import { loadActiveMemoriesMd } from './memory-store.js';

export async function buildStructuredContext({ projectName, soulContent = null, setupStage = null, intentInfo = null, tasksMd = null, memoriesMd = null, wikiPendingMd = null, wikiLintDueMd = null, foreshadowAlertsMd = null, volumeMilestonesMd = null, learnedRulesMd = null, styleFingerprintMd = null, characterStatesMd = null, recentFeedbackMd = null, skillShelfMd = null, skillBlocks = [], projects = [], modeProfile = null } = {}) {
  const memoryText = memoriesMd || (projectName ? await loadActiveMemoriesMd(projectName) : null);
  return {
    meta: {
      projectName: projectName || null,
      modeProfile: modeProfile || 'auto',
      intent: intentInfo?.intent || 'chat',
      risk: intentInfo?.risk || 'low',
      contextMode: intentInfo?.contextMode || 'session',
    },
    work: {
      hasSoul: !!soulContent,
      soulContent: soulContent || null,
      projects: projects.map((p) => ({ name: p.name, stage: p.stage || null })),
      setupStage: setupStage ? {
        stage: setupStage.stage,
        missing: setupStage.missing || [],
        nextStage: setupStage.nextStage || null,
      } : null,
    },
    policy: {
      learnedRulesMd: learnedRulesMd || null,
      recentFeedbackMd: recentFeedbackMd || null,
      foreshadowAlertsMd: foreshadowAlertsMd || null,
      volumeMilestonesMd: volumeMilestonesMd || null,
      styleFingerprintMd: styleFingerprintMd || null,
    },
    runtime: {
      tasksMd: tasksMd || null,
      memoriesMd: memoryText || null,
      wikiPendingMd: wikiPendingMd || null,
      wikiLintDueMd: wikiLintDueMd || null,
      characterStatesMd: characterStatesMd || null,
      skillShelfMd: skillShelfMd || null,
      skillBlocks,
    },
  };
}

export function renderStructuredContextMarkdown(ctx = {}) {
  const lines = [];
  lines.push(`meta: ${JSON.stringify(ctx.meta || {})}`);
  if (ctx.work?.setupStage) lines.push(`setupStage: ${JSON.stringify(ctx.work.setupStage)}`);
  if (ctx.runtime?.tasksMd) lines.push(`tasks: ${String(ctx.runtime.tasksMd).slice(0, 400)}`);
  if (ctx.runtime?.memoriesMd) lines.push(`memories: ${String(ctx.runtime.memoriesMd).slice(0, 400)}`);
  return lines.join('\n');
}
