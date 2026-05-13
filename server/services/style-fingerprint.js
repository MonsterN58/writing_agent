// 风格指纹：从已写章节统计高频词 / 句长分布 / 比喻密度 / 段落节奏 / AI 味预警
// 落盘到 style/fingerprint.json，写章前注入 system prompt 帮模型保持风格一致。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';
import { parseFrontmatter } from './wiki.js';
import { listChapters } from './chapter-utils.js';

const FINGERPRINT_PATH = 'style/fingerprint.json';

// 中文常用 stopwords（不计入"高频特征词"）
const STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '一', '个',
  '不', '人', '有', '和', '也', '都', '与', '又', '才', '着', '过', '来', '去', '上', '下',
  '到', '从', '把', '被', '让', '吗', '呢', '吧', '啊', '哦', '嗯',
  '说', '想', '看', '是', '却', '就', '便', '正', '即', '若',
  '我们', '你们', '他们', '她们', '自己', '什么', '怎么', '为什么', '可是', '但是', '只是',
  '一个', '一种', '一些', '这种', '那种', '这样', '那样', '如此', '于是',
]);

// AI 味敏感四字词（出现频率高 → AI 味重）
const AI_TONE_PATTERNS = [
  /不可否认/g, /毋庸置疑/g, /显而易见/g, /众所周知/g, /可以说/g, /某种程度上/g,
  /某种意义上/g, /换句话说/g, /值得注意的是/g, /需要指出的是/g, /另一方面/g,
  /综上所述/g, /总的来说/g, /总而言之/g, /从某种角度/g,
];

/** 抽取章节正文的纯文本（去掉 H1 标题与 frontmatter） */
function extractProse(body) {
  const lines = String(body || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^#+\s/.test(t)) continue;             // 标题
    if (/^---/.test(t)) continue;              // hr
    if (/^>\s/.test(t)) continue;              // 引用
    out.push(t);
  }
  return out.join('\n');
}

/** 中文分词：极简版 — 2/3字滑窗 + 去 stopword + 去标点 */
function tokenize(text) {
  const cleaned = String(text || '').replace(/[\s\d，。！？、；：""''「」『』（）()【】《》…—\-·,.?!"':;]/g, ' ');
  const tokens = [];
  // 2-gram + 3-gram
  for (const seg of cleaned.split(/\s+/)) {
    if (!seg) continue;
    for (let i = 0; i < seg.length - 1; i++) {
      const bi = seg.slice(i, i + 2);
      if (!STOPWORDS.has(bi) && /^[\u4e00-\u9fa5]{2}$/.test(bi)) tokens.push(bi);
    }
    for (let i = 0; i < seg.length - 2; i++) {
      const tri = seg.slice(i, i + 3);
      if (!STOPWORDS.has(tri) && /^[\u4e00-\u9fa5]{3}$/.test(tri)) tokens.push(tri);
    }
  }
  return tokens;
}

/** 句长分布（按 。！？!? 切句） */
function sentenceLengths(text) {
  const sents = String(text || '').split(/[。！？!?]/).map((s) => s.trim()).filter(Boolean);
  return sents.map((s) => s.length);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function countMatches(text, patterns) {
  let n = 0;
  for (const p of patterns) {
    p.lastIndex = 0;
    const m = text.match(p);
    if (m) n += m.length;
  }
  return n;
}

/**
 * 重建风格指纹。
 * 取最近 N 章（默认 10）做样本，避免早期生疏稿干扰。
 * @param {string} projectName
 * @param {object} opts { sampleN?: number }
 * @returns {Promise<{ok, fingerprint, chapters}>}
 */
export async function rebuildStyleFingerprint(projectName, opts = {}) {
  if (!projectName) return { ok: false, error: '未激活作品' };
  const sampleN = Number(opts.sampleN) || 10;
  const all = await listChapters(projectName);
  if (!all.length) return { ok: false, error: '尚无章节', fingerprint: null };

  // 取最近 sampleN 章
  const sorted = [...all].sort((a, b) => (b.chapter || 0) - (a.chapter || 0)).slice(0, sampleN);
  const ordered = sorted.sort((a, b) => (a.chapter || 0) - (b.chapter || 0));

  // 聚合统计
  const wordFreq = new Map();
  const sentLens = [];
  const paraLens = [];
  let totalChars = 0;
  let aiToneHits = 0;
  let dialogChars = 0;
  let allText = '';

  for (const c of ordered) {
    const abs = resolveInProject(projectName, c.relPath);
    const txt = await readFileSafe(abs);
    if (!txt) continue;
    const { body } = parseFrontmatter(txt);
    const prose = extractProse(body);
    if (!prose) continue;

    totalChars += prose.length;
    allText += prose + '\n';

    // 段落长度（按空行分段后字符数）
    for (const para of prose.split(/\n{2,}/)) {
      const t = para.trim();
      if (t) paraLens.push(t.length);
    }

    // 句长
    for (const len of sentenceLengths(prose)) sentLens.push(len);

    // 高频词
    for (const tok of tokenize(prose)) {
      wordFreq.set(tok, (wordFreq.get(tok) || 0) + 1);
    }

    // AI 味命中
    aiToneHits += countMatches(prose, AI_TONE_PATTERNS);

    // 对话占比（按引号粗估）
    const dialogs = prose.match(/[""][^""]+[""]/g) || prose.match(/"[^"]+"/g) || [];
    for (const d of dialogs) dialogChars += d.length;
  }

  if (!totalChars) return { ok: false, error: '没有可统计的正文', fingerprint: null };

  // Top 50 高频词（>=3 次）
  const topWords = [...wordFreq.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word, count]) => ({ word, count }));

  const fingerprint = {
    sampleChapters: ordered.map((c) => c.chapter),
    totalChars,
    paragraphs: {
      count: paraLens.length,
      avgLen: Math.round(paraLens.reduce((s, n) => s + n, 0) / Math.max(1, paraLens.length)),
      median: median(paraLens),
    },
    sentences: {
      count: sentLens.length,
      avgLen: Math.round(sentLens.reduce((s, n) => s + n, 0) / Math.max(1, sentLens.length)),
      median: median(sentLens),
      shortRatio: sentLens.filter((n) => n <= 8).length / Math.max(1, sentLens.length),
      longRatio: sentLens.filter((n) => n >= 30).length / Math.max(1, sentLens.length),
    },
    dialogRatio: dialogChars / totalChars,
    aiToneDensity: aiToneHits / (totalChars / 1000), // 每千字 AI 味命中
    topWords,
    builtAt: new Date().toISOString(),
  };

  const abs = resolveInProject(projectName, FINGERPRINT_PATH);
  await writeFileSafe(abs, JSON.stringify(fingerprint, null, 2));
  return { ok: true, fingerprint, chapters: ordered.map((c) => c.chapter) };
}

/** 读取已存指纹（不存在返回 null） */
export async function readStyleFingerprint(projectName) {
  if (!projectName) return null;
  const abs = resolveInProject(projectName, FINGERPRINT_PATH);
  const txt = await readFileSafe(abs);
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

/** 把指纹格式化成注入 system prompt 的 markdown 串 */
export function fingerprintToMd(fp) {
  if (!fp) return null;
  const sentLine = `句长 中位数 ${fp.sentences.median}字 / 均值 ${fp.sentences.avgLen}字（短句率 ${(fp.sentences.shortRatio * 100).toFixed(0)}% · 长句率 ${(fp.sentences.longRatio * 100).toFixed(0)}%）`;
  const paraLine = `段落 中位数 ${fp.paragraphs.avgLen}字 (${fp.paragraphs.count} 段)`;
  const dialogLine = `对话占比 ${(fp.dialogRatio * 100).toFixed(0)}%`;
  const aiLine = `AI 味密度 ${fp.aiToneDensity.toFixed(2)} 次/千字${fp.aiToneDensity > 0.8 ? ' ⚠️ 偏高' : ''}`;
  const wordsLine = fp.topWords.slice(0, 20).map((w) => `${w.word}(${w.count})`).join(' · ');
  return [
    `**节奏指标**：${sentLine} · ${paraLine} · ${dialogLine}`,
    `**风格风险**：${aiLine}`,
    `**当前 TOP20 高频词**（参考，已统计 stopword 除外）：${wordsLine}`,
    `**采样章节**：${fp.sampleChapters.join(' / ')} · **样本字数** ${fp.totalChars.toLocaleString()}`,
  ].join('\n');
}
