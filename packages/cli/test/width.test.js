import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NO_COLOR = '1';
process.env.AGORA_PREFS = path.join(mkdtempSync(path.join(os.tmpdir(), 'agora-width-test-')), 'prefs.json');
delete process.env.AGORA_LANG;
const { run } = await import('../src/main.js');

/** Run a command as if printing to a terminal `columns` wide, and return its lines. */
async function inTerminal(argv, columns) {
  const stdout = process.stdout;
  const saved = { isTTY: Object.getOwnPropertyDescriptor(stdout, 'isTTY'), columns: Object.getOwnPropertyDescriptor(stdout, 'columns') };
  Object.defineProperty(stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(stdout, 'columns', { value: columns, configurable: true });
  const out = [];
  try {
    const code = await run(argv, { log: (s) => out.push(s), error: () => {} });
    assert.equal(code, 0, argv.join(' '));
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(stdout, k, d);
      else delete stdout[k];
    }
  }
  return out.join('\n').split('\n');
}

const width = (line) => [...line].filter((ch) => !/\p{M}/u.test(ch)).length;

test('tables fit an 80-column terminal in every language without cutting meeting names to a word', async () => {
  for (const lang of ['en', 'es', 'vi']) {
    for (const argv of [['meetings'], ['cities'], ['city', 'Garland'], ['meetings', 'Plano']]) {
      const lines = await inTerminal([...argv, '--today', '2026-10-10', '--lang', lang], 80);
      const tooWide = lines.filter((l) => width(l) > 80 && !/https?:\/\//.test(l));
      assert.deepEqual(tooWide, [], `${lang} ${argv.join(' ')}`);
    }
    const meetings = await inTerminal(['meetings', '--today', '2026-10-10', '--lang', lang], 80);
    assert.ok(!meetings.some((l) => /^\s{4}\S+ …/.test(l)), `${lang}: meeting names are not cut to one word`);
  }
  // A pipe (no terminal) keeps the full table for tools like grep.
  const out = [];
  await run(['meetings', '--today', '2026-10-10'], { log: (s) => out.push(s), error: () => {} });
  assert.ok(out.join('\n').split('\n').some((l) => width(l) > 80));
});
