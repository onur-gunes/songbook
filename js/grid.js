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
    var BEAT_MIN = 30;          // px, before the sheet's text-size scale
    // The reserved box matches the SVG's 104x120 (uke) / 160x120 (guitar)
    // aspect, so every diagram fills it and no chord is scaled smaller.
    var DIAGRAM_H = 100;        // px at --chord-size: 1, same as the strip
    var DIAGRAM_W_UKE = 87;     // reserved box, not the SVG's natural width
    var DIAGRAM_W_GUITAR = 133;
    var BAR_PAD = 6;            // px inside each bar line
    var CHANGE_PAD = 10;        // extra space after a chord change
    var REPEAT_W = 12;
    var LYRIC_PAD_RIGHT = 6;    // matches .grid-lyric padding-right

    var activeGrid = null;      // { song, beatsPerBar, totalBeats, bpm, ... }
    var cursorRaf = null;
    var lastBeat = -1;

    /* ---------------- helpers ---------------- */

    /* A song can carry an authored grid, or one can be built from the sheet:
     * the lyric lines already mark every chord change, so a chart only needs
     * the metre. Songs without a `time` keep the old "no grid" behaviour
     * because there is no honest beat count to invent. */
    function songHasChanges(song) {
        return (song.sheet || []).some(function (line) {
            return line.some(function (seg) {
                return seg[0] === 'c' && tokenChord(seg[1]);
            });
        });
    }

    function hasGrid(song) {
        if (!song) return false;
        if (song.grid && song.grid.length) return true;
        return !!song.time && songHasChanges(song);
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

    /* ---------------- lyric mapping ----------------
     *
     * The grid knows exactly where each chord changes; the sheet writes the
     * same chords into the lyric line at the syllable where they change.
     * Walking the two change sequences together therefore gives a reliable
     * anchor for the lyric phrase under each bar, without inventing a
     * word-level beat map.
     *
     * The match is deliberately conservative. A section must start with the
     * block's whole change sequence (so a one-pass grid matches one pass of a
     * longer section), and songs whose grid is a different arrangement show
     * the chart without lyrics rather than the wrong words.
     */
    function tokenChord(tok) {
        var s = String(tok == null ? '' : tok);
        var m = s.match(/^\[([\s\S]*)\]$/);
        var core = (m ? m[1] : s).replace(/^\/+|\/+$/g, '').trim();
        // FC is the legacy encoding of F/C (see transposeChartName).
        return core === 'FC' ? 'F/C' : core;
    }

    /* Sheet section headers are italic lines. Performance directions are
     * italic too ("quietly", "down-down"), so only section words count. */
    function isSectionHeader(text) {
        var t = String(text == null ? '' : text).trim().toLowerCase();
        if (!t) return false;
        return /(^|[\s(])(intro|verse|chorus|bridge|pre-?chorus|outro|interlude|instrumental|solo|riff|refrain|hook|coda|tag)([\s):,/]|$)/.test(t);
    }

    function sheetSections(song) {
        var sections = [];
        var cur = { name: '', lines: [] };
        (song.sheet || []).forEach(function (line) {
            var header = line.length === 1 && line[0][0] === 'i' && isSectionHeader(line[0][1]);
            if (header) {
                if (cur.lines.length || cur.name) sections.push(cur);
                cur = { name: String(line[0][1]).trim(), lines: [] };
            } else {
                cur.lines.push(line);
            }
        });
        if (cur.lines.length || cur.name) sections.push(cur);
        return sections;
    }

    /* Chords, comments and preformatted tabs are not lyrics. */
    function isLyricKind(kind) {
        return kind !== 'c' && kind !== 'y' && kind !== 'p';
    }

    /* A line's chord changes, each with the raw lyric text that follows it
     * until the next change. Text before the first token is the line's
     * pickup, so it belongs to the line's first change. */
    function lineChanges(line) {
        var chordAt = [];
        line.forEach(function (seg, i) { if (seg[0] === 'c') chordAt.push(i); });
        var changes = [];
        chordAt.forEach(function (ci, k) {
            var chord = tokenChord(line[ci][1]);
            if (!chord) return;
            var start = k === 0 ? 0 : ci;
            var end = k + 1 < chordAt.length ? chordAt[k + 1] : line.length;
            var text = '';
            for (var i = start; i < end; i++) {
                if (isLyricKind(line[i][0])) text += line[i][1];
            }
            var prev = changes[changes.length - 1];
            // A chord repeated inside one line is the same chord still
            // ringing, so its text stays on the same change.
            if (prev && prev.chord === chord) {
                prev.text += text;
                return;
            }
            changes.push({ chord: chord, text: text });
        });
        return changes;
    }

    /* One section's lyric lines and chord changes. A change is the unit the
     * layout anchors to; a line keeps its own pieces so a whole lyric line can
     * be rebuilt as one readable row. */
    function sectionModel(section) {
        var model = { name: section.name, lines: [], changes: [] };
        var lineIndex = 0;
        section.lines.forEach(function (line) {
            if (!line.length) return;
            var raw = lineChanges(line);
            var row = { index: lineIndex++, parts: [] };
            if (!raw.length) {
                // A lyric-only line (no chord change) still belongs in the
                // chart; anchor it at the left edge under its system.
                var text = lineLyricText(line).replace(/\s+/g, ' ').trim();
                if (text) {
                    row.parts.push({ change: null, text: text, raw: text });
                    model.lines.push(row);
                }
                return;
            }
            raw.forEach(function (ch) {
                var prev = model.changes[model.changes.length - 1];
                var ci;
                if (prev && prev.chord === ch.chord) {
                    ci = prev.index;
                    prev.parts.push({ line: row.index, text: ch.text });
                } else {
                    ci = model.changes.length;
                    model.changes.push({
                        index: ci, chord: ch.chord,
                        parts: [{ line: row.index, text: ch.text }]
                    });
                }
                row.parts.push({ change: ci, text: ch.text, raw: ch.text });
            });
            model.lines.push(row);
        });
        return model;
    }

    function lineLyricText(line) {
        var text = '';
        line.forEach(function (seg) {
            if (isLyricKind(seg[0])) text += seg[1];
        });
        return text;
    }

    function blockChanges(block) {
        var changes = [], prev = null;
        (block.bars || []).forEach(function (bar) {
            (bar.beats || []).forEach(function (seg) {
                var chord = tokenChord(seg.chord);
                if (chord !== prev) {
                    changes.push(chord);
                    prev = chord;
                }
            });
        });
        return changes;
    }

    /* How strongly a block label describes a sheet section. The chord
     * progression is the real match; the label only breaks ties. */
    function labelScore(label, name) {
        var a = String(label || '').toLowerCase().trim();
        var b = String(name || '').toLowerCase().trim();
        if (!a || !b) return 0;
        if (a === b) return 3;
        var parts = a.split(/[\/&,]/).map(function (p) { return p.trim(); }).filter(Boolean);
        if (parts.indexOf(b) !== -1) return 2;
        for (var i = 0; i < parts.length; i++) {
            if (b.indexOf(parts[i]) !== -1) return 1;
        }
        return 0;
    }

    function progressionAt(changes, prog, at) {
        if (at + prog.length > changes.length) return false;
        for (var i = 0; i < prog.length; i++) {
            if (changes[at + i].chord !== prog[i]) return false;
        }
        return true;
    }

    /* A progression template that starts the section, preferring an unused
     * block (so two identical Choruses can use their own authored bars) and
     * an exact full-section match. */
    function matchTemplate(blocks, used, section, changes) {
        if (!changes.length) return null;
        var best = null;
        blocks.forEach(function (block, bi) {
            var prog = blockChanges(block);
            if (!prog.length || !progressionAt(changes, prog, 0)) return;
            var exact = changes.length === prog.length;
            var score = (exact ? 100 : 0) + labelScore(block.label, section.name) * 10 -
                (used[bi] ? 1 : 0);
            if (!best || score > best.score) {
                best = { block: block, index: bi, prog: prog, score: score };
            }
        });
        return best;
    }

    /* Repeat a progression until it covers the section (a verse that runs the
     * same four-bar loop twice), collapsing held chords across the join
     * exactly as the renderer does. Returns null when the section is a
     * different arrangement, so the caller falls back to a chart built from
     * the sheet rather than showing the wrong bars. */
    /* The change sequence a list of bars plays, with a chord held across a bar
     * line counted once (the same collapse the renderer uses). */
    function barsToChanges(bars) {
        var seq = [], prev = null;
        bars.forEach(function (bar) {
            (bar.beats || []).forEach(function (seg) {
                var chord = tokenChord(seg.chord);
                if (chord !== prev) { seq.push(chord); prev = chord; }
            });
        });
        return seq;
    }

    /* Repeat a progression until it covers the section (a verse that runs the
     * same four-bar loop twice), cutting the last repetition at a bar line when
     * the song stops mid-loop ("down country roads" after the chorus). Returns
     * null when the section is a different arrangement, so the caller falls
     * back to a chart built from the sheet rather than showing wrong bars. */
    function tileBars(block, prog, changes) {
        var authored = block.bars || [];
        if (!authored.length || !changes.length) return null;
        var want = changes.map(function (c) { return c.chord; });
        var reps = Math.ceil(changes.length / prog.length) + 1;
        var bars = [];
        for (var r = 0; r < reps; r++) {
            authored.forEach(function (bar) { bars.push(bar); });
            // The smallest prefix that plays exactly the section's changes wins,
            // so a partial final loop keeps its repeat signs without inventing
            // bars past the last lyric.
            for (var k = 1; k <= bars.length; k++) {
                var seq = barsToChanges(bars.slice(0, k));
                if (seq.length !== want.length) continue;
                var ok = true;
                for (var i = 0; i < want.length; i++) {
                    if (seq[i] !== want[i]) { ok = false; break; }
                }
                if (ok) return { bars: bars.slice(0, k), tiles: r + 1 };
            }
        }
        return null;
    }

    /* One bar per chord change, with the metre's full count. This is the
     * no-author fallback: the lyrics already say where the changes are, and
     * one chord per bar is the clearest honest default. */
    function autoBars(model, beatsPerBar) {
        return model.changes.map(function (ch) {
            return { beats: [{ chord: ch.chord, beats: beatsPerBar }] };
        });
    }

    /* Build the complete chart from the sheet. Authored blocks are used as
     * templates where their progression fits the section; every other section
     * gets an automatic chart, so no song needs a hand-written grid. */
    function gridBlocksFor(song) {
        var beatsPerBar = SB.metronomeBeatsPerBar(song.time);
        var authored = song.grid || [];
        var used = {};
        var out = [];

        sheetSections(song).forEach(function (section) {
            var model = sectionModel(section);
            if (!model.changes.length && !model.lines.length) return;
            var match = matchTemplate(authored, used, section, model.changes);
            if (match) {
                var tiled = tileBars(match.block, match.prog, model.changes);
                if (tiled) {
                    used[match.index] = true;
                    out.push({
                        label: section.name || match.block.label || '',
                        bars: tiled.bars,
                        repeat: !!match.block.repeat,
                        model: model
                    });
                    return;
                }
            }
            var bars = autoBars(model, beatsPerBar);
            if (bars.length) {
                out.push({
                    label: section.name || '',
                    bars: bars,
                    repeat: false,
                    model: model
                });
            }
        });

        // An instrumental song can still carry an authored chart even when the
        // sheet has no sections to attach it to.
        if (!out.length && authored.length) {
            out = authored.map(function (block) {
                return {
                    label: block.label || '',
                    bars: block.bars || [],
                    repeat: !!block.repeat,
                    model: null
                };
            });
        }
        return out;
    }
    SB.gridBlocksFor = gridBlocksFor;

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

    /* Keep the current beat visible. Scrolling the whole system was wrong for
     * a system taller than the viewport: after the first nudge the cursor could
     * walk off the bottom and never come back. Scroll to the beat itself, and
     * pan a system that has overflowed horizontally (a long lyric phrase on a
     * phone) so the highlight cannot sit off-screen. */
    function scrollBeatIntoView(el) {
        if (!el) return;
        var system = el.closest ? el.closest('.grid-system') : null;
        if (system && system.scrollWidth > system.clientWidth) {
            var sr = system.getBoundingClientRect();
            var br = el.getBoundingClientRect();
            if (br.left < sr.left || br.right > sr.right) {
                system.scrollLeft += (br.left - sr.left) -
                    (sr.width - br.width) / 2;
            }
        }
        var r = el.getBoundingClientRect();
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
        if (!SB.state.scrollState.playing) scrollBeatIntoView(activeGrid.beatEls[idx]);
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
            activeBeat: lastBeat,
            lyricSection: activeGrid.lyricSection,
            lyricCount: activeGrid.lyricCount
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

    /* Split bars that cannot fit on one system into roughly equal systems.
     * Greedy packing filled the first system and left a lone bar on the last
     * line, which read as a stray chord; balancing keeps the leftover bars
     * together. */
    function splitBars(bars, avail) {
        var widths = bars.map(function (bar) { return bar.width; });
        var total = widths.reduce(function (n, w) { return n + w; }, 0);
        var want = Math.max(1, Math.ceil(total / avail));
        if (want === 1) return [bars];
        var target = total / want;
        var out = [], cur = [], curW = 0, left = bars.length;
        bars.forEach(function (bar) {
            var groupsLeft = want - out.length;
            if (cur.length && (curW + bar.width > avail ||
                (curW + bar.width > target && left >= groupsLeft))) {
                out.push(cur);
                cur = [];
                curW = 0;
            }
            cur.push(bar);
            curW += bar.width;
            left--;
        });
        if (cur.length) out.push(cur);
        return out;
    }

    /* A lyric-driven chart puts one sheet line (and the bars for its changes)
     * on each system. Greedy width packing alone scattered a line's words under
     * a different system from its chords whenever a progression held a chord
     * across two bars. Grouping by the lines' first changes keeps "moon is the
     * only light" directly beneath the D/E/A bars it belongs to, which is the
     * whole point of the chart. A line that shares a chord with the line above
     * is stacked under the same system; a group that is still too wide for the
     * screen is split, and the line stays under the first half. */
    function groupSystems(specs, model, avail) {
        var changeBar = {};
        specs.forEach(function (spec, bi) {
            spec.segments.forEach(function (seg) {
                if (seg.changeIndex >= 0) changeBar[seg.changeIndex] = bi;
            });
        });

        var groups = [], cursor = 0;
        model.lines.forEach(function (line) {
            var first = Infinity, last = -1;
            line.parts.forEach(function (part) {
                if (part.change == null) return;
                if (part.change < first) first = part.change;
                if (part.change > last) last = part.change;
            });
            if (last < 0 || last < cursor) {
                // A lyric-only line, or one that only repeats a chord already
                // rendered above: keep it under the same bars.
                if (groups.length) groups[groups.length - 1].lines.push(line);
                else groups.push({ first: cursor, last: cursor - 1, lines: [line] });
                return;
            }
            var prev = groups[groups.length - 1];
            if (prev && first < cursor) {
                // The line opens on the chord that closed the line above (a
                // held G ringing across the line break). It belongs under the
                // same bars, and its new changes extend that system.
                prev.lines.push(line);
                prev.last = Math.max(prev.last, last);
                cursor = prev.last + 1;
                return;
            }
            groups.push({ first: cursor, last: last, lines: [line] });
            cursor = last + 1;
        });

        var systems = [], cur = [], curW = 0;
        function flush() {
            if (cur.length) { systems.push(cur); cur = []; curW = 0; }
        }
        groups.forEach(function (group) {
            var startBar = changeBar[group.first];
            if (startBar == null) startBar = 0;
            var nextBar = specs.length;
            for (var ci = group.last + 1; ci < group.first + specs.length + 1; ci++) {
                if (changeBar[ci] != null) { nextBar = changeBar[ci]; break; }
            }
            var bars = specs.slice(startBar, nextBar);
            if (!bars.length) bars = specs.slice(startBar, startBar + 1);
            var width = bars.reduce(function (n, bar) { return n + bar.width; }, 0);
            if (width > avail) {
                // The group alone is wider than the screen: split it evenly and
                // let the lyric row sit under the first part.
                flush();
                splitBars(bars, avail).forEach(function (part) { systems.push(part); });
                return;
            }
            if (cur.length && curW + width > avail) flush();
            cur = cur.concat(bars);
            curW += width;
        });
        flush();
        return systems.length ? systems : packBars(specs, avail);
    }

    /* Where each chord change sits inside one system, keyed by the block's
     * change index. The lyric layout needs these positions before it can
     * decide which system a sheet line belongs to. */
    function systemGeometry(bars, baseX) {
        var positions = [], byChange = {}, offset = baseX;
        var repeatStart = baseX > 0;
        bars.forEach(function (spec, bi) {
            // Change x is relative to the bar's padding box, which starts
            // inside its 1px left border (removed on a repeat-start bar).
            var borderLeft = (repeatStart && bi === 0) ? 0 : 1;
            spec.segments.forEach(function (seg, i) {
                if (seg.changeIndex >= 0) {
                    var x = offset + borderLeft + spec.changeXs[i];
                    positions.push({ index: seg.changeIndex, x: x });
                    byChange[seg.changeIndex] = x;
                }
            });
            offset += spec.width;
        });
        return { positions: positions, byChange: byChange, width: offset };
    }

    function repeatSign(kind, height) {
        var s = SB.el('span', 'grid-repeat ' + kind);
        s.style.height = height + 'px';
        s.setAttribute('aria-hidden', 'true');
        return s;
    }

    /* The lyric text that starts at each change, measured in the lyric face.
     * A change can carry text from more than one sheet line (a chord held
     * across a line break belongs to both), so keep the widest. The bar widths
     * derive from these, which lets a long phrase reserve its column while a
     * short one stays narrow. */
    function changeWidths(model, measurer) {
        var byChange = {};
        if (!model) return byChange;
        model.lines.forEach(function (line) {
            line.parts.forEach(function (part) {
                if (part.change == null) return;
                var text = String(part.text || '').replace(/\s+/g, ' ').trim();
                if (!text) return;
                byChange[part.change] = Math.max(byChange[part.change] || 0,
                    measurer.width(text));
            });
        });
        return byChange;
    }

    function buildBarSpec(bar, song, ctx, changeState, lyricW) {
        var segments = bar.beats.map(function (seg) {
            var tname = SB.transposeChartName(seg.chord, SB.state.transpose);
            var label = gridLabel(song, seg.chord);
            var labelW = SB.chordLabelWidth(label);
            var contentW = Math.max(labelW, ctx.diagram.w);
            var voicing = isMuted(tname)
                ? ChordKit.mutedVoicing(SB.state.instrument)
                : SB.chosenVoicing(tname);
            // A held chord gets a diagram in every bar it fills, but only the
            // first bar is a change, so only that one carries a lyric.
            var changeIndex = -1;
            var chordKey = tokenChord(seg.chord);
            if (chordKey !== changeState.prev) {
                changeState.prev = chordKey;
                changeIndex = ++changeState.index;
            }
            // Reserve at least the phrase's width so the next change (and its
            // lyric) starts after the words, not in the middle of them. Add the
            // lyric's right padding so the column is a touch wider than its text.
            var phraseW = changeIndex >= 0 && lyricW ? (lyricW[changeIndex] || 0) + LYRIC_PAD_RIGHT : 0;
            return {
                chord: seg.chord,
                tname: tname,
                label: label,
                beats: seg.beats,
                width: Math.max(seg.beats * ctx.beatW, contentW + ctx.gap,
                    phraseW) + CHANGE_PAD,
                contentW: contentW,
                voicing: voicing,
                changeIndex: changeIndex
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
            // A change at the start of a bar is already marked by the bar line
            // (or the repeat sign). Only a change inside a bar needs the extra
            // drop line, otherwise every bar-start chord got two lines 6px
            // apart while a mid-bar change got one.
            var change = SB.el('div', 'grid-change' + (i > 0 ? ' grid-change-mid' : ''));
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

    /* Text measurement in the lyric face. Rows are built before they are in
     * the document, so widths come from one hidden span in the sheet rather
     * than from a guessed character count. */
    function makeMeasurer(wrap) {
        var span = SB.el('span', 'grid-measure');
        span.setAttribute('aria-hidden', 'true');
        wrap.appendChild(span);
        return {
            width: function (text) {
                span.textContent = text;
                return span.offsetWidth;
            },
            done: function () {
                if (span.parentNode) span.parentNode.removeChild(span);
            }
        };
    }

    /* Put each lyric line under the system that holds its first chord change.
     * Lines with no chords continue under the previous system at the left
     * edge, so no lyric line is dropped just because it has no chord. */
    function assignLineGeometry(lines, geometry) {
        var last = 0;
        lines.forEach(function (line) {
            var found = null;
            for (var p = 0; p < line.parts.length && !found; p++) {
                var change = line.parts[p].change;
                if (change == null) continue;
                for (var si = 0; si < geometry.length; si++) {
                    var x = geometry[si].byChange[change];
                    if (x != null) {
                        found = { system: si, x: x };
                        break;
                    }
                }
            }
            if (found) {
                line.system = found.system;
                line.x = found.x;
                last = found.system;
            } else {
                line.system = last;
                line.x = 0;
            }
        });
    }

    /* One row per sheet line. The row is rebuilt from the line's own pieces
     * and each piece is nudged to its chord change's x, so "Country roads,
     * take me home" stays on one line with "home" under D instead of breaking
     * into one stacked fragment per chord. When the line cannot fit with its
     * anchors intact (a phone, or a long line on a short system) it falls back
     * to continuous wrapping text rather than a squeezed column. */
    function buildLyricLayer(system, geom, lines, si, avail, measurer) {
        var here = lines.filter(function (line) { return line.system === si; });
        if (!here.length) return;
        here.sort(function (a, b) { return a.index - b.index; });

        var layerW = Math.max(geom.width +
            (system.classList.contains('has-repeat-end') ? REPEAT_W : 0), avail);
        var layer = SB.el('div', 'grid-lyrics');
        layer.style.width = layerW + 'px';
        var spaceW = measurer.width(' ');

        here.forEach(function (line) {
            var rowStart = line.x || 0;
            var availW = layerW - rowStart - LYRIC_PAD_RIGHT;
            if (availW <= 0) { rowStart = 0; availW = layerW - LYRIC_PAD_RIGHT; }

            var segments = [], x = 0, prevRaw = '', aligned = true;
            line.parts.forEach(function (part) {
                var raw = String(part.text || '');
                var text = raw.replace(/\s+/g, ' ').trim();
                if (!text) return;
                var anchor = part.change == null ? null : geom.byChange[part.change];
                var rel = anchor == null ? null : anchor - rowStart;
                if (rel == null) aligned = false;
                // A word split by a change ("West Vir" + "ginia") must not gain
                // a space or jump to an anchor inside itself.
                var joined = !!prevRaw && !/\s$/.test(prevRaw) && !/^\s/.test(raw);
                var start, space = false;
                if (!segments.length) {
                    start = (rel == null || rel < 0) ? 0 : rel;
                } else if (joined) {
                    start = x;
                } else {
                    var natural = x + spaceW;
                    start = (rel == null || rel < natural) ? natural : rel;
                    space = true;
                }
                var width = measurer.width(text);
                segments.push({ text: text, start: start, width: width, space: space });
                x = start + width;
                prevRaw = raw;
            });
            if (!segments.length) return;

            var row = SB.el('span', 'grid-lyric');
            row.style.marginLeft = rowStart + 'px';
            row.style.width = (layerW - rowStart) + 'px';
            if (aligned && x <= availW + 0.5) {
                // Phrases fit with their anchors intact; keep them on one line
                // so wrapping cannot undo the alignment.
                row.classList.add('is-aligned');
                var prevEnd = 0;
                segments.forEach(function (seg) {
                    if (seg.space) {
                        row.appendChild(document.createTextNode(' '));
                        prevEnd += spaceW;
                    }
                    var sp = SB.el('span', 'grid-phrase', seg.text);
                    sp.style.marginLeft = Math.max(0, seg.start - prevEnd) + 'px';
                    row.appendChild(sp);
                    prevEnd = seg.start + seg.width;
                });
            } else {
                // Too long for this width: a continuous line that wraps is
                // more useful than broken alignment.
                row.textContent = line.parts.map(function (part) {
                    return String(part.text || '');
                }).join('').replace(/\s+/g, ' ').trim();
            }
            layer.appendChild(row);
        });

        system.appendChild(layer);
    }

    /* The lyric layer is a stack of rows, so its height is the height of the
     * stack, not the tallest row. The layer lives in the system's bottom
     * padding. */
    function sizeLyricLayers(wrap, em) {
        Array.prototype.forEach.call(wrap.querySelectorAll('.grid-lyrics'), function (layer) {
            layer.style.height = '';
            var h = layer.offsetHeight;
            if (!h) h = Math.ceil(em * 1.3);
            layer.style.height = h + 'px';
            if (layer.parentNode) layer.parentNode.style.paddingBottom = h + 'px';
        });
    }

    function renderSheetGrid(song) {
        resetCursor();

        var wrap = SB.$('sheet');
        wrap.textContent = '';
        wrap.classList.remove('chords-above');
        wrap.classList.add('chords-grid');

        var em = SB.sheetEmPx();
        var ctx = {
            beatW: Math.max(BEAT_MIN, em * 2.0),
            labelH: Math.ceil(em * 1.35),
            beatH: Math.ceil(em * 1.7),
            gap: Math.max(10, em * 0.6),
            diagram: diagramBox(SB.state.chordSize)
        };
        ctx.changeBottom = ctx.beatH + 4;
        ctx.barH = ctx.changeBottom + ctx.diagram.h + ctx.labelH + 4;
        wrap.style.setProperty('--grid-beat-h', ctx.beatH + 'px');
        wrap.style.setProperty('--grid-guide-h', ctx.changeBottom + 'px');

        var avail = Math.max(ctx.beatW * 2, (wrap.clientWidth || window.innerWidth - 40) - 2);
        var beatsPerBar = SB.metronomeBeatsPerBar(song.time);
        var bpm = SB.state.metronome.bpm || song.bpm || null;
        var frag = document.createDocumentFragment();
        var lyricSections = [];
        var measurer = makeMeasurer(wrap);
        var blocks = gridBlocksFor(song);

        blocks.forEach(function (block) {
            var model = block.model;
            if (block.label) lyricSections.push(block.label);
            var lyricW = model ? changeWidths(model, measurer) : {};
            var changeState = { prev: null, index: -1 };
            var specs = (block.bars || []).map(function (bar) {
                return buildBarSpec(bar, song, ctx, changeState, lyricW);
            });
            // Repeat signs are flex items too, so reserve their width before
            // packing or a repeated block overflows its system by 24px.
            var packAvail = Math.max(ctx.beatW * 2, avail - (block.repeat ? REPEAT_W * 2 : 0));
            // A chart with lyrics groups bars by lyric line, so every line sits
            // under the bars for its own changes. An authored chart without a
            // matching sheet section just packs by width.
            var systems = model ? groupSystems(specs, model, packAvail) : packBars(specs, packAvail);
            var geom = systems.map(function (bars, si) {
                return systemGeometry(bars, (block.repeat && si === 0) ? REPEAT_W : 0);
            });
            if (model) assignLineGeometry(model.lines, geom);
            var section = SB.el('div', 'grid-section');
            // One label per block, not one per system: a block that reflows
            // onto a second line would otherwise print its name twice.
            if (block.label) {
                section.appendChild(SB.el('div', 'grid-section-label', block.label));
            }

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
                if (model) buildLyricLayer(system, geom[si], model.lines, si, avail, measurer);
                section.appendChild(system);
            });
            frag.appendChild(section);
        });

        measurer.done();
        wrap.appendChild(frag);
        sizeLyricLayers(wrap, em);

        var beatEls = Array.prototype.slice.call(wrap.querySelectorAll('.grid-beat'));
        beatEls.forEach(function (el, i) { el.dataset.beat = String(i); });

        activeGrid = {
            song: song,
            beatsPerBar: beatsPerBar,
            totalBeats: beatEls.length,
            bpm: bpm,
            beatEls: beatEls,
            wrap: wrap,
            phase: 'idle',
            lyricSection: lyricSections.length ? lyricSections[0] : null,
            lyricCount: wrap.querySelectorAll('.grid-lyric').length
        };
        wrap.dataset.gridPhase = 'idle';

        if (SB.state.metronome.playing) SB.gridOnMetronomeStart();
    }

    SB.renderSheetGrid = renderSheetGrid;

})(window.SB = window.SB || {});
