// 章节正文向量化 · 按段落切块索引
// - 索引路径: chapters/.embeddings/index.json
// - 切分策略: 按空行分段，每段超过 MAX_CHUNK_CHARS 就再按句号切
// - 复用 embeddings.js 的 client / embedTexts / cosine
import fsp from 'node:fs/promises';
import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';
import { parseFrontmatter } from './wiki.js';
import { isEmbedEnabled, embedTexts, embedModel } from './embeddings.js';

const CHAPTER_INDEX_PATH = 'chapters/.embeddings/index.json';
const MAX_CHUNK_CHARS = 600;   // 单块上限
const MIN_CHUNK_CHARS = 80;    // 过短不索引
const MAX_CHAPTER_CHUNKS = 40; // 单章上限防爆

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

/** 简易 hash（非加密）用于判断某块是否变化 */
function quickHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 把章节正文切成小块 */
export function chunkChapterBody(body) {
  const text = String(body || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  // 按空行分段
  const paragraphs = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const para of paragraphs) {
    if (para.length <= MAX_CHUNK_CHARS) {
      out.push(para);
      continue;
    }
    // 超长：按句末（。！？!?）再切，尽量不破坏句子
    const sentences = para.match(/[^。！？!?]+[。！？!?]?/g) || [para];
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > MAX_CHUNK_CHARS && buf.length >= MIN_CHUNK_CHARS) {
        out.push(buf);
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf.trim().length >= MIN_CHUNK_CHARS) out.push(buf.trim());
  }
  return out.slice(0, MAX_CHAPTER_CHUNKS).filter((s) => s.length >= MIN_CHUNK_CHARS);
}

async function readIndex(projectName) {
  const abs = resolveInProject(projectName, CHAPTER_INDEX_PATH);
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
  const abs = resolveInProject(projectName, CHAPTER_INDEX_PATH);
  await writeFileSafe(abs, JSON.stringify(data, null, 2));
}

/**
 * 扫描所有章节文件，对新增/变化的块做 embed。
 * 自动跳过已索引且内容未变的块（按 hash 判断）。
 * @param {string} projectName
 * @param {object} opts  { onlyChapter?: number } 传入章号则只索引该章
 * @returns {Promise<{ok,count,added,skipped,model}>}
 */
export async function rebuildChapterEmbedIndex(projectName, opts = {}) {
  if (!isEmbedEnabled()) {
    return { ok: false, error: '未配置 LLM_EMBED_MODEL', count: 0 };
  }
  const onlyChapter = Number(opts.onlyChapter) || null;
  const model = embedModel();
  const index = await readIndex(projectName);
  if (index.model && index.model !== model) {
    // 换模型：全清
    index.items = [];
  }
  index.model = model;

  const dir = resolveInProject(projectName, 'chapters');
  let entries = [];
  try { entries = await fsp.readdir(dir); } catch { return { ok: true, count: 0, added: 0, skipped: true, model }; }

  const tasks = []; // { relPath, chapter, chunkIndex, text, hash, title }
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    // 章号解析：第N章-标题.md / N.md / chapter-N-...md
    const m = /(?:^第\s*(\d+)\s*章)|(?:^chapter[-_](\d+))|(?:^(\d+)[\-._])/i.exec(f);
    const chapter = Number(m?.[1] || m?.[2] || m?.[3] || 0) || 0;
    if (!chapter) continue;
    if (onlyChapter && chapter !== onlyChapter) continue;
    const rel = `chapters/${f}`;
    const txt = await readFileSafe(resolveInProject(projectName, rel));
    if (!txt) continue;
    const { meta, body } = parseFrontmatter(txt);
    const title = meta.title || '';
    const chunks = chunkChapterBody(body);
    chunks.forEach((c, idx) => {
      tasks.push({
        relPath: rel,
        chapter,
        chunkIndex: idx,
        text: c,
        hash: quickHash(c),
        title,
      });
    });
  }

  // 过滤出已索引且 hash 未变的（精确到 (relPath, chunkIndex, hash) 三元组）
  const oldMap = new Map(index.items.map((it) => [`${it.relPath}#${it.chunkIndex}`, it]));
  const needEmbed = [];
  const reused = [];
  for (const t of tasks) {
    const key = `${t.relPath}#${t.chunkIndex}`;
    const prev = oldMap.get(key);
    if (prev && prev.hash === t.hash && Array.isArray(prev.vec) && prev.vec.length) {
      reused.push(prev);
    } else {
      needEmbed.push(t);
    }
  }

  // 批量 embed
  const BATCH = 32;
  const newItems = [];
  for (let i = 0; i < needEmbed.length; i += BATCH) {
    const slice = needEmbed.slice(i, i + BATCH);
    let vecs;
    try {
      vecs = await embedTexts(slice.map((t) => t.text));
    } catch (e) {
      // 失败不中断，先跳过这批（下次重建会重试）
      continue;
    }
    slice.forEach((t, k) => {
      if (!vecs[k]) return;
      newItems.push({
        relPath: t.relPath,
        chapter: t.chapter,
        chunkIndex: t.chunkIndex,
        title: t.title,
        text: t.text,
        hash: t.hash,
        vec: vecs[k],
        updatedAt: new Date().toISOString(),
      });
    });
  }

  // 合并：只保留当前磁盘上还存在的 item（+ 复用 + 新加）
  const keepKeys = new Set(tasks.map((t) => `${t.relPath}#${t.chunkIndex}`));
  const stillAround = index.items.filter((it) => {
    if (onlyChapter && it.chapter !== onlyChapter) return true; // 没指定章的保留
    return keepKeys.has(`${it.relPath}#${it.chunkIndex}`);
  });
  const byKey = new Map(stillAround.map((it) => [`${it.relPath}#${it.chunkIndex}`, it]));
  for (const item of newItems) {
    byKey.set(`${item.relPath}#${item.chunkIndex}`, item);
  }
  const merged = [...byKey.values()];
  await writeIndex(projectName, { model, items: merged });
  return { ok: true, count: merged.length, added: newItems.length, reused: reused.length, skipped: needEmbed.length === 0, model };
}

/**
 * 章节正文语义搜索。
 * @param {string} projectName
 * @param {string} query
 * @param {number} k
 * @returns {Promise<Array<{chapter,title,chunkIndex,text,score,relPath}>>}
 */
export async function searchChapters(projectName, query, k = 8) {
  if (!isEmbedEnabled()) return [];
  const q = String(query || '').trim();
  if (!q) return [];
  const index = await readIndex(projectName);
  if (!index.items.length) return [];

  let qvec;
  try {
    const [v] = await embedTexts([q]);
    qvec = v;
  } catch {
    return [];
  }

  const scored = index.items.map((it) => ({
    chapter: it.chapter,
    title: it.title,
    chunkIndex: it.chunkIndex,
    text: it.text,
    relPath: it.relPath,
    score: cosine(qvec, it.vec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter((x) => x.score > 0.2);
}
