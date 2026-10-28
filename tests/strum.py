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

# Felt beats per bar per metre, mirroring js/metronome.js BEATS_PER_BAR and
# SB.metronomeBeatsPerBar. 6/8 is two dotted-quarter pulses, not six eighths.
BEATS_PER_BAR = {'4/4': 4, '3/4': 3, '6/8': 2, '2/4': 2}


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


class StrumLibraryTests(unittest.TestCase):
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
