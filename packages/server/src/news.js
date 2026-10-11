import { inferTopics } from '@agora/core';
import { loadCities } from '@agora/core/node';

/**
 * Local civic headlines from the curated feeds in data/news.json.
 *
 * Every item passes one deterministic relevance check before anything else happens to it.
 * A headline is kept only when it is recent, is about a Dallas-Fort Worth place, and carries
 * local-government signal (councils, budgets, zoning, elections, school boards, transit
 * agencies), after penalties for sports, weather, lifestyle and business openings, sponsored
 * posts, obituaries, national politics and crime blotter items. Only then are items tagged,
 * filtered by topic and city, and cut to the newest N, so a busy sports or weather feed can
 * never push the civic stories out of the list (or out of the static snapshot).
 *
 * Feeds are fetched with a short timeout and at most a few requests per newsroom host at a
 * time. Successes are cached for 15 minutes and failures for 5. An expired copy is served
 * while a fresh one loads, and the live endpoint stops waiting for slow feeds after a short
 * budget, so one stalled newsroom cannot hold every request hostage. Concurrent requests
 * share one in-flight fetch per feed, and items are scored and tagged once per fetch rather
 * than on every request.
 *
 * Source fields read here (data/news.json):
 * - rssUrl: the feed. A source with rssVerified: false is never fetched.
 * - coverage: city names, "dfw" for a regional newsroom, or "texas" for a statewide one. A
 *   statewide source (or one with requirePlace: true, used for feeds that mix in wire or
 *   national copy) must name a DFW place in the headline or summary. A regional or city
 *   newsroom's own coverage counts as the place.
 * - focus: "government", "elections" or "education" for section feeds the newsroom already
 *   curates as civic, which earns a head start on the civic score.
 */

export const NEWS_MAX_AGE_DAYS = 30;
export const NEWS_USER_AGENT = 'Agora civic app (student project; +https://github.com/saketh-c/agora)';

const HIT_TTL_MS = 15 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000;
// How long a last good copy may keep being served while its feed is failing or refreshing.
const STALE_LIMIT_MS = 6 * 60 * 60 * 1000;
const FEED_TIMEOUT_MS = 6000;
const MAX_PER_HOST = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS_PER_FEED = 40;
const DESCRIPTION_MAX = 280;
const DAY_MS = 86400000;

const MIN_CIVIC = 3;
const MIN_SCORE = 4;
const FOCUS_PRIOR = Object.freeze({ government: 3, elections: 3, education: 1 });

const group = (label, weight, topic, ...patterns) => ({ label, weight, topic, patterns });
const GOV = 'governance-elections';

/**
 * Local-government signal. Weights are counted once per group: in full when the headline
 * matches and at half weight when only the summary does. A group's topic also tags the
 * item, because core's keyword lists were written for agenda items and miss most of the
 * vocabulary of council coverage. Acronyms and proper names are matched case-sensitively
 * so "dart", "tad" or "ice" in ordinary prose never count.
 */
const CIVIC = [
  group('council', 3, GOV, /\bcouncils?\b/i),
  group('city council', 1, GOV, /\b(?:city|town) councils?\b|\bcouncil ?(?:wo)?m[ae]n\b|\bcouncil ?members?\b|\bcouncilmembers?\b/i),
  group('mayor', 3, GOV, /\bmayors?\b|\bmayoral\b/i),
  group('city government', 3, GOV, /\b(?:city|town) (?:hall|manager|attorney|secretary|staff|officials?|leaders?|budget|ordinances?|services)\b/i),
  group('county government', 3, GOV, /\bcommissioners'? court\b|\bcounty (?:commissioners?|commission|judge|officials?|leaders?|budget|clerk|elections?|administrator)\b/i),
  group('ordinance', 3, GOV, /\bordinances?\b/i),
  group('public hearing', 3, GOV, /\bpublic (?:hearings?|comments?|input|meetings?)\b|\btown hall meetings?\b|\bcitizen comments?\b|\bopen forum\b/i),
  group('zoning', 3, 'zoning-development', /\b(?:re)?zoning\b|\brezon(?:e|ed|es)\b|\bzoned\b|\bplanning (?:and|&) zoning\b|\bplan(?:ning)? commission\b|\bboard of adjustment\b|\bvariances?\b|\bspecial (?:use )?permits?\b/i, /\bP&Z\b/),
  group('planning', 2, 'zoning-development', /\bmixed-use\b|\bmaster plan\b|\bcomprehensive plan\b|\bsite plans?\b|\bplats?\b|\bland use\b|\bdevelopment (?:plans?|agreements?|code)\b|\bplanned development\b|\bredevelopment\b|\bthoroughfare plan\b/i),
  group('school board', 3, 'education-libraries', /\bschool boards?\b|\bboard of trustees\b|\btrustees?\b|\bsuperintendents?\b/i, /\bISD boards?\b/),
  group('school district', 3, 'education-libraries', /\bschool districts?\b/i, /\b[A-Z]{0,5}ISDs?\b/),
  group('budget', 3, 'budget-taxes', /\bbudgets?\b|\bfiscal year\b|\bgeneral fund\b/i, /\bFY ?20\d\d\b/),
  group('tax', 3, 'budget-taxes', /\btax (?:rates?|increases?|cuts?|relief|exemptions?|bills?|base)\b|\bproperty tax(?:es)?\b|\bappraisals?\b|\bsales tax\b/i, /\b(?:TAD|DCAD|CCAD)\b/),
  group('election', 3, GOV, /\belections?\b|\bballots?\b|\bearly voting\b|\bvoters?\b|\bvoting\b|\brunoffs?\b|\bcandidates?\b|\bmidterms?\b|\bpoll(?:s|ing) (?:places?|locations?|workers?)\b/i),
  group('proposition', 3, GOV, /\bpropositions?\b|\bbonds? (?:elections?|packages?|programs?|propositions?|funds?|projects?|sales?)\b|\bcharter (?:amendments?|review|elections?)\b|\breferend(?:um|a)\b/i),
  group('recall', 3, GOV, /\brecall (?:elections?|petitions?|campaigns?|efforts?)\b|\bpetitions?\b/i),
  group('governance', 2, GOV, /\bannex(?:ation|es|ed|ing)?\b|\bmoratori(?:um|a)\b|\bredistricting\b|\bsworn in\b|\bappointments?\b|\bappointed\b|\bfurloughs?\b|\bvacan(?:t|cy) (?:seat|place)\b|\bterm limits?\b/i),
  group('development finance', 2, 'economic-development', /\btax increment\b|\bpublic improvement district\b|\beconomic development (?:corporation|agreements?|incentives?)\b|\bincentives?\b/i, /\b(?:TIRZ|PID|EDC)\b/),
  group('transit agency', 3, 'transit', /\b(?:DART|DCTA|Trinity Metro|TEXRail|GoLink)\b/, /\btransit (?:authority|agency|board)\b/i),
  group('water agency', 3, 'utilities-water', /\b(?:NTMWD|TRWD)\b/, /\bwater (?:district|utilities)\b/i),
  group('housing authority', 3, 'housing', /\bhousing authority\b/i),
  group('regional planning', 3, null, /\bNCTCOG\b/, /\bcouncil of governments\b/i),
  group('commission', 2, null, /\bcommissions?\b|\bcommissioners?\b|\bboards? (?:approves?|votes?|of directors|members?)\b/i),
  group('officials', 2, null, /\bofficials?\b|\bcity of\b|\btown of\b|\bmunicipal\b|\bcity-owned\b/i),
  group('city', 1, null, /\bresidents?\b|\bleaders\b|\bcity's\b|\bthe city\b|\bcities\b|\bneighborhoods?\b/i),
  group('decision', 1, null, /\bvotes?\b|\bvoted\b|\bapprov(?:es|ed|al|e)\b|\bdenie[sd]\b|\bdeny\b|\badopts?\b|\badopted\b|\btables?\b|\btabled\b|\breconsiders?\b|\bconsiders?\b|\bpasses\b|\bpassed\b|\bcontracts?\b|\brenews?\b/i, /\bOK(?:'?s|'?d)?\b/),
  group('utility rates', 3, 'utilities-water', /\butility (?:service )?(?:fees|rates|bills?)\b|\bservice fees\b|\bwater(?:, (?:waste|sewer|wastewater))*(?:,? (?:and|&) \w+)? (?:rates|bills?|fees|restrictions)\b|\bwastewater\b|\bsolid waste\b|\btrash (?:pickup|collection|rates|fees)\b/i),
  group('city rules', 3, null, /\bcode enforcement\b|\bregulations?\b|\bregulat(?:e|es|ing)\b|\bbans?\b|\bcurfews?\b/i),
  group('city services', 1, null, /\bfees?\b|\btrash\b|\brecycling\b|\bpermits?\b|\brules?\b|\bgrants?\b|\bfunding\b/i),
  group('library', 2, 'education-libraries', /\blibrar(?:y|ies)\b/i),
  group('parks', 2, 'parks-recreation', /\bparks? (?:board|department|plans?|bonds?|projects?|and recreation)\b|\brec(?:reation)? centers?\b/i),
  group('public safety', 2, 'public-safety', /\bpolice (?:chiefs?|departments?|budget|oversight|staffing)\b|\bfire (?:chiefs?|departments?|stations?)\b|\bfirst responders?\b|\bpublic safety\b|\bbody cameras?\b/i),
  group('roads', 2, 'roads-traffic', /\broad(?:way)? (?:projects?|construction|work|updates?|improvements?|bonds?)\b|\bstreet (?:projects?|repairs?|improvements?)\b|\bsidewalks?\b|\btraffic signals?\b|\boverlay project\b/i, /\bTxDOT\b/),
  group('housing policy', 2, 'housing', /\bhomeless(?:ness)?\b|\baffordable housing\b|\bhousing (?:plan|policy|assistance|office|programs?)\b/i),
  group('public transit', 2, 'transit', /\bpublic transit\b|\bbus (?:routes?|service|stops?)\b|\bpark-and-ride\b|\bcommuter rail\b|\blight rail\b/i),
];

/** Signal that a headline is not local civic news, counted the same way as CIVIC. */
const NOISE = [
  group('sports', 4, null, /\bfootball\b|\bbasketball\b|\bbaseball\b|\bsoftball\b|\bvolleyball\b|\bsoccer\b|\bhockey\b|\bgolfers?\b|\btouchdowns?\b|\bquarterbacks?\b|\bplayoffs?\b|\bscoreboard\b|\brivalry\b|\bmatchup\b|\bhomecoming\b|\bathletes?\b|\bathletics\b|\bcoach(?:es)?\b|\bseason opener\b|\bundefeated\b|\bunbeaten\b|\bin OT\b/i, /\b(?:Cowboys|Mavericks|Mavs|Rangers|Stars|Wings|FC Dallas|Longhorns|Sooners|Aggies|Horned Frogs|Red River|NFL|NBA|MLB|NHL|WNBA|MLS)\b/),
  group('weather', 4, null, /\bweather\b|\bforecasts?\b|\btemperatures?\b|\bsunshine\b|\bsunny\b|\brainy\b|\brainfall\b|\bthunderstorms?\b|\bsevere storms?\b|\bwinter storm\b|\bhail(?:storm)?\b|\btornado(?:es)?\b|\bheat (?:wave|advisory|index)\b|\bcold front\b|\bhard freeze\b|\bfreezing temperatures\b|\bhumid(?:ity)?\b|\bFirst Alert\b|\bhurricanes?\b|\bwind chill\b/i),
  group('lifestyle', 3, null, /\brestaurants?\b|\bdining\b|\bbrunch\b|\bchefs?\b|\bmenus?\b|\bbakery\b|\bcafe\b|\bcoffee\b|\btacos?\b|\bburgers?\b|\bpizz(?:a|eria)\b|\bcocktails?\b|\bbrewery\b|\bpub\b|\bhappy hour\b|\brecipes?\b|\bconcerts?\b|\bfestivals?\b|\balbum\b|\bmovies?\b|\bfilm(?:maker)?\b|\bcelebrit(?:y|ies)\b|\bactor\b|\bactress\b|\bsinger\b|\brapper\b|\bthings to do\b|\bboutique\b|\bnow open\b|\bnow (?:serving|offering)\b|\bgrand opening\b|\bsoft opening\b|\bpermanently closes\b|\bopen houses?\b|\bdream (?:house|home)\b|\bhomes? for sale\b|\blisting\b|\bbedrooms?\b|\bluxury\b|\bmansion\b|\bjewelry\b|\bfashion\b|\bHalloween\b|\bpumpkins?\b|\bhaunted\b|\bshopping\b|\bgiveaway\b/i),
  group('sponsored', 8, null, /\((?:NAPSI|StatePoint|BPT|Family Features)\)|\bsponsored\b|\bpartner content\b|\bpresented by\b|\bpaid (?:post|content)\b|\badvertorial\b|\bIndustry Leaders\b|\bPR ?Newswire\b|\bBusiness Wire\b|\bGlobe ?Newswire\b/i),
  group('obituary', 5, null, /\bobituar(?:y|ies)\b|\bdies at\b|\bpassed away\b|\bfuneral\b|\bmemorial service\b|\bcelebration of life\b|\bThis Day in\b|\bNational Day\b|\bWords to Live By\b|\bGraduate Day\b|\bMetro Salute\b/i, /\b\d{4}\s*[\u2013\u2014-]\s*[A-Z][a-z]{2,4}\.? \d{1,2}, \d{4}\b/),
  group('roundup', 3, null, /\broundup\b|\btrending\b.*\bstories\b|\bstories to know\b|\bletters to the editor\b/i),
  group('national politics', 3, null, /\bTrump\b|\bBiden\b|\bKamala\b|\bCongress(?:ional|man|woman)?\b|\bU\.S\. (?:Senate|House|Rep\.?)|\bWhite House\b|\bSupreme Court\b|\bPentagon\b|\bfederal government\b|\bgovernment shutdown\b|\bDemocratic Party\b|\bRepublican Party\b|\bpresidential\b|\bimmigration\b|\bdeport(?:ation|ations|ed)?\b/i, /\b(?:ICE|GOP)\b/),
  group('crime', 4, null, /\bshoot(?:ing|ings|er)\b|\bshot (?:and killed|dead|in|at)\b|\bgunfire\b|\bkill(?:ed|ing|s)\b|\bmurder(?:ed|s)?\b|\bhomicides?\b|\bstabb(?:ing|ed)\b|\barrest(?:ed|s)?\b|\bsuspects?\b|\bcharged with\b|\bcharges filed\b|\bfaces? (?:additional |new |federal |criminal )?charges?\b|\bindicted\b|\bsentenced\b|\bconvicted\b|\bpleads? guilty\b|\bin prison\b|\bjailed\b|\brobber(?:y|ies)\b|\bburglar(?:y|ies)\b|\btheft\b|\bstolen\b|\bstealing\b|\bcarjack(?:ing|ed)\b|\bassault(?:ed)?\b|\bkidnap(?:ping|ped)?\b|\bcrash(?:es|ed)?\b|\bwreck\b|\bcollision\b|\bhit-and-run\b|\bfatal(?:ly)?\b|\bdead\b|\bdies\b|\bdied\b|\bmanhunt\b|\bstandoff\b|\bSWAT\b|\bDWI\b|\bgrooming\b|\bsex crimes?\b|\bmanslaughter\b|\bcatch(?:es)? fire\b|\bblaze\b|\b(?:structure|house|apartment) fire\b|\bpolice (?:say|said)\b|\bdetained\b|\b(?:terroristic|bomb) threats?\b/i),
];

/** Region words, matched without regard to case ("north Texas", "Tarrant county"). */
const DFW_REGION_ANY_CASE = ['Dallas-Fort Worth', 'Dallas Fort Worth', 'D-FW', 'North Texas', 'Metroplex', 'Oak Cliff', 'Deep Ellum', 'Lake Highlands', 'Preston Hollow', 'Pleasant Grove', 'Las Colinas', 'Fair Park', 'Park Cities', 'Love Field', 'DFW Airport'];
/**
 * DFW municipalities outside the 39 covered cities and DFW agencies, matched with their
 * capital letters so "prosper" or "dart" in ordinary prose never counts as a place.
 */
const DFW_REGION_PROPER = ['DFW', 'Tarrant', 'Collin', 'DART', 'DCTA', 'Trinity Metro', 'NTMWD', 'NCTCOG', 'Prosper', 'Celina', 'Fairview', 'Lavon', 'Rockwall', 'Royse City', 'Forney', 'Sunnyvale', 'Balch Springs', 'Seagoville', 'Glenn Heights', 'Red Oak', 'Midlothian', 'Waxahachie', 'Burleson', 'Crowley', 'Kennedale', 'Benbrook', 'White Settlement', 'Saginaw', 'Haltom City', 'Watauga', 'Richland Hills', 'Haslet', 'Roanoke', 'Trophy Club', 'Argyle', 'Northlake', 'Highland Village', 'Lake Dallas', 'Hickory Creek', 'Krum', 'Hutchins', 'Wilmer', 'Cockrell Hill', 'Lake Worth', 'Azle', 'Aledo'];
const DFW_COUNTIES = ['Dallas', 'Tarrant', 'Collin', 'Denton', 'Rockwall', 'Ellis', 'Johnson', 'Kaufman', 'Parker', 'Hood', 'Wise'];
/**
 * Places that mark a story as somewhere else. A headline naming one of these and no DFW
 * place is dropped even from a newsroom whose coverage would otherwise vouch for it.
 */
const OUT_OF_AREA = ['Houston', 'Austin', 'San Antonio', 'El Paso', 'Corpus Christi', 'Lubbock', 'Amarillo', 'Waco', 'Killeen', 'Laredo', 'McAllen', 'Brownsville', 'Midland', 'Odessa', 'Abilene', 'Beaumont', 'Galveston', 'Harris County', 'Bexar County', 'Travis County', 'Williamson County', 'WilCo', 'Fort Bend', 'Hays County', 'Montgomery County', 'Bastrop', 'Round Rock', 'Georgetown', 'Pflugerville', 'Cedar Park', 'Leander', 'San Marcos', 'New Braunfels', 'Sugar Land', 'The Woodlands', 'Conroe', 'Kingwood', 'Pearland', 'Friendswood', 'League City', 'Cy-Fair', 'Manvel', 'Dripping Springs', 'College Station', 'Kilgore', 'Longview', 'Texarkana', 'Denison', 'Wichita Falls', 'Oklahoma', 'Louisiana', 'Arkansas', 'New Mexico', 'Florida', 'California', 'New York', 'East Texas', 'West Texas', 'South Texas', 'Central Texas', 'Hill Country', 'Rio Grande Valley', 'Panhandle'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (names) =>
  [...names]
    .map(escapeRe)
    .sort((a, b) => b.length - a.length)
    .join('|');

const scorers = new WeakMap();
let defaultCityList = null;

/** The 39 covered cities from data/cities.json, or none when the data is not built yet. */
function defaultCities() {
  if (!defaultCityList) {
    try {
      defaultCityList = loadCities();
    } catch {
      defaultCityList = [];
    }
  }
  return defaultCityList;
}

function scorerFor(cities) {
  let scorer = scorers.get(cities);
  if (!scorer) {
    scorer = makeScorer(cities);
    scorers.set(cities, scorer);
  }
  return scorer;
}

/**
 * Build the place and signal matchers for one list of covered cities. A city name followed
 * by "County" is the county, not the city, and "Dallas-Fort Worth" is the region, not the
 * two cities; both are kept out of the city list that the city filter relies on.
 */
function makeScorer(cities) {
  const named = cities.filter((c) => c && typeof c.name === 'string' && c.name);
  const idByName = new Map(named.map((c) => [c.name.toLowerCase(), c.cityId]));
  const cityAlternatives = named
    .map((c) => c.name)
    .sort((a, b) => b.length - a.length)
    .map((name) => {
      const re = escapeRe(name);
      if (name === 'Fort Worth') return `(?<!Dallas[-\\u2013 ])${re}`;
      if (name === 'Dallas') return `${re}(?![-\\u2013 ]Fort Worth)`;
      return re;
    });
  // Only ever used through matchAll, which works on a copy, so its lastIndex stays at 0.
  const cityRe = named.length ? new RegExp(`\\b(?:${cityAlternatives.join('|')})\\b(?! County)`, 'g') : null;
  const countyRe = new RegExp(`\\b(${alternation(DFW_COUNTIES)}) County\\b`, 'gi');
  const countyTest = new RegExp(`\\b(?:${alternation(DFW_COUNTIES)}) County\\b`, 'i');
  const regionAnyCase = new RegExp(`\\b(?:${alternation(DFW_REGION_ANY_CASE)})\\b`, 'i');
  const regionProper = new RegExp(`\\b(?:${alternation(DFW_REGION_PROPER)})\\b`);
  const outOfArea = new RegExp(`\\b(?:${alternation(OUT_OF_AREA)})\\b`);
  const capitalized = (county) => county.charAt(0).toUpperCase() + county.slice(1).toLowerCase();

  const citiesIn = (text) => (cityRe ? [...text.matchAll(cityRe)].map((m) => idByName.get(m[0].toLowerCase())) : []);
  const countiesIn = (text) => [...text.matchAll(countyRe)].map((m) => capitalized(m[1]));
  const regionIn = (text) => regionAnyCase.test(text) || regionProper.test(text) || countyTest.test(text);

  return function score(item, source = {}) {
    const title = String(item.title || '');
    const description = String(item.description || '');
    const civic = tally(CIVIC, title, description);
    const noise = tally(NOISE, title, description);
    if (/\/online_features\//i.test(String(item.link || '')) && !noise.labels.some((l) => l.startsWith('sponsored'))) {
      noise.total += 8;
      noise.labels.push('sponsored');
    }

    const titleCities = citiesIn(title);
    const descriptionCities = citiesIn(description);
    const namedInTitle = titleCities.length > 0 || regionIn(title);
    const namedInDescription = descriptionCities.length > 0 || regionIn(description);

    const coverage = Array.isArray(source.coverage) ? source.coverage : [];
    const statewide = source.requirePlace === true || coverage.some((c) => /^texas$/i.test(String(c)));
    const vouchedFor = !statewide && coverage.length > 0;
    const coverageCities = vouchedFor ? coverage.map((c) => idByName.get(String(c).toLowerCase())).filter(Boolean) : [];
    const placeScore = namedInTitle ? 2 : namedInDescription ? 1 : vouchedFor ? 1 : 0;
    const elsewhere = outOfArea.test(title) && !namedInTitle && !namedInDescription;

    // The newsroom's own cities stand in only for a story that names no place at all; a
    // story about Prosper or "North Texas" from the Plano edition is not a Plano story.
    const mentioned = unique([...titleCities, ...descriptionCities]);
    const places = mentioned.length ? mentioned : namedInTitle || namedInDescription ? [] : unique(coverageCities);
    const counties = unique([...countiesIn(title), ...countiesIn(description)]);

    const prior = FOCUS_PRIOR[source.focus] || 0;
    const civicScore = Math.min(civic.total + prior, 12);
    const score = civicScore + placeScore - noise.total;
    const reasons = [];
    if (elsewhere) reasons.push('outside-dfw');
    if (!placeScore) reasons.push('no-dfw-place');
    if (civicScore < MIN_CIVIC) reasons.push('not-civic');
    if (score < MIN_SCORE) reasons.push('low-score');
    return {
      relevant: reasons.length === 0,
      score: Math.round(score * 10) / 10,
      civic: civic.labels,
      noise: noise.labels,
      topics: unique(civic.topics),
      places,
      counties,
      reasons,
    };
  };
}

/** Sum each group once: full weight for a headline match, half for a summary-only match. */
function tally(groups, title, description) {
  let total = 0;
  const labels = [];
  const topics = [];
  for (const g of groups) {
    const inTitle = g.patterns.some((re) => re.test(title));
    const inDescription = !inTitle && g.patterns.some((re) => re.test(description));
    if (!inTitle && !inDescription) continue;
    total += inTitle ? g.weight : g.weight / 2;
    labels.push(inTitle ? g.label : `${g.label} (summary)`);
    if (g.topic) topics.push(g.topic);
  }
  return { total, labels, topics };
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

/**
 * Score one headline for local civic relevance. Deterministic: the same item, source and
 * clock always give the same answer, which is what the tests and the static snapshot rely on.
 *
 * @param {{title: string, description?: string, link?: string, publishedAt?: string}} item
 * @param {{coverage?: string[], requirePlace?: boolean, focus?: string}} [source]
 * @param {{cities?: object[], now?: Date|string|number, maxAgeDays?: number}} [options]
 * @returns {{relevant: boolean, score: number, civic: string[], noise: string[], topics: string[], places: string[], counties: string[], reasons: string[], ageDays: number|null}}
 *   reasons lists every failed check: 'undated', 'too-old', 'outside-dfw', 'no-dfw-place', 'not-civic', 'low-score'.
 */
export function scoreRelevance(item, source = {}, { cities, now = new Date(), maxAgeDays = NEWS_MAX_AGE_DAYS } = {}) {
  const result = scorerFor(Array.isArray(cities) ? cities : defaultCities())(item || {}, source || {});
  const age = ageInDays(item && item.publishedAt, toDate(now));
  const reasons = [...result.reasons];
  if (age === null) reasons.unshift('undated');
  else if (age > maxAgeDays || age < -1) reasons.unshift('too-old');
  return { ...result, relevant: reasons.length === 0, reasons, ageDays: age === null ? null : Math.round(age * 10) / 10 };
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Days between publication and now, or null for a missing or unreadable date. */
function ageInDays(publishedAt, now) {
  const t = Date.parse(publishedAt || '');
  return Number.isFinite(t) ? (now.getTime() - t) / DAY_MS : null;
}

/**
 * Headlines that pass the relevance check, newest first, then filtered by topic and city.
 *
 * @param {{sources?: object[], topicLinks?: object[]}} news the contents of data/news.json
 * @param {object} [options]
 * @param {string} [options.topic] a topic id
 * @param {string} [options.city] a city name or id, or several separated by commas. A covered
 *   city matches the stories that name it, its county, or (when a story names no city) the
 *   newsroom that covers it; any other text must appear as a whole word.
 * @param {number} [options.limit=20] newest N after every filter
 * @param {Date|string|number} [options.now] clock for the 30-day window
 * @param {number} [options.waitMs=Infinity] how long to wait for feeds that are still loading.
 *   The live API passes a short budget; feeds that miss it keep loading in the background and
 *   are counted in pendingFeeds.
 * @param {object[]} [options.cities] covered cities; defaults to data/cities.json
 * @returns {Promise<{topic: string|null, city: string|null, fetchedFeeds: number, totalFeeds: number, pendingFeeds: number, maxAgeDays: number, items: object[], topicLinks: object[]}>}
 *   Never rejects: a feed that fails contributes nothing. Each item carries title, link,
 *   description, publishedAt, sourceId, sourceName, topics (at least one id, 'other' when
 *   nothing fits), places (covered city ids), counties (county names) and relevance (score).
 */
export async function fetchNews(news, { topic, city, limit = 20, now = new Date(), waitMs = Infinity, cities } = {}) {
  const clock = toDate(now);
  const covered = Array.isArray(cities) ? cities : defaultCities();
  const scorer = scorerFor(covered);
  const sources = feedSources(news);
  const states = await settleWithin(
    sources.map((s) => loadFeed(s)),
    waitMs,
  );

  let fetchedFeeds = 0;
  let pendingFeeds = 0;
  let items = [];
  states.forEach((state, i) => {
    if (state === PENDING) {
      pendingFeeds++;
      return;
    }
    if (!state || !state.items.length) return;
    fetchedFeeds++;
    items.push(...relevantItems(state, sources[i], scorer));
  });

  items = items.filter((i) => {
    const age = ageInDays(i.publishedAt, clock);
    return age !== null && age <= NEWS_MAX_AGE_DAYS && age >= -1;
  });
  items.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  items = dedupe(items);
  if (topic) items = items.filter((i) => i.topics.includes(topic));
  const wanted = cityFilter(city, covered);
  if (wanted) items = items.filter(wanted);

  const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : limit === Infinity ? Infinity : 20;
  return {
    topic: topic || null,
    city: city || null,
    fetchedFeeds,
    totalFeeds: sources.length,
    pendingFeeds,
    maxAgeDays: NEWS_MAX_AGE_DAYS,
    items: items.slice(0, max),
    topicLinks: (news.topicLinks || []).filter((l) => !topic || l.topic === topic),
  };
}

function feedSources(news) {
  return ((news && news.sources) || []).filter((s) => s && typeof s.rssUrl === 'string' && /^https?:\/\//i.test(s.rssUrl) && s.rssVerified !== false);
}

/**
 * The relevant items of one fetched feed, scored and tagged once per fetch and per city
 * list, so the live endpoint does no regex work on repeat requests.
 */
function relevantItems(state, source, scorer) {
  if (!state.scored) state.scored = new WeakMap();
  let list = state.scored.get(scorer);
  if (!list) {
    list = [];
    for (const item of state.items) {
      const r = scorer(item, source);
      if (!r.relevant) continue;
      list.push({ ...item, sourceId: source.id, sourceName: source.name, topics: tagTopics(item, r.topics), places: r.places, counties: r.counties, relevance: r.score });
    }
    state.scored.set(scorer, list);
  }
  return list;
}

/**
 * Topic tags for a relevant headline: the topics of the civic signals it matched first, then
 * core's keyword guess for the rest. Headlines are short, so the keyword guess needs two
 * points (one long keyword or two short ones) unless nothing else tagged the story.
 */
function tagTopics(item, civicTopics) {
  const text = `${item.title} ${item.description || ''}`;
  const guessed = inferTopics(text, 3, { minScore: 2 }).filter((id) => id !== 'other');
  const tags = unique([...civicTopics, ...guessed]).slice(0, 3);
  return tags.length ? tags : inferTopics(text, 3, { minScore: 1 });
}

/** Drop repeats: the same link, or the same headline syndicated through two newsrooms. */
function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => {
    const keys = [linkKey(i.link), titleKey(i.title)].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    for (const k of keys) seen.add(k);
    return true;
  });
}

function linkKey(link) {
  try {
    const u = new URL(link);
    for (const p of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^ref$/i.test(p)) u.searchParams.delete(p);
    u.hash = '';
    return `link:${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return link ? `link:${link}` : '';
  }
}

function titleKey(title) {
  const key = String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return key.length >= 12 ? `title:${key}` : '';
}

/**
 * Turn the city query into a predicate, or null for no filter. Several names may be given
 * separated by commas. A covered city (by name or id) matches the stories that name it, its
 * county, or that come from a newsroom covering only it; anything else must appear as a
 * whole word, so "Allen" no longer matches "challenge".
 */
function cityFilter(query, covered) {
  const names = String(query || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!names.length) return null;
  const tests = names.map((name) => {
    const lower = name.toLowerCase();
    const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const city = covered.find((c) => c && (c.cityId === slug || String(c.name).toLowerCase() === lower));
    const word = new RegExp(`\\b${escapeRe(city ? city.name : name)}\\b`, 'i');
    return (item) => (city && ((item.places || []).includes(city.cityId) || (city.county && (item.counties || []).includes(city.county)))) || word.test(`${item.title} ${item.description || ''}`);
  });
  return (item) => tests.some((t) => t(item));
}

const PENDING = Symbol('pending');

/** Wait for every promise, or until waitMs passes; unsettled ones come back as PENDING. */
async function settleWithin(promises, waitMs) {
  const results = promises.map(() => PENDING);
  const all = Promise.all(
    promises.map((p, i) =>
      p.then(
        (value) => {
          results[i] = value;
        },
        () => {
          results[i] = null;
        },
      ),
    ),
  );
  if (!Number.isFinite(waitMs)) {
    await all;
    return results;
  }
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, waitMs));
    if (typeof timer.unref === 'function') timer.unref();
  });
  await Promise.race([all, deadline]);
  clearTimeout(timer);
  return results.slice();
}

const cache = new Map();
const inflight = new Map();

/**
 * A feed's latest state: fresh from the cache, a recent copy served while a refresh runs in
 * the background, or the result of a new fetch. Never rejects.
 */
function loadFeed(source) {
  const key = source.rssUrl;
  const cached = cache.get(key);
  const nowMs = Date.now();
  if (cached && cached.expires > nowMs) return Promise.resolve(cached);
  const refresh = inflight.get(key) || startRefresh(source, cached);
  if (cached && cached.items.length && nowMs - cached.fetchedAt < STALE_LIMIT_MS) return Promise.resolve(cached);
  return refresh;
}

function startRefresh(source, previous) {
  const key = source.rssUrl;
  const promise = fetchFeed(source)
    .then((items) => {
      const state = { items, fetchedAt: Date.now(), expires: Date.now() + HIT_TTL_MS, ok: true };
      cache.set(key, state);
      return state;
    })
    .catch(() => {
      // Keep the last good copy for a while, but try again sooner than after a success.
      const keep = previous && previous.items.length && Date.now() - previous.fetchedAt < STALE_LIMIT_MS;
      const state = keep ? { ...previous, expires: Date.now() + MISS_TTL_MS, ok: false } : { items: [], fetchedAt: 0, expires: Date.now() + MISS_TTL_MS, ok: false };
      cache.set(key, state);
      return state;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

const hosts = new Map();

/**
 * Run fn with one of MAX_PER_HOST slots for the URL's host. Several Community Impact
 * editions live on one host, and newsrooms answer bursts with HTTP 429, so requests to the
 * same host queue instead of all starting at once. A released slot passes straight to the
 * next waiting job.
 */
async function withHostSlot(url, fn) {
  let host = 'unknown';
  try {
    host = new URL(url).host;
  } catch {
    /* fetch will reject the URL itself */
  }
  let q = hosts.get(host);
  if (!q) {
    q = { active: 0, waiting: [] };
    hosts.set(host, q);
  }
  if (q.active < MAX_PER_HOST) q.active++;
  else await new Promise((resolve) => q.waiting.push(resolve));
  try {
    return await fn();
  } finally {
    const next = q.waiting.shift();
    if (next) next();
    else if (--q.active === 0) hosts.delete(host);
  }
}

async function fetchFeed(source) {
  return withHostSlot(source.rssUrl, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    try {
      const res = await fetch(source.rssUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': NEWS_USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_BODY_BYTES) throw new Error('Feed too large');
      const xml = await readLimited(res, MAX_BODY_BYTES);
      return parseFeed(xml).map((i) => ({ ...i, sourceId: source.id, sourceName: source.name }));
    } finally {
      clearTimeout(timer);
    }
  });
}

async function readLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error('Feed too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Tiny RSS 2.0 / Atom parser: headline, link, date, and a short description.
 *
 * Atom entries use their rel="alternate" link (the story page), not a rel="self" or
 * rel="replies" link that happens to come first. Descriptions lose the "The post ...
 * appeared first on ..." line WordPress appends, and are cut at a word boundary with an
 * ellipsis rather than mid-word.
 */
export function parseFeed(xml) {
  const out = [];
  const text = String(xml || '');
  const isAtom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  const blockRe = isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi;
  const blocks = text.match(blockRe) || [];
  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = clean(tag(block, 'title'));
    let link = isAtom ? atomLink(block) : clean(tag(block, 'link'));
    if (!/^https?:\/\//i.test(link) && !isAtom) {
      const guid = /<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i.exec(block);
      if (guid && !/isPermaLink\s*=\s*["']false/i.test(guid[0])) link = clean(guid[1]);
    }
    if (!/^https?:\/\//i.test(link)) continue;
    const description = clip(stripFeedFooter(clean(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'))), DESCRIPTION_MAX);
    const dateRaw = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
    const publishedAt = dateRaw ? toIso(dateRaw) : '';
    if (title) out.push({ title, link, description, publishedAt });
  }
  return out;
}

function atomLink(block) {
  let fallback = '';
  for (const m of block.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1];
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs) || /\bhref\s*=\s*'([^']*)'/i.exec(attrs);
    if (!href) continue;
    const rel = ((/\brel\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || 'alternate').toLowerCase();
    if (rel === 'alternate') return decodeEntities(href[1]);
    if (!fallback && !/^(?:self|replies|edit|enclosure|hub|license)$/.test(rel)) fallback = decodeEntities(href[1]);
  }
  return fallback;
}

function stripFeedFooter(s) {
  return s.replace(/\s*The post .{1,300}? appeared first on .{1,200}?\.?\s*$/i, '').trim();
}

/** Cut long text at a word boundary and mark the cut. */
function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const head = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.\-(]+$/, '')}\u2026`;
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = re.exec(block);
  return m ? m[1] : '';
}

function codePoint(n) {
  return n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (m, dec) => codePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

/**
 * Unwrap CDATA, strip tags, decode escaped HTML, collapse whitespace.
 *
 * Tags are stripped before entities are decoded, not after. Newsroom feeds embed an
 * <img> whose alt text can contain an encoded &gt;, and decoding first turns that into a
 * real angle bracket that ends the tag early, leaking the remaining attributes into the
 * summary as text. Stripping runs a second time after decoding for the feeds that escape
 * their markup instead of embedding it.
 */
function clean(s) {
  const unwrapped = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, ' '))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toIso(s) {
  const d = new Date(clean(s));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
