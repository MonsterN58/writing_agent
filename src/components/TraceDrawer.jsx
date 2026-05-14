import React, { useEffect, useState, useMemo } from 'react';
import Icon from './Icon.jsx';

// 加载作品的 runs/*.jsonl 列表并可"回放"——按事件的 t(ms) 以 8× 速度重放
export default function TraceDrawer({ open, onClose, project, initialFile }) {
  const [list, setList] = useState([]);
  const [file, setFile] = useState(initialFile || null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [speed, setSpeed] = useState(8);

  useEffect(() => { if (open && initialFile) setFile(initialFile); }, [open, initialFile]);

  useEffect(() => {
    if (!open || !project) return;
    fetch(`/api/traces?project=${encodeURIComponent(project)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((d) => setList(Array.isArray(d) ? d : []))
      .catch((e) => setError(String(e)));
  }, [open, project]);

  useEffect(() => {
    if (!open || !project || !file) { setEvents([]); setReplayIdx(0); return; }
    setLoading(true);
    setError(null);
    const url = `/api/trace?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`;
    fetch(url)
      .then((r) => r.ok ? r.text() : Promise.reject(r))
      .then((txt) => {
        const arr = txt.split('\n').filter(Boolean).map((ln) => {
          try { return JSON.parse(ln); } catch { return null; }
        }).filter(Boolean);
        setEvents(arr);
        setReplayIdx(arr.length); // 默认展示全量
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [open, project, file]);

  // 回放：按 t(ms) 差值逐条推进
  useEffect(() => {
    if (!replaying) return;
    if (replayIdx >= events.length) { setReplaying(false); return; }
    const cur = events[replayIdx];
    const nxt = events[replayIdx + 1];
    const dt = nxt ? Math.max(20, Math.min(2000, ((nxt.t || 0) - (cur.t || 0)) / speed)) : 50;
    const id = setTimeout(() => setReplayIdx((i) => i + 1), dt);
    return () => clearTimeout(id);
  }, [replaying, replayIdx, events, speed]);

  const shown = useMemo(() => events.slice(0, replayIdx), [events, replayIdx]);

  const tEnd = events.length ? (events[events.length - 1].t || 0) : 0;
  const tCur = shown.length ? (shown[shown.length - 1].t || 0) : 0;

  if (!open) return null;
  return (
    <div className="trace-drawer" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="trace-panel">
        <div className="trace-head">
          <Icon name="history" size={14} />
          <span className="trace-title">Trace 回放 · {project || '—'}</span>
          <span className="trace-spacer" />
          {file && (
            <a className="trace-dl" href={`/api/trace?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}&download=1`} download>
              <Icon name="download" size={12} /> 下载
            </a>
          )}
          <button className="ghost-btn" onClick={onClose} title="关闭"><Icon name="close" size={12} /></button>
        </div>
        <div className="trace-body">
          <aside className="trace-list">
            <div className="trace-list-title">runs/</div>
            {list.length === 0 && <div className="trace-empty">{loading ? '加载中…' : '暂无记录'}</div>}
            {list.map((r) => (
              <button key={r.file} className={`trace-item ${r.file === file ? 'active' : ''}`} onClick={() => setFile(r.file)}>
                <div className="trace-item-name">{r.file}</div>
                <div className="trace-item-meta">{r.lines} 行 · {Math.round((r.size || 0) / 1024)}KB</div>
              </button>
            ))}
          </aside>
          <main className="trace-main">
            {error && <div className="trace-err">加载失败：{error}</div>}
            {!file && !error && <div className="trace-hint">选择左侧一条记录开始回放。</div>}
            {file && (
              <>
                <div className="trace-controls">
                  <button className="ghost-btn" onClick={() => { setReplayIdx(0); setReplaying(true); }}>
                    <Icon name="play" size={12} /> 重放
                  </button>
                  <button className="ghost-btn" onClick={() => setReplaying((v) => !v)}>
                    <Icon name={replaying ? 'pause' : 'play'} size={12} /> {replaying ? '暂停' : '继续'}
                  </button>
                  <button className="ghost-btn" onClick={() => setReplayIdx(events.length)}>
                    <Icon name="chevronsDown" size={12} /> 跳到末尾
                  </button>
                  <label className="trace-speed">
                    速度
                    <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                      <option value={1}>1×</option>
                      <option value={4}>4×</option>
                      <option value={8}>8×</option>
                      <option value={16}>16×</option>
                      <option value={64}>64×</option>
                    </select>
                  </label>
                  <span className="trace-progress">
                    {shown.length} / {events.length} 事件 · {(tCur / 1000).toFixed(1)}s / {(tEnd / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="trace-events">
                  {shown.map((e, i) => (
                    <div key={i} className={`trace-event te-${e.type}`}>
                      <span className="te-t">{String((e.t || 0) / 1000).padStart(5, '0').slice(0, 6)}s</span>
                      <span className="te-type">{e.type}</span>
                      <span className="te-body">{summarize(e)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function summarize(e) {
  switch (e.type) {
    case 'user_send': return String(e.text || '').slice(0, 80);
    case 'tool_call': return `${e.name} · ${abbrArgs(e.args)}`;
    case 'tool_result': return `${e.name} · ${e.status === 'recovered' ? 'recovered' : (e.ok ? 'ok' : 'fail')}${e.status ? ` · ${e.status}` : ''}`;
    case 'file_write': return e.relPath || e.path || '';
    case 'chapter_saved': return `第 ${e.chapter} 章 · ${e.title || ''} · ${e.wordCount || '?'}字`;
    case 'token_usage': return `P ${e.prompt} C ${e.completion} cached ${e.cached} (${e.hitRate}%)`;
    case 'intent_route': return `${e.intent} · risk=${e.risk}`;
    case 'acceptance_report': return `${e.passed ? '✅' : '❌'} · ${e.score} 分 · blockers=${e.blockers?.length || 0}`;
    case 'ask_user': return String(e.question || '').slice(0, 80);
    case 'error': return String(e.message || '').slice(0, 80);
    case 'subagent_done': return `${e.role} · ${e.ok ? 'ok' : 'fail'} · ${e.ms}ms`;
    default:
      try { return JSON.stringify(e).slice(0, 100); } catch { return ''; }
  }
}

function abbrArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const keys = Object.keys(args);
  if (!keys.length) return '';
  const k0 = keys[0];
  const v = args[k0];
  const vs = typeof v === 'string' ? v : JSON.stringify(v);
  return `${k0}=${String(vs).slice(0, 40)}`;
}
