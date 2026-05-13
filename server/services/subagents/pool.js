// 子 Agent 并发池：固定并发上限 / 局部失败隔离 / 逐任务 emit 进度。
/**
 * @template T
 * @param {Array<{role:string, run:()=>Promise<T>}>} tasks
 * @param {{concurrency?:number, emit?:(e:any)=>void, signal?:AbortSignal}} [opts]
 * @returns {Promise<Array<T|{ok:false,error:string}>>}
 */
export async function runParallel(tasks, { concurrency = 3, emit, signal } = {}) {
  const n = tasks.length;
  const results = new Array(n);
  let cursor = 0;
  const workerCount = Math.min(concurrency, n);
  const workers = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (cursor < n) {
        if (signal?.aborted) return;
        const i = cursor++;
        const t = tasks[i];
        emit?.({ type: 'subagent_enqueue', role: t.role, index: i, total: n });
        try {
          results[i] = await t.run();
        } catch (e) {
          results[i] = { ok: false, error: String(e?.message || e) };
        }
      }
    })());
  }
  await Promise.all(workers);
  return results;
}
