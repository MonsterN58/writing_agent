// 事件落盘：每次 runAgent 开一个 novels/<project>/runs/<iso>.jsonl，
// 所有 emit 事件按行追加。支持断开后继续读。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveInProject, ensureDir } from './fs-utils.js';

const SKIP_TYPES = new Set(['token', 'reasoning']); // 这俩太碎，trace 不落

function tsFile() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * @returns {{ relPath, wrap, close }}
 *   wrap: 给一个原始 emit，返回包装后的 emit（写 SSE + 写 trace）
 */
export async function openTrace(projectName) {
  if (!projectName) {
    return {
      relPath: null,
      wrap: (emit) => emit,
      close: async () => {},
    };
  }
  const relPath = `runs/${tsFile()}.jsonl`;
  const abs = resolveInProject(projectName, relPath);
  await ensureDir(path.dirname(abs));
  const fh = await fsp.open(abs, 'a');
  let closed = false;
  const startedAt = Date.now();
  await fh.write(JSON.stringify({ type: 'trace_open', startedAt: new Date(startedAt).toISOString(), projectName }) + '\n');

  return {
    relPath,
    wrap: (emit) => (evt) => {
      emit(evt);
      if (closed || !evt || SKIP_TYPES.has(evt.type)) return;
      try {
        fh.write(JSON.stringify({ t: Date.now() - startedAt, ...evt }) + '\n');
      } catch {}
    },
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await fh.write(JSON.stringify({ type: 'trace_close', ms: Date.now() - startedAt }) + '\n');
      } catch {}
      try { await fh.close(); } catch {}
    },
  };
}
