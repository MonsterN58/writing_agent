/**
 * 卷纲 chapter_nodes 解析与 milestone 提示
 *
 * 用法：在 outline/volumes/volume-N.md 的 frontmatter 声明节奏节点：
 *
 *   ---
 *   volume: 1
 *   chapter_nodes:
 *     - { chapter: 10, milestone: '首次突破，林尘进入炼气期' }
 *     - { chapter: 20, milestone: '初次出宗门，势力初成' }
 *     - { chapter: 40, milestone: '本卷高潮：旧仇浮现' }
 *   ---
 *
 * 写章前调用 buildVolumeMilestonesMd(projectName, chapter) 注入：
 *  - 上一节点：刚过去的 milestone（提醒未完成）
 *  - 本节点：本章/邻近章应达成的 milestone
 *  - 下一节点：还剩 N 章要走到的 milestone
 *
 * 不强制阻断，只产 markdown 提示串。
 */
import fsp from 'node:fs/promises';
import yaml from 'js-yaml';
import { resolveInProject, readFileSafe } from './fs-utils.js';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 列出某作品所有卷的 chapter_nodes。
 * @returns {Promise<Array<{volume:number, file:string, nodes:Array<{chapter:number, milestone:string}>}>>}
 */
export async function listVolumeNodes(projectName) {
  if (!projectName) return [];
  const dir = resolveInProject(projectName, 'outline/volumes');
  let files = [];
  try { files = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const f of files.sort()) {
    if (!f.endsWith('.md')) continue;
    const txt = await readFileSafe(`${dir}/${f}`);
    if (!txt) continue;
    const m = FM_RE.exec(txt);
    if (!m) continue;
    let meta = {};
    try { meta = yaml.load(m[1]) || {}; } catch { continue; }
    const rawNodes = Array.isArray(meta.chapter_nodes) ? meta.chapter_nodes : null;
    if (!rawNodes?.length) continue;
    const nodes = [];
    for (const n of rawNodes) {
      const chapter = Number(n?.chapter);
      const milestone = String(n?.milestone || '').trim();
      if (!Number.isFinite(chapter) || chapter < 1 || !milestone) continue;
      nodes.push({ chapter, milestone });
    }
    nodes.sort((a, b) => a.chapter - b.chapter);
    if (!nodes.length) continue;
    const volume = Number.isFinite(Number(meta.volume))
      ? Number(meta.volume)
      : inferVolumeFromFilename(f);
    out.push({ volume, file: `outline/volumes/${f}`, nodes });
  }
  out.sort((a, b) => (a.volume ?? 0) - (b.volume ?? 0));
  return out;
}

function inferVolumeFromFilename(f) {
  const m = /volume-(\d+)/i.exec(f);
  return m ? Number(m[1]) : null;
}

/**
 * 为写第 `chapter` 章构造 milestone 提示串。
 *  - 距上一个节点 ≤ 3 章未达成 → 警告"上节点超期"
 *  - 本章正好命中节点 → "本章应达成"
 *  - 距下一个节点 ≤ 5 章 → "倒计时" 提醒
 * @returns {Promise<string|null>}
 */
export async function buildVolumeMilestonesMd(projectName, chapter) {
  if (!projectName) return null;
  const ch = Number(chapter);
  if (!ch || ch < 1) return null;
  const groups = await listVolumeNodes(projectName);
  if (!groups.length) return null;

  // 合并所有卷的节点（按 chapter 升序）
  const all = [];
  for (const g of groups) for (const n of g.nodes) all.push({ ...n, volume: g.volume });
  all.sort((a, b) => a.chapter - b.chapter);
  if (!all.length) return null;

  // 上节点：chapter < ch 且最大的
  const past = all.filter((n) => n.chapter < ch).slice(-1)[0] || null;
  // 本节点：chapter === ch
  const now = all.find((n) => n.chapter === ch) || null;
  // 下节点：chapter > ch 且最小的
  const next = all.find((n) => n.chapter > ch) || null;

  const lines = [];
  if (past && ch - past.chapter <= 3) {
    lines.push(`**上节点（第 ${past.chapter} 章 · 卷 ${past.volume ?? '?'}）**：${past.milestone}`);
    lines.push(`  若上一节点尚未达成，请在本章或下一章补上；否则跳过此提示。`);
  }
  if (now) {
    lines.push(`**🎯 本章应达成节点（第 ${ch} 章 · 卷 ${now.volume ?? '?'}）**：${now.milestone}`);
  }
  if (next) {
    const delta = next.chapter - ch;
    if (delta <= 5) {
      lines.push(`**⏳ 下节点（第 ${next.chapter} 章 · 卷 ${next.volume ?? '?'}，剩 ${delta} 章）**：${next.milestone}`);
    } else {
      lines.push(`下一节点：第 ${next.chapter} 章 → ${next.milestone}（剩 ${delta} 章，无需立刻铺垫）`);
    }
  }
  if (!lines.length) return null;
  return lines.join('\n');
}
