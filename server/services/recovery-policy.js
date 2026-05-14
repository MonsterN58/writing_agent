import path from 'node:path';
import { inferOwnerTool } from './edit-file.js';
import { parseChapterFile } from './chapter-utils.js';
import { parseFrontmatter } from './frontmatter.js';

export function planRecovery({ toolName, args = {}, err, classified } = {}) {
  const kind = err?.kind || classified?.kind || inferKind(err);
  const context = err?.context || classified?.context || {};
  const message = String(err?.message || '');

  if (/^setup_incomplete_before_/.test(kind)) {
    return inject('setup_status', {}, '立项阶段不足，自动先检查 setup_status');
  }

  if (kind === 'skill_must_call_tools') {
    const missing = Array.isArray(context.missing) ? context.missing : missingFromMessage(message);
    const next = firstRecoverableMissing(missing, args);
    if (next) return next;
  }

  if (kind === 'file_not_found' || /文件不存在/.test(message)) {
    const p = args.path || args.subPath || '';
    return inject('list_files', { subPath: safeDirname(p) }, '文件不存在，自动列出同目录文件');
  }

  if (kind === 'no_active_project' || /未激活作品/.test(message)) {
    return inject('list_projects', {}, '当前没有激活作品，自动列出作品');
  }

  if (toolName === 'edit_file' && /old_str|未找到|不唯一|匹配|occurrence|ambiguous|not_found/.test(message)) {
    if (args.path) return inject('read_file', { path: args.path, maxChars: 0 }, 'edit_file 定位失败，自动读取目标文件全文');
  }

  if (kind === 'path_not_in_whitelist') {
    const reroute = rerouteWriteTool({ toolName, args });
    if (reroute) return reroute;
    return {
      kind,
      note: '写入工具与路径不匹配，需要换用 recovery_hint 建议的 owner tool',
      userMessage: '[系统恢复｜非用户消息] 刚才写入路径不在该工具白名单内。请根据工具错误 hint 换用正确写工具，不要原地重试。',
    };
  }

  return null;
}

function inject(name, args, note) {
  return { kind: 'inject_tool', injectToolCall: { name, args }, note };
}

function inferKind(err) {
  const msg = String(err?.message || err || '');
  if (/文件不存在/.test(msg)) return 'file_not_found';
  if (/未激活作品/.test(msg)) return 'no_active_project';
  if (/不允许写入路径/.test(msg)) return 'path_not_in_whitelist';
  return 'unknown';
}

function missingFromMessage(message) {
  const out = [];
  for (const name of ['setup_status', 'get_chapter_context', 'lookup_query', 'wiki_query', 'read_file', 'conflict_check']) {
    if (message.includes(name)) out.push(name);
  }
  return out;
}

function firstRecoverableMissing(missing, args) {
  const set = new Set(missing || []);
  if (set.has('setup_status')) return inject('setup_status', {}, '自动补跑 setup_status');
  if (set.has('get_chapter_context') && args.chapter) return inject('get_chapter_context', { chapter: Number(args.chapter) }, '自动补跑 get_chapter_context');
  if (set.has('lookup_query')) return inject('lookup_query', { keywords: [], limit: 12 }, '自动补跑 lookup_query');
  if (set.has('wiki_query')) return inject('wiki_query', { keywords: [] }, '自动补跑 wiki_query');
  if (set.has('read_file')) return inject('read_file', { path: 'outline/overall.md', maxChars: 4000 }, '自动补读 outline/overall.md');
  if (set.has('conflict_check')) return inject('conflict_check', { changes: [] }, '自动补跑 conflict_check');
  return null;
}

function safeDirname(p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (!s || s.includes('..') || path.isAbsolute(s)) return '';
  const d = path.posix.dirname(s);
  return d === '.' ? '' : d;
}

function rerouteWriteTool({ toolName, args = {} }) {
  const relPath = normalizeRelPath(args.path);
  if (!relPath) return null;
  const owner = inferOwnerTool(relPath);
  if (!owner || owner === toolName) return null;

  if (owner === 'setup_work' && typeof args.content === 'string') {
    return inject('setup_work', { content: args.content }, `路径 ${relPath} 应由 setup_work 写入，自动改道`);
  }

  if (owner === 'write_outline' && typeof args.content === 'string') {
    return inject('write_outline', { path: relPath, content: args.content }, `路径 ${relPath} 属于 outline，自动改道到 write_outline`);
  }

  if (owner === 'wiki_ingest' && typeof args.content === 'string' && (!args.mode || args.mode === 'overwrite')) {
    const nextArgs = buildWikiIngestArgs(relPath, args.content, args);
    if (nextArgs) return inject('wiki_ingest', nextArgs, `路径 ${relPath} 属于 wiki 页面，自动改道到 wiki_ingest`);
  }

  if (owner === 'update_progress' && typeof args.content === 'string') {
    const nextArgs = { path: relPath, content: args.content };
    if (typeof args.mode === 'string') nextArgs.mode = args.mode;
    return inject('update_progress', nextArgs, `路径 ${relPath} 属于 progress/world/relations 资产，自动改道到 update_progress`);
  }

  if (owner === 'write_chapter' && typeof args.content === 'string') {
    const parsed = parseChapterFromPath(relPath);
    if (!parsed) return null;
    return inject('write_chapter', { chapter: parsed.chapter, title: parsed.title, content: args.content }, `路径 ${relPath} 可解析为章节文件，自动改道到 write_chapter`);
  }

  return null;
}

function normalizeRelPath(p) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  if (!s || s.includes('..') || path.isAbsolute(s)) return '';
  return s;
}

function parseChapterFromPath(relPath) {
  const base = path.posix.basename(relPath);
  return parseChapterFile(base);
}

function buildWikiIngestArgs(relPath, content, args = {}) {
  const kind = inferWikiKind(relPath);
  if (!kind) return null;

  const { data, body } = parseFrontmatter(content);
  const slug = path.posix.basename(relPath, '.md');
  const name = String(data.name || humanizeSlug(slug)).trim();
  if (!name) return null;

  const base = {};
  const chapter = Number(args.chapter);
  if (Number.isInteger(chapter) && chapter > 0) base.chapter = chapter;
  if (typeof args.chapter_title === 'string' && args.chapter_title.trim()) base.chapter_title = args.chapter_title.trim();

  if (kind === 'location') {
    return {
      ...base,
      new_locations: [{
        name,
        slug,
        body,
        aliases: normalizeStringArray(data.aliases),
        status: asNonEmptyString(data.status),
      }],
    };
  }

  if (kind === 'concept') {
    return {
      ...base,
      new_concepts: [{
        name,
        slug,
        body,
        type: normalizeConceptType(data.type),
      }],
    };
  }

  if (kind === 'entity') {
    const type = normalizeEntityType(data.type);
    if (!type) return null;
    return {
      ...base,
      new_entities: [{
        name,
        slug,
        type,
        body,
        aliases: normalizeStringArray(data.aliases),
        faction: asNonEmptyString(data.faction),
        status: asNonEmptyString(data.status),
        location: asNonEmptyString(data.location),
        appearance: asNonEmptyString(data.appearance),
        motivation: asNonEmptyString(data.motivation),
        arc_goal: asNonEmptyString(data.arc_goal),
        abilities: normalizeStringArray(data.abilities),
        inventory: normalizeStringArray(data.inventory),
      }],
    };
  }

  return null;
}

function inferWikiKind(relPath) {
  if (relPath.startsWith('knowledge/locations/')) return 'location';
  if (relPath.startsWith('knowledge/concepts/')) return 'concept';
  if (relPath.startsWith('knowledge/entities/')) return 'entity';
  return null;
}

function humanizeSlug(slug) {
  const text = String(slug || '').replace(/[-_]+/g, ' ').trim();
  if (!text) return '';
  return text.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function normalizeEntityType(value) {
  const t = String(value || '').trim().toLowerCase();
  return ['character', 'item', 'faction'].includes(t) ? t : '';
}

function normalizeConceptType(value) {
  const t = String(value || '').trim().toLowerCase();
  return ['system', 'rule', 'concept'].includes(t) ? t : 'concept';
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
}

function asNonEmptyString(value) {
  const s = String(value || '').trim();
  return s || undefined;
}
