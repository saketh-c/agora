import { LINK_RE, tidyTimes } from './cityText.js';

/**
 * A city's own text with its URLs, bare domains and email addresses as links (so a long
 * address wraps as a link instead of pushing the page sideways) and its times in the app's
 * style. Links to pages open in a new tab; addresses open the mail app.
 */
export default function Linkified({ text }) {
  const s = tidyTimes(text);
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    const raw = m[0];
    if (m.index > last) parts.push(s.slice(last, m.index));
    const email = raw.includes('@') && !/^https?:/i.test(raw);
    const href = email ? `mailto:${raw}` : /^https?:/i.test(raw) ? raw : `https://${raw}`;
    parts.push(
      <a key={`${m.index}-${raw}`} className="link" href={href} {...(email ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
        {raw}
      </a>,
    );
    last = m.index + raw.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <>{parts}</>;
}
