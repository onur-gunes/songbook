# Songbook (offline PWA)

An instrument-agnostic, offline-first songbook. Ships with the **Krakow Ukulele
Songbook** (198 songs) and lets you import your own song lists as JSON. A global
Ukulele/Guitar toggle re-renders every chord diagram for the chosen instrument.

- **Web app** (served): multi-file app with a service worker → installable PWA.
- **Portable build**: `Songbook.html` — the whole app (songs, engine, images)
  inlined in one file that runs from `file://`.

## Open it

**Hosted:** https://onur-gunes.github.io/songbook/

**Locally:**

```sh
python3 -m http.server 8777
# open http://localhost:8777/
```

**No server:** open the prebuilt **`Songbook.html`** by double-clicking (desktop)
or copy that one file to a phone. Everything is inlined; no network is used.

## What's inside

| File / folder | Purpose |
|---|---|
| `index.html` | App shell (list view + song view in one document) |
| `style.css` | Styling, light/dark themes via `[data-theme]` |
| `chords.js` | **ChordKit** — the shared chord engine: parse chords, search voicings for ukulele and guitar, render SVG diagrams, expose data URIs |
| `tuner.js` | Microphone tuner: YIN + FFT pitch detection, octave guards, smoothing, ukulele/guitar presets, A4 calibration |
| `js/` | The app itself, split by concern — search, filters, sort, favorites, notes, transpose, auto-scroll, songbook switching, import, hash routing, service-worker registration (see [App modules](#app-modules)) |
| `songbooks/index.json` | Manifest of bundled songbooks |
| `songbooks/krakow-ukulele.json` | Bundled dataset (generated — don't hand-edit) |
| `songbooks/polska-gurom.json` | Bundled dataset (generated from `chordpro/polska-gurom/` — don't hand-edit) |
| `songbooks/original-keys.json` | Curated original-recording keys (id → key), merged in by `migrate.py` |
| `manifest.webmanifest`, `sw.js` | PWA manifest + app-shell service worker |
| `images/` | Logos (light/dark), favicon/PWA icons, QR code |
| `legacy/` | The 198 original song pages (archived source) |
| `chordpro/` | ChordPro source books (`<book-id>/book.json` + one file per song) |
| `migrate.py` | Rebuilds `songbooks/krakow-ukulele.json` from `legacy/` + validation |
| `chordpro.py` | Parses the ChordPro authoring subset into the app's sheet format |
| `build_songbook.py` | Builds `songbooks/<id>.json` from a `chordpro/<id>/` book |
| `build_single.py` | Bundles everything into `Songbook.html` |
| `build_pages.py` | Assembles `_site/` for GitHub Pages |
| `tests/` | CDP + headless-Chrome test suites |

## App modules

`js/` holds the app, one file per concern. They are **classic scripts sharing a
single `window.SB` namespace — not ES modules**: native modules are CORS-blocked
over `file://`, which would break the portable `Songbook.html`, and bundling them
would mean adding a JS toolchain to a deliberately zero-dependency project.

The ordered `<script src="js/*.js">` tags in `index.html` are the single source of
truth for load order — `build_single.py` and `build_pages.py` both read them, so
adding a module means editing `index.html` only. `core.js` must load first (it
creates `SB.state`) and `app.js` last (it runs `init()`).

| File | Purpose |
| --- | --- |
| `js/core.js` | Helpers (`$`, `el`, `lsGet`/`lsSet`), storage keys, and the shared `SB.state` container |
| `js/theme.js` | Light/dark theme and the songbook brand logo |
| `js/idb.js` | IndexedDB persistence for imported songbooks |
| `js/songbooks.js` | Songbook normalisation/validation, indexing, active songbook |
| `js/personal.js` | Favourites, per-song notes, recently played |
| `js/instrument.js` | Ukulele/guitar selection |
| `js/transpose.js` | Chord token parsing, semitone transposition, and the written-key scale degrees (`songTonic`, `tokenDegree`) shared by the sheet and the strip |
| `js/sheet.js` | Both sheet renderers (inline chords and chords-above-lyrics) |
| `js/chordstrip.js` | Sticky chord strip and the voicing chooser |
| `js/list.js` | List view: search, filters, sort, songbook picker |
| `js/import.js` | Importing a songbook JSON from disk |
| `js/song.js` | Song view and its controls |
| `js/autoscroll.js` | Auto-scroll, text/chord sizing, pinch zoom |
| `js/metronome.js` | Metronome: lookahead click scheduler and per-song BPM |
| `js/strum.js` | Strum-pattern row + selector, filtered by `time`, highlighted off the metronome clock |
| `js/router.js` | Hash routing |
| `js/keyboard.js` | Global keyboard shortcuts |
| `js/app.js` | Entry point: `init()`, service-worker registration, test export |

State shared by more than one module lives in `SB.state` (`js/core.js`); anything
used by a single module stays a local `var`. Functions used across modules are
attached to `SB`.

## Features

- **Multiple songbooks** — a picker switches between the bundled list and any
  imported lists. Import a `.json` songbook from disk; it is saved in
  **IndexedDB** and restored on reload (remove anytime).
- **Global instrument toggle** — Ukulele or Guitar. Chord diagrams and the
  voicing chooser are generated for the selected instrument; the choice is
  remembered.
- Live search (title + artist), difficulty filters — multi-select, results OR'd
  (84 Easy / 91 Medium / 23 Hard), 🔥 New (18), ⭐ Favorites (localStorage),
  sort Title/Artist — list defaults to alphabetical by name,
  🎲 Random from the current filter, recently-played list (with clear),
  ☰/▤ compact view toggle, persisted.
- Song view in the same page (`#/<songbook>/<song-id>` — refresh- and back-safe),
  prev/next respecting current filter+sort, compact sticky chord strip.
- Chord strip controls: Chords −/+ scales diagram size (60%–150%, persisted) and
  a 📌 Pinned / 📍 Scrolls toggle un-sticks the strip.
- Transpose −/+/0 (sharp spelling, slash basses and strum strokes preserved,
  non-chord tokens like `stop`/`NC`/riff tabs untouched; strip names and diagrams
  transpose too).
- **Scale degrees** — `I-V` swaps the chord names in the sheet for Roman
  numerals (`Am G C` → `vi V I`), in both chord placements, for practising
  intervals. The numerals *replace* the names rather than annotating them:
  showing both more than doubles every chord label, which in Above mode shoves
  chords off the lyric column they are timed to. The chord strip keeps name +
  numeral together as the decoder ring. Degrees come from the written key
  (`sheetKey`, else `key` − `capo`), so they stay put while you transpose;
  strum strokes keep their slashes (`G//` → `V//`) and non-chord markers are
  left alone.
- Chord diagrams are generated on the fly by **chords.js** — one consistent SVG
  per chart, for both instruments, including chords never in the original artwork.
- Click a strip chord to open the **voicing chooser**: every playable voicing
  (lowest to highest fret) with a live preview; picks are remembered per chord.
- Per-song text size Aa (70%–150%, live, stored per song; two-finger pinch works).
- Auto-scroll timed to each song's duration (0.2×–3.0×), play/reset, per-song
  speed, notes (localStorage), dark mode, keyboard shortcuts
  (`/` search, `Space` scroll, `←`/`→` songs, `Esc` back).
- **Metronome** — clicks at the song's `bpm`, accenting beat 1 according to
  `time`. Adjust the tempo and it is remembered for that song; the control is
  hidden for songs with no tempo data. Scheduled against the audio clock
  rather than a timer, so it does not drift.
- **Strum pattern** — a row of arrows (`↓ ↑ ·`) under the chord strip, chosen
  from a library of common patterns filtered by the song's `time` (4/4, 3/4,
  6/8, 2/4 — several per metre). A toggle switches the row between arrows and
  `D`/`U` letters (remembered across songs). It defaults to the song's
  documented `strum` where one exists; a manual choice is remembered per song.
  Sized (60–150%) and pinned like the chord diagrams, so it stays on screen
  while the lyrics scroll; pinned it stacks directly under the chord strip,
  tracking that strip's height as the diagrams resize or it is itself
  unpinned.
  While the metronome runs the current slot is highlighted in lockstep — the
  highlight reads the metronome's own audio clock, not a second timer, so the
  two never diverge — and a one-bar count-in leads in, because a pattern you
  can't start on beat 1 is not usable for playing along. The count-in runs
  **through the pattern's own cells**, which briefly show the beat numbers
  (`1 · 2 · 3 · 4 ·`) and then hand back to the arrows on beat 1, rather than
  occupying a second bar beside it: one bar at a pattern's subdivision is
  exactly as many slots as the pattern, so a separate count-in bar doubled the
  row's width permanently for something only meaningful while it runs — which
  on a phone is the difference between the pattern fitting on screen and not.
  Hidden for songs with no `time`. **One pattern per song is an approximation**: strum is far less
  reliably documented than key or bpm and most songs change feel between verse
  and chorus; per-section patterns are a later feature. Visual only — the
  metronome is the audio.
- **Tuner** — chromatic-style pitch detection from the microphone with
  ukulele/guitar presets, auto or manual string selection, A4 calibration
  (430–450 Hz), and an octave-safe detector. Requires a secure context
  (HTTPS or localhost), so use the hosted app or serve the folder locally;
  Chrome blocks microphone capture from the `file://` single-file build.
  On Android, Chrome also needs microphone permission at the OS level
  (Settings → Apps → Chrome → Permissions → Microphone).
- **PWA** — installable, caches the app shell and songbooks for offline use.

## Songbook JSON format

```jsonc
{
  "id": "my-list",            // unique, used in the URL (#/my-list)
  "name": "My List",
  "description": "...",
  "instrument": "ukulele",    // default instrument suggestion
  "songs": [
    {
      "id": "song-1",
      "title": "...",
      "artist": "...",
      "level": "Easy",         // Easy | Medium | Hard
      "new": false,
      "key": "Am",             // original recording key (optional, shown in the song view)
      "dur": 4,                // minutes, drives auto-scroll
      "bpm": 92,               // optional tempo, 20-300 (see "Tempo and metre")
      "time": "4/4",           // optional metre: 4/4 | 3/4 | 6/8 | 2/4
      "chords": ["Am", "G"],
      "sheet": [ [ ["c", "[Am]"], ["x", " lyric"], ... ], [] ],  // lines of [kind, text]
      "grid": [                // optional bar/beat chart (see "Bar/beat grid")
        { "label": "Chorus", "repeat": false,
          "bars": [ { "beats": [ {"chord": "Am", "beats": 4} ] }, ... ] }
      ]
    }
  ]
}
```

`sheet` kinds: `c` chord token (`[Am]`), `x` text, `m` muted, `b` bold,
`i` italic, `y` comment, `p` preformatted/tab. `grid` is a separate top-level
field, **parallel to `sheet`, not nested in it**: it is a different view of the
same song (where beat 1 is and how many beats each chord gets), and is simply
absent on songs that have no chart. Personal data (favorites, notes, recent,
theme, scroll speed, voicing picks) lives only in `localStorage`; the imported
songbook JSON lives in `IndexedDB`.

## Regenerate the bundled data

```sh
python3 migrate.py                      # Krakow Ukulele Songbook
python3 build_songbook.py chordpro/polska-gurom --allow-trusted-notes   # POLSKA GUROM
```

`migrate.py` reads `legacy/*.html`, merges original keys from
`songbooks/original-keys.json`, writes `songbooks/krakow-ukulele.json`, and
prints a validation report (198 songs, unique ids/numbers, levels 84/91/23,
chord refs, no empty content, no broken unicode). Deterministic and
byte-faithful to the original dataset.

The Polish book is authored in `chordpro/polska-gurom/` and rebuilt with
`build_songbook.py`; its curated keys live in that book's
`original-keys.json` sidecar. `tests/chordpro.py` asserts that regenerating it
reproduces the committed `songbooks/polska-gurom.json` byte for byte.

## Create a songbook from ChordPro

New songbooks can be authored as ChordPro and converted to the same JSON shape
the app renders. This is an input path for agent-generated books: `migrate.py`,
`legacy/` and `songbooks/krakow-ukulele.json` are not involved.

```
chordpro/<book-id>/
  book.json          # songbook metadata
  original-keys.json # optional curated keys, id -> {key, sheetKey, capo}
  tempo.json         # optional curated tempo, id -> {bpm, time, confidence, source}
  01-song-title.cho  # one song per .cho / .chordpro / .pro file
  02-another.cho
```

`book.json` carries `{id, name, description, instrument}` and optionally
`logo` / `logoDark`. `instrument` must be `ukulele` or `guitar`. Song files are
numbered in filename order unless a `{number: 12}` directive overrides it. If
present, `original-keys.json` is merged by song id, mirroring how
`migrate.py` uses `songbooks/original-keys.json` for the legacy book.

Song directives:

| Directive | Maps to | Notes |
|---|---|---|
| `{id: ...}` | `id` | optional stable URL id; invalid ids are slugified + warned |
| `{title: ...}` / `{t: ...}` | `title` | required |
| `{artist: ...}` / `{subtitle: ...}` / `{st: ...}` | `artist` | required |
| `{level: Easy\|Medium\|Hard}` | `level` | default `Medium` + warning |
| `{duration: 3.5}` | `dur` | minutes; default `3` + warning |
| `{tempo: 92}` / `{bpm: 92}` | `bpm` | optional; 20–300, rounded to an integer; invalid values fail the build |
| `{time: 4/4}` / `{meter: 4/4}` | `time` | optional; one of `4/4`, `3/4`, `6/8`, `2/4`; invalid values fail the build |
| `{strum: downs-4-4}` | `strum` | optional strum-pattern id; must exist in the library and match `time`; invalid values fail the build |
| `{key: Am}` | `key` | optional recording key |
| `{sheetkey: Am}` | `sheetKey` | defaults to `key` |
| `{capo: 2}` | `capo` | defaults to `0` when a key is given |
| `{new: true}` | `new` | default `false` |
| `{number: 12}` | `n` | defaults to file order |
| `{chords: Am, C, G}` | `chords` | optional curated order; mismatch with the sheet warns |
| `{start_of_grid: Label}` / `{sog: ...}` … `{end_of_grid}` / `{eog}` | `grid` | optional bar/beat chart (see "Bar/beat grid"); requires `time` |
| `{trusted_note: ...}` | `y` | ignored unless `--allow-trusted-notes` is passed |

Body syntax:

- `Po [C#m]co [A]budować` → alternating text/chord tokens.
- `[C][Am]` → consecutive chord tokens; slash chords (`[C/G]`) and suffixes are
  kept verbatim.
- `\[literal brackets\]` and `\\` escape text that would otherwise look like a
  chord or an escape.
- A blank line → `[]` (never `["x", ""]`).
- `{comment: ...}` / `{c: ...}` → one italic line (safe `textContent`, not the
  `innerHTML` comment kind).
- `{trusted_note: ...}` → one legacy `y` line (rendered with `innerHTML`). It is
  ignored unless the build is run with `--allow-trusted-notes`; use that flag
  only for trusted legacy conversions.
- `{start_of_chorus}` / `{soc}` inserts an `(Chorus)` label; `{end_of_chorus}`
  / `{eoc}` closes it.
- `{start_of_tab}` / `{sot}` … `{end_of_tab}` / `{eot}` keeps raw lines as
  preformatted `p` tokens; no chord parsing inside.
- `{start_of_grid: Label}` / `{sog}` … `{end_of_grid}` / `{eog}` is a bar/beat
  chart, parsed into the top-level `grid` field (see "Bar/beat grid").
- `# source comment` lines are ignored.

`chords[]` is derived automatically from the chord tokens (unique, in first
appearance order), and ids are slugified from titles and de-duplicated per book.
`{chords: ...}` exists only so legacy books can preserve a curated order that
differs from first appearance; a mismatch between the override and the sheet
produces a validation warning.

Build one book, or every book under a directory:

```sh
python3 build_songbook.py chordpro/my-book
python3 build_songbook.py chordpro/
```

To try the authoring format, copy the test fixture as a starting point:

```sh
cp -R tests/fixtures/chordpro/demo chordpro/my-book
python3 build_songbook.py chordpro/my-book
```

The builder writes `songbooks/<id>.json`, upserts the entry in
`songbooks/index.json`, and writes `<id>-report.txt`. If validation reports an
error, the book is not published and the command exits non-zero. The report
checks song counts, duplicate ids/numbers, titles/artists, levels, durations,
tempo/metre, sheet shape, blank-line encoding, pre lines, chord brackets, broken
unicode/entities, and chord playability via `ChordKit` (Node, or headless Chrome
when Node is not installed).

### Tempo and metre

`bpm` and `time` are both optional; songs without them keep working exactly as
before. They are independent of `dur`: `dur` is a wall-clock length that drives
auto-scroll, and deriving one from the other would need a bar count the songs
do not carry.

`bpm` is the **felt pulse**, not the notated beat — quarter-note BPM in simple
metres (`4/4`, `3/4`, `2/4`) and **dotted-quarter** BPM in compound `6/8`. So a
6/8 song at 60 has two pulses per bar, not six. This keeps `bpm` meaning "what
a metronome clicks" in every metre, and is why the metronome accents every
second click in `6/8` rather than every sixth.

Tempo is validated, never guessed: a value outside 20–300, or a metre outside
the allowlist, is a build error rather than a silent default, because a wrong
metronome is worse than no metronome. Imported (untrusted) songbooks are
normalised instead — a bad `bpm` or `time` becomes `null` and the song still
renders.

Curated values live in the per-book `tempo.json` sidecar, merged by song id
exactly like `original-keys.json`, and take precedence over an inline
`{tempo:}` directive:

```json
{
  "arahja": {
    "bpm": 146, "time": "4/4", "confidence": "high", "source": "tunebat",
    "strum": "downs-4-4", "strum_confidence": "low", "strum_source": "generic"
  }
}
```

`confidence` and `source` are curation metadata and never reach the built book.
They are worth keeping because published BPM values disagree between sources
(and often differ by a factor of two), so it matters which ones were measured
and which were guessed.

### Strum pattern

`strum` is an optional per-song pattern id drawn from the small library in
`chordpro.py` (`STRUM_PATTERNS`), mirrored byte-for-byte in `js/strum.js`
(`tests/strum.py` asserts the two agree, exactly as `TIME_SIGNATURES` is
mirrored in `js/songbooks.js`). Each pattern is `D`/`U`/`-` slots at a stated
subdivision, keyed by metre; the app renders it as the subdivision row under
the chord strip and lights the current slot off the metronome clock.

Like `bpm`, it is an allowlist, not freeform: an unknown id is a build error,
and the id's metre must match the song's `time` (a 3/4 pattern on a 4/4 song is
rejected — the row would not line up with the clicks). Give strum its own
`strum_confidence` / `strum_source` in the sidecar rather than reusing the
bpm's: strum is **less** reliably documented than bpm, so a per-song pattern is
explicitly an approximation (most songs change feel between sections; per-
section patterns are a later feature). The field is a single id today but is
shaped so it can grow to a list without a data migration.

### Bar/beat grid

A grid is an optional bar/beat chart for a song — the one thing a play-along
chart needs that nothing in the lyric lines can recover: where beat 1 is, and
how many beats each chord gets. It is authored as a block and parsed into the
top-level `grid` field, deliberately parallel to `sheet` rather than nested in
it (a different view of the same song, absent on songs that have none).

```
{start_of_grid: Intro/Chorus}
| C | G | Am | G |
|: F | G . . | C :|
{end_of_grid}
```

- `|` is a bar line; a bar holds chord tokens.
- A lone chord fills the bar (so `| C |` in 4/4 is C for four beats).
- `.` extends the previous chord by one beat, so `G . .` in 4/4 is G for three
  beats — standard Nashville/chart notation, no invented syntax.
- `|:` opens a repeat and `:|` closes one; a repeat wraps the whole block (the
  single `repeat` flag), so the marks belong at the block's edges, not mid-way.
- The block label becomes the section name (`Intro/Chorus`, `Verse`, …).
- A block may span several lines; each line opens and closes with a bar line.

Chord tokens reuse the sheet's exact vocabulary — slash chords, `NC`, muted
markers — so the same `ChordKit` playability check applies to grid chords too.

A grid **requires `time`** (its bar maths is meaningless without a metre) and
every bar must sum to the beats that metre implies (4 in 4/4, 3 in 3/4, 2 in
6/8 and 2/4 — the felt pulse, same count the metronome accents). A bar that
does not add up, an unbalanced repeat, or a grid with no `time` is a build
**error** naming the song and bar, not a warning: a chart that does not add up
is unusable. On the untrusted import boundary (`js/songbooks.js`) a malformed
grid is instead dropped whole, so the song still renders. Rendering the grid is
out of scope here; the field is produced and validated, not yet drawn.

Run the parser/builder tests with `python3 tests/chordpro.py`, the strum
library mirror guard with `python3 tests/strum.py`, and the dev/prod
environment guard with `python3 tests/env.py`.

## Builds

```sh
python3 build_single.py   # -> Songbook.html (portable, file://)
python3 build_pages.py    # -> _site/ (runtime files + Songbook.html)
```

`build_pages.py` regenerates the service worker's precache list (`CORE`) and
cache-busting `VERSION` in the deployed `_site/sw.js` from the actual contents
of `_site/`, so adding a songbook or asset never requires editing `sw.js` by
hand. Only the built `_site/sw.js` is rewritten; the source `sw.js` keeps the
`@generated-version` / `@generated-core` markers as a fallback for running the
unbuilt tree.

### Environments

One Pages site hosts two environments, each built from its own branch:

| Branch | URL | Purpose |
| --- | --- | --- |
| `main` | <https://onur-gunes.github.io/songbook/> | live site |
| `dev` | <https://onur-gunes.github.io/songbook/dev/> | staging |

Work on `dev`, check it on a real device, then merge to `main` to release.
Pushing to either branch runs the full suite first and republishes the site via
`.github/workflows/deploy-pages.yml`; a Pages deployment replaces the whole
site, so both environments are rebuilt from their own branches on every push
and a dev push can never change what prod serves. The `dev` branch is optional
— until it exists, the site is just prod.

Both environments share one origin, and `localStorage`, IndexedDB and
`CacheStorage` are all scoped to the origin rather than the path. So the
environment is derived from the URL and folded into the storage namespace
(`SB.NS` in `js/core.js`) and the cache names (`sw.js`): prod keeps
`songbook`, dev gets `songbook-dev`. Testing on dev therefore cannot read,
corrupt or delete a live user's favourites, notes or imported songbooks, and
the two service workers no longer evict each other's offline caches.

The environment is resolved at runtime rather than baked in at build time, so
the dev and prod artifacts are byte-identical — what is smoke-tested on `/dev/`
is exactly what ships. `tests/env.py` guards the rule, which is necessarily
duplicated between `js/core.js` and `sw.js` (a page script and a worker cannot
share an import).

Dev is public: GitHub Pages has no access control on a public repo. It is
obscure, not private.

## License

The **source code** (app, chord engine, build scripts, tests) is released under
the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, study, modify
and share it for noncommercial purposes; **commercial use, including selling the
app or a derivative, is not permitted**.

The **code license does not cover the bundled songs**, and they are not
relicensed by this repository. Lyrics, chord charts and arrangements belong to
their respective authors, arrangers and publishers. The Krakow Ukulele Songbook
dataset is mirrored from <https://ukulelekrakow.pl/> for offline personal use.
The bundled song data is provided for **personal, non-commercial use only** — do
not sell, relicense or redistribute it as a collection. See
[NOTICE.md](NOTICE.md) for full attribution and takedown information.

## Run the tests

Every suite below runs in CI on pull requests, and a push to `main` must pass
them before it is allowed to deploy (`.github/workflows/tests.yml`).

To run them locally, start a server first. Chrome is driven over the DevTools
Protocol (requires `pip install websocket-client`); the browser is found
automatically on macOS and Linux, or set `CHROME_PATH` if it lives somewhere
unusual:

```sh
python3 -m http.server 8777 &

# engine unit tests (voicings, parsing, SVG)
python3 tests/run_html.py http://localhost:8777/tests/chordkit.html

# app smoke: list, routing, instrument toggle, diagrams
python3 tests/smoke.py  http://localhost:8777

# import -> IndexedDB -> reload -> remove
python3 tests/import.py http://localhost:8777

# tuner: presets, calibration, octave guards, overlay behaviour
python3 tests/tuner.py  http://localhost:8777

# full behavior suite: search/filter/sort/fav/notes/scroll/theme/chooser/…
python3 tests/run_html.py http://localhost:8777/tests/e2e.html

# all 198 songs: every legacy page line present in the rendered sheet + transpose cycles
python3 tests/run_html.py http://localhost:8777/tests/fidelity-all.html
```

Each HTML suite sets `window.__done` and reports `<title>DONE …</title>` on
success (`FAILS:n` / `CRASH` on failure); `run_html.py` prints the title and the
full `<pre id="log">`. `fidelity-all.html` is generated from the `legacy/` pages
by `python3 tests/generate_fidelity.py`.

## Chord engine

`chords.js` exposes a global `ChordKit`:

```js
ChordKit.voicings('Am', 'guitar')     // -> [ [-1,0,2,2,1,0], ... ]
ChordKit.bestVoicing('C', 'ukulele')  // -> [0,0,0,3]
ChordKit.dataUri('ukulele', frets)    // -> "data:image/svg+xml,..." diagram
ChordKit.diagramSVG('guitar', frets)  // -> raw <svg> markup
```

Instruments and chord types are data-driven (`ChordKit.INSTRUMENTS`,
`ChordKit.TYPES`), so the same engine powers both tunings.
