export function checkSetupStageGate({ toolName, args = {}, setupStage, userMessage = '', allowSkip = false } = {}) {
  const rule = setupGateRule(toolName, args);
  if (!rule) return null;
  const stage = Number(setupStage?.stage || 0);
  if (stage >= rule.requiredStage || allowSkip || hasExplicitSkipConsent(userMessage)) return null;
  const missing = Array.isArray(setupStage?.missingRequired) && setupStage.missingRequired.length
    ? setupStage.missingRequired
    : (Array.isArray(setupStage?.missing) ? setupStage.missing : []);
  return {
    blocked: true,
    kind: rule.kind,
    tool: toolName,
    message: `立项阶段未完成（当前 ${stage}/8），禁止直接调用 ${toolName}`,
    hint: `本操作需要立项阶段至少达到 ${rule.requiredStage}/8（${rule.label}）。先调 setup_status 查看缺口，再用 setup_repair 生成补齐计划。若用户明确要求跳过设定完整性，请先 ask_user 确认风险后重试。`,
    context: {
      stage,
      requiredStage: rule.requiredStage,
      label: rule.label,
      missing: missing.slice(0, 20),
      missingCount: missing.length,
      nextStage: setupStage?.nextStage || null,
    },
  };
}

export function checkSetupWriteGate(opts = {}) {
  return checkSetupStageGate({ ...opts, toolName: 'write_chapter' });
}

export function hasExplicitSkipConsent(text = '') {
  const s = String(text || '');
  if (/(先别写|不要写|不写|不能写|还没补完所以不写)/.test(s)) return false;
  return /(确认|坚持|仍然|强行|跳过|不补|先写|直接写|开写|风险我接受|先别管).*(跳过|不补|先写|直接写|开写|风险|设定|立项|完整性|setup)|((跳过|不补|先别管).*(设定|立项|完整性|setup))/.test(s);
}

function setupGateRule(toolName, args = {}) {
  if (toolName === 'write_chapter') {
    return { requiredStage: 7, kind: 'setup_incomplete_before_write', label: 'Arc 细纲' };
  }
  if (toolName === 'write_outline') {
    const p = String(args.path || '');
    if (p === 'outline/overall.md') return { requiredStage: 1, kind: 'setup_incomplete_before_outline', label: 'SOUL' };
    // 卷纲会展开到具体地点与道具：要求人物（3）+ 地点物品档案（4）已完成
    if (/^outline\/volumes\//.test(p)) return { requiredStage: 4, kind: 'setup_incomplete_before_outline', label: '地点与物品档案' };
    if (/^outline\/arcs\//.test(p)) return { requiredStage: 6, kind: 'setup_incomplete_before_outline', label: '卷纲' };
  }
  return null;
}
