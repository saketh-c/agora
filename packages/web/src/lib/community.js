/**
 * Pure helpers for the Community page: no React and no browser globals, so they run in the
 * Node test suite. The page lives in pages/Community.jsx and the on-device store in
 * lib/communityDb.js.
 *
 * Two kinds of post share one shape:
 *  - team posts, shipped in data/community.json. They are written by the Agora team from a
 *    city's own data file, carry translations in `i18n`, and are signed "Agora team";
 *  - posts a student writes here. They stay on that device (and that profile) until the
 *    student sends one to the team, which is the only way a post reaches everyone.
 *
 * Other pages (Home's community module) can call seedPosts(seed, lang) for the team posts,
 * localized and newest first, with KIND_ICON for the kind's icon.
 */
import { graphemes, isDateStr, stripIsolates, t, tn, todayStr } from '@agora/core';

export const KINDS = Object.freeze(['tip', 'toolkit', 'win', 'question']);

/** Icon names from components/ui/Icon.jsx for each kind. */
export const KIND_ICON = Object.freeze({ tip: 'bulb', toolkit: 'book', win: 'star', question: 'chat' });

/** Link types a post can carry; the page turns each into a localized label. */
export const LINK_TYPES = Object.freeze(['guide', 'signup', 'apply']);

export const MAX_TITLE = 140;
export const MAX_BODY = 4000;
export const MAX_NAME = 60;

const isKind = (k) => KINDS.includes(k);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** Today's date in Dallas-Fort Worth. A post written at 8 PM is dated today, not tomorrow (UTC). */
export function postDate(now = new Date()) {
  return todayStr('America/Chicago', now);
}

/* ---------- Video links ---------- */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** "42", "90s", "1m30s", "1h2m3s" -> seconds, or 0. */
function startSeconds(value) {
  const v = String(value || '').trim();
  if (!v) return 0;
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || !m[0]) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function youtube(id, start) {
  // "videoseries" is a playlist player, not a video, and happens to be 11 characters long.
  if (!YT_ID.test(id || '') || id === 'videoseries') return null;
  const s = start > 0 ? `?start=${start}` : '';
  return { provider: 'youtube', embed: `https://www.youtube-nocookie.com/embed/${id}${s}`, link: `https://www.youtube.com/watch?v=${id}${start > 0 ? `&t=${start}s` : ''}` };
}

function vimeo(id, hash) {
  if (!/^\d{6,12}$/.test(id || '')) return null;
  if (hash && !/^[0-9a-f]{6,20}$/i.test(hash)) return null;
  return {
    provider: 'vimeo',
    embed: `https://player.vimeo.com/video/${id}?dnt=1${hash ? `&h=${hash}` : ''}`,
    link: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
  };
}

/**
 * Turn a pasted YouTube or Vimeo link into a privacy-preserving embed, or null for anything
 * else. Only these two hosts are allowed, because an iframe to an arbitrary site is a
 * phishing surface. Returns { provider, embed, link } (link is the canonical watch page).
 * Also accepts an embed URL this function produced, so stored posts can be re-checked.
 */
export function parseVideoUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  const start = startSeconds(url.searchParams.get('t') || url.searchParams.get('start'));

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (path === '/watch') return youtube(url.searchParams.get('v'), start);
    const m = /^\/(?:embed|shorts|live)\/([^/]+)$/.exec(path);
    return m ? youtube(m[1], start) : null;
  }
  if (host === 'youtu.be') {
    const m = /^\/([^/]+)$/.exec(path);
    return m ? youtube(m[1], start) : null;
  }
  if (host === 'vimeo.com') {
    const m = /^\/(\d+)(?:\/([0-9a-f]+))?$/i.exec(path);
    return m ? vimeo(m[1], m[2]) : null;
  }
  if (host === 'player.vimeo.com') {
    const m = /^\/video\/(\d+)$/.exec(path);
    return m ? vimeo(m[1], url.searchParams.get('h')) : null;
  }
  return null;
}

/* ---------- Normalizing ---------- */

const MEDIA_SRC = /^community\/[A-Za-z0-9][\w.-]*\.(png|jpe?g|webp|gif|webm|mp4)$/;

function normalizeMedia(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const m of list) {
    if (!isPlainObject(m) || (m.type !== 'image' && m.type !== 'video')) continue;
    const base = { type: m.type, alt: str(m.alt, 300), caption: str(m.caption, 300) };
    if (typeof m.mediaId === 'string' && m.mediaId) {
      out.push({ ...base, mediaId: m.mediaId.slice(0, 80) });
    } else if (typeof m.src === 'string' && MEDIA_SRC.test(m.src)) {
      out.push({ ...base, src: m.src, ...(typeof m.poster === 'string' && MEDIA_SRC.test(m.poster) ? { poster: m.poster } : {}) });
    } else if (m.type === 'video' && m.embed) {
      // Re-check stored embeds, so a tampered record can never iframe another site.
      const v = parseVideoUrl(m.embed);
      if (v) out.push({ ...base, embed: v.embed, provider: v.provider, link: v.link });
    }
    if (out.length >= 6) break;
  }
  return out;
}

function normalizeLinks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const l of list) {
    if (!isPlainObject(l)) continue;
    const type = LINK_TYPES.includes(l.type) ? l.type : '';
    const label = str(l.label, 80);
    const to = typeof l.to === 'string' && l.to.startsWith('/') && !l.to.startsWith('//') ? l.to : '';
    let url = '';
    if (typeof l.url === 'string') {
      try {
        if (new URL(l.url).protocol === 'https:') url = l.url;
      } catch {
        url = '';
      }
    }
    // A guide link points at the post's city page; a signup link without a url uses the
    // city's own registration link, so neither can drift from the city data.
    if (type === 'guide' || type === 'signup' || to || url) {
      if (!type && !label) continue;
      out.push({ type, label, ...(to ? { to } : {}), ...(url ? { url } : {}) });
    }
    if (out.length >= 4) break;
  }
  return out;
}

function normalizeTranslations(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  for (const [code, v] of Object.entries(raw)) {
    if (!/^[a-z]{2}$/.test(code) || !isPlainObject(v)) continue;
    out[code] = {
      title: str(v.title, MAX_TITLE),
      body: str(v.body, MAX_BODY),
      media: Array.isArray(v.media) ? v.media.map((m) => (isPlainObject(m) ? { alt: str(m.alt, 300), caption: str(m.caption, 300) } : {})) : [],
    };
  }
  return Object.keys(out).length ? out : null;
}

/** Shape check for anything that came from storage or a file, so the page can trust it. */
export function normalizePost(p) {
  if (!isPlainObject(p)) return null;
  const title = str(p.title, MAX_TITLE);
  const body = str(p.body, MAX_BODY);
  if (!title && !body) return null;
  const author = isPlainObject(p.author) ? p.author : {};
  const team = Boolean(p.team || author.team);
  const createdAt = typeof p.createdAt === 'string' && !Number.isNaN(Date.parse(p.createdAt)) ? p.createdAt : '';
  return {
    id: str(p.id, 80) || newPostId(),
    team,
    local: Boolean(p.local),
    profileId: typeof p.profileId === 'string' ? p.profileId.slice(0, 40) : '',
    kind: isKind(p.kind) ? p.kind : 'tip',
    title,
    body,
    author: { name: team ? '' : str(author.name, MAX_NAME), school: team ? '' : str(author.school, 80) },
    cityId: str(p.cityId, 40),
    postedAt: isDateStr(String(p.postedAt || '').slice(0, 10)) ? String(p.postedAt).slice(0, 10) : postDate(),
    createdAt,
    media: normalizeMedia(p.media),
    links: normalizeLinks(p.links),
    i18n: normalizeTranslations(p.i18n),
  };
}

/**
 * The post in `lang`, when the team translated it; otherwise as written. `textLang` says
 * which language the title and body are in ('en' for an original), so the page can read an
 * untranslated post as English (lib/textDir.js).
 */
export function localizePost(post, lang) {
  if (!post) return post;
  const tr = post.i18n && post.i18n[lang];
  if (!tr || !tr.title || !tr.body) return post.textLang ? post : { ...post, textLang: 'en' };
  return {
    ...post,
    textLang: lang,
    title: tr.title,
    body: tr.body,
    media: post.media.map((m, i) => {
      const mt = (tr.media || [])[i] || {};
      return { ...m, alt: mt.alt || m.alt, caption: mt.caption || m.caption };
    }),
  };
}

/** The team's posts from data/community.json, localized, newest first. */
export function seedPosts(seed, lang = 'en') {
  const list = (seed && Array.isArray(seed.posts) ? seed.posts : []).map((p) => normalizePost({ ...p, local: false })).filter(Boolean);
  return sortPosts(list).map((p) => localizePost(p, lang));
}

/* ---------- Lists ---------- */

export function filterPosts(posts, { kind = '', cityId = '' } = {}) {
  return posts.filter((p) => (!kind || p.kind === kind) && (!cityId || p.cityId === cityId));
}

/**
 * Newest first: by date, then by the moment it was written (posts written here carry
 * createdAt), then in list order, so same-day posts keep a stable order across reloads.
 * by: 'newest' or 'city' (posts about homeCityId first, then newest).
 */
export function sortPosts(posts, by = 'newest', { homeCityId = '' } = {}) {
  return posts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      if (by === 'city' && homeCityId) {
        const ah = a.p.cityId === homeCityId ? 0 : 1;
        const bh = b.p.cityId === homeCityId ? 0 : 1;
        if (ah !== bh) return ah - bh;
      }
      return String(b.p.postedAt).localeCompare(String(a.p.postedAt)) || String(b.p.createdAt || '').localeCompare(String(a.p.createdAt || '')) || a.i - b.i;
    })
    .map((x) => x.p);
}

/**
 * The line over the feed: "9 posts", "3 posts about Plano", or "9 posts, Plano first" when
 * your city's posts lead the list. The count is a phrase by then, so it goes in {posts}: a
 * translator may make any sentence with {n} or {count} plural forms, and only a number can
 * choose among them.
 */
export function feedCountText(count, { filterCity = null, firstCity = null } = {}) {
  const text = filterCity ? tn('community.countIn', count, { city: filterCity.name }) : tn('community.count', count);
  return firstCity && !filterCity && count > 1 ? t('community.countFirst', { posts: text, city: firstCity.name }) : text;
}

export function newPostId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `local-${Date.now().toString(36)}-${rand}`;
}

/** The body's paragraphs (blank-line separated). */
export function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------- Sending a post to the team ---------- */

/** GitHub (and its login redirect) start refusing around 8k characters; stay well under. */
export const ISSUE_URL_MAX = 7000;

const DEFAULT_ISSUE_LABELS = {
  kind: 'Kind',
  city: 'City',
  author: 'Posted by',
  video: 'Video',
  attachments: (n) => `(${n} photo or video file${n === 1 ? '' : 's'} to attach below)`,
  shortened: '(Shortened to fit. The full text is still on the device it was written on.)',
};

/**
 * A prefilled "new issue" link on the project repository. This is how a post written on one
 * device reaches the team for review: the static site has nowhere else to send it. The
 * school is never included (the issue is public). Video links are written into the body;
 * photo and video files are attached by the student in GitHub's editor, so only those are
 * counted. The body is shortened until the whole encoded URL fits in `maxLength`, because
 * Vietnamese text grows about 2.6 times when encoded (Chinese, Hindi, Telugu and Arabic about
 * 9 times); it is cut between graphemes, never inside a character or a conjunct. The issue is
 * plain text, so the bidi isolates of Arabic labels are left out.
 *
 * options: { kindLabel, cityName, labels: Partial<DEFAULT_ISSUE_LABELS>, maxLength }
 */
export function buildIssueUrl(repoUrl, post, { kindLabel, cityName, labels = {}, maxLength = ISSUE_URL_MAX } = {}) {
  const L = { ...DEFAULT_ISSUE_LABELS, ...labels };
  const base = `${String(repoUrl || '').replace(/\/+$/, '')}/issues/new`;
  const media = (post && post.media) || [];
  const files = media.filter((m) => m.mediaId).length;
  const videos = media.filter((m) => m.embed).map((m) => m.link || m.embed);
  const head = [`**${L.kind}:** ${kindLabel || post.kind}`, cityName || post.cityId ? `**${L.city}:** ${cityName || post.cityId}` : null, post.author && post.author.name ? `**${L.author}:** ${post.author.name}` : null].filter(Boolean);
  const tail = [...videos.map((v) => `**${L.video}:** ${v}`), files ? `_${L.attachments(files)}_` : null].filter(Boolean);
  const title = `[community] ${post.title || ''}`;

  const make = (body, cut) => {
    const text = stripIsolates([...head, '', body, ...(cut ? ['', `_${L.shortened}_`] : []), ...(tail.length ? ['', ...tail] : [])].join('\n'));
    return `${base}?${new URLSearchParams({ title: stripIsolates(title), body: text }).toString()}`;
  };

  const full = String(post.body || '');
  let url = make(full, false);
  if (url.length <= maxLength) return url;
  // Binary search on the body length in graphemes, measured on the encoded URL.
  const pieces = graphemes(full);
  const upTo = (n) => `${pieces.slice(0, n).join('').trimEnd()}…`;
  let lo = 0;
  let hi = pieces.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (make(upTo(mid), true).length <= maxLength) lo = mid;
    else hi = mid - 1;
  }
  url = make(upTo(lo), true);
  return url;
}
