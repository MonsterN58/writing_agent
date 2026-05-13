// 离线 eval：不需要 LLM。纯函数级回归测试 + 数据一致性自检。
//   npm run eval
//
// 覆盖：
//   1. tool schema 自洽：每个 TOOLS 条目 parameters 合法
//   2. WRITE_RULES 覆盖：assertWriteAllowed 用到的 name 都存在
//   3. routeSkills 意图路由用例
//   4. scoreChapterContent 样本基线
//   5. inferOwnerTool 路径推断
//   6. skills/*.md 全部可加载
//   7. frontmatter 解析用例
//   8. 工具 envelope 行为
//   9. BASE_SYSTEM 大小预算
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const results = [];
const stats = { total: 0, passed: 0, failed: 0 };

async function group(name, fn) {
  console.log(`\n━━━ ${name} ━━━`);
  await fn();
}

function t(name, fn) {
  stats.total += 1;
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(
        () => { stats.passed += 1; results.push({ name, ok: true }); console.log(`  ✓ ${name}`); },
        (e) => { stats.failed += 1; results.push({ name, ok: false, error: String(e?.message || e) }); console.log(`  ✗ ${name}\n    ${e?.message || e}`); }
      );
    }
    stats.passed += 1;
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    stats.failed += 1;
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.log(`  ✗ ${name}\n    ${e?.message || e}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

async function main() {
  const { TOOLS, normalizeModeProfile, detectRequiredWrites } = await import('../server/services/agent.js');
  const { routeSkills, getSkillCatalog, SKILL_CATALOG, draftUserSkillFromBrief } = await import('../server/services/skills.js');
  const { getChapterContext, scoreChapterContent, countWords, analyzeTransitions, contextCutsForChapter, appendInjectionStats } = await import('../server/services/quality.js');
  const { inferOwnerTool } = await import('../server/services/edit-file.js');
  const { parseFrontmatter, stringifyFrontmatter } = await import('../server/services/frontmatter.js');
  const { wrapToolResult, wrapToolError, wrapToolBlocked, isOk } = await import('../server/services/tool-envelope.js');
  const { validateArgs } = await import('../server/services/tool-validate.js');
  const { llmConfig } = await import('../server/services/llm.js');
  const {
    buildSkillRuntime,
    createRuntimeToolState,
    noteRuntimeToolSuccess,
    checkSkillToolGate,
    summarizeSkillRuntime,
  } = await import('../server/services/skill-runtime.js');
  const { checkSetupManifest, SETUP_MANIFEST } = await import('../server/services/setup-manifest.js');
  const { buildSetupRepairPlan, createSetupStubs } = await import('../server/services/setup-repair.js');
  const { checkSetupWriteGate, checkSetupStageGate, hasExplicitSkipConsent } = await import('../server/services/setup-write-gate.js');
  const { checkStubResidue } = await import('../server/services/acceptance.js');
  const fsUtils = await import('../server/services/fs-utils.js');
  const {
    lookupUpsert,
    lookupQuery,
    lookupRemove,
    lookupList,
    lookupRebuild,
    readLookup,
  } = await import('../server/services/lookup.js');
  const { conflictCheck } = await import('../server/services/conflict.js');
  const { sortToolCallsForExecution } = await import('../server/services/tool-meta.js');
  const { createTaskRuntime, advanceTaskRuntime, normalizeTasks } = await import('../server/services/task-runtime.js');
  const { planRecovery } = await import('../server/services/recovery-policy.js');
  const { extractPreflightKeywords } = await import('../server/services/write-preflight.js');
  const { assessCompletion, buildFinalSummary, renderFinalSummaryMarkdown, collectArtifacts } = await import('../server/services/completion-policy.js');
  const { extractVolumePlan, validateVolumeOutline, validateArcOutline } = await import('../server/services/outline-guard.js');
  const {
    applyIntentPolicy,
    assessStuck,
    buildReflection,
    deriveGoalProgress,
    detectAmbiguity,
    failureMemoryPayload,
    updateBudget,
    verifyToolResult,
  } = await import('../server/services/agent-intelligence.js');
  const {
    getWikiPending,
    buildWikiPendingBlock,
    getWikiLintDue,
    buildWikiLintDueBlock,
    archiveSynthesis,
    runWikiLint,
  } = await import('../server/services/wiki-automation.js');
  const { buildSoftStopPayload, shouldOfferAgentResume, renderResumeHint } = await import('../server/services/soft-stop.js');
  const { TurnRunner, turnRunnerSnapshot } = await import('../server/services/turn-runner.js');
  const { editFilePreview } = await import('../server/services/write-preview.js');
  const { scanChapterConsistency } = await import('../server/services/consistency-scan.js');
  const { listVolumeNodes, buildVolumeMilestonesMd } = await import('../server/services/volume-nodes.js');
  const { applyIngest, listOpenForeshadows, rebuildForeshadowLedger } = await import('../server/services/wiki.js');
  const { parseFeedbackEntries, clusterFeedback, learnPreferences, buildLearnedRulesMd } = await import('../server/services/preference-learner.js');
  const { appendFeedback } = await import('../server/services/quality.js');

  await group('tool schema', () => {
    t('TOOLS 非空且每条有 name/description/parameters', () => {
      assert(Array.isArray(TOOLS) && TOOLS.length > 0, 'TOOLS 为空');
      for (const tool of TOOLS) {
        assert(tool.type === 'function', `工具 type 必须是 function`);
        const f = tool.function;
        assert(f?.name, 'tool.function.name 缺失');
        assert(typeof f.description === 'string' && f.description.length > 0, `${f.name} description 缺失`);
        assert(f.parameters && typeof f.parameters === 'object', `${f.name} parameters 缺失`);
        assert(f.parameters.type === 'object', `${f.name} parameters.type 必须 object`);
      }
    });
    t('工具名全局唯一', () => {
      const seen = new Set();
      for (const tool of TOOLS) {
        const name = tool.function.name;
        assert(!seen.has(name), `工具名重复：${name}`);
        seen.add(name);
      }
    });
    t('required 字段的参数必须在 properties 中声明', () => {
      for (const tool of TOOLS) {
        const f = tool.function;
        const props = f.parameters.properties || {};
        const required = f.parameters.required || [];
        for (const key of required) {
          assert(key in props, `${f.name} required "${key}" 未在 properties 中声明`);
        }
      }
    });
    t('关键工具在 TOOLS 中存在', () => {
      const names = new Set(TOOLS.map((t) => t.function.name));
      const must = ['write_chapter', 'write_outline', 'setup_work', 'setup_status', 'setup_repair', 'update_progress', 'read_file', 'edit_file', 'wiki_query', 'wiki_ingest', 'wiki_archive', 'wiki_lint', 'lookup_query', 'lookup_upsert', 'lookup_remove', 'lookup_list', 'lookup_rebuild', 'conflict_check', 'record_feedback', 'create_user_skill', 'list_user_skills', 'memory_record', 'plan_tasks', 'ask_user', 'finish_task'];
      for (const m of must) assert(names.has(m), `必备工具缺失：${m}`);
    });
  });

  await group('write rules', () => {
    t('inferOwnerTool 所有返回值都在 WRITE_RULES 里', () => {
      const { assertWriteAllowed } = fsUtils;
      const cases = [
        ['SOUL.md', 'setup_work'],
        ['chapters/第1章-a.md', 'write_chapter'],
        ['outline/overall.md', 'write_outline'],
        ['knowledge/entities/a.md', 'wiki_ingest'],
        ['knowledge/synthesis/fog-selectivity.md', 'wiki_archive'],
        ['knowledge/lint-report.md', 'wiki_lint'],
        ['knowledge/lookup.json', 'lookup_upsert'],
        ['knowledge/world/overview.md', 'update_progress'],
        ['knowledge/foreshadow.md', 'foreshadow_scan'],
        ['progress/foreshadow-alerts.md', 'foreshadow_scan'],
        ['reviews/consistency/x.md', 'consistency_check'],
        ['skills/my.md', 'create_user_skill'],
        ['style/feedback.md', 'update_progress'],
      ];
      for (const [p, tool] of cases) {
        assert(inferOwnerTool(p) === tool, `${p} 应归 ${tool}，实得 ${inferOwnerTool(p)}`);
        assertWriteAllowed(tool, p); // 应不抛
      }
    });
    t('非法越界路径会被 resolveInProject 拒绝', () => {
      let threw = false;
      try { fsUtils.resolveInProject('probe', '../../etc/passwd'); } catch { threw = true; }
      assert(threw, '越界路径应抛异常');
    });
  });

  await group('routeSkills', async () => {
    await t('短应答不装载 skill', async () => {
      const r = await routeSkills({ userMessage: '好', hasSoul: true, autoStage: null, setupStage: { stage: 7, missing: [] } });
      assert(Array.isArray(r) && r.length === 0, `短应答应返回空数组，实得 ${JSON.stringify(r)}`);
    });
    await t('"写第 3 章" 触发 chinese-novelist/chapter-planner/wiki-query', async () => {
      const r = await routeSkills({ userMessage: '写第 3 章', hasSoul: true, setupStage: { stage: 7, missing: [] } });
      const s = new Set(r);
      for (const m of ['chinese-novelist', 'chapter-planner', 'wiki-query']) {
        assert(s.has(m), `写章应挂载 ${m}，实得 [${r.join(',')}]`);
      }
    });
    await t('"改写这段" 挂 revision', async () => {
      const r = await routeSkills({ userMessage: '润色一下这段', hasSoul: true, setupStage: { stage: 7, missing: [] } });
      assert(r.includes('revision'), `改稿应挂 revision，实得 [${r.join(',')}]`);
    });
    await t('无 SOUL + "我想写本书" 触发 work-setup', async () => {
      const r = await routeSkills({ userMessage: '我想写一本玄幻小说', hasSoul: false, setupStage: { stage: 0, missing: [] } });
      assert(r.includes('work-setup'), `立项意图应挂 work-setup，实得 [${r.join(',')}]`);
    });
    await t('autoStage after:write_chapter 挂 wiki-ingest', async () => {
      const r = await routeSkills({ userMessage: '', hasSoul: true, autoStage: 'after:write_chapter' });
      assert(r.includes('wiki-ingest'), `after:write_chapter 应挂 wiki-ingest`);
    });
    await t('立项短应答"继续"挂 setup-pipeline + 当前阶段 skill', async () => {
      const r = await routeSkills({ userMessage: '继续', hasSoul: true, setupStage: { stage: 1, missing: ['knowledge/world/*'] } });
      assert(r.includes('setup-pipeline'), `继续立项应挂 setup-pipeline，实得 [${r.join(',')}]`);
      assert(r.includes('worldbuilding-systems'), `stage=1 下一步应挂 worldbuilding-systems，实得 [${r.join(',')}]`);
    });
    await t('设定未完成时写章会挂 setup-pipeline + 当前阶段 skill', async () => {
      const r = await routeSkills({ userMessage: '写第 1 章', hasSoul: true, setupStage: { stage: 3, missing: ['outline/overall.md'] } });
      assert(r.includes('setup-pipeline'), `写章但 setup 未完成应挂 setup-pipeline，实得 [${r.join(',')}]`);
      assert(r.includes('outline-collaborator'), `stage=3 下一步应挂 outline-collaborator，实得 [${r.join(',')}]`);
    });
  });

  await group('quality scoring', () => {
    const goodSample = `门外起风了。林尘攥着那枚玉佩，没出声。师父的火折子还搁在桌角，烧了一半。\n\n"你真想去？"师父问。\n\n他点头。`;
    const badSample = `林尘心潮澎湃，波澜壮阔的前路在他眼前徐徐展开。他深吸一口气，眼神坚定——他相信，无论前路多难，他都会勇敢走下去。一股复杂的情感涌上心头。`;
    t('好样本比差样本得分高', () => {
      const g = scoreChapterContent({ content: goodSample, chapter: 1, title: 'g' });
      const b = scoreChapterContent({ content: badSample, chapter: 1, title: 'b' });
      assert(g.dimensions.anti_ai > b.dimensions.anti_ai, `好样本 anti_ai(${g.dimensions.anti_ai}) 应 > 差样本(${b.dimensions.anti_ai})`);
    });
    t('countWords 只计 CJK + 英文词', () => {
      assert(countWords('') === 0, '空串应为 0');
      assert(countWords('林尘') === 2, '"林尘" 应为 2');
      assert(countWords('hello world') >= 2, '两个英文词应 >= 2');
    });
    t('AI 味样本触发 anti_ai 扣分', () => {
      const b = scoreChapterContent({ content: badSample, chapter: 1, title: 'b' });
      assert(b.dimensions.anti_ai < 80, `差样本 anti_ai 应 < 80，实得 ${b.dimensions.anti_ai}`);
    });
  });

  await group('章际/场景过渡', () => {
    // 段间空行多、几乎不带过渡词的硬切样本
    const abrupt = [
      '林尘攥着玉佩，没说话。师父的火折子还搁在桌角。',
      '王家三公子端坐主位，手里把玩一柄折扇。',
      '青云山顶云海翻涌，玄机子负手而立。',
      '林尘已立在内门石阶下，仰头望去。',
    ].join('\n\n');
    // 同样四段，但每段都有时间/地点过渡词
    const smooth = [
      '林尘攥着玉佩，没说话。师父的火折子还搁在桌角，烧了一半。',
      '半个时辰后，他来到镇上，王家三公子端坐主位，手里把玩一柄折扇。',
      '与此同时，青云山顶云海翻涌，玄机子负手而立。',
      '入夜，林尘已立在内门石阶下，仰头望去。',
    ].join('\n\n');

    t('analyzeTransitions: 硬切样本 bridgeRatio<0.5', () => {
      const r = analyzeTransitions({ content: abrupt });
      assert(r.intra.breakCount >= 3, `breakCount 期望 ≥3，实得 ${r.intra.breakCount}`);
      assert(r.intra.bridgeRatio < 0.5, `硬切 bridgeRatio 应 <0.5，实得 ${r.intra.bridgeRatio}`);
      assert(r.intra.weakBreakSamples.length >= 1, '应至少给出一个 weakBreakSample');
    });
    t('analyzeTransitions: 平滑样本 bridgeRatio>=0.7', () => {
      const r = analyzeTransitions({ content: smooth });
      assert(r.intra.bridgeRatio >= 0.7, `平滑样本 bridgeRatio 应 ≥0.7，实得 ${r.intra.bridgeRatio}`);
    });
    t('analyzeTransitions: 章首命中硬锚点 → inter.strong=true', () => {
      const prevEnding = '灯灭前，林尘看见墙上多了一行字：三日后，别回头。他攥紧玉佩，转身。';
      const opening = '那行字烧在他眼里整夜。林尘还攥着玉佩，天没亮就朝城外走。';
      const r = analyzeTransitions({ content: opening, prevEnding, anchors: ['林尘', '玉佩'] });
      assert(r.inter.hasPrev === true, 'hasPrev 应为 true');
      assert(r.inter.strong === true, `应识别为强衔接，hardAnchorsHit=${r.inter.hardAnchorsHit.join(',')} bigramOverlap=${r.inter.bigramOverlap}`);
      assert(r.inter.hardAnchorsHit.includes('林尘'), 'hardAnchorsHit 应包含 林尘');
    });
    t('analyzeTransitions: 章首与上章末完全无锚 → inter.strong=false', () => {
      const prevEnding = '灯灭前，林尘看见墙上多了一行字：三日后，别回头。';
      const opening = '王家家主端坐主位，三公子汇报昨夜的动静。茶香袅袅。';
      const r = analyzeTransitions({ content: opening, prevEnding, anchors: ['林尘', '玉佩'] });
      assert(r.inter.strong === false, `应识别为硬切，但 strong=${r.inter.strong} hardAnchorsHit=${r.inter.hardAnchorsHit} bigramOverlap=${r.inter.bigramOverlap}`);
    });
    t('analyzeTransitions: 第一章无 prevEnding → inter.strong=true 自动通过', () => {
      const r = analyzeTransitions({ content: smooth });
      assert(r.inter.hasPrev === false && r.inter.strong === true, '第一章应自动放行');
    });
    t('scoreChapterContent: 加入 transition 维度', () => {
      const s = scoreChapterContent({ content: smooth, chapter: 1, title: 't' });
      assert(typeof s.dimensions.transition === 'number', `transition 维度应存在，实得 ${s.dimensions.transition}`);
      assert(s.transitions && s.transitions.intra && s.transitions.inter, 'transitions 字段应返回');
    });
    t('scoreChapterContent: 平滑样本 transition 分高于硬切样本', () => {
      const sg = scoreChapterContent({ content: smooth, chapter: 2, title: 'g' });
      const sb = scoreChapterContent({ content: abrupt, chapter: 2, title: 'b' });
      assert(sg.dimensions.transition > sb.dimensions.transition, `平滑(${sg.dimensions.transition}) 应 > 硬切(${sb.dimensions.transition})`);
    });
    t('scoreChapterContent: 章际硬切 → issues 含"章际硬切"', () => {
      const prevEnding = '灯灭前，林尘看见墙上多了一行字：三日后，别回头。';
      const opening = '王家家主端坐主位，三公子汇报昨夜动静。茶香袅袅，丫鬟添水。';
      const s = scoreChapterContent({ content: opening, chapter: 2, title: 't', prevEnding, anchors: ['林尘', '玉佩'] });
      assert(s.issues.some((x) => /章际硬切/.test(x)), `issues 应含"章际硬切"，实得 ${JSON.stringify(s.issues)}`);
    });
    t('scoreChapterContent: 段际硬切多 → issues 含"段际硬切"', () => {
      const s = scoreChapterContent({ content: abrupt, chapter: 1, title: 't' });
      assert(s.issues.some((x) => /段际硬切/.test(x)), `issues 应含"段际硬切"，实得 ${JSON.stringify(s.issues)}`);
    });
    t('BASE_SYSTEM 含 第 -1.5 条 场景过渡铁律', () => {
      const txt = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/第 -1\.5 条 · 场景过渡铁律/.test(txt), 'agent.js 应包含 "第 -1.5 条 · 场景过渡铁律" 字样');
      assert(/衔接锚点（本章开篇 250 字必须延续/.test(txt), 'buildCanonContextFromState 应注入 衔接锚点 块');
    });
    t('critic.js 含章际衔接段 §6', () => {
      const txt = fs.readFileSync(path.join(ROOT, 'server/services/critic.js'), 'utf8');
      assert(/章际衔接 \/ 场景过渡/.test(txt), 'critic.js 应包含 §6 章际衔接 / 场景过渡');
      assert(/transition/.test(txt), 'critic.js issue kind 应含 transition');
    });
    t('ChapterSavedCard.DIM_LABEL 与后端维度 keys 同步', () => {
      const cardSrc = fs.readFileSync(path.join(ROOT, 'src/components/cards/ChapterSavedCard.jsx'), 'utf8');
      const expected = ['opening_hook', 'scene_logic', 'dialogue_voice', 'anti_ai', 'consistency_proxy', 'ending_hook', 'transition'];
      for (const k of expected) {
        assert(new RegExp(`\\b${k}\\b\\s*:`).test(cardSrc), `DIM_LABEL 缺少 key：${k}`);
      }
      // 防回归：旧的 stale keys 不应再出现在 DIM_LABEL（除非和上面冲突）
      assert(!/\blength\s*:\s*'字数'/.test(cardSrc), 'DIM_LABEL 仍含旧 key length');
      assert(!/\bcharacter_voice\b/.test(cardSrc), 'DIM_LABEL 仍含旧 key character_voice');
      assert(!/\bsensory\s*:/.test(cardSrc), 'DIM_LABEL 仍含旧 key sensory');
    });
    t('ChapterSavedCard verdict 用 pass（与后端一致），不再用 accept', () => {
      const cardSrc = fs.readFileSync(path.join(ROOT, 'src/components/cards/ChapterSavedCard.jsx'), 'utf8');
      assert(/verdict === 'pass'/.test(cardSrc), 'ChapterSavedCard 应识别 verdict=pass');
      assert(/pass:\s*'通过'/.test(cardSrc), 'verdictLabel 应把 pass 映射为「通过」');
      assert(!/verdict === 'accept'/.test(cardSrc), '不应再使用 verdict=accept');
    });
    t('acceptance.js 把 prevEnding/anchors 传给 scoreChapterContent', () => {
      const src = fs.readFileSync(path.join(ROOT, 'server/services/acceptance.js'), 'utf8');
      assert(/prevEnding\s*=\s*''\s*,\s*anchors\s*=\s*\[\]/.test(src), 'acceptChapter 签名应含 prevEnding/anchors');
      assert(/scoreChapterContent\(\s*\{[^}]*prevEnding[^}]*anchors[^}]*\}\s*\)/s.test(src), 'scoreChapterContent 调用应带 prevEnding+anchors');
    });
    t('AcceptanceCard 读 relPath（与后端 emit 一致）', () => {
      const src = fs.readFileSync(path.join(ROOT, 'src/components/cards/AcceptanceCard.jsx'), 'utf8');
      assert(/report\.relPath/.test(src), 'AcceptanceCard 应读 report.relPath');
    });
    t('chapter_critic 事件携带 issues 数组', () => {
      const src = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      // 找到 chapter_critic emit 块
      const m = /type:\s*'chapter_critic'[\s\S]{0,500}?\}\)/.exec(src);
      assert(m, '未找到 chapter_critic emit 块');
      assert(/issues\s*:\s*Array\.isArray\(r\.issues\)/.test(m[0]), 'chapter_critic emit 应同时发送 issues 数组');
    });
    t('auto_repair 二次验收带 canon 上下文', () => {
      const src = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      // 必须有 canonForReAccept = buildCanonContextFromState(...)
      assert(/canonForReAccept\s*=\s*buildCanonContextFromState\(/.test(src), 'auto_repair 二次验收应构造 canonForReAccept');
      // 二次 acceptChapter 调用 context 不再硬写 ''
      assert(!/content:\s*r\.data,\s*context:\s*''/.test(src), 'auto_repair 二次验收不应再硬写 context: \'\'');
    });
    t('acceptance 与 scores 文件命名一致（统一不补零）', () => {
      const src = fs.readFileSync(path.join(ROOT, 'server/services/acceptance.js'), 'utf8');
      assert(/`reviews\/acceptance\/chapter-\$\{chapter\}\.md`/.test(src), 'acceptance.js 应用 chapter-${chapter}.md（与 reviews/scores 一致，不补零）');
      assert(!/padStart\(3,\s*'0'\)/.test(src), 'acceptance.js 不应再 padStart(3, "0")');
    });
    t('loadCharacterStates 返回 aliases 字段', () => {
      const src = fs.readFileSync(path.join(ROOT, 'server/services/wiki.js'), 'utf8');
      // 找 loadCharacterStates 函数
      const fn = /export async function loadCharacterStates\([\s\S]*?\n\}/.exec(src);
      assert(fn, '未找到 loadCharacterStates');
      assert(/aliases:\s*Array\.isArray\(meta\.aliases\)/.test(fn[0]), 'loadCharacterStates 行应包含 aliases 字段');
    });
  });

  await group('frontmatter', async () => {
    t('parse/stringify 回环', () => {
      const data = { title: '测试', keywords: ['a', 'b'], priority: 3 };
      const body = '# hello\n正文';
      const txt = stringifyFrontmatter(data, body);
      const { data: d2, body: b2 } = parseFrontmatter(txt);
      assert(d2.title === '测试', `title 丢失: ${d2.title}`);
      assert(Array.isArray(d2.keywords) && d2.keywords.length === 2, `keywords 错`);
      assert(d2.priority === 3, `priority 错：${d2.priority}`);
      assert(b2.trim().startsWith('# hello'), `body 错：${b2}`);
    });
    t('无 frontmatter 的文本 body 原样返回', () => {
      const { data, body } = parseFrontmatter('# 纯内容');
      assert(Object.keys(data).length === 0, 'data 应为空');
      assert(body === '# 纯内容', 'body 应原样');
    });
    await t('用户 skill 元数据字段可解析到 catalog', async () => {
      const project = '__eval_pr1_skill_meta__';
      const dir = path.join(ROOT, 'novels', project, 'skills');
      fs.rmSync(path.join(ROOT, 'novels', project), { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meta-probe.md'), `---\ntitle: Meta Probe\nphase: write_chapter\nchains_to: [wiki-ingest]\nmust_call_tools: [lookup_query, read_file]\nforbid_tools: [write_chapter]\nprerequisite_files: [knowledge/lookup.json]\npriority: 9\n---\n\n# Meta Probe\n\n正文足够长，用于测试。`);
      const catalog = await getSkillCatalog(project);
      const s = catalog['meta-probe'];
      assert(s.phase === 'write_chapter', `phase 解析失败：${s.phase}`);
      assert(s.chainsTo.includes('wiki-ingest'), `chains_to 解析失败`);
      assert(s.mustCallTools.includes('lookup_query') && s.mustCallTools.includes('read_file'), `must_call_tools 解析失败`);
      assert(s.forbidTools.includes('write_chapter'), `forbid_tools 解析失败`);
      assert(s.prerequisiteFiles.includes('knowledge/lookup.json'), `prerequisite_files 解析失败`);
    });
  });

  await group('lookup service', async () => {
    const project = '__eval_pr1_lookup__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/world'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/entities'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'knowledge/world/power-system.md'), '# 修炼体系\n\n境界：凡人 → 金丹。突破要经历雷劫。');
    fs.writeFileSync(path.join(projectDir, 'knowledge/entities/lin-chen.md'), `---\nid: lin-chen\nname: 林尘\ntype: character\naliases: [林公子]\nstatus: 凡人\n---\n\n# 林尘\n\n主角，目标是突破金丹。`);

    await t('lookup_upsert 写 json/md 且 list 可回读', async () => {
      const r = await lookupUpsert(project, { id: 'power-system', title: '修炼体系', kind: 'world', triggers: ['突破', '金丹'], scenes: ['突破'], paths: ['knowledge/world/power-system.md'], must_read: true, source: 'eval' });
      assert(r.ok && r.relPaths.includes('knowledge/lookup.json'), 'lookup_upsert 应写 json');
      const list = await lookupList(project);
      assert(list.count === 1 && list.topics[0].id === 'power-system', `list 错：${JSON.stringify(list)}`);
    });
    await t('lookup_query 支持 scene/trigger 命中并返回路径', async () => {
      const r = await lookupQuery(project, { scenes: ['突破'], keywords: ['金丹'] });
      assert(r.count >= 1, '应命中 topic');
      assert(r.paths.some((p) => p.path === 'knowledge/world/power-system.md'), `路径未返回：${JSON.stringify(r.paths)}`);
    });
    await t('lookup_remove 删除 topic', async () => {
      const r = await lookupRemove(project, 'power-system');
      assert(r.removed === 1, `应删除 1 条，实得 ${r.removed}`);
      const list = await lookupList(project);
      assert(list.count === 0, '删除后应为空');
    });
    await t('lookup_rebuild 扫 knowledge 生成索引', async () => {
      const r = await lookupRebuild(project);
      assert(r.generated >= 2, `应至少生成 2 条，实得 ${r.generated}`);
      const q = await lookupQuery(project, { characters: ['林尘'] });
      assert(q.paths.some((p) => p.path === 'knowledge/entities/lin-chen.md'), `角色路径未命中：${JSON.stringify(q.paths)}`);
    });
    await t('readLookup schema 自洽', async () => {
      const lookup = await readLookup(project);
      assert(lookup.version >= 1 && Array.isArray(lookup.topics), 'lookup schema 错');
      assert(lookup.topics.every((x) => x.id && x.title && Array.isArray(x.paths)), 'topic 必须含 id/title/paths');
    });
    await t('getChapterContext 注入 relevantPaths', async () => {
      fs.mkdirSync(path.join(projectDir, 'outline/chapters'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'outline/chapters/chapter-1.md'), '出场人物：林尘\n场景：突破\n本章涉及金丹雷劫。');
      const ctx = await getChapterContext(project, 1);
      assert(Array.isArray(ctx.relevantPaths), 'relevantPaths 应为数组');
      assert(ctx.relevantPaths.some((p) => p.path === 'knowledge/entities/lin-chen.md'), `应含林尘路径：${JSON.stringify(ctx.relevantPaths)}`);
    });

    await t('getChapterContext.arcContext 抽出当前章对应 arc 段', async () => {
      // 写两份 arc：arc-1 覆盖 1-5，arc-2 覆盖 6-10
      fs.mkdirSync(path.join(projectDir, 'outline/arcs'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'outline/arcs/arc-1-章001-005.md'),
        '# Arc 1：第 1-5 章 · 入门\n\n## 逐章规划\n\n### 第 1 章 · 抵达青云镇\n- 场景：林尘下山\n\n### 第 2 章 · 街市奇遇\n- 场景：遇见王家三公子\n\n### 第 3 章 · 拜入外门\n- 场景：拜师玄机子\n');
      fs.writeFileSync(path.join(projectDir, 'outline/arcs/arc-2-章006-010.md'),
        '# Arc 2：第 6-10 章 · 王家窥玉\n\n## 逐章规划\n\n### 第 6 章 · 王家窥玉\n- 场景：王家家主试探林尘身世\n\n### 第 7 章 · `[机动·待定]`（软位示例）\n- 候选 A：感情线推进\n- 候选 B：势力线推进\n\n### 第 8 章 · 夜探王家\n- 场景：林尘潜入王家');

      // 第 2 章 → 命中 arc-1 的第 2 章节段
      const ctx2 = await getChapterContext(project, 2);
      assert(ctx2.arcContext, `arcContext 应非空：${JSON.stringify(ctx2.arcContext)}`);
      assert(ctx2.arcContext.arcNumber === 1, `arcNumber 应为 1，得 ${ctx2.arcContext.arcNumber}`);
      assert(ctx2.arcContext.arcRange[0] === 1 && ctx2.arcContext.arcRange[1] === 5, `arcRange 应为 [1,5]`);
      assert(/街市奇遇|王家三公子/.test(ctx2.arcContext.chapterSection), `应抽出第 2 章段：${ctx2.arcContext.chapterSection.slice(0,120)}`);
      assert(!/第 3 章|拜入外门/.test(ctx2.arcContext.chapterSection), `不应越界到第 3 章：${ctx2.arcContext.chapterSection}`);
      assert(ctx2.arcContext.isMobile === false, 'arc-1 第 2 章不应被识别为机动章');
    });

    await t('getChapterContext.arcContext 识别机动章标记', async () => {
      const ctx7 = await getChapterContext(project, 7);
      assert(ctx7.arcContext, 'arcContext 应非空');
      assert(ctx7.arcContext.arcNumber === 2, `arcNumber 应为 2，得 ${ctx7.arcContext.arcNumber}`);
      assert(ctx7.arcContext.isMobile === true, `arc-2 第 7 章应被识别为机动章：${ctx7.arcContext.chapterSection.slice(0,120)}`);
      assert(/候选 A|候选 B/.test(ctx7.arcContext.chapterSection), `应包含候选方向：${ctx7.arcContext.chapterSection}`);
    });

    await t('getChapterContext.arcContext 合并 progress/arc-decisions.md 决议', async () => {
      fs.mkdirSync(path.join(projectDir, 'progress'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'progress/arc-decisions.md'),
        '# Arc 决议表\n\n## 第 7 章 · arc-2 机动位\n- **状态**：resolved\n- **已敲定**：B · 势力线推进\n- **场景节拍**：王家试探 → 林尘反查 → 夜探伏笔\n');
      const ctx7 = await getChapterContext(project, 7);
      assert(ctx7.arcContext.decision?.resolved.includes('势力线推进'), `应合并决议：${JSON.stringify(ctx7.arcContext.decision)}`);
      assert(ctx7.arcContext.isMobile === false, 'resolved 决议后不应继续视作待定机动章');
      assert(/机动章决议|势力线推进/.test(ctx7.arcContext.chapterSection), `应把决议写入 chapterSection：${ctx7.arcContext.chapterSection}`);
    });

    await t('getChapterContext.arcContext 章号不在任何 arc 范围 → null', async () => {
      const ctx99 = await getChapterContext(project, 99);
      assert(ctx99.arcContext === null, `章号超出所有 arc 应返 null，实得：${JSON.stringify(ctx99.arcContext)}`);
    });

    await t('P1-3 · getChapterContext 注入 style/voice-dict.md', async () => {
      // 没有 voice-dict.md 时
      const ctxA = await getChapterContext(project, 1);
      assert(ctxA.voiceDictExists === false, `voice-dict 不存在时应 false，实得 ${ctxA.voiceDictExists}`);
      assert(ctxA.voiceDict === '', `voice-dict 不存在时应空串，实得：${JSON.stringify(ctxA.voiceDict)}`);

      // 创建 voice-dict.md
      fs.mkdirSync(path.join(projectDir, 'style'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'style/voice-dict.md'),
        '# 词典\n\n## 高频词\n\n剑 · 刃 · 风 · 雪 · 夜\n\n## 禁用词\n\n心潮澎湃 · 不由得 · 嘴角微微上扬\n');

      const ctxB = await getChapterContext(project, 1);
      assert(ctxB.voiceDictExists === true, `voice-dict 存在时应 true，实得 ${ctxB.voiceDictExists}`);
      assert(/剑.*刃.*风/.test(ctxB.voiceDict), `voiceDict 应含高频词：${ctxB.voiceDict}`);
      assert(/心潮澎湃/.test(ctxB.voiceDict), `voiceDict 应含禁用词：${ctxB.voiceDict}`);
    });

    await t('style/voice-dict.md frontmatter polluted 标记进入上下文元数据', async () => {
      fs.writeFileSync(path.join(projectDir, 'style/voice-dict.md'),
        '---\npolluted: true\nai_hits_per_1k: 4\n---\n\n# 词典\n\n## 高频词\n\n不由得 · 心潮澎湃\n\n## 禁用词\n\n不由得 · 心潮澎湃\n');
      const ctx = await getChapterContext(project, 1);
      assert(ctx.voiceDictMeta?.polluted === true, `应解析 polluted=true：${JSON.stringify(ctx.voiceDictMeta)}`);
      assert(!/^---/.test(ctx.voiceDict), '注入正文不应包含 frontmatter');
    });

    await t('P2-4 · getChapterContext 注入 progress/pre-read.md', async () => {
      // 没有 pre-read.md 时
      const ctxA = await getChapterContext(project, 1);
      assert(ctxA.preReadExists === false, `pre-read 不存在时应 false，实得 ${ctxA.preReadExists}`);
      assert(ctxA.preRead === '', `pre-read 不存在时应空串`);

      // 创建 pre-read.md
      fs.mkdirSync(path.join(projectDir, 'progress'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'progress/pre-read.md'),
        '# 风格预读样本\n\n## 样本 1\n- **来源**：古龙《多情剑客无情剑》第三章\n- **摘要**：短句驱动，物件签名，章末以"刀光"做收束。\n');

      const ctxB = await getChapterContext(project, 1);
      assert(ctxB.preReadExists === true, `pre-read 存在时应 true，实得 ${ctxB.preReadExists}`);
      assert(/古龙|刀光|多情剑客/.test(ctxB.preRead), `preRead 应含样本来源/内容：${ctxB.preRead}`);
    });

    await t('getChapterContext 按章号裁剪 pre-read/log/paths 并返回统计', async () => {
      const earlyCuts = contextCutsForChapter(3);
      const lateCuts = contextCutsForChapter(120);
      assert(earlyCuts.recentLogN === 0 && earlyCuts.skipStateSnapshot === true, `黄金三章应少注入历史负担：${JSON.stringify(earlyCuts)}`);
      assert(lateCuts.skipPreRead === true && lateCuts.recentLogN === 3 && lateCuts.relevantPathsMax === 6, `长篇后段应裁剪预读和 lookup：${JSON.stringify(lateCuts)}`);
      const ctx120 = await getChapterContext(project, 120);
      assert(ctx120.preReadExists === true && ctx120.preRead === '', '第 120 章应知道 pre-read 存在但跳过注入');
      assert(ctx120.contextCuts.skipPreRead === true, 'payload 应包含 contextCuts');
      assert(ctx120.injectionStats.preRead === 0, `preRead 统计应为 0：${JSON.stringify(ctx120.injectionStats)}`);
    });

    await t('appendInjectionStats 写入 progress/injection-stats.jsonl', async () => {
      const ctx = await getChapterContext(project, 1);
      const rel = await appendInjectionStats(project, 1, ctx);
      assert(rel === 'progress/injection-stats.jsonl', `返回路径错误：${rel}`);
      const txt = fs.readFileSync(path.join(projectDir, rel), 'utf8').trim();
      const last = JSON.parse(txt.split(/\r?\n/).at(-1));
      assert(last.chapter === 1 && last.stats?.voiceDict >= 0 && last.cuts, `统计记录不完整：${txt}`);
    });
  });

  await group('conflict service', async () => {
    const project = '__eval_pr1_conflict__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/entities'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'chapters'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'knowledge/entities/lin-chen.md'), `---\nid: lin-chen\nname: 林尘\ntype: character\nstatus: 凡人\n---\n\n# 林尘\n\n当前还是凡人。`);
    fs.writeFileSync(path.join(projectDir, 'chapters/第1章-开端.md'), '林尘还是凡人，他望着山门。');

    await t('conflict_check 发现旧设定出现在既有章节', async () => {
      const r = await conflictCheck(project, { changes: [{ kind: 'entity', slug: 'lin-chen', name: '林尘', field: 'status', op: 'replace', from: '凡人', to: '金丹' }] });
      assert(r.risk === 'high', `应 high，实得 ${r.risk}`);
      assert(r.conflicts.some((c) => c.kind === 'chapter' && c.chapter === 1), `应含章节冲突：${JSON.stringify(r.conflicts)}`);
      assert(r.suggested_action === 'ask_user', 'high 风险应 ask_user');
    });
    await t('conflict_check 低风险补充可 auto_apply', async () => {
      const r = await conflictCheck(project, { changes: [{ kind: 'world', path: 'knowledge/entities/lin-chen.md', op: 'append', text: '新增口头禅' }] });
      assert(r.risk === 'low', `应 low，实得 ${r.risk}`);
      assert(r.suggested_action === 'auto_apply', 'low 风险应 auto_apply');
    });
  });

  await group('tool envelope', () => {
    t('wrapToolResult 老 ok 格式 → status:ok', () => {
      const e = wrapToolResult({ ok: true, relPath: 'a.md' });
      assert(e.status === 'ok', `应为 ok，实得 ${e.status}`);
      assert(isOk(e), 'isOk 应 true');
    });
    t('wrapToolResult 原始对象 → status:ok wraps as data', () => {
      const e = wrapToolResult({ foo: 1 });
      assert(e.status === 'ok' && e.data.foo === 1);
    });
    t('wrapToolResult 已是 envelope 直通', () => {
      const src = { status: 'error', error: { kind: 'x', message: 'y' } };
      const e = wrapToolResult(src);
      assert(e === src, '已是 envelope 应直通');
    });
    t('wrapToolResult pending_user_reply → status:pending', () => {
      const e = wrapToolResult({ pending_user_reply: true, question: 'q' });
      assert(e.status === 'pending', '应 pending');
    });
    t('wrapToolError 有 kind + hint', () => {
      const e = wrapToolError({ err: new Error('boom'), kindHint: 'bad_args', hintText: 'fix me', attempt: 1, maxRepeat: 2 });
      assert(e.status === 'error' && e.error.kind === 'bad_args' && e.error.hint === 'fix me');
    });
    t('wrapToolBlocked 给出阻断结构', () => {
      const e = wrapToolBlocked({ tool: 'x', attempts: 2, maxRepeat: 2 });
      assert(e.status === 'blocked' && e.error.kind === 'retry_blocked');
    });
  });

  await group('skill runtime guards', async () => {
    await t('buildSkillRuntime 汇总 must/forbid/chains', async () => {
      const rt = await buildSkillRuntime({ selectedSkills: ['chinese-novelist', 'chapter-planner'] });
      assert(rt.skillNames.includes('chinese-novelist'), 'runtime 应包含 chinese-novelist');
      assert(rt.mustCallTools.includes('write_chapter'), 'runtime 应汇总 write_chapter');
      assert(rt.mustCallTools.includes('setup_status'), 'runtime 应汇总 setup_status');
      assert(rt.mustCallTools.includes('lookup_query'), 'runtime 应汇总 lookup_query');
      assert(rt.chainsTo.includes('wiki-ingest'), 'runtime 应汇总 chainsTo wiki-ingest');
      assert(summarizeSkillRuntime(rt).includes('skills='), 'summary 应包含 skills');
    });
    await t('write_chapter 前缺 must_call_tools 会被 skill runtime 拦截', async () => {
      const rt = await buildSkillRuntime({ selectedSkills: ['chinese-novelist'] });
      const state = createRuntimeToolState();
      const ctx = {
        skillRuntime: rt,
        toolState: {
          chapterContext: new Set([1]),
          wikiQuery: true,
          lookupQuery: false,
          skillRuntime: state,
        },
      };
      const block = checkSkillToolGate({ name: 'write_chapter', args: { chapter: 1 }, ctx });
      assert(block?.blocked, '缺 lookup_query/read_file 应被拦');
      assert(block.kind === 'skill_must_call_tools', `kind 应为 skill_must_call_tools，实得 ${block?.kind}`);
    });
    await t('补齐 lookup_query/read_file 后 write_chapter 通过 skill runtime', async () => {
      const rt = await buildSkillRuntime({ selectedSkills: ['chinese-novelist'] });
      const state = createRuntimeToolState();
      noteRuntimeToolSuccess('setup_status', {}, {}, state);
      noteRuntimeToolSuccess('lookup_query', {}, {}, state);
      noteRuntimeToolSuccess('read_file', { path: 'outline/overall.md' }, {}, state);
      const ctx = {
        skillRuntime: rt,
        toolState: {
          chapterContext: new Set([1]),
          wikiQuery: true,
          lookupQuery: true,
          skillRuntime: state,
        },
      };
      const block = checkSkillToolGate({ name: 'write_chapter', args: { chapter: 1 }, ctx });
      assert(!block, `must_call_tools 补齐后不应拦截，实得 ${JSON.stringify(block)}`);
    });
    await t('setup skill forbid_tools 阻止 write_chapter', async () => {
      const rt = await buildSkillRuntime({ selectedSkills: ['setup-pipeline'] });
      const ctx = { skillRuntime: rt, toolState: { skillRuntime: createRuntimeToolState() } };
      const block = checkSkillToolGate({ name: 'write_chapter', args: { chapter: 1 }, ctx });
      assert(block?.kind === 'skill_forbid_tool', `setup-pipeline 应禁止 write_chapter，实得 ${JSON.stringify(block)}`);
    });
    await t('setting-supplement 修改设定前要求 conflict_check', async () => {
      const rt = await buildSkillRuntime({ selectedSkills: ['setting-supplement'] });
      const ctx = { skillRuntime: rt, toolState: { skillRuntime: createRuntimeToolState() } };
      const block = checkSkillToolGate({ name: 'update_progress', args: { path: 'knowledge/world/rules.md' }, ctx });
      assert(block?.kind === 'skill_conflict_check_required', `修改 world 前应要求 conflict_check，实得 ${JSON.stringify(block)}`);
    });
  });

  await group('P1 consistency-scan 启发式', async () => {
    const project = '__eval_consistency_scan__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/entities'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'chapters'), { recursive: true });

    // POV 声明：第三人称限知
    fs.writeFileSync(path.join(projectDir, 'SOUL.md'), '# SOUL\n\nPOV：第三人称限知，主角林尘视角。\n');
    // entities：林尘 + 苏沐儿，含 aliases
    fs.writeFileSync(
      path.join(projectDir, 'knowledge/entities/lin-chen.md'),
      '---\nid: lin-chen\nname: 林尘\ntype: character\naliases: [林师弟, 林哥, 阿尘]\n---\n# 林尘\n',
    );
    fs.writeFileSync(
      path.join(projectDir, 'knowledge/entities/su-muer.md'),
      '---\nid: su-muer\nname: 苏沐儿\ntype: character\naliases: [沐儿, 苏师姐]\n---\n# 苏沐儿\n',
    );

    await t('POV 漂移：限知作品里出现作者按式旁白 → warning', async () => {
      const body = '林尘望着远山，心头烦躁。\n\n读者朋友，这一桩往事且按下不表，且说另一边。';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'pov' && i.level === 'warning'), `POV 检测应报 warning：${JSON.stringify(r.issues)}`);
    });

    await t('称呼漂移：同段内出现林尘 / 林师弟 / 林哥 → info', async () => {
      const body = '林尘走入大殿。\n\n林尘抬头一看，林师弟啊林师弟，林哥这就教你——他喃喃自语。';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      const has = r.issues.find((i) => i.kind === 'character' && /多种称呼/.test(i.title));
      assert(has, `称呼漂移应被检测：${JSON.stringify(r.issues)}`);
    });

    await t('时间词跳变：清晨 → 深夜 短窗口内 → warning', async () => {
      const body = '林尘在清晨醒来，揉了揉眼，转头看向窗外的深夜星空。';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'timeline'), `时间词跳变应被检测：${JSON.stringify(r.issues)}`);
    });

    await t('未知人名：陌生姓氏 + 说道 → info', async () => {
      const body = '林尘走进大殿。\n\n钱不智说道："你来了。"\n\n苏沐儿点头笑道："是。"';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'character' && /未建档/.test(i.title) && /钱不智/.test(i.title)), `未知人名应被检测：${JSON.stringify(r.issues)}`);
      // 苏沐儿在 entities 中，不应被报
      assert(!r.issues.some((i) => /苏沐儿/.test(i.title)), '已建档人物不应被报：苏沐儿');
    });

    await t('AI 味·高频词命中：瞳孔骤缩 + 脸色一变 + 心头一震 → ai_taste warning', async () => {
      const filler = '林尘走入大殿，殿内空旷，柱影斜斜。他低头整理袖口，又抬头看了看梁上的纹饰。'.repeat(8);
      const body = filler + '\n\n瞳孔骤缩，脸色一变。\n\n他心头一震，握紧拳头，眼神坚定。\n\n这一段铺垫到这里。';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'ai_taste' && /AI 高频词命中/.test(i.title)), `应报 AI 高频词命中：${JSON.stringify(r.issues)}`);
    });

    await t('AI 味·破折号密度过高：每千字 > 2 → ai_taste 命中', async () => {
      const para = '他走过去——停在门口——又退了半步。然后看了看天——天是阴的。';
      // 重复 8 次到 ~240 字以越过最小章节门槛
      const body = Array(8).fill(para).join('\n\n');
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'ai_taste' && /破折号密度/.test(i.title)), `应报破折号密度：${JSON.stringify(r.issues)}`);
    });

    await t('AI 味·章末模板：「月光下，他选了——」→ ai_taste warning', async () => {
      // 250+ 字铺垫，章末用禁用模板
      const filler = '林尘看着远处的火光，心里盘算着接下来该怎么走，可天色越来越晚。'.repeat(10);
      const body = filler + '\n\n月光下，他选了——';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      const tailHit = r.issues.find((i) => i.kind === 'ai_taste' && /章末.*禁用模板/.test(i.title));
      const openEnd = r.issues.find((i) => i.kind === 'ai_taste' && /开放式收尾/.test(i.title));
      assert(tailHit || openEnd, `应报章末模板或开放收尾：${JSON.stringify(r.issues)}`);
    });

    await t('节奏·对白比例偏低（< 25%）→ rhythm info/warning', async () => {
      // 一长段纯叙述，对白只有一句很短的
      const narrate = '林尘走入大殿，殿内空旷，柱影斜斜。他低头整理袖口，又抬头看了看梁上的纹饰，心里盘算着接下来该怎么走。'.repeat(8);
      const body = narrate + '\n\n他说："嗯。"\n\n' + narrate;
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'rhythm' && /对白比例偏低/.test(i.title)), `应报对白比例偏低：${JSON.stringify(r.issues.map((i) => i.title))}`);
    });

    await t('节奏·对白比例偏高（> 65%）→ rhythm info/warning', async () => {
      // 大量对白连成段，仅极少叙述
      const dialogue = '"你说。"\n"我不说。"\n"为什么？"\n"因为时机未到。"\n"那你想我怎么办？"\n"等。"\n';
      const body = (dialogue.repeat(20)) + '他点头。';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'rhythm' && /对白比例偏高/.test(i.title)), `应报对白比例偏高：${JSON.stringify(r.issues.map((i) => i.title))}`);
    });

    await t('节奏·句长单调（所有句子都 15 字左右）→ rhythm warning', async () => {
      // 故意造 12 个长度都在 14-17 字的中句，标准差很低
      const sentences = [
        '林尘走进大殿环顾四周内心思绪万千',
        '他低头看了看手中那枚陈旧玉佩',
        '殿内灯光昏暗映出他略显疲惫的脸',
        '门外传来脚步声打破了短暂的宁静',
        '他抬头望去看见来人正是师叔玄机',
        '玄机子手持拂尘缓步走入大殿之中',
        '两人对视片刻气氛瞬间变得凝重',
        '林尘心中浮起诸多疑问却没有出声',
        '玄机子率先开口语气依旧温和如常',
        '林尘只是默默点头算是回应了师叔',
        '殿外风声渐起卷起殿前的落叶残花',
        '他知道事情远未结束此刻只是序幕',
      ];
      const oneRound = sentences.join('。') + '。';
      const body = (oneRound + '\n\n').repeat(3); // 36 句 ~576 字
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      assert(r.issues.some((i) => i.kind === 'rhythm' && /句式单调|句式节奏偏单调/.test(i.title)), `应报句式单调：${JSON.stringify(r.issues.map((i) => i.title))}`);
    });

    await t('节奏·健康章节（对白 35% + 句长长短交替）→ 无 rhythm issue', async () => {
      // 长短句交替 + 适当对白
      const para1 = '林尘推开门。\n\n殿内静极了，柱影斜斜落在青砖上，远处隐约传来风声。他低头，整理了一下袖口，又抬头打量梁上的纹饰，心里在盘算接下来怎么办。\n\n"你来了。"\n\n声音从暗处传出。\n\n林尘没动。他听出来了，是玄机子。';
      const para2 = '"嗯。"林尘走近两步。\n\n殿中烛火忽然摇晃，照得两人影子在墙上拉得很长。玄机子手里那把拂尘轻轻一扫，落叶被卷起又散开。\n\n"坐。"\n\n林尘坐下。他知道接下来会有话要说。';
      const body = para1 + '\n\n' + para2 + '\n\n' + para1; // 复制一份保证 ≥ 500 字
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      // 不应出现 rhythm 类 issue
      const rhythmIssues = r.issues.filter((i) => i.kind === 'rhythm');
      assert(rhythmIssues.length === 0, `健康章节不应出 rhythm issue：${JSON.stringify(rhythmIssues.map((i) => i.title))}`);
    });

    await t('AI 味·对白内的"——"不应被算入破折号密度', async () => {
      // 对白内 3 个 "——"，叙述层无破折号；用 ASCII 双引号触发 stripQuotes
      const seg = '林尘问："——你来了？——为什么这么晚？——你说话啊。"\n\n他没回答，只是站在那里。\n\n';
      const body = seg.repeat(15);
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, persist: false });
      // 不应触发破折号密度（对白被剔除）
      assert(!r.issues.some((i) => i.kind === 'ai_taste' && /破折号密度/.test(i.title)),
        `对白内破折号不应触发密度告警：${JSON.stringify(r.issues)}`);
    });

    await t('干净章节：无问题 + 落盘报告', async () => {
      const body = '林尘走进大殿。\n\n苏沐儿点头笑道："你来了。"\n\n他望着她，没说话。';
      const r = await scanChapterConsistency({ projectName: project, chapter: 1, content: body, chapterTitle: '试章', persist: true });
      assert(r.relPath && /reviews\/consistency\//.test(r.relPath), `应落盘报告：${JSON.stringify(r)}`);
      const md = fs.readFileSync(path.join(projectDir, r.relPath), 'utf8');
      assert(/POV 一致|无未知人名|时间词无跨度跳变/.test(md), `报告应包含 passed_checks：${md.slice(0, 400)}`);
      // 干净章节也应通过 ai_taste 检查
      assert(!r.issues.some((i) => i.kind === 'ai_taste'),
        `干净章节不应出 ai_taste issue：${JSON.stringify(r.issues)}`);
    });

    await t('consistency_scan 工具已注册且 schema 正确', () => {
      const tool = TOOLS.find((x) => x.function.name === 'consistency_scan');
      assert(tool, 'consistency_scan 工具应存在');
      assert(tool.function.parameters.required.includes('chapter'), 'chapter 应为 required');
    });
  });

  await group('P2 伏笔 due_chapter + 卷纲节点', async () => {
    const project = '__eval_p2_foreshadow_due__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/entities'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'outline/volumes'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'SOUL.md'), '# 测试');
    fs.writeFileSync(
      path.join(projectDir, 'knowledge/entities/lin-chen.md'),
      '---\nid: lin-chen\nname: 林尘\ntype: character\n---\n# 林尘',
    );

    await t('wiki_ingest schema foreshadow_open[].due_chapter 已声明', () => {
      const tool = TOOLS.find((x) => x.function.name === 'wiki_ingest');
      const fo = tool.function.parameters.properties.foreshadow_open;
      assert(fo?.items?.properties?.due_chapter, 'foreshadow_open 应支持 due_chapter');
    });

    await t('applyIngest 透传 due_chapter 到实体 frontmatter', async () => {
      await applyIngest(project, {
        chapter: 5,
        foreshadow_open: [
          { on_slug: 'lin-chen', tag: '神秘玉佩', set_chapter: 5, due_chapter: 12 },
          { on_slug: 'lin-chen', tag: '父亲遗言', set_chapter: 5 },
        ],
      });
      const md = fs.readFileSync(path.join(projectDir, 'knowledge/entities/lin-chen.md'), 'utf8');
      assert(/due_chapter:\s*12/.test(md), `due_chapter 应写入 frontmatter：${md.slice(0, 600)}`);
      const opens = await listOpenForeshadows(project);
      assert(opens.find((x) => x.tag === '神秘玉佩')?.due_chapter === 12, 'listOpenForeshadows 应返回 due_chapter');
      assert(opens.find((x) => x.tag === '父亲遗言')?.due_chapter == null, '没声明 due 的应为 null');
    });

    await t('rebuildForeshadowLedger 在第 13 章后把 due=12 标为 overdue', async () => {
      const r = await rebuildForeshadowLedger(project, 13);
      assert(r.overdue === 1, `应有 1 条 overdue，实得 ${JSON.stringify(r)}`);
      const ledger = fs.readFileSync(path.join(projectDir, 'knowledge/foreshadow.md'), 'utf8');
      assert(/已逾期 due_chapter/.test(ledger), '总账应含"已逾期"段落');
      assert(/神秘玉佩.*\|\s*5\s*\|\s*12/.test(ledger), `总账应在 overdue 行显示 set/due：${ledger.slice(0, 800)}`);
      const alerts = fs.readFileSync(path.join(projectDir, 'progress/foreshadow-alerts.md'), 'utf8');
      assert(/已逾期/.test(alerts) && /神秘玉佩/.test(alerts), `预警应含 overdue：${alerts}`);
    });

    await t('rebuildForeshadowLedger 在第 12 章把 due=12 标为 due_now', async () => {
      const r = await rebuildForeshadowLedger(project, 12);
      assert(r.dueNow === 1 && r.overdue === 0, `应有 1 条 due_now：${JSON.stringify(r)}`);
    });

    await t('rebuildForeshadowLedger 在第 10 章把 due=12 标为 due_soon（剩 2 章）', async () => {
      const r = await rebuildForeshadowLedger(project, 10);
      assert(r.dueSoon === 1, `应有 1 条 due_soon：${JSON.stringify(r)}`);
    });

    await t('P0-4 · open >= 5, closed = 0, ch >= 20 → 触发 ratio 预警', async () => {
      // 给 lin-chen 加更多 open 伏笔达到 5+
      await applyIngest(project, {
        chapter: 8,
        foreshadow_open: [
          { on_slug: 'lin-chen', tag: '雷劫预兆', set_chapter: 8 },
          { on_slug: 'lin-chen', tag: '玄机子的过往', set_chapter: 8 },
          { on_slug: 'lin-chen', tag: '王家纹章', set_chapter: 8 },
          { on_slug: 'lin-chen', tag: '化神之上', set_chapter: 8 },
        ],
      });
      // 第 25 章重建：open=6, closed=0
      const r = await rebuildForeshadowLedger(project, 25);
      assert(r.open >= 5 && r.closed === 0, `fixture 应 open>=5 closed=0：${JSON.stringify(r)}`);
      assert(r.ratioAlert === true, `应触发 ratioAlert：${JSON.stringify(r)}`);
      const alerts = fs.readFileSync(path.join(projectDir, 'progress/foreshadow-alerts.md'), 'utf8');
      assert(/承诺-兑现失衡/.test(alerts) && /从未回收过/.test(alerts), `alerts 应含承诺-兑现失衡：${alerts.slice(0, 600)}`);
    });

    await t('P0-4 · open:closed > 5:1 触发 ratio 预警', async () => {
      // 闭合 1 条让 open=5 closed=1 ratio=5（不触发）
      await applyIngest(project, {
        chapter: 26,
        foreshadow_closed: [{ on_slug: 'lin-chen', tag: '父亲遗言' }],
      });
      const r1 = await rebuildForeshadowLedger(project, 26);
      assert(r1.closed === 1, `closed 应为 1：${JSON.stringify(r1)}`);
      // open=5, closed=1, ratio=5：未超 5:1 阈值（用 > 5），不应触发
      assert(r1.ratioAlert === false, `5:1 临界不应触发：${JSON.stringify(r1)}`);

      // 再开 2 条，让 open=7, closed=1, ratio=7（触发）
      await applyIngest(project, {
        chapter: 27,
        foreshadow_open: [
          { on_slug: 'lin-chen', tag: '远古神器', set_chapter: 27 },
          { on_slug: 'lin-chen', tag: '宗门叛徒', set_chapter: 27 },
        ],
      });
      const r2 = await rebuildForeshadowLedger(project, 27);
      assert(r2.open === 7 && r2.closed === 1, `应 open=7 closed=1：${JSON.stringify(r2)}`);
      assert(r2.ratioAlert === true, `7:1 应触发 ratio 预警：${JSON.stringify(r2)}`);
      const ledger = fs.readFileSync(path.join(projectDir, 'knowledge/foreshadow.md'), 'utf8');
      assert(/承诺-兑现比例/.test(ledger), `总账应含 ratio 段：${ledger.slice(-400)}`);
      assert(/⚠️|7\.0:1/.test(ledger), `总账应标注 ratio 警告：${ledger.slice(-400)}`);
    });

    await t('P0-4 · 健康章节（open=2, closed=0）不触发 ratio 预警', async () => {
      // 用独立 project 隔离，避免被前面 fixture 污染
      const proj2 = '__eval_p0_ratio_healthy__';
      const dir2 = path.join(ROOT, 'novels', proj2);
      fs.rmSync(dir2, { recursive: true, force: true });
      fs.mkdirSync(path.join(dir2, 'knowledge/entities'), { recursive: true });
      fs.writeFileSync(path.join(dir2, 'SOUL.md'), '# 测试');
      fs.writeFileSync(path.join(dir2, 'knowledge/entities/lin-chen.md'), '---\nid: lin-chen\nname: 林尘\ntype: character\n---\n');
      await applyIngest(proj2, {
        chapter: 5,
        foreshadow_open: [
          { on_slug: 'lin-chen', tag: 'A', set_chapter: 5 },
          { on_slug: 'lin-chen', tag: 'B', set_chapter: 5 },
        ],
      });
      const r = await rebuildForeshadowLedger(proj2, 25);
      assert(r.open === 2 && r.closed === 0, `应 open=2 closed=0：${JSON.stringify(r)}`);
      assert(r.ratioAlert === false, `open<5 不应触发 ratio 预警：${JSON.stringify(r)}`);
    });

    await t('listVolumeNodes 解析 chapter_nodes', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'outline/volumes/volume-1.md'),
        `---\nvolume: 1\nchapter_nodes:\n  - { chapter: 10, milestone: '首次突破' }\n  - { chapter: 20, milestone: '势力初成' }\n  - { chapter: 40, milestone: '本卷高潮' }\n---\n# 第一卷\n`,
      );
      const groups = await listVolumeNodes(project);
      assert(groups.length === 1 && groups[0].volume === 1, `应解析 1 卷：${JSON.stringify(groups)}`);
      assert(groups[0].nodes.length === 3, `应有 3 节点：${JSON.stringify(groups[0])}`);
      assert(groups[0].nodes[0].chapter === 10 && groups[0].nodes[0].milestone === '首次突破');
    });

    await t('buildVolumeMilestonesMd 命中本节点 + 下节点倒计时', async () => {
      // 第 18 章：上节点=10、本节点=null、下节点=20（剩 2 章）
      const md = await buildVolumeMilestonesMd(project, 18);
      assert(md, 'milestone md 不应为空');
      assert(/下节点.*第 20 章/.test(md) && /剩 2 章/.test(md), `应输出下节点倒计时：${md}`);
      assert(/势力初成/.test(md), `应包含 milestone 文本：${md}`);
    });

    await t('buildVolumeMilestonesMd 命中本节点', async () => {
      const md = await buildVolumeMilestonesMd(project, 20);
      assert(md && /本章应达成节点/.test(md) && /势力初成/.test(md), `应高亮本章节点：${md}`);
    });

    await t('buildVolumeMilestonesMd 没节点附近时返回 null', async () => {
      // 第 1 章：上无 / 下=10（剩 9 章 > 5）→ 仅普通文本，仍应有内容
      const md1 = await buildVolumeMilestonesMd(project, 1);
      assert(md1 && /第 10 章/.test(md1), `应有下节点提示：${md1}`);
      // 第 100 章：远超所有节点
      const md2 = await buildVolumeMilestonesMd(project, 100);
      // 上节点 chapter=40 距离 60 章 > 3 → 不进 past；本/下都没 → 应返回 null
      assert(md2 == null, `远超节点应返回 null：${md2}`);
    });
  });

  await group('P3 偏好累积成铁律', async () => {
    const project = '__eval_p3_preference__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, 'style'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'SOUL.md'), '# 测试');

    await t('parseFeedbackEntries 解析时间 / 章号 / kind / 正文', () => {
      const md = `# 用户反馈闭环

## 2026-05-01T10:00:00Z · 第 5 章

- 类型：AI味
- 文件：chapters/chapter-005.md

破折号太多了，能不能换成句号？读着很顿。

## 2026-05-02T11:00:00Z · 第 6 章

- 类型：custom

形容词堆砌严重，"凌厉的目光闪烁着寒光" 这种删了。
`;
      const entries = parseFeedbackEntries(md);
      assert(entries.length === 2, `应解析 2 条：${entries.length}`);
      assert(entries[0].chapter === 5 && entries[0].kind === 'AI味');
      assert(/破折号太多/.test(entries[0].text));
      assert(entries[1].chapter === 6);
    });

    await t('clusterFeedback 按关键词聚类，返回 count + lastSeen', () => {
      const entries = [
        { chapter: 1, kind: 'AI味', text: '破折号太多', ts: new Date('2026-01-01') },
        { chapter: 2, kind: 'custom', text: '又用了破折号——能不能改', ts: new Date('2026-01-02') },
        { chapter: 3, kind: 'custom', text: '内心独白太长，主角自己解释自己', ts: new Date('2026-01-03') },
      ];
      const c = clusterFeedback(entries);
      const dash = c.find((x) => x.id === 'no-em-dash');
      assert(dash && dash.count === 2, `破折号应命中 2 次：${JSON.stringify(c)}`);
      const inner = c.find((x) => x.id === 'less-inner-monologue');
      assert(inner && inner.count === 1, `内心独白应命中 1 次：${JSON.stringify(c)}`);
      assert(dash.lastSeen instanceof Date && dash.lastSeen.getTime() === new Date('2026-01-02').getTime());
    });

    await t('learnPreferences 在阈值 3 下：3 次破折号反馈被升格', async () => {
      // 写 3 条同类反馈到 feedback.md
      for (let i = 0; i < 3; i++) {
        await appendFeedback(project, { chapter: i + 1, kind: 'AI味', feedback: '破折号太多了，请减少' });
      }
      const r = await learnPreferences(project);
      assert(r.totalEntries === 3, `应有 3 条反馈：${r.totalEntries}`);
      assert(r.promoted.length >= 1 && r.promoted.some((p) => p.id === 'no-em-dash'),
        `破折号应被升格：${JSON.stringify(r.promoted.map((p) => p.id))}`);
      const md = fs.readFileSync(path.join(projectDir, 'style/auto-rules.md'), 'utf8');
      assert(/已升格铁律/.test(md) && /破折号/.test(md), `auto-rules.md 应含铁律：${md.slice(0, 400)}`);
    });

    await t('learnPreferences 候选未升格也要在文件里列出', async () => {
      // 单次 "形容词" 反馈：未到阈值 3，应进入候选区
      await appendFeedback(project, { chapter: 4, kind: 'custom', feedback: '形容词太多堆砌了' });
      const r = await learnPreferences(project, { threshold: 3 });
      assert(r.candidates.length >= 1, '应有候选');
      const md = fs.readFileSync(path.join(projectDir, 'style/auto-rules.md'), 'utf8');
      assert(/候选/.test(md), `应含候选区：${md.slice(0, 600)}`);
    });

    await t('buildLearnedRulesMd 只产出已升格规则（≤ 1KB）', async () => {
      const md = await buildLearnedRulesMd(project);
      assert(md && /禁用破折号过度/.test(md), `应抽取"禁用破折号"铁律：${md}`);
      assert(!/形容词/.test(md), `候选规则不应进入 prompt 注入：${md}`);
      assert(md.length <= 1024, `prompt 注入应 ≤ 1KB：${md.length}`);
    });

    await t('learnPreferences 阈值变化：threshold=2 时形容词晋升', async () => {
      // 加第 2 条形容词反馈
      await appendFeedback(project, { chapter: 5, kind: 'custom', feedback: '形容词堆砌问题还是没改' });
      const r = await learnPreferences(project, { threshold: 2 });
      assert(r.promoted.some((p) => p.id === 'avoid-purple-prose'),
        `threshold=2 时形容词应升格：${JSON.stringify(r.promoted.map((p) => p.id))}`);
    });

    await t('write_chapter 强制时升 writer profile（agent 内部逻辑断言）', () => {
      // 通过源码检查关键分支存在
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/writerNeeded\s*=.*forceNextTool === 'write_chapter'.*\|\|.*requiredWrite\?.tool === 'write_chapter'/s.test(agentSrc),
        'activeProfile 应在 force/required write_chapter 时升 writer');
      assert(/profile_upgrade/.test(agentSrc), '应 emit profile_upgrade 事件');
    });
  });

  await group('setup manifest', async () => {
    const project = '__eval_pr2_setup_manifest__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/world'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/entities'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'outline/volumes'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'outline/arcs'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'SOUL.md'), '# 测试作品');

    await t('manifest 声明 8 个阶段且世界观必备 6 文件，stage 4 为地点与物品档案', async () => {
      assert(SETUP_MANIFEST.length === 8, `manifest 阶段数应为 8，实得 ${SETUP_MANIFEST.length}`);
      const world = SETUP_MANIFEST.find((x) => x.stage === 2);
      assert(world.required.length === 6, `世界观阶段应有 6 个必备文件，实得 ${world.required.length}`);
      const places = SETUP_MANIFEST.find((x) => x.stage === 4);
      assert(places && places.label === '地点与物品档案', `stage 4 应为地点与物品档案，实得 ${JSON.stringify(places)}`);
      assert(places.required.some((r) => r.path === 'knowledge/locations'), `stage 4 应要求 knowledge/locations`);
      assert(places.required.some((r) => r.path === 'knowledge/items'), `stage 4 应要求 knowledge/items`);
    });
    await t('只有 SOUL + 部分 world 文件时仍停在 stage=1', async () => {
      fs.writeFileSync(path.join(projectDir, 'knowledge/world/overview.md'), '# 概览');
      const s = await checkSetupManifest(project);
      assert(s.stage === 1, `world 不完整应停在 stage=1，实得 ${s.stage}`);
      assert(s.missing.includes('knowledge/world/power-system.md'), `应提示缺 power-system：${JSON.stringify(s.missing)}`);
    });
    await t('补齐 world 后进入 stage=2，但缺 relationships/lookup 不进 stage=3', async () => {
      for (const f of ['power-system.md', 'factions.md', 'geography.md', 'history.md', 'rules.md']) {
        fs.writeFileSync(path.join(projectDir, 'knowledge/world', f), `# ${f}`);
      }
      fs.writeFileSync(path.join(projectDir, 'knowledge/entities/lin-chen.md'), '# 林尘');
      const s = await checkSetupManifest(project);
      assert(s.stage === 2, `缺 relationships/lookup 应停在 stage=2，实得 ${s.stage}`);
      assert(s.missing.includes('knowledge/relationships.md'), `应提示缺 relationships：${JSON.stringify(s.missing)}`);
      assert(s.missing.includes('knowledge/lookup.json'), `应提示缺 lookup.json：${JSON.stringify(s.missing)}`);
    });
    await t('补齐 relationships/lookup/locations/items/outline/volume/arc 后进入 stage=7（arc 细纲完成）', async () => {
      fs.writeFileSync(path.join(projectDir, 'knowledge/relationships.md'), '# 关系');
      fs.writeFileSync(path.join(projectDir, 'knowledge/lookup.json'), JSON.stringify({ version: 1, topics: [] }));
      // 新 stage 4 · 地点与物品档案
      fs.mkdirSync(path.join(projectDir, 'knowledge/locations'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'knowledge/locations/loc-a.md'), '# A');
      fs.writeFileSync(path.join(projectDir, 'knowledge/locations/loc-b.md'), '# B');
      fs.writeFileSync(path.join(projectDir, 'knowledge/locations/loc-c.md'), '# C');
      fs.mkdirSync(path.join(projectDir, 'knowledge/items'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'knowledge/items/item-a.md'), '# A');
      fs.mkdirSync(path.join(projectDir, 'outline'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'outline/volumes'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, 'outline/arcs'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'outline/overall.md'), '# 总纲');
      fs.writeFileSync(path.join(projectDir, 'outline/volumes/volume-1.md'), '# 第一卷');
      fs.writeFileSync(path.join(projectDir, 'outline/arcs/arc-1-章001-005.md'), '# arc');
      const s = await checkSetupManifest(project);
      assert(s.stage === 7, `补齐开写前资产应到 stage=7，实得 ${s.stage}`);
      assert(s.nextStage?.skill === 'chinese-novelist', `下一阶段应为 chinese-novelist，实得 ${JSON.stringify(s.nextStage)}`);
    });
  });

  await group('PR3-5 setup repair + hard gate', async () => {
    const project = '__eval_pr3_setup_repair__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'SOUL.md'), '# 测试作品');

    await t('setup_repair 为 stage<7 生成补齐计划', async () => {
      const plan = await buildSetupRepairPlan(project, { targetStage: 7 });
      assert(!plan.complete, '只有 SOUL 时 repair plan 不应 complete');
      assert(plan.tasks.length >= 10, `应生成多个补齐任务，实得 ${plan.tasks.length}`);
      assert(plan.missing.some((x) => x.path === 'knowledge/world/overview.md' && x.tool === 'update_progress'), '应计划补 world overview');
      assert(plan.missing.some((x) => x.path === 'outline/arcs/*.md' && x.canStub), '应允许 arc 目录生成安全 stub');
      assert(plan.missing.some((x) => x.path === 'knowledge/locations/*.md' && x.canStub), '应允许 locations 目录生成安全 stub');
      assert(plan.missing.some((x) => x.path === 'knowledge/items/*.md' && x.canStub), '应允许 items 目录生成安全 stub');
    });
    await t('setup_repair createStubs 可补齐开写前可 stub 资产（含地点 3 + 物品 1）', async () => {
      const r = await createSetupStubs(project, { targetStage: 7 });
      assert(r.created.some((x) => x.path === 'knowledge/world/overview.md'), `应创建 world overview：${JSON.stringify(r.created)}`);
      assert(r.created.some((x) => x.path === 'outline/arcs/arc-1-章001-005.md'), `应创建 arc stub：${JSON.stringify(r.created)}`);
      const locStubs = r.created.filter((x) => /^knowledge\/locations\//.test(x.path));
      assert(locStubs.length >= 3, `应创建至少 3 个 locations stub：${JSON.stringify(locStubs)}`);
      assert(r.created.some((x) => /^knowledge\/items\//.test(x.path)), `应创建至少 1 个 items stub：${JSON.stringify(r.created)}`);
      const s = await checkSetupManifest(project);
      assert(s.stage === 2, `因缺 entities/*.md，stub 后应停在 stage=2，实得 ${s.stage}`);
      assert(s.missing.includes('knowledge/entities/*.md'), `应继续提示缺 entities：${JSON.stringify(s.missing)}`);
    });
    await t('PR3 端到端：补齐 entity 后 setup manifest 到 stage=7', async () => {
      fs.mkdirSync(path.join(projectDir, 'knowledge/entities'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'knowledge/entities/lin-chen.md'), '# 林尘');
      const s = await checkSetupManifest(project);
      assert(s.stage === 7, `补齐 entity 后应到 stage=7（stub 已补齐 locations/items/outline/volume/arc），实得 ${s.stage}，缺 ${JSON.stringify(s.missing)}`);
    });
    await t('PR5 写章前 setup<7 硬阻断，明确跳过才放行到后续 gate', async () => {
      const incomplete = { stage: 2, missing: ['knowledge/entities/*.md'], missingRequired: ['knowledge/entities/*.md'] };
      const blocked = checkSetupWriteGate({ toolName: 'write_chapter', setupStage: incomplete, userMessage: '写第 1 章' });
      assert(blocked?.kind === 'setup_incomplete_before_write', `应被 setup gate 阻断：${JSON.stringify(blocked)}`);
      const skipped = checkSetupWriteGate({ toolName: 'write_chapter', setupStage: incomplete, userMessage: '确认跳过设定完整性，风险我接受，直接写第 1 章' });
      assert(!skipped, `明确跳过后 setup gate 应放行：${JSON.stringify(skipped)}`);
      const complete = checkSetupWriteGate({ toolName: 'write_chapter', setupStage: { stage: 7, missing: [] }, userMessage: '写第 1 章' });
      assert(!complete, `stage=7 应放行：${JSON.stringify(complete)}`);
    });
    await t('PR7 跳过判定正反例', async () => {
      for (const s of ['确认跳过设定完整性，风险我接受', '不补设定先写', '跳过立项检查直接写', '我先写一段先别管 setup', '风险我接受直接开写']) {
        assert(hasExplicitSkipConsent(s), `应识别跳过：${s}`);
      }
      for (const s of ['先别写', '不要写第 1 章', '还没补完所以不写', '不写，先补设定']) {
        assert(!hasExplicitSkipConsent(s), `不应识别跳过：${s}`);
      }
    });
    await t('PR9 write_outline 分阶段 gate', async () => {
      const s0 = { stage: 0, missingRequired: ['SOUL.md'] };
      const s2 = { stage: 2, missingRequired: ['knowledge/entities/*.md'] };
      const s5 = { stage: 5, missingRequired: ['outline/volumes/volume-1.md'] };
      assert(checkSetupStageGate({ toolName: 'write_outline', args: { path: 'outline/overall.md' }, setupStage: s0 })?.kind === 'setup_incomplete_before_outline', 'stage0 应阻断 overall');
      assert(!checkSetupStageGate({ toolName: 'write_outline', args: { path: 'outline/overall.md' }, setupStage: { stage: 1 } }), 'stage1 应允许 overall');
      // 新 manifest：卷纲要求 stage>=4（地点物品完成）
      assert(checkSetupStageGate({ toolName: 'write_outline', args: { path: 'outline/volumes/volume-1.md' }, setupStage: s2 })?.context?.requiredStage === 4, '卷纲应要求 stage4（地点物品完成）');
      // arc 要求 stage>=6（卷纲完成）
      assert(checkSetupStageGate({ toolName: 'write_outline', args: { path: 'outline/arcs/arc-1.md' }, setupStage: s5 })?.context?.requiredStage === 6, 'arc 应要求 stage6（卷纲完成）');
      assert(!checkSetupStageGate({ toolName: 'write_outline', args: { path: 'outline/arcs/arc-1.md' }, setupStage: { stage: 6 } }), 'stage6 应允许 arc');
    });
    await t('PR10 stub 残留检测', async () => {
      const r = await checkStubResidue(project);
      assert(r.ok, `stub residue 应 ok：${JSON.stringify(r)}`);
      assert(r.stubs.some((x) => x.path === 'knowledge/world/overview.md'), `应检测 world stub：${JSON.stringify(r.stubs)}`);
      assert(r.stubs.some((x) => x.path === 'outline/volumes/volume-1.md'), `应检测 volume stub：${JSON.stringify(r.stubs)}`);
    });
    await t('PR6/PR8 源码集成点存在', async () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      const indexSrc = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
      const badgeSrc = fs.readFileSync(path.join(ROOT, 'src/components/SetupStageBadge.jsx'), 'utf8');
      assert(/refreshSetupStageIfDirty/.test(agentSrc) && /setupDirty/.test(agentSrc), 'agent 应支持 setup dirty 刷新');
      assert(/app\.get\('\/api\/setup-repair'/.test(indexSrc) && /app\.post\('\/api\/setup-repair'/.test(indexSrc), 'server 应注册 setup-repair API');
      assert(/\/api\/setup-repair/.test(badgeSrc) && /创建占位/.test(badgeSrc), 'SetupStageBadge 应接 setup-repair 入口');
    });
  });

  await group('upload service (import-text + skill upload)', async () => {
    const { importTextFile, uploadUserSkill } = await import('../server/services/upload.js');
    const project = '__eval_upload__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });

    await t('importTextFile 默认落 imports/ 并加时间戳', async () => {
      const r = await importTextFile({ project, filename: 'world.md', content: '# 世界观\n这是一段设定。' });
      assert(r.ok && /^imports\/\d{4}-\d{2}-\d{2}T.+world\.md$/.test(r.relPath), `relPath 不符：${r.relPath}`);
      assert(fs.existsSync(path.join(projectDir, r.relPath)), '文件应实际写入');
    });
    await t('importTextFile 子目录白名单：knowledge/world 允许、knowledge/ 拒绝', async () => {
      const ok = await importTextFile({ project, filename: 'overview.md', content: '# overview\n世界观初稿' + '。'.repeat(50), subdir: 'knowledge/world' });
      assert(ok.relPath === 'knowledge/world/overview.md', `应直落到 knowledge/world/overview.md：${ok.relPath}`);
      let blocked = false;
      try { await importTextFile({ project, filename: 'a.md', content: 'x', subdir: 'knowledge' }); }
      catch (e) { blocked = /不允许写入子目录/.test(String(e.message)); }
      assert(blocked, 'knowledge 根目录不应被允许');
    });
    await t('importTextFile 拒绝非文本扩展名 + 路径越界 + 空内容', async () => {
      let exts = false, traverse = false, empty = false;
      try { await importTextFile({ project, filename: 'evil.exe', content: 'x' }); } catch (e) { exts = /\.md\/\.markdown/.test(String(e.message)); }
      try { await importTextFile({ project, filename: '../../etc/passwd.md', content: 'x' }); } catch (e) { /* safeFileName 会清理 */ }
      // 越界：通过 subdir 注入 ..
      try { await importTextFile({ project, filename: 'a.md', content: 'x', subdir: '../escape' }); } catch (e) { traverse = /不允许写入子目录|路径越界/.test(String(e.message)); }
      try { await importTextFile({ project, filename: 'a.md', content: '   ' }); } catch (e) { empty = /content 为空/.test(String(e.message)); }
      assert(exts, '扩展名校验应触发');
      assert(traverse, '../escape 应被白名单或越界检查拦截');
      assert(empty, '空 content 应被拒绝');
    });
    await t('importTextFile overwrite=false 命中冲突抛 EEXIST', async () => {
      await importTextFile({ project, filename: 'plan.md', content: 'first', subdir: 'outline' });
      let e1;
      try { await importTextFile({ project, filename: 'plan.md', content: 'second', subdir: 'outline' }); }
      catch (e) { e1 = e; }
      assert(e1?.code === 'EEXIST', `应抛 EEXIST：${e1?.message}`);
      const r = await importTextFile({ project, filename: 'plan.md', content: 'second', subdir: 'outline', overwrite: true });
      assert(r.ok, '覆盖应成功');
      const txt = fs.readFileSync(path.join(projectDir, r.relPath), 'utf8');
      assert(txt === 'second', '覆盖后内容应更新');
    });
    await t('uploadUserSkill 解析 frontmatter 写入 user skill', async () => {
      const md = `---\nname: my-tone\ntitle: 自定义文风\nkeywords: [节奏, 紧凑]\npriority: 4\n---\n# 我的文风\n\n## 触发\n紧凑节奏\n`;
      const r = await uploadUserSkill({ project, content: md });
      assert(r.ok && r.name === 'my-tone' && r.relPath === 'skills/my-tone.md', `relPath 不符：${JSON.stringify(r)}`);
      const written = fs.readFileSync(path.join(projectDir, r.relPath), 'utf8');
      assert(/title: \u81ea\u5b9a\u4e49\u6587\u98ce/.test(written), 'frontmatter 应保留 title');
      assert(/priority: 4/.test(written), 'priority 应被保留');
    });
    await t('uploadUserSkill 缺 name 报错；overwrite=false 命中冲突 EEXIST', async () => {
      let e1;
      try { await uploadUserSkill({ project, content: '没有 frontmatter 的纯正文，长一点长一点长一点长一点。' }); }
      catch (e) { e1 = e; }
      assert(/请在 frontmatter 提供 name|name/.test(String(e1?.message || '')), `应提示 name 缺失：${e1?.message}`);
      const md = `---\nname: my-tone\ntitle: 二次上传\n---\n# 又一份\n`;
      let e2;
      try { await uploadUserSkill({ project, content: md }); } catch (e) { e2 = e; }
      assert(e2?.code === 'EEXIST', `应抛 EEXIST：${e2?.message}`);
    });
    await t('upload API 与前端入口集成点存在', () => {
      const indexSrc = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
      assert(/app\.post\('\/api\/import-text'/.test(indexSrc), '缺少 /api/import-text');
      assert(/app\.post\('\/api\/user-skills\/upload'/.test(indexSrc), '缺少 /api/user-skills/upload');
      const chatSrc = fs.readFileSync(path.join(ROOT, 'src/components/ChatStream.jsx'), 'utf8');
      assert(/onFilesDropped/.test(chatSrc) && /\/api\/import-text/.test(chatSrc), 'ChatStream 应支持拖拽 + 调 /api/import-text');
      const skillSrc = fs.readFileSync(path.join(ROOT, 'src/components/SkillsPanel.jsx'), 'utf8');
      assert(/\/api\/user-skills\/upload/.test(skillSrc), 'SkillsPanel 应有上传入口');
    });
  });

  await group('wiki automation P0', async () => {
    const project = '__eval_wiki_auto__';
    const projectDir = path.join(ROOT, 'novels', project);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectDir, 'chapters'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/entities'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'knowledge/concepts'), { recursive: true });

    t('normalizeModeProfile 映射前端 mode 到 llm profile', () => {
      assert(normalizeModeProfile('flash') === 'cheap', 'flash -> cheap');
      assert(normalizeModeProfile('pro') === 'default', 'pro -> default');
      assert(normalizeModeProfile('writer') === 'writer', 'writer -> writer');
      assert(normalizeModeProfile('ultra') === 'ultra', 'ultra -> ultra');
      assert(normalizeModeProfile('unknown') === null, 'unknown -> null');
    });
    t('llmConfig ultra 支持专用模型并回退主模型', () => {
      const saved = { m: process.env.LLM_MODEL, u: process.env.LLM_MODEL_ULTRA };
      process.env.LLM_MODEL = 'main-model';
      delete process.env.LLM_MODEL_ULTRA;
      try {
        assert(llmConfig('ultra').model === 'main-model', 'ultra 未配应回退主模型');
        process.env.LLM_MODEL_ULTRA = 'ultra-model';
        assert(llmConfig('ultra').model === 'ultra-model', 'ultra 专用模型应生效');
      } finally {
        if (saved.m !== undefined) process.env.LLM_MODEL = saved.m; else delete process.env.LLM_MODEL;
        if (saved.u !== undefined) process.env.LLM_MODEL_ULTRA = saved.u; else delete process.env.LLM_MODEL_ULTRA;
      }
    });
    await t('wiki_pending 找出已保存但未沉淀章节并生成 prompt block', async () => {
      fs.writeFileSync(path.join(projectDir, 'chapters', '第1章-开端.md'), '第一章正文', 'utf8');
      fs.writeFileSync(path.join(projectDir, 'chapters', '第2章-迷雾.md'), '第二章正文', 'utf8');
      fs.mkdirSync(path.join(projectDir, 'knowledge'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'knowledge', 'log.md'), '# 章节摘要时间线\n\n## 第 1 章 开端\n已沉淀。\n', 'utf8');
      const p = await getWikiPending(project);
      assert(p.count === 1 && p.pending[0].chapter === 2, `应只有第2章 pending：${JSON.stringify(p)}`);
      const block = await buildWikiPendingBlock(project);
      assert(/<wiki_pending>/.test(block) && /第 2 章/.test(block) && /wiki_ingest/.test(block), 'pending block 应注入章节和工具要求');
    });
    await t('wiki_lint_due 每 10 章且报告未覆盖时触发', async () => {
      for (let i = 3; i <= 10; i++) fs.writeFileSync(path.join(projectDir, 'chapters', `第${i}章-测试.md`), `第${i}章`, 'utf8');
      const due = await getWikiLintDue(project);
      assert(due.due && due.latestChapter === 10, `第10章应 due：${JSON.stringify(due)}`);
      const block = await buildWikiLintDueBlock(project);
      assert(/<lint_due/.test(block) && /wiki_lint/.test(block), 'lint_due block 应提示 wiki_lint');
    });
    await t('archiveSynthesis 写 knowledge/synthesis 且要求至少 2 来源', async () => {
      let bad = false;
      try { await archiveSynthesis(project, { title: '单源推论', thesis: 'x', derived_from: ['a.md'] }); }
      catch (e) { bad = /至少需要 2/.test(String(e.message)); }
      assert(bad, '单来源应拒绝');
      const r = await archiveSynthesis(project, {
        title: '雾的选择性',
        thesis: '雾更像惩罚主动越界者。',
        derived_from: ['knowledge/concepts/fog.md', 'knowledge/world/rules.md'],
        confidence: 0.65,
      });
      assert(r.ok && /^knowledge\/synthesis\//.test(r.relPath), `应写 synthesis：${JSON.stringify(r)}`);
      assert(fs.existsSync(path.join(projectDir, r.relPath)), 'synthesis 文件应存在');
    });
    await t('runWikiLint 写 lint-report 并报告缺字段/stub', async () => {
      fs.writeFileSync(path.join(projectDir, 'knowledge/entities/protagonist.md'), '---\nid: protagonist\ntype: character\nname: 主角\n---\n\nTODO 待补\n', 'utf8');
      const r = await runWikiLint(project, { currentChapter: 10, scope: 'mechanical' });
      assert(r.ok && r.relPath === 'knowledge/lint-report.md' && r.issues >= 1, `lint 应写报告并有问题：${JSON.stringify(r)}`);
      const report = fs.readFileSync(path.join(projectDir, 'knowledge/lint-report.md'), 'utf8');
      assert(/coverage_chapter: 10/.test(report) && /frontmatter_missing|stub_body/.test(report), '报告应包含 coverage 和问题');
      const due = await getWikiLintDue(project);
      assert(!due.due, 'lint-report 覆盖第10章后不应再 due');
    });
    t('P0 UI/backend 集成点存在', () => {
      const indexSrc = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
      assert(/const \{ message, projectName, history, mode \}/.test(indexSrc) && /mode, emit/.test(indexSrc), 'chat API 应接收并传 mode');
      // mode selector 在 UI Refresh v3 中从 TopBar 下移到 ChatStream 输入卡工具栏
      const chatSrc = fs.readFileSync(path.join(ROOT, 'src/components/ChatStream.jsx'), 'utf8');
      const modesPresent = ['flash', 'pro', 'writer', 'ultra'].every((m) => new RegExp(`\\b${m}\\b`, 'i').test(chatSrc));
      assert(/MODE_INFO/.test(chatSrc) && modesPresent && /onModeChange/.test(chatSrc), 'ChatStream 应内嵌 mode selector（含 flash/pro/writer/ultra）');
      const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
      assert(/moshu\.mode/.test(appSrc) && /mode,/.test(appSrc), 'App 应持久化并发送 mode');
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/buildWikiPendingBlock/.test(agentSrc) && /buildWikiLintDueBlock/.test(agentSrc), 'agent prompt 应注入 wiki pending/lint due');
    });
  });

  await group('P1-P2 archive / skill creator / artifacts / cost UI', async () => {
    t('draftUserSkillFromBrief 生成可编辑 user skill 草稿', () => {
      const d = draftUserSkillFromBrief({ brief: '写章前检查章末钩子和小高潮密度，避免平推。', title: '节奏检查' });
      assert(d.name && /^[a-z0-9][a-z0-9-]{1,40}$/.test(d.name), `非法 name：${d.name}`);
      assert(d.title === '节奏检查', 'title 应沿用输入');
      assert(Array.isArray(d.keywords) && d.keywords.length > 0, '应生成 keywords');
      assert(/## 何时使用/.test(d.body) && /## 禁止/.test(d.body), 'body 应是结构化 Markdown');
    });
    t('P1 后端提供预览器保存 API 与 skill draft API', () => {
      const indexSrc = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
      assert(/app\.post\('\/api\/file\/save'/.test(indexSrc), '缺少 /api/file/save');
      assert(/backupFile\(project, relPath\)/.test(indexSrc), '保存前应备份');
      assert(/app\.post\('\/api\/user-skills\/draft'/.test(indexSrc), '缺少 /api/user-skills/draft');
      const skillsSrc = fs.readFileSync(path.join(ROOT, 'server/services/skills.js'), 'utf8');
      assert(/draftUserSkillFromBrief/.test(skillsSrc), '缺少 skill 草稿函数');
    });
    t('P1 Archive 文档预览支持 frontmatter 元信息与编辑保存', () => {
      const previewSrc = fs.readFileSync(path.join(ROOT, 'src/components/Preview.jsx'), 'utf8');
      assert(/parseDocFrontmatter/.test(previewSrc) && /pv-meta/.test(previewSrc), 'Preview 应展示 frontmatter 元信息');
      assert(/api\/file\/save/.test(previewSrc) && /pv-editor/.test(previewSrc), 'Preview 应支持编辑保存');
      assert(/onContentSaved/.test(previewSrc), '保存后应同步当前预览内容');
    });
    t('P1 Skill Creator UI 集成草稿器', () => {
      const skillPanelSrc = fs.readFileSync(path.join(ROOT, 'src/components/SkillsPanel.jsx'), 'utf8');
      assert(/creatorBrief/.test(skillPanelSrc) && /\/api\/user-skills\/draft/.test(skillPanelSrc), 'SkillsPanel 应有草稿器');
      assert(/生成 skill 草稿/.test(skillPanelSrc), '草稿器按钮文案缺失');
    });
    t('P2 会话产物面板与 token 成本增强集成点存在', () => {
      const chatSrc = fs.readFileSync(path.join(ROOT, 'src/components/ChatStream.jsx'), 'utf8');
      assert(/SessionArtifacts/.test(chatSrc) && /artifacts-panel/.test(chatSrc) && /本会话产物/.test(chatSrc), 'ChatStream 应有产物面板');
      const hudSrc = fs.readFileSync(path.join(ROOT, 'src/components/StatusHUD.jsx'), 'utf8');
      assert(/lastCost/.test(hudSrc) && /profile/.test(hudSrc) && /本轮/.test(hudSrc), 'StatusHUD 应显示 profile 和本轮成本');
      const llmSrc = fs.readFileSync(path.join(ROOT, 'server/services/llm.js'), 'utf8');
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/config: cfg/.test(llmSrc) && /model: config\?\.model/.test(agentSrc), 'llm_done 应携带真实 model/profile');
    });
    t('P1-P2 样式存在', () => {
      const css = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
      for (const cls of ['pv-meta', 'pv-editor', 'skill-creator', 'artifacts-panel', 'hud-sub']) {
        assert(css.includes(`.${cls}`), `缺少样式 ${cls}`);
      }
    });
  });

  await group('skills files', () => {
    t('skills/*.md 全部可读且有标题', () => {
      const dir = path.join(ROOT, 'skills');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      assert(files.length >= 20, `skills 目录文件数异常：${files.length}`);
      for (const f of files) {
        const txt = fs.readFileSync(path.join(dir, f), 'utf8');
        assert(txt.length > 100, `skill ${f} 过短`);
        assert(/^#\s+/m.test(txt), `skill ${f} 没有一级标题`);
      }
    });
    t('SKILL_CATALOG 里的 name 都对应 skills/<name>.md', () => {
      const dir = path.join(ROOT, 'skills');
      for (const name of Object.keys(SKILL_CATALOG)) {
        const p = path.join(dir, `${name}.md`);
        assert(fs.existsSync(p), `SKILL_CATALOG 中 "${name}" 对应文件缺失：${p}`);
      }
    });
    t('PR-2 核心链路 skill frontmatter 元数据完整', () => {
      const dir = path.join(ROOT, 'skills');
      const chain = ['work-setup', 'setup-pipeline', 'bulk-import', 'worldbuilding-systems', 'character-bible', 'outline-collaborator', 'volume-outline', 'arc-outline', 'chapter-planner', 'chinese-novelist'];
      for (const name of chain) {
        const txt = fs.readFileSync(path.join(dir, `${name}.md`), 'utf8');
        const { data } = parseFrontmatter(txt);
        assert(data.name === name, `${name} 缺 name frontmatter`);
        assert(typeof data.phase === 'string' && data.phase.length > 0, `${name} 缺 phase`);
        assert(Array.isArray(data.must_call_tools) && data.must_call_tools.length > 0, `${name} 缺 must_call_tools`);
        assert(Array.isArray(data.exit_when) && data.exit_when.length > 0, `${name} 缺 exit_when`);
      }
    });
    t('PR-2 SKILL_CATALOG 核心链路元数据完整', async () => {
      const catalog = await getSkillCatalog(null);
      const expected = {
        'work-setup': ['setup-pipeline', 'bulk-import'],
        'setup-pipeline': ['worldbuilding-systems', 'character-bible', 'outline-collaborator', 'volume-outline', 'arc-outline', 'chapter-planner'],
        'worldbuilding-systems': ['character-bible'],
        'character-bible': ['outline-collaborator'],
        'outline-collaborator': ['volume-outline'],
        'volume-outline': ['arc-outline'],
        'arc-outline': ['chapter-planner'],
        'chapter-planner': ['chinese-novelist'],
        'chinese-novelist': ['wiki-ingest', 'continuity-guard'],
      };
      for (const [name, chainsTo] of Object.entries(expected)) {
        const s = catalog[name];
        assert(s.phase, `${name} 缺 phase`);
        assert(Array.isArray(s.mustCallTools) && s.mustCallTools.length > 0, `${name} 缺 mustCallTools`);
        for (const target of chainsTo) assert(s.chainsTo.includes(target), `${name} chainsTo 缺 ${target}`);
      }
    });
  });

  await group('prompt budget', async () => {
    const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
    t('BASE_SYSTEM 大小在预算内（< 20k 字符）', () => {
      const m = /const BASE_SYSTEM = `([\s\S]*?)`;/.exec(agentSrc);
      assert(m, 'BASE_SYSTEM 未找到');
      assert(m[1].length < 20000, `BASE_SYSTEM ${m[1].length} 字符超预算 20000`);
    });
    t('没有未使用的 TOOLS 描述占位符', () => {
      for (const tool of TOOLS) {
        assert(!/\$\{[^}]*\}/.test(tool.function.description), `工具 ${tool.function.name} description 含未替换模板 \${...}`);
      }
    });
  });

  await group('completion policy / final summary', async () => {
    t('collectArtifacts 从写入事件汇总产物并去 novels 前缀', () => {
      const artifacts = collectArtifacts([
        { type: 'file_write', path: 'novels/书/chapter.md', kind: 'chapter', note: '新章' },
        { type: 'chapter_saved', relPath: 'chapters/chapter-1.md', chapter: 1, title: '开端', wordCount: 1200, score: 82 },
      ], { projectName: '书' });
      assert(artifacts.some((a) => a.path === 'chapter.md'), `file_write 路径未规范化：${JSON.stringify(artifacts)}`);
      assert(artifacts.some((a) => a.path === 'chapters/chapter-1.md' && /第 1 章/.test(a.label)), `chapter_saved 未汇总：${JSON.stringify(artifacts)}`);
    });
    t('assessCompletion 对 requiredWrite 完成 + 写入产物判定 done', () => {
      const ctx = { projectName: '书', requiredWrite: null, requiredWriteDone: true, lastTasks: [] };
      const a = assessCompletion({ ctx, events: [{ type: 'tool_result', name: 'write_outline', ok: true }, { type: 'file_write', path: 'novels/书/outline/overall.md' }] });
      assert(a.status === 'done', `应 done，实得 ${JSON.stringify(a)}`);
    });
    t('assessCompletion 对 ask_user 判定 needs_user', () => {
      const ctx = { projectName: '书', pauseAfterTools: true, lastTasks: [] };
      const a = assessCompletion({ ctx, events: [{ type: 'ask_user', question: '覆盖吗？', options: ['是', '否'] }] });
      assert(a.status === 'needs_user', `应 needs_user，实得 ${JSON.stringify(a)}`);
    });
    t('final summary markdown 包含产物与下一步', () => {
      const summary = buildFinalSummary({
        ctx: { projectName: '书', intentInfo: { intent: 'write_chapter' } },
        events: [{ type: 'chapter_saved', relPath: 'chapters/chapter-2.md', chapter: 2, title: '风起', wordCount: 1800, score: 86 }],
      });
      const md = renderFinalSummaryMarkdown(summary);
      assert(/本轮产物/.test(md) && /chapters\/chapter-2\.md/.test(md), `summary 缺产物：${md}`);
      assert(/下一步建议/.test(md), `summary 缺下一步：${md}`);
    });
    t('agent 接入 final_summary 自动兜底与 finish_task', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/name: 'finish_task'/.test(agentSrc), '缺 finish_task 工具');
      assert(/type: 'final_summary'/.test(agentSrc), '缺 final_summary 事件');
      assert(/assessCompletion\(\{ ctx, events: ctx\.runEvents/.test(agentSrc), 'runAgent 未使用 completion policy 自动判定');
    });
    t('前端把 final_summary 写入 assistant 气泡', () => {
      const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
      assert(/finalSummaryMd/.test(appSrc), 'App 缺 finalSummaryMd 缓冲');
      assert(/evt\.type === 'final_summary'/.test(appSrc), 'App 未处理 final_summary');
      assert(/assistantBuf \|\| finalSummaryMd/.test(appSrc), '收尾未用 finalSummaryMd 兜底');
    });
  });

  await group('agent intelligence upgrades', async () => {
    t('意图策略对高风险模糊写章触发澄清', () => {
      const intent = { intent: 'write_chapter', risk: 'high', target: {}, contextMode: 'write' };
      const policy = applyIntentPolicy(intent, { includeActivePlan: true });
      const ambiguity = detectAmbiguity(intent, '帮我写一章');
      assert(policy.requireClarifyOnAmbiguity && ambiguity.ambiguous, `应触发澄清：${JSON.stringify({ policy, ambiguity })}`);
    });
    t('工具语义校验识别 read_file 截断与 wiki miss', () => {
      const r1 = verifyToolResult('read_file', { path: 'a.md' }, { status: 'ok', data: { content: 'x', truncated: true } }, {});
      const r2 = verifyToolResult('wiki_query', { keywords: ['林尘'] }, { status: 'ok', data: { hits: [] } }, {});
      assert(r1.kind === 'partial_read' && r2.kind === 'wiki_miss', `校验失败：${JSON.stringify({ r1, r2 })}`);
    });
    t('self-check 反思会把查询工具标为 context_only', () => {
      const reflection = buildReflection({
        toolName: 'read_file',
        result: { status: 'ok', data: { content: 'x' } },
        verification: { severity: 'ok', kind: 'verified' },
        ctx: { requiredWrite: { tool: 'write_chapter' }, requiredWriteDone: false },
      });
      assert(reflection.label === 'context_only' && reflection.target === 'write_chapter', `反思错误：${JSON.stringify(reflection)}`);
    });
    t('stuck detector 识别重复失败并生成重规划信号', () => {
      const stuck = assessStuck({
        ctx: { requiredWrite: { tool: 'write_chapter' }, requiredWriteDone: false },
        turn: 3,
        events: [
          { type: 'tool_result', name: 'read_file', ok: false },
          { type: 'tool_result', name: 'read_file', ok: false },
        ],
      });
      assert(stuck.stuck && stuck.reason === 'repeated_failures', `stuck 判定错误：${JSON.stringify(stuck)}`);
    });
    t('budget-aware 会根据 turn/token 压力升级', () => {
      const ctx = {};
      const b = updateBudget(ctx, { prompt_tokens: 1000, completion_tokens: 1000 }, { turn: 9, maxTurns: 10, profile: 'default' });
      assert(b.pressure === 'high', `预算压力应 high，实得 ${JSON.stringify(b)}`);
    });
    t('goal progress 汇总章节与任务进度', () => {
      const progress = deriveGoalProgress(
        { intentInfo: { intent: 'write_chapter' }, taskRuntime: { tasks: [{ id: 'a', status: 'done' }, { id: 'b', status: 'in_progress', title: '写第2章' }] }, setupStage: { stage: 7 } },
        [{ type: 'chapter_saved', chapter: 2 }],
      );
      assert(progress.latestChapter === 2 && progress.percent === 50 && progress.setupStage === 7, `进度错误：${JSON.stringify(progress)}`);
    });
    t('failure memory 生成 failure_mode 记忆 payload', () => {
      const payload = failureMemoryPayload({
        ctx: { intentInfo: { intent: 'write_chapter' }, requiredWrite: { tool: 'write_chapter' } },
        reason: 'write_intent_unfulfilled',
        events: [{ type: 'tool_result', name: 'write_chapter', result: { error: { hint: '修正参数' } } }],
      });
      assert(payload.kind === 'failure_mode' && /write_chapter/.test(payload.value), `failure memory 错误：${JSON.stringify(payload)}`);
    });
    t('agent 主循环接入智能事件', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/tool_verification/.test(agentSrc) && /self_check/.test(agentSrc), '缺工具校验或 self_check 事件');
      assert(/stuck_detected/.test(agentSrc) && /buildReplanPrompt/.test(agentSrc), '缺 stuck 重规划接入');
      assert(/budget_pressure/.test(agentSrc) && /updateBudget/.test(agentSrc), '缺预算感知接入');
      assert(/goal_progress/.test(agentSrc) && /failureMemoryPayload/.test(agentSrc), '缺目标进度或失败记忆接入');
    });
  });

  await group('outline guard / volume and arc consistency', async () => {
    t('extractVolumePlan 从总纲提取卷章数', () => {
      const plans = extractVolumePlan('## 分卷规划\n- 第一卷：第1-40章，凡尘入局\n- 第二卷：第41-80章，宗门风云');
      assert(plans.get(1)?.count === 40 && plans.get(2)?.start === 41, `卷计划提取错误：${JSON.stringify([...plans])}`);
    });
    t('validateVolumeOutline 拦截卷一 40 章被写成 25 章', () => {
      const overallMd = '- 第一卷：第1-40章，凡尘入局';
      const content = `# 第 1 卷\n\n## Canon 对齐依据\n- SOUL.md：总章数 80\n- outline/overall.md：第一卷第1-40章\n- 人物档案：林尘来自 knowledge/entities/linchen.md\n\n> 预估：1-25（约 25 章）`;
      const r = validateVolumeOutline({ path: 'outline/volumes/volume-1.md', content, overallMd });
      assert(!r.ok && r.issues.some((x) => x.kind === 'volume_count_mismatch'), `应拦截章数不匹配：${JSON.stringify(r)}`);
    });
    t('validateVolumeOutline 要求卷纲写出 canon 与人物依据', () => {
      const r = validateVolumeOutline({ path: 'outline/volumes/volume-1.md', content: '# 第 1 卷\n> 预估：1-40（约 40 章）', overallMd: '- 第一卷：第1-40章' });
      assert(!r.ok && r.issues.some((x) => x.kind === 'missing_canon_evidence'), `应要求 canon evidence：${JSON.stringify(r)}`);
    });
    t('validateArcOutline 拦截越出卷纲范围的细纲', () => {
      const volumeMd = `# 第 1 卷\n\n## Canon 对齐依据\n- SOUL.md：x\n- outline/overall.md：x\n- 人物档案：x\n\n> 预估：1-40（约 40 章）`;
      const content = `# Arc 9：第 041-045 章\n\n## Canon 对齐依据\n- SOUL.md：x\n- outline/overall.md：x\n- outline/volumes/volume-1.md：x\n- 人物档案/关系：x`;
      const r = validateArcOutline({ path: 'outline/arcs/arc-9-章041-045.md', content, volumeMd });
      assert(!r.ok && r.issues.some((x) => x.kind === 'arc_outside_volume'), `应拦截 arc 越界：${JSON.stringify(r)}`);
    });
    t('detectRequiredWrites 对未指定单卷的卷纲请求生成全书卷纲 scope', () => {
      const q = detectRequiredWrites('生成全书卷纲', { intent: 'write_outline', target: {} });
      assert(q.length === 1 && q[0].scope === 'all_volumes' && q[0].path === null, `应生成 all_volumes requiredWrite：${JSON.stringify(q)}`);
    });
    t('volume-outline skill 声明必须补齐全书所有卷纲和人物依据', () => {
      const txt = fs.readFileSync(path.join(ROOT, 'skills/volume-outline.md'), 'utf8');
      assert(/全书所有卷纲/.test(txt) && /knowledge\/entities\/\*/.test(txt) && /knowledge\/relationships\.md/.test(txt), 'volume-outline 缺全书卷纲或人物依据约束');
      assert(/all outline\/volumes\/volume-<N>\.md in overall exist/.test(txt), 'volume-outline exit_when 仍可能只检查 volume-1');
    });
  });

  await group('tool-validate', () => {
    const schema = TOOLS.find((x) => x.function.name === 'write_chapter').function.parameters;
    t('write_chapter 合法参数通过', () => {
      const r = validateArgs(schema, { chapter: 1, title: 't', content: '正文' });
      assert(r.ok, `应通过，实得 ${JSON.stringify(r)}`);
    });
    t('缺 required 字段报错', () => {
      const r = validateArgs(schema, { chapter: 1, title: 't' });
      assert(!r.ok && r.errors.some((e) => e.kind === 'required' && e.path === 'content'), `应报 required.content：${JSON.stringify(r)}`);
    });
    t('chapter 是字符串 "1" 应报 type', () => {
      const r = validateArgs(schema, { chapter: '1', title: 't', content: 'x' });
      assert(!r.ok && r.errors.some((e) => e.kind === 'type' && e.path === 'chapter'), `应报 type.chapter`);
    });
    t('chapter=0 触发 minimum', () => {
      const r = validateArgs(schema, { chapter: 0, title: 't', content: 'x' });
      assert(!r.ok && r.errors.some((e) => e.kind === 'minimum'), `应报 minimum`);
    });
    t('enum 不匹配报错', () => {
      const upSchema = TOOLS.find((x) => x.function.name === 'update_progress').function.parameters;
      const r = validateArgs(upSchema, { path: 'progress/a.md', content: 'x', mode: 'bogus' });
      assert(!r.ok && r.errors.some((e) => e.kind === 'enum'), `应报 enum.mode`);
    });
    t('数组 items 递归校验', () => {
      const wqSchema = TOOLS.find((x) => x.function.name === 'wiki_query').function.parameters;
      const r = validateArgs(wqSchema, { keywords: ['a', 123] });
      assert(!r.ok && r.errors.some((e) => e.kind === 'type' && e.path === 'keywords[1]'), `应报 keywords[1] 类型：${JSON.stringify(r)}`);
    });
  });

  await group('model routing', () => {
    t('llmConfig() 默认档有 model', () => {
      const c = llmConfig();
      assert(c.model && typeof c.model === 'string', 'model 必须有值');
    });
    t('cheap/writer 未配时回退到主模型', () => {
      const saved = { c: process.env.LLM_MODEL_CHEAP, w: process.env.LLM_MODEL_WRITER, m: process.env.LLM_MODEL };
      delete process.env.LLM_MODEL_CHEAP;
      delete process.env.LLM_MODEL_WRITER;
      process.env.LLM_MODEL = 'foo-main';
      try {
        assert(llmConfig('cheap').model === 'foo-main', 'cheap 应回退');
        assert(llmConfig('writer').model === 'foo-main', 'writer 应回退');
      } finally {
        if (saved.c !== undefined) process.env.LLM_MODEL_CHEAP = saved.c;
        if (saved.w !== undefined) process.env.LLM_MODEL_WRITER = saved.w;
        if (saved.m !== undefined) process.env.LLM_MODEL = saved.m;
        else delete process.env.LLM_MODEL;
      }
    });
    t('cheap 配了就走专用档', () => {
      const saved = process.env.LLM_MODEL_CHEAP;
      process.env.LLM_MODEL_CHEAP = 'mini-cheap';
      try {
        assert(llmConfig('cheap').model === 'mini-cheap');
      } finally {
        if (saved !== undefined) process.env.LLM_MODEL_CHEAP = saved;
        else delete process.env.LLM_MODEL_CHEAP;
      }
    });
    t('默认 max_tokens 增大且 writer 档更高', () => {
      const saved = {
        max: process.env.LLM_MAX_TOKENS,
        cheap: process.env.LLM_MAX_TOKENS_CHEAP,
        writer: process.env.LLM_MAX_TOKENS_WRITER,
      };
      delete process.env.LLM_MAX_TOKENS;
      delete process.env.LLM_MAX_TOKENS_CHEAP;
      delete process.env.LLM_MAX_TOKENS_WRITER;
      try {
        assert(llmConfig().max_tokens >= 8192, `默认档 max_tokens 应至少 8192，实得 ${llmConfig().max_tokens}`);
        assert(llmConfig('writer').max_tokens >= 12288, `writer 档 max_tokens 应至少 12288，实得 ${llmConfig('writer').max_tokens}`);
        assert(llmConfig('cheap').max_tokens <= llmConfig().max_tokens, 'cheap 档不应高于默认档');
      } finally {
        if (saved.max !== undefined) process.env.LLM_MAX_TOKENS = saved.max;
        else delete process.env.LLM_MAX_TOKENS;
        if (saved.cheap !== undefined) process.env.LLM_MAX_TOKENS_CHEAP = saved.cheap;
        else delete process.env.LLM_MAX_TOKENS_CHEAP;
        if (saved.writer !== undefined) process.env.LLM_MAX_TOKENS_WRITER = saved.writer;
        else delete process.env.LLM_MAX_TOKENS_WRITER;
      }
    });
  });

  await group('write intent gate', () => {
    const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
    t('detectRequiredWrite 覆盖 write_chapter 意图', () => {
      // 通过源码检查关键分支存在
      assert(/intent === 'write_chapter'/.test(agentSrc), 'detectRequiredWrite 缺 write_chapter case');
      assert(/tool: 'write_chapter'/.test(agentSrc), '缺 write_chapter tool 输出');
    });
    t('detectRequiredWrite 覆盖 setup 意图', () => {
      assert(/intent === 'setup'/.test(agentSrc), '缺 setup case');
      assert(/tool: 'setup_work'/.test(agentSrc), '缺 setup_work tool 输出');
    });
    t('matchesRequiredWrite 用 chapter 比对（不靠 path）', () => {
      assert(/matchesRequiredWrite\s*\(/.test(agentSrc), '缺 matchesRequiredWrite 函数');
      assert(/Number\(parsed\?\.chapter\) === Number\(rw\.chapter\)/.test(agentSrc), 'write_chapter 应按 chapter 比对');
    });
    t('detectWritePromise 识别承诺关键词', () => {
      assert(/function detectWritePromise/.test(agentSrc), '缺 detectWritePromise 函数');
    });
    t('守门员：连续 ≥2 轮不调 requiredWrite 即强制', () => {
      assert(/writeAvoidanceCount/.test(agentSrc), '缺写作躲避计数');
      assert(/reason: 'write_avoidance'/.test(agentSrc), '缺 write_avoidance auto_continue 事件');
      assert(/forceNextTool = ctx\.requiredWrite\.tool/.test(agentSrc), '缺强制 toolChoice 切换');
    });
    t('promise_without_action / pure_stall 任一都立即强制（不等第二次）', () => {
      // 修 1 后：text-only 轮统一立即强制，reason 区分 promise（命中正则） vs pure_stall（没命中）
      assert(/'promise_without_action'/.test(agentSrc), '缺 promise_without_action reason');
      assert(/'pure_stall'/.test(agentSrc), '缺 pure_stall reason（兜底路径）');
      // 必须在 text-only 分支里用到 forceNextTool = ctx.requiredWrite.tool（非条件地）
      assert(/!tool_calls\.length[\s\S]{0,800}?ctx\.forceNextTool\s*=\s*ctx\.requiredWrite\.tool/.test(agentSrc),
        'text-only 分支必须无条件 forceNextTool');
    });
    t('【修 2】requiredWrite 检测到后 system prompt 注入硬约束 directive', () => {
      assert(/writeDirective/.test(agentSrc) && /本轮写入强制约束/.test(agentSrc),
        '缺 writeDirective 硬约束注入');
      assert(/requiredWritePreview/.test(agentSrc), '缺 requiredWritePreview 检测');
    });
    t('【修 3】TEXT_QUOTA（content 过长）加速 avoidance 计数', () => {
      assert(/TEXT_QUOTA\s*=\s*\d+/.test(agentSrc), '缺 TEXT_QUOTA 常量');
      assert(/contentOverQuota/.test(agentSrc), '缺 contentOverQuota 判定');
      // 超标时 avoidance +2（而非 +1）
      assert(/contentOverQuota\s*\?\s*2\s*:\s*1/.test(agentSrc), '缺 quota 超标 +2 的加速逻辑');
    });
    t('setup_work 的 path 设为 null（避免 matchesRequiredWrite 永假）', () => {
      const m = /intent === 'setup'[\s\S]{0,400}?tool: 'setup_work'[\s\S]{0,200}?path:\s*null/.exec(agentSrc);
      assert(m, 'setup_work 应 path:null（setup_work 工具不接受 path 参数）');
    });
    t('守门员只在 requiredWriteDone 时清零（不再被失败调用清零）', () => {
      assert(/if \(ctx\.requiredWriteDone\) \{\s*ctx\.writeAvoidanceCount = 0;/.test(agentSrc),
        '清零分支必须在 requiredWriteDone===true 下');
    });
    t('守门员对 ask_user 友好：不增不减', () => {
      assert(/calledAskUser/.test(agentSrc) && /tc\.function\.name === 'ask_user'/.test(agentSrc),
        '守门员需识别 ask_user 为合法暂停');
    });
    t('硬上限：writeIntentNudges>=4 触发 agent_giveup', () => {
      assert(/reason: 'write_intent_unfulfilled'/.test(agentSrc), '应在 4 次后 giveup write_intent_unfulfilled');
    });
    t('写章任务使用 writer profile', () => {
      // activeProfile 的判定块内必须同时包含 requiredWrite write_chapter 与赋值 'writer'
      assert(/ctx\.requiredWrite\?\.tool === 'write_chapter'[\s\S]{0,300}activeProfile[\s\S]{0,200}'writer'/.test(agentSrc)
        || /activeProfile[\s\S]{0,500}ctx\.requiredWrite\?\.tool === 'write_chapter'/.test(agentSrc),
        '写章 requiredWrite 应切 writer profile');
      assert(/profile: activeProfile/.test(agentSrc), 'streamChat 应透传 activeProfile');
    });
    t('requiredWrite 只有工具 envelope ok 才算完成', () => {
      assert(/isOk\(envOk\) && markRequiredWriteDone\(ctx, tc\.function\.name, parsed\)/.test(agentSrc),
        'requiredWriteDone 必须要求匹配目标且工具 envelope ok');
      assert(/reason: 'required_write_retry'/.test(agentSrc), 'requiredWrite 尝试失败后应强制重试');
    });
    t('detectWritePromise 反白名单（写得/写过/写好不算承诺）', () => {
      const m = /function detectWritePromise[\s\S]{0,400}?\u5199\u5f97\|\u5199\u8fc7\|\u5199\u597d/.exec(agentSrc);
      assert(m, 'detectWritePromise 必须先排除写得/写过/写好等叙述词');
    });
    t('文本兜底：否定语（不要写/先别写）不触发 requiredWrite', () => {
      assert(/isNegative/.test(agentSrc) && /\u4e0d\u8981\|\u522b/.test(agentSrc), '兜底分支必须包含否定语过滤');
    });
  });

  await group('detectWritePromise behavior', async () => {
    const { detectWritePromise } = await import('../server/services/agent.js');
    // 应识别为承诺
    const promises = [
      '我不再废话，直接调用 write_outline 写四份卷纲',
      '我应该直接开始写卷纲，不再规划',
      '好，直接写。先并行读总纲',
      '我马上写第 1 章',
      '我现在就写',
      '现在开始写正文',
      '开始写第 3 章',
      '立刻开始写',
      '就这样写吧',
      '下一步：写第 1 章',
      '好，直接写',
      '调用 write_chapter 写第 5 章',
      '直接调用 setup_work 落盘 SOUL',
    ];
    for (const p of promises) {
      await t(`承诺识别 → "${p}"`, () => {
        assert(detectWritePromise(p) === true, `应识别为承诺：${p}`);
      });
    }
    // 不应识别（反白名单 / 叙述）
    const nonPromises = [
      '我写得不太好',
      '我写过类似的',
      '我写好了',
      '不要写第 3 章',
      '先别写，让我想想',
      '这一段写得很棒',
      '我们讨论一下要写什么',
      '能不能不写打斗',
    ];
    for (const p of nonPromises) {
      await t(`非承诺 → "${p}"`, () => {
        assert(detectWritePromise(p) === false, `不应识别为承诺：${p}`);
      });
    }
  });

  await group('intent inheritance', async () => {
    const { classifyIntent } = await import('../server/services/intent-router.js');
    t('短应答"嗯"继承前一条 write_chapter 意图的 chapter 号', () => {
      const r = classifyIntent({
        userMessage: '嗯',
        history: [
          { role: 'user', content: '写第 5 章' },
          { role: 'assistant', content: '好的，我马上写。' },
        ],
        hasSoul: true,
        setupStage: { stage: 7, missing: [] },
      });
      assert(r.intent === 'write_chapter', `应继承 write_chapter，实得 ${r.intent}`);
      assert(r.target.chapter === 5, `应继承 chapter=5，实得 ${r.target.chapter}`);
    });
  });

  await group('new service exports (UI surfaces)', async () => {
    const skills = await import('../server/services/skills.js');
    const projects = await import('../server/services/projects.js');
    const memory = await import('../server/services/memory-store.js');
    t('skills.readUserSkill / deleteUserSkill 导出', () => {
      assert(typeof skills.readUserSkill === 'function', '缺少 readUserSkill');
      assert(typeof skills.deleteUserSkill === 'function', '缺少 deleteUserSkill');
    });
    t('projects.deleteProject 导出且有路径安全检查', () => {
      assert(typeof projects.deleteProject === 'function', '缺少 deleteProject');
      const src = fs.readFileSync(path.join(ROOT, 'server/services/projects.js'), 'utf8');
      assert(/resolved\.startsWith\(rootResolved/.test(src), 'deleteProject 必须校验路径在 NOVELS_ROOT 下');
    });
    t('memory.listMemories / deleteMemory 导出', () => {
      assert(typeof memory.listMemories === 'function', '缺少 listMemories');
      assert(typeof memory.deleteMemory === 'function', '缺少 deleteMemory');
    });
    t('index.js 注册 Batch1+2 所有新 API', () => {
      const src = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
      const routes = [
        "app.get('/api/user-skills/:name'",
        "app.delete('/api/user-skills/:name'",
        "app.delete('/api/projects/:name'",
        "app.get('/api/setup-stage'",
        "app.post('/api/backup'",
        "app.post('/api/rollback'",
        "app.post('/api/export'",
        "app.get('/api/chapters-dashboard'",
        "app.get('/api/foreshadow-alerts'",
        "app.post('/api/foreshadow-scan'",
        "app.get('/api/memories'",
        "app.post('/api/memories'",
        "app.delete('/api/memories'",
      ];
      for (const r of routes) {
        assert(src.includes(r), `缺少路由：${r}`);
      }
    });
    t('前端面板组件齐全', () => {
      const comps = [
        'src/components/SkillsPanel.jsx',
        'src/components/MemoryPanel.jsx',
        'src/components/ChaptersDashboard.jsx',
        'src/components/SetupStageBadge.jsx',
        'src/components/ForeshadowAlerts.jsx',
      ];
      for (const c of comps) {
        assert(fs.existsSync(path.join(ROOT, c)), `缺少前端组件：${c}`);
      }
    });
    t('TopBar 已挂 6 个新按钮 + SetupStageBadge', () => {
      const src = fs.readFileSync(path.join(ROOT, 'src/components/TopBar.jsx'), 'utf8');
      for (const s of ['onOpenSkills', 'onOpenMemory', 'onOpenDashboard', 'onOpenForeshadow', 'onExport', 'onDeleteProject', 'SetupStageBadge']) {
        assert(src.includes(s), `TopBar 缺少 ${s}`);
      }
    });
    t('SetupStageBadge 展示 manifest 全量缺口与下一阶段', () => {
      const src = fs.readFileSync(path.join(ROOT, 'src/components/SetupStageBadge.jsx'), 'utf8');
      for (const s of ['missingRequired', 'nextStage', '全量缺口', '下一阶段']) {
        assert(src.includes(s), `SetupStageBadge 缺少 ${s}`);
      }
    });
    t('App.jsx 已声明 onExportNovel / onDeleteProject + 4 个 panel state', () => {
      const src = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
      for (const sym of [
        'const onExportNovel',
        'const onDeleteProject',
        'const [skillsOpen, setSkillsOpen]',
        'const [memoryOpen, setMemoryOpen]',
        'const [dashboardOpen, setDashboardOpen]',
        'const [foreshadowOpen, setForeshadowOpen]',
      ]) {
        assert(src.includes(sym), `App.jsx 缺少声明：${sym}`);
      }
    });
    t('Preview 已接 rollback + backup API', () => {
      const src = fs.readFileSync(path.join(ROOT, 'src/components/Preview.jsx'), 'utf8');
      assert(src.includes("'/api/rollback'"), 'Preview 未接 /api/rollback');
      assert(src.includes("'/api/backup'"), 'Preview 未接 /api/backup');
    });
  });

  await group('quality + memory + UX upgrades', () => {
    const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
    const accSrc = fs.readFileSync(path.join(ROOT, 'server/services/acceptance.js'), 'utf8');
    t('【B4】伏笔预警 helper + 注入', () => {
      assert(/buildForeshadowAlertsMd/.test(agentSrc), '缺 buildForeshadowAlertsMd');
      assert(/<foreshadow_alerts>/.test(agentSrc), '缺 <foreshadow_alerts> 注入块');
    });
    t('【B1】chapter-embed.js 存在 + search_chapters/chapter_reindex 工具', () => {
      assert(fs.existsSync(path.join(ROOT, 'server/services/chapter-embed.js')), '缺 chapter-embed.js');
      assert(/name: 'search_chapters'/.test(agentSrc), '缺 search_chapters 工具');
      assert(/name: 'chapter_reindex'/.test(agentSrc), '缺 chapter_reindex 工具');
      assert(/rebuildChapterEmbedIndex/.test(agentSrc), '缺写章后异步索引调用');
    });
    t('【B2】style-fingerprint.js 存在 + system prompt 注入', () => {
      assert(fs.existsSync(path.join(ROOT, 'server/services/style-fingerprint.js')), '缺 style-fingerprint.js');
      assert(/<style_fingerprint>/.test(agentSrc), '缺 <style_fingerprint> 注入块');
      assert(/rebuildStyleFingerprint/.test(agentSrc), '缺写章后异步重建调用');
    });
    t('【B3】character_states 注入', () => {
      assert(/buildCharacterStatesMd/.test(agentSrc), '缺 buildCharacterStatesMd');
      assert(/<character_states>/.test(agentSrc), '缺 <character_states> 注入块');
    });
    t('【A4】reader-score.js 存在 + reader_score 工具 + 异步触发', () => {
      assert(fs.existsSync(path.join(ROOT, 'server/services/reader-score.js')), '缺 reader-score.js');
      assert(/name: 'reader_score'/.test(agentSrc), '缺 reader_score 工具');
      assert(/scoreChapterAsReader/.test(agentSrc), '缺异步打分调用');
    });
    t('【F1】recent_user_feedback 注入', () => {
      assert(/buildRecentFeedbackMd/.test(agentSrc), '缺 buildRecentFeedbackMd');
      assert(/<recent_user_feedback>/.test(agentSrc), '缺 <recent_user_feedback> 注入块');
    });
    t('【A2】beat-checker.js 存在 + acceptance 集成', () => {
      assert(fs.existsSync(path.join(ROOT, 'server/services/beat-checker.js')), '缺 beat-checker.js');
      assert(/import \{ checkBeats \} from '\.\/beat-checker\.js'/.test(accSrc), 'acceptance 未 import checkBeats');
      assert(/beats:miss/.test(accSrc), '缺 beat miss blocker');
      assert(/beat_hit_rate/.test(accSrc), '缺 hit_rate 阈值检查');
    });
    t('【A1】chapter-variants.js 存在 + chapter_alternates 工具', () => {
      assert(fs.existsSync(path.join(ROOT, 'server/services/chapter-variants.js')), '缺 chapter-variants.js');
      assert(/name: 'chapter_alternates'/.test(agentSrc), '缺 chapter_alternates 工具');
      assert(/generateChapterVariants/.test(agentSrc), '缺生成器调用');
    });
    t('【D1】Preview diff 视图', () => {
      const pv = fs.readFileSync(path.join(ROOT, 'src/components/Preview.jsx'), 'utf8');
      assert(/function diffLines/.test(pv), '缺 diffLines 函数');
      assert(/diffMode/.test(pv), '缺 diffMode 状态');
      assert(/pv-diff-row/.test(pv), '缺 diff 行渲染');
    });
    t('【UX】LiveActivity 实时活动条已接入聊天界面', () => {
      const livePath = path.join(ROOT, 'src/components/LiveActivity.jsx');
      assert(fs.existsSync(livePath), '缺 LiveActivity.jsx');
      const live = fs.readFileSync(livePath, 'utf8');
      const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatStream.jsx'), 'utf8');
      const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
      const css = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
      assert(/tool_call/.test(live) && /tool_result/.test(live), 'LiveActivity 未识别工具调用状态');
      assert(/file_write/.test(live), 'LiveActivity 未识别写文件状态');
      assert(/subagent_start/.test(live) && /subagent_done/.test(live), 'LiveActivity 未识别子 Agent 状态');
      assert(/agent_warmup/.test(live), 'LiveActivity 未识别启动状态');
      assert(/import LiveActivity from '\.\/LiveActivity\.jsx'/.test(chat), 'ChatStream 未 import LiveActivity');
      assert(/<LiveActivity events=\{events\} busy=\{busy\}/.test(chat), 'ChatStream 未挂载 LiveActivity');
      assert(/events=\{events\}/.test(app), 'App.jsx 未把 events 传给 ChatStream');
      assert(/\.live-activity/.test(css) && /\.la-spinner/.test(css), '缺 LiveActivity 样式');
    });
  });

  await group('prompt injection guard', () => {
    const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
    t('read_file 返回内容被 <user_file> 包裹', () => {
      assert(/`<user_file path="\$\{args\.path\}">/.test(agentSrc) || /<user_file path="/.test(agentSrc), 'read_file 必须包 <user_file> 标签');
    });
    t('BASE_SYSTEM 提到 <user_file> 安全铁律', () => {
      assert(/安全铁律：<user_file>/.test(agentSrc), 'BASE_SYSTEM 缺少 <user_file> 安全条款');
    });
  });

  await group('agent execution runtime upgrades', () => {
    t('prepare_write_chapter 工具已注册', () => {
      const names = new Set(TOOLS.map((x) => x.function.name));
      assert(names.has('prepare_write_chapter'), '缺 prepare_write_chapter 工具');
    });
    t('detectRequiredWrites 支持章节范围队列', () => {
      const q = detectRequiredWrites('写第 1-3 章', { intent: 'write_chapter', target: { chapter: 1 } });
      assert(q.length === 3, `应生成 3 个 required write，实得 ${q.length}`);
      assert(q[0].chapter === 1 && q[2].chapter === 3, `章节队列错误：${JSON.stringify(q)}`);
    });
    t('sortToolCallsForExecution 把前置只读工具排到写工具前', () => {
      const calls = [
        { function: { name: 'write_chapter' } },
        { function: { name: 'read_file' } },
        { function: { name: 'setup_status' } },
      ];
      const ordered = sortToolCallsForExecution(calls).map((x) => x.function.name);
      assert(ordered.join(',') === 'setup_status,read_file,write_chapter', `排序错误：${ordered.join(',')}`);
    });
    t('task-runtime 规范化并自动推进当前任务', () => {
      const tasks = normalizeTasks([
        { id: 't1', title: '读取总纲', status: 'pending' },
        { id: 't2', title: '写第 1 章', status: 'pending' },
      ]);
      assert(tasks[0].status === 'in_progress', '首个 pending 应自动成为 in_progress');
      const rt = createTaskRuntime(tasks);
      const r = advanceTaskRuntime(rt, 'read_file');
      assert(r.changed && r.next?.id === 't2', `read_file 后应推进到 t2，实得 ${JSON.stringify(r)}`);
    });
    t('recovery-policy 能从 skill_must_call_tools 自动补前置工具', () => {
      const err = { kind: 'skill_must_call_tools', context: { missing: ['setup_status', 'lookup_query'] }, message: '缺 setup_status' };
      const r = planRecovery({ toolName: 'write_chapter', args: { chapter: 1 }, err, classified: err });
      assert(r?.injectToolCall?.name === 'setup_status', `应自动补 setup_status，实得 ${JSON.stringify(r)}`);
    });
    t('write-preflight 可抽取中文人物关键词', () => {
      const ks = extractPreflightKeywords('林尘看见玄机子站在门外，张三也没说话。');
      assert(ks.includes('林尘') && ks.includes('玄机子'), `关键词抽取失败：${ks.join(',')}`);
    });
    t('agent 主循环支持只读工具并发执行', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/Promise\.all\(readPrefix\.map/.test(agentSrc), '只读工具前缀应 Promise.all 并发执行');
      assert(/tool_parallel_start/.test(agentSrc) && /tool_parallel_done/.test(agentSrc), '缺少并发工具事件');
    });
    t('agent 主循环支持只读工具 per-run 缓存', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/toolCache: new Map\(\)/.test(agentSrc), 'ctx 缺少 toolCache');
      assert(/cacheKeyForTool/.test(agentSrc) && /tool_cache_hit/.test(agentSrc), '缺少缓存 key 或命中事件');
      assert(/if \(!isReadTool\(name\)\) ctx\.toolCache\?\.clear/.test(agentSrc), '写工具成功后应清 read cache');
    });
    t('prepare_write_chapter 不应无条件满足 wiki/context gate', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/const wikiReady = !missing\.includes\('wiki_keywords'\)/.test(agentSrc), 'wikiReady 必须基于 missing/gaps');
      assert(/if \(contextReady\)[\s\S]{0,120}chapterContext\.add/.test(agentSrc), 'chapterContext 必须在 contextReady 后才标记');
      assert(/if \(wikiReady\)[\s\S]{0,100}wikiQuery = true/.test(agentSrc), 'wikiQuery 必须在 wikiReady 后才标记');
    });
    t('agent 每轮 LLM 前执行 runtime prompt 压缩', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/function compressRuntimeMessages/.test(agentSrc), '缺 compressRuntimeMessages');
      assert(/prompt_runtime_compressed/.test(agentSrc), '缺 runtime 压缩事件');
      assert(/messages\.splice\(0, messages\.length, \.\.\.runtimeCompression\.messages\)/.test(agentSrc), '应原地替换压缩后的 messages');
    });
    t('scratchpad 会反向注入 system prompt', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/intentInfo\.scratchpadMd = await readScratchpad\(projectName\)/.test(agentSrc), 'runAgent 应读取 scratchpad');
      assert(/if \(intentInfo\?\.scratchpadMd && intentInfo\.scratchpadMd\.trim\(\)\)/.test(agentSrc), 'buildSystemPrompt 应注入 scratchpad');
    });
    t('agent-state 支持继续时恢复 requiredWrites', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/progress\/agent-state\.json/.test(agentSrc), '缺 agent-state 持久化路径');
      assert(/isContinueRequest/.test(agentSrc) && /agent_state_restored/.test(agentSrc), '缺继续语义恢复');
      assert(/writeAgentState\(ctx/.test(agentSrc), 'runAgent 结束应保存 agent state');
    });
    t('runTool 已拆成 policy wrapper 与 core 分派', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/async function runTool\(\{ name, args, ctx, emit \}\)[\s\S]{0,220}runToolWithPolicy/.test(agentSrc), 'runTool 应委托 policy wrapper');
      assert(/async function runToolCore\(\{ name, args, ctx, emit \}\)/.test(agentSrc), '缺 runToolCore');
      assert(/run: \(\) => runToolCore/.test(agentSrc), 'runToolWithPolicy 应调用 runToolCore');
    });
    t('工具执行支持超时保护', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/TOOL_TIMEOUT_MS/.test(agentSrc) && /TOOL_TIMEOUT_OVERRIDES/.test(agentSrc), '缺工具超时配置');
      assert(/withToolTimeout/.test(agentSrc) && /tool_timeout/.test(agentSrc), '缺 timeout wrapper 或 tool_timeout 错误');
      assert(/Promise\.race\(\[promise, timeout\]\)/.test(agentSrc), '工具超时应使用 Promise.race');
    });
    t('工具级退避只针对可重试工具错误', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/TOOL_BACKOFF_DELAYS/.test(agentSrc), '缺工具退避延迟配置');
      assert(/tool_backoff/.test(agentSrc), '缺 tool_backoff 事件');
      assert(/isRetryableToolError/.test(agentSrc) && /isRetryableReadTool/.test(agentSrc), '缺可重试判断');
    });
    t('gate 自动注入安全前置工具', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/autoInjectGateTool/.test(agentSrc) && /gate_auto_inject/.test(agentSrc), '缺 gate 自动注入');
      assert(/gateInjectionForBlock/.test(agentSrc), '缺 gate block 到工具的映射');
      assert(/buildWriteChapterGateBlock/.test(agentSrc) && /write_chapter_gate_missing/.test(agentSrc), '写章硬 gate 应可结构化自动补齐');
    });
    t('写入意图耗尽后改为软停 ask_user 而非 agent_giveup', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      assert(/function softStopForUser/.test(agentSrc) && /agent_soft_stop/.test(agentSrc), '缺软停函数或事件');
      assert(/softStopForUser\(\{ ctx, emit, reason: 'write_intent_unfulfilled'/.test(agentSrc), '写入耗尽应调用 softStopForUser');
      const remainingGiveups = (agentSrc.match(/reason: 'write_intent_unfulfilled'/g) || []).length;
      const softStops = (agentSrc.match(/softStopForUser\(\{ ctx, emit, reason: 'write_intent_unfulfilled'/g) || []).length;
      assert(remainingGiveups === softStops, 'write_intent_unfulfilled 不应再直接 agent_giveup');
    });
    t('soft-stop payload 含恢复选项与最后工具 hint', () => {
      const payload = buildSoftStopPayload({
        reason: 'write_intent_unfulfilled',
        tool: 'write_chapter',
        label: '第 1 章',
        turn: 3,
        ctx: { runEvents: [{ type: 'tool_result', name: 'write_chapter', ok: false, result: { error: { kind: 'bad_args', message: '参数错', hint: '补 title' } } }] },
      });
      assert(payload.options.length >= 4, '软停应给用户恢复选项');
      assert(payload.issue?.hint === '补 title', '软停应带最后工具 hint');
    });
    t('agent-state 支持非继续语义恢复提示', () => {
      const state = { requiredWrites: [{ tool: 'write_chapter', label: '第 2 章', done: false }], pendingRecovery: { reason: 'write_intent_unfulfilled' } };
      assert(shouldOfferAgentResume(state, '换个思路继续写'), '非精确 continue 也应可恢复');
      assert(/agent_resume_hint/.test(renderResumeHint(state)), '恢复提示应可注入 prompt');
    });
    t('TurnRunner 基础轮次快照可用', () => {
      const r = new TurnRunner({ maxTurns: 2 });
      assert(r.next().turn === 1, '第一轮应为 1');
      assert(turnRunnerSnapshot(r).remaining === 1, 'remaining 应正确');
      assert(r.next().turn === 2 && r.next().exceeded, '超过 maxTurns 应 exceeded');
    });
    t('写入预览与前端 UX 事件已接入', () => {
      const agentSrc = fs.readFileSync(path.join(ROOT, 'server/services/agent.js'), 'utf8');
      const turn = fs.readFileSync(path.join(ROOT, 'src/components/TurnTimeline.jsx'), 'utf8');
      const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
      const css = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
      assert(/chapterWritePreview/.test(agentSrc) && /editFilePreview/.test(agentSrc), '写入工具应 emit write_preview');
      assert(/write_preview/.test(turn) && /card-write-preview/.test(css), '前端缺写入预览卡');
      assert(/queuedMessages/.test(app) && /user_queued/.test(app), '缺中途指令队列');
      assert(editFilePreview({ path: 'a.md', old_str: '旧', new_str: '新的' }).delta === 1, 'editFilePreview delta 错误');
    });
    t('trace replay API 已提供摘要回放能力', () => {
      const indexSrc = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
      assert(/\/api\/trace\/replay/.test(indexSrc), '缺 trace replay endpoint');
      assert(/toolCalls/.test(indexSrc) && /toolErrors/.test(indexSrc) && /writes/.test(indexSrc), 'trace replay 应输出摘要统计');
    });
  });

  // 清理本次创建的所有 fixture 项目目录（约定：__*__ 包裹的内部项目）
  try {
    const novelsDir = path.join(ROOT, 'novels');
    if (fs.existsSync(novelsDir)) {
      const entries = fs.readdirSync(novelsDir, { withFileTypes: true });
      let cleaned = 0;
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const n = ent.name;
        if (n.startsWith('__') && n.endsWith('__')) {
          fs.rmSync(path.join(novelsDir, n), { recursive: true, force: true });
          cleaned++;
        }
      }
      if (cleaned > 0) console.log(`[eval] cleaned ${cleaned} fixture project dir(s)`);
    }
  } catch (e) {
    console.warn('[eval] fixture cleanup failed:', e?.message || e);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`eval: ${stats.passed}/${stats.total} passed${stats.failed ? `, ${stats.failed} failed` : ''}`);

  // 落盘报告，供未来 diff 用
  const outDir = path.join(ROOT, 'evals/runs');
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = {
    at: new Date().toISOString(),
    stats,
    results,
  };
  fs.writeFileSync(path.join(outDir, `${ts}.json`), JSON.stringify(report, null, 2));
  console.log(`report: evals/runs/${ts}.json`);

  if (stats.failed) process.exit(1);
}

main().catch((e) => {
  console.error('[eval] fatal:', e);
  process.exit(2);
});
