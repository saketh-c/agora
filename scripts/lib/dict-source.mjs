/**
 * Read and edit dictionary source files (packages/core/src/i18n/locales/<code>/<namespace>.js)
 * without disturbing anything a person wrote. The files are one `export default { ... }` object
 * literal of strings, arrays and nested objects, with comments. Edits rewrite only the literals
 * they change: comments, key order, quoting of untouched strings, indentation and blank lines
 * stay exactly as they were.
 *
 *   const doc = parseDictSource(source);
 *   doc.get('glossary[2].term')            -> { type: 'string', value, start, end }
 *   const out = editDictSource(source, [
 *     { path: 'today', value: 'اليوم' },                      // replace a string
 *     { path: 'minutes', value: { zero: '...', other: '...' } } // set plural forms
 *     { path: 'minutes.one', remove: true },                   // drop a plural form
 *   ]);
 */

/** A source the parser cannot read, with the line it stopped on. */
export class DictSourceError extends Error {
  constructor(message, src, pos) {
    const line = src.slice(0, pos).split('\n').length;
    super(`${message} (line ${line})`);
    this.name = 'DictSourceError';
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new DictSourceError('Unclosed comment', src, i);
      i = end + 2;
      continue;
    }
    if ('{}[]:,;'.includes(ch)) {
      tokens.push({ t: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\n') throw new DictSourceError('Line break inside a string', src, j);
        if (src[j] === '\\') {
          const next = src[j + 1];
          const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
          if (next === 'u') {
            const braced = /^\{([0-9a-fA-F]+)\}/.exec(src.slice(j + 2));
            if (braced) {
              value += String.fromCodePoint(parseInt(braced[1], 16));
              j += 3 + braced[0].length - 1;
            } else {
              value += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16));
              j += 6;
            }
            continue;
          }
          if (next === 'x') {
            value += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16));
            j += 4;
            continue;
          }
          value += Object.prototype.hasOwnProperty.call(simple, next) ? simple[next] : next;
          j += 2;
          continue;
        }
        value += src[j];
        j += 1;
      }
      if (j >= src.length) throw new DictSourceError('Unclosed string', src, i);
      tokens.push({ t: 'str', value, quote: ch, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (ch === '`') throw new DictSourceError('Template literals are not supported in dictionaries', src, i);
    const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (m) {
      tokens.push({ t: 'id', value: m[0], start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    throw new DictSourceError(`Unexpected character ${JSON.stringify(ch)}`, src, i);
  }
  return tokens;
}

/** Parse a dictionary source into nodes that remember where they are. */
export function parseDictSource(src) {
  const tokens = tokenize(src);
  let k = tokens.findIndex((tok, i) => tok.t === 'id' && tok.value === 'export' && tokens[i + 1] && tokens[i + 1].value === 'default');
  if (k === -1) throw new DictSourceError('No "export default"', src, 0);
  k += 2;
  const peek = () => tokens[k];
  const take = (type) => {
    const tok = tokens[k];
    if (!tok || (type && tok.t !== type)) throw new DictSourceError(`Expected ${type}`, src, tok ? tok.start : src.length);
    k += 1;
    return tok;
  };

  function value() {
    const tok = peek();
    if (!tok) throw new DictSourceError('Unexpected end of file', src, src.length);
    if (tok.t === 'str') {
      take('str');
      return { type: 'string', value: tok.value, quote: tok.quote, start: tok.start, end: tok.end };
    }
    if (tok.t === '{') return object();
    if (tok.t === '[') return array();
    throw new DictSourceError(`Unexpected ${tok.t === 'id' ? tok.value : tok.t}`, src, tok.start);
  }

  function object() {
    const open = take('{');
    const props = [];
    while (peek() && peek().t !== '}') {
      const keyTok = peek();
      if (keyTok.t !== 'id' && keyTok.t !== 'str') throw new DictSourceError('Expected a key', src, keyTok.start);
      take();
      take(':');
      const node = value();
      let commaEnd = null;
      if (peek() && peek().t === ',') commaEnd = take(',').end;
      props.push({ key: keyTok.value, keyStart: keyTok.start, node, end: node.end, commaEnd });
    }
    const close = take('}');
    return { type: 'object', start: open.start, end: close.end, closeStart: close.start, props };
  }

  function array() {
    const open = take('[');
    const items = [];
    while (peek() && peek().t !== ']') {
      const node = value();
      let commaEnd = null;
      if (peek() && peek().t === ',') commaEnd = take(',').end;
      items.push({ node, commaEnd });
    }
    const close = take(']');
    return { type: 'array', start: open.start, end: close.end, closeStart: close.start, items };
  }

  const root = value();
  return {
    root,
    /** The node at a path like 'a.b', 'list[2].term' or 'forms.one', or null. */
    get(path) {
      let node = root;
      for (const part of splitPath(path)) {
        if (!node) return null;
        if (typeof part === 'number') node = node.type === 'array' && node.items[part] ? node.items[part].node : null;
        else node = node.type === 'object' ? (node.props.find((p) => p.key === part) || {}).node || null : null;
      }
      return node;
    },
    /** The property record of an object member at a path (for removals and insertions). */
    prop(path) {
      const parts = splitPath(path);
      const last = parts.pop();
      const parent = parts.length ? this.get(joinPath(parts)) : root;
      if (!parent || parent.type !== 'object' || typeof last !== 'string') return null;
      return { parent, prop: parent.props.find((p) => p.key === last) || null };
    },
  };
}

/** 'a.b[2].c' -> ['a', 'b', 2, 'c'] */
export function splitPath(path) {
  const out = [];
  for (const part of String(path).split('.')) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m) throw new Error(`Bad key path ${path}`);
    out.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out;
}

export function joinPath(parts) {
  return parts.reduce((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : acc ? `${acc}.${p}` : p), '');
}

/**
 * A JavaScript string literal for a value, in the files' style: single quotes, or double
 * quotes when the text has an apostrophe and no double quote.
 */
export function quoteString(value, prefer = "'") {
  const text = String(value);
  const escape = (s, q) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)
      .split(q)
      .join(`\\${q}`);
  const q = text.includes("'") && !text.includes('"') ? '"' : prefer === '"' && !text.includes('"') ? '"' : "'";
  return `${q}${escape(text, q)}${q}`;
}

function quoteKey(key) {
  return IDENT.test(key) ? key : quoteString(key);
}

function lineStartOf(src, pos) {
  return src.lastIndexOf('\n', pos - 1) + 1;
}

function indentAt(src, pos) {
  const start = lineStartOf(src, pos);
  return /^[ \t]*/.exec(src.slice(start))[0];
}

const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** An object literal for plural forms (or any flat map of strings), indented under `indent`. */
export function objectLiteral(map, indent) {
  const keys = Object.keys(map).sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const inner = `${indent}  `;
  return `{\n${keys.map((key) => `${inner}${quoteKey(key)}: ${quoteString(map[key])},`).join('\n')}\n${indent}}`;
}

/**
 * Apply edits to a dictionary source and return the new source. Each edit is one of:
 *  - { path, value: 'text' }           replace the string at path (it must exist and be a string);
 *  - { path, value: { one, other } }    make path a plural object with exactly these forms
 *                                       (a string becomes an object; an object keeps its
 *                                       forms' places, gains new ones and loses the rest);
 *  - { path, remove: true }             drop an object member (a plural form);
 *  - { path, value, after: 'key' }      add a new member (a string or plural forms) right after
 *                                       its sibling `key`, on its own line (new English keys).
 * Throws on a path that does not exist or does not fit, so a bad work file never half-applies.
 */
export function editDictSource(src, edits) {
  const doc = parseDictSource(src);
  const splices = [];
  const splice = (start, end, text) => splices.push({ start, end, text });

  for (const edit of edits) {
    if (edit.remove) {
      const found = doc.prop(edit.path);
      if (!found || !found.prop) throw new Error(`No member at ${edit.path}`);
      const { prop } = found;
      const from = lineStartOf(src, prop.keyStart);
      let to = prop.commaEnd || prop.end;
      if (src[to] === '\n') to += 1;
      splice(from, to, '');
      continue;
    }
    if (edit.after && !doc.get(edit.path)) {
      const parts = splitPath(edit.path);
      const key = parts.pop();
      const parent = parts.length ? doc.get(joinPath(parts)) : doc.root;
      if (!parent || parent.type !== 'object') throw new Error(`No object for ${edit.path}`);
      const sibling = parent.props.find((p) => p.key === edit.after);
      if (!sibling) throw new Error(`No ${edit.after} to put ${edit.path} after`);
      const indent = indentAt(src, sibling.keyStart);
      const value = typeof edit.value === 'string' ? quoteString(edit.value) : objectLiteral(edit.value, indent);
      const line = `\n${indent}${quoteKey(key)}: ${value},`;
      if (sibling.commaEnd) splice(sibling.commaEnd, sibling.commaEnd, line);
      else splice(sibling.end, sibling.end, `,${line.replace(/,$/, '')}`);
      continue;
    }
    const node = doc.get(edit.path);
    if (!node) throw new Error(`No entry at ${edit.path}`);
    if (typeof edit.value === 'string') {
      if (node.type !== 'string') throw new Error(`${edit.path} is not a string in the source`);
      if (node.value !== edit.value) splice(node.start, node.end, quoteString(edit.value, node.quote));
      continue;
    }
    const forms = edit.value;
    if (!forms || typeof forms !== 'object' || Array.isArray(forms)) throw new Error(`${edit.path}: unsupported value`);
    if (node.type === 'string') {
      splice(node.start, node.end, objectLiteral(forms, indentAt(src, node.start)));
      continue;
    }
    if (node.type !== 'object') throw new Error(`${edit.path} is not an object in the source`);
    const memberIndent = node.props.length ? indentAt(src, node.props[0].keyStart) : `${indentAt(src, node.start)}  `;
    const present = new Set(node.props.map((p) => p.key));
    for (const prop of node.props) {
      if (!(prop.key in forms)) {
        const from = lineStartOf(src, prop.keyStart);
        let to = prop.commaEnd || prop.end;
        if (src[to] === '\n') to += 1;
        splice(from, to, '');
      } else if (prop.node.type !== 'string') {
        throw new Error(`${edit.path}.${prop.key} is not a string in the source`);
      } else if (prop.node.value !== forms[prop.key]) {
        splice(prop.node.start, prop.node.end, quoteString(forms[prop.key], prop.node.quote));
      }
    }
    // New forms go in CLDR order: before the first present form that comes after them.
    for (const key of ORDER.filter((c) => c in forms && !present.has(c)).concat(Object.keys(forms).filter((c) => !ORDER.includes(c) && !present.has(c)))) {
      const line = `${memberIndent}${quoteKey(key)}: ${quoteString(forms[key])},\n`;
      const after = node.props.find((p) => ORDER.indexOf(p.key) > ORDER.indexOf(key));
      if (after) splice(lineStartOf(src, after.keyStart), lineStartOf(src, after.keyStart), line);
      else {
        const last = node.props[node.props.length - 1];
        if (last && !last.commaEnd) splice(last.end, last.end, ',');
        splice(lineStartOf(src, node.closeStart), lineStartOf(src, node.closeStart), line);
      }
    }
  }

  // Apply from the end so earlier positions stay valid; inserts at one place keep their order.
  const ordered = splices.map((s, i) => ({ ...s, i })).sort((a, b) => b.start - a.start || b.end - a.end || b.i - a.i);
  let out = src;
  for (let i = 0; i < ordered.length; i += 1) {
    const s = ordered[i];
    const prev = ordered[i - 1];
    if (prev && s.end > prev.start && !(s.start === s.end || prev.start === prev.end)) throw new Error('Overlapping edits');
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  parseDictSource(out);
  return out;
}

/** The plain value a node stands for (strings, arrays, objects), like the module's default export. */
export function nodeValue(node) {
  if (node.type === 'string') return node.value;
  if (node.type === 'array') return node.items.map((it) => nodeValue(it.node));
  return Object.fromEntries(node.props.map((p) => [p.key, nodeValue(p.node)]));
}
