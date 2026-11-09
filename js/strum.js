/* Songbook — strum
 * a strum-pattern row under the chord strip, chosen from a small library
 * filtered by the song's time signature, highlighted in lockstep with the
 * metronome. Also resolves the per-song edit plan (issue #105): beat, bar and
 * section-role overrides first, then the song's/plan's defaults.
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
     * ONE pattern for the whole song and is explicitly an approximation; songs
     * can additionally carry `sectionStrums` (one pattern per canonical
     * section role, English or Polish labels alike) and per-song custom
     * patterns in `strumPatterns`. The per-song field stays a single id but is
     * deliberately shaped so it can grow to a list without a data migration
     * (see normalizeStrum in js/songbooks.js). */
    var PATTERNS = [
        // 4/4 — eighths (8 slots)
        { id: 'downs-4-4', name: 'All downs', time: '4/4', subdiv: 2, slots: 'D-D-D-D-' },
        { id: 'eighths-4-4', name: 'All eighths', time: '4/4', subdiv: 2, slots: 'DUDUDUDU' },
        { id: 'dduudu-4-4', name: 'D DU UDU', time: '4/4', subdiv: 2, slots: 'D-DU-UDU' },
        { id: 'dddudu-4-4', name: 'D D DU DU', time: '4/4', subdiv: 2, slots: 'D-D-DUDU' },
        { id: 'ddudu-4-4', name: 'D DU D DU', time: '4/4', subdiv: 2, slots: 'D-DUD-DU' },
        { id: 'duudu-4-4', name: 'D U UDU', time: '4/4', subdiv: 2, slots: 'D-U-UDU-' },
        { id: 'dddududu-4-4', name: 'D D D U D U D U', time: '4/4', subdiv: 2, slots: 'DDDUDUDU' },
        // 3/4 — eighths (6 slots)
        { id: 'downs-3-4', name: 'All downs', time: '3/4', subdiv: 2, slots: 'D-D-D-' },
        { id: 'eighths-3-4', name: 'All eighths', time: '3/4', subdiv: 2, slots: 'DUDUDU' },
        { id: 'waltz-3-4', name: 'D DU DU', time: '3/4', subdiv: 2, slots: 'D-DUDU' },
        { id: 'dddu-3-4', name: 'D D DU', time: '3/4', subdiv: 2, slots: 'D-D-DU' },
        // 6/8 — two dotted-quarter pulses, 3 slots per pulse (6 slots)
        { id: 'downs-6-8', name: 'D . . D . .', time: '6/8', subdiv: 3, slots: 'D--D--' },
        { id: 'du-6-8', name: 'D . U D . U', time: '6/8', subdiv: 3, slots: 'D-UD-U' },
        // DUDDUD, not DUDUDU: alternating eighths restart on the second pulse
        // so a down-stroke lands on every felt beat. See chordpro.py.
        { id: 'eighths-6-8', name: 'All eighths', time: '6/8', subdiv: 3, slots: 'DUDDUD' },
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

    /* Size and pin mirror chordSize/chordPin: same 0.6-1.5 range in 0.1 steps,
     * same default-on pin, same namespaced keys. */
    var SIZE_MIN = 0.6;
    var SIZE_MAX = 1.5;
    try {
        var _ss = parseFloat(window.localStorage.getItem(SB.NS + ':strumSize'));
        if (_ss >= SIZE_MIN && _ss <= SIZE_MAX) SB.state.strumSize = Math.round(_ss * 10) / 10;
    } catch (e) { /* ignore */ }
    try { SB.state.strumPin = window.localStorage.getItem(SB.NS + ':strumPin') !== '0'; }
    catch (e) { /* ignore */ }

    SB.strumPatterns = function () { return PATTERNS.slice(); }

    SB.strumPatternsFor = function (time) {
        if (!time) return [];
        return PATTERNS.filter(function (p) { return p.time === time; });
    }

    /* Songbook data is the baseline, local plan edits are the overlay. An
     * exported song carries its section strums and custom pattern definitions
     * in the song itself (the import schema), while the plan holds only what
     * the player changed after opening it. Merge them for every read path so
     * importing an exported song plays the same chart without copying those
     * fields into local storage first. Plan values win on a shared role or id;
     * a local definition can therefore correct an imported one. */
    function planWithSong(song, plan) {
        plan = SB.normalizePlan(plan);
        if (!song) return plan;
        var merged = {
            version: plan.version,
            songStrum: plan.songStrum,
            sectionStrums: {},
            customPatterns: [],
            barStrums: plan.barStrums,
            beatStrums: plan.beatStrums,
            grid: plan.grid,
            time: plan.time
        };
        var songSections = (song.sectionStrums && typeof song.sectionStrums === 'object' &&
            !Array.isArray(song.sectionStrums)) ? song.sectionStrums : {};
        Object.keys(songSections).forEach(function (role) {
            var id = songSections[role];
            if (SB.isSectionRole(role) && typeof id === 'string' && id) {
                merged.sectionStrums[role] = id;
            }
        });
        Object.keys(plan.sectionStrums).forEach(function (role) {
            merged.sectionStrums[role] = plan.sectionStrums[role];
        });

        var byId = Object.create(null);
        var order = [];
        function add(pattern) {
            if (!pattern || typeof pattern !== 'object' || typeof pattern.id !== 'string' || !pattern.id) return;
            if (!(pattern.id in byId)) order.push(pattern.id);
            byId[pattern.id] = pattern;
        }
        (Array.isArray(song.strumPatterns) ? song.strumPatterns : []).forEach(add);
        plan.customPatterns.forEach(add);
        merged.customPatterns = order.map(function (id) { return byId[id]; });
        return merged;
    }
    SB.strumPlanFor = planWithSong;

    /* The full list a song can use: the immutable library plus the custom
     * definitions stored in the song or its edit plan, filtered to the song's
     * effective metre. Custom definitions are validated with patternFits
     * (below), so a corrupt one can never reach the row; an id that belongs to
     * the library is skipped, because a built-in pattern must not be shadowed
     * or replaced. */
    SB.strumPatternsForSong = function (song, plan) {
        if (!song) return [];
        if (plan === undefined) plan = currentPlanFor(song);
        plan = planWithSong(song, plan);
        var time = timeFor(song, plan);
        var list = SB.strumPatternsFor(time).slice();
        var custom = plan.customPatterns || [];
        custom.forEach(function (p) {
            if (byId[p.id]) return;
            if (patternFits(p, time)) list.push(p);
        });
        return list;
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
     * subdivision slots so it shares the pattern's own grid.
     *
     * One bar at the pattern's own subdivision is exactly the pattern's own
     * slot count (tests/strum.py asserts slots.length === beatsPerBar * subdiv
     * for every pattern), which is what lets the count-in run through the
     * pattern's cells instead of needing a bar of its own. */
    function countInSlots(pattern) {
        return SB.metronomeBeatsPerBar(pattern.time) * pattern.subdiv;
    }

    /* ---------------- per-song choice ---------------- */

    function storedChoice(sbId, songId) {
        try { return window.localStorage.getItem(SB.strumKey(sbId, songId)) || null; }
        catch (e) { return null; }
    }

    /* The main selector is the plan's song-level default, so keep the plan and
     * the pre-plan SB.strumKey copy in step. The old key is what existing
     * builds and users' current storage understand; the plan is where all the
     * new per-section/bar/beat edits live. */
    function saveChoice(sbId, songId, id) {
        try { window.localStorage.setItem(SB.strumKey(sbId, songId), id); }
        catch (e) { /* ignore */ }
        var plan = SB.loadPlan(sbId, songId);
        plan.songStrum = id;
        SB.savePlan(sbId, songId, plan);
    }

    /* The metre used for the row: the plan's structural override, the song's
     * own metre, or the app default. The default is what makes the feature
     * available on every song; it is not written into the song data. */
    function timeFor(song, plan) {
        return (plan && plan.time) || (song && song.time) || SB.DEFAULT_TIME;
    }

    /* Custom patterns live in the plan, library patterns in PATTERNS. A
     * definition is usable only when its metre matches and its slot count
     * lines up with that metre: the same invariant the library is built on,
     * which is what keeps the row aligned with the metronome. */
    function patternFits(pattern, time) {
        if (!pattern || !time || pattern.time !== time) return false;
        var subdiv = pattern.subdiv;
        if (typeof subdiv !== 'number' || subdiv < 1 || subdiv !== Math.floor(subdiv)) return false;
        var slots = pattern.slots;
        if (typeof slots !== 'string' || !/^[DU-]+$/.test(slots)) return false;
        return slots.length === SB.metronomeBeatsPerBar(time) * subdiv;
    }

    function findPattern(id, time, plan) {
        if (!id || !time) return null;
        // Built-ins win over a custom definition with the same id: the library
        // is immutable, and this is what stops an imported/corrupt plan from
        // silently replacing "All downs" with different slots.
        var builtIn = patternForSong(id, time);
        if (builtIn) return builtIn;
        var custom = (plan && plan.customPatterns) || [];
        for (var i = 0; i < custom.length; i++) {
            if (custom[i].id === id) return patternFits(custom[i], time) ? custom[i] : null;
        }
        return null;
    }

    function currentPlanFor(song) {
        var sbId = SB.state.active ? SB.state.active.id : null;
        if (!sbId || !song) return SB.emptyPlan();
        /* Read paths get the song's exported fields layered under the local
         * plan, so a freshly imported book renders its section strums and
         * custom patterns exactly as exported. Writers still call loadPlan()
         * and save only the overrides, never a merged copy. */
        return planWithSong(song, SB.loadPlan(sbId, song.id));
    }

    /* The grid lane is rendered from the plan, not from the live top row, so
       any change that lands in the plan (song default, section, bar or beat)
       has to rebuild it. Without this the row and the lane silently disagree
       until the next song or mode switch. */
    function refreshGridLane() {
        if (SB.isGridMode && SB.isGridMode() && SB.state.currentSong && SB.renderSheet) {
            SB.renderSheet(SB.state.currentSong);
        }
    }

    function planIndex(value) {
        return (typeof value === 'number' && isFinite(value) && value >= 0) ? Math.floor(value) : 0;
    }

    /* The song-level pattern, ignoring section/bar/beat overrides. This is
     * what the collapsed row shows: per-section choices are a separate layer
     * until the grid lane follows them during playback (Step 5). */
    function mainPatternFor(song, plan) {
        if (!song) return null;
        if (plan === undefined) plan = currentPlanFor(song);
        plan = planWithSong(song, plan);
        var time = timeFor(song, plan);
        var pattern = findPattern(plan.songStrum, time, plan);
        if (!pattern && SB.state.active) {
            pattern = findPattern(storedChoice(SB.state.active.id, song.id), time, plan);
        }
        if (!pattern) pattern = findPattern(song.strum, time, plan);
        if (!pattern) {
            var list = SB.strumPatternsForSong(song, plan);
            pattern = list.length ? list[0] : null;
        }
        return pattern;
    }

    /* A section's effective pattern: its plan override when one fits the
     * metre, otherwise the song-level pattern it inherits. Returns the main
     * pattern for an unknown/corrupt override, never a dead id. */
    function sectionPatternFor(song, role, plan) {
        if (!song) return null;
        if (plan === undefined) plan = currentPlanFor(song);
        plan = planWithSong(song, plan);
        var pattern = findPattern(plan.sectionStrums[role], timeFor(song, plan), plan);
        return pattern || mainPatternFor(song, plan);
    }

    SB.mainStrumFor = mainPatternFor;
    SB.sectionStrumFor = sectionPatternFor;

    /* Override coordinates are the block/bar/beat positions inside the
     * effective grid, not the song's labels: labels are free text and may be
     * translated, while the positions are what the grid renderer walks. */
    SB.planBarKey = function (block, bar) { return planIndex(block) + ':' + planIndex(bar); };
    SB.planBeatKey = function (block, bar, beat) {
        return planIndex(block) + ':' + planIndex(bar) + ':' + planIndex(beat);
    };

    /* Look up a pattern id (library or custom) for a metre, validating it with
     * patternFits so a corrupt id never resolves to a row that misaligns with
     * the metronome. Returns null when the id is unknown or doesn't fit. */
    SB.strumPatternFor = function (id, time, plan) {
        return findPattern(id, time, plan);
    };

    function roleAt(song, plan, at) {
        if (at && SB.isSectionRole(at.role)) return at.role;
        var grid = (plan && plan.grid) || (song && song.grid) || [];
        var block = grid[planIndex(at && at.block)];
        if (!block) return null;
        if (SB.isSectionRole(block.role)) return block.role;
        return SB.sectionRole(block.label || '');
    }

    /* One resolver for every strum question. Precedence:
     *
     *   beat > bar > section role > manual song default > song default
     *
     * "Manual song default" is the plan's songStrum, migrated on read from the
     * pre-plan SB.strumKey choice; the legacy key is also consulted directly
     * as a fallback so an existing user's choice can never disappear. "Song
     * default" is the songbook's documented `strum`. If none of those fit the
     * metre, the first pattern for that metre is used — the same fallback the
     * row has always applied when nothing was chosen.
     *
     * `slots` is the effective subdivision string for the requested felt beat,
     * while `pattern` is the full pattern it came from: a beat override can
     * replace one beat without replacing the song's pattern. */
    SB.resolveStrumAt = function (song, at, plan) {
        var none = { id: null, pattern: null, slots: null, subdiv: 0, source: 'none', time: null };
        if (!song) return none;
        if (plan === undefined) plan = currentPlanFor(song);
        plan = planWithSong(song, plan);
        at = at || {};

        var time = timeFor(song, plan);
        var block = planIndex(at.block);
        var bar = planIndex(at.bar);
        var beat = planIndex(at.beat);
        var role = roleAt(song, plan, { block: block, role: at.role });

        var barKey = SB.planBarKey(block, bar);
        var barOverride = findPattern(plan.barStrums[barKey], time, plan);
        var pattern = barOverride;
        var source = pattern ? 'bar' : null;
        if (!pattern && role) {
            pattern = findPattern(plan.sectionStrums[role], time, plan);
            source = pattern ? 'section' : null;
        }
        if (!pattern) {
            pattern = findPattern(plan.songStrum, time, plan);
            source = pattern ? 'manual' : null;
        }
        if (!pattern && SB.state.active) {
            pattern = findPattern(storedChoice(SB.state.active.id, song.id), time, plan);
            source = pattern ? 'manual' : null;
        }
        if (!pattern) {
            pattern = findPattern(song.strum, time, plan);
            source = pattern ? 'song' : null;
        }
        if (!pattern) {
            var list = SB.strumPatternsForSong(song, plan);
            pattern = list.length ? list[0] : null;
            source = pattern ? 'fallback' : 'none';
        }
        if (!pattern) return none;

        var beatSlots = plan.beatStrums[SB.planBeatKey(block, bar, beat)];
        if (beatSlots && beatSlots.length === pattern.subdiv && /^[DU-]+$/.test(beatSlots)) {
            return {
                id: pattern.id,
                pattern: pattern,
                slots: beatSlots,
                subdiv: pattern.subdiv,
                source: 'beat',
                time: time
            };
        }

        /* A song exported from the grid carries the effective beat slots in
         * `bars[].strums` instead of a plan entry. They are per felt beat, not
         * a pattern id, so they override the inherited section/song stride but
         * yield to an explicit local bar override for the same position. */
        if (!barOverride && Array.isArray(at.strums) && beat < at.strums.length) {
            var songSlots = at.strums[beat];
            if (typeof songSlots === 'string' && songSlots.length === pattern.subdiv &&
                /^[DU-]+$/.test(songSlots)) {
                return {
                    id: pattern.id,
                    pattern: pattern,
                    slots: songSlots,
                    subdiv: pattern.subdiv,
                    source: 'bar',
                    time: time
                };
            }
        }

        var start = beat * pattern.subdiv;
        return {
            id: pattern.id,
            pattern: pattern,
            slots: pattern.slots.slice(start, start + pattern.subdiv) || null,
            subdiv: pattern.subdiv,
            source: source,
            time: time
        };
    };

    /* The collapsed row shows one song-wide pattern: section overrides are
     * deliberately not consulted here. During playback the grid lane follows
     * the effective pattern section by section (see gridFollowStrum in
     * js/grid.js) and restores the user's choice when the metronome stops;
     * collapsing the selectors returns the row to this song default. */

    /* Set the strum pattern shown on the top row without persisting it: used
     * when playback follows the effective pattern section by section. Rebuilds
     * the row and keeps the selector in step. */
    SB.strumSetPattern = function (pattern) {
        SB.state.strum.pattern = pattern;
        if (pattern) {
            renderRow();
            buildSelect();
        }
        SB.applyStrumSettings();
    };

    /* Persist a bar-level strum override (pattern id, or null to inherit) in
     * the per-song edit plan. Coordinates are block/bar positions in the grid. */
    SB.setBarOverride = function (sbId, songId, block, bar, patternId) {
        if (!sbId) sbId = SB.state.active && SB.state.active.id;
        if (!sbId || !songId) return;
        var plan = SB.loadPlan(sbId, songId);
        var key = SB.planBarKey(block, bar);
        if (patternId == null) { delete plan.barStrums[key]; }
        else { plan.barStrums[key] = patternId; }
        SB.savePlan(sbId, songId, plan);
    };

    /* Persist a beat-level strum override (subdivision slots string, or null
     * to inherit) in the per-song edit plan. Coordinates are block/bar/beat. */
    SB.setBeatOverride = function (sbId, songId, block, bar, beat, slots) {
        if (!sbId) sbId = SB.state.active && SB.state.active.id;
        if (!sbId || !songId) return;
        var plan = SB.loadPlan(sbId, songId);
        var key = SB.planBeatKey(block, bar, beat);
        if (slots == null) { delete plan.beatStrums[key]; }
        else { plan.beatStrums[key] = String(slots); }
        SB.savePlan(sbId, songId, plan);
    };

    /* The collapsed row shows one song-wide pattern: start at the song's
     * first section so a section default previews correctly when one exists. */

    function chooseFor(song) {
        if (!song) return null;
        return mainPatternFor(song, currentPlanFor(song));
    }

    /* ---------------- rendering ---------------- */

    var raf = null;
    var lastSlot = -1;
    /* Per-section selectors: the disclosure state and the role whose pattern
     * is being previewed in the row. Both are UI-only (the plan is the source
     * of truth), so they reset when the song changes and never leak into the
     * songbook data. */
    var sectionsOpen = false;
    var previewRole = null;
    /* 'countin' while the lead-in bar runs, 'pattern' once it hands over. The
     * two phases share one set of cells (see renderRow), so this is what says
     * which glyphs those cells are currently showing. */
    var phase = null;

    function slotGlyph(ch) {
        if (ch === '-') return '\u00b7';   // middle dot for a rest, either way
        if (SB.state.strum.notation === 'letters') return ch;  // 'D' / 'U'
        if (ch === 'D') return '\u2193';   // downward arrow
        if (ch === 'U') return '\u2191';   // upward arrow
        return '\u00b7';
    }

    /* The count-in's label for a slot: the felt beat number on each beat
     * ("1 2 3 4"), a dot on the subdivisions in between. Counting out loud is
     * how a count-in is actually given, and the numbers also say how long it
     * lasts — which a bar of identical rests never did. */
    function countGlyph(pattern, i) {
        if (i % pattern.subdiv !== 0) return '\u00b7';
        return String(i / pattern.subdiv + 1);
    }

    /* Builds the subdivision row: one bar of cells for the pattern, with bar
     * lines around it. Each slot is one cell so the highlight can toggle a
     * single class without re-rendering.
     *
     * There is no separate count-in bar. A count-in bar doubled the row's width
     * for something that is only meaningful for the two seconds it runs, and on
     * a phone that is the difference between the pattern fitting on screen and
     * not. One bar at the pattern's subdivision is exactly as many slots as the
     * pattern has, so the count-in can run through these same cells — see
     * setPhase. The row carries the phase, not the cells, because the cells are
     * the same elements in both. */
    function renderRow() {
        var row = SB.$('strumRow');
        if (!row) return;
        row.textContent = '';
        var pattern = SB.state.strum.pattern;
        if (!pattern) return;

        var bar = SB.el('div', 'strum-bar pattern');
        var cells = SB.el('div', 'strum-cells');
        for (var i = 0; i < pattern.slots.length; i++) {
            var cell = SB.el('div', 'strum-slot', slotGlyph(pattern.slots[i]));
            if (pattern.slots[i] === '-') cell.classList.add('rest');
            // Mark the first slot of each felt beat so beat 1 and the pulse
            // read clearly even when stopped.
            if (i % pattern.subdiv === 0) cell.classList.add('beat');
            cell.dataset.idx = String(i);
            cells.appendChild(cell);
        }
        bar.appendChild(cells);
        row.appendChild(bar);
        phase = null;
        setPhase('pattern');
        lastSlot = -1;
    }

    /* Swaps the cells between counting you in and showing the pattern. Only the
     * glyphs and the row's phase change — the cells, their order and their
     * data-idx stay put, so the highlight indexes the same grid either way and
     * nothing reflows when the count-in hands over on beat 1. */
    function setPhase(next) {
        if (phase === next) return;
        var row = SB.$('strumRow');
        var pattern = SB.state.strum.pattern;
        if (!row || !pattern) return;
        phase = next;
        var counting = next === 'countin';
        row.dataset.phase = next;
        row.classList.toggle('is-countin', counting);
        Array.prototype.forEach.call(row.querySelectorAll('.strum-slot'), function (cell) {
            var i = parseInt(cell.dataset.idx, 10);
            cell.textContent = counting ? countGlyph(pattern, i) : slotGlyph(pattern.slots[i]);
            cell.classList.toggle('rest', counting
                ? i % pattern.subdiv !== 0
                : pattern.slots[i] === '-');
        });
    }

    function buildSelect() {
        var sel = SB.$('strumSelect');
        if (!sel) return;
        sel.textContent = '';
        var song = SB.state.currentSong;
        var plan = song ? currentPlanFor(song) : SB.emptyPlan();
        var list = song ? SB.strumPatternsForSong(song, plan) : [];
        list.forEach(function (p) {
            var opt = SB.el('option', null, p.name);
            opt.value = p.id;
            // Marks the entries that came from the plan, so a stylesheet or a
            // test can tell them apart without relying on the name.
            if (!byId[p.id]) opt.dataset.custom = '1';
            sel.appendChild(opt);
        });
        if (SB.state.strum.pattern) sel.value = SB.state.strum.pattern.id;
    }

    /* ---------------- per-section selectors ---------------- */

    /* Display names for the canonical roles in js/sections.js. Kept as a
     * presentation table so the stored/exported value stays language-neutral
     * (`pre_chorus`, not "Pre-chorus"). */
    var ROLE_LABELS = {
        intro: 'Intro',
        verse: 'Verse',
        pre_chorus: 'Pre-chorus',
        chorus: 'Chorus',
        bridge: 'Bridge',
        outro: 'Outro',
        interlude: 'Interlude',
        solo: 'Solo',
        tag: 'Tag',
        other: 'Other'
    };

    function roleLabel(role) {
        return ROLE_LABELS[role] || role;
    }

    function sectionRolesFor(song, plan) {
        if (!song) return [];
        return SB.songSectionRoles ? SB.songSectionRoles(song, plan) : [];
    }

    /* True when the sections do not all play the same effective pattern as
     * the song. A role with no override inherits by definition; only a valid
     * override that resolves to a different pattern counts. */
    function sectionsDiffer(song, plan, roles) {
        var main = mainPatternFor(song, plan);
        if (!main) return false;
        var time = timeFor(song, plan);
        return roles.some(function (role) {
            var pattern = findPattern(plan.sectionStrums[role], time, plan);
            return !!pattern && pattern.id !== main.id;
        });
    }

    function appendPatternOptions(select, song, plan, selected) {
        var inherit = SB.el('option', null, 'Same as song');
        inherit.value = '';
        select.appendChild(inherit);
        SB.strumPatternsForSong(song, plan).forEach(function (p) {
            var opt = SB.el('option', null, p.name);
            opt.value = p.id;
            if (!byId[p.id]) opt.dataset.custom = '1';
            select.appendChild(opt);
        });
        select.value = selected || '';
        // A stale/corrupt value can name a pattern that no longer fits the
        // metre (or was deleted). Showing "Same as song" is truthful: the
        // resolver will inherit until the user chooses again.
        if (select.value !== (selected || '')) select.value = '';
    }

    function updateSectionsButton(song, plan, roles) {
        var btn = SB.$('strumSectionsBtn');
        var summary = SB.$('strumSectionsSummary');
        if (!btn) return;
        if (!roles) roles = sectionRolesFor(song, plan || SB.emptyPlan());
        var differ = roles.length > 0 && sectionsDiffer(song, plan || SB.emptyPlan(), roles);
        var collapsedDiff = !sectionsOpen && differ;
        if (summary) {
            // Keep the control down to its chevron unless there is something
            // to report: "multiple patterns" when sections disagree, or a
            // short notice when there are no sections to choose from.
            var note = collapsedDiff ? 'Multiple patterns'
                : (!sectionsOpen && !roles.length ? 'No sections' : '');
            summary.textContent = note;
            summary.hidden = !note;
        }
        btn.classList.toggle('is-multiple', collapsedDiff);
        btn.setAttribute('aria-expanded', sectionsOpen ? 'true' : 'false');
        var label = sectionsOpen
            ? 'Hide per-section strum patterns'
            : (roles.length
                ? 'Show per-section strum patterns' +
                    (differ ? ' (multiple patterns in use)' : '')
                : 'Show per-section strum patterns (this song has no sections)');
        btn.setAttribute('aria-label', label);
        btn.title = label;
    }

    function renderSectionSelectors() {
        var list = SB.$('strumSectionsList');
        var empty = SB.$('strumSectionsEmpty');
        if (!list) return;
        var song = SB.state.currentSong;
        var plan = song ? currentPlanFor(song) : SB.emptyPlan();
        var roles = sectionRolesFor(song, plan);
        var time = song ? timeFor(song, plan) : null;

        list.textContent = '';
        if (empty) empty.hidden = roles.length > 0;
        roles.forEach(function (role) {
            var field = SB.el('label', 'strum-section-field');
            var name = roleLabel(role);
            var text = SB.el('span', 'strum-section-label', name);
            field.appendChild(text);

            var select = SB.el('select', 'strum-section-select');
            select.dataset.role = role;
            select.setAttribute('aria-label',
                'Strum pattern for all ' + name.toLowerCase() + ' sections');
            var stored = plan.sectionStrums[role];
            appendPatternOptions(select, song, plan,
                findPattern(stored, time, plan) ? stored : '');
            select.addEventListener('change', function () {
                setSectionChoice(role, select.value);
            });
            field.appendChild(select);
            list.appendChild(field);
        });
        updateSectionsButton(song, plan, roles);
        var panel = SB.$('strumSections');
        if (panel) panel.hidden = !(sectionsOpen && song && SB.state.strum.pattern);
    }

    function setSectionChoice(role, id) {
        var song = SB.state.currentSong;
        var active = SB.state.active;
        if (!song || !active) return;
        var plan = SB.loadPlan(active.id, song.id);
        var merged = planWithSong(song, plan);
        var pattern = id ? findPattern(id, timeFor(song, merged), merged) : null;
        if (pattern) plan.sectionStrums[role] = pattern.id;
        else delete plan.sectionStrums[role];
        SB.savePlan(active.id, song.id, plan);

        // Selecting a section previews it in the single row. "Same as song"
        // removes the override and returns the row to the inherited pattern.
        previewRole = pattern ? role : null;
        SB.state.strum.pattern = previewRole
            ? sectionPatternFor(song, role, plan)
            : mainPatternFor(song, plan);
        renderRow();
        refreshGridLane();
        if (SB.state.metronome.playing) SB.strumOnMetronomeStart();
        updateSectionsButton(song, plan);
    }

    /* Expand/collapse the section selectors. Collapsing is also a preview
     * reset: the row goes back to the one song-wide pattern, exactly as it
     * behaved before this control existed. */
    SB.toggleStrumSections = function () {
        sectionsOpen = !sectionsOpen;
        if (!sectionsOpen) previewRole = null;
        var song = SB.state.currentSong;
        var plan = song ? currentPlanFor(song) : SB.emptyPlan();
        if (song) {
            SB.state.strum.pattern = previewRole
                ? sectionPatternFor(song, previewRole, plan)
                : mainPatternFor(song, plan);
        }
        renderRow();
        renderSectionSelectors();
        SB.updateStrumUi();
        if (SB.state.metronome.playing) SB.strumOnMetronomeStart();
        if (!sectionsOpen) {
            var btn = SB.$('strumSectionsBtn');
            if (btn) {
                try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
            }
        }
    };

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

        // Phase first: the cells have to be showing the right glyphs before a
        // slot in them is lit, or beat 1 of the pattern flashes on a cell that
        // still reads as a count.
        setPhase(cls);
        if (slot !== lastSlot) {
            paint(slot);
            lastSlot = slot;
        }
        raf = requestAnimationFrame(highlightFrame);
    }

    function paint(idx) {
        var row = SB.$('strumRow');
        if (!row) return;
        Array.prototype.forEach.call(row.querySelectorAll('.strum-slot.on'), function (c) {
            c.classList.remove('on');
        });
        var active = row.querySelector('.strum-slot[data-idx="' + idx + '"]');
        if (active) active.classList.add('on');
    }

    function clearHighlight() {
        var row = SB.$('strumRow');
        if (!row) return;
        Array.prototype.forEach.call(row.querySelectorAll('.strum-slot.on'), function (c) {
            c.classList.remove('on');
        });
        // Stopped means "showing the pattern": the count-in only has meaning
        // while something is counting, and leaving the row full of numbers
        // would hide the one thing it exists to show.
        setPhase('pattern');
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

    /* Shows or hides both halves of the feature together: the selector in the
     * toolbar and the subdivision row under the chord strip. Both start hidden
     * in the markup, so the row has to be unhidden here — without that the
     * pattern is rendered into a display:none element and the whole feature is
     * invisible, leaving the selector and the notation toggle apparently inert
     * because the only thing they change cannot be seen. */
    SB.updateStrumUi = function () {
        var group = SB.$('strumGroup');
        var row = SB.$('strumRow');
        var sections = SB.$('strumSections');
        var on = SB.state.strum.pattern !== null;
        if (group) group.hidden = !on;
        if (row) row.hidden = !on;
        if (sections) sections.hidden = !on || !sectionsOpen;
        SB.applyStrumSettings();
    }

    /* A pinned strum row has to sit directly under whatever is already pinned
     * above it, and the chord strip's height is not a constant: it changes with
     * the diagram size, and the strip leaves the sticky stack entirely when its
     * own pin is off. So measure it rather than hard-coding an offset, and fall
     * back to the top bar alone when the strip is unpinned or absent.
     *
     * Measured from the live layout on every apply, which is also why
     * applyChordSettings calls through here: changing the diagram size or the
     * strip's pin has to move the row that sits beneath it. */
    function updateStickyOffset() {
        var row = SB.$('strumRow');
        if (!row) return;
        var strip = SB.$('chordStrip');
        var stripH = (strip && SB.state.chordPin && !strip.hidden)
            ? Math.round(strip.getBoundingClientRect().height)
            : 0;
        row.style.top = 'calc(var(--topbar-h) + ' + stripH + 'px)';
    }

    SB.applyStrumSettings = function () {
        document.documentElement.style.setProperty('--strum-size', SB.state.strumSize);
        var val = SB.$('strumSizeValue');
        if (val) val.textContent = Math.round(SB.state.strumSize * 100) + '%';

        var p = SB.$('strumPinBtn');
        if (p) {
            p.setAttribute('aria-pressed', SB.state.strumPin ? 'true' : 'false');
            p.textContent = SB.state.strumPin ? '📌' : '📍';
            p.setAttribute('aria-label', SB.state.strumPin
                ? 'Strum row pinned to the top — click to let it scroll with the lyrics'
                : 'Strum row scrolls — click to keep it pinned to the top');
            p.title = SB.state.strumPin
                ? 'Pinned — click to let the strum row scroll'
                : 'Not pinned — click to keep the strum row at the top';
        }
        var row = SB.$('strumRow');
        if (row) row.classList.toggle('is-static', !SB.state.strumPin);
        updateStickyOffset();
    }

    SB.setStrumSize = function (v) {
        SB.state.strumSize = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(v * 10) / 10));
        SB.applyStrumSettings();
        try { window.localStorage.setItem(SB.NS + ':strumSize', String(SB.state.strumSize)); }
        catch (e) { /* ignore */ }
    }

    SB.toggleStrumPin = function () {
        SB.state.strumPin = !SB.state.strumPin;
        try { window.localStorage.setItem(SB.NS + ':strumPin', SB.state.strumPin ? '1' : '0'); }
        catch (e) { /* ignore */ }
        SB.applyStrumSettings();
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
            /* Not aria-pressed: neither notation is an "on" state, so a
             * pressed/unpressed toggle would announce arrows as un-set. This
             * is a two-way switch between equal choices, so the button just
             * names what it will do next and the label carries the state. */
            var label = letters
                ? 'Showing D/U letters — click for arrows'
                : 'Showing arrows — click for D/U letters';
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
        if (SB.state.strum.pattern) {
            renderRow();
            refreshGridLane();
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
     * documented default, else the first for the metre, using DEFAULT_TIME
     * when the song has no metre), renders the row and the selector, and shows
     * the whole control on every song. */
    SB.loadStrumForSong = function (song) {
        closePatternEditor();
        SB.strumOnMetronomeStop();
        sectionsOpen = false;
        previewRole = null;
        SB.state.strum.pattern = chooseFor(song);
        renderRow();
        buildSelect();
        renderSectionSelectors();
        SB.updateStrumUi();
    }

    SB.setStrum = function (id) {
        var song = SB.state.currentSong;
        if (!song) return;
        var plan = currentPlanFor(song);
        var pattern = findPattern(id, timeFor(song, plan), plan);
        if (!pattern) return;
        previewRole = null;
        SB.state.strum.pattern = pattern;
        if (SB.state.active) saveChoice(SB.state.active.id, song.id, pattern.id);
        renderRow();
        buildSelect();
        renderSectionSelectors();
        SB.updateStrumUi();
        refreshGridLane();
        // If the metronome is already running, keep the highlight going on the
        // new row; strumOnMetronomeStart is a no-op if the loop is already up.
        if (SB.state.metronome.playing) SB.strumOnMetronomeStart();
    }

    /* ---------------- custom pattern editor ----------------
     *
     * Custom definitions live in the Step 2 plan (plan.customPatterns). The
     * editor never touches the built-in PATTERNS array: a built-in can only be
     * duplicated into a custom definition, and every custom reference is by id
     * so renaming or re-slotting one definition updates every place that uses
     * it. */

    var editor = null;
    var MAX_SUBDIV = 4;

    function customPatternIn(plan, id) {
        var custom = (plan && plan.customPatterns) || [];
        for (var i = 0; i < custom.length; i++) {
            if (custom[i].id === id) return custom[i];
        }
        return null;
    }

    function generatePatternId(plan) {
        var base = 'custom-' + Date.now().toString(36);
        var id = base;
        var n = 2;
        while (byId[id] || customPatternIn(plan, id)) id = base + '-' + (n++);
        return id;
    }

    function copyName(base, plan) {
        var stem = (base || 'Pattern') + ' copy';
        var name = stem;
        var n = 2;
        while ((plan.customPatterns || []).some(function (p) { return p.name === name; })) {
            name = stem + ' ' + (n++);
        }
        return name;
    }

    function slotWord(ch) {
        return ch === 'D' ? 'down' : (ch === 'U' ? 'up' : 'rest');
    }

    function nextSlot(ch) {
        return ch === 'D' ? 'U' : (ch === 'U' ? '-' : 'D');
    }

    /* The single validation the editor uses before it writes a definition to
     * the plan. Returns a clear, user-facing message, or null when valid. The
     * `excludeId` argument lets an edit keep its own id while still rejecting
     * a duplicate. */
    SB.validateCustomPattern = function (pattern, plan, time, excludeId) {
        if (!pattern || typeof pattern !== 'object') return 'Pattern data is missing.';
        var name = typeof pattern.name === 'string' ? pattern.name.trim() : '';
        if (!name) return 'Give the pattern a name.';
        if (!time) return 'This song has no metre to match.';
        if (pattern.time !== time) {
            return 'Pattern metre must match the song\'s metre (' + time + ').';
        }
        var subdiv = pattern.subdiv;
        if (typeof subdiv !== 'number' || !isFinite(subdiv) ||
            subdiv < 1 || subdiv !== Math.floor(subdiv)) {
            return 'Subdivision must be a whole number of at least 1.';
        }
        var slots = pattern.slots;
        if (typeof slots !== 'string' || !slots.length) return 'Add at least one slot.';
        if (!/^[DU-]+$/.test(slots)) {
            return 'Use only D (down), U (up) and - (rest) in the slots.';
        }
        var expected = SB.metronomeBeatsPerBar(time) * subdiv;
        if (slots.length !== expected) {
            return 'A ' + time + ' pattern at ' + subdiv + ' slot' +
                (subdiv === 1 ? '' : 's') + ' per beat needs ' + expected +
                ' slots; this one has ' + slots.length + '.';
        }
        var id = pattern.id;
        if (typeof id !== 'string' || !id) return 'Pattern id is missing.';
        if (byId[id]) return 'That id belongs to a built-in pattern, which cannot be replaced.';
        var custom = (plan && plan.customPatterns) || [];
        for (var i = 0; i < custom.length; i++) {
            if (custom[i].id === id && id !== excludeId) {
                return 'That pattern id is already in use.';
            }
        }
        return null;
    }

    function defaultSlots(beats, subdiv) {
        var out = '';
        for (var b = 0; b < beats; b++) {
            for (var i = 0; i < subdiv; i++) out += i === 0 ? 'D' : '-';
        }
        return out;
    }

    /* Changing the subdivision keeps each felt beat's opening slots and pads
     * the rest with rests, so beat 1 does not jump from down-stroke to rest
     * while the user is nudging the grid finer. */
    function resizeSlots(slots, oldSubdiv, newSubdiv, beats) {
        var out = '';
        for (var b = 0; b < beats; b++) {
            for (var i = 0; i < newSubdiv; i++) {
                var idx = b * oldSubdiv + i;
                out += i < oldSubdiv && idx < slots.length ? slots[idx] : '-';
            }
        }
        return out;
    }

    function showPatternError(message) {
        var err = SB.$('patternError');
        if (!err) return;
        err.textContent = message;
        err.hidden = false;
        try { err.focus({ preventScroll: true }); } catch (e) { err.focus(); }
    }

    function clearPatternError() {
        var err = SB.$('patternError');
        if (!err) return;
        err.textContent = '';
        err.hidden = true;
    }

    function patternTitle(text) {
        var title = SB.$('patternTitle');
        if (title) title.textContent = text;
    }

    function setPatternPane(name) {
        var list = SB.$('patternListPane');
        var form = SB.$('patternForm');
        if (list) list.hidden = name === 'form';
        if (form) form.hidden = name !== 'form';
    }

    function renderPatternList(plan) {
        var list = SB.$('patternList');
        if (!list || !editor) return;
        list.textContent = '';
        var song = SB.state.currentSong;
        var patterns = SB.strumPatternsForSong(song, plan);
        patterns.forEach(function (p) {
            var custom = !byId[p.id] && !!customPatternIn(plan, p.id);
            var li = SB.el('li', 'pattern-item');
            li.dataset.patternId = p.id;

            var main = SB.el('div', 'pattern-item-main');
            var title = SB.el('div', 'pattern-item-title');
            title.appendChild(SB.el('strong', 'pattern-item-name', p.name));
            title.appendChild(SB.el('span', 'pattern-tag' + (custom ? ' is-custom' : ''),
                custom ? 'Custom' : 'Built-in'));
            if (SB.state.strum.pattern && SB.state.strum.pattern.id === p.id) {
                title.appendChild(SB.el('span', 'pattern-tag is-current', 'In use'));
            }
            main.appendChild(title);

            var mini = SB.el('span', 'pattern-item-mini');
            for (var i = 0; i < p.slots.length; i++) {
                var cell = SB.el('span', 'pattern-mini-slot' +
                    (p.slots[i] === '-' ? ' rest' : '') +
                    (i % p.subdiv === 0 ? ' beat' : ''), slotGlyph(p.slots[i]));
                mini.appendChild(cell);
            }
            main.appendChild(mini);
            main.appendChild(SB.el('span', 'pattern-item-meta',
                p.time + ' \u00b7 ' + p.subdiv + ' per beat \u00b7 ' + p.slots.length + ' slots'));
            li.appendChild(main);

            var actions = SB.el('div', 'pattern-item-actions');
            if (custom) {
                actions.appendChild(patternActionButton('Edit', 'edit', p.id, p.name));
                actions.appendChild(patternActionButton('Delete', 'delete', p.id, p.name));
            }
            actions.appendChild(patternActionButton('Duplicate', 'duplicate', p.id, p.name));
            li.appendChild(actions);
            list.appendChild(li);
        });
    }

    function patternActionButton(label, action, id, name) {
        var btn = SB.el('button', 'pattern-action', label);
        btn.type = 'button';
        btn.dataset.patternAction = action;
        btn.dataset.patternId = id;
        btn.setAttribute('aria-label', label + ' pattern ' + (name || id));
        btn.addEventListener('click', function () {
            if (action === 'edit') beginPatternEdit(id);
            else if (action === 'delete') deleteCustomPattern(id);
            else duplicatePattern(id);
        });
        return btn;
    }

    function showPatternList(focus) {
        if (!editor) return;
        var plan = SB.loadPlan(editor.sbId, editor.songId);
        editor.mode = null;
        editor.id = null;
        editor.selectOnSave = false;
        clearPatternError();
        renderPatternList(plan);
        setPatternPane('list');
        patternTitle('Strum patterns');
        if (focus !== false) {
            var target = SB.$('patternNew');
            if (target) {
                try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
            }
        }
    }

    function populateSubdivs(current) {
        var sel = SB.$('patternSubdiv');
        if (!sel) return;
        sel.textContent = '';
        var max = Math.max(MAX_SUBDIV, current || 1);
        for (var n = 1; n <= max; n++) {
            var opt = SB.el('option', null, n + ' per beat');
            opt.value = String(n);
            sel.appendChild(opt);
        }
        sel.value = String(current || 2);
    }

    function renderEditorSlots() {
        var wrap = SB.$('patternSlots');
        if (!wrap || !editor) return;
        var subdiv = editor.subdiv;
        var expected = SB.metronomeBeatsPerBar(editor.time) * subdiv;
        if (editor.slots.length !== expected) {
            editor.slots = resizeSlots(editor.slots, subdiv, subdiv,
                SB.metronomeBeatsPerBar(editor.time));
        }
        wrap.textContent = '';
        for (var i = 0; i < editor.slots.length; i++) {
            (function (idx) {
                var ch = editor.slots.charAt(idx);
                var btn = SB.el('button', 'pattern-slot' +
                    (ch === '-' ? ' rest' : '') +
                    (idx % subdiv === 0 ? ' beat' : '') +
                    (idx === 0 ? ' first' : ''),
                    ch === '-' ? '\u00b7' : ch);
                btn.type = 'button';
                btn.dataset.idx = String(idx);
                btn.setAttribute('aria-label', 'Slot ' + (idx + 1) + ': ' + slotWord(ch) +
                    '. Activate to change to ' + slotWord(nextSlot(ch)) + '.');
                btn.title = 'Slot ' + (idx + 1) + ': ' + slotWord(ch) +
                    ' \u2014 click for ' + slotWord(nextSlot(ch));
                btn.addEventListener('click', function () {
                    cyclePatternSlot(idx);
                });
                wrap.appendChild(btn);
            })(i);
        }
        updatePatternPreview();
    }

    function cyclePatternSlot(idx) {
        if (!editor || idx < 0 || idx >= editor.slots.length) return;
        var next = nextSlot(editor.slots.charAt(idx));
        editor.slots = editor.slots.slice(0, idx) + next + editor.slots.slice(idx + 1);
        renderEditorSlots();
        var btn = SB.$('patternSlots') &&
            SB.$('patternSlots').querySelector('.pattern-slot[data-idx="' + idx + '"]');
        if (btn) {
            try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
        }
    }

    function updatePatternPreview() {
        var preview = SB.$('patternPreview');
        if (!preview || !editor) return;
        preview.textContent = '';
        for (var i = 0; i < editor.slots.length; i++) {
            var ch = editor.slots.charAt(i);
            preview.appendChild(SB.el('span', 'pattern-preview-slot' +
                (ch === '-' ? ' rest' : '') +
                (i % editor.subdiv === 0 ? ' beat' : ''), slotGlyph(ch)));
        }
    }

    function fillPatternForm(pattern) {
        if (!editor) return;
        editor.subdiv = pattern.subdiv;
        editor.slots = pattern.slots;
        editor.time = pattern.time;
        var name = SB.$('patternName');
        if (name) name.value = pattern.name;
        var time = SB.$('patternTime');
        if (time) time.textContent = pattern.time;
        populateSubdivs(pattern.subdiv);
        clearPatternError();
        renderEditorSlots();
        var del = SB.$('patternDelete');
        if (del) del.hidden = editor.mode !== 'edit';
        var save = SB.$('patternSave');
        if (save) save.textContent = editor.mode === 'edit' ? 'Save' : 'Create';
        setPatternPane('form');
        patternTitle(editor.mode === 'edit' ? 'Edit pattern' :
            (editor.mode === 'duplicate' ? 'Duplicate pattern' : 'New pattern'));
        if (name) {
            try { name.focus({ preventScroll: true }); name.select(); }
            catch (e) { name.focus(); }
        }
    }

    function beginPatternCreate(prefill) {
        if (!editor) return;
        var plan = SB.loadPlan(editor.sbId, editor.songId);
        var time = editor.time;
        var subdiv = (prefill && prefill.subdiv) || 2;
        if (subdiv < 1 || subdiv !== Math.floor(subdiv)) subdiv = 2;
        var slots = prefill && prefill.slots;
        if (!slots || slots.length !== SB.metronomeBeatsPerBar(time) * subdiv) {
            slots = defaultSlots(SB.metronomeBeatsPerBar(time), subdiv);
        }
        editor.mode = prefill ? 'duplicate' : 'create';
        editor.id = null;
        editor.selectOnSave = true;
        fillPatternForm({
            name: prefill ? copyName(prefill.name, plan) : '',
            time: time,
            subdiv: subdiv,
            slots: slots
        });
    }

    function beginPatternEdit(id) {
        if (!editor) return;
        var plan = SB.loadPlan(editor.sbId, editor.songId);
        var pattern = customPatternIn(plan, id);
        if (!pattern) return;
        editor.mode = 'edit';
        editor.id = id;
        editor.selectOnSave = false;
        fillPatternForm(pattern);
    }

    function duplicatePattern(id) {
        if (!editor) return;
        var song = SB.state.currentSong;
        var plan = SB.loadPlan(editor.sbId, editor.songId);
        var pattern = findPattern(id, editor.time,
            song ? planWithSong(song, plan) : plan);
        if (pattern) beginPatternCreate(pattern);
    }

    function refreshCurrentStrum() {
        var song = SB.state.currentSong;
        if (!song) return;
        var plan = currentPlanFor(song);
        if (previewRole && sectionRolesFor(song, plan).indexOf(previewRole) < 0) {
            previewRole = null;
        }
        SB.state.strum.pattern = previewRole
            ? sectionPatternFor(song, previewRole, plan)
            : chooseFor(song);
        renderRow();
        buildSelect();
        renderSectionSelectors();
        SB.updateStrumUi();
        refreshGridLane();
        if (SB.state.metronome.playing) SB.strumOnMetronomeStart();
    }

    function savePatternForm(e) {
        if (e) e.preventDefault();
        if (!editor) return;
        var song = SB.state.currentSong;
        var active = SB.state.active;
        if (!song || !active || active.id !== editor.sbId || song.id !== editor.songId) {
            showPatternError('The song changed while this editor was open. Close it and try again.');
            return;
        }
        var plan = SB.loadPlan(editor.sbId, editor.songId);
        var time = timeFor(song, plan);
        if (time !== editor.time) {
            showPatternError('The song\'s metre changed to ' + time + '. Close the editor and try again.');
            return;
        }
        var nameEl = SB.$('patternName');
        var name = nameEl ? nameEl.value.replace(/\s+/g, ' ').trim() : '';
        var id = editor.id || generatePatternId(plan);
        var pattern = {
            id: id,
            name: name,
            time: time,
            subdiv: editor.subdiv,
            slots: editor.slots
        };
        var error = SB.validateCustomPattern(pattern, plan, time, editor.id);
        if (error) { showPatternError(error); return; }

        var list = plan.customPatterns || [];
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) { idx = i; break; }
        }
        if (idx >= 0) list[idx] = pattern;
        else list.push(pattern);
        plan.customPatterns = list;
        // A newly created/duplicated pattern becomes the song's manual choice;
        // editing an existing one leaves the current selection alone.
        if (editor.mode !== 'edit') plan.songStrum = pattern.id;
        SB.savePlan(editor.sbId, editor.songId, plan);
        if (editor.mode !== 'edit') saveChoice(editor.sbId, editor.songId, pattern.id);

        refreshCurrentStrum();
        closePatternEditor();
    }

    function deleteCustomPattern(id) {
        if (!editor) return;
        var plan = SB.loadPlan(editor.sbId, editor.songId);
        if (!customPatternIn(plan, id)) return;
        plan.customPatterns = (plan.customPatterns || []).filter(function (p) {
            return p.id !== id;
        });
        // A deleted definition must not leave dangling references: fall back to
        // the song/library defaults rather than silently keeping a dead id.
        if (plan.songStrum === id) plan.songStrum = null;
        Object.keys(plan.sectionStrums || {}).forEach(function (role) {
            if (plan.sectionStrums[role] === id) delete plan.sectionStrums[role];
        });
        Object.keys(plan.barStrums || {}).forEach(function (key) {
            if (plan.barStrums[key] === id) delete plan.barStrums[key];
        });
        SB.savePlan(editor.sbId, editor.songId, plan);
        try {
            if (window.localStorage.getItem(SB.strumKey(editor.sbId, editor.songId)) === id) {
                window.localStorage.removeItem(SB.strumKey(editor.sbId, editor.songId));
            }
        } catch (e) { /* ignore */ }
        refreshCurrentStrum();
        showPatternList();
    }

    function patternFocusables() {
        var sheet = SB.$('patternSheet');
        if (!sheet) return [];
        return Array.prototype.filter.call(
            sheet.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
            function (el) {
                return !el.disabled && !el.hidden && el.offsetParent !== null;
            });
    }

    function onPatternEditorKeydown(e) {
        var ov = SB.$('patternOverlay');
        if (!ov || ov.hidden) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closePatternEditor();
            return;
        }
        if (e.key !== 'Tab') return;
        var focusables = patternFocusables();
        if (!focusables.length) { e.preventDefault(); return; }
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var active = document.activeElement;
        if (e.shiftKey && (active === first || active === SB.$('patternSheet'))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function openPatternEditor() {
        var song = SB.state.currentSong;
        var active = SB.state.active;
        var ov = SB.$('patternOverlay');
        if (!song || !active || !ov) return;
        var plan = SB.loadPlan(active.id, song.id);
        // Opening again while the manager is already up (for example after a
        // programmatic click on the toolbar) must keep the original opener;
        // the focused element at that point may be inside the dialog and about
        // to be hidden.
        var opener = (editor && editor.opener) || document.activeElement;
        if (editor) closePatternEditor({ restoreFocus: false });
        editor = {
            sbId: active.id,
            songId: song.id,
            time: timeFor(song, plan),
            opener: opener,
            mode: null,
            id: null,
            selectOnSave: false
        };
        ov.hidden = false;
        ov.setAttribute('aria-hidden', 'false');
        document.body.classList.add('pattern-open');
        document.addEventListener('keydown', onPatternEditorKeydown);
        renderPatternList(plan);
        setPatternPane('list');
        patternTitle('Strum patterns');
        var sheet = SB.$('patternSheet');
        if (sheet) {
            try { sheet.focus({ preventScroll: true }); } catch (e) { sheet.focus(); }
        }
    }

    function closePatternEditor(opts) {
        var ov = SB.$('patternOverlay');
        if (!ov || ov.hidden) {
            editor = null;
            return;
        }
        var opener = editor && editor.opener;
        ov.hidden = true;
        ov.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('pattern-open');
        document.removeEventListener('keydown', onPatternEditorKeydown);
        editor = null;
        if (!opts || opts.restoreFocus !== false) {
            var target = (opener && opener.isConnected && opener.offsetParent !== null)
                ? opener : SB.$('strumEditBtn');
            if (target) {
                try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
            }
        }
    }

    SB.openPatternEditor = openPatternEditor;
    SB.closePatternEditor = closePatternEditor;

    SB.bindStrum = function () {
        var sel = SB.$('strumSelect');
        if (sel) sel.addEventListener('change', function () { SB.setStrum(sel.value); });
        var nbtn = SB.$('strumNotationBtn');
        if (nbtn) nbtn.addEventListener('click', SB.toggleStrumNotation);

        var edit = SB.$('strumEditBtn');
        if (edit) edit.addEventListener('click', openPatternEditor);
        var sectionsBtn = SB.$('strumSectionsBtn');
        if (sectionsBtn) sectionsBtn.addEventListener('click', SB.toggleStrumSections);
        var sectionsPanel = SB.$('strumSections');
        if (sectionsPanel) sectionsPanel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sectionsOpen) {
                e.preventDefault();
                SB.toggleStrumSections();
            }
        });
        var close = SB.$('patternClose');
        if (close) close.addEventListener('click', function () { closePatternEditor(); });
        var cancel = SB.$('patternCancel');
        if (cancel) cancel.addEventListener('click', function () { showPatternList(); });
        var newBtn = SB.$('patternNew');
        if (newBtn) newBtn.addEventListener('click', function () { beginPatternCreate(null); });
        var form = SB.$('patternForm');
        if (form) form.addEventListener('submit', savePatternForm);
        var del = SB.$('patternDelete');
        if (del) del.addEventListener('click', function () {
            if (editor && editor.id) deleteCustomPattern(editor.id);
        });
        var subdiv = SB.$('patternSubdiv');
        if (subdiv) subdiv.addEventListener('change', function () {
            if (!editor) return;
            var next = parseInt(subdiv.value, 10);
            if (!(next >= 1) || next !== Math.floor(next)) return;
            editor.slots = resizeSlots(editor.slots, editor.subdiv, next,
                SB.metronomeBeatsPerBar(editor.time));
            editor.subdiv = next;
            renderEditorSlots();
        });
        var name = SB.$('patternName');
        if (name) name.addEventListener('input', clearPatternError);
        var overlay = SB.$('patternOverlay');
        if (overlay) overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) closePatternEditor();
        });

        var down = SB.$('strumSizeDown');
        if (down) down.addEventListener('click', function () { SB.setStrumSize(SB.state.strumSize - 0.1); });
        var up = SB.$('strumSizeUp');
        if (up) up.addEventListener('click', function () { SB.setStrumSize(SB.state.strumSize + 0.1); });
        var pin = SB.$('strumPinBtn');
        if (pin) pin.addEventListener('click', SB.toggleStrumPin);

        /* The strip above changes height without anything here firing: its
         * chord diagrams are images that finish loading after the row is first
         * positioned (measured 21px, then 121px once they arrive), it reflows
         * on resize, and it rewraps when the song or transpose changes. Watch
         * it rather than guessing when to re-measure, so a pinned row cannot
         * end up overlapping the strip or floating below it. */
        var strip = SB.$('chordStrip');
        if (strip && window.ResizeObserver) {
            new ResizeObserver(updateStickyOffset).observe(strip);
        }
        window.addEventListener('resize', updateStickyOffset);

        SB.applyStrumNotation();
        SB.applyStrumSettings();
    }

})(window.SB = window.SB || {});
