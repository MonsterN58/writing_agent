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

const _protocolByBase = new Map();
const _clients = new Map();
onConfigChange(() => { _clients.clear(); });
function protocolKey() {
  const baseURL = getBaseURL();
  const model = getModel('default');
  return `${baseURL}\n${model}`;
}

function getProtocolProfile() {
  return _protocolByBase.get(protocolKey()) || null;
}

function setProtocolProfile(profile) {
  _protocolByBase.set(protocolKey(), profile);
}

function clearProtocolProfile() {
  _protocolByBase.delete(protocolKey());
}
function getClient() {
  const apiKey = getApiKey();
  const baseURL = getBaseURL();
  if (!apiKey || !baseURL) {
    throw new Error('请在 .env 或前端"LLM 配置"中填写 LLM_API_KEY 和 LLM_BASE_URL');
  }
  const key = `${baseURL}\n${apiKey}`;
  if (_clients.has(key)) return _clients.get(key);
  const client = new OpenAI({ apiKey, baseURL });
  _clients.set(key, client);
  return client;
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
  const { stream, textToolProtocol } = await createChatStreamWithFallback(client, {
    cfg,
    messages,
    tools,
    toolChoice,
    signal,
  });

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
      if (!textToolProtocol) onChunk?.({ type: 'token', text: delta.content });
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

  let tool_calls = [...toolCallsBuf.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function',
      function: { name: v.name, arguments: v.args || '{}' },
    }))
    .filter((c) => c.function.name);
  if (content) {
    const think = extractThinkBlocks(content);
    if (think.reasoning) {
      reasoning += (reasoning ? '\n\n' : '') + think.reasoning;
      content = think.content;
      if (!textToolProtocol) onChunk?.({ type: 'reasoning', text: think.reasoning });
    }
  }
  if (!tool_calls.length && content) {
    const parsed = parseTextToolCalls(content);
    if (parsed.tool_calls.length) {
      tool_calls = parsed.tool_calls;
      content = parsed.content;
      console.warn(`[llm] parsed ${tool_calls.length} text tool_call(s) from fallback content`);
    }
  }
  if (textToolProtocol && content && !tool_calls.length) {
    onChunk?.({ type: 'token', text: content });
  }
  content = typeof content === 'string' ? content : String(content || '');
  reasoning = typeof reasoning === 'string' ? reasoning : String(reasoning || '');

  const dt = Date.now() - t0;
  const cached = normalizeCached(usage);
  console.log(`[llm] ← ${dt}ms content=${content.length} reasoning=${reasoning.length} tools=${tool_calls.length} tokens=${usage?.prompt_tokens ?? '?'}+${usage?.completion_tokens ?? '?'}${cached != null ? ` cached=${cached}` : ''}`);
  return { content, reasoning, tool_calls, usage: usage ? { ...usage, cached_tokens: cached } : null, config: cfg };
}

function buildChatRequest({
  cfg,
  messages,
  tools,
  toolChoice,
  includeUsage = true,
  maxTokens = cfg.max_tokens,
  includeToolChoice = true,
  includeTools = true,
}) {
  const req = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: maxTokens,
    messages,
    stream: true,
  };
  if (includeTools && tools && tools.length) req.tools = tools;
  if (includeToolChoice && includeTools && tools && tools.length) req.tool_choice = toolChoice || 'auto';
  // 部分 OpenAI 兼容服务不支持 stream_options，会返回 400 Param Incorrect。
  if (includeUsage) req.stream_options = { include_usage: true };
  return req;
}

function sanitizeSchemaForCompat(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForCompat);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    // 一些 OpenAI 兼容接口只接受很小的 JSON Schema 子集。
    if (['additionalProperties', 'minimum', 'maximum', 'default', 'examples', 'format'].includes(key)) continue;
    out[key] = sanitizeSchemaForCompat(value);
  }
  return out;
}

function sanitizeToolsForCompat(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: sanitizeSchemaForCompat(tool.function.parameters || { type: 'object', properties: {} }),
    },
  }));
}

function compactToolForPrompt(tool) {
  const fn = tool.function || {};
  const params = fn.parameters || {};
  const props = params.properties || {};
  const fields = Object.entries(props).map(([name, schema]) => {
    const required = Array.isArray(params.required) && params.required.includes(name) ? '*' : '';
    const type = schema?.type || 'string';
    const desc = schema?.description ? ` - ${String(schema.description).slice(0, 120)}` : '';
    return `    - ${name}${required}: ${type}${desc}`;
  }).join('\n') || '    - no parameters';
  return `- ${fn.name}: ${String(fn.description || '').slice(0, 220)}\n${fields}`;
}

function buildToolEmulationMessages(messages, tools = [], toolChoice) {
  if (!tools?.length) return messages;
  const forced = toolChoice?.function?.name;
  const toolList = tools.map(compactToolForPrompt).join('\n');
  const instruction = [
    '当前模型接口不接受 OpenAI tools 参数，改用文本工具调用协议。',
    '当你需要调用工具时，不要只解释，不要写计划，必须输出 XML：',
    '<invoke name="工具名">',
    '<parameter name="参数名">参数值</parameter>',
    '</invoke>',
    '可以连续输出多个 <invoke> 块。参数值可以是普通文本、数字、true/false，复杂对象/数组请写 JSON。',
    forced ? `本轮强制调用工具：${forced}` : '如果任务需要行动，优先调用最合适的工具。',
    '',
    '可用工具：',
    toolList,
  ].join('\n');
  const normalized = messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: `<tool_result call_id="${m.tool_call_id || ''}">\n${m.content || ''}\n</tool_result>`,
      };
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const invocations = m.tool_calls.map((tc) => {
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        const params = Object.entries(args).map(([k, v]) => {
          const value = typeof v === 'string' ? v : JSON.stringify(v);
          return `<parameter name="${k}">${value}</parameter>`;
        }).join('\n');
        return `<invoke name="${tc.function?.name || ''}">\n${params}\n</invoke>`;
      }).join('\n');
      return { role: 'assistant', content: [m.content, invocations].filter(Boolean).join('\n') || invocations };
    }
    return { role: m.role, content: m.content || '' };
  });
  const [first, ...rest] = normalized;
  if (first?.role === 'system') {
    return [{ ...first, content: `${first.content}\n\n<text_tool_protocol>\n${instruction}\n</text_tool_protocol>` }, ...rest];
  }
  return [{ role: 'system', content: `<text_tool_protocol>\n${instruction}\n</text_tool_protocol>` }, ...messages];
}

function parseScalar(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.parse(s); } catch {}
  }
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

function extractThinkBlocks(text) {
  const thinks = [];
  const content = String(text || '').replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_, inner) => {
    if (inner && inner.trim()) thinks.push(inner.trim());
    return '';
  }).trim();
  return { content, reasoning: thinks.join('\n\n') };
}

function parseLegacyToolCallBody(body, parseParams) {
  const strict = /<function=([a-zA-Z0-9_-]+)\s*>([\s\S]*?)<\/function>/i.exec(body);
  if (strict) {
    return { name: strict[1], args: parseParams(strict[2]) };
  }
  const loose = /<function=([a-zA-Z0-9_-]+)\s*>([\s\S]*)$/i.exec(body);
  if (loose) {
    return { name: loose[1], args: parseParams(loose[2]) };
  }
  return null;
}

export function parseTextToolCalls(text) {
  const calls = [];
  const parseParams = (body) => {
    const args = {};
    const paramRe = /<parameter(?:\s+name=["']([^"']+)["']|=([a-zA-Z0-9_-]+))\s*>([\s\S]*?)<\/parameter>/gi;
    let p;
    while ((p = paramRe.exec(body))) {
      args[p[1] || p[2]] = parseScalar(p[3]);
    }
    return args;
  };
  const invokeRe = /<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi;
  let cleaned = text;
  let match;
  while ((match = invokeRe.exec(text))) {
    const [, name, body] = match;
    const args = parseParams(body);
    calls.push({
      id: `call_text_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    });
    cleaned = cleaned.replace(match[0], '').trim();
  }

  const toolCallRe = /<tool_call\s*>([\s\S]*?)(?:<\/tool_call>|<\/invoke>)/gi;
  while ((match = toolCallRe.exec(text))) {
    const [, body] = match;
    const parsed = parseLegacyToolCallBody(body, parseParams);
    if (!parsed) continue;
    calls.push({
      id: `call_text_${Math.random().toString(36).slice(2, 10)}`,
      type: 'function',
      function: { name: parsed.name, arguments: JSON.stringify(parsed.args) },
    });
    cleaned = cleaned.replace(match[0], '').trim();
  }
  return { content: cleaned || '', tool_calls: calls };
}

function isParamError(err) {
  if (!err || err.name === 'AbortError') return false;
  if (err.status !== 400) return false;
  const msg = [
    err.message,
    err.error?.message,
    err.response?.data?.error?.message,
    err.code,
  ].filter(Boolean).join(' ').toLowerCase();
  return /param|parameter|unsupported|invalid|不支持|参数/.test(msg);
}

async function createChatStreamWithFallback(client, opts) {
  const { cfg, signal } = opts;
  const protocol = getProtocolProfile();
  const compatTools = opts.tools?.length ? sanitizeToolsForCompat(opts.tools) : opts.tools;
  const useTextProtocol = protocol === 'text_tool_protocol';
  const useCompatTools = useTextProtocol ? [] : (protocol === 'compat_tools' ? compatTools : opts.tools);

  const attempts = [];
  if (protocol === 'native_tools') {
    attempts.push({ label: 'cached native tools', request: buildChatRequest(opts) });
  } else if (protocol === 'compat_tools') {
    attempts.push({ label: 'cached compat tools', request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false }) });
    attempts.push({ label: 'cached compat tools no tool_choice', request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false, includeToolChoice: false }) });
  } else if (protocol === 'text_tool_protocol') {
    attempts.push({
      label: 'cached text tool protocol',
      textToolProtocol: true,
      request: buildChatRequest({
        ...opts,
        messages: buildToolEmulationMessages(opts.messages, opts.tools, opts.toolChoice),
        tools: [],
        includeUsage: false,
        includeToolChoice: false,
        includeTools: false,
      }),
    });
  }

  attempts.push(
    { label: 'standard', request: buildChatRequest({ ...opts, tools: useCompatTools }) },
    { label: 'without stream_options', request: buildChatRequest({ ...opts, tools: useCompatTools, includeUsage: false }) },
    { label: 'without stream_options/tool_choice', request: buildChatRequest({ ...opts, tools: useCompatTools, includeUsage: false, includeToolChoice: false }) },
  );
  if (opts.tools?.length) {
    attempts.push(
      { label: 'compat tool schema', request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false }) },
      { label: 'compat tool schema without tool_choice', request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false, includeToolChoice: false }) },
      {
        label: 'compat tool schema without tools',
        request: buildChatRequest({ ...opts, tools: [], includeUsage: false, includeToolChoice: false, includeTools: false }),
        textToolProtocol: true,
      },
      {
        label: 'text tool protocol',
        textToolProtocol: true,
        request: buildChatRequest({
          ...opts,
          messages: buildToolEmulationMessages(opts.messages, opts.tools, opts.toolChoice),
          tools: [],
          toolChoice: undefined,
          includeUsage: false,
          includeToolChoice: false,
          includeTools: false,
        }),
      },
    );
  }
  if (cfg.max_tokens >= 4096) {
    attempts.push(
      { label: 'without stream_options, max_tokens=4096', request: buildChatRequest({ ...opts, tools: useCompatTools, includeUsage: false, maxTokens: 4096 }) },
      { label: 'without stream_options/tool_choice, max_tokens=4096', request: buildChatRequest({ ...opts, tools: useCompatTools, includeUsage: false, includeToolChoice: false, maxTokens: 4096 }) },
    );
    if (opts.tools?.length) {
      attempts.push({ label: 'compat tool schema, max_tokens=4096, no tool_choice', request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false, includeToolChoice: false, maxTokens: 4096 }) });
    }
  }

  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      if (i > 0) console.warn(`[llm] param fallback → ${attempt.label}`);
      const stream = await withBackoff(() => client.chat.completions.create(attempt.request, signal ? { signal } : undefined), { signal });
      const protocolUsed = attempt.textToolProtocol ? 'text_tool_protocol' : (attempt.request.tools?.length ? (attempt.request.tool_choice ? 'native_tools' : 'compat_tools') : protocol === 'text_tool_protocol' ? 'text_tool_protocol' : null);
      if (protocolUsed) setProtocolProfile(protocolUsed);
      return { stream, textToolProtocol: attempt.textToolProtocol || false };
    } catch (err) {
      lastErr = err;
      if (!isParamError(err) || i === attempts.length - 1) throw err;
      console.warn(`[llm] 400 parameter rejected, retrying without optional params · ${String(err.message || '').slice(0, 160)}`);
    }
  }
  if (lastErr) {
    clearProtocolProfile();
    throw lastErr;
  }
  throw new Error('createChatStreamWithFallback failed');
}

function shouldLogCompatFallback(label) {
  return !String(label || '').includes('cached');
}

      label: 'without stream_options',
      request: buildChatRequest({ ...opts, includeUsage: false }),
    },
    {
      label: 'without stream_options/tool_choice',
      request: buildChatRequest({ ...opts, includeUsage: false, includeToolChoice: false }),
    },
    ...(compatTools?.length ? [
      {
        label: 'compat tool schema',
        request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false }),
      },
      {
        label: 'compat tool schema without tool_choice',
        request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false, includeToolChoice: false }),
      },
      {
        label: 'compat tool schema without tools',
        request: buildChatRequest({ ...opts, tools: [], includeUsage: false, includeToolChoice: false, includeTools: false }),
        textToolProtocol: true,
        emulateTools: true,
      },
    ] : []),
    ...(opts.tools?.length ? [
      {
        label: 'text tool protocol',
        textToolProtocol: true,
        request: buildChatRequest({
          ...opts,
          messages: buildToolEmulationMessages(opts.messages, opts.tools, opts.toolChoice),
          tools: [],
          toolChoice: undefined,
          includeUsage: false,
          includeToolChoice: false,
          includeTools: false,
        }),
      },
    ] : []),
  ];
  if (cfg.max_tokens >= 4096) {
    attempts.push({
      label: 'without stream_options, max_tokens=4096',
      request: buildChatRequest({ ...opts, includeUsage: false, maxTokens: 4096 }),
    });
    if (compatTools?.length) {
      attempts.push({
        label: 'compat tool schema, max_tokens=4096, no tool_choice',
        request: buildChatRequest({ ...opts, tools: compatTools, includeUsage: false, includeToolChoice: false, maxTokens: 4096 }),
      });
      attempts.push({
        label: 'compat tool schema without tools, max_tokens=4096',
        request: buildChatRequest({ ...opts, tools: [], includeUsage: false, includeToolChoice: false, maxTokens: 4096, includeTools: false }),
        textToolProtocol: true,
        emulateTools: true,
      });
    }
  }

  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      if (i > 0) console.warn(`[llm] param fallback → ${attempt.label}`);
      const stream = await withBackoff(() => client.chat.completions.create(
        attempt.request,
        signal ? { signal } : undefined,
      ), { signal });
      return { stream, textToolProtocol: attempt.textToolProtocol || false };
    } catch (err) {
      lastErr = err;
      if (!isParamError(err) || i === attempts.length - 1) throw err;
      console.warn(`[llm] 400 parameter rejected, retrying without optional params · ${String(err.message || '').slice(0, 160)}`);
    }
  }
  throw lastErr;
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
