import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import SetupStageBadge from './SetupStageBadge.jsx';

function detectSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('moshu.theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return detectSystemTheme();
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('moshu.theme', theme); } catch {}
  }, [theme]);
  // 当用户没显式选过主题时，跟随系统切换
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    let userOverride = false;
    try { userOverride = !!localStorage.getItem('moshu.theme.userPicked'); } catch {}
    if (userOverride) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const setThemePersist = (t) => {
    try { localStorage.setItem('moshu.theme.userPicked', '1'); } catch {}
    setTheme(t);
  };
  return [theme, setThemePersist];
}

export default function TopBar({
  projects, project, onSwitch, onCreate,
  onOpenSkills, onOpenMemory, onOpenDashboard, onOpenForeshadow,
  onOpenLLMSettings,
  onExport, onDeleteProject,
  mode = 'pro', onModeChange,
  onOpenCmdK,
  hudSlot = null,
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [theme, setTheme] = useTheme();
  const [exporting, setExporting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const submit = () => {
    if (!name.trim()) return;
    onCreate(name.trim());
    setName('');
    setCreating(false);
  };

  const handleExport = async () => {
    if (!project || exporting) return;
    setExporting(true);
    try { await onExport?.(); } finally { setExporting(false); setMoreOpen(false); }
  };

  const handleDelete = () => {
    setMoreOpen(false);
    if (!project) return;
    const confirmName = prompt(`确定删除作品 "${project}" 吗？\n此操作不可撤销，将递归删除整个目录。\n\n请输入作品名确认：`);
    if (confirmName !== project) return;
    onDeleteProject?.(project);
  };

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
  const kbdMod = isMac ? '⌘' : 'Ctrl';

  const menuItem = (icon, label, fn, opts = {}) => (
    <button
      type="button"
      className={`tb-more-item${opts.danger ? ' danger' : ''}`}
      disabled={opts.disabled}
      onClick={() => { setMoreOpen(false); fn?.(); }}
    >
      <Icon name={icon} size={13} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="topbar">
      <div className="tb-zone tb-zone-left">
        <div className="brand" title="墨枢 · Mòshū">
          <span className="brand-seal" aria-hidden="true">墨</span>
          <span className="brand-name">墨枢</span>
        </div>
        <span className="tb-divider" aria-hidden="true" />
        <div className="proj-switch">
          {!creating ? (
            <div className="proj-pill">
              <select
                value={project || ''}
                onChange={(e) => onSwitch(e.target.value)}
                aria-label="切换作品"
              >
                {projects.length === 0 && <option value="">（无作品，先新建）</option>}
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}{p.hasSoul ? '' : ' · 未立项'}
                  </option>
                ))}
              </select>
              <button
                className="proj-pill-add"
                onClick={() => setCreating(true)}
                title="新建作品"
                aria-label="新建作品"
              >
                <Icon name="plus" size={12} />
              </button>
            </div>
          ) : (
            <div className="proj-pill proj-pill-creating">
              <input
                autoFocus
                placeholder="作品名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setCreating(false); }}
              />
              <button className="proj-pill-add" onClick={submit} title="确认">建</button>
              <button className="proj-pill-add" onClick={() => setCreating(false)} title="取消">×</button>
            </div>
          )}
        </div>
        {project && <SetupStageBadge project={project} />}
      </div>

      <div className="spacer" />

      <div className="tb-zone tb-zone-right">
        {hudSlot}
        {onOpenCmdK && (
          <button
            className="tb-btn tb-btn-cmdk"
            onClick={onOpenCmdK}
            title="命令面板：项目切换 / 面板 / 快捷指令"
            aria-label="命令面板"
          >
            <Icon name="brand" size={12} />
            <span className="tb-btn-label">命令</span>
            <span className="tb-btn-kbd"><kbd>{kbdMod}</kbd><kbd>K</kbd></span>
          </button>
        )}
        <span className="tb-divider" aria-hidden="true" />
        <div className="tb-more-wrap" ref={moreRef}>
          <button
            className="tb-btn"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            title="更多操作"
          >
            <Icon name="chevronDown" size={13} />
            <span className="tb-btn-label">更多</span>
          </button>
          {moreOpen && (
            <div className="tb-more-pop" role="menu">
              {menuItem('memory', '长期记忆', onOpenMemory, { disabled: !project })}
              {menuItem('skill', '我的技能', onOpenSkills, { disabled: !project })}
              {onOpenDashboard && menuItem('chapter', '章节仪表盘', onOpenDashboard, { disabled: !project })}
              {onOpenForeshadow && menuItem('warn', '伏笔预警', onOpenForeshadow, { disabled: !project })}
              <div className="tb-more-sep" />
              {onOpenLLMSettings && menuItem('settings', 'LLM 配置', onOpenLLMSettings)}
              <div className="tb-more-sep" />
              {menuItem('download', exporting ? '导出中…' : '导出全本', handleExport, { disabled: !project || exporting })}
              {menuItem('trash', '删除当前作品', handleDelete, { disabled: !project, danger: true })}
            </div>
          )}
        </div>
        <span className="tb-divider" aria-hidden="true" />
        <button
          className="tb-btn tb-btn-icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? '切到浅色' : '切到深色'}
          aria-label="切换主题"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
        </button>
      </div>
    </div>
  );
}
