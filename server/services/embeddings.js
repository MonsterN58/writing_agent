// 向量化召回 · wiki 条目 embedding
// 说明：
// - 用 OpenAI 兼容 client（走 LLM_BASE_URL + LLM_API_KEY）。
// - Embed 模型由 LLM_EMBED_MODEL 配置；未配置则降级为禁用，wiki_query 只走关键词。
// - 索引存 knowledge/.embeddings/index.json：{ items: [{ slug, relPath, name, text, vec: [...], updatedAt }] }
// - wiki_ingest 完毕后可调 rebuildEmbedIndex 重建。
import OpenAI from 'openai';
import fsp from 'node:fs/promises';
import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';
import { parseFrontmatter } from './wiki.js';
import { getApiKey, getBaseURL, getEmbedModel, onConfigChange } from './llm-config.js';

const INDEX_PATH = 'knowledge/.embeddings/index.json';

let _client = null;
onConfigChange(() => { _client = null; });
function getEmbedClient() {
  if (_client) return _client;
  const apiKey = getApiKey();
  const baseURL = getBaseURL();
  if (!apiKey || !baseURL) throw new Error('缺少 LLM_API_KEY / LLM_BASE_URL');
  _client = new OpenAI({ apiKey, baseURL });
  return _client;
}

export function embedModel() {
  return getEmbedModel();
}

export function isEmbedEnabled() {
  return !!embedModel();
}

/** 把一段文本（或一批）喂给 embed API，返回 vector 数组 */
export async function embedTexts(texts) {
  if (!isEmbedEnabled()) throw new Error('未配置 LLM_EMBED_MODEL，向量化已禁用');
  const client = getEmbedClient();
  const arr = Array.isArray(texts) ? texts : [texts];
  const resp = await client.embeddings.create({
    model: embedModel(),
    input: arr,
  });
  return resp.data.map((d) => d.embedding);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function readIndex(projectName) {
  const abs = resolveInProject(projectName, INDEX_PATH);
  const txt = await readFileSafe(abs);
  if (!txt) return { model: '', items: [] };
  try {
    const obj = JSON.parse(txt);
    return { model: obj.model || '', items: Array.isArray(obj.items) ? obj.items : [] };
  } catch {
    return { model: '', items: [] };
  }
}

async function writeIndex(projectName, data) {
  const abs = resolveInProject(projectName, INDEX_PATH);
  await writeFileSafe(abs, JSON.stringify(data, null, 2));
}

function buildSummaryText(meta, body) {
  const aliases = Array.isArray(meta.aliases) ? meta.aliases.join(' / ') : '';
  const head = [
    meta.name || '',
    aliases,
    meta.type || '',
    meta.faction || '',
    meta.status || '',
  ].filter(Boolean).join(' · ');
  const bodyHead = String(body || '').replace(/\s+/g, ' ').slice(0, 500);
  return `${head}\n${bodyHead}`.trim();
}

/**
 * 扫所有 knowledge/{entities,concepts,locations} 下的 wiki，逐条 embed，写 index。
 * 只做缺失 / 变化的条目（根据 text hash），不改已存在条目。
 * @returns { ok, count, skipped, model }
 */
export async function rebuildEmbedIndex(projectName) {
  if (!isEmbedEnabled()) {
    return { ok: false, error: '未配置 LLM_EMBED_MODEL', count: 0 };
  }
  const model = embedModel();
  const index = await readIndex(projectName);
  // 换了 embed 模型就全重建
  if (index.model && index.model !== model) {
    index.items = [];
  }
  index.model = model;
  const oldMap = new Map(index.items.map((it) => [it.relPath, it]));

  const dirs = ['knowledge/entities', 'knowledge/concepts', 'knowledge/locations'];
  const tasks = [];
  for (const dir of dirs) {
    const abs = resolveInProject(projectName, dir);
    let entries = [];
    try { entries = await fsp.readdir(abs); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.md')) continue;
      const rel = `${dir}/${f}`;
      const txt = await readFileSafe(resolveInProject(projectName, rel));
      if (!txt) continue;
      const { meta, body } = parseFrontmatter(txt);
      const summary = buildSummaryText(meta, body);
      const prev = oldMap.get(rel);
      if (prev && prev.text === summary && Array.isArray(prev.vec) && prev.vec.length) {
        continue; // 未变，跳过
      }
      tasks.push({ rel, slug: meta.id || f.replace(/\.md$/, ''), name: meta.name || '', summary });
    }
  }

  if (!tasks.length) {
    await writeIndex(projectName, index);
    return { ok: true, count: index.items.length, skipped: true, model };
  }

  // 分批 embed（大部分 API 单批 <= 64）
  const BATCH = 32;
  const newItems = [];
  for (let i = 0; i < tasks.length; i += BATCH) {
    const slice = tasks.slice(i, i + BATCH);
    const vecs = await embedTexts(slice.map((t) => t.summary));
    slice.forEach((t, k) => {
      newItems.push({
        relPath: t.rel,
        slug: t.slug,
        name: t.name,
        text: t.summary,
        vec: vecs[k],
        updatedAt: new Date().toISOString(),
      });
    });
  }

  // 合并：已有但未变的保留，变了的覆盖，新的追加，旧的不在磁盘上了就删
  const keep = [];
  for (const it of index.items) {
    const still = tasks.find((t) => t.rel === it.relPath);
    if (!still) keep.push(it); // 没变
  }
  const merged = [...keep, ...newItems];
  await writeIndex(projectName, { model, items: merged });
  return { ok: true, count: merged.length, added: newItems.length, model };
}

/**
 * 对关键词做 embed，返回 Top-K 最近邻 relPath 列表。
 * 关键词空、索引空、未启用 embed → 返回 []。
 */
export async function vectorSearch(projectName, keywords, k = 8) {
  if (!isEmbedEnabled()) return [];
  const kws = (keywords || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!kws.length) return [];
  const index = await readIndex(projectName);
  if (!index.items.length) return [];

  let qvec;
  try {
    const [v] = await embedTexts([kws.join(' ')]);
    qvec = v;
  } catch (e) {
    // 静默降级为空（调用方会退回到关键词匹配）
    return [];
  }
  const scored = index.items.map((it) => ({
    relPath: it.relPath,
    slug: it.slug,
    name: it.name,
    score: cosine(qvec, it.vec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter((x) => x.score > 0.2);
}
