/**
 * Helpers for text that comes from a city's own data (sign-up rules, deadlines, how to send a
 * written comment). That text is long, written by the city, and full of bare URLs, email
 * addresses and "4 p.m." times. These helpers make it read like the rest of the app.
 */
import { getLocale, parseDate, t, tList, weekdayOf } from '@agora/core';

/**
 * Form vendors a city's text names as a bare host ("hosted at us.openforms.com"). The bare host
 * is the vendor's own sign-in page, not the city's form, so it stays plain text; a full form
 * address on the same host ("us.openforms.com/Form/...") is still a link.
 */
const BARE_VENDOR_HOSTS = ['openforms.com', 'us.openforms.com'];
const VENDOR = `(?:www\\.)?(?:${BARE_VENDOR_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})`;

/** URLs, bare domains with a path, and email addresses inside a city's text. */
export const LINK_RE = new RegExp(
  `(https?:\\/\\/[^\\s<>()]*[^\\s<>().,;:!?'"]|\\b[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+\\b|\\b(?!${VENDOR}(?!\\/|\\.?[\\w-]))(?:www\\.)?[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:gov|org|com|net|us|io)(?:\\/[^\\s<>()]*[^\\s<>().,;:!?'"])?)`,
  'gi',
);

const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

/** A US phone number: "214-670-3738", "(972) 205-2000", "972.205.2000", "+1 817-392-6150". */
export const PHONE_RE = /(?:\+1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[.-]\d{4}\b/g;
// A link to a page: a full URL, a domain with a path, or a host with a subdomain of 4+ letters
// ("feedback.cor.gov"). A bare "city.gov" is the city's home page, never a comment form.
const PAGE_RE = /https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]|\b(?:[a-z0-9-]+\.)+(?:gov|org|com|net|us|io)\/[^\s<>()]*[^\s<>().,;:!?'"]|\b(?!www\.)[a-z0-9-]{4,}\.(?:[a-z0-9-]+\.)+(?:gov|org|com|net|us|io)\b/gi;
const FORMISH = /form|comment|feedback|ideas|input|docspublished/i;

/** A month or weekday name (or its abbreviation) as a whole word. */
const DATE_WORD = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\\.?(?![A-Za-z])';
/** After a time: the end of the text, or a new sentence (a capital that is not a date word). */
const SENTENCE_AFTER = new RegExp(`^\\s*$|^\\s+(?!${DATE_WORD})[A-Z]`);

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
    // "m." also ended the sentence when the text ends or a new sentence starts after it. A
    // month or weekday after the time ("11:59 p.m. May 31") continues the same sentence.
    const rest = s.slice(at + all.length);
    return SENTENCE_AFTER.test(rest) ? `${time}.` : time;
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

/** "with subject 'Public Comment - Tuesday, [date]' plus first name, last name and address" */
const SUBJECT_RE = /\bsubject(?:\s+line)?\s*:?\s*(['"“‘])(.+?)(?:['"”’])(?=[\s,.;:)]|$)/i;
const ASKED_FIELDS = [
  ['first', /\bfirst name\b/i],
  ['last', /\blast name\b/i],
  ['address', /\baddress\b/i],
];
const ENGLISH_WEEKDAYS = /\b(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/;

/**
 * What a city's `writtenCommentMethod` (its English text) asks of an emailed comment:
 * { subject, fields, readAloud }. `subject` is the subject line it quotes ("Public Comment -
 * Tuesday, [date]") or null; `fields` the details it wants with it ('first', 'last',
 * 'address'); `readAloud` is 'no' when written comments are not read aloud, 'notAlways' when
 * not always, otherwise null.
 */
export function writtenRules(text) {
  const s = String(text || '');
  const m = SUBJECT_RE.exec(s);
  let fields = [];
  if (m) {
    // Only the details named with the subject ("... plus first name, last name and address").
    const after = s.slice(m.index + m[0].length).split(/[;.](?:\s|$)/)[0];
    fields = ASKED_FIELDS.filter(([, re]) => re.test(after)).map(([id]) => id);
  }
  const readAloud = /\bnot always (?:be )?read aloud\b/i.test(s) ? 'notAlways' : /\b(?:not|no longer|never) (?:be )?read aloud\b/i.test(s) ? 'no' : null;
  return { subject: m ? m[2].trim() : null, fields, readAloud };
}

/** "October 20, 2026", in English: city staff read the subject line. */
function englishDate(date) {
  const { y, m, d } = parseDate(date);
  return `${tList('format.months', 'en')[m - 1]} ${d}, ${y}`;
}

/**
 * The subject and the opening lines of an emailed comment, in English whatever the app's
 * language, because they are for city staff: the city's own subject line when it asks for one
 * (its weekday and [date] filled in from the meeting), else "Public comment for Plano City
 * Council, Oct 12"; and, when the city asks for them, "First name:", "Last name:" and
 * "Address:" lines above the comment (the name filled in from `name`).
 * Returns { subject, lead } where `lead` is '' or the lines to put before the comment.
 */
export function commentEmail({ method, cityName, meeting, name = '' }) {
  const rules = writtenRules(method);
  const council = t('ui.council', { city: cityName }, 'en');
  let subject;
  if (rules.subject) {
    subject = rules.subject;
    if (meeting) {
      subject = subject.replace(ENGLISH_WEEKDAYS, tList('format.weekdays', 'en')[weekdayOf(meeting.date)]).replace(/\[\s*date\s*\]/i, englishDate(meeting.date));
    }
  } else {
    subject = meeting
      ? t('prepare.write.emailSubject', { council, date: t('ui.monthDay', { month: tList('format.monthsShort', 'en')[parseDate(meeting.date).m - 1], day: parseDate(meeting.date).d }, 'en') }, 'en')
      : t('prepare.write.emailSubjectCity', { council }, 'en');
  }
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const values = { first: words[0] || '', last: words.slice(1).join(' '), address: '' };
  const lead = rules.fields.map((f) => `${t(`prepare.write.emailFields.${f}`, undefined, 'en')}: ${values[f]}`.trimEnd()).join('\n');
  return { subject, lead, readAloud: rules.readAloud, asks: rules.fields };
}
