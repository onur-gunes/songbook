#!/usr/bin/env python3
"""Browser test: grid strum lane renders strokes per felt beat.

Opens grid-bearing songs in grid mode and asserts each beat column shows its
strum strokes (not just "/"), the beat number is shown, and the bar-level
strum control is present. Covers 4/4, 3/4, 6/8 and held chords (beats > 1).

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/grid.py http://localhost:8777
"""
import sys
import time

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9340

# (book id, song id, time signature). grid-song and six-eight-song carry
# authored grids with held chords (beats > 1); the others fall back to an
# automatic one-chord-per-bar grid.
SONGS = [
    ('test-book', 'grid-song', '4/4'),
    ('krakow-ukulele', 'three-quarter-time', '3/4'),
    ('test-book', 'six-eight-song', '6/8'),
    ('test-book', 'two-four-song', '2/4'),
]


def main():
    proc, _ = launch_chrome(PORT)
    try:
        target = new_tab(PORT, 'about:blank')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        inject_fixtures(cdp)
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.getActive())', timeout=30)

        results = []

        def ok(name, cond, detail=''):
            results.append((name, bool(cond), detail))

        def js(expr):
            return cdp.eval(expr)

        def grid_beats():
            return js(
                "Array.from(document.querySelectorAll('.sheet.chords-grid .grid-beat')).map(function(b){"
                "  return { hasStrokes: !!b.querySelector('.grid-beat-strokes'),"
                "           hasNumber: !!b.querySelector('.grid-beat-no'),"
                "           slotCount: b.querySelectorAll('.grid-beat-slot').length,"
                "           text: b.textContent };"
                "});")

        for book, song, time in SONGS:
            js("location.hash = '#/%s/%s'" % (book, song))
            cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
            js("songbookTest.setChordMode('grid')")
            cdp.wait_js(
                "document.querySelectorAll('.sheet.chords-grid .grid-bar').length > 0", timeout=10)

            info = js(
                "({ bars: document.querySelectorAll('.sheet.chords-grid .grid-bar').length,"
                "  beats: document.querySelectorAll('.sheet.chords-grid .grid-beat').length,"
                "  barControls: document.querySelectorAll('.sheet.chords-grid .grid-bar-strum').length });")
            cells = grid_beats()

            all_have_strokes = all(c['hasStrokes'] for c in cells)
            all_have_numbers = all(c['hasNumber'] for c in cells)
            no_legacy_slash = not any(c['text'].strip() == '/' for c in cells)
            bar_controls_match = info['barControls'] == info['bars']

            ok('%s/%s grid opens (%d bars, %d beats)' % (book, song, info['bars'], info['beats']),
               info['bars'] > 0 and info['beats'] > 0)
            ok('%s/%s every beat shows strokes' % (book, song), all_have_strokes)
            ok('%s/%s every beat shows its number' % (book, song), all_have_numbers)
            ok('%s/%s no legacy "/" beat' % (book, song), no_legacy_slash)
            ok('%s/%s one bar strum control per bar' % (book, song), bar_controls_match)

        # Held-chord check: in six-eight-song every bar is one chord held for
        # 2 felt beats, so there must be 8 beat cells for 4 bars, each with
        # 3 subdivision slots (6/8 subdiv = 3).
        js("location.hash = '#/test-book/six-eight-song'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        js("songbookTest.setChordMode('grid')")
        cdp.wait_js("document.querySelectorAll('.sheet.chords-grid .grid-beat').length > 0", timeout=10)
        held = js(
            "({ beats: document.querySelectorAll('.sheet.chords-grid .grid-beat').length,"
            "  allTriplets: Array.from(document.querySelectorAll('.sheet.chords-grid .grid-beat'))."
            "    every(function(b){ return b.querySelectorAll('.grid-beat-slot').length === 3; }) });")
        ok('six-eight-song held chords: 8 beats, 3 slots each',
           held['beats'] == 8 and held['allTriplets'])

        n_fail = 0
        for name, passed, detail in results:
            print(('PASS ' if passed else 'FAIL ') + name + (' | ' + str(detail) if detail != '' else ''))
            n_fail += 0 if passed else 1
        print('\n%d/%d passed' % (len(results) - n_fail, len(results)))
        cdp.close()
        return 1 if n_fail else 0
    finally:
        proc.terminate()


if __name__ == '__main__':
    sys.exit(main())
