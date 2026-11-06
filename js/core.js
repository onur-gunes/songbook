/* Songbook — core
 * shared helpers, storage keys and the SB.state container
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    if (typeof ChordKit === 'undefined') {
        document.body.textContent = 'Failed to load chords.js';
        return;
    }

    /* ---------------- helpers ---------------- */

    SB.$ = function (id) { return document.getElementById(id); };
    SB.SEP = '\u0000';

    /* GitHub Pages serves prod (/songbook/) and dev (/songbook/dev/) from a
     * single origin, and both localStorage and IndexedDB are scoped to the
     * origin rather than the path. Deriving the environment from the URL and
     * folding it into SB.NS gives dev its own storage world, so testing there
     * cannot read, corrupt or delete a live user's favourites, notes or
     * imported songbooks.
     *
     * Every storage key and the IndexedDB database name are built from SB.NS
     * (see js/personal.js, js/theme.js, js/idb.js), so this one value isolates
     * all of them. The same rule lives in sw.js for the cache names — keep the
     * two in step; tests/env.py asserts they agree.
     */
    SB.envFor = function (pathname, protocol) {
        // The portable Songbook.html runs from file:// and has no dev/prod
        // split, so it is always prod — otherwise saving it into a folder
        // that happens to be called "dev" would hide the user's own data.
        if (protocol && protocol !== 'http:' && protocol !== 'https:') return 'prod';
        var parts = String(pathname).split('/');
        // drop a trailing filename ('index.html') or the empty segment left by
        // a trailing slash, so the last entry is the containing directory
        return parts[parts.length - 2] === 'dev' ? 'dev' : 'prod';
    };
    SB.ENV = SB.envFor(window.location.pathname, window.location.protocol);

    // 'songbook' stays the prod namespace so existing users keep their data.
    SB.NS = SB.ENV === 'dev' ? 'songbook-dev' : 'songbook';

    SB.lsGet = function (key, fallback) {
        try {
            var v = window.localStorage.getItem(key);
            return v === null ? fallback : JSON.parse(v);
        } catch (e) { return fallback; }
    }
    /* Personal-data lists are read at boot, before anything can validate them.
     * A stored value of the wrong shape (an older version, a sync tool, or a
     * hand-edited key) used to throw here and leave the app blank, so callers
     * get an array or an empty one — never the raw object. */
    SB.lsGetArray = function (key) {
        var v = SB.lsGet(key, []);
        return Array.isArray(v) ? v : [];
    }
    SB.lsSet = function (key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
    /* Builds a hash from ids that may contain spaces, '%' or other characters
     * that are not safe in a URL fragment. Every navigation goes through this
     * so the router only ever has to decode well-formed input. */
    SB.routeHash = function (sbId, songId) {
        return '#/' + encodeURIComponent(sbId == null ? '' : sbId) +
            (songId == null ? '' : '/' + encodeURIComponent(songId));
    }
    SB.el = function (tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    SB.compositeId = function (sbId, songId) { return sbId + SB.SEP + songId; }

    /* Both the static chart ('grid') and the in-place animated view
     * ('animate') draw from the same beat grid, so every "is this a chart
     * song?" branch goes through here rather than enumerating the modes. */
    SB.isGridMode = function () {
        return SB.state.chordMode === 'grid' || SB.state.chordMode === 'animate';
    };

    SB.FAV_KEY = SB.NS + ':favorites';
    SB.RECENT_KEY = SB.NS + ':recent';
    SB.RECENT_MAX = 15;

    /* Runtime fallbacks for songs whose songbook entry has no tempo or metre.
     * They make the metronome and strum controls usable on every song without
     * changing the song data: the default is only shown until the user adjusts
     * it, at which point the per-song override is stored as usual. Keep these
     * in step with the README's tempo/metre section. */
    SB.DEFAULT_BPM = 100;
    SB.DEFAULT_TIME = '4/4';

    /* ---------------- shared state ----------------
     * Every value read or written by more than one section lives here, so
     * the sections can be split into separate files later without relying
     * on a shared closure. Anything used by a single section stays a local
     * var in that section.
     *
     * Declared after the helpers above because several initialisers call
     * lsGet() / use NS.
     */
    var SB = window.SB = window.SB || {};
    SB.state = {
        /* songbook store */
        bundled: [],
        imported: [],
        bySb: {},
        active: null,           // current songbook
        byId: {},               // active songs by id
        currentSong: null,

        /* personal data */
        favorites: new Set(SB.lsGetArray(SB.FAV_KEY).filter(function (v) {
            return typeof v === 'string';
        })),                                            // composite "sbId\0songId"
        recent: SB.lsGetArray(SB.RECENT_KEY).filter(function (r) {
            return r && typeof r === 'object' &&
                typeof r.sb === 'string' && typeof r.id === 'string';
        }),                                             // [{sb,id}]

        /* instrument + transpose */
        instrument: SB.lsGet(SB.NS + ':instrument', null),
        transpose: 0,

        /* list view */
        state: {
            q: '',
            levels: new Set(),
            isNew: false,
            favOnly: false,
            sort: 'title',
            compact: false
        },

        /* song view + auto-scroll */
        scrollState: { raf: null, last: 0, pos: 0, playing: false, started: false, finished: false, lastY: null },
        scrollSpeed: 1,

        /* metronome — bpm starts null but loadMetronomeForSong always fills it
         * with the song's tempo or DEFAULT_BPM, so the control is available on
         * every song; beats is the meter's beats per bar, used to accent beat
         * 1. See js/metronome.js. */
        metronome: { playing: false, bpm: null, beats: 4 },

        /* strum — the pattern chosen for the current song (a pattern object
         * from the library, using DEFAULT_TIME when the song has no metre),
         * plus how the row is drawn: 'arrows' (↓ ↑ ·) or 'letters' (D U ·).
         * The notation is a global display preference, like chordMode, not a
         * per-song value. See js/strum.js. */
        strum: { pattern: null, notation: 'arrows' },

        /* strum row display, matching chordSize/chordPin: size scales the
         * slots, pin keeps the row on screen while the lyrics scroll. Both are
         * global preferences remembered in localStorage. */
        strumSize: 1,
        strumPin: true,

        textSize: 1,
        chordSize: 1,
        chordPin: true,
        chordMode: 'inline',
        showNumbers: false
    };

})(window.SB = window.SB || {});
