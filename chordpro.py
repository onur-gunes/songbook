#!/usr/bin/env python3
"""Parse the ChordPro subset used to author agent-generated songbooks.

The app's runtime format is still the JSON sheet shape produced by migrate.py.
This module is a parallel *input* path: it turns a ChordPro document into a
song dict with the same `sheet` / `chords` shape the app already renders.

Public API:
    parse_song(text, number=1, warnings=None) -> dict
    parse_line(line) -> list
    slugify(text) -> str
"""
import re
import unicodedata

METADATA_DIRECTIVES = {
    'id': 'id',
    'title': 'title', 't': 'title',
    'artist': 'artist', 'subtitle': 'artist', 'st': 'artist',
    'level': 'level',
    'duration': 'dur',
    'tempo': 'bpm', 'bpm': 'bpm',
    'time': 'time', 'meter': 'time',
    'strum': 'strum',
    'key': 'key',
    'sheetkey': 'sheetKey',
    'capo': 'capo',
    'new': 'new',
    'number': 'n',
    'chords': 'chords',
}

LEVELS = ('Easy', 'Medium', 'Hard')
SONG_EXTENSIONS = ('.cho', '.chordpro', '.pro')

# Tempo is the *felt* pulse, not the notated beat: quarter-note BPM in simple
# metres (4/4, 3/4, 2/4) and dotted-quarter BPM in compound 6/8, so a 6/8 song
# at 60 has 60 dotted-quarter pulses (two per bar), not 180 eighths. That makes
# bpm mean "what a metronome clicks" in every metre, which is what the
# metronome and the strum library both want.
BPM_MIN = 20
BPM_MAX = 300
TIME_SIGNATURES = ('4/4', '3/4', '6/8', '2/4')

# Felt beats per bar, the same count the metronome accents and the strum
# library encodes (len(slots) / subdiv): one dotted-quarter pulse per half-bar
# in 6/8, so 6/8 is two beats, not six. A grid bar must sum to this many beats.
# Mirrored in js/metronome.js and js/songbooks.js (the import-boundary grid
# check); tests/strum.py reuses this copy.
BEATS_PER_BAR = {'4/4': 4, '3/4': 3, '6/8': 2, '2/4': 2}

_DIRECTIVE_RE = re.compile(r'^\s*\{([^{}]*)\}\s*$')

def slugify(text):
    """Slugify a title exactly like migrate.py does."""
    s = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s[:48] or 'song'


def _directive(line):
    """Return (key, value) for a {key: value} line, else None."""
    m = _DIRECTIVE_RE.match(line)
    if not m:
        return None
    body = m.group(1)
    if ':' in body:
        key, value = body.split(':', 1)
    else:
        key, value = body, ''
    key = key.strip().lower().replace(' ', '_')
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
        value = value[1:-1].strip()
    return key, value


def parse_line(line):
    """Tokenize one ChordPro lyric line into app sheet tokens.

    Chords keep their brackets: "[Am]". Text is preserved verbatim, so
    "Po [C#m]co" keeps the space before the chord and indentation is kept.
    A backslash escapes a literal bracket or backslash: "\\[Refren\\]".
    A blank line becomes an empty list (never [["x", ""]]).
    """
    if not line or not line.strip():
        return []
    text = line
    tokens = []
    buf = []
    pos = 0
    while pos < len(text):
        if text[pos] == '\\' and pos + 1 < len(text) and text[pos + 1] in '[]\\':
            buf.append(text[pos + 1])
            pos += 2
        elif text[pos] == '[':
            end = text.find(']', pos + 1)
            if end < 0:
                buf.append(text[pos:])
                break
            chord = text[pos + 1:end].strip()
            if not chord:
                buf.append(text[pos:end + 1])
                pos = end + 1
                continue
            if buf:
                tokens.append(['x', ''.join(buf)])
                buf = []
            tokens.append(['c', '[' + chord + ']'])
            pos = end + 1
        else:
            buf.append(text[pos])
            pos += 1
    if buf:
        tokens.append(['x', ''.join(buf)])
    return tokens


def _as_bool(value):
    v = str(value).strip().lower()
    if v in ('1', 'true', 'yes', 'y', 'on'):
        return True
    if v in ('0', 'false', 'no', 'n', 'off', ''):
        return False
    return None


def parse_bpm(value):
    """Return an int BPM in range, or None if it is not a valid tempo.

    Accepts ints and floats ("92", "92.0"); rejects anything outside
    BPM_MIN..BPM_MAX. Shared with the tempo.json sidecar loader so the
    ChordPro directive and the sidecar can never disagree on what is valid.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        try:
            number = float(str(value).strip())
        except (TypeError, ValueError):
            return None
    if number != number or number in (float('inf'), float('-inf')):
        return None
    number = round(number)
    if number < BPM_MIN or number > BPM_MAX:
        return None
    return int(number)


def parse_time(value):
    """Return an allowlisted time signature string, or None.

    Deliberately not freeform: the strum library is indexed by metre, so an
    unrecognised meter is a mistake to surface, not a value to pass through.
    """
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace(' ', '')
    return text if text in TIME_SIGNATURES else None


# ---------- bar/beat grid ----------
#
# A grid block is a chart of bars, authored separately from the lyric lines:
#
#     {start_of_grid: Intro/Chorus/Interlude}
#     | C | G | Am | G |
#     |: F | G . . | C :|
#     {end_of_grid}
#
# `|` is a bar line; a bar holds chord tokens. A lone chord fills the bar; a
# `.` extends the previous chord by one felt beat, so `G . .` is G for three
# beats (standard Nashville/chart notation). `|:` opens a repeat and `:|`
# closes one. The block label becomes the section name.
#
# The parsed shape is deliberately parallel to `sheet`, not nested in it:
#
#     "grid": [
#       {"label": "Intro/Chorus/Interlude", "repeat": false,
#        "bars": [{"beats": [{"chord": "C", "beats": 4}]}, ...]}
#     ]
#
# This module only parses; build_songbook.validate_songbook is what turns a
# bar that does not sum to the metre (or a grid with no `time`) into a build
# error, exactly as it does for an out-of-range bpm. Structural problems the
# parser cannot represent (empty bars, a stray `.`, misplaced repeats) raise
# ValueError here and are reported as a warning that drops the offending block.

_BARLINE_RE = re.compile(r'(\|:|:\||\|)')


def _grid_bar_beats(bar_text, beats_per_bar):
    """Parse one bar's text into a list of {'chord', 'beats'} entries.

    A lone chord with no dots fills the bar (`beats_per_bar`); otherwise each
    chord takes one beat plus one for every trailing `.`. Raises ValueError on
    an empty bar or a `.` with no chord to extend.
    """
    entries = []
    for tok in bar_text.split():
        if set(tok) == {'.'}:
            if not entries:
                raise ValueError("'.' with no preceding chord")
            entries[-1]['beats'] += len(tok)
        else:
            entries.append({'chord': tok, 'beats': 1})
    if not entries:
        raise ValueError('empty bar')
    # A single bare chord fills the bar. This is the only place beats depend on
    # the metre, which is why the grid is parsed after `time` is known.
    if beats_per_bar is not None and len(entries) == 1 and entries[0]['beats'] == 1:
        entries[0]['beats'] = beats_per_bar
    return entries


def _grid_line_bars(label, line, beats_per_bar):
    """Split one bar-line-delimited grid line into (seps, bar_texts).

    Every line must open and close with a bar line; text outside the outermost
    bar lines, or an empty interior bar, is a ValueError. `seps` are the bar
    line tokens in order, `bar_texts` the raw text of each enclosed bar.
    """
    parts = _BARLINE_RE.split(line)
    pre = parts[0].strip()
    if pre:
        raise ValueError('grid block %r: text before first bar line: %r' % (label, pre))
    seps = parts[1::2]
    contents = parts[2::2]
    if not seps:
        raise ValueError('grid block %r: a line has no bar lines' % label)
    post = contents[-1].strip() if contents else ''
    if post:
        raise ValueError('grid block %r: text after last bar line: %r' % (label, post))
    bar_texts = contents[:-1]
    if not bar_texts:
        raise ValueError('grid block %r: a line has no bars' % label)
    return seps, bar_texts


def parse_grid_block(label, body_lines, time_sig):
    """Parse one {start_of_grid}…{end_of_grid} block into a grid block dict.

    `time_sig` is the song's validated metre (or None); it is used only to
    expand a lone bare chord to a full bar. Raises ValueError if the block has
    no bars, a bar is malformed, or repeat marks are not a balanced pair at the
    block's edges.

    Each body line is parsed independently and its bars concatenated, so a
    grid can span several lines (`| C | G |` / `| Am | G |`) without the line
    break reading as an empty bar between the trailing and leading bar lines.
    """
    beats_per_bar = BEATS_PER_BAR.get(time_sig)
    lines = [line.strip() for line in body_lines if line.strip()]
    if not lines:
        raise ValueError('grid block %r has no bars' % label)
    # Flatten the block into one separator sequence interleaved with bars:
    # [sep, bar, sep, bar, ..., sep]. Each line both opens and closes with a
    # bar line, so the trailing bar line of one line and the leading bar line
    # of the next are the *same* musical division written twice; the leading
    # one is dropped so the block reads as a single continuous sequence.
    # `seps` ends up interleaved with bars as [s0, bar0, s1, bar1, ..., sN]:
    # N bars have N+1 bar lines around them. Each line both opens and closes
    # with a bar line, so an interior line's opening bar line is the *same*
    # division as the previous line's closing one, written twice; the duplicate
    # is dropped so the block reads as one continuous sequence.
    seps = []
    bar_texts = []
    for i, line in enumerate(lines):
        line_seps, line_bars = _grid_line_bars(label, line, beats_per_bar)
        if i > 0:
            if line_seps[0] != '|' or seps[-1] != '|':
                # A repeat mark straddling an interior line break is a repeat
                # in the middle of the block, which the single `repeat` flag
                # cannot represent.
                raise ValueError('grid block %r: repeat mark on an interior '
                                 'line break' % label)
            line_seps = line_seps[1:]
        seps.extend(line_seps)
        bar_texts.extend(line_bars)
    # Repeat marks are only valid as a balanced pair at the block's edges: a
    # single `|:` at the very start and/or a single `:|` at the very end. A
    # close with no matching open repeats from the block's start (standard
    # notation), so a lone trailing `:|` is balanced on its own.
    opens = [i for i, s in enumerate(seps) if s == '|:']
    closes = [i for i, s in enumerate(seps) if s == ':|']
    if any(i != 0 for i in opens) or len(opens) > 1:
        raise ValueError('grid block %r: open-repeat must be a single mark at the start' % label)
    if any(i != len(seps) - 1 for i in closes) or len(closes) > 1:
        raise ValueError('grid block %r: close-repeat must be a single mark at the end' % label)
    repeat = bool(opens or closes)
    bars = [{'beats': _grid_bar_beats(bt, beats_per_bar)} for bt in bar_texts]
    return {'label': label, 'repeat': repeat, 'bars': bars}


# ---------- strum pattern library ----------

# A deliberately small library of strum patterns, keyed by metre. This is the
# canonical source; js/strum.js carries a byte-identical mirror (tests/strum.py
# asserts the two agree), exactly as TIME_SIGNATURES is mirrored in
# js/songbooks.js.
#
# Each pattern is {id, name, time, subdiv, slots}:
#   - `slots` is a string of 'D' (down), 'U' (up) and '-' (rest), one char per
#     subdivision slot. It is the *subdivision row* the UI renders under the
#     chord strip, with bar lines around it.
#   - `subdiv` is how many slots fall on one felt beat (2 = eighths in simple
#     metres). len(slots) must therefore equal subdiv * beats-per-bar, so the
#     row lines up with the metronome's accents (beat 1 is slot 0).
#
# Kept small on purpose: a handful of generic, widely-taught patterns per metre,
# NOT per-song transcriptions. The list is "common strums you could play over
# almost anything in this metre", not every strum that exists.
#
# CAVEAT (stated here in the data, not only in the UI): strum patterns are far
# less reliably documented than key or bpm, and most real songs change pattern
# between verse and chorus. A per-song `strum` is one pattern for the whole
# song and is explicitly an approximation; per-section patterns are a later
# feature. The per-song field is a single id today but is designed so it can
# grow to a list without a data migration.
STRUM_PATTERNS = (
    # 4/4 — eighths (8 slots)
    {'id': 'downs-4-4', 'name': 'All downs', 'time': '4/4', 'subdiv': 2,
     'slots': 'D-D-D-D-'},
    {'id': 'eighths-4-4', 'name': 'All eighths', 'time': '4/4', 'subdiv': 2,
     'slots': 'DUDUDUDU'},
    {'id': 'dduudu-4-4', 'name': 'D DU UDU', 'time': '4/4', 'subdiv': 2,
     'slots': 'D-DU-UDU'},
    {'id': 'dddudu-4-4', 'name': 'D D DU DU', 'time': '4/4', 'subdiv': 2,
     'slots': 'D-D-DUDU'},
    {'id': 'ddudu-4-4', 'name': 'D DU D DU', 'time': '4/4', 'subdiv': 2,
     'slots': 'D-DUD-DU'},
    {'id': 'duudu-4-4', 'name': 'D U UDU', 'time': '4/4', 'subdiv': 2,
     'slots': 'D-U-UDU-'},
    # 3/4 — eighths (6 slots)
    {'id': 'downs-3-4', 'name': 'All downs', 'time': '3/4', 'subdiv': 2,
     'slots': 'D-D-D-'},
    {'id': 'eighths-3-4', 'name': 'All eighths', 'time': '3/4', 'subdiv': 2,
     'slots': 'DUDUDU'},
    {'id': 'waltz-3-4', 'name': 'D DU DU', 'time': '3/4', 'subdiv': 2,
     'slots': 'D-DUDU'},
    {'id': 'dddu-3-4', 'name': 'D D DU', 'time': '3/4', 'subdiv': 2,
     'slots': 'D-D-DU'},
    # 6/8 — counted in two dotted-quarter pulses, 3 slots per pulse (6 slots)
    {'id': 'downs-6-8', 'name': 'D . . D . .', 'time': '6/8', 'subdiv': 3,
     'slots': 'D--D--'},
    {'id': 'du-6-8', 'name': 'D . U D . U', 'time': '6/8', 'subdiv': 3,
     'slots': 'D-UD-U'},
    # Alternating eighths in 6/8 must restart on the second pulse: strict
    # D-U alternation (DUDUDU) would land an UP-stroke on pulse 2, fighting
    # the metronome's accent. A rest-free pattern strums down on every felt
    # beat; tests/strum.py enforces it.
    {'id': 'eighths-6-8', 'name': 'All eighths', 'time': '6/8', 'subdiv': 3,
     'slots': 'DUDDUD'},
    # 2/4 — eighths (4 slots)
    {'id': 'downs-2-4', 'name': 'All downs', 'time': '2/4', 'subdiv': 2,
     'slots': 'D-D-'},
    {'id': 'eighths-2-4', 'name': 'All eighths', 'time': '2/4', 'subdiv': 2,
     'slots': 'DUDU'},
    {'id': 'ddu-2-4', 'name': 'D DU', 'time': '2/4', 'subdiv': 2,
     'slots': 'D-DU'},
)

STRUM_IDS = frozenset(p['id'] for p in STRUM_PATTERNS)


def strum_patterns_for(time_sig):
    """Patterns whose metre matches `time_sig`, in library order."""
    return [p for p in STRUM_PATTERNS if p['time'] == time_sig]


def parse_strum(value):
    """Return a known strum pattern id, or None.

    Like parse_time, this is an allowlist, not freeform: the id must name a
    pattern that actually exists in STRUM_PATTERNS, otherwise the row has
    nothing to render. The metre the pattern belongs to is validated against
    the song's `time` separately (in build_songbook), so this only checks the
    id is real.
    """
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    return text if text in STRUM_IDS else None


def _derive_chords(sheet):
    chords = []
    for line in sheet:
        for seg in line:
            if seg[0] != 'c':
                continue
            name = seg[1]
            if name.startswith('[') and name.endswith(']'):
                name = name[1:-1].strip()
            if name and name not in chords:
                chords.append(name)
    return chords


def _warn(warnings, message):
    if warnings is not None:
        warnings.append(message)


def parse_song(text, number=1, warnings=None, allow_trusted_notes=False):
    """Parse a ChordPro document into an app song dict.

    `number` is the default song order (normally its 1-based file position).
    Missing required metadata is defaulted and reported through `warnings`
    when a list is supplied. The caller is responsible for de-duplicating ids
    across a book.
    """
    if text.startswith('\ufeff'):
        text = text[1:]
    meta = {}
    sheet = []
    in_tab = False
    # Grid blocks are collected raw here and parsed after `time` is known,
    # since a lone bare chord's beat count depends on the metre. Each entry is
    # (label, [body lines]).
    raw_grids = []
    grid_label = None
    grid_lines = None

    for raw in text.splitlines():
        d = _directive(raw)
        if d is not None:
            key, value = d
            if grid_lines is not None and key not in ('end_of_grid', 'eog'):
                # A grid block is line-scoped like a tab; a stray directive
                # inside it is almost certainly a missing {end_of_grid}.
                _warn(warnings, 'directive {%s} inside grid block %r: did you '
                                'forget {end_of_grid}?' % (key, grid_label))
            if key in METADATA_DIRECTIVES:
                meta[METADATA_DIRECTIVES[key]] = value
            elif key in ('start_of_chorus', 'soc'):
                sheet.append([['i', '(Chorus)']])
            elif key in ('end_of_chorus', 'eoc'):
                continue
            elif key in ('start_of_tab', 'sot'):
                in_tab = True
            elif key in ('end_of_tab', 'eot'):
                in_tab = False
            elif key in ('start_of_grid', 'sog'):
                grid_label = value
                grid_lines = []
            elif key in ('end_of_grid', 'eog'):
                if grid_lines is not None:
                    raw_grids.append((grid_label, grid_lines))
                grid_label = None
                grid_lines = None
            elif key in ('comment', 'c'):
                if value:
                    sheet.append([['i', value]])
            elif key == 'trusted_note':
                # Legacy app note kind (`y`), rendered via innerHTML. Only use
                # this for content that is trusted, never for agent output.
                if not allow_trusted_notes:
                    _warn(warnings, 'trusted_note ignored: book does not allow trusted notes')
                elif value:
                    sheet.append([['y', value]])
            # Other directives (define, capo of unknown spelling, etc.) are
            # intentionally ignored: the agent subset is small.
            continue

        if grid_lines is not None:
            # Inside a grid block: collect raw bar lines, skip source comments.
            if not raw.lstrip().startswith('#'):
                grid_lines.append(raw)
            continue

        if raw.lstrip().startswith('#'):
            continue

        if in_tab:
            # Raw tab: no chord parsing, preserve indentation, one pre line.
            if raw.strip():
                sheet.append([['p', raw.rstrip()]])
            else:
                sheet.append([])
            continue

        sheet.append(parse_line(raw))

    if grid_lines is not None:
        # Unterminated block: parse what we have rather than drop it silently.
        _warn(warnings, 'grid block %r is missing {end_of_grid}' % grid_label)
        raw_grids.append((grid_label, grid_lines))

    while sheet and not sheet[0]:
        sheet.pop(0)
    while sheet and not sheet[-1]:
        sheet.pop()

    title = meta.get('title', '').strip()
    artist = meta.get('artist', '').strip()

    level = meta.get('level', '').strip()
    if not level:
        _warn(warnings, 'missing level, defaulting to Medium')
        level = 'Medium'
    else:
        level = level[:1].upper() + level[1:].lower()
        if level not in LEVELS:
            _warn(warnings, 'invalid level %r, defaulting to Medium' % meta.get('level'))
            level = 'Medium'

    dur_raw = meta.get('dur', '').strip()
    if not dur_raw:
        _warn(warnings, 'missing duration, defaulting to 3')
        dur = 3.0
    else:
        try:
            dur = float(dur_raw)
        except ValueError:
            _warn(warnings, 'invalid duration %r, defaulting to 3' % dur_raw)
            dur = 3.0

    n = number
    if 'n' in meta:
        try:
            n = int(meta['n'])
        except ValueError:
            _warn(warnings, 'invalid number %r' % meta['n'])

    new = False
    if 'new' in meta:
        parsed = _as_bool(meta['new'])
        if parsed is None:
            _warn(warnings, 'invalid new value %r, defaulting to false' % meta['new'])
        else:
            new = parsed

    raw_id = meta.get('id', '').strip()
    song_id = slugify(title)
    if raw_id:
        if re.fullmatch(r'[a-z0-9-]+', raw_id):
            song_id = raw_id
        else:
            _warn(warnings, 'invalid id %r, slugifying' % raw_id)
            song_id = slugify(raw_id) or song_id

    song = {
        'id': song_id,
        'n': n,
        'title': title,
        'artist': artist,
        'level': level,
        'new': new,
        'dur': dur,
    }

    key = meta.get('key', '').strip()
    sheet_key = meta.get('sheetKey', '').strip()
    capo_present = 'capo' in meta
    if key:
        song['key'] = key
        song['sheetKey'] = sheet_key or key
    elif sheet_key:
        song['sheetKey'] = sheet_key
    if capo_present:
        try:
            song['capo'] = int(meta['capo'])
        except ValueError:
            _warn(warnings, 'invalid capo %r, defaulting to 0' % meta['capo'])
            song['capo'] = 0
    elif key or sheet_key:
        song['capo'] = 0

    # Unlike duration and capo there is no safe default tempo to fall back to,
    # so an unparseable value is kept verbatim and left for validate_songbook
    # to reject: a wrong metronome is worse than no metronome, and the build
    # must refuse to publish rather than quietly guess.
    bpm_raw = meta.get('bpm', '').strip()
    if bpm_raw:
        bpm = parse_bpm(bpm_raw)
        if bpm is None:
            _warn(warnings, 'invalid tempo %r (expected %d-%d bpm)'
                            % (bpm_raw, BPM_MIN, BPM_MAX))
            song['bpm'] = bpm_raw
        else:
            song['bpm'] = bpm

    time_raw = meta.get('time', '').strip()
    if time_raw:
        time_sig = parse_time(time_raw)
        if time_sig is None:
            _warn(warnings, 'invalid time signature %r (expected %s)'
                            % (time_raw, ', '.join(TIME_SIGNATURES)))
            song['time'] = time_raw
        else:
            song['time'] = time_sig

    # Like bpm, an unknown strum id is kept verbatim for validate_songbook to
    # reject rather than silently dropped: a typo'd pattern id should fail the
    # build, not quietly leave the song with no strum row.
    strum_raw = meta.get('strum', '').strip()
    if strum_raw:
        strum_id = parse_strum(strum_raw)
        if strum_id is None:
            _warn(warnings, 'invalid strum %r (expected one of %s)'
                            % (strum_raw, ', '.join(sorted(STRUM_IDS))))
            song['strum'] = strum_raw
        else:
            song['strum'] = strum_id

    song['chords'] = _derive_chords(sheet)
    if meta.get('chords', '').strip():
        overridden = [name.strip() for name in meta['chords'].split(',') if name.strip()]
        if overridden:
            missing = sorted(set(song['chords']) - set(overridden))
            unused = sorted(set(overridden) - set(song['chords']))
            if missing or unused:
                _warn(warnings, 'chords override differs from sheet '
                                '(missing: %s, unused: %s)' % (missing or 'none',
                                                              unused or 'none'))
            song['chords'] = overridden
    song['sheet'] = sheet

    # Grids are parsed last: a lone bare chord's beat count depends on the
    # metre, so `time` must be resolved first. A block that cannot be parsed is
    # dropped with a warning rather than emitting a half-valid grid — the per-
    # bar beat totals are checked against `time` later, in validate_songbook.
    if raw_grids:
        valid_time = parse_time(meta.get('time', '').strip())
        grid = []
        for label, body_lines in raw_grids:
            try:
                grid.append(parse_grid_block(label, body_lines, valid_time))
            except ValueError as exc:
                _warn(warnings, 'dropped grid block: %s' % exc)
        if grid:
            song['grid'] = grid
    return song
