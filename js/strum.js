/* Songbook — strum
 * a strum-pattern row under the chord strip, chosen from a small library
 * filtered by the song's time signature, highlighted in lockstep with the
 * metronome. See GitHub issue #41.
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order
 * set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- pattern library ----------------
     *
     * A byte-identical mirror of chordpro.py's STRUM_PATTERNS (tests/strum.py
     * asserts the two agree), exactly as TIME_SIGNATURES is mirrored between
     * chordpro.py and js/songbooks.js. The build is the source of truth for
     * what a valid `strum` id is; this copy is what the running app renders.
     *
     * Each pattern is {id, name, time, subdiv, slots}:
     *   - `slots` is a string of 'D' (down), 'U' (up) and '-' (rest), one char
     *     per subdivision slot: the subdivision row rendered under the chord
     *     strip, with bar lines around it.
     *   - `subdiv` is how many slots fall on one felt beat (2 = eighths in
     *     simple metres), so slots.length === subdiv * beatsPerBar and the row
     *     lines up with the metronome's accents (beat 1 is slot 0).
     *
     * CAVEAT (kept here in the data, not only in the comment above the UI):
     * strum patterns are far less reliably documented than key or bpm, and most
     * real songs change pattern between verse and chorus. A per-song `strum` is
     * ONE pattern for the whole song and is explicitly an approximation. Per-
     * section patterns are a later feature; the per-song field is a single id
     * today but is deliberately shaped so it can grow to a list without a data
     * migration (see normalizeStrum in js/songbooks.js). */
    var PATTERNS = [
        // 4/4 — eighths (8 slots)
        { id: 'downs-4-4', name: 'All downs', time: '4/4', subdiv: 2, slots: 'D-D-D-D-' },
        { id: 'eighths-4-4', name: 'All eighths', time: '4/4', subdiv: 2, slots: 'DUDUDUDU' },
        { id: 'dduudu-4-4', name: 'D DU UDU', time: '4/4', subdiv: 2, slots: 'D-DU-UDU' },
        { id: 'dddudu-4-4', name: 'D D DU DU', time: '4/4', subdiv: 2, slots: 'D-D-DUDU' },
        { id: 'ddudu-4-4', name: 'D DU D DU', time: '4/4', subdiv: 2, slots: 'D-DUD-DU' },
        { id: 'duudu-4-4', name: 'D U UDU', time: '4/4', subdiv: 2, slots: 'D-U-UDU-' },
        // 3/4 — eighths (6 slots)
        { id: 'downs-3-4', name: 'All downs', time: '3/4', subdiv: 2, slots: 'D-D-D-' },
        { id: 'eighths-3-4', name: 'All eighths', time: '3/4', subdiv: 2, slots: 'DUDUDU' },
        { id: 'waltz-3-4', name: 'D DU DU', time: '3/4', subdiv: 2, slots: 'D-DUDU' },
        { id: 'dddu-3-4', name: 'D D DU', time: '3/4', subdiv: 2, slots: 'D-D-DU' },
        // 6/8 — two dotted-quarter pulses, 3 slots per pulse (6 slots)
        { id: 'downs-6-8', name: 'D . . D . .', time: '6/8', subdiv: 3, slots: 'D--D--' },
        { id: 'du-6-8', name: 'D . U D . U', time: '6/8', subdiv: 3, slots: 'D-UD-U' },
        { id: 'eighths-6-8', name: 'All eighths', time: '6/8', subdiv: 3, slots: 'DUDUDU' },
        // 2/4 — eighths (4 slots)
        { id: 'downs-2-4', name: 'All downs', time: '2/4', subdiv: 2, slots: 'D-D-' },
        { id: 'eighths-2-4', name: 'All eighths', time: '2/4', subdiv: 2, slots: 'DUDU' },
        { id: 'ddu-2-4', name: 'D DU', time: '2/4', subdiv: 2, slots: 'D-DU' }
    ];

    var byId = {};
    PATTERNS.forEach(function (p) { byId[p.id] = p; });

    /* Notation is a global display preference (arrows ↓↑· vs letters DU·), like
     * chordMode, remembered across songs and sessions. Restore it before any
     * render so the first row drawn is already in the chosen notation. */
    try {
        var _sn = window.localStorage.getItem(SB.NS + ':strumNotation');
        if (_sn === 'arrows' || _sn === 'letters') SB.state.strum.notation = _sn;
    } catch (e) { /* ignore */ }

    SB.strumPatterns = function () { return PATTERNS.slice(); }

    SB.strumPatternsFor = function (time) {
        if (!time) return [];
        return PATTERNS.filter(function (p) { return p.time === time; });
    }

    /* Resolve a stored/sidecar id to a pattern, but only if it actually fits
     * the song's metre: a 3/4 id on a 4/4 song would render a row that does not
     * line up with the clicks, so it is treated as "no choice" rather than
     * forced on. Returns null when the id is unknown or the metre is wrong. */
    function patternForSong(id, time) {
        if (!id || !time) return null;
        var p = byId[id];
        return (p && p.time === time) ? p : null;
    }

    /* The count-in is one full bar of clicks before the pattern starts: a strum
     * you cannot start on beat 1 is not usable for playing along. Expressed in
     * subdivision slots so it shares the pattern's own grid. */
    function countInSlots(pattern) {
        return SB.metronomeBeatsPerBar(pattern.time) * pattern.subdiv;
    }

    /* ---------------- per-song choice ---------------- */

    function storedChoice(sbId, songId) {
        try { return window.localStorage.getItem(SB.strumKey(sbId, songId)) || null; }
        catch (e) { return null; }
    }

    function saveChoice(sbId, songId, id) {
        try { window.localStorage.setItem(SB.strumKey(sbId, songId), id); }
        catch (e) { /* ignore */ }
    }

    /* The documented default (the song's `strum`) is used unless the user has
     * made a manual choice here, exactly as bpm prefers the user override over
     * the song's value. A manual choice that no longer fits the metre (e.g. an
     * imported book changed) falls back to the default rather than nothing. */
    function chooseFor(song) {
        if (!song || !song.time) return null;
        if (SB.state.active) {
            var saved = patternForSong(storedChoice(SB.state.active.id, song.id), song.time);
            if (saved) return saved;
        }
        var def = patternForSong(song.strum, song.time);
        if (def) return def;
        var list = SB.strumPatternsFor(song.time);
        return list.length ? list[0] : null;
    }

    /* ---------------- rendering ---------------- */

    var raf = null;
    var lastSlot = -1;

    function slotGlyph(ch) {
        if (ch === '-') return '\u00b7';   // middle dot for a rest, either way
        if (SB.state.strum.notation === 'letters') return ch;  // 'D' / 'U'
        if (ch === 'D') return '\u2193';   // downward arrow
        if (ch === 'U') return '\u2191';   // upward arrow
        return '\u00b7';
    }

    /* Builds the subdivision row: an optional count-in bar, then the pattern
     * bar, with bar lines between and around them. Each slot is one cell so the
     * highlight can toggle a single class without re-rendering. */
    function renderRow() {
        var row = SB.$('strumRow');
        if (!row) return;
        row.textContent = '';
        var pattern = SB.state.strum.pattern;
        if (!pattern) return;

        function bar(label, slots, cls) {
            var b = SB.el('div', 'strum-bar' + (cls ? ' ' + cls : ''));
            if (label) b.appendChild(SB.el('span', 'strum-bar-label', label));
            var cells = SB.el('div', 'strum-cells');
            for (var i = 0; i < slots.length; i++) {
                var cell = SB.el('div', 'strum-slot', slotGlyph(slots[i]));
                if (slots[i] === '-') cell.classList.add('rest');
                // Mark the first slot of each felt beat so beat 1 and the pulse
                // read clearly even when stopped.
                if (i % pattern.subdiv === 0) cell.classList.add('beat');
                cell.dataset.cls = cls;
                cell.dataset.idx = String(i);
                cells.appendChild(cell);
            }
            b.appendChild(cells);
            return b;
        }

        var countin = new Array(countInSlots(pattern) + 1).join('-'); // all rests
        row.appendChild(bar('Count-in', countin, 'countin'));
        row.appendChild(bar(null, pattern.slots, 'pattern'));
        lastSlot = -1;
    }

    function buildSelect() {
        var sel = SB.$('strumSelect');
        if (!sel) return;
        sel.textContent = '';
        var song = SB.state.currentSong;
        var list = song ? SB.strumPatternsFor(song.time) : [];
        list.forEach(function (p) {
            var opt = SB.el('option', null, p.name);
            opt.value = p.id;
            sel.appendChild(opt);
        });
        if (SB.state.strum.pattern) sel.value = SB.state.strum.pattern.id;
    }

    /* ---------------- highlight (metronome-driven) ----------------
     *
     * The highlight reads SB.metronomePosition() — the metronome's own audio
     * clock — on every animation frame. It never starts a timer of its own:
     * two independent clocks visibly diverge over a long run (issue #41), so
     * the clicks are the single source of truth for which slot is lit. rAF is
     * only a repaint cadence, not a clock; the slot is always recomputed from
     * the audio time, so a dropped frame cannot make it drift. */
    function highlightFrame() {
        raf = null;
        var pattern = SB.state.strum.pattern;
        var pos = pattern ? SB.metronomePosition() : null;
        if (pos === null) { clearHighlight(); return; }

        var countin = countInSlots(pattern);
        var slotsElapsed = Math.floor(pos * pattern.subdiv);
        var slot, cls;
        if (slotsElapsed < countin) {
            slot = slotsElapsed;
            cls = 'countin';
        } else {
            slot = (slotsElapsed - countin) % pattern.slots.length;
            cls = 'pattern';
        }

        if (slot !== lastSlot) {
            paint(cls, slot);
            lastSlot = slot;
        }
        raf = requestAnimationFrame(highlightFrame);
    }

    function paint(cls, idx) {
        var row = SB.$('strumRow');
        if (!row) return;
        Array.prototype.forEach.call(row.querySelectorAll('.strum-slot.on'), function (c) {
            c.classList.remove('on');
        });
        var active = row.querySelector('.strum-slot[data-cls="' + cls + '"][data-idx="' + idx + '"]');
        if (active) active.classList.add('on');
    }

    function clearHighlight() {
        var row = SB.$('strumRow');
        if (!row) return;
        Array.prototype.forEach.call(row.querySelectorAll('.strum-slot.on'), function (c) {
            c.classList.remove('on');
        });
        lastSlot = -1;
    }

    /* Called by the metronome when it starts/stops, so the highlight loop runs
     * only while something is counting (and always reads the audio clock while
     * it does). */
    SB.strumOnMetronomeStart = function () {
        if (!SB.state.strum.pattern) return;
        if (raf === null) raf = requestAnimationFrame(highlightFrame);
    }

    SB.strumOnMetronomeStop = function () {
        if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
        clearHighlight();
    }

    /* ---------------- wiring ---------------- */

    SB.updateStrumUi = function () {
        var group = SB.$('strumGroup');
        if (!group) return;
        var on = SB.state.strum.pattern !== null;
        group.hidden = !on;
    }

    /* Reflects the notation preference on its button. Re-rendering the row (not
     * just restyling it) is deliberate: the glyphs themselves change, and the
     * highlight loop re-reads cells by data attributes, which renderRow rebuilds
     * cleanly. */
    SB.applyStrumNotation = function () {
        var btn = SB.$('strumNotationBtn');
        if (btn) {
            var letters = SB.state.strum.notation === 'letters';
            btn.textContent = letters ? 'DU' : '\u2193\u2191';
            btn.setAttribute('aria-pressed', letters ? 'true' : 'false');
            var label = letters
                ? 'Showing D/U letters — click for arrows'
                : 'Showing arrows — click for D/U letters';
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
        if (SB.state.strum.pattern) {
            renderRow();
            // Keep the highlight in step with the freshly rebuilt cells.
            if (SB.state.metronome.playing) SB.strumOnMetronomeStart();
        }
    }

    SB.toggleStrumNotation = function () {
        SB.state.strum.notation = SB.state.strum.notation === 'letters' ? 'arrows' : 'letters';
        try { window.localStorage.setItem(SB.NS + ':strumNotation', SB.state.strum.notation); }
        catch (e) { /* ignore */ }
        SB.applyStrumNotation();
    }

    /* Called from SB.openSong. Picks the pattern (manual choice, else the
     * documented default, else the first for the metre), renders the row and
     * the selector, and hides the whole control for songs with no time
     * signature — no metre, no pattern, no selector. */
    SB.loadStrumForSong = function (song) {
        SB.strumOnMetronomeStop();
        SB.state.strum.pattern = chooseFor(song);
        renderRow();
        buildSelect();
        SB.updateStrumUi();
    }

    SB.setStrum = function (id) {
        var song = SB.state.currentSong;
        if (!song) return;
        var pattern = patternForSong(id, song.time);
        if (!pattern) return;
        SB.state.strum.pattern = pattern;
        if (SB.state.active) saveChoice(SB.state.active.id, song.id, pattern.id);
        renderRow();
        buildSelect();
        SB.updateStrumUi();
        // If the metronome is already running, keep the highlight going on the
        // new row; strumOnMetronomeStart is a no-op if the loop is already up.
        if (SB.state.metronome.playing) SB.strumOnMetronomeStart();
    }

    SB.bindStrum = function () {
        var sel = SB.$('strumSelect');
        if (sel) sel.addEventListener('change', function () { SB.setStrum(sel.value); });
        var nbtn = SB.$('strumNotationBtn');
        if (nbtn) nbtn.addEventListener('click', SB.toggleStrumNotation);
        SB.applyStrumNotation();
    }

})(window.SB = window.SB || {});
