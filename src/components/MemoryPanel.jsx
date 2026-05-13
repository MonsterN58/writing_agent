import React, { useEffect, useState, useCallback } from 'react';
import Icon from './Icon.jsx';

const KIND_LABELS = {
  character_voice: '人物口吻',
  user_preference: '用户偏好',
  hard_constraint: '硬约束',
  recurring_mistake: '反复踩坑',
  world_rule: '世界规则',
  note: '备注',
};

const EMPTY = { kind: 'user_preference', key: '', value: '', priority: 3, tags: '' };

export default function MemoryPanel({ open, onClose, project }) {
  const [items, setItems] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    if (!project) return;
    setErr('');
    try {
      const r = await fetch(`/api/memories?project=${encodeURIComponent(project)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'load failed');
      setItems(Array.isArray(d.items) ? d.items : []);
      setKinds(Array.isArray(d.kinds) ? d.kinds : Object.keys(KIND_LABELS));
    } catch (e) { setErr(String(e.message || e)); }
  }, [project]);

  useEffect(() => { if (open) { refresh(); setEditing(null); } }, [open, refresh]);

  const save = async () => {
    if (!editing) return;
    setSaving(true); setErr('');
    try {
      const tags = String(editing.tags || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
      const r = await fetch('/api/memories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          kind: editing.kind, key: editing.key.trim(), value: editing.value,
          priority: Number(editing.priority) || 3, tags,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setEditing(null);
      await refresh();
    } catch (e) { setErr(String(e.message || e)); }
    setSaving(false);
  };

  const remove = async (kind, key) => {
    if (!confirm(`删除记忆 ${kind} / ${key} ？`)) return;
    try {
      const r = await fetch(`/api/memories?project=${encodeURIComponent(project)}&kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'delete failed');
      await refresh();
    } catch (e) { setErr(String(e.message || e)); }
  };

  if (!open) return null;

  return (
    <div className="side-panel-mask" onClick={onClose}>
      <div className="side-panel" onClick={(e) => e.stopPropagation()}>
        <header className="side-panel-head">
          <Icon name="memory" size={14} />
          <span>长期记忆 · {project || '未选作品'}</span>
          <span className="spacer" />
          {!editing && <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>+ 新建</button>}
          <button className="btn-ghost close-x" onClick={onClose}>×</button>
        </header>

        {err && <div className="side-err">⚠ {err}</div>}

        {!editing ? (
          <div className="side-list">
            {items.length === 0 ? (
              <div className="side-empty">
                还没有长期记忆。<br />
                硬约束 / 人物口吻 / 反复踩过的坑会被自动注入系统 prompt，防止 agent 犯老毛病。
              </div>
            ) : items.map((m) => (
              <div key={`${m.kind}|${m.key}`} className="side-row">
                <div className="side-row-main">
                  <div className="side-row-title">
                    <span className="kind-badge">{KIND_LABELS[m.kind] || m.kind}</span>
                    <strong>{m.key}</strong>
                    <span className="prio">{'★'.repeat(m.priority || 1)}</span>
                  </div>
                  <div className="side-row-desc">{m.value}</div>
                  {m.tags?.length > 0 && (
                    <div className="side-row-kw">
                      {m.tags.map(t => <span key={t} className="chip">{t}</span>)}
                    </div>
                  )}
                </div>
                <div className="side-row-actions">
                  <button className="btn-danger" onClick={() => remove(m.kind, m.key)}>删</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="side-form">
            <div className="row two">
              <div>
                <label>类型</label>
                <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                  {kinds.map(k => <option key={k} value={k}>{KIND_LABELS[k] || k}</option>)}
                </select>
              </div>
              <div>
                <label>优先级 1-5</label>
                <input type="number" min={1} max={5} value={editing.priority}
                  onChange={(e) => setEditing({ ...editing, priority: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <label>key <small>(唯一标识，同 kind+key 会覆盖)</small></label>
              <input value={editing.key} placeholder="例：沈渊说话的口吻"
                onChange={(e) => setEditing({ ...editing, key: e.target.value })} />
            </div>
            <div className="row">
              <label>value <small>(具体内容)</small></label>
              <textarea rows={5} value={editing.value} placeholder="例：冷，短句，偶尔一个词就是一段"
                onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
            </div>
            <div className="row">
              <label>tags <small>(可选，逗号分隔)</small></label>
              <input value={editing.tags} placeholder="主角, 对话"
                onChange={(e) => setEditing({ ...editing, tags: e.target.value })} />
            </div>
            <div className="form-actions">
              <button className="btn-ghost" onClick={() => setEditing(null)}>返回</button>
              <button className="btn-primary" disabled={saving || !editing.key.trim() || !editing.value.trim()} onClick={save}>
                {saving ? '保存中…' : '保存记忆'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
