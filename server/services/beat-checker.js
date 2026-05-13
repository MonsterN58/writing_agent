// 【A2】Beat 级强约束验收：对比 outline 大纲拍 vs 正文实际落位
// - 用 cheap LLM 判定每个 beat 是否在正文中体现
// - 缺失的 beat 进入 acceptance.blockers / advisories
import { resolveInProject, readFileSafe } from './fs-utils.js';
import { runSubAgent } from './subagents/runner.js';

/**
 * 从 chapter outline markdown 提取 beats（场景节拍）。
 * 兼容多种格式：
 *   - `【场景 N】xxx (约 N 字)`
 *   - `### 场景 N · xxx`
 *   - `- beat 1: xxx` 在 ## 拍位 / ## 场景节拍 段内
 */
export function extractBeatsFromOutline(outlineMd) {
  const text = String(outlineMd || '');
  if (!text.trim()) return [];

  const beats = [];
  // 模式 1：【场景 N】标题
  const re1 = /【场景\s*(\d+)】([^\n]+)/g;
  let m;
  while ((m = re1.exec(text)) !== null) {
    beats.push({
      index: Number(m[1]),
      title: m[2].trim(),
    });
  }
  if (beats.length) return beats;

  // 模式 2：### 场景 N
  const re2 = /^###\s*场景\s*(\d+)[·\s]?\s*([^\n]*)$/gm;
  while ((m = re2.exec(text)) !== null) {
    beats.push({ index: Number(m[1]), title: m[2].trim() || `场景${m[1]}` });
  }
  if (beats.length) return beats;

  // 模式 3：## 场景节拍 段下面的 - / 1. 列表
  const sectionRe = /##\s*(?:场景节拍|节拍|分镜|beats?)[\s\S]*?(?=\n##\s|$)/i;
  const sec = sectionRe.exec(text);
  if (sec) {
    const lines = sec[0].split(/\r?\n/);
    let idx = 0;
    for (const line of lines) {
      const t = line.trim();
      const lm = /^[-*]\s+(.+)$/.exec(t) || /^(\d+)[、.\s]+(.+)$/.exec(t);
      if (lm) {
        idx += 1;
        beats.push({ index: idx, title: (lm[2] || lm[1]).trim() });
      }
    }
  }
  return beats;
}

const BEAT_CHECK_SYSTEM = `你是节拍核对员。给定一份章节大纲提炼出的 beats（场景节拍清单）+ 该章实际正文，
逐条判断每个 beat 是否在正文中**真实体现**（不是被一笔带过）。

判定标准：
- **hit**：正文中能找到这个 beat 对应的具体描写、对话或情节推进（≥3 句话的呈现）
- **partial**：正文有提到/暗示但**没展开**（≤1-2 句草草掠过）
- **miss**：正文完全没有这个 beat 的内容

不要纵容"我意会到了"——必须有文本证据。证据用 ≤30 字摘录正文。`;

const BEAT_CHECK_SCHEMA = {
  beats: [
    {
      index: 1,
      title: 'beat 标题',
      verdict: 'hit | partial | miss',
      evidence: '正文中证据片段（≤30 字）或缺失说明',
    },
  ],
  hit_count: 0,
  partial_count: 0,
  miss_count: 0,
  overall: '一句话总结：本章对大纲拍位的执行度',
};

/**
 * 检查 beats 命中情况。
 * @param {object} opts { projectName, chapter, content, signal?, emit? }
 * @returns {Promise<{ok, beats?, hitRate?, missCount?, partialCount?, missing?, error?}>}
 */
export async function checkBeats(opts) {
  const { projectName, chapter, content, signal, emit } = opts;
  if (!projectName || !chapter || !content) {
    return { ok: false, error: '缺少 projectName / chapter / content', skipped: true };
  }
  const padded = String(chapter).padStart(3, '0');
  // 兼容多种文件名
  const candidates = [
    `outline/chapters/chapter-${chapter}.md`,
    `outline/chapters/chapter-${padded}.md`,
    `outline/chapters/第${chapter}章.md`,
  ];
  let outlineTxt = null;
  for (const p of candidates) {
    const t = await readFileSafe(resolveInProject(projectName, p));
    if (t) { outlineTxt = t; break; }
  }
  if (!outlineTxt) {
    return { ok: false, skipped: true, error: '没有找到 chapter outline', beats: [] };
  }
  const beats = extractBeatsFromOutline(outlineTxt);
  if (!beats.length) {
    return { ok: false, skipped: true, error: '大纲中未识别出 beats', beats: [] };
  }

  const userPrompt = [
    `## 章节大纲拍位（共 ${beats.length} 个）`,
    beats.map((b) => `${b.index}. ${b.title}`).join('\n'),
    '',
    `## 实际正文（节选 16k 字以内）`,
    String(content).slice(0, 16000),
  ].join('\n');

  const r = await runSubAgent({
    role: `beat-check#${chapter}`,
    systemPrompt: BEAT_CHECK_SYSTEM,
    userPrompt,
    schema: BEAT_CHECK_SCHEMA,
    profile: 'cheap',
    signal,
    emit,
    timeoutMs: 90000,
  });
  if (!r.ok) return { ok: false, error: r.error || 'beat-check LLM 调用失败', beats };

  const data = r.data || {};
  const checked = Array.isArray(data.beats) ? data.beats : [];
  // 聚合统计
  let hit = 0, partial = 0, miss = 0;
  const missing = [];
  for (const b of checked) {
    const v = String(b.verdict || '').toLowerCase();
    if (v === 'hit') hit += 1;
    else if (v === 'partial') { partial += 1; missing.push({ ...b, severity: 'medium' }); }
    else if (v === 'miss') { miss += 1; missing.push({ ...b, severity: 'high' }); }
  }
  const total = checked.length || beats.length;
  const hitRate = total ? hit / total : 0;
  return {
    ok: true,
    beats: checked,
    total,
    hit, partial, miss,
    hitRate,
    missing,
    overall: data.overall || '',
  };
}
