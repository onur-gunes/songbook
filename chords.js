/*!
 * ChordKit — instrument-parameterized chord voicing engine.
 *
 * Extracted and generalized from the Ukulele/Guitar Chord Explorer projects
 * (in turn the origin of the songbook's original generator). Given a chord
 * name and an instrument, it finds every playable voicing below the 12th
 * fret, ranks them (canonical shape first, then root-in-bass, low position,
 * few fingers) and draws a chord diagram as SVG.
 *
 * No dependencies. Exposes `ChordKit` on the global object.
 */
(function (root) {
    'use strict';

    var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    var LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
    var PC_LETTER = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
    var ACC_STR = { '-2': '\u266d\u266d', '-1': '\u266d', 0: '', 1: '\u266f', 2: '\u266f\u266f' };
    var ENHARMONIC = {
        1: ['C\u266f', 'D\u266d'],
        3: ['D\u266f', 'E\u266d'],
        6: ['F\u266f', 'G\u266d'],
        8: ['G\u266f', 'A\u266d'],
        10: ['A\u266f', 'B\u266d']
    };

    /* ---------------- instruments ---------------- */

    function ukulelePlayable(inst, frets, relaxed) {
        var nz = frets.filter(function (f) { return f > 0; });
        if (!nz.length) return true;
        var uniq = uniqSorted(nz);
        var span = uniq[uniq.length - 1] - uniq[0];
        if (relaxed) return uniq.length <= 4 && span <= 5;
        var open = frets.indexOf(0) >= 0;
        if (open) return span <= 3;
        if (span <= 3) return true;
        return nz.filter(function (f) { return f === uniq[0]; }).length >= 2 && uniq.length <= 4 && span <= 5;
    }

    function guitarPlayable(inst, frets, relaxed) {
        var fretted = [], sounding = 0;
        for (var i = 0; i < frets.length; i++) {
            if (frets[i] > 0) fretted.push(frets[i]);
            if (frets[i] >= 0) sounding++;
        }
        if (sounding < 3) return false;
        if (!fretted.length) return true;
        var uniq = uniqSorted(fretted);
        var span = fretted[fretted.length - 1] - uniq[0];
        var maxFingers = relaxed ? 5 : 4;
        var maxSpan = relaxed ? 6 : 4;
        if (uniq.length > maxFingers) return false;
        if (span > maxSpan) return false;
        return true;
    }

    var INSTRUMENTS = {
        ukulele: {
            id: 'ukulele',
            label: 'Ukulele',
            strings: ['G', 'C', 'E', 'A'],
            tuning: [67, 60, 64, 69],
            maxFret: 12,
            muted: true,
            playable: ukulelePlayable
        },
        guitar: {
            id: 'guitar',
            label: 'Guitar',
            strings: ['E', 'A', 'D', 'G', 'B', 'E'],
            tuning: [40, 45, 50, 55, 59, 64],
            maxFret: 11,
            muted: true,
            playable: guitarPlayable
        }
    };

    function instrumentOf(id) {
        return INSTRUMENTS[id] || INSTRUMENTS.ukulele;
    }

    /* ---------------- chord types ---------------- */

    var TYPES = [
        { id: 'maj', suffix: '', degrees: ['root', '3', '5'], tones: [[0, 0], [4, 2], [7, 4]] },
        { id: 'm', suffix: 'm', degrees: ['root', '\u266d3', '5'], tones: [[0, 0], [3, 2], [7, 4]] },
        { id: '7', suffix: '7', degrees: ['root', '3', '5', '\u266d7'], tones: [[0, 0], [4, 2], [7, 4], [10, 6]] },
        { id: 'maj7', suffix: 'maj7', degrees: ['root', '3', '5', '7'], tones: [[0, 0], [4, 2], [7, 4], [11, 6]] },
        { id: 'm7', suffix: 'm7', degrees: ['root', '\u266d3', '5', '\u266d7'], tones: [[0, 0], [3, 2], [7, 4], [10, 6]] },
        { id: 'sus4', suffix: 'sus4', degrees: ['root', '4', '5'], tones: [[0, 0], [5, 3], [7, 4]] },
        { id: 'sus2', suffix: 'sus2', degrees: ['root', '2', '5'], tones: [[0, 0], [2, 1], [7, 4]] },
        { id: '7sus4', suffix: '7sus4', degrees: ['root', '4', '5', '\u266d7'], tones: [[0, 0], [5, 3], [7, 4], [10, 6]] },
        { id: '6', suffix: '6', degrees: ['root', '3', '5', '6'], tones: [[0, 0], [4, 2], [7, 4], [9, 5]] },
        { id: 'm6', suffix: 'm6', degrees: ['root', '\u266d3', '5', '6'], tones: [[0, 0], [3, 2], [7, 4], [9, 5]] },
        { id: '9', suffix: '9', degrees: ['root', '3', '5', '\u266d7', '9'], tones: [[0, 0], [4, 2], [7, 4], [10, 6], [14, 8]] },
        { id: 'm9', suffix: 'm9', degrees: ['root', '\u266d3', '5', '\u266d7', '9'], tones: [[0, 0], [3, 2], [7, 4], [10, 6], [14, 8]] },
        { id: 'maj9', suffix: 'maj9', degrees: ['root', '3', '5', '7', '9'], tones: [[0, 0], [4, 2], [7, 4], [11, 6], [14, 8]] },
        { id: 'add9', suffix: 'add9', degrees: ['root', '3', '5', '9'], tones: [[0, 0], [4, 2], [7, 4], [14, 8]] },
        { id: 'dim', suffix: 'dim', degrees: ['root', '\u266d3', '\u266d5'], tones: [[0, 0], [3, 2], [6, 4]] },
        { id: 'dim7', suffix: 'dim7', degrees: ['root', '\u266d3', '\u266d5', '\u266d\u266d7'], tones: [[0, 0], [3, 2], [6, 4], [9, 6]] },
        { id: 'aug', suffix: 'aug', degrees: ['root', '3', '\u266f5'], tones: [[0, 0], [4, 2], [8, 4]] },
        { id: 'm7b5', suffix: 'm7\u266d5', degrees: ['root', '\u266d3', '\u266d5', '\u266d7'], tones: [[0, 0], [3, 2], [6, 4], [10, 6]] }
    ];

    var SUFFIX_ALIASES = { '+': 'aug', 'aug': 'aug', 'm7b5': 'm7\u266d5', 'm7-5': 'm7\u266d5', 'min': 'm', 'mi': 'm' };

    function typeOf(id) {
        for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
        return TYPES[0];
    }

    function typeForSuffix(suffix) {
        if (suffix == null) return TYPES[0];
        var s = SUFFIX_ALIASES[suffix] || suffix;
        for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === s || TYPES[i].suffix === s) return TYPES[i];
        return null;
    }

    /* ---------------- parsing ---------------- */

    // Legacy chart keys concatenate the slash bass (FC === F/C). Accept both.
    function splitSlash(name) {
        var m = name.match(/^([^/]+)\/(.+)$/);
        if (m) return { head: m[1], bass: m[2] };
        if (/^[A-G](?:sharp|flat|#|b)?$/.test(name) === false && /^[A-G](?:sharp|flat|#|b)?C$/.test(name)) {
            return { head: name.slice(0, -1), bass: 'C' };
        }
        return { head: name, bass: null };
    }

    function rootPcOf(token) {
        var m = token.match(/^([A-G])(sharp|flat|#|b)?/);
        if (!m) return null;
        var acc = !m[2] ? 0 : (m[2] === 'sharp' || m[2] === '#') ? 1 : -1;
        return ((LETTER_PC[LETTERS.indexOf(m[1])] + acc) % 12 + 12) % 12;
    }

    function parse(name) {
        if (name == null) return null;
        var key = String(name).trim();
        if (!key || key === 'NC' || /^(stop|pause|riff|muted)$/i.test(key)) return null;
        var slash = splitSlash(key);
        var m = slash.head.match(/^([A-G])(sharp|flat|#|b)?(.*)$/);
        if (!m) return null;
        var acc = !m[2] ? 0 : (m[2] === 'sharp' || m[2] === '#') ? 1 : -1;
        var type = typeForSuffix(m[3]);
        if (!type) return null;
        return {
            name: key,
            rootPc: ((LETTER_PC[LETTERS.indexOf(m[1])] + acc) % 12 + 12) % 12,
            letter: m[1],
            acc: acc,
            suffix: m[3],
            type: type,
            bass: slash.bass ? rootPcOf(slash.bass) : null
        };
    }

    /* ---------------- helpers ---------------- */

    function uniqSorted(arr) {
        var u = [];
        arr.forEach(function (v) { if (u.indexOf(v) < 0) u.push(v); });
        return u.sort(function (a, b) { return a - b; });
    }

    function rootName(rootPc, spelling) {
        var list = ENHARMONIC[((rootPc % 12) + 12) % 12];
        if (!list) return PC_LETTER[((rootPc % 12) + 12) % 12] || '';
        return spelling === 'flat' ? list[1] : list[0];
    }

    /* ---------------- voicing search ---------------- */

    var shapeCache = {};

    function findShapes(inst, rootPc, type, relaxed) {
        var allowed = {}, essential = {};
        for (var ti = 0; ti < type.tones.length; ti++) {
            var pcv = (rootPc + type.tones[ti][0]) % 12;
            allowed[pcv] = true;
            if (ti !== 2) essential[pcv] = true;   // ignore the 5th when 5 tones are required
        }
        var cand = [];
        for (var s = 0; s < inst.tuning.length; s++) {
            var list = inst.muted ? [-1] : [];
            for (var f = 0; f <= inst.maxFret; f++) {
                if (allowed[(inst.tuning[s] + f) % 12]) list.push(f);
            }
            cand.push(list);
        }
        var maxFingers = relaxed ? 5 : 4;
        var maxSpan = relaxed ? 6 : 4;
        var out = [], seen = {}, cur = [], used = {};
        var n = inst.tuning.length;
        for (var z = 0; z < n; z++) cur.push(0);

        function rec(s, minF, maxF, count) {
            if (count > maxFingers || maxF - minF > maxSpan) return;
            if (s === n) {
                if (!inst.playable(inst, cur, relaxed)) return;
                var present = {}, sounding = 0, distinct = 0;
                for (var i = 0; i < n; i++) {
                    if (cur[i] < 0) continue;
                    sounding++;
                    var pcv = (inst.tuning[i] + cur[i]) % 12;
                    if (!present[pcv]) { present[pcv] = true; distinct++; }
                }
                if (sounding < 3 || distinct < 3) return;
                for (var e in essential) if (!present[e]) return;
                var key = cur.join(',');
                if (!seen[key]) { seen[key] = true; out.push(cur.slice()); }
                return;
            }
            var cl = cand[s];
            for (var k = 0; k < cl.length; k++) {
                var v = cl[k];
                cur[s] = v;
                if (v > 0) {
                    var add = !used[v];
                    if (add) used[v] = 1;
                    rec(s + 1, v < minF ? v : minF, v > maxF ? v : maxF, count + (add ? 1 : 0));
                    if (add) delete used[v];
                } else {
                    rec(s + 1, minF, maxF, count);
                }
            }
        }
        rec(0, Infinity, -Infinity, 0);
        return out;
    }

    function shapesFor(inst, rootPc, type, relaxed) {
        var key = inst.id + ':' + rootPc + ':' + type.id + ':' + (relaxed ? 1 : 0);
        if (Object.prototype.hasOwnProperty.call(shapeCache, key)) return shapeCache[key];
        var shapes = findShapes(inst, rootPc, type, relaxed);
        shapeCache[key] = shapes;
        return shapes;
    }

    /* ---------------- ranking ---------------- */

    // Canonical open shapes, keyed quality -> rootPc -> frets. Guitar values are
    // the well-known CAGED/open voicings; ukulele covers the common opens.
    var CANON = {
        guitar: {
            maj: { 0: [-1, 3, 2, 0, 1, 0], 2: [-1, -1, 0, 2, 3, 2], 4: [0, 2, 2, 1, 0, 0], 5: [1, 3, 3, 2, 1, 1], 7: [3, 2, 0, 0, 0, 3], 9: [-1, 0, 2, 2, 2, 0], 11: [-1, 2, 4, 4, 4, 2] },
            m: { 2: [-1, -1, 0, 2, 3, 1], 4: [0, 2, 2, 0, 0, 0], 9: [-1, 0, 2, 2, 1, 0] },
            '7': { 0: [-1, 3, 2, 3, 1, 0], 2: [-1, -1, 0, 2, 1, 2], 4: [0, 2, 0, 1, 0, 0], 5: [1, 3, 1, 2, 1, 1], 7: [3, 2, 0, 0, 0, 1], 9: [-1, 0, 2, 0, 2, 0], 11: [-1, 2, 1, 2, 0, 2] },
            maj7: { 0: [-1, 3, 2, 0, 0, 0], 2: [-1, -1, 0, 2, 2, 2], 4: [0, 2, 1, 1, 0, 0], 5: [1, 3, 2, 2, 1, 1], 7: [3, 2, 0, 0, 0, 2], 9: [-1, 0, 2, 1, 2, 0], 11: [-1, 2, 3, 3, 3, 2] },
            m7: { 2: [-1, -1, 0, 2, 1, 1], 4: [0, 2, 0, 0, 0, 0], 9: [-1, 0, 2, 0, 1, 0], 11: [-1, 2, 0, 2, 0, 2] },
            sus4: { 2: [-1, -1, 0, 2, 3, 3], 4: [0, 2, 2, 2, 0, 0], 7: [3, 3, 0, 0, 1, 3], 9: [-1, 0, 2, 2, 3, 0] },
            sus2: { 2: [-1, -1, 0, 2, 3, 0], 4: [0, 2, 4, 4, 0, 0], 9: [-1, 0, 2, 2, 0, 0] },
            '6': { 0: [-1, 3, 2, 2, 1, 0], 2: [-1, -1, 0, 2, 0, 2], 4: [0, 2, 2, 1, 2, 0], 7: [3, 2, 0, 0, 0, 0], 9: [-1, 0, 2, 2, 2, 2] },
            m6: { 2: [-1, -1, 0, 2, 0, 1], 4: [0, 2, 2, 0, 2, 0], 9: [-1, 0, 2, 2, 1, 2] },
            add9: { 0: [-1, 3, 2, 0, 3, 3], 4: [0, 2, 2, 1, 0, 2], 9: [-1, 0, 2, 4, 2, 0] },
            '9': { 0: [-1, 3, 2, 3, 3, -1] },
            m9: { 0: [-1, 3, 1, 3, 3, -1] },
            maj9: { 0: [-1, 3, 2, 4, 3, -1] },
            dim: { 0: [-1, 3, 4, 5, 4, -1] },
            dim7: { 0: [-1, 3, 4, 2, 4, -1] },
            aug: { 0: [-1, 3, 2, 1, 1, 0] },
            m7b5: { 0: [-1, 3, 4, 3, 4, -1], 11: [-1, 2, 3, 2, 3, -1] },
            '7sus4': { 0: [-1, 3, 3, 3, 1, 1], 2: [-1, -1, 0, 2, 1, 3] }
        },
        ukulele: {
            maj: { 0: [0, 0, 0, 3], 2: [2, 2, 2, 0], 4: [1, 4, 0, 2], 5: [2, 0, 1, 0], 7: [0, 2, 3, 2], 9: [2, 1, 0, 0], 11: [3, 2, 2, 2] },
            m: { 0: [0, 3, 3, 3], 2: [2, 2, 1, 0], 4: [0, 4, 3, 2], 5: [1, 0, 1, 3], 7: [0, 2, 3, 1], 9: [2, 0, 0, 0], 11: [4, 2, 2, 2] },
            '7': { 0: [0, 0, 0, 1], 2: [2, 2, 2, 3], 4: [1, 2, 0, 2], 5: [2, 3, 1, 3], 7: [0, 2, 1, 2], 9: [0, 1, 0, 0], 11: [3, 2, 1, 2] },
            maj7: { 0: [0, 0, 0, 2], 2: [2, 2, 2, 4], 4: [1, 3, 0, 2], 5: [2, 4, 1, 3], 7: [0, 2, 2, 2], 9: [1, 1, 0, 0], 11: [3, 2, 2, 2] },
            m7: { 0: [3, 3, 3, 3], 2: [2, 2, 1, 3], 4: [0, 2, 0, 2], 5: [1, 3, 1, 3], 7: [0, 2, 1, 1], 9: [0, 0, 0, 0], 11: [1, 2, 2, 2] }
        }
    };

    function shapeRank(inst, frets, rootPc) {
        var fretted = [], open = 0, sounding = 0, bass = -1, bassPc = -1;
        for (var i = 0; i < frets.length; i++) {
            var v = frets[i];
            if (v > 0) fretted.push(v);
            if (v === 0) open++;
            if (v >= 0) {
                sounding++;
                var p = inst.tuning[i] + v;
                if (bass < 0 || p < bass) { bass = p; bassPc = p % 12; }
            }
        }
        var minF = fretted.length ? Math.min.apply(null, fretted) : 0;
        var maxF = fretted.length ? Math.max.apply(null, fretted) : 0;
        return {
            rootBass: bassPc === ((rootPc % 12) + 12) % 12 ? 0 : 1,
            minF: minF,
            maxF: maxF,
            frettedCount: fretted.length,
            fingers: uniqSorted(fretted).length,
            span: maxF - minF,
            open: -open,
            sounding: -sounding,
            pattern: frets.join(',')
        };
    }

    function cmpUke(x, y) {
        // ukulele explorer order: most strings ringing, low position, few fretted strings, tight span
        if (x.sounding !== y.sounding) return x.sounding - y.sounding;
        if (x.maxF !== y.maxF) return x.maxF - y.maxF;
        if (x.frettedCount !== y.frettedCount) return x.frettedCount - y.frettedCount;
        if (x.span !== y.span) return x.span - y.span;
        return x.pattern < y.pattern ? -1 : (x.pattern > y.pattern ? 1 : 0);
    }

    function cmpGuitar(x, y) {
        // guitar explorer order: root in the bass, low position, most strings ringing
        if (x.rootBass !== y.rootBass) return x.rootBass - y.rootBass;
        if (x.minF !== y.minF) return x.minF - y.minF;
        if (x.sounding !== y.sounding) return x.sounding - y.sounding;
        if (x.open !== y.open) return x.open - y.open;
        if (x.fingers !== y.fingers) return x.fingers - y.fingers;
        if (x.span !== y.span) return x.span - y.span;
        return x.pattern < y.pattern ? -1 : (x.pattern > y.pattern ? 1 : 0);
    }

    function sortShapes(inst, shapes, rootPc, type) {
        var group = CANON[inst.id] && CANON[inst.id][type.id];
        var want = group ? group[rootPc] : null;
        var wantKey = want ? want.join(',') : null;
        var cmp = inst.id === 'ukulele' ? cmpUke : cmpGuitar;
        var keyed = shapes.map(function (f) {
            return { f: f, canon: wantKey && f.join(',') === wantKey ? 0 : 1, r: shapeRank(inst, f, rootPc) };
        });
        keyed.sort(function (a, b) {
            if (a.canon !== b.canon) return a.canon - b.canon;
            return cmp(a.r, b.r);
        });
        return keyed.map(function (k) { return k.f; });
    }

    // Chords whose standard open-position shape is a stretchy barre. The plain
    // major/minor triads on these roots are the ones learners struggle with; a
    // muted first-position alternative is meaningfully easier.
    var HARD_MAJOR = { 1: 1, 4: 1, 6: 1, 8: 1, 10: 1, 11: 1 };   // C#, E, F#, G#, Bb, B
    var HARD_MINOR = { 1: 1, 8: 1, 10: 1, 11: 1 };               // C#m, G#m, A#m, Bm

    function chordDifficulty(name) {
        var p = parse(name);
        if (!p) return 'standard';
        var hard = p.type.id === 'maj' ? HARD_MAJOR[p.rootPc] : (p.type.id === 'm' ? HARD_MINOR[p.rootPc] : null);
        return hard ? 'hard' : 'standard';
    }

    // For hard chords, lift the best easier muted voicing into the second slot
    // so it surfaces right after the standard instead of getting buried.
    function boostEasy(inst, shapes, rootPc, type) {
        if (inst.id !== 'ukulele' || shapes.length < 2) return shapes;
        var hard = type.id === 'maj' ? HARD_MAJOR[rootPc] : (type.id === 'm' ? HARD_MINOR[rootPc] : null);
        if (!hard) return shapes;
        var std = shapes[0];
        if (std.indexOf(-1) >= 0) return shapes;
        var stdR = shapeRank(inst, std, rootPc);
        var best = -1, bestM = -1, bestC = -1, bestS = -1;
        for (var i = 1; i < shapes.length; i++) {
            var f = shapes[i];
            if (f.indexOf(-1) < 0) continue;
            var r = shapeRank(inst, f, rootPc);
            if (r.maxF > stdR.maxF) continue;
            if (r.maxF === stdR.maxF && r.frettedCount >= stdR.frettedCount) continue;
            if (best < 0 ||
                r.maxF < bestM ||
                (r.maxF === bestM && r.frettedCount < bestC) ||
                (r.maxF === bestM && r.frettedCount === bestC && r.sounding > bestS)) {
                best = i; bestM = r.maxF; bestC = r.frettedCount; bestS = r.sounding;
            }
        }
        if (best < 2) return shapes;
        var out = shapes.slice();
        out.splice(1, 0, out.splice(best, 1)[0]);
        return out;
    }

    // All ranked voicings for a chord name on an instrument. Never empty for a
    // valid chord: falls back to relaxed (stretch) voicings if needed.
    function voicings(name, instrumentId) {
        var parsed = parse(name);
        if (!parsed) return [];
        var inst = instrumentOf(instrumentId);
        var shapes = shapesFor(inst, parsed.rootPc, parsed.type, false);
        if (!shapes.length) shapes = shapesFor(inst, parsed.rootPc, parsed.type, true);
        if (!shapes.length) return [];
        shapes = sortShapes(inst, shapes, parsed.rootPc, parsed.type);
        return boostEasy(inst, shapes, parsed.rootPc, parsed.type);
    }

    function bestVoicing(name, instrumentId) {
        var v = voicings(name, instrumentId);
        return v.length ? v[0] : null;
    }

    /* ---------------- diagram drawing ---------------- */

    function strX(i, gap, padX) { return padX + i * gap; }

    function diagramSVG(instrumentId, frets) {
        var inst = instrumentOf(instrumentId);
        var num = frets.length || inst.tuning.length;
        var W = num === 6 ? 160 : 104;
        var padX = 22, fg = 21;
        var gap = (W - 2 * padX) / (num - 1);
        var nz = frets.filter(function (f) { return f > 0; });
        var minF = nz.length ? Math.min.apply(null, nz) : 0;
        var hasMark = frets.some(function (v) { return v <= 0; });
        var maxF = Math.max.apply(null, frets.filter(function (f) { return f > 0; })) || 0;
        var lo = maxF <= 4 ? 0 : Math.max(minF - 1, 0);
        var showNut = lo === 0;
        var hi = Math.max(maxF + 1, lo + 4);
        var rows = hi - lo;
        var top = hasMark ? 26 : 16;
        var markY = top - 11;
        var H = top + rows * fg + 10;
        var yWire = function (f) { return top + (f - lo) * fg; };
        var yDot = function (f) { return top + (f - lo) * fg - fg / 2; };
        var xStr = function (i) { return strX(i, gap, padX); };
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">';
        var strTop = yWire(lo);
        for (var i = 0; i < num; i++) {
            s += '<line class="st" x1="' + xStr(i) + '" y1="' + strTop + '" x2="' + xStr(i) + '" y2="' + yWire(hi) + '"/>';
        }
        for (var f = showNut ? 1 : lo; f <= hi; f++) {
            s += '<line class="fw" x1="' + (xStr(0) - 6) + '" y1="' + yWire(f) + '" x2="' + (xStr(num - 1) + 6) + '" y2="' + yWire(f) + '"/>';
        }
        if (showNut) {
            s += '<line class="nut" x1="' + (xStr(0) - 6) + '" y1="' + yWire(0) + '" x2="' + (xStr(num - 1) + 6) + '" y2="' + yWire(0) + '"/>';
        } else {
            s += '<text class="pos" x="9" y="' + (yWire(lo) + fg / 2) + '">' + (lo + 1) + '</text>';
        }
        var covered = {};
        (function () {
            var fretted = nz;
            if (!fretted.length) return;
            var mf = Math.min.apply(null, fretted);
            var idxs = [];
            frets.forEach(function (v, idx) { if (v === mf) idxs.push(idx); });
            if (idxs.length < 2) return;
            var lo2 = idxs[0], hi2 = idxs[idxs.length - 1], okBar = true;
            for (var k = lo2; k <= hi2; k++) {
                if (frets[k] === 0 || frets[k] === -1) { okBar = false; break; }
            }
            if (!okBar) return;
            if (idxs.length < 3 && (hi2 - lo2 + 1) === idxs.length) return;
            var x1 = xStr(lo2), x2 = xStr(hi2);
            s += '<rect class="bar" x="' + (x1 - 7) + '" y="' + (yDot(mf) - 7) + '" width="' + (x2 - x1 + 14) + '" height="14" rx="7"/>';
            idxs.forEach(function (ix) { covered[ix] = 1; });
        })();
        frets.forEach(function (fr, idx) {
            if (covered[idx]) return;
            if (fr === 0) s += '<circle class="oc" cx="' + xStr(idx) + '" cy="' + markY + '" r="4.5"/>';
            else if (fr === -1) s += '<text class="muted" x="' + xStr(idx) + '" y="' + markY + '" text-anchor="middle">\u00d7</text>';
            else s += '<circle class="dot" cx="' + xStr(idx) + '" cy="' + yDot(fr) + '" r="7"/>';
        });
        return s + '</svg>';
    }

    function fretLabelsSVG(instrumentId, frets) {
        var inst = instrumentOf(instrumentId);
        var num = frets.length || inst.tuning.length;
        var W = num === 6 ? 160 : 104;
        var padX = 22;
        var gap = (W - 2 * padX) / (num - 1);
        var H = 14;
        var s = '<svg class="flabels" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">';
        for (var i = 0; i < num; i++) {
            var label = frets[i] < 0 ? 'x' : String(frets[i]);
            s += '<text class="snum" x="' + (padX + i * gap) + '" y="' + (H / 2) + '">' + label + '</text>';
        }
        return s + '</svg>';
    }

    var svgStyle = '<style>.st{stroke:#5f6d80;stroke-width:1.4}.fw{stroke:#4c5765;stroke-width:1.4}' +
        '.nut{stroke:#8b95a5;stroke-width:4.5;stroke-linecap:round}.dot,.bar{fill:#3b6bd6}' +
        '.oc{fill:none;stroke:#77829a;stroke-width:1.7}.pos{fill:#828d9e;font-size:11px;font-weight:700}' +
        '.muted{fill:#8b95a5;font-size:13px;font-weight:700}</style>';

    function withStyle(svg) {
        return svg.replace('<svg ', '<svg ').replace(/^(<svg[^>]*>)/, '$1' + svgStyle);
    }

    function dataUri(instrumentId, frets) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(withStyle(diagramSVG(instrumentId, frets)));
    }

    /* ---------------- exports ---------------- */

    root.ChordKit = {
        INSTRUMENTS: INSTRUMENTS,
        TYPES: TYPES,
        instrumentOf: instrumentOf,
        typeOf: typeOf,
        typeForSuffix: typeForSuffix,
        parse: parse,
        rootPcOf: rootPcOf,
        rootName: rootName,
        chordDifficulty: chordDifficulty,
        voicings: voicings,
        bestVoicing: bestVoicing,
        diagramSVG: diagramSVG,
        fretLabelsSVG: fretLabelsSVG,
        dataUri: dataUri,
        version: '1.0.0'
    };
})(typeof window !== 'undefined' ? window : this);
