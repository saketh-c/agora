import { Fragment } from 'react';
import { intlLocale, t } from '@agora/core';
import Icon from './Icon.jsx';
import { englishOriginalProps } from '../../lib/textDir.js';

/** "Sep 15" (or "Sep 15, 2025" in another year), in Central time and the app language. */
export function newsDate(iso, lang) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const locale = intlLocale(lang);
  const sameYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(d) === new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(new Date());
  return new Intl.DateTimeFormat(locale, { timeZone: 'America/Chicago', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

/**
 * The source and the date in the language's own news.sourceDate template ("{source}, {date}";
 * "{source}，{date}" in Chinese), each param rendered as its own node.
 */
function SourceDate({ source, date, lang }) {
  if (!source || !date) return source || date;
  const pieces = t('news.sourceDate', undefined, lang).split(/\{(\w+)\}/);
  return pieces.map((piece, i) => <Fragment key={i}>{i % 2 ? { source, date }[piece] : piece}</Fragment>);
}

/**
 * Headlines as link rows that open the source in a new tab: title, then "Source, date".
 * items: [{ title, link, sourceName, publishedAt }] as returned by api.news().
 * The headline and the source are English (lang="en", and dir="ltr" on a right-to-left page); the date is in the app's language. The
 * source is isolated (<bdi>), so on an Arabic page "Community Impact (DFW education)" and
 * "9 أكتوبر" stay two pieces in the line's order instead of one run that splits the date.
 */
export default function NewsList({ items, limit, lang = 'en', className = '' }) {
  const list = (items || []).filter((i) => i && i.title && i.link).slice(0, limit || undefined);
  if (!list.length) return null;
  return (
    <ul className={`group ${className}`.trim()}>
      {list.map((item) => {
        // No-break spaces keep a date ("9 thg 10") on one line at the end of the source.
        const date = newsDate(item.publishedAt, lang).replace(/ /g, ' ');
        return (
          <li key={item.link}>
            <a className="lrow" href={item.link} target="_blank" rel="noopener noreferrer">
              <span>
                {/* Headlines come from English-language newsrooms: read them with an English voice. */}
                <span className="lrow__t" {...englishOriginalProps(true, lang)}>
                  {item.title}
                </span>
                {(item.sourceName || date) && (
                  <span className="lrow__m">
                    <SourceDate lang={lang} source={item.sourceName && <bdi lang="en">{item.sourceName}</bdi>} date={date && <span className="nowrap">{date}</span>} />
                  </span>
                )}
              </span>
              <Icon name="ext" />
              <span className="vh">{t('ui.opensNewTab')}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
