/* Songbook — chord explorer
 * circle of fifths, chord types, voicing browser and reverse lookup
 *
 * Part of the window.SB namespace. The two standalone Chord Explorer apps
 * (ukulele and guitar) were folded into this view so the songbook is the one
 * place for both instruments. All voicing search, spelling and SVG drawing
 * comes from the shared ChordKit engine in chords.js.
 */
(function (SB) {
    'use strict';

    var MINOR_IDS = { m: 1, m7: 1, m6: 1, m9: 1, 'm7b5': 1 };

    var CIRCLE = [
        { maj: ['C'], min: ['Am'] },
        { maj: ['G'], min: ['Em'] },
        { maj: ['D'], min: ['Bm'] },
        { maj: ['A'], min: ['F\u266fm'] },
        { maj: ['E'], min: ['C\u266fm'] },
        { maj: ['B'], min: ['G\u266fm'] },
        { maj: ['F\u266f', 'G\u266d'], min: ['D\u266fm', 'E\u266dm'] },
        { maj: ['D\u266d'], min: ['B\u266dm'] },
        { maj: ['A\u266d'], min: ['Fm'] },
        { maj: ['E\u266d'], min: ['Cm'] },
        { maj: ['B\u266d'], min: ['Gm'] },
        { maj: ['F'], min: ['Dm'] }
    ];

    var CHIP_GROUPS = [
        { name: 'Major', ids: ['maj', 'maj7', '7', '6', '9', 'maj9', 'add9', 'aug'] },
        { name: 'Minor', ids: ['m', 'm7', 'm6', 'm9', 'm7b5', 'dim', 'dim7'] },
        { name: 'Suspended', ids: ['sus4', 'sus2', '7sus4'] }
    ];

    var state = {
        rootPc: 0,
        rootName: 'C',
        quality: 'maj',
        spelling: 'sharp'
    };

    var findValues = {
        ukulele: [0, 0, 0, 3],
        guitar: [-1, 3, 2, 0, 1, 0]
    };

    var circleKey = null;
    var finderKey = null;
    var chipsBuilt = false;
    var lastFind = null;

    function instrument() { return ChordKit.instrumentOf(SB.state.instrument); }
    function qualityType() { return ChordKit.typeOf(state.quality); }
    function isMinorQuality(id) { return !!MINOR_IDS[id || state.quality]; }

    function parsedRootName() { return state.rootName; }
    function wholeChordName() { return parsedRootName() + qualityType().suffix; }

    function pickName(names) {
        return names.length === 1 ? names[0] : (state.spelling === 'sharp' ? names[0] : names[1]);
    }

    var MAJOR_PCS = CIRCLE.map(function (entry) { return ChordKit.parse(entry.maj[0]).rootPc; });
    var MINOR_PCS = CIRCLE.map(function (entry) { return ChordKit.parse(entry.min[0]).rootPc; });

    /* ---------------- state changes ---------------- */

    function setRootFromCircle(name, minorRing) {
        var parsed = ChordKit.parse(name);
        if (!parsed) return;
        state.rootPc = parsed.rootPc;
        state.rootName = name.charAt(name.length - 1) === 'm' ? name.slice(0, -1) : name;
        if (name.indexOf('\u266d') >= 0) state.spelling = 'flat';
        else if (name.indexOf('\u266f') >= 0) state.spelling = 'sharp';

        // Keep a selected seventh/sixth type when the new ring family still
        // fits it; only swap between the plain major and minor triad.
        if (minorRing && !isMinorQuality()) state.quality = 'm';
        else if (!minorRing && isMinorQuality()) state.quality = 'maj';
    }

    function toggleSpelling() {
        state.spelling = state.spelling === 'sharp' ? 'flat' : 'sharp';
        state.rootName = ChordKit.rootName(state.rootPc, state.spelling);
    }

    function applyFind(candidate) {
        state.rootPc = candidate.rootPc;
        state.rootName = ChordKit.rootName(candidate.rootPc, state.spelling);
        state.quality = candidate.type.id;
        renderAll();
        if (window.matchMedia('(max-width: 860px)').matches) {
            var main = document.querySelector('.explorer-main');
            if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /* ---------------- circle of fifths ---------------- */

    function polar(radius, degrees) {
        var angle = degrees * Math.PI / 180;
        return [200 + radius * Math.cos(angle), 200 + radius * Math.sin(angle)];
    }

    function fixed(n) { return n.toFixed(1); }

    function sector(inner, outer, start, end) {
        var p = polar(outer, start), q = polar(outer, end);
        var r = polar(inner, end), s = polar(inner, start);
        return 'M' + fixed(p[0]) + ' ' + fixed(p[1]) +
            'A' + outer + ' ' + outer + ' 0 0 1 ' + fixed(q[0]) + ' ' + fixed(q[1]) +
            'L' + fixed(r[0]) + ' ' + fixed(r[1]) +
            'A' + inner + ' ' + inner + ' 0 0 0 ' + fixed(s[0]) + ' ' + fixed(s[1]) + 'Z';
    }

    function buildCircle() {
        var svg = '<svg viewBox="0 0 400 400" role="group" aria-label="Circle of fifths">';
        CIRCLE.forEach(function (entry, i) {
            var a1 = -105 + i * 30, a2 = a1 + 30, mid = a1 + 15;
            var majName = pickName(entry.maj);
            var minName = pickName(entry.min);
            var outer = polar(159, mid), inner = polar(103, mid);
            svg += '<g data-kind="maj" data-i="' + i + '" tabindex="0" role="button"' +
                ' aria-pressed="false" aria-label="' + majName + ' major">' +
                '<path class="cx-wg cx-wmaj" d="' + sector(132, 186, a1, a2) + '"/>' +
                '<text class="cx-lbl-o" x="' + fixed(outer[0]) + '" y="' + fixed(outer[1]) +
                '" dominant-baseline="middle" text-anchor="middle">' + majName + '</text></g>';
            svg += '<g data-kind="min" data-i="' + i + '" tabindex="0" role="button"' +
                ' aria-pressed="false" aria-label="' + minName + ' minor">' +
                '<path class="cx-wg cx-wmin" d="' + sector(76, 130, a1, a2) + '"/>' +
                '<text class="cx-lbl-i" x="' + fixed(inner[0]) + '" y="' + fixed(inner[1]) +
                '" dominant-baseline="middle" text-anchor="middle">' + minName + '</text></g>';
        });
        svg += '<circle class="cx-ctr" cx="200" cy="200" r="74"/>' +
            '<text class="cx-ctr-name" id="explorerCircleName" x="200" y="196"></text>' +
            '<text class="cx-ctr-notes" id="explorerCircleNotes" x="200" y="221"></text></svg>';

        document.getElementById('explorerCircle').innerHTML =
            svg +
            '<div class="explorer-hint-row"><span>Outer ring: major · inner ring: relative minor</span>' +
            '<button id="explorerSpellInline" class="explorer-acc" type="button"></button></div>';
    }

    function ensureCircle() {
        var key = state.spelling;
        if (circleKey !== key) {
            buildCircle();
            circleKey = key;
        }
    }

    function updateCircleSelection() {
        var minor = isMinorQuality();
        var index = (minor ? MINOR_PCS : MAJOR_PCS).indexOf(state.rootPc);
        var kind = minor ? 'min' : 'maj';
        var nodes = document.querySelectorAll('#explorerCircle [data-kind]');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var on = node.getAttribute('data-kind') === kind &&
                Number(node.getAttribute('data-i')) === index;
            node.classList.toggle('sel', on);
            node.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    /* ---------------- reverse lookup controls ---------------- */

    function valuesFor(inst) {
        if (!findValues[inst.id] || findValues[inst.id].length !== inst.tuning.length) {
            findValues[inst.id] = inst.tuning.map(function () { return 0; });
        }
        return findValues[inst.id];
    }

    function ensureFinder() {
        var inst = instrument();
        if (finderKey === inst.id) return;
        finderKey = inst.id;
        var values = valuesFor(inst);
        var html = inst.strings.map(function (letter, i) {
            var options = ['<option value="-1"' + (values[i] === -1 ? ' selected' : '') + '>×</option>'];
            for (var fret = 0; fret <= inst.maxFret; fret++) {
                options.push('<option value="' + fret + '"' +
                    (values[i] === fret ? ' selected' : '') + '>' + fret + '</option>');
            }
            return '<label class="explorer-fstr"><span>' + letter + '</span>' +
                '<select class="explorer-fsel" aria-label="' + letter +
                ' string fret">' + options.join('') + '</select></label>';
        }).join('');
        var host = document.getElementById('explorerFindStrings');
        host.innerHTML = html;
        var selects = host.querySelectorAll('select');
        Array.prototype.forEach.call(selects, function (select, i) {
            select.addEventListener('change', function () {
                values[i] = Number(select.value);
                renderFindResult();
            });
        });
    }

    function renderFindResult() {
        var inst = instrument();
        var values = valuesFor(inst);
        var out = document.getElementById('explorerFindOut');
        var candidates = ChordKit.identify(values.slice(0, inst.tuning.length), inst.id);
        if (!candidates.length) {
            lastFind = null;
            out.innerHTML = '<span class="explorer-find-none">No matching chord</span>';
            return;
        }
        lastFind = candidates[0];
        var name = ChordKit.rootName(lastFind.rootPc, state.spelling) + lastFind.type.suffix;
        out.innerHTML = '<div class="explorer-find-hit">' +
            '<button class="explorer-find-name" type="button">' + name + '</button>' +
            '<span class="explorer-find-hint">tap to load it below</span></div>';
        var button = out.querySelector('.explorer-find-name');
        if (button) {
            button.addEventListener('click', function () { applyFind(lastFind); });
        }
    }

    /* ---------------- main panel ---------------- */

    function renderCenter() {
        var name = document.getElementById('explorerChordName');
        var notes = ChordKit.chordNotes(wholeChordName());
        name.innerHTML = '<span class="explorer-root">' + state.rootName + '</span>' +
            qualityType().suffix;
        document.getElementById('explorerChordNotes').textContent =
            notes.map(function (note) { return note.name; }).join(' · ');

        var circleName = document.getElementById('explorerCircleName');
        var circleNotes = document.getElementById('explorerCircleNotes');
        if (circleName) circleName.innerHTML = '<tspan class="explorer-root">' + state.rootName +
            '</tspan>' + qualityType().suffix;
        if (circleNotes) {
            circleNotes.textContent = notes.map(function (note) { return note.name; }).join(' · ');
        }
    }

    function renderSpellingButton() {
        var sharp = ChordKit.rootName(state.rootPc, 'sharp');
        var flat = ChordKit.rootName(state.rootPc, 'flat');
        var buttons = [
            document.getElementById('explorerSpelling'),
            document.getElementById('explorerSpellInline')
        ];
        buttons.forEach(function (button) {
            if (!button) return;
            if (sharp === flat) {
                button.hidden = true;
                return;
            }
            button.hidden = false;
            button.textContent = 'Spell as ' + (state.spelling === 'sharp' ? flat : sharp);
            button.setAttribute('aria-label',
                'Spell the root as ' + (state.spelling === 'sharp' ? flat : sharp));
        });
    }

    function renderTones() {
        var notes = ChordKit.chordNotes(wholeChordName());
        document.getElementById('explorerNotes').innerHTML = notes.map(function (note) {
            return '<div class="explorer-note' + (note.degree === 'root' ? ' root' : '') + '">' +
                '<b>' + note.name + '</b><span>' + note.degree + '</span></div>';
        }).join('');
    }

    function buildChips() {
        if (chipsBuilt) return;
        chipsBuilt = true;
        document.getElementById('explorerChips').innerHTML = CHIP_GROUPS.map(function (group) {
            return '<div class="explorer-chip-group">' +
                '<div class="explorer-chip-label">' + group.name + '</div>' +
                '<div class="explorer-chip-row">' +
                group.ids.map(function (id) {
                    var type = ChordKit.typeOf(id);
                    return '<button class="explorer-chip" type="button" data-quality="' + id +
                        '">' + (type.label || type.suffix || 'major') + '</button>';
                }).join('') +
                '</div></div>';
        }).join('');
    }

    function renderChips() {
        buildChips();
        var chips = document.querySelectorAll('#explorerChips .explorer-chip');
        for (var i = 0; i < chips.length; i++) {
            chips[i].classList.toggle('active',
                chips[i].getAttribute('data-quality') === state.quality);
        }
    }

    function renderShapes() {
        var inst = instrument();
        var chordName = wholeChordName();
        var shapes = ChordKit.voicings(chordName, inst.id);
        var hard = ChordKit.chordDifficulty(chordName) === 'hard';

        var title = document.getElementById('explorerShapesTitle');
        title.innerHTML = 'Ways to play <span class="explorer-shapes-name">' + chordName + '</span>' +
            (hard ? '<span class="explorer-hard-tag" title="Barre-heavy chord — the second shape may be an easier muted voicing">hard</span>' : '');

        document.getElementById('explorerShapesCount').textContent =
            shapes.length + ' ' + (shapes.length === 1 ? 'way' : 'ways') +
            ' · ' + inst.label.toLowerCase();

        var host = document.getElementById('explorerShapes');
        if (!shapes.length) {
            host.innerHTML = '<p class="explorer-empty">No playable voicing found below the ' +
                (inst.maxFret + 1) + 'th fret.</p>';
            return;
        }

        host.innerHTML = shapes.map(function (frets, index) {
            var easy = hard && index === 1 && frets.indexOf(-1) >= 0;
            var fretsLabel = frets.map(function (fret) {
                return fret < 0 ? 'muted' : fret;
            }).join(' ');
            return '<div class="explorer-shape' + (easy ? ' easy' : '') + '"' +
                ' role="img" aria-label="' + chordName + ' voicing: ' + fretsLabel + '"' +
                ' style="animation-delay:' + Math.min(index * 25, 350) + 'ms">' +
                '<div class="explorer-diagram">' + ChordKit.diagramSVG(inst.id, frets) + '</div>' +
                '<div class="explorer-frets">' + ChordKit.fretLabelsSVG(inst.id, frets) + '</div>' +
                (easy ? '<span class="explorer-easy">easy</span>' : '') +
                '</div>';
        }).join('');
    }

    function renderInstrument() {
        var label = instrument().label;
        document.getElementById('explorerInstrumentName').textContent = label.toLowerCase();
    }

    function renderAll() {
        ensureCircle();
        ensureFinder();
        updateCircleSelection();
        renderCenter();
        renderSpellingButton();
        renderTones();
        renderChips();
        renderShapes();
        renderFindResult();
        renderInstrument();
    }

    /* ---------------- wiring ---------------- */

    function pickCircleGroup(group) {
        var entry = CIRCLE[Number(group.getAttribute('data-i'))];
        if (!entry) return;
        var minor = group.getAttribute('data-kind') === 'min';
        setRootFromCircle(pickName(minor ? entry.min : entry.maj), minor);
        renderAll();
    }

    function bindOnce() {
        var circle = document.getElementById('explorerCircle');
        circle.addEventListener('click', function (event) {
            var group = event.target.closest('[data-kind]');
            if (group) pickCircleGroup(group);
        });
        circle.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            var group = event.target.closest('[data-kind]');
            if (!group) return;
            event.preventDefault();
            pickCircleGroup(group);
        });

        document.getElementById('explorerChips').addEventListener('click', function (event) {
            var chip = event.target.closest('.explorer-chip');
            if (!chip) return;
            state.quality = chip.getAttribute('data-quality');
            renderAll();
        });

        document.getElementById('explorerSpelling').addEventListener('click', function () {
            toggleSpelling();
            renderAll();
        });

        // The inline copy lives inside the rebuilt circle markup, so a fresh
        // listener is attached after every rebuild.
        circle.addEventListener('click', function (event) {
            if (event.target.id !== 'explorerSpellInline') return;
            toggleSpelling();
            renderAll();
        });

        SB.renderExplorer = renderAll;
    }

    SB.explorerVisible = function () {
        var view = document.getElementById('explorerView');
        return !!view && !view.hidden;
    };

    SB.explorerState = state;

    SB.openExplorer = function () {
        if (SB.closeVoicingChooser) SB.closeVoicingChooser();
        if (SB.resetScroll) SB.resetScroll(true);
        if (SB.stopMetronome) SB.stopMetronome();
        SB.state.currentSong = null;
        document.getElementById('listView').hidden = true;
        document.getElementById('songView').hidden = true;
        document.getElementById('explorerView').hidden = false;
        var link = document.getElementById('explorerLink');
        if (link) link.setAttribute('aria-current', 'page');
        renderAll();
        window.scrollTo(0, 0);
    };

    bindOnce();

})(window.SB = window.SB || {});