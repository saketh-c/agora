/**
 * Create the files a new language needs, ready for translators:
 *  - packages/core/src/i18n/locales/<code>/<namespace>.js: a copy of each English file,
 *    comments included, with every plural object given exactly the forms the language's
 *    plural rules use (Arabic gets zero, one, two, few, many and other; Chinese only other),
 *    each form starting as the English text it replaces;
 *  - packages/core/src/i18n/locales/<code>/index.js, assembling the namespaces;
 *  - data/i18n/<code>.json, an empty translation memory for city data.
 * Files that already exist are never overwritten. Register the language in
 * packages/core/src/i18n/runtime.js (LOCALES and LOADERS) and index.js first.
 *
 * Usage: node scripts/i18n-scaffold.mjs zh hi te ar
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCALES, isPluralForms, pluralCategoriesFor } from '../packages/core/src/i18n/runtime.js';
import { editDictSource, nodeValue, parseDictSource } from './lib/dict-source.mjs';
import { DATA_I18N_DIR, LOCALES_DIR, namespaces } from './lib/i18n-tools.mjs';

/** Paths of every plural object in a parsed dictionary source. */
function pluralPaths(node, at = '') {
  if (node.type === 'object') {
    if (isPluralForms(nodeValue(node))) return [at];
    return node.props.flatMap((p) => pluralPaths(p.node, at ? `${at}.${p.key}` : p.key));
  }
  if (node.type === 'array') return node.items.flatMap((it, i) => pluralPaths(it.node, `${at}[${i}]`));
  return [];
}

/** The English source of a namespace, with its plural objects reshaped for `code`. */
export function scaffoldNamespace(englishSource, code) {
  const doc = parseDictSource(englishSource);
  const required = pluralCategoriesFor(code);
  const edits = pluralPaths(doc.root).map((p) => {
    const english = nodeValue(doc.get(p));
    return { path: p, value: Object.fromEntries(required.map((c) => [c, english[c] ?? english.other])) };
  });
  return edits.length ? editDictSource(englishSource, edits) : englishSource;
}

/** index.js for a language: the English index with its own header. */
export function scaffoldIndex(code) {
  const info = LOCALES.find((l) => l.code === code);
  const english = readFileSync(path.join(LOCALES_DIR, 'en', 'index.js'), 'utf8');
  const body = english.slice(english.indexOf('import '));
  const header = `/**\n * ${info.name} dictionary (${info.nativeName}). Keys mirror the English files exactly; plural objects\n * carry the forms ${info.name} uses (${pluralCategoriesFor(code).join(', ')}).\n * Curly braces mark parameters, for example {city}. Do not use the em dash or en dash characters.\n */\n`;
  return header + body;
}

export function scaffold(code, { log = console.log } = {}) {
  if (!LOCALES.some((l) => l.code === code) || code === 'en') throw new Error(`${code} is not a language in LOCALES (packages/core/src/i18n/runtime.js)`);
  const dir = path.join(LOCALES_DIR, code);
  mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const ns of namespaces()) {
    const target = path.join(dir, `${ns}.js`);
    if (existsSync(target)) continue;
    writeFileSync(target, scaffoldNamespace(readFileSync(path.join(LOCALES_DIR, 'en', `${ns}.js`), 'utf8'), code));
    written += 1;
  }
  const index = path.join(dir, 'index.js');
  if (!existsSync(index)) {
    writeFileSync(index, scaffoldIndex(code));
    written += 1;
  }
  const memory = path.join(DATA_I18N_DIR, `${code}.json`);
  if (!existsSync(memory)) {
    // The same shape and layout as es.json: one-space indent, no final newline.
    writeFileSync(memory, JSON.stringify({ lang: code, generatedAt: new Date().toISOString().slice(0, 10), strings: {} }, null, 1));
    written += 1;
  }
  log(`${code}: ${written} file${written === 1 ? '' : 's'} written (plural forms: ${pluralCategoriesFor(code).join(', ')})`);
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const codes = process.argv.slice(2);
  if (!codes.length) {
    console.error('Usage: node scripts/i18n-scaffold.mjs <lang> [lang...]');
    process.exit(1);
  }
  for (const code of codes) scaffold(code);
}
