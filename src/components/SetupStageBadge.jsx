import React, { useEffect, useState } from 'react';

// 立项 8 阶段（与 server/services/setup-manifest.js SETUP_MANIFEST 对应）
// stage 4「地点与物品档案」是 v5 起新增的设定前置硬闸门
const STAGE_LABELS = [
  '未开始',         // 0
  'SOUL',           // 1
  '世界观',         // 2
  '主要人物',       // 3
  '地点与物品',     // 4
  '总纲',           // 5
  '卷纲',           // 6
  'arc 细纲',       // 7
  '开写',           // 8
];
const STAGE_MAX = 8;
const STAGE_WRITE_READY = 7;

export default function SetupStageBadge({ project }) {
  const [stage, setStage] = useState(null);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!project) { setStage(null); setOpen(false); return; }
    loadStage().then(d => { if (!cancelled) setStage(d); });
    return () => { cancelled = true; };
  }, [project]);

  async function loadStage() {
    return fetch(`/api/setup-stage?project=${encodeURIComponent(project)}`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }

  async function loadPlan() {
    if (!project) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch(`/api/setup-repair?project=${encodeURIComponent(project)}&targetStage=${STAGE_WRITE_READY}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '生成计划失败');
      setPlan(d);
      setMsg(d.complete ? '开写前 setup 已完整。' : `补齐计划 ${d.tasks?.length || 0} 项。`);
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function createStubs() {
    if (!project) return;
    if (!confirm('将为缺失的 setup 资产创建安全 TODO 占位文件，不会覆盖已有文件。继续？')) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/setup-repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, targetStage: STAGE_WRITE_READY }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '创建占位失败');
      setPlan(d.plan);
      setMsg(`已创建 ${d.created?.length || 0} 个，占位跳过 ${d.skipped?.length || 0} 个。`);
      setStage(await loadStage());
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (!stage) return null;

  const n = Math.max(0, Math.min(STAGE_MAX, Number(stage.stage) || 0));
  const percent = Math.round((n / STAGE_MAX) * 100);
  const label = STAGE_LABELS[n] || '?';
  const missing = Array.isArray(stage.missing) ? stage.missing : [];
  const missingRequired = Array.isArray(stage.missingRequired) ? stage.missingRequired : missing;
  const nextStage = stage.nextStage || null;

  const titleParts = [`立项阶段 ${n}/${STAGE_MAX} · 已完成到「${label}」`];
  if (nextStage?.label) titleParts.push(`下一阶段：${nextStage.label}${nextStage.skill ? `（${nextStage.skill}）` : ''}`);
  if (missing.length > 0) titleParts.push(`下一步缺：\n- ${missing.slice(0, 8).join('\n- ')}`);
  if (missingRequired.length > missing.length) titleParts.push(`全量缺口：${missingRequired.length} 项\n- ${missingRequired.slice(0, 12).join('\n- ')}`);
  const title = titleParts.join('\n\n');

  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];

  // SVG 进度环参数
  const ringR = 9;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - n / STAGE_MAX);

  return (
    <div className="stage-wrap">
      <button type="button" className="stage-ring-wrap" title={title} onClick={() => setOpen(v => !v)}>
        <svg className="stage-ring" viewBox="0 0 22 22" aria-hidden="true">
          <circle className="bg" cx="11" cy="11" r={ringR} fill="none" strokeWidth="2.5" />
          <circle
            className="fg"
            cx="11"
            cy="11"
            r={ringR}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={ringC}
            strokeDashoffset={ringOffset}
            transform="rotate(-90 11 11)"
          />
          <text x="11" y="14" textAnchor="middle">{n}</text>
        </svg>
        <span className="stage-ring-text"><strong>立项</strong>{label}</span>
        {missingRequired.length > 0 && <span className="stage-ring-missing">缺 {missingRequired.length}</span>}
      </button>
      {open && (
        <div className="stage-pop">
          <div className="stage-pop-head">
            <strong>立项完整度 {n}/{STAGE_MAX}</strong>
            {nextStage?.label && <span>下一步：{nextStage.label}</span>}
          </div>
          <div className="stage-pop-list">
            {(missingRequired.length ? missingRequired : ['无缺口']).slice(0, 12).map((x, i) => <span key={`${x}-${i}`}>{x}</span>)}
          </div>
          {tasks.length > 0 && (
            <div className="stage-pop-tasks">
              {tasks.slice(0, 8).map(t => <span key={t.id}>{t.title}{t.canStub ? ' · 可占位' : ''}</span>)}
            </div>
          )}
          {msg && <div className="stage-pop-msg">{msg}</div>}
          <div className="stage-pop-actions">
            <button type="button" disabled={busy} onClick={loadPlan}>生成计划</button>
            <button type="button" disabled={busy || n >= STAGE_WRITE_READY} onClick={createStubs}>创建占位</button>
          </div>
        </div>
      )}
    </div>
  );
}
