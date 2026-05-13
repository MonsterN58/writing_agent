import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import TopBar from './components/TopBar.jsx';
import FileTree from './components/FileTree.jsx';
import ChatStream from './components/ChatStream.jsx';
import PreviewDrawer from './components/PreviewDrawer.jsx';
import Icon from './components/Icon.jsx';
import StatusHUD from './components/StatusHUD.jsx';
import TraceDrawer from './components/TraceDrawer.jsx';
import SkillsPanel from './components/SkillsPanel.jsx';
import MemoryPanel from './components/MemoryPanel.jsx';
import ChaptersDashboard from './components/ChaptersDashboard.jsx';
import ForeshadowAlerts from './components/ForeshadowAlerts.jsx';
import LLMSettings from './components/LLMSettings.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Preview from './components/Preview.jsx';
import ShortcutsHelp from './components/ShortcutsHelp.jsx';
import StatusBar from './components/StatusBar.jsx';
import { useToast } from './components/Toast.jsx';

const LS_PROJECT = 'moshu.project';
const LS_HISTORY_PREFIX = 'moshu.history.';
const LS_EVENTS_PREFIX = 'moshu.events.';
const historyKey = (p) => `${LS_HISTORY_PREFIX}${p || '_none'}`;
const eventsKey = (p) => `${LS_EVENTS_PREFIX}${p || '_none'}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientChatError(err) {
  if (err?.name === 'AbortError') return false;
  const msg = String(err?.message || err || '').toLowerCase();
  return /failed to fetch|networkerror|network error|fetch failed|load failed|terminated|econnreset|econnrefused|socket|proxy|http 502|http 503|http 504/.test(msg);
}

async function waitForBackend(signal) {
  for (let i = 0; i < 6; i++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    try {
      const r = await fetch(`/api/health?ts=${Date.now()}`, { cache: 'no-store', signal });
      if (r.ok) return true;
    } catch {}
    await sleep(250 + i * 150);
  }
  return false;
}

function loadHistory(p) {
  try {
    const raw = localStorage.getItem(historyKey(p));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 一次性清理：之前版本会把"用户中断"作为独立 system_warn 消息 push 到对话里
    // 现在改为仅作为事件展示，于是过滤掉历史里残留的这类伪消息
    return arr.filter((m) => !(m && m.kind === 'system_warn' && /中断|主动停止|🛑/.test(String(m.content || ''))));
  } catch { return []; }
}
function saveHistory(p, arr) {
  try { localStorage.setItem(historyKey(p), JSON.stringify(arr.slice(-200))); } catch {}
}

// 事件持久化精简：去掉 token / reasoning，仅保留主线事件，单组最多 24 条
const KEEP_EVENT_TYPES = new Set([
  'user_send', 'tool_call', 'tool_result', 'file_write', 'chapter_saved',
  'chapter_score', 'chapter_critic', 'feedback_saved', 'memory_saved',
  'intent_route', 'review_alert', 'tasks_update', 'ask_user',
  'awaiting_user', 'agent_giveup', 'llm_done', 'error', 'skill_load',
  // Claude Code 风视图需要
  'skill_routed', 'acceptance_report', 'auto_repair', 'auto_repair_tool',
  'subagent_start', 'subagent_done', 'subagent_enqueue',
  'token_usage', 'prompt_size', 'trace_open', 'start', 'turn_start',
  'agent_warmup', 'mode_selected', 'chat_retry', 'chat_retry_success',
  'user_skill_saved', 'edit_file', 'final_summary', 'agent_soft_stop',
  'auto_continue', 'budget_pressure', 'stuck_detected', 'write_preview',
  'agent_state_restored', 'turn_runner', 'user_queued',
]);
function compactEvents(events) {
  const out = [];
  let groupCount = 0;
  for (const e of events) {
    if (e.type === 'user_send') groupCount = 0;
    if (!KEEP_EVENT_TYPES.has(e.type)) continue;
    if (groupCount >= 48 && e.type !== 'user_send') continue;
    // 去掉超大字段
    const slim = { ...e };
    if (slim.result && typeof slim.result === 'object') {
      try {
        const s = JSON.stringify(slim.result);
        if (s.length > 800) slim.result = { _truncated: true, preview: s.slice(0, 600) };
      } catch {}
    }
    if (slim.args && typeof slim.args === 'object') {
      try {
        const s = JSON.stringify(slim.args);
        if (s.length > 400) slim.args = { _truncated: true, preview: s.slice(0, 300) };
      } catch {}
    }
    if (typeof slim.text === 'string' && slim.text.length > 300) slim.text = slim.text.slice(0, 300) + '…';
    out.push(slim);
    groupCount += 1;
  }
  return out.slice(-200);
}
function loadEvents(p) {
  try {
    const raw = localStorage.getItem(eventsKey(p));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 一次性清理：旧版本 bug 导致每次发消息都会持久化一条 agent_giveup 事件
    return arr.filter((e) => !(e && e.type === 'agent_giveup' && /中断/.test(String(e.reason || ''))));
  } catch { return []; }
}
function saveEvents(p, events) {
  try { localStorage.setItem(eventsKey(p), JSON.stringify(compactEvents(events).slice(-600))); } catch {}
}

export default function App() {
  const toast = useToast();
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(() => localStorage.getItem(LS_PROJECT) || null);
  const [files, setFiles] = useState([]);
  const [previewPath, setPreviewPath] = useState(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [events, setEvents] = useState(() => loadEvents(localStorage.getItem(LS_PROJECT)));
  const [chatHistory, setChatHistory] = useState(() => loadHistory(localStorage.getItem(LS_PROJECT)));
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('moshu.mode') || 'pro'; } catch { return 'pro'; }
  });
  const [busy, setBusy] = useState(false);
  const [askUser, setAskUser] = useState(null); // { question, options, context }
  const [tasks, setTasks] = useState(null);     // { tasks: [...], total, done }
  const [queuedMessages, setQueuedMessages] = useState([]);
  const [editDraft, setEditDraft] = useState(null); // { text, nonce } 用于「编辑重发」回填到 ChatStream 输入框
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceFile, setTraceFile] = useState(null); // 指定打开某个 trace 文件
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [foreshadowOpen, setForeshadowOpen] = useState(false);
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isWide, setIsWide] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(min-width: 1400px)').matches;
  });
  const abortRef = useRef(null);

  // 监听宽屏切换
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1400px)');
    const onChange = (e) => setIsWide(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // 全局 Cmd/Ctrl+K 唤出命令面板；? 打开快捷键面板
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdkOpen((v) => !v);
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onExportNovel = useCallback(async () => {
    if (!project) return;
    try {
      const r = await fetch('/api/export', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'export failed');
      toast.success(
        '导出完成',
        `${d.chapters || '?'} 章 · ${(d.words || 0).toLocaleString()} 字 · ${d.mdRelPath || 'exports/full-novel.md'}`
      );
    } catch (e) { toast.danger('导出失败', String(e.message || e)); }
  }, [project, toast]);

  const onDeleteProject = useCallback(async (name) => {
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'delete failed');
      try { localStorage.removeItem(historyKey(name)); localStorage.removeItem(eventsKey(name)); } catch {}
      if (project === name) {
        setProject(null);
        setChatHistory([]);
        setEvents([]);
      }
      toast.info('已删除', `作品 "${name}" 已删除`);
    } catch (e) { toast.danger('删除失败', String(e.message || e)); }
  }, [project, toast]);

  const stopGenerating = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // project 变化时：持久化 + 切换到对应的历史
  useEffect(() => {
    if (project) localStorage.setItem(LS_PROJECT, project);
    setChatHistory(loadHistory(project));
    setEvents(loadEvents(project));
    setAskUser(null);
    setTasks(null);
  }, [project]);

  // chatHistory 变化时持久化（忽略 streaming 中的中间态，避免频繁写）
  useEffect(() => {
    const hasStreaming = chatHistory.some((m) => m.streaming);
    if (hasStreaming) return;
    saveHistory(project, chatHistory);
  }, [chatHistory, project]);

  // events 持久化（同样在非 busy 时写，避免频繁 stringify）
  useEffect(() => {
    if (busy) return;
    saveEvents(project, events);
  }, [events, project, busy]);

  useEffect(() => {
    try { localStorage.setItem('moshu.mode', mode); } catch {}
  }, [mode]);

  const refreshProjects = useCallback(async () => {
    const r = await fetch('/api/projects');
    const list = await r.json();
    setProjects(list);
    // 只有没保存过、或保存的作品不存在时，才兜底选第一个
    setProject((cur) => {
      if (cur && list.some((p) => p.name === cur)) return cur;
      return list[0]?.name || null;
    });
    return list;
  }, []);

  const refreshFiles = useCallback(async () => {
    if (!project) { setFiles([]); return; }
    const r = await fetch(`/api/files?project=${encodeURIComponent(project)}`);
    const list = await r.json();
    if (Array.isArray(list)) setFiles(list);
  }, [project]);

  useEffect(() => { refreshProjects(); }, []);
  useEffect(() => { refreshFiles(); }, [project, refreshFiles]);

  const openFile = useCallback(async (relPath) => {
    if (!project) return;
    const r = await fetch(`/api/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(relPath)}`);
    if (!r.ok) return;
    const { content } = await r.json();
    setPreviewPath(relPath);
    setPreviewContent(content);
    setPreviewOpen(true);
  }, [project]);

  const sendMessage = useCallback(async (text, opts = {}) => {
    if (!text.trim()) return;
    if (busy) {
      setQueuedMessages((q) => [...q, text.trim()].slice(-5));
      setEvents((ev) => [...ev, { type: 'user_queued', text: text.trim(), time: Date.now() }]);
      return;
    }
    setBusy(true);
    setAskUser(null); // 用户答了问题就关闭旧的求证卡
    const userMsg = { role: 'user', content: text };
    setChatHistory((h) => [...h, userMsg, { role: 'assistant', content: '', reasoning: '', reasoningTurns: [], streaming: true }]);
    setEvents((ev) => [...ev, { type: 'user_send', text, time: Date.now() }]);

    let assistantBuf = '';
    let finalSummaryMd = '';
    let reasoningBuf = '';
    let reasoningTurns = []; // 每个 turn 结束时把当前 reasoningBuf 存档为一项
    let scheduled = false;
    let requestStarted = false;
    const flushBubble = () => {
      scheduled = false;
      setChatHistory((h) => {
        const copy = [...h];
        const last = copy[copy.length - 1];
        if (last && last.streaming) {
          last.content = assistantBuf;
          last.reasoning = reasoningBuf;
          last.reasoningTurns = reasoningTurns;
        }
        return copy;
      });
    };
    const renderBubble = () => {
      // 用 rAF 节流，避免每个 token 都触发 setState 引起气泡频繁重排
      if (scheduled) return;
      scheduled = true;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flushBubble);
      else setTimeout(flushBubble, 16);
    };
    const ac = new AbortController();
    abortRef.current = ac;
    const readChatStream = async ({ retry = false } = {}) => {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ac.signal,
        cache: 'no-store',
        body: JSON.stringify({
          message: text,
          projectName: project,
          mode,
          history: (opts.historyOverride ?? chatHistory).filter(m => !m.streaming).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE 解析：以 \n\n 为分隔
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = block.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          let evt;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          requestStarted = true;
          if (retry && evt.type === 'start') {
            setEvents((ev) => [...ev, { type: 'chat_retry_success', time: Date.now() }]);
          }
          if (evt.type === 'token') {
            assistantBuf += evt.text;
            renderBubble();
          } else if (evt.type === 'reasoning') {
            reasoningBuf += evt.text;
            renderBubble();
          } else {
            // turn_start：把上一 turn 的 reasoning 收档为独立项，开始下一段
            if (evt.type === 'turn_start' && reasoningBuf.trim()) {
              reasoningTurns = [...reasoningTurns, reasoningBuf];
              reasoningBuf = '';
              renderBubble();
            }
            setEvents((ev) => [...ev, { ...evt, time: Date.now() }]);
            // 工具如果是写文件 / 改作品，刷新文件树和作品列表
            if (evt.type === 'file_write') {
              refreshFiles();
              refreshProjects();
            }
            if (evt.type === 'tool_result' && evt.ok && evt.result?._frontendShouldSwitch) {
              setProject(evt.result.switched);
            }
            if (evt.type === 'tool_result' && evt.ok && evt.name === 'create_project') {
              setProject(evt.result.name);
              refreshProjects();
            }
            // 章节写完后自动在预览面板打开
            if (evt.type === 'chapter_saved' && evt.relPath) {
              setTimeout(() => openFile(evt.relPath), 100);
            }
            // 任务清单更新
            if (evt.type === 'tasks_update') {
              setTasks({ tasks: evt.tasks, total: evt.total, done: evt.done });
            }
            // agent 主动求证：弹快速回复卡
            if (evt.type === 'ask_user') {
              setAskUser({ question: evt.question, options: evt.options || [], context: evt.context });
            }
            if (evt.type === 'final_summary') {
              finalSummaryMd = evt.markdown || evt.summary || '';
              if (!assistantBuf.trim() && finalSummaryMd.trim()) {
                assistantBuf = finalSummaryMd;
                renderBubble();
              }
            }
            // agent 放弃：仅作为事件链条的一条记录展示，不再污染对话历史
          }
        }
      }
    };
    try {
      try {
        await readChatStream();
      } catch (e) {
        if (!requestStarted && isTransientChatError(e)) {
          setEvents((ev) => [...ev, { type: 'chat_retry', reason: String(e.message || e), time: Date.now() }]);
          await waitForBackend(ac.signal);
          await readChatStream({ retry: true });
        } else {
          throw e;
        }
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        // 用户主动中断：仅作为事件记录；如果当前 streaming bubble 是空的，移除它（避免留一个空气泡）
        setEvents((ev) => [...ev, { type: 'agent_giveup', reason: '用户中断', time: Date.now() }]);
        setChatHistory((h) => {
          const last = h[h.length - 1];
          if (last && last.streaming && !String(last.content || '').trim()) {
            return h.slice(0, -1);
          }
          return h;
        });
      } else {
        const message = `请求没有进入 Agent 或中途断开：${String(e.message || e)}。如果刚重启后端，我已经尝试自动重连；请再发一次，或检查后端终端日志。`;
        assistantBuf = message;
        renderBubble();
        setEvents((ev) => [...ev, { type: 'error', message, time: Date.now() }]);
      }
    } finally {
      abortRef.current = null;
      // 收尾：把最后一段 reasoning 收档；清理"既无正文又无思考"的空 streaming 气泡
      if (reasoningBuf.trim()) {
        reasoningTurns = [...reasoningTurns, reasoningBuf];
        reasoningBuf = '';
      }
      setChatHistory((h) => {
        const cleaned = h.map((m) => {
          if (!m.streaming) return m;
          return {
            ...m,
            streaming: false,
            content: assistantBuf || finalSummaryMd || m.content || '',
            reasoning: '',                  // 不再驻留中间态
            reasoningTurns: reasoningTurns.length ? reasoningTurns : (m.reasoningTurns || []),
          };
        });
        const last = cleaned[cleaned.length - 1];
        if (
          last && last.role === 'assistant'
          && !String(last.content || '').trim()
          && !(last.reasoningTurns && last.reasoningTurns.length)
        ) {
          return cleaned.slice(0, -1);
        }
        return cleaned;
      });
      setBusy(false);
      refreshFiles();
    }
  }, [busy, project, chatHistory, refreshFiles, refreshProjects, mode, openFile]);

  useEffect(() => {
    if (busy || queuedMessages.length === 0) return;
    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    const id = setTimeout(() => sendMessage(next), 60);
    return () => clearTimeout(id);
  }, [busy, queuedMessages, sendMessage]);

  const onCreateProject = useCallback(async (name) => {
    const r = await fetch('/api/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      const { name: created } = await r.json();
      await refreshProjects();
      setProject(created);
    } else {
      toast.danger('创建失败', (await r.json()).error || '请检查作品名');
    }
  }, [refreshProjects, toast]);

  // 把 events 按 user_send 锚点切组，每组 = 一个用户回合的所有事件
  const eventGroups = useMemo(() => {
    const groups = [];
    let cur = null;
    for (const e of events) {
      if (e.type === 'user_send') {
        cur = [];
        groups.push(cur);
      } else if (cur) {
        cur.push(e);
      }
    }
    return groups;
  }, [events]);

  const dequeueAt = (i) => setQueuedMessages((q) => q.filter((_, idx) => idx !== i));
  const wideInlinePreview = isWide && previewOpen;

  // 「重试」：从某条 assistant 消息回到上一条 user 消息，重新发送
  const onRetryFromIndex = useCallback((assistantIdx) => {
    if (busy) { toast.warn('生成中', '先停止再重试'); return; }
    let userIdx = -1;
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (chatHistory[i]?.role === 'user') { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    const userText = chatHistory[userIdx].content || '';
    const sliced = chatHistory.slice(0, userIdx);
    setChatHistory(sliced);
    sendMessage(userText, { historyOverride: sliced });
  }, [busy, chatHistory, sendMessage]);

  // 「编辑重发」：把用户消息回退到输入框、并把原文回填到 ChatStream 的输入框
  const onEditResend = useCallback((userIdx, originalText) => {
    if (busy) { toast.warn('生成中', '先停止再编辑'); return; }
    if (chatHistory[userIdx]?.role !== 'user') return;
    const draftText = originalText || chatHistory[userIdx].content || '';
    setChatHistory((h) => h.slice(0, userIdx));
    setEditDraft({ text: draftText, nonce: Date.now() });
  }, [busy, chatHistory]);

  return (
    <div className="app">
      <TopBar
        projects={projects}
        project={project}
        onSwitch={setProject}
        onCreate={onCreateProject}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenMemory={() => setMemoryOpen(true)}
        onOpenDashboard={() => setDashboardOpen(true)}
        onOpenForeshadow={() => setForeshadowOpen(true)}
        onOpenLLMSettings={() => setLlmSettingsOpen(true)}
        onExport={onExportNovel}
        onDeleteProject={onDeleteProject}
        mode={mode}
        onModeChange={setMode}
        onOpenCmdK={() => setCmdkOpen(true)}
      />
      <div className={`main ${leftCollapsed ? 'left-collapsed' : ''} ${wideInlinePreview ? 'three-col' : ''}`}>
        <aside className="left">
          <div className="left-head">
            <Icon name="folder" size={13} />
            <span className="left-title">novels/{project || '...'}/</span>
            <button
              className="ghost-btn left-toggle"
              onClick={() => setLeftCollapsed((c) => !c)}
              title={leftCollapsed ? '展开文件树' : '折叠文件树'}
            >
              <Icon name={leftCollapsed ? 'panelOpen' : 'panelClose'} size={13} />
            </button>
          </div>
          {!leftCollapsed && (
            <FileTree
              files={files}
              onOpen={openFile}
              project={project}
              currentPath={previewPath}
              events={events}
            />
          )}
        </aside>
        {leftCollapsed && (
          <button
            className="left-rail"
            onClick={() => setLeftCollapsed(false)}
            title="展开文件树"
          >
            <Icon name="panelOpen" size={14} />
          </button>
        )}
        <section className="center">
          <ChatStream
            history={chatHistory}
            busy={busy}
            onSend={sendMessage}
            onStop={stopGenerating}
            queuedMessages={queuedMessages}
            project={project}
            askUser={askUser}
            tasks={tasks}
            eventGroups={eventGroups}
            events={events}
            files={files}
            mode={mode}
            onModeChange={setMode}
            onRetryFromIndex={onRetryFromIndex}
            onEditResend={onEditResend}
            editDraft={editDraft}
            onOpenFile={openFile}
            onDequeue={dequeueAt}
            onEditQueue={dequeueAt}
            onClear={() => {
              setChatHistory([]);
              setEvents([]);
              setAskUser(null);
              setTasks(null);
              try { localStorage.removeItem(eventsKey(project)); } catch {}
            }}
          />
        </section>
        {wideInlinePreview && (
          <section className="preview-pane">
            <header className="preview-pane-head">
              <Icon name="preview" size={13} />
              <span className="pp-title">{previewPath || ''}</span>
              <button className="pp-close" onClick={() => setPreviewOpen(false)} title="关闭预览">
                <Icon name="close" size={13} />
              </button>
            </header>
            <div className="preview-pane-body">
              <Preview
                path={previewPath}
                content={previewContent}
                project={project}
                onFeedbackSaved={(evt) => {
                  setEvents((ev) => [...ev, { type: 'feedback_saved', ...evt, time: Date.now() }]);
                  refreshFiles();
                }}
                onRefresh={refreshFiles}
                onContentSaved={setPreviewContent}
              />
            </div>
          </section>
        )}
      </div>
      <StatusBar
        project={project}
        mode={mode}
        events={events}
        busy={busy}
        files={files}
        onOpenTrace={(path) => { setTraceFile(path); setTraceOpen(true); }}
      />
      <TraceDrawer
        open={traceOpen}
        onClose={() => { setTraceOpen(false); setTraceFile(null); }}
        project={project}
        initialFile={traceFile}
      />
      <PreviewDrawer
        open={previewOpen && !isWide}
        onClose={() => setPreviewOpen(false)}
        path={previewPath}
        content={previewContent}
        project={project}
        onFeedbackSaved={(evt) => {
          setEvents((ev) => [...ev, { type: 'feedback_saved', ...evt, time: Date.now() }]);
          refreshFiles();
        }}
        onRefresh={refreshFiles}
        onContentSaved={setPreviewContent}
      />
      <SkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} project={project} />
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} project={project} />
      <ChaptersDashboard
        open={dashboardOpen}
        onClose={() => setDashboardOpen(false)}
        project={project}
        onOpenFile={(p) => { setPreviewPath(p); setPreviewOpen(true); setDashboardOpen(false); }}
      />
      <ForeshadowAlerts
        open={foreshadowOpen}
        onClose={() => setForeshadowOpen(false)}
        project={project}
      />
      <LLMSettings open={llmSettingsOpen} onClose={() => setLlmSettingsOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        project={project}
        projects={projects}
        onCreateProject={onCreateProject}
        onSwitchProject={setProject}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenMemory={() => setMemoryOpen(true)}
        onExportNovel={onExportNovel}
        onDeleteProject={() => {
          if (!project) return;
          const confirmName = prompt(`确定删除作品 "${project}" 吗？\n请输入作品名确认：`);
          if (confirmName !== project) return;
          onDeleteProject(project);
        }}
        onSetTheme={(t) => {
          document.documentElement.setAttribute('data-theme', t);
          try { localStorage.setItem('moshu.theme', t); } catch {}
        }}
        theme={typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') || 'light' : 'light'}
        onSetMode={setMode}
        mode={mode}
        onSend={sendMessage}
      />
    </div>
  );
}
