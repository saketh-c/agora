import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tidyTimes, writtenContact } from '../src/components/ui/cityText.js';
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
  assert.deepEqual(MILES, [5, 10, 15, 25]);
  assert.deepEqual(milesChoices(15), [5, 10, 15, 25]);
  assert.deepEqual(milesChoices(40), [5, 10, 15, 25, 40]);
  assert.deepEqual(milesChoices(null), [5, 10, 15, 25]);
});
