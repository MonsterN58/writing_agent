import path from 'node:path';
import fsp from 'node:fs/promises';
import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';
import { listChapters } from './chapter-utils.js';
import {
  listOpenForeshadows,
  loadLatestStateSnapshot,
  loadRecentLog,
  loadCharacterStates,
  loadWorldRulesSummary,
} from './wiki.js';
import { loadExemplars } from './exemplars.js';
import { lookupQuery } from './lookup.js';
import { parseFrontmatter } from './frontmatter.js';

const AI_PATTERNS = [
  '心潮澎湃', '热血沸腾', '波澜壮阔', '璀璨夺目', '瑰丽', '绚烂',
  '复杂的情感', '涌起一股', '心中一震', '命运的齿轮', '前所未有',
  '不由得', '深吸一口气', '眼神坚定', '仿佛整个世界', '正能量',
];

export function countWords(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = (s.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return cjk + latinWords;
}

export function lastText(text, maxChars = 600) {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;
  return s.slice(-maxChars);
}

export async function getChapterContext(projectName, chapter, options = {}) {
  const n = Number(chapter);
  const cuts = contextCutsForChapter(n);
  const maxEndingChars = Number(options.maxEndingChars || 600);
  const chapters = await listChapters(projectName);
  const prev = chapters.find((c) => c.chapter === n - 1) || null;
  let prevEnding = '';
  if (prev) {
    const txt = await readFileSafe(resolveInProject(projectName, `chapters/${prev.file}`));
    prevEnding = lastText(txt || '', maxEndingChars);
  }

  const outlinePath = `outline/chapters/chapter-${n}.md`;
  const outline = await readFileSafe(resolveInProject(projectName, outlinePath));
  const voice = await readFileSafe(resolveInProject(projectName, 'style/voice.md'));
  const voiceDict = await readFileSafe(resolveInProject(projectName, 'style/voice-dict.md'));
  const preRead = await readFileSafe(resolveInProject(projectName, 'progress/pre-read.md'));
  const feedback = await readFileSafe(resolveInProject(projectName, 'style/feedback.md'));
  const sceneTypes = extractSceneTypes(outline || '');
  let exemplars = { good: [], bad: [], scenes: [] };
  try { exemplars = await loadExemplars(projectName, sceneTypes); } catch { exemplars = { good: [], bad: [], scenes: [] }; }

  // ============ Canon Pack：本章所需事实底座 ============
  // 1) 最近 6 章摘要（知识/log.md）。比 prevEnding 更有用，因为压缩过。
  let recentLog = [];
  try { recentLog = cuts.recentLogN > 0 ? await loadRecentLog(projectName, cuts.recentLogN) : []; } catch { recentLog = []; }

  // 2) 主要人物当前状态（status / location / motivation / inventory）
  let characterStates = [];
  try { characterStates = await loadCharacterStates(projectName, 8); } catch { characterStates = []; }

  // 3) open 伏笔清单（本章可选地回收 / 必须记得它们存在）
  let openForeshadows = [];
  try { openForeshadows = cuts.skipOpenForeshadows ? [] : await listOpenForeshadows(projectName); } catch { openForeshadows = []; }

  // 4) 世界硬约束（规则 + 力量体系头部）
  let worldRules = '';
  try { worldRules = await loadWorldRulesSummary(projectName); } catch { worldRules = ''; }

  // 5) 主角/场景的上章末状态快照（progress/state.json.snapshot）
  let stateSnapshot = null;
  try { stateSnapshot = cuts.skipStateSnapshot ? null : await loadLatestStateSnapshot(projectName); } catch { stateSnapshot = null; }

  // 6) arc 段：当前章号 N 所属的 arc 文件，切出第 N 章那一段
  let arcContext = null;
  try { arcContext = await loadArcChapterSection(projectName, n); } catch { arcContext = null; }

  let relevantPaths = [];
  try {
    const signals = extractLookupSignals(outline || '', sceneTypes, characterStates);
    relevantPaths = (await lookupQuery(projectName, { ...signals, limit: cuts.relevantPathsMax })).paths;
  } catch { relevantPaths = []; }

  const voiceDictParsed = voiceDict ? parseFrontmatter(voiceDict) : { data: {}, body: '' };
  const trimmedVoice = voice ? trimForContext(voice, cuts.voiceMax) : '';
  const trimmedVoiceDict = voiceDict ? trimForContext(voiceDictParsed.body || voiceDict, cuts.voiceDictMax) : '';
  const trimmedPreRead = preRead && !cuts.skipPreRead ? trimForContext(preRead, cuts.preReadMax) : '';
  const trimmedFeedback = feedback && !cuts.skipRecentFeedback ? lastFeedback(feedback, cuts.feedbackMax) : '';

  const injectionStats = {
    outline: outline ? trimForContext(outline, 5000).length : 0,
    voice: trimmedVoice.length,
    voiceDict: trimmedVoiceDict.length,
    preRead: trimmedPreRead.length,
    recentFeedback: trimmedFeedback.length,
    recentLog: recentLog.join('\n\n').length,
    characterStates: JSON.stringify(characterStates || []).length,
    openForeshadows: JSON.stringify(openForeshadows || []).length,
    worldRules: worldRules.length,
    stateSnapshot: stateSnapshot ? JSON.stringify(stateSnapshot).length : 0,
    arcContext: arcContext?.chapterSection?.length || 0,
    relevantPaths: JSON.stringify(relevantPaths || []).length,
  };

  return {
    chapter: n,
    prevChapter: prev ? { chapter: prev.chapter, title: prev.title, file: prev.file } : null,
    prevEnding,
    prevEndingChars: prevEnding.length,
    outlinePath,
    outlineExists: outline != null,
    outline: outline ? trimForContext(outline, 5000) : '',
    voiceExists: voice != null,
    voice: trimmedVoice,
    voiceDictExists: voiceDict != null,
    voiceDict: trimmedVoiceDict,
    voiceDictMeta: voiceDictParsed.data || {},
    preReadExists: preRead != null,
    preRead: trimmedPreRead,
    feedbackExists: feedback != null,
    recentFeedback: trimmedFeedback,
    sceneTypes,
    exemplars,
    // --- canon pack ---
    recentLog,
    recentLogCount: recentLog.length,
    characterStates,
    openForeshadows,
    openForeshadowCount: openForeshadows.length,
    worldRules,
    worldRulesChars: worldRules.length,
    stateSnapshot,
    arcContext,
    relevantPaths,
    contextCuts: cuts,
    injectionStats,
    canonNote: '以上 recentLog / characterStates / openForeshadows / worldRules / stateSnapshot / arcContext 为 canon 事实底座，写本章前逐项校对，不得违反。',
  };
}

export function contextCutsForChapter(chapter) {
  const ch = Number(chapter) || 0;
  if (ch <= 5) {
    return {
      skipRecentLog: true,
      skipStateSnapshot: true,
      skipOpenForeshadows: true,
      skipPreRead: false,
      skipRecentFeedback: false,
      preReadMax: 2000,
      voiceMax: 1200,
      voiceDictMax: 1500,
      feedbackMax: 1200,
      relevantPathsMax: 12,
      recentLogN: 0,
    };
  }
  if (ch <= 30) {
    return {
      skipRecentLog: false,
      skipStateSnapshot: false,
      skipOpenForeshadows: false,
      skipPreRead: false,
      skipRecentFeedback: false,
      preReadMax: 1500,
      voiceMax: 1200,
      voiceDictMax: 1500,
      feedbackMax: 1600,
      relevantPathsMax: 12,
      recentLogN: 6,
    };
  }
  if (ch <= 100) {
    return {
      skipRecentLog: false,
      skipStateSnapshot: false,
      skipOpenForeshadows: false,
      skipPreRead: false,
      skipRecentFeedback: false,
      preReadMax: 500,
      voiceMax: 1200,
      voiceDictMax: 1500,
      feedbackMax: 1200,
      relevantPathsMax: 8,
      recentLogN: 5,
    };
  }
  return {
    skipRecentLog: false,
    skipStateSnapshot: false,
    skipOpenForeshadows: false,
    skipPreRead: true,
    skipRecentFeedback: false,
    preReadMax: 0,
    voiceMax: 1200,
    voiceDictMax: 1500,
    feedbackMax: 1000,
    relevantPathsMax: 6,
    recentLogN: 3,
  };
}

export async function appendInjectionStats(projectName, chapter, payload = {}) {
  if (!projectName || !payload?.injectionStats) return null;
  const relPath = 'progress/injection-stats.jsonl';
  const abs = resolveInProject(projectName, relPath);
  const old = (await readFileSafe(abs)) || '';
  const record = {
    ts: new Date().toISOString(),
    chapter: Number(chapter) || null,
    cuts: payload.contextCuts || null,
    stats: payload.injectionStats,
  };
  await writeFileSafe(abs, old + JSON.stringify(record) + '\n');
  return relPath;
}

/**
 * P0-2 · 加载当前章号 N 所属的 arc 文件并切出第 N 章那一段。
 *
 * arc 文件命名格式：`arc-<M>-章<SSS>-<EEE>.md`，从文件名提取 [SSS, EEE]。
 * 内容按 `### 第 N 章` 切片，到下一个 `### 第 ` 或文件末尾。
 *
 * 同时识别 `[机动·待定]` / `[机动]` 标记，让下游知道是不是软位章。
 *
 * @returns {object|null} { arcFile, arcRange:[SSS,EEE], arcTitle, chapterSection, isMobile }
 */
async function loadArcChapterSection(projectName, chapter) {
  const n = Number(chapter);
  if (!n) return null;

  let entries;
  try {
    const dir = resolveInProject(projectName, 'outline/arcs');
    entries = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const arcFiles = entries
    .filter((x) => x.endsWith('.md'))
    .map((file) => {
      const m = /^arc-(\d+)-章(\d+)-(\d+)\.md$/i.exec(file);
      if (!m) return null;
      return { file, arc: Number(m[1]), from: Number(m[2]), to: Number(m[3]) };
    })
    .filter(Boolean);

  // 找包含当前章号 N 的 arc
  const hit = arcFiles.find((x) => n >= x.from && n <= x.to);
  if (!hit) return null;

  const arcText = await readFileSafe(resolveInProject(projectName, `outline/arcs/${hit.file}`));
  if (!arcText) return null;

  // 抽 arc 标题（第一行 # 后的内容）
  const titleMatch = /^#\s+(.+)$/m.exec(arcText);
  const arcTitle = titleMatch ? titleMatch[1].trim() : '';

  // 按 `### 第 N 章` 切出对应章那一段
  // 不能用 \b 做边界（CJK 字符不构成 ASCII word boundary）。改成捕获章号再做数值比对。
  const lines = arcText.split(/\r?\n/);
  const headerRe = /^###\s+第\s*(\d+)\s*章/;
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const m = headerRe.exec(lines[i]);
    if (!m) continue;
    const ch = Number(m[1]);
    if (start < 0 && ch === n) {
      start = i;
    } else if (start >= 0 && ch !== n) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;

  const chapterSection = lines.slice(start, end).join('\n').trim();
  const mobileCount = (arcText.match(/\[机动[·•]?待定\]|\[机动\]/g) || []).length;
  const isMobile = /\[机动[·•]?待定\]|\[机动\]/.test(chapterSection);

  const base = {
    arcFile: hit.file,
    arcNumber: hit.arc,
    arcRange: [hit.from, hit.to],
    arcTitle,
    chapterSection,
    chapterSectionChars: chapterSection.length,
    isMobile,
    mobileCount,
    warning: mobileCount >= 2 ? `本 arc 含 ${mobileCount} 个机动章，可能脱离 5 章骨架` : null,
  };
  return await mergeArcDecision(projectName, n, base);
}

async function mergeArcDecision(projectName, chapter, base) {
  const txt = await readFileSafe(resolveInProject(projectName, 'progress/arc-decisions.md'));
  if (!txt || !base) return base;
  const re = new RegExp(`^##\\s+第\\s*${Number(chapter)}\\s*章[\\s\\S]*?(?=^##\\s+第\\s*\\d+\\s*章|$(?![\\s\\S]))`, 'm');
  const m = re.exec(txt);
  if (!m) return base;
  const section = m[0].trim();
  const resolved = pickDecisionField(section, '已敲定');
  const deferred = /state\s*:\s*deferred|状态\s*[：:]\s*deferred|暂缓/.test(section);
  if (!resolved && !deferred) return base;
  const beats = pickDecisionField(section, 'scene_beats') || pickDecisionField(section, '场景节拍') || '';
  const decisionText = [
    deferred
      ? '⚠️ 机动章决议：暂缓敲定（deferred），本章仍按候选范围规划。'
      : `✅ 机动章决议：已敲定为「${resolved}」。`,
    beats ? `- 场景节拍：${beats}` : '',
    '',
    '（以下为原 arc 候选，仅作历史参考）',
    base.chapterSection,
  ].filter((x) => x != null).join('\n');
  return {
    ...base,
    chapterSection: decisionText,
    chapterSectionChars: decisionText.length,
    isMobile: deferred ? base.isMobile : false,
    decision: { resolved: resolved || null, deferred, beats },
  };
}

function pickDecisionField(section, label) {
  const esc = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`[-*]\\s*\\*\\*${esc}\\*\\*\\s*[：:]\\s*([^\\n]+)|[-*]\\s*${esc}\\s*[：:]\\s*([^\\n]+)`);
  const m = re.exec(section || '');
  return (m?.[1] || m?.[2] || '').trim();
}

function extractSceneTypes(outline) {
  const txt = String(outline || '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
  if (fm) {
    const line = fm[1].split(/\r?\n/).find((x) => /^scene_types\s*:/.test(x.trim()));
    if (line) {
      const raw = line.split(':').slice(1).join(':').trim();
      if (raw.startsWith('[') && raw.endsWith(']')) {
        return raw.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      }
      return raw.split(/[，,|]/).map((x) => x.trim()).filter(Boolean);
    }
  }
  const found = [];
  if (/打斗|战斗|追杀|交手|刀|剑|拳|血/.test(txt)) found.push('action');
  if (/对话|谈判|争吵|问答|对白|台词/.test(txt)) found.push('dialogue');
  if (/独白|心理|回忆|自省/.test(txt)) found.push('introspection');
  if (/结尾|钩子|悬念|反转/.test(txt)) found.push('cliffhanger');
  return [...new Set(found)];
}

function extractLookupSignals(outline, sceneTypes, characterStates) {
  const text = String(outline || '');
  const characters = [];
  const m = /(出场人物|人物|角色)\s*[:：]\s*([^\n]+)/.exec(text);
  if (m) characters.push(...m[2].split(/[、,，/|]/).map((x) => x.trim()).filter(Boolean));
  for (const c of characterStates || []) {
    if (c?.name && text.includes(c.name)) characters.push(c.name);
  }
  const keywords = [...new Set((text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || [])
    .filter((x) => !/^(本章|场景|人物|出场|目标|冲突|节拍|禁止|事项)$/.test(x))
    .slice(0, 30))];
  return { scenes: sceneTypes || [], characters: [...new Set(characters)], keywords };
}

// 段间过渡词：时间 / 地点 / 视角 / 因果
const TRANSITION_TIME = /(次日|翌日|第二天|第三天|三日后|数日后|半个时辰|一个时辰|两个时辰|一刻钟|半晌|片刻|少顷|不久|稍后|入夜|天亮|清晨|黄昏|夜深|傍晚|午时|子时|寅时|卯时|过了|不多时|约莫)/;
const TRANSITION_PLACE = /(回到|来到|走出|走入|步入|行至|抵达|穿过|出了|进了|来至|推开|跨过|登上|下了|赶到|奔向)/;
const TRANSITION_POV = /(另一边|与此同时|此刻|这时|镜头|远在|百里之外|城外|城中|宫中|府中|庭院|屋内|屋外|远处|近处)/;
const TRANSITION_CAUSE = /(直到|在此之前|此前|当|正当|话说|且说|话分两头)/;
const TRANSITION_RE = new RegExp(
  `${TRANSITION_TIME.source}|${TRANSITION_PLACE.source}|${TRANSITION_POV.source}|${TRANSITION_CAUSE.source}`
);

/**
 * 段际/章际过渡分析（确定性、零 LLM）。
 * @param {object} opts
 *   - content:    本章正文
 *   - prevEnding: 上一章末若干字（无则视为第 1 章，inter.strong=true 自动通过）
 *   - anchors:    硬锚点候选（人名/地点等），用于 inter 检查
 */
export function analyzeTransitions({ content, prevEnding = '', anchors = [] } = {}) {
  const text = String(content || '');
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // ---- 段际：每个段间空行视为潜在场景边界 ----
  const breakCount = Math.max(0, paragraphs.length - 1);
  let bridgedBreaks = 0;
  const weakBreakSamples = [];
  for (let i = 1; i < paragraphs.length; i++) {
    const head = paragraphs[i].slice(0, 60);
    const tail = paragraphs[i - 1].slice(-60);
    const bridged = TRANSITION_RE.test(head) || TRANSITION_RE.test(tail);
    if (bridged) {
      bridgedBreaks++;
    } else if (weakBreakSamples.length < 3) {
      // 段首 30 字，给用户一眼看出是哪儿硬切
      weakBreakSamples.push(paragraphs[i].slice(0, 30));
    }
  }
  const bridgeRatio = breakCount > 0 ? bridgedBreaks / breakCount : 1;

  // ---- 章际：章首 250 字 是否锚住上章末尾 200 字 ----
  const opening = text.slice(0, 250);
  const prevTail = String(prevEnding || '').slice(-200);
  let inter;
  if (!prevTail) {
    inter = { hasPrev: false, hardAnchorsHit: [], bigramOverlap: 0, strong: true };
  } else {
    const hardAnchorsHit = [];
    const seen = new Set();
    for (const raw of anchors || []) {
      const a = String(raw || '').trim();
      if (!a || a.length < 2 || seen.has(a)) continue;
      seen.add(a);
      if (opening.includes(a) && prevTail.includes(a)) hardAnchorsHit.push(a);
    }
    // 中文 2-gram overlap 兜底
    const bigrams = new Set();
    for (let i = 0; i < prevTail.length - 1; i++) {
      const b = prevTail.slice(i, i + 2);
      if (/^[\u4e00-\u9fa5]{2}$/.test(b)) bigrams.add(b);
    }
    let bigramOverlap = 0;
    for (let i = 0; i < opening.length - 1; i++) {
      const b = opening.slice(i, i + 2);
      if (/^[\u4e00-\u9fa5]{2}$/.test(b) && bigrams.has(b)) bigramOverlap++;
    }
    inter = {
      hasPrev: true,
      hardAnchorsHit,
      bigramOverlap,
      // 强衔接：硬锚点≥1 或 bigram overlap≥3
      strong: hardAnchorsHit.length > 0 || bigramOverlap >= 3,
    };
  }

  return {
    intra: {
      paragraphCount: paragraphs.length,
      breakCount,
      bridgedBreaks,
      bridgeRatio: Math.round(bridgeRatio * 100) / 100,
      weakBreakSamples,
    },
    inter,
  };
}

export function scoreChapterContent({ content, chapter, title, prevEnding = '', anchors = [] }) {
  const text = String(content || '');
  const wordCount = countWords(text);
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const opening = text.slice(0, 500);
  const ending = text.slice(-500);
  const dialogueCount = (text.match(/[“"「『][^”"」』]{1,120}[”"」』]/g) || []).length;
  const aiHits = AI_PATTERNS.filter((p) => text.includes(p));
  const dashCount = (text.match(/[—]{1,2}/g) || []).length;
  const sensoryCount = (text.match(/看见|听见|闻到|触到|冷|热|疼|涩|腥|尘|雨|风|血|汗|木|铁|火|灯/g) || []).length;
  const hookSignals = /[？?！!]|竟|忽然|却见|门外|身后|来人|血|信|玉佩|令牌|名字|真相|秘密|死|醒/.test(ending);
  const sceneSignals = (text.match(/片刻|这时|门外|院中|街上|夜里|天亮|回到|转身|忽然|随后|半晌/g) || []).length;

  // 段际/章际衔接分析（确定性）
  const transitions = analyzeTransitions({ content: text, prevEnding, anchors });
  const transitionScore = clampScore(
    60
    + Math.round((transitions.intra.bridgeRatio - 0.5) * 50)  // 50% 桥接率为基线
    + (transitions.inter.hasPrev ? (transitions.inter.strong ? 25 : -25) : 0)
  );

  const dimensions = {
    opening_hook: clampScore(60 + (/[？?！!]|血|死|门外|身后|忽然|却见|砰|喊|哭|笑|冷/.test(opening) ? 25 : 0) + (opening.length > 150 ? 10 : 0)),
    scene_logic: clampScore(55 + Math.min(sceneSignals * 4, 25) + (paragraphs.length >= 8 ? 10 : 0)),
    dialogue_voice: clampScore(50 + Math.min(dialogueCount * 5, 30) - (dialogueCount === 0 ? 15 : 0)),
    anti_ai: clampScore(92 - aiHits.length * 8 - Math.max(0, dashCount - 3) * 4),
    consistency_proxy: clampScore(72 + (wordCount >= 1200 ? 8 : 0) + (wordCount >= 2200 ? 5 : 0)),
    ending_hook: clampScore(55 + (hookSignals ? 30 : 0) + (ending.length > 180 ? 5 : 0)),
    transition: transitionScore,
  };
  const total = Math.round(Object.values(dimensions).reduce((a, b) => a + b, 0) / Object.keys(dimensions).length);

  const issues = [];
  if (wordCount < 1200) issues.push('正文偏短，可能没有完成完整场景链。');
  if (aiHits.length) issues.push(`AI 味高频词：${aiHits.slice(0, 8).join('、')}`);
  if (dashCount > 6) issues.push(`破折号偏多（${dashCount} 处），容易显得像 ChatGPT 串场。`);
  if (dialogueCount < 3) issues.push('对白较少，人物声音可能不够鲜活。');
  if (!hookSignals) issues.push('章末钩子不够明确，读者继续阅读动力偏弱。');
  if (sensoryCount < 5) issues.push('感官细节较少，画面感可能偏虚。');
  // 衔接相关 issue
  if (transitions.intra.breakCount >= 3 && transitions.intra.bridgeRatio < 0.5) {
    const samples = transitions.intra.weakBreakSamples.length
      ? `（如：${transitions.intra.weakBreakSamples.map((s) => `「${s}…」`).join('、')}）`
      : '';
    issues.push(`段际硬切：${transitions.intra.breakCount} 处段间空行中只有 ${transitions.intra.bridgedBreaks} 处带过渡信号${samples}。`);
  }
  if (transitions.inter.hasPrev && !transitions.inter.strong) {
    issues.push('章际硬切：本章开篇 250 字与上一章末尾既无人物/地点锚点，也缺少明显的过渡词或场景延续，读者会感到跳跃。');
  }

  return {
    chapter: Number(chapter || 0) || null,
    title: title || '',
    wordCount,
    total,
    dimensions,
    issues,
    aiHits,
    dashCount,
    dialogueCount,
    sensoryCount,
    transitions,
  };
}

export async function writeChapterScore(projectName, score) {
  const ch = score.chapter || 'unknown';
  const relPath = `reviews/scores/chapter-${ch}.md`;
  const lines = [
    `# 第 ${ch} 章质量评分${score.title ? ` · ${score.title}` : ''}`,
    '',
    `- 总分：**${score.total}/100**`,
    `- 字数：${score.wordCount}`,
    `- AI 味命中：${score.aiHits?.length || 0}`,
    `- 破折号：${score.dashCount || 0}`,
    `- 对白句：${score.dialogueCount || 0}`,
    '',
    '## 维度',
    '',
    '| 维度 | 分数 |',
    '|---|---:|',
    `| 开头钩子 | ${score.dimensions.opening_hook} |`,
    `| 场景逻辑 | ${score.dimensions.scene_logic} |`,
    `| 人物对白 | ${score.dimensions.dialogue_voice} |`,
    `| 反 AI 味 | ${score.dimensions.anti_ai} |`,
    `| 设定一致性代理 | ${score.dimensions.consistency_proxy} |`,
    `| 章末钩子 | ${score.dimensions.ending_hook} |`,
    `| 段际/章际衔接 | ${score.dimensions.transition ?? '-'} |`,
    '',
    '## 问题',
    '',
    ...(score.issues?.length ? score.issues.map((x) => `- ${x}`) : ['（未发现明显问题）']),
    '',
  ];
  await writeFileSafe(resolveInProject(projectName, relPath), lines.join('\n'));
  return relPath;
}

export async function appendFeedback(projectName, payload) {
  const relPath = 'style/feedback.md';
  const abs = resolveInProject(projectName, relPath);
  const old = (await readFileSafe(abs)) || '# 用户反馈闭环\n\n';
  const entry = [
    `## ${new Date().toISOString()}${payload.chapter ? ` · 第 ${payload.chapter} 章` : ''}`,
    '',
    `- 类型：${payload.kind || 'custom'}`,
    payload.path ? `- 文件：${payload.path}` : null,
    '',
    String(payload.feedback || '').trim(),
    '',
  ].filter((x) => x != null).join('\n');
  await writeFileSafe(abs, old + entry);
  return { relPath, bytes: entry.length };
}

function trimForContext(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.floor(max * 0.7))}\n\n[…中间省略 ${s.length - max} 字…]\n\n${s.slice(-Math.floor(max * 0.3))}`;
}

function lastFeedback(text, max) {
  const s = String(text || '').trim();
  return s.length <= max ? s : s.slice(-max);
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
