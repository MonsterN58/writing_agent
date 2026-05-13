const READ_TOOLS = new Set([
  'list_projects',
  'read_soul',
  'list_files',
  'setup_status',
  'read_file',
  'list_chapters',
  'get_chapter_context',
  'prepare_write_chapter',
  'wiki_query',
  'lookup_query',
  'lookup_list',
  'conflict_check',
  'search_chapters',
  'chapter_critic',
  'read_skill_section',
  'list_user_skills',
]);

const TERMINAL_TOOLS = new Set([
  'ask_user',
  'finish_task',
  'write_chapter',
  'export_novel',
]);

const TOOL_ORDER = new Map([
  ['list_projects', 5],
  ['create_project', 8],
  ['switch_project', 8],
  ['setup_status', 10],
  ['prepare_write_chapter', 12],
  ['list_files', 15],
  ['list_chapters', 15],
  ['read_soul', 18],
  ['read_file', 20],
  ['get_chapter_context', 25],
  ['lookup_query', 28],
  ['wiki_query', 30],
  ['conflict_check', 35],
  ['chapter_critic', 40],
  ['backup_file', 45],
  ['edit_file', 55],
  ['setup_work', 60],
  ['setup_repair', 62],
  ['update_progress', 65],
  ['write_outline', 70],
  ['wiki_ingest', 75],
  ['wiki_archive', 76],
  ['wiki_lint', 76],
  ['write_chapter', 90],
  ['finish_task', 94],
  ['ask_user', 95],
]);

export const TOOL_META = {
  readTools: READ_TOOLS,
  terminalTools: TERMINAL_TOOLS,
};

export function toolPriority(name) {
  return TOOL_ORDER.get(name) ?? 50;
}

export function isReadTool(name) {
  return READ_TOOLS.has(name);
}

export function isTerminalTool(name) {
  return TERMINAL_TOOLS.has(name);
}

export function sortToolCallsForExecution(toolCalls = []) {
  return [...toolCalls]
    .map((tc, index) => ({ tc, index }))
    .sort((a, b) => {
      const pa = toolPriority(a.tc?.function?.name);
      const pb = toolPriority(b.tc?.function?.name);
      return pa === pb ? a.index - b.index : pa - pb;
    })
    .map((x) => x.tc);
}

export function describeToolMeta(name) {
  return {
    name,
    priority: toolPriority(name),
    readOnly: isReadTool(name),
    terminal: isTerminalTool(name),
  };
}
