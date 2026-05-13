// 【A4】读者视角独立打分：扮演目标读者群，给"爽点 / 疲劳 / 追读欲"三维评分
// - 用 cheap 档独立 LLM 调用，不影响主流程
// - 落 reviews/reader/第N章.md（人类可读）+ reviews/reader/第N章.json（机器可读）
import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';
import { readSoul } from './projects.js';
import { runSubAgent } from './subagents/runner.js';

const READER_SYSTEM = `你是网文目标读者群的代表，**不是编辑、不是作家**。
你以普通读者视角对刚读完的本章打分，关注三件事：
1. **爽点强度 (hook 0-100)**：本章给我带来的多少"想拍桌子叫好/笑出来/紧张到屏息/泪目"的瞬间。空气段、流水账、推情节但不上头 = 低分。
2. **疲劳度 (fatigue 0-100)**：读着累、跳读、想关页面、信息密度过高、情感连续轰炸的程度。**越高越糟**。
3. **追读欲 (retention 0-100)**：读完想立刻看下一章的程度。结尾钩子、悬念、情感回旋。

不要客气，不要客观分析，**就用读者的本能反应说话**。
也指出最让你出戏 / 兴奋的具体段落（≤50 字摘录）。`;

const READER_SCHEMA = {
  hook: 0,
  fatigue: 0,
  retention: 0,
  reading_emotion: '一句话总结你的阅读感受',
  hook_lines: ['让你眼前一亮的具体段落摘录（≤50字 × 最多3条）'],
  problem_lines: ['让你出戏/想跳过的具体段落摘录（≤50字 × 最多3条）'],
  next_chapter_attractor: '我会因为什么继续读下一章（如果会的话）',
  audience_match: '本章对目标读者（参考下方）契合度 0-100',
  one_line_advice: '给作者一句话的建议',
};

function readerOutPathMd(chapter) {
  return `reviews/reader/第${chapter}章.md`;
}
function readerOutPathJson(chapter) {
  return `reviews/reader/第${chapter}章.json`;
}

/**
 * @param {object} opts { projectName, chapter, title, content, audience?, signal?, emit? }
 * @returns {Promise<{ok, data?, mdPath?, jsonPath?, error?}>}
 */
export async function scoreChapterAsReader(opts) {
  const { projectName, chapter, title, content, signal, emit } = opts;
  if (!projectName || !chapter || !content) return { ok: false, error: '缺少 projectName / chapter / content' };

  // 取 SOUL 里的目标读者描述（如果用户填了）作为 persona 锚
  let audience = opts.audience || '';
  if (!audience) {
    const soul = await readSoul(projectName);
    const m = /目标读者[：:]\s*([^\n]+)/.exec(String(soul || ''));
    audience = m ? m[1].trim() : '一般网文读者';
  }

  const userPrompt = [
    `## 你扮演的读者画像`,
    audience,
    '',
    `## 本章正文（第 ${chapter} 章${title ? ' · ' + title : ''}）`,
    String(content || '').slice(0, 16000),
  ].join('\n');

  const r = await runSubAgent({
    role: `reader-score#${chapter}`,
    systemPrompt: READER_SYSTEM,
    userPrompt,
    schema: READER_SCHEMA,
    profile: 'cheap',
    signal,
    emit,
    timeoutMs: 120000,
  });

  if (!r.ok) return { ok: false, error: r.error || '读者打分失败' };
  const d = r.data;
  // 字段兜底
  const safe = (v, def) => (v == null ? def : v);
  const data = {
    chapter,
    title: title || '',
    audience,
    hook: Number(safe(d.hook, 0)) || 0,
    fatigue: Number(safe(d.fatigue, 0)) || 0,
    retention: Number(safe(d.retention, 0)) || 0,
    audience_match: Number(safe(d.audience_match, 0)) || 0,
    reading_emotion: String(safe(d.reading_emotion, '')),
    hook_lines: Array.isArray(d.hook_lines) ? d.hook_lines.slice(0, 5) : [],
    problem_lines: Array.isArray(d.problem_lines) ? d.problem_lines.slice(0, 5) : [],
    next_chapter_attractor: String(safe(d.next_chapter_attractor, '')),
    one_line_advice: String(safe(d.one_line_advice, '')),
    scoredAt: new Date().toISOString(),
  };

  // 综合分：hook 40% + retention 40% + (100-fatigue) 20%
  data.composite = Math.round(data.hook * 0.4 + data.retention * 0.4 + (100 - data.fatigue) * 0.2);

  // 落盘
  const md = renderReaderReportMd(data);
  const mdPath = readerOutPathMd(chapter);
  const jsonPath = readerOutPathJson(chapter);
  await writeFileSafe(resolveInProject(projectName, mdPath), md);
  await writeFileSafe(resolveInProject(projectName, jsonPath), JSON.stringify(data, null, 2));
  return { ok: true, data, mdPath, jsonPath };
}

function bar(score, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function renderReaderReportMd(d) {
  return `# 第 ${d.chapter} 章 · 读者视角打分${d.title ? ' · ' + d.title : ''}

> 评分日期：${d.scoredAt}  
> 读者画像：${d.audience}  
> **综合分：${d.composite}/100**

| 维度 | 分数 |
|---|---|
| 爽点强度 (hook) | ${bar(d.hook)} ${d.hook} |
| 追读欲 (retention) | ${bar(d.retention)} ${d.retention} |
| 疲劳度 (fatigue) | ${bar(d.fatigue)} ${d.fatigue} *(越低越好)* |
| 读者契合度 | ${bar(d.audience_match)} ${d.audience_match} |

## 读者本能反应
${d.reading_emotion}

## 让人眼前一亮的段落
${d.hook_lines.length ? d.hook_lines.map((l) => `- ${l}`).join('\n') : '（无）'}

## 让人出戏 / 想跳过的段落
${d.problem_lines.length ? d.problem_lines.map((l) => `- ${l}`).join('\n') : '（无）'}

## 下一章吸引力
${d.next_chapter_attractor}

## 一句话建议
${d.one_line_advice}
`;
}
