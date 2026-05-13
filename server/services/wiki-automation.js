import path from 'node:path';
import fsp from 'node:fs/promises';
import { resolveInProject, readFileSafe, writeFileSafe, assertWriteAllowed } from './fs-utils.js';
import { listChapters } from './chapter-utils.js';
import { parseFrontmatter, stringifyFrontmatter, listOpenForeshadows } from './wiki.js';

const KNOWLEDGE_DIRS = [
  'knowledge/entities',
  'knowledge/concepts',
  'knowledge/locations',
  'knowledge/world',
  'knowledge/synthesis',
];

const REQUIRED_BY_TYPE = {
  character: ['id', 'type', 'name', 'aliases', 'first_appear_chapter', 'last_update_chapter'],
  item: ['id', 'type', 'name', 'aliases', 'first_appear_chapter', 'last_update_chapter'],
  faction: ['id', 'type', 'name', 'aliases', 'first_appear_chapter', 'last_update_chapter'],
  concept: ['id', 'type', 'name', 'aliases', 'first_appear_chapter'],
  system: ['id', 'type', 'name', 'aliases', 'first_appear_chapter'],
  rule: ['id', 'type', 'name', 'aliases', 'first_appear_chapter'],
  location: ['id', 'type', 'name', 'aliases', 'first_appear_chapter'],
  synthesis: ['id', 'type', 'title', 'derived_from', 'confidence', 'tier'],
};

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || `synthesis-${Date.now()}`;
}

async function listMdFiles(projectName, relDir) {
  const abs = resolveInProject(projectName, relDir);
  try {
    const names = await fsp.readdir(abs);
    return names.filter((n) => n.endsWith('.md')).map((n) => `${relDir}/${n}`);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function readLogIngestedChapters(projectName) {
  const txt = await readFileSafe(resolveInProject(projectName, 'knowledge/log.md')) || '';
  const out = new Set();
  const re = /##\s*第\s*(\d+)\s*章/g;
  let m;
  while ((m = re.exec(txt)) !== null) out.add(Number(m[1]));
  return out;
}

export async function getWikiPending(projectName) {
  if (!projectName) return { pending: [], count: 0 };
  const [chapters, ingested] = await Promise.all([
    listChapters(projectName),
    readLogIngestedChapters(projectName),
  ]);
  const pending = chapters
    .filter((c) => !ingested.has(Number(c.chapter)))
    .map((c) => ({ chapter: c.chapter, title: c.title, relPath: `chapters/${c.file}` }));
  return { pending, count: pending.length };
}

export async function buildWikiPendingBlock(projectName) {
  const { pending } = await getWikiPending(projectName);
  if (!pending.length) return '';
  const rows = pending.slice(0, 10).map((c) => `- 第 ${c.chapter} 章《${c.title}》：${c.relPath}`).join('\n');
  return `<wiki_pending>\n以下章节已保存但尚未沉淀到 knowledge/log.md。你必须优先处理：\n${rows}\n\n规则：先 read_file 对应章节正文，再调用 wiki_ingest({chapter,...}) 消费 pending；若用户明确说本章无沉淀，也要用 wiki_ingest 写 summary 占位。不要在 pending 未消费时继续写新章。\n</wiki_pending>`;
}

async function latestChapterNumber(projectName) {
  const chapters = await listChapters(projectName);
  return chapters.length ? Math.max(...chapters.map((c) => Number(c.chapter) || 0)) : 0;
}

export async function getWikiLintDue(projectName) {
  if (!projectName) return { due: false, latestChapter: 0, lastCoverage: 0 };
  const latestChapter = await latestChapterNumber(projectName);
  const report = await readFileSafe(resolveInProject(projectName, 'knowledge/lint-report.md')) || '';
  const { meta } = parseFrontmatter(report);
  const lastCoverage = Number(meta.coverage_chapter || 0);
  const due = latestChapter > 0 && latestChapter % 10 === 0 && lastCoverage < latestChapter;
  return { due, latestChapter, lastCoverage };
}

export async function buildWikiLintDueBlock(projectName) {
  const due = await getWikiLintDue(projectName);
  if (!due.due) return '';
  return `<lint_due chapter="${due.latestChapter}">\n当前作品已写到第 ${due.latestChapter} 章，且 knowledge/lint-report.md 尚未覆盖该章。下一轮涉及设定、写章或体检时，应调用 wiki_lint({scope:"mechanical", currentChapter:${due.latestChapter}})。wiki_lint 只写报告，不自动改 canon。\n</lint_due>`;
}

export async function archiveSynthesis(projectName, payload = {}) {
  if (!projectName) throw new Error('未激活作品');
  const title = String(payload.title || payload.thesis || '').trim();
  if (!title) throw new Error('缺少 title/thesis');
  const thesis = String(payload.thesis || '').trim() || title;
  const derived = Array.isArray(payload.derived_from) ? payload.derived_from.map(String).filter(Boolean) : [];
  if (derived.length < 2) throw new Error('derived_from 至少需要 2 个来源路径/条目');
  const confidence = Math.max(0, Math.min(1, Number(payload.confidence ?? 0.65)));
  const slug = slugify(payload.slug || title);
  const relPath = `knowledge/synthesis/${slug}.md`;
  assertWriteAllowed('wiki_archive', relPath);
  assertWriteAllowed('wiki_archive', 'knowledge/log.md');
  const body = String(payload.body || '').trim() || `# ${title}\n\n## 结论\n${thesis}\n\n## 推导来源\n${derived.map((d) => `- ${d}`).join('\n')}\n`;
  const meta = {
    id: slug,
    type: 'synthesis',
    title,
    thesis,
    derived_from: derived,
    confidence,
    tier: payload.tier || 'working',
    last_confirmed: new Date().toISOString().slice(0, 10),
  };
  await writeFileSafe(resolveInProject(projectName, relPath), stringifyFrontmatter(meta, body));
  const logAbs = resolveInProject(projectName, 'knowledge/log.md');
  const old = await readFileSafe(logAbs) || '# 章节摘要时间线\n\n';
  await writeFileSafe(logAbs, `${old.trimEnd()}\n\n- archive | ${title} | ${relPath} | confidence=${confidence}\n`);
  return { ok: true, relPath, slug, title, confidence };
}

export async function runWikiLint(projectName, { currentChapter = null, scope = 'mechanical' } = {}) {
  if (!projectName) throw new Error('未激活作品');
  const latest = currentChapter || await latestChapterNumber(projectName);
  const allFiles = [];
  for (const dir of KNOWLEDGE_DIRS) allFiles.push(...await listMdFiles(projectName, dir));

  const issues = [];
  const seenIds = new Map();
  for (const rel of allFiles) {
    const txt = await readFileSafe(resolveInProject(projectName, rel));
    const { meta, body } = parseFrontmatter(txt || '');
    const id = meta.id || path.basename(rel, '.md');
    const type = meta.type || (rel.includes('/synthesis/') ? 'synthesis' : rel.includes('/locations/') ? 'location' : rel.includes('/concepts/') ? 'concept' : rel.includes('/world/') ? 'world' : 'character');
    if (seenIds.has(id)) issues.push({ level: 'warning', kind: 'duplicate_id', path: rel, message: `id 与 ${seenIds.get(id)} 重复：${id}` });
    else seenIds.set(id, rel);
    const required = REQUIRED_BY_TYPE[type] || [];
    const missing = required.filter((k) => meta[k] == null || meta[k] === '' || (Array.isArray(meta[k]) && meta[k].length === 0));
    if (missing.length) issues.push({ level: 'warning', kind: 'frontmatter_missing', path: rel, message: `缺字段：${missing.join(', ')}` });
    if (!String(body || '').trim()) issues.push({ level: 'info', kind: 'empty_body', path: rel, message: '正文为空' });
    if (/TODO|待补|请补|补全/.test(String(body || '')) && String(body || '').length < 600) {
      issues.push({ level: 'warning', kind: 'stub_body', path: rel, message: '疑似占位 stub 尚未补全' });
    }
  }

  let foreshadowStats = null;
  try {
    const open = await listOpenForeshadows(projectName);
    const aged = open.filter((f) => latest && f.set_chapter && latest - Number(f.set_chapter) >= 5);
    foreshadowStats = { open: open.length, aged: aged.length };
    for (const f of aged) {
      issues.push({ level: 'info', kind: 'aged_foreshadow', path: f.on_slug, message: `${f.tag} 已悬置 ${latest - Number(f.set_chapter)} 章` });
    }
  } catch {}

  const critical = issues.filter((x) => x.level === 'critical').length;
  const warning = issues.filter((x) => x.level === 'warning').length;
  const info = issues.filter((x) => x.level === 'info').length;
  const md = renderLintReport({ projectName, latest, scope, files: allFiles, issues, critical, warning, info, foreshadowStats });
  const relPath = 'knowledge/lint-report.md';
  assertWriteAllowed('wiki_lint', relPath);
  await writeFileSafe(resolveInProject(projectName, relPath), md);
  return { ok: true, relPath, coverage_chapter: latest, files: allFiles.length, issues: issues.length, critical, warning, info };
}

function renderLintReport({ projectName, latest, scope, files, issues, critical, warning, info, foreshadowStats }) {
  const meta = stringifyFrontmatter({
    type: 'wiki_lint_report',
    project: projectName,
    scope,
    coverage_chapter: latest,
    generated_at: new Date().toISOString(),
    files_scanned: files.length,
    critical,
    warning,
    info,
  }, '');
  const rows = issues.length
    ? issues.map((x) => `| ${x.level} | ${x.kind} | ${x.path || ''} | ${String(x.message || '').replace(/\|/g, '/')} |`).join('\n')
    : '| pass | all | knowledge/ | 未发现机械问题 |';
  return `${meta.trimEnd()}\n# Wiki 体检报告\n\n## 概览\n- 覆盖章：第 ${latest || 0} 章\n- 扫描文件：${files.length}\n- critical/warning/info：${critical}/${warning}/${info}\n- open 伏笔：${foreshadowStats ? `${foreshadowStats.open}（悬置≥5章：${foreshadowStats.aged}）` : '未统计'}\n\n## 问题清单\n| level | kind | path | message |\n|---|---|---|---|\n${rows}\n\n## 原则\n本报告只体检，不自动修改 canon；是否修复由作者拍板。\n`;
}
