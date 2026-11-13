#!/usr/bin/env python3
"""Parity tests: SB.parseChordPro against chordpro.parse_song.

The app now parses ChordPro in the browser, while the build still parses it in
Python. Two implementations of one authoring subset are only safe if they
cannot drift, so this suite runs the same sources through both and compares the
song dict and the warning strings exactly.

Usage:
    python3 -m http.server 8777 &
    python3 tests/chordpro_js.py http://localhost:8777
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import chordpro  # noqa: E402
from cdp import launch_chrome, new_tab, CDP  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9333


def corpus():
    """Every .cho/.chordpro source the build and the fixtures use."""
    patterns = [
        os.path.join(ROOT, 'chordpro', 'demo', '*.cho'),
        os.path.join(ROOT, 'tests', 'fixtures', 'chordpro', '**', '*.cho'),
        os.path.join(ROOT, 'tests', 'fixtures', 'chordpro', '**', '*.chordpro'),
    ]
    files = []
    for pattern in patterns:
        files.extend(glob.glob(pattern, recursive=True))
    return sorted(set(files))


def cases():
    """(name, text, options) pairs; options mirror parse_song's arguments."""
    out = []
    for i, path in enumerate(corpus()):
        with open(path, encoding='utf-8') as f:
            out.append((os.path.relpath(path, ROOT), f.read(),
                        {'number': i + 1}))
    out.extend([
        ('bad-grid-bar', '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
                         '{start_of_grid: Intro}\n| C | G\n{end_of_grid}\n', {}),
        ('unclosed-grid', '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
                          '{start_of_grid: Intro}\n| C | G |\n[Am]lyric\n', {}),
        ('unbalanced-repeat', '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
                              '{start_of_grid: Verse}\n|: C | G :| Am |\n{end_of_grid}\n', {}),
        ('repeat-on-interior-break',
         '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
         '{start_of_grid: Verse}\n| C | G |\n|: Am | F |\n{end_of_grid}\n', {}),
        ('grid-no-bars', '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
                         '{start_of_grid: Intro}\n{end_of_grid}\n', {}),
        ('grid-dot-without-chord',
         '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
         '{start_of_grid: Intro}\n| . C |\n{end_of_grid}\n', {}),
        ('grid-missing-end-with-directive',
         '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
         '{start_of_grid: Intro}\n| C |\n{comment: still inside}\n', {}),
        ('invalid-chord-token-is-verbatim', '{title: T}\n{artist: A}\n'
                                            '{level: Easy}\n{duration: 1}\n'
                                            '[H7]text [N.C.]x\n', {}),
        ('unsupported-directive-is-ignored', '{title: T}\n{artist: A}\n'
                                             '{level: Easy}\n{duration: 1}\n'
                                             '{define: X base-fret 1}\n[C]x\n', {}),
        ('invalid-metadata', '{title: T}\n{artist: A}\n{level: weird}\n'
                             '{duration: soon}\n{tempo: 999}\n{time: 5/4}\n'
                             '{strum: nope}\n{capo: x}\n{number: nope}\n'
                             '{new: maybe}\n[C]x\n', {}),
        ('valid-metadata', '{title: T}\n{artist: A}\n{level: hard}\n'
                           '{duration: 2.5}\n{tempo: 92.5}\n{time: 6 / 8}\n'
                           '{strum: du-6-8}\n{key: Am}\n{sheetkey: G}\n'
                           '{capo: 2}\n{number: 7}\n{new: yes}\n[C]x\n', {}),
        ('chords-override-mismatch', '{title: T}\n{artist: A}\n{level: Easy}\n'
                                     '{duration: 1}\n{chords: Am, F}\n[C]x\n', {}),
        ('trusted-note-disabled', '{title: T}\n{artist: A}\n{level: Easy}\n'
                                  '{duration: 1}\n{trusted_note: Refren:}\n[C]x\n', {}),
        ('trusted-note-allowed', '{title: T}\n{artist: A}\n{level: Easy}\n'
                                 '{duration: 1}\n{trusted_note: Refren:}\n[C]x\n',
         {'allow_trusted_notes': True}),
        ('comments-tab-and-bom', '\ufeff{title: T}\n{artist: A}\n{level: Easy}\n'
                                 '{duration: 1}\n{comment: Intro}\n'
                                 '# source comment\n{sot}\n  e|--0--|  \n\n{eot}\n'
                                 '[C]x\n', {}),
        ('empty-brackets-and-escapes', '{title: T}\n{artist: A}\n{level: Easy}\n'
                                       '{duration: 1}\n'
                                       'a[]b \\[Refren\\] [C]x\n', {}),
    ])
    return out


def main():
    proc, _ = launch_chrome(PORT)
    results = []

    def check(name, cond, detail=''):
        results.append((name, bool(cond), detail))

    try:
        target = new_tab(PORT, 'about:blank')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.SB && SB.parseChordPro)', timeout=30)

        # A non-string is a programming error, not malformed ChordPro.
        try:
            cdp.eval('SB.parseChordPro(null)')
            check('non-string input throws', False)
        except RuntimeError:
            check('non-string input throws', True)

        for name, text, options in cases():
            number = options.get('number', 1)
            expected_warnings = []
            expected = chordpro.parse_song(
                text, number=number, warnings=expected_warnings,
                allow_trusted_notes=bool(options.get('allow_trusted_notes')))
            js_options = {'number': number}
            if options.get('allow_trusted_notes'):
                # The browser API is camelCase; parse_song's keyword is not.
                js_options['allowTrustedNotes'] = True
            expr = ('JSON.stringify(SB.parseChordPro(%s, %s))'
                    % (json.dumps(text), json.dumps(js_options)))
            try:
                got = json.loads(cdp.eval(expr))
            except Exception as exc:  # noqa: BLE001 - report and keep going
                check(name, False, 'JS error: %s' % exc)
                continue
            if got.get('song') != expected:
                check(name + ' song', False,
                      'expected %s\ngot      %s' % (json.dumps(expected, sort_keys=True),
                                                    json.dumps(got.get('song'), sort_keys=True)))
            else:
                check(name + ' song', True)
            if got.get('warnings') != expected_warnings:
                check(name + ' warnings', False,
                      'expected %r\ngot      %r' % (expected_warnings, got.get('warnings')))
            else:
                check(name + ' warnings', True)
    finally:
        proc.kill()
        proc.wait()

    failures = [r for r in results if not r[1]]
    for name, ok, detail in results:
        if not ok:
            print('FAIL %s' % name)
            if detail:
                print('     %s' % detail.replace('\n', '\n     '))
    print('\n%d/%d checks passed' % (len(results) - len(failures), len(results)))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
