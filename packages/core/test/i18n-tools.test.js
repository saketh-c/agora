/**
 * The translation tools: editing dictionary sources in place, the per-language checks of
 * scripts/i18n-check.mjs, the scaffold for a new language, and the todo and apply round trip
 * translators use (run end to end in a temporary copy of the repository).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DICTIONARIES, isPluralForms, pluralCategoriesFor } from '../src/i18n/index.js';
import { editDictSource, parseDictSource, quoteString } from '../../../scripts/lib/dict-source.mjs';
import { MUST_CONFIRM, compareLocale, needsTranslation, parseJsonPositions, pluralSelector, sameAsEnglish, setJsonMember } from '../../../scripts/lib/i18n-tools.mjs';
import { scaffoldNamespace } from '../../../scripts/i18n-scaffold.mjs';
import { formatSameAsEnglish, planCommunity, planData, planUi } from '../../../scripts/i18n-apply.mjs';
import { uiTodo } from '../../../scripts/i18n-todo.mjs';
import { readiness } from '../../../scripts/i18n-check.mjs';
import { REPO_ROOT } from '../src/load-node.js';

const SOURCE = `/** A namespace. */
export default {
  // A comment that must survive.
  title: 'Meetings',
  apostrophe: "The city's list",
  'kebab-key': 'Work session',
  minutes: {
    one: '{n} minute',
    other: '{n} minutes',
  },
  showAll: 'Show all {n}',
  list: [
    'first',
    'second',
  ],
  nested: {
    deep: 'Deep text',
  },
};
`;

test('dictionary sources are edited in place: comments, quotes and order survive', () => {
  const doc = parseDictSource(SOURCE);
  assert.equal(doc.get('apostrophe').value, "The city's list");
  assert.equal(doc.get('list[1]').value, 'second');
  const out = editDictSource(SOURCE, [
    { path: 'title', value: 'الاجتماعات' },
    { path: 'list[0]', value: 'الأول' },
    { path: 'nested.deep', value: "l'eau" },
    { path: 'minutes', value: { zero: 'لا دقائق', one: 'دقيقة', two: 'دقيقتان', few: '{n} دقائق', many: '{n} دقيقة', other: '{n} دقيقة' } },
    { path: 'showAll', value: { one: 'عرض الكل', other: 'عرض الكل ({n})' } },
    { path: 'added', value: 'New', after: 'kebab-key' },
  ]);
  assert.match(out, /\/\/ A comment that must survive\./);
  assert.match(out, /title: 'الاجتماعات',/);
  assert.match(out, /apostrophe: "The city's list",/, 'untouched strings keep their quotes');
  assert.match(out, /deep: "l'eau",/, 'an apostrophe switches to double quotes');
  assert.match(out, /'kebab-key': 'Work session',\n  added: 'New',/);
  // Plural forms go in CLDR order, keeping the existing lines' places.
  assert.match(out, /minutes: \{\n    zero: 'لا دقائق',\n    one: 'دقيقة',\n    two: 'دقيقتان',\n    few: '\{n\} دقائق',\n    many: '\{n\} دقيقة',\n    other: '\{n\} دقيقة',\n  \},/);
  assert.match(out, /showAll: \{\n    one: 'عرض الكل',\n    other: 'عرض الكل \(\{n\}\)',\n  \},/, 'a string becomes plural forms');
  // Dropping a form (Chinese has only "other").
  const zh = editDictSource(SOURCE, [{ path: 'minutes', value: { other: '{n}分钟' } }]);
  assert.match(zh, /minutes: \{\n    other: '\{n\}分钟',\n  \},/);
  // Nothing changes when nothing is new, and a bad path never half-applies.
  assert.equal(editDictSource(SOURCE, [{ path: 'title', value: 'Meetings' }]), SOURCE);
  assert.throws(() => editDictSource(SOURCE, [{ path: 'title', value: 'x' }, { path: 'nope', value: 'y' }]), /No entry at nope/);
  assert.equal(quoteString('a\\b'), "'a\\\\b'");
});

test('a new language starts as English with its own plural forms', () => {
  const ar = scaffoldNamespace(SOURCE, 'ar');
  assert.match(ar, /minutes: \{\n    zero: '\{n\} minutes',\n    one: '\{n\} minute',\n    two: '\{n\} minutes',\n    few: '\{n\} minutes',\n    many: '\{n\} minutes',\n    other: '\{n\} minutes',\n  \},/);
  assert.match(ar, /\/\/ A comment that must survive\./);
  const zh = scaffoldNamespace(SOURCE, 'zh');
  assert.match(zh, /minutes: \{\n    other: '\{n\} minutes',\n  \},/);
  assert.equal(scaffoldNamespace(SOURCE, 'hi'), SOURCE, 'Hindi has the same forms as English');
});

/**
 * A language as it starts out (what scripts/i18n-scaffold.mjs writes): English text, with each
 * plural object given the forms the language uses. Every shipped language is finished, so the
 * checks for untranslated text run against this.
 */
function untranslated(code, value = DICTIONARIES.en) {
  if (isPluralForms(value)) return Object.fromEntries(pluralCategoriesFor(code).map((c) => [c, value[c] ?? value.other]));
  if (Array.isArray(value)) return value.map((v) => untranslated(code, v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, untranslated(code, v)]));
  return value;
}

const NEW_LANGUAGES = ['zh', 'hi', 'te', 'ar'];

test('every language passes the structural checks and is completely translated', () => {
  for (const code of ['es', 'vi', ...NEW_LANGUAGES]) {
    const r = compareLocale(code);
    assert.deepEqual([r.missing, r.extra, r.problems], [[], [], []], code);
    assert.deepEqual(r.untranslated, [], `${code} is complete`);
    assert.equal(r.translated, r.total, code);
  }
});

test('a language that is still English reports what is untranslated', () => {
  for (const code of NEW_LANGUAGES) {
    const r = compareLocale(code, { dicts: { en: DICTIONARIES.en, [code]: untranslated(code) } });
    assert.deepEqual([r.missing, r.extra, r.problems], [[], [], []], `${code}: the starting copy is well formed`);
    assert.ok(r.untranslated.includes('nav.home'), code);
    assert.ok(!r.untranslated.includes('format.weekdays[1]'), `${code}: Intl supplies weekday names`);
    assert.ok(!r.untranslated.includes('prepare.write.schoolPlaceholder'), `${code}: a sample school name stays English`);
  }
  const start = (code) => compareLocale(code, { dicts: { en: DICTIONARIES.en, [code]: untranslated(code) } });
  assert.ok(start('zh').untranslated.includes('ui.dateTime'), 'Chinese writes its own comma');
  assert.ok(!start('hi').untranslated.includes('ui.dateTime'), 'Hindi keeps the Latin comma');
});

test('plural and parameter rules: required categories, extra ones allowed, counts may become plurals', () => {
  const clone = (code) => structuredClone(DICTIONARIES[code]);
  const dicts = { en: DICTIONARIES.en };
  // Arabic without "few": a failure.
  const ar = clone('ar');
  delete ar.common.minutes.few;
  let r = compareLocale('ar', { dicts: { ...dicts, ar } });
  assert.ok(r.problems.some((p) => p.startsWith('common.minutes: plural forms missing few')), r.problems.join('\n'));
  // Hindi with an extra category English lacks: fine.
  const hi = clone('hi');
  hi.common.minutes = { zero: '{n} मिनट', one: '{n} मिनट', other: '{n} मिनट' };
  assert.deepEqual(compareLocale('hi', { dicts: { ...dicts, hi } }).problems, []);
  // A string that counts may be answered with plural forms; one that does not, may not.
  const te = clone('te');
  te.common.showAll = { one: 'అన్నీ చూపించు', other: 'అన్నీ {n} చూపించు' };
  te.common.loading = { one: 'x', other: 'y' };
  r = compareLocale('te', { dicts: { ...dicts, te } });
  assert.ok(!r.problems.some((p) => p.startsWith('common.showAll')), r.problems.join('\n'));
  assert.ok(r.problems.some((p) => p.startsWith('common.loading')), 'loading has no count');
  // Arabic "two" may leave the number out; "few" may not.
  const ar2 = clone('ar');
  ar2.common.minutes = { zero: 'لا دقائق', one: 'دقيقة', two: 'دقيقتان', few: 'دقائق', many: '{n} دقيقة', other: '{n} دقيقة' };
  r = compareLocale('ar', { dicts: { ...dicts, ar: ar2 } });
  assert.deepEqual(r.problems, ['common.minutes.few: params {} vs {n}']);
});

test('what still needs a translator, by script', () => {
  assert.equal(needsTranslation('Show all {n}', 'zh'), true);
  assert.equal(needsTranslation('{n} s', 'ar'), true, 'a one-letter unit is English too');
  assert.equal(needsTranslation('{page} | {app}', 'zh'), false);
  assert.equal(needsTranslation('{date}, {time}', 'zh'), true, 'Chinese uses a full-width comma');
  assert.equal(needsTranslation('{date}, {time}', 'ar'), true, 'Arabic uses its own comma');
  assert.equal(needsTranslation('{date}, {time}', 'hi'), false);
  assert.equal(needsTranslation('{name} ({mb} MB)', 'te'), false, 'an acronym is not a phrase');
  assert.equal(needsTranslation('you@example.com', 'ar'), false);
  assert.equal(needsTranslation('Video', 'es'), false, 'a cognate in a Latin-script language');
  assert.equal(needsTranslation('Video', 'hi'), true);
});

test('a value still in English counts as untranslated even after English changes', () => {
  // An English edit during translation leaves the old English copy behind in the new
  // languages; it must not pass for a translation (it would ship English with --strict green).
  const en = structuredClone(DICTIONARIES.en);
  en.nav.home = 'Start';
  const zh = structuredClone(DICTIONARIES.zh);
  zh.nav.home = 'Home';
  zh.nav.meetings = '会议';
  const r = compareLocale('zh', { dicts: { en, zh } });
  assert.ok(r.untranslated.includes('nav.home'), 'the stale copy is still English');
  assert.ok(!r.untranslated.includes('nav.meetings'), 'a value in Chinese is translated');
  // Written in its own script with English names in it: translated.
  zh.nav.home = 'Plano 首页';
  assert.ok(!compareLocale('zh', { dicts: { en, zh } }).untranslated.includes('nav.home'));
  assert.equal(needsTranslation('Agora 的 Plano 页面', 'zh'), false);
  assert.equal(needsTranslation('Plano City Council', 'ar'), true);
  // Spanish and Vietnamese keep the phrase test against today's English.
  const es = structuredClone(DICTIONARIES.es);
  assert.deepEqual(compareLocale('es', { dicts: { en, es } }).untranslated, []);
});

test('every new language confirms its punctuation, and letterless templates are counted apart', () => {
  for (const code of NEW_LANGUAGES) {
    // Each punctuation key is answered: translated, or kept English on purpose.
    const done = compareLocale(code);
    for (const key of MUST_CONFIRM) assert.ok(!done.untranslated.includes(key), `${code} confirmed ${key}`);
    // A language that is still English must confirm each one it has not kept on purpose.
    const r = compareLocale(code, { dicts: { en: DICTIONARIES.en, [code]: untranslated(code) } });
    const kept = sameAsEnglish(code);
    for (const key of MUST_CONFIRM) assert.equal(r.untranslated.includes(key), !kept.has(key), `${code} confirms ${key}`);
    assert.ok(!r.fixed.includes('rehearse.quoted'), code);
    assert.equal(r.translated + r.untranslated.length, r.total, `${code}: fixed units are in neither number`);
    assert.ok(r.fixed.every((k) => !r.untranslated.includes(k)));
  }
  // Chinese keeps none of them English, so a fresh copy asks for all four.
  for (const key of MUST_CONFIRM) assert.ok(!sameAsEnglish('zh').has(key), `zh translates ${key}`);
  // rehearse.quoted reaches the work files although its English is only quotes and a param.
  assert.equal(uiTodo('zh', { dicts: { en: DICTIONARIES.en, zh: untranslated('zh') } })['rehearse.quoted'], '"{word}"');
  assert.equal(uiTodo('zh')['rehearse.quoted'], undefined, 'the shipped Chinese has its own quotes');
  assert.ok(compareLocale('hi').fixed.includes('ui.dateTime'), 'Hindi keeps the Latin comma: nothing to write');
  assert.ok(!compareLocale('hi').untranslated.includes('ui.dateTime'));
  // A translation, or English kept on purpose, answers it.
  const zh = structuredClone(DICTIONARIES.zh);
  zh.rehearse.quoted = '“{word}”';
  zh.format.sep = '、';
  const r = compareLocale('zh', { dicts: { en: DICTIONARIES.en, zh } });
  assert.ok(!r.untranslated.includes('rehearse.quoted') && !r.untranslated.includes('format.sep'));
  assert.equal(needsTranslation('“{word}”', 'zh'), false);
  assert.equal(needsTranslation('{date}，{time}', 'zh'), false);
  // Never offered to Spanish or Vietnamese, which are complete.
  for (const code of ['es', 'vi']) for (const key of MUST_CONFIRM) assert.ok(!compareLocale(code).untranslated.includes(key));
});

test('only the number that picks a plural form may be left out of a form', () => {
  assert.equal(pluralSelector('Council meetings, next {n} days ({total})'), 'n');
  assert.equal(pluralSelector('You said "{word}" {count} times'), 'count');
  assert.equal(pluralSelector('{done} of {total} done'), null);
  const en = DICTIONARIES.en.cli.meetingsHeading;
  // Arabic "two" may say "يومين" without {n}, but must keep {total}.
  const ok = { zero: 'لا أيام ({total})', one: 'يوم ({total})', two: 'يومان ({total})', few: '{n} أيام ({total})', many: '{n} يومًا ({total})', other: '{n} يوم ({total})' };
  assert.deepEqual(planUi('ar', { 'cli.meetingsHeading': ok }).rejected, []);
  const lost = { ...ok, two: 'يومان' };
  assert.ok(planUi('ar', { 'cli.meetingsHeading': lost }).rejected.some((p) => p === 'cli.meetingsHeading.two: missing {total}'), 'not another number');
  const ar = structuredClone(DICTIONARIES.ar);
  ar.cli.meetingsHeading = lost;
  assert.ok(compareLocale('ar', { dicts: { en: DICTIONARIES.en, ar } }).problems.some((p) => p.startsWith('cli.meetingsHeading.two: params')));
  assert.ok(en.other.includes('{total}'));
});

test("kept-English keys are written back in the file's own layout", () => {
  const raw = readFileSync(path.join(REPO_ROOT, 'packages/core/src/i18n/same-as-english.json'), 'utf8');
  assert.equal(formatSameAsEnglish(JSON.parse(raw)), raw, 'unchanged data, unchanged file');
  const out = formatSameAsEnglish({ ar: ['format.sep'], '*': ['a', 'b'], hi: ['format.sep', 'rehearse.quoted'] });
  assert.equal(out, '{\n  "*": ["a", "b"],\n  "hi": ["format.sep", "rehearse.quoted"],\n  "ar": ["format.sep"]\n}\n', 'one line per language, in menu order');
});

test('a language is offered only when finished, and a finished one must be offered', () => {
  const r = readiness([
    { code: 'es', ready: true, ui: 0, data: 0, posts: 0 },
    { code: 'vi', ready: true, ui: 0, data: 2, posts: 0 },
    { code: 'zh', ready: false, ui: 0, data: 0, posts: 0 },
    { code: 'ar', ready: false, ui: 5, data: 0, posts: 0 },
  ]);
  assert.deepEqual(r.brokenReady.map((p) => p.code), ['vi'], 'a ready language with gaps fails');
  assert.deepEqual(r.unoffered.map((p) => p.code), ['zh'], 'a finished language must be marked ready');
});

test('apply checks every value before it writes', () => {
  const ui = planUi('ar', {
    'nav.home': 'الرئيسية',
    'common.minutes': { zero: 'لا دقائق', one: 'دقيقة', two: 'دقيقتان', few: '{n} دقائق', many: '{n} دقيقة', other: '{n} دقيقة' },
    'common.showAll': { zero: 'z', one: 'o', two: 't', few: 'عرض {n}', many: 'عرض {n}', other: 'عرض {n}' },
    'nav.meetings': 'Meetings',
    'nav.news': `أخبار ${String.fromCharCode(0x2014)} dash`,
    'common.inDays': { other: 'بعد {n}' },
    'city.councilTitle': 'مجلس مدينة',
    'no.such.key': 'x',
  });
  assert.deepEqual(ui.skipped, ['nav.meetings'], 'a value still in English is skipped');
  assert.ok(ui.rejected.some((p) => p.startsWith('nav.news') && /dash/.test(p)));
  assert.ok(ui.rejected.some((p) => p.startsWith('common.inDays: plural forms missing zero, one, two, few, many')));
  assert.ok(ui.rejected.some((p) => p === 'city.councilTitle: missing {city}'));
  assert.ok(ui.rejected.some((p) => p.startsWith('no.such.key')));
  assert.deepEqual(ui.edits.get('nav'), [{ path: 'home', value: 'الرئيسية' }]);
  // Chinese drops forms it never uses.
  const zh = planUi('zh', { 'common.minutes': { one: '{n}分钟', other: '{n}分钟' } });
  assert.deepEqual(zh.edits.get('common'), [{ path: 'minutes', value: { other: '{n}分钟' } }]);

  const shown = new Set(['Call 214-670-3738 or email clerk@plano.gov by 4 p.m.', 'Second string.']);
  const data = planData('ar', { 'Call 214-670-3738 or email clerk@plano.gov by 4 p.m.': 'اتصل على 214-670-3738 قبل 4 م', 'Second string.': 'النص الثاني.', 'Unknown.': 'x' }, shown);
  assert.ok(data.rejected.some((p) => /lost clerk@plano\.gov/.test(p)), 'a lost email address is rejected');
  assert.ok(data.rejected.some((p) => /not a string the app shows/.test(p)));
  const data2 = planData('ar', { 'Second string.': 'النص الثاني.' }, shown);
  assert.deepEqual(data2.accept, [['Second string.', 'النص الثاني.']]);

  const seed = { posts: [{ id: 'p1', team: true, title: 'T', body: 'B' }] };
  assert.equal(planCommunity('ar', { p1: { title: 'عنوان', body: 'نص' } }, seed).accept.size, 1);
  assert.ok(planCommunity('ar', { p2: { title: 'x', body: 'y' } }, seed).rejected.length);
});

test('JSON members are set in place without reformatting the file', () => {
  const text = '{\n  "posts": [\n    { "id": "a", "i18n": {\n        "es": { "title": "T" }\n      } }\n  ],\n  "n": 1\n}\n';
  const root = parseJsonPositions(text);
  const i18n = root.props[0].node.items[0].props[1].node;
  const out = setJsonMember(text, i18n, 'ar', { title: 'عنوان' });
  assert.deepEqual(JSON.parse(out).posts[0].i18n, { es: { title: 'T' }, ar: { title: 'عنوان' } });
  assert.ok(out.startsWith('{\n  "posts": [\n    { "id": "a", "i18n": {'), 'the hand-made layout stays');
  assert.equal(JSON.parse(setJsonMember(out, parseJsonPositions(out).props[0].node.items[0].props[1].node, 'ar', { title: 'جديد' })).posts[0].i18n.ar.title, 'جديد');
});

test('todo and apply round-trip a language in chunks (in a copy of the repository)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'agora-i18n-'));
  try {
    for (const p of ['scripts', 'packages/core/src', 'data/i18n']) cpSync(path.join(REPO_ROOT, p), path.join(tmp, p), { recursive: true });
    for (const p of ['package.json', 'packages/core/package.json', 'data/cities.json', 'data/community.json']) {
      mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true });
      cpSync(path.join(REPO_ROOT, p), path.join(tmp, p));
    }
    rmSync(path.join(tmp, 'data/i18n/work'), { recursive: true, force: true });
    const run = (args) => spawnSync(process.execPath, args, { cwd: tmp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // Arabic ships finished, so the copy starts it over as a new language: not ready, its
    // dictionary scaffolded from English, no city-data memory, no translated posts, and
    // nothing kept English on purpose.
    const runtimeFile = path.join(tmp, 'packages/core/src/i18n/runtime.js');
    const runtime = readFileSync(runtimeFile, 'utf8');
    const unready = runtime.replace(/(\{ code: 'ar',[^\n]*ready: )true/, '$1false');
    assert.notEqual(unready, runtime, 'Arabic is in LOCALES');
    writeFileSync(runtimeFile, unready);
    rmSync(path.join(tmp, 'packages/core/src/i18n/locales/ar'), { recursive: true, force: true });
    rmSync(path.join(tmp, 'data/i18n/ar.json'), { force: true });
    const communityFile = path.join(tmp, 'data/community.json');
    const community = JSON.parse(readFileSync(communityFile, 'utf8'));
    for (const post of community.posts || []) if (post.i18n) delete post.i18n.ar;
    writeFileSync(communityFile, `${JSON.stringify(community, null, 2)}\n`);
    const sameFile = path.join(tmp, 'packages/core/src/i18n/same-as-english.json');
    writeFileSync(sameFile, formatSameAsEnglish(Object.fromEntries(Object.entries(JSON.parse(readFileSync(sameFile, 'utf8'))).filter(([k]) => k !== 'ar'))));
    let r = run(['scripts/i18n-scaffold.mjs', 'ar']);
    assert.equal(r.status, 0, r.stderr);
    r = run(['scripts/i18n-todo.mjs', 'ar', '--chunks', '2', '--data-chunks', '2']);
    assert.equal(r.status, 0, r.stderr);
    const files = readdirSync(path.join(tmp, 'data/i18n/work')).sort();
    assert.deepEqual(files, ['ar-community.json', 'ar-data-1.json', 'ar-data-2.json', 'ar-ui-1.json', 'ar-ui-2.json']);
    const uiFile = path.join(tmp, 'data/i18n/work/ar-ui-1.json');
    const work = JSON.parse(readFileSync(uiFile, 'utf8'));
    assert.deepEqual(work.pluralForms, ['zero', 'one', 'two', 'few', 'many', 'other']);
    assert.equal(work.strings['nav.home'], 'Home');
    assert.ok(work.instructions.some((line) => /em dash/.test(line)));
    // A counting string arrives as plural forms in Arabic.
    const both = { ...work.strings, ...JSON.parse(readFileSync(path.join(tmp, 'data/i18n/work/ar-ui-2.json'), 'utf8')).strings };
    assert.deepEqual(Object.keys(both['common.showAll']), ['zero', 'one', 'two', 'few', 'many', 'other']);
    // Translate two keys and one city string; leave the rest as they are.
    work.strings['nav.home'] = 'الرئيسية';
    if (work.strings['common.today'] !== undefined) work.strings['common.today'] = 'اليوم';
    writeFileSync(uiFile, JSON.stringify(work, null, 2));
    // Keep one punctuation key as English on purpose, in whichever file it landed.
    const sepFile = ['ar-ui-1.json', 'ar-ui-2.json'].map((f) => path.join(tmp, 'data/i18n/work', f)).find((f) => JSON.parse(readFileSync(f, 'utf8')).strings['format.labelValue'] !== undefined);
    const sepWork = JSON.parse(readFileSync(sepFile, 'utf8'));
    sepWork.keepEnglish.push('format.labelValue');
    writeFileSync(sepFile, JSON.stringify(sepWork, null, 2));
    const sameBefore = readFileSync(path.join(tmp, 'packages/core/src/i18n/same-as-english.json'), 'utf8');
    const dataFile = path.join(tmp, 'data/i18n/work/ar-data-1.json');
    const data = JSON.parse(readFileSync(dataFile, 'utf8'));
    const [english] = Object.keys(data.strings).filter((s) => !/https?:|@/.test(s));
    data.strings[english] = `ترجمة ${(english.match(/\d+/g) || []).join(' ')}`;
    writeFileSync(dataFile, JSON.stringify(data, null, 2));
    const before = readFileSync(path.join(tmp, 'packages/core/src/i18n/locales/ar/nav.js'), 'utf8');
    r = run(['scripts/i18n-apply.mjs', 'ar']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readFileSync(path.join(tmp, 'packages/core/src/i18n/locales/ar/nav.js'), 'utf8');
    assert.equal(after, before.replace("home: 'Home',", "home: 'الرئيسية',"), 'only that line changed');
    const sameAfter = readFileSync(path.join(tmp, 'packages/core/src/i18n/same-as-english.json'), 'utf8');
    assert.equal(sameAfter, sameBefore.replace(/\n\}\n$/, ',\n  "ar": ["format.labelValue"]\n}\n'), 'one line added, the rest untouched');
    const memory = readFileSync(path.join(tmp, 'data/i18n/ar.json'), 'utf8');
    assert.equal(JSON.parse(memory).strings[english], data.strings[english]);
    assert.ok(memory.startsWith('{\n "lang": "ar",'), 'the memory keeps its one-space layout');
    // Applying again changes nothing.
    r = run(['scripts/i18n-apply.mjs', 'ar']);
    assert.equal(r.status, 0);
    assert.equal(readFileSync(path.join(tmp, 'packages/core/src/i18n/locales/ar/nav.js'), 'utf8'), after);
    // The check sees the translation, and fails only with --strict.
    r = run(['scripts/i18n-check.mjs']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /ar: \d+\/\d+ keys OK, \d+\/\d+ translated/);
    r = run(['scripts/i18n-check.mjs', '--strict']);
    assert.equal(r.status, 1, 'untranslated keys fail with --strict');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
