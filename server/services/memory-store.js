// 长期记忆 store · memory/index.json
// 结构化保存用户偏好 / 硬约束 / 重复踩过的坑等长期信息，
// 每轮 runAgent 启动时把 priority 高 + 最近的 N 条注入 system prompt。
import { resolveInProject, readFileSafe, writeFileSafe } from './fs-utils.js';

const VALID_KINDS = new Set([
  'character_voice',   // 某角色固定口吻 / 说话方式
  'user_preference',   // 用户偏好（节奏、长短、口味）
  'hard_constraint',   // 硬约束（必须 / 绝不）
  'recurring_mistake', // 重复踩过的坑（防止再犯）
  'failure_mode',
  'world_rule',        // 用户后期补充的世界观规则
  'note',              // 其他备注
]);

const MEMORY_PATH = 'memory/index.json';

async function readIndex(projectName) {
  if (!projectName) return { items: [] };
  const abs = resolveInProject(projectName, MEMORY_PATH);
  const txt = await readFileSafe(abs);
  if (!txt) return { items: [] };
  try {
    const parsed = JSON.parse(txt);
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

async function writeIndex(projectName, data) {
  const abs = resolveInProject(projectName, MEMORY_PATH);
  await writeFileSafe(abs, JSON.stringify(data, null, 2));
}

/**
 * 记录一条长期记忆。
 * @param {string} projectName
 * @param {object} payload
 *   - kind: VALID_KINDS 之一
 *   - key:  唯一键（同 kind+key 已存在则更新而不是重复）
 *   - value: 记忆正文
 *   - priority: 1-5（5 最高，每次都注入；3 中等，按需注入；1 低）
 *   - tags: 字符串数组
 */
export async function recordMemory(projectName, payload) {
  if (!projectName) throw new Error('未激活作品');
  const kind = String(payload.kind || '').trim();
  const key = String(payload.key || '').trim();
  const value = String(payload.value || '').trim();
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`memory kind 必须是：${[...VALID_KINDS].join(' / ')}`);
  }
  if (!key) throw new Error('memory.key 不能为空');
  if (!value) throw new Error('memory.value 不能为空');
  const priority = Math.min(5, Math.max(1, Number(payload.priority || 3)));
  const tags = Array.isArray(payload.tags) ? payload.tags.slice(0, 8) : [];

  const data = await readIndex(projectName);
  const idx = data.items.findIndex((it) => it.kind === kind && it.key === key);
  const now = new Date().toISOString();
  const entry = { kind, key, value, priority, tags, updatedAt: now };
  if (idx >= 0) {
    entry.createdAt = data.items[idx].createdAt || now;
    data.items[idx] = entry;
  } else {
    entry.createdAt = now;
    data.items.push(entry);
  }
  // 限制总条数：超过 200 条丢掉最旧 + 最低优先级的
  if (data.items.length > 200) {
    data.items.sort((a, b) => (b.priority - a.priority) || (b.updatedAt.localeCompare(a.updatedAt)));
    data.items = data.items.slice(0, 200);
  }
  await writeIndex(projectName, data);
  return { ok: true, count: data.items.length, entry };
}

/**
 * 取出当前最该注入的记忆，序列化为 markdown 片段。
 * 规则：priority>=4 的全注入；priority==3 取最近 8 条；总长度限 1500 字。
 */
export async function loadActiveMemoriesMd(projectName) {
  if (!projectName) return null;
  const data = await readIndex(projectName);
  if (!data.items.length) return null;
  const sorted = [...data.items].sort((a, b) =>
    (b.priority - a.priority) || (b.updatedAt.localeCompare(a.updatedAt))
  );
  const high = sorted.filter((m) => m.priority >= 4);
  const mid = sorted.filter((m) => m.priority === 3).slice(0, 8);
  const picked = [...high, ...mid];
  if (!picked.length) return null;

  const KIND_LABEL = {
    character_voice: '人物口吻',
    user_preference: '用户偏好',
    hard_constraint: '硬约束',
    recurring_mistake: '反复踩坑',
    failure_mode: '失败模式',
    world_rule: '世界规则',
    note: '备注',
  };
  const lines = [];
  for (const m of picked) {
    const label = KIND_LABEL[m.kind] || m.kind;
    const star = '★'.repeat(m.priority);
    lines.push(`- **[${label}]** ${star} ${m.key}：${m.value}`);
  }
  let md = lines.join('\n');
  if (md.length > 1500) md = md.slice(0, 1500) + '\n…';
  return md;
}

/** 列出所有记忆（排序：优先级降序 → 更新时间降序） */
export async function listMemories(projectName) {
  const data = await readIndex(projectName);
  return [...data.items].sort((a, b) =>
    (b.priority - a.priority) || (b.updatedAt || '').localeCompare(a.updatedAt || '')
  );
}

/** 按 kind+key 删除一条记忆 */
export async function deleteMemory(projectName, kind, key) {
  if (!projectName) throw new Error('未激活作品');
  const data = await readIndex(projectName);
  const before = data.items.length;
  data.items = data.items.filter((it) => !(it.kind === kind && it.key === key));
  if (data.items.length === before) throw new Error(`记忆不存在：${kind}/${key}`);
  await writeIndex(projectName, data);
  return { ok: true, count: data.items.length };
}

export const MEMORY_KINDS = [...VALID_KINDS];
