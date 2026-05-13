import React from 'react';
import Icon from '../Icon.jsx';

// 把 subagent_start / subagent_done / subagent_enqueue 事件合并为编队视图
export default function SubagentSwarm({ events }) {
  const runners = new Map();
  for (const e of events) {
    if (e.type === 'subagent_enqueue') {
      runners.set(e.role, { role: e.role, status: 'queued' });
    } else if (e.type === 'subagent_start') {
      runners.set(e.role, { ...(runners.get(e.role) || {}), role: e.role, status: 'running', start: e.time });
    } else if (e.type === 'subagent_done') {
      const prev = runners.get(e.role) || { role: e.role };
      runners.set(e.role, { ...prev, status: e.ok ? 'done' : 'error', ms: e.ms, error: e.error });
    }
  }
  const list = Array.from(runners.values());
  if (!list.length) return null;

  return (
    <div className="card-swarm">
      <Icon name="branch" size={12} className="sw-ico" />
      <span className="sw-title">子 Agent 编队 · {list.length}</span>
      <div className="sw-dots">
        {list.map((r) => (
          <span key={r.role} className={`sw-dot sw-${r.status}`} title={`${r.role} · ${r.status}${r.ms ? ` · ${r.ms}ms` : ''}${r.error ? `\n${r.error}` : ''}`}>
            <span className="sw-dot-role">{r.role}</span>
            {r.ms && <span className="sw-dot-ms">{r.ms}ms</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
