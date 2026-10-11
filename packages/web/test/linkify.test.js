import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LINK_RE } from '../src/components/ui/cityText.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const links = (s) => [...String(s).matchAll(LINK_RE)].map((m) => m[0]);

test('city text links: URLs, bare domains with a path, addresses and city hosts', () => {
  assert.deepEqual(links('Email councilcomments@plano.gov or see https://plano.gov/1234/Speak.'), ['councilcomments@plano.gov', 'https://plano.gov/1234/Speak']);
  assert.deepEqual(links('Use docspublished.io/fortworthtexas or feedback.cor.gov today'), ['docspublished.io/fortworthtexas', 'feedback.cor.gov']);
  assert.deepEqual(links('(via addisontx.gov City Secretary page)'), ['addisontx.gov']);
});

test('a bare form-vendor host is not a link, but a full form address on it is', () => {
  assert.deepEqual(links('Online form (via addisontx.gov City Secretary page, hosted at us.openforms.com); comments are attached'), ['addisontx.gov']);
  assert.deepEqual(links('Online form (us.openforms.com link) or email gpcitysecretary@gptx.org by 3:00 p.m.'), ['gpcitysecretary@gptx.org']);
  assert.deepEqual(links('Forms live at openforms.com.'), []);
  assert.deepEqual(links('Use https://us.openforms.com/Form/fc163f82-283c-4d0e-8d90-102932710e71 to write in'), ['https://us.openforms.com/Form/fc163f82-283c-4d0e-8d90-102932710e71']);
  assert.deepEqual(links('the form at us.openforms.com/Form/fc163f82 works'), ['us.openforms.com/Form/fc163f82']);
  // Hosts that merely contain the vendor's name are not affected.
  assert.deepEqual(links('see myopenforms.com and openforms.community.org'), ['myopenforms.com', 'openforms.community.org']);
});

test('no city text links to a bare openforms host', () => {
  const cities = JSON.parse(readFileSync(path.resolve(here, '../../../data/cities.json'), 'utf8')).cities;
  for (const city of cities) {
    const pc = city.publicComment || {};
    for (const text of [pc.howToRegister, pc.writtenCommentMethod, pc.notes, pc.deadline]) {
      for (const link of links(text || '')) assert.doesNotMatch(link, /^(?:https?:\/\/)?(?:us\.)?openforms\.com\/?$/i, `${city.cityId}: ${link}`);
    }
  }
});

test('the Farmers Branch rules note no longer links to its dead council page', () => {
  const cities = JSON.parse(readFileSync(path.resolve(here, '../../../data/cities.json'), 'utf8')).cities;
  const fb = cities.find((c) => c.cityId === 'farmers-branch');
  assert.ok(!links(fb.publicComment.notes).some((l) => /101\/City-Council/.test(l)));
});
