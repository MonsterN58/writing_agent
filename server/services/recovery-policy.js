import path from 'node:path';

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
