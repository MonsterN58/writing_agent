import React from 'react';
import Icon from '../Icon.jsx';

const INTENT_LABEL = {
  write_chapter: '写章',
  continue_chapter: '续写',
  outline: '规划大纲',
  revise_chapter: '改稿',
  setup_work: '立项',
  update_progress: '更新进度',
  wiki_query: '查阅 wiki',
  consistency_check: '一致性检查',
  chat: '闲聊',
  unknown: '未分类',
};

const RISK_LABEL = { low: '低', mid: '中', high: '高' };

export default function IntentBadge({ intent, risk, contextMode }) {
  if (!intent) return null;
  const label = INTENT_LABEL[intent] || intent;
  const riskKey = (risk || '').toLowerCase();
  return (
    <div className="intent-badge" title={`意图分类：${intent}${risk ? ` · 风险 ${RISK_LABEL[riskKey] || risk}` : ''}${contextMode ? ` · 上下文 ${contextMode}` : ''}`}>
      <Icon name="intent" size={11} className="intent-ico" />
      <span className="intent-label">{label}</span>
      {risk && <span className={`intent-risk risk-${riskKey}`}>{RISK_LABEL[riskKey] || risk}</span>}
      {contextMode && <span className="intent-ctx">{contextMode}</span>}
    </div>
  );
}
