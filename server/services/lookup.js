// Knowledge Lookup：写章前的设定路径索引
import path from 'node:path';
import fsp from 'node:fs/promises';
import yaml from 'js-yaml';
import { resolveInProject, readFileSafe, writeFileSafe, assertWriteAllowed } from './fs-utils.js';

export const LOOKUP_JSON = 'knowledge/lookup.json';
export const LOOKUP_MD = 'knowledge/lookup.md';
const LOOKUP_VERSION = 1;
const SCAN_DIRS = ['knowledge/entities', 'knowledge/concepts', 'knowledge/locations', 'knowledge/world'];

export async function readLookup(projectName) {
  const txt = await readFileSafe(resolveInProject(projectName, LOOKUP_JSON));
  if (!txt) return emptyLookup();
  try {
    return normalizeLookup(JSON.parse(txt));
  } catch {
    return emptyLookup();
  }
}

export async function writeLookup(projectName, data, toolName = 'lookup_upsert') {
  assertWriteAllowed(toolName, LOOKUP_JSON);
  assertWriteAllowed(toolName, LOOKUP_MD);
  const normalized = normalizeLookup(data);
  normalized.updated_at = new Date().toISOString();
  await writeFileSafe(resolveInProject(projectName, LOOKUP_JSON), JSON.stringify(normalized, null, 2));
  await writeFileSafe(resolveInProject(projectName, LOOKUP_MD), renderLookupMd(normalized));
  return { ok: true, relPaths: [LOOKUP_JSON, LOOKUP_MD], count: normalized.topics.length, lookup: normalized };
}

export async function lookupList(projectName, { kind } = {}) {
  const lookup = await readLookup(projectName);
  const topics = kind ? lookup.topics.filter((t) => t.kind === kind) : lookup.topics;
  return { topics, count: topics.length, relPath: LOOKUP_JSON };
}

export async function lookupUpsert(projectName, topic) {
  const lookup = await readLookup(projectName);
  const normalized = normalizeTopic(topic);
  if (!normalized) throw new Error('lookup topic 缺少 id/title/paths 等必要字段');
  const idx = lookup.topics.findIndex((t) => t.id === normalized.id);
  if (idx >= 0) lookup.topics[idx] = { ...lookup.topics[idx], ...normalized };
  else lookup.topics.push(normalized);
  const written = await writeLookup(projectName, lookup, 'lookup_upsert');
  return { ok: true, topic: normalized, relPaths: written.relPaths, count: written.count };
}

export async function lookupRemove(projectName, id) {
  const lookup = await readLookup(projectName);
  const before = lookup.topics.length;
  lookup.topics = lookup.topics.filter((t) => t.id !== String(id || '').trim());
  const written = await writeLookup(projectName, lookup, 'lookup_remove');
  return { ok: true, removed: before - lookup.topics.length, id, relPaths: written.relPaths, count: written.count };
}

export async function lookupQuery(projectName, query = {}) {
  const lookup = await readLookup(projectName);
  const signals = normalizeSignals(query);
  const scored = [];
  for (const topic of lookup.topics) {
    const score = scoreTopic(topic, signals);
    if (score.score > 0) scored.push({ ...topic, _score: score.score, _why: score.why });
  }
  scored.sort((a, b) => b._score - a._score || Number(b.must_read) - Number(a.must_read) || a.id.localeCompare(b.id));
  const limit = clampInt(query.limit, 1, 30, 12);
  const topics = scored.slice(0, limit);
  return { topics, paths: collectPaths(topics), count: topics.length, signals };
}

export async function lookupRebuild(projectName) {
  const existing = await readLookup(projectName);
  const preserved = existing.topics.filter((t) => !['rebuild', 'wiki_ingest'].includes(t.source));
  const generated = [];
  for (const dir of SCAN_DIRS) {
    const absDir = resolveInProject(projectName, dir);
    let files = [];
    try { files = await fsp.readdir(absDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const file of files.filter((x) => x.endsWith('.md'))) {
      const relPath = `${dir}/${file}`;
      const topic = await topicFromWikiPath(projectName, relPath, 'rebuild');
      if (topic) generated.push(topic);
    }
  }
  const byId = new Map();
  for (const topic of [...preserved, ...generated]) byId.set(topic.id, topic);
  const written = await writeLookup(projectName, { version: LOOKUP_VERSION, topics: [...byId.values()] }, 'lookup_rebuild');
  return { ok: true, generated: generated.length, preserved: preserved.length, relPaths: written.relPaths, count: written.count };
}

export async function syncLookupForWikiPath(projectName, relPath) {
  const topic = await topicFromWikiPath(projectName, relPath, 'wiki_ingest');
  if (!topic) return { ok: false, skipped: true, relPath };
  return await lookupUpsert(projectName, topic);
}

async function topicFromWikiPath(projectName, relPath, source) {
  const rel = normalizePath(relPath);
  if (!/^knowledge\/(entities|concepts|locations|world)\//.test(rel) || !rel.endsWith('.md')) return null;
  const txt = await readFileSafe(resolveInProject(projectName, rel));
  if (!txt) return null;
  const { meta, body } = parseFrontmatter(txt);
  const slug = meta.id || path.basename(rel, '.md');
  const title = meta.name || titleFromPath(rel);
  const type = meta.type || kindFromPath(rel);
  return normalizeTopic({
    id: slugify(slug || title),
    title,
    kind: normalizeKind(type, rel),
    triggers: compact([title, slug, meta.status, meta.faction, ...(asArray(meta.aliases)), ...(asArray(meta.abilities)), ...extractKeywords(body)]),
    characters: type === 'character' ? compact([title, ...asArray(meta.aliases)]) : [],
    scenes: inferScenes(`${title}\n${body}`),
    paths: [rel],
    must_read: true,
    source,
  });
}

function normalizeLookup(data) {
  const topics = Array.isArray(data?.topics) ? data.topics.map(normalizeTopic).filter(Boolean) : [];
  const seen = new Map();
  for (const topic of topics) seen.set(topic.id, topic);
  return { version: Number(data?.version || LOOKUP_VERSION), updated_at: data?.updated_at || null, topics: [...seen.values()] };
}

function normalizeTopic(topic) {
  const title = String(topic?.title || topic?.name || topic?.id || '').trim();
  const id = slugify(topic?.id || title);
  if (!id || !title) return null;
  return {
    id,
    title,
    kind: normalizeKind(topic?.kind || topic?.type || 'concept'),
    triggers: uniq([...(asArray(topic?.triggers)), title]),
    characters: uniq(asArray(topic?.characters)),
    scenes: uniq(asArray(topic?.scenes)),
    paths: uniq(asArray(topic?.paths).map(normalizePath).filter(Boolean)),
    must_read: topic?.must_read !== false,
    source: String(topic?.source || 'manual'),
  };
}

function normalizeKind(kind, relPath = '') {
  const k = String(kind || '').trim().toLowerCase();
  if (['world', 'entity', 'concept', 'location', 'rule', 'foreshadow'].includes(k)) return k;
  if (['character', 'faction', 'item'].includes(k)) return 'entity';
  if (relPath.includes('/world/')) return 'world';
  if (relPath.includes('/locations/')) return 'location';
  if (relPath.includes('/entities/')) return 'entity';
  return 'concept';
}

function normalizePath(p) {
  const s = String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..')) return '';
  return s;
}

function normalizeSignals(query) {
  return {
    scenes: uniq([...asArray(query.scene), ...asArray(query.scenes)]),
    characters: uniq(asArray(query.characters)),
    keywords: uniq(asArray(query.keywords)),
  };
}

function scoreTopic(topic, signals) {
  const why = [];
  let score = 0;
  const hay = uniq([topic.title, topic.id, ...topic.triggers, ...topic.characters, ...topic.scenes, ...topic.paths]).map(norm);
  const addMatches = (items, weight, label) => {
    for (const item of items) {
      const n = norm(item);
      if (!n) continue;
      const hit = hay.some((h) => h.includes(n) || n.includes(h));
      if (hit) { score += weight; why.push(`${label}:${item}`); }
    }
  };
  addMatches(signals.characters, 6, 'character');
  addMatches(signals.scenes, 4, 'scene');
  addMatches(signals.keywords, 3, 'keyword');
  if (topic.must_read && score > 0) score += 1;
  return { score, why };
}

function collectPaths(topics) {
  const out = [];
  const seen = new Set();
  for (const topic of topics) {
    for (const p of topic.paths || []) {
      const pathOnly = String(p).split('#')[0];
      const key = pathOnly;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: pathOnly, sourcePath: p, topic_id: topic.id, title: topic.title, why: topic._why || [], must_read: topic.must_read, score: topic._score || 0 });
    }
  }
  return out;
}

function renderLookupMd(lookup) {
  const rows = lookup.topics.map((t) => `| ${t.id} | ${t.title} | ${t.kind} | ${t.must_read ? '是' : '否'} | ${(t.triggers || []).slice(0, 8).join('、')} | ${(t.paths || []).join('<br>')} |`);
  return `# Knowledge Lookup\n\n> 自动维护的设定召回索引。机读源文件：\`${LOOKUP_JSON}\`。最后更新：${lookup.updated_at || '未知'}\n\n| id | 标题 | 类型 | 必读 | 触发词 | 路径 |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text || ''));
  if (!m) return { meta: {}, body: String(text || '') };
  let meta = {};
  try { meta = yaml.load(m[1]) || {}; } catch { meta = {}; }
  return { meta, body: m[2] || '' };
}

function extractKeywords(body) {
  const txt = String(body || '').slice(0, 1500);
  return [...new Set((txt.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || []).filter((x) => !/^(这个|那个|一种|可以|如果|但是|因为|所以)$/.test(x)).slice(0, 20))];
}

function inferScenes(text) {
  const s = String(text || '');
  const out = [];
  if (/战斗|打斗|交手|追杀|刀|剑|拳/.test(s)) out.push('战斗');
  if (/突破|境界|晋升|雷劫|修为/.test(s)) out.push('突破');
  if (/炼丹|丹药|药鼎/.test(s)) out.push('炼丹');
  if (/对话|谈判|争吵|对白/.test(s)) out.push('对话');
  if (/赶路|远行|路上/.test(s)) out.push('赶路');
  return out;
}

function titleFromPath(relPath) {
  return path.basename(relPath, '.md').replace(/[-_]/g, ' ');
}

function kindFromPath(relPath) {
  if (relPath.includes('/entities/')) return 'entity';
  if (relPath.includes('/locations/')) return 'location';
  if (relPath.includes('/world/')) return 'world';
  return 'concept';
}

function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function asArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/[，,|]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function uniq(arr) {
  return [...new Set((arr || []).map((x) => String(x || '').trim()).filter(Boolean))];
}

function compact(arr) {
  return (arr || []).map((x) => String(x || '').trim()).filter(Boolean);
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function emptyLookup() {
  return { version: LOOKUP_VERSION, updated_at: null, topics: [] };
}
