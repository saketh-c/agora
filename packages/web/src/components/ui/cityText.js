/**
 * Helpers for text that comes from a city's own data (sign-up rules, deadlines, how to send a
 * written comment). That text is long, written by the city, and full of bare URLs, email
 * addresses and "4 p.m." times. These helpers make it read like the rest of the app.
 */
import { getLocale } from '@agora/core';

/** URLs, bare domains with a path, and email addresses inside a city's text. */
export const LINK_RE = /(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:gov|org|com|net|us|io)(?:\/[^\s<>()]*[^\s<>().,;:!?'"])?)/gi;

const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
// A link to a page: a full URL, a domain with a path, or a host with a subdomain of 4+ letters
// ("feedback.cor.gov"). A bare "city.gov" is the city's home page, never a comment form.
const PAGE_RE = /https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]|\b(?:[a-z0-9-]+\.)+(?:gov|org|com|net|us|io)\/[^\s<>()]*[^\s<>().,;:!?'"]|\b(?!www\.)[a-z0-9-]{4,}\.(?:[a-z0-9-]+\.)+(?:gov|org|com|net|us|io)\b/gi;
const FORMISH = /form|comment|feedback|ideas|input|docspublished/i;

/**
 * English data says "4 p.m." and "5:00 p.m."; the app says "4:00 PM". In English this rewrites
 * the city's times to the app's style (keeping a sentence-ending period); other languages
 * keep their own translation untouched.
 */
export function tidyTimes(text, lang = getLocale()) {
  const s = String(text || '');
  // Spanish keeps "4 p.m." but never splits it across two lines.
  if (lang !== 'en') return s.replace(/(\d)\s+([ap]\.\s?m\.)/g, '$1 $2');
  return s.replace(/\b(\d{1,2})(?::(\d{2}))?\s?([ap])\.\s?m\./g, (all, h, m, ap, at) => {
    const time = `${h}:${m || '00'} ${ap.toUpperCase()}M`;
    // "m." also ended the sentence when the text ends or a new sentence starts after it.
    const rest = s.slice(at + all.length);
    return /^\s*$|^\s+[A-Z]/.test(rest) ? `${time}.` : time;
  });
}

/**
 * The one way to send a written comment, read from a city's `writtenCommentMethod` text:
 * { kind: 'form', href } when the text names an online comment form first, { kind: 'email',
 * email } when it names an address, or null when it only describes a process.
 */
export function writtenContact(text) {
  const s = String(text || '');
  const emails = [...s.matchAll(EMAIL_RE)];
  // Blank out the addresses so their domains ("plano.gov") never read as pages.
  let masked = s;
  for (const m of emails) masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
  const page = [...masked.matchAll(PAGE_RE)].find((m) => FORMISH.test(m[0]));
  const email = emails[0];
  if (page && (!email || page.index < email.index)) return { kind: 'form', href: /^https?:/i.test(page[0]) ? page[0] : `https://${page[0]}` };
  if (email) return { kind: 'email', email: email[0] };
  return null;
}
