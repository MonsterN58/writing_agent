import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * 全局命令面板（Cmd/Ctrl+K 唤出）。
 * 不引入新 API；所有动作只是调用上层已有回调或派发 onSend(text)。
 *
 * Props:
 *   open, onClose
 *   project, projects
 *   onCreateProject(name)
 *   onSwitchProject(name)
 *   onOpenSkills, onOpenMemory
 *   onExportNovel, onDeleteProject
 *   onSetTheme(theme), theme
 *   onSetMode(mode), mode
 *   onSend(text)
 */
export default function CommandPalette({
  open, onClose,
  project, projects = [],
  onCreateProject, onSwitchProject,
  onOpenSkills, onOpenMemory,
  onExportNovel, onDeleteProject,
  onSetTheme, theme,
  onSetMode, mode,
  onSend,
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) { setQ(''); setActive(0); return; }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const items = useMemo(() => {
    const arr = [];
    // 面板入口
    arr.push({ section: '面板', id: 'open-skills', title: '打开技能 …', sub: '我的技能 / 系统技能', icon: 'skill', disabled: !project, run: onOpenSkills });
    arr.push({ section: '面板', id: 'open-memory', title: '打开长期记忆 …', sub: '硬约束 / 人物口吻 / 失败模式', icon: 'memory', disabled: !project, run: onOpenMemory });
    // 作品
    arr.push({ section: '作品', id: 'create-project', title: '新建作品 …', sub: '创建空作品并切换', icon: 'plus', run: () => {
      const name = prompt('新作品名：');
      if (name?.trim()) onCreateProject?.(name.trim());
    }});
    for (const p of projects) {
      if (p.name === project) continue;
      arr.push({ section: '切换作品', id: `sw-${p.name}`, title: p.name, sub: p.hasSoul ? '已立项' : '未立项', icon: 'folder', run: () => onSwitchProject?.(p.name) });
    }
    arr.push({ section: '作品', id: 'export', title: '导出全本', sub: '合并到 exports/full-novel.md', icon: 'download', disabled: !project, run: onExportNovel });
    arr.push({ section: '作品', id: 'delete', title: '删除当前作品 …', sub: '不可撤销', icon: 'trash', disabled: !project, run: onDeleteProject });
    // 模型 / 主题
    for (const m of ['flash', 'pro', 'writer', 'ultra']) {
      arr.push({ section: '模型档位', id: `mode-${m}`, title: `切到 ${m}`, sub: m === mode ? '当前' : '', icon: 'cpu', run: () => onSetMode?.(m) });
    }
    arr.push({ section: '外观', id: 'theme', title: theme === 'dark' ? '切到浅色' : '切到深色', sub: '主题', icon: theme === 'dark' ? 'sun' : 'moon', run: () => onSetTheme?.(theme === 'dark' ? 'light' : 'dark') });
    // 快捷指令（直接发到对话）
    if (project) {
      arr.push({ section: '写作快捷', id: 'sl-write', title: '写下一章', sub: '/write', icon: 'pen', run: () => onSend?.('/write') });
      arr.push({ section: '写作快捷', id: 'sl-outline', title: '出下一章单章纲', sub: '/outline', icon: 'tasks', run: () => onSend?.('/outline') });
      arr.push({ section: '写作快捷', id: 'sl-check', title: '一致性扫描最新章', sub: '/check', icon: 'critic', run: () => onSend?.('/check') });
      arr.push({ section: '写作快捷', id: 'sl-foreshadow', title: '伏笔总账', sub: '/foreshadow', icon: 'reviewAlert', run: () => onSend?.('/foreshadow') });
      arr.push({ section: '写作快捷', id: 'sl-style', title: '抽风格锚', sub: '/style', icon: 'wand', run: () => onSend?.('/style') });
    }
    return arr;
  }, [project, projects, mode, theme, onCreateProject, onSwitchProject, onOpenSkills, onOpenMemory, onExportNovel, onDeleteProject, onSetMode, onSetTheme, onSend]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return items.filter((it) => !it.disabled);
    return items.filter((it) => {
      if (it.disabled) return false;
      const hay = `${it.title} ${it.sub || ''} ${it.section}`.toLowerCase();
      return hay.includes(ql);
    });
  }, [items, q]);

  // 按 section 分组渲染
  const grouped = useMemo(() => {
    const m = new Map();
    filtered.forEach((it) => {
      if (!m.has(it.section)) m.set(it.section, []);
      m.get(it.section).push(it);
    });
    return [...m.entries()];
  }, [filtered]);

  useEffect(() => { setActive(0); }, [q]);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[active];
      if (it && it.run) {
        try { it.run(); } catch {}
        onClose?.();
      }
    }
  };

  if (!open) return null;
  let counter = -1;
  return (
    <div className="cp-mask" onClick={onClose}>
      <div className="cp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cp-head">
          <Icon name="brand" size={14} />
          <input
            ref={inputRef}
            className="cp-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="输入命令、作品名、技能… (↑↓ 选择，Enter 执行，Esc 关闭)"
          />
          <span className="cp-shortcut">Esc</span>
        </div>
        <div className="cp-list">
          {filtered.length === 0 && <div className="cp-empty">没有匹配项</div>}
          {grouped.map(([sec, list]) => (
            <div key={sec}>
              <div className="cp-section">{sec}</div>
              {list.map((it) => {
                counter += 1;
                const isActive = counter === active;
                return (
                  <div
                    key={it.id}
                    className={`cp-item${isActive ? ' active' : ''}`}
                    onMouseEnter={() => setActive(counter)}
                    onClick={() => { try { it.run(); } catch {} onClose?.(); }}
                  >
                    <span className="cp-icon"><Icon name={it.icon} size={13} /></span>
                    <div className="cp-item-body">
                      <div className="cp-item-title">{it.title}</div>
                      {it.sub && <div className="cp-item-sub">{it.sub}</div>}
                    </div>
                    {isActive && <span className="cp-item-key">↵</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
