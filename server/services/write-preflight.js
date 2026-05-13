import fsp from 'node:fs/promises';
import { resolveInProject, readFileSafe } from './fs-utils.js';
import { listChapters } from './chapter-utils.js';
import { getChapterContext } from './quality.js';
import { lookupQuery } from './lookup.js';
import { queryByKeywords } from './wiki.js';
import { checkSetupManifest } from './setup-manifest.js';

const NAME_PREFIX = '王李张刘陈杨赵黄周吴徐孙朱马胡郭林何高梁郑罗宋谢唐韩曹许邓萧冯曾程蔡彭潘袁于董余苏叶吕魏蒋田杜丁沈姜范江傅钟卢汪戴崔任陆廖姚方金邱夏谭韦贾邹石熊孟秦阎薛侯雷白龙段郝孔邵史毛常万顾赖武康贺严尹钱施牛洪龚';

export function extractPreflightKeywords(text = '') {
  const names = [];
  const raw = String(text || '');
  const re = new RegExp(`[${NAME_PREFIX}][\\u4e00-\\u9fa5]{1,3}`, 'g');
  let m;
  while ((m = re.exec(raw))) {
    let name = m[0];
    name = name.replace(/[看站走坐说问答拿见来去回在了着也没不把给将从到向和与及、，。！？；：].*$/u, '');
    if (name.length >= 2) names.push(name);
  }
  const titleRe = /[\u4e00-\u9fa5]{1,3}(?:子|君|师|老|王|帝|尊|侯|公|仙|圣|魔|妖|鬼|神)/g;
  while ((m = titleRe.exec(raw))) {
    let name = m[0];
    name = name.replace(/^(看见|看|见|问|说|答|听见|站在|走向|回到)/u, '');
    if (name.length >= 2) names.push(name);
  }
  return [...new Set(names)].slice(0, 10);
}

export async function prepareWriteChapter({ projectName, chapter, keywords = [], scenes = [], maxEndingChars = 600 } = {}) {
  if (!projectName) throw new Error('未激活作品');
  const ch = Number(chapter);
  if (!ch) throw new Error('chapter 必须是正整数');

  const setup = await checkSetupManifest(projectName).catch(() => null);
  const chapters = await listChapters(projectName).catch(() => []);
  const overall = await readFileSafe(resolveInProject(projectName, 'outline/overall.md'));
  const context = await getChapterContext(projectName, ch, { maxEndingChars });
  const derivedKeywords = extractPreflightKeywords([
    context?.outline || '',
    context?.recentLog?.join('\n') || '',
    context?.worldRules || '',
  ].join('\n'));
  const finalKeywords = [...new Set([...(keywords || []), ...derivedKeywords])].slice(0, 10);
  const lookup = await lookupQuery(projectName, { keywords: finalKeywords, scenes, limit: 12 }).catch((e) => ({ error: String(e?.message || e), count: 0, paths: [] }));
  const wiki = await queryByKeywords(projectName, finalKeywords).catch((e) => ({ error: String(e?.message || e), hits: [] }));
  const arcFiles = await listArcFiles(projectName);
  const chapterOutlinePath = `outline/chapters/chapter-${ch}.md`;
  const chapterOutline = await readFileSafe(resolveInProject(projectName, chapterOutlinePath));
  const missing = [];

  if (setup && setup.stage < 7) missing.push('setup_stage_below_7');
  if (!overall) missing.push('outline/overall.md');
  if (!arcFiles.length) missing.push('outline/arcs/*.md');
  if (!chapterOutline) missing.push(chapterOutlinePath);
  if (!context?.outlineExists) missing.push('chapter_context.outline');
  if (!finalKeywords.length) missing.push('wiki_keywords');

  return {
    ok: missing.length === 0,
    chapter: ch,
    setupStage: setup ? { stage: setup.stage, missing: setup.missing, nextStage: setup.nextStage } : null,
    chapters: {
      count: chapters.length,
      latest: chapters.length ? chapters[chapters.length - 1] : null,
      targetExists: chapters.some((c) => Number(c.chapter) === ch),
    },
    outline: {
      overallExists: !!overall,
      arcCount: arcFiles.length,
      chapterOutlinePath,
      chapterOutlineExists: !!chapterOutline,
    },
    keywords: finalKeywords,
    context,
    lookup,
    wiki,
    missing,
    readyForWrite: missing.length === 0 || missing.every((x) => x === 'wiki_keywords'),
    nextTools: nextToolsForMissing(missing, ch),
  };
}

async function listArcFiles(projectName) {
  try {
    const dir = resolveInProject(projectName, 'outline/arcs');
    const entries = await fsp.readdir(dir);
    return entries.filter((x) => x.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

function nextToolsForMissing(missing, chapter) {
  const tools = [];
  if (missing.includes('setup_stage_below_6')) tools.push({ tool: 'setup_status' });
  if (missing.includes('outline/overall.md')) tools.push({ tool: 'write_outline', path: 'outline/overall.md' });
  if (missing.includes('outline/arcs/*.md')) tools.push({ tool: 'write_outline', path: 'outline/arcs/arc-1-章001-005.md' });
  if (missing.includes(`outline/chapters/chapter-${chapter}.md`) || missing.includes('chapter_context.outline')) tools.push({ tool: 'write_outline', path: `outline/chapters/chapter-${chapter}.md` });
  if (missing.includes('wiki_keywords')) tools.push({ tool: 'wiki_query', keywords: [] });
  return tools;
}
