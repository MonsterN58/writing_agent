// OpenAI 兼容客户端封装（流式 + 工具调用）
import OpenAI from 'openai';
import {
  getApiKey,
  getBaseURL,
  getModel,
  getTemperature,
  getMaxTokens,
  onConfigChange,
} from './llm-config.js';

let _client = null;
onConfigChange(() => { _client = null; });
export function resetLLMClient() { _client = null; }
function getClient() {
  if (_client) return _client;
  const apiKey = getApiKey();
  const baseURL = getBaseURL();
  if (!apiKey || !baseURL) {
    throw new Error('请在 .env 或前端"LLM 配置"中填写 LLM_API_KEY 和 LLM_BASE_URL');
  }
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

/** 暴露给 /api/llm-config/test：用当前配置发一个 1-token ping */
export async function pingLLM({ profile = 'default', signal } = {}) {
  const client = getClient();
  const model = getModel(profile);
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 8,
    messages: [{ role: 'user', content: 'ping' }],
  }, signal ? { signal } : undefined);
  return {
    ok: true,
    model,
    latencyMs: Date.now() - t0,
    sample: resp?.choices?.[0]?.message?.content || '',
    usage: resp?.usage || null,
  };
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_TOKENS_CHEAP = 4096;
const DEFAULT_MAX_TOKENS_WRITER = 12288;
const DEFAULT_MAX_TOKENS_ULTRA = 16384;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * 模型配置。profile 决定用哪个档位：
 *   'default' / undefined → LLM_MODEL（主模型）
 *   'cheap'               → LLM_MODEL_CHEAP（critic / wiki_ingest / 子 agent 默认）
 *   'writer'              → LLM_MODEL_WRITER（写章 / 改稿高质量档）
 *   'ultra'               → LLM_MODEL_ULTRA（最高质量 / 长上下文档）
 * 任一 env 未配则回退到 LLM_MODEL。
 */
export function llmConfig(profile = 'default') {
  const model = getModel(profile);
  const temperature = getTemperature(profile);
  const defaultByProfile = profile === 'cheap'
    ? DEFAULT_MAX_TOKENS_CHEAP
    : (profile === 'writer' ? DEFAULT_MAX_TOKENS_WRITER : (profile === 'ultra' ? DEFAULT_MAX_TOKENS_ULTRA : DEFAULT_MAX_TOKENS));
  const maxTokens = positiveInt(getMaxTokens(profile), defaultByProfile);
  return {
    model,
    temperature,
    max_tokens: maxTokens,
    profile,
  };
}

/**
 * 流式 chat completion，逐 chunk 回调
 * @param {object} opts
 * @param {Array} opts.messages
 * @param {Array} opts.tools - OpenAI tool schema
 * @param {(chunk) => void} opts.onChunk - 每个 delta（含 content / tool_calls 增量）
 * @returns {Promise<{content: string, tool_calls: Array}>} 完整回复
 */
export async function streamChat({ messages, tools, onChunk, signal, toolChoice, profile }) {
  const client = getClient();
  const cfg = llmConfig(profile);
  const t0 = Date.now();
  const promptChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
  console.log(`[llm] → ${cfg.model} profile=${cfg.profile} max=${cfg.max_tokens} msgs=${messages.length} chars=${promptChars} tools=${tools?.length || 0}`);
  if (signal?.aborted) {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  }
  const stream = await withBackoff(() => client.chat.completions.create({
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
    messages,
    tools: tools && tools.length ? tools : undefined,
    tool_choice: tools && tools.length ? (toolChoice || 'auto') : undefined,
    stream: true,
    // 让兼容 OpenAI 的供应商（deepseek / qwen / openai 本身）把 usage 放在流最后一个 chunk
    stream_options: { include_usage: true },
  }, signal ? { signal } : undefined), { signal });

  let content = '';
  let reasoning = '';
  let usage = null;
  /** @type {Map<number, {id?: string, name?: string, args: string}>} */
  const toolCallsBuf = new Map();

  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      onChunk?.({ type: 'token', text: delta.content });
    }
    // 兼容 deepseek-reasoner / Qwen QwQ 等推理模型：reasoning_content 单独走流
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      onChunk?.({ type: 'reasoning', text: delta.reasoning_content });
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolCallsBuf.get(idx) || { args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolCallsBuf.set(idx, cur);
      }
    }
  }

  const tool_calls = [...toolCallsBuf.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function',
      function: { name: v.name, arguments: v.args || '{}' },
    }))
    .filter((c) => c.function.name);

  const dt = Date.now() - t0;
  const cached = normalizeCached(usage);
  console.log(`[llm] ← ${dt}ms content=${content.length} reasoning=${reasoning.length} tools=${tool_calls.length} tokens=${usage?.prompt_tokens ?? '?'}+${usage?.completion_tokens ?? '?'}${cached != null ? ` cached=${cached}` : ''}`);
  return { content, reasoning, tool_calls, usage: usage ? { ...usage, cached_tokens: cached } : null, config: cfg };
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);

function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  if (RETRYABLE_STATUS.has(err.status)) return true;
  if (RETRYABLE_CODES.has(err.code)) return true;
  const msg = String(err.message || '').toLowerCase();
  if (/rate limit|too many requests|timeout|temporar/.test(msg)) return true;
  return false;
}

/** 指数退避 + jitter。最多 3 次（共 4 次尝试）。signal.aborted 立刻抛不重试。 */
async function withBackoff(fn, { signal, maxRetries = 3 } = {}) {
  const base = [500, 2000, 6000];
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxRetries) throw err;
      const delay = base[attempt] + Math.floor(Math.random() * 400);
      console.warn(`[llm] retry attempt ${attempt + 1}/${maxRetries} in ${delay}ms · ${err.status || err.code || ''} ${String(err.message || '').slice(0, 120)}`);
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/** 各家 OpenAI 兼容 API 把 cached 放在不同字段里，这里统一归一。 */
function normalizeCached(u) {
  if (!u) return null;
  // OpenAI: prompt_tokens_details.cached_tokens
  const fromDetails = u.prompt_tokens_details?.cached_tokens;
  if (typeof fromDetails === 'number') return fromDetails;
  // DeepSeek: prompt_cache_hit_tokens + prompt_cache_miss_tokens
  if (typeof u.prompt_cache_hit_tokens === 'number') return u.prompt_cache_hit_tokens;
  // Qwen / 通义：cache_tokens / cached_tokens 直放
  if (typeof u.cached_tokens === 'number') return u.cached_tokens;
  if (typeof u.cache_tokens === 'number') return u.cache_tokens;
  return null;
}
