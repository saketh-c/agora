/**
 * The CLI in Chinese, Hindi, Telugu and Arabic: --lang and AGORA_LANG accept full tags, columns
 * are counted the way terminals draw them (Chinese characters take two), wrapping breaks
 * between Chinese characters, and tables still fit the terminal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { langCode } from '../src/args.js';
import { padVisible, setColorEnabled, truncate, visibleLength, wrapText, table } from '../src/ui.js';

process.env.NO_COLOR = '1';
process.env.AGORA_PREFS = path.join(mkdtempSync(path.join(os.tmpdir(), 'agora-i18n-cli-')), 'prefs.json');
delete process.env.AGORA_LANG;
const { run } = await import('../src/main.js');
setColorEnabled(false);

test('language codes and tags from --lang and AGORA_LANG', () => {
  assert.equal(langCode('zh'), 'zh');
  assert.equal(langCode('zh-CN'), 'zh');
  assert.equal(langCode('ZH_tw'), 'zh');
  assert.equal(langCode('hi_IN.UTF-8'), 'hi');
  assert.equal(langCode('te'), 'te');
  assert.equal(langCode('ar-EG'), 'ar');
  assert.equal(langCode('de'), undefined);
});

test('columns: Chinese takes two, marks and controls none', () => {
  assert.equal(visibleLength('中文abc'), 7);
  assert.equal(visibleLength('10月12日周一'), 12);
  assert.equal(visibleLength('，'), 2, 'full-width punctuation');
  assert.equal(visibleLength('Thứ hai'.normalize('NFD')), 7);
  assert.equal(visibleLength('\u2068Plano\u2069'), 5, 'bidi isolates take no room');
  assert.equal(visibleLength('👍🏽'), 2);
  assert.equal(padVisible('中文', 6), '中文  ');
  const cut = truncate('达拉斯沃思堡市议会会议', 9);
  assert.ok(visibleLength(cut) <= 9 && cut.endsWith('…'), cut);
  assert.equal(truncate('क्षत्रिय नगर परिषद', 6).replace('…', '').endsWith('्'), false, 'never cut after a virama');
});

test('Chinese wraps between characters, keeping punctuation off the start of a line', () => {
  const text = '我想请市议会延长公交车的运行时间，因为很多学生放学后要坐公交车回家。我们学校在Plano East，离车站很远。';
  const lines = wrapText(text, 30, 2).split('\n');
  assert.ok(lines.length > 2);
  for (const line of lines) {
    assert.ok(visibleLength(line) <= 32, line);
    assert.doesNotMatch(line.trim(), /^[，。、；：？！）]/, 'no line starts with closing punctuation');
  }
  assert.equal(lines.map((l) => l.trim()).join('').replace(/ /g, ''), text.replace(/ /g, ''), 'nothing is lost');
  assert.ok(lines.some((l) => l.includes('Plano East')) || lines.some((l) => l.includes('Plano')), 'a Latin word stays whole');
  // Space-separated text wraps as before.
  assert.equal(wrapText('one two three four', 9), 'one two\nthree\nfour');
});

test('a table with Chinese cells lines up', () => {
  const out = table([{ a: '10月12日周一', b: 'x' }, { a: 'Mon, Oct 12', b: 'y' }], [{ key: 'a', title: 'When' }, { key: 'b', title: 'B' }], { maxWidth: 80 }).split('\n');
  const col = out.map((l) => visibleLength(l.slice(0, l.lastIndexOf(' ') + 1)));
  assert.equal(col[2], col[3], out.join('\n'));
});

/** Run a command as if printing to a terminal `columns` wide. */
async function inTerminal(argv, columns) {
  const stdout = process.stdout;
  const saved = { isTTY: Object.getOwnPropertyDescriptor(stdout, 'isTTY'), columns: Object.getOwnPropertyDescriptor(stdout, 'columns') };
  Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(stdout, 'columns', { value: columns, configurable: true });
  const out = [];
  const errors = [];
  try {
    const code = await run(argv, { log: (s) => out.push(s), error: (s) => errors.push(s) });
    assert.equal(code, 0, `${argv.join(' ')}: ${errors.join(' ')}`);
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(stdout, k, d);
      else delete stdout[k];
    }
  }
  return out.join('\n').split('\n');
}

test('tables fit an 80-column terminal in Chinese, Hindi, Telugu and Arabic', async () => {
  for (const lang of ['zh', 'hi', 'te', 'ar']) {
    for (const argv of [['meetings'], ['cities'], ['city', 'Garland'], ['map']]) {
      const lines = await inTerminal([...argv, '--today', '2026-10-10', '--lang', lang], 80);
      const tooWide = lines.filter((l) => visibleLength(l) > 80 && !/https?:\/\//.test(l));
      assert.deepEqual(tooWide, [], `${lang} ${argv.join(' ')}`);
      assert.ok(!lines.some((l) => /[\u2066-\u2069]/.test(l)), `${lang}: no bidi isolates in terminal output`);
    }
  }
  const zh = await inTerminal(['meetings', 'Plano', '--today', '2026-10-10', '--lang', 'zh'], 80);
  assert.ok(zh.some((l) => /10月12日周一 19:00/.test(l)), 'Intl dates and the 24-hour clock in Chinese');
});
