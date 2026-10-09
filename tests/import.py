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
    ],
}

IMPORT_JS = """
(function () {
  var inp = document.getElementById('importFile');
  var dt = new DataTransfer();
  dt.items.add(new File([%s], 'test-sb.json', { type: 'application/json' }));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()
""" % json.dumps(json.dumps(SONGBOOK))


def main():
    proc, _ = launch_chrome(PORT)
    results = []
    def ok(name, cond, detail=''):
        results.append((name, bool(cond), detail))

    def run_checks(cdp, phase):
        ids = cdp.eval("ukbTest.allSongbooks().map(s=>s.id).join(',')")
        ok(phase + ': two songbooks', ids == 'krakow-ukulele,test-sb', ids)
        opts = cdp.eval(
            "Array.from(document.querySelectorAll('#songbookSelect option')).map(o=>o.value).join(',')")
        ok(phase + ': picker has imported', opts == 'krakow-ukulele,test-sb', opts)

    try:
        target = new_tab(PORT, BASE + '/index.html?nosw')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.ukbTest && ukbTest.getActive())', timeout=30)

        # import
        cdp.eval(IMPORT_JS, await_promise=False)
        cdp.wait_js("ukbTest.allSongbooks().length === 2", timeout=10)
        cdp.wait_js("location.hash === '#/test-sb'", timeout=10)
        run_checks(cdp, 'after import')
        ok('after import: active is test-sb', cdp.eval('ukbTest.getActive().id') == 'test-sb')
        rows = cdp.eval("document.querySelectorAll('#songList .song-row').length")
        ok('after import: 2 rows', rows == 2, rows)

        # brand logo follows the active songbook
        ok('imported songbook: logo hidden', cdp.eval("document.getElementById('logo').hidden === true"))
        cdp.eval("var s=document.getElementById('songbookSelect'); s.value='krakow-ukulele'; s.dispatchEvent(new Event('change'));")
        cdp.wait_js("ukbTest.getActive().id === 'krakow-ukulele'", timeout=10)
        logo = cdp.eval("({hidden: document.getElementById('logo').hidden, src: document.getElementById('logo').getAttribute('src') || ''})")
        ok('krakow songbook: krakow logo shown',
           logo['hidden'] is False and 'ukulele-krakow-trans' in logo['src'], json.dumps(logo))
        cdp.eval("var s=document.getElementById('songbookSelect'); s.value='test-sb'; s.dispatchEvent(new Event('change'));")
        cdp.wait_js("ukbTest.getActive().id === 'test-sb'", timeout=10)
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

        # persistence across reload
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw#/test-sb'})
        cdp.wait_js('!!(window.ukbTest && ukbTest.allSongbooks().length === 2)', timeout=30)
        run_checks(cdp, 'after reload')
        ok('after reload: active test-sb', cdp.eval('ukbTest.getActive().id') == 'test-sb')

        # removal
        cdp.eval("window.confirm = function(){ return true; };")
        cdp.eval("document.getElementById('removeSongsBtn').click()", await_promise=False)
        cdp.wait_js("ukbTest.allSongbooks().length === 1", timeout=10)
        ok('after remove: one songbook',
           cdp.eval("ukbTest.allSongbooks().map(s=>s.id).join(',')") == 'krakow-ukulele')

        # reload confirms removal persisted
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.ukbTest && ukbTest.getActive())', timeout=30)
        ok('after remove+reload: one songbook',
           cdp.eval("ukbTest.allSongbooks().length") == 1)

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
