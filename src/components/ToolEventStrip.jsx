import React, { useState } from 'react';
import Icon from './Icon.jsx';

// 事件类型 → 显示元数据
const TYPE_META = {
  user_send:     { iconName: 'user',         label: '用户消息',  cls: 'evt-user' },
  start:         { iconName: 'play',         label: '开始',      cls: 'evt-info' },
  skill_routed:  { iconName: 'skill',        label: 'skill 路由', cls: 'evt-skill' },
  skill_load:    { iconName: 'skill',        label: '加载 skill', cls: 'evt-skill' },
  tool_call:     { iconName: 'tool',         label: '调用工具',  cls: 'evt-tool' },
  tool_result:   { iconName: 'toolResult',   label: '工具返回',  cls: 'evt-tool' },
  file_write:    { iconName: 'fileWrite',    label: '写入文件',  cls: 'evt-file' },
  chapter_saved: { iconName: 'chapter',      label: '章节落盘',  cls: 'evt-file' },
  chapter_score: { iconName: 'score',        label: '质量评分',  cls: 'evt-score' },
  chapter_critic:{ iconName: 'critic',       label: 'critic 评审', cls: 'evt-score' },
  feedback_saved:{ iconName: 'feedback',     label: '反馈保存',  cls: 'evt-feedback' },
  user_skill_saved:{ iconName: 'skill',      label: '用户 skill', cls: 'evt-skill' },
  memory_saved:  { iconName: 'memory',       label: '长期记忆',  cls: 'evt-feedback' },
  intent_route:  { iconName: 'intent',       label: '意图路由',  cls: 'evt-info' },
  prompt_size:   { iconName: 'promptSize',   label: 'prompt 体量', cls: 'evt-mute' },
  token_usage:   { iconName: 'promptSize',   label: 'token 用量', cls: 'evt-mute' },
  edit_file:     { iconName: 'fileWrite',    label: '定点替换',   cls: 'evt-file' },
  trace_open:    { iconName: 'reasoning',    label: 'trace 开启', cls: 'evt-mute' },
  review_alert:  { iconName: 'reviewAlert',  label: '一致性告警', cls: 'evt-err' },
  tasks_update:  { iconName: 'tasks',        label: '任务清单',  cls: 'evt-plan' },
  ask_user:      { iconName: 'ask',          label: '主动求证',  cls: 'evt-ask' },
  awaiting_user: { iconName: 'pause',        label: '等用户答复', cls: 'evt-ask' },
  agent_giveup:  { iconName: 'giveup',       label: 'agent 放弃', cls: 'evt-err' },
  turn_start:    { iconName: 'turnStart',    label: '请求模型',  cls: 'evt-info' },
  llm_done:      { iconName: 'llmDone',      label: '模型返回',  cls: 'evt-info' },
  reasoning:     { iconName: 'reasoning',    label: '推理',      cls: 'evt-mute' },
  turn_end:      { iconName: 'turnEnd',      label: '本轮结束',  cls: 'evt-info' },
  done:          { iconName: 'done',         label: '完成',      cls: 'evt-ok' },
  error:         { iconName: 'error',        label: '错误',      cls: 'evt-err' },
  // 子 Agent / 验收 / 自修复
  subagent_start:   { iconName: 'tool',        label: '子 Agent 启动', cls: 'evt-skill' },
  subagent_done:    { iconName: 'toolResult',  label: '子 Agent 返回', cls: 'evt-skill' },
  subagent_enqueue: { iconName: 'tasks',       label: '子 Agent 排队', cls: 'evt-mute' },
  acceptance_report:{ iconName: 'reviewAlert', label: '验收委员会', cls: 'evt-score' },
  auto_repair:      { iconName: 'reasoning',   label: '自动修稿',    cls: 'evt-plan' },
  auto_repair_tool: { iconName: 'reasoning',   label: '自修工具链',  cls: 'evt-plan' },
  auto_continue:    { iconName: 'turnStart',   label: '自动续轮',    cls: 'evt-mute' },
};

function fmt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function summarize(evt) {
  switch (evt.type) {
    case 'skill_routed':  return `${evt.name}${evt.source === 'user' ? '（用户）' : ''}${evt.matchedOn?.length ? ` · ${evt.matchedOn.join(' / ')}` : ''}`;
    case 'skill_load':    return `${evt.name}${evt.title ? ` · ${evt.title}` : ''}`;
    case 'tool_call':     return evt.name;
    case 'tool_result':   return `${evt.name} ${evt.ok ? '✓' : '✗'}`;
    case 'file_write':    return `${evt.path}${evt.bytes ? ` (${evt.bytes} 字)` : ''}${evt.note ? ' · ' + evt.note : ''}`;
    case 'chapter_saved': return `第 ${evt.chapter} 章 · ${evt.title}${evt.wordCount ? ` · ${evt.wordCount}字` : ''}${evt.score ? ` · ${evt.score}分` : ''}`;
    case 'chapter_score': return `第 ${evt.chapter} 章 · ${evt.score?.total ?? '?'} 分`;
    case 'chapter_critic':return `第 ${evt.chapter || '?'} 章 · ${evt.verdict}${evt.score != null ? ` · ${evt.score}分` : ''} · ${evt.issueCount || 0} 处 issue`;
    case 'feedback_saved':return `${evt.kind || 'custom'}${evt.relPath ? ` · ${evt.relPath}` : ''}`;
    case 'user_skill_saved':return `${evt.name}${evt.title ? ` · ${evt.title}` : ''}${evt.relPath ? ` · ${evt.relPath}` : ''}`;
    case 'memory_saved':  return `[${evt.kind}] ${evt.key} · 优先级 ${evt.priority}`;
    case 'intent_route':  return `${evt.intent} · ${evt.contextMode} · ${evt.risk}`;
    case 'prompt_size':   return `${evt.chars} 字 · ${evt.skills} skill · ${evt.intent || '?'}${evt.compressed ? ' · 压缩' : ''}`;
    case 'token_usage':   return `第 ${evt.turn} 轮 · prompt ${evt.prompt}${evt.cached ? `（缓存 ${evt.cached}，命中 ${evt.hitRate}%）` : ''} + out ${evt.completion}　总 ${evt.total?.prompt || 0}/${evt.total?.completion || 0}`;
    case 'edit_file':     return evt.status === 'error' ? `${evt.path} · ${evt.kind}${evt.matches != null ? `（${evt.matches} 处匹配）` : ''}` : `${evt.path} · 行 ${evt.lineNumber} · Δ${evt.bytesDelta >= 0 ? '+' : ''}${evt.bytesDelta}`;
    case 'trace_open':    return evt.relPath || '';
    case 'review_alert':  return `第 ${evt.chapter} 章 · ${evt.count} 条致命问题`;
    case 'tasks_update':  return `${evt.done}/${evt.total} 完成`;
    case 'ask_user':      return evt.question;
    case 'awaiting_user': return `第 ${evt.turn} 轮暂停`;
    case 'agent_giveup':  return evt.reason || '主动停止';
    case 'turn_start':    return `第 ${evt.turn} 轮`;
    case 'llm_done':      return `第 ${evt.turn} 轮 · ${evt.ms}ms · 正文 ${evt.contentChars} / 推理 ${evt.reasoningChars} / 工具 ${evt.toolCalls}`;
    case 'error':         return evt.message;
    case 'subagent_start':   return evt.role;
    case 'subagent_done':    return `${evt.role} ${evt.ok ? `✓ ${evt.ms}ms${evt.chars ? ` · ${evt.chars} 字` : ''}` : `✗ ${evt.error || '?'}`}`;
    case 'subagent_enqueue': return `${evt.index + 1}/${evt.total} · ${evt.role}`;
    case 'acceptance_report':return `第 ${evt.chapter} 章 · ${evt.passed ? `✅ ${evt.score} 分` : `❌ ${(evt.blockers || []).join('；')}`}`;
    case 'auto_repair':      return `第 ${evt.chapter} 章 · 第 ${evt.attempt}${evt.max ? `/${evt.max}` : ''} 次${evt.ok === false ? ` ✗ ${evt.error || ''}` : ''}`;
    case 'auto_repair_tool': return `${evt.of} → 补跑 ${evt.via}（${evt.note || ''}）`;
    case 'auto_continue':    return `${evt.reason || ''}${evt.nudge ? ` · 第 ${evt.nudge} 次` : ''}`;
    default: return '';
  }
}

function detailOf(evt) {
  switch (evt.type) {
    case 'tool_call':     return fmt(evt.args);
    case 'tool_result':   return fmt(evt.result);
    case 'chapter_score': return fmt(evt.score);
    case 'tasks_update':  return fmt(evt.tasks);
    case 'ask_user':      return evt.options?.length ? `选项：${evt.options.join(' | ')}` : (evt.context || '');
    case 'prompt_size':
      return evt.breakdown
        ? `system: ${evt.breakdown.system} 字\nhistory: ${evt.breakdown.history} 字（${evt.breakdown.historyMsgs} 条）\nuser: ${evt.breakdown.user} 字`
        : '';
    case 'skill_routed':  return fmt({ title: evt.title, source: evt.source, matchedOn: evt.matchedOn, priority: evt.priority });
    case 'intent_route':  return fmt({ target: evt.target, notes: evt.notes, skillsHint: evt.skillsHint });
    case 'chapter_saved': return evt.scorePath || '';
    case 'acceptance_report': return fmt({ blockers: evt.blockers, advisories: evt.advisories, relPath: evt.relPath });
    case 'auto_repair':       return fmt({ blockers: evt.blockers, error: evt.error });
    default: return '';
  }
}

function EventRow({ evt }) {
  const meta = TYPE_META[evt.type] || { iconName: 'bullet', label: evt.type, cls: '' };
  const [open, setOpen] = useState(false);
  const detail = detailOf(evt);
  const summary = summarize(evt);
  const interactive = !!detail;
  return (
    <div
      className={`evt ${meta.cls} ${interactive ? 'evt-clickable' : ''}`}
      onClick={() => interactive && setOpen((o) => !o)}
    >
      <span className="evt-icon"><Icon name={meta.iconName} size={13} /></span>
      <span className="evt-label">{meta.label}</span>
      <span className="evt-summary">{summary}</span>
      {interactive && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} className="evt-chev" />}
      {open && detail && <pre className="evt-detail">{detail}</pre>}
    </div>
  );
}

/**
 * 计算事件链摘要：调用了几个工具 / 写了几个文件 / 总耗时。
 */
function summarizeStrip(events) {
  const tools = new Set();
  let writes = 0;
  let chapters = 0;
  let asks = 0;
  let errors = 0;
  let llmMs = 0;
  for (const e of events) {
    if (e.type === 'tool_call') tools.add(e.name);
    if (e.type === 'file_write') writes += 1;
    if (e.type === 'chapter_saved') chapters += 1;
    if (e.type === 'ask_user') asks += 1;
    if (e.type === 'error' || (e.type === 'tool_result' && !e.ok) || e.type === 'agent_giveup') errors += 1;
    if (e.type === 'llm_done' && e.ms) llmMs += e.ms;
  }
  const parts = [];
  if (tools.size) parts.push(`${tools.size} 个工具`);
  if (writes) parts.push(`${writes} 个文件写入`);
  if (chapters) parts.push(`${chapters} 章落盘`);
  if (asks) parts.push(`${asks} 次求证`);
  if (errors) parts.push(`${errors} 个错误`);
  if (llmMs) parts.push(`${(llmMs / 1000).toFixed(1)}s`);
  return parts.length ? parts.join(' · ') : `${events.length} 条事件`;
}

/**
 * 渲染挂在 assistant 气泡下方的事件链（默认折叠为单行 chip）。
 * - events: 已经按 turn 分好组的本回合事件
 * - filter: 是否隐藏 token / reasoning（默认隐藏）
 */
export default function ToolEventStrip({ events }) {
  const [open, setOpen] = useState(false);
  const visible = (events || []).filter((e) =>
    e.type !== 'token'
    && e.type !== 'reasoning'
    && e.type !== 'turn_start'
    && e.type !== 'turn_end'
    && e.type !== 'start'
    && e.type !== 'user_send'
    && e.type !== 'done'
  );
  if (visible.length === 0) return null;
  const summary = summarizeStrip(visible);
  const hasError = visible.some((e) => e.type === 'error' || (e.type === 'tool_result' && !e.ok) || e.type === 'agent_giveup');
  return (
    <div className={`tool-strip ${open ? 'open' : ''} ${hasError ? 'has-error' : ''}`}>
      <button className="tool-strip-chip" onClick={() => setOpen((o) => !o)}>
        <Icon name={hasError ? 'warn' : 'tool'} size={13} className="tool-strip-ico" />
        <span className="tool-strip-summary">{summary}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="tool-strip-chev" />
      </button>
      {open && (
        <div className="tool-strip-list">
          {visible.map((e, i) => <EventRow key={i} evt={e} />)}
        </div>
      )}
    </div>
  );
}
