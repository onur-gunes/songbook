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

    SB.stripSortPrefix = function (t) {
        return t.replace(/^[🔥🎂\s]+/, '').replace(/^#?\d+\s*[-–—]\s+/, '').replace(/^The\s+/i, '');
    };

})(window.SB = window.SB || {});
