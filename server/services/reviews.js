// 一致性扫描报告 / 历史版本管理 / 通用文件备份
import path from 'node:path';
import fsp from 'node:fs/promises';
import { resolveInProject, readFileSafe, writeFileSafe, ensureDir } from './fs-utils.js';

/** 用于 reviews/consistency 报告 + 通用备份的时间戳 */
function ts() {
  // YYYY-MM-DDTHH-MM-SS-ms 含毫秒，避免同秒覆盖
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
}

/** 把任意已有文件备份到 <dir>/versions/<basename>-<ts>.<ext> */
export async function backupFile(projectName, relPath) {
  const abs = resolveInProject(projectName, relPath);
  const txt = await readFileSafe(abs);
  if (txt == null) return null;
  // 备份目录：与文件同级的 versions/
  const parsed = path.posix.parse(relPath.replace(/\\/g, '/'));
  const versionsRel = path.posix.join(parsed.dir || '', 'versions');
  const backupRel = path.posix.join(versionsRel, `${parsed.name}-${ts()}${parsed.ext}`);
  const backupAbs = resolveInProject(projectName, backupRel);
  await ensureDir(path.dirname(backupAbs));
  await writeFileSafe(backupAbs, txt);
  return backupRel;
}

/** 列出某文件的所有历史备份 */
export async function listVersions(projectName, relPath) {
  const parsed = path.posix.parse(relPath.replace(/\\/g, '/'));
  const versionsRel = path.posix.join(parsed.dir || '', 'versions');
  const abs = resolveInProject(projectName, versionsRel);
  let names;
  try { names = await fsp.readdir(abs); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  // 章节用的是 `章NNN-...md` 格式，大纲/SOUL 用 `<basename>-<ts>.<ext>`
  const baseName = parsed.name;
  const out = [];
  for (const n of names) {
    if (!n.startsWith(baseName + '-')) {
      // 章节备份的命名是 `章NNN-时间戳.md`，特殊处理
      // 这里宽松过滤：只要在 versions/ 下都列
    }
    const full = path.join(abs, n);
    const st = await fsp.stat(full);
    out.push({
      file: n,
      relPath: path.posix.join(versionsRel, n),
      size: st.size,
      mtime: st.mtimeMs,
    });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** 写一致性扫描报告 */
export async function writeConsistencyReport({ projectName, chapter, chapterTitle, payload }) {
  const issues = payload.issues || [];
  const critical = issues.filter((i) => i.level === 'critical' || i.level === 'fatal');
  const warning = issues.filter((i) => i.level === 'warning');
  const info = issues.filter((i) => i.level === 'info');

  const date = new Date().toISOString().slice(0, 10);
  const filename = `章${String(chapter).padStart(3, '0')}-${date}.md`;
  const relPath = `reviews/consistency/${filename}`;

  const fmtIssues = (rows, icon) => {
    if (!rows.length) return '（无）\n';
    return rows.map((it, i) => `### ${icon} ${i + 1}. [${it.kind || '其它'}] ${it.title || it.summary || '(无标题)'}

**位置**：${it.position || '?'}

**正文片段**：
> ${(it.excerpt || '').split('\n').join('\n> ')}

${it.conflict_with ? `**与 wiki 矛盾**：\n${it.conflict_with}\n\n` : ''}**建议修改**：
${it.suggestion || '(待定)'}
`).join('\n---\n\n');
  };

  const md = `# 第 ${chapter} 章 一致性扫描

**时间**：${new Date().toISOString().slice(0, 19).replace('T', ' ')}
**扫描章节**：第 ${chapter} 章${chapterTitle ? ' ' + chapterTitle : ''}
**总评**：${critical.length ? '🔴' : warning.length ? '🟡' : '🟢'} ${critical.length} 致命 / ${warning.length} 警告 / ${info.length} 提示

---

## 🔴 致命问题（必须改）

${fmtIssues(critical, '🔴')}

## 🟡 警告（建议改）

${fmtIssues(warning, '🟡')}

## 🟢 提示

${fmtIssues(info, '🟢')}

${payload.passed_checks?.length ? `---

## ✅ 通过项

${payload.passed_checks.map((p) => `- ${p}`).join('\n')}
` : ''}`;

  const abs = resolveInProject(projectName, relPath);
  await writeFileSafe(abs, md);

  return {
    relPath,
    critical: critical.length,
    warning: warning.length,
    info: info.length,
  };
}
