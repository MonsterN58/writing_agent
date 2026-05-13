// 【A1】Best-of-N 章节生成：基于同一份 prompt 用 cheap 档跑 N 个候选，打分，落盘
// - 不替代 write_chapter；agent 看完候选后调 write_chapter 用最高分版本（或自己再融合）
// - 落 chapters/alternates/第N章-候选-A.md / B.md（含分数 frontmatter）
import { resolveInProject, writeFileSafe } from './fs-utils.js';
import { runSubAgent } from './subagents/runner.js';
import { scoreChapterContent } from './quality.js';

const VARIANT_SYSTEM = `你是中文网文写手，本任务是"为同一章写一个完整候选稿"。

要求：
- 严格按用户消息里的"章节大纲与上下文"写
- 输出**只有正文**：不要标题（# 第N章）、不要 frontmatter、不要任何说明文字
- 字数贴近用户给的目标（±20%）
- 注重画面感、动作、对话、感官、情绪节拍；避免抽象总结、概念化、AI 味套话

直接开始写正文，第一段就是正文第一段。`;

/**
 * 生成 N 个候选章节版本，返回 [{ id, path, score, wordCount, content, ms }]
 *
 * @param {object} opts
 *   projectName, chapter, title, briefMd（包含大纲/上下文/约束的合成 prompt）,
 *   n=2, targetWords=2500, signal, emit
 */
export async function generateChapterVariants(opts) {
  const {
    projectName, chapter, title = '',
    briefMd, n = 2, targetWords = 2500,
    signal, emit,
  } = opts;
  if (!projectName) return { ok: false, error: '未激活作品' };
  if (!chapter) return { ok: false, error: '需要 chapter' };
  if (!briefMd || !briefMd.trim()) return { ok: false, error: '需要 briefMd（大纲+上下文）' };

  const N = Math.max(2, Math.min(3, Number(n) || 2));
  const userPrompt = [
    `## 目标章节`,
    `第 ${chapter} 章${title ? ' · ' + title : ''}`,
    `目标字数：约 ${targetWords} 字（±20%）`,
    '',
    `## 章节大纲与上下文`,
    briefMd.trim(),
    '',
    `请直接写正文。`,
  ].join('\n');

  const labels = ['A', 'B', 'C', 'D'];
  // 并行生成 N 个候选
  const tasks = [];
  for (let i = 0; i < N; i++) {
    tasks.push(runSubAgent({
      role: `variant-${labels[i]}#${chapter}`,
      systemPrompt: VARIANT_SYSTEM,
      userPrompt,
      profile: 'cheap',
      signal,
      emit,
      timeoutMs: 240000,
    }));
  }
  const results = await Promise.all(tasks);

  // 打分 + 落盘
  const variants = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok || !r.data || !String(r.data).trim()) continue;
    const content = String(r.data).trim();
    const score = scoreChapterContent({ content, chapter, title });
    const id = labels[i];
    const padded = String(chapter).padStart(3, '0');
    const rel = `chapters/alternates/第${chapter}章-候选-${id}.md`;
    const fm = `---\nchapter: ${chapter}\ntitle: ${JSON.stringify(title)}\nvariant: ${id}\nscore: ${score.total}\nwordCount: ${score.wordCount}\ngeneratedAt: ${new Date().toISOString()}\n---\n\n`;
    await writeFileSafe(resolveInProject(projectName, rel), fm + content);
    variants.push({
      id, relPath: rel,
      score: score.total,
      wordCount: score.wordCount,
      contentPreview: content.slice(0, 240),
      ms: r.ms,
    });
  }
  if (!variants.length) return { ok: false, error: '所有候选都生成失败' };

  // 排序：分数高的在前
  variants.sort((a, b) => b.score - a.score);
  const best = variants[0];

  return {
    ok: true,
    chapter,
    count: variants.length,
    best,
    variants,
    bestPath: best.relPath,
  };
}
