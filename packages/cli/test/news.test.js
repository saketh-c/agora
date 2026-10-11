import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatDate, setLocale } from '@agora/core';

// Set up the environment before the CLI modules read it at import.
process.env.NO_COLOR = '1';
process.env.AGORA_PREFS = path.join(mkdtempSync(path.join(os.tmpdir(), 'agora-news-test-')), 'prefs.json');
delete process.env.AGORA_LANG;
const { renderNews, newsDate, newsOffline } = await import('../src/news.js');
const { run } = await import('../src/main.js');
const { setColorEnabled } = await import('../src/ui.js');
setColorEnabled(false);

const result = (items, extra = {}) => ({ topic: null, city: null, fetchedFeeds: 3, totalFeeds: 3, items, topicLinks: [], ...extra });

test('headlines from feeds cannot send terminal control sequences', () => {
  const out = renderNews(
    result([
      {
        title: 'Council vote \u001b[2J\u001b[31mFAKE ALERT\u001b[0m',
        sourceName: 'Paper\u001b]0;pwned\u0007',
        link: 'https://example.com/a\u001b]8;;https://evil.example/\u0007',
        publishedAt: '2026-10-09T15:00:00Z',
        topics: ['budget-taxes'],
      },
    ]),
  );
  assert.ok(!out.includes('\u001b'), JSON.stringify(out));
  assert.ok(!out.includes('\u0007'));
  assert.match(out, /Council vote FAKE ALERT/);
  assert.match(out, /\[Budget and taxes\]/);
});

test('story dates are the Dallas calendar date, not the UTC one', () => {
  // 03:31 UTC on Oct 10 is 10:31 PM on Oct 9 in Dallas.
  assert.equal(newsDate('2026-10-10T03:31:00Z'), formatDate('2026-10-09'));
  assert.equal(newsDate('2026-10-10T15:00:00Z'), formatDate('2026-10-10'));
  assert.equal(newsDate(''), '');
  assert.equal(newsDate('not a date'), '');
  setLocale('es');
  assert.match(newsDate('2026-10-10T03:31:00Z'), /9 de oct/);
  setLocale('en');
});

test('no feeds answering means offline, not "no stories matched"', () => {
  assert.equal(newsOffline(result([], { fetchedFeeds: 0 })), true);
  assert.equal(newsOffline(result([], { fetchedFeeds: 1 })), false);
  assert.equal(newsOffline(result([], { fetchedFeeds: 0, totalFeeds: 0 })), false);
  const offline = renderNews(result([], { fetchedFeeds: 0, topicLinks: [{ label: 'KERA News', sourceName: 'KERA', url: 'https://www.keranews.org' }] }));
  assert.doesNotMatch(offline, /No stories matched/);
  assert.match(offline, /Where to read more/);
  assert.match(renderNews(result([])), /No stories matched/);
});

test('agora news exits 1 and says so when every feed fails', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const out = [];
  const err = [];
  try {
    const code = await run(['news', '--limit', '3'], { log: (s) => out.push(s), error: (s) => err.push(s) });
    assert.equal(code, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.match(err.join('\n'), /Could not reach any news feed\. Are you offline\?/);
  const text = out.join('\n');
  assert.match(text, /0 of \d+ feeds responded/);
  assert.doesNotMatch(text, /No stories matched/);
});
