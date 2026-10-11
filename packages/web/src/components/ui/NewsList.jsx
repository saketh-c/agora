import { t } from '@agora/core';
import Icon from './Icon.jsx';

/** "Sep 15" (or "Sep 15, 2025" in another year), in Central time and the app language. */
export function newsDate(iso, lang) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const locale = { en: 'en-US', es: 'es-US', vi: 'vi-VN' }[lang] || 'en-US';
  const sameYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(d) === new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(new Date());
  return new Intl.DateTimeFormat(locale, { timeZone: 'America/Chicago', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

/**
 * Headlines as link rows that open the source in a new tab: title, then "Source, date".
 * items: [{ title, link, sourceName, publishedAt }] as returned by api.news().
 */
export default function NewsList({ items, limit, lang = 'en', className = '' }) {
  const list = (items || []).filter((i) => i && i.title && i.link).slice(0, limit || undefined);
  if (!list.length) return null;
  return (
    <ul className={`group ${className}`.trim()}>
      {list.map((item) => {
        // No-break spaces keep a date ("9 thg 10") on one line at the end of the source.
        const date = newsDate(item.publishedAt, lang).replace(/ /g, ' ');
        const meta = [item.sourceName, date].filter(Boolean).join(', ');
        return (
          <li key={item.link}>
            <a className="lrow" href={item.link} target="_blank" rel="noopener noreferrer">
              <span>
                {/* Headlines come from English-language newsrooms: read them with an English voice. */}
                <span className="lrow__t" lang="en">
                  {item.title}
                </span>
                {meta && <span className="lrow__m">{meta}</span>}
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
