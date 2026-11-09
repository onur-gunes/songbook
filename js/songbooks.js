/* Songbook — songbooks
 * songbook normalisation, indexing and the active songbook
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- songbook store ---------------- */


    SB.activeSongs = function () { return SB.state.active ? SB.state.active.songs : []; }
    SB.allSongbooks = function () { return SB.state.bundled.concat(SB.state.imported); }

    /* Tempo bounds and metres, mirroring chordpro.py (BPM_MIN/BPM_MAX,
     * TIME_SIGNATURES). bpm is the felt pulse: quarter-note in simple metres,
     * dotted-quarter in 6/8. Keep the two lists in step. */
    var BPM_MIN = 20, BPM_MAX = 300;
    var TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4'];

    /* Felt beats per bar per metre, mirroring chordpro.BEATS_PER_BAR. A grid
     * bar must sum to this many beats; 6/8 is two dotted-quarter pulses, not
     * six eighths, matching how bpm and the strum library count 6/8. */
    var BEATS_PER_BAR = { '4/4': 4, '3/4': 3, '6/8': 2, '2/4': 2 };

    /* Imported songbooks are untrusted JSON, so an out-of-range or non-numeric
     * tempo is dropped to null rather than clamped: clamping "0" to 20 would
     * invent a tempo the song never had and silently drive the metronome at a
     * fabricated speed. null means "unknown", which every consumer can handle. */
    function normalizeBpm(value) {
        if (typeof value !== 'number' || !isFinite(value)) return null;
        var bpm = Math.round(value);
        return (bpm >= BPM_MIN && bpm <= BPM_MAX) ? bpm : null;
    }

    function normalizeTime(value) {
        return TIME_SIGNATURES.indexOf(value) >= 0 ? value : null;
    }

    /* A strum is kept as a bare id string here; js/strum.js owns the pattern
     * library and resolves the id against it (and against the song's metre) at
     * open time. Keeping it a string rather than resolving here avoids a
     * load-order dependency on strum.js. Per-section patterns would be a
     * separate field; this one is the song's single documented default. */
    function normalizeStrum(value) {
        return (typeof value === 'string' && value) ? value : null;
    }

    /* The grid is a bar/beat chart parallel to the sheet (see chordpro.py).
     * This is the untrusted-import boundary, so the whole grid is dropped to
     * null the moment anything is off — bars that do not sum to the metre, a
     * missing `time`, an empty chord — rather than letting a half-valid grid
     * reach the renderer. A build-time grid is already fully validated; this
     * only has to defend against hand-edited or hostile imported JSON. `time`
     * is the already-normalised metre (null if the song's metre was invalid).
     * Returns a clean grid array, or null to omit the field entirely. */
    function normalizeGrid(value, time) {
        if (!Array.isArray(value) || !value.length) return null;
        var beatsPerBar = BEATS_PER_BAR[time];
        if (!beatsPerBar) return null;           // a grid is meaningless without a metre
        var blocks = [];
        for (var bi = 0; bi < value.length; bi++) {
            var block = value[bi];
            if (!block || typeof block !== 'object' || !Array.isArray(block.bars) || !block.bars.length) return null;
            var bars = [];
            for (var ri = 0; ri < block.bars.length; ri++) {
                var bar = block.bars[ri];
                if (!bar || typeof bar !== 'object' || !Array.isArray(bar.beats) || !bar.beats.length) return null;
                var beats = [];
                var total = 0;
                for (var si = 0; si < bar.beats.length; si++) {
                    var seg = bar.beats[si];
                    if (!seg || typeof seg !== 'object') return null;
                    var chord = seg.chord;
                    var count = seg.beats;
                    if (typeof chord !== 'string' || !chord) return null;
                    if (typeof count !== 'number' || !isFinite(count) || count < 1 || count !== Math.floor(count)) return null;
                    total += count;
                    beats.push({ chord: chord, beats: count });
                }
                if (total !== beatsPerBar) return null;
                /* `strums` is one slot string per felt beat (bar-level strum
                 * overrides written into the grid at export). Its length must
                 * match the bar's beat total and every entry must share one
                 * subdivision; anything else drops the whole grid, matching
                 * the strict import-boundary treatment of the rest of the grid. */
                var barStrums = null;
                if (Array.isArray(bar.strums)) {
                    if (bar.strums.length !== total) return null;
                    var slotLengths = {};
                    var badEntry = false;
                    bar.strums.forEach(function (entry) {
                        if (typeof entry !== 'string' || !entry || !/^[DU-]+$/.test(entry)) badEntry = true;
                        else slotLengths[entry.length] = true;
                    });
                    if (badEntry || Object.keys(slotLengths).length !== 1) return null;
                    barStrums = bar.strums.slice();
                }
                var barOut = { beats: beats };
                if (barStrums) barOut.strums = barStrums;
                bars.push(barOut);
            }
            blocks.push({
                label: (typeof block.label === 'string') ? block.label : '',
                role: normalizeGridRole(block),
                repeat: !!block.repeat,
                bars: bars
            });
        }
        return blocks;
    }

    /* A missing or invalid role is derived from the block's label via the
     * shared role model (js/sections.js), so every imported grid block carries
     * a valid role. An explicitly present, valid role is kept as authored. */
    function normalizeGridRole(block) {
        var role = block.role;
        if (typeof role === 'string' && SB.isSectionRole(role)) return role;
        var label = typeof block.label === 'string' ? block.label : '';
        return SB.sectionRole(label);
    }

    /* `sectionStrums` maps a canonical section role to a pattern id. Only
     * real roles are kept, and only with a non-empty id; the id's metre is
     * checked against the song at pattern-resolution time (in js/strum.js),
     * so here we keep the shape clean without the pattern library (which loads
     * after this module). */
    function normalizeSectionStrums(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        var out = {};
        var any = false;
        Object.keys(value).forEach(function (role) {
            if (!SB.isSectionRole(role)) return;
            var id = value[role];
            if (typeof id === 'string' && id) { out[role] = id; any = true; }
        });
        return any ? out : null;
    }

    /* `strumPatterns` are per-song custom pattern definitions (the plan's
     * customPatterns carried into the songbook). Each entry is validated with
     * the same invariant the library is built on: a real id that does not
     * shadow a built-in (that check happens at build time, since the library
     * lives in js/strum.js), a real metre, a whole-number subdivision, and a
     * slot string whose length is exactly subdivision * felt-beats-per-bar.
     * Duplicate ids collapse to the first valid definition. */
    function normalizeStrumPatterns(value) {
        if (!Array.isArray(value)) return null;
        var out = [];
        var seen = {};
        value.forEach(function (p) {
            if (!p || typeof p !== 'object') return;
            var id = p.id, name = p.name, time = p.time, subdiv = p.subdiv, slots = p.slots;
            if (typeof id !== 'string' || !id || seen[id]) return;
            if (typeof name !== 'string' || !name.trim()) return;
            if (TIME_SIGNATURES.indexOf(time) < 0) return;
            if (typeof subdiv !== 'number' || !isFinite(subdiv) || subdiv < 1 || subdiv !== Math.floor(subdiv)) return;
            if (typeof slots !== 'string' || !slots || !/^[DU-]+$/.test(slots)) return;
            var expected = BEATS_PER_BAR[time] * subdiv;
            if (slots.length !== expected) return;
            seen[id] = true;
            out.push({ id: id, name: name.trim(), time: time, subdiv: subdiv, slots: slots });
        });
        return out.length ? out : null;
    }

    /* The sheet is the only imported field with a nested shape. A missing or
     * wrong-typed value used to reach the renderers and throw (or draw
     * garbage), so coerce it here: keep lines of valid [kind, text] segments
     * and drop anything else. An empty line is meaningful — a blank line in
     * the sheet — so it is preserved. */
    var SHEET_KINDS = { c: 1, x: 1, m: 1, b: 1, i: 1, y: 1, p: 1 };

    function normalizeSegment(seg) {
        if (!Array.isArray(seg) || seg.length < 2) return null;
        var kind = seg[0];
        if (typeof kind !== 'string' || !SHEET_KINDS[kind]) return null;
        var val = seg[1];
        if (val == null) return null;
        return [kind, String(val)];
    }

    function normalizeSheet(value) {
        if (!Array.isArray(value)) return [];
        return value.map(function (line) {
            if (!Array.isArray(line)) return null;
            return line.map(normalizeSegment).filter(Boolean);
        }).filter(function (line) { return line !== null; });
    }

    function normalizeSong(s, index) {
        if (!s || typeof s !== 'object') throw new Error('bad song entry');
        var time = normalizeTime(s.time);
        var grid = normalizeGrid(s.grid, time);
        var rawId = s.id;
        var id = (typeof rawId === 'string' || typeof rawId === 'number')
            ? String(rawId).trim() : '';
        if (!id) id = 'song-' + (index + 1);
        var song = {
            id: id,
            n: (typeof s.n === 'number' && isFinite(s.n)) ? s.n : (index + 1),
            title: String(s.title || 'Untitled'),
            artist: String(s.artist || ''),
            level: (s.level === 'Easy' || s.level === 'Medium' || s.level === 'Hard') ? s.level : 'Medium',
            new: !!s.new,
            key: s.key ? String(s.key) : '',
            sheetKey: s.sheetKey ? String(s.sheetKey) : '',
            capo: (typeof s.capo === 'number' && isFinite(s.capo)) ? s.capo : null,
            dur: (typeof s.dur === 'number' && isFinite(s.dur) && s.dur > 0) ? s.dur : 4,
            bpm: normalizeBpm(s.bpm),
            time: time,
            strum: normalizeStrum(s.strum),
            chords: Array.isArray(s.chords) ? s.chords.filter(function (c) {
                return typeof c === 'string' || typeof c === 'number';
            }).map(String) : [],
            sheet: normalizeSheet(s.sheet)
        };
        /* Kept absent when there is nothing to carry, so downstream code can
         * test for the field's presence instead of special-casing null. */
        var sectionStrums = normalizeSectionStrums(s.sectionStrums);
        if (sectionStrums) song.sectionStrums = sectionStrums;
        var strumPatterns = normalizeStrumPatterns(s.strumPatterns);
        if (strumPatterns) song.strumPatterns = strumPatterns;
        if (grid) song.grid = grid;
        return song;
    }

    SB.normalizeSongbook = function (raw) {
        if (Array.isArray(raw)) raw = { songs: raw };
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.songs)) {
            throw new Error('not a songbook (missing "songs" array)');
        }
        var id = String(raw.id || '').trim();
        var name = String(raw.name || raw.title || '').trim();
        if (!id || !name) throw new Error('songbook needs an "id" and a "name"');
        if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error('songbook "id" must be letters, numbers and dashes');
        return {
            id: id,
            name: name,
            description: String(raw.description || ''),
            instrument: (raw.instrument === 'guitar' || raw.instrument === 'ukulele') ? raw.instrument : 'ukulele',
            logo: String(raw.logo || ''),
            logoDark: String(raw.logoDark || ''),
            songs: raw.songs.map(normalizeSong)
        };
    }

    SB.loadBundled = function () {
        /* An injected empty list is authoritative, not an invitation to fetch:
         * the single-file build and the test harness both use this hook to say
         * "this app has no bundled books", which is now a valid state. */
        if (Array.isArray(window.__SONGBOOKS__)) {
            return Promise.resolve(window.__SONGBOOKS__.map(SB.normalizeSongbook));
        }
        return fetch('songbooks/index.json', { cache: 'no-cache' }).then(function (r) {
            /* An absent manifest means a content-free app, not a broken one.
             * Anything else non-OK (and malformed JSON below) is still a real
             * error: a 500, or a corrupt manifest, must not be swallowed. */
            if (r.status === 404) return null;
            if (!r.ok) throw new Error('songbooks/index.json ' + r.status);
            return r.json();
        }).then(function (manifest) {
            if (!manifest) return [];
            var entries = (manifest && manifest.songbooks) || [];
            return Promise.all(entries.map(function (e) {
                return fetch('songbooks/' + e.file, { cache: 'no-cache' }).then(function (r) {
                    if (!r.ok) throw new Error(e.file + ' ' + r.status);
                    return r.json();
                });
            }));
        }).then(function (list) {
            return list.map(function (raw, i) {
                try { return SB.normalizeSongbook(raw); }
                catch (err) { throw new Error('bundled songbook ' + i + ': ' + err.message); }
            });
        });
    }

    SB.rebuildIndex = function () {
        SB.state.bySb = {};
        SB.allSongbooks().forEach(function (sb) { SB.state.bySb[sb.id] = sb; });
        buildSongbookSelect();
        SB.renderEmptyState();
    }

    SB.setActive = function (sb) {
        SB.state.active = sb;
        SB.state.byId = {};
        if (sb) sb.songs.forEach(function (s) { SB.state.byId[s.id] = s; });
        var sel = SB.$('songbookSelect');
        if (sel) sel.value = sb ? sb.id : '';
        var rm = SB.$('removeSongsBtn');
        if (rm) rm.hidden = !(sb && sb.imported);
        var ex = SB.$('exportSongsBtn');
        if (ex) ex.hidden = !sb;
        if (SB.applyBrand) SB.applyBrand();
    }

    function buildSongbookSelect() {
        var sel = SB.$('songbookSelect');
        if (!sel) return;
        sel.textContent = '';
        SB.allSongbooks().forEach(function (sb) {
            var opt = SB.el('option', null, sb.name + (sb.imported ? ' (imported)' : ''));
            opt.value = sb.id;
            sel.appendChild(opt);
        });
    }

    SB.defaultSongbook = function () {
        return SB.state.bundled[0] || SB.allSongbooks()[0] || null;
    }

})(window.SB = window.SB || {});
