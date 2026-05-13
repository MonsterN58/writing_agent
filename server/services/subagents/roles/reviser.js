// 修稿子 Agent：给定原文 + blockers 问题清单 → 输出修订后的全文正文。
import { runSubAgent } from '../runner.js';

const SYSTEM = `你是定点修稿编辑。给定原文 + 必改问题清单 + 要保留的好句，你的任务是输出修订后的**全文**。

## 严格约束
- 只修所列问题，不要改情节结构、不要改人物动机、不要新增设定。
- keep_highlights 里的句子必须原样保留，**一字不改**。
- 长度与原文大致相当（±20%）。
- 不要加章节标题、不要加任何解释、不要加 markdown fence。
- 输出**纯正文**，一行不多一行不少。`;

/**
 * @param {object} opts
 * @returns {Promise<{ok:boolean, data:string, raw:string, error?:string, ms:number, role:string}>}
 *   data 即修订后正文
 */
export async function reviseChapter({ chapter, title, content, issues, keepHighlights = [], signal, emit }) {
  const issuesText = (issues || []).length
    ? issues.map((i) => `- [${i.severity || '?'} · ${i.kind || '?'}] ${i.problem || ''}\n  原文："${i.quote || ''}"\n  建议：${i.suggestion || ''}`).join('\n')
    : '（无）';
  const keepText = keepHighlights.length ? keepHighlights.map((s) => `- ${s}`).join('\n') : '（无）';
  const userPrompt = [
    `# 第 ${chapter} 章${title ? ' · ' + title : ''}（原文）`,
    content,
    ``,
    `# 必改问题`,
    issuesText,
    ``,
    `# 保留不动的好句`,
    keepText,
    ``,
    `# 任务`,
    `输出修订后的全文正文。`,
  ].join('\n');
  const r = await runSubAgent({
    role: `reviser#${chapter}`,
    systemPrompt: SYSTEM,
    userPrompt,
    signal,
    emit,
    timeoutMs: 240000,
    profile: 'writer',
  });
  return { ...r, data: r.raw };
}
