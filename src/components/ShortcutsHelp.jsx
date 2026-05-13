import React, { useEffect } from 'react';
import Icon from './Icon.jsx';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const MOD = isMac ? '⌘' : 'Ctrl';

const SECTIONS = [
  {
    title: '全局',
    rows: [
      { label: '打开命令面板', keys: [MOD, 'K'] },
      { label: '快捷键帮助', keys: ['?'] },
      { label: '关闭浮层', keys: ['Esc'] },
    ],
  },
  {
    title: '对话',
    rows: [
      { label: '发送 / 排队', keys: [MOD, 'Enter'] },
      { label: '提及文件 / 章节 / 技能', keys: ['@'] },
      { label: '快捷指令', keys: ['/'] },
      { label: 'AskUser 选项 1-9', keys: ['1', '…', '9'] },
    ],
  },
  {
    title: '消息',
    rows: [
      { label: '复制本条', keys: ['鼠标悬停', '→', '复制'] },
      { label: '重试本回合', keys: ['鼠标悬停', '→', '重试'] },
      { label: '编辑重发', keys: ['鼠标悬停用户消息', '→', '编辑重发'] },
    ],
  },
  {
    title: '导航',
    rows: [
      { label: '回到最新', keys: ['↓ 浮窗按钮'] },
      { label: '展开 / 折叠左栏', keys: ['左侧栏图标'] },
      { label: '切换主题', keys: ['顶栏 ☀ / ☾'] },
    ],
  },
];

export default function ShortcutsHelp({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="shortcuts-mask" onClick={onClose}>
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-head">
          <h3>快捷键</h3>
          <button className="close" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className="shortcuts-section">{sec.title}</div>
            {sec.rows.map((r, i) => (
              <div key={i} className="shortcuts-row">
                <span className="label">{r.label}</span>
                <span className="keys">
                  {r.keys.map((k, j) => k === '…' || k === '→' || k.length > 4
                    ? <span key={j} style={{ color: 'var(--muted)', fontSize: 11, padding: '0 2px' }}>{k}</span>
                    : <kbd key={j}>{k}</kbd>)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
