import React, { useState } from 'react';
import Icon from '../Icon.jsx';

const TOOL_ICON = {
  read_file: 'file',
  list_files: 'folder',
  write_chapter: 'chapter',
  write_outline: 'fileWrite',
  update_progress: 'fileWrite',
  setup_work: 'fileWrite',
  edit_file: 'fileWrite',
  wiki_query: 'database',
  wiki_query_more: 'database',
  wiki_ingest: 'database',
  consistency_check: 'critic',
  foreshadow_scan: 'reviewAlert',
  plan_tasks: 'tasks',
  ask_user: 'ask',
  memory_record: 'memory',
  record_feedback: 'feedback',
  list_user_skills: 'skill',
  create_user_skill: 'skill',
  read_user_skill: 'skill',
  delete_user_skill: 'skill',
  export_novel: 'download',
};

function summarize(name, args) {
  if (!args || typeof args !== 'object') return '';
  switch (name) {
    case 'read_file':
    case 'write_chapter':
    case 'write_outline':
    case 'update_progress':
    case 'setup_work':
    case 'edit_file':
      return args.path || (args.chapter != null ? `第 ${args.chapter} 章` : '');
    case 'list_files':
      return args.subPath || '.';
    case 'wiki_query':
    case 'wiki_query_more':
      return Array.isArray(args.keywords) ? args.keywords.slice(0, 4).join(' · ') : (args.query || '');
    case 'wiki_ingest':
      return args.chapter != null ? `第 ${args.chapter} 章` : (args.path || '');
    case 'plan_tasks':
      if (Array.isArray(args.tasks)) return `${args.tasks.length} 个任务`;
      if (Array.isArray(args.updates)) return `更新 ${args.updates.length} 项`;
      return '';
    case 'ask_user':
      return args.question ? String(args.question).slice(0, 40) + (args.question.length > 40 ? '…' : '') : '';
    case 'memory_record':
      return `${args.kind || ''} · ${String(args.summary || '').slice(0, 30)}`;
    case 'record_feedback':
      return `${args.polarity || ''} · ${String(args.note || '').slice(0, 30)}`;
    case 'consistency_check':
      return args.chapter != null ? `第 ${args.chapter} 章` : '';
    case 'foreshadow_scan':
      return args.mode || '全量';
    default:
      try { return JSON.stringify(args).slice(0, 50); } catch { return ''; }
  }
}

function statusIcon(status, ok) {
  if (status === 'blocked') return { icon: 'error', cls: 'tc-blocked' };
  if (status === 'pending') return { icon: 'ask', cls: 'tc-pending' };
  if (status === 'recovered') return { icon: 'refresh', cls: 'tc-pending' };
  if (ok === true || status === 'ok') return { icon: 'done', cls: 'tc-ok' };
  if (ok === false || status === 'error') return { icon: 'error', cls: 'tc-err' };
  return { icon: 'clock', cls: 'tc-running' };
}

function resultPreview(result, name) {
  if (!result) return null;
  const env = result.status ? result : null; // envelope 或裸对象
  const data = env ? env.data : result;
  if (env && env.status === 'error') {
    return { kind: 'error', message: env.error?.message, hint: env.error?.hint, errKind: env.error?.kind };
  }
  if (env && env.status === 'blocked') {
    return { kind: 'blocked', message: env.error?.message, hint: env.error?.hint };
  }
  if (env && env.status === 'pending') {
    return { kind: 'pending', data };
  }
  if (env && env.status === 'recovered') {
    return {
      kind: 'recovered',
      message: env.recovery?.message,
      hint: env.recovery?.hint,
      recoverKind: env.recovery?.kind,
      via: env.via,
      note: env.note,
    };
  }
  // 成功或老格式 —— 挑一些可读字段
  if (data == null) return null;
  if (typeof data === 'string') return { kind: 'text', text: data.slice(0, 200) };
  const keys = Object.keys(data);
  const hint = [];
  if (data.relPath) hint.push(`${data.relPath}`);
  if (typeof data.chars === 'number') hint.push(`${data.chars} 字`);
  if (typeof data.totalChars === 'number' && data.totalChars !== data.chars) hint.push(`共 ${data.totalChars}`);
  if (typeof data.wordCount === 'number') hint.push(`${data.wordCount} 字`);
  if (typeof data.bytesDelta === 'number') hint.push(`Δ${data.bytesDelta > 0 ? '+' : ''}${data.bytesDelta}B`);
  if (typeof data.lineNumber === 'number') hint.push(`行 ${data.lineNumber}`);
  if (Array.isArray(data.entities)) hint.push(`${data.entities.length} 实体`);
  if (Array.isArray(data.foreshadow)) hint.push(`${data.foreshadow.length} 伏笔`);
  if (Array.isArray(data.files)) hint.push(`${data.files.length} 文件`);
  if (hint.length) return { kind: 'summary', text: hint.join(' · ') };
  return { kind: 'summary', text: keys.slice(0, 3).join(',') };
}

function CopyErrButton({ text }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e) => {
    e.stopPropagation();
    try {
      navigator.clipboard?.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button type="button" className={`tc-copy-err${copied ? ' copied' : ''}`} onClick={onClick} title="复制错误信息">
      <Icon name="copy" size={11} /> {copied ? '已复制' : '复制'}
    </button>
  );
}

export default function ToolCard({ call, result, onOpenFile }) {
  const [open, setOpen] = useState(false);
  const name = call?.name;
  const args = call?.args || {};
  const ok = result?.ok;
  const status = result?.status || (result ? (ok ? 'ok' : 'error') : 'running');
  const st = statusIcon(status, ok);
  const summary = summarize(name, args);
  const preview = resultPreview(result?.result, name);
  const iconName = TOOL_ICON[name] || 'tool';

  // 写文件类工具：展示"查看"按钮
  const writeLikePath = (() => {
    if (!result || !ok) return null;
    const data = result.result?.data ?? result.result;
    if (data && typeof data === 'object' && data.relPath) return data.relPath;
    if (['write_chapter', 'write_outline', 'update_progress', 'setup_work', 'edit_file'].includes(name)) {
      return args.path || null;
    }
    return null;
  })();

  return (
    <div className={`tool-card ${st.cls}`}>
      <div className="tc-head" onClick={() => setOpen((v) => !v)}>
        <Icon name={iconName} size={13} className="tc-tool-ico" />
        <span className="tc-name">{name || '?'}</span>
        {summary && <span className="tc-summary">{summary}</span>}
        <span className="tc-spacer" />
        {preview?.kind === 'summary' && <span className="tc-hint">{preview.text}</span>}
        {preview?.kind === 'error' && <span className="tc-hint tc-hint-err">{preview.errKind || 'error'}</span>}
        {preview?.kind === 'recovered' && <span className="tc-hint">{preview.recoverKind || 'recovered'}</span>}
        {preview?.kind === 'blocked' && <span className="tc-hint tc-hint-err">blocked</span>}
        <Icon name={st.icon} size={12} className={`tc-status-ico ${st.cls}`} />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} className="tc-fold" />
      </div>
      {(preview?.kind === 'error' || preview?.kind === 'blocked' || preview?.kind === 'recovered') && (preview.message || preview.hint || preview.note) && (
        <div className={`tc-inline-${preview.kind === 'recovered' ? 'recovered' : 'error'}`}>
          <strong>{preview.kind === 'blocked' ? '已阻断' : preview.kind === 'recovered' ? '已补救' : '错误'}：</strong>{preview.message}
          {preview.hint && <span>建议：{preview.hint}</span>}
          {preview.via && <span>通过：{preview.via}</span>}
          {preview.note && <span>说明：{preview.note}</span>}
          <CopyErrButton text={`${name || ''} ${preview.kind === 'blocked' ? '阻断' : preview.kind === 'recovered' ? '已补救' : '错误'}: ${preview.message || ''}${preview.hint ? '\nhint: ' + preview.hint : ''}${preview.via ? '\nvia: ' + preview.via : ''}${preview.note ? '\nnote: ' + preview.note : ''}`} />
        </div>
      )}
      {open && (
        <div className="tc-body">
          {Object.keys(args).length > 0 && (
            <details className="tc-args" open>
              <summary>参数</summary>
              <pre>{JSON.stringify(args, null, 2)}</pre>
            </details>
          )}
          {preview && (
            <div className={`tc-result tc-result-${preview.kind}`}>
              {preview.kind === 'error' && (
                <>
                  <div className="tc-result-line"><strong>错误：</strong> {preview.message}</div>
                  {preview.hint && <div className="tc-result-hint">{preview.hint}</div>}
                </>
              )}
              {preview.kind === 'blocked' && (
                <>
                  <div className="tc-result-line"><strong>阻断：</strong> {preview.message}</div>
                  {preview.hint && <div className="tc-result-hint">{preview.hint}</div>}
                </>
              )}
              {preview.kind === 'recovered' && (
                <>
                  <div className="tc-result-line"><strong>已补救：</strong> {preview.message}</div>
                  {preview.via && <div className="tc-result-line">已自动执行：{preview.via}</div>}
                  {preview.note && <div className="tc-result-hint">{preview.note}</div>}
                  {preview.hint && <div className="tc-result-hint">{preview.hint}</div>}
                </>
              )}
              {preview.kind === 'text' && <pre>{preview.text}</pre>}
              {preview.kind === 'summary' && (
                <div className="tc-result-line">返回 · {preview.text}</div>
              )}
              {preview.kind === 'pending' && (
                <div className="tc-result-line">等待用户回复…</div>
              )}
            </div>
          )}
          {writeLikePath && onOpenFile && (
            <button className="tc-open-file" onClick={() => onOpenFile(writeLikePath)} title="打开该文件">
              <Icon name="eye" size={11} /> 查看 {writeLikePath}
            </button>
          )}
          {result?.result && (
            <details className="tc-raw">
              <summary>原始 JSON</summary>
              <pre>{JSON.stringify(result.result, null, 2).slice(0, 4000)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
