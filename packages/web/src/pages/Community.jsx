import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BRAND, formatMonthDay, isDateStr, t, tn, compareText, formatNumber } from '@agora/core';
import seed from '@data/community.json';
import { useCities } from '../lib/DataProvider.jsx';
import { useStore } from '../lib/store.jsx';
import { copyText } from '../lib/clipboard.js';
import { communityFilterCount, readCommunityFilters, writeCommunityFilters } from '../lib/communityFilters.js';
import { inputDir, postTextProps } from '../lib/textDir.js';
import useClock from '../components/home/useClock.js';
import { useSkipLink } from '../components/shell/PageMeta.jsx';
import { KINDS, KIND_ICON, MAX_BODY, MAX_NAME, MAX_TITLE, buildIssueUrl, feedCountText, filterPosts, localizePost, newPostId, normalizePost, paragraphs, parseVideoUrl, postDate, sortPosts } from '../lib/community.js';
import { PHOTO_TYPES, downscaleImage, getMedia, isQuotaError, listPosts, removePost, savePost, storageMode } from '../lib/communityDb.js';
import { Avatar, Badge, Chip, EmptyState, Icon, Notice, PageHeader, Section, Segmented, Sheet } from '../components/ui/index.js';
import { BrandMark } from '../components/shell/Brand.jsx';
import '../styles/pages/community.css';

const MAX_PHOTOS = 4;
const MAX_VIDEO_MB = 120;
const DRAFT_KEY = 'agora.community.draft.v1';
const TOAST_MS = 5000;
const PROVIDER = { youtube: 'YouTube', vimeo: 'Vimeo' };

/** "Oct 10", or "Oct 10, 2025" in another year, in the app language. */
function shortDate(dateStr, today) {
  if (!isDateStr(String(dateStr || ''))) return '';
  return formatMonthDay(dateStr, { withYear: String(dateStr).slice(0, 4) !== String(today).slice(0, 4) });
}

function readDraft(profileId) {
  try {
    const raw = JSON.parse(sessionStorage.getItem(`${DRAFT_KEY}:${profileId}`) || 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeDraft(profileId, draft) {
  try {
    if (draft) sessionStorage.setItem(`${DRAFT_KEY}:${profileId}`, JSON.stringify(draft));
    else sessionStorage.removeItem(`${DRAFT_KEY}:${profileId}`);
  } catch {
    /* private mode: the draft lives in memory only */
  }
}

const blankDraft = (profile, prefs) => ({ kind: 'tip', title: '', body: '', cityId: prefs.homeCityId || '', name: profile.name || '', videoUrl: '' });

/**
 * Community: tips and guides from the Agora team, checked against each city's own rules, and
 * posts students write here. A student's post stays on this device (and this profile) until
 * they send it to the team, which is the only way onto everyone's page, so the page says
 * that once, plainly, instead of pretending to be a live forum.
 */
export default function Community() {
  const { profile, prefs, ui, setUi, lang } = useStore();
  const { cities, cityById } = useCities();
  // The date labels ("Oct 10", or with a year) follow the clock in a tab left open.
  const { today } = useClock();
  useSkipLink('cm-posts', t('shell.skip.posts'));

  // Team posts ship with the app; posts written here come from IndexedDB.
  const seeds = useMemo(() => (seed.posts || []).map((p) => normalizePost({ ...p, local: false })).filter(Boolean), []);
  const [local, setLocal] = useState([]);
  const [mode, setMode] = useState('idb');
  const urlMap = useRef(new Map());
  const [urls, setUrls] = useState({});

  // Kind, city and sort live in the address, so Back, a reload or a shared link keeps them.
  const [params, setParams] = useSearchParams();
  const homeCityId = prefs.homeCityId || '';
  const filters = readCommunityFilters(params, { homeCityId, hasCity: (id) => Boolean(cityById(id)) });
  const { kind, cityId: cityFilter, sort: sortBy, defaultSort } = filters;
  // Built from the address as it is now, not as of the last render: two quick changes (a city,
  // then a sort) must both stick.
  const setFilters = (patch) => setParams(writeCommunityFilters(new URLSearchParams(window.location.search), patch, { defaultSort }), { replace: true });
  const setKind = (value) => setFilters({ kind: value });
  const setCityFilter = (value) => setFilters({ city: value });
  const setSort = (value) => setFilters({ sort: value });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [toSend, setToSend] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const focusAfter = useRef(null);

  const adoptUrl = useCallback((mediaId, blob, url) => {
    if (urlMap.current.has(mediaId)) return urlMap.current.get(mediaId);
    const u = url || URL.createObjectURL(blob);
    urlMap.current.set(mediaId, u);
    return u;
  }, []);

  // Load this device's posts and their media once. URLs are made only while the page is
  // mounted, and all of them are revoked when it unmounts.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [stored, m] = await Promise.all([listPosts().catch(() => []), storageMode().catch(() => 'memory')]);
      if (!alive) return;
      setMode(m);
      const posts = stored.map((p) => normalizePost({ ...p, local: true })).filter(Boolean);
      const found = {};
      for (const p of posts) {
        for (const media of p.media) {
          if (!media.mediaId) continue;
          const rec = await getMedia(media.mediaId).catch(() => null);
          if (!alive) return;
          if (rec && rec.blob) found[media.mediaId] = adoptUrl(media.mediaId, rec.blob);
        }
      }
      setLocal((prev) => {
        const have = new Set(prev.map((p) => p.id));
        return [...prev, ...posts.filter((p) => !have.has(p.id))];
      });
      setUrls((prev) => ({ ...found, ...prev }));
    })();
    return () => {
      alive = false;
    };
  }, [adoptUrl]);

  useEffect(() => {
    const map = urlMap.current;
    return () => {
      for (const u of map.values()) URL.revokeObjectURL(u);
      map.clear();
    };
  }, []);

  // Toasts clear themselves; the live region around them stays mounted so each one is read.
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  const say = (text) => setToast({ text, at: Date.now() });

  // Move focus to a post heading (or the list) after the dialog that changed it has closed
  // and handed focus back.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return undefined;
    const timer = setTimeout(() => {
      focusAfter.current = null;
      const el = document.getElementById(target) || document.getElementById('cm-posts');
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }, 350);
    return () => clearTimeout(timer);
  });

  const mine = useMemo(() => local.filter((p) => !p.profileId || p.profileId === profile.id), [local, profile.id]);
  const team = useMemo(() => seeds.map((p) => localizePost(p, lang)), [seeds, lang]);
  const all = useMemo(() => [...mine, ...team], [mine, team]);
  const shown = useMemo(() => sortPosts(filterPosts(all, { kind, cityId: cityFilter }), sortBy, { homeCityId }), [all, kind, cityFilter, sortBy, homeCityId]);

  const cityCounts = useMemo(() => {
    const counts = new Map();
    for (const p of all) if (p.cityId && cityById(p.cityId)) counts.set(p.cityId, (counts.get(p.cityId) || 0) + 1);
    // A city from a link that has no posts yet still shows as the choice in use.
    if (cityFilter && !counts.has(cityFilter)) counts.set(cityFilter, 0);
    return [...counts.entries()].map(([id, n]) => ({ city: cityById(id), n })).sort((a, b) => compareText(a.city.name, b.city.name, lang));
  }, [all, cityById, lang, cityFilter]);

  const helpful = useMemo(() => new Set(Array.isArray(ui.helpful) ? ui.helpful : []), [ui.helpful]);
  const toggleHelpful = (id) => {
    const next = new Set(helpful);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setUi({ helpful: [...next].slice(-300) });
  };

  const filterCount = communityFilterCount(filters);
  const anyFilter = Boolean(kind || cityFilter);
  const clearFilters = () => setFilters({ kind: '', city: '' });
  const filterCity = cityFilter ? cityById(cityFilter) : null;
  const homeCity = homeCityId ? cityById(homeCityId) : null;
  // Say why the order is not by date: "9 posts, Plano first".
  const listCount = feedCountText(shown.length, { filterCity, firstCity: sortBy === 'city' ? homeCity : null });

  const onPosted = (post, mediaUrls) => {
    for (const [id, u] of Object.entries(mediaUrls)) adoptUrl(id, null, u);
    setLocal((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
    setUrls((prev) => ({ ...prev, ...mediaUrls }));
    setComposerOpen(false);
    // Show the new post: every kind and city, newest first.
    setFilters({ kind: '', city: '', sort: 'newest' });
    focusAfter.current = `post-${post.id}`;
    say(t('community.posted'));
  };

  const confirmDelete = async () => {
    const post = toDelete;
    if (!post) return;
    const index = shown.findIndex((p) => p.id === post.id);
    const next = shown[index + 1] || shown[index - 1];
    try {
      await removePost(post);
    } catch {
      setToDelete(null);
      say(t('community.errors.delete'));
      return;
    }
    for (const m of post.media) {
      if (!m.mediaId) continue;
      const u = urlMap.current.get(m.mediaId);
      if (u) URL.revokeObjectURL(u);
      urlMap.current.delete(m.mediaId);
    }
    setLocal((prev) => prev.filter((p) => p.id !== post.id));
    if (helpful.has(post.id)) toggleHelpful(post.id);
    setToDelete(null);
    focusAfter.current = next ? `post-${next.id}` : 'cm-posts';
    say(t('community.deleted'));
  };

  const kindLabel = (k) => t(`community.kinds.${k}`);

  return (
    <div className="wrap cm">
      <PageHeader title={t('community.heading')} lead={t('community.lead')}>
        <div className="cm-share">
          <button type="button" className="btn btn--primary" onClick={() => setComposerOpen(true)} aria-haspopup="dialog" aria-describedby="cm-note">
            <Icon name="pen" size={20} />
            {t('community.share')}
          </button>
          <p className="cm-share__note" id="cm-note">
            <Icon name="info" size={18} />
            {t('community.note')}
          </p>
        </div>
      </PageHeader>

      <div className="cm-grid">
        <div className="cm-main">
          <div className="chipbar cm-chips" role="group" aria-label={t('community.kindsLabel')}>
            <Chip icon="sliders" count={filterCount || undefined} onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
              {t('community.filters')}
            </Chip>
            <span className="cm-chips__rule" aria-hidden="true" />
            <Chip pressed={kind === ''} onClick={() => setKind('')}>
              {t('community.all')}
            </Chip>
            {KINDS.map((k) => (
              <Chip key={k} pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)}>
                {t(`community.kindsPlural.${k}`)}
              </Chip>
            ))}
          </div>

          <div className="cm-listbar">
            <p className="cm-listbar__count" aria-live="polite">
              {listCount}
            </p>
            {anyFilter && (
              <button type="button" className="see" onClick={clearFilters}>
                {t('community.clear')}
              </button>
            )}
          </div>

          <h2 className="vh" id="cm-posts" tabIndex={-1}>
            {t('community.postsHeading')}
          </h2>
          {shown.length > 0 ? (
            <ul className="cm-feed" aria-labelledby="cm-posts">
              {shown.map((post) => (
                <li key={post.id}>
                  <PostCard
                    post={post}
                    lang={lang}
                    city={post.cityId ? cityById(post.cityId) : null}
                    urls={urls}
                    today={today}
                    kindLabel={kindLabel(post.kind)}
                    voted={helpful.has(post.id)}
                    onHelpful={() => toggleHelpful(post.id)}
                    onSend={() => setToSend(post)}
                    onDelete={() => setToDelete(post)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={kind === 'win' ? 'star' : 'people'}
              title={t('community.emptyTitle')}
              actions={
                <button type="button" className="btn btn--secondary" onClick={clearFilters}>
                  {t('community.showAll')}
                </button>
              }
            >
              {kind === 'win' ? t('community.emptyWins') : t('community.emptyBody')}
            </EmptyState>
          )}
        </div>

        <aside className="cm-side" aria-labelledby="cm-ready">
          <Section title={t('community.ready.title')} id="cm-ready">
            <ul className="group">
              <li>
                <Link className="lrow lrow--icon" to="/meetings">
                  <span className="lrow__ic">
                    <Icon name="cal" />
                  </span>
                  <span>
                    <span className="lrow__t">{t('community.ready.meetings')}</span>
                    <span className="lrow__m">{t('community.ready.meetingsSub')}</span>
                  </span>
                  <Icon name="chev-r" />
                </Link>
              </li>
              <li>
                <Link className="lrow lrow--icon" to="/prepare/write">
                  <span className="lrow__ic">
                    <Icon name="pen" />
                  </span>
                  <span>
                    <span className="lrow__t">{t('ui.prep.stepsLong.write')}</span>
                    <span className="lrow__m">{t('community.ready.writeSub')}</span>
                  </span>
                  <Icon name="chev-r" />
                </Link>
              </li>
              <li>
                <Link className="lrow lrow--icon" to="/prepare/practice">
                  <span className="lrow__ic">
                    <Icon name="mic" />
                  </span>
                  <span>
                    <span className="lrow__t">{t('ui.prep.stepsLong.practice')}</span>
                    <span className="lrow__m">{t('community.ready.practiceSub')}</span>
                  </span>
                  <Icon name="chev-r" />
                </Link>
              </li>
            </ul>
          </Section>
        </aside>
      </div>

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        cityCounts={cityCounts}
        cityFilter={cityFilter}
        setCityFilter={setCityFilter}
        sort={sortBy}
        setSort={setSort}
        homeCity={homeCity}
        count={shown.length}
        onClear={() => setFilters({ city: '', sort: defaultSort })}
      />

      <Composer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        profile={profile}
        prefs={prefs}
        cities={cities}
        mode={mode}
        onPosted={onPosted}
      />

      <SendSheet post={toSend} city={toSend && toSend.cityId ? cityById(toSend.cityId) : null} onClose={() => setToSend(null)} onDone={(msg) => say(msg)} />

      <Sheet
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title={t('community.deleteTitle')}
        footer={
          <div className="btn-row">
            <button type="button" className="btn btn--secondary btn--danger" onClick={confirmDelete}>
              <Icon name="trash" size={20} />
              {t('community.delete')}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setToDelete(null)}>
              {t('community.cancel')}
            </button>
          </div>
        }
      >
        <p>{t('community.deleteBody')}</p>
      </Sheet>

      <div className="cm-toaster" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.at}>
            <Icon name="check-f" size={20} />
            <span>{toast.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- One post ---------- */

function PostCard({ post, lang, city, urls, today, kindLabel, voted, onHelpful, onSend, onDelete }) {
  const titleId = `post-${post.id}`;
  const author = post.team ? t('community.team') : post.author.name || t('community.you');
  const sub = post.team ? '' : t('community.onThisDevice');
  // A post reads as one block in its own language and direction (lib/textDir.js): a team
  // post in the page's language follows the page, even when it starts with "Plano:".
  const textProps = postTextProps(post, lang);
  return (
    <article className="post cm-post" aria-labelledby={titleId}>
      <div className="cm-post__top">
        <p className="post__kind">
          <Icon name={KIND_ICON[post.kind] || 'bulb'} />
          {city ? t('community.kindCity', { kind: kindLabel, city: city.name }) : kindLabel}
        </p>
        {post.local && (
          <Badge tone="neutral" icon="user">
            {t('community.yourPost')}
          </Badge>
        )}
      </div>
      <h3 className="post__t" id={titleId} tabIndex={-1} {...textProps}>
        {post.title}
      </h3>
      <div className="post__b cm-post__b" {...textProps}>
        {paragraphs(post.body).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {post.media.length > 0 && <Media media={post.media} urls={urls} />}

      {post.links.length > 0 && <PostLinks links={post.links} city={city} />}

      <div className="post__by">
        {post.team ? (
          <span className="avatar avatar--soft cm-mark" aria-hidden="true">
            <BrandMark className="cm-mark__svg" />
          </span>
        ) : (
          <Avatar name={post.author.name} soft />
        )}
        <span className="cm-by">
          <strong>{author}</strong>
          {sub && <span className="cm-by__sub">{sub}</span>}
        </span>
        {/* Your own post keeps its footer for its two actions; its date sits up here instead. */}
        {post.local && (
          <time className="cm-by__time" dateTime={post.postedAt}>
            {shortDate(post.postedAt, today)}
          </time>
        )}
      </div>

      <div className={`post__foot${post.local ? ' cm-foot--own' : ''}`}>
        {post.local ? (
          <span className="cm-own">
            <button type="button" className="btn btn--secondary btn--sm" onClick={onSend} aria-haspopup="dialog" aria-describedby={titleId}>
              <Icon name="share" />
              {t('community.sendToTeam')}
            </button>
            <button type="button" className="btn btn--quiet btn--sm btn--danger" onClick={onDelete} aria-haspopup="dialog" aria-describedby={titleId}>
              {t('community.delete')}
            </button>
          </span>
        ) : (
          <button type="button" className="cm-helpful" aria-pressed={voted} onClick={onHelpful} aria-describedby={titleId}>
            <Icon name="thumb" />
            {t('community.helpful')}
          </button>
        )}
        {!post.local && <time dateTime={post.postedAt}>{shortDate(post.postedAt, today)}</time>}
      </div>
    </article>
  );
}

function PostLinks({ links, city }) {
  const items = links
    .map((l) => {
      if (l.type === 'guide') return city ? { key: 'guide', label: t('ui.cityGuide', { city: city.name }), to: `/city/${city.cityId}` } : null;
      if (l.type === 'signup') {
        const url = l.url || (city && city.publicComment && city.publicComment.registrationUrl);
        return url ? { key: 'signup', label: t('community.links.signup'), url } : null;
      }
      if (l.type === 'apply') return l.url ? { key: 'apply', label: t('community.links.apply'), url: l.url } : null;
      return l.to || l.url ? { key: l.label, label: l.label, to: l.to, url: l.url } : null;
    })
    .filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="cm-post__links btn-row">
      {items.map((l) =>
        l.to ? (
          <Link key={l.key} className="btn btn--secondary btn--sm" to={l.to}>
            {l.label}
          </Link>
        ) : (
          <a key={l.key} className="btn btn--secondary btn--sm" href={l.url} target="_blank" rel="noopener noreferrer">
            <Icon name="ext" />
            {l.label}
            <span className="vh">{t('ui.opensNewTab')}</span>
          </a>
        ),
      )}
    </div>
  );
}

const publicUrl = (src) => (src ? `${import.meta.env.BASE_URL}${src.replace(/^\//, '')}` : '');

function Media({ media, urls }) {
  const images = media.filter((m) => m.type === 'image' && (m.mediaId ? urls[m.mediaId] : m.src));
  const videos = media.filter((m) => m.type === 'video');
  return (
    <div className="cm-media">
      {images.length > 0 && (
        <div className={`cm-photos cm-photos--${Math.min(images.length, 4)}`}>
          {images.map((m, i) => (
            <figure key={m.mediaId || m.src || i}>
              <img src={m.mediaId ? urls[m.mediaId] : publicUrl(m.src)} alt={m.alt || ''} loading="lazy" decoding="async" />
              {m.caption && <figcaption>{m.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {videos.map((m, i) => (m.embed ? <Embed key={`e${i}`} media={m} /> : <VideoFile key={`v${i}`} media={m} url={m.mediaId ? urls[m.mediaId] : publicUrl(m.src)} />))}
    </div>
  );
}

function VideoFile({ media, url }) {
  const [failed, setFailed] = useState(false);
  if (!url) return null;
  const type = /\.webm$/i.test(media.src || '') ? 'video/webm' : /\.mp4$/i.test(media.src || '') ? 'video/mp4' : undefined;
  return (
    <figure className="cm-video">
      {failed ? (
        <Notice icon="video">{t('community.videoUnsupported')}</Notice>
      ) : (
        // preload="none": the file loads only when someone presses play.
        <video controls preload="none" playsInline poster={media.poster ? publicUrl(media.poster) : undefined} onError={() => setFailed(true)}>
          <source src={url} type={type} onError={() => setFailed(true)} />
        </video>
      )}
      {media.caption && <figcaption>{media.caption}</figcaption>}
    </figure>
  );
}

/** A YouTube or Vimeo player that loads only when asked, so nothing is sent to them before. */
function Embed({ media }) {
  const [on, setOn] = useState(false);
  const site = PROVIDER[media.provider] || 'video';
  return (
    <figure className="cm-video">
      <div className="cm-embed">
        {on ? (
          <iframe
            src={`${media.embed}${media.embed.includes('?') ? '&' : '?'}autoplay=1`}
            title={media.caption || t('community.videoFrom', { site })}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" className="cm-embed__play" onClick={() => setOn(true)}>
            <span className="cm-embed__ic" aria-hidden="true">
              <Icon name="play" />
            </span>
            <span>{t('community.playFrom', { site })}</span>
          </button>
        )}
      </div>
      {media.caption && <figcaption>{media.caption}</figcaption>}
    </figure>
  );
}

/* ---------- Filters ---------- */

function FiltersSheet({ open, onClose, cityCounts, cityFilter, setCityFilter, sort, setSort, homeCity, count, onClear }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('community.filtersTitle')}
      footer={
        <div className="btn-row cm-sheet-foot">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {tn('community.showPosts', count)}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClear}>
            {t('community.clear')}
          </button>
        </div>
      }
    >
      <div className="field">
        <label className="label" htmlFor="cm-city">
          {t('community.city')}
        </label>
        <select id="cm-city" className="select" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
          <option value="">{t('community.allCities')}</option>
          {cityCounts.map(({ city, n }) => (
            <option key={city.cityId} value={city.cityId}>
              {t('community.cityOption', { city: city.name, n })}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="field cm-sort">
        <legend className="label">{t('community.sort')}</legend>
        <label className="check-row">
          <input type="radio" name="cm-sort" value="newest" checked={sort === 'newest'} onChange={() => setSort('newest')} />
          <span>{t('community.sortNewest')}</span>
        </label>
        <label className="check-row">
          <input type="radio" name="cm-sort" value="city" checked={sort === 'city'} disabled={!homeCity} onChange={() => setSort('city')} />
          <span>
            {homeCity ? t('community.sortCity', { city: homeCity.name }) : t('community.sortCityNone')}
          </span>
        </label>
      </fieldset>
    </Sheet>
  );
}

/* ---------- Writing a post ---------- */

function Composer({ open, onClose, profile, prefs, cities, mode, onPosted }) {
  const [draft, setDraft] = useState(() => readDraft(profile.id) || blankDraft(profile, prefs));
  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState(null);
  const [errors, setErrors] = useState({});
  const [mediaNote, setMediaNote] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);
  const formRef = useRef(null);
  const draftUrls = useRef(new Set());
  const draftFor = useRef(profile.id);

  // Another profile, another draft.
  if (draftFor.current !== profile.id) {
    draftFor.current = profile.id;
    setDraft(readDraft(profile.id) || blankDraft(profile, prefs));
  }

  // Text survives closing the sheet, a language switch and a reload (this tab only).
  useEffect(() => {
    const blank = blankDraft(profile, prefs);
    const empty = !draft.title.trim() && !draft.body.trim() && !draft.videoUrl.trim();
    writeDraft(profile.id, empty && draft.kind === blank.kind ? null : draft);
  }, [draft, profile, prefs]);

  // Photo and video previews belong to this composer until a post takes them over.
  useEffect(() => {
    const set = draftUrls.current;
    return () => {
      for (const u of set) URL.revokeObjectURL(u);
      set.clear();
    };
  }, []);
  const preview = (blob) => {
    const u = URL.createObjectURL(blob);
    draftUrls.current.add(u);
    return u;
  };
  const drop = (u) => {
    if (u && draftUrls.current.delete(u)) URL.revokeObjectURL(u);
  };

  const set = (key) => (e) => {
    const value = e && e.target ? e.target.value : e;
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: '' }));
  };

  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const notes = [];
    const images = files.filter((f) => PHOTO_TYPES.includes(f.type));
    const videos = files.filter((f) => f.type.startsWith('video/'));
    if (images.length + videos.length < files.length) notes.push(t('community.media.skipped'));
    const room = MAX_PHOTOS - photos.length;
    if (images.length > room) notes.push(tn('community.media.tooMany', MAX_PHOTOS));
    if (videos.length) {
      const v = videos[0];
      if (video || videos.length > 1) notes.push(t('community.media.oneVideo'));
      if (!video) {
        if (v.size > MAX_VIDEO_MB * 1024 * 1024) notes.push(t('community.media.videoTooLarge', { mb: MAX_VIDEO_MB }));
        else setVideo({ blob: v, name: v.name, size: v.size, url: preview(v) });
      }
    }
    if (images.length && room > 0) {
      setProcessing(true);
      const added = [];
      for (const f of images.slice(0, room)) {
        const blob = await downscaleImage(f);
        added.push({ id: newPostId(), blob, alt: '', name: f.name, url: preview(blob) });
      }
      setPhotos((prev) => [...prev, ...added].slice(0, MAX_PHOTOS));
      setProcessing(false);
    }
    setMediaNote(notes.join(' '));
  };

  const removePhoto = (i) => {
    const p = photos[i];
    drop(p && p.url);
    setPhotos((prev) => prev.filter((_, j) => j !== i));
    // Keep focus in the media area: the next photo's description, or the add button.
    setTimeout(() => {
      const next = document.getElementById(`cm-alt-${Math.min(i, photos.length - 2)}`);
      (next || fileRef.current?.previousElementSibling)?.focus();
    }, 0);
  };

  const removeVideo = () => {
    drop(video && video.url);
    setVideo(null);
  };

  const close = () => {
    setErrors({});
    setSaveError('');
    onClose();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || processing) return;
    const next = {};
    if (!draft.title.trim()) next.title = t('community.errors.title');
    if (!draft.body.trim()) next.body = t('community.errors.body');
    const link = draft.videoUrl.trim() ? parseVideoUrl(draft.videoUrl) : null;
    if (draft.videoUrl.trim() && !link) next.videoUrl = t('community.errors.videoUrl');
    setErrors(next);
    const first = ['title', 'body', 'videoUrl'].find((k) => next[k]);
    if (first) {
      const el = formRef.current && formRef.current.querySelector(`[name="${first}"]`);
      if (el) el.focus();
      return;
    }
    setBusy(true);
    setSaveError('');
    const id = newPostId();
    const media = [];
    const files = [];
    const mediaUrls = {};
    photos.forEach((p, i) => {
      const mediaId = `${id}-img${i}`;
      media.push({ type: 'image', mediaId, alt: p.alt.trim() });
      files.push({ id: mediaId, blob: p.blob });
      mediaUrls[mediaId] = p.url;
    });
    if (video) {
      const mediaId = `${id}-vid`;
      media.push({ type: 'video', mediaId });
      files.push({ id: mediaId, blob: video.blob });
      mediaUrls[mediaId] = video.url;
    }
    if (link) media.push({ type: 'video', embed: link.embed });
    const post = normalizePost({
      id,
      local: true,
      profileId: profile.id,
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      cityId: draft.cityId,
      author: { name: draft.name },
      postedAt: postDate(),
      createdAt: new Date().toISOString(),
      media,
    });
    try {
      await savePost(post, files);
    } catch (err) {
      setSaveError(isQuotaError(err) ? t('community.errors.quota') : t('community.errors.save'));
      setBusy(false);
      const body = formRef.current && formRef.current.closest('.sheet__body');
      if (body) body.scrollTo({ top: 0 });
      return;
    }
    // The feed owns these previews now.
    for (const u of Object.values(mediaUrls)) draftUrls.current.delete(u);
    setPhotos([]);
    setVideo(null);
    setMediaNote('');
    setDraft({ ...blankDraft(profile, prefs), kind: draft.kind, cityId: draft.cityId, name: draft.name });
    writeDraft(profile.id, null);
    setBusy(false);
    onPosted(post, mediaUrls);
  };

  const err = (key) =>
    errors[key] ? (
      <p className="err" id={`cm-${key}-err`}>
        <Icon name="alert" />
        {errors[key]}
      </p>
    ) : null;
  const described = (key, help) => [help, errors[key] ? `cm-${key}-err` : ''].filter(Boolean).join(' ') || undefined;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('community.composerTitle')}
      footer={
        <div className="btn-row cm-sheet-foot">
          <button type="submit" form="cm-form" className="btn btn--primary" disabled={busy || processing}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {t('community.post')}
          </button>
          <button type="button" className="btn btn--quiet" onClick={close}>
            {t('community.cancel')}
          </button>
        </div>
      }
    >
      <form id="cm-form" ref={formRef} className="cm-form" onSubmit={submit} noValidate>
        {mode === 'memory' && <Notice tone="amber">{t('community.memoryOnly')}</Notice>}
        {saveError && (
          <Notice tone="stop" role="alert">
            {saveError}
          </Notice>
        )}

        <div className="field">
          <span className="label" id="cm-kind-l">
            {t('community.kindsLabel')}
          </span>
          <Segmented block label={t('community.kindsLabel')} value={draft.kind} onChange={set('kind')} options={KINDS.map((k) => ({ value: k, label: t(`community.kinds.${k}`) }))} />
        </div>

        <div className="field">
          <label className="label" htmlFor="cm-title">
            {t('community.titleLabel')}
          </label>
          <input id="cm-title" name="title" className="input" dir={inputDir(draft.title)} value={draft.title} onChange={set('title')} maxLength={MAX_TITLE} placeholder={t('community.titlePlaceholder')} aria-invalid={Boolean(errors.title)} aria-describedby={described('title')} />
          {err('title')}
        </div>

        <div className="field">
          <label className="label" htmlFor="cm-body">
            {t('community.bodyLabel')}
          </label>
          <textarea id="cm-body" name="body" className="textarea" dir={inputDir(draft.body)} rows={5} value={draft.body} onChange={set('body')} maxLength={MAX_BODY} placeholder={t('community.bodyPlaceholder')} aria-invalid={Boolean(errors.body)} aria-describedby={described('body')} />
          {err('body')}
        </div>

        <div className="cm-form__two">
          <div className="field">
            <label className="label" htmlFor="cm-city-in">
              {t('community.cityLabel')}
            </label>
            <select id="cm-city-in" className="select" value={draft.cityId} onChange={set('cityId')}>
              <option value="">{t('community.noCity')}</option>
              {cities.map((c) => (
                <option key={c.cityId} value={c.cityId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="cm-name">
              {t('community.nameLabel')} <span className="opt">{t('community.optional')}</span>
            </label>
            <input id="cm-name" className="input" dir={inputDir(draft.name)} value={draft.name} onChange={set('name')} maxLength={MAX_NAME} autoComplete="given-name" aria-describedby="cm-name-help" />
            <p className="help" id="cm-name-help">
              {t('community.nameHelp')}
            </p>
          </div>
        </div>

        <div className="field">
          <span className="label">
            {t('community.mediaLabel')} <span className="opt">{t('community.optional')}</span>
          </span>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={processing || (photos.length >= MAX_PHOTOS && Boolean(video))}>
              {processing ? <span className="spinner" aria-hidden="true" /> : <Icon name="camera" />}
              {t('community.media.add')}
            </button>
            <input ref={fileRef} type="file" className="vh" tabIndex={-1} aria-hidden="true" accept={[...PHOTO_TYPES, 'video/*'].join(',')} multiple onChange={onFiles} />
          </div>
          <p className="help">{tn('community.media.help', MAX_PHOTOS)}</p>
          {mediaNote && (
            <p className="help cm-form__note" role="status">
              {mediaNote}
            </p>
          )}
          {photos.length > 0 && (
            <ul className="cm-thumbs">
              {photos.map((p, i) => (
                <li key={p.id} className="cm-thumb">
                  <img src={p.url} alt="" />
                  <div className="cm-thumb__fields">
                    <label className="vh" htmlFor={`cm-alt-${i}`}>
                      {t('community.media.altLabel', { n: i + 1 })}
                    </label>
                    <input id={`cm-alt-${i}`} className="input" dir={inputDir(p.alt)} value={p.alt} maxLength={160} placeholder={t('community.media.altPlaceholder')} onChange={(e) => setPhotos((prev) => prev.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
                    <button type="button" className="btn btn--quiet btn--sm" onClick={() => removePhoto(i)} aria-label={t('community.media.removePhoto', { n: i + 1 })}>
                      {t('community.media.remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {video && (
            <div className="cm-file">
              <Icon name="video" />
              <span className="cm-file__name">{t('community.media.videoAttached', { name: video.name, mb: formatNumber(video.size / 1024 / 1024, undefined, { maximumFractionDigits: 1 }) })}</span>
              <button type="button" className="btn btn--quiet btn--sm" onClick={removeVideo}>
                {t('community.media.remove')}
              </button>
            </div>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="cm-video-url">
            {t('community.videoUrlLabel')} <span className="opt">{t('community.optional')}</span>
          </label>
          <input id="cm-video-url" name="videoUrl" className="input" dir="ltr" value={draft.videoUrl} onChange={set('videoUrl')} inputMode="url" placeholder="https://youtu.be/" aria-invalid={Boolean(errors.videoUrl)} aria-describedby={described('videoUrl', 'cm-video-help')} />
          <p className="help" id="cm-video-help">
            {t('community.videoUrlHelp')}
          </p>
          {err('videoUrl')}
        </div>
      </form>
    </Sheet>
  );
}

/* ---------- Sending a post to the team ---------- */

function SendSheet({ post, city, onClose, onDone }) {
  const last = useRef(post);
  if (post) last.current = post;
  const p = post || last.current;
  const url = useMemo(() => {
    if (!p) return '';
    return buildIssueUrl(BRAND.repoUrl, p, {
      kindLabel: t(`community.kinds.${p.kind}`),
      cityName: city ? city.name : '',
      labels: {
        kind: t('community.issue.kind'),
        city: t('community.issue.city'),
        author: t('community.issue.author'),
        video: t('community.issue.video'),
        attachments: (n) => tn('community.issue.attachments', n),
        shortened: t('community.issue.shortened'),
      },
    });
  }, [p, city]);

  const copy = async () => {
    const ok = await copyText(`${p.title}\n\n${p.body}`);
    onDone(ok ? t('community.copied') : t('community.copyFailed'));
    onClose();
  };

  return (
    <Sheet
      open={Boolean(post)}
      onClose={onClose}
      title={t('community.sendTitle')}
      footer={
        <div className="btn-row cm-sheet-foot">
          <a
            className="btn btn--primary"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              onClose();
              onDone(t('community.sent'));
            }}
          >
            <Icon name="ext" size={20} />
            {t('community.sendOpen')}
            <span className="vh">{t('ui.opensNewTab')}</span>
          </a>
          <button type="button" className="btn btn--quiet" onClick={copy}>
            <Icon name="copy" size={20} />
            {t('community.copyText')}
          </button>
        </div>
      }
    >
      <div className="cm-send">
        <p>{t('community.sendBody')}</p>
        <Notice tone="amber" icon="eye">
          {t('community.sendPublic')}
        </Notice>
      </div>
    </Sheet>
  );
}
