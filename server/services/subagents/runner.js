// 通用子 Agent 运行器：短 LLM 会话，返回结构化 JSON 或纯文本；默认只读、不写盘。
import { streamChat } from '../llm.js';

/**
 * @param {object} opts
 * @param {string} opts.role         - 角色标识，会出现在事件埋点里（例：'arc-writer#1'）
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {object} [opts.schema]     - 若提供，则提示 LLM 严格按此 JSON 结构输出，并在返回前 parse
 * @param {number} [opts.timeoutMs=120000]
 * @param {AbortSignal} [opts.signal]
 * @param {(evt:any)=>void} [opts.emit]
 * @returns {Promise<{ok:boolean, data?:any, raw:string, error?:string, ms:number, role:string}>}
 */
export async function runSubAgent({ role, systemPrompt, userPrompt, schema, timeoutMs = 120000, signal, emit, profile = 'cheap' }) {
  const t0 = Date.now();
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener?.('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  emit?.({ type: 'subagent_start', role });
  try {
    const sys = schema
      ? `${systemPrompt}\n\n## 严格输出 JSON，schema 示意：\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n只输出 JSON，不要前后文字、不要 markdown fence 外的内容。`
      : systemPrompt;
    const { content } = await streamChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userPrompt },
      ],
      tools: [],
      signal: ac.signal,
      onChunk: () => {},
      profile,
    });
    const ms = Date.now() - t0;
    let data;
    if (schema) {
      try { data = parseJson(content); }
      catch (e) {
        emit?.({ type: 'subagent_done', role, ok: false, ms, error: `JSON 解析失败: ${e.message}` });
        return { ok: false, raw: content, error: `JSON 解析失败: ${e.message}`, ms, role };
      }
    } else {
      data = content;
    }
    emit?.({ type: 'subagent_done', role, ok: true, ms, chars: content.length });
    return { ok: true, data, raw: content, ms, role };
  } catch (e) {
    const ms = Date.now() - t0;
    const err = String(e?.message || e);
    emit?.({ type: 'subagent_done', role, ok: false, ms, error: err });
    return { ok: false, raw: '', error: err, ms, role };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

function parseJson(text) {
  if (!text) throw new Error('空输出');
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1].trim();
  // 优先尝试对象，再尝试数组
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  }
  const ar = s.indexOf('['); const br = s.lastIndexOf(']');
  if (ar >= 0 && br > ar) {
    return JSON.parse(s.slice(ar, br + 1));
  }
  throw new Error('未找到 JSON 边界');
}
