export function parseFrontmatter(text) {
  const raw = String(text || '');
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { data: {}, body: raw };
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data = parseYamlLite(m[1]);
  return { data, body: raw.slice(m[0].length) };
}

export function stringifyFrontmatter(data, body = '') {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data || {})) {
    if (value == null || value === '') continue;
    lines.push(`${key}: ${formatYamlValue(value)}`);
  }
  lines.push('---', '', String(body || '').replace(/^\s+/, ''));
  return lines.join('\n');
}

function parseYamlLite(src) {
  const data = {};
  const lines = String(src || '').split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const idx = s.indexOf(':');
    if (idx <= 0) continue;
    const key = s.slice(0, idx).trim();
    const value = s.slice(idx + 1).trim();
    data[key] = parseYamlValue(value);
  }
  return data;
}

function parseYamlValue(value) {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => unquote(x.trim())).filter(Boolean);
  }
  return unquote(value);
}

function formatYamlValue(value) {
  if (Array.isArray(value)) return `[${value.map((x) => quoteIfNeeded(String(x))).join(', ')}]`;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return quoteIfNeeded(String(value));
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function quoteIfNeeded(s) {
  if (!s) return '""';
  if (/^[\w\-\u4e00-\u9fa5 .\/]+$/.test(s) && !/^(true|false|null|\d)/i.test(s)) return s;
  return JSON.stringify(s);
}
