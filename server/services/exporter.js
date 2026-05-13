// 全本导出：合并所有章节为单个 md / txt
import path from 'node:path';
import { listChapters } from './chapter-utils.js';
import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';

/** 把所有章节合并为整本 markdown / txt，写到 exports/ */
export async function exportFullNovel(projectName, opts = {}) {
  const includeFrontmatter = opts.includeFrontmatter !== false;
  const chapters = await listChapters(projectName);
  if (!chapters.length) throw new Error('暂无章节可导出');

  // 读 SOUL.md 获取作品名
  const soulText = await readFileSafe(resolveInProject(projectName, 'SOUL.md')) || '';
  const titleMatch = soulText.match(/^#\s+(.+)$/m);
  const novelTitle = titleMatch ? titleMatch[1].trim() : projectName;

  // 拼正文
  const parts = [];
  if (includeFrontmatter) {
    parts.push(`# ${novelTitle}\n`);
    parts.push(`> 共 ${chapters.length} 章 · 导出时间 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}\n`);
    parts.push('');
  }

  let totalChars = 0;
  for (const ch of chapters) {
    const abs = path.join(resolveInProject(projectName, 'chapters'), ch.file);
    const text = await readFileSafe(abs) || '';
    parts.push(`\n## 第 ${ch.chapter} 章 ${ch.title}\n`);
    parts.push(text.trim());
    parts.push('\n');
    totalChars += text.length;
  }

  const merged = parts.join('\n');

  // 落 exports/full-novel.md
  const mdPath = 'exports/full-novel.md';
  const txtPath = 'exports/full-novel.txt';
  await writeFileSafe(resolveInProject(projectName, mdPath), merged);

  // 纯文本版（去掉 # 标题、保留 章名）
  const plain = merged
    .replace(/^#\s+/gm, '')
    .replace(/^>.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  await writeFileSafe(resolveInProject(projectName, txtPath), plain);

  return {
    chapters: chapters.length,
    chars: totalChars,
    files: [mdPath, txtPath],
  };
}
