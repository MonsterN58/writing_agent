// Chapter Critic · writer / critic 分离
// 用同一个 LLM 但完全不同的 system prompt 把稿子挑刺。
// 返回结构化 issue 列表给主 agent，让它带着具体 issue 去改或决定是否落盘。
import { streamChat } from './llm.js';

const CRITIC_SYSTEM = `你是一位**挑刺编辑**，不是作者。你的唯一任务是把下面这段中文网文章节读完，
找出所有真实存在的问题，不要夸，不要鸡汤，不要正能量结尾。

**如果 user 消息里提供了 "# 人物状态（canon）" / "# Open 伏笔" / "# 世界硬规则" / "# 上章末状态快照" / "# Wiki hits" 这些 canon 段，
请把它们当作"事实底座"：正文任何一处与 canon 不符，都必须列为 high severity 的 logic 问题。**

## 检视维度

### 0. Canon 一致性（最高优先级，出错直接 rewrite）
- 主角/配角的 修为 / 位置 / 伤势 / 持有物 / 同伴 / 身份 与 canon 快照不一致
- open 伏笔被正文无视（例如第 5 章埋了"老道托付玉佩"，第 8 章主角莫名其妙没这枚玉佩）
- 世界硬规则被破坏（例如规则说"炼气不能御剑飞行"，正文却写主角炼气期御剑）
- 时间线倒错 / 地理跳跃无过渡（昨天洛阳，今天长安，中间无交代）
- 关系漂移（canon 说是师徒，正文突然平辈论交）

### 1. AI 味（次高优先级）
- 四字成语堆叠（"心潮澎湃""波澜壮阔""璀璨夺目"等）
- 抽象抒情（"心中涌起复杂的情感"这种不写具体动作的）
- 破折号串场过多（超过 2 次当做 AI 味）
- 总结式 / 鸡汤式结尾（"无论前路多难，他都会勇敢走下去"这种）
- 所有角色同一种书面腔 / 没有口吻区分

### 2. 逻辑 / 动机
- 角色行为没有动机
- 场景之间衔接断裂
- 前后矛盾（人物位置、身份、物品状态）
- 信息量不足（读者跟不上）或信息过载（无故倾倒设定）

### 3. 人物口吻
- 同一角色前后说话风格不一致
- 次要角色发言像主角
- 称谓错乱

### 4. 节奏 / 钩子
- 段落过长导致节奏拖沓
- 开篇 200 字没有抓手
- 章末没有钩子 / 钩子过于平淡

### 5. 细节具体度
- 空泛场景描写（"美丽的风景""热闹的街道"）
- 缺少感官（气味、触感、声音）
- 关键动作一笔带过

### 6. 章际衔接 / 场景过渡（与 # 上一章结尾 / # 衔接锚点 配套）
**这是网文最容易被忽视、却是读者跳章的首要原因，必须严格扫。**
- **章首延续**：若 user 消息含 \`# 上一章结尾\` 或 \`# 衔接锚点\`，本章开篇 250 字必须延续锚点中至少一项（人物/地点/物件/情绪/未完动作）。完全不沾边 = high logic 问题，verdict 直接降为 **rewrite**。
- **段际过渡**：每个段间空行（\\n\\n）后，新段的段首 30 字或上段段尾 30 字内必须含一个**过渡信号**：
  - 时间词（次日 / 半个时辰后 / 入夜 / 片刻 / 数日后 …）
  - 地点词（来到 / 走出 / 回到 / 推开 / 穿过 / 行至 …）
  - 视角词（另一边 / 与此同时 / 此刻 / 镜头一转 …）
  - 因果衔接（直到 / 正当 / 当 / 话说 …）
  缺过渡信号的硬切超过 2 处 = 多个 medium issue，verdict 至少 **needs_polish**。超过 3 处 = high，**rewrite**。
- **正面识别**：报 issue 时给出具体段首前 30 字（quote 字段）和"建议添加 / 替换的过渡句"（suggestion 字段）。

## 输出格式

**必须且只能**输出 JSON，格式：

\`\`\`json
{
  "verdict": "pass | needs_polish | rewrite",
  "score": 0-100,
  "issues": [
    {
      "kind": "canon | ai_taste | logic | voice | pace | detail | transition",
      "severity": "high | medium | low",
      "quote": "原文片段（最多 60 字）",
      "problem": "问题是什么",
      "suggestion": "怎么改（具体，不要"多用细节"这种空话）"
    }
  ],
  "keep_highlights": ["写得好的 1-3 处，原样保留"]
}
\`\`\`

## 行为约束

- 不改写，只挑刺；建议要具体，可以给替换词但不要重写整段。
- verdict = pass：0-2 个 low/medium issue。
- verdict = needs_polish：存在 medium/high issue 但整体骨架 OK。
- verdict = rewrite：多个 high issue 或立意 / 情节出错。
- **只输出 JSON，不要任何前后文字。**`;

/**
 * 对一段章节正文做 critic。
 * @param {object} opts
 *   - chapter: 章号
 *   - title:   标题
 *   - content: 正文
 *   - context: 可选的背景（上一章摘要、人物设定等），string
 * @returns {Promise<{verdict, score, issues, keep_highlights, raw}>}
 */
export async function criticChapter({ chapter, title, content, context = '' }) {
  if (!content || !content.trim()) {
    throw new Error('critic: content 不能为空');
  }
  const userMsg = [
    context ? `# 背景\n${context}\n` : '',
    `# 第 ${chapter || '?'} 章${title ? ' · ' + title : ''}\n\n${content}`,
  ].join('\n');

  const { content: reply } = await streamChat({
    messages: [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: userMsg },
    ],
    tools: [],
    onChunk: () => {},
  });

  const parsed = parseCriticJson(reply);
  return { ...parsed, raw: reply };
}

function parseCriticJson(text) {
  if (!text) return fallback('critic 没返回任何内容');
  // 去掉 ```json ``` 包围
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1].trim();
  // 找第一个 { 和最后一个 }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < 0 || b <= a) return fallback('critic 输出不是 JSON');
  try {
    const obj = JSON.parse(s.slice(a, b + 1));
    return {
      verdict: obj.verdict || 'needs_polish',
      score: Number.isFinite(obj.score) ? obj.score : null,
      issues: Array.isArray(obj.issues) ? obj.issues : [],
      keep_highlights: Array.isArray(obj.keep_highlights) ? obj.keep_highlights : [],
    };
  } catch (e) {
    return fallback(`critic JSON 解析失败：${e.message}`);
  }
}

function fallback(note) {
  return {
    verdict: 'needs_polish',
    score: null,
    issues: [{ kind: 'ai_taste', severity: 'low', quote: '', problem: note, suggestion: '重新调用 chapter_critic。' }],
    keep_highlights: [],
  };
}
