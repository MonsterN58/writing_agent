import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Icon from './Icon.jsx';
import ToolEventStrip from './ToolEventStrip.jsx';
import TurnTimeline from './TurnTimeline.jsx';

const LS_ADVANCED = 'moshu.advancedView';

// 兼容：把 content 里残留的 <thinking>...</thinking> 也抽出来当一段思考
function extractInlineThinking(text) {
  const re = /<thinking>([\s\S]*?)<\/thinking>/g;
  const thinks = [];
  const stripped = (text || '').replace(re, (_m, inner) => {
    if (inner && inner.trim()) thinks.push(inner.trim());
    return '';
  });
  return { stripped, thinks };
}

function stripTransportToolMarkup(text) {
  return String(text || '')
    .replace(/<tool_call\s*>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<invoke\s+name=["'][^"']+["']\s*>[\s\S]*?<\/invoke>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function CopyButton({ getText, className = 'bubble-act-btn', label = '复制', icon = 'copy', title = '复制' }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e) => {
    e.stopPropagation();
    try {
      const t = typeof getText === 'function' ? getText() : (getText || '');
      navigator.clipboard?.writeText(t || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button type="button" className={`${className}${copied ? ' copied' : ''}`} onClick={onClick} title={title}>
      <Icon name={icon} size={11} />
      <span className="label">{copied ? '已复制' : label}</span>
    </button>
  );
}

function CodeBlock({ inline, className, children, ...props }) {
  const text = String(children || '').replace(/\n$/, '');
  const lang = (className || '').replace(/^language-/, '') || '';
  if (inline) {
    return <code className={className} {...props}>{children}</code>;
  }
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-block-lang">{lang || 'text'}</span>
        <CopyButton getText={() => text} className="code-block-copy" label="复制" />
      </div>
      <pre><code className={className}>{text}</code></pre>
    </div>
  );
}

function ThinkBlock({ text, label, defaultOpen = false }) {
  if (!text || !text.trim()) return null;
  const len = text.trim().length;
  return (
    <details className="think-inline" open={defaultOpen}>
      <summary>
        <Icon name="thinking" size={11} className="think-ico" />
        <span className="think-label">{label || '思考'} · {len.toLocaleString()} 字</span>
      </summary>
      <pre>{text.trim()}</pre>
    </details>
  );
}

const MD_COMPONENTS = {
  code: CodeBlock,
};

function MessageMarkdown({ text }) {
  // 流式时直接走 markdown 也没问题，react-markdown 会增量解析
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {text || ''}
    </ReactMarkdown>
  );
}

export default function MessageBubble({ msg, events, onOpenFile, onRetryFromIndex, onEditResend, msgIndex }) {
  const [advanced, setAdvanced] = useState(() => {
    try { return localStorage.getItem(LS_ADVANCED) === '1'; } catch { return false; }
  });
  const toggleAdvanced = () => {
    setAdvanced((v) => {
      const nv = !v;
      try { localStorage.setItem(LS_ADVANCED, nv ? '1' : '0'); } catch {}
      return nv;
    });
  };

  if (msg.role === 'user') {
    return (
      <div className="bubble user">
        <div className="bubble-body">{msg.content}</div>
        <div className="bubble-actions">
          <CopyButton getText={() => msg.content || ''} label="复制" />
          {onEditResend && (
            <button
              type="button"
              className="bubble-act-btn"
              onClick={() => onEditResend(msgIndex, msg.content || '')}
              title="把这条放回输入框，并重新发送"
            >
              <Icon name="pen" size={11} /> <span className="label">编辑重发</span>
            </button>
          )}
        </div>
      </div>
    );
  }
  if (msg.kind === 'system_warn') {
    return (
      <div className="bubble system-warn">
        <Icon name="giveup" size={14} className="sysw-ico" />
        <div className="bubble-body">{msg.content}</div>
      </div>
    );
  }

  // 思考来源：① reasoningTurns（已收档的多轮）② reasoning（当前流式）③ content 内残留的 <thinking>
  const turns = Array.isArray(msg.reasoningTurns) ? msg.reasoningTurns : [];
  const live = msg.reasoning || '';
  const { stripped, thinks } = extractInlineThinking(msg.content || '');
  const displayText = stripTransportToolMarkup(stripped);
  const allTurns = [...turns, ...thinks];
  const hasAnyThink = allTurns.length > 0 || live.trim().length > 0;
  const showActions = !msg.streaming && displayText.length > 0;

  return (
    <div className={`bubble assistant ${msg.streaming ? 'streaming' : ''}`}>
      <div className="bubble-head">
        <span className="who-name">墨枢</span>
        {msg.streaming && (
          <span className="who-streaming">正在落笔</span>
        )}
      </div>
      {advanced && hasAnyThink && (
        <div className="bubble-thinks">
          {allTurns.map((t, i) => (
            <ThinkBlock key={`r${i}`} text={t} label={allTurns.length > 1 ? `思考 · 第 ${i + 1} 段` : '思考'} />
          ))}
          {live.trim() && (
            <ThinkBlock
              text={live}
              defaultOpen={!!msg.streaming}
              label={msg.streaming ? `思考 · 进行中（第 ${allTurns.length + 1} 段）` : `思考 · 第 ${allTurns.length + 1} 段`}
            />
          )}
        </div>
      )}
      {events && events.length > 0 && (
        <TurnTimeline events={events} onOpenFile={onOpenFile} />
      )}
      <div className="bubble-body">
        <MessageMarkdown text={displayText} />
        {msg.streaming && <span className="caret" aria-hidden="true" />}
      </div>
      {showActions && (
        <div className="bubble-actions">
          <CopyButton getText={() => displayText} label="复制" />
          {onRetryFromIndex && (
            <button
              type="button"
              className="bubble-act-btn"
              onClick={() => onRetryFromIndex(msgIndex)}
              title="重新生成本回合"
            >
              <Icon name="refresh" size={11} /> <span className="label">重试</span>
            </button>
          )}
          {(events && events.length > 0) || hasAnyThink ? (
            <button
              type="button"
              className="bubble-act-btn"
              onClick={toggleAdvanced}
              title={advanced ? '隐藏开发者视图' : '显示思考与原始事件'}
            >
              <Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={10} />
              <span className="label">开发者视图{events?.length ? ` · ${events.length}` : ''}</span>
            </button>
          ) : null}
        </div>
      )}
      {advanced && events && events.length > 0 && (
        <div className="bubble-advanced">
          <ToolEventStrip events={events} />
        </div>
      )}
    </div>
  );
}
