/* Songbook — grid
 * play-along chord chart: bars, beat slashes, diagrams and a beat cursor
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- layout constants ----------------
     *
     * A grid bar is a fixed-cell version of the chords-above layout: every
     * beat is a column, and the chord change at the start of a run of beats
     * carries a diagram and a label. The columns have to be measured before
     * they are placed, because a diagram is wider than a beat slash and a
     * degree label is set in the mono face (see chordLabelWidth in
     * js/sheet.js). Nothing here is guessed from character counts.
     */
    var BEAT_MIN = 24;          // px, before the sheet's text-size scale
    var DIAGRAM_H = 78;         // px at --chord-size: 1, same as the strip
    var DIAGRAM_W_UKE = 72;     // reserved box, not the SVG's natural width
    var DIAGRAM_W_GUITAR = 108;
    var BAR_PAD = 6;            // px inside each bar line
    var REPEAT_W = 12;

    var activeGrid = null;      // { song, beatsPerBar, totalBeats, bpm, ... }
    var cursorRaf = null;
    var lastBeat = -1;
    var lastSystem = null;

    /* ---------------- helpers ---------------- */

    function hasGrid(song) {
        return !!(song && song.grid && song.grid.length);
    }
    SB.songHasGrid = hasGrid;

    function isMuted(name) {
        return ChordKit.isMutedName(name);
    }

    /* The label the chart shows for a chord. Degrees REPLACE names, exactly
     * as in the two sheet renderers, and are computed from the untransposed
     * token so they do not move when the user transposes. */
    function gridLabel(song, chord) {
        var tname = SB.transposeChartName(chord, SB.state.transpose);
        if (SB.state.showNumbers) {
            var deg = SB.tokenDegree(chord, SB.songTonic(song));
            if (deg) return deg;
        }
        return isMuted(tname) ? 'Chuck' : SB.displayChord(tname);
    }

    function diagramBox(chordSize) {
        var strings = ChordKit.instrumentOf(SB.state.instrument).tuning.length;
        return {
            w: (strings === 6 ? DIAGRAM_W_GUITAR : DIAGRAM_W_UKE) * chordSize,
            h: DIAGRAM_H * chordSize
        };
    }

    /* ---------------- cursor ---------------- */

    function clearActive() {
        if (lastBeat >= 0 && activeGrid && activeGrid.beatEls[lastBeat]) {
            activeGrid.beatEls[lastBeat].classList.remove('on');
        }
        lastBeat = -1;
        if (activeGrid && activeGrid.wrap) {
            delete activeGrid.wrap.dataset.activeBeat;
        }
    }

    function resetCursor() {
        if (cursorRaf !== null) { cancelAnimationFrame(cursorRaf); cursorRaf = null; }
        clearActive();
        lastSystem = null;
        if (activeGrid && activeGrid.wrap) {
            activeGrid.phase = 'idle';
            activeGrid.wrap.dataset.gridPhase = 'idle';
        }
    }

    /* Called when the sheet is about to render something that is not a grid,
     * or when a no-grid song falls back to the normal sheet. Keeps the last
     * grid from answering metronome queries while it is off screen. */
    SB.gridDeactivate = function () {
        resetCursor();
        activeGrid = null;
        var wrap = SB.$('sheet');
        if (wrap) {
            wrap.classList.remove('chords-grid');
            delete wrap.dataset.gridPhase;
            delete wrap.dataset.activeBeat;
        }
    };

    SB.gridReset = resetCursor;

    function scrollSystemIntoView(el) {
        if (!el) return;
        var system = el.closest ? el.closest('.grid-system') : null;
        if (!system || system === lastSystem) return;
        lastSystem = system;
        var r = system.getBoundingClientRect();
        var topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
        var visibleTop = topbar + 8;
        var visibleBottom = window.innerHeight - 24;
        if (r.top >= visibleTop && r.bottom <= visibleBottom) return;
        var target = r.top - Math.max(visibleTop, (window.innerHeight - r.height) / 2);
        window.scrollBy({ top: target, behavior: 'smooth' });
    }

    function setActive(idx) {
        if (!activeGrid || !activeGrid.beatEls[idx]) return;
        if (lastBeat >= 0 && activeGrid.beatEls[lastBeat]) {
            activeGrid.beatEls[lastBeat].classList.remove('on');
        }
        activeGrid.beatEls[idx].classList.add('on');
        lastBeat = idx;
        activeGrid.wrap.dataset.activeBeat = String(idx);
        // The continuous auto-scroll already follows the music. Nudging here
        // too would fight it, so only step in when the transport is manual.
        if (!SB.state.scrollState.playing) scrollSystemIntoView(activeGrid.beatEls[idx]);
    }

    /* One repaint loop, driven by the metronome's audio clock. rAF is only a
     * repaint cadence; the beat is always recomputed from
     * SB.metronomePosition(), so a dropped frame cannot make the cursor drift
     * away from the clicks (the same rule the strum row follows). */
    function cursorFrame() {
        cursorRaf = null;
        if (!activeGrid || SB.state.chordMode !== 'grid') return;
        var pos = SB.metronomePosition();
        if (pos === null) { clearActive(); return; }

        var chartBeats = pos - activeGrid.beatsPerBar; // one bar of count-in
        if (chartBeats < 0) {
            clearActive();
            if (activeGrid.phase !== 'countin') {
                activeGrid.phase = 'countin';
                activeGrid.wrap.dataset.gridPhase = 'countin';
            }
            cursorRaf = requestAnimationFrame(cursorFrame);
            return;
        }

        var idx = Math.floor(chartBeats);
        if (idx >= activeGrid.totalBeats) {
            clearActive();
            activeGrid.phase = 'done';
            activeGrid.wrap.dataset.gridPhase = 'done';
            return;
        }

        if (activeGrid.phase !== 'playing') {
            activeGrid.phase = 'playing';
            activeGrid.wrap.dataset.gridPhase = 'playing';
        }
        if (idx !== lastBeat) setActive(idx);
        cursorRaf = requestAnimationFrame(cursorFrame);
    }

    SB.gridOnMetronomeStart = function () {
        if (!activeGrid || SB.state.chordMode !== 'grid') return;
        if (cursorRaf === null) cursorRaf = requestAnimationFrame(cursorFrame);
    };

    SB.gridOnMetronomeStop = resetCursor;

    /* Pure beat mapping, exposed for the suite. -1 is the count-in, null is
     * past the end of the chart. */
    SB.gridBeatAt = function (pos) {
        if (!activeGrid || typeof pos !== 'number' || !isFinite(pos)) return null;
        var chart = pos - activeGrid.beatsPerBar;
        if (chart < 0) return -1;
        if (chart >= activeGrid.totalBeats) return null;
        return Math.floor(chart);
    };

    SB.gridInfo = function () {
        if (!activeGrid) return null;
        return {
            totalBeats: activeGrid.totalBeats,
            beatsPerBar: activeGrid.beatsPerBar,
            bpm: SB.state.metronome.bpm || activeGrid.bpm,
            phase: activeGrid.phase,
            activeBeat: lastBeat
        };
    };

    /* ---------------- transport helpers ---------------- */

    /* Whole-chart duration in ms, from the grid's own beat count and tempo.
     * This replaces the dur-based estimate (and its above-mode fudge) when a
     * grid is on screen. Includes the count-in bar so the scroll and the
     * clicks start together. */
    SB.gridDurationMs = function () {
        if (!activeGrid) return null;
        var bpm = SB.state.metronome.bpm || activeGrid.bpm;
        if (!bpm) return null;
        return (activeGrid.totalBeats + activeGrid.beatsPerBar) * 60000 / bpm;
    };

    /* How long the chart has left, read from the metronome's audio clock.
     * -1 means "count-in, do not move yet"; null means there is no live
     * metronome clock, so auto-scroll falls back to its duration estimate. */
    SB.gridScrollRemainingMs = function () {
        if (!activeGrid || SB.state.chordMode !== 'grid') return null;
        var bpm = SB.state.metronome.bpm || activeGrid.bpm;
        if (!bpm) return null;
        var pos = SB.metronomePosition();
        if (pos === null) return null;
        var chart = pos - activeGrid.beatsPerBar;
        if (chart < 0) return -1;
        var left = Math.max(0, activeGrid.totalBeats - chart);
        return left * 60000 / bpm / Math.max(0.2, SB.state.scrollSpeed);
    };

    /* ---------------- rendering ---------------- */

    function packBars(bars, avail) {
        var systems = [], cur = [], width = 0;
        bars.forEach(function (bar) {
            if (cur.length && width + bar.width > avail) {
                systems.push(cur);
                cur = [];
                width = 0;
            }
            cur.push(bar);
            width += bar.width;
        });
        if (cur.length) systems.push(cur);
        return systems;
    }

    function repeatSign(kind, height) {
        var s = SB.el('span', 'grid-repeat ' + kind);
        s.style.height = height + 'px';
        s.setAttribute('aria-hidden', 'true');
        return s;
    }

    function buildBarSpec(bar, song, ctx) {
        var segments = bar.beats.map(function (seg) {
            var tname = SB.transposeChartName(seg.chord, SB.state.transpose);
            var label = gridLabel(song, seg.chord);
            var labelW = SB.chordLabelWidth(label);
            var contentW = Math.max(labelW, ctx.diagram.w);
            var voicing = isMuted(tname)
                ? ChordKit.mutedVoicing(SB.state.instrument)
                : SB.chosenVoicing(tname);
            return {
                chord: seg.chord,
                tname: tname,
                label: label,
                beats: seg.beats,
                width: Math.max(seg.beats * ctx.beatW, contentW + ctx.gap),
                contentW: contentW,
                voicing: voicing
            };
        });

        var x = BAR_PAD, beatXs = [], changeXs = [];
        segments.forEach(function (seg) {
            changeXs.push(x);
            for (var i = 0; i < seg.beats; i++) {
                beatXs.push(x + seg.width * (i + 0.5) / seg.beats);
            }
            x += seg.width;
        });

        return {
            segments: segments,
            beatXs: beatXs,
            changeXs: changeXs,
            width: x + BAR_PAD
        };
    }

    function buildBarEl(spec, ctx) {
        var bar = SB.el('div', 'grid-bar');
        bar.style.width = spec.width + 'px';
        bar.style.height = ctx.barH + 'px';

        spec.segments.forEach(function (seg, i) {
            var change = SB.el('div', 'grid-change');
            change.style.left = spec.changeXs[i] + 'px';
            change.style.width = seg.contentW + 'px';
            change.style.height = (ctx.diagram.h + ctx.labelH) + 'px';
            change.style.bottom = ctx.changeBottom + 'px';
            change.setAttribute('data-chord', seg.tname);
            change.setAttribute('data-label', seg.label);

            if (seg.voicing) {
                var img = new Image();
                img.className = 'grid-diagram';
                img.alt = seg.label + ' chord diagram';
                img.title = seg.label;
                img.src = ChordKit.dataUri(SB.state.instrument, seg.voicing);
                img.style.width = ctx.diagram.w + 'px';
                img.style.height = ctx.diagram.h + 'px';
                change.appendChild(img);
            } else {
                var missing = SB.el('span', 'grid-missing', 'no diagram');
                missing.style.width = ctx.diagram.w + 'px';
                missing.style.height = ctx.diagram.h + 'px';
                change.appendChild(missing);
            }
            change.appendChild(SB.el('span', 'grid-chord', seg.label));
            bar.appendChild(change);
        });

        spec.beatXs.forEach(function (x) {
            var beat = SB.el('span', 'grid-beat', '/');
            beat.style.left = x + 'px';
            beat.setAttribute('aria-hidden', 'true');
            bar.appendChild(beat);
        });

        return bar;
    }

    function renderSheetGrid(song) {
        resetCursor();

        var wrap = SB.$('sheet');
        wrap.textContent = '';
        wrap.classList.remove('chords-above');
        wrap.classList.add('chords-grid');

        var em = SB.sheetEmPx();
        var ctx = {
            beatW: Math.max(BEAT_MIN, em * 1.7),
            labelH: Math.ceil(em * 1.35),
            beatH: Math.ceil(em * 1.7),
            gap: Math.max(6, em * 0.45),
            diagram: diagramBox(SB.state.chordSize)
        };
        ctx.changeBottom = ctx.beatH + 4;
        ctx.barH = ctx.changeBottom + ctx.diagram.h + ctx.labelH + 4;
        wrap.style.setProperty('--grid-beat-h', ctx.beatH + 'px');

        var avail = Math.max(ctx.beatW * 2, (wrap.clientWidth || window.innerWidth - 40) - 2);
        var beatsPerBar = SB.metronomeBeatsPerBar(song.time);
        var bpm = SB.state.metronome.bpm || song.bpm || null;
        var frag = document.createDocumentFragment();

        song.grid.forEach(function (block) {
            var specs = block.bars.map(function (bar) {
                return buildBarSpec(bar, song, ctx);
            });
            // Repeat signs are flex items too, so reserve their width before
            // packing or a repeated block overflows its system by 24px.
            var packAvail = Math.max(ctx.beatW * 2, avail - (block.repeat ? REPEAT_W * 2 : 0));
            var systems = packBars(specs, packAvail);
            var section = SB.el('div', 'grid-section');

            systems.forEach(function (bars, si) {
                var system = SB.el('div', 'grid-system');
                var first = si === 0, last = si === systems.length - 1;
                if (block.repeat && first) {
                    system.classList.add('has-repeat-start');
                    system.appendChild(repeatSign('start', ctx.barH));
                }
                bars.forEach(function (spec) {
                    system.appendChild(buildBarEl(spec, ctx));
                });
                if (block.repeat && last) {
                    system.classList.add('has-repeat-end');
                    system.appendChild(repeatSign('end', ctx.barH));
                }
                section.appendChild(system);
            });
            // One label per block, not one per system: a block that reflows
            // onto a second line would otherwise print its name twice.
            if (block.label) {
                section.appendChild(SB.el('div', 'grid-section-label', block.label));
            }

            frag.appendChild(section);
        });

        wrap.appendChild(frag);

        var beatEls = Array.prototype.slice.call(wrap.querySelectorAll('.grid-beat'));
        beatEls.forEach(function (el, i) { el.dataset.beat = String(i); });

        activeGrid = {
            song: song,
            beatsPerBar: beatsPerBar,
            totalBeats: beatEls.length,
            bpm: bpm,
            beatEls: beatEls,
            wrap: wrap,
            phase: 'idle'
        };
        wrap.dataset.gridPhase = 'idle';

        if (SB.state.metronome.playing) SB.gridOnMetronomeStart();
    }

    SB.renderSheetGrid = renderSheetGrid;

})(window.SB = window.SB || {});
