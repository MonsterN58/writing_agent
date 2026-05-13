import React from 'react';
import Icon from '../Icon.jsx';

export default function AcceptanceCard({ report, onOpenFile }) {
  if (!report) return null;
  const passed = !!report.passed;
  return (
    <div className={`card-accept ${passed ? 'ac-ok' : 'ac-fail'}`}>
      <div className="ac-head">
        <Icon name={passed ? 'done' : 'reviewAlert'} size={14} className="ac-ico" />
        <span className="ac-title">验收 · {passed ? '✅ 通过' : '❌ 未通过'}</span>
        {typeof report.score === 'number' && <span className="ac-score">{report.score} 分</span>}
        <span className="ac-spacer" />
        {(report.relPath || report.reportPath) && onOpenFile && (
          <button className="ac-open" onClick={() => onOpenFile(report.relPath || report.reportPath)}>
            <Icon name="eye" size={11} /> 报告
          </button>
        )}
      </div>
      {Array.isArray(report.blockers) && report.blockers.length > 0 && (
        <div className="ac-blockers">
          <div className="ac-section-title">阻断项 · {report.blockers.length}</div>
          <ul>{report.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {Array.isArray(report.advisories) && report.advisories.length > 0 && (
        <details className="ac-advisories">
          <summary>建议 · {report.advisories.length}</summary>
          <ul>{report.advisories.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
