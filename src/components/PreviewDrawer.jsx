import React, { useEffect } from 'react';
import Icon from './Icon.jsx';
import Preview from './Preview.jsx';

/**
 * 右抽屉包装 Preview。
 * - open: 是否显示
 * - onClose: 关闭回调（点遮罩 / 点 X / 按 Esc）
 */
export default function PreviewDrawer({ open, onClose, ...previewProps }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`drawer-mask ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <Icon name="preview" size={14} />
          <span className="drawer-title">预览</span>
          <span className="drawer-spacer" />
          <button className="ghost-btn" onClick={onClose} title="关闭 (Esc)">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="drawer-body">
          <Preview {...previewProps} />
        </div>
      </aside>
    </>
  );
}
