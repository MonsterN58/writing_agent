// 定点替换工具：old_str → new_str 精准定位，自动备份，不允许新建。
// 白名单：复用 fs-utils 的 WRITE_RULES，按 path 前缀推断归属工具。
import { resolveInProject, readFileSafe, writeFileSafe, assertWriteAllowed } from './fs-utils.js';
import { backupFile } from './reviews.js';

const MAX_OLD_STR = 4000;
const MAX_NEW_STR = 8000;

/** 根据 path 推断它归哪个写工具管（以便复用 WRITE_RULES）。 */
export function inferOwnerTool(relPath) {
  const p = String(relPath || '');
  if (p === 'SOUL.md') return 'setup_work';
  if (p.startsWith('chapters/')) return 'write_chapter';
  if (p.startsWith('outline/')) return 'write_outline';
  if (p === 'knowledge/lookup.json' || p === 'knowledge/lookup.md') return 'lookup_upsert';
  if (p === 'knowledge/foreshadow.md' || p === 'progress/foreshadow-alerts.md') return 'foreshadow_scan';
  if (p === 'knowledge/lint-report.md') return 'wiki_lint';
  if (p.startsWith('knowledge/synthesis/')) return 'wiki_archive';
  if (p.startsWith('knowledge/world/') || p === 'knowledge/relationships.md') return 'update_progress';
  if (p.startsWith('knowledge/')) return 'wiki_ingest';
  if (p.startsWith('reviews/')) return 'consistency_check';
  if (p.startsWith('skills/')) return 'create_user_skill';
  // 兜底：progress/ memory/ style/ reviews/ relations/ exports/
  return 'update_progress';
}

/**
 * @param {object} opts
 *   - projectName
 *   - path:       作品内相对路径，文件必须已存在
 *   - old_str:    必须在文件中唯一出现（除非指定 occurrence）
 *   - new_str:    替换为的文本（允许为空以删除）
 *   - occurrence: 当 old_str 多次出现时指定第几次（1-based），否则要求必须唯一
 *   - expected_count: 可选，断言 old_str 总出现次数，不符直接报错
 */
export async function editFile({ projectName, path: relPath, old_str, new_str = '', occurrence = null, expected_count = null }) {
  if (!projectName) throw new Error('未激活作品');
  if (!relPath) throw new Error('缺少 path');
  if (typeof old_str !== 'string' || !old_str.length) throw new Error('old_str 不能为空');
  if (old_str.length > MAX_OLD_STR) throw new Error(`old_str 不能超过 ${MAX_OLD_STR} 字符`);
  if (new_str.length > MAX_NEW_STR) throw new Error(`new_str 不能超过 ${MAX_NEW_STR} 字符`);
  if (old_str === new_str) throw new Error('old_str 与 new_str 完全相同');

  const owner = inferOwnerTool(relPath);
  assertWriteAllowed(owner, relPath);

  const abs = resolveInProject(projectName, relPath);
  const original = await readFileSafe(abs);
  if (original == null) throw new Error(`文件不存在：${relPath}（edit_file 仅用于修改已有文件，新建请用对应写工具）`);

  const positions = findAll(original, old_str);
  const count = positions.length;

  if (expected_count != null && count !== Number(expected_count)) {
    return errorEnvelope({
      kind: 'occurrence_mismatch',
      message: `old_str 实际出现 ${count} 次，与 expected_count=${expected_count} 不符`,
      matches: count,
      hint: '先 read_file 查全文，核对后再调，或改用 occurrence 定位第 N 次。',
      sample: sampleContexts(original, positions, old_str),
    });
  }

  if (count === 0) {
    return errorEnvelope({
      kind: 'not_found',
      message: 'old_str 在文件中未找到',
      matches: 0,
      hint: '常见原因：(1) 空白/换行不完全一致（TAB vs 空格、CRLF vs LF）；(2) 已被上一次编辑改动。先 read_file maxChars=0 拿最新全文再重试。',
    });
  }

  let targetIdx;
  if (count === 1) {
    targetIdx = positions[0];
  } else {
    if (!occurrence) {
      return errorEnvelope({
        kind: 'ambiguous',
        message: `old_str 有 ${count} 处匹配，必须指定 occurrence（1-based）或把 old_str 扩成包含更多上下文使其唯一`,
        matches: count,
        hint: '推荐方案：把 old_str 扩大到包含上下各 1-2 行，使其在文件内唯一；或传 occurrence: 1 精确定位第几处。',
        sample: sampleContexts(original, positions, old_str),
      });
    }
    const idx = Number(occurrence) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
      return errorEnvelope({
        kind: 'bad_occurrence',
        message: `occurrence=${occurrence} 超出范围 [1, ${count}]`,
        matches: count,
      });
    }
    targetIdx = positions[idx];
  }

  const backupRel = await backupFile(projectName, relPath);

  const before = original.slice(0, targetIdx);
  const after = original.slice(targetIdx + old_str.length);
  const updated = before + new_str + after;
  await writeFileSafe(abs, updated);

  const lineNumber = before.split(/\r?\n/).length;
  const linesChanged = linesChangedCount(old_str, new_str);

  return {
    status: 'ok',
    path: relPath,
    bytesBefore: original.length,
    bytesAfter: updated.length,
    bytesDelta: updated.length - original.length,
    matchIndex: targetIdx,
    lineNumber,
    linesChanged,
    backup: backupRel,
    owner,
  };
}

function findAll(text, sub) {
  const out = [];
  if (!sub) return out;
  let from = 0;
  while (true) {
    const i = text.indexOf(sub, from);
    if (i === -1) break;
    out.push(i);
    from = i + Math.max(1, sub.length);
  }
  return out;
}

function sampleContexts(text, positions, needle, n = 3) {
  return positions.slice(0, n).map((p) => {
    const start = Math.max(0, p - 40);
    const end = Math.min(text.length, p + needle.length + 40);
    return { at: p, context: text.slice(start, end).replace(/\n/g, '\\n') };
  });
}

function linesChangedCount(a, b) {
  return Math.max(a.split(/\r?\n/).length, b.split(/\r?\n/).length);
}

function errorEnvelope(data) {
  return { status: 'error', ...data };
}
