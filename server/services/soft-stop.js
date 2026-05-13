const REASON_LABELS = {
  write_intent_unfulfilled: '写入目标多次未完成',
  max_turns_reached: '已达到本轮最大执行步数',
  user_interrupt: '用户主动中断',
  too_many_fails: '工具连续失败过多',
};

export function latestToolIssue(events = []) {
  const hit = [...events].reverse().find((e) => e?.type === 'tool_result' && e.ok === false);
  const env = hit?.result || {};
  const err = env.error || {};
  if (!hit) return null;
  return {
    tool: hit.name || null,
    status: hit.status || env.status || 'error',
    kind: err.kind || null,
    message: err.message || '',
    hint: err.hint || '',
  };
}

export function buildSoftStopPayload({ ctx = {}, reason = 'unknown', tool = null, label = null, turn = null } = {}) {
  const issue = latestToolIssue(ctx.runEvents || []);
  const pendingRequired = ctx.requiredWrite || null;
  const pendingTasks = (ctx.lastTasks || []).filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const summary = REASON_LABELS[reason] || reason || '执行被暂停';
  const target = label || pendingRequired?.label || pendingRequired?.path || pendingRequired?.tool || tool || '';
  const options = [
    '换个思路继续',
    '把目标缩小后继续',
    '我来补充缺失信息',
    '取消本任务',
  ];
  const question = target
    ? `${summary}：${target} 还没安全完成。要怎么继续？`
    : `${summary}。要怎么继续？`;
  const contextParts = [];
  if (issue?.tool) contextParts.push(`最后失败工具：${issue.tool}${issue.kind ? ` / ${issue.kind}` : ''}`);
  if (issue?.hint) contextParts.push(`建议：${issue.hint}`);
  if (pendingTasks.length) contextParts.push(`仍有 ${pendingTasks.length} 个任务未完成`);
  return {
    reason,
    summary,
    tool: tool || pendingRequired?.tool || null,
    label: target || null,
    turn,
    issue,
    pendingRequired,
    pendingTasks: pendingTasks.slice(0, 8),
    question,
    options,
    context: contextParts.join('；') || '我已保留上下文，下次回复可直接续跑。',
  };
}

export function shouldOfferAgentResume(state, userMessage = '') {
  if (!state || typeof state !== 'object') return false;
  const pending = Array.isArray(state.requiredWrites) && state.requiredWrites.some((x) => !x.done);
  if (!pending && !state.pendingRecovery) return false;
  const text = String(userMessage || '').trim();
  if (!text) return false;
  if (/^(取消|不用|别继续|新任务|重新开始|清空)$/i.test(text)) return false;
  return true;
}

export function renderResumeHint(state) {
  const pending = Array.isArray(state?.requiredWrites) ? state.requiredWrites.filter((x) => !x.done) : [];
  const first = pending[0] || state?.currentRequiredWrite || null;
  const recovery = state?.pendingRecovery || null;
  const lines = [];
  lines.push('<agent_resume_hint>');
  lines.push('检测到上次任务还有可恢复上下文。');
  if (first) lines.push(`未完成目标：${first.label || first.path || first.tool}`);
  if (recovery?.reason) lines.push(`上次暂停原因：${recovery.reason}`);
  if (recovery?.issue?.hint) lines.push(`上次工具建议：${recovery.issue.hint}`);
  lines.push('如果用户当前消息是在继续/修正上次任务，请优先复用该状态；如果明显是新任务，则忽略本提示。');
  lines.push('</agent_resume_hint>');
  return lines.join('\n');
}
