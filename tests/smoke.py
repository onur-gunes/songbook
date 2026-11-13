#!/usr/bin/env python3
"""Quick CDP smoke test for the rewritten Songbook app.

Fixtures (tests/fixtures/books/) are injected as ``window.__SONGBOOKS__`` via
CDP before navigation, so the suite runs against known original content instead
of the removed bundled books.

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/smoke.py http://localhost:8777
"""
import sys
import time

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9333


def main():
    proc, _ = launch_chrome(PORT)
    try:
        # Open blank, register the fixture injection, then navigate so the
        # script is in place before the app document loads.
        target = new_tab(PORT, 'about:blank')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        inject_fixtures(cdp)
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.getActive())', timeout=30)

        results = []
        def ok(name, cond, detail=''):
            results.append((name, bool(cond), detail))

        n_songs = cdp.eval('songbookTest.getActive().songs.length')
        rows = cdp.eval("document.querySelectorAll('#songList .song-row').length")
        ok('active songbook songs=15', n_songs == 15, n_songs)
        ok('rendered rows=15', rows == 15, rows)
        ok('default instrument ukulele', cdp.eval('songbookTest.getInstrument()') == 'ukulele')

        # open a song: key C, capo 1 -> "Capo 1"; transpose +1 -> "No capo"
        cdp.eval("location.hash = '#/krakow-ukulele/harbour-lights'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        cdp.wait_js("document.querySelectorAll('#chordStrip .chord-item').length > 0", timeout=10)
        ok('song title Harbour Lights',
           cdp.eval("document.getElementById('songTitle').textContent") == 'Harbour Lights')
        names = cdp.eval(
            "Array.from(document.querySelectorAll('#chordStrip .cname')).map(e=>e.textContent).join(',')")
        ok('strip chords', names == 'C,G,Am,F', names)
        ok('original key shown',
           cdp.eval("document.getElementById('origKey').hidden") is False
           and cdp.eval("document.getElementById('origKeyValue').textContent") == 'C',
           cdp.eval("document.getElementById('origKeyValue').textContent"))
        ok('capo shown', cdp.eval("document.getElementById('capoValue').textContent") == 'Capo 1',
           cdp.eval("document.getElementById('capoValue').textContent"))

        # Song tools: layout, practice and structure controls sit behind one
        # disclosure, so the basic reading row does not grow with every song.
        ok('advanced song controls start collapsed',
           cdp.eval("document.getElementById('songToolsAdvanced').hidden") is True)
        cdp.eval("document.getElementById('songToolsMoreBtn').click()")
        ok('More controls reveals tempo, strum, diagram and structure',
           cdp.eval("document.getElementById('songToolsAdvanced').hidden") is False
           and cdp.eval("document.getElementById('songToolsMoreBtn').getAttribute('aria-expanded')") == 'true'
           and cdp.eval("document.getElementById('metronomeGroup').hidden") is False)
        cdp.eval("document.getElementById('songToolsMoreBtn').click()")
        ok('More controls collapses again',
           cdp.eval("document.getElementById('songToolsAdvanced').hidden") is True)

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

        # capo -2 song -> "No capo · transpose -2"
        cdp.eval("location.hash = '#/krakow-ukulele/budapest'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Budapest'", timeout=10)
        ok('capo -2 hint', cdp.eval("document.getElementById('capoValue').textContent") == 'No capo · transpose -2',
           cdp.eval("document.getElementById('capoValue').textContent"))

        # NC renders as Chuck in the strip
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

        # polska-gurom song opens
        cdp.eval("location.hash = '#/polska-gurom/arahja'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Arahja'", timeout=10)
        ok('polska-gurom song opens', cdp.eval("document.getElementById('songTitle').textContent") == 'Arahja')

        # back to harbour-lights for diagram string counts
        cdp.eval("location.hash = '#/krakow-ukulele/harbour-lights'")
        cdp.wait_js("document.getElementById('songTitle').textContent === 'Harbour Lights'", timeout=10)
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
        first_src = cdp.eval("document.querySelector('#chordStrip img').src.slice(0,40)")
        ok('strip diagram re-rendered', 'data:image/svg' in first_src, first_src)
        cdp.eval("songbookTest.setInstrument('ukulele')")

        # chord explorer: circle, chips, voicings and reverse lookup
        cdp.eval("location.hash = '#/chords'")
        cdp.wait_js("document.getElementById('explorerView').hidden === false", timeout=10)
        ok('chord explorer opens',
           cdp.eval("songbookTest.isExplorerVisible()") is True)
        ok('explorer hides list and song views',
           cdp.eval("document.getElementById('listView').hidden") is True
           and cdp.eval("document.getElementById('songView').hidden") is True)
        ok('explorer link marked current',
           cdp.eval("document.getElementById('explorerLink').getAttribute('aria-current')") == 'page')
        ok('explorer circle has 24 roots',
           cdp.eval("document.querySelectorAll('#explorerCircle [data-kind]').length") == 24)
        ok('explorer has 18 chord types',
           cdp.eval("document.querySelectorAll('#explorerChips .explorer-chip').length") == 18)
        ok('explorer shows C voicings',
           cdp.eval("document.querySelectorAll('#explorerShapes .explorer-shape').length") ==
           cdp.eval("songbookTest.ChordKit.voicings('C','ukulele').length"),
           cdp.eval("document.querySelectorAll('#explorerShapes .explorer-shape').length"))
        cdp.eval("document.querySelector('#explorerChips [data-quality=\"7\"]').click()")
        time.sleep(0.1)
        ok('chord type chip selects C7',
           cdp.eval("songbookTest.explorerState.quality") == '7'
           and cdp.eval("document.getElementById('explorerChordName').textContent") == 'C7',
           cdp.eval("document.getElementById('explorerChordName').textContent"))

        # switching instrument re-renders the explorer for six strings
        cdp.eval("songbookTest.setInstrument('guitar')")
        time.sleep(0.3)
        ok('explorer follows instrument to guitar',
           cdp.eval("document.querySelectorAll('#explorerFindStrings select').length") == 6
           and cdp.eval("document.getElementById('explorerInstrumentName').textContent") == 'guitar')
        ok('guitar explorer diagrams have 6 strings',
           cdp.eval("(document.querySelector('#explorerShapes .explorer-diagram svg')||{innerHTML:''}).innerHTML.split('class=\"st\"').length - 1") == 6)
        ok('reverse lookup names the default guitar shape',
           cdp.eval("(document.querySelector('#explorerFindOut .explorer-find-name')||{}).textContent") == 'C',
           cdp.eval("(document.querySelector('#explorerFindOut .explorer-find-name')||{}).textContent"))
        cdp.eval("songbookTest.setInstrument('ukulele')")
        time.sleep(0.3)

        # neck tab: curated voicings, chord tones and a scale layer
        cdp.eval("location.hash = '#/chords/neck'")
        cdp.wait_js("document.getElementById('explorerNeckPane').hidden === false", timeout=10)
        ok('neck tab opens',
           cdp.eval("location.hash") == '#/chords/neck'
           and cdp.eval("document.getElementById('explorerShapesPane').hidden") is True)
        cdp.eval("(function(){var r=document.getElementById('neckRoot');r.value='9';r.dispatchEvent(new Event('change',{bubbles:true}));})()")
        cdp.eval("(function(){var q=document.getElementById('neckQuality');q.value='m7';q.dispatchEvent(new Event('change',{bubbles:true}));})()")
        time.sleep(0.1)
        ok('neck selects Am7',
           cdp.eval("document.getElementById('neckChordName').textContent") == 'Am7',
           cdp.eval("document.getElementById('neckChordName').textContent"))
        ok('neck uses a curated shape stepper',
           0 < int(cdp.eval("document.getElementById('neckShapeCount').textContent").split('/')[1].strip())
           < 100,
           cdp.eval("document.getElementById('neckShapeCount').textContent"))
        ok('neck draws the selected shape',
           cdp.eval("document.querySelectorAll('#neckDiagram .neck-note-shape').length") > 0)
        ok('neck draws the scale layer',
           cdp.eval("document.querySelectorAll('#neckDiagram .neck-note-scale').length") > 0)
        ok('neck lists shape notes',
           cdp.eval("document.querySelectorAll('#neckShapeNotes .neck-string-note').length") > 0,
           cdp.eval("document.querySelectorAll('#neckShapeNotes .neck-string-note').length"))
        cdp.eval("songbookTest.setInstrument('guitar')")
        time.sleep(0.3)
        ok('neck follows the instrument to guitar',
           cdp.eval("document.querySelectorAll('#neckDiagram .neck-string').length") == 6,
           cdp.eval("document.querySelectorAll('#neckDiagram .neck-string').length"))
        cdp.eval("songbookTest.setInstrument('ukulele')")
        time.sleep(0.3)
        cdp.eval("location.hash = '#/chords'")
        cdp.wait_js("document.getElementById('explorerShapesPane').hidden === false", timeout=10)
        ok('shapes tab returns',
           cdp.eval("document.getElementById('explorerNeckPane').hidden") is True)

        # back to list
        cdp.eval("location.hash = ''")
        cdp.wait_js("document.getElementById('listView').hidden === false", timeout=10)
        ok('back to list shows 15', cdp.eval("document.querySelectorAll('#songList .song-row').length") == 15)

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
