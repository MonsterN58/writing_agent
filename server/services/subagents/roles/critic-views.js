// 三视角 critic 子 Agent：canon / ai_taste / pace 独立各跑一遍，聚合后给验收委员会。
import { runSubAgent } from '../runner.js';

const VIEWS = {
  canon: `你是 canon 一致性审查员，只检查正文与 "# 人物状态（canon）" / "# Open 伏笔" / "# 世界硬规则" / "# 上章末状态快照" / "# Wiki hits" 是否冲突。
不看文采、不看节奏、不看 AI 味。
任何冲突 → severity=high，kind="canon"。
若 canon 不足以判断，不要瞎编问题，返回空 issues。`,

  ai_taste: `你是"去 AI 味"编辑，只抓以下问题，kind 固定 "ai_taste"：
- 四字成语堆叠（一段≥3 个）
- 抽象抒情（"心中涌起复杂的情感"之类不写具体动作）
- 破折号串场（单章超过 2 次）
- 鸡汤式 / 总结式结尾
- 所有角色同一书面腔，口吻无区分
不看剧情逻辑、不看 canon。没找到就 issues=[]、verdict=pass。`,

  pace: `你是节奏/钩子审查员，只看：
- 开篇 200 字是否有抓手（无 → severity=medium，kind="pace"）
- 段落是否过长导致拖沓（单段 > 400 字连续 ≥2 段 → medium）
- 章末是否有钩子（平淡或硬收 → high）
不看文字风格。没问题就 issues=[]、verdict=pass。`,
};

const SCHEMA = {
  verdict: 'pass | needs_polish | rewrite',
  score: '0-100',
  issues: [{ kind: 'string', severity: 'high|medium|low', quote: 'string', problem: 'string', suggestion: 'string' }],
  keep_highlights: ['string'],
};

export async function criticView({ view, chapter, title, content, context, signal, emit }) {
  const sys = `${VIEWS[view]}\n\n## 输出\n严格 JSON：{verdict, score, issues[], keep_highlights[]}。`;
  const user = [
    context ? `# 背景（canon）\n${context}\n` : '',
    `# 第 ${chapter || '?'} 章${title ? ' · ' + title : ''}`,
    content,
  ].join('\n');
  return runSubAgent({
    role: `critic-${view}`,
    systemPrompt: sys,
    userPrompt: user,
    schema: SCHEMA,
    signal,
    emit,
    timeoutMs: 90000,
  });
}

/**
 * 三视角并行跑，聚合为单一判决。
 * @returns {Promise<{verdict:string, score:number|null, issues:Array, keep_highlights:Array, views:Array}>}
 */
export async function criticAllViews({ chapter, title, content, context, signal, emit }) {
  const views = ['canon', 'ai_taste', 'pace'];
  const results = await Promise.all(
    views.map((v) => criticView({ view: v, chapter, title, content, context, signal, emit }))
  );
  const issues = [];
  const keep = [];
  const scores = [];
  for (let i = 0; i < views.length; i++) {
    const r = results[i];
    if (r.ok && r.data) {
      if (Array.isArray(r.data.issues)) issues.push(...r.data.issues.map((x) => ({ ...x, _view: views[i] })));
      if (Array.isArray(r.data.keep_highlights)) keep.push(...r.data.keep_highlights);
      if (Number.isFinite(r.data.score)) scores.push(r.data.score);
    }
  }
  const hasHigh = issues.some((x) => x.severity === 'high');
  const hasMed = issues.some((x) => x.severity === 'medium');
  const verdict = hasHigh ? 'rewrite' : hasMed ? 'needs_polish' : 'pass';
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  return {
    verdict,
    score,
    issues,
    keep_highlights: keep,
    views: results.map((r, i) => ({ view: views[i], ok: r.ok, ms: r.ms, error: r.error })),
  };
}
