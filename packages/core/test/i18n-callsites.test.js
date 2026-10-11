/**
 * {n} and {count} are numbers. A translator may turn any English string that has one of them
 * into plural forms (scripts/i18n-todo.mjs offers it that way in languages with more than one
 * form), and only a number can choose among the forms. So every call site of such a string
 * must pass a number there; text that is already words ("9 posts") goes in a param with
 * another name. These tests check the call sites in the source, and run the engine with every
 * such string turned into plural forms, the way a finished translation will have them.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  DICTIONARIES,
  describeRecurrence,
  formatDate,
  isPluralForms,
  joinList,
  milesText,
  pluralCategoriesFor,
  relativeDays,
  setBidiIsolation,
  setI18nWarnings,
  setLocale,
  t,
  tn,
} from '../src/index.js';
import { REPO_ROOT } from '../src/load-node.js';

const COUNT = /\{(?:n|count)\}/;

/** Every English key that counts: plural forms, or a string with {n} or {count}. */
function countingKeys(dict = DICTIONARIES.en, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPluralForms(v)) out.set(key, v);
    else if (typeof v === 'string') {
      if (COUNT.test(v)) out.set(key, v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) countingKeys(v, key, out);
  }
  return out;
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      if (!['node_modules', 'dist', 'locales'].includes(name)) yield* sourceFiles(file);
    } else if (/\.(?:m?js|jsx)$/.test(name)) yield file;
  }
}

/**
 * The arguments of the call whose "(" is at src[open], as source text, split at the commas
 * between them (strings, template literals and brackets are skipped over).
 */
function callArgs(src, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let j = open; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = src.indexOf(ch, j + 1);
      if (end === -1) return args;
      j = end;
    } else if ('{(['.includes(ch)) depth += 1;
    else if ('})]'.includes(ch)) {
      depth -= 1;
      if (depth === 0) {
        args.push(src.slice(start, j));
        return args.map((a) => a.trim()).filter(Boolean);
      }
    } else if (ch === ',' && depth === 1) {
      args.push(src.slice(start, j));
      start = j + 1;
    }
  }
  return args;
}

/** The properties of an object literal's source, as { name: expression } (shorthand: name). */
function properties(objectSource) {
  const inner = objectSource.slice(1, -1);
  const props = {};
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let j = 0; j <= inner.length; j += 1) {
    const ch = inner[j];
    if (j === inner.length || (ch === ',' && depth === 0)) {
      parts.push(inner.slice(start, j));
      start = j + 1;
    } else if ('{(['.includes(ch)) depth += 1;
    else if ('})]'.includes(ch)) depth -= 1;
    else if (ch === "'" || ch === '"' || ch === '`') j = inner.indexOf(ch, j + 1);
  }
  for (const part of parts) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*([\s\S]+?))?\s*$/.exec(part);
    if (m) props[m[1]] = m[2] === undefined ? m[1] : m[2];
  }
  return props;
}

/** Why an expression passed as {n} or {count} is text, not a number, or ''. */
function textReason(expr, fileSource) {
  const e = expr.trim();
  if (/^['"`]/.test(e)) return 'a string literal';
  if (/^(?:t|tn|tList|joinList|joinItems|labelValue|asSentence|String)\(/.test(e)) return `the text of ${e.split('(')[0]}()`;
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const decl = new RegExp(`(?:const|let|var)\\s+${e}\\s*=\\s*([^;\\n]+)`).exec(fileSource);
    if (decl && /(?:^|[^\w.])(?:t|tn|joinList|joinItems|labelValue)\(|`/.test(decl[1])) return `${e}, which is text (${decl[1].trim().slice(0, 60)})`;
  }
  return '';
}

/** Formatting helpers that keep a number readable as one ("1,234", "2.7"). */
const NUMBER_TEXT = /^(?:numberText|formatNumber|formatMiles)\(/;

test('every call that passes {n} or {count} passes a number', () => {
  const keys = countingKeys();
  const problems = [];
  const CALL = /(?<![\w.$])(t|tn)\(\s*(['"])([A-Za-z][\w-]*(?:\.[\w-]+)+)\2/g;
  for (const pkg of readdirSync(path.join(REPO_ROOT, 'packages'))) {
    const src = path.join(REPO_ROOT, 'packages', pkg, 'src');
    try {
      statSync(src);
    } catch {
      continue;
    }
    for (const file of sourceFiles(src)) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(CALL)) {
        const [, fn, , key] = m;
        if (!keys.has(key)) continue;
        const where = `${path.relative(REPO_ROOT, file)}:${code.slice(0, m.index).split('\n').length} ${fn}('${key}')`;
        const args = callArgs(code, m.index + fn.length);
        if (fn === 't') {
          const params = args[1];
          if (!params || params === 'undefined') {
            problems.push(`${where}: no {n} or {count} at all`);
            continue;
          }
          if (!params.startsWith('{')) continue; // params built elsewhere: checked at run time below
          const props = properties(params);
          const name = 'n' in props ? 'n' : 'count' in props ? 'count' : null;
          if (!name) {
            problems.push(`${where}: no {n} or {count} in ${params.slice(0, 60)}`);
            continue;
          }
          const why = textReason(props[name], code);
          if (why && !NUMBER_TEXT.test(props[name].trim())) problems.push(`${where}: {${name}} is ${why}`);
        } else {
          // tn(key, n, params): params may restate n only as that number formatted for reading.
          const params = args[2];
          if (!params || !params.startsWith('{')) continue;
          const props = properties(params);
          if ('n' in props && !NUMBER_TEXT.test(props.n.trim())) problems.push(`${where}: params replace {n} with ${props.n.trim().slice(0, 40)}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

/**
 * Run fn with every counting string of a language turned into plural forms (each form the
 * English text with its category in front), as a finished translation may have them.
 */
function withPluralForms(code, fn) {
  const saved = [];
  const forms = pluralCategoriesFor(code);
  const walk = (en, mine) => {
    for (const [k, v] of Object.entries(en)) {
      // The language's own value may already be plural forms (every finished language has
      // some); it is replaced the same way, so each form is tagged with its category.
      if (typeof v === 'string' && COUNT.test(v) && (typeof mine[k] === 'string' || isPluralForms(mine[k]))) {
        saved.push([mine, k, mine[k]]);
        mine[k] = Object.fromEntries(forms.map((c) => [c, `[${c}] ${v}`]));
      } else if (v && typeof v === 'object' && !Array.isArray(v) && !isPluralForms(v) && mine[k] && typeof mine[k] === 'object') walk(v, mine[k]);
    }
  };
  walk(DICTIONARIES.en, DICTIONARIES[code]);
  try {
    return fn();
  } finally {
    for (const [obj, k, v] of saved.reverse()) obj[k] = v;
  }
}

afterEach(() => {
  setLocale('en');
  setBidiIsolation(true);
  setI18nWarnings(null);
});

test('the engine composes its sentences from numbers when every count has plural forms', () => {
  const warnings = [];
  setI18nWarnings((m) => warnings.push(m));
  for (const code of ['ar', 'hi', 'te']) {
    withPluralForms(code, () => {
      setLocale(code);
      const out = [
        relativeDays('2026-10-14', '2026-10-11', code),
        relativeDays('2026-10-01', '2026-10-11', code),
        relativeDays('2026-11-30', '2026-10-11', code),
        milesText(2.7, code),
        milesText(14, code),
        describeRecurrence({ kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' }, code),
        formatDate('2026-10-12', { locale: code }),
        joinList(['Plano', 'Dallas'], code),
        tn('common.minutes', 3, undefined, code),
        t('common.showAll', { n: 4 }, code),
        t('insights.lead', { n: 39, days: tn('common.days', 60, undefined, code) }, code),
      ];
      for (const s of out) {
        assert.equal(typeof s, 'string', code);
        assert.doesNotMatch(s, /\{(?:n|count)\}/, `${code}: ${s}`);
      }
      // The form follows the number: Arabic "few" for 3 and "many" for 11, Hindi "one" for 1.
      if (code === 'ar') {
        assert.match(t('common.showAll', { n: 3 }, 'ar'), /^\[few\]/);
        assert.match(t('api.rateLimited', { n: 11 }, 'ar'), /^\[many\]/);
      }
      if (code === 'hi') assert.match(t('prepare.ruler.notePractice', { n: 1 }, 'hi'), /^\[one\]/);
    });
  }
  assert.deepEqual(warnings, []);
});
