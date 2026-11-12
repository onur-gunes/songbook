#!/usr/bin/env python3
"""Browser test: grid strum lane renders strokes per felt beat.

Opens grid-bearing songs in grid mode and asserts each beat column shows its
strum strokes (not just "/"), the beat number is gone, every slot stays inside
its beat column, and the bar-level strum control is present without repeating
the word "Inherit" on every diagram. Covers 4/4, 3/4, 6/8 and held chords
(beats > 1).

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/grid.py http://localhost:8777
"""
import sys
import time

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures, load_all_fixtures, load_fixture

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
        inject_fixtures(cdp, load_all_fixtures() + [load_fixture('grid-edge')])
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
                "  var br = b.getBoundingClientRect();"
                "  var slots = Array.from(b.querySelectorAll('.grid-beat-slot'));"
                "  return { hasStrokes: !!b.querySelector('.grid-beat-strokes'),"
                "           hasNumber: !!b.querySelector('.grid-beat-no'),"
                "           slotCount: slots.length,"
                "           slotsFit: slots.every(function(s){"
                "             var sr = s.getBoundingClientRect();"
                "             return sr.left >= br.left - 1 && sr.right <= br.right + 1;"
                "           }),"
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
                "  barControls: document.querySelectorAll('.sheet.chords-grid .grid-bar-strum').length,"
                "  barLabels: Array.from(document.querySelectorAll('.sheet.chords-grid .grid-bar-strum'))."
                "    map(function(b){ return { text: b.textContent, label: b.getAttribute('aria-label') }; }) });")
            cells = grid_beats()

            all_have_strokes = all(c['hasStrokes'] for c in cells)
            no_numbers = not any(c['hasNumber'] for c in cells)
            no_legacy_slash = not any(c['text'].strip() == '/' for c in cells)
            slots_fit = all(c['slotsFit'] for c in cells)
            bar_controls_match = info['barControls'] == info['bars']
            no_inherit_pills = all(
                b['text'] != 'Inherit' and 'Bar strum' in (b['label'] or '')
                for b in info['barLabels'])

            ok('%s/%s grid opens (%d bars, %d beats)' % (book, song, info['bars'], info['beats']),
               info['bars'] > 0 and info['beats'] > 0)
            ok('%s/%s every beat shows strokes' % (book, song), all_have_strokes)
            ok('%s/%s beat numbers removed from under the diagrams' % (book, song), no_numbers)
            ok('%s/%s no legacy "/" beat' % (book, song), no_legacy_slash)
            ok('%s/%s strum slots stay inside their beat' % (book, song), slots_fit)
            ok('%s/%s one bar strum control per bar' % (book, song), bar_controls_match)
            ok('%s/%s bar strum control is compact, not "Inherit"' % (book, song),
               no_inherit_pills)

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

        # Regression for #77: a section whose first lyric line has no chord
        # tokens used to synthesise a bar that the next group emitted too,
        # duplicating the opening bar and inflating totalBeats. The fixture
        # has two authored bars; the chart must draw two, not three.
        js("location.hash = '#/grid-edge/leading-lyric-only'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        js("songbookTest.setChordMode('grid')")
        cdp.wait_js("document.querySelectorAll('.sheet.chords-grid .grid-bar').length > 0", timeout=10)
        edge = js(
            "({ bars: document.querySelectorAll('.sheet.chords-grid .grid-bar').length,"
            "  beats: document.querySelectorAll('.sheet.chords-grid .grid-beat').length,"
            "  total: songbookTest.gridInfo().totalBeats,"
            "  bpb: songbookTest.gridInfo().beatsPerBar })")
        ok('leading lyric-only line does not duplicate the opening bar',
           edge['bars'] == 2 and edge['beats'] == 8 and edge['total'] == 8,
           edge)

        # The main selector must rebuild the grid lane, not just the top row.
        # grid-song's documented default is downs-4-4; choosing eighths-4-4
        # must reach every beat cell.
        js("location.hash = '#/test-book/grid-song'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        js("songbookTest.setChordMode('grid')")
        cdp.wait_js("document.querySelectorAll('.sheet.chords-grid .grid-beat').length > 0", timeout=10)
        strum_label = js("document.getElementById('strumRow').getAttribute('aria-label')")
        ok('strum row label carries the pattern name and strokes',
           bool(strum_label) and 'All downs' in strum_label
           and 'down rest' in strum_label and 'Strum pattern' in strum_label,
           strum_label)
        before_ids = js(
            "Array.from(document.querySelectorAll('.sheet.chords-grid .grid-beat'))."
            "map(function(b){ return b.dataset.strumId; })")
        js("(function(){ var s = document.getElementById('strumSelect');"
           "  s.value = 'eighths-4-4';"
           "  s.dispatchEvent(new Event('change', {bubbles:true})); })()")
        cdp.wait_js(
            "Array.from(document.querySelectorAll('.sheet.chords-grid .grid-beat'))."
            "every(function(b){ return b.dataset.strumId === 'eighths-4-4'; })", timeout=10)
        after_ids = js(
            "Array.from(document.querySelectorAll('.sheet.chords-grid .grid-beat'))."
            "map(function(b){ return b.dataset.strumId; })")
        ok('main strum selector rebuilds the grid lane',
           bool(before_ids) and all(i == 'downs-4-4' for i in before_ids)
           and bool(after_ids) and all(i == 'eighths-4-4' for i in after_ids))

        # The bar editor must sit above its backdrop and survive a click on one
        # of its own options. (The backdrop used to cover the panel because it
        # was inside a transformed element.)
        js("document.querySelector('.sheet.chords-grid .grid-bar-strum').click()")
        dialog = js(
            "(function(){"
            "  var ed = document.querySelector('.grid-strum-editor');"
            "  var sh = document.querySelector('.grid-strum-sheet');"
            "  var r = sh.getBoundingClientRect();"
            "  var at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);"
            "  return { open: !!ed && !ed.hidden, onTop: !!(at && at.closest('.grid-strum-sheet')) };"
            "})()")
        ok('bar strum dialog is above its backdrop', dialog['open'] and dialog['onTop'])
        js("document.querySelectorAll('.grid-editor-option')[1].click()")
        ok('choosing a bar pattern keeps the dialog open',
           js("!!document.querySelector('.grid-strum-editor') &&"
              " !document.querySelector('.grid-strum-editor').hidden"))
        js("document.querySelector('.grid-strum-close').click()")

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
