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
        ok('Riptide original key shown',
           cdp.eval("document.getElementById('origKey').hidden") is False
           and cdp.eval("document.getElementById('origKeyValue').textContent") == 'C#',
           cdp.eval("document.getElementById('origKeyValue').textContent"))
        ok('Riptide capo shown',
           cdp.eval("document.getElementById('capoPart').hidden") is False
           and cdp.eval("document.getElementById('capoValue').textContent") == 'Capo 1',
           cdp.eval("document.getElementById('capoValue').textContent"))
        cdp.eval("document.getElementById('trUp').click()")
        time.sleep(0.1)
        ok('capo follows transpose (+1 -> no capo)',
           cdp.eval("document.getElementById('capoValue').textContent") == 'No capo',
           cdp.eval("document.getElementById('capoValue').textContent"))
        cdp.eval("document.getElementById('trDown').click()")
        cdp.eval("document.getElementById('trDown').click()")
        time.sleep(0.1)
        ok('capo recovers at -1 (-> Capo 2)',
           cdp.eval("document.getElementById('capoValue').textContent") == 'Capo 2',
           cdp.eval("document.getElementById('capoValue').textContent"))
        cdp.eval("location.hash = '#/krakow-ukulele/budapest'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Budapest'", timeout=10)
        ok('negative capo -> no capo/transpose hint',
           cdp.eval("document.getElementById('capoValue').textContent") == 'No capo · transpose -2',
           cdp.eval("document.getElementById('capoValue').textContent"))
        cdp.eval("location.hash = '#/krakow-ukulele/let-her-go'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Let Her Go'", timeout=10)
        chuck_label = cdp.eval(
            "(document.querySelector('#chordStrip .chord-item.chuck .cname')||{}).textContent")
        ok('NC renders as Chuck in strip', chuck_label == 'Chuck', chuck_label)
        chuck_src = cdp.eval(
            "(document.querySelector('#chordStrip .chord-item.chuck img')||{}).src")
        ok('Chuck diagram is an svg', bool(chuck_src) and chuck_src.startswith('data:image/svg'),
           (chuck_src or '')[:32])
        ok('NC notated as chuck in sheet',
           cdp.eval("Array.from(document.querySelectorAll('#sheet .seg-chord')).some(function(e){return e.textContent.toLowerCase().indexOf('chuck')>=0;})"))
        uke_mutes = cdp.eval(
            "songbookTest.ChordKit.diagramSVG('ukulele', songbookTest.ChordKit.mutedVoicing('ukulele')).split('\\u00d7').length - 1")
        ok('ukulele chuck mutes 4 strings', uke_mutes == 4, uke_mutes)
        gtr_mutes = cdp.eval(
            "songbookTest.ChordKit.diagramSVG('guitar', songbookTest.ChordKit.mutedVoicing('guitar')).split('\\u00d7').length - 1")
        ok('guitar chuck mutes 6 strings', gtr_mutes == 6, gtr_mutes)
        cdp.eval("location.hash = '#/polska-gurom/czerwone-korale'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Czerwone Korale'", timeout=10)
        ok('no key -> section hidden', cdp.eval("document.getElementById('origKey').hidden") is True)
        cdp.eval("location.hash = '#/krakow-ukulele/riptide'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Riptide'", timeout=10)
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
