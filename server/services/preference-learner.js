/**
 * 偏好学习器 · 把重复出现的用户负面反馈"提级"为铁律
 *
 * 流程：
 *  1. 读 style/feedback.md（appendFeedback 写入的反馈历史）
 *  2. 按关键词词表聚类，统计每个关键词出现次数
 *  3. 次数 ≥ N（默认 3） → 写入 style/auto-rules.md
 *  4. agent.js 在 system prompt 注入该文件作为铁律
 *
 * 不破坏手写 style/voice.md（红线由作者亲笔维护），auto-rules.md 完全由本服务生成，可随时重生成。
 */
import { readFileSafe, writeFileSafe, resolveInProject } from './fs-utils.js';

/**
 * 关键词 → 规则映射表
 * 每个 rule 对应一个反馈类别：用户出现该关键词 N+ 次时升格为铁律。
 * patterns 支持多个同义词，命中其一即计 +1。
 */
const RULE_PATTERNS = [
  {
    id: 'no-em-dash',
    label: '禁用破折号过度',
    rule: '禁止用破折号（—— / —）做停顿或情绪重音，改用句号 / 逗号 / 分号。一章最多用 1 次。',
    patterns: [/破折号/, /——/, /—\s/],
  },
  {
    id: 'less-inner-monologue',
    label: '减少内心独白',
    rule: '内心独白每章 ≤ 2 处，每处 ≤ 60 字；情绪用动作 / 对白 / 环境呈现，不要让主角自己解释自己的感受。',
    patterns: [/内心独白/, /内心戏/, /心理描写/, /心声/, /自言自语过多/],
  },
  {
    id: 'avoid-ai-tone',
    label: '避免 AI 套话',
    rule: '禁用 AI 套话：起伏不定 / 复杂的情感涌上心头 / 心潮澎湃 / 一股暖流 / 不禁感叹 / 这一刻他终于明白 / 仿佛过了一个世纪 / 千言万语化作一句…… 通通替换为具体动作和细节。',
    patterns: [/AI\s*味/i, /AI\s*腔/i, /AI\s*感/i, /套话/, /模板腔/, /味儿/],
  },
  {
    id: 'avoid-purple-prose',
    label: '避免矫情堆砌',
    rule: '禁止形容词 / 副词堆砌（"凌厉的目光闪烁着寒光"），改成"看了他一眼"。一段话形容词 ≤ 1 个。',
    patterns: [/矫情/, /文艺(腔|味)?/, /(华丽|堆砌)(辞|词|藻)/, /形容词(多|过多|太多|堆)/, /辞藻/],
  },
  {
    id: 'avoid-overlong',
    label: '禁止冗余啰嗦',
    rule: '同一信息不重复（已经叙过的不再让角色复述）；删除可有可无的 "其实 / 似乎 / 仿佛 / 看起来 / 大概 / 也许"。一段话不超 4 句。',
    patterns: [/啰嗦/, /冗(余|长)/, /(太|过)(长|啰嗦)/, /废话/, /反复说/, /重复说/],
  },
  {
    id: 'avoid-water-text',
    label: '禁止水文',
    rule: '禁止"凑字数"段落：每段必须推进情节、铺垫伏笔或塑造人物之一；纯环境 / 纯回忆 / 纯吐槽段落超过 200 字必须删除或合并。',
    patterns: [/水文/, /凑字/, /灌水/, /(无意义|无关).*段(落)?/, /节奏(慢|拖|拖沓|拖泥)/],
  },
  {
    id: 'avoid-pacing-explode',
    label: '禁止超展开',
    rule: '禁止 1 章内完成超出大纲 2 个剧情节点；新设定 / 新人物每章 ≤ 2 个；高潮要先铺垫。',
    patterns: [/超展开/, /节奏(炸|崩|乱)/, /(剧情|展开).*太快/, /(突然|莫名)(出现|冒出)/],
  },
  {
    id: 'avoid-cliche',
    label: '禁用陈词滥调',
    rule: '禁用陈词滥调短语：风萧萧兮 / 时光荏苒 / 不知过了多久 / 一道身影 / 一道清冷的声音 / 修仙路漫漫 / 强者为尊。要写人物 / 场景具体特征。',
    patterns: [/陈词滥调/, /(俗|烂)(套|梗)/, /(模板|套路)文/, /雷同/, /老套/],
  },
  {
    id: 'avoid-dumb-protag',
    label: '禁止主角降智',
    rule: '主角必须按已知信息做最优解。不可"忘记自己有的能力 / 看不出明显陷阱 / 听不懂明显暗示"。困境必须来自外部约束或两难选择，不是主角自己变蠢。',
    patterns: [/(主角|男主|女主)?(降智|犯蠢|变蠢|脑残)/, /智商(掉|不在线)/, /(看不出|听不懂).*明显/],
  },
];

/**
 * 解析 feedback.md 为条目数组。
 * 每条 entry：{ header, body, ts(Date|null), chapter(number|null), kind, text }
 */
export function parseFeedbackEntries(md) {
  const txt = String(md || '').replace(/\r\n/g, '\n');
  if (!txt.trim()) return [];
  // 按 "\n## " 切分（首条无前导换行也兼容）
  const parts = [];
  const lines = txt.split('\n');
  let buf = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (buf) parts.push(buf);
      buf = { header: line.replace(/^##\s+/, '').trim(), bodyLines: [] };
    } else if (buf) {
      buf.bodyLines.push(line);
    }
  }
  if (buf) parts.push(buf);

  const entries = [];
  for (const p of parts) {
    const header = p.header;
    const body = p.bodyLines.join('\n').trim();
    const tsMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\d.Z:+-]*)/.exec(header);
    const ts = tsMatch ? new Date(tsMatch[1]) : null;
    const chMatch = /第\s*(\d+)\s*章/.exec(header);
    const chapter = chMatch ? Number(chMatch[1]) : null;
    const kindMatch = /-\s*类型：\s*([^\n]+)/.exec(body);
    const kind = kindMatch ? kindMatch[1].trim() : 'custom';
    const text = body
      .replace(/^-\s*类型：[^\n]*\n?/m, '')
      .replace(/^-\s*文件：[^\n]*\n?/m, '')
      .trim();
    entries.push({ header, body, ts, chapter, kind, text });
  }
  return entries;
}

/**
 * 按 RULE_PATTERNS 聚类，返回每条规则的命中次数与最近一次时间。
 * @param {Array} entries
 * @returns {Array<{id, label, rule, count, lastSeen, examples}>}
 */
export function clusterFeedback(entries) {
  const out = [];
  for (const def of RULE_PATTERNS) {
    let count = 0;
    let lastSeen = null;
    const examples = [];
    for (const e of entries) {
      const haystack = `${e.kind}\n${e.text}`;
      const hit = def.patterns.some((re) => re.test(haystack));
      if (hit) {
        count += 1;
        if (e.ts && (!lastSeen || e.ts > lastSeen)) lastSeen = e.ts;
        if (examples.length < 3) {
          const snippet = e.text.length > 80 ? e.text.slice(0, 78) + '…' : e.text;
          examples.push({ chapter: e.chapter, snippet });
        }
      }
    }
    if (count > 0) out.push({ id: def.id, label: def.label, rule: def.rule, count, lastSeen, examples });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * 学习并落盘到 style/auto-rules.md。
 * @param {string} projectName
 * @param {object} [opts]
 * @param {number} [opts.threshold=3] - 升格阈值；count ≥ threshold 才写入红线列表
 * @param {boolean} [opts.persist=true]
 */
export async function learnPreferences(projectName, opts = {}) {
  if (!projectName) throw new Error('projectName required');
  const threshold = Math.max(1, Number(opts.threshold) || 3);
  const persist = opts.persist !== false;

  const feedbackMd = (await readFileSafe(resolveInProject(projectName, 'style/feedback.md'))) || '';
  const entries = parseFeedbackEntries(feedbackMd);
  const clusters = clusterFeedback(entries);
  const promoted = clusters.filter((c) => c.count >= threshold);
  const candidates = clusters.filter((c) => c.count > 0 && c.count < threshold);

  const md = renderAutoRulesMd({ promoted, candidates, totalEntries: entries.length, threshold });
  let relPath = null;
  if (persist) {
    relPath = 'style/auto-rules.md';
    await writeFileSafe(resolveInProject(projectName, relPath), md);
  }

  return {
    relPath,
    totalEntries: entries.length,
    promoted,
    candidates,
    md,
  };
}

function renderAutoRulesMd({ promoted, candidates, totalEntries, threshold }) {
  const lines = [];
  lines.push('# 自动学习的写作铁律（由 preference-learner 自动生成）');
  lines.push('');
  lines.push(`> 本文件**不要手写**。来源：style/feedback.md ${totalEntries} 条反馈，升格阈值 ≥ ${threshold} 次。`);
  lines.push('>');
  lines.push('> 想新增铁律：去 record_feedback 用同样关键词反复反馈到阈值；想去掉铁律：清理 feedback.md 或在 style/voice.md 显式覆盖。');
  lines.push('');
  if (!promoted.length) {
    lines.push('## 当前已升格铁律');
    lines.push('');
    lines.push('（暂无 · 反馈次数尚未达到阈值）');
  } else {
    lines.push('## 当前已升格铁律（按命中次数降序）');
    lines.push('');
    for (const p of promoted) {
      const last = p.lastSeen ? p.lastSeen.toISOString().slice(0, 10) : '—';
      lines.push(`### ${p.label}（命中 ${p.count} 次 · 最近 ${last}）`);
      lines.push('');
      lines.push(`**铁律**：${p.rule}`);
      lines.push('');
      if (p.examples.length) {
        lines.push('**用户原话示例**：');
        for (const ex of p.examples) {
          lines.push(`- ${ex.chapter ? `第 ${ex.chapter} 章：` : ''}${ex.snippet}`);
        }
        lines.push('');
      }
    }
  }
  if (candidates.length) {
    lines.push('---');
    lines.push('');
    lines.push('## 候选（未达阈值，仅作参考）');
    lines.push('');
    for (const c of candidates) {
      lines.push(`- **${c.label}**：命中 ${c.count} 次（差 ${threshold - c.count} 次升格）`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * 构造注入 system prompt 的简短铁律列表（≤ 1KB）。
 * 仅含已升格规则；未升格规则不出现。
 */
export async function buildLearnedRulesMd(projectName) {
  if (!projectName) return null;
  try {
    const md = await readFileSafe(resolveInProject(projectName, 'style/auto-rules.md'));
    if (!md) return null;
    // 抽出"已升格铁律"中每条 ### + 铁律行
    const re = /^###\s+([^\n（]+)（命中 \d+ 次[^\n]*\n[^\n]*\n\*\*铁律\*\*：([^\n]+)/gm;
    const items = [];
    let m;
    while ((m = re.exec(md)) !== null) {
      items.push({ label: m[1].trim(), rule: m[2].trim() });
    }
    if (!items.length) return null;
    const lines = items.map((x, i) => `${i + 1}. **${x.label}**：${x.rule}`);
    let out = lines.join('\n');
    // 1KB 上限
    if (out.length > 1024) out = out.slice(0, 1020) + '…';
    return out;
  } catch {
    return null;
  }
}
