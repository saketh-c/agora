import readline from 'node:readline';
import { topicList, cityPoint, defaultPrefs, setLocale, t, BRAND, LOCALES, searchFold, offeredLocales, joinItems } from '@agora/core';
import { c, heading, safe, wrapText } from './ui.js';
import { savePrefs } from './prefs.js';
import { matchCity } from './data.js';

const INDENT = '   ';

/** Setup stopped early: Ctrl+C ('interrupt'), or input ended with Ctrl+D or a short pipe ('eof'). */
class Cancelled extends Error {
  constructor(reason) {
    super(`Setup cancelled (${reason})`);
    this.reason = reason;
  }
}

/**
 * Compare answers without case or Latin accents, so "SI", "si" and "sí" (or "co" and "có")
 * match. Devanagari and Telugu vowel signs are letters there and stay (core's searchFold).
 */
const fold = (s) => searchFold(s);

/** A comma-separated word list from the dictionary ("s, si, sí"), folded for comparison. */
const wordList = (s) => String(s || '').split(',').map(fold).filter(Boolean);

/** English answers work in every language, since many people type y/n out of habit. */
const ENGLISH_YES = ['y', 'yes'];
const ENGLISH_NO = ['n', 'no'];

/** The language a typed answer names: a code ("es"), or a name in English or in itself ("Español"). */
function languageFrom(answer) {
  const a = fold(answer);
  if (!a) return null;
  const hit = LOCALES.find((l) => [l.code, l.tag, l.name, l.nativeName, ...(l.aliases || [])].some((x) => fold(x) === a));
  return hit ? hit.code : null;
}

async function defaultGeocode(query, cities) {
  const { geocode } = await import('@agora/server/geocode');
  return geocode(query, cities);
}

const samePoint = (a, b) => Boolean(a && b && a.lat === b.lat && a.lng === b.lng);

/**
 * Interactive first-run setup. Saves ~/.agora.json (or the file named by AGORA_PREFS).
 *
 * Answers are read from readline's async line iterator rather than rl.question(). Lines
 * that arrive while no question is waiting (a paste, or answers piped in) are kept and
 * used in order; with rl.question() they were dropped, and the end of input left the
 * question waiting forever, so piped setups exited without saving anything.
 * Ctrl+C and Ctrl+D (or input that ends early) cancel cleanly with a short message, not a
 * stack trace, and nothing is saved.
 *
 * @param {object[]} cities
 * @param {object} existing saved preferences, used as defaults
 * @param {string} lang language to ask the first question in
 * @param {{input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, geocode?: Function, save?: Function}} [io]
 *   streams and services, replaceable in tests
 * @returns {Promise<{code: number, prefs: object | null, file: string | null}>} code is 0 when
 *   saved, 130 after Ctrl+C, 1 when input ended early or the file could not be written
 */
export async function runWizard(cities, existing, lang = 'en', { input = process.stdin, output = process.stdout, geocode = defaultGeocode, save = savePrefs } = {}) {
  const terminal = Boolean(input.isTTY && output.isTTY);
  const rl = readline.createInterface({ input, output, terminal });
  const lines = rl[Symbol.asyncIterator]();
  let closed = false;
  let interrupted = false;
  let onInterrupt;
  const interruptedSignal = new Promise((resolve) => {
    onInterrupt = resolve;
  });
  const cancel = () => {
    interrupted = true;
    onInterrupt();
    if (!closed) rl.close();
  };
  rl.on('close', () => {
    closed = true;
  });
  // In a terminal readline turns Ctrl+C into this event; with piped input it arrives as a signal.
  rl.on('SIGINT', cancel);
  process.on('SIGINT', cancel);

  const say = (s = '') => output.write(`${s}\n`);
  const cmd = BRAND.cliCommand;

  const ask = async (q, def = '') => {
    if (interrupted) throw new Cancelled('interrupt');
    const text = `${INDENT}${q}${def ? c.gray(` [${def}]`) : ''} `;
    if (closed) output.write(text);
    else {
      rl.setPrompt(text);
      rl.prompt();
    }
    const { value, done } = await lines.next();
    if (interrupted) throw new Cancelled('interrupt');
    if (done) throw new Cancelled('eof');
    const answer = String(value).trim();
    // Piped answers are not echoed by a terminal, so print them to keep the transcript readable.
    if (!terminal) output.write(`${answer}\n`);
    return answer || def;
  };

  /** Wait for a slow call (the geocoder) unless the person presses Ctrl+C first. */
  const unlessInterrupted = (promise) =>
    Promise.race([
      promise,
      interruptedSignal.then(() => {
        throw new Cancelled('interrupt');
      }),
    ]);

  const yesNo = async (q, def) => {
    const yes = wordList(t('cli.wizard.yesWords'));
    const no = wordList(t('cli.wizard.noWords'));
    const yesAll = new Set([...yes, ...ENGLISH_YES]);
    const noAll = new Set([...no, ...ENGLISH_NO]);
    for (;;) {
      const a = fold(await ask(`${q} (${yes[0]}/${no[0]})`, def ? yes[0] : no[0]));
      if (yesAll.has(a)) return true;
      if (noAll.has(a)) return false;
      say(c.yellow(`${INDENT}${t('cli.wizard.yesNoRetry', { yes: yes[0], no: no[0] })}`));
    }
  };

  try {
    const prefs = { ...defaultPrefs(), ...(existing || {}) };

    const codes = joinItems(offeredLocales(lang).map((l) => l.code));
    for (;;) {
      const code = languageFrom(await ask(t('cli.wizard.language', { codes }), lang));
      if (code) {
        prefs.lang = code;
        break;
      }
      say(c.yellow(`${INDENT}${t('cli.wizard.languageRetry', { codes })}`));
    }
    setLocale(prefs.lang);

    say(heading(t('cli.wizard.heading')));
    say(c.dim(wrapText(t('cli.wizard.intro', { cmd }), 76)));
    say();

    say(c.bold(t('cli.wizard.q1')));
    const pickable = topicList().filter((x) => x.id !== 'other');
    pickable.forEach((x, i) => say(`${INDENT}${String(i + 1).padStart(2)}. ${x.label}`));
    const current = prefs.interests.map((id) => pickable.findIndex((x) => x.id === id) + 1).filter((n) => n > 0);
    for (;;) {
      const tokens = (await ask(t('cli.wizard.pickNumbers'), current.join(',') || '1,2,4')).split(/[,\s]+/).filter(Boolean);
      const picked = tokens.map((tok) => (/^\d+$/.test(tok) ? pickable[Number(tok) - 1] : pickable.find((x) => x.id === tok.toLowerCase())));
      if (tokens.length && picked.every(Boolean)) {
        prefs.interests = [...new Set(picked.map((x) => x.id))];
        break;
      }
      say(c.yellow(`${INDENT}${t('cli.wizard.pickRetry', { n: pickable.length })}`));
    }

    say(`\n${c.bold(t('cli.wizard.q2'))}`);
    prefs.availability = {
      evenings: await yesNo(t('cli.wizard.evenings'), prefs.availability.evenings),
      daytime: await yesNo(t('cli.wizard.daytime'), prefs.availability.daytime),
      weekends: await yesNo(t('cli.wizard.weekends'), prefs.availability.weekends),
    };
    prefs.student = await yesNo(t('cli.wizard.student'), prefs.student);

    say(`\n${c.bold(t('cli.wizard.q3'))}`);
    const previous = cities.find((x) => x.cityId === prefs.homeCityId) || null;
    let city = null;
    while (!city) {
      const name = await ask(t('cli.wizard.cityPrompt'), previous ? previous.name : '');
      const found = matchCity(cities, name);
      city = found.city;
      if (city) break;
      if (found.candidates.length > 1) say(c.yellow(`${INDENT}${t('cli.wizard.cityWhich', { name, list: found.candidates.map((x) => x.name).join(', ') })}`));
      else if (found.candidates.length === 1) say(c.yellow(`${INDENT}${t('cli.wizard.cityDidYouMean', { name, city: found.candidates[0].name })}`));
      else {
        say(c.yellow(`${INDENT}${t('cli.wizard.cityNotFound', { name, n: cities.length })}`));
        say(c.dim(wrapText(cities.map((x) => x.name).join(', '), 72, INDENT.length)));
      }
    }
    prefs.homeCityId = city.cityId;

    // The saved spot is offered again only for the same home city, and only when it is not
    // some city's hall. Otherwise a new home city kept the old city's location (a Dallas
    // student measured from Plano City Hall), and pressing Enter sent that old label to the
    // geocoder even though the prompt promised city hall.
    const hall = cityPoint(city);
    const useCityHall = () => {
      prefs.location = hall;
      prefs.locationLabel = t('common.cityHallOf', { city: city.name });
    };
    const atSomeHall = cities.some((x) => samePoint(cityPoint(x), prefs.location));
    const keep = previous && previous.cityId === city.cityId && prefs.location && !atSomeHall && prefs.locationLabel ? safe(prefs.locationLabel) : '';
    const where = await ask(t('cli.wizard.zipPrompt'), keep);
    if (!where) useCityHall();
    else if (!(keep && where === keep)) {
      try {
        const g = await unlessInterrupted(Promise.resolve().then(() => geocode(where, cities)));
        if (g) {
          prefs.location = { lat: g.lat, lng: g.lng };
          prefs.locationLabel = safe(g.label);
          say(c.green(`${INDENT}${t('cli.wizard.found', { label: prefs.locationLabel })}`));
        } else {
          say(c.yellow(`${INDENT}${t('cli.wizard.noMatch')}`));
          useCityHall();
        }
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        say(c.yellow(`${INDENT}${t('cli.wizard.geoDown')}`));
        useCityHall();
      }
    }

    for (;;) {
      const n = Number.parseFloat((await ask(t('cli.wizard.howFar'), String(prefs.maxMiles))).replace(',', '.'));
      if (Number.isFinite(n) && n > 0 && n <= 200) {
        prefs.maxMiles = n;
        break;
      }
      say(c.yellow(`${INDENT}${t('cli.wizard.milesRetry')}`));
    }

    say(`\n${c.bold(t('cli.wizard.q4'))}`);
    prefs.canSpeakOnly = await yesNo(t('cli.wizard.speakOnly'), prefs.canSpeakOnly);
    prefs.virtualOk = await yesNo(t('cli.wizard.remoteOk'), prefs.virtualOk);

    let file;
    try {
      file = save(prefs);
    } catch (e) {
      say(c.red(t('cli.wizard.saveFailed', { error: e.message })));
      return { code: 1, prefs, file: null };
    }
    say(`\n${c.green(t('cli.wizard.saved'))} ${c.dim(file)}`);
    say(t('cli.wizard.runNext', { match: c.cyan(`${cmd} match`), map: c.cyan(`${cmd} map`) }));
    return { code: 0, prefs, file };
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
    say(`\n${c.yellow(t('cli.wizard.cancelled'))}`);
    return { code: e.reason === 'interrupt' ? 130 : 1, prefs: null, file: null };
  } finally {
    process.removeListener('SIGINT', cancel);
    if (!closed) rl.close();
  }
}
