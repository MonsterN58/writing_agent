import React from 'react';
import Icon from '../Icon.jsx';

export default function RepairCard({ evt }) {
  if (!evt) return null;
  const failed = evt.ok === false;
  return (
    <div className={`card-repair ${failed ? 'rp-fail' : 'rp-run'}`}>
      <Icon name={failed ? 'error' : 'rotate'} size={13} className="rp-ico" />
      <span className="rp-title">
        自动修稿 · 第 {evt.chapter} 章 · 第 {evt.attempt}/{evt.max} 次{failed ? ' 失败' : '进行中'}
      </span>
      {Array.isArray(evt.blockers) && evt.blockers.length > 0 && (
        <span className="rp-blockers">· {evt.blockers.slice(0, 2).join('；')}{evt.blockers.length > 2 ? '…' : ''}</span>
      )}
      {evt.error && <span className="rp-err">· {evt.error}</span>}
    </div>
  );
}

export function RepairToolCard({ evt }) {
  if (!evt) return null;
  return (
    <div className="card-repair rp-run">
      <Icon name="rotate" size={13} className="rp-ico" />
      <span className="rp-title">工具自愈 · {evt.of} 经 {evt.via} 修复</span>
      {evt.note && <span className="rp-note">· {evt.note}</span>}
    </div>
  );
}
