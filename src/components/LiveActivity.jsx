import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// 工具名 → 中文标签 + 图标 + 主色
const TOOL_HINTS = {
  // 写入
  write_chapter:    { label: '写章节',         icon: 'chapter',    cls: 'la-write' },
  write_outline:    { label: '写大纲',         icon: 'tasks',      cls: 'la-write' },
  setup_work:       { label: '立项',           icon: 'skill',      cls: 'la-write' },
  edit_file:        { label: '改文件',         icon: 'fileWrite',  cls: 'la-write' },
  update_progress:  { label: '更新进度',       icon: 'done',       cls: 'la-write' },
  backup_file:      { label: '备份文件',       icon: 'history',    cls: 'la-write' },
  wiki_ingest:      { label: '沉淀知识',       icon: 'memory',     cls: 'la-write' },
  create_user_skill:{ label: '存技能',         icon: 'skill',      cls: 'la-write' },
  record_feedback:  { label: '存反馈',         icon: 'feedback',   cls: 'la-write' },
  remember:         { label: '存记忆',         icon: 'memory',     cls: 'la-write' },
  // 读取/检索
  read_file:        { label: '读文件',         icon: 'file',       cls: 'la-read' },
  list_files:       { label: '列目录',         icon: 'folder',     cls: 'la-read' },
  list_chapters:    { label: '列章节',         icon: 'tasks',      cls: 'la-read' },
  read_skill_section:{ label: '读 skill',      icon: 'skill',      cls: 'la-read' },
  wiki_query:       { label: '查 wiki',        icon: 'memory',     cls: 'la-read' },
  search_chapters:  { label: '搜章节正文',     icon: 'memory',     cls: 'la-read' },
  get_chapter_context:{ label: '聚章节上下文', icon: 'memory',     cls: 'la-read' },
  // 验收/打分
  reader_score:     { label: '读者打分',       icon: 'feedback',   cls: 'la-think' },
  chapter_alternates:{ label: '生成候选稿',    icon: 'skill',      cls: 'la-think' },
  chapter_reindex:  { label: '建索引',         icon: 'memory',     cls: 'la-think' },
  // 元
  ask_user:         { label: '询问你',         icon: 'ask',        cls: 'la-ask' },
  plan_tasks:       { label: '排任务',         icon: 'tasks',      cls: 'la-think' },
};

function toolHint(name) {
  return TOOL_HINTS[name] || { label: name, icon: 'tool', cls: 'la-tool' };
}

function shortPath(p) {
  if (!p) return '';
  const s = String(p);
  // 截掉 novels/<project>/ 前缀
  const idx = s.indexOf('/');
  const rest = s.startsWith('novels/') && idx >= 0 ? s.slice(s.indexOf('/', idx + 1) + 1) : s;
  return rest.length > 50 ? '…' + rest.slice(-48) : rest;
}

/**
 * 从事件流里提炼"当前在干什么"。返回 {phase, label, detail, icon, cls, sub}
 * 优先级：等用户 > 子 agent > 工具调用中 > 刚写文件 > 在思考 > 装配中 > 启动中 > 兜底
 */
function deriveActivity(events, busy) {
  if (!events || !events.length) {
    return busy ? { phase: 'warmup', label: '启动中', icon: 'spinner', cls: 'la-warm' } : null;
  }

  // 反向遍历，找最近的标志事件
  const now = Date.now();
  const within = (e, ms) => e && e.time && (now - e.time) <= ms;

  // 1. 等待用户回应：awaiting_user 是终止态，busy 应该已 false，但保险起见
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'done' || e.type === 'error' || e.type === 'agent_giveup') break;
    if (e.type === 'awaiting_user') {
      return { phase: 'awaiting', label: '等你回应', icon: 'ask', cls: 'la-ask' };
    }
  }

  // 2. tool_call without matching tool_result（按 id 配对）
  const openTools = new Map(); // id -> tool_call event
  for (const e of events) {
    if (e.type === 'tool_call' && e.id) openTools.set(e.id, e);
    else if (e.type === 'tool_result' && e.id) openTools.delete(e.id);
  }
  if (openTools.size > 0) {
    // 取最新一个
    const last = [...openTools.values()].pop();
    const h = toolHint(last.name);
    let detail = '';
    const args = last.args || {};
    if (args.path) detail = shortPath(args.path);
    else if (args.relPath) detail = shortPath(args.relPath);
    else if (args.chapter) detail = `第 ${args.chapter} 章${args.title ? ' · ' + String(args.title).slice(0, 24) : ''}`;
    else if (args.query) detail = String(args.query).slice(0, 30);
    else if (args.keywords) detail = (args.keywords || []).slice(0, 3).join(' · ');
    else if (args.question) detail = String(args.question).slice(0, 30);
    else if (args.name) detail = String(args.name);
    return {
      phase: 'tool',
      label: `调用 · ${h.label}`,
      detail,
      icon: h.icon,
      cls: h.cls,
      sub: openTools.size > 1 ? `+${openTools.size - 1} 并行` : null,
    };
  }

  // 3. 子 agent 运行中
  const openSubs = new Map();
  for (const e of events) {
    if (e.type === 'subagent_start' && e.role) openSubs.set(e.role, e);
    else if (e.type === 'subagent_done' && e.role) openSubs.delete(e.role);
  }
  if (openSubs.size > 0) {
    const last = [...openSubs.values()].pop();
    return {
      phase: 'subagent',
      label: `子任务 · ${last.role}`,
      icon: 'sparkles',
      cls: 'la-think',
      sub: openSubs.size > 1 ? `+${openSubs.size - 1} 并行` : null,
    };
  }

  // 4. 刚写完文件（最近 1.5s 内）
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!within(e, 1500)) break;
    if (e.type === 'file_write') {
      const isChapter = e.kind === 'chapter';
      return {
        phase: 'write',
        label: isChapter ? '已落章' : '写入文件',
        detail: shortPath(e.path || e.relPath),
        icon: isChapter ? 'chapter' : 'fileWrite',
        cls: 'la-write',
      };
    }
    if (e.type === 'chapter_indexed' || e.type === 'style_fingerprint_updated' || e.type === 'reader_scored') {
      const labels = {
        chapter_indexed: '章节向量化',
        style_fingerprint_updated: '风格指纹更新',
        reader_scored: '读者打分',
      };
      return { phase: 'post', label: labels[e.type], icon: 'memory', cls: 'la-think' };
    }
  }

  // 5. 流式 token 中（最近 1.5s 内有 turn_start 但没 llm_done）
  let lastTurnStart = null;
  let lastLlmDone = null;
  for (const e of events) {
    if (e.type === 'turn_start') lastTurnStart = e;
    else if (e.type === 'llm_done') lastLlmDone = e;
  }
  if (lastTurnStart && (!lastLlmDone || (lastTurnStart.time || 0) > (lastLlmDone.time || 0))) {
    return { phase: 'thinking', label: `思考中 · 第 ${lastTurnStart.turn || '?'} 轮`, icon: 'cpu', cls: 'la-think' };
  }

  // 6. prompt 装配
  let lastPromptSize = null;
  for (const e of events) if (e.type === 'prompt_size') lastPromptSize = e;
  if (lastPromptSize && within(lastPromptSize, 3000) && busy) {
    return {
      phase: 'prompt',
      label: '装配 prompt',
      detail: `${(lastPromptSize.chars / 1000).toFixed(1)}k 字符 · ${lastPromptSize.skills || 0} skill`,
      icon: 'cpu',
      cls: 'la-warm',
    };
  }

  // 7. warmup（agent 入口刚发的事件）
  let lastWarmup = null;
  for (const e of events) if (e.type === 'agent_warmup' || e.type === 'start') lastWarmup = e;
  if (lastWarmup && within(lastWarmup, 5000) && busy) {
    return { phase: 'warmup', label: '启动中', icon: 'spinner', cls: 'la-warm' };
  }

  // 兜底
  return busy ? { phase: 'busy', label: '处理中', icon: 'spinner', cls: 'la-warm' } : null;
}

function Spinner() {
  return <span className="la-spinner" />;
}

export default function LiveActivity({ events, busy }) {
  // 强制 200ms 一次重渲染，确保"刚写完文件"等时间敏感判定能淡出
  const [, tick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [busy]);

  const activity = useMemo(() => deriveActivity(events, busy), [events, busy]);
  // 平滑：刚结束时仍保留最后一次 activity 0.8s 让用户看到"已完成"
  const [pinned, setPinned] = useState(null);
  const lastActivityRef = useRef(null);
  useEffect(() => {
    if (activity) {
      lastActivityRef.current = activity;
      setPinned(null);
      return;
    }
    if (!busy && lastActivityRef.current) {
      // 把最后一个状态短暂保留为"已完成"
      setPinned({ phase: 'done', label: '已完成', icon: 'check', cls: 'la-done' });
      const id = setTimeout(() => setPinned(null), 1200);
      return () => clearTimeout(id);
    }
  }, [activity, busy]);

  const display = activity || pinned;
  if (!display) return null;

  return (
    <div className={`live-activity ${display.cls || ''}`}>
      <span className="la-icon">
        {display.icon === 'spinner' ? <Spinner /> : <Icon name={display.icon} size={13} />}
      </span>
      <span className="la-label">{display.label}</span>
      {display.detail && <span className="la-detail" title={display.detail}>{display.detail}</span>}
      {display.sub && <span className="la-sub">{display.sub}</span>}
      {(display.phase !== 'done' && display.phase !== 'awaiting' && display.phase !== 'post') && (
        <span className="la-pulse" />
      )}
    </div>
  );
}
