/* Songbook — transpose
 * chord token parsing and semitone transposition
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- transpose ---------------- */

    var SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
    var NOTE_RE = /^([A-G])(sharp|flat|b|#)?/;

    SB.transposeNote = function (part, semis) {
        if (!part) return null;
        var m = part.match(NOTE_RE);
        if (!m) return null;
        var semi = SEMIS[m[1]];
        if (m[2] === '#' || m[2] === 'sharp') semi += 1;
        else if (m[2] === 'b' || m[2] === 'flat') semi -= 1;
        var idx = ((semi + semis) % 12 + 12) % 12;
        return NOTE_NAMES[idx] + part.slice(m[0].length);
    }
    SB.transposeToken = function (tok, semis) {
        if (!semis) return tok;
        var out = '', rest = tok;
        var lead = rest.match(/^\/+/);
        if (lead) { out += lead[0]; rest = rest.slice(lead[0].length); }
        var trail = '';
        var tr = rest.match(/\/+$/);
        if (tr) { trail = tr[0]; rest = rest.slice(0, rest.length - tr[0].length); }
        if (rest === '') return tok;
        var parts = rest.split('/');
        var moved = parts.map(function (p) { return SB.transposeNote(p, semis); });
        if (moved.some(function (t) { return t === null; })) return tok;
        return out + moved.join('/') + trail;
    }
    SB.transposeChordValue = function (val, semis) {
        if (!semis) return val;
        var m = val.match(/^\[([\s\S]*)\]$/);
        if (!m) return val;
        var inner = m[1];
        var out = inner.split(/\s+/).map(function (t) { return SB.transposeToken(t, semis); }).join(' ');
        return '[' + out + ']';
    }

    // Chart key -> display name, transposed. FC is the legacy encoding of F/C.
    SB.transposeChartName = function (name, semis) {
        var n = name === 'FC' ? 'F/C' : name;
        if (!semis) return n;
        return n.split('/').map(function (tok) { return SB.transposeNote(tok, semis) || tok; }).join('/');
    }
    SB.displayChord = function (name) {
        return name.replace(/sharp/g, '#').replace(/flat/g, 'b');
    }

    /* ---------------- scale degrees in the sheet ---------------- */

    // Tonic the sheet chords are written in: the curated sheetKey when present,
    // otherwise recording key minus capo. Lives here (not in chordstrip.js) so
    // both the strip and the two sheet renderers can reach it.
    SB.songTonic = function (song) {
        if (!song) return null;
        if (song.sheetKey) {
            var sk = ChordKit.parse(song.sheetKey);
            if (sk) return { pc: sk.rootPc, minor: sk.type.id === 'm', name: song.sheetKey };
        }
        if (!song.key) return null;
        var k = ChordKit.parse(song.key);
        if (!k) return null;
        var capo = (typeof song.capo === 'number' && isFinite(song.capo)) ? song.capo : 0;
        return { pc: ((k.rootPc - capo) % 12 + 12) % 12, minor: k.type.id === 'm', name: '' };
    };

    // Strum strokes are authored as leading/trailing slashes on the token
    // ("G//", "/Am"). ChordKit.parse rejects those, so 10.8% of chord tokens
    // would silently lose their numeral if we handed the raw token over.
    // Split the decoration off, number the core, then put it back.
    var STROKE_RE = /^(\/*)([\s\S]*?)(\/*)$/;

    // Degree label for one chord token, or null when it has no numeral
    // (non-chord markers like "stop"/"riff"/"NC", or a bare "//").
    // `name` must be the UNTRANSPOSED token: the numeral is a property of the
    // written key, so it must not move when the user transposes.
    SB.tokenDegree = function (tok, tonic) {
        if (!tonic || !tok) return null;
        var m = String(tok).match(STROKE_RE);
        var core = m[2];
        if (!core || ChordKit.isMutedName(core)) return null;
        // FC is the legacy encoding of F/C (see transposeChartName above).
        var deg = ChordKit.scaleDegree(core === 'FC' ? 'F/C' : core, tonic.pc, tonic.minor, tonic.name);
        if (!deg) return null;
        return m[1] + deg + m[3];
    };

    SB.stripSortPrefix = function (t) {
        return t.replace(/^[🔥🎂\s]+/, '').replace(/^#?\d+\s*[-–—]\s+/, '').replace(/^The\s+/i, '');
    };

})(window.SB = window.SB || {});
