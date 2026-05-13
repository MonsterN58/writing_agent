import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

// 每 1M token 的价格（美元）。可在 .env 里覆盖，否则按内置表按 model 名前缀匹配。
// 参考 2024-2025 公开价格，仅供展示；准确价以供应商官网为准。
const DEFAULT_PRICES = [
  { prefix: 'deepseek-chat',      prompt: 0.27, completion: 1.10, cacheDiscount: 0.9 },
  { prefix: 'deepseek-reasoner',  prompt: 0.55, completion: 2.19, cacheDiscount: 0.9 },
  { prefix: 'deepseek',           prompt: 0.27, completion: 1.10, cacheDiscount: 0.9 },
  { prefix: 'qwen-max',           prompt: 2.50, completion: 10.0, cacheDiscount: 0.0 },
  { prefix: 'qwen-plus',          prompt: 0.40, completion: 1.20, cacheDiscount: 0.0 },
  { prefix: 'qwen-turbo',         prompt: 0.05, completion: 0.20, cacheDiscount: 0.0 },
  { prefix: 'qwen',               prompt: 0.40, completion: 1.20, cacheDiscount: 0.0 },
  { prefix: 'gpt-4o-mini',        prompt: 0.15, completion: 0.60, cacheDiscount: 0.5 },
  { prefix: 'gpt-4o',             prompt: 2.50, completion: 10.0, cacheDiscount: 0.5 },
  { prefix: 'gpt-4.1-mini',       prompt: 0.40, completion: 1.60, cacheDiscount: 0.5 },
  { prefix: 'gpt-4.1',            prompt: 2.00, completion: 8.00, cacheDiscount: 0.5 },
  { prefix: 'o1-mini',            prompt: 1.10, completion: 4.40, cacheDiscount: 0.5 },
  { prefix: 'o1',                 prompt: 15.0, completion: 60.0, cacheDiscount: 0.5 },
  { prefix: 'mimo',               prompt: 0.30, completion: 1.20, cacheDiscount: 0.9 },
];

function priceFor(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  return DEFAULT_PRICES.find((p) => m.startsWith(p.prefix)) || DEFAULT_PRICES[DEFAULT_PRICES.length - 1];
}

function estimateCost({ prompt, completion, cached, model }) {
  const p = priceFor(model);
  if (!p) return null;
  const cachedPart = (cached || 0) / 1e6 * p.prompt * (1 - p.cacheDiscount);
  const uncachedPrompt = Math.max(0, prompt - (cached || 0));
  const promptPart = uncachedPrompt / 1e6 * p.prompt;
  const completionPart = completion / 1e6 * p.completion;
  return promptPart + cachedPart + completionPart;
}

function fmtNum(n) {
  if (n == null) return '?';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function fmtUSD(v) {
  if (v == null) return '—';
  if (v < 0.01) return '<$0.01';
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

// 从事件流里归纳 HUD 要展示的数据
export function useHudState(events) {
  return React.useMemo(() => {
    let model = null;
    let profile = null;
    let turn = 0;
    let maxTurns = null;
    let promptChars = null;
    let prompt = 0, completion = 0, cached = 0;
    let lastTotal = null;
    let tracePath = null;
    let running = false;
    let lastToolMs = null;
    for (const e of events) {
      switch (e.type) {
        case 'start':
          model = e.model || model;
          maxTurns = e.maxTurns || maxTurns;
          running = true;
          break;
        case 'turn_start':
          turn = e.turn || turn;
          break;
        case 'llm_done':
          lastToolMs = e.ms || lastToolMs;
          model = e.model || model;
          profile = e.profile || profile;
          break;
        case 'prompt_size':
          promptChars = e.chars ?? promptChars;
          break;
        case 'token_usage':
          if (e.total) {
            prompt = e.total.prompt ?? prompt;
            completion = e.total.completion ?? completion;
            cached = e.total.cached ?? cached;
          }
          lastTotal = e;
          break;
        case 'trace_open':
          tracePath = e.path || tracePath;
          break;
        case 'done':
        case 'error':
        case 'awaiting_user':
        case 'agent_giveup':
          running = false;
          break;
      }
    }
    const hitRate = prompt > 0 && cached >= 0 ? Math.round((cached / prompt) * 100) : null;
    const cost = estimateCost({ prompt, completion, cached, model });
    const lastCost = lastTotal ? estimateCost({ prompt: lastTotal.prompt || 0, completion: lastTotal.completion || 0, cached: lastTotal.cached || 0, model }) : null;
    return { model, profile, turn, maxTurns, promptChars, prompt, completion, cached, hitRate, cost, lastCost, tracePath, running, lastTotal };
  }, [events]);
}

export default function StatusHUD({ events, onOpenTrace, inline = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const s = useHudState(events);
  // 没有任何可展示数据就不渲染
  if (!s.model && s.prompt === 0 && !s.running) return null;

  const cacheColor = s.hitRate == null ? 'hud-cache-na' : s.hitRate >= 80 ? 'hud-cache-good' : s.hitRate >= 50 ? 'hud-cache-mid' : 'hud-cache-low';

  // inline 模式：只在顶栏显示一行精简信息，点击展开为浮窗（与原浮窗行为一致）
  if (inline) {
    if (expanded) {
      return (
        <>
          <div className="cp-mask" style={{ background: 'transparent', zIndex: 60 }} onClick={() => setExpanded(false)} />
          <div className="hud" style={{ zIndex: 61 }}>
            <button className="hud-fold" onClick={() => setExpanded(false)} title="收起">
              <Icon name="close" size={11} />
            </button>
            <div className="hud-row hud-row-model">
              <Icon name="cpu" size={12} className="hud-ico" />
              <span className="hud-label">{s.model || '未启动'}{s.profile ? ` · ${s.profile}` : ''}</span>
              {s.running && <span className="hud-pulse" title="运行中" />}
            </div>
            {s.turn > 0 && (
              <div className="hud-row">
                <Icon name="turnStart" size={12} className="hud-ico" />
                <span>轮 {s.turn}{s.maxTurns ? ` / ${s.maxTurns}` : ''}</span>
              </div>
            )}
            <div className="hud-row">
              <Icon name="trending" size={12} className="hud-ico" />
              <span>P {fmtNum(s.prompt)} · C {fmtNum(s.completion)}</span>
            </div>
            <div className={`hud-row ${cacheColor}`}>
              <Icon name="shield" size={12} className="hud-ico" />
              <span>缓存 {s.hitRate == null ? '—' : `${s.hitRate}%`}（{fmtNum(s.cached)}）</span>
            </div>
            <div className="hud-row hud-row-cost">
              <Icon name="coins" size={12} className="hud-ico" />
              <span className="hud-cost">{fmtUSD(s.cost)}</span>
              {s.lastCost != null && <span className="hud-sub">本轮 {fmtUSD(s.lastCost)}</span>}
            </div>
            {s.tracePath && (
              <button className="hud-trace" onClick={() => onOpenTrace?.(s.tracePath)} title={s.tracePath}>
                <Icon name="download" size={11} /> trace
              </button>
            )}
          </div>
        </>
      );
    }
    return (
      <div className="hud hud-inline" onClick={() => setExpanded(true)} title={`${s.model || ''} · ${s.turn || 0} 轮 · ${fmtUSD(s.cost)}`}>
        {s.running && <span className="hud-pulse" />}
        <div className="hud-row hud-row-model">
          <Icon name="cpu" size={12} className="hud-ico" />
          <span>{s.model || '未启动'}</span>
        </div>
        {s.turn > 0 && (
          <div className="hud-row">
            <span>轮 {s.turn}{s.maxTurns ? `/${s.maxTurns}` : ''}</span>
          </div>
        )}
        <div className={`hud-row ${cacheColor}`}>
          <span>{s.hitRate == null ? '—' : `${s.hitRate}%`}</span>
        </div>
        <div className="hud-row hud-row-cost">
          <span className="hud-cost">{fmtUSD(s.cost)}</span>
        </div>
      </div>
    );
  }

  // 兼容浮窗（保留原行为）
  if (collapsed) {
    return (
      <div className="hud hud-collapsed" onClick={() => setCollapsed(false)} title="点击展开">
        <Icon name="coins" size={12} />
        <span>{fmtUSD(s.cost)}</span>
        {s.running && <span className="hud-pulse" />}
      </div>
    );
  }

  return (
    <div className="hud">
      <button className="hud-fold" onClick={() => setCollapsed(true)} title="折叠">
        <Icon name="close" size={11} />
      </button>
      <div className="hud-row hud-row-model">
        <Icon name="cpu" size={12} className="hud-ico" />
        <span className="hud-label">{s.model || '未启动'}{s.profile ? ` · ${s.profile}` : ''}</span>
        {s.running && <span className="hud-pulse" title="运行中" />}
      </div>
      {s.turn > 0 && (
        <div className="hud-row">
          <Icon name="turnStart" size={12} className="hud-ico" />
          <span>轮 {s.turn}{s.maxTurns ? ` / ${s.maxTurns}` : ''}</span>
        </div>
      )}
      <div className="hud-row">
        <Icon name="trending" size={12} className="hud-ico" />
        <span>P {fmtNum(s.prompt)} · C {fmtNum(s.completion)}</span>
      </div>
      <div className={`hud-row ${cacheColor}`}>
        <Icon name="shield" size={12} className="hud-ico" />
        <span>缓存 {s.hitRate == null ? '—' : `${s.hitRate}%`}（{fmtNum(s.cached)}）</span>
      </div>
      <div className="hud-row hud-row-cost">
        <Icon name="coins" size={12} className="hud-ico" />
        <span className="hud-cost">{fmtUSD(s.cost)}</span>
        {s.lastCost != null && <span className="hud-sub">本轮 {fmtUSD(s.lastCost)}</span>}
      </div>
      {s.tracePath && (
        <button className="hud-trace" onClick={() => onOpenTrace?.(s.tracePath)} title={s.tracePath}>
          <Icon name="download" size={11} /> trace
        </button>
      )}
    </div>
  );
}
