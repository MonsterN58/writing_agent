// 轻量 JSON Schema 校验：只实现 OpenAI function schema 常用子集，不引新依赖。
// 支持：type(string/integer/number/boolean/array/object)、required、enum、
//       minimum/maximum、minLength/maxLength、minItems/maxItems、items(递归)、
//       properties(递归)。未知关键字忽略。
//
// 用法：
//   const r = validateArgs(tool.function.parameters, args);
//   if (!r.ok) throw new ToolError('bad_args', r.message, r.hint);

export function validateArgs(schema, value, pathPrefix = '') {
  const errors = [];
  walk(schema, value, pathPrefix, errors);
  if (!errors.length) return { ok: true };
  const first = errors[0];
  const list = errors.slice(0, 6).map((e) => `  - ${e.path || '(root)'}: ${e.message}`).join('\n');
  return {
    ok: false,
    errors,
    message: first.message,
    hint: `工具参数不符合 schema（${errors.length} 处问题）：\n${list}${errors.length > 6 ? `\n  …共 ${errors.length} 条` : ''}\n请按 schema 修正参数后重试。`,
  };
}

function walk(schema, v, p, errs) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type) {
    if (!typeMatch(schema.type, v)) {
      errs.push({ path: p, kind: 'type', message: `类型应为 ${schema.type}，实得 ${describe(v)}` });
      return; // 类型都不对，后面细项没必要查
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(v)) {
    errs.push({ path: p, kind: 'enum', message: `值必须是 [${schema.enum.join(', ')}] 之一，实得 ${JSON.stringify(v)}` });
  }

  if (typeof v === 'string') {
    if (typeof schema.minLength === 'number' && v.length < schema.minLength) {
      errs.push({ path: p, kind: 'minLength', message: `长度不能短于 ${schema.minLength}，实得 ${v.length}` });
    }
    if (typeof schema.maxLength === 'number' && v.length > schema.maxLength) {
      errs.push({ path: p, kind: 'maxLength', message: `长度不能超过 ${schema.maxLength}，实得 ${v.length}` });
    }
  }

  if (typeof v === 'number') {
    if (typeof schema.minimum === 'number' && v < schema.minimum) {
      errs.push({ path: p, kind: 'minimum', message: `不能小于 ${schema.minimum}，实得 ${v}` });
    }
    if (typeof schema.maximum === 'number' && v > schema.maximum) {
      errs.push({ path: p, kind: 'maximum', message: `不能大于 ${schema.maximum}，实得 ${v}` });
    }
  }

  if (Array.isArray(v)) {
    if (typeof schema.minItems === 'number' && v.length < schema.minItems) {
      errs.push({ path: p, kind: 'minItems', message: `数组至少 ${schema.minItems} 项，实得 ${v.length}` });
    }
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) {
      errs.push({ path: p, kind: 'maxItems', message: `数组最多 ${schema.maxItems} 项，实得 ${v.length}` });
    }
    if (schema.items) {
      for (let i = 0; i < v.length; i++) {
        walk(schema.items, v[i], `${p}[${i}]`, errs);
      }
    }
  }

  if (v && typeof v === 'object' && !Array.isArray(v) && schema.type !== 'array') {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const k of required) {
      if (!(k in v) || v[k] === undefined) {
        errs.push({ path: p ? `${p}.${k}` : k, kind: 'required', message: `必填字段缺失` });
      }
    }
    const props = schema.properties || {};
    for (const [k, sub] of Object.entries(props)) {
      if (k in v) walk(sub, v[k], p ? `${p}.${k}` : k, errs);
    }
  }
}

function typeMatch(t, v) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && !Number.isNaN(v);
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return v != null && typeof v === 'object' && !Array.isArray(v);
    case 'null': return v === null;
    default: return true;
  }
}

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
