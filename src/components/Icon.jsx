import React from 'react';

/**
 * 统一 SVG 图标系统。
 * 用法：<Icon name="brain" size={14} />
 *
 * 所有图标基于 lucide 风格（24x24 viewBox，stroke-based，stroke-width=2）。
 * stroke 默认 currentColor，外层文字色 = 图标色。
 */

const PATHS = {
  // 通用
  'message-square': 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  'file-text': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  'send': ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z'],
  'square': 'M3 3h18v18H3z', // stop
  'plus': ['M12 5v14', 'M5 12h14'],
  'trash-2': ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  'x': ['M18 6L6 18', 'M6 6l12 12'],
  'check': 'M20 6L9 17l-5-5',
  'check-circle': ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-left': 'M15 18l-6-6 6-6',
  'sparkles': ['M12 3l1.9 5.8L19 10l-5.1 1.2L12 17l-1.9-5.8L5 10l5.1-1.2z', 'M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z', 'M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z'],

  // 思考 / 反馈
  'brain': ['M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z', 'M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z'],
  'help-circle': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  'octagon-alert': ['M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z', 'M12 8v4', 'M12 16h.01'],
  'alert-triangle': ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],

  // 任务 / 状态
  'list-todo': ['M3 4h.01', 'M3 12h.01', 'M3 20h.01', 'M8 4h13', 'M8 12h13', 'M8 20h13'],
  'clock': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  'play': 'M5 3l14 9-14 9V3z',
  'skip-forward': ['M5 4l10 8-10 8V4z', 'M19 5v14'],

  // 工具 / 文件 / 章节
  'wrench': 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  'package': ['M16.5 9.4l-9-5.19', 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.27 6.96L12 12.01l8.73-5.05', 'M12 22V12'],
  'pen-line': ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
  'book-open': ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  'bar-chart-2': ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
  'stethoscope': ['M11 2v2', 'M5 2v2', 'M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1', 'M8 15a6 6 0 0 0 12 0v-3', 'M20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  'message-circle': 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z',
  'lightbulb': ['M9 18h6', 'M10 22h4', 'M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z'],
  'compass': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z'],
  'ruler': 'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0zM7.5 10.5l2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2M16.5 1.5l2 2',
  'pause': ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
  'zap': 'M13 2L3 14h9l-1 8 10-12h-9z',
  'rotate-ccw': ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  'corner-down-left': ['M9 10l-5 5 5 5', 'M20 4v7a4 4 0 0 1-4 4H4'],
  'circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  'history': ['M3 3v5h5', 'M3.05 13A9 9 0 1 0 6 5.3L3 8', 'M12 7v5l4 2'],
  'maximize': ['M3 3h6', 'M3 3v6', 'M21 3h-6', 'M21 3v6', 'M3 21h6', 'M3 21v-6', 'M21 21h-6', 'M21 21v-6'],
  'minimize': ['M8 3v5H3', 'M21 8h-5V3', 'M16 21v-5h5', 'M3 16h5v5'],
  'folder': 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  'panel-left-close': ['M3 3h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18', 'M16 15l-3-3 3-3'],
  'panel-left-open': ['M3 3h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18', 'M14 9l3 3-3 3'],
  'database': ['M12 8c5 0 9-1.34 9-3s-4-3-9-3-9 1.34-9 3 4 3 9 3z', 'M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5', 'M3 12c0 1.66 4 3 9 3s9-1.34 9-3'],
  'eye': ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  'wand': ['M15 4V2', 'M15 16v-2', 'M8 9h2', 'M20 9h2', 'M17.8 11.8L19 13', 'M15 9h.01', 'M17.8 6.2L19 5', 'M3 21l9-9', 'M12.2 6.2L11 5'],
  'sun': ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.22 4.22l1.42 1.42', 'M18.36 18.36l1.42 1.42', 'M1 12h2', 'M21 12h2', 'M4.22 19.78l1.42-1.42', 'M18.36 5.64l1.42-1.42'],
  'moon': 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  // 成本 / 模型 / 追踪 / 扩展
  'coins': ['M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z'],
  'cpu': ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 9h6v6H9z', 'M3 10h2', 'M3 14h2', 'M19 10h2', 'M19 14h2', 'M10 3v2', 'M14 3v2', 'M10 19v2', 'M14 19v2'],
  'git-branch': ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'],
  'copy': ['M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  'download': ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  'chevrons-down': ['M7 13l5 5 5-5', 'M7 6l5 5 5-5'],
  'trending-up': ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  'shield': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  'sliders-horizontal': ['M21 6H8', 'M5 6H3', 'M21 12H12', 'M9 12H3', 'M21 18H16', 'M13 18H3', 'M6 4v4', 'M10 10v4', 'M14 16v4'],
};

const ICON_MAP = {
  // 顶部 / 输入
  brand: 'sparkles',
  send: 'send',
  stop: 'square',
  plus: 'plus',
  close: 'x',
  trash: 'trash-2',
  back: 'corner-down-left',
  rotate: 'rotate-ccw',
  expand: 'maximize',
  collapse: 'minimize',
  history: 'history',
  eye: 'eye',
  panelClose: 'panel-left-close',
  panelOpen: 'panel-left-open',
  sun: 'sun',
  moon: 'moon',
  // 对话
  user: 'message-circle',
  assistant: 'sparkles',
  thinking: 'brain',
  ask: 'help-circle',
  giveup: 'octagon-alert',
  warn: 'alert-triangle',
  welcome: 'wand',
  // 文件 / 预览
  file: 'file-text',
  folder: 'folder',
  preview: 'file-text',
  feedback: 'message-circle',
  // 任务
  tasks: 'list-todo',
  taskPending: 'clock',
  taskDoing: 'play',
  taskDone: 'check-circle',
  taskSkip: 'skip-forward',
  // 时间线 / 工具事件
  tool: 'wrench',
  toolResult: 'package',
  fileWrite: 'pen-line',
  pen: 'pen-line',
  chapter: 'book-open',
  score: 'bar-chart-2',
  critic: 'stethoscope',
  memory: 'database',
  intent: 'compass',
  promptSize: 'ruler',
  reasoning: 'lightbulb',
  turnStart: 'clock',
  llmDone: 'zap',
  turnEnd: 'corner-down-left',
  done: 'check-circle',
  error: 'octagon-alert',
  skill: 'sparkles',
  pause: 'pause',
  reviewAlert: 'alert-triangle',
  bullet: 'circle',
  chevronDown: 'chevron-down',
  chevronRight: 'chevron-right',
  chevronLeft: 'chevron-left',
  chevronsDown: 'chevrons-down',
  // HUD / cards
  coins: 'coins',
  cpu: 'cpu',
  branch: 'git-branch',
  copy: 'copy',
  download: 'download',
  trending: 'trending-up',
  shield: 'shield',
  refresh: 'rotate-ccw',
  package: 'package',
  clock: 'clock',
  square: 'square',
  at: 'compass',
  question: 'help-circle',
  sparkles: 'sparkles',
  settings: 'sliders-horizontal',
};

export default function Icon({ name, size = 16, strokeWidth = 2, className = '', style, ...rest }) {
  const resolved = ICON_MAP[name] || name;
  const path = PATHS[resolved];
  if (!path) {
    // 找不到就画一个空圆，避免崩
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={`icon ${className}`} aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
      </svg>
    );
  }
  const paths = Array.isArray(path) ? path : [path];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className}`}
      style={style}
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
