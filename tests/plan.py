#!/usr/bin/env python3
"""Unit tests for the per-song edit plan (issue #105).

The plan object lives in js/personal.js, exposed through songbookTest. These
tests load js/core.js, js/sections.js, js/songbooks.js, js/personal.js and
js/strum.js under node, build a plan, round-trip it through JSON, and assert
the precedence:

    beat > bar > section role > manual song default > song default

They also cover migration of corrupt / unknown-version plans, clearing, and
that manual SB.strumKey choices are migrated into the plan rather than lost.

Usage:
    python3 tests/plan.py
"""
import json
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

PLAN_JS = os.path.join(ROOT, 'js', 'personal.js')
CORE_JS = os.path.join(ROOT, 'js', 'core.js')
SECTIONS_JS = os.path.join(ROOT, 'js', 'sections.js')
SONGBOOKS_JS = os.path.join(ROOT, 'js', 'songbooks.js')
STRUM_JS = os.path.join(ROOT, 'js', 'strum.js')

SONG = {
    'id': 'song-1',
    'title': 'Demo',
    'time': '4/4',
    'strum': 'downs-4-4',
    'grid': [
        {'label': 'Verse 1', 'role': 'verse', 'bars': [{'beats': []}, {'beats': []}]},
        {'label': 'Chorus 1', 'role': 'chorus', 'bars': [{'beats': []}]},
    ],
}


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def harness(extra='', local_storage=None):
    """Build a node script that stubs SB/window/localStorage, loads the app
    modules, runs `extra`, and console.logs its result as JSON."""
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
        'var SB = { state: {} };\n'
        'var document = { body: {} };\n'
        'var window = { SB: SB, document: document, location: { pathname: \'/songbook/\', protocol: \'https:\' } };\n'
        + storage_init
        + read(CORE_JS)
        + '\n' + read(SECTIONS_JS)
        + '\n' + read(SONGBOOKS_JS)
        + '\n' + read(PLAN_JS)
        + '\n' + read(STRUM_JS)
        + '\n' + extra
    )


def run_js(extra, local_storage=None):
    out = subprocess.run(
        ['node', '-e', harness(extra, local_storage)],
        capture_output=True, text=True, check=True, cwd=ROOT)
    return json.loads(out.stdout)


class PlanRoundTripTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_empty_plan_is_all_defaults(self):
        got = run_js('''
            var p = SB.emptyPlan();
            console.log(JSON.stringify(p));
        ''')
        self.assertEqual(got['version'], 1)
        self.assertEqual(got['songStrum'], None)
        self.assertEqual(got['sectionStrums'], {})
        self.assertEqual(got['customPatterns'], [])
        self.assertEqual(got['barStrums'], {})
        self.assertEqual(got['beatStrums'], {})
        self.assertEqual(got['grid'], None)
        self.assertEqual(got['time'], None)

    def test_missing_version_becomes_v1(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan({ songStrum: 'dddudu-4-4' })));
        ''')
        self.assertEqual(got['version'], 1)
        self.assertEqual(got['songStrum'], 'dddudu-4-4')

    def test_version_zero_is_accepted(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan({ version: 0, songStrum: 'downs-4-4' })));
        ''')
        self.assertEqual(got['version'], 1)
        self.assertEqual(got['songStrum'], 'downs-4-4')

    def test_newer_version_is_rejected(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan({ version: 9, songStrum: 'downs-4-4' })));
        ''')
        self.assertEqual(got['songStrum'], None)
        self.assertEqual(got['sectionStrums'], {})

    def test_corrupt_storage_gives_an_empty_plan(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan('not json at all')));
        ''')
        self.assertEqual(got, run_js('''console.log(JSON.stringify(SB.emptyPlan()));'''))

    def test_plan_object_round_trips(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan({
                version: 1,
                songStrum: 'ddudu-4-4',
                sectionStrums: { verse: 'dduudu-4-4' },
                customPatterns: [{ id: 'c1', name: 'Mine', time: '4/4',
                    subdiv: 2, slots: 'D-DUD-DU' }],
                barStrums: { '0:0': 'dddudu-4-4' },
                beatStrums: { '0:0:1': 'DU-U' },
                grid: [{ label: 'Verse 1', bars: [{ beats: [] }] }],
                time: '3/4',
            })));
        ''')
        self.assertEqual(got['songStrum'], 'ddudu-4-4')
        self.assertEqual(got['sectionStrums'], {'verse': 'dduudu-4-4'})
        self.assertEqual(got['customPatterns'], [{
            'id': 'c1', 'name': 'Mine', 'time': '4/4', 'subdiv': 2,
            'slots': 'D-DUD-DU'}])
        self.assertEqual(got['barStrums'], {'0:0': 'dddudu-4-4'})
        self.assertEqual(got['beatStrums'], {'0:0:1': 'DU-U'})
        self.assertEqual(got['time'], '3/4')

    def test_invalid_custom_patterns_are_dropped(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan({
                customPatterns: [
                    { id: 'bad', time: '4/4', subdiv: 2, slots: 'XYZ' },
                    { id: 'ok', name: 'Ok', time: '4/4', subdiv: 2, slots: 'DUDU' },
                    { id: 'ok', name: 'dup', time: '4/4', subdiv: 2, slots: 'DUDU' },
                    { id: 123, time: '4/4', subdiv: 2, slots: 'DUDU' },
                    null,
                ],
            })));
        ''')
        self.assertEqual(got['customPatterns'], [{
            'id': 'ok', 'name': 'Ok', 'time': '4/4', 'subdiv': 2, 'slots': 'DUDU'}])

    def test_non_metre_time_is_dropped(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan({ time: '7/4' })));
        ''')
        self.assertEqual(got['time'], None)

    def test_invalid_overrides_are_dropped(self):
        got = run_js('''
            console.log(JSON.stringify(SB.normalizePlan({
                barStrums: { '0:0': 'downs-4-4', __proto__: 'evil', '': 'x', '0:1': '' },
                beatStrums: { '0:0:0': 'DU', '0:0:1': 'XY', bad: 'D' },
            })));
        ''')
        self.assertEqual(got['barStrums'], {'0:0': 'downs-4-4'})
        self.assertEqual(got['beatStrums'], {'0:0:0': 'DU'})

    def test_save_load_clear_plan_round_trips(self):
        got = run_js('''
            var plan = SB.emptyPlan();
            plan.songStrum = 'dddudu-4-4';
            plan.sectionStrums = { chorus: 'ddudu-4-4' };
            SB.savePlan('sb', 'song', plan);
            var loaded = SB.loadPlan('sb', 'song');
            SB.clearPlan('sb', 'song');
            var after = SB.loadPlan('sb', 'song');
            console.log(JSON.stringify({
                loaded: loaded,
                edits: SB.hasLocalEdits(loaded),
                after: after,
                afterEdits: SB.hasLocalEdits('sb', 'song')
            }));
        ''', {'songbook:plan:sb\0song': '{"version":1,"songStrum":null,"sectionStrums":{},"customPatterns":[],"barStrums":{},"beatStrums":{}}'})
        self.assertEqual(got['loaded']['songStrum'], 'dddudu-4-4')
        self.assertEqual(got['loaded']['sectionStrums'], {'chorus': 'ddudu-4-4'})
        self.assertTrue(got['edits'])
        self.assertEqual(got['after']['songStrum'], None)
        self.assertFalse(got['afterEdits'])

    def test_seed_from_legacy_strum_key(self):
        got = run_js('''
            window.localStorage.setItem(SB.strumKey('sb', 'song-1'), 'dddudu-4-4');
            var plan = SB.loadPlan('sb', 'song-1');
            console.log(JSON.stringify(plan));
        ''', {'songbook:strum:sb\0song-1': '"dddudu-4-4"'})
        self.assertEqual(got['songStrum'], 'dddudu-4-4')
        self.assertEqual(got['version'], 1)

    def test_has_local_edits_accepts_sb_and_song(self):
        got = run_js('''
            SB.savePlan('sb', 'song', { version: 1, songStrum: 'x' });
            var a = SB.hasLocalEdits('sb', 'song');
            SB.clearPlan('sb', 'song');
            var b = SB.hasLocalEdits('sb', 'song');
            console.log(JSON.stringify([a, b]));
        ''', {})
        self.assertEqual(got, [True, False])


class PlanPrecedenceTests(unittest.TestCase):
    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def default_plan(self):
        return {'version': 1, 'songStrum': None, 'sectionStrums': {},
                'customPatterns': [], 'barStrums': {}, 'beatStrums': {},
                'grid': None, 'time': None}

    def test_beat_override_wins_over_bar_and_section(self):
        # A beat override replaces just that beat's slots (2 slots for 4/4),
        # but keeps the id of the pattern the bar/section resolved to.
        plan = dict(self.default_plan())
        plan['sectionStrums'] = {'verse': 'dddudu-4-4'}
        plan['barStrums'] = {'0:0': 'ddudu-4-4'}
        plan['beatStrums'] = {'0:0:2': 'DU'}
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 2 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id, slots: r.slots }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, {'source': 'beat', 'id': 'ddudu-4-4', 'slots': 'DU'})

    def test_bar_override_wins_over_section(self):
        plan = dict(self.default_plan())
        plan['sectionStrums'] = {'verse': 'dddudu-4-4'}
        plan['barStrums'] = {'0:0': 'ddudu-4-4'}
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, {'source': 'bar', 'id': 'ddudu-4-4'})

    def test_section_override_wins_over_song_default(self):
        plan = dict(self.default_plan())
        plan['sectionStrums'] = {'chorus': 'ddudu-4-4'}
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 1, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, {'source': 'section', 'id': 'ddudu-4-4'})

    def test_manual_song_default_wins_over_song_strum(self):
        plan = dict(self.default_plan())
        plan['songStrum'] = 'dddudu-4-4'
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, {'source': 'manual', 'id': 'dddudu-4-4'})

    def test_legacy_strum_key_is_migrated_and_wins_over_song_strum(self):
        got = run_js('''
            window.localStorage.setItem(SB.strumKey('sb', 'song-1'), 'dddudu-4-4');
            var song = %s;
            var plan = SB.loadPlan('sb', 'song-1');
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id }));
        ''' % json.dumps(SONG), {'songbook:strum:sb\0song-1': '"dddudu-4-4"'})
        self.assertEqual(got, {'source': 'manual', 'id': 'dddudu-4-4'})

    def test_song_default_wins_over_fallback(self):
        plan = dict(self.default_plan())
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, {'source': 'song', 'id': 'downs-4-4'})

    def test_fallback_when_nothing_fits(self):
        song = dict(SONG); song['strum'] = 'not-a-pattern'
        plan = dict(self.default_plan())
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id }));
        ''' % (json.dumps(song), json.dumps(plan)))
        self.assertEqual(got, {'source': 'fallback', 'id': 'downs-4-4'})

    def test_beat_override_slots_line_up_with_subdivision(self):
        plan = dict(self.default_plan())
        plan['beatStrums'] = {'0:0:1': 'DU'}
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 1 }, plan);
            console.log(JSON.stringify({ source: r.source, slots: r.slots, subdiv: r.subdiv }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, {'source': 'beat', 'slots': 'DU', 'subdiv': 2})

    def test_invalid_beat_override_falls_back(self):
        # 'XY' is dropped by normalization, so beat 1 inherits from the song.
        plan = dict(self.default_plan())
        plan['beatStrums'] = {'0:0:1': 'XY'}
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 1 }, plan);
            console.log(JSON.stringify({ source: r.source, slots: r.slots }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got['source'], 'song')
        self.assertEqual(got['slots'], 'D-')

    def test_no_song_gives_none(self):
        got = run_js('''
            var r = SB.resolveStrumAt(null, { block: 0, bar: 0, beat: 0 }, {});
            console.log(JSON.stringify({ source: r.source, id: r.id }));
        ''')
        self.assertEqual(got, {'source': 'none', 'id': None})

    def test_plan_song_strum_is_not_persisted_into_song_data(self):
        plan = dict(self.default_plan())
        plan['songStrum'] = 'dddudu-4-4'
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ after: song.strum, id: r.id }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got['after'], 'downs-4-4')
        self.assertEqual(got['id'], 'dddudu-4-4')


if __name__ == '__main__':
    unittest.main(verbosity=2)
