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

    function normalizeSong(s, index) {
        if (!s || typeof s !== 'object') throw new Error('bad song entry');
        return {
            id: String(s.id || ('song-' + (index + 1))),
            n: typeof s.n === 'number' ? s.n : (index + 1),
            title: String(s.title || 'Untitled'),
            artist: String(s.artist || ''),
            level: (s.level === 'Easy' || s.level === 'Medium' || s.level === 'Hard') ? s.level : 'Medium',
            new: !!s.new,
            key: s.key ? String(s.key) : '',
            sheetKey: s.sheetKey ? String(s.sheetKey) : '',
            capo: (typeof s.capo === 'number' && isFinite(s.capo)) ? s.capo : null,
            dur: typeof s.dur === 'number' ? s.dur : 4,
            bpm: normalizeBpm(s.bpm),
            time: normalizeTime(s.time),
            chords: Array.isArray(s.chords) ? s.chords.map(String) : [],
            sheet: Array.isArray(s.sheet) ? s.sheet : (s.sheet ? s.sheet : [])
        };
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
        if (window.__SONGBOOKS__ && window.__SONGBOOKS__.length) {
            return Promise.resolve(window.__SONGBOOKS__.map(SB.normalizeSongbook));
        }
        return fetch('songbooks/index.json', { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('songbooks/index.json ' + r.status);
            return r.json();
        }).then(function (manifest) {
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
    }

    SB.setActive = function (sb) {
        SB.state.active = sb;
        SB.state.byId = {};
        if (sb) sb.songs.forEach(function (s) { SB.state.byId[s.id] = s; });
        var sel = SB.$('songbookSelect');
        if (sel && sb) sel.value = sb.id;
        var rm = SB.$('removeSongsBtn');
        if (rm) rm.hidden = !(sb && sb.imported);
        SB.applyBrand();
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
