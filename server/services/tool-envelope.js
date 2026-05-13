// 统一工具返回契约。边界包装，不改既有 runTool case 的内部实现。
//
// 约定：
//   { status: 'ok',      data: any,                     side_effects?: [...] }
//   { status: 'error',   error: { kind, message, hint, context? }, attempt, max_repeat, auto_repaired?, via?: string }
//   { status: 'pending', data: any }                // ask_user 分支
//   { status: 'blocked', error: { kind, message, hint } } // 重试预算阻断
//
// 兼容老 runTool case：它们可能返回 { ok:true, ... } / { error, recovery_hint } / 纯对象。
// wrapToolResult 把这些都归一到 envelope。

export class ToolError extends Error {
  constructor(kind, message, hint, context) {
    super(message);
    this.name = 'ToolError';
    this.kind = kind;
    this.hint = hint || '';
    this.context = context;
  }
}

export function wrapToolResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return { status: 'ok', data: raw ?? null };
  }
  // 已经是 envelope
  if (raw.status === 'ok' || raw.status === 'error' || raw.status === 'pending' || raw.status === 'blocked') {
    return raw;
  }
  // ask_user 分支：老代码返回 { pending_user_reply:true, ... }
  if (raw.pending_user_reply) {
    const { pending_user_reply, ...rest } = raw;
    return { status: 'pending', data: rest };
  }
  // 老 edit_file 已经 status 字段；上面已命中。
  // 老 error 分支：{ error, recovery_hint, ... } —— 但 agent.js 里是先 throw 再包装，
  // 所以通常不会走到这里；保留兜底。
  if (raw.error && (raw.recovery_hint || raw.blocked)) {
    const hint = raw.recovery_hint?.hint || '';
    const kind = raw.recovery_hint?.kind || (raw.blocked ? 'retry_blocked' : 'unknown');
    return {
      status: raw.blocked ? 'blocked' : 'error',
      error: { kind, message: String(raw.error), hint },
      attempt: raw.attempt,
      max_repeat: raw.max_repeat,
    };
  }
  return { status: 'ok', data: raw };
}

export function wrapToolError({ err, kindHint, hintText, attempt, maxRepeat, autoRepaired, via, note, recoveryHint }) {
  const kind = err?.kind || kindHint || recoveryHint?.kind || 'unknown';
  const hint = err?.hint || hintText || recoveryHint?.hint || '';
  return {
    status: autoRepaired ? 'error' : 'error',
    error: {
      kind,
      message: String(err?.message || err),
      hint,
      context: err?.context,
    },
    attempt,
    max_repeat: maxRepeat,
    auto_repaired: !!autoRepaired,
    via,
    note,
  };
}

export function wrapToolBlocked({ tool, attempts, maxRepeat }) {
  return {
    status: 'blocked',
    error: {
      kind: 'retry_blocked',
      message: `🛑 重试预算耗尽：工具 ${tool} 用相同参数已连续失败 ${attempts} 次，被系统阻断。`,
      hint: '禁止再用相同参数重试。请：(a) 换路径/换参数；(b) 先调 list_files / read_file 重新确认状态；(c) 调 ask_user 让用户决策。',
    },
    attempts,
    max_repeat: maxRepeat,
  };
}

/** 判断 envelope 是否成功（用于 emit 的 ok 字段 / 计数）。 */
export function isOk(env) {
  return env && env.status === 'ok';
}
