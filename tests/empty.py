#!/usr/bin/env python3
"""CDP test for the content-free boot (zero songbooks).

Phase 2 acceptance: with ``window.__SONGBOOKS__ = []`` the app must boot to a
usable list view with the empty state, not a fatal error. Importing a book must
return it to the normal app, and removing the last book must return to the
empty state.

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/empty.py http://localhost:8777
"""
import json
import sys

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures, load_fixture

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9335


def import_files_js(files):
    """Build file-input dispatch JS for a batch of (name, content) pairs."""
    items = ''.join(
        "dt.items.add(new File([%s], %s, { type: 'application/json' }));"
        % (json.dumps(content), json.dumps(name))
        for name, content in files)
    return """
(function () {
  var inp = document.getElementById('importFile');
  var dt = new DataTransfer();
  %s
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()
""" % items


def main():
    proc, _ = launch_chrome(PORT)
    results = []

    def ok(name, cond, detail=''):
        results.append((name, bool(cond), detail))

    try:
        target = new_tab(PORT, 'about:blank')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()

        # Empty injected list is authoritative (see SB.loadBundled): the app
        # must not fall back to fetching songbooks/index.json.
        inject_fixtures(cdp, books=[])
        # Import reports a summary through alert(); capture it so a blocking
        # dialog cannot stall the test.
        cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            'source': 'window.__alerts = [];'
                      'window.alert = function (m) { window.__alerts.push(String(m)); };'
        })
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)

        # --- boot with no books -------------------------------------------
        ok('no songbooks loaded', cdp.eval('songbookTest.allSongbooks().length') == 0,
           cdp.eval('songbookTest.allSongbooks().length'))
        ok('no active songbook', cdp.eval('songbookTest.getActive()') is None)
        ok('list view shown', cdp.eval("document.getElementById('listView').hidden") is False)
        ok('song view hidden', cdp.eval("document.getElementById('songView').hidden") is True)
        ok('boot message hidden', cdp.eval("document.getElementById('bootMsg').hidden") is True)
        ok('boot message is not an error',
           cdp.eval("document.getElementById('bootMsg').classList.contains('boot-error')") is False)
        ok('empty state shown', cdp.eval("document.getElementById('emptyState').hidden") is False)
        ok('list toolbar hidden', cdp.eval("document.getElementById('listControls').hidden") is True)
        ok('no rendered rows',
           cdp.eval("document.querySelectorAll('#songList .song-row').length") == 0)
        ok('empty import button is visible',
           cdp.eval("document.getElementById('emptyImportBtn').offsetParent !== null"))
        ok('top import button is visible',
           cdp.eval("document.getElementById('importBtn').offsetParent !== null"))
        ok('empty state offers URL import',
           cdp.eval("document.getElementById('emptyImportUrlBtn').offsetParent !== null"))
        cdp.eval("document.getElementById('emptyImportUrlBtn').click()")
        ok('empty state URL form opens with a text input',
           cdp.eval("document.getElementById('importUrlForm').hidden") is False
           and cdp.eval("document.getElementById('importUrl').offsetParent !== null"))
        cdp.eval("document.getElementById('importUrlCancel').click()")
        ok('URL form closes again',
           cdp.eval("document.getElementById('importUrlForm').hidden") is True)
        ok('remove button hidden', cdp.eval("document.getElementById('removeSongsBtn').hidden") is True)
        ok('export button hidden', cdp.eval("document.getElementById('exportSongsBtn').hidden") is True)
        ok('picker has no books',
           cdp.eval("document.querySelectorAll('#songbookSelect option').length") == 0)

        # A hand-edited route must not strand the app with both views hidden.
        cdp.eval("location.hash = '#/missing-book'")
        cdp.wait_js("document.getElementById('listView').hidden === false", timeout=10)
        ok('unknown route keeps the empty list usable',
           cdp.eval("document.getElementById('emptyState').hidden") is False)

        # --- importing a book returns the app to normal -------------------
        book = load_fixture('test-book')
        cdp.eval(import_files_js([('test-book.json', json.dumps(book))]),
                 await_promise=False)
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'test-book'",
                    timeout=15)
        ok('import activates the book',
           cdp.eval('songbookTest.getActive().id') == 'test-book')
        ok('import hides the empty state',
           cdp.eval("document.getElementById('emptyState').hidden") is True)
        ok('import shows the toolbar',
           cdp.eval("document.getElementById('listControls').hidden") is False)
        rows = cdp.eval("document.querySelectorAll('#songList .song-row').length")
        ok('import renders every song', rows == len(book['songs']), rows)
        ok('remove button visible for an import',
           cdp.eval("document.getElementById('removeSongsBtn').hidden") is False)
        ok('export button visible for an import',
           cdp.eval("document.getElementById('exportSongsBtn').hidden") is False)

        # The fixture is the compact coverage book: every metre, a grid song,
        # a no-grid song, a capo/key song and a song with no time.
        coverage = cdp.eval("""
            (function () {
                var songs = songbookTest.getActive().songs;
                return {
                    times: songs.map(function (s) { return s.time; }).filter(Boolean),
                    grid: songs.filter(function (s) { return !!s.grid; }).map(function (s) { return s.id; }),
                    noGrid: songs.filter(function (s) { return !s.grid; }).map(function (s) { return s.id; }),
                    capo: songs.filter(function (s) { return s.capo > 0; }).map(function (s) { return s.id; }),
                    noTime: songs.filter(function (s) { return s.time === null; }).map(function (s) { return s.id; })
                };
            })()
        """)
        for metre in ('4/4', '3/4', '6/8', '2/4'):
            ok('fixture covers metre ' + metre, metre in coverage['times'], coverage['times'])
        ok('fixture has a grid song', 'grid-song' in coverage['grid'], coverage['grid'])
        ok('fixture has a no-grid song', 'no-grid-song' in coverage['noGrid'], coverage['noGrid'])
        ok('fixture has a capo/key song', 'capo-key-song' in coverage['capo'], coverage['capo'])
        ok('fixture has a song with no time', 'no-time-song' in coverage['noTime'],
           coverage['noTime'])

        cdp.eval("location.hash = '#/test-book/grid-song'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Grid Song'", timeout=10)
        cdp.eval("document.querySelector('.chord-mode-btn[data-chord-mode=\"grid\"]').click()")
        cdp.wait_js('!!songbookTest.gridInfo()', timeout=10)
        ok('fixture grid renders', cdp.eval('songbookTest.gridInfo().totalBeats') == 8,
           cdp.eval('songbookTest.gridInfo().totalBeats'))

        cdp.eval("location.hash = '#/test-book/two-four-song'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Two Four Song'", timeout=10)
        cdp.wait_js('!!songbookTest.gridInfo()', timeout=10)
        ok('2/4 grid uses two beats per bar',
           cdp.eval('songbookTest.gridInfo().totalBeats') == 4
           and cdp.eval('songbookTest.gridInfo().beatsPerBar') == 2,
           cdp.eval('songbookTest.gridInfo()'))

        # --- removing the last book returns to the empty state ------------
        cdp.eval("window.confirm = function () { return true; };")
        cdp.eval("document.getElementById('removeSongsBtn').click()", await_promise=False)
        cdp.wait_js('songbookTest.allSongbooks().length === 0', timeout=10)
        cdp.wait_js("document.getElementById('emptyState').hidden === false", timeout=10)
        ok('removing the last book empties the app',
           cdp.eval('songbookTest.allSongbooks().length') == 0)
        ok('removing the last book shows the empty state',
           cdp.eval("document.getElementById('emptyState').hidden") is False)
        ok('removing the last book is not fatal',
           cdp.eval("document.getElementById('bootMsg').hidden") is True
           and cdp.eval("document.getElementById('bootMsg').classList.contains('boot-error')") is False)
        ok('removing the last book clears the active book',
           cdp.eval('songbookTest.getActive()') is None)
        ok('removing the last book hides the toolbar',
           cdp.eval("document.getElementById('listControls').hidden") is True)
        ok('removing the last book empties the picker',
           cdp.eval("document.querySelectorAll('#songbookSelect option').length") == 0)

        # The removal is persisted, so a reload is still the empty state.
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        ok('empty state survives reload',
           cdp.eval('songbookTest.allSongbooks().length') == 0
           and cdp.eval("document.getElementById('emptyState').hidden") is False)

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
