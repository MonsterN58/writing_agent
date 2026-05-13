import React, { useState } from 'react';
import Icon from '../Icon.jsx';

const DIM_LABEL = {
  opening_hook: '开头钩子',
  scene_logic: '场景逻辑',
  dialogue_voice: '人物对白',
  anti_ai: '反 AI 味',
  consistency_proxy: '设定一致',
  ending_hook: '章末钩子',
  transition: '段际/章际衔接',
};

function ScoreBar({ label, value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const cls = v >= 80 ? 'sb-good' : v >= 60 ? 'sb-mid' : 'sb-low';
  return (
    <div className={`score-bar ${cls}`} title={`${label} ${v}/100`}>
      <span className="sb-label">{label}</span>
      <span className="sb-track"><span className="sb-fill" style={{ width: `${v}%` }} /></span>
      <span className="sb-num">{v}</span>
    </div>
  );
}

function RadarChart({ dims, size = 180 }) {
  const entries = Object.entries(dims || {});
  if (!entries.length) return null;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 28;
  const n = entries.length;
  const angleFor = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointAt = (i, r) => [
    cx + Math.cos(angleFor(i)) * r,
    cy + Math.sin(angleFor(i)) * r,
  ];

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const valuePoints = entries.map(([, v], i) => {
    const ratio = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    return pointAt(i, radius * ratio);
  });
  const valuePath = valuePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z';

  return (
    <svg className="cc-radar" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {/* 网格圆 */}
      {gridLevels.map((lvl, gi) => (
        <polygon
          key={gi}
          className="cc-radar-grid"
          points={entries.map((_, i) => {
            const [x, y] = pointAt(i, radius * lvl);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ')}
        />
      ))}
      {/* 轴线 */}
      {entries.map((_, i) => {
        const [x, y] = pointAt(i, radius);
        return (
          <line
            key={`axis-${i}`}
            className="cc-radar-axis"
            x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)}
          />
        );
      })}
      {/* 数据多边形 */}
      <path className="cc-radar-fill" d={valuePath} />
      {valuePoints.map((p, i) => (
        <circle key={`pt-${i}`} className="cc-radar-pt" cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r={2.5} />
      ))}
      {/* 标签 */}
      {entries.map(([k], i) => {
        const [x, y] = pointAt(i, radius + 14);
        const label = DIM_LABEL[k] || k;
        return (
          <text
            key={`lbl-${i}`}
            className="cc-radar-label"
            x={x.toFixed(1)}
            y={y.toFixed(1)}
            textAnchor={Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end'}
            dominantBaseline={Math.abs(y - cy) < 8 ? 'middle' : y > cy ? 'hanging' : 'auto'}
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

export default function ChapterSavedCard({ saved, score, critic, onOpenFile }) {
  const [view, setView] = useState('bars'); // 'bars' | 'radar'
  if (!saved) return null;
  const dims = score?.dimensions || {};
  const total = score?.total;
  const verdictCls = critic?.verdict === 'pass' ? 'cv-ok' : critic?.verdict === 'needs_polish' ? 'cv-mid' : critic?.verdict === 'rewrite' ? 'cv-err' : '';
  const verdictLabel = { pass: '通过', needs_polish: '待打磨', rewrite: '需重写' }[critic?.verdict] || critic?.verdict;
  const dimCount = Object.keys(dims).length;
  const canRadar = dimCount >= 3;

  return (
    <div className="card-chapter">
      <div className="card-chapter-head">
        <Icon name="chapter" size={14} className="cc-ico" />
        <span className="cc-title">第 {saved.chapter} 章 · {saved.title || '无标题'}</span>
        <span className="cc-spacer" />
        {typeof saved.wordCount === 'number' && <span className="cc-word">{saved.wordCount} 字</span>}
        {typeof total === 'number' && <span className={`cc-total ${verdictCls}`}>{total}</span>}
        {critic?.verdict && <span className={`cc-verdict ${verdictCls}`}>{verdictLabel}</span>}
        {canRadar && (
          <button
            type="button"
            className="cc-view-toggle"
            onClick={() => setView((v) => (v === 'bars' ? 'radar' : 'bars'))}
            title={view === 'bars' ? '切换雷达图' : '切换柱状图'}
            aria-label="切换打分视图"
          >
            <Icon name={view === 'bars' ? 'sparkles' : 'chevron-right'} size={11} />
            <span>{view === 'bars' ? '雷达' : '柱状'}</span>
          </button>
        )}
      </div>
      {dimCount > 0 && view === 'bars' && (
        <div className="card-chapter-dims">
          {Object.entries(dims).map(([k, v]) => (
            <ScoreBar key={k} label={DIM_LABEL[k] || k} value={v} />
          ))}
        </div>
      )}
      {dimCount > 0 && view === 'radar' && (
        <div className="card-chapter-radar">
          <RadarChart dims={dims} />
        </div>
      )}
      {(critic?.issues?.length || 0) > 0 && (
        <details className="card-chapter-issues">
          <summary>问题 · {critic.issues.length} 条</summary>
          <ul>
            {critic.issues.slice(0, 8).map((it, i) => (
              <li key={i} className={`issue-${it.severity || 'low'}`}>
                <span className="issue-sev">{it.severity || '-'}</span>
                <span className="issue-kind">{it.kind || ''}</span>
                <span className="issue-text">{it.problem}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {saved.relPath && onOpenFile && (
        <button className="cc-open" onClick={() => onOpenFile(saved.relPath)}>
          <Icon name="eye" size={11} /> 打开 {saved.relPath}
        </button>
      )}
    </div>
  );
}
