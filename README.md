# Songbook (offline PWA)

An instrument-agnostic, offline-first songbook. The repository ships the engine
and one small **public-domain demo songbook**; your own songbooks are external
JSON files you import and keep on disk. A global Ukulele/Guitar toggle re-renders
every chord diagram for the chosen instrument.

- **Web app** (served): multi-file app with a service worker → installable PWA.
- **Portable build**: `Songbook.html` — the whole app (engine, images, demo
  songs) inlined in one file that runs from `file://`.

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
| `index.html` | App shell (list, song and chord-explorer views in one document) |
| `style.css` | Styling, light/dark themes via `[data-theme]` |
| `chords.js` | **ChordKit** — the shared chord engine: parse chords, spell tones, search voicings for ukulele and guitar, identify a fret shape, render SVG diagrams, expose data URIs |
| `tuner.js` | Microphone tuner: YIN + FFT pitch detection, octave guards, smoothing, ukulele/guitar presets, A4 calibration |
| `js/` | The app itself, split by concern — search, filters, sort, favorites, notes, transpose, auto-scroll, songbook switching, import, hash routing, service-worker registration (see [App modules](#app-modules)) |
| `songbooks/index.json` | Manifest of the books bundled into a build (the demo book, by default) |
| `songbooks/demo.json` | The bundled demo dataset — twelve public-domain songs (generated from `chordpro/demo/` — don't hand-edit) |
| `songbooks/original-keys.json` | Curated key/capo metadata from the retired bundled book (ids and keys only, no lyrics); `migrate.py` can merge it into a local legacy archive |
| `manifest.webmanifest`, `sw.js` | PWA manifest + app-shell service worker |
| `images/` | Logos (light/dark), favicon/PWA icons, QR code |
| `chordpro/` | ChordPro authoring sources (`<book-id>/book.json` + one file per song). Local books are git-ignored; `chordpro/demo/` is the shipped example |
| `migrate.py` | Legacy migration tool: rebuilds a Krakow JSON book from a local copy of the old `legacy/` pages (not shipped) |
| `chordpro.py` | Parses the ChordPro authoring subset into the app's sheet format |
| `build_songbook.py` | Builds `songbooks/<id>.json` from a `chordpro/<id>/` book |
| `build_single.py` | Bundles everything into `Songbook.html` |
| `build_pages.py` | Assembles `_site/` for GitHub Pages |
| `tests/` | CDP + headless-Chrome test suites |

The app ships no third-party copyrighted song data. The only bundled book is
`demo`, twelve public-domain songs with chord charts written for this project;
it exists so a first run is not empty and so Grid, metronome and strum controls
have something to demonstrate. Every song is public domain in both the US and
the EU; the provenance table is in
[`chordpro/demo/PUBLIC-DOMAIN.md`](chordpro/demo/PUBLIC-DOMAIN.md). `.gitignore` blocks
`songbooks/*.json` (except the manifest, demo and key metadata) and
`chordpro/*/` (except the demo), so a local book cannot be committed by accident.

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
| `js/grid.js` | Play-along grid chart: bars, beat slashes, diagrams and the metronome-driven beat cursor |
| `js/chordstrip.js` | Sticky chord strip and the voicing chooser |
| `js/explorer.js` | Chord explorer: circle of fifths, chord types, voicing browser and reverse fret lookup |
| `js/neck.js` | Full-neck explorer tab: selected chord shape, all chord tones and an optional scale layer across the fretboard |
| `js/list.js` | List view: search, filters, sort, songbook picker |
| `js/import.js` | Importing songbook JSON from disk or a URL (shared parse/validate/persist pipeline) |
| `js/export.js` | Exporting any songbook (bundled or imported) back to a JSON file |
| `js/author.js` | In-app songbook authoring: create, add, edit source, reorder, remove and duplicate books behind a per-book **Edit songbook** mode; writes only imported books |
| `js/song.js` | Song view and its controls |
| `js/autoscroll.js` | Auto-scroll, text/chord sizing, pinch zoom |
| `js/metronome.js` | Metronome: lookahead click scheduler and per-song BPM |
| `js/strum.js` | Strum-pattern row + selector, filtered by `time`, highlighted off the metronome clock |
| `js/chordpro.js` | Browser ChordPro parser (`SB.parseChordPro`), a parity-tested port of `chordpro.py`'s authoring subset |
| `js/router.js` | Hash routing |
| `js/keyboard.js` | Global keyboard shortcuts |
| `js/app.js` | Entry point: `init()`, service-worker registration, test export |

State shared by more than one module lives in `SB.state` (`js/core.js`); anything
used by a single module stays a local `var`. Functions used across modules are
attached to `SB`.

## Features

- **Multiple songbooks** — a picker switches between the demo book and any
  imported lists. Import one or more `.json` songbooks from disk, or fetch one
  from a URL; they are saved in **IndexedDB** and restored on reload (remove
  anytime). A URL import remembers its source and offers **Refresh** to
  re-fetch and replace it. Re-importing an id replaces your imported copy; a
  bundled id stays read-only. Export any songbook, bundled or imported, back
  out as the same `.json` shape. You can also create, fill, edit, reorder and
  duplicate songbooks entirely in the app — see
  [Author songs in the app](#author-songs-in-the-app).
- **Global instrument toggle** — Ukulele or Guitar. Chord diagrams and the
  voicing chooser are generated for the selected instrument; the choice is
  remembered.
- **Chord explorer** (`#/chords`) — the standalone Ukulele and Guitar Chord
  Explorer apps are now part of the songbook. Pick a root on the circle of
  fifths, choose one of 18 chord types, and see every playable voicing with
  fret labels. It also spells out the chord tones (with enharmonic spelling)
  and reverses the lookup: set each string's fret and it names the shape.
  The **Neck** tab (`#/chords/neck`) draws the whole fretboard with the
  selected shape, every chord tone, and an optional scale layer (major,
  minor, pentatonic, blues, Dorian, Mixolydian). Voicings are curated to one
  representative per inversion and hand position, so the shape stepper moves
  through distinct shapes instead of hundreds of note-doubling variants.
  Capo, octave labels, flats/sharps and the scale key/type are adjustable
  there. Everything follows the global instrument toggle, so the same view
  covers both tunings.
- Live search (title + artist), difficulty filters — multi-select, results OR'd
  across Easy / Medium / Hard, 🔥 New, ⭐ Favorites (localStorage),
  sort Title/Artist — list defaults to alphabetical by name,
  🎲 Random from the current filter, recently-played list (with clear),
  ☰/▤ compact view toggle, persisted.
- Song view in the same page (`#/<songbook>/<song-id>` — refresh- and back-safe),
  prev/next respecting current filter+sort, compact sticky chord strip.
- **Two-layer song controls** — the always-visible row carries **Transpose**,
  **Chords** (In text / Above / Grid / Animate / I-V) and **Text** size;
  **More controls** opens **Tempo**, **Strum**, **Diagram** and **Structure**
  without re-flowing the basic row. Diagram −/+ scales the chord strip
  (60%–150%, persisted) and a 📌 Pinned / 📍 Scrolls toggle un-sticks it.
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
  speed, notes (autosaved to `localStorage`), dark mode, keyboard shortcuts
  (`/` search, `Space` scroll, `←`/`→` songs, `Esc` back).
- **Metronome** — clicks at the song's `bpm`, accenting beat 1 according to
  `time`. Adjust the tempo and it is remembered for that song; the ↺ button
  next to the stepper drops that override and returns to the song's documented
  tempo (or the 100 bpm default). Available on every song: one with no tempo
  data starts at a neutral 100 bpm in 4/4, and the first adjustment stores a
  per-song override. Scheduled against the audio clock rather than a timer, so
  it does not drift; a live tempo change re-spaces the remaining clicks instead
  of letting the old grid play out.
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
  Available on every song: one with no `time` uses 4/4, so the row and
  selector still work and a manual choice can be stored per song.
  Per-section patterns: under **More controls**, open **Sections** in the
  strum group to pick a pattern per section role present in the song (Verse, Chorus, Bridge, …; "Verse 1" and "Verse 2"
  share one choice). Each selector defaults to "Same as song" and inherits the
  main pattern until changed, and the row updates immediately. Choosing a
  section pattern applies to every section with that role and is remembered in
  the song's edit plan; during playback the grid lane follows the effective
  pattern section by section, and stopping the metronome restores the user's
  choice. Visual only — the metronome is the audio.
- **Tuner** — chromatic-style pitch detection from the microphone with
  ukulele/guitar presets, auto or manual string selection, A4 calibration
  (430–450 Hz), and an octave-safe detector. Requires a secure context
  (HTTPS or localhost), so use the hosted app or serve the folder locally;
  Chrome blocks microphone capture from the `file://` single-file build.
  On Android, Chrome also needs microphone permission at the OS level
  (Settings → Apps → Chrome → Permissions → Microphone).
- **PWA** — installable, caches the app shell and songbooks for offline use.

## Edit mode and Reset

Structure editing lives behind **More controls → Structure → Edit** in the
song view. Play mode stays the default: strum selectors and per-beat strum
overrides keep working, while chord names, chord lengths, beat counts and bar
structure are read-only.

Opening Edit mode opens a panel that works on the song's local edit plan,
never on the imported songbook:

- edit chord names (each must be a playable chord);
- edit chord lengths in felt beats, with a stepper;
- add and remove bars and beats;
- change the time signature among `4/4`, `3/4`, `6/8` and `2/4`;
- add and remove sections, and assign each a canonical section role
  (intro, verse, pre-chorus, chorus, bridge, outro, interlude, solo, tag,
  other — English and Polish labels resolve to the same role);
- every edit is validated so each bar sums to the metre; an invalid bar shows
  an error and is not saved.

Strum overrides (bar and beat patterns) and structure edits are separate
layers: changing chords or beats never rewrites strums, and changing strums
never rewrites chords, lengths or beats. Added beats inherit the effective
strum; removed beats lose their overrides. All edits persist to `localStorage`
and survive reload, and are merged into the export rather than written into
the songbook itself.

**Reset** sits next to Edit. It asks for confirmation, then restores the song
exactly as it is in the songbook: it clears the strum plan, custom patterns,
bar/beat overrides and all structural edits. Unrelated per-song preferences
(notes, text size, scroll speed, transpose) are untouched, and Reset is
disabled until there are local edits.

## Export

At the bottom of the song view, next to My notes, an export area offers three
actions — a dedicated trigger, not part of My notes:

- **Show song JSON** — opens an on-screen panel with the song's *effective*
  JSON: the stored song merged with every local strum, custom-pattern,
  bar/beat and structure change from the edit plan, with a canonical role on
  every grid block. A **Copy** button puts it on the clipboard and the polite
  status line confirms it.
- **Download song JSON** — downloads one song object with all local changes
  applied.
- **Download songbook JSON** — downloads the whole active songbook, applying
  every song's plan.

File names are stamped with local time, e.g.
`harbour-lights-20261109-152304.json`, so downloads never overwrite each other
and the clock on the device that saved them is what shows in the name. Both
downloads are effective: the song export is one effective song and the
songbook export applies every song's plan. That is exactly what
`SB.normalizeSongbook` / `build_songbook.py` accept, so an exported file can
be imported by any build.

Export works for bundled and imported songbooks alike; a bundled book stays
read-only in the app — export is how its content leaves the app. Authored songs
keep their `chordpro` field in both the song and songbook downloads, so an
exported file can be re-imported and edited from source again.

## Import from a URL

**From URL…** in the songbook bar (or in the empty state on first run) fetches
a songbook JSON document over HTTP(S) and imports it through the same
parse/validate/persist path as a file. File import remains the primary action
because it has no cross-origin constraint.

The URL is stored with the imported book as `sourceUrl`, and **Refresh**
re-fetches it and replaces the stored copy without asking again. A failed
refresh leaves the working copy untouched.

The host serving the file must allow cross-origin requests and send:

```
Access-Control-Allow-Origin: *
```

(Or the app's exact origin instead of `*`.) The fetch errors name the failure
explicitly:

- **CORS / network** — `could not fetch (network error or CORS blocked; the
  host must send Access-Control-Allow-Origin)`;
- **404** — `not found (404)`;
- **non-JSON** — `not valid JSON: …` (a host that returns an HTML error page
  instead of the songbook file lands here).

Everything after the response body is the normal import pipeline, so a URL
that returns a file the file picker would reject fails for the same reason.

## Songbook JSON format

A songbook is a plain JSON file. This is the **public import interface**: it is
the shape `Export` writes and the shape `SB.normalizeSongbook` accepts, so a
file produced by one build can be imported by another. Only `id`, `name` and
`songs` are required; unknown fields are dropped, and malformed values inside
`songs` are normalised rather than crashing the app.

Top-level fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Required. Unique, letters/numbers/dashes only; used in the URL (`#/my-list`) |
| `name` | string | Required. Shown in the songbook picker |
| `description` | string | Optional |
| `instrument` | `"ukulele"` \| `"guitar"` | Optional initial instrument suggestion |
| `logo`, `logoDark` | string | Optional image path/data URI for the songbook brand |
| `songs` | array | Required |

Song fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the book; defaults to `song-<n>` |
| `title` | string | Defaults to `Untitled` |
| `artist` | string | Optional |
| `level` | `"Easy"` \| `"Medium"` \| `"Hard"` | Defaults to `Medium` |
| `new` | boolean | Shows the 🔥 New filter |
| `key` | string | Original recording key, shown in the song view |
| `sheetKey` | string | Key the chords are written in; defaults to `key` |
| `capo` | integer | Capo fret; `null`/absent means none |
| `dur` | number | Minutes, drives auto-scroll (default `4`) |
| `bpm` | integer | Optional tempo, 20–300 (see [Tempo and metre](#tempo-and-metre)) |
| `time` | string | Optional metre: `4/4`, `3/4`, `6/8` or `2/4` |
| `strum` | string | Optional pattern id from the strum library, matching `time` (see [Strum pattern](#strum-pattern)) |
| `sectionStrums` | object | Pattern id per section role, e.g. `{ "verse": "dduudu-4-4" }`; keys are canonical roles (see [Per-section strums](#per-section-strums)) |
| `strumPatterns` | array | Per-song custom pattern definitions, each `{ id, name, time, subdiv, slots }` (see [Per-section strums](#per-section-strums)) |
| `chords` | string[] | Unique chord tokens; derived by the builder if omitted |
| `chordpro` | string | Optional authoring source. Kept from an in-app add or edit and preserved by export/re-import; it is not rendered |
| `sheet` | array | Lyric/chord lines (below) |
| `grid` | array | Optional bar/beat chart, parallel to `sheet`; each block carries a `role` (derived from its `label`) and each bar may carry `strums`, one slot string per felt beat (see [Bar/beat grid](#barbeat-grid)) |

```jsonc
{
  "id": "my-list",
  "name": "My List",
  "description": "...",
  "instrument": "ukulele",
  "songs": [
    {
      "id": "song-1",
      "title": "...",
      "artist": "...",
      "level": "Easy",
      "new": false,
      "key": "Am",
      "sheetKey": "Am",
      "capo": 0,
      "dur": 4,
      "bpm": 92,
      "time": "4/4",
      "strum": "dduudu-4-4",
      "chords": ["Am", "G"],
      "sheet": [ [ ["c", "[Am]"], ["x", " lyric"], ... ], [] ],
      "grid": [
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
absent on songs that have no chart. A `grid` requires a valid `time`, and every
bar must sum to that metre's felt beats; an imported grid that breaks either
rule is dropped whole rather than half-rendered. Imported sheets are normalised
the same way: a missing or wrong-typed `sheet` becomes empty, and malformed
lines/segments are dropped instead of reaching the renderer. Song ids may
contain any characters; the app percent-encodes them in the hash.

Personal data (favorites, notes, recent, theme, scroll speed, voicing picks)
lives only in `localStorage`; imported songbook JSON lives in `IndexedDB`.

## Rebuild the demo book

```sh
python3 build_songbook.py chordpro/demo
```

The command writes `songbooks/demo.json`, upserts its entry in
`songbooks/index.json`, and prints a validation report. The demo is the only
book in the tree; everything else under `chordpro/` and `songbooks/*.json` is
local authoring input and is git-ignored.

The retired Krakow archive can still be rebuilt locally with `migrate.py` if
you keep your own copy of the old `legacy/` pages: it merges
`songbooks/original-keys.json` and validates the result. Neither the archive nor
the migrated JSON ships with the repository.

## Author songs in the app

A songbook can be created, filled and maintained from the UI without touching
the filesystem. This is the in-app counterpart to the ChordPro build path
below: both end in the same songbook JSON described in
[Songbook JSON format](#songbook-json-format).

1. **Create** — **New songbook** in the list header (or the first-run empty
   state) asks for a name, an optional description and an instrument. The new
   book is imported, empty and editable.
2. **Add songs** — in **Edit songbook** mode, **Add song…** opens a dialog
   where you can paste one ChordPro source or choose several `.cho`,
   `.chordpro` or `.txt` files. (An empty book offers Add song in its empty
   state too, so the first song does not need the extra click.) The
   preview parses as you type or select, and shows each song's title, artist,
   metre, tempo, strum, section/bar counts and any parser warnings. **Add**
   stores the valid songs in one batch and reports one summary, listing any
   files that failed.
3. **Edit** — **Edit songbook** in the list header turns on a task mode for
   that book (session-scoped, cleared when you switch books or reload). A
   banner naming the book then exposes **Add song…** and **Remove songbook**
   (the whole book), rows show a compact **Edit source / Move up / Move down /
   Remove** action dock, and the list shows the book's own order with the sort
   buttons disabled, so moving a song moves its row. Edit source re-parses and
   revalidates the ChordPro, keeps the song's id and position, and previews the
   result before saving; a saved source also drops that song's local grid/strum
   plan, because it described the old structure. The first **Remove** press
   arms **Confirm** (Escape cancels) and a confirmed removal renumbers the
   remaining songs and clears that song's notes, favourite and local edits.
   Moving keeps `n` contiguous. Removing the last song leaves a usable empty
   book with the Add song action.
4. **Export** — the song view's **Download songbook JSON** saves the whole
   book with every local edit applied, including the `chordpro` source of each
   authored song. Re-import that file to keep editing it.

The bar outside edit mode is read-only. Its first line holds the book picker,
**Edit songbook** (imported books only), then the entry actions **New
songbook**, **Import list…**, **From URL…** and **Tuner**; a quieter second
line holds the file actions under a **File** label: **Refresh** (URL imports
only), **Duplicate** (bundled books) and **Export**. Every one of these is the
same pill shape, with the filled accent reserved for **New songbook**. **Add
song…** and **Remove songbook** live in the edit-mode banner, and
**Duplicate** also becomes available for an imported book while editing.
Bundled books have no edit mode, so their bar keeps **Duplicate** as the route
to an editable copy.

Authoring outcomes — the add batch summary, update/remove/duplicate results and
errors — are announced on a polite status line under the songbook bar rather
than in blocking dialogs.

### Editable books, sources and read-only books

Only imported books can be edited. Bundled books (the shipped demo) are
read-only: they offer no Add song, no Edit songbook and no per-song actions,
and their bar keeps only the browsing actions plus **Duplicate**, which creates
an editable imported copy named `Name (copy)`; the source book is never
changed. Imported books hide **Add song…**, **Duplicate** and **Remove** (the
whole book) until **Edit songbook** is on, so the default bar stays read-only.
The copy carries the local edit plans, favourites and notes of its songs across
to the new book id, but does not inherit `sourceUrl`, so Refresh cannot replace
local edits with the remote file.

A song added from ChordPro keeps its source in the optional `song.chordpro`
field. **Edit source** is offered only when that field is present; parsing
replaces the song's title, chords, sheet and grid while preserving its id and
`n`. Songs without a source — for example songs copied from a bundled book —
are JSON-only: the dialog explains this and points at the song view's **Grid**
and **Strum** editors, which change a local plan rather than the stored song.
Those local edits are included in exports but never rewrite the songbook.

In-app input supports the same ChordPro subset as the build path below:
`{title}`/`{t}`, `{artist}`/`{subtitle}`/`{st}`, `{level}`, `{duration}`,
`{tempo}`/`{bpm}`, `{time}`/`{meter}`, `{strum}`, `{key}`, `{sheetkey}`,
`{capo}`, `{new}`, `{number}`, `{chords}`, `{comment}`/`{c}`,
`{start_of_chorus}`/`{end_of_chorus}`, `{start_of_tab}`/`{end_of_tab}` and
`{start_of_grid}`/`{end_of_grid}`, plus inline `[Am]` chords and escapes. The
full directive table, body syntax and warning behaviour are under
[Create a songbook from ChordPro](#create-a-songbook-from-chordpro); the
authoring specification is [#136](https://github.com/onur-gunes/songbook/issues/136).
`{trusted_note}` stays disabled for user input.

## Create a songbook from ChordPro

New songbooks can be authored as ChordPro and converted to the same JSON shape
the app renders. This is the supported authoring path; you do not need the
legacy migration tools or any bundled dataset.

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
present, `original-keys.json` is merged by song id.

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

The same subset is parsed in the browser by `js/chordpro.js`, which exposes
`SB.parseChordPro(text, { allowTrustedNotes: false })` → `{ song, warnings }`.
It mirrors `chordpro.py` exactly, including the warning strings, and
`tests/chordpro_js.py` fails on any difference. `{trusted_note}` stays disabled
for user input. The parser only produces a song dict; callers still pass it
through `SB.normalizeSongbook`, the single import validator.

Build one book, or every book under a directory:

```sh
python3 build_songbook.py chordpro/my-book
python3 build_songbook.py chordpro/
```

To try the authoring format, copy the demo book as a starting point (then edit
its `book.json` and song files):

```sh
cp -R chordpro/demo chordpro/my-book
python3 build_songbook.py chordpro/my-book
```

The new book and its `songbooks/my-book.json` output are git-ignored. Edit
`book.json`'s `id` and `name` before building; the builder upserts the entry in
`songbooks/index.json`.

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

The app still makes the metronome usable when a song has neither value: it
shows a neutral **100 bpm in 4/4** fallback rather than hiding the control.
That fallback is a starting point for the user, not a claim about the song, and
it is never written into the songbook or stored as an override until the user
changes the tempo. The ↺ button appears once an override exists, so there is
always a way back to the song's own value. The same rule applies to strum: a
song with no `time` uses 4/4 so its row and selector are available.

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
section patterns let each role play its own pattern — see
[Per-section strums](#per-section-strums). The field is a single id today but
is shaped so it can grow to a list without a data migration. When a song has no
`time`, the runtime uses 4/4 so the strum row is still available; a manual
choice made there is remembered per song just like a documented default.

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
- Each block carries a `role` (a canonical section role such as `verse`,
  `chorus`, `bridge`, `outro`); when absent it is derived from the block's
  `label`, so `Verse 1` and `Verse 2` both map to `verse`.
- Each bar may carry `strums`: one slot string per felt beat in the bar, each
  a string of `D` (down), `U` (up) and `-` (rest) whose length is the
  subdivision (all entries in a bar share one length). E.g. in 4/4,
  `"strums": ["DU", "DU", "DU", "DU"]` is one down-up per beat.
- A block may span several lines; each line opens and closes with a bar line.

Chord tokens reuse the sheet's exact vocabulary — slash chords, `NC`, muted
markers — so the same `ChordKit` playability check applies to grid chords too.

A grid **requires `time`** (its bar maths is meaningless without a metre) and
every bar must sum to the beats that metre implies (4 in 4/4, 3 in 3/4, 2 in
6/8 and 2/4 — the felt pulse, same count the metronome accents). A bar that
does not add up, an unbalanced repeat, or a grid with no `time` is a build
**error** naming the song and bar, not a warning: a chart that does not add up
is unusable. On the untrusted import boundary (`js/songbooks.js`) a malformed
grid is instead dropped whole, so the song still renders. `js/grid.js` draws the
field as the play-along chart (the Grid mode in the sheet controls); songs
without a grid fall back to the normal sheet.

The chart also shows the section's lyrics. It walks the block's change sequence
against the sheet's chord tokens and, when a section starts with the same
changes, prints each sheet line as one row under the system that holds it. Each
phrase in the row starts at the x of the chord change that introduced it, so
"voice" sits under D and "mornin'" under G while the words stay together as
readable text. A line whose phrases would not fit in the remaining width
falls back to one continuous row beginning at the system's left edge rather
than breaking the alignment badly. Bar widths come from the lyric phrases
themselves: each change reserves at least the width of the words that start
under it (with the diagram as a floor), so a long line gets a wider column
instead of running into the next change. Every diagram uses the same four fret
rows and the same box, so a chord that needs an extra row is not drawn smaller
or denser than its neighbours. A change inside a bar carries a faint drop line
through the beat row; a change on a bar line uses the bar line itself, so no
change is marked twice. A looping grid maps one iteration (the repeat signs mark
the rest); a
grid that is a different arrangement, or has no matching section, shows the
chart without lyrics rather than guessing.

**Animate** is the same chart with the page held still. It mounts one system at
a time in a fixed-height stage and swaps it in place when the metronome's beat
cursor enters the next system's range, so the lyrics and diagrams change under
the playhead instead of the page scrolling. The current chord label and diagram
are highlighted along with the beat slash. The metronome is the transport, so
the view needs a tempo; the auto-scroll control is hidden while it is active.
One bar of count-in precedes the first chart beat, and stopping the metronome
returns the stage to the opening system.

### Per-section strums and custom patterns

`sectionStrums` assigns a pattern to each section role present in the song,
e.g. `{ "verse": "dduudu-4-4", "chorus": "downs-4-4" }`. Keys are canonical
roles (the same roles the grid blocks resolve to), so a song's section patterns
stay language-independent. A role without an override inherits the song's
documented `strum`.

`strumPatterns` are per-song custom pattern definitions, each `{ id, name,
time, subdiv, slots }`. The `id` must be unique within the song and must not
shadow a built-in library id; `time` must be a valid metre; `subdiv` is a whole
number of slots per beat; and `slots` is a `D`/`U`/`-` string whose length is
exactly `subdiv * felt-beats-per-bar` for its metre. Invalid custom patterns,
metre mismatches, and wrong slot counts are build errors.

Run the parser/builder tests with `python3 tests/chordpro.py`, the browser
parser parity suite with `python3 tests/chordpro_js.py` (needs the app server),
the strum library mirror guard with `python3 tests/strum.py`, the dev/prod
environment guard with `python3 tests/env.py`, and the
plan/export/sections/editor unit suites with `python3 tests/plan.py`,
`python3 tests/export.py`, `python3 tests/sections.py` and
`python3 tests/editor.py`.

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

The repository **ships no third-party copyrighted song data**. The only bundled
book, `demo`, contains songs whose words and melodies are in the public domain;
its chord charts were written for this project and are covered by the same
license as the code (the underlying compositions stay public domain). Songbooks
you import are your responsibility: lyrics, melodies, chord charts and
arrangements belong to their respective authors and publishers, and importing a
file does not relicense it. See [NOTICE.md](NOTICE.md) for the full notice.

## Run the tests

Every suite below except the fidelity tool runs in CI on pull requests, and a
push to `main` must pass them before it is allowed to deploy
(`.github/workflows/tests.yml`). Fidelity is local-only because its subject,
the retired `legacy/` archive, is no longer in the repo.

To run them locally, start a server first. Chrome is driven over the DevTools
Protocol (requires `pip install websocket-client`); the browser is found
automatically on macOS and Linux, or set `CHROME_PATH` if it lives somewhere
unusual:

```sh
python3 -m http.server 8777 &

# parser/builder and JS/Python mirror unit tests
python3 tests/chordpro.py
python3 tests/env.py
python3 tests/strum.py
python3 tests/plan.py
python3 tests/export.py
python3 tests/sections.py
python3 tests/editor.py

# engine unit tests (voicings, parsing, SVG)
python3 tests/run_html.py http://localhost:8777/tests/chordkit.html

# app smoke: list, routing, instrument toggle, diagrams, chord explorer
python3 tests/smoke.py  http://localhost:8777

# content-free boot: zero songbooks, import, remove the last book
python3 tests/empty.py  http://localhost:8777

# import -> IndexedDB -> reload -> remove; export -> import round-trip
python3 tests/import.py http://localhost:8777

# in-app authoring: create, add, edit source, reorder, remove, duplicate,
# keyboard focus and export/re-import of the stored source
python3 tests/author.py http://localhost:8777

# tuner: presets, calibration, octave guards, overlay behaviour
python3 tests/tuner.py  http://localhost:8777

# grid strum lane: strokes, bar controls, metres and held chords
python3 tests/grid.py http://localhost:8777

# edit mode: plan grid rendering, strum/structure independence, selectors,
# animated read-only cells and touch targets
python3 tests/edit.py http://localhost:8777

# full behavior suite: search/filter/sort/fav/notes/scroll/theme/chooser/…
python3 tests/run_html.py http://localhost:8777/tests/e2e.html

# fidelity (local authoring tool, NOT run in CI): it compares a local copy of
# the retired legacy/ archive against a local songbooks/krakow-ukulele.json.
# Restore both from git history (or another local copy) before running it.
python3 tests/generate_fidelity.py
python3 tests/run_html.py http://localhost:8777/tests/fidelity-all.html
```

Each HTML suite sets `window.__done` and reports `<title>DONE …</title>` on
success (`FAILS:n` / `CRASH` on failure); `run_html.py` prints the title and the
full `<pre id="log">`.

## Chord engine

`chords.js` exposes a global `ChordKit`:

```js
ChordKit.voicings('Am', 'guitar')     // -> [ [-1,0,2,2,1,0], ... ]
ChordKit.bestVoicing('C', 'ukulele')  // -> [0,0,0,3]
ChordKit.chordNotes('Cdim7')          // -> [{name:'C',degree:'root'}, ... , {name:'Bbb',...}]
ChordKit.identify([0,0,0,3], 'ukulele') // -> [{name:'Am7',rootPc:9,...}, ...]
ChordKit.scaleNotes(9, 'minorPent', 'sharp') // -> [{name:'A',degree:'1'}, ...]
ChordKit.SCALES                     // -> major, minor, pentatonic, blues, ...
ChordKit.dataUri('ukulele', frets)    // -> "data:image/svg+xml,..." diagram
ChordKit.diagramSVG('guitar', frets)  // -> raw <svg> markup
```

Instruments, chord types and scales are data-driven (`ChordKit.INSTRUMENTS`,
`ChordKit.TYPES`, `ChordKit.SCALES`), so the same engine powers both tunings.
The chord explorer is the UI over this API; the neck tab and the songbook
itself use the same voicings and renderers.
