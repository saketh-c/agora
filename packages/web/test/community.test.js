import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseVideoUrl, buildIssueUrl, filterPosts, sortPosts, normalizePost, localizePost, seedPosts, postDate, paragraphs, KINDS, ISSUE_URL_MAX } from '../src/lib/community.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const seed = JSON.parse(readFileSync(path.join(root, 'data/community.json'), 'utf8'));

test('video links resolve only for YouTube and Vimeo, to privacy-preserving embeds', () => {
  assert.equal(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ').embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').provider, 'youtube');
  assert.equal(parseVideoUrl('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789?dnt=1');
  // Anything else is refused: an iframe to an arbitrary host is a phishing surface.
  assert.equal(parseVideoUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseVideoUrl('javascript:alert(1)'), null);
  assert.equal(parseVideoUrl('not a url'), null);
  assert.equal(parseVideoUrl('https://www.youtube.com/watch?v=<script>'), null);
});

test('video links keep the start time and unlisted hashes, and refuse look-alike paths', () => {
  assert.equal(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=42').embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42');
  assert.equal(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s').embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
  assert.equal(parseVideoUrl('https://vimeo.com/123456789/abcdef1234').embed, 'https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234');
  assert.equal(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQextra'), null, 'a YouTube id is exactly 11 characters');
  assert.equal(parseVideoUrl('https://vimeo.com/user12345678'), null, 'a profile is not a video');
  assert.equal(parseVideoUrl('https://vimeo.com/showcase/1234567'), null, 'a showcase is not a video');
  assert.equal(parseVideoUrl('https://www.youtube.com/embed/videoseries?list=PL123'), null, 'a playlist is not one video');
  // Embeds it produced are accepted again, so stored posts can be re-checked.
  const v = parseVideoUrl('https://vimeo.com/123456789/abcdef1234');
  assert.deepEqual(parseVideoUrl(v.embed), v);
});

test('the review link carries the post, never the school, and counts only files to attach', () => {
  const post = normalizePost({
    kind: 'win',
    title: 'Crosswalk on the list',
    body: 'Six of us spoke.',
    cityId: 'garland',
    author: { name: 'J.', school: 'Garland HS' },
    media: [{ type: 'image', mediaId: 'm1' }, { type: 'video', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' }],
  });
  const u = new URL(buildIssueUrl('https://github.com/example/agora/', post, { kindLabel: 'Win', cityName: 'Garland' }));
  assert.equal(u.origin + u.pathname, 'https://github.com/example/agora/issues/new');
  assert.equal(u.searchParams.get('title'), '[community] Crosswalk on the list');
  const body = u.searchParams.get('body');
  assert.match(body, /\*\*Kind:\*\* Win/);
  assert.match(body, /\*\*City:\*\* Garland/);
  assert.match(body, /\*\*Posted by:\*\* J\./);
  assert.doesNotMatch(body, /Garland HS/);
  assert.match(body, /Six of us spoke\./);
  assert.match(body, /https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ/, 'the video link is in the body');
  assert.match(body, /\(1 photo or video file to attach below\)/);
  assert.equal(u.searchParams.get('labels'), null, 'no label the repository does not have');
});

test('a long Vietnamese post still gives a link GitHub accepts', () => {
  const body = 'Tôi đã phát biểu tại hội đồng thành phố về công viên. '.repeat(80).slice(0, 3500);
  const url = buildIssueUrl('https://github.com/example/agora', normalizePost({ title: 'Công viên', body, kind: 'tip' }));
  assert.ok(url.length <= ISSUE_URL_MAX, `${url.length} characters`);
  assert.match(new URL(url).searchParams.get('body'), /Shortened to fit/);
  const short = buildIssueUrl('https://github.com/example/agora', normalizePost({ title: 'x', body: 'short', kind: 'tip' }));
  assert.doesNotMatch(new URL(short).searchParams.get('body'), /Shortened/);
});

test('filtering and sorting', () => {
  const posts = [
    { id: 'a', kind: 'tip', cityId: 'plano', postedAt: '2026-09-01' },
    { id: 'b', kind: 'win', cityId: 'plano', postedAt: '2026-09-10' },
    { id: 'c', kind: 'tip', cityId: 'denton', postedAt: '2026-09-05' },
  ];
  assert.deepEqual(filterPosts(posts, { kind: 'tip' }).map((p) => p.id), ['a', 'c']);
  assert.deepEqual(filterPosts(posts, { cityId: 'plano' }).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(sortPosts(posts).map((p) => p.id), ['b', 'c', 'a'], 'newest first');
  assert.deepEqual(sortPosts(posts, 'city', { homeCityId: 'denton' }).map((p) => p.id), ['c', 'b', 'a'], 'your city first, then newest');
});

test('same-day posts keep their order across a reload', () => {
  const first = { id: 'local-1', postedAt: '2026-10-10', createdAt: '2026-10-10T20:00:00.000Z' };
  const second = { id: 'local-2', postedAt: '2026-10-10', createdAt: '2026-10-10T21:00:00.000Z' };
  const seedPost = { id: 'team', postedAt: '2026-10-10', createdAt: '' };
  // IndexedDB returns them oldest first; the page shows the newest first either way.
  assert.deepEqual(sortPosts([first, second, seedPost]).map((p) => p.id), ['local-2', 'local-1', 'team']);
  assert.deepEqual(sortPosts([seedPost, second, first]).map((p) => p.id), ['local-2', 'local-1', 'team']);
});

test('a post written at 8:30 PM in Dallas is dated that day, not the next (UTC) day', () => {
  assert.equal(postDate(new Date('2026-10-11T01:30:00Z')), '2026-10-10', 'CDT');
  assert.equal(postDate(new Date('2026-11-03T01:30:00Z')), '2026-11-02', 'CST, after the DST change');
});

test('anything from storage is normalized before the page trusts it', () => {
  assert.equal(normalizePost(null), null);
  assert.equal(normalizePost({ title: '', body: '   ' }), null, 'an empty post is dropped');
  const p = normalizePost({
    title: 'x',
    kind: 'nonsense',
    postedAt: 'garbage',
    media: [{ type: 'script' }, { type: 'image', src: 'community/a.png' }, { type: 'image', src: 'https://evil.example/a.png' }, { type: 'video', embed: 'https://evil.example/embed/x' }],
    links: [{ label: 'ok', to: '/meetings' }, { label: 'no target' }, { label: 'protocol', url: 'javascript:alert(1)' }, { label: 'other host', to: '//evil.example' }],
  });
  assert.equal(p.kind, 'tip');
  assert.match(p.postedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p.media.length, 1, 'only a relative community/ image survives');
  assert.deepEqual(p.links.map((l) => l.label), ['ok']);
});

test('team posts are honest: signed by the team, from real city data, with no invented people', () => {
  const cities = new Set(JSON.parse(readFileSync(path.join(root, 'data/cities.json'), 'utf8')).cities.map((c) => c.cityId));
  assert.ok(seed.posts.length >= 6);
  for (const raw of seed.posts) {
    const p = normalizePost(raw);
    assert.equal(p.team, true, `${raw.id} is signed by the team`);
    assert.equal(p.author.name, '', `${raw.id} names no person`);
    assert.ok(!('helpful' in raw) || raw.helpful === 0, `${raw.id} has no made-up helpful count`);
    assert.ok(KINDS.includes(raw.kind), `${raw.id} kind`);
    assert.ok(!raw.cityId || cities.has(raw.cityId), `${raw.id} city exists`);
    for (const m of raw.media || []) {
      assert.ok(existsSync(path.join(root, 'packages/web/public', m.src)), `${raw.id} media ${m.src} exists`);
      assert.doesNotMatch(m.src, /\.svg$/, 'no placeholder drawings');
    }
    for (const lang of ['es', 'vi']) {
      assert.ok(raw.i18n && raw.i18n[lang] && raw.i18n[lang].title && raw.i18n[lang].body, `${raw.id} is translated to ${lang}`);
      assert.doesNotMatch(`${raw.i18n[lang].title} ${raw.i18n[lang].body}`, /[–—]/, `${raw.id} ${lang} has no dashes`);
      if (lang === 'vi') assert.doesNotMatch(raw.i18n[lang].body, /\b\d{1,2}(:\d{2})?\s?(AM|PM|[ap]\.m\.)/i, `${raw.id} vi uses a 24-hour clock`);
    }
  }
});

test('seed posts come back localized, newest first', () => {
  const es = seedPosts(seed, 'es');
  assert.equal(es.length, seed.posts.length);
  const plano = es.find((p) => p.id === 'team-plano-signup');
  assert.match(plano.title, /inscríbete/);
  // Captions follow the order of media.
  const withMedia = { ...plano, media: [{ type: 'image', src: 'community/a.png', caption: 'A photo' }], i18n: { es: { title: 'Título', body: 'Texto', media: [{ caption: 'Una foto' }] } } };
  assert.equal(localizePost(withMedia, 'es').media[0].caption, 'Una foto');
  assert.equal(localizePost({ ...withMedia, i18n: { es: { title: 'Título', body: 'Texto' } } }, 'es').media[0].caption, 'A photo', 'no translated captions: the English one stays');
  assert.equal(localizePost(plano, 'fr'), plano, 'no translation: unchanged');
  assert.deepEqual(paragraphs('One.\n\nTwo.\n \nThree.'), ['One.', 'Two.', 'Three.']);
});
