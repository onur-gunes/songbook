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
    SB.NS = 'songbook';        // storage namespace prefix

    SB.lsGet = function (key, fallback) {
        try {
            var v = window.localStorage.getItem(key);
            return v === null ? fallback : JSON.parse(v);
        } catch (e) { return fallback; }
    }
    SB.lsSet = function (key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
    SB.el = function (tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    SB.compositeId = function (sbId, songId) { return sbId + SB.SEP + songId; }

    SB.FAV_KEY = SB.NS + ':favorites';
    SB.RECENT_KEY = SB.NS + ':recent';
    SB.RECENT_MAX = 15;

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
        favorites: new Set(SB.lsGet(SB.FAV_KEY, [])),   // composite "sbId\0songId"
        recent: SB.lsGet(SB.RECENT_KEY, []),            // [{sb,id}]

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
        textSize: 1,
        chordSize: 1,
        chordPin: true,
        chordMode: 'inline',
        showNumbers: false
    };

})(window.SB = window.SB || {});
