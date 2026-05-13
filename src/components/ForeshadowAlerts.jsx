import React, { useEffect, useState, useCallback } from 'react';
import Icon from './Icon.jsx';

export default function ForeshadowAlerts({ open, onClose, project }) {
  const [data, setData] = useState({ alerts: null, ledger: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/foreshadow-alerts?project=${encodeURIComponent(project)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setData(d || { alerts: null, ledger: null });
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, [project]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const onScan = async () => {
    if (!project || scanning) return;
    setScanning(true);
    setErr(null);
    try {
      const r = await fetch('/api/foreshadow-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setScanning(false);
    }
  };

  if (!open) return null;

  return (
    <div className="side-panel-mask" onClick={onClose}>
      <div className="side-panel" onClick={(e) => e.stopPropagation()}>
        <div className="side-panel-head">
          <Icon name="warn" size={16} />
          <span>伏笔预警</span>
          {project && <span className="dash-stat">· {project}</span>}
          <span className="spacer" />
          <button
            className="btn-ghost"
            disabled={scanning || busy}
            onClick={onScan}
            style={{ marginRight: 8 }}
          >
            {scanning ? '扫描中…' : '重建总账'}
          </button>
          <button className="close-x" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {err && <div className="side-err">{err}</div>}
        <div className="foreshadow-body">
          {busy && !data.alerts && !data.ledger && <div className="side-empty">加载中…</div>}
          {!busy && !data.alerts && !data.ledger && !err && (
            <div className="side-empty">
              暂无伏笔总账。<br />
              <span style={{ fontSize: 12 }}>使用伏笔扫描后会生成 <code>knowledge/foreshadow.md</code> 与 <code>progress/foreshadow-alerts.md</code>。</span>
            </div>
          )}
          {data.alerts && (
            <section>
              <h4><Icon name="warn" size={12} /> 当前预警</h4>
              <pre className="md-raw">{data.alerts}</pre>
            </section>
          )}
          {data.ledger && (
            <section>
              <h4><Icon name="file" size={12} /> 伏笔总账</h4>
              <pre className="md-raw">{data.ledger}</pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
