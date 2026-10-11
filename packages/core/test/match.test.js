import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchMeetings, matchAgendaItems, buildPlan, normalizePrefs } from '../src/match.js';
import { validateCity, scheduleWarnings } from '../src/validate.js';
import { inferTopics } from '../src/topics.js';
import { buildComment, estimateSpeakingSeconds } from '../src/civics.js';
import { computeStats } from '../src/stats.js';
import { findCity, haversineMiles } from '../src/geo.js';
import { upcomingMeetings } from '../src/schedule.js';
import { setLocale } from '../src/i18n/index.js';

const cities = [
  {
    cityId: 'plano',
    name: 'Plano',
    county: 'Collin',
    website: 'https://www.plano.gov',
    cityHall: { address: '1520 K Ave, Plano, TX 75074', lat: 33.0198, lng: -96.6989 },
    meetings: [{ type: 'regular', label: 'City Council meeting', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 1, ordinals: [2, 4], time: '19:00' } }],
    publicComment: { summary: 'Fill out a card.', howToRegister: 'Speaker card at the door.', virtualAllowed: false, timeLimitMinutes: 3 },
    youthPrograms: [{ name: 'Plano Youth Council' }],
    agendaItems: [{ title: 'Rezoning for apartments near Legacy', meetingDate: '2026-09-14', topics: ['zoning-development', 'housing'] }],
    confidence: 'high',
    sources: ['https://www.plano.gov'],
  },
  {
    cityId: 'dallas',
    name: 'Dallas',
    county: 'Dallas',
    website: 'https://dallascityhall.com',
    cityHall: { address: '1500 Marilla St, Dallas, TX 75201', lat: 32.7767, lng: -96.797 },
    meetings: [
      { type: 'regular', label: 'City Council voting meeting', openToPublicComment: true, recurrence: { kind: 'nth-weekday', weekday: 3, ordinals: [2, 4], time: '09:00' } },
      { type: 'briefing', label: 'Council briefing', openToPublicComment: false, recurrence: { kind: 'nth-weekday', weekday: 3, ordinals: [1, 3], time: '09:00' } },
    ],
    publicComment: { summary: 'Register online.', howToRegister: 'Online form by 5 PM the day before.', virtualAllowed: true, timeLimitMinutes: 3 },
    youthPrograms: [],
    agendaItems: [{ title: 'DART bus network redesign', meetingDate: '2026-09-23', topics: ['transit'] }],
    confidence: 'high',
    sources: ['https://dallascityhall.com'],
  },
];

test('fixtures validate', () => {
  for (const c of cities) assert.deepEqual(validateCity(c), []);
});

test('validator catches bad data', () => {
  const bad = { ...cities[0], cityHall: { address: 'x', lat: 40, lng: -74 }, meetings: [{ type: 'regular', label: 'x', recurrence: { kind: 'nth-weekday', weekday: 9, time: '7pm' } }] };
  const errors = validateCity(bad);
  assert.ok(errors.some((e) => e.includes('outside Dallas-Fort Worth')));
  assert.ok(errors.some((e) => e.includes('weekday')));
  assert.ok(errors.some((e) => e.includes('HH:MM')));
  assert.ok(errors.some((e) => e.includes('ordinals')));
});

test('evening student in Plano prefers Plano Monday night over Dallas Wednesday morning', () => {
  const prefs = { interests: ['housing'], availability: { evenings: true, daytime: false, weekends: true }, homeCityId: 'plano', location: { lat: 33.02, lng: -96.7 } };
  const ranked = matchMeetings(cities, prefs, { today: '2026-09-10', days: 30 });
  assert.equal(ranked[0].cityId, 'plano');
  assert.equal(ranked[0].date, '2026-09-14');
  assert.ok(ranked[0].reasons.some((r) => r.kind === 'topic' && r.text.includes('housing')));
  assert.ok(ranked[0].reasons.some((r) => r.kind === 'time' && r.text.includes('Evening')));
  const dallasVoting = ranked.find((m) => m.cityId === 'dallas' && m.type === 'regular');
  assert.ok(dallasVoting.score < ranked[0].score);
  assert.ok(dallasVoting.reasons.some((r) => r.text.includes('school hours')));
});

test('daytime availability flips the ranking toward Dallas transit items', () => {
  const prefs = { interests: ['transit'], availability: { evenings: false, daytime: true, weekends: false }, homeCityId: 'dallas' };
  const ranked = matchMeetings(cities, prefs, { today: '2026-09-10', days: 30 });
  assert.equal(ranked[0].cityId, 'dallas');
  assert.equal(ranked[0].date, '2026-09-23');
});

test('canSpeakOnly filters out briefings', () => {
  const ranked = matchMeetings(cities, { canSpeakOnly: true }, { today: '2026-09-10', days: 30 });
  assert.ok(ranked.every((m) => m.openToPublicComment));
});

test('agenda item matching', () => {
  const items = matchAgendaItems(cities, { interests: ['transit'] }, { today: '2026-09-10' });
  assert.equal(items.length, 1);
  assert.equal(items[0].cityId, 'dallas');
  const none = matchAgendaItems(cities, { interests: ['animal-services'] }, { today: '2026-09-10' });
  assert.equal(none.length, 0);
});

test('plan summary and normalization', () => {
  const plan = buildPlan(cities, { interests: ['housing', 'not-a-topic'], maxMiles: 'abc' }, { today: '2026-09-10' });
  assert.deepEqual(plan.prefs.interests, ['housing']);
  assert.equal(plan.prefs.maxMiles, 15);
  assert.match(plan.summary, /Plano/);
  assert.equal(normalizePrefs(null).virtualOk, true);
});

test('topic inference from agenda text', () => {
  assert.deepEqual(inferTopics('Ordinance amending the comprehensive zoning ordinance for a multifamily development')[0], 'zoning-development');
  assert.ok(inferTopics('Approve DART interlocal agreement for bus shelters').includes('transit'));
  assert.deepEqual(inferTopics('Proclamation honoring a resident'), ['other']);
});

test('comment builder produces a speakable draft', () => {
  const text = buildComment({ name: 'Nate', school: 'St. Mark\'s School of Texas', cityName: 'Dallas', topicId: 'transit', position: 'support', ask: 'fund the bus shelter program' });
  assert.match(text, /My name is Nate/);
  assert.match(text, /fund the bus shelter program/);
  const secs = estimateSpeakingSeconds(text);
  assert.ok(secs > 20 && secs < 180, `draft should be well under 3 minutes, got ${secs}s`);
});

test('stats aggregate', () => {
  const s = computeStats(cities, { today: '2026-09-10', days: 30 });
  assert.equal(s.totals.cities, 2);
  assert.ok(s.totals.meetings >= 4);
  assert.equal(s.byWeekdayHour[1][19] > 0, true);
  assert.equal(s.perCity.find((c) => c.cityId === 'plano').youthPrograms, 1);
  assert.ok(s.topicCounts.some((t) => t.topicId === 'transit'));
});

test('geo helpers', () => {
  assert.equal(findCity(cities, 'Fort Worth'), null);
  assert.equal(findCity(cities, 'plano').cityId, 'plano');
  assert.equal(findCity(cities, 'DAL').cityId, 'dallas');
  const miles = haversineMiles({ lat: 33.0198, lng: -96.6989 }, { lat: 32.7767, lng: -96.797 });
  assert.ok(miles > 16 && miles < 19, `Plano to Dallas city hall should be about 17.5 miles, got ${miles}`);
});

test('topic inference respects word boundaries', () => {
  assert.equal(inferTopics('Helping parents help their kids in school').includes('housing'), false, '"parents" must not match "rent"');
  assert.equal(inferTopics('Business registration program').includes('transit'), false, '"business" must not match "bus"');
  assert.ok(inferTopics('New bus shelters along Route 12').includes('transit'));
  assert.ok(inferTopics('Rental assistance for renters').includes('housing'));
  assert.deepEqual(inferTopics('Article about current events', 3, { minScore: 2 }), ['other']);
});

test('topic inference suffix rules', () => {
  assert.equal(inferTopics('Retirement transitions and sustainable income', 3, { minScore: 2 }).includes('transit'), false, '"transitions" must not match "transit"');
  assert.ok(inferTopics('Curbside recycling expansion').includes('environment'));
  assert.ok(inferTopics('Libraries extend weekend hours').includes('education-libraries'));
  assert.ok(inferTopics('Firefighter staffing plan').includes('public-safety'));
});

// ---------------------------------------------------------------------------------------------
// Regression tests for ranking quality, recent agendas, stats windows, and validation.

const nearPlano = { lat: 33.02, lng: -96.7 };

test('reasons come strongest first, so the plan summary names what mattered', () => {
  const prefs = { interests: ['housing'], homeCityId: 'plano', location: nearPlano };
  const ranked = matchMeetings(cities, prefs, { today: '2026-10-10', days: 30 });
  for (const m of ranked) {
    for (let i = 1; i < m.reasons.length; i += 1) assert.ok(Math.abs(m.reasons[i - 1].points) >= Math.abs(m.reasons[i].points), `${m.id} reasons out of order`);
  }
  const plan = buildPlan(cities, prefs, { today: '2026-10-10' });
  assert.equal(plan.meetings[0].reasons[0].kind, 'distance');
  assert.match(plan.summary, /\(under 1 mile away; evening meeting, after school\)/);
});

test('a meeting past the user\'s own limit counts against it, even under 10 miles', () => {
  const eightMilesNorth = { lat: 33.1356, lng: -96.6989 };
  const ranked = matchMeetings(cities, { location: eightMilesNorth, maxMiles: 5 }, { today: '2026-10-10', days: 30 });
  const plano = ranked.find((m) => m.cityId === 'plano');
  const distance = plano.reasons.find((r) => r.kind === 'distance');
  assert.equal(distance.points, -5);
  assert.match(distance.text, /past your 5 mile limit/);
});

test('remote comment only counts at meetings where the public may comment', () => {
  const ranked = matchMeetings(cities, { interests: ['transit'] }, { today: '2026-10-01', days: 30 });
  const briefing = ranked.find((m) => m.cityId === 'dallas' && m.type === 'briefing');
  const voting = ranked.find((m) => m.cityId === 'dallas' && m.type === 'regular');
  assert.ok(!briefing.reasons.some((r) => r.text === 'Remote comment allowed'), 'watch-only meeting');
  assert.ok(voting.reasons.some((r) => r.text === 'Remote comment allowed'));
});

test('upcoming agenda items stay the strongest topic signal; recent ones are a weak, dated hint', () => {
  const upcoming = matchMeetings(cities, { interests: ['housing'] }, { today: '2026-09-10', days: 10 }).find((m) => m.cityId === 'plano');
  const topic = upcoming.reasons.filter((r) => r.kind === 'topic');
  assert.deepEqual(topic.map((r) => [r.points, r.text]), [[3, '1 agenda item on housing']]);

  const later = matchMeetings(cities, { interests: ['housing'] }, { today: '2026-10-10', days: 10 }).find((m) => m.cityId === 'plano');
  assert.deepEqual(later.reasons.filter((r) => r.kind === 'topic').map((r) => [r.points, r.text]), [[1, 'Took up housing on Sep 14']]);
  assert.equal(later.matchedItems.length, 0, 'a past item never counts as being on an upcoming agenda');

  const unrelated = matchMeetings(cities, { interests: ['technology'] }, { today: '2026-10-10', days: 10 });
  assert.ok(unrelated.every((m) => !m.reasons.some((r) => r.kind === 'topic')), 'no generic voting-meeting reason');

  // Topics now move the ranking between otherwise identical councils.
  const twin = (cityId, topic) => ({
    ...cities[0],
    cityId,
    name: cityId,
    agendaItems: [{ title: 'Item', meetingDate: '2026-09-14', topics: [topic] }],
  });
  const pair = [twin('alpha', 'housing'), twin('beta', 'animal-services')];
  assert.equal(matchMeetings(pair, { interests: ['housing'] }, { today: '2026-10-10', days: 10 })[0].cityId, 'alpha');
  assert.equal(matchMeetings(pair, { interests: ['animal-services'] }, { today: '2026-10-10', days: 10 })[0].cityId, 'beta');

  const plan = buildPlan(cities, { interests: ['housing'] }, { today: '2026-10-10' });
  assert.deepEqual(plan.agendaItems, []);
  assert.deepEqual(plan.recentAgendaItems.map((a) => a.title), ['Rezoning for apartments near Legacy']);
});

test('perCity caps how many meetings one council contributes; buildPlan keeps two', () => {
  const prefs = { interests: ['housing'], homeCityId: 'plano', location: nearPlano };
  const count = (list, id) => list.filter((m) => m.cityId === id).length;
  assert.ok(count(matchMeetings(cities, prefs, { today: '2026-10-10', days: 45 }), 'plano') >= 3, 'no cap by default');
  const capped = matchMeetings(cities, prefs, { today: '2026-10-10', days: 45, perCity: 1 });
  assert.deepEqual(capped.map((m) => m.cityId).sort(), ['dallas', 'plano']);
  const plan = buildPlan(cities, prefs, { today: '2026-10-10' });
  assert.equal(count(plan.meetings, 'plano'), 2);
  assert.ok(plan.meetings.every((m, i, arr) => i === 0 || arr[i - 1].score >= m.score));
});

test('a meeting that ended earlier today is not ranked or recommended once now is given', () => {
  const prefs = { homeCityId: 'plano' };
  const opts = { today: '2026-10-12', days: 14 };
  assert.ok(matchMeetings(cities, prefs, opts).some((m) => m.cityId === 'plano' && m.date === '2026-10-12'));
  const late = { ...opts, now: '2026-10-12T21:30:00-05:00' };
  assert.ok(!matchMeetings(cities, prefs, late).some((m) => m.date === '2026-10-12'));
  assert.notEqual(buildPlan(cities, prefs, late).meetings[0].date, '2026-10-12');
});

test('NaN or non-numeric coordinates are dropped instead of skewing every distance', () => {
  assert.equal(normalizePrefs({ location: { lat: NaN, lng: NaN } }).location, null);
  assert.equal(normalizePrefs({ location: { lat: '33.0', lng: -96.7 } }).location, null);
  assert.equal(normalizePrefs({ location: { lat: Infinity, lng: -96.7 } }).location, null);
  assert.deepEqual(normalizePrefs({ location: nearPlano }).location, nearPlano);
  const ranked = matchMeetings(cities, { location: { lat: NaN, lng: 1 } }, { today: '2026-10-10' });
  assert.ok(ranked.every((m) => m.distanceMiles === null && !m.reasons.some((r) => r.kind === 'distance')));
});

test('findCity ignores blank queries and understands initials', () => {
  const list = [...cities, { cityId: 'fort-worth', name: 'Fort Worth' }, { cityId: 'north-richland-hills', name: 'North Richland Hills' }];
  assert.equal(findCity(list, ' '), null);
  assert.equal(findCity(list, ''), null);
  assert.equal(findCity(list, null), null);
  assert.equal(findCity(list, 'fw').cityId, 'fort-worth');
  assert.equal(findCity(list, 'NRH').cityId, 'north-richland-hills');
  assert.equal(findCity(list, 'dal').cityId, 'dallas', 'a name prefix still wins');
});

test('comment drafts keep acronyms such as DART intact in every language', () => {
  try {
    for (const lang of ['en', 'es', 'vi']) {
      setLocale(lang);
      const draft = buildComment({ name: 'Sam', cityName: 'Dallas', topicId: 'transit', position: 'support' });
      assert.ok(draft.includes('DART'), `${lang} keeps DART`);
      assert.ok(!draft.includes('dART'), `${lang} never writes dART`);
    }
  } finally {
    setLocale('en');
  }
});

test('stats use exact windows, real occurrences, and separate upcoming from recent agendas', () => {
  const s = computeStats(cities, { today: '2026-10-10', days: 30 });
  assert.equal(s.totals.meetings, upcomingMeetings(cities, { from: '2026-10-10', days: 30 }).length);
  assert.ok(upcomingMeetings(cities, { from: '2026-10-10', days: 30 }).every((m) => m.date <= '2026-11-08'));
  assert.equal(s.totals.agendaItems, 2, 'every item, as before');
  assert.equal(s.totals.upcomingAgendaItems, 0);
  assert.equal(s.totals.recentAgendaItems, 2);
  assert.deepEqual(s.upcomingTopicCounts, []);
  assert.deepEqual(s.recentTopicCounts.map((x) => x.topicId).sort(), ['housing', 'transit', 'zoning-development']);
  assert.equal(s.recentAgendaSince, '2026-08-11');
  assert.ok(s.totals.schoolHoursShare > 0 && s.totals.schoolHoursShare < 1, 'Dallas meets at 9 AM, Plano at 7 PM');

  // Cancellations come off the per-month rate.
  const cancelled = [{ ...cities[0], scheduleExceptions: [{ date: '2026-10-12', status: 'cancelled', note: 'Holiday.' }] }];
  const plain = computeStats([cities[0]], { today: '2026-10-10' }).perCity[0].evening;
  const fewer = computeStats(cancelled, { today: '2026-10-10' }).perCity[0].evening;
  assert.equal(Math.round((plain - fewer) * 3), 1, 'one fewer evening meeting over 90 days');
});

test('validator accepts note exceptions and explicit fields, and checks every link', () => {
  const good = {
    ...cities[0],
    scheduleExceptions: [
      { date: '2026-11-03', status: 'note', note: 'Held as scheduled on Election Day.' },
      { date: '2026-11-10', status: 'special', label: 'Canvass meeting', type: 'other', openToPublicComment: false, time: '18:00', note: 'Canvass.' },
      { date: '2026-11-16', status: 'rescheduled', movedFrom: '2026-11-17', time: '19:00', note: 'Moved.' },
    ],
  };
  assert.deepEqual(validateCity(good), []);
  assert.deepEqual(scheduleWarnings(good), []);
  const bad = {
    ...cities[0],
    council: { findMyDistrictUrl: 'javascript:alert(1)' },
    sources: ['https://ok.example', 'not a url'],
    agendaItems: [{ title: 'x', topics: ['housing'], url: 'ftp://x' }],
    scheduleExceptions: [
      { date: '2026-11-03', status: 'cancelled', label: 'x', time: '7pm' },
      { date: '2026-11-04', status: 'note' },
      { date: '2026-11-05', status: 'special', type: 'party' },
    ],
  };
  const errors = validateCity(bad).join('\n');
  for (const expected of ['council.findMyDistrictUrl is not a URL', 'sources[1] is not a URL', 'agendaItems[0].url is not a URL', 'scheduleExceptions[0].label only applies to special exceptions', 'scheduleExceptions[0].time "7pm" must be HH:MM', 'scheduleExceptions[1].note is required', 'scheduleExceptions[2].type "party" is not a known meeting type']) {
    assert.ok(errors.includes(expected), `missing: ${expected}`);
  }
  const smells = scheduleWarnings({
    cityId: 'denton',
    meetings: [
      { recurrence: { kind: 'custom', time: '14:00', dates: ['2026-10-13'] } },
      { recurrence: { kind: 'custom', time: '14:00', dates: ['2026-10-13', '2026-10-27'] } },
    ],
    scheduleExceptions: [{ date: '2026-11-10', status: 'rescheduled', note: 'See the calendar.' }],
  });
  assert.equal(smells.length, 2);
});
