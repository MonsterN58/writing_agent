import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon.jsx';

const VERDICT_LABEL = { pass: '通过', needs_polish: '待打磨', rewrite: '需重写' };
const VERDICT_COLOR = {
  pass: 'var(--success)',
  needs_polish: 'var(--warn)',
  rewrite: 'var(--danger)',
};

export default function ChaptersDashboard({ open, onClose, project, onOpenFile }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sortKey, setSortKey] = useState('chapter');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    if (!open || !project) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    fetch(`/api/chapters-dashboard?project=${encodeURIComponent(project)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        return d;
      })
      .then((d) => { if (!cancelled) setRows(Array.isArray(d) ? d : []); })
      .catch((e) => { if (!cancelled) setErr(String(e.message || e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, project]);

  const sorted = useMemo(() => {
    const arr = rows.slice();
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      const s = String(av).localeCompare(String(bv), 'zh-Hans-CN');
      return sortDir === 'asc' ? s : -s;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const stats = useMemo(() => {
    const totalWords = rows.reduce((s, r) => s + (r.wordCount || 0), 0);
    const scored = rows.filter((r) => typeof r.score === 'number');
    const avg = scored.length ? scored.reduce((s, r) => s + r.score, 0) / scored.length : null;
    const verdicts = rows.reduce((m, r) => { if (r.verdict) m[r.verdict] = (m[r.verdict] || 0) + 1; return m; }, {});
    return { totalWords, avg, verdicts, count: rows.length };
  }, [rows]);

  const setSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  if (!open) return null;

  return (
    <div className="side-panel-mask" onClick={onClose}>
      <div className="side-panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="side-panel-head">
          <Icon name="chapter" size={16} />
          <span>章节仪表盘</span>
          {project && <span className="dash-stat">· {project}</span>}
          <span className="dash-stat">{stats.count} 章</span>
          <span className="dash-stat">{stats.totalWords.toLocaleString()} 字</span>
          {stats.avg != null && <span className="dash-stat">均分 {stats.avg.toFixed(1)}</span>}
          <span className="spacer" />
          <button className="close-x" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {err && <div className="side-err">{err}</div>}
        <div className="side-list">
          {busy && rows.length === 0 && <div className="side-empty">加载中…</div>}
          {!busy && rows.length === 0 && !err && (
            <div className="side-empty">还没有章节落盘。<br />写完一章后会自动出现在这里。</div>
          )}
          {rows.length > 0 && (
            <table className="chapter-table">
              <thead>
                <tr>
                  <th onClick={() => setSort('chapter')} style={{ cursor: 'pointer', width: 64 }}>
                    # {sortKey === 'chapter' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th onClick={() => setSort('title')} style={{ cursor: 'pointer' }}>
                    标题 {sortKey === 'title' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th onClick={() => setSort('wordCount')} style={{ cursor: 'pointer', width: 80 }}>
                    字数 {sortKey === 'wordCount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th onClick={() => setSort('score')} style={{ cursor: 'pointer', width: 64 }}>
                    评分 {sortKey === 'score' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th style={{ width: 80 }}>验收</th>
                  <th style={{ width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.chapter}>
                    <td>{r.chapter}</td>
                    <td>{r.title || <span className="muted">（无标题）</span>}</td>
                    <td>{(r.wordCount || 0).toLocaleString()}</td>
                    <td>{r.score != null ? r.score.toFixed(1) : <span className="muted">—</span>}</td>
                    <td>
                      {r.verdict ? (
                        <span
                          className="verdict-pill"
                          style={{ background: VERDICT_COLOR[r.verdict] || 'var(--muted)' }}
                        >
                          {VERDICT_LABEL[r.verdict] || r.verdict}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      {onOpenFile && (
                        <button onClick={() => onOpenFile(r.file)}>打开</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
