// Wiki 知识沉淀 / 检索 / 伏笔总账
import path from 'node:path';
import fsp from 'node:fs/promises';
import yaml from 'js-yaml';
import { resolveInProject, readFileSafe, writeFileSafe, ensureDir } from './fs-utils.js';
import { syncLookupForWikiPath } from './lookup.js';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** 解析 frontmatter 文件：{ meta, body } */
export function parseFrontmatter(text) {
  if (text == null) return { meta: {}, body: '' };
  const m = FM_RE.exec(text);
  if (!m) return { meta: {}, body: text };
  let meta = {};
  try { meta = yaml.load(m[1]) || {}; } catch { meta = {}; }
  return { meta, body: m[2] || '' };
}

/** 序列化回 frontmatter + body */
export function stringifyFrontmatter(meta, body = '') {
  const yml = yaml.dump(meta, { lineWidth: 100, noRefs: true });
  return `---\n${yml}---\n\n${body.trimStart()}`;
}

const KIND_DIRS = {
  character: 'knowledge/entities',
  faction: 'knowledge/entities',
  item: 'knowledge/entities',
  entity: 'knowledge/entities',
  concept: 'knowledge/concepts',
  system: 'knowledge/concepts',
  rule: 'knowledge/concepts',
  location: 'knowledge/locations',
};

function dirForType(type) {
  return KIND_DIRS[type] || 'knowledge/entities';
}

/** 列出 knowledge 下某类型目录的所有文件 */
async function listDir(projectName, relDir) {
  const abs = resolveInProject(projectName, relDir);
  try {
    const entries = await fsp.readdir(abs);
    return entries.filter((n) => n.endsWith('.md'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/** 读单个 wiki 文件 */
async function readWikiFile(projectName, relPath) {
  const abs = resolveInProject(projectName, relPath);
  const txt = await readFileSafe(abs);
  if (txt == null) return null;
  return parseFrontmatter(txt);
}

/** 写单个 wiki 文件（带 frontmatter） */
async function writeWikiFile(projectName, relPath, meta, body) {
  const abs = resolveInProject(projectName, relPath);
  await writeFileSafe(abs, stringifyFrontmatter(meta, body || ''));
}

/** 通过 slug 找到 wiki 文件路径（先 entities 再 concepts 再 locations） */
async function findWikiPath(projectName, slug) {
  for (const dir of ['knowledge/entities', 'knowledge/concepts', 'knowledge/locations']) {
    const p = path.posix.join(dir, `${slug}.md`);
    const abs = resolveInProject(projectName, p);
    try { await fsp.access(abs); return p; } catch {}
  }
  return null;
}

/** 通过名字 / 别名 grep 出候选 slug 列表 */
export async function queryByKeywords(projectName, keywords) {
  const kws = (keywords || []).map((k) => String(k).trim()).filter(Boolean);
  const normKws = kws.map(normalizeText).filter(Boolean);
  if (!kws.length) return { hits: [], openForeshadows: await listOpenForeshadows(projectName) };

  const result = [];
  const seen = new Set();
  for (const dir of ['knowledge/entities', 'knowledge/concepts', 'knowledge/locations']) {
    const files = await listDir(projectName, dir);
    for (const f of files) {
      const rel = `${dir}/${f}`;
      const item = await readWikiFile(projectName, rel);
      if (!item) continue;
      const { meta, body } = item;
      const haystack = [
        meta.name,
        ...(Array.isArray(meta.aliases) ? meta.aliases : []),
        meta.id,
        f.replace(/\.md$/, ''),
        meta.faction,
        meta.status,
      ].filter(Boolean).map(String);
      const bodyText = String(body || '').slice(0, 1200);
      const normHay = [...haystack, bodyText].map(normalizeText).filter(Boolean);
      const matched = normKws.some((kw) => normHay.some((h) => isLooseMatch(kw, h)));
      if (matched) {
        if (seen.has(rel)) continue;
        seen.add(rel);
        result.push({
          relPath: rel,
          slug: meta.id || f.replace(/\.md$/, ''),
          name: meta.name || '',
          type: meta.type || 'unknown',
          status: meta.status || null,
          faction: meta.faction || null,
          first_appear_chapter: meta.first_appear_chapter || null,
          last_update_chapter: meta.last_update_chapter || null,
          aliases: meta.aliases || [],
          open_foreshadow: (meta.foreshadow || [])
            .filter((f) => f?.state === 'open')
            .map((f) => f.tag),
        });
      }
    }
  }
  // 追加向量召回（若启用 LLM_EMBED_MODEL 且有索引）
  try {
    const { vectorSearch, isEmbedEnabled } = await import('./embeddings.js');
    if (isEmbedEnabled()) {
      const vecHits = await vectorSearch(projectName, kws, 8);
      for (const v of vecHits) {
        if (seen.has(v.relPath)) continue;
        seen.add(v.relPath);
        const item = await readWikiFile(projectName, v.relPath);
        if (!item) continue;
        const { meta } = item;
        result.push({
          relPath: v.relPath,
          slug: meta.id || v.slug,
          name: meta.name || v.name,
          type: meta.type || 'unknown',
          status: meta.status || null,
          faction: meta.faction || null,
          first_appear_chapter: meta.first_appear_chapter || null,
          last_update_chapter: meta.last_update_chapter || null,
          aliases: meta.aliases || [],
          open_foreshadow: (meta.foreshadow || [])
            .filter((f) => f?.state === 'open')
            .map((f) => f.tag),
          _via: 'vector',
          _score: Number(v.score?.toFixed(3)) || undefined,
        });
      }
    }
  } catch (e) {
    // 向量召回失败不影响主流程
  }

  const openForeshadows = await listOpenForeshadows(projectName);
  return { hits: result, openForeshadows };
}

/** 扫所有 wiki 文件，聚合 open 伏笔 */
export async function listOpenForeshadows(projectName) {
  const out = [];
  for (const dir of ['knowledge/entities', 'knowledge/concepts', 'knowledge/locations']) {
    const files = await listDir(projectName, dir);
    for (const f of files) {
      const rel = `${dir}/${f}`;
      const item = await readWikiFile(projectName, rel);
      if (!item) continue;
      const { meta } = item;
      const fs = meta.foreshadow || [];
      for (const fr of fs) {
        if (fr?.state === 'open') {
          out.push({
            on_slug: meta.id || f.replace(/\.md$/, ''),
            on_name: meta.name || '',
            tag: fr.tag,
            set_chapter: fr.set_chapter || null,
            due_chapter: fr.due_chapter || null,
          });
        }
      }
    }
  }
  return out;
}

/** 应用 wiki-ingest 的 payload 到知识库 */
export async function applyIngest(projectName, payload) {
  const written = [];
  const ch = Number(payload.chapter || 0) || null;

  // 1. new_entities / new_concepts / new_locations
  const allNew = [
    ...(payload.new_entities || []).map((x) => ({ ...x, _kind: 'entity' })),
    ...(payload.new_concepts || []).map((x) => ({ ...x, _kind: 'concept' })),
    ...(payload.new_locations || []).map((x) => ({ ...x, _kind: 'location' })),
  ];

  for (const item of allNew) {
    const slug = item.slug || slugify(item.name);
    if (!slug) continue;
    const dir = dirForType(item.type || item._kind);
    const rel = `${dir}/${slug}.md`;
    const existing = await readWikiFile(projectName, rel);
    const meta = existing?.meta || {};
    const resolvedType = item.type || meta.type || item._kind;
    Object.assign(meta, {
      id: meta.id || slug,
      type: resolvedType,
      name: item.name || meta.name,
      aliases: mergeArr(meta.aliases, item.aliases),
      faction: item.faction || meta.faction,
      status: item.status || meta.status,
      location: item.location || meta.location,
      inventory: mergeArr(meta.inventory, item.inventory),
      abilities: mergeArr(meta.abilities, item.abilities),
      appearance: item.appearance || meta.appearance,
      motivation: item.motivation || meta.motivation,
      arc_goal: item.arc_goal || meta.arc_goal,
      relationships: mergeRelations(meta.relationships, item.relationships),
      first_appear_chapter: meta.first_appear_chapter || ch || item.first_appear || null,
      last_update_chapter: ch || meta.last_update_chapter || null,
    });
    // 清掉 undefined 让 yaml 干净
    for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
    if (item.foreshadow) {
      meta.foreshadow = mergeForeshadow(meta.foreshadow, item.foreshadow);
    }
    const hasRichBody = item.body && item.body.trim().length > 20;
    const bodyHasTemplate = existing?.body && /##\s+核心档案|##\s+登场/.test(existing.body);
    let body;
    if (hasRichBody) {
      body = item.body;
    } else if (bodyHasTemplate) {
      body = existing.body; // 保留已有结构
    } else {
      body = buildWikiBodyTemplate({
        kind: item._kind,
        type: resolvedType,
        name: item.name || slug,
        meta,
        chapter: ch,
        seedBody: item.body || existing?.body || '',
      });
    }
    await writeWikiFile(projectName, rel, meta, body);
    written.push(rel);
  }

  // 2. updated_entities (patch)
  for (const upd of payload.updated_entities || []) {
    if (!upd.slug) continue;
    const rel = await findWikiPath(projectName, upd.slug);
    if (!rel) continue;
    const ex = await readWikiFile(projectName, rel);
    if (!ex) continue;
    Object.assign(ex.meta, upd.patch || {});
    if (ch) ex.meta.last_update_chapter = ch;
    await writeWikiFile(projectName, rel, ex.meta, ex.body);
    written.push(rel);
  }

  // 3. foreshadow_open / foreshadow_closed (作用到对应实体)
  for (const fr of payload.foreshadow_open || []) {
    const rel = await findWikiPath(projectName, fr.on_slug);
    if (!rel) continue;
    const ex = await readWikiFile(projectName, rel);
    if (!ex) continue;
    ex.meta.foreshadow = mergeForeshadow(ex.meta.foreshadow, [{
      tag: fr.tag,
      state: 'open',
      set_chapter: fr.set_chapter || ch,
      ...(fr.due_chapter ? { due_chapter: fr.due_chapter } : {}),
    }]);
    await writeWikiFile(projectName, rel, ex.meta, ex.body);
    written.push(rel);
  }
  for (const fr of payload.foreshadow_closed || []) {
    const rel = await findWikiPath(projectName, fr.on_slug);
    if (!rel) continue;
    const ex = await readWikiFile(projectName, rel);
    if (!ex) continue;
    ex.meta.foreshadow = (ex.meta.foreshadow || []).map((f) =>
      f.tag === fr.tag ? { ...f, state: 'closed', closed_chapter: ch } : f
    );
    await writeWikiFile(projectName, rel, ex.meta, ex.body);
    written.push(rel);
  }

  // 4. summary → log.md (append)
  if (payload.summary && ch) {
    const logAbs = resolveInProject(projectName, 'knowledge/log.md');
    const old = (await readFileSafe(logAbs)) || '# 章节摘要时间线\n\n';
    const newEntry = `## 第 ${ch} 章${payload.chapter_title ? ' ' + payload.chapter_title : ''}\n${payload.summary.trim()}\n\n`;
    await writeFileSafe(logAbs, old + newEntry);
    written.push('knowledge/log.md');
  }

  // 5. timeline events
  if (payload.timeline_events?.length) {
    const tlAbs = resolveInProject(projectName, 'knowledge/timeline.md');
    const old = (await readFileSafe(tlAbs)) || '# 故事内时间线\n\n';
    const lines = payload.timeline_events.map((e) =>
      `- [第${e.chapter || ch || '?'}章] ${e.event}`
    ).join('\n');
    await writeFileSafe(tlAbs, old + lines + '\n');
    written.push('knowledge/timeline.md');
  }

  // 5.5 state_snapshot → progress/state.json（主角/核心角色本章末状态快照）
  if (payload.state_snapshot && ch) {
    await writeStateSnapshot(projectName, ch, payload.state_snapshot, payload.chapter_title);
    written.push('progress/state.json');
  }

  // 6. 重建 foreshadow.md 总账
  await rebuildForeshadowLedger(projectName, ch);
  written.push('knowledge/foreshadow.md');

  // 7. 若启用向量索引，异步增量重建（失败静默）
  try {
    const { rebuildEmbedIndex, isEmbedEnabled } = await import('./embeddings.js');
    if (isEmbedEnabled()) {
      const r = await rebuildEmbedIndex(projectName);
      if (r.ok && !r.skipped) written.push('knowledge/.embeddings/index.json');
    }
  } catch {}

  try {
    const lookupWritten = new Set();
    for (const rel of [...new Set(written)]) {
      if (!/^knowledge\/(entities|concepts|locations)\//.test(rel) || !rel.endsWith('.md')) continue;
      const r = await syncLookupForWikiPath(projectName, rel);
      if (r.ok) for (const p of r.relPaths || []) lookupWritten.add(p);
    }
    written.push(...lookupWritten);
  } catch {}

  return { written, count: written.length };
}

/** 重建伏笔总账 + 写预警提醒 */
export async function rebuildForeshadowLedger(projectName, currentChapter) {
  const open = await listOpenForeshadows(projectName);
  const closed = await listClosedForeshadows(projectName);

  const ch = Number(currentChapter) || null;
  const withMeta = open.map((f) => {
    const age = ch && f.set_chapter ? ch - f.set_chapter : null;
    // 距 due 的章数：负数=已逾期；0=本章应回收；正数=还剩 N 章
    const dueDelta = ch && f.due_chapter ? f.due_chapter - ch : null;
    return { ...f, age, dueDelta };
  });

  // due_chapter 优先分类：overdue / due_now / due_soon 优先于按 age 分级
  const overdue = withMeta.filter((f) => f.dueDelta != null && f.dueDelta < 0);
  const dueNow = withMeta.filter((f) => f.dueDelta === 0);
  const dueSoon = withMeta.filter((f) => f.dueDelta != null && f.dueDelta > 0 && f.dueDelta <= 3);
  const dueRest = new Set([...overdue, ...dueNow, ...dueSoon]);
  const remaining = withMeta.filter((f) => !dueRest.has(f));
  const red = remaining.filter((f) => f.age != null && f.age >= 50);
  const orange = remaining.filter((f) => f.age != null && f.age >= 30 && f.age < 50);
  const yellow = remaining.filter((f) => f.age != null && f.age >= 15 && f.age < 30);
  const green = remaining.filter((f) => f.age == null || f.age < 15);

  const fmt = (rows, withDue = false) => rows.length === 0
    ? '（无）\n'
    : (withDue
        ? '| 标签 | 实体 | 埋设章 | 到期章 | 距今 |\n|---|---|---|---|---|\n' +
          rows.map((r) => `| ${r.tag} | ${r.on_name || r.on_slug} | ${r.set_chapter ?? '?'} | ${r.due_chapter ?? '-'} | ${r.age ?? '?'} |`).join('\n') + '\n'
        : '| 标签 | 实体 | 埋设章 | 距今 |\n|---|---|---|---|\n' +
          rows.map((r) => `| ${r.tag} | ${r.on_name || r.on_slug} | ${r.set_chapter ?? '?'} | ${r.age ?? '?'} |`).join('\n') + '\n');

  const md = `# 伏笔总账（自动维护，禁止手写）

> 最后更新：${ch ? `第 ${ch} 章后` : '初始'}

## ⛔ 已逾期 due_chapter（必须立即处理）
${fmt(overdue, true)}
## 🎯 本章到期（due_chapter === 当前章）
${fmt(dueNow, true)}
## ⏳ 即将到期（剩 1-3 章）
${fmt(dueSoon, true)}
## 🔴 红色（≥50 章未推进）
${fmt(red)}
## 🟠 橙色（30-49 章）
${fmt(orange)}
## 🟡 黄色（15-29 章）
${fmt(yellow)}
## 🟢 绿色（<15 章）
${fmt(green)}

---

## Closed（已回收）
${closed.length === 0 ? '（无）\n' :
  '| 标签 | 实体 | 埋设章 | 回收章 |\n|---|---|---|---|\n' +
  closed.map((r) => `| ${r.tag} | ${r.on_name || r.on_slug} | ${r.set_chapter ?? '?'} | ${r.closed_chapter ?? '?'} |`).join('\n') + '\n'}

## 统计
- 总 open：${open.length}
- 已逾期：${overdue.length}  ·  本章到期：${dueNow.length}  ·  即将到期：${dueSoon.length}
- 平均年龄：${withMeta.filter((f) => f.age != null).length === 0 ? '?' :
    (withMeta.filter((f) => f.age != null).reduce((s, f) => s + f.age, 0) / withMeta.filter((f) => f.age != null).length).toFixed(1)} 章
- 承诺-兑现比例：open ${open.length} : closed ${closed.length}${promiseFulfillNote(open.length, closed.length, ch)}
`;

  const ledgerAbs = resolveInProject(projectName, 'knowledge/foreshadow.md');
  await writeFileSafe(ledgerAbs, md);

  // 预警提醒（写到 progress/foreshadow-alerts.md）
  const alerts = [];
  if (overdue.length) alerts.push(`⛔ ${overdue.length} 条 **已逾期** 伏笔（due_chapter 已过），本章/下一章必须回收：\n` +
    overdue.map((r) => `- ${r.tag}（${r.on_name}, 设于第 ${r.set_chapter ?? '?'} 章，应于第 ${r.due_chapter} 章前回收，已逾期 ${Math.abs(r.dueDelta)} 章）`).join('\n'));
  if (dueNow.length) alerts.push(`🎯 ${dueNow.length} 条伏笔 **本章到期**：\n` +
    dueNow.map((r) => `- ${r.tag}（${r.on_name}, 设于第 ${r.set_chapter ?? '?'} 章）`).join('\n'));
  if (dueSoon.length) alerts.push(`⏳ ${dueSoon.length} 条伏笔即将到期（剩 1-3 章）`);
  if (red.length) alerts.push(`🔴 ${red.length} 条红色伏笔（≥50 章未推进），本卷必须回收：\n` +
    red.map((r) => `- ${r.tag}（${r.on_name}, ${r.age} 章）`).join('\n'));
  if (orange.length) alerts.push(`🟠 ${orange.length} 条橙色伏笔（30-49 章），强烈建议推进`);
  if (open.length >= 8) alerts.push(`⚠ 当前 open 伏笔 ${open.length} 条，建议本卷内回收 3 条以上`);

  // P0-4 · 承诺-兑现比例预警（早于"年龄超阈"，让作者在第 30 章而非第 50 章修复）
  const ratioAlert = computeRatioAlert(open.length, closed.length, ch);
  if (ratioAlert) alerts.push(ratioAlert);

  const alertsAbs = resolveInProject(projectName, 'progress/foreshadow-alerts.md');
  if (alerts.length === 0) {
    await writeFileSafe(alertsAbs, '# 伏笔预警\n\n（暂无）\n');
  } else {
    await writeFileSafe(alertsAbs, '# 伏笔预警\n\n' + alerts.join('\n\n') + '\n');
  }

  return {
    open: open.length,
    closed: closed.length,
    overdue: overdue.length,
    dueNow: dueNow.length,
    dueSoon: dueSoon.length,
    red: red.length,
    orange: orange.length,
    yellow: yellow.length,
    ratioAlert: ratioAlert ? true : false,
  };
}

/**
 * P0-4 · 计算承诺-兑现比例预警
 *
 * 触发条件（任一即报警）：
 *   - open >= 5 且 closed === 0 且 currentChapter >= 20（已写一段从未回收 → 早期失衡）
 *   - open >= 6 且 closed > 0 且 open / closed > 5（开远多于收 → 长线烂尾风险）
 *
 * 不触发场景：
 *   - open < 5（样本太少）
 *   - 早期作品（章号 < 20）
 */
function computeRatioAlert(open, closed, currentChapter) {
  if (open < 5) return null;
  const ch = Number(currentChapter) || 0;
  if (closed === 0 && ch >= 20) {
    return `⚖ 承诺-兑现失衡：累计开 ${open} 条伏笔但**从未回收过**（已写 ${ch} 章）。建议本卷内至少回收 2 条，否则烂尾风险高。`;
  }
  if (closed > 0) {
    const ratio = open / closed;
    if (ratio > 5 && open >= 6) {
      return `⚖ 承诺-兑现失衡：open ${open} : closed ${closed} = ${ratio.toFixed(1)}:1（健康值 ≤ 5:1）。本卷内建议回收 ${Math.ceil(open / 5) - closed} 条，让 ratio 回落到 5:1 以内。`;
    }
  }
  return null;
}

/**
 * 总账统计段中给比例做一句话注解，仅在数据有意义时显示。
 */
function promiseFulfillNote(open, closed, currentChapter) {
  if (open === 0 && closed === 0) return '';
  if (closed === 0) {
    if ((Number(currentChapter) || 0) >= 20 && open >= 5) return ' ⚠️（已写多章但从未回收）';
    return '';
  }
  const ratio = open / closed;
  if (open >= 6 && ratio > 5) return ` ⚠️（${ratio.toFixed(1)}:1 > 健康阈 5:1）`;
  if (open >= 3 && ratio <= 5) return ` ✅（${ratio.toFixed(1)}:1 ≤ 5:1，节奏健康）`;
  return '';
}

async function listClosedForeshadows(projectName) {
  const out = [];
  for (const dir of ['knowledge/entities', 'knowledge/concepts', 'knowledge/locations']) {
    const files = await listDir(projectName, dir);
    for (const f of files) {
      const rel = `${dir}/${f}`;
      const item = await readWikiFile(projectName, rel);
      if (!item) continue;
      const { meta } = item;
      for (const fr of (meta.foreshadow || [])) {
        if (fr?.state === 'closed') {
          out.push({
            on_slug: meta.id || f.replace(/\.md$/, ''),
            on_name: meta.name || '',
            tag: fr.tag,
            set_chapter: fr.set_chapter,
            closed_chapter: fr.closed_chapter,
          });
        }
      }
    }
  }
  return out;
}

// ============== 工具函数 ==============
function slugify(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[\\/:*?"<>|.]/g, '')
    .slice(0, 60);
}

function mergeArr(a, b) {
  const set = new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
  return [...set].filter(Boolean);
}

function mergeForeshadow(a, b) {
  const out = Array.isArray(a) ? [...a] : [];
  for (const nf of (b || [])) {
    if (!nf?.tag) continue;
    const idx = out.findIndex((f) => f.tag === nf.tag);
    if (idx >= 0) {
      out[idx] = { ...out[idx], ...nf };
    } else {
      out.push({ state: 'open', ...nf });
    }
  }
  return out;
}
function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[“”"'\s\u3000，。！？、：；（）()《》【】\[\]{}·\-_/\\|]/g, '');
}

function isLooseMatch(kw, h) {
  if (!kw || !h) return false;
  if (h.includes(kw)) return true;
  if (kw.length >= 2 && kw.includes(h) && h.length >= 2) return true;
  if (kw.length >= 3 && h.length >= 3 && overlapRatio(kw, h) >= 0.68) return true;
  return false;
}

function overlapRatio(a, b) {
  const as = new Set([...a]);
  const bs = new Set([...b]);
  let hit = 0;
  for (const ch of as) if (bs.has(ch)) hit += 1;
  return hit / Math.max(1, Math.min(as.size, bs.size));
}

function mergeRelations(a, b) {
  const list = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  const byKey = new Map();
  for (const r of list) {
    if (!r || !r.target) continue;
    const key = String(r.target);
    const cur = byKey.get(key) || {};
    byKey.set(key, {
      target: key,
      kind: r.kind || cur.kind,
      note: r.note || cur.note,
      since_chapter: r.since_chapter || cur.since_chapter,
    });
  }
  return [...byKey.values()];
}

/**
 * 生成富结构化 wiki body 模板。模型之后可以用 update_progress 或下一次 ingest 逐步填。
 * 区分 character / faction / item / concept / system / rule / location 七种类型。
 */
function buildWikiBodyTemplate({ kind, type, name, meta, chapter, seedBody }) {
  const head = `# ${name}\n`;
  const seed = seedBody && seedBody.trim() && !/^#\s/.test(seedBody.trim())
    ? `\n> ${seedBody.trim().slice(0, 200)}\n`
    : '';
  const firstCh = meta.first_appear_chapter || chapter || '?';
  const isCharacter = type === 'character' || kind === 'entity' && (type === 'character' || !type);
  const isFaction = type === 'faction';
  const isItem = type === 'item';
  const isLocation = type === 'location' || kind === 'location';
  const isConcept = kind === 'concept' || ['concept', 'system', 'rule'].includes(type);

  if (isCharacter) {
    return [
      head + seed,
      '## 核心档案',
      '- **身份**：',
      `- **所属**：${meta.faction || '（未定）'}`,
      `- **当前修为/实力**：${meta.status || '（未定）'}`,
      `- **当前所在**：${meta.location || '（未定）'}`,
      `- **外貌**：${meta.appearance || '（未写）'}`,
      `- **核心动机**：${meta.motivation || '（未写）'}`,
      `- **本作弧光目标**：${meta.arc_goal || '（未写）'}`,
      '',
      '## 能力 / 持有',
      meta.abilities?.length ? meta.abilities.map((x) => `- ${x}`).join('\n') : '- （未登记）',
      '',
      meta.inventory?.length ? '**持有物**：\n' + meta.inventory.map((x) => `- ${x}`).join('\n') + '\n' : '**持有物**：（未登记）\n',
      '## 关系网',
      meta.relationships?.length
        ? meta.relationships.map((r) => `- **${r.target}** · ${r.kind || '关系'}${r.note ? ` · ${r.note}` : ''}${r.since_chapter ? `（第${r.since_chapter}章起）` : ''}`).join('\n')
        : '- （未登记）',
      '',
      '## 登场与状态变化',
      `- 第 ${firstCh} 章：首次登场`,
      '',
      '## 伏笔',
      '（由 wiki_ingest 自动维护，请勿手写）',
      '',
    ].join('\n');
  }
  if (isFaction) {
    return [
      head + seed,
      '## 核心档案',
      `- **领袖**：`,
      `- **总部**：${meta.location || '（未定）'}`,
      `- **立场**：`,
      `- **核心资源/根本利益**：`,
      '',
      '## 与主线的关系',
      '- （主角与该势力的关系弧）',
      '',
      '## 重要成员',
      '- （列 3-5 人，可链接到 entities）',
      '',
      '## 登场',
      `- 第 ${firstCh} 章：首次登场`,
      '',
    ].join('\n');
  }
  if (isItem) {
    return [
      head + seed,
      '## 核心档案',
      '- **类别**：（法宝 / 神兵 / 灵材 / 信物）',
      '- **品级**：',
      `- **当前持有者**：${meta.status || '（未定）'}`,
      '- **外观**：',
      '',
      '## 能力 / 规则',
      '- （使用条件、代价、禁忌）',
      '',
      '## 出现与流转',
      `- 第 ${firstCh} 章：首次出现`,
      '',
    ].join('\n');
  }
  if (isLocation) {
    return [
      head + seed,
      '## 核心档案',
      '- **所属地域**：',
      '- **势力归属**：',
      '- **地理特征**：',
      '- **主要建筑/结构**：',
      '',
      '## 氛围感官',
      '- **视觉**：',
      '- **声音**：',
      '- **气味**：',
      '',
      '## 登场',
      `- 第 ${firstCh} 章：首次出现`,
      '',
    ].join('\n');
  }
  if (isConcept) {
    return [
      head + seed,
      '## 定义',
      '- （一句话定义，不要泛泛之谈）',
      '',
      '## 规则',
      '- （硬约束：什么可以，什么不可以，代价是什么）',
      '- （避免"修为越高越强"这种空话，要写具体等级/效果对应）',
      '',
      '## 边界条件',
      '- （误用、失效、被破解的条件）',
      '',
      '## 出现',
      `- 第 ${firstCh} 章：首次提及`,
      '',
    ].join('\n');
  }
  return head + seed;
}

async function writeStateSnapshot(projectName, chapter, snapshot, chapterTitle) {
  const abs = resolveInProject(projectName, 'progress/state.json');
  let st = {};
  try {
    const txt = await readFileSafe(abs);
    if (txt) st = JSON.parse(txt);
  } catch { st = {}; }
  st.currentChapter = Math.max(Number(st.currentChapter || 0), Number(chapter) || 0);
  st.lastUpdate = new Date().toISOString();
  st.lastChapterTitle = chapterTitle || st.lastChapterTitle || '';
  // snapshot 里建议包含：in_story_time / protagonist / companions / open_threads
  // 接受任意 JSON，按键并入（history 最多保留最近 12 条）
  const entry = {
    chapter: Number(chapter),
    title: chapterTitle || '',
    time: new Date().toISOString(),
    ...snapshot,
  };
  st.snapshot = snapshot; // 最新态
  st.history = Array.isArray(st.history) ? st.history : [];
  // 同章覆盖
  st.history = st.history.filter((h) => h.chapter !== entry.chapter);
  st.history.push(entry);
  if (st.history.length > 12) st.history = st.history.slice(-12);
  await writeFileSafe(abs, JSON.stringify(st, null, 2));
}

/**
 * 读取 progress/state.json 里最近的状态快照（最新一条）。
 */
export async function loadLatestStateSnapshot(projectName) {
  try {
    const abs = resolveInProject(projectName, 'progress/state.json');
    const txt = await readFileSafe(abs);
    if (!txt) return null;
    const st = JSON.parse(txt);
    return st.snapshot || null;
  } catch { return null; }
}

/**
 * 读取最近 N 条章节摘要（从 knowledge/log.md 反向提取 ## 段落）。
 */
export async function loadRecentLog(projectName, limit = 6) {
  const abs = resolveInProject(projectName, 'knowledge/log.md');
  const txt = await readFileSafe(abs);
  if (!txt) return [];
  const parts = txt.split(/\n##\s+/).slice(1); // 去掉首个 # 标题段
  const entries = parts.map((p) => '## ' + p.trim()).filter(Boolean);
  return entries.slice(-limit);
}

/**
 * 读取主要人物（entities 下 type=character）的状态快照行，最多 8 个。
 * 用于写章前给模型一份"canon 档案卡"。
 */
export async function loadCharacterStates(projectName, limit = 8) {
  const files = await listDir(projectName, 'knowledge/entities');
  const rows = [];
  for (const f of files) {
    const rel = `knowledge/entities/${f}`;
    const item = await readWikiFile(projectName, rel);
    if (!item) continue;
    const { meta } = item;
    if (meta.type && meta.type !== 'character') continue;
    rows.push({
      slug: meta.id || f.replace(/\.md$/, ''),
      name: meta.name || '',
      aliases: Array.isArray(meta.aliases) ? meta.aliases.filter(Boolean) : [],
      status: meta.status || '',
      location: meta.location || '',
      faction: meta.faction || '',
      motivation: meta.motivation || '',
      inventory: Array.isArray(meta.inventory) ? meta.inventory.slice(0, 4) : [],
      last_update_chapter: meta.last_update_chapter || null,
    });
  }
  rows.sort((a, b) => (b.last_update_chapter || 0) - (a.last_update_chapter || 0));
  return rows.slice(0, limit);
}

/**
 * 读取 knowledge/world/ 下 rules.md + power-system.md 的头部，拼接为精炼 canon。
 */
export async function loadWorldRulesSummary(projectName, maxCharsPerFile = 900) {
  const files = ['knowledge/world/rules.md', 'knowledge/world/power-system.md'];
  const parts = [];
  for (const rel of files) {
    const txt = await readFileSafe(resolveInProject(projectName, rel));
    if (!txt) continue;
    const head = txt.length > maxCharsPerFile ? txt.slice(0, maxCharsPerFile) + '\n[…略]' : txt;
    parts.push(`### ${rel}\n${head.trim()}`);
  }
  return parts.join('\n\n');
}
