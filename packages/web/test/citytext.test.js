import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { commentEmail, tidyTimes, writtenContact, writtenRules } from '../src/components/ui/cityText.js';
import { setLocale } from '@agora/core';
import { MILES, milesChoices } from '../src/lib/distance.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cities = JSON.parse(readFileSync(path.resolve(here, '../../../data/cities.json'), 'utf8')).cities;
const NB = ' ';

test("English data times read like the app's: 4 p.m. becomes 4:00 PM", () => {
  assert.equal(tidyTimes('4:00 p.m. on the day of the meeting (opens 5 p.m. the Tuesday before)', 'en'), `4:00${NB}PM on the day of the meeting (opens 5:00${NB}PM the Tuesday before)`);
  // "m." also ended the sentence: keep a period.
  assert.equal(tidyTimes('Paper cards until 7 p.m. Bring an ID.', 'en'), `Paper cards until 7:00${NB}PM. Bring an ID.`);
  assert.equal(tidyTimes('Doors open at 6 a.m.', 'en'), `Doors open at 6:00${NB}AM.`);
  assert.equal(tidyTimes('by noon on meeting day', 'en'), 'by noon on meeting day');
  // Other languages keep their translation, with the time held on one line.
  assert.equal(tidyTimes('antes de las 4 p.m. del día', 'es'), `antes de las 4${NB}p.m. del día`);
  assert.equal(tidyTimes('trước 16:00', 'vi'), 'trước 16:00');
});

test('the one way to send a written comment: a form when one is named first, else an address', () => {
  assert.deepEqual(writtenContact('Email councilcomments@plano.gov (the city asks for emails by 4 p.m. on meeting day)'), { kind: 'email', email: 'councilcomments@plano.gov' });
  assert.deepEqual(writtenContact('Online Public Comment Form at feedback.cor.gov (submitted by 4 p.m.)'), { kind: 'form', href: 'https://feedback.cor.gov' });
  assert.deepEqual(writtenContact('Select Written Comments on the same online form at docspublished.io/fortworthtexas, or email csoadmin@fortworthtexas.gov'), { kind: 'form', href: 'https://docspublished.io/fortworthtexas' });
  // An address's domain is never read as a page, and a bare city home page is not a form.
  assert.deepEqual(writtenContact('No form; email the City Secretary at cs@mycity.gov or see mycity.gov.'), { kind: 'email', email: 'cs@mycity.gov' });
  assert.equal(writtenContact('Contact the City Secretary\'s Office at 817-427-6060.'), null);
  assert.equal(writtenContact(''), null);
});

test('every city with a written-comment text gives a usable link or nothing', () => {
  for (const city of cities) {
    const c = writtenContact(city.publicComment && city.publicComment.writtenCommentMethod);
    if (!c) continue;
    if (c.kind === 'email') assert.match(c.email, /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/, city.cityId);
    else assert.doesNotThrow(() => new URL(c.href), city.cityId);
  }
});

test('one distance scale for setup and the Meetings filters, plus a saved value off the scale', () => {
  assert.deepEqual(MILES, [5, 10, 15, 25, 40, 60]);
  assert.deepEqual(milesChoices(15), [5, 10, 15, 25, 40, 60]);
  assert.deepEqual(milesChoices(50), [5, 10, 15, 25, 40, 50, 60]);
  assert.deepEqual(milesChoices(null), [5, 10, 15, 25, 40, 60]);
  assert.deepEqual(milesChoices(15, 80, null, 'x'), [5, 10, 15, 25, 40, 60, 80]);
});

test('an emailed comment follows the city’s own subject line, in English, with the details it asks for', () => {
  const duncanville = cities.find((c) => c.cityId === 'duncanville').publicComment.writtenCommentMethod;
  assert.deepEqual(writtenRules(duncanville), { subject: 'Public Comment - Tuesday, [date]', fields: ['first', 'last', 'address'], readAloud: 'no' });
  setLocale('es');
  try {
    const tue = commentEmail({ method: duncanville, cityName: 'Duncanville', meeting: { date: '2026-10-20' }, name: 'Ana María García' });
    assert.equal(tue.subject, 'Public Comment - Tuesday, October 20, 2026', 'English, whatever the app language');
    assert.equal(tue.lead, 'First name: Ana\nLast name: María García\nAddress:');
    assert.equal(tue.readAloud, 'no');
    // A meeting on another day keeps the city's format with the right weekday.
    assert.equal(commentEmail({ method: duncanville, cityName: 'Duncanville', meeting: { date: '2026-10-19' } }).subject, 'Public Comment - Monday, October 19, 2026');
    // No subject asked for: a plain English one, and nothing above the comment.
    const plano = commentEmail({ method: 'Email councilcomments@plano.gov by 4 p.m. on meeting day', cityName: 'Plano', meeting: { date: '2026-10-12' }, name: 'Ana' });
    assert.deepEqual([plano.subject, plano.lead, plano.readAloud], ['Public comment for Plano City Council, Oct 12', '', null]);
    assert.equal(commentEmail({ method: '', cityName: 'Plano', meeting: null }).subject, 'Public comment for Plano City Council');
  } finally {
    setLocale('en');
  }
  const up = cities.find((c) => c.cityId === 'university-park').publicComment.writtenCommentMethod;
  assert.equal(writtenRules(up).readAloud, 'notAlways');
  assert.equal(writtenRules(cities.find((c) => c.cityId === 'denton').publicComment.writtenCommentMethod).readAloud, 'no');
  // An email address is not an "address" the city asks for.
  assert.deepEqual(writtenRules('Email the City Secretary at cs@mycity.gov; include your address if you like.').fields, []);
});
