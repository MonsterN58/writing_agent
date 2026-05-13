// 路径白名单 + 安全文件读写
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const NOVELS_ROOT = path.join(ROOT, 'novels');
export const SKILLS_ROOT = path.join(ROOT, 'skills');

/** 标准化作品名为目录安全的形式 */
export function safeName(name) {
  return String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

/** 把作品内相对路径解析为绝对路径，越界则抛错 */
export function resolveInProject(projectName, relPath) {
  const proj = safeName(projectName);
  if (!proj) throw new Error('作品名为空');
  const projDir = path.join(NOVELS_ROOT, proj);
  const target = path.resolve(projDir, relPath || '');
  if (!target.startsWith(projDir + path.sep) && target !== projDir) {
    throw new Error(`路径越界：${relPath}`);
  }
  return target;
}

/** 各 skill 写入许可：path 必须落在白名单子目录 */
const WRITE_RULES = {
  // 仅 work-setup 可写 SOUL.md
  setup_work: [/^SOUL\.md$/],
  // 仅 wiki-ingest 可写 knowledge/
  wiki_ingest: [/^knowledge\//],
  // 仅 foreshadow-tracker 可写 foreshadow 总账
  foreshadow_scan: [/^knowledge\/foreshadow\.md$/, /^progress\/foreshadow-alerts\.md$/],
  // 大纲
  write_outline: [/^outline\//],
  // 章节正文
  write_chapter: [/^chapters\//],
  // 一致性报告
  consistency_check: [/^reviews\//],
  // 改稿备份
  revision_backup: [/^chapters\/versions\//, /^outline\/versions\//],
  // 通用进度/记忆/风格 (允许较宽松)
  update_progress: [/^progress\//, /^memory\//, /^style\//, /^reviews\//, /^relations\//, /^exports\//, /^knowledge\/world\//, /^knowledge\/relationships\.md$/],
  create_user_skill: [/^skills\/[a-z0-9][a-z0-9-]{1,40}\.md$/],
  lookup_upsert: [/^knowledge\/lookup\.(json|md)$/],
  lookup_remove: [/^knowledge\/lookup\.(json|md)$/],
  lookup_rebuild: [/^knowledge\/lookup\.(json|md)$/],
  wiki_archive: [/^knowledge\/synthesis\/[a-z0-9][a-z0-9-]*\.md$/, /^knowledge\/log\.md$/],
  wiki_lint: [/^knowledge\/lint-report\.md$/],
};

export function assertWriteAllowed(toolName, relPath) {
  const rules = WRITE_RULES[toolName];
  if (!rules) throw new Error(`工具 ${toolName} 无写权限`);
  if (!rules.some((re) => re.test(relPath))) {
    throw new Error(`工具 ${toolName} 不允许写入路径 ${relPath}`);
  }
}

export async function ensureDir(absDir) {
  await fsp.mkdir(absDir, { recursive: true });
}

export async function readFileSafe(absPath) {
  try {
    return await fsp.readFile(absPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeFileSafe(absPath, content) {
  await ensureDir(path.dirname(absPath));
  await fsp.writeFile(absPath, content, 'utf8');
}

/**
 * 列目录递归。
 * options.includeVersions=false（默认）：跳过 versions/、.tmp/ 等历史/临时目录，避免给 LLM 灌大量备份噪声。
 * 前端文件树独立调用 includeVersions=true 时可看到全部。
 */
export async function listDirRecursive(absDir, baseDir = absDir, options = {}) {
  const { includeVersions = false } = options;
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const ent of entries) {
    if (!includeVersions && (ent.name === 'versions' || ent.name === '.tmp')) continue;
    const full = path.join(absDir, ent.name);
    const rel = path.relative(baseDir, full).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      out.push({ type: 'dir', path: rel, name: ent.name });
      out.push(...(await listDirRecursive(full, baseDir, options)));
    } else {
      const stat = await fsp.stat(full);
      out.push({ type: 'file', path: rel, name: ent.name, size: stat.size });
    }
  }
  return out;
}

export function existsSync(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
