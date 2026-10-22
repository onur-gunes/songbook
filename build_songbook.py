#!/usr/bin/env python3
"""Build a songbook JSON file from a directory of ChordPro songs.

Usage:
    python3 build_songbook.py chordpro/            # every book with book.json
    python3 build_songbook.py chordpro/my-book/    # one book

Input layout:

    chordpro/<book-id>/
        book.json          # {id, name, description, instrument, logo?}
        01-first.cho
        02-second.chordpro

Output:
    songbooks/<book-id>.json
    songbooks/index.json   (entry upserted)
    <book-id>-report.txt

The generated book uses the exact same sheet/chords shape as migrate.py. The
legacy krakow-ukulele migration path is not touched.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile

import chordpro

D = os.path.dirname(os.path.abspath(__file__))
SONGBOOKS = os.path.join(D, 'songbooks')
INDEX = os.path.join(SONGBOOKS, 'index.json')
ENTITIES_RE = re.compile(r'&(?:[a-zA-Z]+|#\d+);')
INSTRUMENTS = ('ukulele', 'guitar')


# ---------- discovery ----------

def find_book_dirs(path):
    if os.path.isfile(os.path.join(path, 'book.json')):
        return [path]
    if not os.path.isdir(path):
        raise SystemExit('not a directory: %s' % path)
    dirs = []
    for name in sorted(os.listdir(path)):
        child = os.path.join(path, name)
        if os.path.isfile(os.path.join(child, 'book.json')):
            dirs.append(child)
    return dirs


def song_files(book_dir):
    return sorted(
        name for name in os.listdir(book_dir)
        if os.path.splitext(name)[1].lower() in chordpro.SONG_EXTENSIONS
        and not name.startswith('.')
    )


def load_original_keys(book_dir):
    """Load an optional per-book original-keys.json sidecar.

    Same shape as songbooks/original-keys.json used by migrate.py: song id ->
    {key, sheetKey, capo, confidence, source} (or a bare key string). This lets
    curated recording keys live next to the ChordPro source instead of in a
    dangling file nobody reads.
    """
    path = os.path.join(book_dir, 'original-keys.json')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    out = {}
    for key, value in data.items():
        if isinstance(value, dict):
            entry = {}
            if value.get('key'):
                entry['key'] = str(value['key'])
            if value.get('sheetKey'):
                entry['sheetKey'] = str(value['sheetKey'])
            if isinstance(value.get('capo'), int):
                entry['capo'] = value['capo']
            if entry:
                out[key] = entry
        elif value:
            out[key] = {'key': str(value)}
    return out


# ---------- validation ----------

def validate_songbook(book):
    """Return (errors, facts) for a built songbook dict."""
    errors = []
    songs = book.get('songs', [])

    ids = [s.get('id') for s in songs]
    duplicate_ids = sorted({i for i in ids if ids.count(i) > 1})
    numbers = [s.get('n') for s in songs]
    duplicate_numbers = sorted({n for n in numbers if numbers.count(n) > 1})

    missing_titles = [s.get('id') or '?' for s in songs if not str(s.get('title', '')).strip()]
    missing_artists = [s.get('id') or '?' for s in songs if not str(s.get('artist', '')).strip()]
    invalid_levels = [s.get('id') or '?' for s in songs
                      if s.get('level') not in chordpro.LEVELS]
    invalid_durations = [s.get('id') or '?' for s in songs
                         if isinstance(s.get('dur'), bool) or not isinstance(s.get('dur'), (int, float))]

    bad_shape, bad_blank, bad_pre, bad_chords = [], [], [], []
    entities = []
    for song in songs:
        sid = song.get('id') or '?'
        for li, line in enumerate(song.get('sheet', [])):
            if not isinstance(line, list):
                bad_shape.append('%s:%d' % (sid, li + 1))
                continue
            if not line:
                continue
            for seg in line:
                if not isinstance(seg, (list, tuple)) or len(seg) != 2:
                    bad_shape.append('%s:%d' % (sid, li + 1))
                    break
            if any(isinstance(seg, (list, tuple)) and len(seg) == 2
                   and seg[0] == 'x' and seg[1] == '' for seg in line):
                bad_blank.append('%s:%d' % (sid, li + 1))
            if any(isinstance(seg, (list, tuple)) and len(seg) == 2
                   and seg[0] == 'p' for seg in line) and len(line) != 1:
                bad_pre.append('%s:%d' % (sid, li + 1))
            for seg in line:
                if not isinstance(seg, (list, tuple)) or len(seg) != 2:
                    continue
                kind, value = seg
                value = str(value)
                if kind == 'c':
                    if not (value.startswith('[') and value.endswith(']') and value[1:-1].strip()):
                        bad_chords.append('%s:%d %r' % (sid, li + 1, value))
                if ENTITIES_RE.search(value) or '\ufffd' in value:
                    entities.append('%s:%d %r' % (sid, li + 1, value[:40]))

    if not songs:
        errors.append('no songs')
    if duplicate_ids:
        errors.append('duplicate ids: %s' % duplicate_ids)
    if duplicate_numbers:
        errors.append('duplicate numbers: %s' % duplicate_numbers)
    if missing_titles:
        errors.append('missing titles: %s' % missing_titles)
    if missing_artists:
        errors.append('missing artists: %s' % missing_artists)
    if invalid_levels:
        errors.append('invalid levels: %s' % invalid_levels)
    if invalid_durations:
        errors.append('invalid durations: %s' % invalid_durations)
    if bad_shape:
        errors.append('sheet lines are not lists: %s' % bad_shape)
    if bad_blank:
        errors.append('blank lines encoded as empty text: %s' % bad_blank)
    if bad_pre:
        errors.append('pre lines must be single-token: %s' % bad_pre)
    if bad_chords:
        errors.append('chord tokens missing brackets: %s' % bad_chords)
    if entities:
        errors.append('leftover html entities / broken unicode: %s' % entities)

    facts = {
        'duplicate_ids': duplicate_ids,
        'duplicate_numbers': duplicate_numbers,
        'missing_titles': missing_titles,
        'missing_artists': missing_artists,
        'invalid_levels': invalid_levels,
        'invalid_durations': invalid_durations,
        'bad_shape': bad_shape,
        'bad_blank': bad_blank,
        'bad_pre': bad_pre,
        'bad_chords': bad_chords,
        'entities': entities,
    }
    return errors, facts


# ---------- chord engine check ----------

CHORD_CHECK_JS = """
const ChordKit = require(%s).ChordKit;
const instrument = %s;
const names = %s;
const bad = [];
for (const raw of names) {
  const head = String(raw).split('/')[0];
  if (ChordKit.isMutedName(head) || /^(stop|pause|riff|muted)$/i.test(head)) continue;
  if (!ChordKit.parse(raw) || !ChordKit.voicings(head, instrument).length) bad.push(raw);
}
console.log('__CHORD_CHECK__' + JSON.stringify(bad));
"""


def _check_chords_chrome(names, instrument):
    try:
        sys.path.insert(0, os.path.join(D, 'tests'))
        from cdp import launch_chrome, new_tab, CDP
    except Exception as exc:
        return None, 'unavailable', 'ChordKit check skipped (%s)' % exc

    chords_path = os.path.join(D, 'chords.js')
    with open(chords_path, encoding='utf-8') as f:
        chords_js = f.read().replace('</script', '<\\/script')
    script = """
(function () {
  var NAMES = %s;
  var INSTRUMENT = %s;
  var bad = [];
  try {
    for (var i = 0; i < NAMES.length; i++) {
      var raw = NAMES[i];
      var head = String(raw).split('/')[0];
      if (ChordKit.isMutedName(head) || /^(stop|pause|riff|muted)$/i.test(head)) continue;
      if (!ChordKit.parse(raw) || !ChordKit.voicings(head, INSTRUMENT).length) bad.push(raw);
    }
    window.__chordCheck = { bad: bad };
  } catch (e) {
    window.__chordCheck = { error: String(e) };
  }
})();
""" % (json.dumps(names, ensure_ascii=False), json.dumps(instrument))

    html = ('<!doctype html><meta charset="utf-8"><pre id="log"></pre>'
            '<script>%s</script><script>%s</script>' % (chords_js, script))
    tmp = tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8')
    tmp.write(html)
    tmp.close()
    proc = None
    port = _free_port()
    try:
        proc, _ = launch_chrome(port)
        target = new_tab(port, 'file://' + tmp.name)
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        cdp.wait_js('window.__chordCheck !== undefined', timeout=20)
        result = cdp.eval('window.__chordCheck')
        cdp.close()
        if result.get('error'):
            return None, 'chrome', 'ChordKit check failed: %s' % result['error']
        return result.get('bad', []), 'chrome', ''
    except Exception as exc:
        return None, 'unavailable', 'ChordKit check skipped (%s)' % exc
    finally:
        if proc is not None:
            proc.terminate()
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def _free_port():
    sock = socket.socket()
    try:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]
    finally:
        sock.close()


def check_chords(names, instrument):
    """Return (bad_names, engine, note); bad_names None means unavailable."""
    if not names:
        return [], 'n/a', ''
    node = shutil.which('node')
    if node:
        script = CHORD_CHECK_JS % (
            json.dumps(os.path.join(D, 'chords.js')),
            json.dumps(instrument),
            json.dumps(names, ensure_ascii=False),
        )
        try:
            proc = subprocess.run([node, '-e', script], capture_output=True,
                                  text=True, timeout=30)
            if proc.returncode == 0:
                marker = '__CHORD_CHECK__'
                for line in reversed(proc.stdout.splitlines()):
                    line = line.strip()
                    if line.startswith(marker):
                        return json.loads(line[len(marker):]), 'node', ''
            return None, 'node', 'ChordKit check failed: %s' % (
                proc.stderr.strip()[:200] or proc.stdout.strip()[:200])
        except Exception as exc:
            return None, 'node', 'ChordKit check failed: %s' % exc
    return _check_chords_chrome(names, instrument)


# ---------- build ----------

def _upsert_index(index_path, entry):
    data = {'songbooks': []}
    if os.path.exists(index_path):
        with open(index_path, encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {'songbooks': data}
    books = data.setdefault('songbooks', [])
    os.makedirs(os.path.dirname(index_path) or '.', exist_ok=True)
    for i, existing in enumerate(books):
        if existing.get('id') == entry['id']:
            books[i] = entry
            break
    else:
        books.append(entry)
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def build_book(book_dir, out_dir=None, index_path=None, report_path=None,
               chord_check=True):
    out_dir = out_dir or SONGBOOKS
    index_path = index_path or INDEX
    errors = []
    warnings = []

    meta_path = os.path.join(book_dir, 'book.json')
    try:
        with open(meta_path, encoding='utf-8-sig') as f:
            meta = json.load(f)
    except Exception as exc:
        errors.append('cannot read book.json: %s' % exc)
        meta = {}

    name = str(meta.get('name') or '').strip()
    book_id = str(meta.get('id') or '').strip()
    if not book_id:
        errors.append('book.json: missing id')
    if not name:
        errors.append('book.json: missing name')
    book_id = book_id or chordpro.slugify(name or os.path.basename(book_dir.rstrip('/')))
    name = name or book_id
    description = str(meta.get('description') or '').strip()
    if not description:
        warnings.append('book.json: missing description')
    instrument = str(meta.get('instrument') or 'ukulele').strip().lower()
    if instrument not in INSTRUMENTS:
        errors.append('book.json: invalid instrument %r (expected ukulele or guitar)'
                      % instrument)

    files = song_files(book_dir)
    if not files:
        errors.append('no .cho/.chordpro/.pro files')

    songs = []
    seen_ids = set()
    deduped = []
    for index, filename in enumerate(files, 1):
        with open(os.path.join(book_dir, filename), encoding='utf-8-sig',
                  errors='replace') as f:
            text = f.read()
        song_warnings = []
        song = chordpro.parse_song(text, number=index, warnings=song_warnings)
        for warning in song_warnings:
            warnings.append('%s: %s' % (filename, warning))

        base = song['id']
        sid = base
        suffix = 2
        while sid in seen_ids:
            sid = '%s-%d' % (base, suffix)
            suffix += 1
        if sid != base:
            deduped.append('%s -> %s' % (base, sid))
        seen_ids.add(sid)
        song['id'] = sid
        songs.append(song)

    if deduped:
        warnings.append('de-duplicated ids: %s' % deduped)

    songs.sort(key=lambda s: s['n'])

    original_keys = load_original_keys(book_dir)
    if original_keys:
        unused = sorted(set(original_keys) - seen_ids)
        if unused:
            warnings.append('original-keys.json: unused ids: %s' % unused)
        for song in songs:
            entry = original_keys.get(song['id'])
            if not entry:
                continue
            if entry.get('key'):
                song['key'] = entry['key']
            if 'capo' in entry:
                song['capo'] = entry['capo']
            if entry.get('sheetKey'):
                song['sheetKey'] = entry['sheetKey']

    book = {
        'id': book_id,
        'name': name,
        'description': description,
        'instrument': instrument,
    }
    for key in ('logo', 'logoDark'):
        if meta.get(key):
            book[key] = meta[key]
    book['songs'] = songs

    validation_errors, facts = validate_songbook(book)
    errors.extend(validation_errors)

    chords = []
    for song in songs:
        for chord in song['chords']:
            if chord not in chords:
                chords.append(chord)

    if chord_check and instrument in INSTRUMENTS:
        bad, engine, note = check_chords(chords, instrument)
        if bad is None:
            warnings.append(note or 'ChordKit check unavailable')
            chord_status = 'skipped (%s)' % engine
        elif bad:
            errors.append('unplayable chords (%s): %s' % (instrument, bad))
            chord_status = 'unplayable: %s' % bad
        else:
            chord_status = 'all %d playable' % len(chords)
    elif chord_check:
        engine = 'n/a'
        chord_status = 'skipped (invalid instrument)'
    else:
        engine = 'disabled'
        chord_status = 'skipped (disabled)'

    output_path = os.path.join(out_dir, book_id + '.json')
    wrote = bool(songs) and not errors
    if wrote:
        os.makedirs(out_dir, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(json.dumps(book, ensure_ascii=False, indent=1) + '\n')
        _upsert_index(index_path, {
            'id': book_id,
            'name': name,
            'description': description,
            'instrument': instrument,
            'file': book_id + '.json',
        })

    levels = {}
    for song in songs:
        levels[song['level']] = levels.get(song['level'], 0) + 1
    numbers = [s['n'] for s in songs]
    report = [
        '=== chordpro validation report ===',
        'book: %s (%s)' % (book_id, name),
        'source: %s' % book_dir,
        'songs: %d' % len(songs),
        'errors: %s' % (errors or 'none'),
        'warnings: %s' % (warnings or 'none'),
        'levels: %s' % (levels or 'none'),
        'numbers: %s' % ('%d..%d unique=%d' % (min(numbers), max(numbers), len(set(numbers)))
                         if numbers else 'none'),
        'duplicate ids: %s' % (facts['duplicate_ids'] or 'none'),
        'duplicate numbers: %s' % (facts['duplicate_numbers'] or 'none'),
        'missing titles: %s' % (facts['missing_titles'] or 'none'),
        'missing artists: %s' % (facts['missing_artists'] or 'none'),
        'invalid levels: %s' % (facts['invalid_levels'] or 'none'),
        'invalid durations: %s' % (facts['invalid_durations'] or 'none'),
        'sheet shape: %s' % ('ok' if not facts['bad_shape'] else facts['bad_shape']),
        'blank lines: %s' % ('ok' if not facts['bad_blank'] else facts['bad_blank']),
        'pre lines: %s' % ('ok' if not facts['bad_pre'] else facts['bad_pre']),
        'chord tokens: %s' % ('ok' if not facts['bad_chords'] else facts['bad_chords']),
        'leftover html entities / broken unicode: %s' % (facts['entities'] or 'none'),
        'unique chords: %d' % len(chords),
        'chord engine (%s): %s' % (engine, chord_status),
        'wrote: %s' % (os.path.relpath(output_path, D) if wrote else 'not written'),
        'index: %s' % (os.path.relpath(index_path, D) if wrote else 'not updated'),
    ]
    report_text = '\n'.join(report)
    if report_path is None:
        report_path = os.path.join(D, book_id + '-report.txt')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report_text + '\n')

    return {
        'book': book,
        'output': output_path,
        'report_path': report_path,
        'report': report_text,
        'errors': errors,
        'warnings': warnings,
        'chords': chords,
    }


def main(argv):
    path = argv[1] if len(argv) > 1 else 'chordpro'
    books = find_book_dirs(path)
    if not books:
        raise SystemExit('no book.json found under %s' % path)

    failed = False
    for i, book_dir in enumerate(books):
        result = build_book(book_dir, chord_check='--no-chord-check' not in argv[2:])
        if i:
            print()
        print(result['report'])
        print('report written to %s' % result['report_path'])
        failed = failed or bool(result['errors'])
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
