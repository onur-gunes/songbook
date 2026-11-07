#!/usr/bin/env python3
"""Guard the strum pattern library.

The library lives in two places that must agree:

    chordpro.py  STRUM_PATTERNS  -> the build's allowlist of valid `strum` ids
    js/strum.js  PATTERNS        -> what the running app renders

They cannot import each other (one is Python, one a browser script), so this
test extracts the JS copy under node and asserts it is identical to the Python
one, exactly as tests/env.py does for the dev/prod rule. It also checks the
library's own invariants: every pattern's slot count lines up with its metre
and subdivision, so the subdivision row always lines up with the metronome.

Usage:
    python3 tests/strum.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import chordpro  # noqa: E402

STRUM_JS = os.path.join(ROOT, 'js', 'strum.js')
METRONOME_JS = os.path.join(ROOT, 'js', 'metronome.js')
SONGBOOKS_JS = os.path.join(ROOT, 'js', 'songbooks.js')

# Felt beats per bar per metre, mirroring js/metronome.js BEATS_PER_BAR and
# SB.metronomeBeatsPerBar. 6/8 is two dotted-quarter pulses, not six eighths.
# The canonical copy now lives in chordpro (used by the grid validator too);
# reuse it here so there is one fewer hand-kept duplicate.
BEATS_PER_BAR = chordpro.BEATS_PER_BAR


def extract_js_patterns():
    """Pull the PATTERNS array out of js/strum.js and evaluate it under node."""
    with open(STRUM_JS, encoding='utf-8') as fh:
        src = fh.read()
    m = re.search(r'var PATTERNS = (\[.*?\]);', src, re.DOTALL)
    if not m:
        raise AssertionError('could not find PATTERNS in js/strum.js')
    script = 'var PATTERNS = %s;\nconsole.log(JSON.stringify(PATTERNS));' % m.group(1)
    out = subprocess.run(['node', '-e', script], capture_output=True,
                         text=True, check=True, cwd=ROOT)
    return json.loads(out.stdout)


def _eval_js(expr):
    """Evaluate a literal JS expression under node and return its JSON value."""
    out = subprocess.run(
        ['node', '-e', 'console.log(JSON.stringify(%s));' % expr],
        capture_output=True, text=True, check=True, cwd=ROOT)
    return json.loads(out.stdout)


def extract_js_constants(path):
    """Extract the tempo/metre constants shared by the browser scripts.

    These are plain literals, but they are still evaluated under node rather
    than parsed by hand so the test reads the same values the browser sees.
    Missing declarations raise: a rename must fail this guard, not silently
    skip the comparison.
    """
    with open(path, encoding='utf-8') as fh:
        src = fh.read()

    bpm = re.search(r'var\s+BPM_MIN\s*=\s*(\d+)\s*,\s*BPM_MAX\s*=\s*(\d+)\s*;', src)
    if not bpm:
        raise AssertionError('could not find BPM_MIN/BPM_MAX in %s' % path)
    out = {'bpm_min': int(bpm.group(1)), 'bpm_max': int(bpm.group(2))}

    beats = re.search(r'var\s+BEATS_PER_BAR\s*=\s*(\{[^}]*\})\s*;', src)
    if beats:
        out['beats_per_bar'] = _eval_js(beats.group(1))

    times = re.search(r'var\s+TIME_SIGNATURES\s*=\s*(\[[^\]]*\])\s*;', src)
    if times:
        out['time_signatures'] = _eval_js(times.group(1))

    return out


class StrumLibraryTests(unittest.TestCase):
    def test_count_in_fits_the_pattern_bar(self):
        """A count-in bar is exactly as many slots as the pattern itself.

        The app counts you in through the pattern's OWN cells rather than a
        second bar beside it (renderRow/setPhase in js/strum.js): a separate
        count-in bar doubled the row's width for something only meaningful
        while it runs, which on a phone cost the pattern its place on screen.

        That only works because one bar at the pattern's subdivision is the
        same number of slots as the pattern. It follows from the invariant
        above, but it is asserted separately because it is a different claim:
        if a pattern ever spanned two bars, the count-in would silently stop
        lining up with the cells it is painting.
        """
        for p in chordpro.STRUM_PATTERNS:
            count_in = BEATS_PER_BAR[p['time']] * p['subdiv']
            self.assertEqual(
                count_in, len(p['slots']),
                'id %r: a %s count-in is %d slots but the pattern has %d' %
                (p['id'], p['time'], count_in, len(p['slots'])))

    def test_python_invariants(self):
        """Every pattern's slots line up with its metre and subdivision."""
        seen = set()
        for p in chordpro.STRUM_PATTERNS:
            self.assertIn(p['time'], chordpro.TIME_SIGNATURES, p)
            self.assertNotIn(p['id'], seen, 'duplicate id %r' % p['id'])
            seen.add(p['id'])
            self.assertTrue(set(p['slots']) <= set('DU-'), p)
            expected = BEATS_PER_BAR[p['time']] * p['subdiv']
            self.assertEqual(len(p['slots']), expected,
                             'id %r: %d slots, expected %d' %
                             (p['id'], len(p['slots']), expected))

    def test_bar_starts_on_a_downstroke(self):
        """Slot 0 is always a down-stroke.

        Slot 0 is beat 1, the bar's strongest accent and where the count-in
        hands over. Starting a bar on an up-stroke or a rest is never what a
        generic pattern wants.
        """
        for p in chordpro.STRUM_PATTERNS:
            self.assertEqual(p['slots'][0], 'D',
                             'id %r starts on %r' % (p['id'], p['slots'][0]))

    def test_continuous_patterns_strum_down_on_the_beat(self):
        """In a rest-free pattern every felt beat is a down-stroke.

        With no rests the hand never leaves the strings, so the stroke
        direction is fixed by the subdivision: beats are downs, off-beats are
        ups. Any other arrangement means the hand is travelling upward as the
        metronome accents, which visually fights the click.

        This is deliberately limited to rest-free patterns. Patterns WITH
        rests are a different case: the island strum (dduudu-4-4,
        'D-DU-UDU') intentionally leaves beat 3 silent, and that syncopation
        is the whole point of it.

        Caught eighths-6-8 shipping as 'DUDUDU', which under 6/8's two
        dotted-quarter pulses put an up-stroke on pulse 2; 'DUDDUD' restarts
        the alternation on each pulse.
        """
        for p in chordpro.STRUM_PATTERNS:
            if '-' in p['slots']:
                continue
            for beat in range(BEATS_PER_BAR[p['time']]):
                slot = beat * p['subdiv']
                self.assertEqual(
                    p['slots'][slot], 'D',
                    "id %r (%s, slots %r): felt beat %d is slot %d = %r, "
                    "expected a down-stroke" %
                    (p['id'], p['time'], p['slots'], beat + 1, slot,
                     p['slots'][slot]))

    def test_parse_strum_allowlist(self):
        self.assertEqual(chordpro.parse_strum('downs-4-4'), 'downs-4-4')
        self.assertIsNone(chordpro.parse_strum('not-a-pattern'))
        self.assertIsNone(chordpro.parse_strum(''))
        self.assertIsNone(chordpro.parse_strum(None))
        self.assertIsNone(chordpro.parse_strum(True))

    def test_filter_by_metre(self):
        for time in chordpro.TIME_SIGNATURES:
            for p in chordpro.strum_patterns_for(time):
                self.assertEqual(p['time'], time)
        # at least the three metres the issue names are covered
        for time in ('4/4', '3/4', '6/8'):
            self.assertTrue(chordpro.strum_patterns_for(time),
                            'no patterns for %s' % time)

    def test_tempo_and_metre_tables_agree(self):
        """The Python copies are one allowlist, not three loose constants."""
        self.assertLess(chordpro.BPM_MIN, chordpro.BPM_MAX)
        self.assertEqual(set(chordpro.BEATS_PER_BAR), set(chordpro.TIME_SIGNATURES))
        for time, beats in chordpro.BEATS_PER_BAR.items():
            self.assertGreater(beats, 0, time)


class MirrorConstantTests(unittest.TestCase):
    """The browser copies of the tempo/metre constants must match chordpro.py.

    Three copies exist because the build (Python) and the app (classic
    scripts) cannot import each other: chordpro.py, js/metronome.js and
    js/songbooks.js. Comments alone do not fail CI when one drifts, so this
    guard extracts the JS literals under node and compares them.
    """

    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_metronome_matches_python(self):
        js = extract_js_constants(METRONOME_JS)
        self.assertEqual(js['bpm_min'], chordpro.BPM_MIN)
        self.assertEqual(js['bpm_max'], chordpro.BPM_MAX)
        self.assertEqual(js['beats_per_bar'], chordpro.BEATS_PER_BAR)
        self.assertEqual(set(js['beats_per_bar']), set(chordpro.TIME_SIGNATURES))

    def test_songbooks_matches_python(self):
        js = extract_js_constants(SONGBOOKS_JS)
        self.assertEqual(js['bpm_min'], chordpro.BPM_MIN)
        self.assertEqual(js['bpm_max'], chordpro.BPM_MAX)
        self.assertEqual(js['time_signatures'], list(chordpro.TIME_SIGNATURES))
        self.assertEqual(js['beats_per_bar'], chordpro.BEATS_PER_BAR)

    def test_js_copies_match_each_other(self):
        met = extract_js_constants(METRONOME_JS)
        sb = extract_js_constants(SONGBOOKS_JS)
        self.assertEqual((met['bpm_min'], met['bpm_max']),
                         (sb['bpm_min'], sb['bpm_max']))
        self.assertEqual(met['beats_per_bar'], sb['beats_per_bar'])


class StrumMirrorTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_js_matches_python(self):
        """js/strum.js PATTERNS must be byte-identical to chordpro.STRUM_PATTERNS."""
        js = extract_js_patterns()
        py = [dict(p) for p in chordpro.STRUM_PATTERNS]
        self.assertEqual(js, py)


if __name__ == '__main__':
    unittest.main(verbosity=2)
