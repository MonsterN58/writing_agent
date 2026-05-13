function normalizeDigits(s = '') {
  return String(s).replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
}

function cnToNumber(input = '') {
  const s = String(input || '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  const m = /^(?:(一|二|两|三|四|五|六|七|八|九))?十(?:(一|二|两|三|四|五|六|七|八|九))?$/.exec(s);
  if (m) return (m[1] ? map[m[1]] : 1) * 10 + (m[2] ? map[m[2]] : 0);
  return map[s] || null;
}

function volumeNoFromPath(path = '') {
  const m = /outline\/volumes\/volume-(\d+)\.md$/i.exec(path);
  return m ? Number(m[1]) : null;
}

function arcRangeFromPath(path = '') {
  const m = /章\s*(\d+)\s*-\s*(\d+)/.exec(path) || /arc-[^-]+-(\d+)-(\d+)\.md$/i.exec(path);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

function inclusiveCount(start, end) {
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start + 1 : null;
}

export function extractVolumePlan(overallMd = '') {
  const text = normalizeDigits(overallMd);
  const plans = new Map();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const n = cnToNumber((/第\s*([一二两三四五六七八九十\d]+)\s*卷/.exec(line) || [])[1]);
    if (!n) continue;
    const range = /第?\s*(\d+)\s*[章回]?\s*[-—~～至到]\s*第?\s*(\d+)\s*[章回]?/.exec(line);
    const countMatch = /(?:约|共|=|：|:|，|,|\s)(\d+)\s*章/.exec(line);
    const count = range ? inclusiveCount(Number(range[1]), Number(range[2])) : (countMatch ? Number(countMatch[1]) : null);
    if (count) plans.set(n, { volume: n, count, line: line.trim(), start: range ? Number(range[1]) : null, end: range ? Number(range[2]) : null });
  }
  return plans;
}

export function extractVolumeOutlineRange(content = '') {
  const text = normalizeDigits(content);
  const quoteRange = /预估[：:]?\s*(?:第)?\s*(\d+)\s*[章回]?\s*[-—~～至到]\s*(?:第)?\s*(\d+)\s*[章回]?/.exec(text);
  if (quoteRange) {
    const start = Number(quoteRange[1]);
    const end = Number(quoteRange[2]);
    return { start, end, count: inclusiveCount(start, end), via: 'estimate_range' };
  }
  const ranges = [...text.matchAll(/(?:起|承|转|合)[^\n\d]{0,12}(?:第)?\s*(\d+)\s*[章回]?\s*[-—~～至到]\s*(?:第)?\s*(\d+)\s*[章回]?/g)]
    .map((m) => ({ start: Number(m[1]), end: Number(m[2]) }))
    .filter((r) => inclusiveCount(r.start, r.end));
  if (ranges.length) {
    const start = Math.min(...ranges.map((r) => r.start));
    const end = Math.max(...ranges.map((r) => r.end));
    return { start, end, count: inclusiveCount(start, end), via: 'section_ranges' };
  }
  const countMatch = /(?:预估|约|共)\s*(\d+)\s*章/.exec(text);
  return countMatch ? { start: null, end: null, count: Number(countMatch[1]), via: 'count_only' } : null;
}

export function hasCanonEvidence(content = '', { kind = 'outline' } = {}) {
  const text = String(content || '');
  const hasSoul = /SOUL\.md|SOUL|红线|核心承诺|全书规模/.test(text);
  const hasOverall = /outline\/overall\.md|总纲锚点|总纲依据|总纲/.test(text);
  const hasCharacters = /knowledge\/entities|人物档案|角色档案|出场人物|人物依据|knowledge\/relationships|人物关系/.test(text);
  const hasVolume = kind === 'arc' ? /outline\/volumes|卷纲锚点|所属卷|卷纲/.test(text) : true;
  return { ok: hasSoul && hasOverall && hasCharacters && hasVolume, hasSoul, hasOverall, hasCharacters, hasVolume };
}

export function validateVolumeOutline({ path = '', content = '', overallMd = '' } = {}) {
  const volume = volumeNoFromPath(path);
  if (!volume) return { ok: true, issues: [] };
  const issues = [];
  const evidence = hasCanonEvidence(content, { kind: 'volume' });
  if (!evidence.ok) {
    issues.push({ kind: 'missing_canon_evidence', message: `卷纲必须显式写出 SOUL、总纲、人物档案/人物关系依据，当前缺失：${Object.entries(evidence).filter(([k, v]) => k !== 'ok' && !v).map(([k]) => k).join(', ')}` });
  }
  const plans = extractVolumePlan(overallMd);
  const expected = plans.get(volume);
  if (!expected) return { ok: issues.length === 0, issues };
  const actual = extractVolumeOutlineRange(content);
  if (!actual?.count) {
    issues.push({ kind: 'missing_volume_count', message: `卷纲必须标明第 ${volume} 卷覆盖章号或总章数；总纲要求：${expected.line}` });
  } else if (actual.count !== expected.count) {
    issues.push({ kind: 'volume_count_mismatch', message: `第 ${volume} 卷章数不匹配：总纲要求 ${expected.count} 章（${expected.line}），本卷纲写成 ${actual.count} 章。` });
  }
  if (expected.start && actual?.start && actual.start !== expected.start) {
    issues.push({ kind: 'volume_start_mismatch', message: `第 ${volume} 卷起始章不匹配：总纲第 ${expected.start} 章，本卷纲第 ${actual.start} 章。` });
  }
  if (expected.end && actual?.end && actual.end !== expected.end) {
    issues.push({ kind: 'volume_end_mismatch', message: `第 ${volume} 卷结束章不匹配：总纲第 ${expected.end} 章，本卷纲第 ${actual.end} 章。` });
  }
  return { ok: issues.length === 0, issues, expected, actual, evidence };
}

export function validateArcOutline({ path = '', content = '', volumeMd = '' } = {}) {
  if (!/^outline\/arcs\//i.test(path)) return { ok: true, issues: [] };
  const issues = [];
  const evidence = hasCanonEvidence(content, { kind: 'arc' });
  if (!evidence.ok) {
    issues.push({ kind: 'missing_canon_evidence', message: `细纲必须显式写出 SOUL、总纲、卷纲、人物档案/人物关系依据，当前缺失：${Object.entries(evidence).filter(([k, v]) => k !== 'ok' && !v).map(([k]) => k).join(', ')}` });
  }
  const arc = arcRangeFromPath(path);
  const volumeRange = extractVolumeOutlineRange(volumeMd);
  if (arc && volumeRange?.start && volumeRange?.end && (arc.start < volumeRange.start || arc.end > volumeRange.end)) {
    issues.push({ kind: 'arc_outside_volume', message: `细纲范围第 ${arc.start}-${arc.end} 章超出当前卷纲范围第 ${volumeRange.start}-${volumeRange.end} 章。` });
  }
  return { ok: issues.length === 0, issues, arc, volumeRange, evidence };
}

export async function validateOutlineWrite({ path = '', content = '', readProjectFile } = {}) {
  if (!path || typeof readProjectFile !== 'function') return { ok: true, issues: [] };
  if (/^outline\/volumes\/volume-\d+\.md$/i.test(path)) {
    const overallMd = await readProjectFile('outline/overall.md').catch(() => '') || '';
    return validateVolumeOutline({ path, content, overallMd });
  }
  if (/^outline\/arcs\//i.test(path)) {
    const range = arcRangeFromPath(path);
    let volumeMd = '';
    if (range) {
      const candidates = await Promise.all(Array.from({ length: 12 }, (_, i) => readProjectFile(`outline/volumes/volume-${i + 1}.md`).catch(() => '')));
      volumeMd = candidates.find((txt) => {
        const vr = extractVolumeOutlineRange(txt || '');
        return vr?.start && vr?.end && range.start >= vr.start && range.end <= vr.end;
      }) || candidates.find(Boolean) || '';
    }
    return validateArcOutline({ path, content, volumeMd });
  }
  return { ok: true, issues: [] };
}
