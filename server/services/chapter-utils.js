// 章节命名 / 编号 / 解析工具
import path from 'node:path';
import fsp from 'node:fs/promises';
import { resolveInProject, readFileSafe, writeFileSafe, ensureDir } from './fs-utils.js';

// 文件名规范：`第N章-标题.md`，N 为正整数无前导零
const CHAPTER_RE = /^第([1-9]\d*)章-(.+)\.md$/;

/** 清洗章节标题（去掉文件名非法字符） */
export function sanitizeTitle(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 60) || '未命名';
}

/** 章节文件名 */
export function chapterFilename(chapter, title) {
  const n = Number(chapter);
  if (!Number.isInteger(n) || n < 1) throw new Error(`章号必须是正整数：${chapter}`);
  return `第${n}章-${sanitizeTitle(title)}.md`;
}

/** 解析已有章节文件名 */
export function parseChapterFile(name) {
  const m = CHAPTER_RE.exec(name);
  if (!m) return null;
  return { chapter: Number(m[1]), title: m[2] };
}

/** 列出已写章节，按章号排序 */
export async function listChapters(projectName) {
  const dir = resolveInProject(projectName, 'chapters');
  let names;
  try { names = await fsp.readdir(dir); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const items = [];
  for (const n of names) {
    const p = parseChapterFile(n);
    if (!p) continue;
    const stat = await fsp.stat(path.join(dir, n));
    items.push({ ...p, file: n, size: stat.size, mtime: stat.mtimeMs });
  }
  items.sort((a, b) => a.chapter - b.chapter);
  return items;
}

/** 找出现有同章号文件（用户改了标题也能命中） */
export async function findExistingChapterFile(projectName, chapter) {
  const all = await listChapters(projectName);
  return all.find((c) => c.chapter === Number(chapter)) || null;
}

/** 写章节（自动备份 + 写正稿 + 更新草稿 + 进度） */
export async function writeChapterFile({ projectName, chapter, title, content }) {
  const n = Number(chapter);
  if (!Number.isInteger(n) || n < 1) throw new Error(`章号必须是正整数：${chapter}`);
  const cleanTitle = sanitizeTitle(title);
  const filename = chapterFilename(n, cleanTitle);

  const chaptersDir = resolveInProject(projectName, 'chapters');
  const versionsDir = resolveInProject(projectName, 'chapters/versions');
  await ensureDir(chaptersDir);
  await ensureDir(versionsDir);

  // 同章号已有文件 → 备份到 versions/
  const existing = await findExistingChapterFile(projectName, n);
  if (existing) {
    const oldAbs = path.join(chaptersDir, existing.file);
    const oldText = await readFileSafe(oldAbs);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
    const backupAbs = path.join(versionsDir, `章${String(n).padStart(3, '0')}-${ts}.md`);
    if (oldText != null) await writeFileSafe(backupAbs, oldText);
    // 如果旧文件名（标题改了）和新文件名不一致，删掉旧文件
    if (existing.file !== filename) {
      try { await fsp.unlink(oldAbs); } catch {}
    }
  }

  // 写正稿
  const targetAbs = path.join(chaptersDir, filename);
  await writeFileSafe(targetAbs, content);

  // 写最新草稿镜像（覆盖）
  const draftAbs = path.join(chaptersDir, 'latest-draft.md');
  await writeFileSafe(draftAbs, `<!-- 第${n}章 ${cleanTitle} · ${new Date().toISOString()} -->\n\n${content}`);

  // 更新 meta.json + progress/state.json
  await updateChapterProgress(projectName, n);

  return {
    file: filename,
    relPath: `chapters/${filename}`,
    bytes: content.length,
    backedUp: !!existing,
  };
}

async function updateChapterProgress(projectName, chapterN) {
  // meta.json
  try {
    const metaAbs = resolveInProject(projectName, 'meta.json');
    const txt = await readFileSafe(metaAbs);
    const meta = txt ? JSON.parse(txt) : {};
    meta.lastChapter = Math.max(Number(meta.lastChapter || 0), chapterN);
    meta.lastUpdate = new Date().toISOString();
    await writeFileSafe(metaAbs, JSON.stringify(meta, null, 2));
  } catch (e) {
    console.warn('[chapter] 更新 meta.json 失败：', e.message);
  }
  // progress/state.json
  try {
    const stateAbs = resolveInProject(projectName, 'progress/state.json');
    const txt = await readFileSafe(stateAbs);
    const st = txt ? JSON.parse(txt) : {};
    st.currentChapter = chapterN;
    st.lastUpdate = new Date().toISOString();
    await writeFileSafe(stateAbs, JSON.stringify(st, null, 2));
  } catch (e) {
    console.warn('[chapter] 更新 progress/state.json 失败：', e.message);
  }
}

/** 写大纲（总纲 / 单章纲 / 弧光 / worldbuilding） */
export async function writeOutlineFile({ projectName, relPath, content }) {
  if (!relPath.startsWith('outline/')) {
    throw new Error('write_outline 只能写 outline/ 下的路径');
  }
  // 限制扩展名
  if (!relPath.endsWith('.md')) {
    throw new Error('outline 文件必须是 .md');
  }
  const abs = resolveInProject(projectName, relPath);
  await writeFileSafe(abs, content);
  return { relPath, bytes: content.length };
}
