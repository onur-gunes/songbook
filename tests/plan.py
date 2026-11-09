#!/usr/bin/env python3
"""Unit tests for the per-song edit plan (issue #105), custom strum patterns
(issue #106) and per-section strum selectors (issue #107).

The plan object lives in js/personal.js, exposed through songbookTest. These
tests load js/sections.js, js/grid.js, js/personal.js and js/strum.js under
node, build a plan, round-trip it through JSON, and assert the precedence:

    beat > bar > section role > manual song default > song default

They also cover migration of corrupt / unknown-version plans, clearing, that
manual SB.strumKey choices are migrated into the plan rather than lost, and
that section roles/pattern inheritance are derived from the song's real
sections.

Usage:
    python3 tests/plan.py
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

PLAN_JS = os.path.join(ROOT, 'js', 'personal.js')
CORE_JS = os.path.join(ROOT, 'js', 'core.js')
SECTIONS_JS = os.path.join(ROOT, 'js', 'sections.js')
GRID_JS = os.path.join(ROOT, 'js', 'grid.js')
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
    """Build a node script that stubs the SB surface, loads the app modules
    under test (sections.js, personal.js, strum.js), runs `extra`, and
    console.logs its result as JSON.

    core.js is deliberately *not* loaded: it references `document` at load
    time, which does not exist under node. The existing node suites
    (env.py, strum.py) avoid loading it for the same reason. The minimal SB
    surface below is what personal.js and strum.js touch; they attach their
    own functions to window.SB.
    """
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
    sep = chr(0)
    return (
        'var SB = {\n'
        '  state: { active: null },\n'
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
        + '\n' + extra
    )


def run_js(extra, local_storage=None):
    script = harness(extra, local_storage)
    try:
        # Write the script to a temp file instead of passing it inline via
        # `node -e`: the concatenated app modules can exceed the OS argument
        # limit (ARG_MAX), especially on runners with a large environment.
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
                beatStrums: { '0:0:0': 'DU', '0:0:1': 'XY', bad: 'XY' },
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


class SectionSelectorTests(unittest.TestCase):
    """Step 4: selectors come from the song's real roles, inherit the main
    pattern until changed, and apply to every section with that role."""

    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def plan(self, **kwargs):
        plan = {'version': 1, 'songStrum': None, 'sectionStrums': {},
                'customPatterns': [], 'barStrums': {}, 'beatStrums': {},
                'grid': None, 'time': None}
        plan.update(kwargs)
        return plan

    def test_roles_are_derived_from_sheet_sections_and_deduped(self):
        song = {
            'id': 'roles', 'title': 'Roles', 'time': '4/4',
            'strum': 'downs-4-4',
            'sheet': [
                [['i', 'Verse 1']], [['c', '[C]'], ['x', 'one']],
                [['i', 'Chorus']], [['c', '[G]'], ['x', 'two']],
                [['i', 'Verse 2']], [['c', '[C]'], ['x', 'three']],
                [['i', 'Bridge']], [['c', '[F]'], ['x', 'four']],
            ],
            # Authored-only section the sheet does not cover.
            'grid': [{'label': 'Intro', 'role': 'intro',
                      'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}]}],
        }
        got = run_js('''
            var song = %s;
            console.log(JSON.stringify(SB.songSectionRoles(song)));
        ''' % json.dumps(song))
        self.assertEqual(got, ['verse', 'chorus', 'bridge', 'intro'])

    def test_roles_include_other_and_plan_grid_sections(self):
        song = {
            'id': 'roles', 'title': 'Roles', 'time': '4/4',
            'grid': [
                {'label': 'Something', 'role': 'other',
                 'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}]},
            ],
        }
        plan = self.plan(grid=[
            {'label': 'Solo', 'role': 'solo',
             'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}]},
        ])
        got = run_js('''
            var song = %s;
            var plan = %s;
            console.log(JSON.stringify(SB.songSectionRoles(song, plan)));
        ''' % (json.dumps(song), json.dumps(plan)))
        self.assertEqual(got, ['other', 'solo'])

    def test_song_with_no_sections_has_no_roles(self):
        song = {
            'id': 'plain', 'title': 'Plain', 'time': '4/4',
            'sheet': [[['c', '[C]'], ['x', 'just lyrics']]],
        }
        got = run_js('''
            var song = %s;
            console.log(JSON.stringify(SB.songSectionRoles(song)));
        ''' % json.dumps(song))
        self.assertEqual(got, [])

    def test_section_inherits_until_overridden(self):
        plan = self.plan(songStrum='dduudu-4-4')
        got = run_js('''
            var song = %s;
            var plan = %s;
            var before = SB.sectionStrumFor(song, 'verse', plan);
            plan.sectionStrums.verse = 'dddudu-4-4';
            var after = SB.sectionStrumFor(song, 'verse', plan);
            var chorus = SB.sectionStrumFor(song, 'chorus', plan);
            console.log(JSON.stringify({
                before: before.id, after: after.id, chorus: chorus.id
            }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got['before'], 'dduudu-4-4')
        self.assertEqual(got['after'], 'dddudu-4-4')
        # An untouched role still inherits the song's manual default.
        self.assertEqual(got['chorus'], 'dduudu-4-4')

    def test_same_role_shares_one_override(self):
        song = {
            'id': 'verses', 'title': 'Verses', 'time': '4/4',
            'strum': 'downs-4-4',
            'grid': [
                {'label': 'Verse 1', 'role': 'verse',
                 'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}]},
                {'label': 'Verse 2', 'role': 'verse',
                 'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}]},
            ],
        }
        plan = self.plan(sectionStrums={'verse': 'dddudu-4-4'})
        got = run_js('''
            var song = %s;
            var plan = %s;
            function at(block) {
                var r = SB.resolveStrumAt(song, { block: block, bar: 0, beat: 0 }, plan);
                return { source: r.source, id: r.id };
            }
            console.log(JSON.stringify({ one: at(0), two: at(1) }));
        ''' % (json.dumps(song), json.dumps(plan)))
        self.assertEqual(got['one'], {'source': 'section', 'id': 'dddudu-4-4'})
        self.assertEqual(got['two'], {'source': 'section', 'id': 'dddudu-4-4'})

    def test_invalid_section_override_falls_back_to_main(self):
        plan = self.plan(sectionStrums={'verse': 'waltz-3-4'})
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.sectionStrumFor(song, 'verse', plan);
            console.log(JSON.stringify(r.id));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, 'downs-4-4')

    def test_main_pattern_ignores_section_overrides(self):
        plan = self.plan(sectionStrums={'verse': 'dddudu-4-4'})
        got = run_js('''
            var song = %s;
            var plan = %s;
            console.log(JSON.stringify(SB.mainStrumFor(song, plan).id));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, 'downs-4-4')


class CustomPatternTests(unittest.TestCase):
    """Step 3 custom patterns: the full list, references and validation."""

    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def plan(self, **kwargs):
        plan = {'version': 1, 'songStrum': None, 'sectionStrums': {},
                'customPatterns': [], 'barStrums': {}, 'beatStrums': {},
                'grid': None, 'time': None}
        plan.update(kwargs)
        return plan

    def test_full_list_is_library_plus_matching_custom_patterns(self):
        plan = self.plan(customPatterns=[
            {'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
             'subdiv': 2, 'slots': 'DUDUDUDU'},
            {'id': 'custom-waltz', 'name': 'Waltz', 'time': '3/4',
             'subdiv': 2, 'slots': 'D-DUDU'},
            # Right metre, wrong slot count: not usable, so not listed.
            {'id': 'custom-short', 'name': 'Short', 'time': '4/4',
             'subdiv': 2, 'slots': 'DUDU'},
        ])
        got = run_js('''
            var song = %s;
            var plan = %s;
            var list = SB.strumPatternsForSong(song, plan);
            console.log(JSON.stringify({
                ids: list.map(function (p) { return p.id; }),
                times: list.map(function (p) { return p.time; }),
                last: list[list.length - 1].id
            }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertIn('custom-1', got['ids'])
        self.assertNotIn('custom-waltz', got['ids'])
        self.assertNotIn('custom-short', got['ids'])
        self.assertIn('downs-4-4', got['ids'])
        self.assertEqual(set(got['times']), {'4/4'})
        self.assertEqual(got['ids'].index('custom-1'), len(got['ids']) - 1)

    def test_custom_pattern_resolves_by_reference(self):
        plan = self.plan(
            songStrum='custom-1',
            customPatterns=[{'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
                             'subdiv': 2, 'slots': 'D-DUD-DU'}])
        got = run_js('''
            var song = %s;
            var plan = %s;
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({ source: r.source, id: r.id, slots: r.slots }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got, {'source': 'manual', 'id': 'custom-1', 'slots': 'D-'})

    def test_editing_a_custom_pattern_updates_every_reference(self):
        # Same id, new definition: every reference must resolve to the new
        # slots without rewriting the references themselves.
        before = self.plan(
            sectionStrums={'verse': 'custom-1'},
            barStrums={'0:0': 'custom-1'},
            customPatterns=[{'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
                             'subdiv': 2, 'slots': 'D-DUD-DU'}])
        after = self.plan(
            sectionStrums={'verse': 'custom-1'},
            barStrums={'0:0': 'custom-1'},
            customPatterns=[{'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
                             'subdiv': 2, 'slots': 'DUDUDUDU'}])
        got = run_js('''
            var song = %s;
            function get(plan, at) {
                var r = SB.resolveStrumAt(song, at, plan);
                return { id: r.id, slots: r.slots };
            }
            console.log(JSON.stringify({
                beforeBar: get(%s, { block: 0, bar: 0, beat: 2 }),
                afterBar: get(%s, { block: 0, bar: 0, beat: 2 }),
                afterSection: get(%s, { block: 0, bar: 1, beat: 0 })
            }));
        ''' % (json.dumps(SONG), json.dumps(before), json.dumps(after),
               json.dumps(after)))
        self.assertEqual(got['beforeBar'], {'id': 'custom-1', 'slots': 'D-'})
        self.assertEqual(got['afterBar'], {'id': 'custom-1', 'slots': 'DU'})
        self.assertEqual(got['afterSection'], {'id': 'custom-1', 'slots': 'DU'})

    def test_built_in_patterns_cannot_be_shadowed(self):
        plan = self.plan(
            songStrum='downs-4-4',
            customPatterns=[{'id': 'downs-4-4', 'name': 'Fake', 'time': '4/4',
                             'subdiv': 2, 'slots': 'DUDUDUDU'}])
        got = run_js('''
            var song = %s;
            var plan = %s;
            var list = SB.strumPatternsForSong(song, plan);
            var r = SB.resolveStrumAt(song, { block: 0, bar: 0, beat: 0 }, plan);
            console.log(JSON.stringify({
                ids: list.map(function (p) { return p.id; }),
                name: r.pattern.name,
                slots: r.pattern.slots
            }));
        ''' % (json.dumps(SONG), json.dumps(plan)))
        self.assertEqual(got['ids'].count('downs-4-4'), 1)
        self.assertEqual(got['name'], 'All downs')
        self.assertEqual(got['slots'], 'D-D-D-D-')

    def test_validation_messages(self):
        plan = self.plan(customPatterns=[
            {'id': 'taken', 'name': 'Taken', 'time': '4/4',
             'subdiv': 2, 'slots': 'DUDUDUDU'}])
        got = run_js('''
            var plan = %s;
            function check(p, exclude) {
                return SB.validateCustomPattern(p, plan, '4/4', exclude);
            }
            function p(over) {
                var base = { id: 'new', name: 'Mine', time: '4/4',
                             subdiv: 2, slots: 'DUDUDUDU' };
                Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
                return base;
            }
            console.log(JSON.stringify({
                ok: check(p()),
                noName: check(p({ name: '   ' })),
                wrongTime: check(p({ time: '3/4' })),
                badChar: check(p({ slots: 'DUDUDUDX' })),
                badLength: check(p({ slots: 'DUDU' })),
                duplicate: check(p({ id: 'taken' })),
                selfEdit: check(p({ id: 'taken' }), 'taken'),
                builtIn: check(p({ id: 'downs-4-4' }))
            }));
        ''' % json.dumps(plan))
        self.assertIsNone(got['ok'])
        self.assertIn('name', got['noName'])
        self.assertIn('metre', got['wrongTime'])
        self.assertIn('D (down), U (up)', got['badChar'])
        self.assertIn('needs 8 slots', got['badLength'])
        self.assertIn('already in use', got['duplicate'])
        self.assertIsNone(got['selfEdit'])
        self.assertIn('built-in', got['builtIn'])


class SongbookImportTests(unittest.TestCase):
    """Issue #110: normalizeSongbook preserves the exported per-song strum
    fields, and the runtime treats them as the songbook baseline under the
    local edit plan (so an exported song plays the same chart after import)."""

    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    SONG = {
        'id': 's1', 'title': 'Song', 'artist': 'A', 'level': 'Easy',
        'dur': 3.0, 'time': '4/4', 'strum': 'downs-4-4',
        'sectionStrums': {'verse': 'custom-1', 'chorus': 'dddudu-4-4'},
        'strumPatterns': [{
            'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
            'subdiv': 2, 'slots': 'DUDUDUDU'}],
        'grid': [{
            'label': 'Verse 1', 'role': 'verse', 'repeat': False,
            'bars': [{
                'beats': [{'chord': 'C', 'beats': 4}],
                'strums': ['DU', 'DU', 'DU', 'DU']}],
        }],
    }

    def normalize(self, **overrides):
        song = dict(self.SONG)
        song.update(overrides)
        return run_js('''
            var sb = SB.normalizeSongbook({ id: 'bk', name: 'Book',
                songs: [%s] });
            console.log(JSON.stringify(sb.songs[0]));
        ''' % json.dumps(song))

    def test_import_preserves_strums_roles_and_custom_patterns(self):
        got = self.normalize()
        self.assertEqual(got['sectionStrums'],
                         {'verse': 'custom-1', 'chorus': 'dddudu-4-4'})
        self.assertEqual(got['strumPatterns'], [{
            'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
            'subdiv': 2, 'slots': 'DUDUDUDU'}])
        self.assertEqual(got['grid'][0]['role'], 'verse')
        self.assertEqual(got['grid'][0]['bars'][0]['strums'],
                         ['DU', 'DU', 'DU', 'DU'])

    def test_missing_role_is_derived_from_label(self):
        got = self.normalize(grid=[{
            'label': 'Zwrotka 2',
            'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}],
        }])
        self.assertEqual(got['grid'][0]['role'], 'verse')

    def test_invalid_song_strums_drop_the_grid(self):
        for strums in ('DUDU', ['DU', 'DU', 'DU'], ['DU', 'DU', 'DU', 'D'],
                       ['DU', 'DX', 'DU', 'DU']):
            got = self.normalize(grid=[{
                'label': 'V',
                'bars': [{'beats': [{'chord': 'C', 'beats': 4}],
                          'strums': strums}],
            }])
            self.assertNotIn('grid', got, strums)

    def test_invalid_custom_patterns_and_roles_are_dropped(self):
        got = self.normalize(
            sectionStrums={'not-a-role': 'downs-4-4', 'verse': 'custom-1'},
            strumPatterns=[
                {'id': 'custom-1', 'name': 'Mine', 'time': '4/4',
                 'subdiv': 2, 'slots': 'DUDUDUDU'},
                {'id': 'custom-1', 'name': 'Dup', 'time': '4/4',
                 'subdiv': 2, 'slots': 'DUDUDUDU'},
                {'id': 'downs-4-4', 'name': 'Shadow', 'time': '4/4',
                 'subdiv': 2, 'slots': 'DUDUDUDU'},
                {'id': 'bad', 'name': 'Bad', 'time': '4/4',
                 'subdiv': 2, 'slots': 'DUDU'}])
        self.assertEqual(got['sectionStrums'], {'verse': 'custom-1'})
        self.assertEqual([p['id'] for p in got['strumPatterns']], ['custom-1'])

    def test_imported_fields_are_effective_under_an_empty_plan(self):
        got = run_js('''
            var song = %s;
            var plan = SB.emptyPlan();
            var section = SB.sectionStrumFor(song, 'verse', plan);
            var ids = SB.strumPatternsForSong(song, plan).map(function (p) {
                return p.id;
            });
            var bySection = SB.resolveStrumAt(song,
                { block: 0, bar: 0, beat: 0 }, plan);
            var byBar = SB.resolveStrumAt(song,
                { block: 0, bar: 0, beat: 1,
                  strums: song.grid[0].bars[0].strums }, plan);
            console.log(JSON.stringify({
                section: section.id,
                ids: ids,
                sectionSource: bySection.source,
                sectionSlots: bySection.slots,
                barSource: byBar.source,
                barSlots: byBar.slots
            }));
        ''' % json.dumps(self.SONG))
        self.assertEqual(got['section'], 'custom-1')
        self.assertIn('custom-1', got['ids'])
        self.assertEqual(got['sectionSource'], 'section')
        self.assertEqual(got['sectionSlots'], 'DU')
        self.assertEqual(got['barSource'], 'bar')
        self.assertEqual(got['barSlots'], 'DU')


if __name__ == '__main__':
    unittest.main(verbosity=2)
