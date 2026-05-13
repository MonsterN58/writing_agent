import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';

const DEFAULT_SCENE = 'general';
const GOOD_KINDS = new Set(['exemplar_good']);
const BAD_KINDS = new Set(['exemplar_bad']);

export function normalizeSceneType(sceneType) {
  const s = String(sceneType || DEFAULT_SCENE).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || DEFAULT_SCENE;
}

export function polarityFromKind(kind) {
  if (GOOD_KINDS.has(kind)) return 'good';
  if (BAD_KINDS.has(kind)) return 'bad';
  return null;
}

export async function appendExemplar(projectName, payload) {
  const sceneType = normalizeSceneType(payload.sceneType || payload.scene_type || inferSceneType(payload));
  const polarity = payload.polarity || polarityFromKind(payload.kind);
  if (!['good', 'bad'].includes(polarity)) throw new Error(`未知示例极性：${polarity || payload.kind}`);
  const snippet = String(payload.snippet || payload.feedback || '').trim();
  if (snippet.length < 20) throw new Error('示例片段太短，至少需要 20 字');
  const safeSnippet = snippet.length > 1200 ? snippet.slice(0, 1200) + '…' : snippet;
  const relPath = `style/exemplars/${sceneType}-${polarity}.md`;
  const abs = resolveInProject(projectName, relPath);
  const old = (await readFileSafe(abs)) || `# ${sceneType} · ${polarity === 'good' ? '好范本' : '反例'}\n\n`;
  const meta = [
    `<!-- from: ${payload.path || '-'}${payload.chapter ? ` · 第 ${payload.chapter} 章` : ''} · ${new Date().toISOString()} -->`,
    `> ${safeSnippet.replace(/\r?\n/g, '\n> ')}`,
    '',
  ].join('\n');
  await writeFileSafe(abs, old.replace(/\s*$/, '\n\n') + meta);
  return { relPath, bytes: meta.length, sceneType, polarity };
}

export async function loadExemplars(projectName, sceneTypes = [], options = {}) {
  const maxGood = Number(options.maxGood || 2);
  const maxBad = Number(options.maxBad || 1);
  const scenes = [...new Set([...(sceneTypes || []).map(normalizeSceneType), DEFAULT_SCENE])];
  const good = [];
  const bad = [];
  for (const scene of scenes) {
    if (good.length < maxGood) good.push(...await readExamples(projectName, scene, 'good', maxGood - good.length));
    if (bad.length < maxBad) bad.push(...await readExamples(projectName, scene, 'bad', maxBad - bad.length));
  }
  return { good: good.slice(0, maxGood), bad: bad.slice(0, maxBad), scenes };
}

function inferSceneType(payload) {
  const text = `${payload.path || ''}\n${payload.feedback || ''}`;
  if (/打|战|杀|剑|刀|拳|血|action/i.test(text)) return 'action';
  if (/对话|台词|说|问|dialogue/i.test(text)) return 'dialogue';
  if (/结尾|钩子|cliff/i.test(text)) return 'cliffhanger';
  return DEFAULT_SCENE;
}

async function readExamples(projectName, scene, polarity, limit) {
  const relPath = `style/exemplars/${scene}-${polarity}.md`;
  const txt = await readFileSafe(resolveInProject(projectName, relPath));
  if (!txt) return [];
  const chunks = txt.split(/<!--\s*from:[\s\S]*?-->/g).map((x) => x.trim()).filter((x) => /^>\s*/m.test(x));
  return chunks.slice(-Math.max(limit * 3, limit)).reverse().slice(0, limit).map((chunk) => ({
    scene,
    polarity,
    relPath,
    text: stripQuote(chunk).slice(0, 500),
  }));
}

function stripQuote(chunk) {
  return chunk.split(/\r?\n/).map((line) => line.replace(/^>\s?/, '')).join('\n').trim();
}
