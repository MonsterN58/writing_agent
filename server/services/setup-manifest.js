import fsp from 'node:fs/promises';
import { resolveInProject } from './fs-utils.js';

/**
 * 立项 8 阶段硬闸门。
 * 注意：v5 起在「主要人物」之后插入新阶段 4「地点与物品档案」，原 4-7 后移为 5-8。
 * 写章前所需阶段 = 7（arc 细纲完成）；setup_repair 默认 targetStage = 7。
 * dir_markdown_min 表示目录下至少有 `min` 个 .md 文件才算合格。
 */
export const SETUP_MANIFEST = [
  {
    stage: 1,
    label: 'SOUL',
    skill: 'work-setup',
    required: [{ type: 'file', path: 'SOUL.md' }],
  },
  {
    stage: 2,
    label: '世界观包',
    skill: 'worldbuilding-systems',
    required: [
      { type: 'file', path: 'knowledge/world/overview.md' },
      { type: 'file', path: 'knowledge/world/power-system.md' },
      { type: 'file', path: 'knowledge/world/factions.md' },
      { type: 'file', path: 'knowledge/world/geography.md' },
      { type: 'file', path: 'knowledge/world/history.md' },
      { type: 'file', path: 'knowledge/world/rules.md' },
    ],
  },
  {
    stage: 3,
    label: '主要人物与检索索引',
    skill: 'character-bible',
    required: [
      { type: 'dir_markdown', path: 'knowledge/entities', label: 'knowledge/entities/*.md' },
      { type: 'file', path: 'knowledge/relationships.md' },
      { type: 'file', path: 'knowledge/lookup.json' },
    ],
  },
  {
    stage: 4,
    label: '地点与物品档案',
    skill: 'locations-bible',
    required: [
      { type: 'dir_markdown_min', path: 'knowledge/locations', label: 'knowledge/locations/*.md', min: 3 },
      { type: 'dir_markdown_min', path: 'knowledge/items',     label: 'knowledge/items/*.md',     min: 1 },
    ],
  },
  {
    stage: 5,
    label: '总纲',
    skill: 'outline-collaborator',
    required: [{ type: 'file', path: 'outline/overall.md' }],
  },
  {
    stage: 6,
    label: '卷纲',
    skill: 'volume-outline',
    required: [{ type: 'file', path: 'outline/volumes/volume-1.md' }],
  },
  {
    stage: 7,
    label: 'Arc 细纲',
    skill: 'arc-outline',
    required: [{ type: 'dir_markdown', path: 'outline/arcs', label: 'outline/arcs/*.md' }],
  },
  {
    stage: 8,
    label: '已开写',
    skill: 'chinese-novelist',
    required: [{ type: 'dir_markdown', path: 'chapters', label: 'chapters/*.md' }],
  },
];

/** 写章前要求达到的最高 setup stage（= arc 细纲完成）。供守门与 repair 默认值复用。 */
export const STAGE_WRITE_READY = 7;
/** 整套 manifest 的最高 stage（= 开写）。 */
export const STAGE_MAX = 8;

export async function checkSetupManifest(projectName) {
  const stages = [];
  const missingRequired = [];
  let stage = 0;

  for (const item of SETUP_MANIFEST) {
    const checks = [];
    for (const req of item.required) {
      const ok = await requirementExists(projectName, req);
      const path = req.label || req.path;
      checks.push({ ...req, rawPath: req.path, path, ok });
      if (!ok) missingRequired.push({ stage: item.stage, label: item.label, skill: item.skill, path });
    }
    const complete = checks.every((x) => x.ok);
    stages.push({ stage: item.stage, label: item.label, skill: item.skill, complete, required: checks });
    if (complete && stage === item.stage - 1) stage = item.stage;
  }

  const next = SETUP_MANIFEST.find((x) => x.stage === Math.min(stage + 1, STAGE_MAX)) || null;
  const missing = next
    ? missingRequired.filter((x) => x.stage === next.stage).map((x) => x.path)
    : [];

  return {
    stage,
    missing,
    missingRequired: missingRequired.map((x) => x.path),
    details: stages,
    nextStage: next ? { stage: next.stage, label: next.label, skill: next.skill } : null,
  };
}

async function requirementExists(projectName, req) {
  if (req.type === 'file') return fileExists(projectName, req.path);
  if (req.type === 'dir_markdown') return dirHasMarkdown(projectName, req.path, 1);
  if (req.type === 'dir_markdown_min') return dirHasMarkdown(projectName, req.path, Math.max(1, Number(req.min) || 1));
  return false;
}

async function fileExists(projectName, rel) {
  try {
    const stat = await fsp.stat(resolveInProject(projectName, rel));
    return stat.isFile() && stat.size >= 0;
  } catch {
    return false;
  }
}

async function dirHasMarkdown(projectName, rel, min = 1) {
  try {
    const entries = await fsp.readdir(resolveInProject(projectName, rel), { withFileTypes: true });
    const count = entries.filter((x) => x.isFile() && x.name.endsWith('.md')).length;
    return count >= min;
  } catch {
    return false;
  }
}
