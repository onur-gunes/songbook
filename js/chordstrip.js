/* Songbook — chordstrip
 * the sticky chord strip and the voicing chooser
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- chord strip (ChordKit) ---------------- */

    // The number is computed from the untransposed chord and tonic so it stays
    // put as the user transposes. songTonic/tokenDegree live in js/transpose.js
    // so the sheet renderers share them.
    //
    // The strip is the one place that shows the name AND the numeral together:
    // it lists each chord once (~7 per song), so it stays the decoder ring
    // while the sheet substitutes numerals for names.
    function addChordDegree(item, name, song) {
        if (!SB.state.showNumbers) return;
        var deg = SB.tokenDegree(name, SB.songTonic(song));
        if (deg) item.appendChild(SB.el('span', 'cdeg', deg));
    }

    function pickKey(chordName) { return SB.NS + ':pick:' + SB.state.instrument + ':' + chordName; }

    function storedPick(chordName) {
        try {
            var s = window.localStorage.getItem(pickKey(chordName));
            if (!s) return null;
            var f = s.split(',').map(Number);
            var n = ChordKit.instrumentOf(SB.state.instrument).tuning.length;
            if (f.length === n && f.every(function (v) { return v >= -1 && v <= 12; })) return f;
        } catch (e) { /* ignore */ }
        return null;
    }
    function savePick(chordName, frets) {
        try { window.localStorage.setItem(pickKey(chordName), frets.join(',')); } catch (e) { /* ignore */ }
    }

    function voicingsFor(chordName) { return ChordKit.voicings(chordName, SB.state.instrument); }

    SB.chosenVoicing = function (chordName) {
        var list = voicingsFor(chordName);
        if (!list.length) return null;
        var pick = storedPick(chordName);
        if (pick) {
            var key = pick.join(',');
            for (var i = 0; i < list.length; i++) if (list[i].join(',') === key) return list[i];
        }
        return list[0];
    }

    SB.renderChordStrip = function (song) {
        var strip = SB.$('chordStrip');
        strip.textContent = '';
        (song.chords || []).forEach(function (name) {
            var tname = SB.transposeChartName(name, SB.state.transpose);
            var label = SB.displayChord(tname);
            if (ChordKit.isMutedName(tname)) {
                var citem = SB.el('div', 'chord-item chuck');
                var cimg = new Image();
                cimg.alt = 'Chuck – all strings muted';
                cimg.title = 'Chuck – mute all strings and strum';
                cimg.src = ChordKit.dataUri(SB.state.instrument, ChordKit.mutedVoicing(SB.state.instrument));
                citem.appendChild(SB.el('span', 'cname', 'Chuck'));
                citem.appendChild(cimg);
                strip.appendChild(citem);
                return;
            }
            var hard = ChordKit.chordDifficulty(tname) === 'hard';
            var item = SB.el('div', 'chord-item' + (hard ? ' hard' : ''));
            var list = voicingsFor(tname);
            if (list.length) {
                var v = SB.chosenVoicing(tname);
                var img = new Image();
                img.alt = label + ' chord diagram';
                img.title = label + (hard ? ' (hard chord – easy alternative in the picker)' : ' – click to choose voicing');
                img.src = ChordKit.dataUri(SB.state.instrument, v);
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.setAttribute('aria-label', label + ' chord diagram – choose voicing');
                var openSel = function (e) { e.preventDefault(); showVoicingChooser(strip, item, tname, label, img); };
                item.addEventListener('click', openSel);
                item.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSel(e); }
                });
                item.appendChild(SB.el('span', 'cname', label));
                addChordDegree(item, name, song);
                item.appendChild(img);
            } else {
                item.classList.add('no-diagram');
                item.appendChild(SB.el('span', 'cname', label));
                addChordDegree(item, name, song);
                item.appendChild(SB.el('span', 'missing', 'no diagram'));
            }
            strip.appendChild(item);
        });
    }

    var voicingEsc = null;

    SB.closeVoicingChooser = function () {
        var ov = document.getElementById('voicingChooser');
        if (ov) ov.remove();
        if (voicingEsc) { document.removeEventListener('keydown', voicingEsc); voicingEsc = null; }
    }

    function showVoicingChooser(strip, item, chordName, label, img) {
        SB.closeVoicingChooser();
        var shapes = voicingsFor(chordName);
        if (!shapes.length) return;
        var cur = SB.chosenVoicing(chordName);
        var curKey = cur ? cur.join(',') : '';
        var ov = SB.el('div', 'chooser-overlay');
        ov.id = 'voicingChooser';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-label', 'Choose voicing for ' + label);
        var box = SB.el('div', 'chooser');
        var head = SB.el('div', 'chooser-head');
        head.appendChild(SB.el('span', 'chooser-title', label + ' – choose a voicing (' + ChordKit.instrumentOf(SB.state.instrument).label + ')'));
        var closeBtn = SB.el('button', 'chooser-close');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', SB.closeVoicingChooser);
        head.appendChild(closeBtn);
        box.appendChild(head);
        var grid = SB.el('div', 'chooser-grid');
        var hard = ChordKit.chordDifficulty(chordName) === 'hard';
        shapes.slice(0, 60).forEach(function (f, i) {
            var opt = SB.el('button');
            opt.type = 'button';
            var easy = hard && i === 1;
            var fretsTxt = f.map(function (v) { return v < 0 ? 'x' : (v === 0 ? 'o' : v); }).join(' ');
            opt.title = 'Fretting ' + fretsTxt + (easy ? ' – easy alternative' : '');
            if (easy) opt.classList.add('easy');
            if (f.join(',') === curKey) opt.classList.add('sel');
            var oi = new Image();
            oi.alt = '';
            oi.src = ChordKit.dataUri(SB.state.instrument, f);
            opt.appendChild(oi);
            opt.appendChild(SB.el('span', 'choosing-frets', fretsTxt));
            opt.addEventListener('click', function () {
                savePick(chordName, f);
                img.src = ChordKit.dataUri(SB.state.instrument, f);
                SB.closeVoicingChooser();
                // The grid draws the same stored pick; without this it would
                // keep showing the old shape until the next render.
                if (SB.state.chordMode === 'grid' && SB.state.currentSong) {
                    SB.renderSheet(SB.state.currentSong);
                }
            });
            grid.appendChild(opt);
        });
        box.appendChild(grid);
        ov.appendChild(box);
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) SB.closeVoicingChooser(); });
        voicingEsc = function (e) { if (e.key === 'Escape') SB.closeVoicingChooser(); };
        document.addEventListener('keydown', voicingEsc);
        document.body.appendChild(ov);
    }

})(window.SB = window.SB || {});
