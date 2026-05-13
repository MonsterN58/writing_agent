import React, { useState, useRef, useEffect, useMemo } from 'react';
import Icon from './Icon.jsx';
import MessageBubble from './MessageBubble.jsx';
import LiveActivity from './LiveActivity.jsx';

function expandSlash(text) {
  const m = /^\/(\w+)\s*(.*)$/i.exec(text);
  if (!m) return text;
  const cmd = m[1].toLowerCase();
  const rest = (m[2] || '').trim();
  switch (cmd) {
    case 'write': {
      const num = (rest.match(/\d+/) || [])[0];
      const title = rest.replace(/^\d+\s*/, '').trim();
      return `写第 ${num || '下一'} 章${title ? `，标题想叫「${title}」` : ''}。按写章流程：list_chapters → wiki_query → write_outline → write_chapter → wiki_ingest → consistency_check。`;
    }
    case 'outline': {
      const num = (rest.match(/\d+/) || [])[0];
      return `请出第 ${num || '下一'} 章的单章纲，调 chapter-planner skill，落到 outline/chapters/chapter-${num || 'N'}.md。包含场景节拍、出场人物、章末钩子、字数预算。`;
    }
    case 'check': {
      const num = (rest.match(/\d+/) || [])[0];
      return `对第 ${num || '最新'} 章跑一致性扫描：read_file 章节正文 + wiki_query 相关实体 → 比对 → consistency_check 工具落报告。`;
    }
    case 'wiki': {
      const kws = rest || '主角';
      return `调 wiki_query 查 [${kws}]，返回相关实体/概念和未闭合伏笔。`;
    }
    case 'foreshadow': return `调 foreshadow_scan 重建伏笔总账并显示当前所有 open 伏笔的年龄分级。`;
    case 'export': return `调 export_novel 把所有章节合并导出到 exports/full-novel.md 和 .txt。`;
    case 'rewrite': {
      const num = (rest.match(/\d+/) || [])[0];
      return `改写第 ${num || '?'} 章。${rest.includes('整章') || rest.includes('重写') ? 'L3 章改' : '请先澄清档位（L1润色/L2段改/L3章改/L4结构改）'}。${rest}`;
    }
    case 'style': return `调 prose-style 和 style-voice skill 帮我建立当前作品的风格锚。先读 SOUL、最近章节和 style/feedback.md，最后用 update_progress 写入 style/voice.md。`;
    case 'name': return `调 naming skill 帮我起 ${rest || '角色'} 的名字，给 3-5 个候选 + 推荐理由。`;
    default: return text;
  }
}

const SLASH_CMDS = [
  { cmd: '/write', tip: '写第 N 章。例：/write 5 王家窥玉' },
  { cmd: '/outline', tip: '出第 N 章单章纲。例：/outline 5' },
  { cmd: '/check', tip: '一致性扫描第 N 章。例：/check 5' },
  { cmd: '/wiki', tip: '查 wiki。例：/wiki 林尘 玉佩' },
  { cmd: '/foreshadow', tip: '看伏笔总账' },
  { cmd: '/export', tip: '导出全本到 exports/' },
  { cmd: '/rewrite', tip: '改写。例：/rewrite 5 整章重写' },
  { cmd: '/style', tip: '调文风' },
  { cmd: '/name', tip: '起名。例：/name 反派' },
];

const TASK_STATUS = {
  pending:    { iconName: 'taskPending', cls: 'task-pending', label: '待办' },
  in_progress:{ iconName: 'taskDoing',   cls: 'task-doing',   label: '进行中' },
  done:       { iconName: 'taskDone',    cls: 'task-done',    label: '完成' },
  skipped:    { iconName: 'taskSkip',    cls: 'task-skip',    label: '跳过' },
};

function TasksPanel({ tasks }) {
  if (!tasks || !tasks.tasks?.length) return null;
  const pct = tasks.total ? (tasks.done / tasks.total * 100) : 0;
  return (
    <details className="tasks-panel" open>
      <summary>
        <Icon name="tasks" size={14} className="tasks-ico" />
        <span className="tasks-title">任务清单</span>
        <span className="tasks-progress">{tasks.done}/{tasks.total}</span>
        <span className="tasks-bar"><span className="tasks-bar-fill" style={{ width: `${pct}%` }} /></span>
      </summary>
      <ul className="tasks-list">
        {tasks.tasks.map((t) => {
          const s = TASK_STATUS[t.status] || TASK_STATUS.pending;
          return (
            <li key={t.id} className={s.cls}>
              <Icon name={s.iconName} size={13} className="task-ico" />
              <span className="task-id">{t.id}</span>
              <span className="task-title">{t.title}</span>
              {t.note && <span className="task-note">{t.note}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function AskUserCard({ ask, onPick }) {
  useEffect(() => {
    if (!ask || !ask.options?.length) return;
    const onKey = (e) => {
      // 在输入框中输入数字时不要劫持
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (!Number.isFinite(n)) return;
      const idx = n - 1;
      if (idx >= 0 && idx < ask.options.length) {
        e.preventDefault();
        onPick(ask.options[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask, onPick]);
  if (!ask) return null;
  return (
    <div className="ask-card">
      <div className="ask-head">
        <Icon name="ask" size={14} className="ask-ico" />
        <span className="ask-title">墨枢需要你确认</span>
      </div>
      <div className="ask-q">{ask.question}</div>
      {ask.context && (
        <details className="ask-ctx">
          <summary>为什么问？</summary>
          <div>{ask.context}</div>
        </details>
      )}
      {ask.options.length > 0 ? (
        <div className="ask-options">
          {ask.options.map((opt, i) => (
            <button
              key={i}
              className="ask-opt"
              onClick={() => onPick(opt)}
              title={i < 9 ? `按 ${i + 1} 选择` : undefined}
            >
              {i < 9 && <span className="ask-opt-key">{i + 1}</span>}
              <span>{opt}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="ask-hint">在下面输入框里答复，墨枢会接着继续</div>
      )}
    </div>
  );
}

function SessionArtifacts({ events, onOpenFile }) {
  const items = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const e of events || []) {
      let path = e.relPath || e.path || e.scorePath || null;
      let label = path;
      let kind = e.type;
      if (e.type === 'chapter_saved') {
        path = e.relPath;
        label = `第 ${e.chapter} 章 · ${e.title || path}`;
        kind = 'chapter';
      } else if (e.type === 'user_skill_saved') {
        label = `skill · ${e.name || path}`;
        kind = 'skill';
      } else if (e.type === 'memory_saved') {
        label = `memory · ${e.kind || ''} · ${e.key || ''}`;
      } else if (e.type === 'feedback_saved') {
        label = `feedback · ${e.kind || ''}`;
      } else if (e.type === 'wiki_lint') {
        path = e.relPath;
        label = `wiki_lint · ${e.issues} issues`;
      } else if (e.type === 'wiki_archive') {
        path = e.relPath;
        label = `wiki_archive · ${e.title}`;
      } else if (e.type !== 'file_write') {
        continue;
      }
      const key = `${kind}:${path || label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, path, label });
    }
    return out.slice(-30).reverse();
  }, [events]);

  if (!items.length) return <div className="artifacts-empty">本会话还没有产物。</div>;
  return (
    <div className="artifacts-list">
      {items.map((it) => (
        <div key={`${it.kind}:${it.path || it.label}`} className="artifact-row">
          <Icon name={it.kind === 'chapter' ? 'chapter' : it.kind === 'skill' ? 'skill' : 'file'} size={13} />
          <span className="artifact-kind">{it.kind}</span>
          <span className="artifact-label">{it.label}</span>
          {it.path && onOpenFile && <button onClick={() => onOpenFile(it.path)}>打开</button>}
        </div>
      ))}
    </div>
  );
}

function useAutoResize(ref, value) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [value, ref]);
}

const IMPORT_SUBDIRS = [
  { value: 'imports', label: 'imports/（默认 · 待整理素材）' },
  { value: 'knowledge/world', label: 'knowledge/world/（世界观）' },
  { value: 'knowledge/entities', label: 'knowledge/entities/（人物档案）' },
  { value: 'outline/volumes', label: 'outline/volumes/（卷纲）' },
  { value: 'outline/arcs', label: 'outline/arcs/（arc 细纲）' },
  { value: 'outline/chapters', label: 'outline/chapters/（单章纲）' },
  { value: 'outline', label: 'outline/（总纲：overall.md）' },
  { value: 'style', label: 'style/（风格锚）' },
  { value: 'references', label: 'references/（参考资料）' },
];

const MODE_INFO = {
  flash:  { label: 'Flash',  sub: '快 / 省成本' },
  pro:    { label: 'Pro',    sub: '默认 / 平衡' },
  writer: { label: 'Writer', sub: '更稳的写作' },
  ultra:  { label: 'Ultra',  sub: '最强 / 重要章节' },
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return { eyebrow: '深夜', title: '夜深了，再写一章好吗？' };
  if (h < 11) return { eyebrow: '早安', title: '早安，今天想往前推哪一章？' };
  if (h < 14) return { eyebrow: '午时', title: '中午好，要不要先列个单章纲？' };
  if (h < 18) return { eyebrow: '下午', title: '下午好，让笔随心。' };
  if (h < 22) return { eyebrow: '晚上', title: '晚安前的几页，最适合细写。' };
  return { eyebrow: '夜半', title: '夜里灵感最稠，写一段试试？' };
}

export default function ChatStream({
  history, busy, onSend, onStop, queuedMessages = [], project, askUser, tasks, eventGroups, events,
  onClear, onOpenFile, onDequeue, onEditQueue,
  mode = 'pro', onModeChange,
  files: projectFiles = [],
  onRetryFromIndex, onEditResend,
  editDraft = null,
}) {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadPick, setUploadPick] = useState(null); // { files, subdir }
  const [uploading, setUploading] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [mentionState, setMentionState] = useState(null); // { q, start, items, active }
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const modeBtnRef = useRef(null);

  const onFilesDropped = (fileList) => {
    if (!project) { alert('先选作品再上传'); return; }
    const files = Array.from(fileList || []).filter((f) => /\.(md|markdown|txt|json|ya?ml)$/i.test(f.name));
    if (!files.length) { alert('仅支持 .md/.markdown/.txt/.json/.yaml'); return; }
    setUploadPick({ files, subdir: 'imports' });
  };

  const confirmUpload = async () => {
    if (!uploadPick || !project) return;
    setUploading(true);
    const { files, subdir } = uploadPick;
    const ok = [], failed = [];
    try {
      for (const f of files) {
        const content = await f.text();
        let r = await fetch('/api/import-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, filename: f.name, content, subdir, overwrite: false }),
        });
        let d = await r.json();
        if (r.status === 409) {
          if (!confirm(`${f.name}: ${d.error}\n是否覆盖？`)) { failed.push(`${f.name}: 已跳过`); continue; }
          r = await fetch('/api/import-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project, filename: f.name, content, subdir, overwrite: true }),
          });
          d = await r.json();
        }
        if (r.ok) ok.push(d.relPath);
        else failed.push(`${f.name}: ${d.error || 'failed'}`);
      }
    } catch (e) {
      failed.push(String(e.message || e));
    }
    setUploading(false);
    setUploadPick(null);
    if (ok.length) {
      const list = ok.map((p) => `\`${p}\``).join('、');
      const hint = subdir === 'imports'
        ? `已导入 ${ok.length} 个文件到：${list}。请按 bulk-import skill 流程：先 list_dir / read_file 看一遍 → wiki_ingest 沉淀到 knowledge/ → lookup_rebuild → conflict_check。`
        : `已上传 ${ok.length} 个文件到 ${subdir}/：${list}。请用 setup_status 看 setup 阶段是否推进，必要时 lookup_rebuild。`;
      onSend(hint);
    }
    if (failed.length) alert(`部分失败：\n${failed.join('\n')}`);
  };
  useAutoResize(taRef, text);

  // 「编辑重发」：父级把原文塞回输入框 + 自动聚焦光标到末尾
  useEffect(() => {
    if (!editDraft) return;
    const draft = editDraft.text || '';
    setText(draft);
    setMentionState(null);
    const id = setTimeout(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        try { ta.setSelectionRange(draft.length, draft.length); } catch {}
      }
    }, 0);
    return () => clearTimeout(id);
    // 依赖 nonce：每次「编辑重发」点击都触发，即便文本相同
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDraft?.nonce]);

  const showSlash = text.startsWith('/') && !text.includes(' ') && !text.includes('\n');
  const slashHits = showSlash ? SLASH_CMDS.filter((c) => c.cmd.startsWith(text.toLowerCase())) : [];

  // history 索引 → 该消息对应的事件组
  // eventGroups 是按 turn（user-send 锚点）分好的二维数组，长度 = user 消息数
  // 每个 assistant 消息显示其前面最近一个 user 消息对应的 group
  const groupsByAssistantIdx = useMemo(() => {
    const map = new Map();
    let userCount = 0;
    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      if (m.role === 'user') {
        userCount += 1;
      } else if (m.role === 'assistant') {
        const groupIdx = userCount - 1;
        if (groupIdx >= 0 && eventGroups[groupIdx]) {
          map.set(i, eventGroups[groupIdx]);
        }
      }
    }
    return map;
  }, [history, eventGroups]);

  // 滚到底：仅在"消息条数变化 / askUser 出现 / tasks 出现"时触发，
  // 而不是每个 token 都滚——否则会和气泡高度变化叠加产生抖动。
  // streaming 中的渐进跟随用 rAF + 仅追加最后一条的逻辑分开处理。
  const lastLenRef = useRef(history.length);
  useEffect(() => {
    if (history.length !== lastLenRef.current) {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastLenRef.current = history.length;
    }
  }, [history.length]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [askUser, tasks?.total]);

  // streaming 中的"贴底跟随"：用 rAF 节流，且只在用户已经接近底部时才滚（避免把用户从历史里拽走）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = history[history.length - 1];
    if (!last || !last.streaming) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      const id = requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [history]);

  // 滚动监听：用户拉离底部时显示「回到最新」按钮
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJump(dist > 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  const jumpToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  // mode menu 外部点击关闭
  useEffect(() => {
    if (!modeOpen) return;
    const onDoc = (e) => {
      if (modeBtnRef.current && !modeBtnRef.current.contains(e.target)) setModeOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [modeOpen]);

  // @ 提及候选：基于项目文件 + 章节聚合
  const mentionCandidates = useMemo(() => {
    const list = [];
    for (const f of projectFiles || []) {
      if (f.type === 'dir') continue;
      const p = f.path || '';
      let section = '其它';
      let label = p;
      if (p.startsWith('chapters/')) {
        section = '章节';
        const m = /^chapters\/第(\d+)章-(.+)\.md$/.exec(p);
        label = m ? `第 ${m[1]} 章 · ${m[2]}` : p.replace('chapters/', '');
      } else if (p.startsWith('outline/')) {
        section = '大纲';
        label = p.replace('outline/', '');
      } else if (p.startsWith('knowledge/')) {
        section = '设定';
        label = p.replace('knowledge/', '');
      } else if (p.startsWith('style/')) {
        section = '风格';
        label = p.replace('style/', '');
      } else {
        continue;
      }
      list.push({ section, label, path: p });
    }
    return list;
  }, [projectFiles]);

  // 检查 textarea 当前 caret 前是否在 @… 输入态
  const computeMention = (val, caretPos) => {
    const left = (val || '').slice(0, caretPos);
    const m = /@([^\s@\n]{0,30})$/.exec(left);
    if (!m) return null;
    const q = m[1];
    const start = caretPos - m[0].length;
    const ql = q.toLowerCase();
    const items = mentionCandidates.filter((c) => {
      if (!ql) return true;
      return c.label.toLowerCase().includes(ql) || c.path.toLowerCase().includes(ql);
    }).slice(0, 30);
    return { q, start, items, active: 0 };
  };

  const onTextChange = (e) => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart || v.length;
    setMentionState(computeMention(v, caret));
  };

  const closeMention = () => setMentionState(null);

  const insertMention = (item) => {
    if (!mentionState) return;
    const { start, q } = mentionState;
    const before = text.slice(0, start);
    const after = text.slice(start + q.length + 1); // 1 = '@'
    const token = `[${item.label}](${item.path})`;
    const next = `${before}${token} ${after}`;
    setText(next);
    setMentionState(null);
    setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = before.length + token.length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const submit = () => {
    if (!text.trim()) return;
    onSend(expandSlash(text.trim()));
    setText('');
    setMentionState(null);
  };

  const pickOption = (opt) => {
    if (busy) return;
    onSend(opt);
  };

  return (
    <div
      className={`chat${dragOver ? ' chat-drag' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          setDragOver(false);
          onFilesDropped(e.dataTransfer.files);
        }
      }}
    >
      {dragOver && (
        <div className="chat-drop-overlay">
          <div className="chat-drop-hint">
            <Icon name="file" size={32} />
            <div>松开导入到当前作品 imports/</div>
            <div className="chat-drop-sub">支持 .md / .markdown / .txt / .json / .yaml（≤ 4MB）</div>
          </div>
        </div>
      )}
      {uploadPick && (
        <div className="side-panel-mask" onClick={() => !uploading && setUploadPick(null)}>
          <div className="side-panel" style={{ width: 'min(560px, 92vw)', maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
            <header className="side-panel-head">
              <Icon name="file" size={14} />
              <span>导入 {uploadPick.files.length} 个文件 · {project}</span>
              <span className="spacer" />
              <button className="btn-ghost close-x" onClick={() => !uploading && setUploadPick(null)} aria-label="关闭">×</button>
            </header>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--muted)' }}>落盘到子目录</label>
                <select
                  value={uploadPick.subdir}
                  onChange={(e) => setUploadPick({ ...uploadPick, subdir: e.target.value })}
                  disabled={uploading}
                  style={{ width: '100%' }}
                >
                  {IMPORT_SUBDIRS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--ink-2)', maxHeight: 240, overflow: 'auto' }}>
                {uploadPick.files.map((f) => <li key={f.name}>{f.name}<span style={{ color: 'var(--muted)' }}> · {Math.round(f.size / 1024)} KB</span></li>)}
              </ul>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn-ghost" disabled={uploading} onClick={() => setUploadPick(null)}>取消</button>
                <button className="btn-primary" disabled={uploading} onClick={confirmUpload}>{uploading ? '上传中…' : '确认导入'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {artifactsOpen && (
        <div className="side-panel-mask" onClick={() => setArtifactsOpen(false)}>
          <div className="side-panel artifacts-panel" onClick={(e) => e.stopPropagation()}>
            <header className="side-panel-head">
              <Icon name="package" size={14} />
              <span>本会话产物</span>
              <span className="spacer" />
              <button className="btn-ghost close-x" onClick={() => setArtifactsOpen(false)} aria-label="关闭">×</button>
            </header>
            <SessionArtifacts events={events} onOpenFile={(p) => { setArtifactsOpen(false); onOpenFile?.(p); }} />
          </div>
        </div>
      )}
      {(history.length > 0 || tasks) && (
        <div className="chat-toolbar">
          <span className="chat-count">
            {history.length} 条消息{tasks ? ` · ${tasks.done}/${tasks.total} 任务` : ''}
          </span>
          <button
            className="ghost-btn"
            onClick={() => setArtifactsOpen(true)}
            title="查看本会话生成/写入的文件、报告、记忆"
          >
            <Icon name="package" size={12} /> 产物
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              if (confirm('清空当前作品的对话记录？（不会影响已落盘的小说文件）')) onClear?.();
            }}
            title="清空本作品的对话历史"
          >
            <Icon name="trash" size={12} /> 清空对话
          </button>
        </div>
      )}
      <TasksPanel tasks={tasks} />
      <div className="chat-list" ref={scrollRef}>
        {history.length === 0 && (
          <div className="welcome">
            <div className="welcome-mark" aria-hidden="true">墨</div>
            <div className="welcome-inner">
              <h3 className="welcome-title">{getGreeting().title}</h3>
              <p className="welcome-sub">
                {project ? <>当前作品 · <span className="welcome-proj">{project}</span></> : '先在顶栏新建一部作品。'}
              </p>
              <ul className="welcome-tips tips-grid">
                {[
                  { icon: 'compass', title: '立项一本新书', sub: '我想写本玄幻修仙文，主角是个废材逆袭', send: '我想写本玄幻修仙文，主角是个废材逆袭。请按 setup-pipeline 引导立项。' },
                  { icon: 'package', title: '导入已有设定', sub: '把人物 / 世界观 / 卷纲拖进来', send: '我有一批已有设定要导入，请把 imports/ 里的素材按 bulk-import 流程沉淀到 knowledge/，并跑 lookup_rebuild + conflict_check。' },
                  { icon: 'pen', title: '写下一章', sub: '章规划 + 正文 + 评分', send: '/write' },
                  { icon: 'eye', title: '看伏笔总账', sub: '检查未闭合伏笔', send: '/foreshadow' },
                ].map((tip) => (
                  <li key={tip.title}>
                    <button
                      type="button"
                      className="welcome-tip-btn"
                      disabled={busy}
                      onClick={() => onSend(tip.send)}
                    >
                      <span className="wt-icon"><Icon name={tip.icon} size={14} /></span>
                      <span className="wt-body">
                        <span className="wt-title">{tip.title}</span>
                        <span className="wt-sub">{tip.sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {history.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            msgIndex={i}
            events={groupsByAssistantIdx.get(i)}
            onOpenFile={onOpenFile}
            onRetryFromIndex={onRetryFromIndex}
            onEditResend={onEditResend}
          />
        ))}
        <AskUserCard ask={askUser} onPick={pickOption} />
      </div>
      {slashHits.length > 0 && (
        <div className="slash-menu">
          {slashHits.map((c) => (
            <div key={c.cmd} className="slash-item" onClick={() => setText(c.cmd + ' ')}>
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-tip">{c.tip}</span>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`scroll-to-bottom${showJump ? ' visible' : ''}`}
        onClick={jumpToBottom}
        title="回到最新"
        aria-label="回到最新"
      >
        <Icon name="chevronsDown" size={14} />
        {busy && <span className="badge">·</span>}
      </button>
      <LiveActivity events={events} busy={busy} />
      {queuedMessages.length > 0 && (
        <div className="chat-queue chat-input-row">
          <Icon name="clock" size={12} />
          <span>已排队 <strong>{queuedMessages.length}</strong> 条中途指令</span>
          <div className="chat-queue-list">
            {queuedMessages.map((q, i) => (
              <span key={i} className="chat-queue-chip" title={q}>
                <span className="chat-queue-chip-text">{q}</span>
                {onEditQueue && (
                  <button
                    type="button"
                    className="chat-queue-chip-btn edit"
                    title="取回到输入框"
                    onClick={() => { setText(q); onEditQueue(i); taRef.current?.focus(); }}
                  >
                    <Icon name="pen" size={11} />
                  </button>
                )}
                {onDequeue && (
                  <button
                    type="button"
                    className="chat-queue-chip-btn"
                    title="移除"
                    onClick={() => onDequeue(i)}
                  >
                    <Icon name="close" size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="chat-input-row">
        <div className="chat-input-card">
          {busy && onStop && (
            <button
              type="button"
              className="floating-stop"
              onClick={() => onStop?.()}
              title="停止生成"
            >
              <span className="floating-stop-dot" />
              <span>停止生成</span>
            </button>
          )}
          {mentionState && mentionState.items.length > 0 && (
            <div className="mention-menu" onMouseDown={(e) => e.preventDefault()}>
              {(() => {
                const groups = new Map();
                for (const it of mentionState.items) {
                  if (!groups.has(it.section)) groups.set(it.section, []);
                  groups.get(it.section).push(it);
                }
                let counter = -1;
                return [...groups.entries()].map(([sec, list]) => (
                  <div key={sec}>
                    <div className="mention-section">{sec}</div>
                    {list.map((it) => {
                      counter += 1;
                      const isActive = counter === mentionState.active;
                      return (
                        <button
                          key={it.path}
                          type="button"
                          className={`mention-item${isActive ? ' active' : ''}`}
                          onClick={() => insertMention(it)}
                        >
                          <span>{it.label}</span>
                          <span className="mention-path">{it.path}</span>
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          )}
          {mentionState && mentionState.items.length === 0 && (
            <div className="mention-menu">
              <div className="mention-empty">没有匹配的章节 / 设定 / 大纲</div>
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            placeholder={
              busy
                ? '生成中…输入中途指令，Ctrl+Enter 排队'
                : askUser
                  ? '回答上面的问题，或自由输入…'
                  : '说点什么…   /  快捷指令   @  提及章节/设定   Ctrl+Enter 发送'
            }
            value={text}
            onChange={onTextChange}
            onKeyUp={(e) => {
              const v = e.currentTarget.value;
              const caret = e.currentTarget.selectionStart || v.length;
              setMentionState(computeMention(v, caret));
            }}
            onClick={(e) => {
              const v = e.currentTarget.value;
              const caret = e.currentTarget.selectionStart || v.length;
              setMentionState(computeMention(v, caret));
            }}
            onBlur={() => setTimeout(closeMention, 150)}
            onKeyDown={(e) => {
              // 提及导航
              if (mentionState && mentionState.items.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMentionState((s) => s && ({ ...s, active: Math.min(s.items.length - 1, s.active + 1) })); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMentionState((s) => s && ({ ...s, active: Math.max(0, s.active - 1) })); return; }
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  insertMention(mentionState.items[mentionState.active]);
                  return;
                }
                if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
                if (e.key === 'Tab') { e.preventDefault(); insertMention(mentionState.items[mentionState.active]); return; }
              }
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
            }}
          />
          <div className="chat-input-toolbar">
            <label className="cit-btn" title="上传 .md/.txt（也可拖入聊天区）">
              <Icon name="file" size={13} />
              <span>附件</span>
              <input
                type="file"
                accept=".md,.markdown,.txt,.json,.yaml,.yml"
                multiple
                style={{ display: 'none' }}
                disabled={busy || !project}
                onChange={(e) => { onFilesDropped(e.target.files); e.target.value = ''; }}
              />
            </label>
            <button
              type="button"
              className="cit-btn"
              onClick={() => {
                const ta = taRef.current;
                if (!ta) return;
                const pos = ta.selectionStart || text.length;
                const before = text.slice(0, pos);
                const after = text.slice(pos);
                const next = `${before}@${after}`;
                setText(next);
                setTimeout(() => {
                  ta.focus();
                  ta.setSelectionRange(pos + 1, pos + 1);
                  setMentionState(computeMention(next, pos + 1));
                }, 0);
              }}
              title="提及章节 / 设定 / 大纲（也可直接输入 @）"
              disabled={!project}
            >
              <Icon name="at" size={12} />
              <span>提及</span>
            </button>
            <span className="spacer" />
            {text.length > 0 && (
              <span className="cit-charcount">{text.length}</span>
            )}
            {onModeChange && (
              <div className="tb-more-wrap" ref={modeBtnRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="cit-btn"
                  onClick={() => setModeOpen((v) => !v)}
                  title="模型档位"
                >
                  <Icon name="cpu" size={12} />
                  <span className="cit-mode cit-mode-current">{(MODE_INFO[mode] || MODE_INFO.pro).label}</span>
                  <Icon name="chevronDown" size={11} />
                </button>
                {modeOpen && (
                  <div className="cit-mode-pop" role="menu">
                    {Object.entries(MODE_INFO).map(([key, info]) => (
                      <button
                        key={key}
                        type="button"
                        className={`cit-mode-item${mode === key ? ' active' : ''}`}
                        onClick={() => { onModeChange(key); setModeOpen(false); }}
                      >
                        <span>{info.label}</span>
                        <span className="cit-mode-item-sub">{info.sub}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className="cit-send-btn"
              onClick={submit}
              disabled={!text.trim()}
              title={busy ? '排队中途指令 (Ctrl+Enter)' : '发送 (Ctrl+Enter)'}
              aria-label="发送"
            >
              <Icon name="send" size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
