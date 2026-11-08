#!/usr/bin/env python3
"""Unit tests for Step 6 structure editing (issue #109).

Covers the grid renderer's preference for the per-song edit plan's structural
grid override (plan.grid) over the songbook's authored grid, so a song opened
in edit mode shows the user's structure verbatim.

These tests load js/sections.js and js/grid.js under node and assert
SB.gridBlocksFor honours plan.grid when present.

Usage:
    python3 tests/editor.py
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

SECTIONS_JS = os.path.join(ROOT, 'js', 'sections.js')
GRID_JS = os.path.join(ROOT, 'js', 'grid.js')

SONG = {
    'id': 'song-1', 'title': 'Demo', 'time': '4/4', 'strum': 'downs-4-4',
    'grid': [
        {'label': 'Verse 1', 'role': 'verse',
         'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}]},
        {'label': 'Chorus 1', 'role': 'chorus',
         'bars': [{'beats': [{'chord': 'G', 'beats': 4}]}]},
    ],
}

PLAN_GRID = [
    {'label': 'Bridge', 'role': 'bridge',
     'bars': [{'beats': [{'chord': 'Am', 'beats': 2}, {'chord': 'Dm', 'beats': 2}]}]},
]


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def harness(extra):
    """Build a node script stubbing the SB surface, loading sections.js and
    grid.js, running `extra`, and console.logging its result as JSON.

    core.js is deliberately *not* loaded: it references `document` at load
    time, which does not exist under node. The minimal SB surface below is what
    grid.js touches (sections.js provides SB.sectionRole / SB.isSectionRole,
    grid.js provides SB.metronomeBeatsPerBar via the harness)."""
    return (
        'var SB = {\n'
        '  state: { active: null },\n'
        '  NS: \'songbook\',\n'
        '  SEP: \'\\u0000\',\n'
        '  DEFAULT_TIME: \'4/4\',\n'
        '  metronomeBeatsPerBar: function (t) {\n'
        '    var b = { \'4/4\': 4, \'3/4\': 3, \'6/8\': 2, \'2/4\': 2 };\n'
        '    return b[t] || 4;\n'
        '  },\n'
        '  sectionRole: function () { return \'other\';\n  },\n'
        '  isSectionRole: function () { return false;\n  },\n'
        '};\n'
        'var document = { body: {} };\n'
        'var window = { SB: SB, document: document };\n'
        + read(SECTIONS_JS)
        + '\n' + read(GRID_JS)
        + '\n' + extra
    )


def run_js(extra):
    script = harness(extra)
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


class GridBlocksPlanOverrideTests(unittest.TestCase):
    """plan.grid overrides song.grid when rendering the chart."""

    def setUp(self):
        if not shutil.which('node'):
            self.skipTest('node not available')

    def test_plan_grid_wins_over_song_grid(self):
        got = run_js('''
            var song = %s;
            var plan = { grid: %s, time: '4/4' };
            var blocks = SB.gridBlocksFor(song, plan);
            console.log(JSON.stringify(blocks.map(function (b) {
                return { label: b.label, role: b.role,
                    bars: b.bars.map(function (bar) {
                        return bar.beats.map(function (seg) {
                            return seg.chord + ':' + seg.beats;
                        });
                    }) };
            })));
        ''' % (json.dumps(SONG), json.dumps(PLAN_GRID)))
        self.assertEqual(got, [{
            'label': 'Bridge', 'role': 'bridge',
            'bars': [['Am:2', 'Dm:2']],
        }])

    def test_no_plan_grid_uses_song_grid(self):
        got = run_js('''
            var song = %s;
            var plan = { grid: null, time: '4/4' };
            var blocks = SB.gridBlocksFor(song, plan);
            console.log(JSON.stringify(blocks.map(function (b) {
                return { label: b.label, role: b.role };
            })));
        ''' % json.dumps(SONG))
        self.assertEqual(got, [
            {'label': 'Verse 1', 'role': 'verse'},
            {'label': 'Chorus 1', 'role': 'chorus'},
        ])

    def test_plan_grid_blocks_render_verbatim_without_lyric_matching(self):
        # A plan grid block whose progression does not match the sheet still
        # renders, because plan structure is authoritative in edit mode.
        song = dict(SONG)
        song['sheet'] = [
            [['c', '[C]'], ['x', 'words']],
        ]
        got = run_js('''
            var song = %s;
            var plan = { grid: %s, time: '4/4' };
            var blocks = SB.gridBlocksFor(song, plan);
            console.log(JSON.stringify(blocks.length));
        ''' % (json.dumps(song), json.dumps(PLAN_GRID)))
        self.assertEqual(got, 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
