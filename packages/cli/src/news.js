import { getTopic, formatDate, todayStr, t, joinItems, tn } from '@agora/core';
import { c, heading, bullet, wrapText, safe } from './ui.js';

const WIDTH = 76;

/**
 * A story's calendar date in Dallas time. Feeds give UTC instants, and a story published
 * at 10:30 PM Central is already the next day in UTC, so slicing the ISO string printed
 * tomorrow's date for evening stories.
 */
export function newsDate(iso) {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : formatDate(todayStr('America/Chicago', d));
}

/** True when there are feeds to read and not one of them answered: the reader is probably offline. */
export function newsOffline(result) {
  return Boolean(result && result.totalFeeds > 0 && result.fetchedFeeds === 0);
}

function tags(ids) {
  const labels = (ids || []).filter((id) => id !== 'other').map((id) => getTopic(id).label);
  return labels.length ? c.cyan(`[${joinItems(labels)}]`) : '';
}

/**
 * The `agora news` screen. Every string that came from a feed goes through safe(), which
 * removes terminal control sequences, so a feed cannot clear the screen, recolor the
 * output or hide a link's real address.
 * @param {object} result what fetchNews returned
 * @param {{topic?: string, city?: string}} [filters] the --topic and --city the user gave
 */
export function renderNews(result, { topic, city } = {}) {
  const offline = newsOffline(result);
  const topicLabel = topic ? getTopic(topic).label : '';
  const title =
    topic && city ? t('cli.newsHeadingTopicCity', { topic: topicLabel, city }) : topic ? t('cli.newsHeadingTopic', { topic: topicLabel }) : city ? t('cli.newsHeadingCity', { city }) : t('cli.newsHeading');
  const lines = [heading(title), c.dim(t('cli.feedsResponded', { n: result.fetchedFeeds, feeds: tn('cli.feedsN', result.totalFeeds) })), ''];
  for (const i of result.items || []) {
    const date = newsDate(i.publishedAt);
    const tagText = tags(i.topics);
    lines.push(c.bold(wrapText(safe(i.title), WIDTH)));
    lines.push(`  ${c.gray(`${safe(i.sourceName)}${date ? `, ${date}` : ''}`)}${tagText ? `  ${tagText}` : ''}`);
    lines.push(`  ${c.gray(safe(i.link))}`, '');
  }
  if (!(result.items || []).length && !offline) lines.push(c.yellow(t('cli.noStories')), '');
  const links = result.topicLinks || [];
  if (links.length) {
    lines.push(c.bold(t('cli.whereToRead')));
    for (const l of links.slice(0, 12)) lines.push(bullet(`${safe(l.label)} ${c.gray(`(${safe(l.sourceName)})`)}\n    ${c.gray(safe(l.url))}`));
    if (links.length > 12) lines.push(c.dim(`  ${t('cli.showingOf', { shown: 12, n: links.length })}`));
  }
  return lines.join('\n').trimEnd();
}
