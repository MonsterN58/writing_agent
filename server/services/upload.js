// 用户从前端上传文本类材料的服务：导入素材文件 + 上传作品级 user skill
import fssync from 'node:fs';
import { resolveInProject, writeFileSafe } from './fs-utils.js';
import { parseFrontmatter } from './frontmatter.js';
import { writeUserSkill } from './skills.js';

// 允许直接落盘的子目录白名单（imports/ 是默认）
const IMPORT_DIR_ALLOWLIST = [
  'imports',
  'knowledge/world',
  'knowledge/entities',
  'outline',
  'outline/volumes',
  'outline/arcs',
  'outline/chapters',
  'style',
  'references',
];

// 允许的扩展名（文本类）
const TEXT_EXT_ALLOWLIST = /\.(md|markdown|txt|json|yaml|yml)$/i;

const MAX_TEXT_BYTES = 4 * 1024 * 1024; // 4MB，与 express.json limit 对齐

/** 文件名净化：去掉路径分隔符和危险符号，保留中文/字母/数字/常用连接符 */
function safeFileName(name) {
  return String(name || '')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}

function tsSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * 把一段用户上传的文本写入作品内白名单子目录。
 * @param {object} opts
 *   - project: string
 *   - filename: string  原始文件名
 *   - content: string   文本内容
 *   - subdir: string    目标子目录（默认 imports，必须在白名单内）
 *   - overwrite: boolean
 * @returns {{ok, relPath, chars}}
 */
export async function importTextFile({ project, filename, content, subdir = 'imports', overwrite = false } = {}) {
  if (!project) throw new Error('缺少 project');
  if (typeof content !== 'string') throw new Error('content 必须是字符串');
  if (!content.trim()) throw new Error('content 为空');
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw new Error('文本超过 4MB 上限');

  const safeFile = safeFileName(filename || `import-${tsSlug()}.md`);
  if (!TEXT_EXT_ALLOWLIST.test(safeFile)) {
    throw new Error('仅支持 .md/.markdown/.txt/.json/.yaml/.yml');
  }

  const cleanSubdir = String(subdir || 'imports').replace(/^\/+|\/+$/g, '');
  if (!IMPORT_DIR_ALLOWLIST.includes(cleanSubdir)) {
    throw new Error(`不允许写入子目录：${cleanSubdir}（白名单：${IMPORT_DIR_ALLOWLIST.join(', ')}）`);
  }

  // imports 默认带时间戳避免冲突；其它白名单子目录不强制改名
  const isImports = /^imports(\/|$)/.test(cleanSubdir);
  const finalName = isImports ? `${tsSlug()}-${safeFile}` : safeFile;
  const relPath = `${cleanSubdir}/${finalName}`.replace(/^\/+/, '');
  const abs = resolveInProject(project, relPath);

  if (!overwrite && fssync.existsSync(abs)) {
    const err = new Error(`目标已存在：${relPath}（传 overwrite=true 覆盖）`);
    err.code = 'EEXIST';
    throw err;
  }

  await writeFileSafe(abs, content);
  return { ok: true, relPath, chars: content.length };
}

/**
 * 上传一个完整的 user skill markdown（含 frontmatter），解析后写入 novels/<proj>/skills/。
 * 兼容用户从其它机器/项目 copy 过来的 skill 文件。
 * @param {object} opts
 *   - project: string
 *   - name: string?  覆盖 frontmatter.name
 *   - content: string
 *   - overwrite: boolean
 * @returns {{ok, name, relPath, bytes}}
 */
export async function uploadUserSkill({ project, name, content, overwrite = false } = {}) {
  if (!project) throw new Error('缺少 project');
  if (typeof content !== 'string' || content.length < 30) throw new Error('skill 内容过短');
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw new Error('skill 超过 4MB 上限');

  const { data, body } = parseFrontmatter(content);
  // 名字优先级：参数 > frontmatter.name > frontmatter.title 推断
  let finalName = String(name || data.name || '').trim().toLowerCase();
  if (!finalName && data.title) {
    finalName = String(data.title).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  }
  if (!finalName) throw new Error('请在 frontmatter 提供 name，或上传时显式传 name');

  const payload = {
    projectName: project,
    name: finalName,
    title: data.title || finalName,
    description: data.description || '',
    keywords: data.keywords || [],
    activate_when: data.activate_when || data.autoBefore || [],
    activate_after: data.activate_after || data.autoAfter || [],
    priority: Number(data.priority || 3),
    body: body || content,
  };

  if (!overwrite) {
    // writeUserSkill 不会自动覆盖检查；这里手动判断
    const abs = resolveInProject(project, `skills/${finalName}.md`);
    if (fssync.existsSync(abs)) {
      const err = new Error(`skill 已存在：${finalName}（传 overwrite=true 覆盖）`);
      err.code = 'EEXIST';
      throw err;
    }
  }

  return await writeUserSkill(payload);
}
