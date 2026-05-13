/**
 * 一致性自动巡查器（启发式，不依赖 LLM）
 *
 * 7 项独立检测：
 *   1. POV 漂移：限知作品里突然出现全知线索 / 他人内心独白
 *   2. 称呼漂移：同一段落内同一人物跳 alias
 *   3. 时间词跳跃：相邻短窗口内时间词大跨度
 *   4. 未知人名：章里说话/动作人名不在 entities/lookup 中
 *   5. AI 味密度：高频 AI 词清单 / 破折号密度 / 章末模板（kind=ai_taste）
 *   6. 对白比例：对白字符占比（kind=rhythm，< 25% 过于叙述化 / > 65% 灌水）
 *   7. 句长节奏：句长标准差（kind=rhythm，单调 = AI 味的另一信号）
 *
 * 输出与 consistency_check 工具兼容的 issues 数组，复用 writeConsistencyReport 落盘。
 * 不打断写章，只产报告 + emit 提醒。
 */
import fsp from 'node:fs/promises';
import yaml from 'js-yaml';
import { readFileSafe, resolveInProject } from './fs-utils.js';
import { writeConsistencyReport } from './reviews.js';
import { listChapters } from './chapter-utils.js';

// ============== 公共词表 ==============

/**
 * 时间词按"时段编号"分组：相邻段差距 ≥ 3 视为跨度过大跳变。
 * 例如 "清晨(1) → 深夜(5)" 距离 4，> 3 → warn。
 */
const TIME_TOKENS = [
  // 1 早晨
  { re: /(?:清晨|凌晨|拂晓|黎明|破晓|大早|一早|天刚亮)/g, bucket: 1 },
  // 2 上午
  { re: /(?:早上|上午|辰时)/g, bucket: 2 },
  // 3 中午
  { re: /(?:正午|中午|午时|日中|响午)/g, bucket: 3 },
  // 4 下午 / 傍晚
  { re: /(?:下午|未时|申时|黄昏|傍晚|日落|日暮|薄暮)/g, bucket: 4 },
  // 5 夜晚
  { re: /(?:夜晚|入夜|深夜|半夜|子时|丑时|寅时|月夜|夜半|三更|四更|五更)/g, bucket: 5 },
];

/** 全知/作者按线索：限知作品中检测到 → warn */
const OMNISCIENT_HINTS = [
  /(读者朋友|各位读者)/g,
  /(作者[按按语注]|话说|且说|按下不表|另一边却不知)/g,
  // 多 POV 同段：A 心想…… B 心想……
];

/** 第一人称代词出现（不在引号 / 全角引号 / 单引号 内）的统计 */
const FIRST_PERSON_RE = /(?<![\u201c\u300c\u300e"'])(?:我|俺|本座|本王|本宫|朕)(?![\u201d\u300d\u300f"'])/g;

/** 中文姓氏白名单（仅用于"候选人名"判定） */
const COMMON_SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵堪汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘斜厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲台从鄂索咸籍赖卓蔺屠蒙池乔郄欧上官欧阳司马诸葛公孙轩辕令狐司徒司空夏侯东方独孤';

/**
 * AI 味高频词词典（合并 humanizer P7 + style-voice 反 AI 禁令 + chinese-novelist C1）
 * 出现一次记 1 次命中；同一词重复出现合并为 1 个 issue 但记录次数。
 * 注意：词条不能与正常叙述高频冲突（如「眼神」「不」单字都太宽，必须 ≥ 2 字组合）。
 */
const AI_VOCAB = [
  // 反应表演词
  '瞳孔骤缩', '脸色一变', '脸色骤变', '脸色一沉', '脸色铁青',
  '心头一震', '心头一颤', '心头一紧', '心潮澎湃', '热血沸腾',
  '握紧拳头', '紧握双拳', '咬紧牙关', '深吸一口气', '猛地深吸',
  '嘴角微微上扬', '嘴角勾起一抹', '嘴角扬起一丝', '勾起一抹弧度',
  '眼神坚定', '眼神复杂', '眸光闪烁', '眼眸深邃', '寒光闪烁', '寒光乍现',
  '不动声色', '面不改色', '不寒而栗', '寒意涌上',
  // 时间感叹词（仅当孤立出现时算 AI 味）
  '骤然之间', '霎时之间', '刹那之间', '千钧一发',
  // 报幕式陈词
  '原来如此', '现在看来', '命运的齿轮', '前所未有的',
  '这一刻他才明白', '真相只有一个', '一切都说得通了',
  // 万能受伤 / 围观
  '鲜血从嘴角溢出', '嘴角溢出一抹血丝', '抹去嘴角的血迹',
  '全场寂静', '全场鸦雀无声', '所有人倒吸一口气',
  '仿佛连空气都凝固了', '仿佛时间都静止了', '一道道目光投向',
  // 拐杖词（成对出现才算）
  '心中暗道', '心中冷笑', '心中暗想',
];

/**
 * 章末禁用模板（最后 200 字内出现即记 1 个 issue）
 */
const TAIL_TEMPLATES = [
  /月光下[，,]\s*(?:他|她)/,
  /夜色中[，,]\s*(?:他|她)/,
  /(?:他|她)选了\s*[—\-]{1,2}/,
  /原来如此/,
  /原来这一切/,
  /鲜血从嘴角溢出/,
  /全场寂静/,
  /所有人倒吸一口气/,
  /仿佛时间都静止了/,
  /(?:他|她)握紧拳头/,
];

/** 章末是否以省略号 / 破折号收尾 */
const TAIL_OPEN_END = /[—\-]{2,}\s*$|…{1,}\s*$|\.\.\.\s*$/;

// ============== 工具函数 ==============

function stripQuotes(text) {
  // 把双引号 / 单引号 / 中文引号包裹的对话剔除（避免误报第一人称代词）
  return String(text || '')
    .replace(/[\u201c\u300c\u300e"][^\u201d\u300d\u300f"]{1,800}[\u201d\u300d\u300f"]/g, ' ')
    .replace(/'[^']{1,800}'/g, ' ');
}

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}|\r\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function shortExcerpt(text, max = 100) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

async function loadEntityAliases(projectName) {
  const dir = resolveInProject(projectName, 'knowledge/entities');
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return { byName: new Map(), allAliases: new Set(), characterEntities: [] }; }
  const byName = new Map(); // alias → canonical
  const allAliases = new Set();
  const characterEntities = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const txt = await readFileSafe(`${dir}/${f}`);
    if (!txt) continue;
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
    if (!m) continue;
    let meta = {};
    try { meta = yaml.load(m[1]) || {}; } catch { continue; }
    if (!meta?.name) continue;
    const aliases = [meta.name, ...(Array.isArray(meta.aliases) ? meta.aliases : [])].filter(Boolean);
    for (const a of aliases) {
      byName.set(String(a), meta.name);
      allAliases.add(String(a));
    }
    if (meta.type === 'character') characterEntities.push({ name: meta.name, aliases });
  }
  return { byName, allAliases, characterEntities };
}

async function loadPovHint(projectName) {
  // 从 SOUL.md / style/voice.md 找 POV 声明
  const [soul, voice] = await Promise.all([
    readFileSafe(resolveInProject(projectName, 'SOUL.md')),
    readFileSafe(resolveInProject(projectName, 'style/voice.md')),
  ]);
  const corpus = `${soul || ''}\n${voice || ''}`;
  if (/第一人称/.test(corpus)) return 'first';
  if (/(第三人称\s*全知|全知视角)/.test(corpus)) return 'third_omniscient';
  if (/(第三人称\s*限知|限知视角|主角视角)/.test(corpus)) return 'third_limited';
  // 默认按"第三人称限知"处理（网文最常见），若 POV 未声明则不报 pov 问题
  return null;
}

// ============== 4 项检测器 ==============

/** 1. POV 检测 */
function detectPov(text, povHint) {
  const issues = [];
  if (!povHint) return issues;

  const stripped = stripQuotes(text);

  if (povHint === 'third_limited' || povHint === 'third_omniscient') {
    // 第一人称代词出现在叙述（非对话）里
    const firstPersonMatches = stripped.match(FIRST_PERSON_RE) || [];
    if (firstPersonMatches.length >= 2) {
      issues.push({
        level: 'warning',
        kind: 'pov',
        title: '叙述中出现第一人称代词',
        position: '正文（已剔除对白后仍出现）',
        excerpt: shortExcerpt(firstPersonMatches.join('、'), 80),
        conflict_with: `POV 声明为"${povHint}"`,
        suggestion: '叙述部分改为第三人称（他/她/林尘 等），第一人称只用于对白与内心独白。',
      });
    }
  }

  if (povHint === 'third_limited') {
    // 全知线索
    for (const re of OMNISCIENT_HINTS) {
      const m = String(text).match(re);
      if (m && m.length) {
        issues.push({
          level: 'warning',
          kind: 'pov',
          title: '限知作品出现全知/作者按线索',
          position: '正文',
          excerpt: shortExcerpt(m.join('、'), 80),
          conflict_with: 'POV 限知不应出现作者直接评述 / 跳出主角视野的旁白',
          suggestion: '删去这类作者按；如需交代隐藏信息，改用伏笔或他人之口透露。',
        });
        break;
      }
    }
  }

  if (povHint === 'first') {
    // 第一人称作品里如果第三人称代词频次远高于第一人称 → 反向漂移
    const first = (stripped.match(FIRST_PERSON_RE) || []).length;
    const third = (stripped.match(/(?<![\u201c\u300c\u300e"'])(他|她|它)(?![\u201d\u300d\u300f"'])/g) || []).length;
    if (third >= first + 10 && first <= 1) {
      issues.push({
        level: 'warning',
        kind: 'pov',
        title: '第一人称作品中第三人称占主导',
        position: '正文',
        excerpt: `第一人称代词 ${first} 次 vs 第三人称 ${third} 次`,
        conflict_with: 'POV 第一人称要求"我"为视角主体',
        suggestion: '检查叙述视角，必要时改回第一人称叙述。',
      });
    }
  }

  return issues;
}

/** 2. 称呼漂移：同段落内同一人物跳 alias（剔除"长 alias 子串"造成的重复命中） */
function detectAliasDrift(text, byName) {
  const issues = [];
  if (byName.size === 0) return issues;

  // 按 canonical 分组：canonical → aliases[]（按长度降序）
  const groups = new Map();
  for (const [alias, canonical] of byName) {
    if (alias.length < 2) continue; // 单字 alias 太易误报
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push(alias);
  }
  for (const arr of groups.values()) arr.sort((a, b) => b.length - a.length);

  const paragraphs = splitParagraphs(text);
  let idx = 0;
  for (const para of paragraphs) {
    idx += 1;
    for (const [canonical, aliases] of groups) {
      // 标记本段中已被"更长 alias"占用的字符位置，短 alias 只在未被占用处计数
      const occupied = new Uint8Array(para.length);
      const usedAliases = [];
      for (const alias of aliases) {
        let cursor = 0;
        let found = false;
        while (cursor <= para.length - alias.length) {
          const pos = para.indexOf(alias, cursor);
          if (pos < 0) break;
          // 该位置整段是否完全被覆盖？是 → 视为长 alias 子串，跳过
          let allOccupied = true;
          for (let i = pos; i < pos + alias.length; i++) {
            if (!occupied[i]) { allOccupied = false; break; }
          }
          if (!allOccupied) {
            found = true;
            for (let i = pos; i < pos + alias.length; i++) occupied[i] = 1;
          }
          cursor = pos + alias.length;
        }
        if (found) usedAliases.push(alias);
      }
      if (usedAliases.length >= 2) {
        issues.push({
          level: 'info',
          kind: 'character',
          title: `同段内 ${canonical} 出现多种称呼`,
          position: `第 ${idx} 自然段`,
          excerpt: shortExcerpt(para, 120),
          conflict_with: `本段同时使用：${usedAliases.join('、')}`,
          suggestion: `同一段落只用一种称呼以减少跳读感；若是有意切换（如他人称呼变化），可忽略此提示。`,
        });
      }
    }
  }
  return issues;
}

/** 3. 时间词跨度跳变 */
function detectTimeJumps(text) {
  const issues = [];
  // 收集所有时间词位置 + bucket
  const found = [];
  for (const tok of TIME_TOKENS) {
    let m;
    const re = new RegExp(tok.re.source, tok.re.flags);
    while ((m = re.exec(text)) !== null) {
      found.push({ index: m.index, word: m[0], bucket: tok.bucket });
    }
  }
  found.sort((a, b) => a.index - b.index);
  for (let i = 1; i < found.length; i++) {
    const prev = found[i - 1];
    const cur = found[i];
    const distChars = cur.index - prev.index;
    const bucketDelta = Math.abs(cur.bucket - prev.bucket);
    // 50 字以内出现跨度 ≥ 3 的时间段 → 跳变
    if (distChars < 80 && bucketDelta >= 3) {
      const start = Math.max(0, prev.index - 20);
      const end = Math.min(text.length, cur.index + cur.word.length + 20);
      issues.push({
        level: 'warning',
        kind: 'timeline',
        title: `时间词跳变：${prev.word} → ${cur.word}`,
        position: `约第 ${prev.index} 字处`,
        excerpt: shortExcerpt(text.slice(start, end), 120),
        conflict_with: `两个时间段距离 ${bucketDelta} 段，相隔 ${distChars} 字内无明确过渡`,
        suggestion: `补一句过渡（"半日后"/"夜幕降临"/"等到..."）或拆分场景。`,
      });
    }
  }
  return issues;
}

/** 4. 未知人名：扫"X 说道/笑道/道：/答：/X 走/X 看"等模式，与 entities 比对 */
function detectUnknownNames(text, allAliases) {
  const issues = [];
  // 模式：连续 2-3 个中文字 + 说道/道：/笑道/喝道/答道/沉声道/冷声道
  const re = /([\u4e00-\u9fff]{2,3})(说道|道：|笑道|喝道|答道|沉声道|冷声道|淡淡道|低声道|嗤笑道|冷笑道|哼道|哈哈大笑)/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    // 必须首字是常见姓氏，避免 "今天说道" 这种误报
    if (!COMMON_SURNAMES.includes(name[0])) continue;
    if (allAliases.has(name)) continue;
    // 也允许 "alias + suffix" 的子串匹配（如 alias 是"林老"，匹配到"林老说道"）
    let inAliases = false;
    for (const a of allAliases) {
      if (a.length >= 2 && name.includes(a)) { inAliases = true; break; }
    }
    if (inAliases) continue;
    const start = Math.max(0, m.index - 20);
    const end = Math.min(text.length, m.index + name.length + 40);
    issues.push({
      level: 'info',
      kind: 'character',
      title: `疑似未建档人名：${name}`,
      position: `约第 ${m.index} 字处`,
      excerpt: shortExcerpt(text.slice(start, end), 120),
      conflict_with: `${name} 不在 knowledge/entities/*.md 的 name/aliases 列表`,
      suggestion: `若是新人物，调用 wiki_ingest 立档；若是临时配角（路人），可忽略。`,
    });
  }
  return issues;
}

/**
 * 5. AI 味密度检测（合并 humanizer P5/P7/P11 可正则化部分）
 *
 * 三个子检测：
 *   a) 高频 AI 词命中（AI_VOCAB），每词命中合并成 1 个 issue 但记录 count
 *   b) 破折号 "——" 千字密度（> 2/千字 触发）
 *   c) 章末 200 字内禁用模板 + 开放式收尾（破折号/省略号）
 *
 * 仅扫叙述层（剔除引号内对白），避免对白里"——"误报。
 */
function detectAiTaste(text) {
  const issues = [];
  if (!text || text.length < 200) return issues;

  const stripped = stripQuotes(text);
  const totalChars = stripped.length;

  // (a) 高频词
  const wordHits = []; // { word, count, samples: [excerpt] }
  for (const word of AI_VOCAB) {
    let count = 0;
    let firstIdx = -1;
    let cursor = 0;
    while (cursor < stripped.length) {
      const pos = stripped.indexOf(word, cursor);
      if (pos < 0) break;
      count += 1;
      if (firstIdx < 0) firstIdx = pos;
      cursor = pos + word.length;
    }
    if (count > 0) wordHits.push({ word, count, idx: firstIdx });
  }
  if (wordHits.length > 0) {
    // 词条按 count desc 排序，截断到前 12 个避免报告膨胀
    wordHits.sort((a, b) => b.count - a.count);
    const top = wordHits.slice(0, 12);
    const summary = top.map((h) => `${h.word}×${h.count}`).join('、');
    const total = wordHits.reduce((s, h) => s + h.count, 0);
    const sampleHit = top[0];
    const start = Math.max(0, sampleHit.idx - 30);
    const end = Math.min(stripped.length, sampleHit.idx + sampleHit.word.length + 30);
    issues.push({
      level: total >= 6 ? 'warning' : 'info',
      kind: 'ai_taste',
      title: `AI 高频词命中 ${wordHits.length} 类共 ${total} 次`,
      position: '叙述层（剔除对白后）',
      excerpt: shortExcerpt(`${summary}；首例上下文：${stripped.slice(start, end)}`, 200),
      conflict_with: '与 humanizer P7 / style-voice 反 AI 禁令冲突',
      suggestion: '把出现的高频词替换为具体动作 / 物件 / 慎重台词；详见 skills/style-voice.md 的「替代策略」段。',
    });
  }

  // (b) 破折号密度
  const dashCount = (stripped.match(/[—]{2}|--/g) || []).length;
  const dashPerKChar = totalChars > 0 ? (dashCount * 1000) / totalChars : 0;
  if (dashPerKChar > 2 && dashCount >= 3) {
    issues.push({
      level: dashPerKChar > 4 ? 'warning' : 'info',
      kind: 'ai_taste',
      title: `破折号密度过高（每千字 ${dashPerKChar.toFixed(1)} 个）`,
      position: '叙述层',
      excerpt: `共 ${dashCount} 个 "——"，叙述层总字数 ${totalChars}`,
      conflict_with: 'humanizer P5: 破折号每千字 ≤ 2 个',
      suggestion: '把抒情型破折号换成具体动作或环境音；保留必要的内心节奏破折号即可。',
    });
  }

  // (c) 章末模板 + 开放式收尾（看最后 250 字）
  const tail = String(text).slice(-250);
  const tailHits = [];
  for (const re of TAIL_TEMPLATES) {
    const m = tail.match(re);
    if (m) tailHits.push(m[0]);
  }
  if (tailHits.length > 0) {
    issues.push({
      level: 'warning',
      kind: 'ai_taste',
      title: `章末 250 字命中禁用模板：${tailHits.join('、')}`,
      position: '章末',
      excerpt: shortExcerpt(tail, 200),
      conflict_with: 'humanizer P11 + chinese-novelist C3',
      suggestion: '章末用具体物件或环境音收束（灯灭一盏 / 雨打棚顶 / 折扇敲鬓角），不要套用「月光下 / 原来如此 / 全场寂静」等模板。',
    });
  }

  // 章末以 "——" 或 "……" 结尾
  if (TAIL_OPEN_END.test(tail.replace(/\s+$/, ''))) {
    issues.push({
      level: 'info',
      kind: 'ai_taste',
      title: '章末以破折号 / 省略号开放式收尾',
      position: '章末最末一句',
      excerpt: shortExcerpt(tail.slice(-80), 100),
      conflict_with: 'style-voice 章末禁用「他选了——」「……」开放式留白',
      suggestion: '改用具体动作或物件做收束钩点，例如对方一句指令、一件具体物件落定。',
    });
  }

  return issues;
}

/**
 * 6. 对白比例检测（dialogue_ratio）
 *
 * 核心指标：被引号包裹的字符 / 总字符（排除空白换行）
 *
 * 阈值：
 *   - < 25%：叙述过重，读者容易累（info）
 *   - > 65%：对白灌水 / 缺叙述支撑（info）
 *
 * 仅对 ≥ 500 字的章节启用，过短章节比例波动大。
 */
function detectDialogueRatio(text) {
  const issues = [];
  if (!text || text.length < 500) return issues;

  // 先剔除空白与换行
  const compact = String(text).replace(/\s+/g, '');
  const totalChars = compact.length;
  if (totalChars < 500) return issues;

  // 提取所有引号包裹的内容（与 stripQuotes 同款 regex）
  const quoteRe = /[\u201c\u300c\u300e"][^\u201d\u300d\u300f"]{1,800}[\u201d\u300d\u300f"]/g;
  let dialogueChars = 0;
  const matches = String(text).match(quoteRe) || [];
  for (const m of matches) {
    // 引号本身不算对白字数；内部去掉空白后计
    dialogueChars += m.replace(/[\u201c\u300c\u300e"\u201d\u300d\u300f"]/g, '').replace(/\s+/g, '').length;
  }

  const ratio = totalChars > 0 ? dialogueChars / totalChars : 0;
  const pct = (ratio * 100).toFixed(1);

  if (ratio < 0.25) {
    issues.push({
      level: ratio < 0.15 ? 'warning' : 'info',
      kind: 'rhythm',
      title: `对白比例偏低（${pct}%，目标 ≥ 25%）`,
      position: '全章',
      excerpt: `对白字符 ${dialogueChars} / 非空字符 ${totalChars}`,
      conflict_with: '网文对白经验值 ≥ 30%；过低容易让章节读起来叙述过重',
      suggestion: '把 1-2 段叙述改写为人物对话或带台词的动作；对白比纯叙述更能透露人物性格与信息。',
    });
  } else if (ratio > 0.65) {
    issues.push({
      level: ratio > 0.8 ? 'warning' : 'info',
      kind: 'rhythm',
      title: `对白比例偏高（${pct}%，目标 ≤ 65%）`,
      position: '全章',
      excerpt: `对白字符 ${dialogueChars} / 非空字符 ${totalChars}`,
      conflict_with: '对白过多 / 缺叙述支撑，容易像剧本',
      suggestion: '给对白之间补场景动作、环境反应、人物心理；避免连续 3+ 段纯对白。',
    });
  }
  return issues;
}

/**
 * 7. 句长节奏检测（sentence_rhythm）
 *
 * 核心指标：句长标准差 / 平均句长（变异系数 CV）
 *
 * 长短句交替是网文节奏的基础。CV 过低 = 句式单调（AI 味典型表现）。
 *
 * 阈值：
 *   - 平均句长 < 8 字：短句过多，可能段落残缺或对话占比过高（跳过，由 dialogue_ratio 承接）
 *   - 平均句长 > 45 字：长句堆砌，读起来像古文翻译
 *   - CV < 0.35：句式单调（info）
 *   - CV < 0.22：句式严重单调（warning）
 *
 * 句长按中文终结符 `。！？；` 切分，仅对叙述层（剔除对白）计算。
 */
function detectSentenceRhythm(text) {
  const issues = [];
  if (!text || text.length < 500) return issues;

  const stripped = stripQuotes(text);
  if (stripped.length < 400) return issues; // 叙述层太短不扫

  // 按中文终结符切句
  const sentences = stripped
    .split(/[。！？；!?;]+/)
    .map((s) => s.replace(/\s+/g, ''))
    .filter((s) => s.length >= 3); // 过滤过短残片

  if (sentences.length < 8) return issues; // 样本太少不扫

  const lengths = sentences.map((s) => s.length);
  const n = lengths.length;
  const mean = lengths.reduce((a, b) => a + b, 0) / n;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;

  // 平均句长异常直接报
  if (mean > 45) {
    issues.push({
      level: 'info',
      kind: 'rhythm',
      title: `叙述层平均句长偏长（${mean.toFixed(1)} 字/句）`,
      position: '叙述层',
      excerpt: `共 ${n} 句，平均 ${mean.toFixed(1)} 字，标准差 ${stdDev.toFixed(1)}`,
      conflict_with: '长句堆砌、缺短句节奏点',
      suggestion: '把一些长句断开为 2-3 短句；冲突 / 打斗 / 转折处尤其需要 5-10 字的短句加速。',
    });
  }

  // 变异系数（句长多样性）
  if (n >= 10) {
    if (cv < 0.22) {
      issues.push({
        level: 'warning',
        kind: 'rhythm',
        title: `句式单调（CV=${cv.toFixed(2)}，目标 ≥ 0.35）`,
        position: '叙述层',
        excerpt: `平均 ${mean.toFixed(1)} 字，标准差 ${stdDev.toFixed(1)}，共 ${n} 句`,
        conflict_with: 'humanizer 铁律 3·变化节奏；句长整齐划一是 AI 生成的典型痕迹',
        suggestion: '主动加入 3-8 字短句和 25+ 字长句交替；每段至少 1 短 1 长。',
      });
    } else if (cv < 0.35) {
      issues.push({
        level: 'info',
        kind: 'rhythm',
        title: `句式节奏偏单调（CV=${cv.toFixed(2)}，目标 ≥ 0.35）`,
        position: '叙述层',
        excerpt: `平均 ${mean.toFixed(1)} 字，标准差 ${stdDev.toFixed(1)}，共 ${n} 句`,
        conflict_with: 'humanizer 铁律 3·变化节奏',
        suggestion: '适当增加长短句交替；不要全段都是 15-20 字的中句。',
      });
    }
  }

  return issues;
}

// ============== 入口 ==============

/**
 * 扫描一章内容并落盘报告。
 *
 * @param {object} opts
 * @param {string} opts.projectName
 * @param {number} opts.chapter
 * @param {string} [opts.content] - 不传则自动从 chapters/*.md 找
 * @param {string} [opts.chapterTitle]
 * @param {boolean} [opts.persist=true] - false 则只返回 issues 不写盘
 */
export async function scanChapterConsistency({ projectName, chapter, content, chapterTitle, persist = true }) {
  if (!projectName) throw new Error('projectName required');
  let ch = Number(chapter);
  if (!ch || ch < 1) throw new Error('chapter required (positive integer)');

  // 取章节正文
  let body = content;
  let resolvedTitle = chapterTitle;
  if (!body) {
    const all = await listChapters(projectName).catch(() => []);
    const found = all.find((c) => c.chapter === ch);
    if (!found) throw new Error(`第 ${ch} 章不存在`);
    resolvedTitle = resolvedTitle || found.title;
    body = (await readFileSafe(resolveInProject(projectName, found.path))) || '';
  }
  if (!body || body.length < 20) {
    return { ok: true, relPath: null, issues: [], note: 'chapter empty or too short' };
  }

  // 准备上下文
  const [{ byName, allAliases }, povHint] = await Promise.all([
    loadEntityAliases(projectName),
    loadPovHint(projectName),
  ]);

  // 跑 7 项检测
  const issues = [
    ...detectPov(body, povHint),
    ...detectAliasDrift(body, byName),
    ...detectTimeJumps(body),
    ...detectUnknownNames(body, allAliases),
    ...detectAiTaste(body),
    ...detectDialogueRatio(body),
    ...detectSentenceRhythm(body),
  ];

  const summary = {
    critical: issues.filter((i) => i.level === 'critical').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    info: issues.filter((i) => i.level === 'info').length,
    ai_taste: issues.filter((i) => i.kind === 'ai_taste').length,
    rhythm: issues.filter((i) => i.kind === 'rhythm').length,
  };

  let relPath = null;
  if (persist) {
    const r = await writeConsistencyReport({
      projectName,
      chapter: ch,
      chapterTitle: resolvedTitle,
      payload: {
        chapter: ch,
        issues,
        passed_checks: collectPassedChecks(issues, povHint),
      },
    });
    relPath = r.relPath;
  }

  return {
    ok: true,
    chapter: ch,
    issues,
    summary,
    povHint,
    relPath,
  };
}

function collectPassedChecks(issues, povHint) {
  const has = (kind) => issues.some((i) => i.kind === kind);
  const passed = [];
  if (povHint && !has('pov')) passed.push(`POV 一致（${povHint}）`);
  if (!has('character')) passed.push('人物称呼一致，无未知人名');
  if (!has('timeline')) passed.push('时间词无跨度跳变');
  if (!has('ai_taste')) passed.push('AI 味密度低（未触发高频词 / 破折号 / 章末模板告警）');
  if (!has('rhythm')) passed.push('节奏健康（对白比例 25-65% 且句式长短交替）');
  return passed;
}
