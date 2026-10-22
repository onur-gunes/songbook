#!/usr/bin/env python3
"""Unit tests for the ChordPro authoring path.

Usage:
    python3 tests/chordpro.py
"""
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import chordpro
import build_songbook

FIXTURE = os.path.join(ROOT, 'tests', 'fixtures', 'chordpro', 'demo')


class ParseLineTests(unittest.TestCase):
    def test_inline_chords(self):
        self.assertEqual(
            chordpro.parse_line('Po [C#m]co [A]budować'),
            [['x', 'Po '], ['c', '[C#m]'], ['x', 'co '], ['c', '[A]'], ['x', 'budować']],
        )

    def test_consecutive_chords(self):
        self.assertEqual(
            chordpro.parse_line('[C][Am]together'),
            [['c', '[C]'], ['c', '[Am]'], ['x', 'together']],
        )

    def test_slash_chords_and_suffixes_verbatim(self):
        self.assertEqual(
            chordpro.parse_line('[C/G]one [Fmaj7]two [A7sus4]three'),
            [['c', '[C/G]'], ['x', 'one '], ['c', '[Fmaj7]'],
             ['x', 'two '], ['c', '[A7sus4]'], ['x', 'three']],
        )

    def test_blank_line_is_empty_list(self):
        self.assertEqual(chordpro.parse_line(''), [])
        self.assertEqual(chordpro.parse_line('   '), [])

    def test_unterminated_bracket_stays_text(self):
        self.assertEqual(chordpro.parse_line('[C lyric'), [['x', '[C lyric']])

    def test_empty_brackets_stay_text(self):
        self.assertEqual(chordpro.parse_line('a[]b'), [['x', 'a[]b']])


class ParseSongTests(unittest.TestCase):
    def test_metadata_mapping(self):
        song = chordpro.parse_song(
            '{t: My Song}\n{st: Me}\n{level: hard}\n{duration: 4}\n'
            '{key: Am}\n{sheetkey: G}\n{capo: 2}\n{new: yes}\n{number: 7}\n\n'
            '[C]Hello\n'
        )
        self.assertEqual(song['title'], 'My Song')
        self.assertEqual(song['artist'], 'Me')
        self.assertEqual(song['level'], 'Hard')
        self.assertEqual(song['dur'], 4.0)
        self.assertEqual(song['key'], 'Am')
        self.assertEqual(song['sheetKey'], 'G')
        self.assertEqual(song['capo'], 2)
        self.assertIs(song['new'], True)
        self.assertEqual(song['n'], 7)
        self.assertEqual(song['id'], 'my-song')
        self.assertEqual(song['chords'], ['C'])
        self.assertEqual(song['sheet'], [[['c', '[C]'], ['x', 'Hello']]])

    def test_defaults_and_warnings(self):
        warnings = []
        song = chordpro.parse_song('{title: T}\n{artist: A}\n\n[C]x', warnings=warnings)
        self.assertEqual(song['level'], 'Medium')
        self.assertEqual(song['dur'], 3.0)
        self.assertIs(song['new'], False)
        self.assertEqual(song['n'], 1)
        self.assertNotIn('key', song)
        self.assertNotIn('sheetKey', song)
        self.assertNotIn('capo', song)
        self.assertTrue(any('missing level' in w for w in warnings))
        self.assertTrue(any('missing duration' in w for w in warnings))

    def test_key_defaults_sheetkey_and_capo(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n{key: Am}\n[C]x'
        )
        self.assertEqual(song['key'], 'Am')
        self.assertEqual(song['sheetKey'], 'Am')
        self.assertEqual(song['capo'], 0)

    def test_invalid_level_and_duration_warn(self):
        warnings = []
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Impossible}\n{duration: soon}\n[C]x',
            warnings=warnings,
        )
        self.assertEqual(song['level'], 'Medium')
        self.assertEqual(song['dur'], 3.0)
        self.assertTrue(any('invalid level' in w for w in warnings))
        self.assertTrue(any('invalid duration' in w for w in warnings))

    def test_comments_are_safe_italic(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{comment: Verse 1}\n{c: Quietly}\n[C]x'
        )
        self.assertEqual(song['sheet'][0], [['i', 'Verse 1']])
        self.assertEqual(song['sheet'][1], [['i', 'Quietly']])
        kinds = {seg[0] for line in song['sheet'] for seg in line}
        self.assertNotIn('y', kinds)

    def test_chorus_labels(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{soc}\n[C]chorus\n{eoc}'
        )
        self.assertEqual(song['sheet'][0], [['i', '(Chorus)']])
        self.assertEqual(song['sheet'][1], [['c', '[C]'], ['x', 'chorus']])

    def test_tab_keeps_raw_lines_and_skips_chord_parsing(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{sot}\n[Am] raw\n  B|--1--|\n# ignored inside tab\n{eot}'
        )
        self.assertEqual(song['sheet'], [
            [['p', '[Am] raw']],
            [['p', '  B|--1--|']],
        ])

    def test_source_comments_ignored_and_trailing_blanks_trimmed(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '# ignored\n[C]x\n\n\n'
        )
        self.assertEqual(song['sheet'], [[['c', '[C]'], ['x', 'x']]])

    def test_internal_blank_line_kept_as_empty_list(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '[C]one\n\n[G]two'
        )
        self.assertEqual(song['sheet'][1], [])
        for line in song['sheet']:
            self.assertNotIn(['x', ''], line)

    def test_chords_derived_unique_in_order(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '[C]a [Am]b [C]c [F]d [G]e'
        )
        self.assertEqual(song['chords'], ['C', 'Am', 'F', 'G'])


class BuildTests(unittest.TestCase):
    def test_fixture_book_round_trip(self):
        with open(os.path.join(FIXTURE, 'expected.json'), encoding='utf-8') as f:
            expected = json.load(f)
        with tempfile.TemporaryDirectory() as tmp:
            songbooks = os.path.join(tmp, 'songbooks')
            os.makedirs(songbooks)
            index_path = os.path.join(songbooks, 'index.json')
            with open(index_path, 'w', encoding='utf-8') as f:
                json.dump({'songbooks': [
                    {'id': 'keep', 'name': 'Keep', 'description': 'x',
                     'instrument': 'ukulele', 'file': 'keep.json'},
                    {'id': 'demo', 'name': 'Old', 'description': 'old',
                     'instrument': 'ukulele', 'file': 'old.json'},
                ]}, f, ensure_ascii=False, indent=2)

            result = build_songbook.build_book(
                FIXTURE, out_dir=songbooks, index_path=index_path,
                report_path=os.path.join(tmp, 'demo-report.txt'),
                chord_check=False,
            )

            self.assertEqual(result['errors'], [])
            self.assertEqual(result['book'], expected)
            validation_errors, _ = build_songbook.validate_songbook(expected)
            self.assertEqual(validation_errors, [])
            with open(result['output'], encoding='utf-8') as f:
                written = f.read()
            self.assertEqual(written, json.dumps(expected, ensure_ascii=False, indent=1) + '\n')

            with open(index_path, encoding='utf-8') as f:
                index = json.load(f)
            self.assertEqual([b['id'] for b in index['songbooks']], ['keep', 'demo'])
            self.assertEqual(index['songbooks'][1]['name'], 'ChordPro Demo')
            self.assertEqual(index['songbooks'][1]['file'], 'demo.json')

            self.assertTrue(os.path.exists(result['report_path']))
            self.assertIn('errors: none', result['report'])
            self.assertIn('blank lines: ok', result['report'])
            self.assertIn('pre lines: ok', result['report'])
            self.assertIn('chord engine (disabled)', result['report'])

    def test_validation_flags_malformed_sheet(self):
        book = {
            'id': 'bad', 'name': 'Bad', 'description': '',
            'instrument': 'ukulele',
            'songs': [{
                'id': 'bad-song', 'n': 1, 'title': '', 'artist': '',
                'level': 'Weird', 'new': False, 'dur': '3',
                'chords': [],
                'sheet': [
                    [['x', '']],
                    [['c', 'Am']],
                    [['p', 'a'], ['x', 'b']],
                    [['x', '&amp; broken']],
                ],
            }],
        }
        errors, facts = build_songbook.validate_songbook(book)
        joined = '\n'.join(errors)
        self.assertIn('missing titles', joined)
        self.assertIn('missing artists', joined)
        self.assertIn('invalid levels', joined)
        self.assertIn('invalid durations', joined)
        self.assertIn('blank lines encoded as empty text', joined)
        self.assertIn('chord tokens missing brackets', joined)
        self.assertIn('pre lines must be single-token', joined)
        self.assertIn('leftover html entities', joined)
        self.assertTrue(facts['bad_blank'])

    def test_find_book_dirs_accepts_root_and_single_book(self):
        self.assertEqual(build_songbook.find_book_dirs(FIXTURE), [FIXTURE])
        root = os.path.dirname(FIXTURE)
        self.assertEqual(build_songbook.find_book_dirs(root), [FIXTURE])


if __name__ == '__main__':
    unittest.main(verbosity=2)
