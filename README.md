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
| `app.js` | Search, filters, sort, favorites, notes, transpose, auto-scroll, songbook switching, import, hash routing, service-worker registration |
| `songbooks/index.json` | Manifest of bundled songbooks |
| `songbooks/krakow-ukulele.json` | Bundled dataset (generated — don't hand-edit) |
| `manifest.webmanifest`, `sw.js` | PWA manifest + app-shell service worker |
| `images/` | Logos (light/dark), favicon/PWA icons, QR code |
| `legacy/` | The 198 original song pages (archived source) |
| `migrate.py` | Rebuilds `songbooks/krakow-ukulele.json` from `legacy/` + validation |
| `build_single.py` | Bundles everything into `Songbook.html` |
| `build_pages.py` | Assembles `_site/` for GitHub Pages |
| `tests/` | CDP + headless-Chrome test suites |

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
python3 migrate.py
```

Reads `legacy/*.html`, writes `songbooks/krakow-ukulele.json`, and prints a
validation report (198 songs, unique ids/numbers, levels 84/91/23, chord refs,
no empty content, no broken unicode). Deterministic and byte-faithful to the
original dataset.

## Builds

```sh
python3 build_single.py   # -> Songbook.html (portable, file://)
python3 build_pages.py    # -> _site/ (runtime files + Songbook.html)
```

Pushing to `main` deploys `_site/` to GitHub Pages via
`.github/workflows/deploy-pages.yml`.

## Run the tests

Start a server first, then run the suites. Chrome is driven over the DevTools
Protocol (requires `pip install websocket-client`):

```sh
python3 -m http.server 8777 &

# engine unit tests (voicings, parsing, SVG) — 23 assertions
python3 tests/run_html.py http://localhost:8777/tests/chordkit.html

# app smoke: list, routing, instrument toggle, diagrams — 11 assertions
python3 tests/smoke.py  http://localhost:8777

# import -> IndexedDB -> reload -> remove — 12 assertions
python3 tests/import.py http://localhost:8777

# full behavior suite: search/filter/sort/fav/notes/scroll/theme/chooser/… — 168 assertions
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
