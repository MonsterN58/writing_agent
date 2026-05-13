import { readFileSafe, resolveInProject } from './fs-utils.js';

export function contentPreview(text = '', max = 360) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export async function chapterWritePreview({ projectName, chapter, title, content }) {
  const wordCount = (String(content || '').match(/[\u4e00-\u9fa5]/g) || []).length;
  let existing = null;
  try {
    const chaptersDir = resolveInProject(projectName, 'chapters');
    const files = await import('node:fs/promises').then((fs) => fs.readdir(chaptersDir).catch(() => []));
    const hit = files.find((f) => new RegExp(`^第?0*${Number(chapter)}章|^chapter-${Number(chapter)}\\b`, 'i').test(f));
    if (hit) {
      const old = await readFileSafe(resolveInProject(projectName, `chapters/${hit}`));
      existing = old == null ? null : { path: `chapters/${hit}`, chars: old.length };
    }
  } catch {}
  return {
    type: 'write_preview',
    target: 'chapter',
    chapter,
    title,
    wordCount,
    mode: existing ? 'overwrite' : 'create',
    existing,
    preview: contentPreview(content),
  };
}

export function editFilePreview({ path, old_str, new_str }) {
  return {
    type: 'write_preview',
    target: 'edit_file',
    path,
    oldChars: String(old_str || '').length,
    newChars: String(new_str || '').length,
    delta: String(new_str || '').length - String(old_str || '').length,
    before: contentPreview(old_str),
    after: contentPreview(new_str),
  };
}
