// 卷纲分片子 Agent：输入总纲 + 一卷元信息 → 输出该卷的分章大纲 markdown。
import { runSubAgent } from '../runner.js';

const SYSTEM = `你是网文卷纲分工作者。基于总纲与该卷定位，写一卷的完整分章大纲。

## 硬约束
- 只写当前这一卷，不要跨卷剧透，不要改总纲设定。
- 每章 1 段 80-150 字，包含：核心冲突 / 关键动作 / 章末钩子。
- 严格遵守总纲里的人物设定、世界规则、伏笔计划。
- 单章标题短而有力（不超过 12 字）。

## 输出格式（markdown）
首行：\`# 第 N 卷 · <卷名>\`
后接每章小节：
\`## 第 M 章 · <章标题>\`
\`<80-150 字章纲>\`

## 行为
- 不输出前后解释，不加结尾总结。
- 章数必须等于用户给的 chapters。`;

/**
 * @param {object} opts
 * @param {string} opts.overallOutline - outline/overall.md 全文
 * @param {{index:number, title:string, chapters:number, brief:string}} opts.arc
 * @param {AbortSignal} [opts.signal]
 * @param {(e:any)=>void} [opts.emit]
 */
export async function writeArcOutline({ overallOutline, arc, signal, emit }) {
  const userPrompt = [
    `# 总纲（outline/overall.md）`,
    overallOutline,
    ``,
    `# 本次要写的卷`,
    `- 卷号：第 ${arc.index} 卷`,
    `- 卷名：${arc.title}`,
    `- 预计章数：${arc.chapters}`,
    `- 卷定位 / brief：${arc.brief}`,
    ``,
    `请现在输出这一卷的完整分章大纲。`,
  ].join('\n');
  const r = await runSubAgent({
    role: `arc-writer#${arc.index}`,
    systemPrompt: SYSTEM,
    userPrompt,
    signal,
    emit,
    timeoutMs: 180000,
  });
  return { ...r, arc };
}
