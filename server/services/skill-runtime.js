// Skill runtime guards: turn selected skill metadata into lightweight tool gates.
import { getSkillCatalog } from './skills.js';

const WRITE_TERMINAL_TOOLS = new Set(['write_chapter']);
const SETTING_MUTATION_TOOLS = new Set(['wiki_ingest', 'update_progress', 'edit_file', 'lookup_upsert', 'lookup_remove']);
const NON_DESTRUCTIVE_TOOLS = new Set(['read_file', 'setup_status', 'lookup_query', 'wiki_query', 'get_chapter_context', 'conflict_check', 'ask_user', 'plan_tasks', 'read_skill_section']);

export async function buildSkillRuntime({ projectName, selectedSkills = [] } = {}) {
  const catalog = await getSkillCatalog(projectName);
  const skills = [...new Set(selectedSkills)]
    .map((name) => catalog[name])
    .filter(Boolean);
  const mustCallTools = uniq(skills.flatMap((s) => s.mustCallTools || []));
  const forbidTools = uniq(skills.flatMap((s) => s.forbidTools || []));
  const phases = uniq(skills.map((s) => s.phase).filter(Boolean));
  const chainsTo = uniq(skills.flatMap((s) => s.chainsTo || []));
  return {
    skills: skills.map((s) => ({
      name: s.name,
      title: s.title,
      phase: s.phase,
      mustCallTools: s.mustCallTools || [],
      forbidTools: s.forbidTools || [],
      chainsTo: s.chainsTo || [],
    })),
    skillNames: skills.map((s) => s.name),
    mustCallTools,
    forbidTools,
    phases,
    chainsTo,
  };
}

export function createRuntimeToolState() {
  return {
    calledTools: new Set(),
    readFile: false,
    setupStatus: false,
    lookupQuery: false,
    conflictCheck: false,
  };
}

export function noteRuntimeToolSuccess(name, args, result, runtimeState) {
  if (!runtimeState || !name) return;
  runtimeState.calledTools.add(name);
  if (name === 'read_file') runtimeState.readFile = true;
  if (name === 'setup_status') runtimeState.setupStatus = true;
  if (name === 'lookup_query') runtimeState.lookupQuery = true;
  if (name === 'conflict_check') runtimeState.conflictCheck = true;
}

export function checkSkillToolGate({ name, args = {}, ctx = {} } = {}) {
  const runtime = ctx.skillRuntime;
  const state = ctx.toolState || {};
  if (!runtime || !name) return null;

  const forbidders = runtime.skills.filter((s) => (s.forbidTools || []).includes(name));
  if (forbidders.length && !NON_DESTRUCTIVE_TOOLS.has(name)) {
    return blocked({
      kind: 'skill_forbid_tool',
      tool: name,
      message: `当前 skill 禁止调用 ${name}`,
      hint: `先完成或退出这些 skill：${forbidders.map((s) => s.name).join('、')}。如果用户坚持跳过，请先 ask_user 确认。`,
      context: { skills: forbidders.map((s) => s.name) },
    });
  }

  if (WRITE_TERMINAL_TOOLS.has(name)) {
    const missing = requiredBeforeWrite(runtime, state, args);
    if (missing.length) {
      return blocked({
        kind: 'skill_must_call_tools',
        tool: name,
        message: `写章前缺少必要 skill 工具：${missing.join('、')}`,
        hint: `按顺序补齐：${missing.join(' → ')}，再重试 ${name}。`,
        context: { missing, mustCallTools: runtime.mustCallTools },
      });
    }
  }

  if (SETTING_MUTATION_TOOLS.has(name) && mustCheckConflictBeforeMutation(runtime, name, args, state)) {
    return blocked({
      kind: 'skill_conflict_check_required',
      tool: name,
      message: `修改设定前必须先调用 conflict_check`,
      hint: `先用 conflict_check 描述本次变更；若 risk=medium/high，必须 ask_user 让用户决定。`,
      context: { selectedSkills: runtime.skillNames, path: args.path || null },
    });
  }

  return null;
}

export function summarizeSkillRuntime(runtime) {
  if (!runtime) return '';
  const rows = [];
  if (runtime.skillNames?.length) rows.push(`skills=${runtime.skillNames.join(',')}`);
  if (runtime.mustCallTools?.length) rows.push(`must=${runtime.mustCallTools.join(',')}`);
  if (runtime.forbidTools?.length) rows.push(`forbid=${runtime.forbidTools.join(',')}`);
  if (runtime.chainsTo?.length) rows.push(`chains_to=${runtime.chainsTo.join(',')}`);
  return rows.join(' | ');
}

function requiredBeforeWrite(runtime, state, args) {
  const must = new Set(runtime.mustCallTools || []);
  const missing = [];
  if (must.has('get_chapter_context')) {
    const ch = Number(args.chapter || 0);
    if (!ch || !state.chapterContext?.has(ch)) missing.push('get_chapter_context');
  }
  if (must.has('setup_status') && !state.skillRuntime?.setupStatus) missing.push('setup_status');
  if (must.has('lookup_query') && !state.skillRuntime?.lookupQuery && !state.lookupQuery) missing.push('lookup_query');
  if (must.has('wiki_query') && !state.wikiQuery) missing.push('wiki_query');
  if (must.has('read_file') && !state.skillRuntime?.readFile) missing.push('read_file');
  return uniq(missing);
}

function mustCheckConflictBeforeMutation(runtime, name, args, state) {
  if (state.skillRuntime?.conflictCheck) return false;
  if (!(runtime.mustCallTools || []).includes('conflict_check')) return false;
  if (name === 'lookup_upsert' || name === 'lookup_remove') return false;
  if (name === 'update_progress') {
    const p = String(args.path || '');
    return /^knowledge\/(world\/|relationships\.md$)/.test(p);
  }
  return true;
}

function blocked({ kind, tool, message, hint, context }) {
  return { blocked: true, kind, tool, message, hint, context };
}

function uniq(arr) {
  return [...new Set((arr || []).map((x) => String(x || '').trim()).filter(Boolean))];
}
