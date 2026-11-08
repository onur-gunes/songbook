#!/usr/bin/env python3
"""Guard the canonical section-role model.

The role table lives in two places that must agree:

    chordpro.py  SECTION_ROLES / SECTION_ALIASES  (the build)
    js/sections.js SECTION_ROLES / SECTION_ALIASES (the running app)

They cannot import each other (one is Python, one a browser script), so this
test extracts the JS copy under node and asserts it matches the Python one,
exactly as tests/strum.py does for the strum library. It also checks
section_role() on the bilingual labels the issue names
(Zwrotka 2 == Verse 2 == verse, etc.).

Usage:
    python3 tests/sections.py
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

SECTIONS_JS = os.path.join(ROOT, 'js', 'sections.js')

ROLES = chordpro.SECTION_ROLES


def extract_js_table(path, name):
    """Pull a top-level `var NAME = ...` literal out of a JS file and evaluate
    it under node, returning its JSON value. Raises if the declaration is
    missing, so a rename fails this guard rather than silently skipping it."""
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    m = re.search(r'var\s+%s\s*=\s*(\[.*?\]|\{.*?\})\s*;' % name, src, re.DOTALL)
    if not m:
        raise AssertionError('could not find %s in %s' % (name, path))
    script = 'var %s = %s;\nconsole.log(JSON.stringify(%s));' % (name, m.group(1), name)
    out = subprocess.run(['node', '-e', script], capture_output=True,
                         text=True, check=True, cwd=ROOT)
    return json.loads(out.stdout)


class SectionRoleTests(unittest.TestCase):
    def test_bilingual_labels_resolve_to_the_same_role(self):
        self.assertEqual(chordpro.section_role('Zwrotka 2'), 'verse')
        self.assertEqual(chordpro.section_role('Verse 2'), 'verse')
        self.assertEqual(chordpro.section_role('(Chorus)'), 'chorus')
        self.assertEqual(chordpro.section_role('Refren 3'), 'chorus')
        self.assertEqual(chordpro.section_role('Wstęp'), 'intro')
        self.assertEqual(chordpro.section_role('Zakończenie'), 'outro')
        self.assertEqual(chordpro.section_role('Most'), 'bridge')
        self.assertEqual(chordpro.section_role('Przejście'), 'pre_chorus')
        self.assertEqual(chordpro.section_role('Final Chorus'), 'chorus')
        self.assertEqual(chordpro.section_role('Intro/Chorus'), 'intro')

    def test_unmatched_labels_return_other(self):
        self.assertEqual(chordpro.section_role('Quietly'), 'other')
        self.assertEqual(chordpro.section_role('Down-down'), 'other')
        self.assertEqual(chordpro.section_role(''), 'other')
        self.assertEqual(chordpro.section_role(None), 'other')
        self.assertEqual(chordpro.section_role('Something random'), 'other')

    def test_roles_are_the_declared_enum(self):
        self.assertEqual(ROLES, ('intro', 'verse', 'pre_chorus', 'chorus',
                                 'bridge', 'outro', 'interlude', 'solo',
                                 'tag', 'other'))


class SectionMirrorTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_js_roles_match_python(self):
        js = extract_js_table(SECTIONS_JS, 'SECTION_ROLES')
        self.assertEqual(js, list(chordpro.SECTION_ROLES))

    def test_js_aliases_match_python(self):
        js = extract_js_table(SECTIONS_JS, 'SECTION_ALIASES')
        self.assertEqual(js, chordpro.SECTION_ALIASES)

    def test_js_sectionrole_matches_python(self):
        """The JS sectionRole() gives the same answers as chordpro.section_role()."""
        cases = [
            'Zwrotka 2', 'Verse 2', '(Chorus)', 'Refren 3',
            'Wstęp', 'Zakończenie', 'Most', 'Przejście', 'Final Chorus',
            'Intro/Chorus', 'Quietly', '', 'Coda', 'Hook',
        ]
        with open(SECTIONS_JS, encoding='utf-8') as fh:
            src = fh.read()
        script = ('var window = { SB: {} };\n'
                  + src
                  + '\nconsole.log(JSON.stringify(%s.map(function (c) { '
                  + 'return window.SB.sectionRole(c); })));'
                  % json.dumps(cases))
        out = subprocess.run(['node', '-e', script], capture_output=True,
                             text=True, check=True, cwd=ROOT)
        got = json.loads(out.stdout)
        expected = [chordpro.section_role(c) for c in cases]
        self.assertEqual(got, expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
