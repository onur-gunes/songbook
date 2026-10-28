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

    def test_escaped_brackets_and_edge_whitespace_are_preserved(self):
        self.assertEqual(
            chordpro.parse_line('  \\[Refren\\] [C]x  '),
            [['x', '  [Refren] '], ['c', '[C]'], ['x', 'x  ']],
        )


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

    def test_id_and_chords_can_be_overridden(self):
        warnings = []
        song = chordpro.parse_song(
            '{title: Some Long Title}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{id: stable-legacy-id}\n{chords: Am, C}\n[C]one [Am]two',
            warnings=warnings,
        )
        self.assertEqual(song['id'], 'stable-legacy-id')
        self.assertEqual(song['chords'], ['Am', 'C'])
        self.assertEqual(warnings, [])

    def test_invalid_id_is_slugified_with_warning(self):
        warnings = []
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{id: Not A Slug!}\n[C]x',
            warnings=warnings,
        )
        self.assertEqual(song['id'], 'not-a-slug')
        self.assertTrue(any('invalid id' in w for w in warnings))

    def test_chords_override_mismatch_warns(self):
        warnings = []
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{chords: Am, F}\n[C]x',
            warnings=warnings,
        )
        self.assertEqual(song['chords'], ['Am', 'F'])
        self.assertTrue(any('chords override differs' in w for w in warnings))

    def test_trusted_note_keeps_trusted_y_token_when_allowed(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{trusted_note: Refren:}\n[C]x',
            allow_trusted_notes=True,
        )
        self.assertEqual(song['sheet'][0], [['y', 'Refren:']])

    def test_trusted_note_is_ignored_by_default(self):
        warnings = []
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{trusted_note: Refren:}\n[C]x',
            warnings=warnings,
        )
        self.assertEqual(song['sheet'], [[['c', '[C]'], ['x', 'x']]])
        self.assertTrue(any('trusted_note ignored' in w for w in warnings))

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

    def test_tempo_and_time_directives(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{tempo: 92}\n{time: 3/4}\n[C]x'
        )
        self.assertEqual(song['bpm'], 92)
        self.assertEqual(song['time'], '3/4')

    def test_bpm_and_meter_aliases(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{bpm: 120}\n{meter: 6/8}\n[C]x'
        )
        self.assertEqual(song['bpm'], 120)
        self.assertEqual(song['time'], '6/8')

    def test_tempo_and_time_are_absent_when_not_given(self):
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n[C]x'
        )
        self.assertNotIn('bpm', song)
        self.assertNotIn('time', song)

    def test_invalid_tempo_and_time_warn_and_keep_raw(self):
        # Kept verbatim on purpose: validate_songbook turns these into build
        # errors, so a bad tempo fails the build instead of silently vanishing.
        warnings = []
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{tempo: fast}\n{time: 9/4}\n[C]x',
            warnings=warnings,
        )
        self.assertEqual(song['bpm'], 'fast')
        self.assertEqual(song['time'], '9/4')
        self.assertTrue(any('invalid tempo' in w for w in warnings))
        self.assertTrue(any('invalid time signature' in w for w in warnings))

    def test_out_of_range_tempo_warns(self):
        warnings = []
        song = chordpro.parse_song(
            '{title: T}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
            '{tempo: 400}\n[C]x',
            warnings=warnings,
        )
        self.assertEqual(song['bpm'], '400')
        self.assertTrue(any('invalid tempo' in w for w in warnings))

    def test_parse_bpm_bounds_and_rounding(self):
        self.assertEqual(chordpro.parse_bpm('92.4'), 92)
        self.assertEqual(chordpro.parse_bpm(20), 20)
        self.assertEqual(chordpro.parse_bpm(300), 300)
        self.assertIsNone(chordpro.parse_bpm(19))
        self.assertIsNone(chordpro.parse_bpm(301))
        self.assertIsNone(chordpro.parse_bpm(True))
        self.assertIsNone(chordpro.parse_bpm('fast'))
        self.assertIsNone(chordpro.parse_bpm(''))

    def test_parse_time_allowlist(self):
        self.assertEqual(chordpro.parse_time('4/4'), '4/4')
        self.assertEqual(chordpro.parse_time(' 6/8 '), '6/8')
        self.assertIsNone(chordpro.parse_time('9/4'))
        self.assertIsNone(chordpro.parse_time('common'))
        self.assertIsNone(chordpro.parse_time(None))

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

    def test_bom_and_instrument_normalization(self):
        with tempfile.TemporaryDirectory() as tmp:
            book_dir = os.path.join(tmp, 'bom-book')
            songbooks = os.path.join(tmp, 'songbooks')
            os.makedirs(book_dir)
            with open(os.path.join(book_dir, 'book.json'), 'w', encoding='utf-8-sig') as f:
                json.dump({'id': 'bom-book', 'name': 'BOM Book', 'description': 'x',
                           'instrument': 'Ukulele'}, f)
            with open(os.path.join(book_dir, '01-bom.cho'), 'w', encoding='utf-8-sig') as f:
                f.write('{title: BOM Song}\n{artist: A}\n{level: Easy}\n'
                        '{duration: 1}\n[C]lyric\n')

            result = build_songbook.build_book(
                book_dir, out_dir=songbooks,
                index_path=os.path.join(songbooks, 'index.json'),
                report_path=os.path.join(tmp, 'report.txt'), chord_check=False)

            self.assertEqual(result['errors'], [])
            self.assertEqual(result['book']['instrument'], 'ukulele')
            self.assertEqual(result['book']['songs'][0]['title'], 'BOM Song')
            self.assertEqual(result['book']['songs'][0]['sheet'][0][1], ['x', 'lyric'])
            self.assertNotIn('\ufeff', result['report'])

    def test_invalid_instrument_is_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            book_dir = os.path.join(tmp, 'bad-instrument')
            songbooks = os.path.join(tmp, 'songbooks')
            os.makedirs(book_dir)
            with open(os.path.join(book_dir, 'book.json'), 'w', encoding='utf-8') as f:
                json.dump({'id': 'bad-instrument', 'name': 'Bad Instrument',
                           'description': 'x', 'instrument': 'mandolin'}, f)
            with open(os.path.join(book_dir, '01-song.cho'), 'w', encoding='utf-8') as f:
                f.write('{title: Song}\n{artist: A}\n{level: Easy}\n'
                        '{duration: 1}\n[C]lyric\n')

            result = build_songbook.build_book(
                book_dir, out_dir=songbooks,
                index_path=os.path.join(songbooks, 'index.json'),
                report_path=os.path.join(tmp, 'report.txt'), chord_check=True)

            self.assertTrue(any('invalid instrument' in e for e in result['errors']))
            self.assertFalse(os.path.exists(result['output']))
            self.assertFalse(os.path.exists(os.path.join(songbooks, 'index.json')))
            self.assertIn('chord engine (n/a): skipped (invalid instrument)', result['report'])
            self.assertIn('wrote: not written', result['report'])

    def test_validation_errors_are_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            book_dir = os.path.join(tmp, 'bad-song')
            songbooks = os.path.join(tmp, 'songbooks')
            os.makedirs(book_dir)
            with open(os.path.join(book_dir, 'book.json'), 'w', encoding='utf-8') as f:
                json.dump({'id': 'bad-song', 'name': 'Bad Song',
                           'description': 'x', 'instrument': 'ukulele'}, f)
            with open(os.path.join(book_dir, '01-song.cho'), 'w', encoding='utf-8') as f:
                f.write('{artist: A}\n{level: Easy}\n{duration: 1}\n[C]lyric\n')

            result = build_songbook.build_book(
                book_dir, out_dir=songbooks,
                index_path=os.path.join(songbooks, 'index.json'),
                report_path=os.path.join(tmp, 'report.txt'), chord_check=False)

            self.assertTrue(any('missing titles' in e for e in result['errors']))
            self.assertFalse(os.path.exists(result['output']))
            self.assertFalse(os.path.exists(os.path.join(songbooks, 'index.json')))
            self.assertIn('wrote: not written', result['report'])

    def test_bad_tempo_is_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            book_dir = os.path.join(tmp, 'bad-tempo')
            songbooks = os.path.join(tmp, 'songbooks')
            os.makedirs(book_dir)
            with open(os.path.join(book_dir, 'book.json'), 'w', encoding='utf-8') as f:
                json.dump({'id': 'bad-tempo', 'name': 'Bad Tempo',
                           'description': 'x', 'instrument': 'ukulele'}, f)
            with open(os.path.join(book_dir, '01-song.cho'), 'w', encoding='utf-8') as f:
                f.write('{title: Song}\n{artist: A}\n{level: Easy}\n{duration: 1}\n'
                        '{tempo: fast}\n{time: 9/4}\n[C]lyric\n')

            result = build_songbook.build_book(
                book_dir, out_dir=songbooks,
                index_path=os.path.join(songbooks, 'index.json'),
                report_path=os.path.join(tmp, 'report.txt'), chord_check=False)

            self.assertTrue(any('invalid bpm' in e for e in result['errors']))
            self.assertTrue(any('invalid time signatures' in e for e in result['errors']))
            self.assertFalse(os.path.exists(result['output']))
            self.assertIn('wrote: not written', result['report'])

    def test_tempo_sidecar_merges_and_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            book_dir = os.path.join(tmp, 'tempo-book')
            songbooks = os.path.join(tmp, 'songbooks')
            os.makedirs(book_dir)
            with open(os.path.join(book_dir, 'book.json'), 'w', encoding='utf-8') as f:
                json.dump({'id': 'tempo-book', 'name': 'Tempo Book',
                           'description': 'x', 'instrument': 'ukulele'}, f)
            with open(os.path.join(book_dir, '01-song.cho'), 'w', encoding='utf-8') as f:
                f.write('{title: Song}\n{artist: A}\n{level: Easy}\n'
                        '{duration: 1}\n[C]lyric\n')
            with open(os.path.join(book_dir, '02-other.cho'), 'w', encoding='utf-8') as f:
                f.write('{title: Other}\n{artist: A}\n{level: Easy}\n'
                        '{duration: 1}\n[C]lyric\n')
            with open(os.path.join(book_dir, 'tempo.json'), 'w', encoding='utf-8') as f:
                json.dump({
                    'song': {'bpm': 92, 'time': '4/4',
                             'confidence': 'high', 'source': 'tunebat'},
                    'ghost': {'bpm': 100},
                }, f)

            result = build_songbook.build_book(
                book_dir, out_dir=songbooks,
                index_path=os.path.join(songbooks, 'index.json'),
                report_path=os.path.join(tmp, 'report.txt'), chord_check=False)

            self.assertEqual(result['errors'], [])
            songs = {s['id']: s for s in result['book']['songs']}
            self.assertEqual(songs['song']['bpm'], 92)
            self.assertEqual(songs['song']['time'], '4/4')
            # curation metadata stays in the sidecar, never in the book
            self.assertNotIn('confidence', songs['song'])
            self.assertNotIn('source', songs['song'])
            self.assertNotIn('bpm', songs['other'])
            self.assertTrue(any('tempo.json: unused ids' in w for w in result['warnings']))
            self.assertIn('tempo: 1/2 songs with bpm, 1 with time signature',
                          result['report'])

    def test_tempo_sidecar_rejects_invalid_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, 'tempo.json'), 'w', encoding='utf-8') as f:
                json.dump({
                    'ok': {'bpm': 120, 'time': '3/4'},
                    'bare': 85,
                    'bad-bpm': {'bpm': 'fast'},
                    'bad-time': {'bpm': 90, 'time': '9/4'},
                }, f)
            tempo, rejected = build_songbook.load_tempo(tmp)

            self.assertEqual(tempo['ok'], {'bpm': 120, 'time': '3/4'})
            self.assertEqual(tempo['bare'], {'bpm': 85})
            self.assertNotIn('bad-bpm', tempo)
            self.assertEqual(tempo['bad-time'], {'bpm': 90})
            self.assertEqual(len(rejected), 2)

    def test_tempo_sidecar_absent_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(build_songbook.load_tempo(tmp), ({}, []))

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

    def test_original_keys_sidecar_is_merged(self):
        with tempfile.TemporaryDirectory() as tmp:
            book_dir = os.path.join(tmp, 'keys-book')
            songbooks = os.path.join(tmp, 'songbooks')
            os.makedirs(book_dir)
            with open(os.path.join(book_dir, 'book.json'), 'w', encoding='utf-8') as f:
                json.dump({'id': 'keys-book', 'name': 'Keys Book',
                           'description': 'x', 'instrument': 'ukulele'}, f)
            with open(os.path.join(book_dir, '01-song.cho'), 'w', encoding='utf-8') as f:
                f.write('{title: Song}\n{artist: A}\n{level: Easy}\n'
                        '{duration: 1}\n[C]lyric\n')
            with open(os.path.join(book_dir, 'original-keys.json'), 'w',
                      encoding='utf-8') as f:
                json.dump({'song': {'key': 'D', 'sheetKey': 'C', 'capo': 2,
                                    'source': 'test'}}, f)

            result = build_songbook.build_book(
                book_dir, out_dir=songbooks,
                index_path=os.path.join(songbooks, 'index.json'),
                report_path=os.path.join(tmp, 'report.txt'), chord_check=False)

            self.assertEqual(result['errors'], [])
            song = result['book']['songs'][0]
            self.assertEqual(song['key'], 'D')
            self.assertEqual(song['sheetKey'], 'C')
            self.assertEqual(song['capo'], 2)

    def test_original_keys_ignore_boolean_capo(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, 'original-keys.json'), 'w',
                      encoding='utf-8') as f:
                json.dump({'song': {'key': 'D', 'capo': True}}, f)
            keys = build_songbook.load_original_keys(tmp)
            self.assertEqual(keys['song'], {'key': 'D'})

    def test_bundled_polish_book_rebuilds_from_chordpro(self):
        source = os.path.join(ROOT, 'chordpro', 'polska-gurom')
        committed = os.path.join(ROOT, 'songbooks', 'polska-gurom.json')
        with tempfile.TemporaryDirectory() as tmp:
            result = build_songbook.build_book(
                source, out_dir=os.path.join(tmp, 'songbooks'),
                index_path=os.path.join(tmp, 'songbooks', 'index.json'),
                report_path=os.path.join(tmp, 'report.txt'), chord_check=False,
                allow_trusted_notes=True)
            self.assertEqual(result['errors'], [])
            self.assertTrue(any('049-love-story.cho: chords override differs' in w
                                for w in result['warnings']))
            with open(committed, encoding='utf-8') as f:
                expected = f.read()
            with open(result['output'], encoding='utf-8') as f:
                actual = f.read()
            self.assertEqual(actual, expected)

    def test_find_book_dirs_accepts_root_and_single_book(self):
        self.assertEqual(build_songbook.find_book_dirs(FIXTURE), [FIXTURE])
        root = os.path.dirname(FIXTURE)
        self.assertEqual(build_songbook.find_book_dirs(root), [FIXTURE])


if __name__ == '__main__':
    unittest.main(verbosity=2)
