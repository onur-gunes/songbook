#!/usr/bin/env python3
"""CDP tests for in-app songbook authoring (Steps 2–4).

Covers creating an editable songbook from the list and first-run empty state,
keyboard focus/validation, persistence across reload, unique ids against
bundled books, the zero-song state, the `chordpro` source round-trip, adding
songs by pasting ChordPro or selecting files, and the per-song/maintenance
actions: edit source, reject invalid source, move up/down, remove with
confirmation, duplicate bundled and authored books, and the empty state.

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/author.py http://localhost:8777
"""
import json
import os
import sys

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures, load_all_fixtures, load_fixture

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9339

GRID_FIXTURE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'fixtures', 'chordpro', 'demo', '01-nie-ma-nas.cho')
with open(GRID_FIXTURE, encoding='utf-8') as fh:
    GRID_SOURCE = fh.read()


def add_files_js(files):
    """Dispatch a multi-file selection on the add-song file input."""
    items = ''.join(
        "dt.items.add(new File([%s], %s, { type: 'text/plain' }));"
        % (json.dumps(content), json.dumps(name))
        for name, content in files)
    return """
(function () {
  var inp = document.getElementById('addSongFile');
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
        ok('zero-song book offers Add song',
           cdp.eval("document.getElementById('emptyAddSongBtn').hidden") is False)
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

        # --- add songs: keyboard, paste preview and persistence -----------
        cdp.eval("window.__alerts = [];"
                 " window.alert = function (m) { window.__alerts.push(String(m)); };")
        ok('imported book offers Add song',
           cdp.eval("document.getElementById('addSongBtn').hidden") is False)
        cdp.eval("(function () { var b = document.getElementById('addSongBtn');"
                 " b.focus(); b.click(); })()")
        cdp.wait_js("document.getElementById('addSongOverlay').hidden === false", timeout=10)
        ok('add dialog focuses the ChordPro textarea',
           cdp.eval("document.activeElement && document.activeElement.id") == 'addSongText',
           cdp.eval("document.activeElement && document.activeElement.id"))
        cdp.send('Input.dispatchKeyEvent', {
            'type': 'keyDown', 'key': 'Escape', 'code': 'Escape',
            'windowsVirtualKeyCode': 27, 'nativeVirtualKeyCode': 27,
        })
        cdp.wait_js("document.getElementById('addSongOverlay').hidden === true", timeout=10)
        ok('Escape closes the add dialog and restores focus',
           cdp.eval("document.activeElement && document.activeElement.id") == 'addSongBtn',
           cdp.eval("document.activeElement && document.activeElement.id"))

        paste = ("{title: Harbour Lights}\n{artist: Me}\n{level: Easy}\n"
                 "{duration: 3}\n{time: 4/4}\n{tempo: 92}\n[C]Hello [G]world")
        cdp.eval("document.getElementById('addSongBtn').click()")
        cdp.wait_js("document.getElementById('addSongOverlay').hidden === false", timeout=10)
        cdp.eval("document.getElementById('addSongText').value = %s;"
                 " document.getElementById('addSongText')"
                 ".dispatchEvent(new Event('input', { bubbles: true }));"
                 % json.dumps(paste))
        cdp.wait_js("document.querySelectorAll('#addSongPreviewList .add-song-item')"
                    ".length === 1", timeout=10)
        paste_meta = cdp.eval(
            "document.querySelector('#addSongPreviewList .add-song-meta').textContent")
        ok('paste preview shows title, artist and metadata',
           cdp.eval("document.querySelector('#addSongPreviewList .add-song-item-title')"
                    ".textContent") == 'Harbour Lights'
           and cdp.eval("document.querySelector('#addSongPreviewList .add-song-item-artist')"
                        ".textContent") == 'Me'
           and '4/4' in paste_meta and '92 bpm' in paste_meta
           and '1 section' in paste_meta,
           paste_meta)

        cdp.eval("document.getElementById('addSongAdd').click()")
        cdp.wait_js("window.__alerts.length === 1", timeout=15)
        cdp.wait_js("document.getElementById('addSongOverlay').hidden === true", timeout=10)
        ok('paste add reports one summary',
           cdp.eval('window.__alerts[0]') == '1 added', cdp.eval('window.__alerts'))
        ok('paste add appends one song',
           cdp.eval('songbookTest.getActive().songs.length') == 1)
        ok('paste add keeps the ChordPro source',
           cdp.eval('songbookTest.getActive().songs[0].chordpro') == paste,
           cdp.eval('songbookTest.getActive().songs[0].chordpro'))
        ok('paste add assigns the next position',
           cdp.eval('songbookTest.getActive().songs[0].n') == 1)

        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=15)
        ok('added song survives reload and navigation',
           cdp.eval('songbookTest.getActive().songs.length') == 1
           and cdp.eval('songbookTest.getActive().songs[0].title') == 'Harbour Lights')
        ok('added song still carries its source after reload',
           cdp.eval('songbookTest.getActive().songs[0].chordpro') == paste)

        # --- malformed input: inline error, book unchanged ----------------
        cdp.eval("window.__alerts = [];"
                 " window.alert = function (m) { window.__alerts.push(String(m)); };")
        cdp.eval("document.getElementById('addSongBtn').click()")
        cdp.wait_js("document.getElementById('addSongOverlay').hidden === false", timeout=10)
        cdp.eval("document.getElementById('addSongText').value = '[C]Just lyrics, no title';"
                 " document.getElementById('addSongText')"
                 ".dispatchEvent(new Event('input', { bubbles: true }));")
        cdp.wait_js("document.querySelectorAll('#addSongPreviewList .add-song-item.is-error')"
                    ".length === 1", timeout=10)
        ok('malformed paste is reported in the preview',
           cdp.eval("document.querySelector('#addSongPreviewList .add-song-item-error')"
                    ".textContent") == 'missing {title}')
        cdp.eval("document.getElementById('addSongAdd').click()")
        cdp.wait_js("document.getElementById('addSongError').hidden === false", timeout=10)
        ok('all-failed submit is announced and adds nothing',
           'missing {title}' in cdp.eval(
               "document.getElementById('addSongError').textContent")
           and cdp.eval('songbookTest.getActive().songs.length') == 1
           and cdp.eval("document.getElementById('addSongOverlay').hidden") is False)

        # --- grid preview counts ------------------------------------------
        cdp.eval("document.getElementById('addSongText').value = %s;"
                 " document.getElementById('addSongText')"
                 ".dispatchEvent(new Event('input', { bubbles: true }));"
                 % json.dumps(GRID_SOURCE))
        cdp.wait_js("document.querySelectorAll('#addSongPreviewList .add-song-item')"
                    ".length === 1", timeout=10)
        grid_meta = cdp.eval(
            "document.querySelector('#addSongPreviewList .add-song-meta').textContent")
        grid_counts = cdp.eval("""
            (function () {
                var song = SB.normalizeSongbook({
                    id: 'preview', name: 'Preview',
                    songs: [SB.parseChordPro(%s).song]
                }).songs[0];
                var blocks = SB.gridBlocksFor(song, null);
                return {
                    sections: blocks.length,
                    bars: blocks.reduce(function (n, b) {
                        return n + (b.bars || []).length;
                    }, 0)
                };
            })()
        """ % json.dumps(GRID_SOURCE))
        ok('grid preview counts match the parsed grid',
           str(grid_counts['sections']) + ' sections' in grid_meta
           and str(grid_counts['bars']) + ' bars' in grid_meta,
           grid_meta)
        ok('grid preview shows the parsed title and artist',
           cdp.eval("document.querySelector('#addSongPreviewList .add-song-item-title')"
                    ".textContent") == 'Nie ma nas'
           and cdp.eval("document.querySelector('#addSongPreviewList .add-song-item-artist')"
                        ".textContent") == 'Patty')
        cdp.eval("document.getElementById('addSongCancel').click()")
        cdp.wait_js("document.getElementById('addSongOverlay').hidden === true", timeout=10)

        # --- multi-file batch: one summary, unique ids --------------------
        cdp.eval("document.getElementById('addSongBtn').click()")
        cdp.wait_js("document.getElementById('addSongOverlay').hidden === false", timeout=10)
        cdp.eval(add_files_js([
            ('one.cho', '{title: Same}\n{level: Easy}\n{time: 4/4}\n[C]One'),
            ('two.cho', '{title: Same}\n{level: Easy}\n{time: 4/4}\n[G]Two'),
            ('empty.txt', '   \n'),
        ]))
        cdp.wait_js("document.querySelectorAll('#addSongPreviewList .add-song-item')"
                    ".length === 3", timeout=10)
        ok('batch preview lists every source and flags the empty one',
           cdp.eval("document.querySelectorAll('#addSongPreviewList .add-song-item.is-error')"
                    ".length") == 1
           and cdp.eval("document.querySelector('#addSongPreviewList .add-song-item-error')"
                        ".textContent") == 'empty file')
        cdp.eval("document.getElementById('addSongAdd').click()")
        cdp.wait_js("window.__alerts.length === 1", timeout=15)
        ok('batch reports one summary',
           cdp.eval('window.__alerts[0]')
           == '2 added, 1 failed: empty.txt — empty file',
           cdp.eval('window.__alerts'))
        cdp.wait_js('songbookTest.getActive().songs.length === 3', timeout=15)
        ids = cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                       " return s.id; })")
        ok('duplicate titles get unique ids', sorted(ids) ==
           ['harbour-lights', 'same', 'same-2'], ids)
        ok('batch continues the book positions',
           cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                    " return s.n; }).join(',')") == '1,2,3',
           cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                    " return s.n; }).join(',')"))
        ok('batch keeps every source',
           cdp.eval("songbookTest.getActive().songs[1].chordpro")
           == '{title: Same}\n{level: Easy}\n{time: 4/4}\n[C]One'
           and cdp.eval("songbookTest.getActive().songs[2].chordpro")
           == '{title: Same}\n{level: Easy}\n{time: 4/4}\n[G]Two')

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
        cdp.eval("location.hash = SB.routeHash(SB.state.bundled[0].id)")
        cdp.wait_js('songbookTest.getActive() && !songbookTest.getActive().imported',
                    timeout=10)
        ok('bundled books hide the Add song action',
           cdp.eval("document.getElementById('addSongBtn').hidden") is True
           and cdp.eval("document.getElementById('emptyAddSongBtn').hidden") is True)
        ok('bundled books hide per-song editing actions',
           cdp.eval("document.querySelectorAll('#songList .row-action').length") == 0)

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

        # --- per-song editing: source, warnings, persistence --------------
        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=10)
        ok('authored rows expose per-song actions',
           cdp.eval("document.querySelectorAll('#songList .song-row.has-actions').length")
           == 3
           and cdp.eval("document.querySelectorAll('#songList [data-action=\"edit\"]')"
                        ".length") == 3)

        edited = ("{title: Harbour Nights}\n{artist: Me}\n{level: Easy}\n"
                  "{duration: 3}\n{time: 4/4}\n{tempo: 92}\n[Am]Hello [F]world")
        cdp.eval("document.querySelector('#songList .song-row[data-id=\"harbour-lights\"]"
                 " [data-action=\"edit\"]').click()")
        cdp.wait_js("document.getElementById('editSourceOverlay').hidden === false", timeout=10)
        ok('edit dialog is prefilled with the stored source',
           cdp.eval("document.getElementById('editSourceText').value") == paste)
        ok('edit dialog focuses the source',
           cdp.eval("document.activeElement && document.activeElement.id") == 'editSourceText',
           cdp.eval("document.activeElement && document.activeElement.id"))
        cdp.eval("document.getElementById('editSourceText').value = %s;"
                 " document.getElementById('editSourceText')"
                 ".dispatchEvent(new Event('input', { bubbles: true }));"
                 % json.dumps(edited))
        cdp.wait_js("document.querySelectorAll('#editSourcePreviewList .add-song-item')"
                    ".length === 1", timeout=10)
        ok('edit preview shows the new title',
           cdp.eval("document.querySelector('#editSourcePreviewList .add-song-item-title')"
                    ".textContent") == 'Harbour Nights')
        cdp.eval("document.getElementById('editSourceSave').click()")
        cdp.wait_js("document.getElementById('editSourceOverlay').hidden === true", timeout=15)
        cdp.wait_js("songbookTest.getActive().songs[0].title === 'Harbour Nights'", timeout=10)
        ok('edit keeps the song id and position',
           cdp.eval("songbookTest.getActive().songs[0].id") == 'harbour-lights'
           and cdp.eval("songbookTest.getActive().songs[0].n") == 1)
        ok('edit renders the new title in the list',
           cdp.eval("document.querySelector('#songList .song-row[data-id=\"harbour-lights\"]"
                    " .row-title').textContent") == 'Harbour Nights')
        edited_json = cdp.eval('SB.songbookJSON(SB.state.active)')
        ok('songbookJSON carries the updated source',
           '"title": "Harbour Nights"' in edited_json
           and '[Am]Hello [F]world' in edited_json)

        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=10)
        ok('edited source survives reload',
           cdp.eval("songbookTest.getActive().songs[0].title") == 'Harbour Nights'
           and cdp.eval("songbookTest.getActive().songs[0].chordpro") == edited)

        # --- invalid edit keeps the previous version ----------------------
        cdp.eval("document.querySelector('#songList .song-row[data-id=\"harbour-lights\"]"
                 " [data-action=\"edit\"]').click()")
        cdp.wait_js("document.getElementById('editSourceOverlay').hidden === false", timeout=10)
        cdp.eval("document.getElementById('editSourceText').value = '[C]no title';"
                 " document.getElementById('editSourceText')"
                 ".dispatchEvent(new Event('input', { bubbles: true }));")
        cdp.wait_js("document.querySelectorAll('#editSourcePreviewList .add-song-item.is-error')"
                    ".length === 1", timeout=10)
        cdp.eval("document.getElementById('editSourceSave').click()")
        cdp.wait_js("document.getElementById('editSourceError').hidden === false", timeout=10)
        ok('invalid edit is rejected without changing the song',
           'missing {title}' in cdp.eval(
               "document.getElementById('editSourceError').textContent")
           and cdp.eval("document.getElementById('editSourceOverlay').hidden") is False
           and cdp.eval("songbookTest.getActive().songs[0].title") == 'Harbour Nights'
           and cdp.eval("songbookTest.getActive().songs[0].chordpro") == edited)
        cdp.eval("document.getElementById('editSourceCancel').click()")
        cdp.wait_js("document.getElementById('editSourceOverlay').hidden === true", timeout=10)

        # --- move up/down renumbers the book ------------------------------
        ok('move buttons disable at the book boundaries',
           cdp.eval("document.querySelector('#songList .song-row[data-id=\"harbour-lights\"]"
                    " [data-action=\"up\"]').disabled") is True
           and cdp.eval("document.querySelector('#songList .song-row[data-id=\"same-2\"]"
                        " [data-action=\"down\"]').disabled") is True)
        cdp.eval("document.querySelector('#songList .song-row[data-id=\"same-2\"]"
                 " [data-action=\"up\"]').click()")
        cdp.wait_js("songbookTest.getActive().songs[1].id === 'same-2'", timeout=15)
        ok('move up swaps book order and renumbers n',
           cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                    " return s.id; }).join(',')") == 'harbour-lights,same-2,same'
           and cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                        " return s.n; }).join(',')") == '1,2,3')
        ok('moved row shows its new position',
           cdp.eval("document.querySelector('#songList .song-row[data-id=\"same-2\"]"
                    " .row-num').textContent") == '2')

        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=10)
        ok('reorder survives reload',
           cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                    " return s.id; }).join(',')") == 'harbour-lights,same-2,same'
           and cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                        " return s.n; }).join(',')") == '1,2,3')

        # --- duplicate a bundled book, then an authored one ---------------
        cdp.eval("location.hash = SB.routeHash(SB.state.bundled[0].id)")
        cdp.wait_js('songbookTest.getActive() && !songbookTest.getActive().imported',
                    timeout=10)
        bundled_json = cdp.eval('JSON.stringify(SB.state.bundled[0].songs)')
        cdp.eval("document.getElementById('duplicateBookBtn').click()")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id"
                    " === 'krakow-ukulele-copy'", timeout=15)
        ok('duplicate creates an editable copy with a new id and name',
           cdp.eval('songbookTest.getActive().imported') is True
           and cdp.eval('songbookTest.getActive().name') == 'Krakow Ukulele (copy)')
        ok('duplicate copies every song and leaves the source untouched',
           cdp.eval('songbookTest.getActive().songs.length') == 15
           and cdp.eval('JSON.stringify(SB.state.bundled[0].songs)') == bundled_json)

        cdp.eval("document.querySelector('#songList .song-row:first-child"
                 " [data-action=\"edit\"]').click()")
        cdp.wait_js("document.getElementById('editSourceOverlay').hidden === false", timeout=10)
        ok('JSON-only songs explain that source editing is unavailable',
           cdp.eval("document.getElementById('editSourceField').hidden") is True
           and cdp.eval("document.getElementById('editSourceUnavailable').hidden") is False
           and 'Grid and Strum editors' in cdp.eval(
               "document.getElementById('editSourceUnavailable').textContent")
           and cdp.eval("document.getElementById('editSourceSave').hidden") is True)
        cdp.eval("document.getElementById('editSourceCancel').click()")
        cdp.wait_js("document.getElementById('editSourceOverlay').hidden === true", timeout=10)

        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=10)
        sources_before = cdp.eval("SB.state.active.songs.map(function (s) {"
                                  " return s.chordpro || ''; })")
        cdp.eval("document.getElementById('duplicateBookBtn').click()")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id"
                    " === 'my-songs-copy'", timeout=15)
        ok('duplicate of an authored book keeps every ChordPro source',
           cdp.eval("SB.state.active.songs.map(function (s) {"
                    " return s.chordpro || ''; })") == sources_before
           and 'Harbour Nights' in cdp.eval(
               "SB.state.active.songs[0].chordpro || ''"))

        # --- remove renumbers and the last removal empties the book -------
        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=10)
        cdp.eval("window.__confirms = [];"
                 " window.confirm = function (m) { window.__confirms.push(String(m));"
                 " return true; };")
        cdp.eval("document.querySelector('#songList .song-row[data-id=\"same\"]"
                 " [data-action=\"remove\"]').click()")
        cdp.wait_js("songbookTest.getActive().songs.length === 2", timeout=15)
        ok('remove confirms before deleting',
           len(cdp.eval('window.__confirms')) == 1
           and 'Same' in cdp.eval('window.__confirms[0]'),
           cdp.eval('window.__confirms'))
        ok('remove deletes the song and renumbers the rest',
           cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                    " return s.id; }).join(',')") == 'harbour-lights,same-2'
           and cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                        " return s.n; }).join(',')") == '1,2')

        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=10)
        ok('remove survives reload',
           cdp.eval("songbookTest.getActive().songs.map(function (s) {"
                    " return s.id; }).join(',')") == 'harbour-lights,same-2')

        cdp.eval("window.__confirms = [];"
                 " window.confirm = function (m) { window.__confirms.push(String(m));"
                 " return true; };")
        cdp.eval("document.querySelector('#songList .song-row[data-id=\"same-2\"]"
                 " [data-action=\"remove\"]').click()")
        cdp.wait_js("songbookTest.getActive().songs.length === 1", timeout=15)
        cdp.eval("document.querySelector('#songList .song-row[data-id=\"harbour-lights\"]"
                 " [data-action=\"remove\"]').click()")
        cdp.wait_js("songbookTest.getActive().songs.length === 0", timeout=15)
        ok('removing the last song leaves a usable empty state',
           cdp.eval("document.getElementById('emptyBookState').hidden") is False
           and cdp.eval("document.getElementById('emptyAddSongBtn').hidden") is False
           and cdp.eval("document.querySelectorAll('#songList .song-row').length") == 0)

        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && document.getElementById("bootMsg").hidden)',
                    timeout=30)
        cdp.eval("location.hash = '#/my-songs-2'")
        cdp.wait_js("songbookTest.getActive() && songbookTest.getActive().id === 'my-songs-2'",
                    timeout=10)
        ok('empty book survives reload',
           cdp.eval('songbookTest.getActive().songs.length') == 0
           and cdp.eval("document.getElementById('emptyBookState').hidden") is False)

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
