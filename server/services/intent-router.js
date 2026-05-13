// Intent Router · 轻量规则意图识别
// 目标：先判断“这句话想干什么”，再决定 skill / context / history 策略，避免每句话都套完整写作大 prompt。

const CHITCHAT_RE = /^[\s,.，。！!?？\n\r]*(?:嗯+|好+的?|行+|对+|可以|收到|没问题|继续|下一步|ok|okay|谢谢|辛苦了?|麻烦了?|拜托了?|好吧|那就这样|就这样)[\s,.，。！!?？\n\r]*$/i;

function has(text, re) {
  return re.test(String(text || ''));
}

function inferChapter(text) {
  const s = String(text || '');
  const m1 = /第\s*(\d+)\s*章/.exec(s);
  if (m1) return Number(m1[1]);
  const m2 = /(一|二|三|四|五|六|七|八|九|十)章/.exec(s);
  if (!m2) return null;
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[m2[1]] || null;
}

function lastUserIntent(history) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role === 'user' && m.content) return classifyIntent({ userMessage: m.content, history: [], hasSoul: true, setupStage: null });
  }
  return null;
}

/**
 * @returns {{intent:string,target:object,risk:string,contextMode:string,historyRounds:number,skillsHint:string[],needsSoul:boolean,notes:string[]}}
 */
export function classifyIntent({ userMessage, history = [], hasSoul = false, setupStage = null }) {
  const text = String(userMessage || '').trim();
  const target = { chapter: inferChapter(text), file: null };
  const notes = [];

  if (!text || CHITCHAT_RE.test(text)) {
    const prev = lastUserIntent(history);
    const inherited = prev && prev.intent !== 'chat' ? prev.intent : 'continue';
    // 继承 target：短应答自身没章号 / 文件名，必须从上一条 user 意图捞，否则强制写也不知道写哪
    const inheritedTarget = prev?.target
      ? {
          chapter: target.chapter || prev.target.chapter || null,
          file: target.file || prev.target.file || null,
        }
      : target;
    return {
      intent: inherited,
      target: inheritedTarget,
      risk: inherited === 'write_chapter' || inherited === 'revise' ? 'medium' : 'low',
      contextMode: inherited === 'write_chapter' ? 'write' : inherited === 'revise' ? 'revision' : 'minimal',
      historyRounds: 2,
      skillsHint: [],
      needsSoul: inherited !== 'chat',
      notes: ['short_ack', ...(inheritedTarget.chapter ? [`inherited_chapter=${inheritedTarget.chapter}`] : [])],
    };
  }

  if (has(text, /(导出|导出全本|epub|txt|markdown|打包)/)) {
    return { intent: 'export', target, risk: 'low', contextMode: 'minimal', historyRounds: 2, skillsHint: [], needsSoul: true, notes };
  }

  if (has(text, /(查一下|查查|查询|查设定|查人物|上次出现|前面提过|现在在哪|修为|境界|有哪些伏笔|伏笔|一致性|矛盾|检查)/)) {
    return { intent: 'query_wiki', target, risk: 'low', contextMode: 'wiki', historyRounds: 2, skillsHint: ['wiki-query'], needsSoul: true, notes };
  }

  if (has(text, /(润色|改写|重写|改稿|修改|调整这段|这章重做|rewrite|revision)/i)) {
    const risk = has(text, /(重写|这章重做|结构|大纲|全篇|主线|人设|设定)/) ? 'high' : 'medium';
    return { intent: 'revise', target, risk, contextMode: 'revision', historyRounds: 3, skillsHint: ['revision'], needsSoul: true, notes };
  }

  if (has(text, /(写第|写章|写一章|帮我写.*章|给我写.*章|写正文|写下一章|继续写|接着写|开始写|开第一章|开头|起草|草稿)/)) {
    return {
      intent: 'write_chapter',
      target,
      risk: 'high',
      contextMode: 'write',
      historyRounds: 3,
      skillsHint: ['chinese-novelist', 'chapter-planner', 'wiki-query', 'hook-and-cliffhanger', 'style-voice'],
      needsSoul: true,
      notes,
    };
  }

  if (has(text, /((写|出|生成|落盘|保存|现在写|帮我写|给我写).*(总纲|总大纲|全书大纲|整体大纲|大纲|卷纲|分卷大纲|细纲|章纲))|outline\/(overall|volumes|arcs|chapters)\//i)) {
    const file = /(总纲|总大纲|全书大纲|整体大纲|outline\/overall\.md)/i.test(text)
      ? 'outline/overall.md'
      : null;
    return {
      intent: 'write_outline',
      target: { ...target, file },
      risk: 'high',
      contextMode: 'outline',
      historyRounds: 4,
      skillsHint: ['outline-collaborator', 'volume-outline', 'arc-outline'],
      needsSoul: true,
      notes,
    };
  }

  if (has(text, /(新作品|新建作品|立项|想写本|想写一本|开新书|SOUL|世界观初设|从头开始|搭设定|补齐设定|七阶段|按流程)/)) {
    return {
      intent: !hasSoul ? 'setup' : 'setup_continue',
      target,
      risk: setupStage && setupStage.stage >= 6 ? 'medium' : 'low',
      contextMode: 'setup',
      historyRounds: 3,
      skillsHint: !hasSoul ? ['work-setup'] : ['setup-pipeline'],
      needsSoul: hasSoul,
      notes,
    };
  }

  if (has(text, /(反馈|记住|以后|别再|我喜欢|我不喜欢|不要.*(?:文艺|破折号|AI味|内心独白)|这个角色.*(?:口吻|说话))/)) {
    return { intent: 'feedback', target, risk: 'low', contextMode: 'memory', historyRounds: 3, skillsHint: [], needsSoul: true, notes };
  }

  if (has(text, /(文风|风格|风格锚|文风锚|声音基准|调文风|\/style)/)) {
    return { intent: 'style', target, risk: 'medium', contextMode: 'style', historyRounds: 3, skillsHint: ['prose-style', 'style-voice'], needsSoul: true, notes };
  }

  if (has(text, /(讨论故事|聊故事|聊聊剧情|一起想剧情|剧情分析|故事分析|主题分析|动机分析)/)) {
    return { intent: 'story_chat', target, risk: 'low', contextMode: 'story', historyRounds: 3, skillsHint: ['story-collaborator'], needsSoul: true, notes };
  }

  return { intent: 'chat', target, risk: 'low', contextMode: 'minimal', historyRounds: 2, skillsHint: [], needsSoul: false, notes };
}

export function contextPolicy(intentInfo) {
  const mode = intentInfo?.contextMode || 'minimal';
  return {
    includeSoul: !['minimal'].includes(mode),
    includeProjects: ['minimal', 'setup'].includes(mode),
    includeSetupStage: ['setup', 'write', 'revision', 'outline'].includes(mode),
    includeActivePlan: !['minimal'].includes(mode),
    includeMemory: !['minimal'].includes(mode),
    includeScratchpad: !['minimal'].includes(mode),
    mode,
  };
}
