// 墨枢 Agent · Express + SSE 后端
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { runAgent } from './services/agent.js';
import { listProjects, createProject, deleteProject } from './services/projects.js';
import { resolveInProject, readFileSafe, writeFileSafe, listDirRecursive } from './services/fs-utils.js';
import { listVersions, backupFile } from './services/reviews.js';
import { appendFeedback } from './services/quality.js';
import { appendExemplar, polarityFromKind } from './services/exemplars.js';
import { listUserSkills, writeUserSkill, readUserSkill, deleteUserSkill, computeSetupStage, draftUserSkillFromBrief } from './services/skills.js';
import { listMemories, recordMemory, deleteMemory, MEMORY_KINDS } from './services/memory-store.js';
import { listChapters } from './services/chapter-utils.js';
import { exportFullNovel } from './services/exporter.js';
import { rebuildForeshadowLedger } from './services/wiki.js';
import { openTrace } from './services/tracer.js';
import { buildSetupRepairPlan, createSetupStubs } from './services/setup-repair.js';
import { importTextFile, uploadUserSkill } from './services/upload.js';
import { getEffectiveConfig, saveOverrides, patchFromCamel } from './services/llm-config.js';
import { pingLLM } from './services/llm.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

// 健康检查
app.get('/api/health', (req, res) => {
  const cfg = getEffectiveConfig();
  res.json({
    ok: true,
    hasKey: cfg.hasKey,
    baseUrl: cfg.baseUrl || null,
    model: cfg.model || null,
  });
});

// LLM 配置：查看当前生效配置（apiKey 脱敏）
app.get('/api/llm-config', (req, res) => {
  try {
    res.json(getEffectiveConfig());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// LLM 配置：保存覆盖项（持久化到 data/llm-config.json）
app.post('/api/llm-config', async (req, res) => {
  try {
    const body = req.body || {};
    // 兼容两种入参：env 风格 ({ LLM_API_KEY:... }) 或 camelCase ({ apiKey: ... })
    const isEnvStyle = Object.keys(body).some((k) => /^LLM_/.test(k));
    const patch = isEnvStyle ? body : patchFromCamel(body);
    await saveOverrides(patch);
    res.json({ ok: true, config: getEffectiveConfig() });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// LLM 配置：用当前配置发一次 ping（不持久化）
app.post('/api/llm-config/test', async (req, res) => {
  const profile = req.body?.profile || 'default';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await pingLLM({ profile, signal: ac.signal });
    res.json(r);
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: String(e.message || e),
      status: e?.status || null,
      code: e?.code || null,
    });
  } finally {
    clearTimeout(timer);
  }
});

// 作品列表
app.get('/api/projects', async (req, res) => {
  try {
    res.json(await listProjects());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 创建作品
app.post('/api/projects', async (req, res) => {
  try {
    const r = await createProject(req.body?.name);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 文件树
app.get('/api/files', async (req, res) => {
  try {
    const project = req.query.project;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const base = resolveInProject(project, '');
    const items = await listDirRecursive(base, base, { includeVersions: true });
    res.json(items);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 单文件读取
app.get('/api/file', async (req, res) => {
  try {
    const { project, path: relPath } = req.query;
    if (!project || !relPath) return res.status(400).json({ error: '缺少 project / path' });
    const abs = resolveInProject(project, relPath);
    const txt = await readFileSafe(abs);
    if (txt === null) return res.status(404).json({ error: '不存在' });
    res.json({ content: txt });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/file/save', async (req, res) => {
  try {
    const { project, path: relPath, content } = req.body || {};
    if (!project || !relPath || typeof content !== 'string') return res.status(400).json({ error: '缺少 project / path / content' });
    if (!/^(knowledge|outline|style|references|imports|skills|progress)\//.test(relPath) && relPath !== 'SOUL.md') {
      return res.status(400).json({ error: '该路径不允许在预览器直接保存' });
    }
    if (!/\.(md|markdown|txt|json|ya?ml)$/i.test(relPath)) return res.status(400).json({ error: '仅支持保存文本文件' });
    if (Buffer.byteLength(content, 'utf8') > 4 * 1024 * 1024) return res.status(400).json({ error: '文件超过 4MB 上限' });
    const abs = resolveInProject(project, relPath);
    const old = await readFileSafe(abs);
    if (old === null) return res.status(404).json({ error: '文件不存在' });
    let backupRelPath = null;
    try { backupRelPath = await backupFile(project, relPath); } catch {}
    await writeFileSafe(abs, content);
    res.json({ ok: true, path: relPath, bytes: content.length, backupRelPath });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 历史版本列表
app.get('/api/versions', async (req, res) => {
  try {
    const { project, path: relPath } = req.query;
    if (!project || !relPath) return res.status(400).json({ error: '缺少 project / path' });
    const items = await listVersions(project, relPath);
    res.json(items);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { project, chapter, path: relPath, kind, feedback, sceneType, snippet } = req.body || {};
    if (!project || !kind || !feedback) return res.status(400).json({ error: '缺少 project / kind / feedback' });
    const polarity = polarityFromKind(kind);
    const r = polarity
      ? await appendExemplar(project, { chapter, path: relPath, kind, feedback, snippet: snippet || feedback, sceneType })
      : await appendFeedback(project, { chapter, path: relPath, kind, feedback });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// trace 列表
app.get('/api/traces', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const dir = resolveInProject(project, 'runs');
    let entries = [];
    try { entries = await fs.readdir(dir); } catch { return res.json([]); }
    const out = [];
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        const full = path.join(dir, name);
        const stat = await fs.stat(full);
        const txt = await fs.readFile(full, 'utf8');
        const lines = txt.split('\n').filter(Boolean).length;
        out.push({ file: name, size: stat.size, lines, mtimeMs: stat.mtimeMs });
      } catch {}
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// trace 内容（jsonl 原文）
app.get('/api/trace', async (req, res) => {
  try {
    const { project, file, download } = req.query;
    if (!project || !file) return res.status(400).json({ error: '缺少 project / file' });
    // 路径白名单：限制到 runs/ 下 + *.jsonl
    if (/[\\/]/.test(file) || !/^[\w.-]+\.jsonl$/.test(file)) {
      return res.status(400).json({ error: '非法文件名' });
    }
    const abs = resolveInProject(project, path.join('runs', file));
    const txt = await fs.readFile(abs, 'utf8');
    if (download === '1') {
      res.setHeader('content-disposition', `attachment; filename="${file}"`);
    }
    res.type('application/x-ndjson').send(txt);
  } catch (e) {
    res.status(404).json({ error: String(e?.message || e) });
  }
});

app.get('/api/trace/replay', async (req, res) => {
  try {
    const { project, file } = req.query;
    if (!project || !file) return res.status(400).json({ error: '缺少 project / file' });
    if (/[\\/]/.test(file) || !/^[\w.-]+\.jsonl$/.test(file)) {
      return res.status(400).json({ error: '非法文件名' });
    }
    const abs = resolveInProject(project, path.join('runs', file));
    const txt = await fs.readFile(abs, 'utf8');
    const events = txt
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
    const summary = {
      events: events.length,
      toolCalls: events.filter((e) => e.type === 'tool_call').length,
      toolErrors: events.filter((e) => e.type === 'tool_result' && e.ok === false).length,
      writes: events.filter((e) => ['file_write', 'chapter_saved', 'edit_file'].includes(e.type)).length,
      final: [...events].reverse().find((e) => e.type === 'final_summary') || null,
    };
    res.json({ file, summary, events });
  } catch (e) {
    res.status(404).json({ error: String(e?.message || e) });
  }
});

app.get('/api/user-skills', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await listUserSkills(project));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/user-skills', async (req, res) => {
  try {
    const { project, ...payload } = req.body || {};
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await writeUserSkill({ projectName: project, ...payload }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/user-skills/draft', async (req, res) => {
  try {
    const { brief, title, name } = req.body || {};
    res.json(draftUserSkillFromBrief({ brief, title, name }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/user-skills/:name', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await readUserSkill(project, req.params.name));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.delete('/api/user-skills/:name', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await deleteUserSkill(project, req.params.name));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 删除作品
app.delete('/api/projects/:name', async (req, res) => {
  try {
    res.json(await deleteProject(req.params.name));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 立项阶段
app.get('/api/setup-stage', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await computeSetupStage(project));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/setup-repair', async (req, res) => {
  try {
    const { project, targetStage } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await buildSetupRepairPlan(project, { targetStage: targetStage || 7 }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/setup-repair', async (req, res) => {
  try {
    const { project, targetStage, only } = req.body || {};
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await createSetupStubs(project, { targetStage: targetStage || 7, only: only || [] }));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 用户上传文本素材（大纲/设定等）→ 落到作品内白名单子目录
app.post('/api/import-text', async (req, res) => {
  try {
    const { project, filename, content, subdir, overwrite } = req.body || {};
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const r = await importTextFile({ project, filename, content, subdir, overwrite: !!overwrite });
    res.json(r);
  } catch (e) {
    if (e.code === 'EEXIST') return res.status(409).json({ error: String(e.message || e) });
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 用户上传完整 user skill markdown（含 frontmatter）
app.post('/api/user-skills/upload', async (req, res) => {
  try {
    const { project, name, content, overwrite } = req.body || {};
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const r = await uploadUserSkill({ project, name, content, overwrite: !!overwrite });
    res.json(r);
  } catch (e) {
    if (e.code === 'EEXIST') return res.status(409).json({ error: String(e.message || e) });
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 手动备份文件
app.post('/api/backup', async (req, res) => {
  try {
    const { project, path: relPath } = req.body || {};
    if (!project || !relPath) return res.status(400).json({ error: '缺少 project / path' });
    const r = await backupFile(project, relPath);
    if (!r) return res.status(404).json({ error: '文件不存在' });
    res.json({ ok: true, backupRelPath: r });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 回滚文件到指定版本（自动备份原件）
app.post('/api/rollback', async (req, res) => {
  try {
    const { project, target, from } = req.body || {};
    if (!project || !target || !from) return res.status(400).json({ error: '缺少 project / target / from' });
    // from 必须在 versions/ 子目录
    if (!from.includes('/versions/')) return res.status(400).json({ error: 'from 必须是历史版本路径' });
    const srcAbs = resolveInProject(project, from);
    const txt = await readFileSafe(srcAbs);
    if (txt === null) return res.status(404).json({ error: '源版本不存在' });
    // 先备份当前正稿，再覆写
    try { await backupFile(project, target); } catch {}
    const destAbs = resolveInProject(project, target);
    await writeFileSafe(destAbs, txt);
    res.json({ ok: true, target, from, bytes: txt.length });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 导出全本
app.post('/api/export', async (req, res) => {
  try {
    const { project, includeFrontmatter } = req.body || {};
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const r = await exportFullNovel(project, { includeFrontmatter });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 章节仪表盘：章号 + 标题 + 字数 + 评分摘要
app.get('/api/chapters-dashboard', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const chapters = await listChapters(project);
    const out = [];
    for (const c of chapters) {
      // 读正文算字数（绕开 frontmatter）
      const abs = resolveInProject(project, `chapters/${c.file}`);
      const txt = await readFileSafe(abs);
      const body = txt ? txt.replace(/^---\n[\s\S]*?\n---\n/, '') : '';
      const wordCount = (body.match(/[\u4e00-\u9fa5]/g) || []).length;
      // 评分摘要
      const scoreAbs = resolveInProject(project, `reviews/scores/chapter-${c.chapter}.md`);
      const scoreTxt = await readFileSafe(scoreAbs);
      let score = null, verdict = null;
      if (scoreTxt) {
        const m = /总分[\s:：]*([0-9.]+)/.exec(scoreTxt);
        if (m) score = Number(m[1]);
        const v = /verdict[\s:：]*(pass|needs_polish|rewrite)/i.exec(scoreTxt);
        if (v) verdict = v[1].toLowerCase();
      }
      out.push({
        chapter: c.chapter,
        title: c.title,
        file: `chapters/${c.file}`,
        wordCount,
        score,
        verdict,
        mtime: c.mtime,
      });
    }
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 伏笔预警
app.get('/api/foreshadow-alerts', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const alertsAbs = resolveInProject(project, 'progress/foreshadow-alerts.md');
    const ledgerAbs = resolveInProject(project, 'knowledge/foreshadow.md');
    const alerts = await readFileSafe(alertsAbs);
    const ledger = await readFileSafe(ledgerAbs);
    res.json({ alerts: alerts || null, ledger: ledger || null });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 手动重建伏笔总账
app.post('/api/foreshadow-scan', async (req, res) => {
  try {
    const { project } = req.body || {};
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const r = await rebuildForeshadowLedger(project);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// 长期记忆 CRUD
app.get('/api/memories', async (req, res) => {
  try {
    const { project } = req.query;
    if (!project) return res.status(400).json({ error: '缺少 project' });
    const items = await listMemories(project);
    res.json({ kinds: MEMORY_KINDS, items });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/memories', async (req, res) => {
  try {
    const { project, ...payload } = req.body || {};
    if (!project) return res.status(400).json({ error: '缺少 project' });
    res.json(await recordMemory(project, payload));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.delete('/api/memories', async (req, res) => {
  try {
    const { project, kind, key } = req.query;
    if (!project || !kind || !key) return res.status(400).json({ error: '缺少 project / kind / key' });
    res.json(await deleteMemory(project, kind, key));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// SSE 聊天
app.post('/api/chat', async (req, res) => {
  const { message, projectName, history, mode } = req.body || {};
  if (!message) return res.status(400).json({ error: '缺少 message' });
  const chatStartedAt = Date.now();
  console.log(`[chat] start project=${projectName || '-'} mode=${mode || 'auto'} chars=${String(message || '').length}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const emit = (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  // 立即发一个填充字节，让前端 reader.read() 能马上返回 chunk
  // 解决某些代理/dev-server 在第一条消息时缓冲所有内容直到响应结束的问题
  res.write(': preflight\n\n');

  // 每 15s 发心跳（SSE comment 行，前端会忽略），防止中间层超时断流
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
  }, 15000);
  res.on('close', () => clearInterval(heartbeat));

  emit({ type: 'start' });

  // 客户端断开时通过 AbortController 通知 runAgent 主循环。
  // 注意：必须监听 res.on('close')，不能监听 req.on('close')。
  // 因为 Express 解析完 POST body 后，req（IncomingMessage）会立刻触发 close，
  // 这会导致一启动就被误判为"用户中断"。
  // res.on('close') 只在底层 socket 在 res.end() 之前断开时触发。
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  let tracer = { wrap: (e) => e, close: async () => {}, relPath: null };
  try { tracer = await openTrace(projectName); } catch {}
  const tracedEmit = tracer.wrap(emit);
  if (tracer.relPath) tracedEmit({ type: 'trace_open', relPath: tracer.relPath });

  try {
    await runAgent({ userMessage: message, projectName, history, mode, emit: tracedEmit, signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted || e?.name === 'AbortError' || /aborted/i.test(String(e?.message || ''))) {
      // 客户端已断开，无需 emit
    } else {
      tracedEmit({ type: 'error', message: String(e?.message || e) });
    }
  } finally {
    try { await tracer.close(); } catch {}
    console.log(`[chat] end project=${projectName || '-'} ms=${Date.now() - chatStartedAt} aborted=${ac.signal.aborted}`);
    if (!res.writableEnded) res.end();
  }
});

const PORT = Number(process.env.SERVER_PORT || 8787);
app.listen(PORT, () => {
  console.log(`[墨枢] 后端监听 http://localhost:${PORT}`);
  const cfg = getEffectiveConfig();
  if (!cfg.hasKey) {
    console.warn('[警告] 未配置 LLM_API_KEY，聊天会报错。请在前端"LLM 配置"或 .env 中填写。');
  } else {
    console.log(`[墨枢] LLM 已就绪 · model=${cfg.model} base=${cfg.baseUrl} (override keys: ${cfg.overrideKeys.join(',') || '无'})`);
  }
});
