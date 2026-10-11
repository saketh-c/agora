import { test } from 'node:test';
import assert from 'node:assert/strict';
import { c, safe, visibleLength, labelBlock, table, wrapText, wrapParagraphs, setColorEnabled, colorEnabled } from '../src/ui.js';

setColorEnabled(false);

test('safe() removes terminal control sequences from network text', () => {
  // Clear screen, a color change, and an OSC 8 hyperlink that hides where it points.
  const hostile = 'Council vote \u001b[2J\u001b[31mFAKE ALERT\u001b[0m \u001b]8;;https://evil.example/\u0007click here\u001b]8;;\u0007 done';
  assert.equal(safe(hostile), 'Council vote FAKE ALERT click here done');
  assert.equal(safe('a\u001b]0;new window title\u001b\\b'), 'ab');
  assert.equal(safe('bell\u0007 and backspace\u0008s and \u009b2J C1'), 'bell and backspaces and 2J C1');
  assert.equal(safe('abc‮dcba‬'), 'abcdcba', 'bidi overrides could disguise text');
  assert.equal(safe('line one\nline two\ttab'), 'line one line two tab');
  assert.equal(safe('para one\n\npara two', { multiline: true }), 'para one\n\npara two');
  assert.equal(safe('Café Đà Nẵng, Señor'), 'Café Đà Nẵng, Señor', 'accents survive');
  assert.equal(safe(null), '');
});

test('visibleLength ignores color codes and combining accents', () => {
  setColorEnabled(true);
  assert.equal(visibleLength(c.red('abc')), 3);
  setColorEnabled(false);
  assert.equal(visibleLength('Thứ hai'), 7);
  assert.equal(visibleLength('Thứ hai'.normalize('NFD')), 7, 'decomposed Vietnamese counts the same');
});

test('setColorEnabled switches colors at run time', () => {
  const before = colorEnabled();
  setColorEnabled(true);
  assert.match(c.green('x'), /\u001b\[32m/);
  setColorEnabled(false);
  assert.equal(c.green('x'), 'x');
  setColorEnabled(before);
});

test('labelBlock sizes the label column to the longest label and wraps values under it', () => {
  const out = labelBlock([
    ['Distancia máxima', '15 millas'],
    ['Idioma', 'Español'],
    null,
    ['Intereses', 'Vivienda y renta, Autobuses, trenes y bicicletas, Calles y tráfico, Parques y recreación, Seguridad'],
  ]).split('\n');
  const col = 'Distancia máxima '.length;
  assert.equal(out[0], 'Distancia máxima 15 millas');
  assert.equal(out[1].indexOf('Español'), col);
  assert.equal(out[2].indexOf('Vivienda'), col);
  assert.ok(out.length > 3, 'the long value wraps');
  assert.equal(out[3].search(/\S/), col, 'continuation lines hang under the value');
  assert.ok(out.every((l) => l.length <= 78));
  const long = labelBlock(
    [
      ['Short', 'a'],
      ['A label far longer than the column allows', 'b'],
    ],
    { max: 10 },
  ).split('\n');
  // The column stops at `max`; the overlong label gets its own line and its value lines up below.
  assert.deepEqual(long, ['Short      a', 'A label far longer than the column allows', '           b']);
});

test('table trims trailing spaces, shrinks flexible columns to fit, and shows an empty message', () => {
  const rows = [
    { a: 'Mon, Oct 12 7:00 PM', b: 'City Council Preliminary Open Meeting and Work Session', d: 'x' },
    { a: 'Tue, Oct 13 6:00 PM', b: 'Regular Meeting', d: '' },
  ];
  const columns = [
    { key: 'a', title: 'When' },
    { key: 'b', title: 'Meeting', flex: true },
    { key: 'd', title: 'Notes' },
  ];
  const wide = table(rows, columns, { maxWidth: Infinity }).split('\n');
  assert.ok(wide.every((l) => l === l.trimEnd()), 'no trailing spaces');
  assert.ok(wide.some((l) => l.includes('Preliminary Open Meeting and Work Session')));
  const narrow = table(rows, columns, { maxWidth: 50 }).split('\n');
  assert.ok(narrow.every((l) => visibleLength(l) <= 50), narrow.join('\n'));
  assert.ok(narrow.some((l) => l.includes('…')));
  assert.equal(table([], columns, { empty: 'Nothing on this day.' }), '  Nothing on this day.');
});

test('a narrow table drops optional columns and shortens titles before cutting cells', () => {
  const rows = [{ city: 'Addison', when: 'mar, 13 de oct 5:30 p.m.', rel: 'en 3 días', remote: 'pregunta' }];
  const columns = [
    { key: 'city', title: 'Ciudad' },
    { key: 'when', title: 'Próxima oportunidad de hablar', flex: true },
    { key: 'rel', title: '', optional: true },
    { key: 'remote', title: 'A distancia', flex: true },
  ];
  const out = table(rows, columns, { maxWidth: 48 }).split('\n');
  assert.ok(out.every((l) => visibleLength(l) <= 48), out.join('\n'));
  assert.ok(!out.some((l) => l.includes('en 3 días')), 'the optional column went first');
  assert.ok(out[2].includes('mar, 13 de oct 5:30 p.m.'), 'the date itself is whole');
  assert.ok(out[2].includes('pregunta'));
  assert.ok(out[0].includes('…'), 'a title was shortened instead');
});

test('wrapParagraphs keeps paragraphs apart', () => {
  const text = `${'word '.repeat(30)}\n\n${'more '.repeat(5)}`;
  const out = wrapParagraphs(text, 40);
  assert.equal(out.split('\n\n').length, 2);
  assert.ok(out.split('\n').every((l) => l.length <= 40));
  assert.equal(wrapText('a b c', 76, 2), '  a b c');
});
