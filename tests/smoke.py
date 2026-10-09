#!/usr/bin/env python3
"""Quick CDP smoke test for the rewritten Songbook app.

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/smoke.py http://localhost:8777
"""
import sys
import time

from cdp import launch_chrome, new_tab, CDP

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9333


def main():
    proc, _ = launch_chrome(PORT)
    try:
        target = new_tab(PORT, BASE + '/index.html?nosw')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.getActive())', timeout=30)

        results = []
        def ok(name, cond, detail=''):
            results.append((name, bool(cond), detail))

        n_songs = cdp.eval('songbookTest.getActive().songs.length')
        rows = cdp.eval("document.querySelectorAll('#songList .song-row').length")
        ok('active songbook songs=198', n_songs == 198, n_songs)
        ok('rendered rows=198', rows == 198, rows)
        ok('default instrument ukulele', cdp.eval('songbookTest.getInstrument()') == 'ukulele')

        # open a song
        cdp.eval("location.hash = '#/krakow-ukulele/riptide'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        cdp.wait_js("document.querySelectorAll('#chordStrip .chord-item').length > 0", timeout=10)
        ok('song title Riptide',
           cdp.eval("document.getElementById('songTitle').textContent") == 'Riptide')
        names = cdp.eval(
            "Array.from(document.querySelectorAll('#chordStrip .cname')).map(e=>e.textContent).join(',')")
        ok('Riptide strip chords', names == 'Am,G,C,F', names)
        uke_svg = cdp.eval(
            "songbookTest.ChordKit.diagramSVG('ukulele', songbookTest.ChordKit.voicings('Am','ukulele')[0])")
        ok('ukulele Am svg has 4 strings', uke_svg.count('class="st"') == 4, uke_svg.count('class="st"'))

        # switch instrument globally
        cdp.eval("songbookTest.setInstrument('guitar')")
        time.sleep(0.3)
        ok('instrument now guitar', cdp.eval('songbookTest.getInstrument()') == 'guitar')
        g_svg = cdp.eval(
            "songbookTest.ChordKit.diagramSVG('guitar', songbookTest.ChordKit.voicings('Am','guitar')[0])")
        ok('guitar Am svg has 6 strings', g_svg.count('class="st"') == 6, g_svg.count('class="st"'))
        # diagrams re-rendered
        first_src = cdp.eval("document.querySelector('#chordStrip img').src.slice(0,40)")
        ok('strip diagram re-rendered', 'data:image/svg' in first_src, first_src)
        cdp.eval("songbookTest.setInstrument('ukulele')")

        # back to list
        cdp.eval("location.hash = ''")
        cdp.wait_js("document.getElementById('listView').hidden === false", timeout=10)
        ok('back to list shows 198', cdp.eval("document.querySelectorAll('#songList .song-row').length") == 198)

        # 404 route falls back to list
        cdp.eval("location.hash = '#/nope/nope'")
        time.sleep(0.3)
        ok('bad route -> list view',
           cdp.eval("document.getElementById('listView').hidden") is False)

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
