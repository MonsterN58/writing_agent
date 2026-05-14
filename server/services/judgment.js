import { scoreChapterContent } from './quality.js';
import { criticAllViews } from './subagents/roles/critic-views.js';
import { checkBeats } from './beat-checker.js';
import { buildFailureStats } from './agent-intelligence.js';

export async function judgeQuality({ projectName, chapter, title, content, context = '', prevEnding = '', anchors = [], signal, emit, acceptanceConfig = null, critic = null, beatCheck = null, consistency = null, readerScore = null } = {}) {
  const quality = scoreChapterContent({ content, chapter, title, prevEnding, anchors });
  const [criticRes, beatRes] = await Promise.all([
    critic || criticAllViews({ chapter, title, content, context, signal, emit }),
    beatCheck || checkBeats({ projectName, chapter, content, signal, emit }).catch((e) => ({ ok: false, error: String(e?.message || e), skipped: true })),
  ]);

  const scoreParts = [quality.total];
  const blockers = [];
  const advisories = [];

  if (criticRes?.score != null) scoreParts.push(Number(criticRes.score));
  if (readerScore?.composite != null) scoreParts.push(Number(readerScore.composite));
  if (beatRes?.ok && typeof beatRes.hitRate === 'number') scoreParts.push(Math.round(beatRes.hitRate * 100));
  if (consistency?.summary) {
    const penalty = (consistency.summary.critical || 0) * 12 + (consistency.summary.warning || 0) * 4;
    scoreParts.push(Math.max(0, 100 - penalty));
  }

  const score = Math.round(scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length);
  const highIssues = Array.isArray(criticRes?.issues) ? criticRes.issues.filter((x) => x.severity === 'high').length : 0;
  const mediumIssues = Array.isArray(criticRes?.issues) ? criticRes.issues.filter((x) => x.severity === 'medium').length : 0;
  if (highIssues > 0) blockers.push(`critic:high×${highIssues}`);
  if (criticRes?.verdict === 'rewrite') blockers.push('critic.verdict=rewrite');
  if (quality.wordCount && quality.wordCount < 1500) blockers.push(`word_count=${quality.wordCount}<1500`);
  if (mediumIssues > 3) advisories.push(`critic:medium×${mediumIssues}`);

  if (beatRes?.ok) {
    if (beatRes.hitRate < 0.7) blockers.push(`beat_hit_rate=${Math.round(beatRes.hitRate * 100)}%`);
    if (beatRes.miss > 1) blockers.push(`beats:miss×${beatRes.miss}`);
  } else if (beatRes?.skipped) {
    advisories.push(`beat-check skipped: ${beatRes.error || '无大纲'}`);
  }

  if (consistency?.summary) {
    if ((consistency.summary.critical || 0) > 0) blockers.push(`consistency:critical×${consistency.summary.critical}`);
    if ((consistency.summary.warning || 0) > 2) advisories.push(`consistency:warning×${consistency.summary.warning}`);
  }

  if (readerScore?.composite != null && readerScore.composite < 55) advisories.push(`reader_score=${readerScore.composite}`);

  const decision = blockers.length ? 'revise' : advisories.length ? 'pass_with_warnings' : 'pass';
  const failureStats = buildFailureStats([]);
  return {
    decision,
    score,
    quality,
    critic: criticRes,
    beatCheck: beatRes,
    consistency,
    readerScore,
    blockers,
    advisories,
    failureStats,
  };
}
