/* Songbook — chord explorer: full neck, CAGED shapes, chord tones and scale
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order
 * set by index.html; see js/core.js for the shared state. The neck edits the
 * same root/quality/spelling as the shapes tab (js/explorer.js) and reads its
 * voicings from the shared ChordKit engine in chords.js.
 *
 * The CAGED layout is built from the five movable major shapes. For each
 * shape position the engine supplies the best voicing of the actual chord
 * quality, so a Cm7 region still shows a real Cm7 voicing rather than a
 * major triad. Regions repeat every octave, which is what makes the familiar
 * C–A–G–E–D run appear across the neck.
 */
(function (SB) {
    'use strict';

    var PREF_KEY = SB.NS + ':neck';
    var INLAY_FRETS = {
        3: 1, 5: 1, 7: 1, 9: 1, 12: 2,
        15: 1, 17: 1, 19: 1, 21: 1, 24: 2
    };

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

    var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var CAGED_LETTERS = ['C', 'A', 'G', 'E', 'D'];
    var QUICK_QUALITIES = ['maj', 'm', '7', 'maj7', 'm7'];
    var LABEL_MODES = ['notes', 'degrees', 'none'];
    var FRET_CHOICES = [12, 15, 24];

    /* Semitone offsets from the shape's root string. These are the movable
     * major forms: C and A put the root on the A string, G and E on the low E,
     * and D on the D string. */
    var CAGED_SHAPES = {
        C: { rootString: 1, offsets: { 1: 0, 2: -1, 3: -3, 4: -2, 5: -3 } },
        A: { rootString: 1, offsets: { 1: 0, 2: 2, 3: 2, 4: 2, 5: 0 } },
        G: { rootString: 0, offsets: { 0: 0, 1: -1, 2: -3, 3: -3, 4: -3, 5: 0 } },
        E: { rootString: 0, offsets: { 0: 0, 1: 2, 2: 2, 3: 1, 4: 0, 5: 0 } },
        D: { rootString: 2, offsets: { 2: 0, 3: 2, 4: 3, 5: 2 } }
    };

    var CAGED_COLORS = {
        C: 'var(--caged-c)',
        A: 'var(--caged-a)',
        G: 'var(--caged-g)',
        E: 'var(--caged-e)',
        D: 'var(--caged-d)'
    };

    var prefs = readPrefs();

    var state = {
        scaleRootPc: null,
        scaleId: prefs.scaleId || null
    };

    var highGuitarId = null;
    var voicingCache = {};

    /* ---------------- preferences ---------------- */

    function readPrefs() {
        var raw = SB.lsGet(PREF_KEY, {});
        if (!raw || typeof raw !== 'object') raw = {};
        var capo = Number(raw.capo);
        var frets = Number(raw.frets);
        if (FRET_CHOICES.indexOf(frets) < 0) frets = 15;

        var shapeMode = typeof raw.shapeMode === 'string' ? raw.shapeMode : 'caged';
        if (shapeMode !== 'caged' && shapeMode !== 'all' &&
            CAGED_LETTERS.indexOf(shapeMode) < 0) {
            shapeMode = 'caged';
        }
        var labelMode = LABEL_MODES.indexOf(raw.labelMode) >= 0 ? raw.labelMode : 'notes';

        return {
            scaleOn: raw.scaleOn !== false,
            octaves: raw.octaves === true,
            capo: capo >= 0 && capo <= 7 ? Math.floor(capo) : 0,
            scaleId: typeof raw.scaleId === 'string' ? raw.scaleId : null,
            frets: frets,
            shapeMode: shapeMode,
            labelMode: labelMode,
            bassDegree: typeof raw.bassDegree === 'string' ? raw.bassDegree : 'root',
            fingers: raw.fingers === true
        };
    }

    function savePrefs() {
        SB.lsSet(PREF_KEY, {
            scaleOn: prefs.scaleOn,
            octaves: prefs.octaves,
            capo: prefs.capo,
            scaleId: state.scaleId,
            frets: prefs.frets,
            shapeMode: prefs.shapeMode,
            labelMode: prefs.labelMode,
            bassDegree: prefs.bassDegree,
            fingers: prefs.fingers
        });
    }

    /* ---------------- shared explorer state ---------------- */

    function exp() { return SB.explorerState; }
    function inst() { return ChordKit.instrumentOf(SB.state.instrument); }
    function isGuitar() { return inst().id === 'guitar'; }
    function type() { return ChordKit.typeOf(exp().quality); }
    function mod12(n) { return ((n % 12) + 12) % 12; }
    function isMinorQuality() { return !!MINOR_IDS[exp().quality]; }

    function chordName() { return exp().rootName + type().suffix; }

    /* The chord the shapes are drawn for. With a capo the shapes are relative
     * to the capo, exactly like a player reading a capo chart. */
    function shapeRootPc() { return mod12(exp().rootPc - prefs.capo); }
    function shapeChordName() {
        return ChordKit.rootName(shapeRootPc(), exp().spelling) + type().suffix;
    }

    function parsedRoot() {
        return ChordKit.parse(exp().rootName) ||
            { letter: 'C', acc: 0, rootPc: 0 };
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

    function octave(midi) {
        return Math.floor(midi / 12) - 1;
    }

    function bassPcOf(frets) {
        var min = null;
        for (var i = 0; i < frets.length; i++) {
            if (frets[i] < 0) continue;
            var midi = inst().tuning[i] + prefs.capo + frets[i];
            if (min === null || midi < min) min = midi;
        }
        return min === null ? null : mod12(min);
    }

    function selectedBassPc() {
        if (!prefs.bassDegree) return null;
        var notes = ChordKit.chordNotes(chordName());
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].degree === prefs.bassDegree) return notes[i].pc;
        }
        return notes.length ? notes[0].pc : null;
    }

    function ordinal(degree) {
        var map = {
            root: 'root',
            '2': '2nd', '\u266d2': '2nd',
            '3': '3rd', '\u266d3': '3rd',
            '4': '4th', '\u266f4': '4th',
            '5': '5th', '\u266f5': '5th', '\u266d5': '5th',
            '6': '6th', '\u266d6': '6th',
            '7': '7th', '\u266d7': '7th',
            '9': '9th', '\u266d9': '9th',
            '11': '11th', '\u266f11': '11th',
            '13': '13th', '\u266d13': '13th'
        };
        return map[degree] || degree;
    }

    function fingerMap(frets) {
        var uniq = [];
        frets.forEach(function (fret) {
            if (fret > 0 && uniq.indexOf(fret) < 0) uniq.push(fret);
        });
        uniq.sort(function (a, b) { return a - b; });
        var map = {};
        uniq.forEach(function (fret, index) {
            map[fret] = Math.min(4, index + 1);
        });
        return map;
    }

    /* ---------------- CAGED shape positions ---------------- */

    function highGuitar() {
        if (highGuitarId) return highGuitarId;
        var base = ChordKit.instrumentOf('guitar');
        if (!ChordKit.INSTRUMENTS.guitar15) {
            var clone = {};
            Object.keys(base).forEach(function (key) { clone[key] = base[key]; });
            clone.id = 'guitar15';
            clone.maxFret = 15;
            ChordKit.INSTRUMENTS.guitar15 = clone;
        }
        highGuitarId = 'guitar15';
        return highGuitarId;
    }

    function qualityVoicings() {
        if (!isGuitar()) return [];
        var name = shapeChordName();
        if (!voicingCache[name]) {
            voicingCache[name] = ChordKit.voicings(name, highGuitar());
        }
        return voicingCache[name];
    }

    function shiftFrets(frets, amount) {
        return frets.map(function (fret) {
            return fret < 0 ? -1 : fret + amount;
        });
    }

    function cagedTemplates() {
        var rootPc = shapeRootPc();
        var tuning = inst().tuning;
        var num = tuning.length;
        var out = [];
        if (!isGuitar()) return out;

        CAGED_LETTERS.forEach(function (letter) {
            var shape = CAGED_SHAPES[letter];
            var rootFret = mod12(rootPc - tuning[shape.rootString]);
            for (var octave = 0; octave <= 2; octave++) {
                var anchor = rootFret + 12 * octave;
                var frets = [];
                var valid = true;
                for (var s = 0; s < num; s++) {
                    if (shape.offsets[s] == null) {
                        frets.push(-1);
                        continue;
                    }
                    var fret = anchor + shape.offsets[s];
                    if (fret < 0 || fret > prefs.frets) {
                        valid = false;
                        break;
                    }
                    frets.push(fret);
                }
                if (!valid) continue;
                var sounding = frets.filter(function (fret) { return fret >= 0; });
                if (sounding.length < 3) continue;
                out.push({
                    letter: letter,
                    template: frets,
                    octave: octave,
                    minFret: Math.min.apply(null, sounding),
                    maxFret: Math.max.apply(null, sounding)
                });
            }
        });

        out.sort(function (a, b) {
            if (a.minFret !== b.minFret) return a.minFret - b.minFret;
            return CAGED_LETTERS.indexOf(a.letter) - CAGED_LETTERS.indexOf(b.letter);
        });
        return out;
    }

    function cagedShapes() {
        if (!isGuitar()) return [];
        var templates = cagedTemplates();
        var voicings = qualityVoicings();
        var wantedBass = selectedBassPc();
        var out = [];

        templates.forEach(function (template) {
            var baseLo = template.minFret - 12 * template.octave;
            var baseHi = template.maxFret - 12 * template.octave;
            var candidates = voicings.filter(function (frets) {
                return frets.every(function (fret) {
                    return fret < 0 || (fret >= baseLo && fret <= baseHi);
                });
            });
            if (!candidates.length) return;

            var chosen = null;
            var bassMatch = wantedBass == null;
            if (wantedBass != null) {
                for (var i = 0; i < candidates.length; i++) {
                    var shifted = shiftFrets(candidates[i], 12 * template.octave);
                    if (bassPcOf(shifted) === wantedBass) {
                        chosen = candidates[i];
                        bassMatch = true;
                        break;
                    }
                }
            }
            if (!chosen) chosen = candidates[0];

            var frets = shiftFrets(chosen, 12 * template.octave);
            var sounding = frets.filter(function (fret) { return fret >= 0; });
            if (!sounding.length) return;

            out.push({
                letter: template.letter,
                frets: frets,
                minFret: Math.min.apply(null, sounding),
                maxFret: Math.max.apply(null, sounding),
                bassPc: bassPcOf(frets),
                bassMatch: bassMatch
            });
        });

        var seen = {};
        out = out.filter(function (shape) {
            var key = shape.letter + ':' + shape.frets.join(',');
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });

        out.sort(function (a, b) {
            if (a.minFret !== b.minFret) return a.minFret - b.minFret;
            return CAGED_LETTERS.indexOf(a.letter) - CAGED_LETTERS.indexOf(b.letter);
        });
        return out;
    }

    function effectiveShapeMode() {
        if (!isGuitar()) return 'all';
        if (prefs.shapeMode === 'caged' || prefs.shapeMode === 'all' ||
            CAGED_LETTERS.indexOf(prefs.shapeMode) >= 0) {
            return prefs.shapeMode;
        }
        return 'caged';
    }

    function activeShapes(allShapes) {
        var mode = effectiveShapeMode();
        if (mode === 'caged') return allShapes;
        if (mode === 'all') return [];
        return allShapes.filter(function (shape) { return shape.letter === mode; });
    }

    function currentVoicing() {
        var shapes = cagedShapes();
        var active = activeShapes(shapes);
        var wantedBass = selectedBassPc();

        if (active.length) {
            if (wantedBass != null) {
                for (var i = 0; i < active.length; i++) {
                    if (active[i].bassPc === wantedBass) return active[i].frets;
                }
            }
            return active[0].frets;
        }

        var id = isGuitar() ? highGuitar() : inst().id;
        var list = ChordKit.voicings(shapeChordName(), id);
        if (wantedBass != null) {
            for (var j = 0; j < list.length; j++) {
                if (bassPcOf(list[j]) === wantedBass) return list[j];
            }
        }
        return list.length ? list[0] : null;
    }

    /* ---------------- control builders ---------------- */

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

    function renderHero() {
        SB.$('neckChordName').textContent = chordName();
        SB.$('neckChordNotes').textContent =
            exp().rootName + ' ' + (QUALITY_LABELS[exp().quality] || 'Major').toLowerCase();
    }

    function renderRoots() {
        var parsed = parsedRoot();
        SB.$('neckRoot').innerHTML = LETTERS.map(function (letter) {
            var active = parsed.letter === letter;
            return '<button type="button" data-root-letter="' + letter +
                '" aria-pressed="' + active + '">' + letter + '</button>';
        }).join('');

        var accidentals = [
            { value: -1, label: '\u266d', name: 'Flat' },
            { value: 0, label: '\u266e', name: 'Natural' },
            { value: 1, label: '\u266f', name: 'Sharp' }
        ];
        SB.$('neckAccidental').innerHTML = accidentals.map(function (item) {
            return '<button type="button" data-acc="' + item.value +
                '" aria-pressed="' + (parsed.acc === item.value) +
                '" aria-label="' + item.name + '">' + item.label + '</button>';
        }).join('');
    }

    function renderLabels() {
        SB.$('neckLabels').innerHTML = [
            { value: 'notes', label: 'Notes' },
            { value: 'degrees', label: 'Degrees' },
            { value: 'none', label: 'None' }
        ].map(function (item) {
            return '<button type="button" data-label="' + item.value +
                '" aria-pressed="' + (prefs.labelMode === item.value) + '">' +
                item.label + '</button>';
        }).join('');
    }

    function renderQualities() {
        var root = exp().rootName;
        SB.$('neckQualities').innerHTML = QUICK_QUALITIES.map(function (id) {
            var quality = ChordKit.typeOf(id);
            return '<button type="button" data-quality="' + id +
                '" aria-pressed="' + (exp().quality === id) + '">' +
                root + quality.suffix + '</button>';
        }).join('');

        var select = SB.$('neckQuality');
        select.innerHTML = '<option value="" disabled>More chords</option>' +
            ChordKit.TYPES.map(function (item) {
                return '<option value="' + item.id + '">' + root + item.suffix +
                    ' \u00b7 ' + (QUALITY_LABELS[item.id] || item.suffix) + '</option>';
            }).join('');
        select.value = QUICK_QUALITIES.indexOf(exp().quality) >= 0 ? '' : exp().quality;
    }

    function renderShapes() {
        var guitar = isGuitar();
        var mode = effectiveShapeMode();
        var options = [
            { value: 'caged', label: 'CAGED' },
            { value: 'all', label: 'All' }
        ].concat(CAGED_LETTERS.map(function (letter) {
            return { value: letter, label: letter };
        }));

        SB.$('neckShapes').innerHTML = options.map(function (item) {
            var disabled = !guitar && item.value !== 'all';
            var title = disabled ? ' title="CAGED shapes are a guitar layout"' : '';
            return '<button type="button" data-shape-mode="' + item.value +
                '" aria-pressed="' + (mode === item.value) + '"' +
                (disabled ? ' disabled' : '') + title + '>' + item.label + '</button>';
        }).join('');
    }

    function renderBass() {
        var notes = ChordKit.chordNotes(chordName());
        var found = notes.some(function (note) {
            return note.degree === prefs.bassDegree;
        });
        if (!found && prefs.bassDegree) {
            prefs.bassDegree = 'root';
            savePrefs();
        }

        var options = [{ value: '', label: 'Any bass' }].concat(notes.map(function (note) {
            return {
                value: note.degree,
                label: note.name + ', the ' + ordinal(note.degree)
            };
        }));
        fillSelect(SB.$('neckBass'), options, prefs.bassDegree || '');
    }

    function renderFrets() {
        SB.$('neckFrets').innerHTML = FRET_CHOICES.map(function (count) {
            return '<button type="button" data-frets="' + count +
                '" aria-pressed="' + (prefs.frets === count) + '">' + count + '</button>';
        }).join('');
    }

    function renderOptions() {
        SB.$('neckScaleToggle').setAttribute('aria-pressed', prefs.scaleOn ? 'true' : 'false');
        SB.$('neckFingers').setAttribute('aria-pressed', prefs.fingers ? 'true' : 'false');
        SB.$('neckOctaves').setAttribute('aria-pressed', prefs.octaves ? 'true' : 'false');
        SB.$('neckScaleFields').hidden = !prefs.scaleOn;

        fillSelect(SB.$('neckScaleType'), scaleTypeOptions(), scaleId());
        var scaleKeyOptions = [{ value: '', label: 'Follow chord (' + exp().rootName + ')' }]
            .concat(rootOptions());
        fillSelect(SB.$('neckScaleRoot'), scaleKeyOptions,
            state.scaleRootPc == null ? '' : state.scaleRootPc);
        fillSelect(SB.$('neckCapo'), capoOptions(), prefs.capo);

        var summary = scaleInfo();
        SB.$('neckScaleSummary').textContent = prefs.scaleOn
            ? 'Scale: ' + summary.summary
            : 'Scale hidden';
    }

    /* ---------------- neck drawing ---------------- */

    function horizontalNeck(shapes, tones, scales) {
        var instrument = inst();
        var num = instrument.tuning.length;
        var frets = prefs.frets;
        var mode = effectiveShapeMode();

        var W = 1000;
        var left = 46;
        var openW = 44;
        var right = 22;
        var top = 30;
        var rowGap = num === 6 ? 34 : 46;
        var boardTop = top - 16;
        var boardBottom = top + (num - 1) * rowGap + 16;
        var fretNumY = boardBottom + 22;
        var pillBaseY = fretNumY + 27;
        var H = pillBaseY + 34;

        var nutX = left + openW;
        var fw = (W - nutX - right) / frets;
        var xOpen = left + openW / 2;
        var noteR = num === 6 ? 13 : 15;

        function xFret(fret) {
            return fret <= 0 ? xOpen : nutX + (fret - 0.5) * fw;
        }
        function rowY(row) {
            return top + row * rowGap;
        }
        function stringRow(index) {
            return num - 1 - index;
        }

        var geometry = {
            num: num,
            stringRow: stringRow,
            xFret: xFret,
            rowY: rowY,
            fw: fw,
            noteR: noteR
        };

        var out = [];
        out.push('<svg viewBox="0 0 ' + W + ' ' + H +
            '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="group">');
        out.push('<defs><clipPath id="neckClip"><rect x="' + (left - 8) +
            '" y="' + boardTop + '" width="' + (W - left - right + 16) +
            '" height="' + (boardBottom - boardTop) + '" rx="12"/></clipPath></defs>');
        out.push('<rect class="neck-board" x="' + (left - 8) + '" y="' + boardTop +
            '" width="' + (W - left - right + 16) + '" height="' +
            (boardBottom - boardTop) + '" rx="12"/>');

        // Coloured CAGED regions sit behind the grid.
        out.push('<g clip-path="url(#neckClip)">');
        shapes.forEach(function (shape) {
            var d = regionPath(shape, geometry);
            if (!d) return;
            var color = CAGED_COLORS[shape.letter];
            out.push('<path class="neck-region' + (shape.bassMatch ? '' : ' is-dim') +
                '" d="' + d + '" fill="' + color + '" stroke="' + color + '"/>');
        });
        out.push('</g>');

        // Fret lines (the nut is drawn after the strings so it stays crisp).
        for (var fret = 1; fret <= frets; fret++) {
            var fretX = nutX + fret * fw;
            out.push('<line class="neck-fret" x1="' + fretX + '" y1="' + (boardTop + 4) +
                '" x2="' + fretX + '" y2="' + (boardBottom - 4) + '"/>');
        }

        // Inlays between the middle strings.
        var centerRow = (num - 1) / 2;
        var inlayY = top + centerRow * rowGap;
        Object.keys(INLAY_FRETS).forEach(function (key) {
            var inlayFret = Number(key);
            if (inlayFret > frets) return;
            var inlayX = nutX + (inlayFret - 0.5) * fw;
            if (INLAY_FRETS[key] === 2) {
                out.push('<circle class="neck-inlay" cx="' + inlayX + '" cy="' +
                    (inlayY - 9) + '" r="3.2"/>');
                out.push('<circle class="neck-inlay" cx="' + inlayX + '" cy="' +
                    (inlayY + 9) + '" r="3.2"/>');
            } else {
                out.push('<circle class="neck-inlay" cx="' + inlayX + '" cy="' +
                    inlayY + '" r="3.2"/>');
            }
        });

        // Strings and labels.
        for (var string = 0; string < num; string++) {
            var y = rowY(stringRow(string));
            out.push('<line class="neck-string" x1="' + nutX + '" y1="' + y +
                '" x2="' + (nutX + frets * fw) + '" y2="' + y + '"/>');
            out.push('<text class="neck-string-label" x="' + (left - 12) +
                '" y="' + (y + 0.5) + '">' + instrument.strings[string] + '</text>');
        }

        out.push('<line class="neck-nut" x1="' + nutX + '" y1="' + (boardTop + 4) +
            '" x2="' + nutX + '" y2="' + (boardBottom - 4) + '"/>');

        // Faint scale layer.
        if (prefs.scaleOn) {
            for (var scaleString = 0; scaleString < num; scaleString++) {
                for (var scaleFret = 0; scaleFret <= frets; scaleFret++) {
                    var scalePitch = pitchAt(scaleString, scaleFret);
                    if (!scales[scalePitch.pc]) continue;
                    out.push('<circle class="neck-note-scale" cx="' + xFret(scaleFret) +
                        '" cy="' + rowY(stringRow(scaleString)) + '" r="' +
                        (scaleFret === 0 ? 4 : 3.5) + '"/>');
                }
            }
        }

        // Notes: shape notes first, then the rest of the chord tones.
        var markers = buildMarkers(shapes, tones, mode, num, frets);
        Object.keys(markers).forEach(function (key) {
            out.push(markerSVG(markers[key], geometry, tones));
        });

        // A single shape shows its muted strings; CAGED would be too noisy.
        if (mode !== 'caged' && mode !== 'all' && shapes.length) {
            var selected = shapes[0];
            for (var mutedString = 0; mutedString < num; mutedString++) {
                if (selected.frets[mutedString] !== -1) continue;
                out.push('<text class="neck-muted" x="' + xOpen + '" y="' +
                    rowY(stringRow(mutedString)) + '">\u00d7</text>');
            }
        }

        // Fret numbers below the board.
        for (var number = 1; number <= frets; number++) {
            out.push('<text class="neck-fret-num" x="' + xFret(number) +
                '" y="' + fretNumY + '">' + number + '</text>');
        }

        // Shape pills under the fret numbers; clicking one isolates that shape.
        var pillRows = [];
        shapes.forEach(function (shape) {
            var center = (xFret(shape.minFret) + xFret(shape.maxFret)) / 2;
            var row = 0;
            while (pillRows[row] != null && center - pillRows[row] < 30) row++;
            pillRows[row] = center;
            var color = CAGED_COLORS[shape.letter];
            var pillY = pillBaseY + row * 22;
            out.push('<g class="neck-shape-pill" data-shape="' + shape.letter +
                '" tabindex="0" role="button" aria-label="Select ' + shape.letter +
                ' shape">' +
                '<rect x="' + (center - 12) + '" y="' + (pillY - 10) +
                '" width="24" height="20" rx="10" fill="' + color + '"/>' +
                '<text x="' + center + '" y="' + (pillY + 0.5) + '">' +
                shape.letter + '</text></g>');
        });

        out.push('</svg>');
        return out.join('');
    }

    /* A CAGED region should read as one soft island around the notes of that
     * shape. Grow the note cluster by a disc: sample a ring around every
     * note and take the convex hull, which is the true rounded outline of the
     * cluster. Miter-offsetting the hull instead would spike at the sharp
     * corners where neighbouring strings sit close together. */
    function regionPath(shape, geometry) {
        var num = geometry.num;
        var points = [];
        for (var string = 0; string < num; string++) {
            var fret = shape.frets[string];
            if (fret < 0) continue;
            points.push({
                x: geometry.xFret(fret),
                y: geometry.rowY(geometry.stringRow(string))
            });
        }
        if (points.length < 2) return '';

        var pad = geometry.noteR + 8;
        var steps = 48;
        var ring = [];
        points.forEach(function (point) {
            for (var i = 0; i < steps; i++) {
                var angle = (i / steps) * Math.PI * 2;
                ring.push({
                    x: point.x + Math.cos(angle) * pad,
                    y: point.y + Math.sin(angle) * pad
                });
            }
        });

        var hull = convexHull(ring);
        if (hull.length < 3) return '';
        return roundedPolygonPath(hull, pad * 0.5);
    }

    /* Andrew's monotone chain. Collinear points are dropped so the hull is a
     * clean convex outline (counter-clockwise in SVG coordinates). */
    function convexHull(points) {
        var sorted = points.slice().sort(function (a, b) {
            return a.x === b.x ? a.y - b.y : a.x - b.x;
        });

        function cross(o, a, b) {
            return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        }

        var lower = [];
        sorted.forEach(function (point) {
            while (lower.length >= 2 &&
                   cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
                lower.pop();
            }
            lower.push(point);
        });

        var upper = [];
        for (var i = sorted.length - 1; i >= 0; i--) {
            var point = sorted[i];
            while (upper.length >= 2 &&
                   cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
                upper.pop();
            }
            upper.push(point);
        }

        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }

    /* Draw a closed polygon with softly rounded corners while keeping the
     * straight edges, so the island keeps the size we gave it. */
    function roundedPolygonPath(points, radius) {
        var n = points.length;
        if (n < 3) return '';

        function unit(a, b) {
            var dx = b.x - a.x;
            var dy = b.y - a.y;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            return { x: dx / len, y: dy / len, len: len };
        }

        var d = '';
        for (var i = 0; i < n; i++) {
            var prev = points[(i + n - 1) % n];
            var cur = points[i];
            var next = points[(i + 1) % n];
            var inDir = unit(prev, cur);
            var outDir = unit(cur, next);
            var start = {
                x: cur.x - inDir.x * Math.min(radius, inDir.len / 2),
                y: cur.y - inDir.y * Math.min(radius, inDir.len / 2)
            };
            var end = {
                x: cur.x + outDir.x * Math.min(radius, outDir.len / 2),
                y: cur.y + outDir.y * Math.min(radius, outDir.len / 2)
            };
            d += (i === 0 ? 'M' : ' L') + round(start.x) + ' ' + round(start.y) +
                ' Q' + round(cur.x) + ' ' + round(cur.y) + ' ' +
                round(end.x) + ' ' + round(end.y);
        }
        return d + ' Z';
    }

    function round(value) {
        return Math.round(value * 10) / 10;
    }

    function buildMarkers(shapes, tones, mode, num, frets) {
        var markers = {};
        function keyOf(string, fret) { return string + ':' + fret; }

        shapes.forEach(function (shape) {
            var fingers = fingerMap(shape.frets);
            for (var string = 0; string < num; string++) {
                var fret = shape.frets[string];
                if (fret < 0 || fret > frets) continue;
                var key = keyOf(string, fret);
                if (markers[key]) continue;
                var pitch = pitchAt(string, fret);
                markers[key] = {
                    kind: 'shape',
                    string: string,
                    fret: fret,
                    pitch: pitch,
                    tone: tones[pitch.pc],
                    shape: shape,
                    finger: fingers[fret] || 0
                };
            }
        });

        if (mode === 'all') {
            for (var string = 0; string < num; string++) {
                for (var fret = 0; fret <= frets; fret++) {
                    var pitch = pitchAt(string, fret);
                    if (!tones[pitch.pc]) continue;
                    var key = keyOf(string, fret);
                    if (markers[key]) continue;
                    markers[key] = {
                        kind: 'tone',
                        string: string,
                        fret: fret,
                        pitch: pitch,
                        tone: tones[pitch.pc],
                        finger: 0
                    };
                }
            }
        } else {
            // Ghost chord tones outside the selected shapes keep the fretboard
            // readable without competing with the coloured shape notes. Open
            // strings are skipped because the string labels already name them.
            for (var ghostString = 0; ghostString < num; ghostString++) {
                for (var ghostFret = 1; ghostFret <= frets; ghostFret++) {
                    var ghostPitch = pitchAt(ghostString, ghostFret);
                    if (!tones[ghostPitch.pc]) continue;
                    var ghostKey = keyOf(ghostString, ghostFret);
                    if (markers[ghostKey]) continue;
                    markers[ghostKey] = {
                        kind: 'ghost',
                        string: ghostString,
                        fret: ghostFret,
                        pitch: ghostPitch,
                        tone: tones[ghostPitch.pc],
                        finger: 0
                    };
                }
            }
        }
        return markers;
    }

    function labelFor(pitch, tone, tones) {
        if (prefs.labelMode === 'none') return '';
        if (prefs.labelMode === 'degrees') {
            return tone ? degreeMark(tone.degree) : '';
        }
        var name = noteName(pitch.pc, tones);
        return name + (prefs.octaves ? octave(pitch.midi) : '');
    }

    function markerSVG(marker, geometry, tones) {
        var x = geometry.xFret(marker.fret);
        var y = geometry.rowY(geometry.stringRow(marker.string));
        var r = geometry.noteR;
        var out = '';

        if (marker.kind === 'shape') {
            var color = CAGED_COLORS[marker.shape.letter];
            if (marker.tone && marker.tone.degree === 'root') {
                out += '<circle class="neck-note-ring" cx="' + x + '" cy="' + y +
                    '" r="' + (r + 3) + '"/>';
            }
            out += '<circle class="neck-note neck-note-shape" cx="' + x + '" cy="' + y +
                '" r="' + r + '" fill="' + color + '"/>';
            var label = labelFor(marker.pitch, marker.tone, tones);
            if (label) {
                out += '<text class="neck-note-text neck-note-text-shape" x="' + x +
                    '" y="' + (y + 0.5) + '">' + label + '</text>';
            }
            if (prefs.fingers && marker.finger) {
                var bx = x + r * 0.82;
                var by = y - r * 0.82;
                out += '<circle class="neck-badge" cx="' + bx + '" cy="' + by +
                    '" r="5.6"/>';
                out += '<text class="neck-badge-text" x="' + bx + '" y="' + (by + 0.5) +
                    '">' + marker.finger + '</text>';
            }
            return out;
        }

        if (marker.kind === 'tone') {
            out += '<circle class="neck-note neck-note-tone" cx="' + x + '" cy="' + y +
                '" r="' + (r - 2) + '"/>';
            var toneLabel = labelFor(marker.pitch, marker.tone, tones);
            if (toneLabel) {
                out += '<text class="neck-note-text neck-note-text-tone" x="' + x +
                    '" y="' + (y + 0.5) + '">' + toneLabel + '</text>';
            }
            return out;
        }

        // Ghost notes are small map markers. Open strings keep their name so
        // the fretboard still reads like a chord chart.
        var ghostR = marker.fret === 0 ? 10 : 3.6;
        out += '<circle class="neck-note-ghost' + (marker.fret === 0 ? ' is-open' : '') +
            '" cx="' + x + '" cy="' + y + '" r="' + ghostR + '"/>';
        if (marker.fret === 0) {
            var ghostLabel = labelFor(marker.pitch, marker.tone, tones);
            if (ghostLabel) {
                out += '<text class="neck-note-text neck-note-text-ghost" x="' + x +
                    '" y="' + (y + 0.5) + '">' + ghostLabel + '</text>';
            }
        }
        return out;
    }

    /* ---------------- shape notes ---------------- */

    function renderShapeNotes() {
        var host = SB.$('neckShapeNotes');
        var count = SB.$('neckNotesCount');
        var shapeCount = SB.$('neckShapeCount');
        var allShapes = cagedShapes();
        var active = activeShapes(allShapes);
        var mode = effectiveShapeMode();

        var sources = [];
        if (mode === 'all' || !active.length) {
            var voicing = currentVoicing();
            if (voicing) sources.push({ label: chordName(), frets: voicing });
            shapeCount.textContent = 'Default voicing';
        } else {
            active.forEach(function (shape) {
                sources.push({ label: shape.letter + ' shape', frets: shape.frets });
            });
            shapeCount.textContent = active.length +
                (active.length === 1 ? ' shape' : ' shapes');
        }

        var tones = chordMap();
        var notes = [];
        var seen = {};
        sources.forEach(function (source) {
            for (var string = 0; string < source.frets.length; string++) {
                var fret = source.frets[string];
                if (fret < 0) continue;
                var key = string + ':' + fret;
                if (seen[key]) continue;
                seen[key] = true;
                var pitch = pitchAt(string, fret);
                var tone = tones[pitch.pc];
                notes.push({
                    stringIndex: string,
                    fret: fret,
                    midi: pitch.midi,
                    name: noteName(pitch.pc, tones),
                    octave: octave(pitch.midi),
                    degree: tone ? tone.degree : null,
                    role: tone ? (DEGREE_LABELS[tone.degree] || tone.degree) : 'Chord tone',
                    shape: source.label
                });
            }
        });

        if (!notes.length) {
            host.innerHTML = '<p class="explorer-empty">No playable shape for this chord in the explorer range.</p>';
            count.textContent = '';
            return;
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

    function renderDiagram() {
        var host = SB.$('neckDiagram');
        var allShapes = cagedShapes();
        var shapes = activeShapes(allShapes);
        var tones = chordMap();
        var scales = prefs.scaleOn ? scaleMap() : {};
        var mode = effectiveShapeMode();

        host.innerHTML = horizontalNeck(shapes, tones, scales);

        var desc = chordName() + ', ' + (QUALITY_LABELS[exp().quality] || 'Major').toLowerCase();
        if (prefs.capo) desc += ', capo ' + prefs.capo;
        if (mode === 'caged') desc += ', CAGED shapes';
        else if (mode === 'all') desc += ', all chord tones';
        else desc += ', ' + mode + ' shape';
        desc += ', frets 1 to ' + prefs.frets;
        if (prefs.scaleOn) desc += ', ' + scaleInfo().summary;
        host.setAttribute('aria-label', 'Fretboard: ' + desc);
    }

    /* ---------------- render ---------------- */

    function render() {
        if (!SB.$('neckRoot')) return;
        renderHero();
        renderRoots();
        renderLabels();
        renderQualities();
        renderShapes();
        renderBass();
        renderFrets();
        renderOptions();
        renderDiagram();
        renderShapeNotes();
    }

    /* ---------------- wiring ---------------- */

    function setRoot(letter, acc) {
        var pc = (LETTER_PC[letter] + acc + 12) % 12;
        var spelling = acc < 0 ? 'flat' : 'sharp';
        var name = ChordKit.rootName(pc, spelling);
        // E#/Cb and friends would change the letter; keep the clicked letter
        // only when the spelling actually belongs to it.
        if (name.charAt(0) !== letter) {
            pc = LETTER_PC[letter];
            name = ChordKit.rootName(pc, 'sharp');
        }
        SB.applyExplorerSelection({ rootPc: pc, rootName: name, spelling: spelling });
    }

    function play(mode) {
        var frets = currentVoicing();
        if (!frets || !SB.playChord) return;
        SB.playChord(frets, inst().id, mode, prefs.capo);
    }

    function bindOnce() {
        var root = SB.$('neckRoot');
        if (!root || root.dataset.bound) return;
        root.dataset.bound = '1';

        root.addEventListener('click', function (event) {
            var button = event.target.closest('[data-root-letter]');
            if (!button) return;
            setRoot(button.getAttribute('data-root-letter'), parsedRoot().acc);
        });

        SB.$('neckAccidental').addEventListener('click', function (event) {
            var button = event.target.closest('[data-acc]');
            if (!button) return;
            setRoot(parsedRoot().letter, Number(button.getAttribute('data-acc')));
        });

        SB.$('neckLabels').addEventListener('click', function (event) {
            var button = event.target.closest('[data-label]');
            if (!button) return;
            prefs.labelMode = button.getAttribute('data-label');
            savePrefs();
            render();
        });

        SB.$('neckQualities').addEventListener('click', function (event) {
            var button = event.target.closest('[data-quality]');
            if (!button) return;
            SB.applyExplorerSelection({ quality: button.getAttribute('data-quality') });
        });

        SB.$('neckQuality').addEventListener('change', function () {
            if (!this.value) return;
            SB.applyExplorerSelection({ quality: this.value });
        });

        SB.$('neckShapes').addEventListener('click', function (event) {
            var button = event.target.closest('[data-shape-mode]');
            if (!button || button.disabled) return;
            prefs.shapeMode = button.getAttribute('data-shape-mode');
            savePrefs();
            render();
        });

        SB.$('neckBass').addEventListener('change', function () {
            prefs.bassDegree = this.value;
            savePrefs();
            render();
        });

        SB.$('neckFrets').addEventListener('click', function (event) {
            var button = event.target.closest('[data-frets]');
            if (!button) return;
            prefs.frets = Number(button.getAttribute('data-frets'));
            savePrefs();
            render();
        });

        SB.$('neckScaleToggle').addEventListener('click', function () {
            prefs.scaleOn = !prefs.scaleOn;
            savePrefs();
            render();
        });

        SB.$('neckFingers').addEventListener('click', function () {
            prefs.fingers = !prefs.fingers;
            savePrefs();
            render();
        });

        SB.$('neckOctaves').addEventListener('click', function () {
            prefs.octaves = !prefs.octaves;
            savePrefs();
            render();
        });

        SB.$('neckScaleRoot').addEventListener('change', function () {
            state.scaleRootPc = this.value === '' ? null : Number(this.value);
            render();
        });

        SB.$('neckScaleType').addEventListener('change', function () {
            state.scaleId = this.value;
            savePrefs();
            render();
        });

        SB.$('neckCapo').addEventListener('change', function () {
            prefs.capo = Number(this.value) || 0;
            savePrefs();
            render();
        });

        SB.$('neckStrum').addEventListener('click', function () { play('strum'); });
        SB.$('neckArpeggio').addEventListener('click', function () { play('arpeggio'); });

        var diagram = SB.$('neckDiagram');
        function pickShape(event) {
            var pill = event.target.closest('[data-shape]');
            if (!pill) return false;
            prefs.shapeMode = pill.getAttribute('data-shape');
            savePrefs();
            render();
            return true;
        }
        diagram.addEventListener('click', pickShape);
        diagram.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (pickShape(event)) event.preventDefault();
        });
    }

    SB.renderNeck = render;
    SB.neckPrefs = prefs;
    SB.neckState = state;
    SB.neckShapes = cagedShapes;
    SB.neckVoicing = currentVoicing;

    bindOnce();

})(window.SB = window.SB || {});
