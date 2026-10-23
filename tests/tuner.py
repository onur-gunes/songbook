#!/usr/bin/env python3
"""CDP smoke test for the tuner UI and pitch engine.

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/tuner.py http://localhost:8777
"""
import math
import sys
import time

from cdp import launch_chrome, new_tab, CDP

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9337


def main():
    proc, _ = launch_chrome(PORT)
    try:
        target = new_tab(PORT, BASE + '/index.html?nosw')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.SongbookTuner && window.songbookTest && songbookTest.getActive())',
                    timeout=30)

        results = []
        def ok(name, cond, detail=''):
            results.append((name, bool(cond), detail))

        cdp.eval("localStorage.removeItem('songbook:tuner:a4')")

        ok('tuner button exists', cdp.eval("!!document.getElementById('tunerBtn')"))
        ok('tuner starts closed', cdp.eval("SongbookTuner.isOpen()") is False)

        # --- pitch engine accuracy on synthetic tones (no microphone) ---
        detect = """
            (function () {
                var T = SongbookTuner._test;
                var sr = 44100, n = 8192;
                function tone(f) {
                    var b = new Float32Array(n);
                    for (var i = 0; i < n; i++) {
                        var t = i / sr;
                        b[i] = 0.3 * Math.sin(2 * Math.PI * f * t) +
                               0.09 * Math.sin(2 * Math.PI * 2 * f * t) +
                               0.04 * Math.sin(2 * Math.PI * 3 * f * t);
                    }
                    var d = T.createPitchDetector({ minFreq: 55, maxFreq: 900 });
                    return d.detect(b, sr);
                }
                return { a4: tone(440), e2: tone(82.4069), g4: tone(391.9954) };
            })()
        """
        detected = cdp.eval(detect)
        for name, target in [('a4', 440.0), ('e2', 82.4069), ('g4', 391.9954)]:
            freq = detected[name]['freq']
            cents = 1200 * math.log(freq / target, 2)
            ok('detect %s within 2 cents' % name, abs(cents) <= 2.0,
               'freq=%.3f cents=%.2f' % (freq, cents))

        ok('note parsing G4 = 391.995 Hz',
           abs(cdp.eval("SongbookTuner._test.noteFromName('G4', 440).freq") - 391.9954) < 0.01)
        ok('A4 calibration changes target',
           abs(cdp.eval("SongbookTuner._test.noteFromName('A4', 442).freq") - 442) < 0.001)

        clean = cdp.eval("SongbookTuner._test.adaptFromSnr(40)")
        noisy = cdp.eval("SongbookTuner._test.adaptFromSnr(0)")
        ok('clean SNR gives tight gate/window',
           clean == {'gate': 0.82, 'window': 3, 'quality': 1}, clean)
        ok('noisy SNR gives loose gate/window',
           noisy == {'gate': 0.93, 'window': 7, 'quality': 0}, noisy)
        ok('SNR adaptation is monotonic',
           cdp.eval("SongbookTuner._test.adaptFromSnr(10).gate > "
                    "SongbookTuner._test.adaptFromSnr(25).gate"))

        # --- open the tuner ---
        cdp.eval("document.getElementById('tunerBtn').click()")
        cdp.wait_js("SongbookTuner.isOpen() && !document.getElementById('tunerOverlay').hidden")
        ok('tuner opens', cdp.eval("!document.getElementById('tunerOverlay').hidden") is True)
        ok('tuner is a dialog',
           cdp.eval("document.querySelector('#tunerOverlay [role=\"dialog\"]') !== null"))
        ok('ukulele strings rendered',
           cdp.eval("document.querySelectorAll('#tunerStrings .tuner-string').length") == 5)
        ok('ukulele tab active',
           cdp.eval("document.querySelector('[data-tuner-instrument=\"ukulele\"]').classList.contains('active')"))
        ukulele_range = cdp.eval('SongbookTuner._test.detectorRange()')
        ok('ukulele detector range', ukulele_range == {'min': 130, 'max': 900}, ukulele_range)
        ok('tuning selector populated',
           cdp.eval("document.getElementById('tunerTuning').options.length") >= 2)
        ok('default A4 shown', cdp.eval("document.getElementById('tunerCalValue').textContent") == '440')
        ok('attribution credits fgnass',
           cdp.eval("document.querySelector('.tuner-attrib a').href.indexOf('fgnass/tuner') >= 0"))
        ok('confidence bar exists', cdp.eval("!!document.getElementById('tunerConfidence')"))
        bar = cdp.eval("""(function () {
            SongbookTuner._test.setConfidence(0.8);
            var el = document.getElementById('tunerConfidence');
            var high = { width: el.style.width, good: el.classList.contains('good') };
            SongbookTuner._test.setConfidence(0.5);
            return { high: high, mid: { width: el.style.width, ok: el.classList.contains('ok') } };
        })()""")
        ok('confidence bar tracks level',
           bar == {'high': {'width': '80%', 'good': True},
                   'mid': {'width': '50%', 'ok': True}}, bar)

        # --- switch instrument from inside the tuner and sync the app ---
        cdp.eval("document.querySelector('[data-tuner-instrument=\"guitar\"]').click()")
        time.sleep(0.2)
        ok('tuner guitar tab active',
           cdp.eval("document.querySelector('[data-tuner-instrument=\"guitar\"]').classList.contains('active')"))
        ok('global instrument synced to guitar',
           cdp.eval("songbookTest.getInstrument()") == 'guitar')
        ok('guitar strings rendered',
           cdp.eval("document.querySelectorAll('#tunerStrings .tuner-string').length") == 7)
        guitar_range = cdp.eval('SongbookTuner._test.detectorRange()')
        ok('guitar detector range', guitar_range == {'min': 55, 'max': 700}, guitar_range)
        cdp.eval("document.querySelector('[data-tuner-instrument=\"ukulele\"]').click()")
        time.sleep(0.15)

        # --- A4 calibration ---
        cdp.eval("document.getElementById('tunerCalUp').click()")
        ok('A4 +1 updates label',
           cdp.eval("document.getElementById('tunerCalValue').textContent") == '441')
        cdp.eval("document.getElementById('tunerCalDown').click()")

        # --- Escape closes without leaking to the app's keyboard handler ---
        cdp.eval("location.hash = '#/krakow-ukulele/riptide'")
        cdp.wait_js("document.getElementById('songView').hidden === false", timeout=10)
        cdp.eval("document.getElementById('tunerBtn').click()")
        cdp.wait_js("SongbookTuner.isOpen()")
        cdp.eval("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}))")
        time.sleep(0.15)
        ok('arrow keys ignored while tuner open',
           cdp.eval("location.hash") == '#/krakow-ukulele/riptide')
        cdp.eval("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}))")
        cdp.wait_js("!SongbookTuner.isOpen()", timeout=5)
        ok('Escape closes tuner',
           cdp.eval("document.getElementById('tunerOverlay').hidden") is True)
        ok('Escape does not navigate away from song',
           cdp.eval("document.getElementById('songView').hidden") is False)

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
