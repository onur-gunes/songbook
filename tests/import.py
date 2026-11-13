#!/usr/bin/env python3
"""CDP test for the imported-songbook (IndexedDB) flow.

Usage:
    python3 -m http.server 8777 &
    python3 tests/import.py http://localhost:8777
"""
import json
import sys
import time

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9334

SONGBOOK = {
    "id": "test-sb",
    "name": "Test Songbook",
    "description": "imported in a test",
    "instrument": "ukulele",
    "songs": [
        {
            "id": "t1",
            "title": "Test Song",
            "artist": "Tester",
            "level": "Easy",
            "new": True,
            "chords": ["C", "G", "Am", "F"],
            "sheet": [
                [["c", "[C]"], ["x", " hello "], ["c", "[G]"], ["x", " world"]],
                [["c", "[Am]"], ["x", " a minor "], ["c", "[F]"], ["x", " chord"]],
            ],
        },
        {
            "id": "t2",
            "title": "Second Song",
            "artist": "Tester",
            "level": "Hard",
            "chords": ["C", "E7"],
            "sheet": [[["c", "[C]"], ["x", " one "], ["c", "[E7]"], ["x", " two"]]],
        },
        {
            "id": "bad-sheet-1",
            "title": "Bad Sheet String",
            "artist": "Tester",
            "sheet": "not an array",
        },
        {
            "id": "bad-sheet-2",
            "title": "Bad Sheet Entries",
            "artist": "Tester",
            "sheet": [None, [[None]], [[1, 2]], [["c", "[C]"], ["x", "ok"]]],
        },
        {
            "id": "100%",
            "title": "Percent Song",
            "artist": "Tester",
            "sheet": [[["c", "[C]"], ["x", " percent"]]],
        },
    ],
}

def make_book(book_id, name, song_ids):
    return {
        "id": book_id,
        "name": name,
        "songs": [
            {
                "id": song_id,
                "title": "Song " + song_id,
                "artist": "Tester",
                "sheet": [[["c", "[C]"], ["x", " " + song_id]]],
            }
            for song_id in song_ids
        ],
    }


MULTI_ONE = make_book("multi-one", "Multi One", ["m1", "m2"])
MULTI_TWO = make_book("multi-two", "Multi Two", ["m3"])
MULTI_ONE_V2 = make_book("multi-one", "Multi One v2", ["m1"])
BUNDLED_HIJACK = make_book("krakow-ukulele", "Hijacked Krakow", ["hijack"])


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


IMPORT_JS = import_files_js([('test-sb.json', json.dumps(SONGBOOK))])


def main():
    proc, _ = launch_chrome(PORT)
    results = []
    def ok(name, cond, detail=''):
        results.append((name, bool(cond), detail))

    def run_checks(cdp, phase, expected_ids):
        ids = cdp.eval("songbookTest.allSongbooks().map(s=>s.id).join(',')")
        ok(phase + ': imported appended to bundled', ids == expected_ids, ids)
        opts = cdp.eval(
            "Array.from(document.querySelectorAll('#songbookSelect option')).map(o=>o.value).join(',')")
        ok(phase + ': picker has imported', opts == expected_ids, opts)

    try:
        target = new_tab(PORT, 'about:blank')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        # Inject the test fixtures as bundled content before the app loads, so
        # the import flow runs against known original content instead of the
        # removed bundled books.
        inject_fixtures(cdp)
        # Imports report one summary alert per batch. Capture it instead of
        # letting a real (blocking) dialog stall every reload.
        cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            'source': 'window.__alerts = [];'
                      'window.alert = function (m) { window.__alerts.push(String(m)); };'
        })
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.getActive())', timeout=30)

        bundled_ids = cdp.eval("songbookTest.allSongbooks().map(s=>s.id).join(',')")
        bundled_count = cdp.eval("songbookTest.allSongbooks().length")
        ok('bundled songbooks include krakow and polska',
           'krakow-ukulele' in bundled_ids and 'polska-gurom' in bundled_ids, bundled_ids)
        expected_after_import = bundled_ids + ',test-sb'
        expected_after_import_count = bundled_count + 1

        # import
        cdp.eval(IMPORT_JS, await_promise=False)
        cdp.wait_js("songbookTest.allSongbooks().length === %d" % expected_after_import_count, timeout=10)
        cdp.wait_js("location.hash === '#/test-sb'", timeout=10)
        run_checks(cdp, 'after import', expected_after_import)
        ok('after import: active is test-sb', cdp.eval('songbookTest.getActive().id') == 'test-sb')
        rows = cdp.eval("document.querySelectorAll('#songList .song-row').length")
        ok('after import: 5 rows', rows == 5, rows)

        # brand logo follows the active songbook
        ok('imported songbook: logo hidden', cdp.eval("document.getElementById('logo').hidden === true"))
        cdp.eval("var s=document.getElementById('songbookSelect'); s.value='krakow-ukulele'; s.dispatchEvent(new Event('change'));")
        cdp.wait_js("songbookTest.getActive().id === 'krakow-ukulele'", timeout=10)
        logo = cdp.eval("({hidden: document.getElementById('logo').hidden, src: document.getElementById('logo').getAttribute('src') || ''})")
        ok('krakow songbook: krakow logo shown',
           logo['hidden'] is False and 'ukulele-krakow-trans' in logo['src'], json.dumps(logo))
        cdp.eval("var s=document.getElementById('songbookSelect'); s.value='test-sb'; s.dispatchEvent(new Event('change'));")
        cdp.wait_js("songbookTest.getActive().id === 'test-sb'", timeout=10)
        ok('switch back: logo hidden again', cdp.eval("document.getElementById('logo').hidden === true"))

        # open imported song and check sheet/chords render
        cdp.eval("location.hash = '#/test-sb/t1'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        ok('imported song title', cdp.eval("document.getElementById('songTitle').textContent") == 'Test Song')
        names = cdp.eval(
            "Array.from(document.querySelectorAll('#chordStrip .cname')).map(e=>e.textContent).join(',')")
        ok('imported song chords', names == 'C,G,Am,F', names)
        text = cdp.eval("document.querySelector('.sheet').textContent")
        ok('imported sheet text', 'hello' in text and 'world' in text and 'a minor' in text, text[:60])

        # malformed sheet shapes are normalised instead of crashing the view
        cdp.eval("location.hash = '#/test-sb/bad-sheet-1'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        ok('malformed sheet string opens',
           cdp.eval("document.getElementById('songTitle').textContent") == 'Bad Sheet String')
        ok('malformed sheet string renders empty',
           cdp.eval("document.querySelector('.sheet').textContent.trim()") == '')

        cdp.eval("location.hash = '#/test-sb/bad-sheet-2'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        bad_text = cdp.eval("document.querySelector('.sheet').textContent")
        ok('malformed sheet entries are dropped', 'ok' in bad_text, repr(bad_text))
        ok('valid line survives malformed siblings',
           cdp.eval("document.querySelectorAll('.sheet .line').length") >= 1)

        # ids with characters that need URL-encoding must still route
        cdp.eval("location.hash = SB.routeHash('test-sb', '100%')")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        ok('percent id routes to its song',
           cdp.eval("document.getElementById('songTitle').textContent") == 'Percent Song')
        ok('percent id hash is encoded', '%25' in cdp.eval("location.hash"),
           cdp.eval("location.hash"))

        # a hand-edited, malformed hash must not throw or blank the app
        cdp.eval("location.hash = '#/%'")
        time.sleep(0.2)
        ok('malformed hash falls back to the list',
           cdp.eval("document.getElementById('listView').hidden === false"))

        # the list's own link must encode the id too
        cdp.eval("location.hash = '#/test-sb'")
        cdp.wait_js("document.getElementById('listView').hidden === false", timeout=10)
        href = cdp.eval(
            "document.querySelector('#songList .song-row[data-id=\"100%\"] a.song-link').getAttribute('href')")
        ok('list link encodes the song id', href == '#/test-sb/100%25', href)

        # persistence across reload
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw#/test-sb'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.allSongbooks().length === %d)'
                    % expected_after_import_count, timeout=30)
        run_checks(cdp, 'after reload', expected_after_import)
        ok('after reload: active test-sb', cdp.eval('songbookTest.getActive().id') == 'test-sb')

        # removal (Remove is an edit-mode action)
        cdp.eval("document.getElementById('editBookBtn').click()")
        cdp.wait_js("document.getElementById('removeSongsBtn').hidden === false", timeout=10)
        cdp.eval("window.confirm = function(){ return true; };")
        cdp.eval("document.getElementById('removeSongsBtn').click()", await_promise=False)
        cdp.wait_js("songbookTest.allSongbooks().length === %d" % bundled_count, timeout=10)
        ok('after remove: import gone, bundled kept',
           cdp.eval("songbookTest.allSongbooks().map(s=>s.id).join(',')") == bundled_ids)

        # reload confirms removal persisted
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.getActive())', timeout=30)
        ok('after remove+reload: import does not return',
           cdp.eval("songbookTest.allSongbooks().length") == bundled_count)

        # An exported songbook is a valid import. The bundled ids still exist
        # in this profile, so the copy gets a fresh id; its contents, including
        # the beat grid, must survive the export -> import round-trip.
        cdp.eval("location.hash = '#/popular/stand-by-me'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        cdp.eval("document.querySelector('.chord-mode-btn[data-chord-mode=\"grid\"]').click()")
        cdp.wait_js('!!songbookTest.gridInfo()', timeout=10)
        original_beats = cdp.eval('songbookTest.gridInfo().totalBeats')

        # Phase 1 invariant: normalizeSongbook(JSON.parse(export(sb))) must
        # deep-equal sb minus the storage-only `imported` flag. This is the
        # strongest form of the round-trip; the import below then proves the
        # file path accepts it too.
        ok('export -> normalize round-trip is deep-equal',
           cdp.eval(
               "(function () {"
               "  var sb = songbookTest.allSongbooks().filter(function (b) { return b.id === 'popular'; })[0];"
               "  var round = songbookTest.normalizeSongbook("
               "      JSON.parse(songbookTest.songbookJSON(sb)));"
               "  var expected = JSON.parse(JSON.stringify(sb));"
               "  delete expected.imported;"
               "  return JSON.stringify(round) === JSON.stringify(expected);"
               "})()"))

        exported = cdp.eval(
            "(function () {"
            "  var sb = songbookTest.allSongbooks().filter(function (b) { return b.id === 'popular'; })[0];"
            "  var copy = JSON.parse(songbookTest.songbookJSON(sb));"
            "  copy.id = 'popular-copy';"
            "  copy.name = 'Popular Copy';"
            "  return JSON.stringify(copy);"
            "})()")
        import_copy_js = """
        (function () {
          var inp = document.getElementById('importFile');
          var dt = new DataTransfer();
          dt.items.add(new File([%s], 'popular.json', { type: 'application/json' }));
          inp.files = dt.files;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
        """ % json.dumps(exported)
        cdp.eval(import_copy_js, await_promise=False)
        cdp.wait_js("songbookTest.getActive().id === 'popular-copy'", timeout=10)
        ok('exported book imports with all its songs',
           cdp.eval('songbookTest.getActive().songs.length') == 3,
           cdp.eval('songbookTest.getActive().songs.length'))
        ok('export button visible for imported songbook',
           cdp.eval("document.getElementById('exportSongsBtn').hidden") is False)

        cdp.eval("location.hash = '#/popular-copy/stand-by-me'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        cdp.eval("document.querySelector('.chord-mode-btn[data-chord-mode=\"grid\"]').click()")
        cdp.wait_js('!!songbookTest.gridInfo()', timeout=10)
        ok('exported book keeps its grid',
           cdp.eval('songbookTest.gridInfo().totalBeats') == original_beats,
           '%s vs original %s' % (cdp.eval('songbookTest.gridInfo().totalBeats'), original_beats))

        # --- Phase 3: import hardening -----------------------------------
        ok('import input accepts multiple files',
           cdp.eval("document.getElementById('importFile').multiple === true"))
        # One summary for the batch, and a malformed file must not abort the
        # files after it.
        cdp.eval("window.__alerts = [];")
        cdp.eval(import_files_js([
            ('multi-one.json', json.dumps(MULTI_ONE)),
            ('broken.json', '{"id": "broken",'),
            ('multi-two.json', json.dumps(MULTI_TWO)),
        ]), await_promise=False)
        cdp.wait_js("songbookTest.allSongbooks().length === %d" % (bundled_count + 3),
                    timeout=15)
        alerts = cdp.eval('window.__alerts')
        ok('batch import: one summary alert', len(alerts) == 1, alerts)
        summary = alerts[0] if alerts else ''
        ok('batch import: summary counts',
           summary.startswith('2 imported, 1 failed:'), summary)
        ok('batch import: names the failed file and reason',
           'broken.json' in summary and ' — ' in summary and 'not valid JSON' in summary,
           summary)
        ids = cdp.eval("songbookTest.allSongbooks().map(s=>s.id).join(',')")
        ok('batch import: valid files on both sides of the failure imported',
           'multi-one' in ids and 'multi-two' in ids, ids)
        ok('batch import: last successful file is active',
           cdp.eval('songbookTest.getActive().id') == 'multi-two')

        # Re-importing the same id replaces the user's own copy in place.
        cdp.eval("window.__alerts = []; window.__confirms = [];"
                 "window.confirm = function (m) { window.__confirms.push(m); return true; };")
        cdp.eval(import_files_js([('multi-one-v2.json', json.dumps(MULTI_ONE_V2))]),
                 await_promise=False)
        cdp.wait_js("songbookTest.getActive().id === 'multi-one'"
                    " && songbookTest.getActive().name === 'Multi One v2'", timeout=15)
        ok('replace import: prompted once for the imported id',
           len(cdp.eval('window.__confirms')) == 1, cdp.eval('window.__confirms'))
        ok('replace import: no duplicate entry',
           cdp.eval('songbookTest.allSongbooks().length') == bundled_count + 3,
           cdp.eval('songbookTest.allSongbooks().length'))
        ok('replace import: in-memory entry swapped',
           cdp.eval("SB.state.imported.filter(function (b) {"
                    " return b.id === 'multi-one'; }).length") == 1
           and cdp.eval('songbookTest.getActive().songs.length') == 1,
           cdp.eval('songbookTest.getActive().songs.length'))
        ok('replace import: summary reports it as imported',
           cdp.eval('window.__alerts[0]') == '1 imported', cdp.eval('window.__alerts'))

        # A bundled id is not the user's to overwrite, even if a stale
        # confirm handler would say yes.
        bundled_name = cdp.eval(
            "SB.state.bundled.filter(function (b) { return b.id === 'krakow-ukulele'; })[0].name")
        cdp.eval("window.__alerts = []; window.__confirms = [];"
                 "window.confirm = function (m) { window.__confirms.push(m); return true; };")
        cdp.eval(import_files_js([('krakow.json', json.dumps(BUNDLED_HIJACK))]),
                 await_promise=False)
        cdp.wait_js('window.__alerts.length === 1', timeout=15)
        ok('bundled reject: no replace prompt', cdp.eval('window.__confirms.length') == 0,
           cdp.eval('window.__confirms'))
        alerts = cdp.eval('window.__alerts')
        ok('bundled reject: summary reports the failure',
           bool(alerts) and alerts[0].startswith('0 imported, 1 failed: krakow.json'),
           alerts)
        ok('bundled reject: bundled book untouched',
           cdp.eval("SB.state.bundled.filter(function (b) {"
                    " return b.id === 'krakow-ukulele'; })[0].name") == bundled_name)
        ok('bundled reject: nothing appended',
           cdp.eval('songbookTest.allSongbooks().length') == bundled_count + 3,
           cdp.eval('songbookTest.allSongbooks().length'))

        # The replace persisted, and the rejected overwrite did not.
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.allSongbooks().length === %d)'
                    % (bundled_count + 3), timeout=30)
        ok('replace persists after reload',
           cdp.eval("SB.state.imported.filter(function (b) {"
                    " return b.id === 'multi-one'; })[0].name") == 'Multi One v2')
        ok('bundled reject persists after reload',
           cdp.eval("SB.state.bundled.filter(function (b) {"
                    " return b.id === 'krakow-ukulele'; })[0].name") == bundled_name)

        # --- Phase 4: import from URL ------------------------------------
        # The URL form is secondary to the file picker and lives in the same
        # import area; opening it must not trigger a native file dialog.
        ok('URL form starts hidden',
           cdp.eval("document.getElementById('importUrlForm').hidden") is True)
        ok('URL import control is visible next to file import',
           cdp.eval("document.getElementById('importUrlToggle').offsetParent !== null")
           and cdp.eval("document.getElementById('importBtn').offsetParent !== null"))
        cdp.eval("document.getElementById('importUrlToggle').click()")
        ok('URL control reveals the text input',
           cdp.eval("document.getElementById('importUrlForm').hidden") is False
           and cdp.eval("document.getElementById('importUrl').offsetParent !== null"))

        url = BASE + '/tests/fixtures/url-book.json'
        cdp.eval("document.getElementById('importUrl').value = %s;"
                 " document.getElementById('importUrlForm').requestSubmit();" % json.dumps(url),
                 await_promise=False)
        cdp.wait_js("songbookTest.getActive() &&"
                    " songbookTest.getActive().id === 'url-book'", timeout=15)
        ok('URL import adds the fetched songbook',
           cdp.eval('songbookTest.getActive().name') == 'URL Book')
        ok('URL import remembers its source URL',
           cdp.eval('songbookTest.getActive().sourceUrl') == url,
           cdp.eval('songbookTest.getActive().sourceUrl'))
        ok('URL import closes and clears the form',
           cdp.eval("document.getElementById('importUrlForm').hidden") is True
           and cdp.eval("document.getElementById('importUrl').value") == '')
        ok('URL import exposes Refresh',
           cdp.eval("document.getElementById('refreshSongsBtn').hidden") is False)
        cdp.wait_js("document.querySelectorAll('#songList .song-row').length === 1", timeout=10)
        ok('URL import renders its songs',
           cdp.eval("document.querySelectorAll('#songList .song-row').length") == 1
           and cdp.eval("document.querySelector('#songList .row-title').textContent")
           == 'Fetched Song')

        # Each failure mode reports what happened instead of "Failed to fetch".
        def url_error(target):
            return cdp.eval(
                "SB.importSongbookFromUrl(%s).then(function () { return 'unexpected success'; },"
                " function (e) { return e.message; })" % json.dumps(target))

        non_json = url_error(BASE + '/index.html')
        ok('URL import: non-JSON is named', 'not valid JSON' in non_json, non_json)
        missing = url_error(BASE + '/definitely-missing-94.json')
        ok('URL import: 404 is named', '404' in missing, missing)
        no_url = url_error('')
        ok('URL import: empty URL is rejected', no_url == 'enter a URL', no_url)
        cors = url_error('http://127.0.0.1:1/url-book.json')
        ok('URL import: CORS/network failure names the header',
           'CORS' in cors and 'Access-Control-Allow-Origin' in cors, cors)

        # sourceUrl is bookkeeping, not songbook content, so it must survive
        # the normalise-on-boot path as well as the IndexedDB write.
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw#/url-book'})
        cdp.wait_js("!!(window.songbookTest && songbookTest.getActive()"
                    " && songbookTest.getActive().id === 'url-book')", timeout=30)
        ok('URL source survives reload',
           cdp.eval('songbookTest.getActive().sourceUrl') == url,
           cdp.eval('songbookTest.getActive().sourceUrl'))
        ok('Refresh reappears after reload',
           cdp.eval("document.getElementById('refreshSongsBtn').hidden") is False)

        refreshed = {
            "id": "url-book",
            "name": "URL Book v2",
            "songs": [{
                "id": "u1",
                "title": "Refreshed Song",
                "artist": "Tester",
                "sheet": [[["c", "[C]"], ["x", " refreshed"]]],
            }],
        }
        cdp.eval("window.__realFetch = window.fetch;"
                 " window.__confirms = [];"
                 " window.confirm = function (m) { window.__confirms.push(m); return true; };"
                 " window.fetch = function () {"
                 "   return Promise.resolve(new Response(%s, { status: 200,"
                 "     headers: { 'Content-Type': 'application/json' } }));"
                 " };" % json.dumps(json.dumps(refreshed)))
        cdp.eval("document.getElementById('refreshSongsBtn').click()", await_promise=False)
        cdp.wait_js("songbookTest.getActive().name === 'URL Book v2'", timeout=15)
        ok('Refresh replaces the stored book',
           cdp.eval('songbookTest.getActive().songs[0].title') == 'Refreshed Song',
           cdp.eval('songbookTest.getActive().songs[0].title'))
        ok('Refresh keeps the source URL',
           cdp.eval('songbookTest.getActive().sourceUrl') == url)
        ok('Refresh does not ask to replace',
           cdp.eval('window.__confirms.length') == 0, cdp.eval('window.__confirms'))
        ok('Refresh does not duplicate the entry',
           cdp.eval('songbookTest.allSongbooks().length') == bundled_count + 4,
           cdp.eval('songbookTest.allSongbooks().length'))

        # A failed refresh must leave the working copy in place.
        cdp.eval("window.__alerts = [];"
                 " window.fetch = function () {"
                 "   return Promise.resolve(new Response('<html>not json</html>',"
                 "     { status: 200 }));"
                 " };")
        cdp.eval("document.getElementById('refreshSongsBtn').click()", await_promise=False)
        cdp.wait_js('window.__alerts.length === 1', timeout=15)
        refresh_alert = cdp.eval('window.__alerts[0]')
        ok('failed Refresh reports the reason',
           refresh_alert.startswith('Refresh failed:') and 'not valid JSON' in refresh_alert,
           refresh_alert)
        ok('failed Refresh keeps the old copy',
           cdp.eval('songbookTest.getActive().name') == 'URL Book v2'
           and cdp.eval('songbookTest.getActive().sourceUrl') == url)
        cdp.eval("window.fetch = window.__realFetch;")

        # --- #85: a malformed grid is dropped, but not silently ----------
        cdp.eval(
            "window.__warnings = []; window.__realWarn = console.warn;"
            "console.warn = function () {"
            "  window.__warnings.push(Array.prototype.join.call(arguments, ' '));"
            "  window.__realWarn.apply(console, arguments);"
            "};")
        dropped = cdp.eval(
            "(function () {"
            "  var book = songbookTest.normalizeSongbook({id: 'bad-grid-book', name: 'Bad',"
            "    songs: [{id: 'bad-grid-song', title: 'Bad Grid', time: '4/4',"
            "      sheet: [[['c', '[C]'], ['x', 'x']]],"
            "      grid: [{label: 'Verse', bars: [{beats: [{chord: 'C', beats: 3}]}]}]}]});"
            "  return book.songs[0].grid === undefined;"
            "})()")
        grid_warnings = cdp.eval("window.__warnings.slice()")
        cdp.eval("console.warn = window.__realWarn;")
        ok('malformed grid is dropped with an explanatory warning',
           dropped and any('bad-grid-song' in w and 'grid dropped' in w for w in grid_warnings),
           grid_warnings)

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
