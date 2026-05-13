// LLM 运行时配置层
// ------------------------------------------------------------
// 设计目标：
//   - 默认从 .env 读取（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / ...）
//   - 用户可通过前端"LLM 配置"弹窗保存覆盖项到 data/llm-config.json
//   - 覆盖项优先级高于 env；保存后立即失效已缓存的 OpenAI client
//   - 仅本机持久化，data/ 目录不入库
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CONFIG_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_PATH = path.join(CONFIG_DIR, 'llm-config.json');

// 允许写入的 env 风格键名（其它键直接丢弃）
const ALLOWED_KEYS = new Set([
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_MODEL_CHEAP',
  'LLM_MODEL_WRITER',
  'LLM_MODEL_ULTRA',
  'LLM_EMBED_MODEL',
  'LLM_TEMPERATURE',
  'LLM_TEMPERATURE_CHEAP',
  'LLM_TEMPERATURE_WRITER',
  'LLM_TEMPERATURE_ULTRA',
  'LLM_MAX_TOKENS',
  'LLM_MAX_TOKENS_CHEAP',
  'LLM_MAX_TOKENS_WRITER',
  'LLM_MAX_TOKENS_ULTRA',
]);

let _cache = null;
const _listeners = new Set();

function readSync() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (ALLOWED_KEYS.has(k) && v != null && v !== '') out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

function ensureLoaded() {
  if (_cache) return _cache;
  _cache = readSync();
  return _cache;
}

export function getOverrides() {
  return { ...ensureLoaded() };
}

/** 监听配置变化（llm.js / embeddings.js 用来失效 client 缓存） */
export function onConfigChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notifyChange() {
  for (const fn of _listeners) {
    try { fn(); } catch {}
  }
}

/** 保存覆盖配置（patch 形式合并；空串/null 视为"删除该键，回退到 env"） */
export async function saveOverrides(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('patch 必须是对象');
  const cur = { ...ensureLoaded() };
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (v == null || v === '') {
      delete cur[k];
    } else {
      cur[k] = String(v).trim();
    }
  }
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(cur, null, 2), 'utf8');
  _cache = cur;
  notifyChange();
  return cur;
}

// ------------------------------------------------------------
// 统一取值 helper：覆盖项 > env
// ------------------------------------------------------------
function pick(key) {
  const o = ensureLoaded();
  if (o[key] != null && o[key] !== '') return o[key];
  const v = process.env[key];
  return v != null && v !== '' ? v : undefined;
}

export function getApiKey() { return pick('LLM_API_KEY') || ''; }
export function getBaseURL() { return pick('LLM_BASE_URL') || ''; }
export function getEmbedModel() { return pick('LLM_EMBED_MODEL') || ''; }

export function getModel(profile = 'default') {
  const byProfile = {
    cheap: pick('LLM_MODEL_CHEAP'),
    writer: pick('LLM_MODEL_WRITER'),
    ultra: pick('LLM_MODEL_ULTRA'),
    default: pick('LLM_MODEL'),
  };
  return byProfile[profile] || pick('LLM_MODEL') || 'deepseek-chat';
}

export function getTemperature(profile = 'default') {
  const byProfile = {
    cheap: pick('LLM_TEMPERATURE_CHEAP'),
    writer: pick('LLM_TEMPERATURE_WRITER'),
    ultra: pick('LLM_TEMPERATURE_ULTRA'),
  };
  const raw = byProfile[profile] ?? pick('LLM_TEMPERATURE') ?? 0.8;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0.8;
}

export function getMaxTokens(profile = 'default') {
  const byProfile = {
    cheap: pick('LLM_MAX_TOKENS_CHEAP'),
    writer: pick('LLM_MAX_TOKENS_WRITER'),
    ultra: pick('LLM_MAX_TOKENS_ULTRA'),
  };
  const raw = byProfile[profile] ?? pick('LLM_MAX_TOKENS');
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

/** 给前端展示用：脱敏的当前生效配置 + 来源标记 */
export function getEffectiveConfig() {
  const overrides = ensureLoaded();
  const source = (k) => {
    if (overrides[k] != null && overrides[k] !== '') return 'override';
    if (process.env[k] != null && process.env[k] !== '') return 'env';
    return 'none';
  };
  const apiKey = getApiKey();
  return {
    apiKey: '',                 // 永远不回传明文
    apiKeyMasked: maskKey(apiKey),
    hasKey: !!apiKey,
    baseUrl: getBaseURL(),
    embedModel: getEmbedModel(),
    model: getModel('default'),
    modelCheap: getModel('cheap'),
    modelWriter: getModel('writer'),
    modelUltra: getModel('ultra'),
    temperature: getTemperature('default'),
    temperatureCheap: getTemperature('cheap'),
    temperatureWriter: getTemperature('writer'),
    temperatureUltra: getTemperature('ultra'),
    maxTokens: getMaxTokens('default'),
    maxTokensCheap: getMaxTokens('cheap'),
    maxTokensWriter: getMaxTokens('writer'),
    maxTokensUltra: getMaxTokens('ultra'),
    sources: Object.fromEntries([...ALLOWED_KEYS].map((k) => [k, source(k)])),
    overrideKeys: Object.keys(overrides),
    configPath: path.relative(process.cwd(), CONFIG_PATH).replace(/\\/g, '/'),
  };
}

/** 前端使用的 camelCase patch → env 风格键 */
export function patchFromCamel(input = {}) {
  const map = {
    apiKey: 'LLM_API_KEY',
    baseUrl: 'LLM_BASE_URL',
    model: 'LLM_MODEL',
    modelCheap: 'LLM_MODEL_CHEAP',
    modelWriter: 'LLM_MODEL_WRITER',
    modelUltra: 'LLM_MODEL_ULTRA',
    embedModel: 'LLM_EMBED_MODEL',
    temperature: 'LLM_TEMPERATURE',
    temperatureCheap: 'LLM_TEMPERATURE_CHEAP',
    temperatureWriter: 'LLM_TEMPERATURE_WRITER',
    temperatureUltra: 'LLM_TEMPERATURE_ULTRA',
    maxTokens: 'LLM_MAX_TOKENS',
    maxTokensCheap: 'LLM_MAX_TOKENS_CHEAP',
    maxTokensWriter: 'LLM_MAX_TOKENS_WRITER',
    maxTokensUltra: 'LLM_MAX_TOKENS_ULTRA',
  };
  const out = {};
  for (const [camel, envKey] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(input, camel)) {
      out[envKey] = input[camel];
    }
  }
  return out;
}
