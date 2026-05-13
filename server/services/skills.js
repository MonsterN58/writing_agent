// Skill 目录 + 意图路由 + 按需加载
import path from 'node:path';
import fsp from 'node:fs/promises';
import { SKILLS_ROOT, readFileSafe, resolveInProject, writeFileSafe, assertWriteAllowed } from './fs-utils.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { checkSetupManifest } from './setup-manifest.js';

/**
 * 30 个 skill 的调用条件目录
 * - keywords: 命中用户消息文本时加载
 * - autoBefore / autoAfter: 自动链触发点（由 agent 在对应阶段插入）
 * - whenNoSoul: SOUL.md 不存在 + 用户提到写作/立项时强制加载
 * - primary: 主写作流（写章时必加）
 * - silentTools: 该 skill 主要靠工具落实（提示语优先简短）
 */
export const SKILL_CATALOG = {
  // ============== 必补 4 ==============
  'setup-bootstrap': {
    title: '立项前的风格基线启动器',
    keywords: ['先定文风', '先建文风', '风格基线', '参考样本', '我想模仿', '我希望读起来像', '/style-bootstrap', '想要古龙', '想要鲁迅', '风格定下来'],
    whenNoSoul: true,
    phase: 'setup:bootstrap',
    chainsTo: ['work-setup', 'style-voice'],
    mustCallTools: ['ask_user', 'update_progress'],
    forbidTools: ['write_chapter', 'setup_work'],
    exitWhen: ['style/voice.md exists', 'style/voice-dict.md exists'],
    priority: 5,
  },
  'work-setup': {
    title: '立项 · 生成 SOUL.md',
    keywords: ['新作品', '新建作品', '立项', '想写本', '想写一本', '想写个', '我有个灵感', '我有灵感', '帮我写小说', '帮我开新书', 'SOUL', '世界观初设', '从头开始'],
    whenNoSoul: true,
    phase: 'setup:soul',
    chainsFrom: ['setup-bootstrap'],
    chainsTo: ['setup-pipeline', 'bulk-import'],
    mustCallTools: ['ask_user', 'setup_work'],
    forbidTools: ['write_chapter'],
    exitWhen: ['SOUL.md exists'],
    priority: 5,
  },
  'setup-pipeline': {
    title: '立项全链编排（八阶段）',
    keywords: ['继续立项', '继续搭设定', '搭设定', '补齐设定', '设定补全', '按流程', '下一步', '全链', '八阶段', '七阶段', '搭完再写', '都搭完'],
    phase: 'setup:orchestrate',
    chainsTo: ['worldbuilding-systems', 'character-bible', 'locations-bible', 'items-bible', 'outline-collaborator', 'volume-outline', 'arc-outline', 'chapter-planner'],
    prerequisiteFiles: ['SOUL.md'],
    mustCallTools: ['setup_status', 'read_file', 'ask_user', 'update_progress'],
    forbidTools: ['write_chapter'],
    exitWhen: ['setupStage.stage >= 7'],
    priority: 5,
  },
  'character-bible': {
    title: '主要人物谱（立项 ③）',
    keywords: ['立人物', '主要人物', '人物谱', '角色表', '主角 配角 反派', '搭人物', '建立人物'],
    phase: 'setup:characters',
    chainsFrom: ['worldbuilding-systems', 'bulk-import'],
    // 主链：character-bible → locations-bible → items-bible → outline-collaborator
    chainsTo: ['locations-bible', 'outline-collaborator'],
    prerequisiteFiles: ['SOUL.md', 'knowledge/world/*'],
    mustCallTools: ['wiki_ingest', 'update_progress', 'lookup_rebuild'],
    forbidTools: ['write_chapter'],
    exitWhen: ['knowledge/entities/* exists', 'knowledge/relationships.md exists'],
    priority: 5,
  },
  'locations-bible': {
    title: '地点档案（立项 ④a）',
    keywords: ['立地点', '地点档案', '场景档案', '场景表', '地图', '驻地', '主要地点', '关键地点', '建立地点', '搭场景', 'location'],
    phase: 'setup:locations',
    chainsFrom: ['character-bible'],
    chainsTo: ['items-bible'],
    prerequisiteFiles: ['SOUL.md', 'knowledge/world/*', 'knowledge/entities/*'],
    mustCallTools: ['wiki_ingest', 'update_progress', 'lookup_rebuild'],
    forbidTools: ['write_chapter'],
    exitWhen: ['knowledge/locations/*.md count >= 3'],
    priority: 5,
  },
  'items-bible': {
    title: '关键物品档案（立项 ④b）',
    keywords: ['立物品', '物品档案', '法器', '道具', '主角金手指', '开篇关键物', '物品表', '关键道具', '神器', '法宝', '信物', 'item'],
    phase: 'setup:items',
    chainsFrom: ['locations-bible'],
    chainsTo: ['outline-collaborator'],
    prerequisiteFiles: ['SOUL.md', 'knowledge/world/*', 'knowledge/entities/*'],
    mustCallTools: ['wiki_ingest', 'update_progress', 'lookup_rebuild'],
    forbidTools: ['write_chapter'],
    exitWhen: ['knowledge/items/*.md count >= 1'],
    priority: 5,
  },
  'volume-outline': {
    title: '卷纲（立项 ⑤）',
    keywords: ['卷纲', '全书卷纲', '分卷大纲', '分卷', '第一卷规划', '卷规划', '本卷'],
    phase: 'setup:volume_outline',
    chainsFrom: ['outline-collaborator'],
    chainsTo: ['arc-outline'],
    prerequisiteFiles: ['SOUL.md', 'outline/overall.md', 'knowledge/entities/*', 'knowledge/relationships.md'],
    mustCallTools: ['read_file', 'write_outline', 'update_progress'],
    forbidTools: ['write_chapter'],
    exitWhen: ['all outline/volumes/volume-<N>.md in overall exist'],
    priority: 5,
  },
  'arc-outline': {
    title: '5 章细纲（立项 ⑥）',
    keywords: ['细纲', '5章细纲', '五章细纲', '接下来5章', '接下来五章', 'arc', 'arc 细纲', '章段规划'],
    phase: 'setup:arc_outline',
    chainsFrom: ['volume-outline'],
    chainsTo: ['chapter-planner'],
    prerequisiteFiles: ['SOUL.md', 'outline/overall.md', 'outline/volumes/*'],
    mustCallTools: ['read_file', 'write_outline', 'update_progress'],
    forbidTools: ['write_chapter'],
    exitWhen: ['outline/arcs/* exists'],
    priority: 5,
  },
  'bulk-import': {
    title: '设定集一次性导入',
    keywords: ['贴给你', '我把设定', '完整设定', '现成的设定', '导入设定', '设定集', '设定文档', '把这些设定', '设定笔记', '/import'],
    phase: 'setup:bulk_import',
    chainsFrom: ['work-setup'],
    chainsTo: ['setup-pipeline', 'outline-collaborator'],
    prerequisiteFiles: ['SOUL.md'],
    mustCallTools: ['setup_status', 'plan_tasks', 'wiki_ingest', 'update_progress', 'lookup_rebuild', 'conflict_check'],
    forbidTools: ['write_chapter'],
    exitWhen: ['knowledge/world/* exists', 'knowledge/entities/* exists', 'knowledge/lookup.json exists'],
    priority: 5,
  },
  'setting-supplement': {
    title: '设定补充 / 修订',
    keywords: ['对了', '还有个设定', '我想加', '加个设定', '补充设定', '改一下设定', '修订设定', '修订', '全篇', '统一替换', '我改主意', '把它改成'],
    phase: 'revise:setting_supplement',
    chainsTo: ['continuity-guard'],
    prerequisiteFiles: ['SOUL.md', 'knowledge/lookup.json'],
    mustCallTools: ['lookup_query', 'conflict_check', 'read_file'],
    forbidTools: ['write_chapter'],
    exitWhen: ['changed knowledge file synced to lookup', 'conflict_check completed'],
    priority: 5,
  },
  'wiki-ingest': {
    title: '章后沉淀 knowledge/',
    keywords: ['沉淀', '提取人物', '提取设定', 'wiki 重建'],
    autoAfter: ['write_chapter'],
    phase: 'write:post_chapter_ingest',
    chainsTo: ['foreshadow-tracker'],
    mustCallTools: ['wiki_ingest'],
    exitWhen: ['knowledge updated'],
  },
  'wiki-query': {
    title: '写前查 wiki 防崩',
    keywords: ['查设定', '查人物', '上次出现', '前面提过', 'X 修为是', '现在在哪'],
    autoBefore: ['write_chapter', 'chapter-planner'],
    phase: 'write:pre_context',
    chainsTo: ['chapter-planner'],
    mustCallTools: ['lookup_query', 'wiki_query', 'read_file'],
    exitWhen: ['relevant canon loaded'],
  },
  'wiki-archive': {
    title: '跨章推论归档 synthesis/',
    keywords: ['记一下', '归档这个规律', '沉淀这个推论', '跨章规律', '二层规律', 'synthesis'],
    phase: 'archive:synthesis',
    mustCallTools: ['wiki_archive'],
    exitWhen: ['knowledge/synthesis updated'],
  },
  'wiki-lint': {
    title: 'Wiki 体检报告',
    keywords: ['wiki 体检', '档案体检', '检查档案', 'lint', '知识库体检', '设定体检'],
    phase: 'archive:lint',
    mustCallTools: ['wiki_lint'],
    exitWhen: ['knowledge/lint-report.md updated'],
  },
  'chapter-planner': {
    title: '单章纲',
    keywords: ['章纲', '单章纲', '本章规划', '这章想写', '下一章规划', 'outline'],
    autoBefore: ['write_chapter'],
    primary: true,
    phase: 'write:chapter_outline',
    chainsFrom: ['arc-outline', 'wiki-query'],
    chainsTo: ['chinese-novelist'],
    prerequisiteFiles: ['SOUL.md', 'outline/overall.md', 'outline/arcs/*'],
    mustCallTools: ['read_file', 'lookup_query', 'write_outline'],
    exitWhen: ['outline/chapters/chapter-N.md exists'],
  },

  // ============== 强补 5 ==============
  'webnovel-tropes': {
    title: '网文爽点（金手指/装逼/打脸/扮猪吃虎/系统流）',
    keywords: ['爽点', '装逼', '打脸', '扮猪吃虎', '金手指', '系统流', '更爽', '加点爽', '不够爽'],
  },
  'hook-and-cliffhanger': {
    title: '章末钩子',
    keywords: ['钩子', '章末', '结尾', '吊人胃口', '结束太平', 'cliffhanger'],
    autoBefore: ['chapter-planner', 'write_chapter'],
  },
  'continuity-guard': {
    title: '一致性守门',
    keywords: ['一致性', '检查', '矛盾', '人设漂移', '设定矛盾', 'check', '体检'],
    autoAfter: ['write_chapter'],
  },
  'foreshadow-tracker': {
    title: '伏笔总账',
    keywords: ['伏笔', '挖了没填', '回收', 'foreshadow', '哪些伏笔'],
    autoAfter: ['wiki-ingest'],
  },
  'revision': {
    title: '改稿（L1润色/L2段改/L3章改/L4结构改）',
    keywords: ['改写', '重写', '润色', '改稿', '修改', '调整这段', '这章重做', 'rewrite', 'revision'],
  },

  // ============== 可选 4 ==============
  'worldbuilding-systems': {
    title: '体系化设定',
    keywords: ['修炼体系', '魔法体系', '科技树', '等级体系', '世界观体系', '体系设计', '势力划分', '经济体系'],
    phase: 'setup:worldbuilding',
    chainsFrom: ['setup-pipeline', 'work-setup'],
    chainsTo: ['character-bible'],
    prerequisiteFiles: ['SOUL.md'],
    mustCallTools: ['setup_status', 'read_file', 'update_progress', 'lookup_rebuild'],
    forbidTools: ['write_chapter'],
    exitWhen: ['knowledge/world/* exists'],
    priority: 5,
  },
  'naming': {
    title: '命名（角色/招式/法宝/地名）',
    keywords: ['起名', '取名', '叫什么', '招式名', '法宝名', '门派名', '地名', '名字'],
  },
  'pov-and-tense': {
    title: '视角与时态',
    keywords: ['视角', 'POV', '人称', '第一人称', '第三人称', '全知', '限知', '穿帮'],
  },
  'pacing-control': {
    title: '节奏控制',
    keywords: ['节奏', '太慢', '太赶', '注水', '没起伏', '冷热', '拍位'],
  },

  // ============== 现有 17 ==============
  'chinese-novelist': {
    title: '中文小说写作主流程',
    keywords: ['写章', '写第', '写正文', '写下一章', '继续写', '接着写', '开始写', '开第一章'],
    primary: true,
    phase: 'write:chapter_draft',
    chainsFrom: ['chapter-planner'],
    chainsTo: ['wiki-ingest', 'continuity-guard'],
    prerequisiteFiles: ['SOUL.md', 'outline/overall.md', 'outline/arcs/*', 'outline/chapters/chapter-N.md', 'knowledge/lookup.json'],
    mustCallTools: ['setup_status', 'get_chapter_context', 'lookup_query', 'wiki_query', 'read_file', 'write_chapter'],
    exitWhen: ['chapters/第N章-*.md exists'],
  },
  'drafting': {
    title: '起草',
    keywords: ['起草', '草稿', 'drafting', '从头写'],
  },
  'outline-collaborator': {
    title: '总纲与弧光',
    keywords: ['总纲', '总大纲', '整本规划', '弧光', '分卷', '主线规划'],
    phase: 'setup:overall_outline',
    chainsFrom: ['character-bible', 'bulk-import'],
    chainsTo: ['volume-outline'],
    prerequisiteFiles: ['SOUL.md', 'knowledge/world/*', 'knowledge/entities/*'],
    mustCallTools: ['read_file', 'write_outline', 'update_progress'],
    forbidTools: ['write_chapter'],
    exitWhen: ['outline/overall.md exists'],
    priority: 5,
  },
  'character-arc': {
    title: '人物弧光',
    keywords: ['人物弧', '角色成长', '人设变化', '主角成长线', '人物动机'],
  },
  'dialogue': {
    title: '对话',
    keywords: ['对话', '台词', '对白', '聊天写不好'],
  },
  'humanizer': {
    title: '去 AI 味',
    keywords: ['AI味', '人味', '太机器', 'ChatGPT 味', '破折号太多'],
  },
  'prose-style': {
    title: '文风',
    keywords: ['文风', '风格', '白开水', '紫色散文', '文笔'],
  },
  'style-voice': {
    title: '风格锚（style/voice.md + style/voice-dict.md）',
    keywords: ['风格锚', '文风锚', '声音基准', 'voice anchor', '建立文风', '调文风', '/style', 'voice-dict', '高频词', '禁用词典', '风格指纹'],
    phase: 'style:voice',
    chainsFrom: ['setup-bootstrap'],
    mustCallTools: ['update_progress'],
    forbidTools: ['write_chapter'],
  },
  'cliche-transcendence': {
    title: '反套路',
    keywords: ['套路', '俗套', '老梗', '光环', '反转老套', '高级一点'],
  },
  'genre-conventions': {
    title: '类型惯例',
    keywords: ['类型惯例', '题材惯例', '玄幻该有', '言情套路', '读者期待'],
  },
  'scene-sequencing': {
    title: '场景排序',
    keywords: ['场景排序', '场景顺序', '换场', '场景过渡'],
  },
  'endings': {
    title: '结局',
    keywords: ['结局', '收尾', '大结局', '终章', 'HE', 'BE'],
  },
  'story-analysis': {
    title: '剧情分析',
    keywords: ['剧情分析', '故事分析', '主题分析', '隐喻', '动机分析'],
  },
  'story-coach': {
    title: '故事教练',
    keywords: ['故事教练', '剧本教练', '帮我看看故事'],
  },
  'story-collaborator': {
    title: '故事讨论',
    keywords: ['讨论故事', '聊故事', '聊聊剧情', '一起想剧情'],
  },
  'adaptation-synthesis': {
    title: '改编综合',
    keywords: ['改编', '基于这个故事', '把这个改'],
  },
  'dna-extraction': {
    title: '风格 DNA 提取',
    keywords: ['DNA', '提取风格', '学这个风格', '模仿这种文笔'],
  },
  'list-builder': {
    title: '清单生成',
    keywords: ['清单', '列举', '列一份'],
  },
};

// 短应答 / 纯附和：不再装任何 skill，靠 BASE_SYSTEM 和 history 继续上轮任务
const CHITCHAT_RE = /^[\s,.，。！!?？\n\r]*(?:嗯+|好+的?|行+|对+|可以|收到|没问题|继续|下一步|ok|okay|谢谢|辛苦了?|麻烦了?|拜托了?|好吧|那就这样|就这样)[\s,.，。！!?？\n\r]*$/i;
function isChitchat(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length <= 8 && CHITCHAT_RE.test(t)) return true;
  if (t.length <= 2 && !/[\u4e00-\u9fa5A-Za-z]/.test(t)) return true;
  return false;
}

const USER_SKILL_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function normalizeUserSkillName(raw) {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 41);
  const name = base || `skill-${Date.now().toString(36).slice(-6)}`;
  return USER_SKILL_RE.test(name) ? name : `skill-${name}`.slice(0, 41).replace(/-$/g, '');
}

function normalizeArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/[，,|]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function normalizeSkillDef(name, def = {}, source = 'system', filePath = null) {
  return {
    ...def,
    name,
    source,
    filePath,
    title: def.title || name,
    description: def.description || '',
    keywords: normalizeArray(def.keywords),
    autoBefore: normalizeArray(def.autoBefore || def.activate_when),
    autoAfter: normalizeArray(def.autoAfter || def.activate_after),
    phase: def.phase || '',
    chainsFrom: normalizeArray(def.chainsFrom || def.chains_from),
    chainsTo: normalizeArray(def.chainsTo || def.chains_to),
    prerequisiteFiles: normalizeArray(def.prerequisiteFiles || def.prerequisite_files),
    mustCallTools: normalizeArray(def.mustCallTools || def.must_call_tools),
    forbidTools: normalizeArray(def.forbidTools || def.forbid_tools),
    exitWhen: Array.isArray(def.exitWhen) ? def.exitWhen : (Array.isArray(def.exit_when) ? def.exit_when : []),
    priority: Number(def.priority || (def.primary ? 4 : 2)),
  };
}

async function loadUserSkillEntries(projectName) {
  if (!projectName) return [];
  const dir = resolveInProject(projectName, 'skills');
  let files = [];
  try {
    files = await fsp.readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const file of files.filter((x) => x.endsWith('.md'))) {
    const name = file.replace(/\.md$/i, '');
    if (!USER_SKILL_RE.test(name)) continue;
    const abs = path.join(dir, file);
    const txt = await readFileSafe(abs);
    if (!txt) continue;
    const { data, body } = parseFrontmatter(txt);
    out.push({
      ...normalizeSkillDef(name, data, 'user', abs),
      body,
      relPath: `skills/${file}`,
    });
  }
  return out;
}

export async function getSkillCatalog(projectName) {
  const system = Object.fromEntries(
    Object.entries(SKILL_CATALOG).map(([name, def]) => [name, normalizeSkillDef(name, def, 'system')])
  );
  const user = await loadUserSkillEntries(projectName);
  for (const skill of user) system[skill.name] = skill;
  return system;
}

export function isUserSkillName(name) {
  return USER_SKILL_RE.test(String(name || ''));
}

function nextSetupSkill(stage) {
  const n = Number(stage || 0);
  if (n <= 0) return 'work-setup';
  if (n === 1) return 'worldbuilding-systems';
  if (n === 2) return 'character-bible';
  if (n === 3) return 'outline-collaborator';
  if (n === 4) return 'volume-outline';
  if (n === 5) return 'arc-outline';
  if (n === 6) return 'chapter-planner';
  return null;
}

function finalizeSkillHits({ hits, catalog, matched, emit }) {
  const MAX_SKILLS = 6;
  const order = Object.keys(SKILL_CATALOG);
  const sorted = [...hits].sort((a, b) => {
    const da = catalog[a] || {};
    const db = catalog[b] || {};
    if ((db.priority || 0) !== (da.priority || 0)) return (db.priority || 0) - (da.priority || 0);
    const ia = order.includes(a) ? order.indexOf(a) : 999;
    const ib = order.includes(b) ? order.indexOf(b) : 999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  }).slice(0, MAX_SKILLS);
  for (const name of sorted) {
    const def = catalog[name] || {};
    emit?.({ type: 'skill_routed', name, title: def.title || name, source: def.source || 'system', matchedOn: matched.get(name) || [], priority: def.priority || 0 });
  }
  return sorted;
}

/** 路由：基于文本 + 上下文（是否有 SOUL / 设定齐全度）选 skill */
export async function routeSkills({ userMessage, hasSoul, autoStage, setupStage, projectName, emit }) {
  const text = String(userMessage || '');
  const hits = new Set();
  const catalog = await getSkillCatalog(projectName);
  const matched = new Map();
  const mark = (name, reason) => {
    hits.add(name);
    if (!matched.has(name)) matched.set(name, []);
    matched.get(name).push(reason);
  };
  const markSetupStageSkill = (reason) => {
    const name = nextSetupSkill(setupStage?.stage);
    if (name) mark(name, reason);
  };

  // autoStage：自动链触发点（如 'after:write_chapter'），优先级最高，不受 chitchat 影响
  if (autoStage) {
    const [phase, target] = autoStage.split(':');
    const key = phase === 'before' ? 'autoBefore' : 'autoAfter';
    for (const [name, def] of Object.entries(catalog)) {
      if (def[key]?.includes(target)) mark(name, `${key}:${target}`);
    }
  }

  // 短应答（嘴嗯嗯、好的、继续 …）直接返回：不装 skill，靠 history 接上上轮任务
  if (isChitchat(text)) {
    if (hasSoul && setupStage && setupStage.stage > 0 && setupStage.stage < 7 && /(继续|下一步|好|可以|按流程|都搭完)/.test(text.trim())) {
      mark('setup-pipeline', 'setup_continue_chitchat');
      markSetupStageSkill('setup_stage_next');
    }
    return finalizeSkillHits({ hits, catalog, matched, emit });
  }

  // 关键词命中
  for (const [name, def] of Object.entries(catalog)) {
    if (!def.keywords) continue;
    const kws = def.keywords.filter((kw) => text.includes(kw));
    if (kws.length) mark(name, `keywords:${kws.join('|')}`);
  }

  // 立项状态路由（setupStage 由后端基于文件存在性计算，见 agent.js）
  const writeIntent = /(写|新作品|想写|灵感|开新书|新书|立项|搭设定|补齐设定)/.test(text);
  if (!hasSoul && writeIntent) mark('work-setup', 'no_soul_write_intent');
  // setup-pipeline：仅当用户显式提到立项 / 搭设定 / 继续搭 才挂，不再“阶段<6 就常驻”
  const setupIntent = /(立项|搭设定|补齐|搭完|全链|七阶段|下一步|按流程|继续搭|继续立项)/.test(text);
  if (hasSoul && setupStage && setupStage.stage < 7 && setupIntent) {
    mark('setup-pipeline', 'setup_stage');
    markSetupStageSkill('setup_stage_next');
  }

  // 写章意图
  const chapterIntent = /(写第|写章|写正文|写下一章|继续写|接着写|开始写|开第一章|开头)/.test(text);
  if (chapterIntent && hasSoul) {
    mark('chinese-novelist', 'chapter_intent');
    mark('chapter-planner', 'chapter_intent');
    mark('wiki-query', 'chapter_intent');
    mark('hook-and-cliffhanger', 'chapter_intent');
    mark('style-voice', 'chapter_intent');
    for (const [name, def] of Object.entries(catalog)) {
      if (def.autoBefore?.includes('write_chapter') || def.autoBefore?.includes('chapter-planner')) mark(name, 'activate_when:write_chapter');
    }
    // 如果设定还没搭完，要同时带 setup-pipeline 提醒先搭
    if (setupStage && setupStage.stage < 7) {
      mark('setup-pipeline', 'setup_stage');
      markSetupStageSkill('setup_stage_next');
    }
    // 注 1：故意不把 arc-outline 注入这里——arc-outline 是"5 章细纲规划"工具
    //       写章时模型会被 5 章规划误导成"批量写 5 章"。需要细纲时由 chinese-novelist
    //       流程内的 read_file outline/arcs/*.md 自然取用即可。
    // 注 2：故意不把 humanizer 注入这里——humanizer 是改稿后清理工具（其自身 SKILL.md
    //       明确反对在 drafting 中插入）。反 AI 味的事前约束已经写在 BASE_SYSTEM 的
    //       「写章流程铁律·第 -1 条」里，足以约束 token 生成时的风格。
  }

  // 改稿意图带 wiki-query 防止改坏
  if (/(改写|重写|润色|改稿)/.test(text)) {
    mark('revision', 'revision_intent');
  }

  if (/(文风|风格|风格锚|文风锚|声音基准|调文风|\/style)/.test(text)) {
    mark('prose-style', 'style_intent');
    mark('style-voice', 'style_intent');
  }

  // bulk-import 启发式：在立项早期阶段（≤①）用户贴长文本（>800 字符）且含设定类词汇
  // → 高概率是导入完整设定集
  const longText = text.length >= 800;
  const hasSettingWords = /(设定|世界观|主角|修炼|魔法|体系|势力|门派|国家|流派)/.test(text);
  if (longText && hasSettingWords && hasSoul && setupStage && setupStage.stage <= 2) {
    mark('bulk-import', 'long_setting_text');
  }
  // 设定补充：在中后期阶段（≥③，已有人物）用户说"对了/我想加/补充" → 不是新立项
  const supplementCue = /(对了|还有个|我想加|加个|补充|修订|全篇|改一下|改主意)/.test(text);
  if (supplementCue && hasSoul && setupStage && setupStage.stage >= 3) {
    mark('setting-supplement', 'supplement_cue');
  }

  return finalizeSkillHits({ hits, catalog, matched, emit });
}

/**
 * 计算立项阶段（基于文件存在性）
 * 返回 { stage: 1..7, missing: [...] }
 *   1 = 只有 SOUL
 *   2 = +世界观
 *   3 = +主要人物
 *   4 = +总纲
 *   5 = +第一卷卷纲
 *   6 = +至少一个 arc 细纲
 *   7 = 已经开始写章
 */
export async function computeSetupStage(projectName) {
  return await checkSetupManifest(projectName);
}

/** 加载 skill 文件全文（保留旧 API，给需要全文的场景） */
export async function loadSkillContent(name, projectName = null) {
  const p = await resolveSkillPath(name, projectName);
  if (!p) return null;
  const txt = await readFileSafe(p);
  if (!txt) return null;
  return stripFrontmatterIfUser(txt, p, projectName);
}

/**
 * 加载 skill 摘要：默认注入到 system prompt 的版本。
 * - 文件 < 1500 字 → 全文返回
 * - 否则只返回开头到第 2 个 ## 之前 + 章节标题清单 + 提示如何调 read_skill_section
 */
export async function loadSkillSummary(name, projectName = null) {
  const p = await resolveSkillPath(name, projectName);
  if (!p) return null;
  const txt = await readFileSafe(p);
  if (!txt) return null;
  const body = stripFrontmatterIfUser(txt, p, projectName);
  const wrapped = await wrapUserSkillIfNeeded(name, body, projectName);
  if (wrapped.length <= 1500) return wrapped;

  // 找出所有 ## 标题
  const sections = [];
  const re = /^##\s+(.+)$/gm;
  let m;
  while ((m = re.exec(wrapped)) !== null) {
    sections.push({ title: m[1].trim(), index: m.index });
  }
  let head;
  if (sections.length >= 2) {
    head = wrapped.slice(0, sections[1].index).trim();
  } else {
    head = wrapped.slice(0, 1200).trim();
  }
  if (head.length > 1200) head = head.slice(0, 1200) + '\n…';

  const titleList = sections.length
    ? sections.map((s) => `  - ${s.title}`).join('\n')
    : '  - （此 skill 无二级标题）';

  return `${head}\n\n---\n_本 skill 已折叠为摘要。如需读完整章节，调 \`read_skill_section({skill: '${name}', section: '<标题>'})\`。可用章节：_\n${titleList}`;
}

/** 读 skill 的某个 ## 章节正文（用于按需取段） */
export async function loadSkillSection(name, sectionTitle, projectName = null) {
  const p = await resolveSkillPath(name, projectName);
  if (!p) throw new Error(`skill 不存在：${name}`);
  const txt = await readFileSafe(p);
  if (!txt) throw new Error(`skill 不存在：${name}`);
  const body = stripFrontmatterIfUser(txt, p, projectName);
  if (!sectionTitle) return await wrapUserSkillIfNeeded(name, body, projectName); // 空 → 返回全文
  const re = /^##\s+(.+)$/gm;
  const positions = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    positions.push({ title: m[1].trim(), start: m.index });
  }
  const target = positions.find((s) => s.title === sectionTitle || s.title.includes(sectionTitle));
  if (!target) {
    return {
      error: `skill ${name} 内找不到章节"${sectionTitle}"`,
      available: positions.map((s) => s.title),
    };
  }
  const next = positions.find((s) => s.start > target.start);
  const end = next ? next.start : body.length;
  return { title: target.title, content: body.slice(target.start, end).trim() };
}

/** 列出所有可用 skill 名（给 read_skill_section 的容错提示用） */
export async function listAvailableSkills(projectName = null) {
  return Object.keys(await getSkillCatalog(projectName));
}

/** skill 描述：给前端时间线显示 */
export async function describeSkill(name, projectName = null) {
  const catalog = await getSkillCatalog(projectName);
  const def = catalog[name];
  return def ? def.title : name;
}

export async function listUserSkills(projectName) {
  return (await loadUserSkillEntries(projectName)).map((s) => ({
    name: s.name,
    title: s.title,
    description: s.description,
    keywords: s.keywords,
    activate_when: s.autoBefore,
    activate_after: s.autoAfter,
    priority: s.priority,
    relPath: s.relPath,
  }));
}

export async function writeUserSkill({ projectName, name, title, description = '', keywords = [], activate_when = [], activate_after = [], priority = 3, body = '' }) {
  if (!projectName) throw new Error('未激活作品');
  if (!USER_SKILL_RE.test(name)) throw new Error('skill name 必须是 2-41 位小写字母/数字/连字符，且以字母或数字开头');
  if (SKILL_CATALOG[name]) throw new Error(`不能覆盖系统 skill：${name}`);
  assertWriteAllowed('create_user_skill', `skills/${name}.md`);
  const contentBody = String(body || '').trim() || `# ${title || name}\n\n## 触发\n\n## 流程\n`;
  const data = {
    title: title || name,
    description,
    keywords: normalizeArray(keywords),
    activate_when: normalizeArray(activate_when),
    activate_after: normalizeArray(activate_after),
    priority: Math.max(1, Math.min(5, Number(priority || 3))),
  };
  const relPath = `skills/${name}.md`;
  const abs = resolveInProject(projectName, relPath);
  const content = stringifyFrontmatter(data, contentBody);
  if (content.length > 20000) throw new Error('单个用户 skill 不能超过 20000 字符');
  await writeFileSafe(abs, content);
  return { ok: true, name, title: data.title, relPath, bytes: content.length };
}

export function draftUserSkillFromBrief({ brief = '', title = '', name = '' } = {}) {
  const cleanBrief = String(brief || '').trim();
  if (!cleanBrief) throw new Error('缺少 brief');
  const cleanTitle = String(title || '').trim() || cleanBrief.slice(0, 24).replace(/\s+/g, ' ');
  const cleanName = normalizeUserSkillName(name || cleanTitle);
  const keywords = [...new Set(cleanBrief.split(/[,，、\s]+/).map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 8))];
  return {
    name: cleanName,
    title: cleanTitle,
    description: cleanBrief.slice(0, 80),
    keywords,
    activate_when: [],
    activate_after: [],
    priority: 3,
    body: `# ${cleanTitle}\n\n## 何时使用\n\n当用户提到：${keywords.length ? keywords.join('、') : cleanTitle}。\n\n## 核心原则\n\n${cleanBrief}\n\n## 执行流程\n\n1. 先确认当前任务是否真的适用本技能。\n2. 读取必要上下文，不要凭空补设定。\n3. 按本技能原则给出建议或执行对应工具。\n4. 结束时总结已完成内容和后续建议。\n\n## 禁止\n\n- 不覆盖 SOUL.md、硬约束和用户原话。\n- 不在缺少上下文时编造事实。\n- 不把一次性偏好写成永久规则，除非用户明确要求。\n`,
  };
}

/** 读单个用户 skill 全文（含 frontmatter 解析后的字段 + body），用于前端编辑器 */
export async function readUserSkill(projectName, name) {
  if (!projectName) throw new Error('未激活作品');
  if (!USER_SKILL_RE.test(name)) throw new Error('非法 skill name');
  if (SKILL_CATALOG[name]) throw new Error(`这是系统 skill，不能在此读取：${name}`);
  const relPath = `skills/${name}.md`;
  const abs = resolveInProject(projectName, relPath);
  const txt = await readFileSafe(abs);
  if (!txt) throw new Error(`skill 不存在：${name}`);
  const { data, body } = parseFrontmatter(txt);
  return {
    name,
    title: data.title || name,
    description: data.description || '',
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    activate_when: Array.isArray(data.activate_when) ? data.activate_when : [],
    activate_after: Array.isArray(data.activate_after) ? data.activate_after : [],
    priority: Number(data.priority || 3),
    body: body || '',
    relPath,
  };
}

/** 删除用户 skill 文件 */
export async function deleteUserSkill(projectName, name) {
  if (!projectName) throw new Error('未激活作品');
  if (!USER_SKILL_RE.test(name)) throw new Error('非法 skill name');
  if (SKILL_CATALOG[name]) throw new Error(`不能删除系统 skill：${name}`);
  const relPath = `skills/${name}.md`;
  const abs = resolveInProject(projectName, relPath);
  try {
    await fsp.unlink(abs);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`skill 不存在：${name}`);
    throw e;
  }
  return { ok: true, name, relPath };
}

export async function buildSkillShelf(projectName, selected = []) {
  const catalog = await getSkillCatalog(projectName);
  const selectedSet = new Set(selected || []);
  return Object.values(catalog)
    .filter((s) => !selectedSet.has(s.name))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .slice(0, 30)
    .map((s) => `- ${s.name}${s.source === 'user' ? '（用户）' : ''}：${s.title}${s.description ? ` — ${s.description}` : (s.keywords?.length ? ` — 关键词：${s.keywords.slice(0, 6).join(' / ')}` : '')}`)
    .join('\n');
}

async function resolveSkillPath(name, projectName) {
  if (projectName && isUserSkillName(name)) {
    const userPath = resolveInProject(projectName, `skills/${name}.md`);
    if (await readFileSafe(userPath)) return userPath;
  }
  const sysPath = path.join(SKILLS_ROOT, `${name}.md`);
  if (await readFileSafe(sysPath)) return sysPath;
  return null;
}

function stripFrontmatterIfUser(txt, absPath, projectName) {
  if (!projectName) return txt;
  const skillsDir = resolveInProject(projectName, 'skills');
  if (absPath.startsWith(skillsDir)) return parseFrontmatter(txt).body;
  return txt;
}

async function wrapUserSkillIfNeeded(name, body, projectName) {
  if (!projectName || !isUserSkillName(name)) return body;
  const catalog = await getSkillCatalog(projectName);
  const def = catalog[name];
  if (def?.source !== 'user') return body;
  return `<user_skill name="${name}" scope="advisory" priority="${def.priority || 3}">\n${body.trim()}\n</user_skill>`;
}
