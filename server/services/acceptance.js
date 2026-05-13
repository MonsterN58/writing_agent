// 交付验收委员会：合并三视角 critic + 量化分 + 【A2】beat 命中检查，产出 passed/score/blockers/advisories 并落盘报告。
import { resolveInProject, readFileSafe, writeFileSafe, listDirRecursive } from './fs-utils.js';
import { scoreChapterContent } from './quality.js';
import { criticAllViews } from './subagents/roles/critic-views.js';
import { checkBeats } from './beat-checker.js';

const DEFAULTS = {
  minQualityScore: 60,
  maxHighIssues: 0,
  maxMediumIssues: 3,
  minWordCount: 1500,
  minBeatHitRate: 0.7,    // 【A2】beat 命中率门槛
  maxBeatMiss: 1,         // 【A2】最多容忍 1 个完全缺失的 beat
};

export async function loadAcceptanceConfig(projectName) {
  if (!projectName) return { ...DEFAULTS };
  const txt = await readFileSafe(resolveInProject(projectName, '.config/acceptance.json'));
  if (!txt) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(txt) }; } catch { return { ...DEFAULTS }; }
}

/**
 * @param {object} opts
 *   projectName, chapter, title, content, context(canon string), signal, emit
 * @returns {Promise<{passed, score, blockers, advisories, critic, quality, highs, meds, reportPath, chapter, title, content, checkedAt}>}
 */
export async function acceptChapter({ projectName, chapter, title, content, context = '', prevEnding = '', anchors = [], signal, emit }) {
  const cfg = await loadAcceptanceConfig(projectName);
  // 【A2】并行：critic 三视角 + beat 命中检查
  const [critic, beatCheck, stubResidue] = await Promise.all([
    criticAllViews({ chapter, title, content, context, signal, emit }),
    checkBeats({ projectName, chapter, content, signal, emit }).catch((e) => ({ ok: false, error: String(e?.message || e), skipped: true })),
    checkStubResidue(projectName).catch((e) => ({ ok: false, error: String(e?.message || e), stubs: [] })),
  ]);
  const quality = scoreChapterContent({ content, chapter, title, prevEnding, anchors });

  const blockers = [];
  const advisories = [];
  const highs = critic.issues.filter((x) => x.severity === 'high');
  const meds = critic.issues.filter((x) => x.severity === 'medium');

  if (highs.length > cfg.maxHighIssues) blockers.push(`critic:high×${highs.length}`);
  if (critic.verdict === 'rewrite') blockers.push('critic.verdict=rewrite');
  if (quality.total < cfg.minQualityScore) blockers.push(`quality=${quality.total}<${cfg.minQualityScore}`);
  if (quality.wordCount && quality.wordCount < cfg.minWordCount) blockers.push(`word_count=${quality.wordCount}<${cfg.minWordCount}`);
  if (meds.length > cfg.maxMediumIssues) advisories.push(`critic:medium×${meds.length}`);

  // 【A2】beat 命中阻断
  if (beatCheck.ok) {
    if (beatCheck.miss > cfg.maxBeatMiss) {
      const titles = beatCheck.missing.filter((b) => b.severity === 'high').map((b) => b.title).slice(0, 5);
      blockers.push(`beats:miss×${beatCheck.miss}（${titles.join('；')}）`);
    } else if (beatCheck.miss > 0) {
      const titles = beatCheck.missing.filter((b) => b.severity === 'high').map((b) => b.title).slice(0, 3);
      advisories.push(`beats:miss×${beatCheck.miss}（${titles.join('；')}）`);
    }
    if (beatCheck.hitRate < cfg.minBeatHitRate) {
      blockers.push(`beat_hit_rate=${(beatCheck.hitRate * 100).toFixed(0)}%<${(cfg.minBeatHitRate * 100).toFixed(0)}%`);
    }
    if (beatCheck.partial > 2) advisories.push(`beats:partial×${beatCheck.partial}`);
  } else if (beatCheck.skipped) {
    advisories.push(`beat-check skipped: ${beatCheck.error || '无大纲'}`);
  }
  if (stubResidue.ok && stubResidue.stubs.length) {
    advisories.push(`stub_in_canon×${stubResidue.stubs.length}（${stubResidue.stubs.slice(0, 5).map((x) => x.path).join('；')}）`);
  }

  const compositeScore = Math.round(((critic.score ?? 70) + quality.total) / 2);
  const passed = blockers.length === 0;

  const report = {
    chapter,
    title,
    passed,
    score: compositeScore,
    blockers,
    advisories,
    critic: {
      verdict: critic.verdict,
      score: critic.score,
      issues: critic.issues,
      keep_highlights: critic.keep_highlights,
      views: critic.views,
    },
    quality,
    beatCheck,
    stubResidue,
    checkedAt: new Date().toISOString(),
  };
  const rel = `reviews/acceptance/chapter-${chapter}.md`;
  await writeFileSafe(resolveInProject(projectName, rel), renderMd(report));
  emit?.({
    type: 'acceptance_report',
    chapter,
    title,
    passed,
    score: compositeScore,
    blockers,
    advisories,
    relPath: rel,
  });
  return { ...report, highs, meds, reportPath: rel, content };
}

function renderMd(r) {
  const lines = [
    `# 第 ${r.chapter} 章验收报告`,
    ``,
    `- 结果：${r.passed ? '✅ 通过' : '❌ 未通过'}`,
    `- 综合分：${r.score}`,
    `- 量化分：${r.quality.total}（${r.quality.wordCount} 字）`,
    `- Critic verdict：${r.critic.verdict} · 分数 ${r.critic.score ?? '-'}`,
    `- 检查时间：${r.checkedAt}`,
    ``,
    `## Blockers（必改）`,
    ...(r.blockers.length ? r.blockers.map((x) => `- ${x}`) : ['- 无']),
    ``,
    `## Advisories（建议）`,
    ...(r.advisories.length ? r.advisories.map((x) => `- ${x}`) : ['- 无']),
    ``,
    `## 三视角 critic`,
    ...r.critic.views.map((v) => `- ${v.view}: ${v.ok ? `ok · ${v.ms}ms` : `failed · ${v.error || '?'}`}`),
    ``,
    `## Beat 命中（${r.beatCheck?.ok ? `${r.beatCheck.hit}/${r.beatCheck.total} hit · ${r.beatCheck.partial} partial · ${r.beatCheck.miss} miss` : 'skipped'}）`,
    ...(r.beatCheck?.ok && Array.isArray(r.beatCheck.beats)
      ? r.beatCheck.beats.map((b) => {
          const tag = b.verdict === 'hit' ? '✅' : b.verdict === 'partial' ? '⚠️' : '❌';
          return `- ${tag} **${b.title}**${b.evidence ? ` —— ${b.evidence}` : ''}`;
        })
      : ['- （未执行 beat 检查）']),
    ``,
    `## Canon Stub 残留（${r.stubResidue?.stubs?.length || 0}）`,
    ...(r.stubResidue?.stubs?.length ? r.stubResidue.stubs.map((x) => `- ${x.path}（${x.chars} 字）`) : ['- 无']),
    ``,
    `## 问题详情（${r.critic.issues.length} 条）`,
    ...r.critic.issues.map(
      (i) => `- [${i.severity}] **${i.kind}**（${i._view || '?'}）：${i.problem || ''}\n    > ${(i.quote || '').slice(0, 120)}\n    → ${i.suggestion || ''}`
    ),
    ``,
    `## 保留亮点`,
    ...(r.critic.keep_highlights?.length ? r.critic.keep_highlights.map((s) => `- ${s}`) : ['- 无']),
    ``,
  ];
  return lines.join('\n') + '\n';
}

export async function checkStubResidue(projectName) {
  if (!projectName) return { ok: true, stubs: [] };
  const candidates = [
    'knowledge/world/overview.md',
    'knowledge/world/power-system.md',
    'knowledge/world/factions.md',
    'knowledge/world/geography.md',
    'knowledge/world/history.md',
    'knowledge/world/rules.md',
    'knowledge/relationships.md',
    'outline/overall.md',
  ];
  for (const rel of await markdownFiles(projectName, 'outline/volumes')) candidates.push(rel);
  const stubs = [];
  for (const rel of [...new Set(candidates)]) {
    const txt = await readFileSafe(resolveInProject(projectName, rel));
    if (isStubText(txt)) stubs.push({ path: rel, chars: String(txt || '').trim().length });
  }
  return { ok: true, stubs };
}

async function markdownFiles(projectName, subPath) {
  const base = resolveInProject(projectName, subPath);
  const items = await listDirRecursive(base, base);
  return items
    .filter((x) => x.type === 'file' && x.path.endsWith('.md'))
    .map((x) => `${subPath}/${x.path}`);
}

function isStubText(txt) {
  const body = String(txt || '').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return body.length > 0 && body.length <= 260 && /\bTODO\b|待补|请补|补全/.test(body);
}
