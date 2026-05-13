const WRITE_TOOLS = new Set(['write_chapter', 'write_outline', 'setup_work', 'update_progress', 'edit_file', 'wiki_ingest', 'wiki_archive', 'wiki_lint', 'export_novel', 'create_user_skill', 'memory_record', 'record_feedback']);
const QUERY_TOOLS = new Set(['read_file', 'wiki_query', 'lookup_query', 'list_files', 'get_chapter_context', 'setup_status', 'chapter_critic', 'reader_score']);

function eventPath(e = {}) {
  return e.relPath || e.path || e.result?.data?.path || e.result?.data?.relPath || '';
}

function normalizeToolResult(result) {
  if (!result || typeof result !== 'object') return { status: 'ok', data: result };
  if (result.status) return result;
  return { status: 'ok', data: result };
}

export function detectAmbiguity(intentInfo = {}, userMessage = '') {
  const text = String(userMessage || '');
  const issues = [];
  if (intentInfo.intent === 'write_chapter' && !intentInfo.target?.chapter && !/(下一章|继续写|接着写|开第一章|第一章)/.test(text)) {
    issues.push({ kind: 'missing_chapter', question: '你要写第几章？' });
  }
  if (intentInfo.intent === 'revise' && !intentInfo.target?.chapter && /这章|重写|改稿|润色/.test(text)) {
    issues.push({ kind: 'missing_revision_target', question: '你要修改哪一章或哪段文本？' });
  }
  if (intentInfo.intent === 'write_outline' && !intentInfo.target?.file && !/(总纲|总大纲|整体大纲|全书大纲|卷纲|分卷|细纲|章纲|outline\/)/i.test(text)) {
    issues.push({ kind: 'missing_outline_target', question: '你要写总纲、卷纲、细纲还是单章纲？' });
  }
  return { ambiguous: issues.length > 0, issues };
}

export function shouldFastReply(intentInfo = {}, userMessage = '') {
  const text = String(userMessage || '').trim();
  if (!text) return null;
  if (intentInfo.intent === 'chat' && /^(谢谢|辛苦了|收到|ok|okay|好的|好)$/i.test(text)) {
    return {
      summary: '我在，可以继续说你的想法。',
      next_steps: ['如果要推进作品，可以直接说“写第 N 章”“查某个设定”或“继续立项”。'],
    };
  }
  return null;
}

export function verifyToolResult(name, args = {}, result = {}, ctx = {}) {
  const env = normalizeToolResult(result);
  if (env.status !== 'ok') return { ok: false, severity: 'error', kind: env.error?.kind || env.status || 'tool_not_ok', hint: env.error?.hint || '根据工具错误修正后重试。' };
  const data = env.data ?? result;
  if (name === 'read_file') {
    if (!data?.content && !data?.chars && !data?.totalChars) return { ok: false, severity: 'warning', kind: 'empty_read', hint: '读取结果为空，先确认路径或改用 list_files。' };
    if (data?.truncated) return { ok: true, severity: 'info', kind: 'partial_read', hint: '文件被截断；需要精修或核对全文时用 maxChars=0 重新读取。' };
  }
  if (name === 'wiki_query') {
    const hits = Array.isArray(data?.hits) ? data.hits.length : Number(data?.count || 0);
    if (hits === 0) return { ok: true, severity: 'warning', kind: 'wiki_miss', hint: 'wiki_query 未命中，换关键词或先沉淀 wiki。' };
  }
  if (name === 'lookup_query') {
    const hits = Array.isArray(data?.items) ? data.items.length : Array.isArray(data?.hits) ? data.hits.length : 0;
    if (hits === 0) return { ok: true, severity: 'warning', kind: 'lookup_miss', hint: 'lookup_query 未命中，换关键词或先 lookup_upsert。' };
  }
  if (WRITE_TOOLS.has(name)) {
    const artifacts = (ctx.runEvents || []).filter((e) => ['file_write', 'chapter_saved', 'wiki_archive', 'wiki_lint', 'user_skill_saved', 'memory_saved', 'feedback_saved', 'edit_file'].includes(e.type));
    if (!artifacts.length && !['memory_record', 'record_feedback', 'finish_task'].includes(name)) {
      return { ok: true, severity: 'warning', kind: 'write_without_artifact_event', hint: '写入工具返回 ok 但本轮未观察到产物事件，请核对是否真的落盘。' };
    }
  }
  return { ok: true, severity: 'ok', kind: 'verified', hint: '' };
}

export function updateBudget(ctx = {}, usage = {}, { turn = 0, maxTurns = 0, profile = null } = {}) {
  ctx.budget ||= { prompt: 0, completion: 0, totalTokens: 0, turnsUsed: 0, maxTurns, pressure: 'low' };
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  ctx.budget.prompt += prompt;
  ctx.budget.completion += completion;
  ctx.budget.totalTokens += prompt + completion;
  ctx.budget.turnsUsed = Math.max(ctx.budget.turnsUsed || 0, turn);
  ctx.budget.maxTurns = maxTurns || ctx.budget.maxTurns;
  const turnRatio = maxTurns ? turn / maxTurns : 0;
  const tokenPressure = ctx.budget.totalTokens >= 90000 ? 'high' : ctx.budget.totalTokens >= 60000 ? 'medium' : 'low';
  ctx.budget.pressure = tokenPressure === 'high' || turnRatio >= 0.85 ? 'high' : tokenPressure === 'medium' || turnRatio >= 0.65 ? 'medium' : 'low';
  ctx.budget.profile = profile;
  return ctx.budget;
}

export function budgetDirective(ctx = {}) {
  const b = ctx.budget || {};
  if (b.pressure === 'high') return '预算压力 high：停止扩展探索，优先完成当前 requiredWrite 或调用 finish_task 交付已完成部分；不要再启动新的子任务。';
  if (b.pressure === 'medium') return '预算压力 medium：减少周边查询，只保留完成当前目标必要工具；下一轮尽量落盘或交付。';
  return '';
}

export function assessStuck({ ctx = {}, events = [], turn = 0 } = {}) {
  const recent = events.slice(-30);
  const toolResults = recent.filter((e) => e.type === 'tool_result');
  const writes = recent.filter((e) => ['file_write', 'chapter_saved', 'wiki_archive', 'wiki_lint', 'user_skill_saved', 'memory_saved', 'feedback_saved', 'edit_file'].includes(e.type));
  const failures = toolResults.filter((e) => e.ok === false);
  const lastTools = toolResults.slice(-4).map((e) => e.name).filter(Boolean);
  const sameToolRepeated = lastTools.length >= 3 && new Set(lastTools).size === 1;
  const noArtifactAfterManyTurns = turn >= 3 && !writes.length && !ctx.requiredWriteDone && !!ctx.requiredWrite;
  const repeatedFailures = failures.length >= 2;
  const stuck = sameToolRepeated || noArtifactAfterManyTurns || repeatedFailures;
  const reason = sameToolRepeated ? 'same_tool_repeated' : repeatedFailures ? 'repeated_failures' : noArtifactAfterManyTurns ? 'no_artifact_progress' : 'progressing';
  return { stuck, reason, lastTools, failures: failures.length, artifactCount: writes.length };
}

export function buildReflection({ toolName, args = {}, result = {}, verification = {}, ctx = {} } = {}) {
  const env = normalizeToolResult(result);
  let label = 'advanced';
  if (env.status !== 'ok' || verification.severity === 'error') label = 'blocked';
  else if (verification.severity === 'warning' || verification.severity === 'info') label = 'partial';
  else if (QUERY_TOOLS.has(toolName) && ctx.requiredWrite && !ctx.requiredWriteDone) label = 'context_only';
  const suggestion = label === 'advanced'
    ? '继续推进下一步，避免重复查询。'
    : label === 'context_only'
      ? `已获得上下文，下一步应靠近 ${ctx.requiredWrite?.tool || '目标工具'}。`
      : verification.hint || '根据工具反馈调整策略。';
  return { label, tool: toolName, suggestion, verification: verification.kind || env.status, target: ctx.requiredWrite?.tool || null, argsHash: JSON.stringify(args || {}).slice(0, 160) };
}

export function renderReflectionLine(reflection = {}) {
  if (!reflection.tool) return '';
  return `self_check ${reflection.tool}: ${reflection.label}; ${reflection.suggestion}`;
}

export function deriveGoalProgress(ctx = {}, events = []) {
  const chapters = events.filter((e) => e.type === 'chapter_saved').map((e) => Number(e.chapter)).filter(Number.isFinite);
  const setupStage = ctx.setupStage?.stage ?? null;
  const tasks = ctx.taskRuntime?.tasks || ctx.lastTasks || [];
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const current = tasks.find((t) => t.status === 'in_progress') || null;
  return {
    level: ctx.intentInfo?.intent === 'write_chapter' ? 'chapter' : ctx.intentInfo?.contextMode || 'session',
    chaptersDone: chapters.length,
    latestChapter: chapters.length ? Math.max(...chapters) : null,
    setupStage,
    taskDone: done,
    taskTotal: total,
    percent: total ? Math.round((done / total) * 100) : null,
    currentTask: current ? { id: current.id, title: current.title } : null,
  };
}

export function goalProgressMarkdown(progress = {}) {
  const rows = [];
  rows.push(`level=${progress.level || 'session'}`);
  if (progress.latestChapter) rows.push(`latestChapter=${progress.latestChapter}`);
  if (progress.setupStage != null) rows.push(`setupStage=${progress.setupStage}`);
  if (progress.taskTotal) rows.push(`tasks=${progress.taskDone}/${progress.taskTotal}${progress.percent != null ? ` (${progress.percent}%)` : ''}`);
  if (progress.currentTask) rows.push(`current=${progress.currentTask.id}:${progress.currentTask.title}`);
  return rows.join(' · ');
}

export function failureMemoryPayload({ ctx = {}, reason = '', events = [] } = {}) {
  const lastTool = [...events].reverse().find((e) => e.type === 'tool_result');
  const kind = reason || lastTool?.result?.error?.kind || 'agent_failure';
  return {
    kind: 'failure_mode',
    key: `${ctx.intentInfo?.intent || 'unknown'}:${kind}`.slice(0, 120),
    value: `intent=${ctx.intentInfo?.intent || 'unknown'}; reason=${kind}; required=${ctx.requiredWrite?.tool || 'none'}; lastTool=${lastTool?.name || 'none'}; hint=${lastTool?.result?.error?.hint || '换方案、缩小步骤或 ask_user'}`,
    priority: 3,
    tags: ['agent', 'failure', ctx.intentInfo?.intent || 'unknown'].filter(Boolean),
  };
}

export function buildReplanPrompt(stuck = {}, ctx = {}) {
  return `[系统提醒｜自检重规划 · 非用户消息]\n检测到执行卡住：${stuck.reason}。请先调 plan_tasks 重排剩余步骤，随后只推进最小下一步。${ctx.requiredWrite ? `当前 requiredWrite=${ctx.requiredWrite.tool}，不要忘记最终完成它。` : ''}`;
}

export function applyIntentPolicy(intentInfo = {}, policy = {}) {
  const next = { ...policy };
  if (intentInfo.intent === 'chat') {
    next.includeActivePlan = false;
    next.includeMemory = false;
    next.includeScratchpad = false;
  }
  if (intentInfo.risk === 'high') next.requireClarifyOnAmbiguity = true;
  return next;
}
