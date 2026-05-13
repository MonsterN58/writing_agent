import React, { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import Icon from './Icon.jsx';

marked.setOptions({ breaks: true, gfm: true });

// 【D1】行级 diff（LCS DP）。规模过大时降级为只标记新增/删除段落。
function diffLines(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  const n = a.length, m = b.length;
  if (n + m > 4000) {
    // 降级：只取 set 差集，标记新增/删除（非顺序敏感）
    const setA = new Map();
    a.forEach((l) => setA.set(l, (setA.get(l) || 0) + 1));
    const out = [];
    for (const line of b) {
      const cnt = setA.get(line) || 0;
      if (cnt > 0) { out.push({ type: 'eq', text: line }); setA.set(line, cnt - 1); }
      else out.push({ type: 'add', text: line });
    }
    for (const [line, cnt] of setA.entries()) {
      for (let i = 0; i < cnt; i++) out.push({ type: 'del', text: line });
    }
    return out;
  }
  // 标准 LCS DP
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'eq', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

function diffStats(rows) {
  let add = 0, del = 0;
  for (const r of rows) { if (r.type === 'add') add++; else if (r.type === 'del') del++; }
  return { add, del };
}

export default function Preview({ path, content, project, onFeedbackSaved, onRefresh, onContentSaved }) {
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [viewing, setViewing] = useState(null); // {relPath, content}
  const [diffMode, setDiffMode] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackState, setFeedbackState] = useState('');
  const [sceneType, setSceneType] = useState('general');
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState('');
  const [copiedFull, setCopiedFull] = useState(false);

  // 重置 viewing 当主路径变化
  useEffect(() => {
    setViewing(null);
    setShowVersions(false);
    setDiffMode(false);
    setEditMode(false);
    setDraft(content || '');
    setSaveState('');
    if (!project || !path) return;
    fetch(`/api/versions?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((list) => Array.isArray(list) && setVersions(list))
      .catch(() => setVersions([]));
  }, [project, path, content]);

  const displayed = viewing || { relPath: path, content };
  const isEditable = !viewing && /\.(md|markdown|txt|json|ya?ml)$/i.test(path || '');
  const parsedFm = useMemo(() => parseDocFrontmatter(displayed.content), [displayed.content]);
  const html = useMemo(() => {
    if (!displayed.content) return '';
    if (displayed.relPath?.endsWith('.md')) return marked.parse(displayed.content);
    return null;
  }, [displayed.relPath, displayed.content]);

  // 【D1】当前正在看历史版本 → 计算 diff（vs 正稿）
  const diffRows = useMemo(() => {
    if (!viewing || !diffMode) return null;
    return diffLines(viewing.content || '', content || '');
  }, [viewing, diffMode, content]);
  const diffMeta = diffRows ? diffStats(diffRows) : null;

  const openVersion = async (vRelPath) => {
    if (!project) return;
    const r = await fetch(`/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(vRelPath)}`);
    if (!r.ok) return;
    const { content } = await r.json();
    setViewing({ relPath: vRelPath, content });
    setShowVersions(false);
  };

  const rollbackTo = async (vRelPath) => {
    if (!project || !path) return;
    if (!confirm(`确定把 ${path} 回滚到 ${vRelPath}？\n（当前版本会先自动备份）`)) return;
    try {
      const r = await fetch('/api/rollback', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, target: path, from: vRelPath }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'rollback failed');
      setViewing(null);
      onRefresh?.();
      alert(`已回滚 ${path}\n来源：${vRelPath}\n原正稿已备份。`);
    } catch (e) { alert('回滚失败：' + String(e.message || e)); }
  };

  const backupNow = async () => {
    if (!project || !path) return;
    try {
      const r = await fetch('/api/backup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, path }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'backup failed');
      // 刷新版本列表
      const lr = await fetch(`/api/versions?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`);
      if (lr.ok) setVersions(await lr.json());
      alert(`已备份到 ${d.backupRelPath}`);
    } catch (e) { alert('备份失败：' + String(e.message || e)); }
  };

  const saveDraft = async () => {
    if (!project || !path || !isEditable) return;
    setSaveState('saving');
    try {
      const r = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, path, content: draft }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '保存失败');
      setSaveState(`已保存${d.backupRelPath ? `，备份：${d.backupRelPath}` : ''}`);
      setEditMode(false);
      onContentSaved?.(draft);
      onRefresh?.();
    } catch (e) {
      setSaveState(String(e.message || e));
    }
  };

  const isChapter = /^chapters\/第\d+章-.+\.md$/.test(displayed.relPath || '');
  const chapterNumber = Number((displayed.relPath || '').match(/^chapters\/第(\d+)章-/)?.[1] || 0) || null;

  const selectedSnippet = () => {
    const s = typeof window !== 'undefined' ? String(window.getSelection?.() || '').trim() : '';
    if (s.length >= 20) return s;
    return String(displayed.content || '').replace(/^#.+$/m, '').trim().slice(0, 1000);
  };

  const sendFeedback = async (kind, text, extra = {}) => {
    if (!project || !displayed.relPath) return;
    const feedback = (text || feedbackText || '').trim();
    if (!feedback) return;
    setFeedbackState('saving');
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project,
          chapter: chapterNumber,
          path: displayed.relPath,
          kind,
          feedback,
          ...extra,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || '反馈保存失败');
      const saved = await r.json();
      setFeedbackState('saved');
      setFeedbackText('');
      onFeedbackSaved?.({ chapter: chapterNumber, kind, relPath: saved.relPath, path: displayed.relPath });
      setTimeout(() => setFeedbackState(''), 1800);
    } catch (e) {
      setFeedbackState(String(e.message || e));
    }
  };

  if (!path) {
    return <div className="preview empty">从左侧文件树点开一个文件</div>;
  }

  return (
    <div className={`preview ${immersive ? 'immersive' : ''}`}>
      <div className="pv-head">
        <span className="pv-path">{displayed.relPath}</span>
        {viewing && (
          <button className="pv-pill" onClick={() => { setViewing(null); setDiffMode(false); }} title="返回当前版本">
            <Icon name="chevronLeft" size={11} /> 当前版本
          </button>
        )}
        {viewing && (
          <button
            className={`pv-pill ${diffMode ? 'pv-pill-active' : ''}`}
            onClick={() => setDiffMode((d) => !d)}
            title="对比此历史版本与当前正稿"
          >
            {diffMode
              ? <>📄 看全文</>
              : <>🔍 vs 当前 {diffMeta ? <span className="pv-diff-stat">+{diffMeta.add} -{diffMeta.del}</span> : null}</>
            }
          </button>
        )}
        {versions.length > 0 && !viewing && (
          <div className="pv-versions">
            <button className="pv-pill" onClick={() => setShowVersions((s) => !s)}>
              <Icon name="history" size={11} /> 历史版本 ({versions.length})
            </button>
            {showVersions && (
              <div className="pv-versions-menu">
                {versions.map((v) => (
                  <div key={v.file} className="pv-ver-item">
                    <span className="pv-ver-file" onClick={() => openVersion(v.relPath)} title="预览此版本">
                      {v.file}
                    </span>
                    <span className="pv-ver-size">{v.size} 字</span>
                    <button
                      className="pv-ver-rollback"
                      onClick={(e) => { e.stopPropagation(); rollbackTo(v.relPath); }}
                      title="回滚正稿到此版本（自动备份当前）"
                    >
                      回滚
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!viewing && (displayed.content || '').length > 0 && (
          <button
            className={`pv-pill pv-copyall${copiedFull ? ' copied' : ''}`}
            onClick={() => {
              try {
                navigator.clipboard?.writeText(displayed.content || '');
                setCopiedFull(true);
                setTimeout(() => setCopiedFull(false), 1500);
              } catch {}
            }}
            title="复制全文"
          >
            <Icon name="copy" size={11} /> {copiedFull ? '已复制' : '复制全文'}
          </button>
        )}
        {!viewing && path && (
          <button className="pv-pill" onClick={backupNow} title="把当前版本备份到 versions/">
            💾 备份
          </button>
        )}
        {isEditable && (
          <button className={`pv-pill ${editMode ? 'pv-pill-active' : ''}`} onClick={() => { setDraft(content || ''); setEditMode((x) => !x); }} title="编辑当前文档并保存">
            <Icon name="pen" size={11} /> {editMode ? '预览' : '编辑'}
          </button>
        )}
        {viewing && (
          <button className="pv-pill" onClick={() => rollbackTo(viewing.relPath)} title="把正稿覆盖为此历史版本">
            ⤺ 回滚到此版本
          </button>
        )}
        <button className="pv-pill" onClick={() => setImmersive((i) => !i)} title="沉浸模式">
          <Icon name={immersive ? 'collapse' : 'expand'} size={11} /> {immersive ? '退出' : '沉浸'}
        </button>
        {isChapter && !viewing && (
          <button className="pv-pill pv-feedback-btn" onClick={() => setFeedbackOpen((s) => !s)} title="把这章的阅读反馈写入风格记忆">
            <Icon name="feedback" size={11} /> 反馈
          </button>
        )}
      </div>
      {!editMode && parsedFm.meta && (
        <div className="pv-meta">
          {Object.entries(parsedFm.meta).slice(0, 18).map(([k, v]) => (
            <div key={k} className="pv-meta-row">
              <span className="pv-meta-key">{k}</span>
              <span className="pv-meta-val">{formatMetaValue(v)}</span>
            </div>
          ))}
        </div>
      )}
      {saveState && <div className="pv-save-state">{saveState}</div>}
      {isChapter && !viewing && feedbackOpen && (
        <div className="pv-feedback">
          <div className="pv-feedback-row">
            <button onClick={() => sendFeedback('satisfied', '这章整体满意，后续保持这种节奏、密度和文风。')}>满意</button>
            <button onClick={() => sendFeedback('ai_taste', '这章 AI 味偏重：减少抽象抒情、四字词、总结式句子，多用动作和感官细节。')}>AI味重</button>
            <button onClick={() => sendFeedback('logic', '这章逻辑/动机不够顺，需要后续写章更重视因果、人物目标和场景承接。')}>逻辑问题</button>
            <button onClick={() => sendFeedback('style', '这章文风不稳，需要后续统一人物口吻、句式节奏和叙事质感。')}>文风不稳</button>
          </div>
          <div className="pv-feedback-row">
            <select value={sceneType} onChange={(e) => setSceneType(e.target.value)} title="示例所属场景">
              <option value="general">通用</option>
              <option value="action">打斗</option>
              <option value="dialogue">对话</option>
              <option value="introspection">心理</option>
              <option value="cliffhanger">钩子</option>
            </select>
            <button onClick={() => sendFeedback('exemplar_good', '把选中文本/本章开头保存为好范本，后续写同类场景时模仿其节奏、质感和句式。', { sceneType, snippet: selectedSnippet() })}>存好范本</button>
            <button onClick={() => sendFeedback('exemplar_bad', '把选中文本/本章开头保存为反例，后续写同类场景时避开这种表达。', { sceneType, snippet: selectedSnippet() })}>存反例</button>
          </div>
          <div className="pv-feedback-custom">
            <input
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="写一条具体反馈，会保存到 style/feedback.md"
            />
            <button onClick={() => sendFeedback('custom')}>保存</button>
          </div>
          {feedbackState && <div className="pv-feedback-state">{feedbackState === 'saving' ? '保存中…' : feedbackState === 'saved' ? '已保存到风格反馈' : feedbackState}</div>}
        </div>
      )}
      <div className="pv-body">
        {editMode ? (
          <div className="pv-editor">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            <div className="pv-editor-actions">
              <span>{draft.length} 字符</span>
              <button className="btn-ghost" onClick={() => { setDraft(content || ''); setEditMode(false); }}>取消</button>
              <button className="btn-primary" onClick={saveDraft} disabled={saveState === 'saving'}>{saveState === 'saving' ? '保存中…' : '保存'}</button>
            </div>
          </div>
        ) : diffRows ? (
          <div className="pv-diff">
            <div className="pv-diff-head">
              <span>对比：<code>{viewing.relPath}</code> → <code>正稿</code></span>
              <span className="pv-diff-legend">
                <span className="pv-diff-add-tag">+ 正稿新增 {diffMeta.add}</span>
                <span className="pv-diff-del-tag">- 历史版本独有 {diffMeta.del}</span>
              </span>
            </div>
            <pre className="pv-diff-body">
              {diffRows.map((r, idx) => (
                <div key={idx} className={`pv-diff-row pv-diff-${r.type}`}>
                  <span className="pv-diff-marker">{r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '}</span>
                  <span className="pv-diff-text">{r.text || '\u00A0'}</span>
                </div>
              ))}
            </pre>
          </div>
        ) : html != null ? (
          <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="raw">{displayed.content}</pre>
        )}
      </div>
    </div>
  );
}

function parseDocFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text || ''));
  if (!m) return { meta: null };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (mm) meta[mm[1]] = mm[2];
  }
  return { meta };
}

function formatMetaValue(v) {
  if (Array.isArray(v)) return v.join('、');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v ?? '');
}
