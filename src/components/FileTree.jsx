import React, { useMemo, useState } from 'react';
import Icon from './Icon.jsx';

const FILTER_PRESETS = {
  all: { label: '全部', test: () => true },
  chapters: { label: '章节', test: (p) => p.startsWith('chapters/') },
  outline: { label: '大纲', test: (p) => p.startsWith('outline/') },
  knowledge: { label: '设定', test: (p) => p.startsWith('knowledge/') },
};

// 把扁平路径列表转为嵌套树
function buildTree(items) {
  const root = { name: '', path: '', children: {}, isDir: true };
  for (const it of items) {
    const parts = it.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: {},
          isDir: !isLast || it.type === 'dir',
        };
      }
      node = node.children[part];
    }
  }
  return root;
}

function scoreClass(score) {
  if (score == null) return null;
  if (score >= 8) return 's-good';
  if (score >= 6) return 's-mid';
  return 's-low';
}

function TreeNode({ node, depth, onOpen, currentPath, openMap, toggle, scoreMap, forceOpen }) {
  const children = Object.values(node.children).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });
  const isOpen = forceOpen || (openMap[node.path] ?? depth < 1);
  const isCurrent = currentPath === node.path;

  if (node.path === '') {
    return <>{children.map((c) => (
      <TreeNode key={c.path} node={c} depth={0} onOpen={onOpen} currentPath={currentPath} openMap={openMap} toggle={toggle} scoreMap={scoreMap} forceOpen={forceOpen} />
    ))}</>;
  }

  const dotCls = !node.isDir ? scoreClass(scoreMap?.get(node.path)) : null;

  return (
    <div>
      <div
        className={`tree-row ${isCurrent ? 'current' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => node.isDir ? toggle(node.path) : onOpen(node.path)}
      >
        <span className="icon">
          {node.isDir
            ? <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={11} />
            : <Icon name="file" size={11} />}
        </span>
        <span className="name">{node.name}</span>
        {dotCls && <span className={`ft-score-dot ${dotCls}`} aria-hidden="true" />}
      </div>
      {node.isDir && isOpen && children.map((c) => (
        <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} currentPath={currentPath} openMap={openMap} toggle={toggle} scoreMap={scoreMap} forceOpen={forceOpen} />
      ))}
    </div>
  );
}

export default function FileTree({ files, onOpen, project, currentPath, events }) {
  const [openMap, setOpenMap] = useState({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const toggle = (p) => setOpenMap((m) => ({ ...m, [p]: !(m[p] ?? false) }));

  // 章节评分 map（path → score）
  const scoreMap = useMemo(() => {
    const m = new Map();
    for (const e of events || []) {
      if (e.type === 'chapter_score' && e.relPath != null && typeof e.score === 'number') {
        m.set(e.relPath, e.score);
      } else if (e.type === 'chapter_saved' && e.relPath && typeof e.score === 'number') {
        m.set(e.relPath, e.score);
      }
    }
    return m;
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const presetTest = FILTER_PRESETS[filter]?.test || (() => true);
    return (files || []).filter((it) => {
      if (!presetTest(it.path)) return false;
      if (!q) return true;
      return it.path.toLowerCase().includes(q);
    });
  }, [files, search, filter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const forceOpen = !!search.trim() || filter !== 'all';

  if (!project) {
    return <div className="filetree empty">先在顶栏新建或选择作品</div>;
  }

  return (
    <div className="filetree">
      <div className="ft-toolbar">
        <input
          className="ft-search"
          placeholder="搜文件…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ft-filters">
          {Object.entries(FILTER_PRESETS).map(([k, v]) => (
            <button
              key={k}
              className={`ft-filter${filter === k ? ' active' : ''}`}
              onClick={() => setFilter(k)}
              type="button"
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ft-body">
        {filtered.length === 0
          ? <div className="hint">{search.trim() ? '没有匹配文件' : '（空目录）'}</div>
          : <TreeNode node={tree} depth={-1} onOpen={onOpen} currentPath={currentPath} openMap={openMap} toggle={toggle} scoreMap={scoreMap} forceOpen={forceOpen} />}
      </div>
    </div>
  );
}
