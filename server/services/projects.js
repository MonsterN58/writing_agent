// 作品管理
import path from 'node:path';
import fsp from 'node:fs/promises';
import { NOVELS_ROOT, ensureDir, existsSync, readFileSafe, writeFileSafe, safeName, resolveInProject } from './fs-utils.js';

const SUBDIRS = [
  'outline', 'outline/chapters', 'outline/arcs', 'outline/volumes', 'outline/versions',
  'chapters', 'chapters/versions',
  'knowledge', 'knowledge/world', 'knowledge/entities', 'knowledge/concepts', 'knowledge/locations', 'knowledge/items',
  'reviews/consistency', 'reviews/critique', 'reviews/foreshadow',
  'progress', 'memory', 'style', 'style/samples',
  'exports',
  // 注：`relations/` 已从脚手架移除（人物关系统一走 knowledge/relationships.md 单文件）。
  // fs-utils.js 白名单仍允许写 relations/，以兼容老项目。
];

/**
 * 是否为「内部 / fixture / 隐藏」项目目录。约定：
 *   - 以 `__` 开头且以 `__` 结尾（eval fixture，例如 __eval_upload__）
 *   - 以 `.` 开头（隐藏目录，例如 .git / .DS_Store-like）
 * 这些项目不会出现在 `/api/projects` 返回里，前端下拉框也就不会显示。
 */
export function isInternalProjectName(name) {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  if (name.startsWith('__') && name.endsWith('__')) return true;
  return false;
}

export async function listProjects({ includeInternal = false } = {}) {
  await ensureDir(NOVELS_ROOT);
  const entries = await fsp.readdir(NOVELS_ROOT, { withFileTypes: true });
  const result = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (!includeInternal && isInternalProjectName(ent.name)) continue;
    const projDir = path.join(NOVELS_ROOT, ent.name);
    const metaPath = path.join(projDir, 'meta.json');
    let meta = { name: ent.name, createdAt: null, lastChapter: 0 };
    try {
      const txt = await readFileSafe(metaPath);
      if (txt) meta = { ...meta, ...JSON.parse(txt) };
    } catch {}
    const hasSoul = existsSync(path.join(projDir, 'SOUL.md'));
    result.push({ name: ent.name, hasSoul, ...meta });
  }
  return result;
}

export async function createProject(rawName) {
  const name = safeName(rawName);
  if (!name) throw new Error('作品名不能为空');
  const projDir = path.join(NOVELS_ROOT, name);
  if (existsSync(projDir)) throw new Error(`作品已存在：${name}`);
  for (const sub of SUBDIRS) {
    await ensureDir(path.join(projDir, sub));
  }
  await writeFileSafe(path.join(projDir, 'meta.json'), JSON.stringify({
    name,
    createdAt: new Date().toISOString(),
    lastChapter: 0,
  }, null, 2));
  await writeFileSafe(path.join(projDir, 'progress', 'state.json'), JSON.stringify({
    currentChapter: 0,
    lastUpdate: new Date().toISOString(),
  }, null, 2));
  return { name };
}

export async function readSoul(projectName) {
  const p = resolveInProject(projectName, 'SOUL.md');
  return await readFileSafe(p);
}

export async function writeSoul(projectName, content) {
  const p = resolveInProject(projectName, 'SOUL.md');
  await writeFileSafe(p, content);
}

/** 删除整个作品目录（递归）。二次确认由前端负责。 */
export async function deleteProject(rawName) {
  const name = safeName(rawName);
  if (!name) throw new Error('作品名不能为空');
  const projDir = path.join(NOVELS_ROOT, name);
  if (!existsSync(projDir)) throw new Error(`作品不存在：${name}`);
  // 安全校验：目录必须在 NOVELS_ROOT 下
  const resolved = path.resolve(projDir);
  const rootResolved = path.resolve(NOVELS_ROOT);
  if (!resolved.startsWith(rootResolved + path.sep)) {
    throw new Error('路径非法，拒绝删除');
  }
  await fsp.rm(projDir, { recursive: true, force: true });
  return { ok: true, name };
}
