/* Songbook — neck explorer
 * full fretboard: selected chord shape, all chord tones and a scale layer
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order
 * set by index.html; see js/core.js for the shared state. The neck edits the
 * same root/quality/spelling as the shapes tab (js/explorer.js) and reads its
 * voicings from the shared ChordKit engine in chords.js.
 */
(function (SB) {
    'use strict';

    var PREF_KEY = SB.NS + ':neck';
    var NECK_FRETS = 12;
    var INLAY_FRETS = { 3: 1, 5: 1, 7: 1, 9: 1, 12: 2 };

    var MINOR_IDS = { m: 1, m7: 1, m6: 1, m9: 1, 'm7b5': 1 };

    var QUALITY_LABELS = {
        maj: 'Major',
        m: 'Minor',
        '7': 'Dominant 7th',
        maj7: 'Major 7th',
        m7: 'Minor 7th',
        sus4: 'Sus4',
        sus2: 'Sus2',
        '7sus4': '7sus4',
        '6': '6th',
        m6: 'Minor 6th',
        '9': '9th',
        m9: 'Minor 9th',
        maj9: 'Major 9th',
        add9: 'Add 9',
        dim: 'Diminished',
        dim7: 'Diminished 7th',
        aug: 'Augmented',
        m7b5: 'Minor 7\u266d5'
    };

    var DEGREE_LABELS = {
        root: 'Root',
        '2': 'Major 2nd',
        '\u266d2': 'Minor 2nd',
        '3': 'Major 3rd',
        '\u266d3': 'Minor 3rd',
        '4': 'Perfect 4th',
        '\u266d5': 'Diminished 5th',
        '5': 'Perfect 5th',
        '\u266f5': 'Augmented 5th',
        '6': 'Major 6th',
        '\u266d6': 'Minor 6th',
        '\u266d7': 'Minor 7th',
        '7': 'Major 7th',
        '9': 'Major 9th',
        '\u266d\u266d7': 'Diminished 7th'
    };

    var prefs = readPrefs();

    var state = {
        shapeIndex: 0,
        scaleRootPc: null,
        scaleId: prefs.scaleId || null,
        scaleTouched: !!prefs.scaleId
    };

    /* ---------------- preferences ---------------- */

    function readPrefs() {
        var raw = SB.lsGet(PREF_KEY, {});
        if (!raw || typeof raw !== 'object') raw = {};
        var capo = Number(raw.capo);
        return {
            allTones: raw.allTones !== false,
            scaleOn: raw.scaleOn !== false,
            octaves: raw.octaves === true,
            capo: capo >= 0 && capo <= 7 ? Math.floor(capo) : 0,
            scaleId: typeof raw.scaleId === 'string' ? raw.scaleId : null
        };
    }

    function savePrefs() {
        SB.lsSet(PREF_KEY, {
            allTones: prefs.allTones,
            scaleOn: prefs.scaleOn,
            octaves: prefs.octaves,
            capo: prefs.capo,
            scaleId: state.scaleId
        });
    }

    /* ---------------- shared explorer state ---------------- */

    function exp() { return SB.explorerState; }
    function inst() { return ChordKit.instrumentOf(SB.state.instrument); }
    function type() { return ChordKit.typeOf(exp().quality); }
    function mod12(n) { return ((n % 12) + 12) % 12; }
    function isMinorQuality() { return !!MINOR_IDS[exp().quality]; }

    function chordName() { return exp().rootName + type().suffix; }
    function shapeChordName() {
        return ChordKit.rootName(mod12(exp().rootPc - prefs.capo), exp().spelling) +
            type().suffix;
    }

    function defaultScaleId() {
        return isMinorQuality() ? 'minorPent' : 'major';
    }

    function scaleId() {
        return state.scaleId || defaultScaleId();
    }

    function scaleRootPc() {
        return state.scaleRootPc == null ? exp().rootPc : state.scaleRootPc;
    }

    function scaleRootName() {
        return ChordKit.rootName(scaleRootPc(), exp().spelling);
    }

    function scaleInfo() {
        var scale = ChordKit.scaleOf(scaleId());
        return {
            id: scale.id,
            label: scale.label,
            summary: scaleRootName() + ' ' + scale.label.toLowerCase()
        };
    }

    /* ---------------- chord data ---------------- */

    function shapes() {
        return curateShapes(ChordKit.voicings(shapeChordName(), inst().id) || []);
    }

    /* The engine returns every playable permutation, which is useful for the
     * shapes grid but far too many for a neck stepper (Am7 on guitar alone has
     * over a thousand). For the neck, keep the best-ranked voicing for each
     * bass note in each hand position: one representative per inversion and
     * region, so paging moves through distinct shapes rather than variants
     * that only double a note on another string. */
    function curateShapes(list) {
        var guitar = inst();
        var seen = {};
        var out = [];
        list.forEach(function (frets) {
            var bassMidi = null;
            var minFret = Infinity;
            for (var i = 0; i < frets.length; i++) {
                var fret = frets[i];
                if (fret < 0) continue;
                if (fret > 0 && fret < minFret) minFret = fret;
                var midi = guitar.tuning[i] + prefs.capo + fret;
                if (bassMidi === null || midi < bassMidi) bassMidi = midi;
            }
            if (bassMidi === null) return;
            var key = mod12(bassMidi) + ':' + region(minFret);
            if (seen[key]) return;
            seen[key] = true;
            out.push(frets);
        });
        return out;
    }

    function region(minFret) {
        if (minFret === Infinity || minFret === 0) return 0;
        if (minFret <= 4) return 1;
        if (minFret <= 8) return 2;
        return 3;
    }

    function currentShape(list) {
        if (!list.length) return null;
        if (state.shapeIndex < 0) state.shapeIndex = list.length - 1;
        if (state.shapeIndex >= list.length) state.shapeIndex = 0;
        return list[state.shapeIndex];
    }

    function chordMap() {
        var map = {};
        ChordKit.chordNotes(chordName()).forEach(function (note) {
            map[note.pc] = note;
        });
        return map;
    }

    function scaleMap() {
        var map = {};
        ChordKit.scaleNotes(scaleRootPc(), scaleId(), exp().spelling)
            .forEach(function (note) { map[note.pc] = note; });
        return map;
    }

    function pitchAt(stringIndex, fret) {
        var midi = inst().tuning[stringIndex] + prefs.capo + fret;
        return { midi: midi, pc: mod12(midi) };
    }

    function noteName(pc, map) {
        return map[pc] ? map[pc].name : ChordKit.rootName(pc, exp().spelling);
    }

    function degreeMark(degree) {
        return degree === 'root' ? 'R' : degree;
    }

    function voiceLabel(frets, index) {
        var guitar = inst();
        var bassMidi = null;
        var minFret = Infinity;
        for (var i = 0; i < frets.length; i++) {
            var fret = frets[i];
            if (fret < 0) continue;
            if (fret > 0 && fret < minFret) minFret = fret;
            var midi = guitar.tuning[i] + prefs.capo + fret;
            if (bassMidi === null || midi < bassMidi) bassMidi = midi;
        }
        if (bassMidi === null) return (index + 1) + '. Muted';
        var bassPc = mod12(bassMidi);
        var rootInBass = bassPc === exp().rootPc;
        var position;
        if (minFret === Infinity || minFret <= 2) {
            position = prefs.capo ? 'At capo' : 'Open position';
        } else if (minFret <= 4) {
            position = 'Low position';
        } else if (minFret <= 8) {
            position = 'Mid position';
        } else {
            position = 'High position';
        }
        var bass = rootInBass ? 'root' : ChordKit.rootName(bassPc, exp().spelling);
        return (index + 1) + '. ' + position + ', ' + bass + ' in bass \u00b7 ' +
            fretsLabel(frets);
    }

    function fretsLabel(frets) {
        return frets.map(function (fret) {
            return fret < 0 ? 'x' : String(fret);
        }).join(' ');
    }

    /* ---------------- select builders ---------------- */

    function fillSelect(select, options, value) {
        select.innerHTML = options.map(function (opt) {
            return '<option value="' + opt.value + '">' + opt.label + '</option>';
        }).join('');
        select.value = String(value);
    }

    function rootOptions() {
        var out = [];
        for (var pc = 0; pc < 12; pc++) {
            out.push({ value: pc, label: ChordKit.rootName(pc, exp().spelling) });
        }
        return out;
    }

    function qualityOptions() {
        return ChordKit.TYPES.map(function (item) {
            return {
                value: item.id,
                label: QUALITY_LABELS[item.id] || item.suffix || 'Major'
            };
        });
    }

    function scaleTypeOptions() {
        return ChordKit.SCALES.map(function (scale) {
            return { value: scale.id, label: scale.label };
        });
    }

    function capoOptions() {
        var out = [{ value: 0, label: 'No capo' }];
        for (var n = 1; n <= 7; n++) out.push({ value: n, label: 'Capo ' + n });
        return out;
    }

    function renderToolbar() {
        fillSelect(SB.$('neckRoot'), rootOptions(), exp().rootPc);
        fillSelect(SB.$('neckQuality'), qualityOptions(), exp().quality);
        fillSelect(SB.$('neckCapo'), capoOptions(), prefs.capo);

        var scaleKeyOptions = [{ value: '', label: 'Follow chord (' + exp().rootName + ')' }].concat(rootOptions());
        fillSelect(SB.$('neckScaleRoot'), scaleKeyOptions,
            state.scaleRootPc == null ? '' : state.scaleRootPc);
        fillSelect(SB.$('neckScaleType'), scaleTypeOptions(), scaleId());

        var spell = SB.$('neckSpell');
        var sharp = ChordKit.rootName(exp().rootPc, 'sharp');
        var flat = ChordKit.rootName(exp().rootPc, 'flat');
        if (sharp === flat) {
            spell.hidden = true;
        } else {
            spell.hidden = false;
            spell.textContent = 'Spell as ' + (exp().spelling === 'sharp' ? flat : sharp);
            spell.setAttribute('aria-label',
                'Spell the root as ' + (exp().spelling === 'sharp' ? flat : sharp));
        }

        SB.$('neckAllTones').setAttribute('aria-pressed', prefs.allTones ? 'true' : 'false');
        SB.$('neckScaleToggle').setAttribute('aria-pressed', prefs.scaleOn ? 'true' : 'false');
        SB.$('neckOctaves').setAttribute('aria-pressed', prefs.octaves ? 'true' : 'false');
        SB.$('neckScaleFields').hidden = !prefs.scaleOn;
    }

    function renderSummary(list) {
        var notes = ChordKit.chordNotes(chordName());
        SB.$('neckChordName').textContent = chordName();
        SB.$('neckChordNotes').textContent = notes.map(function (note) {
            return note.name;
        }).join(' \u00b7 ');

        var count = SB.$('neckShapeCount');
        var next = SB.$('neckNext');
        var prev = SB.$('neckPrev');
        var frets = SB.$('neckShapeFrets');

        if (!list.length) {
            count.textContent = 'No shapes';
            frets.textContent = '\u2014';
            next.disabled = true;
            prev.disabled = true;
            fillSelect(SB.$('neckVoicing'), [{ value: 0, label: 'No playable shape' }], 0);
        } else {
            currentShape(list);
            count.textContent = (state.shapeIndex + 1) + ' / ' + list.length;
            frets.textContent = fretsLabel(list[state.shapeIndex]);
            next.disabled = list.length < 2;
            prev.disabled = list.length < 2;
            fillSelect(SB.$('neckVoicing'), list.map(function (frets, index) {
                return { value: index, label: voiceLabel(frets, index) };
            }), state.shapeIndex);
        }

        var summary = scaleInfo();
        SB.$('neckScaleSummary').textContent = prefs.scaleOn
            ? 'Scale: ' + summary.summary
            : 'Scale hidden';
    }

    /* ---------------- neck drawing ---------------- */

    function noteMarkup(x, y, opts) {
        if (opts.kind === 'scale') {
            return '<circle class="neck-note neck-note-scale" cx="' + x +
                '" cy="' + y + '" r="' + opts.r + '"/>';
        }
        var shape = opts.kind === 'shape';
        var textClass = shape ? 'neck-note-text neck-note-text-shape' : 'neck-note-text neck-note-text-tone';
        if (opts.octaves) textClass += ' neck-note-text-oct';
        var out = '<circle class="neck-note ' + (shape ? 'neck-note-shape' : 'neck-note-tone') +
            '" cx="' + x + '" cy="' + y + '" r="' + opts.r + '"/>' +
            '<text class="' + textClass + '" x="' + x + '" y="' + (y + 0.5) + '">' +
            opts.name + '</text>';
        if (shape && opts.degree) {
            var bx = x + opts.r * 0.85;
            var by = y - opts.r * 0.85;
            out += '<circle class="neck-badge" cx="' + bx + '" cy="' + by + '" r="6"/>' +
                '<text class="neck-badge-text" x="' + bx + '" y="' + (by + 0.5) + '">' +
                opts.degree + '</text>';
        }
        return out;
    }

    function mutedMarkup(x, y) {
        return '<text class="neck-muted" x="' + x + '" y="' + y + '">\u00d7</text>';
    }

    function markerAt(stringIndex, fret, shape, tones, scales) {
        var pitch = pitchAt(stringIndex, fret);
        var shapeFret = shape ? shape[stringIndex] : null;

        if (shapeFret === -1 && fret === 0) return { kind: 'muted' };
        if (shapeFret === fret) {
            var note = tones[pitch.pc];
            return {
                kind: 'shape',
                name: noteName(pitch.pc, tones) + (prefs.octaves ? octave(pitch.midi) : ''),
                degree: note ? degreeMark(note.degree) : ''
            };
        }
        if (prefs.allTones && tones[pitch.pc]) {
            return {
                kind: 'tone',
                name: noteName(pitch.pc, tones) + (prefs.octaves ? octave(pitch.midi) : '')
            };
        }
        if (prefs.scaleOn && scales[pitch.pc]) return { kind: 'scale' };
        return null;
    }

    function octave(midi) {
        return Math.floor(midi / 12) - 1;
    }

    function addMarker(out, x, y, marker, shapeRadius, toneRadius, scaleRadius) {
        if (!marker) return;
        if (marker.kind === 'muted') {
            out.push(mutedMarkup(x, y));
            return;
        }
        out.push(noteMarkup(x, y, {
            kind: marker.kind,
            name: marker.name,
            degree: marker.degree,
            octaves: prefs.octaves,
            r: marker.kind === 'shape' ? shapeRadius :
                (marker.kind === 'tone' ? toneRadius : scaleRadius)
        }));
    }

    function horizontalNeck(instrument, shape, tones, scales) {
        var num = instrument.tuning.length;
        var W = 860;
        var left = 30, openW = 38, right = 18, top = 36, bottom = 18;
        var rowGap = num === 6 ? 31 : 39;
        var H = top + (num - 1) * rowGap + bottom;
        var nutX = left + openW;
        var fw = (W - nutX - right) / NECK_FRETS;
        var rowY = function (row) { return top + row * rowGap; };
        var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">'];

        // Fret lines and numbers.
        for (var f = 0; f <= NECK_FRETS; f++) {
            var x = nutX + f * fw;
            var cls = f === 0 ? 'neck-nut' : 'neck-fret';
            out.push('<line class="' + cls + '" x1="' + x + '" y1="' + (top - 9) +
                '" x2="' + x + '" y2="' + (top + (num - 1) * rowGap + 9) + '"/>');
            if (f > 0) {
                out.push('<text class="neck-fret-num" x="' + (x - fw / 2) +
                    '" y="' + (top - 17) + '">' + f + '</text>');
            }
        }

        // Inlays sit between the two middle string rows.
        Object.keys(INLAY_FRETS).forEach(function (key) {
            var fret = Number(key);
            if (fret > NECK_FRETS) return;
            var cx = nutX + (fret - 0.5) * fw;
            var cy = top + ((num - 1) * rowGap) / 2;
            var dots = INLAY_FRETS[key];
            if (dots === 2) {
                out.push('<circle class="neck-inlay" cx="' + cx + '" cy="' + (cy - 9) + '" r="3.2"/>');
                out.push('<circle class="neck-inlay" cx="' + cx + '" cy="' + (cy + 9) + '" r="3.2"/>');
            } else {
                out.push('<circle class="neck-inlay" cx="' + cx + '" cy="' + cy + '" r="3.2"/>');
            }
        });

        // Strings, labels and the open-string column.
        for (var i = 0; i < num; i++) {
            var row = num - 1 - i;
            var y = rowY(row);
            out.push('<line class="neck-string" x1="' + nutX + '" y1="' + y + '" x2="' +
                (nutX + NECK_FRETS * fw) + '" y2="' + y + '"/>');
            out.push('<text class="neck-string-label" x="' + (left - 10) + '" y="' + (y + 0.5) +
                '">' + instrument.strings[i] + '</text>');
            addMarker(out, left + openW / 2, y, markerAt(i, 0, shape, tones, scales), 11, 9.5, 4.5);
            for (var fret = 1; fret <= NECK_FRETS; fret++) {
                addMarker(out, nutX + (fret - 0.5) * fw, y,
                    markerAt(i, fret, shape, tones, scales), 11, 9.5, 4.5);
            }
        }

        out.push('</svg>');
        return out.join('');
    }

    function verticalNeck(instrument, shape, tones, scales) {
        var num = instrument.tuning.length;
        var W = 340;
        var left = 34, right = 14, top = 42, bottom = 16;
        var colW = (W - left - right) / (num - 1);
        var openY = top;
        var nutY = top + 26;
        var fh = 44;
        var H = nutY + NECK_FRETS * fh + bottom;
        var colX = function (i) { return left + i * colW; };
        var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">'];

        // String labels above the open row.
        for (var i = 0; i < num; i++) {
            out.push('<text class="neck-string-label" x="' + colX(i) + '" y="' + (openY - 17) +
                '">' + instrument.strings[i] + '</text>');
        }

        // Fret lines and numbers.
        for (var f = 0; f <= NECK_FRETS; f++) {
            var y = nutY + f * fh;
            var cls = f === 0 ? 'neck-nut' : 'neck-fret';
            out.push('<line class="' + cls + '" x1="' + (left - 9) + '" y1="' + y + '" x2="' +
                (W - right + 9) + '" y2="' + y + '"/>');
            if (f > 0) {
                out.push('<text class="neck-fret-num" x="' + (left - 18) + '" y="' +
                    (y - fh / 2 + 3) + '">' + f + '</text>');
            }
        }

        // Inlays sit on the centre line between the two middle strings.
        Object.keys(INLAY_FRETS).forEach(function (key) {
            var fret = Number(key);
            if (fret > NECK_FRETS) return;
            var cy = nutY + (fret - 0.5) * fh;
            var cx = (left + (W - right)) / 2;
            var dots = INLAY_FRETS[key];
            if (dots === 2) {
                out.push('<circle class="neck-inlay" cx="' + (cx - 10) + '" cy="' + cy + '" r="3.2"/>');
                out.push('<circle class="neck-inlay" cx="' + (cx + 10) + '" cy="' + cy + '" r="3.2"/>');
            } else {
                out.push('<circle class="neck-inlay" cx="' + cx + '" cy="' + cy + '" r="3.2"/>');
            }
        });

        // Strings and note markers.
        for (var s = 0; s < num; s++) {
            var x = colX(s);
            out.push('<line class="neck-string" x1="' + x + '" y1="' + nutY + '" x2="' + x +
                '" y2="' + (nutY + NECK_FRETS * fh) + '"/>');
            addMarker(out, x, openY, markerAt(s, 0, shape, tones, scales), 13, 11, 5);
            for (var fret = 1; fret <= NECK_FRETS; fret++) {
                addMarker(out, x, nutY + (fret - 0.5) * fh,
                    markerAt(s, fret, shape, tones, scales), 13, 11, 5);
            }
        }

        out.push('</svg>');
        return out.join('');
    }

    function renderDiagram(list) {
        var shape = currentShape(list);
        var tones = chordMap();
        var scales = prefs.scaleOn ? scaleMap() : {};
        var vertical = window.matchMedia('(max-width: 640px)').matches;
        var host = SB.$('neckDiagram');
        var svg = vertical
            ? verticalNeck(inst(), shape, tones, scales)
            : horizontalNeck(inst(), shape, tones, scales);
        host.innerHTML = svg;

        var desc = chordName();
        if (shape) {
            desc += ', shape ' + (state.shapeIndex + 1) + ' of ' + list.length +
                ', frets ' + fretsLabel(shape);
        }
        if (prefs.capo) desc += ', capo ' + prefs.capo;
        if (prefs.scaleOn) desc += ', ' + scaleInfo().summary;
        host.setAttribute('aria-label', 'Fretboard: ' + desc);
    }

    /* ---------------- shape notes ---------------- */

    function renderShapeNotes(list) {
        var host = SB.$('neckShapeNotes');
        var count = SB.$('neckNotesCount');
        var shape = currentShape(list);
        if (!shape) {
            host.innerHTML = '<p class="explorer-empty">No playable shape for this chord in the explorer range.</p>';
            count.textContent = '';
            return;
        }

        var tones = chordMap();
        var notes = [];
        for (var i = 0; i < shape.length; i++) {
            var fret = shape[i];
            if (fret < 0) continue;
            var pitch = pitchAt(i, fret);
            var tone = tones[pitch.pc];
            notes.push({
                stringIndex: i,
                fret: fret,
                midi: pitch.midi,
                name: noteName(pitch.pc, tones),
                octave: octave(pitch.midi),
                degree: tone ? tone.degree : null,
                role: tone ? (DEGREE_LABELS[tone.degree] || tone.degree) : 'Chord tone'
            });
        }
        notes.sort(function (a, b) { return a.midi - b.midi; });

        host.innerHTML = notes.map(function (note) {
            var stringNo = inst().tuning.length - note.stringIndex;
            var at = note.fret === 0
                ? (prefs.capo ? 'capo' : 'open')
                : 'fr ' + note.fret;
            return '<div class="neck-string-note' + (note.degree === 'root' ? ' root' : '') + '">' +
                '<div class="neck-string-note-top">' +
                '<span class="neck-string-note-name">' + note.name + note.octave + '</span>' +
                (note.degree ? '<span class="neck-string-degree">' + degreeMark(note.degree) + '</span>' : '') +
                '</div>' +
                '<div class="neck-string-role">' + note.role + '</div>' +
                '<div class="neck-string-pos">str ' + stringNo + ', ' + at + '</div>' +
                '</div>';
        }).join('');
        count.textContent = notes.length + (notes.length === 1 ? ' note' : ' notes');
    }

    /* ---------------- render ---------------- */

    function render() {
        if (!SB.$('neckRoot')) return;
        var list = shapes();
        renderToolbar();
        renderSummary(list);
        renderDiagram(list);
        renderShapeNotes(list);
    }

    /* ---------------- wiring ---------------- */

    function setChordRoot(pc) {
        SB.applyExplorerSelection({
            rootPc: pc,
            rootName: ChordKit.rootName(pc, exp().spelling)
        });
    }

    function bindOnce() {
        var root = SB.$('neckRoot');
        if (!root || root.dataset.bound) return;
        root.dataset.bound = '1';

        root.addEventListener('change', function () {
            state.shapeIndex = 0;
            setChordRoot(Number(root.value));
        });

        SB.$('neckQuality').addEventListener('change', function () {
            state.shapeIndex = 0;
            if (!state.scaleTouched) state.scaleId = null;
            SB.applyExplorerSelection({ quality: SB.$('neckQuality').value });
        });

        SB.$('neckVoicing').addEventListener('change', function () {
            state.shapeIndex = Number(SB.$('neckVoicing').value) || 0;
            render();
        });

        SB.$('neckPrev').addEventListener('click', function () {
            var list = shapes();
            if (!list.length) return;
            state.shapeIndex = (state.shapeIndex - 1 + list.length) % list.length;
            render();
        });

        SB.$('neckNext').addEventListener('click', function () {
            var list = shapes();
            if (!list.length) return;
            state.shapeIndex = (state.shapeIndex + 1) % list.length;
            render();
        });

        SB.$('neckCapo').addEventListener('change', function () {
            prefs.capo = Number(SB.$('neckCapo').value) || 0;
            state.shapeIndex = 0;
            savePrefs();
            render();
        });

        SB.$('neckAllTones').addEventListener('click', function () {
            prefs.allTones = !prefs.allTones;
            savePrefs();
            render();
        });

        SB.$('neckScaleToggle').addEventListener('click', function () {
            prefs.scaleOn = !prefs.scaleOn;
            savePrefs();
            render();
        });

        SB.$('neckOctaves').addEventListener('click', function () {
            prefs.octaves = !prefs.octaves;
            savePrefs();
            render();
        });

        SB.$('neckScaleRoot').addEventListener('change', function () {
            var value = SB.$('neckScaleRoot').value;
            state.scaleRootPc = value === '' ? null : Number(value);
            render();
        });

        SB.$('neckScaleType').addEventListener('change', function () {
            state.scaleId = SB.$('neckScaleType').value;
            state.scaleTouched = true;
            savePrefs();
            render();
        });

        SB.$('neckSpell').addEventListener('click', function () {
            var next = exp().spelling === 'sharp' ? 'flat' : 'sharp';
            SB.applyExplorerSelection({ rootPc: exp().rootPc, spelling: next });
        });

        var media = window.matchMedia('(max-width: 640px)');
        if (media.addEventListener) {
            media.addEventListener('change', function () {
                if (SB.neckVisible && SB.neckVisible()) render();
            });
        }
    }

    SB.renderNeck = render;
    SB.neckPrefs = prefs;

    bindOnce();

})(window.SB = window.SB || {});
