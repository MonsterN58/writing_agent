import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon.jsx';

const FIELDS = [
  { key: 'apiKey',      label: 'API Key',         placeholder: 'sk-...',                  type: 'password', desc: '留空则回退到 .env 中的 LLM_API_KEY' },
  { key: 'baseUrl',     label: 'Base URL',        placeholder: 'https://api.deepseek.com', type: 'text',     desc: 'OpenAI 兼容的根地址，如 deepseek / qwen / openai' },
  { key: 'model',       label: '主模型 (default)', placeholder: 'deepseek-chat',           type: 'text',     desc: '日常对话 / Agent ReAct 主循环' },
  { key: 'modelCheap',  label: 'cheap 档模型',     placeholder: '同主模型',                type: 'text',     desc: 'critic / wiki_ingest / 子 agent；留空回退主模型' },
  { key: 'modelWriter', label: 'writer 档模型',    placeholder: '同主模型',                type: 'text',     desc: '写章 / 改稿高质量档；留空回退主模型' },
  { key: 'modelUltra',  label: 'ultra 档模型',     placeholder: '同主模型',                type: 'text',     desc: '最高质量 / 长上下文档；留空回退主模型' },
  { key: 'embedModel',  label: 'Embed 模型',       placeholder: 'text-embedding-3-small',  type: 'text',     desc: 'wiki 向量召回；留空则禁用向量检索' },
  { key: 'temperature', label: '温度 (default)',  placeholder: '0.8',                     type: 'number',   desc: '0~2，默认 0.8' },
  { key: 'maxTokens',   label: 'max_tokens',      placeholder: '8192',                    type: 'number',   desc: '主模型单次最大输出 tokens，留空使用内置默认' },
];

const ADVANCED_FIELDS = [
  { key: 'temperatureCheap',  label: '温度 · cheap',  type: 'number' },
  { key: 'temperatureWriter', label: '温度 · writer', type: 'number' },
  { key: 'temperatureUltra',  label: '温度 · ultra',  type: 'number' },
  { key: 'maxTokensCheap',    label: 'max_tokens · cheap',  type: 'number' },
  { key: 'maxTokensWriter',   label: 'max_tokens · writer', type: 'number' },
  { key: 'maxTokensUltra',    label: 'max_tokens · ultra',  type: 'number' },
];

function srcLabel(src) {
  if (src === 'override') return { text: '已覆盖', cls: 'src-override' };
  if (src === 'env') return { text: '来自 .env', cls: 'src-env' };
  return { text: '未配置', cls: 'src-none' };
}

const ENV_KEY_MAP = {
  apiKey: 'LLM_API_KEY',
  baseUrl: 'LLM_BASE_URL',
  model: 'LLM_MODEL',
  modelCheap: 'LLM_MODEL_CHEAP',
  modelWriter: 'LLM_MODEL_WRITER',
  modelUltra: 'LLM_MODEL_ULTRA',
  embedModel: 'LLM_EMBED_MODEL',
  temperature: 'LLM_TEMPERATURE',
  temperatureCheap: 'LLM_TEMPERATURE_CHEAP',
  temperatureWriter: 'LLM_TEMPERATURE_WRITER',
  temperatureUltra: 'LLM_TEMPERATURE_ULTRA',
  maxTokens: 'LLM_MAX_TOKENS',
  maxTokensCheap: 'LLM_MAX_TOKENS_CHEAP',
  maxTokensWriter: 'LLM_MAX_TOKENS_WRITER',
  maxTokensUltra: 'LLM_MAX_TOKENS_ULTRA',
};

export default function LLMSettings({ open, onClose }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [err, setErr] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/llm-config');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'load failed');
      setCfg(d);
      // 仅把"override 来源"的值显示出来；env 来源的字段留空作为占位符
      const init = {};
      for (const key of Object.keys(ENV_KEY_MAP)) {
        const envKey = ENV_KEY_MAP[key];
        if (d.sources?.[envKey] === 'override') {
          if (key === 'apiKey') init[key] = ''; // 永远不回填 key
          else init[key] = d[key] != null ? String(d[key]) : '';
        } else {
          init[key] = '';
        }
      }
      setForm(init);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setTestResult(null);
      setShowAdvanced(false);
    }
  }, [open, refresh]);

  const onChange = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const submit = async () => {
    setSaving(true); setErr(''); setTestResult(null);
    try {
      // 只发送非空字段；空字符串意为"清除该覆盖"，需要用 null 显式传
      const payload = {};
      for (const [key, val] of Object.entries(form)) {
        const trimmed = typeof val === 'string' ? val.trim() : val;
        // apiKey 留空 = 不修改；其它字段留空 = 清除覆盖
        if (key === 'apiKey') {
          if (trimmed) payload[key] = trimmed;
        } else {
          payload[key] = trimmed === '' ? null : trimmed;
        }
      }
      const r = await fetch('/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setCfg(d.config);
      // 重置 form 输入回显
      await refresh();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (profile = 'default') => {
    setTesting(true); setTestResult(null); setErr('');
    try {
      const r = await fetch('/api/llm-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      const d = await r.json();
      setTestResult({ ok: r.ok && d.ok !== false, ...d });
    } catch (e) {
      setTestResult({ ok: false, error: String(e.message || e) });
    } finally {
      setTesting(false);
    }
  };

  const clearAll = async () => {
    if (!confirm('清除所有 LLM 覆盖配置？将回退到 .env。')) return;
    setSaving(true); setErr('');
    try {
      const payload = {};
      for (const key of Object.keys(ENV_KEY_MAP)) payload[key] = null;
      const r = await fetch('/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'reset failed');
      await refresh();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const renderField = (f) => {
    const envKey = ENV_KEY_MAP[f.key];
    const src = srcLabel(cfg?.sources?.[envKey] || 'none');
    const effective = cfg?.[f.key];
    const placeholder = cfg && cfg.sources?.[envKey] === 'env'
      ? (f.key === 'apiKey'
          ? (cfg.apiKeyMasked || '已从 .env 加载')
          : (effective != null && effective !== '' ? `当前 .env: ${effective}` : f.placeholder))
      : f.placeholder;
    return (
      <div key={f.key} className="row">
        <label>
          {f.label}
          <span className={`llm-src-tag ${src.cls}`}>{src.text}</span>
          {f.desc && <small>{f.desc}</small>}
        </label>
        <input
          type={f.type || 'text'}
          value={form[f.key] ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(f.key, e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    );
  };

  return (
    <div className="side-panel-mask" onClick={onClose}>
      <div className="side-panel llm-settings-panel" onClick={(e) => e.stopPropagation()}>
        <header className="side-panel-head">
          <Icon name="settings" size={14} />
          <span>LLM 配置</span>
          <span className="spacer" />
          <button className="btn-ghost" onClick={refresh} disabled={loading} title="重新读取">
            <Icon name="refresh" size={12} /> 刷新
          </button>
          <button className="btn-ghost close-x" onClick={onClose}>×</button>
        </header>

        {err && <div className="side-err">⚠ {err}</div>}

        {!cfg ? (
          <div className="side-empty">加载中…</div>
        ) : (
          <div className="side-form">
            <div className="llm-status-card">
              <div>
                <strong>当前生效：</strong>
                <code>{cfg.model || '(未设置)'}</code> @ <code>{cfg.baseUrl || '(未设置)'}</code>
              </div>
              <div>
                <strong>API Key：</strong>
                {cfg.hasKey ? <code>{cfg.apiKeyMasked}</code> : <span className="src-none">未配置</span>}
              </div>
              <div className="llm-status-meta">
                覆盖配置文件：<code>{cfg.configPath}</code>
                {cfg.overrideKeys.length > 0 && <> · 已覆盖 {cfg.overrideKeys.length} 项</>}
              </div>
            </div>

            {FIELDS.map(renderField)}

            <div className="row">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                <Icon name={showAdvanced ? 'chevronDown' : 'chevronRight'} size={12} />
                {showAdvanced ? '收起' : '展开'} 进阶（各档位温度 / max_tokens）
              </button>
            </div>
            {showAdvanced && (
              <div className="llm-advanced-grid">
                {ADVANCED_FIELDS.map(renderField)}
              </div>
            )}

            {testResult && (
              <div className={`llm-test-result ${testResult.ok ? 'ok' : 'fail'}`}>
                {testResult.ok ? (
                  <>
                    ✅ 连通成功 · model=<code>{testResult.model}</code> · {testResult.latencyMs}ms
                    {testResult.sample && <> · 输出：<em>{testResult.sample}</em></>}
                  </>
                ) : (
                  <>❌ 失败：{testResult.error || '未知错误'} {testResult.status ? `(HTTP ${testResult.status})` : ''}</>
                )}
              </div>
            )}

            <div className="form-actions">
              <button className="btn-ghost" onClick={clearAll} disabled={saving || testing}>
                清除所有覆盖
              </button>
              <span className="spacer" />
              <button className="btn-ghost" onClick={() => runTest('default')} disabled={testing || saving}>
                {testing ? '测试中…' : '测试连通'}
              </button>
              <button className="btn-primary" onClick={submit} disabled={saving || testing}>
                {saving ? '保存中…' : '保存配置'}
              </button>
            </div>

            <p className="llm-hint">
              覆盖项写入 <code>{cfg.configPath}</code>（已加入 .gitignore，仅本机生效）；保存后立即对所有 LLM 调用生效，无需重启后端。
              留空任一字段会清除该项覆盖、回退到 <code>.env</code> 中的同名变量。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
