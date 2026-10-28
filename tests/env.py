#!/usr/bin/env python3
"""Guard the dev/prod environment split.

GitHub Pages serves prod (/songbook/) and dev (/songbook/dev/) from one
origin, so localStorage, IndexedDB and CacheStorage are all shared between
them. Two independent copies of the same "which environment am I?" rule keep
them apart:

    js/core.js  SB.envFor()  -> storage namespace (SB.NS)
    sw.js       envFor()     -> cache name prefix

They cannot import each other (one is a page script, one a worker), so this
test extracts both and asserts they agree, and that prod's storage namespace
is still the original 'songbook' — renaming it would orphan every existing
user's favourites, notes and imported songbooks.

Usage:
    python3 tests/env.py
"""
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (pathname, expected environment) — the URL shapes these actually see.
CASES = [
    ('/songbook/', 'prod'),
    ('/songbook/index.html', 'prod'),
    ('/songbook/sw.js', 'prod'),
    ('/songbook/dev/', 'dev'),
    ('/songbook/dev/index.html', 'dev'),
    ('/songbook/dev/sw.js', 'dev'),
    ('/', 'prod'),
    ('/index.html', 'prod'),
    ('/dev/', 'dev'),
    ('/dev/index.html', 'dev'),
    # a directory merely starting with "dev" is not the dev deploy
    ('/songbook/developer/', 'prod'),
]

CORE_JS = os.path.join(ROOT, 'js', 'core.js')
SW_JS = os.path.join(ROOT, 'sw.js')


def extract(path, pattern):
    """Pull a single function body out of a JS source file."""
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    m = re.search(pattern, src, re.DOTALL)
    if not m:
        raise AssertionError('could not find the env rule in ' + path)
    return m.group(1)


def run_js(body, call):
    """Evaluate an extracted function against every case under node."""
    script = body + '\n' + (
        'var cases = %s;\n'
        'cases.forEach(function (c) { console.log(%s(c)); });'
    ) % (repr([c[0] for c in CASES]).replace("'", '"'), call)
    out = subprocess.run(
        ['node', '-e', script],
        capture_output=True, text=True, check=True, cwd=ROOT)
    return out.stdout.split()


class EnvRuleTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_core_js_rule(self):
        body = extract(CORE_JS, r'(SB\.envFor = function \(pathname, protocol\) \{.*?\};)')
        # pin the protocol to https so this compares like-for-like with sw.js,
        # which only ever runs over http(s)
        body = ('var SB = {};\n' + body
                + "\nvar _f = SB.envFor;"
                + "\nSB.envFor = function (p) { return _f(p, 'https:'); };")
        self.assertEqual(run_js(body, 'SB.envFor'), [c[1] for c in CASES])

    def test_file_protocol_is_always_prod(self):
        """The portable Songbook.html must never pick up the dev namespace."""
        body = extract(CORE_JS, r'(SB\.envFor = function \(pathname, protocol\) \{.*?\};)')
        script = ('var SB = {};\n' + body
                  + "\nconsole.log(SB.envFor('/Users/me/dev/Songbook.html', 'file:'));"
                  + "\nconsole.log(SB.envFor('/Users/me/Downloads/Songbook.html', 'file:'));")
        out = subprocess.run(['node', '-e', script], capture_output=True,
                             text=True, check=True, cwd=ROOT)
        self.assertEqual(out.stdout.split(), ['prod', 'prod'])

    def test_sw_js_rule(self):
        body = extract(SW_JS, r'(function envFor\(pathname\) \{.*?\n\})')
        self.assertEqual(run_js(body, 'envFor'), [c[1] for c in CASES])

    def test_prod_namespace_is_unchanged(self):
        """Renaming prod's namespace would orphan every live user's data."""
        with open(CORE_JS, encoding='utf-8') as fh:
            src = fh.read()
        m = re.search(r'SB\.NS = .*', src)
        self.assertIsNotNone(m, 'SB.NS assignment not found')
        line = m.group(0)
        self.assertIn("'songbook'", line)
        self.assertIn("'songbook-dev'", line)

    def test_sw_prunes_only_its_own_prefix(self):
        """activate must not delete the other environment's caches."""
        with open(SW_JS, encoding='utf-8') as fh:
            src = fh.read()
        self.assertIn("k.indexOf(PREFIX) !== 0", src)


if __name__ == '__main__':
    unittest.main(verbosity=2)
