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
| `js/transpose.js` | Chord token parsing and semitone transposition |
| `js/sheet.js` | Both sheet renderers (inline chords and chords-above-lyrics) |
| `js/chordstrip.js` | Sticky chord strip and the voicing chooser |
| `js/list.js` | List view: search, filters, sort, songbook picker |
| `js/import.js` | Importing a songbook JSON from disk |
| `js/song.js` | Song view and its controls |
| `js/autoscroll.js` | Auto-scroll, text/chord sizing, pinch zoom |
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
- Chord diagrams are generated on the fly by **chords.js** — one consistent SVG
  per chart, for both instruments, including chords never in the original artwork.
- Click a strip chord to open the **voicing chooser**: every playable voicing
  (lowest to highest fret) with a live preview; picks are remembered per chord.
- Per-song text size Aa (70%–150%, live, stored per song; two-finger pinch works).
- Auto-scroll timed to each song's duration (0.2×–3.0×), play/reset, per-song
  speed, notes (localStorage), dark mode, keyboard shortcuts
  (`/` search, `Space` scroll, `←`/`→` songs, `Esc` back).
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
      "chords": ["Am", "G"],
      "sheet": [ [ ["c", "[Am]"], ["x", " lyric"], ... ], [] ]   // lines of [kind, text]
    }
  ]
}
```

`sheet` kinds: `c` chord token (`[Am]`), `x` text, `m` muted, `b` bold,
`i` italic, `y` comment, `p` preformatted/tab. Personal data (favorites, notes,
recent, theme, scroll speed, voicing picks) lives only in `localStorage`; the
imported songbook JSON lives in `IndexedDB`.

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
| `{key: Am}` | `key` | optional recording key |
| `{sheetkey: Am}` | `sheetKey` | defaults to `key` |
| `{capo: 2}` | `capo` | defaults to `0` when a key is given |
| `{new: true}` | `new` | default `false` |
| `{number: 12}` | `n` | defaults to file order |
| `{chords: Am, C, G}` | `chords` | optional curated order; mismatch with the sheet warns |
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
sheet shape, blank-line encoding, pre lines, chord brackets, broken
unicode/entities, and chord playability via `ChordKit` (Node, or headless Chrome
when Node is not installed).

Run the parser/builder tests with `python3 tests/chordpro.py`, and the
dev/prod environment guard with `python3 tests/env.py`.

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
