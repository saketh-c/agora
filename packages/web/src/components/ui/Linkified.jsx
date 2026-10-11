import { getLocale } from '@agora/core';
import { LINK_RE, PHONE_RE, tidyTimes } from './cityText.js';
import { englishOriginalProps, isEnglishOriginal } from '../../lib/textDir.js';

/**
 * Plain text with its US phone numbers kept left to right: in Arabic, "(972) 205-2000" would
 * otherwise come apart around its parentheses.
 */
function withPhones(text, keyBase) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(PHONE_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${keyBase}-tel-${m.index}`} className="nowrap" dir="ltr">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (!out.length) return [text];
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * A city's own text with its URLs, bare domains and email addresses as links (so a long
 * address wraps as a link instead of pushing the page sideways) and its times in the app's
 * style. Links to pages open in a new tab; addresses open the mail app. Links and phone
 * numbers are set left to right (dir="ltr" isolates them), so right-to-left text around them
 * cannot reorder their characters.
 *
 * Translated text reads in the page's direction, even when it starts with a form or program
 * name kept in English ("eComment ..."), which dir="auto" or <bdi> would have turned left to
 * right. The English original of text not translated yet is marked as English, and on a
 * right-to-left page runs left to right inside its line, so "5 PM." keeps its period at the end.
 */
export default function Linkified({ text }) {
  const s = tidyTimes(text);
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    const raw = m[0];
    if (m.index > last) parts.push(...withPhones(s.slice(last, m.index), last));
    const email = raw.includes('@') && !/^https?:/i.test(raw);
    const href = email ? `mailto:${raw}` : /^https?:/i.test(raw) ? raw : `https://${raw}`;
    parts.push(
      <a key={`${m.index}-${raw}`} className="link" dir="ltr" href={href} {...(email ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
        {raw}
      </a>,
    );
    last = m.index + raw.length;
  }
  if (last < s.length) parts.push(...withPhones(s.slice(last), last));
  const lang = getLocale();
  return isEnglishOriginal(s, lang) ? <span {...englishOriginalProps(true, lang)}>{parts}</span> : <>{parts}</>;
}
