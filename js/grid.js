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
        return /(^|[\s(])(intro|verse|chorus|bridge|pre-?chorus|outro|interlude|instrumental|solo|riff|refrain|hook|coda|tag)([\s):,]|$)/.test(t);
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

    function sectionLines(section) {
        var lines = [];
        section.lines.forEach(function (line) {
            var changes = lineChanges(line);
            if (changes.length) lines.push({ changes: changes });
        });
        return lines;
    }

    /* Collapse the sheet's chord tokens into changes (a repeated token is the
     * same chord still ringing). A change keeps every line piece that carries
     * it, because a chord held across a line break belongs to both lines. */
    function sectionChanges(lines) {
        var changes = [];
        lines.forEach(function (line, li) {
            line.changes.forEach(function (ch) {
                var prev = changes[changes.length - 1];
                if (prev && prev.chord === ch.chord) {
                    prev.parts.push({ line: li, text: ch.text });
                    return;
                }
                changes.push({ chord: ch.chord, parts: [{ line: li, text: ch.text }] });
            });
        });
        return changes;
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

    function labelMatches(label, name) {
        var n = String(name || '').toLowerCase();
        if (!n) return false;
        return String(label || '').toLowerCase().split(/[\/&,]/).some(function (p) {
            p = p.trim();
            return !!p && n.indexOf(p) !== -1;
        });
    }

    function matchSection(song, block) {
        var grid = blockChanges(block);
        if (grid.length < 2) return null;
        var best = null;
        sheetSections(song).forEach(function (section) {
            var lines = sectionLines(section);
            var changes = sectionChanges(lines);
            if (changes.length < grid.length) return;
            for (var i = 0; i < grid.length; i++) {
                if (changes[i].chord !== grid[i]) return;
            }
            var exact = changes.length === grid.length;
            var label = labelMatches(block.label, section.name);
            // Exact full-section match beats a prefix; a label match breaks
            // ties between sections that share the same changes.
            if (!best || (exact && !best.exact) ||
                (exact === best.exact && label && !best.label)) {
                best = {
                    section: section, changes: changes,
                    exact: exact, label: label
                };
            }
        });
        return best;
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

    /* The lyric phrase that starts at each change, measured in the lyric face.
     * A change can carry one phrase per sheet line (a chord held across a line
     * break belongs to both lines), so keep the widest. The bar widths are
     * then derived from these, which lets the same layout work for songs with
     * long and short lines instead of a fixed column width. */
    function phraseWidths(matched, measurer) {
        var byChange = {};
        if (!matched) return byChange;
        matched.changes.forEach(function (change, ci) {
            change.parts.forEach(function (part) {
                var text = String(part.text || '').replace(/\s+/g, ' ').trim();
                if (!text) return;
                byChange[ci] = Math.max(byChange[ci] || 0, measurer.width(text));
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

    /* Build one lyric row per chord change (not one row per sheet line). Each
     * change that has words gets its own line anchored at that change's x, so a
     * chord always has one lyric line under it - never zero, never two. A word
     * split by a change ("West Vir" + "ginia") is glued onto the row of the
     * change where it begins, so neither row starts in the middle of a word.
     * When a split word consumes a change's text, that change still gets an
     * empty row at its own x so no chord is left without a line. */
    function buildPhraseRows(matched) {
        if (!matched) return [];
        var order = [], byLine = {};
        matched.changes.forEach(function (change, ci) {
            change.parts.forEach(function (part) {
                var li = part.line;
                if (byLine[li] == null) { byLine[li] = []; order.push(li); }
                byLine[li].push({ change: ci, part: part });
            });
        });
        order.sort(function (a, b) { return a - b; });

        var rows = [];
        order.forEach(function (li) {
            var parts = byLine[li];
            var cur = null, prevRaw = '';
            parts.forEach(function (p) {
                var raw = String(p.part.text || '');
                var text = raw.replace(/\s+/g, ' ').trim();
                if (cur && prevRaw.length > 0 && !/\s$/.test(prevRaw) &&
                    !/^\s/.test(raw) && text.length) {
                    // A word split across a change stays whole on one row.
                    cur.text = cur.text + text;
                    cur.raw = cur.raw + raw;
                    // This change's text was glued onto the previous row; it
                    // still needs its own row at its own x (empty text).
                    p.consumed = true;
                } else if (text || !cur) {
                    if (cur) rows.push(cur);
                    cur = { line: li, change: p.change, text: text, raw: raw };
                }
                prevRaw = raw;
            });
            if (cur) rows.push(cur);
        });

        // Ensure every change gets a row, even if its text was glued onto a
        // previous change's row (split word). Consumed changes get an empty
        // row at their own x so no chord is left without a line.
        var hasRow = {};
        rows.forEach(function (row) { hasRow[row.change] = true; });
        matched.changes.forEach(function (change, ci) {
            if (!hasRow[ci]) {
                rows.push({ line: -1, change: ci, text: '', raw: '', empty: true });
            }
        });

        return rows;
    }

    /* Derive per-change lyric widths from the rows so columns are sized for the
     * combined row text (not individual parts), and so split-word rows are wide
     * enough to hold the glued word. */
    function rowsToWidths(rows, measurer) {
        var byChange = {};
        rows.forEach(function (row) {
            var w = measurer.width(row.text);
            byChange[row.change] = Math.max(byChange[row.change] || 0, w);
        });
        return byChange;
    }

    /* After bar specs and geometry exist, attach each row to the system that
     * holds its change and anchor it at that change's x. */
    function assignRowGeometry(rows, geometry) {
        rows.forEach(function (row) {
            geometry.forEach(function (geom, si) {
                var x = geom.byChange[row.change];
                if (x != null) { row.system = si; row.x = x; }
            });
        });
    }

    /* Lay one phrase row per chord change. The phrase starts at its change's x
     * and is just wide enough for its text; the bar column has already been
     * widened by rowsToWidths + CHANGE_PAD, so the row fits cleanly under its
     * diagram instead of bleeding into the next bar. */
    function buildLyricLayer(system, geom, rows, si, avail, measurer) {
        var here = rows.filter(function (row) { return row.system === si; });
        if (!here.length) return;
        here.sort(function (a, b) {
            return a.line === b.line ? a.x - b.x : a.line - b.line;
        });
        var layerW = Math.max(geom.width +
            (system.classList.contains('has-repeat-end') ? REPEAT_W : 0), avail);
        var layer = SB.el('div', 'grid-lyrics');
        layer.style.width = layerW + 'px';

        here.forEach(function (row) {
            var node = SB.el('span', 'grid-lyric', row.text);
            node.style.marginLeft = row.x + 'px';
            if (row.empty) {
                // Change consumed its text into a previous row (split word);
                // keep an empty marker at its own x so the chord isn't skipped.
                node.classList.add('grid-lyric-empty');
                node.style.width = '0px';
                node.style.height = '0px';
                node.style.padding = '0';
                node.style.marginLeft = row.x + 'px';
                layer.appendChild(node);
                return;
            }
            // The row is just as wide as its text (plus right padding), so it
            // stays under its own chord column rather than stretching across
            // the whole system.
            var textW = measurer.width(row.text);
            node.style.width = (textW + LYRIC_PAD_RIGHT) + 'px';
            // A phrase that cannot reach the next change (only on a narrow
            // screen) is better read as a continuous line from the left edge.
            if (textW > layerW - row.x - LYRIC_PAD_RIGHT) {
                node.style.marginLeft = '0px';
                node.style.width = (layerW - LYRIC_PAD_RIGHT) + 'px';
            }
            layer.appendChild(node);
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

        song.grid.forEach(function (block) {
            var matched = matchSection(song, block);
            if (matched) lyricSections.push(matched.section.name);
            var rows = buildPhraseRows(matched);
            var lyricW = rowsToWidths(rows, measurer);
            var changeState = { prev: null, index: -1 };
            var specs = block.bars.map(function (bar) {
                var spec = buildBarSpec(bar, song, ctx, changeState, lyricW);
                return spec;
            });
            // Repeat signs are flex items too, so reserve their width before
            // packing or a repeated block overflows its system by 24px.
            var packAvail = Math.max(ctx.beatW * 2, avail - (block.repeat ? REPEAT_W * 2 : 0));
            var systems = packBars(specs, packAvail);
            var geom = systems.map(function (bars, si) {
                return systemGeometry(bars, (block.repeat && si === 0) ? REPEAT_W : 0);
            });
            assignRowGeometry(rows, geom);
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
                buildLyricLayer(system, geom[si], rows, si, avail, measurer);
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
