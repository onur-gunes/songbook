#!/usr/bin/env python3
"""Browser test: edit mode and the strum/structure boundary (issue #103).

Covers the regressions found while reviewing the per-section/per-beat strum
work:

- plan.grid is the authoritative structure in Edit mode, so a structural edit
  renders immediately (the plan used to be read after the blocks were built,
  which silently rendered the songbook grid);
- a chord/length edit preserves `repeat` signs and the per-bar `strums` an
  exported songbook carries (strum and structure edits are independent);
- a bar with an empty chord is rejected, not saved and not exported;
- the per-section selectors speak the song's own labels and do not offer a
  role the plan removed;
- the animated view is read-only (no button role, no tab stop, no edit hint)
  and has no bar-strum control;
- beat cells and the bar strum control meet the 44px touch-target minimum.

Usage: start a server in the project root, then:
    python3 -m http.server 8777 &
    python3 tests/edit.py http://localhost:8777
"""
import sys

from cdp import launch_chrome, new_tab, CDP
from fixture import inject_fixtures

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8777'
PORT = 9341

BOOK = 'test-book'
SONG = 'grid-song'
TITLE = 'Grid Song'
# A different song in the same book: navigating away and back guarantees the
# hashchange actually fires even when the scenario runs twice in one page.
OTHER = 'six-eight-song'
OTHER_TITLE = 'Six Eight Song'

# A plan block carrying both a repeat sign and the per-beat slot strings that
# an exported grid can hold. Structural edits must not rewrite either.
PRESERVE_PLAN = {
    'version': 1,
    'grid': [{
        'label': 'Verse 1',
        'role': 'verse',
        'repeat': True,
        'bars': [{
            'beats': [{'chord': 'C', 'beats': 4}],
            'strums': ['DU', 'DU', 'DU', 'DU'],
        }],
    }],
    'time': '4/4',
    'songStrum': '',
    'sectionStrums': {},
    'customPatterns': [],
    'barStrums': {},
    'beatStrums': {},
}

# A one-section plan whose label and role differ from the songbook's own
# grid, used to prove the plan wins at render time.
STRUCT_PLAN = {
    'version': 1,
    'grid': [{
        'label': 'Bridge edit',
        'role': 'bridge',
        'repeat': False,
        'bars': [{'beats': [{'chord': 'Am', 'beats': 4}]}],
    }],
    'time': '4/4',
    'songStrum': '',
    'sectionStrums': {},
    'customPatterns': [],
    'barStrums': {},
    'beatStrums': {},
}

# Two verse sections with the song's own labels. Only the verse role exists in
# the plan, so the chorus the songbook's authored grid contains must not leak
# into the selectors; sections sharing a role share one selector, so their
# labels are joined.
LABEL_PLAN = {
    'version': 1,
    'grid': [
        {'label': 'Zwrotka 2', 'role': 'verse',
         'bars': [{'beats': [{'chord': 'C', 'beats': 4}]}]},
        {'label': 'Zwrotka 3', 'role': 'verse',
         'bars': [{'beats': [{'chord': 'G', 'beats': 4}]}]},
    ],
    'time': '4/4',
    'songStrum': '',
    'sectionStrums': {},
    'customPatterns': [],
    'barStrums': {},
    'beatStrums': {},
}


def main():
    proc, _ = launch_chrome(PORT)
    try:
        target = new_tab(PORT, 'about:blank')
        cdp = CDP(target['webSocketDebuggerUrl'])
        cdp.enable()
        inject_fixtures(cdp)
        cdp.send('Page.navigate', {'url': BASE + '/index.html?nosw'})
        cdp.wait_js('!!(window.songbookTest && songbookTest.getActive())', timeout=30)

        results = []

        def ok(name, cond, detail=''):
            results.append((name, bool(cond), detail))

        def js(expr):
            return cdp.eval(expr)

        def seed(plan):
            """Replace the song's local plan and force a fresh render."""
            js("songbookTest.clearPlan(%r, %r)" % (BOOK, SONG))
            if plan is not None:
                js("songbookTest.savePlan(%r, %r, %s)" %
                   (BOOK, SONG, _json(plan)))

        def open_song():
            """Route away and back so the hashchange always fires."""
            js("location.hash = '#/%s/%s'" % (BOOK, OTHER))
            cdp.wait_js("document.getElementById('songTitle').textContent === %r"
                        % OTHER_TITLE, timeout=10)
            js("location.hash = '#/%s/%s'" % (BOOK, SONG))
            cdp.wait_js("document.getElementById('songTitle').textContent === %r"
                        % TITLE, timeout=10)
            cdp.wait_js("document.getElementById('songView').hidden === false",
                        timeout=10)

        def show_grid():
            js("songbookTest.setChordMode('grid')")
            cdp.wait_js(
                "document.querySelectorAll('.sheet.chords-grid .grid-bar').length > 0",
                timeout=10)

        # --- 1. A structural edit renders in grid mode ------------------
        seed(STRUCT_PLAN)
        open_song()
        show_grid()
        rendered = js(
            "({ labels: Array.from(document.querySelectorAll("
            "  '.sheet.chords-grid .grid-section-label')).map(function (e) {"
            "    return e.textContent; }),"
            "  bars: document.querySelectorAll('.sheet.chords-grid .grid-bar').length })")
        ok('plan.grid renders its own section, not the songbook grid',
           rendered['labels'] == ['Bridge edit'] and rendered['bars'] == 1,
           rendered)
        ok('plan.grid section role reaches the strum selectors',
           js("songbookTest.songSectionRoles(songbookTest.getSong('grid-song'),"
              " songbookTest.loadPlan('test-book', 'grid-song'))[0] === 'bridge'"))

        # --- 2. Edit mode preserves repeat + bar.strums -----------------
        seed(PRESERVE_PLAN)
        open_song()
        show_grid()
        js("document.getElementById('editBtn').click()")
        cdp.wait_js(
            "!!document.querySelector('.structure-editor') &&"
            " !document.querySelector('.structure-editor').hidden", timeout=10)
        js("(function () {"
           "  var input = document.querySelector('.editor-chord');"
           "  input.value = 'G';"
           "  input.dispatchEvent(new Event('change', {bubbles: true}));"
           "})()")
        kept = js(
            "(function () {"
            "  var plan = songbookTest.loadPlan('test-book', 'grid-song');"
            "  var block = plan.grid[0];"
            "  return { chord: block.bars[0].beats[0].chord,"
            "           repeat: block.repeat,"
            "           strums: block.bars[0].strums };"
            "})()")
        ok('changing a chord does not drop the repeat sign',
           kept['chord'] == 'G' and kept['repeat'] is True, kept)
        ok("changing a chord keeps the bar's per-beat strums",
           kept['strums'] == ['DU', 'DU', 'DU', 'DU'], kept)

        # --- 3. An empty chord is rejected, not saved -------------------
        # A new bar starts with an empty chord that already sums to the
        # metre, so the metre check alone would let it through.
        seed(PRESERVE_PLAN)
        open_song()
        js("document.getElementById('editBtn').click()")
        cdp.wait_js(
            "!!document.querySelector('.structure-editor') &&"
            " !document.querySelector('.structure-editor').hidden", timeout=10)
        js("document.querySelector('.editor-add-bar').click()")
        cdp.wait_js(
            "!!document.querySelector('.editor-error') &&"
            " !document.querySelector('.editor-error').hidden", timeout=10)
        rejected = js(
            "({ message: document.querySelector('.editor-error').textContent,"
            "   bars: songbookTest.loadPlan('test-book', 'grid-song').grid[0].bars.length })")
        ok('an empty chord shows a validation error',
           'empty or not playable' in rejected['message'], rejected)
        ok('an invalid bar is not saved to the plan',
           rejected['bars'] == 1, rejected)

        # --- 4. Selectors use the song's labels, not stale roles --------
        seed(LABEL_PLAN)
        open_song()
        show_grid()
        js("document.getElementById('strumSectionsBtn').click()")
        cdp.wait_js(
            "document.getElementById('strumSections').hidden === false", timeout=10)
        selectors = js(
            "({ labels: Array.from(document.querySelectorAll("
            "    '#strumSectionsList .strum-section-label')).map(function (e) {"
            "      return e.textContent; }),"
            "  roles: Array.from(document.querySelectorAll("
            "    '#strumSectionsList .strum-section-select')).map(function (s) {"
            "      return s.dataset.role; }),"
            "  aria: Array.from(document.querySelectorAll("
            "    '#strumSectionsList .strum-section-select')).map(function (s) {"
            "      return s.getAttribute('aria-label'); }) })")
        ok("section selectors show the song's own labels",
           selectors['labels'] == ['Zwrotka 2 / Zwrotka 3'], selectors)
        ok('section selector aria-label names the sections',
           selectors['aria'] and 'Zwrotka 2' in selectors['aria'][0] and
           'Zwrotka 3' in selectors['aria'][0], selectors)
        ok('a section removed by plan.grid leaves no stale selector',
           selectors['roles'] == ['verse'], selectors)

        # --- 5. The animated view is read-only -------------------------
        seed(None)
        open_song()
        js("songbookTest.setChordMode('animate')")
        cdp.wait_js(
            "document.querySelectorAll('.sheet.chords-animate .grid-beat').length > 0",
            timeout=10)
        animated = js(
            "({ beats: document.querySelectorAll('.sheet.chords-animate .grid-beat').length,"
            "   focusable: Array.from(document.querySelectorAll("
            "     '.sheet.chords-animate .grid-beat')).filter(function (b) {"
            "       return b.hasAttribute('role') || b.hasAttribute('tabindex') ||"
            "              /press Enter/i.test(b.getAttribute('aria-label') || '');"
            "   }).length,"
            "   barControls: document.querySelectorAll("
            "     '.sheet.chords-animate .grid-bar-strum').length })")
        ok('animated beats are read-only',
           animated['beats'] > 0 and animated['focusable'] == 0, animated)
        ok('animated view has no bar strum control',
           animated['barControls'] == 0, animated)

        # --- 6. Touch targets ------------------------------------------
        show_grid()
        targets = js(
            "(function () {"
            "  var beats = Array.from(document.querySelectorAll("
            "    '.sheet.chords-grid .grid-beat'));"
            "  var bar = document.querySelector('.sheet.chords-grid .grid-bar-strum');"
            "  var r = bar.getBoundingClientRect();"
            "  var cs = getComputedStyle(bar, '::after');"
            "  var top = parseFloat(cs.top), bottom = parseFloat(cs.bottom);"
            "  var left = parseFloat(cs.left), right = parseFloat(cs.right);"
            "  return { minBeat: beats.length ? Math.min.apply(null, beats.map("
            "             function (b) { return b.getBoundingClientRect().height; })) : 0,"
            "           hitH: r.height - top - bottom,"
            "           hitW: r.width - left - right,"
            "           hitContent: cs.content };"
            "})()")
        ok('beat cells are at least 44px tall',
           targets['minBeat'] >= 44, targets)
        ok('bar strum control has a 44px touch area',
           targets['hitContent'] not in (None, 'none', 'normal') and
           targets['hitH'] >= 44 and targets['hitW'] >= 44, targets)

        n_fail = 0
        for name, passed, detail in results:
            print(('PASS ' if passed else 'FAIL ') + name +
                  (' | ' + str(detail) if detail != '' else ''))
            n_fail += 0 if passed else 1
        print('\n%d/%d passed' % (len(results) - n_fail, len(results)))
        cdp.close()
        return 1 if n_fail else 0
    finally:
        proc.terminate()


def _json(value):
    import json
    return json.dumps(value)


if __name__ == '__main__':
    sys.exit(main())
