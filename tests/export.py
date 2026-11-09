#!/usr/bin/env python3
"""Unit tests for the effective-song serialiser and export file names (#111).

The serialiser lives in js/export.js. These tests load the app modules under
node (the same way tests/plan.py does), merge a local edit plan into a song,
and assert that:

  - metadata, sheet, effective grid, time, strum defaults, section strums and
    custom patterns are carried through;
  - bar/beat overrides are flattened into grid[].bars[].strums, one entry per
    felt beat, with a canonical role on every block;
  - a song with no authored grid gets the same auto-generated grid the chart
    shows;
  - downloaded names end with YYYYMMDD-HHMMSS;
  - the exported song passes the Step 7 build validator and normalizeSongbook,
    including the auto-generated grid case.

Usage:
    python3 tests/export.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_songbook  # noqa: E402

SONGBOOKS_JS = os.path.join(ROOT, 'js', 'songbooks.js')
SECTIONS_JS = os.path.join(ROOT, 'js', 'sections.js')
GRID_JS = os.path.join(ROOT, 'js', 'grid.js')
PLAN_JS = os.path.join(ROOT, 'js', 'personal.js')
STRUM_JS = os.path.join(ROOT, 'js', 'strum.js')
EXPORT_JS = os.path.join(ROOT, 'js', 'export.js')

SONG = {
    'id': 'harbour-lights',
    'n': 1,
    'title': 'Harbour Lights',
    'artist': 'The Artist',
    'level': 'Easy',
    'new': False,
    'key': 'C',
    'sheetKey': 'C',
    'capo': 0,
    'dur': 3.0,
    'bpm': 100,
    'time': '4/4',
    'strum': 'downs-4-4',
    'chords': ['C', 'G', 'Am', 'F'],
    'sheet': [
        [['i', 'Verse 1']],
        [['c', '[C]'], ['x', ' lights '], ['c', '[G]'], ['x', 'burn']],
    ],
    'grid': [{
        'label': 'Verse 1',
        'role': 'verse',
        'repeat': False,
        'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}],
    }],
}

PLAN = {
    'version': 1,
    'songStrum': 'dduudu-4-4',
    'sectionStrums': {'verse': 'custom-1'},
    'customPatterns': [{
        'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
        'subdiv': 2, 'slots': 'DUDUDUDU',
    }],
    'barStrums': {'0:0': 'dddudu-4-4'},
    'beatStrums': {'0:0:1': 'UU'},
    'grid': [{
        'label': 'Verse 1', 'role': 'verse',
        'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}],
    }],
    'time': '4/4',
}

AUTO_SONG = {
    'id': 'auto-grid',
    'n': 2,
    'title': 'Auto Grid',
    'artist': 'The Artist',
    'level': 'Medium',
    'new': False,
    'key': 'G',
    'sheetKey': 'G',
    'capo': 0,
    'dur': 4.0,
    'bpm': 90,
    'time': '4/4',
    'strum': 'downs-4-4',
    'chords': ['G', 'C'],
    'sheet': [
        [['i', 'Verse 1']],
        [['c', '[G]'], ['x', ' one '], ['c', '[C]'], ['x', ' two']],
    ],
}


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def harness(extra='', local_storage=None):
    """Load the modules export.js depends on under node, then run `extra`."""
    storage_init = ''
    if local_storage is not None:
        storage_init = (
            'window.localStorage = (function () {\n'
            '  var store = ' + json.dumps(local_storage) + ';\n'
            '  return {\n'
            '    getItem: function (k) { return k in store ? store[k] : null; },\n'
            '    setItem: function (k, v) { store[k] = v; },\n'
            '    removeItem: function (k) { delete store[k]; },\n'
            '    length: Object.keys(store).length,\n'
            '    key: function (i) { return Object.keys(store)[i] || null; }\n'
            '  };\n'
            '})();\n'
        )
    return (
        'var SB = {\n'
        '  state: { active: null, strum: { notation: \'arrows\' } },\n'
        '  NS: \'songbook\',\n'
        '  SEP: \'\\u0000\',\n'
        '  DEFAULT_TIME: \'4/4\',\n'
        '  lsGet: function (k, f) {\n'
        '    try { var v = window.localStorage.getItem(k); return v === null ? f : JSON.parse(v); }\n'
        '    catch (e) { return f; }\n'
        '  },\n'
        '  lsSet: function (k, v) {\n'
        '    try { window.localStorage.setItem(k, JSON.stringify(v)); }\n'
        '    catch (e) { /* ignore */ }\n'
        '  },\n'
        '  metronomeBeatsPerBar: function (t) {\n'
        '    var b = { \'4/4\': 4, \'3/4\': 3, \'6/8\': 2, \'2/4\': 2 };\n'
        '    return b[t] || 4;\n'
        '  }\n'
        '};\n'
        'var document = { body: {} };\n'
        'var window = { SB: SB, document: document, location: { pathname: \'/songbook/\', protocol: \'https:\' } };\n'
        + storage_init
        + read(SONGBOOKS_JS)
        + '\n' + read(SECTIONS_JS)
        + '\n' + read(GRID_JS)
        + '\n' + read(PLAN_JS)
        + '\n' + read(STRUM_JS)
        + '\n' + read(EXPORT_JS)
        + '\n' + extra
    )


def run_js(extra, local_storage=None):
    script = harness(extra, local_storage)
    try:
        with tempfile.NamedTemporaryFile(
                'w', suffix='.js', delete=False, dir=ROOT) as fh:
            fh.write(script)
            tmp = fh.name
        try:
            out = subprocess.run(
                ['node', tmp], capture_output=True, text=True, check=True,
                cwd=ROOT)
        finally:
            os.unlink(tmp)
    except subprocess.CalledProcessError as e:
        print('NODE STDERR:', e.stderr, file=sys.stderr)
        raise
    return json.loads(out.stdout)


def effective(song, plan):
    return run_js('''
        console.log(JSON.stringify(SB.effectiveSong(%s, %s)));
    ''' % (json.dumps(song), json.dumps(plan)))


class EffectiveSongTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_merges_metadata_plan_and_effective_grid(self):
        got = effective(SONG, PLAN)
        self.assertEqual(got['id'], 'harbour-lights')
        self.assertEqual(got['title'], 'Harbour Lights')
        self.assertEqual(got['time'], '4/4')
        self.assertEqual(got['strum'], 'dduudu-4-4')
        self.assertEqual(got['sectionStrums'], {'verse': 'custom-1'})
        self.assertEqual(got['strumPatterns'], [{
            'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
            'subdiv': 2, 'slots': 'DUDUDUDU'}])
        self.assertEqual(got['sheet'], SONG['sheet'])
        self.assertEqual(got['grid'][0]['role'], 'verse')
        self.assertEqual(got['grid'][0]['label'], 'Verse 1')
        # One slot string per felt beat; the bar override supplies beats 0/2/3
        # and the beat override replaces beat 1.
        self.assertEqual(got['grid'][0]['bars'][0]['strums'],
                         ['D-', 'UU', 'DU', 'DU'])

    def test_auto_grid_is_generated_when_the_song_has_none(self):
        got = effective(AUTO_SONG, {
            'version': 1, 'songStrum': None, 'sectionStrums': {},
            'customPatterns': [], 'barStrums': {}, 'beatStrums': {},
            'grid': None, 'time': None,
        })
        self.assertIn('grid', got)
        self.assertTrue(got['grid'])
        self.assertEqual(got['grid'][0]['role'], 'verse')
        self.assertEqual(len(got['grid'][0]['bars']), 2)
        for bar in got['grid'][0]['bars']:
            self.assertEqual(sum(seg['beats'] for seg in bar['beats']), 4)
            self.assertNotIn('strums', bar)

    def test_wrong_metre_patterns_are_dropped_not_exported(self):
        got = effective(SONG, {
            'version': 1,
            'songStrum': 'waltz-3-4',          # 3/4 on a 4/4 song
            'sectionStrums': {'verse': 'waltz-3-4', 'chorus': 'downs-4-4'},
            'customPatterns': [{
                'id': 'custom-1', 'name': 'Mine', 'time': '3/4',
                'subdiv': 2, 'slots': 'DUDUDU',
            }],
            'barStrums': {}, 'beatStrums': {}, 'grid': None, 'time': None,
        })
        # Falls back to the song's own documented default.
        self.assertEqual(got['strum'], 'downs-4-4')
        self.assertEqual(got['sectionStrums'], {'chorus': 'downs-4-4'})
        self.assertNotIn('strumPatterns', got)

    def test_structural_edits_and_time_override_are_exported(self):
        plan = dict(PLAN)
        plan['time'] = '3/4'
        plan['grid'] = [{
            'label': 'Verse 1', 'role': 'verse',
            'bars': [{'beats': [{'chord': 'C', 'beats': 3}]}],
        }]
        plan['barStrums'] = {}
        plan['beatStrums'] = {}
        song = dict(SONG)
        got = effective(song, plan)
        self.assertEqual(got['time'], '3/4')
        self.assertEqual(got['grid'][0]['bars'][0]['beats'],
                         [{'chord': 'C', 'beats': 3}])

    def test_exported_song_passes_the_build_validator(self):
        got = effective(SONG, PLAN)
        book = {
            'id': 'demo', 'name': 'Demo', 'description': '',
            'instrument': 'ukulele', 'songs': [got],
        }
        errors, facts = build_songbook.validate_songbook(book)
        self.assertEqual(errors, [], errors)
        self.assertEqual(facts['with_strum_patterns'], 1)
        self.assertEqual(facts['with_section_strums'], 1)

    def test_auto_grid_export_passes_the_build_validator(self):
        got = effective(AUTO_SONG, {
            'version': 1, 'songStrum': None, 'sectionStrums': {},
            'customPatterns': [], 'barStrums': {}, 'beatStrums': {},
            'grid': None, 'time': None,
        })
        book = {
            'id': 'demo', 'name': 'Demo', 'description': '',
            'instrument': 'ukulele', 'songs': [got],
        }
        errors, _ = build_songbook.validate_songbook(book)
        self.assertEqual(errors, [], errors)

    def test_exported_song_round_trips_through_normalize_songbook(self):
        got = run_js('''
            var eff = SB.effectiveSong(%s, %s);
            var book = SB.normalizeSongbook({ id: 'demo', name: 'Demo',
                songs: [JSON.parse(JSON.stringify(eff))] });
            console.log(JSON.stringify(book.songs[0]));
        ''' % (json.dumps(SONG), json.dumps(PLAN)))
        self.assertEqual(got['strum'], 'dduudu-4-4')
        self.assertEqual(got['sectionStrums'], {'verse': 'custom-1'})
        self.assertEqual([p['id'] for p in got['strumPatterns']], ['custom-1'])
        self.assertEqual(got['grid'][0]['role'], 'verse')
        self.assertEqual(got['grid'][0]['bars'][0]['strums'],
                         ['D-', 'UU', 'DU', 'DU'])

    def test_songbook_export_applies_every_songs_plan(self):
        second = dict(AUTO_SONG)
        second['id'] = 'second'
        second['n'] = 2
        plan2 = {
            'version': 1, 'songStrum': 'eighths-4-4', 'sectionStrums': {},
            'customPatterns': [], 'barStrums': {}, 'beatStrums': {},
            'grid': None, 'time': None,
        }
        storage = {
            'songbook:plan:demo\x00harbour-lights': json.dumps(PLAN),
            'songbook:plan:demo\x00second': json.dumps(plan2),
        }
        got = run_js('''
            var sb = { id: 'demo', name: 'Demo', description: '',
                instrument: 'ukulele', songs: [%s, %s] };
            console.log(JSON.stringify(SB.effectiveSongbook(sb)));
        ''' % (json.dumps(SONG), json.dumps(second)), storage)
        self.assertEqual(got['id'], 'demo')
        self.assertNotIn('imported', got)
        self.assertEqual(got['songs'][0]['strum'], 'dduudu-4-4')
        self.assertEqual(got['songs'][1]['strum'], 'eighths-4-4')
        self.assertTrue(got['songs'][1]['grid'])


class FilenameTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_names_use_local_time_and_a_timestamp(self):
        got = run_js('''
            console.log(JSON.stringify({
                song: SB.exportFilename('harbour-lights',
                    new Date(2026, 10, 8, 13, 45, 0)),
                book: SB.exportFilename('demo',
                    new Date(2026, 10, 8, 13, 45, 5)),
                padded: SB.exportFilename('Harbour Lights!!',
                    new Date(2026, 0, 2, 3, 4, 5))
            }));
        ''')
        self.assertEqual(got['song'], 'harbour-lights-20261108-134500.json')
        self.assertEqual(got['book'], 'demo-20261108-134505.json')
        self.assertEqual(got['padded'], 'harbour-lights-20260102-030405.json')


if __name__ == '__main__':
    unittest.main(verbosity=2)
