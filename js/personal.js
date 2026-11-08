/* Songbook — personal
 * favourites, per-song notes and the recently-played list
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- personal data ---------------- */

    SB.saveFavorites = function () { SB.lsSet(SB.FAV_KEY, Array.from(SB.state.favorites)); }
    SB.isFav = function (sbId, songId) { return SB.state.favorites.has(SB.compositeId(sbId, songId)); }

    SB.addRecent = function (sbId, songId) {
        SB.state.recent = [{ sb: sbId, id: songId }].concat(SB.state.recent.filter(function (r) {
            return !(r.sb === sbId && r.id === songId);
        })).slice(0, SB.RECENT_MAX);
        SB.lsSet(SB.RECENT_KEY, SB.state.recent);
    }

    SB.noteKey = function (sbId, songId) { return SB.NS + ':note:' + sbId + SB.SEP + songId; }
    SB.speedKey = function (sbId, songId) { return SB.NS + ':speed:' + sbId + SB.SEP + songId; }
    SB.sizeKey = function (sbId, songId) { return SB.NS + ':size:' + sbId + SB.SEP + songId; }
    SB.bpmKey = function (sbId, songId) { return SB.NS + ':bpm:' + sbId + SB.SEP + songId; }
    SB.strumKey = function (sbId, songId) { return SB.NS + ':strum:' + sbId + SB.SEP + songId; }

    /* ---------------- per-song edit plan ----------------
     *
     * Every local edit to one song — strum choices today, structure later —
     * lives in a single versioned object under one key. It is deliberately
     * separate from the songbook object: the imported book in memory/IDB is
     * never mutated, and the plan is merged only when exporting. The key is
     * scoped to songbook + song because two books may reuse a song id.
     *
     * Shape (version 1):
     *
     *   {
     *     version: 1,
     *     songStrum: 'dduudu-4-4',      // manual song-level default
     *     sectionStrums: { verse: '…' }, // keyed by canonical role
     *     customPatterns: [{id, name, time, subdiv, slots}],
     *     barStrums: { 'block:bar': '…' },
     *     beatStrums: { 'block:bar:beat': 'DU' },
     *     grid: [...],                   // structural override (Step 6)
     *     time: '4/4'                    // metre override (Step 6)
     *   }
     *
     * Only overrides are stored, never a copy of the whole song. Unknown or
     * corrupt data is ignored rather than allowed to break the song view. */
    var PLAN_VERSION = 1;
    var PLAN_TIMES = { '4/4': 1, '3/4': 1, '6/8': 1, '2/4': 1 };

    function planString(v) { return (typeof v === 'string' && v) ? v : null; }
    function planObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

    function emptyPlan() {
        return {
            version: PLAN_VERSION,
            songStrum: null,
            sectionStrums: {},
            customPatterns: [],
            barStrums: {},
            beatStrums: {},
            grid: null,
            time: null
        };
    }

    /* Pattern definitions may come from a future/older build, so validate the
     * whole shape before the strum resolver can trust an id to refer to a
     * usable pattern. The metre/slot-count check happens in js/strum.js, where
     * the pattern library and BEATS_PER_BAR live. */
    function normalizeCustomPattern(raw) {
        if (!planObject(raw)) return null;
        var id = planString(raw.id);
        var time = planString(raw.time);
        var slots = planString(raw.slots);
        var subdiv = raw.subdiv;
        if (!id || !time || !slots || !/^[DU-]+$/.test(slots)) return null;
        if (typeof subdiv !== 'number' || !isFinite(subdiv) ||
            subdiv < 1 || subdiv !== Math.floor(subdiv)) return null;
        return {
            id: id,
            name: planString(raw.name) || id,
            time: time,
            subdiv: subdiv,
            slots: slots
        };
    }

    /* Copy a key -> string map, dropping anything that is not a safe, plain
     * string value. `__proto__` and friends are skipped so corrupt storage can
     * never change a prototype while it is being read. */
    function normalizeOverrides(raw, isValue) {
        var out = {};
        if (!planObject(raw)) return out;
        Object.keys(raw).forEach(function (key) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
            var value = raw[key];
            if (typeof value !== 'string' || !value) return;
            if (isValue && !isValue(value)) return;
            out[key] = value;
        });
        return out;
    }

    function hasBeatSlots(value) { return /^[DU-]+$/.test(value); }

    /* Bring any stored shape up to the current version. A missing version is
     * treated as v0 (the shape before this key existed, e.g. an unversioned
     * test fixture or an old manual choice). A NEWER version is rejected: a
     * future build may have written fields this one would silently discard. */
    function migratePlan(raw) {
        if (!planObject(raw)) return null;
        var version = raw.version;
        if (typeof version !== 'number' || !isFinite(version)) version = 0;
        if (version > PLAN_VERSION) return null;
        if (version < 1) {
            raw = {
                version: PLAN_VERSION,
                songStrum: planString(raw.songStrum) || planString(raw.strum),
                sectionStrums: raw.sectionStrums,
                customPatterns: raw.customPatterns,
                barStrums: raw.barStrums,
                beatStrums: raw.beatStrums,
                grid: raw.grid,
                time: raw.time
            };
        }
        return raw;
    }

    SB.normalizePlan = function (raw) {
        var migrated = migratePlan(raw);
        if (!migrated) return emptyPlan();

        var sections = {};
        var rawSections = planObject(migrated.sectionStrums) ? migrated.sectionStrums : {};
        Object.keys(rawSections).forEach(function (role) {
            var id = planString(rawSections[role]);
            if (id && SB.isSectionRole(role)) sections[role] = id;
        });

        var patterns = [];
        var seen = {};
        if (Array.isArray(migrated.customPatterns)) {
            migrated.customPatterns.forEach(function (rawPattern) {
                var pattern = normalizeCustomPattern(rawPattern);
                if (!pattern || seen[pattern.id]) return;
                seen[pattern.id] = true;
                patterns.push(pattern);
            });
        }

        var grid = null;
        if (Array.isArray(migrated.grid) && migrated.grid.every(function (block) {
            return block && typeof block === 'object' && Array.isArray(block.bars);
        })) {
            grid = migrated.grid;
        }

        var time = planString(migrated.time);
        return {
            version: PLAN_VERSION,
            songStrum: planString(migrated.songStrum),
            sectionStrums: sections,
            customPatterns: patterns,
            barStrums: normalizeOverrides(migrated.barStrums),
            beatStrums: normalizeOverrides(migrated.beatStrums, hasBeatSlots),
            grid: grid,
            time: knownPlanTime(time)
        };
    };

    function knownPlanTime(value) { return value && PLAN_TIMES[value] ? value : null; }

    SB.emptyPlan = emptyPlan;
    SB.PLAN_VERSION = PLAN_VERSION;
    SB.planKey = function (sbId, songId) { return SB.NS + ':plan:' + sbId + SB.SEP + songId; }

    /* The plan's own song-level default is the manual strum choice. Older
     * builds stored only that id under SB.strumKey, so seed it on read: an
     * existing user keeps their choice without writing anything until they
     * change something. */
    SB.loadPlan = function (sbId, songId) {
        var plan = SB.normalizePlan(SB.lsGet(SB.planKey(sbId, songId), null));
        if (!plan.songStrum) {
            try {
                plan.songStrum = planString(window.localStorage.getItem(SB.strumKey(sbId, songId)));
            } catch (e) { /* ignore */ }
        }
        return plan;
    };

    SB.savePlan = function (sbId, songId, plan) {
        var clean = SB.normalizePlan(plan);
        SB.lsSet(SB.planKey(sbId, songId), clean);
        return clean;
    };

    /* Clearing the plan removes every local edit for the song, including the
     * pre-plan manual choice it was migrated from. Per-song preferences that
     * are not song edits (notes, tempo, scroll speed, text size) stay put. */
    SB.clearPlan = function (sbId, songId) {
        try { window.localStorage.removeItem(SB.planKey(sbId, songId)); } catch (e) { /* ignore */ }
        try { window.localStorage.removeItem(SB.strumKey(sbId, songId)); } catch (e) { /* ignore */ }
    };

    function planHasEdits(plan) {
        if (!plan || typeof plan !== 'object') return false;
        return !!(plan.songStrum || plan.time ||
            (plan.grid && plan.grid.length) ||
            (plan.customPatterns && plan.customPatterns.length) ||
            Object.keys(plan.sectionStrums || {}).length ||
            Object.keys(plan.barStrums || {}).length ||
            Object.keys(plan.beatStrums || {}).length);
    }

    /* Accepts either a plan object (for a plan already in hand) or a
     * songbook/song pair (reads and migrates it). */
    SB.hasLocalEdits = function (sbId, songId) {
        if (planObject(sbId)) return planHasEdits(sbId);
        return planHasEdits(SB.loadPlan(sbId, songId));
    };

    /* ---------------- recent ---------------- */

    SB.renderRecent = function () {
        var block = SB.$('recentBlock');
        var list = SB.$('recentList');
        list.textContent = '';
        var items = SB.state.recent.filter(function (r) { return SB.state.bySb[r.sb] && SB.state.bySb[r.sb].songs.some(function (s) { return s.id === r.id; }); });
        if (!items.length) { block.hidden = true; return; }
        block.hidden = false;
        items.forEach(function (r) {
            var sb = SB.state.bySb[r.sb];
            var s = sb.songs.filter(function (x) { return x.id === r.id; })[0];
            var li = document.createElement('li');
            var b = SB.el('button', null, s.title);
            b.type = 'button';
            b.addEventListener('click', function () { location.hash = SB.routeHash(sb.id, s.id); });
            li.appendChild(b);
            list.appendChild(li);
        });
    }

})(window.SB = window.SB || {});
