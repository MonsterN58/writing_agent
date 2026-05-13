import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const ToastCtx = createContext(null);

const KIND_ICON = {
  success: 'check',
  info: 'sparkles',
  warn: 'warn',
  danger: 'warn',
};

let SEQ = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setItems((arr) => arr.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const tm = timersRef.current.get(id);
    if (tm) { clearTimeout(tm); timersRef.current.delete(id); }
    setTimeout(() => {
      setItems((arr) => arr.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const push = useCallback((payload) => {
    const id = ++SEQ;
    const item = {
      id,
      kind: payload.kind || 'info',
      title: payload.title || '',
      desc: payload.desc || '',
      duration: payload.duration ?? 4200,
      leaving: false,
    };
    setItems((arr) => [...arr, item].slice(-5));
    if (item.duration > 0) {
      const tm = setTimeout(() => dismiss(id), item.duration);
      timersRef.current.set(id, tm);
    }
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    timersRef.current.forEach((tm) => clearTimeout(tm));
    timersRef.current.clear();
  }, []);

  const api = {
    push,
    dismiss,
    success: (title, desc, opts = {}) => push({ kind: 'success', title, desc, ...opts }),
    info:    (title, desc, opts = {}) => push({ kind: 'info', title, desc, ...opts }),
    warn:    (title, desc, opts = {}) => push({ kind: 'warn', title, desc, ...opts }),
    danger:  (title, desc, opts = {}) => push({ kind: 'danger', title, desc, ...opts, duration: opts.duration ?? 6000 }),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="v5-toast-stack" aria-live="polite" aria-atomic="true">
        {items.map((t) => (
          <div
            key={t.id}
            className={`v5-toast t-${t.kind}${t.leaving ? ' leaving' : ''}`}
            role={t.kind === 'danger' ? 'alert' : 'status'}
          >
            <Icon name={KIND_ICON[t.kind] || 'spark'} size={14} />
            <div className="v5-toast-body">
              {t.title && <div className="v5-toast-title">{t.title}</div>}
              {t.desc && <div className="v5-toast-desc">{t.desc}</div>}
            </div>
            <button
              type="button"
              className="v5-toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="关闭"
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // 兜底：未挂 Provider 时也能调用，但只输出 console
    return {
      push: ({ title, desc, kind }) => console.warn(`[toast:${kind || 'info'}] ${title}${desc ? ' — ' + desc : ''}`),
      dismiss: () => {},
      success: (t, d) => console.log(`[toast:success] ${t}${d ? ' — ' + d : ''}`),
      info:    (t, d) => console.log(`[toast:info] ${t}${d ? ' — ' + d : ''}`),
      warn:    (t, d) => console.warn(`[toast:warn] ${t}${d ? ' — ' + d : ''}`),
      danger:  (t, d) => console.error(`[toast:danger] ${t}${d ? ' — ' + d : ''}`),
    };
  }
  return ctx;
}
