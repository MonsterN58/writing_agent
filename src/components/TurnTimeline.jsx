import React, { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import ToolCard from './cards/ToolCard.jsx';
import AcceptanceCard from './cards/AcceptanceCard.jsx';
import ChapterSavedCard from './cards/ChapterSavedCard.jsx';
import RepairCard, { RepairToolCard } from './cards/RepairCard.jsx';
import SubagentSwarm from './cards/SubagentSwarm.jsx';
import IntentBadge from './cards/IntentBadge.jsx';
import SkillsRow from './cards/SkillsRow.jsx';

// 关键节点（默认折叠时仍然可见）
const KEY_KINDS = new Set(['chapter', 'final', 'giveup', 'error', 'acceptance', 'write_preview']);
const COLLAPSE_THRESHOLD = 6;

// 规整事件流：
// 1. tool_call + tool_result（按 id）合并为一张 ToolCard
// 2. subagent_* 合并为一个 SubagentSwarm
// 3. chapter_saved + chapter_score + chapter_critic（按 chapter）合并为 ChapterSavedCard
// 4. acceptance_report → AcceptanceCard（作用于最近那一次 ChapterSavedCard）
// 5. auto_repair / auto_repair_tool → RepairCard
// 6. 其它单项事件：file_write (非 chapter 配套)、review_alert、memory_saved…
export default function TurnTimeline({ events, onOpenFile }) {
  const plan = useMemo(() => planTimeline(events || []), [events]);
  const [expanded, setExpanded] = useState(false);
  if (!plan.items.length && !plan.intent && !plan.skills.routed.length && !plan.skills.loaded.length) return null;

  // 折叠：长 timeline 默认只保留关键节点和最后 2 项；其余收进 chip
  const shouldCollapse = !expanded && plan.items.length > COLLAPSE_THRESHOLD;
  const minorCount = shouldCollapse
    ? plan.items.filter((it, idx) => !KEY_KINDS.has(it.kind) && idx < plan.items.length - 2).length
    : 0;
  const visibleItems = shouldCollapse
    ? plan.items.filter((it, idx) => KEY_KINDS.has(it.kind) || idx >= plan.items.length - 2)
    : plan.items;
  const toolCount = plan.items.filter((it) => it.kind === 'tool').length;
  const fileCount = plan.items.filter((it) => it.kind === 'file').length;

  return (
    <div className="turn-timeline">
      {(plan.intent || plan.skills.routed.length || plan.skills.loaded.length) > 0 && (
        <div className="tt-head">
          {plan.intent && <IntentBadge intent={plan.intent.intent} risk={plan.intent.risk} contextMode={plan.intent.contextMode} />}
          <SkillsRow routed={plan.skills.routed} loaded={plan.skills.loaded} />
        </div>
      )}
      {shouldCollapse && minorCount > 0 && (
        <button className="tt-collapse-chip" onClick={() => setExpanded(true)} type="button">
          <Icon name="chevronsDown" size={11} />
          <span>已隐藏 <strong>{minorCount}</strong> 条过程事件{toolCount > 0 ? ` · ${toolCount} 次工具` : ''}{fileCount > 0 ? ` · ${fileCount} 次写入` : ''}</span>
          <span>· 展开</span>
        </button>
      )}
      {!shouldCollapse && plan.items.length > COLLAPSE_THRESHOLD && (
        <button className="tt-collapse-chip" onClick={() => setExpanded(false)} type="button">
          <Icon name="chevronRight" size={11} />
          <span>收起过程事件</span>
        </button>
      )}
      <div className="tt-list">
        {visibleItems.map((it, i) => {
          if (it.kind === 'tool') {
            return <ToolCard key={`t${i}`} call={it.call} result={it.result} onOpenFile={onOpenFile} />;
          }
          if (it.kind === 'swarm') {
            return <SubagentSwarm key={`s${i}`} events={it.events} />;
          }
          if (it.kind === 'chapter') {
            return (
              <ChapterSavedCard
                key={`ch${i}`}
                saved={it.saved}
                score={it.score}
                critic={it.critic}
                onOpenFile={onOpenFile}
              />
            );
          }
          if (it.kind === 'acceptance') {
            return <AcceptanceCard key={`ac${i}`} report={it.report} onOpenFile={onOpenFile} />;
          }
          if (it.kind === 'repair') {
            return <RepairCard key={`rp${i}`} evt={it.evt} />;
          }
          if (it.kind === 'repair_tool') {
            return <RepairToolCard key={`rpt${i}`} evt={it.evt} />;
          }
          if (it.kind === 'alert') {
            return (
              <div key={`al${i}`} className="card-alert">
                <Icon name="reviewAlert" size={13} className="al-ico" />
                <span>{it.evt.message || `${it.evt.severity || ''} · ${it.evt.kind || ''}`}</span>
              </div>
            );
          }
          if (it.kind === 'memory') {
            return (
              <div key={`mem${i}`} className="card-note">
                <Icon name="memory" size={12} /> <span>长期记忆：{it.evt.kind} · {it.evt.summary || ''}</span>
              </div>
            );
          }
          if (it.kind === 'feedback') {
            return (
              <div key={`fb${i}`} className="card-note">
                <Icon name="feedback" size={12} /> <span>风格样例：{it.evt.polarity} · {it.evt.relPath || ''}</span>
              </div>
            );
          }
          if (it.kind === 'skill_save') {
            return (
              <div key={`sk${i}`} className="card-note">
                <Icon name="skill" size={12} /> <span>新技能：{it.evt.name || it.evt.relPath || ''}</span>
              </div>
            );
          }
          if (it.kind === 'final') {
            return (
              <div key={`fn${i}`} className={`card-final ${it.evt.status === 'failed' ? 'card-final-failed' : it.evt.status === 'awaiting_user' ? 'card-final-wait' : ''}`}>
                <Icon name="done" size={13} />
                <div className="card-final-body">
                  <strong>{it.evt.summary || '已完成'}</strong>
                  {it.evt.issues?.length > 0 && (
                    <ul className="card-final-list">
                      {it.evt.issues.slice(0, 3).map((x, j) => <li key={j}>{x}</li>)}
                    </ul>
                  )}
                  {it.evt.pendingTasks?.length > 0 && (
                    <div className="card-final-pending">尚未完成：{it.evt.pendingTasks.slice(0, 3).map((t) => t.title || t.summary || t.id).join('；')}</div>
                  )}
                  {it.evt.artifacts?.length > 0 && (
                    <div className="card-final-paths">
                      {it.evt.artifacts.slice(0, 4).map((a, j) => (
                        <button
                          key={j}
                          className="card-note-open"
                          disabled={!a.path || !onOpenFile}
                          onClick={() => a.path && onOpenFile && onOpenFile(a.path)}
                        >
                          {a.path || a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          }
          if (it.kind === 'file') {
            return (
              <div key={`f${i}`} className="card-note">
                <Icon name="fileWrite" size={12} />
                <span>{it.evt.relPath || it.evt.path}</span>
                {onOpenFile && (it.evt.relPath || it.evt.path) && (
                  <button className="card-note-open" onClick={() => onOpenFile(it.evt.relPath || it.evt.path)}>查看</button>
                )}
              </div>
            );
          }
          if (it.kind === 'giveup') {
            return (
              <div key={`gv${i}`} className="card-giveup">
                <Icon name="giveup" size={13} />
                <div className="card-giveup-body">
                  <strong>Agent 已暂停</strong>
                  <span>{it.evt.summary || it.evt.reason || '为避免误操作，我先保留现场。'}</span>
                  {it.evt.issue?.hint && <em>{it.evt.issue.hint}</em>}
                  {it.evt.options?.length > 0 && <div className="card-giveup-options">{it.evt.options.slice(0, 4).join(' / ')}</div>}
                </div>
              </div>
            );
          }
          if (it.kind === 'auto') {
            return (
              <div key={`au${i}`} className="card-auto">
                <Icon name="turnStart" size={12} />
                <span>自动续轮 · {it.evt.reason || ''}{it.evt.tool ? ` · ${it.evt.tool}` : ''}</span>
              </div>
            );
          }
          if (it.kind === 'stuck') {
            return (
              <div key={`st${i}`} className="card-auto card-auto-warn">
                <Icon name="reviewAlert" size={12} />
                <span>检测到卡住：{it.evt.reason || 'unknown'}，正在重规划。</span>
              </div>
            );
          }
          if (it.kind === 'write_preview') {
            return (
              <div key={`wp${i}`} className="card-write-preview">
                <Icon name="fileWrite" size={13} />
                <div>
                  <strong>{it.evt.target === 'chapter' ? `写入预览 · 第 ${it.evt.chapter} 章` : `编辑预览 · ${it.evt.path}`}</strong>
                  <span>{it.evt.mode === 'overwrite' ? '覆盖已有文件' : '新建/写入'}{it.evt.wordCount ? ` · ${it.evt.wordCount} 字` : ''}{it.evt.delta != null ? ` · Δ${it.evt.delta}` : ''}</span>
                  {it.evt.preview && <p>{it.evt.preview}</p>}
                </div>
              </div>
            );
          }
          if (it.kind === 'error') {
            return (
              <div key={`er${i}`} className="card-error">
                <Icon name="error" size={13} /> <span>错误 · {it.evt.message}</span>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function planTimeline(events) {
  const items = [];
  const toolById = new Map(); // tc.id → index in items
  const subagentEvents = [];
  let swarmIdx = -1;
  const chapterIdx = new Map(); // chapter → items index
  const skills = { routed: [], loaded: [] };
  let intent = null;

  for (const e of events) {
    switch (e.type) {
      case 'intent_route':
        intent = { intent: e.intent, risk: e.risk, contextMode: e.contextMode };
        break;
      case 'skill_routed':
        if (Array.isArray(e.skills)) skills.routed.push(...e.skills);
        break;
      case 'skill_load':
        if (e.name) skills.loaded.push(e.name);
        break;
      case 'tool_call': {
        const idx = items.length;
        items.push({ kind: 'tool', call: e, result: null });
        toolById.set(e.id, idx);
        break;
      }
      case 'tool_result': {
        const idx = toolById.get(e.id);
        if (idx != null && items[idx]) items[idx].result = e;
        else items.push({ kind: 'tool', call: null, result: e });
        break;
      }
      case 'subagent_start':
      case 'subagent_done':
      case 'subagent_enqueue':
        subagentEvents.push(e);
        if (swarmIdx < 0) {
          swarmIdx = items.length;
          items.push({ kind: 'swarm', events: subagentEvents });
        } else {
          items[swarmIdx].events = subagentEvents;
        }
        break;
      case 'chapter_saved': {
        const idx = items.length;
        items.push({ kind: 'chapter', saved: e, score: null, critic: null });
        chapterIdx.set(e.chapter, idx);
        break;
      }
      case 'chapter_score': {
        const idx = chapterIdx.get(e.chapter);
        if (idx != null) items[idx].score = e;
        break;
      }
      case 'chapter_critic': {
        const idx = chapterIdx.get(e.chapter);
        if (idx != null) items[idx].critic = e;
        break;
      }
      case 'acceptance_report':
        items.push({ kind: 'acceptance', report: e });
        break;
      case 'auto_repair':
        items.push({ kind: 'repair', evt: e });
        break;
      case 'auto_repair_tool':
        items.push({ kind: 'repair_tool', evt: e });
        break;
      case 'review_alert':
        items.push({ kind: 'alert', evt: e });
        break;
      case 'memory_saved':
        items.push({ kind: 'memory', evt: e });
        break;
      case 'feedback_saved':
        items.push({ kind: 'feedback', evt: e });
        break;
      case 'user_skill_saved':
        items.push({ kind: 'skill_save', evt: e });
        break;
      case 'final_summary':
        items.push({ kind: 'final', evt: e });
        break;
      case 'agent_soft_stop':
        items.push({ kind: 'giveup', evt: e });
        break;
      case 'auto_continue':
      case 'budget_pressure':
        items.push({ kind: 'auto', evt: e });
        break;
      case 'stuck_detected':
        items.push({ kind: 'stuck', evt: e });
        break;
      case 'write_preview':
        items.push({ kind: 'write_preview', evt: e });
        break;
      case 'file_write': {
        // 避免和 chapter/tool 重复：如果前面有同路径的 chapter_saved / tool_call 就跳过
        const path = e.relPath || e.path;
        const exists = items.some((it) =>
          (it.kind === 'chapter' && it.saved?.relPath === path) ||
          (it.kind === 'tool' && it.result?.result?.data?.relPath === path) ||
          (it.kind === 'tool' && it.call?.args?.path === path)
        );
        if (!exists && path) items.push({ kind: 'file', evt: e });
        break;
      }
      case 'agent_giveup':
        items.push({ kind: 'giveup', evt: e });
        break;
      case 'error':
        items.push({ kind: 'error', evt: e });
        break;
      default:
        break;
    }
  }
  return { items, intent, skills };
}
