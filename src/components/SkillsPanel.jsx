import React, { useEffect, useState, useCallback } from 'react';
import Icon from './Icon.jsx';

const EMPTY = {
  name: '', title: '', description: '',
  keywords: '', activate_when: '', activate_after: '',
  priority: 3, body: '',
};

export default function SkillsPanel({ open, onClose, project }) {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null); // null=列表, {...}=编辑态
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [creatorBrief, setCreatorBrief] = useState('');

  const refresh = useCallback(async () => {
    if (!project) return;
    setErr('');
    try {
      const r = await fetch(`/api/user-skills?project=${encodeURIComponent(project)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'load failed');
      setList(Array.isArray(d) ? d : []);
    } catch (e) { setErr(String(e.message || e)); }
  }, [project]);

  useEffect(() => { if (open) { refresh(); setEditing(null); } }, [open, refresh]);

  const startEdit = async (name) => {
    try {
      const r = await fetch(`/api/user-skills/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'load failed');
      setEditing({
        name: d.name,
        title: d.title,
        description: d.description,
        keywords: (d.keywords || []).join(', '),
        activate_when: (d.activate_when || []).join(', '),
        activate_after: (d.activate_after || []).join(', '),
        priority: d.priority,
        body: d.body,
        _isEdit: true,
      });
    } catch (e) { setErr(String(e.message || e)); }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setErr('');
    try {
      const splitCsv = (s) => String(s || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
      const payload = {
        project,
        name: editing.name.trim(),
        title: editing.title.trim() || editing.name.trim(),
        description: editing.description,
        keywords: splitCsv(editing.keywords),
        activate_when: splitCsv(editing.activate_when),
        activate_after: splitCsv(editing.activate_after),
        priority: Number(editing.priority) || 3,
        body: editing.body,
      };
      const r = await fetch('/api/user-skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setEditing(null);
      await refresh();
    } catch (e) { setErr(String(e.message || e)); }
    setSaving(false);
  };

  const onUploadFiles = async (files) => {
    if (!files || !files.length) return;
    setSaving(true); setErr('');
    const results = [];
    try {
      for (const f of files) {
        if (f.size > 4 * 1024 * 1024) { results.push(`${f.name}: 超过 4MB 上限`); continue; }
        const text = await f.text();
        let r = await fetch('/api/user-skills/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, content: text, overwrite: false }),
        });
        let d = await r.json();
        if (r.status === 409) {
          if (!confirm(`${f.name}: ${d.error}\n是否覆盖？`)) { results.push(`${f.name}: 已跳过`); continue; }
          r = await fetch('/api/user-skills/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project, content: text, overwrite: true }),
          });
          d = await r.json();
        }
        if (!r.ok) results.push(`${f.name}: ${d.error || 'upload failed'}`);
        else results.push(`${f.name} → ${d.relPath}`);
      }
      if (results.some((x) => /:\s/.test(x) && !/→/.test(x))) setErr(results.join('\n'));
      await refresh();
    } catch (e) { setErr(String(e.message || e)); }
    setSaving(false);
  };

  const remove = async (name) => {
    if (!confirm(`确定删除 skill "${name}" ？此操作不可撤销。`)) return;
    try {
      const r = await fetch(`/api/user-skills/${encodeURIComponent(name)}?project=${encodeURIComponent(project)}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'delete failed');
      await refresh();
    } catch (e) { setErr(String(e.message || e)); }
  };

  const draftFromBrief = async () => {
    const brief = creatorBrief.trim();
    if (!brief) { setErr('先写一句你想固化成 skill 的规则/流程'); return; }
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/user-skills/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'draft failed');
      setEditing({
        ...d,
        keywords: (d.keywords || []).join(', '),
        activate_when: (d.activate_when || []).join(', '),
        activate_after: (d.activate_after || []).join(', '),
      });
      setCreatorBrief('');
    } catch (e) { setErr(String(e.message || e)); }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div className="side-panel-mask" onClick={onClose}>
      <div className="side-panel" onClick={(e) => e.stopPropagation()}>
        <header className="side-panel-head">
          <Icon name="skill" size={14} />
          <span>我的技能 · {project || '未选作品'}</span>
          <span className="spacer" />
          {!editing && (
            <>
              <label className="btn-ghost" style={{ cursor: 'pointer' }}>
                上传 .md
                <input
                  type="file"
                  accept=".md,.markdown,.txt"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { onUploadFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
                />
              </label>
              <button className="btn-ghost" onClick={() => setCreatorBrief((x) => x || '写章前检查章末钩子和小高潮密度，避免平推。')}>草稿器</button>
              <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>+ 新建</button>
            </>
          )}
          <button className="btn-ghost close-x" onClick={onClose} aria-label="关闭">×</button>
        </header>

        {err && <div className="side-err">⚠ {err}</div>}
        {!editing && creatorBrief && (
          <div className="skill-creator">
            <textarea
              rows={3}
              value={creatorBrief}
              onChange={(e) => setCreatorBrief(e.target.value)}
              placeholder="一句话描述要固化的流程/偏好，例如：写战斗章时先确认目标、压缩铺垫、章末留危机钩。"
            />
            <div className="skill-creator-actions">
              <button className="btn-ghost" onClick={() => setCreatorBrief('')}>取消</button>
              <button className="btn-primary" disabled={saving} onClick={draftFromBrief}>{saving ? '生成中…' : '生成 skill 草稿'}</button>
            </div>
          </div>
        )}

        {!editing ? (
          <div className="side-list">
            {list.length === 0 ? (
              <div className="side-empty">
                还没有自定义技能。<br />
                技能会按 <code>keywords</code> / <code>activate_when</code> 自动加载，
                把"反复强调的写作偏好"固化下来，下次就不用再重复。
              </div>
            ) : list.map((s) => (
              <div key={s.name} className="side-row">
                <div className="side-row-main">
                  <div className="side-row-title">
                    <strong>{s.title}</strong>
                    <code>{s.name}</code>
                    <span className="prio">P{s.priority}</span>
                  </div>
                  {s.description && <div className="side-row-desc">{s.description}</div>}
                  {(s.keywords?.length > 0) && (
                    <div className="side-row-kw">
                      <span className="kw-label">关键词：</span>
                      {s.keywords.slice(0, 8).map(k => <span key={k} className="chip">{k}</span>)}
                    </div>
                  )}
                </div>
                <div className="side-row-actions">
                  <button onClick={() => startEdit(s.name)}>编辑</button>
                  <button className="btn-danger" onClick={() => remove(s.name)}>删</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="side-form">
            <div className="row">
              <label>name <small>(2-41 位小写字母/数字/连字符)</small></label>
              <input value={editing.name} disabled={editing._isEdit}
                placeholder="my-style-rule"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="row">
              <label>标题</label>
              <input value={editing.title} placeholder="一句话名字"
                onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div className="row">
              <label>描述 <small>(给 agent 看的简介)</small></label>
              <input value={editing.description} placeholder="一句话用途"
                onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="row two">
              <div>
                <label>关键词 <small>(命中即加载，逗号分隔)</small></label>
                <input value={editing.keywords} placeholder="文风, 破折号, AI味"
                  onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} />
              </div>
              <div>
                <label>优先级 1-5</label>
                <input type="number" min={1} max={5} value={editing.priority}
                  onChange={(e) => setEditing({ ...editing, priority: e.target.value })} />
              </div>
            </div>
            <div className="row two">
              <div>
                <label>activate_when <small>(某工具前)</small></label>
                <input value={editing.activate_when} placeholder="write_chapter, chapter-planner"
                  onChange={(e) => setEditing({ ...editing, activate_when: e.target.value })} />
              </div>
              <div>
                <label>activate_after <small>(某工具后)</small></label>
                <input value={editing.activate_after} placeholder="write_chapter"
                  onChange={(e) => setEditing({ ...editing, activate_after: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <label>正文 (Markdown)</label>
              <textarea rows={14} value={editing.body}
                placeholder={'# 标题\n\n## 触发\n\n## 流程\n'}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </div>
            <div className="form-actions">
              <button className="btn-ghost" onClick={() => setEditing(null)}>返回</button>
              <button className="btn-primary" disabled={saving || !editing.name.trim()} onClick={save}>
                {saving ? '保存中…' : (editing._isEdit ? '保存修改' : '创建 skill')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
