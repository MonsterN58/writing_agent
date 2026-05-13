import path from 'node:path';
import { checkSetupManifest, STAGE_WRITE_READY, STAGE_MAX } from './setup-manifest.js';
import { readFileSafe, resolveInProject, writeFileSafe } from './fs-utils.js';

const STUBS = {
  'SOUL.md': '# SOUL\n\n> TODO: 请补充题材、主角、核心冲突、篇幅、风格红线。\n',
  'knowledge/world/overview.md': '# 世界概览\n\n> TODO: 3-5 行说明世界定位、核心矛盾、主角所处初始环境。\n',
  'knowledge/world/power-system.md': '# 力量体系\n\n> TODO: 列出等级/品阶、升级条件、代价、上限与禁忌。\n',
  'knowledge/world/factions.md': '# 势力\n\n| 名称 | 属性 | 规模 | 驻地 | 与主角关系 |\n|---|---|---|---|---|\n| TODO | TODO | TODO | TODO | TODO |\n',
  'knowledge/world/geography.md': '# 地理与地点\n\n> TODO: 列出主角会去的关键地点、资源、危险和剧情用途。\n',
  'knowledge/world/history.md': '# 历史大事记\n\n| 时间 | 事件 | 影响 |\n|---|---|---|\n| TODO | TODO | TODO |\n',
  'knowledge/world/rules.md': '# 世界规则\n\n1. TODO: 写下会影响剧情决策的硬规则。\n',
  'knowledge/relationships.md': '# 人物关系\n\n```mermaid\ngraph TD\n  TODO[待补人物关系]\n```\n',
  'knowledge/lookup.json': '{\n  "version": 1,\n  "topics": []\n}\n',
  'outline/overall.md': '# 总纲\n\n> TODO: 补全主线、阶段目标、核心反转、结局方向。\n',
  'outline/volumes/volume-1.md': '# 第一卷卷纲\n\n> TODO: 补全本卷目标、冲突升级、关键章节节点。\n',
  'outline/arcs/arc-1-章001-005.md': '# Arc 1（第001-005章）\n\n> TODO: 补全 5 章细纲，每章目标/冲突/钩子。\n',
  // 新 stage 4 · 地点与物品档案 stub
  'knowledge/locations/location-1-主角住处.md': '# 主角住处\n\n- type: 居住 / 势力 / 禁地 / 资源点 / TODO\n- region: TODO\n- vibes: TODO\n\n## 地理与物质\n> TODO: 位置、面积、地貌、关键物件。\n\n## 经济与人群\n> TODO: 人口、产业、阶级。\n\n## 与主线的关联\n> TODO: 本地会发生哪些重要事件。\n',
  'knowledge/locations/location-2-开篇坜.md': '# 开篇坜场景\n\n- type: TODO\n- region: TODO\n- vibes: TODO\n\n> TODO: 本地限定为开篇前 3-5 章的主场景。\n',
  'knowledge/locations/location-3-首个冲突点.md': '# 首个冲突点\n\n- type: 交手 / 接任务 / 揭秘 / TODO\n- region: TODO\n\n> TODO: 主角会在这里与哪股势力首次正面交锁。\n',
  'knowledge/items/item-1-主角开篇关键物.md': '# 主角开篇关键物\n\n- type: 信物 / 法器 / 功法 / 亲人遗物 / TODO\n- power_tier: 凡品 / 低 / 中 / 高 / 禄外 / TODO\n- price: 获取代价 / 反噬代价 / TODO\n\n## 起源\n> TODO\n\n## 效果与限制\n> TODO\n\n## 在主线中的跟踪\n> TODO\n',
};

export async function buildSetupRepairPlan(projectName, { targetStage = STAGE_WRITE_READY } = {}) {
  const status = await checkSetupManifest(projectName);
  const target = Math.max(1, Math.min(STAGE_MAX, Number(targetStage) || STAGE_WRITE_READY));
  const missing = [];
  for (const stage of status.details || []) {
    if (stage.stage > target) continue;
    for (const req of stage.required || []) {
      if (req.ok) continue;
      const rawPath = req.rawPath || req.path;
      missing.push({
        stage: stage.stage,
        label: stage.label,
        skill: stage.skill,
        path: req.path,
        rawPath,
        type: req.type,
        canStub: canStub(req),
        tool: ownerToolFor(rawPath),
      });
    }
  }
  const tasks = missing.map((item, i) => ({
    id: `repair-${i + 1}`,
    title: `补齐 ${item.path}`,
    status: 'pending',
    stage: item.stage,
    skill: item.skill,
    tool: item.tool,
    canStub: item.canStub,
  }));
  return {
    ok: true,
    stage: status.stage,
    targetStage: target,
    nextStage: status.nextStage,
    missing,
    tasks,
    complete: missing.length === 0,
  };
}

export async function createSetupStubs(projectName, { targetStage = STAGE_WRITE_READY, only = [] } = {}) {
  const plan = await buildSetupRepairPlan(projectName, { targetStage });
  const allow = new Set((only || []).map((x) => String(x || '').trim()).filter(Boolean));
  const created = [];
  const skipped = [];

  for (const item of plan.missing) {
    if (allow.size && !allow.has(item.path)) continue;
    if (!item.canStub) {
      skipped.push({ path: item.path, reason: 'cannot_stub' });
      continue;
    }
    const writePaths = [stubPathFor(item), ...extraStubPathsFor(item)];
    for (const writePath of writePaths) {
      const abs = resolveInProject(projectName, writePath);
      const existing = await readFileSafe(abs);
      if (existing !== null) {
        skipped.push({ path: writePath, reason: 'exists' });
        continue;
      }
      const content = stubContentFor(writePath);
      await writeFileSafe(abs, content);
      created.push({ path: writePath, bytes: content.length });
    }
  }

  return { ok: true, plan, created, skipped };
}

function canStub(req) {
  const rawPath = req.rawPath || req.path;
  if (req.type === 'file') return Boolean(STUBS[rawPath]);
  if (req.type === 'dir_markdown') return rawPath === 'outline/arcs';
  if (req.type === 'dir_markdown_min') return rawPath === 'knowledge/locations' || rawPath === 'knowledge/items';
  return false;
}

function stubPathFor(item) {
  const rawPath = item.rawPath || item.path;
  if (rawPath === 'outline/arcs') return 'outline/arcs/arc-1-章001-005.md';
  if (rawPath === 'knowledge/locations') {
    // 一次性补 3 个 stub。buildSetupRepairPlan 只生一条 missing，createSetupStubs 需要能多创。
    return 'knowledge/locations/location-1-主角住处.md';
  }
  if (rawPath === 'knowledge/items') return 'knowledge/items/item-1-主角开篇关键物.md';
  return rawPath;
}

/** 一个 dir_markdown_min 需要多个 stub 才能达 min 阈值，返回需补的所有 stub 路径。 */
function extraStubPathsFor(item) {
  const rawPath = item.rawPath || item.path;
  if (rawPath === 'knowledge/locations') {
    return [
      'knowledge/locations/location-2-开篇坜.md',
      'knowledge/locations/location-3-首个冲突点.md',
    ];
  }
  return [];
}

function stubContentFor(rel) {
  return STUBS[rel] || `# ${path.basename(rel, path.extname(rel))}\n\n> TODO: 补齐内容。\n`;
}

function ownerToolFor(rel) {
  if (rel === 'SOUL.md') return 'setup_work';
  if (/^knowledge\/world\//.test(rel) || rel === 'knowledge/relationships.md') return 'update_progress';
  if (rel === 'knowledge/lookup.json') return 'lookup_rebuild';
  if (/^outline\//.test(rel)) return 'write_outline';
  if (/^knowledge\/entities/.test(rel)) return 'wiki_ingest';
  if (/^knowledge\/locations/.test(rel) || /^knowledge\/items/.test(rel)) return 'wiki_ingest';
  return 'unknown';
}
