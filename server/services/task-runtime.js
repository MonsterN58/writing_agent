const VALID_STATUS = new Set(['pending', 'in_progress', 'done', 'skipped']);

export function inferTaskOwnerTool(task = {}) {
  const text = `${task.title || ''} ${task.note || ''}`;
  if (/查询|读取|核对|上下文|素材|文件|读/.test(text)) return 'read_file';
  if (/setup_status|检查.*立项|立项.*状态|manifest/i.test(text)) return 'setup_status';
  if (/setup_repair|补齐|占位|缺口|repair/i.test(text)) return 'setup_repair';
  if (/SOUL|作品宪章|核心设定|立项/i.test(text)) return 'setup_work';
  if (/写.*章|章节正文|正文|write_chapter/i.test(text)) return 'write_chapter';
  if (/总纲|大纲|卷纲|细纲|章纲|outline|arc/i.test(text)) return 'write_outline';
  if (/世界观|关系图|relationships|progress|memory|style|反馈|设定补充/i.test(text)) return 'update_progress';
  if (/wiki_ingest|知识沉淀|沉淀|实体|人物卡|伏笔/i.test(text)) return 'wiki_ingest';
  return null;
}

export function normalizeTasks(tasks = []) {
  const out = [];
  let activeSeen = false;
  for (let i = 0; i < tasks.length; i += 1) {
    const raw = tasks[i] || {};
    let status = VALID_STATUS.has(raw.status) ? raw.status : 'pending';
    if (status === 'in_progress') {
      if (activeSeen) status = 'pending';
      activeSeen = true;
    }
    out.push({
      id: String(raw.id || `t${i + 1}`),
      title: String(raw.title || `任务 ${i + 1}`),
      status,
      note: raw.note ? String(raw.note) : '',
      ownerTool: raw.ownerTool || inferTaskOwnerTool(raw),
    });
  }
  if (!activeSeen) {
    const first = out.find((t) => t.status === 'pending');
    if (first) first.status = 'in_progress';
  }
  return out;
}

export function createTaskRuntime(tasks = []) {
  const normalized = normalizeTasks(tasks);
  return {
    tasks: normalized,
    current: normalized.find((t) => t.status === 'in_progress') || null,
    openCount: normalized.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
    completedCount: normalized.filter((t) => t.status === 'done').length,
  };
}

export function summarizeTaskRuntime(runtime) {
  if (!runtime) return '';
  const current = runtime.current ? `${runtime.current.id}:${runtime.current.title}` : 'none';
  return `open=${runtime.openCount} done=${runtime.completedCount} current=${current}`;
}

export function advanceTaskRuntime(runtime, toolName) {
  if (!runtime?.tasks?.length || !toolName) return { changed: false };
  const current = runtime.tasks.find((t) => t.status === 'in_progress');
  if (!current || !current.ownerTool || current.ownerTool !== toolName) return { changed: false };
  current.status = 'done';
  const next = runtime.tasks.find((t) => t.status === 'pending');
  if (next) next.status = 'in_progress';
  const fresh = createTaskRuntime(runtime.tasks);
  runtime.tasks = fresh.tasks;
  runtime.current = fresh.current;
  runtime.openCount = fresh.openCount;
  runtime.completedCount = fresh.completedCount;
  return { changed: true, completed: current, next: runtime.current, allDone: runtime.openCount === 0 };
}

export function renderTasksMarkdown(tasks = []) {
  const normalized = normalizeTasks(tasks);
  const lines = ['# 任务清单', '', `_最后更新：${new Date().toISOString()}_`, ''];
  const icons = { pending: '⏳', in_progress: '▶️', done: '✅', skipped: '⏭' };
  for (const t of normalized) {
    const note = [t.note, t.ownerTool ? `tool=${t.ownerTool}` : ''].filter(Boolean).join('；');
    lines.push(`- ${icons[t.status] || '·'} **${t.id}** · ${t.title}${note ? ` _(${note})_` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function hasOpenTasks(runtime) {
  return !!runtime && runtime.openCount > 0;
}
