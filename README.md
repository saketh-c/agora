# Agora

**Your turn to speak at city hall.** Find city council meetings across 39 Dallas-Fort Worth cities, learn exactly how to sign up to speak, and get matched to the issues you care about. Built by students for the Congressional App Challenge.

The agora was the open square at the center of a Greek city, the place where citizens gathered to trade news, argue, and decide things together, and nobody needed an invitation to stand in it. A council chamber is the closest thing a modern city has to that square, so the app is named after it and looks the part.

Agora is a web app, an installable phone app (PWA), and a terminal tool that all share one engine and one dataset. It works in English, Spanish, and Vietnamese, including the city guides and agenda items. It is strictly nonpartisan: Texas city councils are nonpartisan, and the app is about showing up and being heard, not about picking a side.

## Try it

**[Open the live app](https://saketh-c.github.io/agora/)**, hosted from this repository. Every commit to `main` republishes it. The map, the city guides, the rankings, and the charts all read data bundled into the page, so they work with no server behind them. A tab that was open during a deploy reloads itself once, the first time it needs a page from the newer build.

Headlines work there too, with one difference worth knowing. A static site cannot run the
news endpoint, so the deploy gathers the newsroom feeds at build time and ships the result
as a snapshot, and a scheduled run refreshes it four times a day. The page says when the
headlines were collected rather than implying they are live. Address lookup and the AI
explanations do need the API, so on the hosted copy they fall back to their offline
behavior: pick a city from the list instead of typing a ZIP code, and agenda items get a
plain-language explanation from the topic guide instead of from the model.

To run the whole thing, including the API, without installing anything locally, open the repository on GitHub and choose **Code > Codespaces > Create codespace on main**. Dependencies install on their own, then run `npm run dev` and open the forwarded port 5173. Under **Ports** you can set that port to public and hand the URL to anyone you want to show it to.

The live app redeploys itself: `.github/workflows/pages.yml` rebuilds and publishes it on
every push to `main`, and `.github/workflows/ci.yml` runs the test suites, the dictionary
parity check, and a production build on every push and pull request.

## Quick start

Locally you need [Node.js 22 or newer](https://nodejs.org/).

```bash
npm install          # once
npm run dev          # API on http://localhost:8787, web app on http://localhost:5173
```

Open http://localhost:5173 on your laptop, or on your phone over Wi-Fi (the dev server prints a network URL). On a phone, use "Add to Home Screen" and it installs like a native app and keeps working offline.

### Terminal

Everything also runs in the terminal, no server needed:

```bash
npm run cli -- cities                                   # every city and its next meeting
npm run cli -- match --interests housing,transit --city Plano --evening --weekends
npm run cli -- speak Dallas                             # exactly how to sign up to speak
npm run cli -- city "Fort Worth"                        # schedule, agenda, youth programs
npm run cli -- map --near Richardson                    # ASCII map of the whole region
npm run cli -- agenda --topic parks-recreation          # upcoming agenda items on a topic
npm run cli -- stats                                    # when councils meet, in text charts
npm run cli -- comment --name "Ana" --city Plano --topic parks-recreation --ask "keep the pool open later"
npm run cli -- setup                                    # save your preferences (no account)
npm run cli -- demo                                     # a scripted tour of the whole loop
npm run cli -- help
```

Add `--json` to any command for raw JSON, `--today 2026-09-14` to pretend it is another day, and `--lang es` or `--lang vi` (or set `AGORA_LANG`) for Spanish or Vietnamese.

### Tests

```bash
npm test
```

Runs the schedule engine, matching, server, and CLI test suites (Node's built-in test runner, no extra tooling).

### Production build

```bash
npm run build        # merges the data and builds the web app into packages/web/dist
npm start            # one server on http://localhost:8787 serving the app and the API
```

### Optional AI features

Set `ANTHROPIC_API_KEY` before starting the server to turn on two features: "Explain this" on any agenda item, and "Polish with AI" in the comment builder. Without a key, both fall back to plain-language templates, so nothing in the app depends on it.

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

## What it does

Four destinations, the same on a phone (a bottom tab bar) and on a laptop (links in the
header): **Home**, **Meetings**, **Prepare** and **Community**. The header also holds the
language menu and the profile menu; the footer links to News, The data, About and Profiles.

| Page | What it is for |
|---|---|
| Home `/` | First visit: one question, "Where do you live or go to school?", and three real meetings you can speak at. After that: "Ana, your turn is Monday.", your next meeting with a countdown, the sign-up deadline and your prep progress, then what is coming up, seats you can apply for, headlines and one post from Community |
| Meetings `/meetings` | Every upcoming council meeting as a list (and a map beside it on a laptop, or behind the Map toggle on a phone), with search, filters and "Best for you" or "Soonest" order. A meeting opens in a sheet: can I speak, for how long, the sign-up deadline, and "Prepare to speak" |
| Cities `/cities`, a city `/city/plano` | The directory of all 39 councils, and one page per city: the next meeting you can speak at, how to speak there in three steps, youth programs, official links, the schedule and recent agenda items |
| Prepare `/prepare` | Getting ready for one meeting, step by step: sign up, write your comment (`/prepare/write`), practice out loud (`/prepare/practice`), on the day, and afterwards |
| Community `/community` | Guides from the Agora team grounded in each city's rules, and posts students write on their own device |
| News, The data, About, Profiles | Local reporting on your topics, how the region's councils meet in charts, where the data comes from, and the profiles saved on this device |

"Your city, topics and times" opens from the profile menu over whatever page you are on,
so changing your city never loses your place. Everything works in English, Spanish and
Vietnamese, including the city guides and agenda items.

The terminal tool covers the same ground: `map`, `match`, `speak`, `city`, `youth`,
`agenda`, `explain`, `comment`, `news` and `stats`.

## Data visualizations

Charts sit where the question comes up, and each one is built from the same published
schedule data as the rest of the app.

| Chart | What it answers | Where it appears |
|---|---|---|
| Speaking-time ruler | Is my comment short enough? The draft is timed against that city's limit, with green, amber and red zones like the light at a podium | Write and Practice |
| School hours bar list | Which councils meet while I am in class? One bar per council, your city highlighted | The data |
| Weekday by hour heatmap | When do councils meet? Weekday against start hour over ninety days | The data |
| Speaking limits | How long do cities let you speak? Councils grouped by their limit | The data |
| Agenda topics | What subjects fill the agendas? | The data |
| Pace and volume over time | Did I rush the opening and fade at the end? | Practice report |
| Eye contact strip | When did I look down? One cell per second of the take | Practice report |

Chart text is set at a fixed 12 or 14 pixels, one accent hue carries the data, labels sit
on the marks instead of in legends, and every chart has a table view of the same numbers.

## Profiles

Agora has no accounts, no sign-in, and no server holding anyone's data. A profile is a
separate saved setup in one browser: its own topics, availability, home city, language,
and first-meeting checklist. That covers the case the app actually has, which is a shared
school laptop where several students each want their own matches, without asking a minor
to create a password or hand over an email address.

Because nothing is stored remotely, the only way to move a setup between devices, or to
get it back after clearing browser data, is the export file on the Profiles page. The page
says so directly rather than implying a recovery that cannot exist. The optional email
field is used for exactly one thing, closing your own draft comment with a contact line,
and the form says that too.

A setup saved before profiles existed is migrated into the first profile on next load, so
nobody is sent back through onboarding.

## Community

The Community page is where someone who has stood up at a meeting tells the next person
what worked. Posts are one of four kinds, tip, guide, win, or question, and each can carry
up to four photos, a video file, or a YouTube or Vimeo link.

The feed is seeded from `data/community.json` with guides written by the Agora team from
each city's own file in `data/cities/`. They say nothing that file does not: no invented
students, schools, outcomes or votes, and every helpful count starts at zero. A post
written on the page is saved on that device (IndexedDB, so a phone video fits) and shows
at the top of that person's feed, marked as theirs. **Send to the Agora team** opens a
prefilled issue on this repository with the post text; a person reads it and, with the
student's consent, adds it to the seed file, which is the moderation step a page used by
students needs. Photos and video for a submitted post are attached in the issue editor.

Pasted video links are rewritten to the privacy-preserving `youtube-nocookie.com` and
`player.vimeo.com` embeds, and any other host is refused, so nobody can slip an arbitrary
page into an iframe on the feed. Uploaded photos are shrunk to 1600 pixels on the longest
edge before they are stored.

To seed a post with a video file rather than a link, put the file under
`packages/web/public/community/` and reference it as
`{ "type": "video", "src": "community/name.webm", "poster": "community/name.png" }`.

## Practice

Showing up is half of it; the other half is the three minutes. Practice
(`/prepare/practice`) records you giving your comment and tells you, specifically, what
to fix.

Pick the council (its speaking limit becomes the clock), optionally bring the draft from
the comment builder, and record. From the audio it measures pace over time, pauses,
whether you trail off at the ends of sentences, volume consistency, and pitch variety.
With the live transcript on it also counts fillers, highlights them in the transcript,
checks how much of your script actually came out, and whether your name, the item, and
your ask were spoken. With the camera on it tracks how much of the time you faced the
room, how often you looked down at notes, sway, shoulder tilt, and hands near the face.
The report ranks the five things to work on first, each with the evidence and one drill,
lists what went well, shows the timelines, lets you watch the take back, and keeps a
one-line summary per attempt so the next one can be compared.

Everything is analyzed in the browser. The camera and microphone streams never leave the
device, the recording exists only in the tab (there is a download button if you want it),
and only the summary numbers are saved, in your profile. The one exception is the live
transcript, which uses the browser's own speech service; in Chrome and Edge that sends
audio to Google or Microsoft for recognition, and the page says so and lets you switch it
off. Firefox has no speech recognition, so there the transcript is simply unavailable and
pace is estimated from syllables in your voice instead.

Eye contact and posture come from two MediaPipe models (Apache 2.0) served from this
app's own origin, about 20 MB fetched on first use and cached after that. They are not
committed; `npm run models` downloads them into `packages/web/public/models/`, and the
deploy does the same before it builds. Without them the page still works and simply
offers voice analysis only. The analysis itself is plain, testable code in
`packages/web/src/lib/rehearse/`: transcript analysis, audio envelope and pitch, body
summaries, and the coach that turns measurements into ranked findings.

## Design

The direction is called "Your turn at the podium". Ink on card on a light gray floor, and
the only color is the timer light at a council podium: **green means it is your turn and
you can speak**, amber means time is running out (sign-up deadlines), red means stop
(cancelled). Every other surface is neutral, and each screen spends its boldness once: the
green "Your next meeting" card on Home, the "Can I speak? Yes, for 3 minutes" answer on a
meeting.

Headings are set in Mona Sans at its widest, body text in Public Sans, both self-hosted.
Controls are pills; lists are white groups with hairline dividers; meeting rows lead with
a date tile that is lit green when you can speak. Copy is sentence case and short, a page
introduction is two lines at most, longer explanations sit behind a "How this works"
disclosure, and every list has a designed empty, loading and error state that says what
to do next. The logo is a stoa, the covered walkway that edged the agora, with a green
head at the lectern.

The tokens and shared components live in `packages/web/src/styles/` (`tokens.css`,
`base.css`, `components.css`, `shell.css`, `charts.css`, `map.css`, and one file per page
in `styles/pages/`) and `packages/web/src/components/ui/`. A gallery of every component in
every state renders at `/__ui`.

## How it is built

```
data/cities/*.json       one file per city: city hall, schedule rules, exceptions (with optional movedFrom/movedTo), public comment rules,
                         youth programs, agenda items, sources, confidence, lastVerified
data/cities.json         merged and validated by scripts/build-data.mjs
data/news.json           curated newsroom RSS feeds and topic links
packages/core            zero-dependency engine: schedule expansion, matching, geography, civics helpers
packages/server          Express API (meetings, match, news, geocode, stats, explain) and static hosting
packages/cli             terminal app built on core and server modules
packages/web             React + Vite + Leaflet PWA
```

The engine turns each city's recurrence rules ("2nd and 4th Mondays at 7 PM") into dated meetings, applies published cancellations and holiday shifts, attaches agenda items, and scores each meeting against a user's preferences with plain-language reasons. Preferences live in `localStorage` (web) or `~/.agora.json` (CLI). There are no accounts.

## Data

Schedules, addresses, and public comment rules come from each city's official website and adopted meeting calendar, gathered and then independently re-checked against those pages. Special meetings that are not on a city's adopted calendar are not included, and the dataset covers 39 cities, not every municipality in the region. Each city record carries `confidence` and `lastVerified`, and every city page links to its sources. Cities change schedules for holidays and special sessions, so the app always says: confirm on the city website before you go.

To add or fix a city, edit or add a file in `data/cities/` and run `npm run build:data`. The validator reports anything malformed.

## Languages

Every string in the web app, the engine, and the CLI comes from one dictionary per language in `packages/core/src/i18n/locales/` (English is the source of truth). City data is translated with a translation memory in `data/i18n/<lang>.json` that maps each English sentence to its translation; a sentence is only swapped when the English source still matches, so a data update falls back to English instead of showing a stale translation. The web app picks the browser language on first visit and remembers the choice from the language menu.

```bash
node scripts/i18n-check.mjs      # dictionary coverage per language
node scripts/i18n-extract.mjs    # data strings still untranslated per language
```

## Accessibility

Keyboard-navigable throughout, with a skip link, landmarks, one heading per page that
takes focus after navigation, a polite route announcer, a 2px ink focus ring, a list
alternative to the map, labels on icons and pins, reduced-motion support, a forced-colors
fallback, and a table view for every chart. Touch targets are at least 44px (small chips
and buttons extend their hit area past their outline), nothing scrolls sideways at 320px,
and inputs use 16px text so phones do not zoom. Text clears WCAG AA contrast and control
borders clear 3:1. English data shown on a Spanish or Vietnamese page, such as headlines
and addresses, is marked `lang="en"` so screen readers switch voices.

## Renaming

Product naming lives in one place: `packages/core/src/brand.js`. Package names use the `@agora` scope and the terminal command is `agora`. Preferences saved under the previous name are migrated on first load, so nobody has to redo onboarding.

## Contributing

Push access is limited to the team. If you have been added as a collaborator, branch off
`main`, open a pull request, and the CI workflow will run the test suites, the dictionary
parity check, and a production build against it before anyone merges.

## License

MIT. See [LICENSE](LICENSE).
