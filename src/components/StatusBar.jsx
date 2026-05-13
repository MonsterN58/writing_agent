import React, { useMemo } from 'react';
import Icon from './Icon.jsx';
import { useHudState } from './StatusHUD.jsx';

/**
 * v5 底部 status bar：薄条，展示 project / mode / model / turn / token / cost / running 心跳。
 * 点击 trace 按钮可打开 TraceDrawer；点击 cost 区域弹完整 HUD。
 */
function fmtNum(n) {
  if (n == null) return '?';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function fmtUSD(v) {
  if (v == null) return '—';
  if (v < 0.01) return '<$0.01';
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

const MODE_LABEL = {
  flash: '极速',
  pro: '标准',
  writer: '写作',
  ultra: '深思',
  cheap: '极速',
  default: '标准',
};

export default function StatusBar({
  project,
  mode,
  events,
  busy,
  files,
  onOpenTrace,
  onOpenCmdK,
}) {
  const s = useHudState(events);
  const fileCount = files?.length || 0;
  const chapterCount = useMemo(() => {
    if (!files) return 0;
    return files.filter((f) => /^chapters\//.test(f.relPath || f.path || '')).length;
  }, [files]);

  const cacheColor = s.hitRate == null
    ? ''
    : s.hitRate >= 80 ? 'sb-cache-good'
    : s.hitRate >= 50 ? 'sb-cache-mid'
    : 'sb-cache-low';

  return (
    <div className="v5-statusbar" role="status" aria-label="状态栏">
      {/* 左：状态心跳 + 项目 */}
      <span className={`sb-dot ${busy ? 'busy' : (s.running ? 'busy' : 'idle')}`} aria-hidden />
      <span className="sb-item" title="当前作品">
        <Icon name="folder" size={11} />
        <span>{project || '未选作品'}</span>
      </span>
      <span className="sb-sep" />
      <span className="sb-item" title="当前模式">
        <span>{MODE_LABEL[mode] || mode || 'pro'}</span>
      </span>
      {chapterCount > 0 && (
        <>
          <span className="sb-sep" />
          <span className="sb-item" title="章节数">
            <span>{chapterCount} 章</span>
          </span>
        </>
      )}

      <span className="sb-spacer" />

      {/* 中右：model / turn / token / cost / trace */}
      {s.model && (
        <span className="sb-item" title={`模型 ${s.model}${s.profile ? ' · ' + s.profile : ''}`}>
          <Icon name="cpu" size={11} />
          <span>{s.model}</span>
        </span>
      )}
      {s.turn > 0 && (
        <>
          <span className="sb-sep" />
          <span className="sb-item" title={`第 ${s.turn} 轮${s.maxTurns ? ' / ' + s.maxTurns : ''}`}>
            <span>T{s.turn}{s.maxTurns ? `/${s.maxTurns}` : ''}</span>
          </span>
        </>
      )}
      {s.prompt > 0 && (
        <>
          <span className="sb-sep" />
          <span
            className={`sb-item ${cacheColor}`}
            title={`prompt ${fmtNum(s.prompt)} · completion ${fmtNum(s.completion)} · cached ${fmtNum(s.cached)} (${s.hitRate == null ? '—' : s.hitRate + '%'})`}
          >
            <span>{fmtNum(s.prompt + s.completion)} tok</span>
          </span>
        </>
      )}
      {s.cost != null && (
        <>
          <span className="sb-sep" />
          <span className="sb-item sb-cost" title="累计估算成本（仅供参考）">
            <Icon name="coins" size={11} />
            <span>{fmtUSD(s.cost)}</span>
          </span>
        </>
      )}
      {s.tracePath && (
        <>
          <span className="sb-sep" />
          <button
            className="sb-item clickable sb-trace"
            onClick={() => onOpenTrace?.(s.tracePath)}
            title="打开当前 trace"
          >
            <Icon name="download" size={11} />
            <span>trace</span>
          </button>
        </>
      )}
      {onOpenCmdK && (
        <>
          <span className="sb-sep" />
          <button
            className="sb-item clickable"
            onClick={onOpenCmdK}
            title="命令面板 ⌘/Ctrl+K"
          >
            <Icon name="brand" size={11} />
            <span>⌘K</span>
          </button>
        </>
      )}
    </div>
  );
}
