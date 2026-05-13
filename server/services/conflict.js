// 结构化冲突扫描：改设定 / 改章前的低成本守门，不依赖 LLM。
import path from 'node:path';
import { resolveInProject, readFileSafe, listDirRecursive } from './fs-utils.js';
import { listChapters } from './chapter-utils.js';
import { lookupQuery } from './lookup.js';

export async function conflictCheck(projectName, payload = {}) {
  const changes = normalizeChanges(payload.changes || []);
  const conflicts = [];
  const scanned = { wiki: 0, chapters: 0, lookupPaths: 0 };
  for (const change of changes) {
    const wikiConflicts = await scanWiki(projectName, change);
    scanned.wiki += wikiConflicts.scanned;
    conflicts.push(...wikiConflicts.conflicts);

    const lookup = await lookupQuery(projectName, {
      characters: compact([change.name, change.slug]),
      keywords: compact([change.field, change.from, change.to, change.text]),
      limit: 12,
    });
    scanned.lookupPaths += lookup.paths.length;

    const chapterConflicts = await scanChapters(projectName, change, lookup.paths.map((p) => p.path));
    scanned.chapters += chapterConflicts.scanned;
    conflicts.push(...chapterConflicts.conflicts);
  }
  const risk = classifyRisk(conflicts);
  return {
    ok: true,
    risk,
    suggested_action: risk === 'low' ? 'auto_apply' : 'ask_user',
    conflicts,
    conflictCount: conflicts.length,
    scanned,
  };
}

async function scanWiki(projectName, change) {
  const conflicts = [];
  const candidates = await candidateWikiPaths(projectName, change);
  let scanned = 0;
  for (const relPath of candidates) {
    const txt = await readFileSafe(resolveInProject(projectName, relPath));
    if (!txt) continue;
    scanned += 1;
    if (change.from && !containsLoose(txt, change.from)) {
      conflicts.push({ kind: 'wiki', severity: 'medium', path: relPath, reason: `当前文件未找到原值「${change.from}」，可能不是基于最新设定修改` });
    }
    if (change.to && containsLoose(txt, change.to) && change.op === 'replace') {
      conflicts.push({ kind: 'wiki', severity: 'low', path: relPath, reason: `目标值「${change.to}」已存在，可能无需重复修改` });
    }
  }
  return { conflicts, scanned };
}

async function scanChapters(projectName, change) {
  const conflicts = [];
  const chapters = await listChapters(projectName);
  let scanned = 0;
  const oldTerm = String(change.from || '').trim();
  const slugTerm = String(change.name || change.slug || '').trim();
  if (!oldTerm && !slugTerm) return { conflicts, scanned };
  for (const chapter of chapters) {
    const relPath = `chapters/${chapter.file}`;
    const txt = await readFileSafe(resolveInProject(projectName, relPath));
    if (!txt) continue;
    scanned += 1;
    const oldHit = oldTerm && oldTerm.length >= 2 && containsLoose(txt, oldTerm);
    const slugHit = slugTerm && slugTerm.length >= 2 && containsLoose(txt, slugTerm);
    if (oldHit && (change.to || change.op === 'replace')) {
      conflicts.push({ kind: 'chapter', severity: 'high', chapter: chapter.chapter, path: relPath, line_hint: sampleLine(txt, oldTerm), reason: `既有章节仍出现旧设定「${oldTerm}」` });
    } else if (slugHit && change.field && change.field !== 'body') {
      conflicts.push({ kind: 'chapter', severity: 'medium', chapter: chapter.chapter, path: relPath, line_hint: sampleLine(txt, slugTerm), reason: `章节提到「${slugTerm}」，修改字段 ${change.field} 前建议确认是否需要追改正文` });
    }
  }
  return { conflicts, scanned };
}

async function candidateWikiPaths(projectName, change) {
  const out = new Set();
  if (change.path) out.add(change.path);
  if (change.slug) {
    for (const dir of ['knowledge/entities', 'knowledge/concepts', 'knowledge/locations']) {
      out.add(`${dir}/${change.slug}.md`);
    }
  }
  const tree = await listDirRecursive(resolveInProject(projectName, 'knowledge'));
  for (const item of tree) {
    if (item.type !== 'file' || !item.path.endsWith('.md')) continue;
    const rel = `knowledge/${item.path}`.replaceAll('\\', '/');
    if (change.name && item.name.includes(change.name)) out.add(rel);
    if (change.slug && item.name.includes(change.slug)) out.add(rel);
  }
  return [...out].filter((p) => /^knowledge\//.test(p) && !p.includes('..'));
}

function normalizeChanges(changes) {
  return (Array.isArray(changes) ? changes : []).map((c) => ({
    kind: String(c.kind || 'setting'),
    slug: safeToken(c.slug),
    name: String(c.name || '').trim(),
    path: normalizePath(c.path),
    field: String(c.field || '').trim(),
    op: String(c.op || (c.from && c.to ? 'replace' : 'append')),
    from: String(c.from || '').trim(),
    to: String(c.to || '').trim(),
    text: String(c.text || '').trim(),
  })).filter((c) => c.slug || c.name || c.path || c.from || c.to || c.text);
}

function classifyRisk(conflicts) {
  if (conflicts.some((c) => c.severity === 'high')) return 'high';
  if (conflicts.some((c) => c.severity === 'medium')) return 'medium';
  return 'low';
}

function containsLoose(text, term) {
  return norm(text).includes(norm(term));
}

function sampleLine(text, term) {
  const lines = String(text || '').split(/\r?\n/);
  const n = norm(term);
  const idx = lines.findIndex((line) => norm(line).includes(n));
  if (idx < 0) return '';
  return `L${idx + 1}: ${lines[idx].trim().slice(0, 160)}`;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizePath(p) {
  const s = String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..') || path.isAbsolute(s)) return '';
  return s;
}

function safeToken(s) {
  return String(s || '').trim().replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function compact(arr) {
  return (arr || []).map((x) => String(x || '').trim()).filter(Boolean);
}
