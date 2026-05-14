export function buildExecutionPlan({ userMessage = '', intentInfo = {}, requiredWrites = [], setupStage = null } = {}) {
  const steps = [];
  const primary = requiredWrites.find((x) => !x.done) || requiredWrites[0] || null;

  if (setupStage?.stage != null && setupStage.stage < 6 && intentInfo.intent === 'write_chapter') {
    steps.push({ id: 'plan-setup-check', kind: 'check', title: '确认立项状态', tool: 'setup_status' });
  }

  if (intentInfo.intent === 'write_chapter') {
    steps.push(
      { id: 'plan-context', kind: 'read', title: '读取章节上下文', tool: 'get_chapter_context' },
      { id: 'plan-wiki', kind: 'read', title: '查询本章相关设定', tool: 'wiki_query' },
      { id: 'plan-critic', kind: 'review', title: '草稿前评审', tool: 'chapter_critic' },
      { id: 'plan-write', kind: 'write', title: '落盘章节正文', tool: 'write_chapter' },
      { id: 'plan-ingest', kind: 'write', title: '沉淀知识与状态', tool: 'wiki_ingest' },
      { id: 'plan-review', kind: 'review', title: '统一验收裁决', tool: 'quality_judge' },
      { id: 'plan-close', kind: 'finalize', title: '写入反思并收尾', tool: 'finish_task' },
    );
  } else if (intentInfo.intent === 'write_outline') {
    steps.push(
      { id: 'plan-outline-read', kind: 'read', title: '读取总纲与相关约束', tool: 'read_file' },
      { id: 'plan-outline-write', kind: 'write', title: '写入大纲', tool: 'write_outline' },
      { id: 'plan-review', kind: 'review', title: '统一验收裁决', tool: 'quality_judge' },
      { id: 'plan-close', kind: 'finalize', title: '写入反思并收尾', tool: 'finish_task' },
    );
  } else if (primary) {
    steps.push({ id: 'plan-required', kind: 'write', title: primary.label || primary.tool, tool: primary.tool });
  }

  if (!steps.length) {
    steps.push({ id: 'plan-chat', kind: 'chat', title: '回答用户问题', tool: null });
  }

  return {
    goal: String(userMessage || '').slice(0, 120),
    intent: intentInfo.intent || 'chat',
    steps,
    primaryTool: primary?.tool || null,
    needsClarify: !!intentInfo.needsClarify,
  };
}

export function renderExecutionPlanMarkdown(plan = {}) {
  const lines = [];
  lines.push(`intent=${plan.intent || 'chat'}`);
  if (plan.primaryTool) lines.push(`primary=${plan.primaryTool}`);
  for (const step of plan.steps || []) {
    lines.push(`- ${step.id} · ${step.kind} · ${step.title}${step.tool ? ` → ${step.tool}` : ''}`);
  }
  return lines.join('\n');
}
