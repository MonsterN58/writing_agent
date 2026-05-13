/*
 * scripts/build-styles.mjs
 * 把 src/styles/<module>.css 按顺序拼合为 src/styles.css。
 * 拆分版本（src/styles/*.css）是开发主要编辑入口；
 * 聚合版本（src/styles.css）是 vite 构建 + evals 静态扫描的入口。
 *
 * 用法：node scripts/build-styles.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STYLES_DIR = path.join(ROOT, 'src', 'styles');
const OUT = path.join(ROOT, 'src', 'styles.css');

const ORDER = [
  'tokens.css',
  'base.css',
  'layout.css',
  'topbar.css',
  'chat.css',
  'cards.css',
  'hud.css',
  'preview.css',
  'side-panel.css',
];

const HEADER = `/* ============================================================ */
/* styles.css · v5 入口（聚合产物）                              */
/* 此文件由 src/styles/*.css 按顺序拼合而成。                    */
/* 主要编辑入口：src/styles/<module>.css；                       */
/* 重生成命令：node scripts/build-styles.mjs                      */
/* 备份历史版本：src/styles.legacy.css                            */
/* ============================================================ */

`;

const TRAILER = `

/* ============================================================ */
/* —— v5 兼容补丁：清理旧版残留与微调                            */
/* ============================================================ */
.bubble.assistant > .bubble-body,
.bubble.user .bubble-body,
.preview-content,
.welcome-title { font-family: var(--serif); letter-spacing: 0.01em; }
.tc-name, .hud-cost, .hud-row span, .stage-label,
.cp-shortcut, .char-count, .chat-count, .tasks-progress { font-variant-numeric: tabular-nums; }
.tc-name { font-family: var(--mono); font-size: 12px; }

[data-theme="dark"] .hud.hud-inline { background: var(--surface-2); }
[data-theme="dark"] .welcome-tip-btn { background: var(--surface-2); }
[data-theme="dark"] .welcome-tip-btn:hover { background: var(--accent-faint); }
[data-theme="dark"] .preview-pane { background: var(--surface-1); }
[data-theme="dark"] .ft-toolbar { background: var(--surface-1); }
[data-theme="dark"] .cp-panel { background: var(--surface-1); }
[data-theme="dark"] .scroll-to-bottom { background: var(--surface-2); }
[data-theme="dark"] .topbar { background: var(--surface-1); border-bottom-color: var(--line); }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) {
    color-scheme: dark;
  }
}

.chat .chat-input::before { display: none; }
.chat-input.deprecated-bar { display: none !important; }
.bubble.assistant .think-inline::before { display: none; }
`;

function main() {
  const parts = [HEADER];
  for (const name of ORDER) {
    const p = path.join(STYLES_DIR, name);
    if (!fs.existsSync(p)) {
      console.error('[build-styles] missing:', p);
      process.exit(1);
    }
    const c = fs.readFileSync(p, 'utf8');
    parts.push(`/* ==================== ${name} ==================== */\n`);
    parts.push(c);
    parts.push('\n');
  }
  parts.push(TRAILER);
  fs.writeFileSync(OUT, parts.join(''), 'utf8');
  const size = fs.statSync(OUT).size;
  console.log(`[build-styles] wrote src/styles.css (${size} bytes from ${ORDER.length} modules)`);
}

main();
