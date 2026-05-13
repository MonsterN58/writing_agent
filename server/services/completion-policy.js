const WRITE_EVENT_TYPES = new Set([
  'file_write',
  'chapter_saved',
  'wiki_archive',
  'wiki_lint',
  'user_skill_saved',
  'memory_saved',
  'feedback_saved',
  'edit_file',
]);

function stripProjectPrefix(path, projectName) {
  const s = String(path || '').replace(/\\/g, '/');
  if (!s) return '';
  const prefix = projectName ? `novels/${projectName}/` : 'novels/';
  if (projectName && s.startsWith(prefix)) return s.slice(prefix.length);
  if (s.startsWith('novels/')) return s.split('/').slice(2).join('/');
  return s;
}

function artifactFromEvent(e, projectName) {
  if (!e || !WRITE_EVENT_TYPES.has(e.type)) return null;
  if (e.type === 'chapter_saved') {
    return {
      kind: 'chapter',
      path: stripProjectPrefix(e.relPath || e.path, projectName),
      label: `第 ${e.chapter} 章${e.title ? ` · ${e.title}` : ''}`,
      note: e.wordCount ? `${e.wordCount} 字${e.score ? ` · ${e.score} 分` : ''}` : '',
    };
  }
  if (e.type === 'wiki_archive') {
    return { kind: 'wiki', path: stripProjectPrefix(e.relPath, projectName), label: `归档推论 · ${e.title || ''}`.trim(), note: e.confidence ? `confidence ${e.confidence}` : '' };
  }
  if (e.type === 'wiki_lint') {
    return { kind: 'wiki', path: stripProjectPrefix(e.relPath, projectName), label: 'Wiki 体检报告', note: `${e.issues || 0} issues` };
  }
  if (e.type === 'user_skill_saved') {
    return { kind: 'skill', path: stripProjectPrefix(e.relPath, projectName), label: `用户 skill · ${e.title || e.name || ''}`.trim(), note: '' };
  }
  if (e.type === 'memory_saved') {
    return { kind: 'memory', path: '', label: `长期记忆 · ${e.kind || ''} · ${e.key || ''}`.trim(), note: e.priority ? `P${e.priority}` : '' };
  }
  if (e.type === 'feedback_saved') {
    return { kind: 'feedback', path: stripProjectPrefix(e.relPath, projectName), label: `反馈闭环 · ${e.kind || e.polarity || ''}`.trim(), note: e.sceneType || '' };
  }
  if (e.type === 'edit_file') {
    if (e.status === 'error') return null;
    return { kind: 'edit', path: stripProjectPrefix(e.path, projectName), label: `定点修改 · ${stripProjectPrefix(e.path, projectName)}`, note: e.bytesDelta != null ? `Δ${e.bytesDelta >= 0 ? '+' : ''}${e.bytesDelta}` : '' };
  }
  const path = stripProjectPrefix(e.relPath || e.path, projectName);
  if (!path) return null;
  return { kind: e.kind || 'file', path, label: e.note || path, note: e.bytes ? `${e.bytes} bytes` : '' };
}

export function collectArtifacts(events = [], { projectName } = {}) {
  const seen = new Set();
  const out = [];
  for (const e of events || []) {
    const a = artifactFromEvent(e, projectName);
    if (!a) continue;
    const key = `${a.kind}:${a.path || a.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function assessCompletion({ ctx, events = [] } = {}) {
  const pendingRequired = !!ctx?.requiredWrite && !ctx?.requiredWriteDone;
  const pendingTasks = (ctx?.lastTasks || []).filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const artifacts = collectArtifacts(events, { projectName: ctx?.projectName });
  const lastError = [...(events || [])].reverse().find((e) => e.type === 'error' || e.type === 'agent_giveup');
  const lastToolError = [...(events || [])].reverse().find((e) => e.type === 'tool_result' && e.ok === false);
  const asks = (events || []).filter((e) => e.type === 'ask_user');
  const terminalTool = [...(events || [])].reverse().find((e) => e.type === 'tool_result' && e.ok && ['write_chapter', 'write_outline', 'setup_work', 'update_progress', 'edit_file', 'wiki_ingest', 'wiki_archive', 'wiki_lint', 'export_novel', 'create_user_skill', 'memory_record', 'record_feedback', 'finish_task'].includes(e.name));

  if (ctx?.finalized) return { status: 'done', reason: 'finalized', artifacts, pendingTasks };
  if (ctx?.pauseAfterTools || asks.length) return { status: 'needs_user', reason: 'awaiting_user', artifacts, pendingTasks, ask: asks.at(-1) || null, recovery: ctx?.pendingRecovery || null, lastToolError };
  if (lastError?.type === 'agent_giveup') return { status: 'failed', reason: lastError.reason || 'agent_giveup', artifacts, pendingTasks, error: lastError, lastToolError };
  if (pendingRequired) return { status: 'continue', reason: 'required_write_pending', artifacts, pendingTasks };
  if (pendingTasks.length) return { status: 'continue', reason: 'tasks_pending', artifacts, pendingTasks };
  if (terminalTool || artifacts.length) return { status: 'done', reason: terminalTool ? `terminal_tool:${terminalTool.name}` : 'artifacts_written', artifacts, pendingTasks };
  return { status: 'open', reason: 'no_terminal_signal', artifacts, pendingTasks };
}

function nextStepsFor(ctx, assessment) {
  if (assessment.status === 'needs_user') {
    const opts = assessment.ask?.options || assessment.recovery?.options || [];
    return opts.length ? opts.slice(0, 5) : ['请先回复上面的确认问题，我会按你的选择继续。'];
  }
  if (assessment.status === 'failed') return ['换个思路重试', '把目标缩小一步继续', '我来补充缺失信息后继续', '取消本任务'];
  if (ctx?.intentInfo?.intent === 'write_chapter') return ['预览刚写好的章节。', '让我按验收/评分建议继续润色。', '继续写下一章。'];
  if (ctx?.intentInfo?.intent === 'setup' || ctx?.intentInfo?.intent === 'setup_continue') return ['运行 setup_status 查看下一阶段缺口。', '继续补齐世界观、人物或大纲资产。'];
  if (assessment.artifacts?.length) return ['打开本轮产物检查内容。', '继续让我推进下一步。'];
  return ['如果要继续，我可以把下一步拆成任务清单后执行。'];
}

export function buildFinalSummary({ ctx, events = [], assessment, explicit = null, reason = 'auto' } = {}) {
  const a = assessment || assessCompletion({ ctx, events });
  const artifacts = explicit?.artifacts?.length ? explicit.artifacts.map((x) => typeof x === 'string' ? { kind: 'file', path: x, label: x, note: '' } : x) : a.artifacts;
  const completed = explicit?.completed?.length ? explicit.completed : [];
  const autoIssues = [];
  const toolErr = a.lastToolError?.result?.error;
  if (a.recovery?.issue?.message) autoIssues.push(`上次卡点：${a.recovery.issue.message}`);
  if (a.recovery?.issue?.hint) autoIssues.push(`建议：${a.recovery.issue.hint}`);
  if (toolErr?.message && !autoIssues.some((x) => x.includes(toolErr.message))) autoIssues.push(`最后工具错误：${toolErr.message}`);
  if (toolErr?.hint && !autoIssues.some((x) => x.includes(toolErr.hint))) autoIssues.push(`工具建议：${toolErr.hint}`);
  const issues = explicit?.issues?.length ? explicit.issues : autoIssues;
  const nextSteps = explicit?.next_steps?.length ? explicit.next_steps : nextStepsFor(ctx, { ...a, artifacts });
  const title = explicit?.summary || (a.status === 'needs_user'
    ? (a.recovery?.summary ? `我已暂停在可恢复节点：${a.recovery.summary}` : '我已推进到需要你确认的节点。')
    : a.status === 'failed'
      ? '任务未完全完成，我已保留现场以便换路继续。'
      : artifacts.length
        ? '已完成本轮任务并整理好产物。'
        : '本轮处理已结束。');

  return {
    status: a.status === 'failed' ? 'failed' : a.status === 'needs_user' ? 'awaiting_user' : 'done',
    reason,
    summary: title,
    completed,
    artifacts: artifacts.slice(-20),
    issues: issues.slice(0, 8),
    pendingTasks: a.pendingTasks || [],
    next_steps: nextSteps.slice(0, 5),
  };
}

export function renderFinalSummaryMarkdown(summary) {
  const lines = [];
  lines.push(summary.summary || '已完成。');
  if (summary.completed?.length) {
    lines.push('', '完成项：');
    for (const x of summary.completed) lines.push(`- ${x}`);
  }
  if (summary.artifacts?.length) {
    lines.push('', '本轮产物：');
    for (const a of summary.artifacts) lines.push(`- ${a.path || a.label}${a.note ? ` · ${a.note}` : ''}`);
  }
  if (summary.issues?.length) {
    lines.push('', '注意事项：');
    for (const x of summary.issues) lines.push(`- ${x}`);
  }
  if (summary.pendingTasks?.length) {
    lines.push('', '尚未完成：');
    for (const t of summary.pendingTasks.slice(0, 8)) lines.push(`- ${t.id || ''} ${t.title || t.summary || ''}`.trim());
  }
  if (summary.next_steps?.length) {
    lines.push('', '下一步建议：');
    for (const x of summary.next_steps) lines.push(`- ${x}`);
  }
  return lines.join('\n');
}
