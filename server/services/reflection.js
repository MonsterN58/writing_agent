import { writeFileSafe, resolveInProject } from './fs-utils.js';
import { buildFailureStatsMarkdown, buildReflectionBundle } from './agent-intelligence.js';

export function buildReflectionMd({ plan = null, judgment = null, events = [], ctx = {} } = {}) {
  const bundle = buildReflectionBundle({ ctx, events, plan, judgment });
  const lines = [];
  lines.push('# Agent Reflection');
  lines.push('');
  lines.push(`- 时间：${new Date().toISOString()}`);
  if (bundle.plan) {
    lines.push(`- intent：${bundle.plan.intent}`);
    lines.push(`- primary：${bundle.plan.primaryTool || 'none'}`);
  }
  lines.push(`- 结果：${bundle.summary}`);
  if (bundle.lastTool) lines.push(`- 最后工具：${bundle.lastTool.name} · ${bundle.lastTool.status || (bundle.lastTool.ok ? 'ok' : 'err')}`);
  lines.push('');
  lines.push('## 计划');
  if (bundle.plan?.steps?.length) {
    for (const step of bundle.plan.steps) lines.push(`- ${step.kind} · ${step.title}${step.tool ? ` → ${step.tool}` : ''}`);
  } else {
    lines.push('- 无');
  }
  lines.push('');
  lines.push('## 失败统计');
  lines.push(buildFailureStatsMarkdown(bundle.stats));
  lines.push('');
  lines.push('## 下一步');
  if (Array.isArray(bundle.next) && bundle.next.length) {
    for (const n of bundle.next) lines.push(`- ${n}`);
  } else {
    lines.push('- 无');
  }
  if (bundle.reflection) {
    lines.push('');
    lines.push('## 自检');
    lines.push(bundle.reflection);
  }
  return lines.join('\n') + '\n';
}

export async function saveReflection(projectName, content) {
  const relPath = 'progress/reflection.md';
  await writeFileSafe(resolveInProject(projectName, relPath), content);
  return relPath;
}
