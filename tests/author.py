#!/usr/bin/env python3
"""CDP tests for in-app songbook authoring (Step 2).

Covers creating an editable songbook from the list and first-run empty state,
keyboard focus/validation, persistence across reload, unique ids against
bundled books, the zero-song state, and the `chordpro` source round-trip.

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/author.py http://localhost:8777
"""
import json
import sys

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures, load_all_fixtures, load_fixture

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9339


def main():
    proc, _ = launch_chrome(PORT)
    results = []

    def ok(name, cond, detail=''):
        results.append((name, bool(cond), detail))

    try:
        target = new_tab(PORT, 'about:blank')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()

        # --- first run: create from the zero-books empty state -------------
        inject_fixtures(cdp, books=[])
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)

        ok('empty state offers create',
           cdp.eval("document.getElementById('emptyNewSongbookBtn').offsetParent !== null"))
        cdp.eval("(function () { var b = document.getElementById('emptyNewSongbookBtn');"
                 " b.focus(); b.click(); })()")
        cdp.wait_js("document.getElementById('newBookOverlay').hidden === false", timeout=10)
        ok('create dialog opens', cdp.eval("document.getElementById('newBookOverlay').hidden") is False)
        ok('name field is focused',
           cdp.eval("document.activeElement && document.activeElement.id") == 'newBookName',
           cdp.eval("document.activeElement && document.activeElement.id"))

        # Empty name is rejected in place, without creating anything.
        cdp.eval("document.getElementById('newBookCreate').click()")
        cdp.wait_js("document.getElementById('newBookError').hidden === false", timeout=10)
        ok('empty name is rejected',
           cdp.eval("document.getElementById('newBookError').textContent").strip() != '')
        ok('error is announced and focus returns to the field',
           cdp.eval("document.getElementById('newBookError').getAttribute('role')") == 'alert'
           and cdp.eval("document.activeElement.id") == 'newBookName',
           cdp.eval("document.activeElement.id"))
        ok('rejected create adds no book',
           cdp.eval('songbookTest.allSongbooks().length') == 0)

        # Escape closes and returns focus to the opener.
        cdp.send('Input.dispatchKeyEvent', {
            'type': 'keyDown', 'key': 'Escape', 'code': 'Escape',
            'windowsVirtualKeyCode': 27, 'nativeVirtualKeyCode': 27,
        })
        cdp.wait_js("document.getElementById('newBookOverlay').hidden === true", timeout=10)
        ok('Escape closes the dialog',
           cdp.eval("document.getElementById('newBookOverlay').hidden") is True)
        ok('Escape restores focus to the opener',
           cdp.eval("document.activeElement && document.activeElement.id") == 'emptyNewSongbookBtn',
           cdp.eval("document.activeElement && document.activeElement.id"))

        # Create a book and check the zero-song state.
        cdp.eval("document.getElementById('emptyNewSongbookBtn').click()")
        cdp.wait_js("document.getElementById('newBookOverlay').hidden === false", timeout=10)
        cdp.eval("""
            document.getElementById('newBookName').value = 'My Songs';
            document.getElementById('newBookDescription').value = 'Songs I wrote';
            document.getElementById('newBookInstrument').value = 'guitar';
            document.getElementById('newBookCreate').click();
        """)
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs'",
                    timeout=15)
        ok('create adds an imported book',
           cdp.eval('songbookTest.allSongbooks().length') == 1
           and cdp.eval('songbookTest.getActive().imported') is True)
        ok('create stores name, description and instrument',
           cdp.eval('songbookTest.getActive().name') == 'My Songs'
           and cdp.eval('songbookTest.getActive().description') == 'Songs I wrote'
           and cdp.eval('songbookTest.getActive().instrument') == 'guitar')
        ok('create activates the book and updates the URL',
           cdp.eval('location.hash') == '#/my-songs',
           cdp.eval('location.hash'))
        ok('dialog closes after create',
           cdp.eval("document.getElementById('newBookOverlay').hidden") is True)
        ok('zero-song book shows its empty state',
           cdp.eval("document.getElementById('emptyBookState').hidden") is False)
        ok('zero-song book hides the song toolbar',
           cdp.eval("document.getElementById('listControls').hidden") is True)
        ok('zero-song book has no rows',
           cdp.eval("document.querySelectorAll('#songList .song-row').length") == 0)
        ok('picker lists the new book',
           cdp.eval("document.querySelectorAll('#songbookSelect option').length") == 1)

        # --- persistence across reload ------------------------------------
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        ok('created book survives reload',
           cdp.eval('songbookTest.allSongbooks().length') == 1
           and cdp.eval('songbookTest.getActive().id') == 'my-songs')
        ok('zero-song state survives reload',
           cdp.eval("document.getElementById('emptyBookState').hidden") is False)

        # --- duplicate names get unique ids -------------------------------
        cdp.eval("document.getElementById('newSongbookBtn').click()")
        cdp.wait_js("document.getElementById('newBookOverlay').hidden === false", timeout=10)
        cdp.eval("document.getElementById('newBookName').value = 'My Songs';"
                 " document.getElementById('newBookCreate').click();")
        cdp.wait_js('songbookTest.allSongbooks().length === 2', timeout=15)
        ids = cdp.eval('songbookTest.allSongbooks().map(function (b) { return b.id; })')
        ok('duplicate name gets a unique id',
           sorted(ids) == ['my-songs', 'my-songs-2'], ids)

        # --- chordpro source round-trip -----------------------------------
        round_trip = cdp.eval("""
            (function () {
                var source = '{title: S1}\\n[C]x';
                var raw = { id: 'rt', name: 'RT', songs: [
                    { id: 's1', title: 'S1', chordpro: source }
                ] };
                var sb = SB.normalizeSongbook(raw);
                var json = SB.songbookJSON(sb);
                var again = SB.normalizeSongbook(JSON.parse(json));
                var effective = SB.effectiveSongbook(sb);
                var blank = SB.normalizeSongbook({ id: 'b', name: 'B', songs: [
                    { id: 's', title: 'S', chordpro: '   ' }
                ] });
                return {
                    normalized: sb.songs[0].chordpro,
                    reimported: again.songs[0].chordpro,
                    exported: effective.songs[0].chordpro,
                    inJson: json.indexOf('"chordpro"') >= 0,
                    blankOmitted: !('chordpro' in blank.songs[0])
                };
            })()
        """)
        ok('chordpro survives normalizeSongbook',
           round_trip['normalized'] == '{title: S1}\n[C]x', round_trip)
        ok('chordpro survives songbookJSON re-import',
           round_trip['reimported'] == '{title: S1}\n[C]x', round_trip)
        ok('chordpro survives effective export',
           round_trip['exported'] == '{title: S1}\n[C]x', round_trip)
        ok('chordpro is present in exported JSON', round_trip['inJson'], round_trip)
        ok('blank chordpro is omitted', round_trip['blankOmitted'], round_trip)

        # --- list-view create + bundled books stay read-only --------------
        inject_fixtures(cdp, books=load_all_fixtures())
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        bundled_before = cdp.eval(
            "SB.state.bundled.map(function (b) {"
            " return b.id + ':' + b.songs.length; }).join(',')")
        ok('fixtures load as bundled books',
           cdp.eval('SB.state.bundled.length') == len(load_all_fixtures()),
           cdp.eval('SB.state.bundled.length'))

        cdp.eval("document.getElementById('newSongbookBtn').click()")
        cdp.wait_js("document.getElementById('newBookOverlay').hidden === false", timeout=10)
        # A bundled id must never be reused, even when the name slug matches.
        cdp.eval("document.getElementById('newBookName').value = 'Test Book';"
                 " document.getElementById('newBookCreate').click();")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().name === 'Test Book'",
                    timeout=15)
        ok('create avoids a bundled id',
           cdp.eval('songbookTest.getActive().id') == 'test-book-2',
           cdp.eval('songbookTest.getActive().id'))
        bundled_after = cdp.eval(
            "SB.state.bundled.map(function (b) {"
            " return b.id + ':' + b.songs.length; }).join(',')")
        ok('creating a book leaves bundled books untouched',
           bundled_after == bundled_before, bundled_after)
        ok('bundled books stay read-only',
           cdp.eval('SB.state.bundled.every(function (b) { return !b.imported; })') is True)

        n_fail = 0
        for name, passed, detail in results:
            print(('PASS ' if passed else 'FAIL ') + name
                  + (' | ' + str(detail) if detail != '' else ''))
            n_fail += 0 if passed else 1
        print('\n%d/%d passed' % (len(results) - n_fail, len(results)))
        cdp.close()
        return 1 if n_fail else 0
    finally:
        proc.terminate()


if __name__ == '__main__':
    sys.exit(main())
