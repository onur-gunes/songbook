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

    for raw in text.splitlines():
        d = _directive(raw)
        if d is not None:
            key, value = d
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
    return song
