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
    /* The currently lit strum arrow within the playhead's beat, so the grid
       lane pulses subdivision-by-subdivision like the top strum row. */
    var lastStrumEl = null;

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

    /* Sheet section headers are italic lines whose label resolves to a real
     * section role (bilingual: "Zwrotka 2" and "Verse 2" are both verses).
     * Performance directions ("quietly") and chord-only lines resolve to
     * `other`, so they stay lyric lines. */
    function isSectionHeader(text) {
        return SB.sectionRole(String(text == null ? '' : text)) !== 'other';
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
     * gets an automatic chart, so no song needs a hand-written grid.
     *
     * When a per-song edit plan carries a structural grid override
     * (plan.grid, Step 6 edit mode), that override wins over the songbook's
     * authored grid: the user's structure is what the chart shows. Each plan
     * block renders as its own section, keyed by its own label/role, so the
     * editor's add/remove/split/merge edits appear verbatim.
     */
    function gridBlocksFor(song, plan) {
        var beatsPerBar = SB.metronomeBeatsPerBar(song.time);
        var used = {};
        var out = [];

        var planGrid = (plan && plan.grid) || null;
        if (planGrid && planGrid.length) {
            planGrid.forEach(function (block) {
                var bars = (block.bars || []).map(function (bar) {
                    return { beats: (bar.beats || []).map(function (seg) {
                        return { chord: seg.chord, beats: seg.beats };
                    }) };
                });
                out.push({
                    label: block.label || '',
                    role: SB.isSectionRole(block.role) ? block.role : SB.sectionRole(block.label || ''),
                    bars: bars,
                    repeat: !!block.repeat,
                    model: null
                });
            });
            return out;
        }

        var authored = song.grid || [];

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
                        // The role belongs to the section the player is in, not
                        // to whichever authored template happened to fit it:
                        // a Bridge that reuses the Verse progression is still
                        // a bridge, and must not be offered as a verse strum
                        // selector (issue #107).
                        role: SB.sectionRole(section.name || match.block.label || ''),
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
                    role: SB.sectionRole(section.name || ''),
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
                    role: SB.sectionRole(block.label || ''),
                    bars: block.bars || [],
                    repeat: !!block.repeat,
                    model: null
                };
            });
        }
        return out;
    }
    SB.gridBlocksFor = gridBlocksFor;

    /* Every canonical section role the song actually contains, in the order
     * the player meets them (sheet order, then any authored grid block the
     * sheet does not cover). The per-section strum selectors are keyed by this
     * list, not by a fixed menu: a song with no bridge must not offer one.
     *
     * Two labels with the same role ("Verse 1", "Verse 2") collapse into one
     * entry, because section strums are stored per role. `other` is included
     * when a block carries it, so an unrecognised authored section still gets
     * a selector rather than silently falling back to the song pattern. */
    SB.songSectionRoles = function (song, plan) {
        var roles = [];
        var seen = {};
        function add(block) {
            if (!block) return;
            var label = block.label || '';
            var role = SB.isSectionRole(block.role)
                ? block.role
                : SB.sectionRole(label);
            if (!role || seen[role]) return;
            // An auto-generated block with no label (or an unnamed block) is
            // just "the rest of the song", not a section worth a selector.
            if (role === 'other' && !label) return;
            seen[role] = true;
            roles.push(role);
        }
        if (!song) return roles;

        gridBlocksFor(song).forEach(add);
        var authored = (plan && plan.grid) || song.grid || [];
        authored.forEach(add);
        return roles;
    };

    /* ---------------- cursor ---------------- */

    function chordElAt(idx) {
        return activeGrid && activeGrid.chordAt ? activeGrid.chordAt[idx] : null;
    }

    function clearActive() {
        if (lastBeat >= 0 && activeGrid) {
            if (activeGrid.beatEls[lastBeat]) {
                activeGrid.beatEls[lastBeat].classList.remove('on');
            }
            var chord = chordElAt(lastBeat);
            if (chord) chord.classList.remove('on');
        }
        lastBeat = -1;
        if (lastStrumEl) {
            lastStrumEl.classList.remove('on');
            lastStrumEl = null;
        }
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
            wrap.classList.remove('chords-grid', 'chords-animate');
            delete wrap.dataset.gridPhase;
            delete wrap.dataset.activeBeat;
            delete wrap.dataset.animSystem;
            delete wrap.dataset.animSection;
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

    /* The animated view keeps exactly one chart system on screen. Every system
     * is built up front (so measurements are stable), then swapped into the
     * stage when the playhead enters its beat range. Swapping the page rather
     * than scrolling means the lyrics and diagrams change in place. */
    function showAnimSystem(idx) {
        if (!activeGrid || !activeGrid.anim || idx == null) return;
        if (idx === activeGrid.animSystem) return;
        var page = activeGrid.animSystems[idx];
        if (!page || !activeGrid.animStage) return;

        activeGrid.animStage.textContent = '';
        activeGrid.animStage.appendChild(page.el);
        activeGrid.animSystem = idx;
        if (activeGrid.wrap) {
            activeGrid.wrap.dataset.animSystem = String(idx);
            activeGrid.wrap.dataset.animSection = page.label || '';
        }
        if (activeGrid.animStatus && activeGrid.animStatus.textContent !== (page.label || '')) {
            activeGrid.animStatus.textContent = page.label || '';
        }
        // Restart the enter transition even when two systems swap inside the
        // same animation frame.
        activeGrid.animStage.classList.remove('is-entering');
        if (activeGrid.animStage.offsetWidth || activeGrid.animStage.offsetHeight) {
            activeGrid.animStage.classList.add('is-entering');
        }
    }

    function setActive(idx) {
        if (!activeGrid || !activeGrid.beatEls[idx]) return;
        var prevChord = lastBeat >= 0 ? chordElAt(lastBeat) : null;
        if (lastBeat >= 0 && activeGrid.beatEls[lastBeat]) {
            activeGrid.beatEls[lastBeat].classList.remove('on');
        }
        if (prevChord) prevChord.classList.remove('on');

        // Mount the system that owns this beat before highlighting it.
        if (activeGrid.anim) showAnimSystem(activeGrid.beatSystem[idx]);

        activeGrid.beatEls[idx].classList.add('on');
        var chord = chordElAt(idx);
        if (chord) chord.classList.add('on');
        lastBeat = idx;
        activeGrid.wrap.dataset.activeBeat = String(idx);
        // The continuous auto-scroll already follows the music. Nudging here
        // too would fight it, so only step in when the transport is manual.
        // The animated view never moves the page at all.
        if (!SB.state.scrollState.playing && !activeGrid.anim) {
            scrollBeatIntoView(activeGrid.beatEls[idx]);
        }
        // During playback in the static grid, keep the top strum row in step
        // with the effective pattern for the beat under the playhead.
        if (!activeGrid.anim) gridFollowStrum(idx);
    }

    function gridFollowStrum(idx) {
        if (!activeGrid || !activeGrid.song) return;
        var el = activeGrid.beatEls[idx];
        if (!el) return;
        var block = parseInt(el.dataset.block, 10);
        var bar = parseInt(el.dataset.bar, 10);
        var beat = parseInt(el.dataset.beatLocal, 10);
        var resolved = SB.resolveStrumAt(activeGrid.song, { block: block, bar: bar, beat: beat }, activeGrid.plan);
        if (!resolved.pattern) return;
        var cur = SB.state.strum.pattern;
        if (cur && cur.id === resolved.pattern.id) return;
        if (activeGrid._strumSaved == null) activeGrid._strumSaved = cur;
        activeGrid._strumFollowed = true;
        SB.strumSetPattern(resolved.pattern);
    }

    /* Lights the subdivision arrow within the playhead's beat, one slot at a
       time, exactly as the top strum row pulses each down / up. `chartBeats`
       is the metronome position in beats (fraction = position within the
       beat). Only the current beat carries a lit arrow. */
    function paintStrumSlot(chartBeats) {
        var idx = Math.floor(chartBeats);
        var beatEl = activeGrid && activeGrid.beatEls ? activeGrid.beatEls[idx] : null;
        if (!beatEl) {
            if (lastStrumEl) { lastStrumEl.classList.remove('on'); lastStrumEl = null; }
            return;
        }
        var subdiv = parseInt(beatEl.dataset.subdiv, 10) || 1;
        var frac = chartBeats - idx;
        var slot = Math.floor(frac * subdiv);
        if (slot < 0) slot = 0;
        if (slot >= subdiv) slot = subdiv - 1;
        var slotEl = beatEl.querySelectorAll('.grid-beat-slot')[slot];
        if (slotEl === lastStrumEl) return;
        if (lastStrumEl) lastStrumEl.classList.remove('on');
        lastStrumEl = slotEl;
        if (slotEl) slotEl.classList.add('on');
    }

    /* One repaint loop, driven by the metronome's audio clock. rAF is only a
     * repaint cadence; the beat is always recomputed from
     * SB.metronomePosition(), so a dropped frame cannot make the cursor drift
     * away from the clicks (the same rule the strum row follows). */
    function cursorFrame() {
        cursorRaf = null;
        if (!activeGrid || !SB.isGridMode()) return;
        var pos = SB.metronomePosition();
        if (pos === null) { clearActive(); return; }

        var chartBeats = pos - activeGrid.beatsPerBar; // one bar of count-in
        if (chartBeats < 0) {
            // The animated stage waits on the opening system during the
            // count-in, then starts advancing without ever moving the page.
            if (activeGrid.anim) showAnimSystem(0);
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
        // Pulse the current strum arrow within the playhead's beat.
        paintStrumSlot(chartBeats);
        cursorRaf = requestAnimationFrame(cursorFrame);
    }

    SB.gridOnMetronomeStart = function () {
        if (!activeGrid || !SB.isGridMode()) return;
        if (cursorRaf === null) cursorRaf = requestAnimationFrame(cursorFrame);
        // Remember the user's chosen pattern so playback following sections
        // can restore it when the metronome stops.
        activeGrid._strumSaved = SB.state.strum.pattern;
        activeGrid._strumFollowed = false;
    };

    SB.gridOnMetronomeStop = function () {
        resetCursor();
        // A stopped animated chart returns to the opening system, ready for
        // the next count-in, instead of freezing on a later section.
        if (activeGrid && activeGrid.anim) showAnimSystem(0);
        // Restore the user's strum pattern if playback followed sections.
        if (activeGrid && activeGrid._strumFollowed && activeGrid._strumSaved) {
            SB.strumSetPattern(activeGrid._strumSaved);
            activeGrid._strumFollowed = false;
            activeGrid._strumSaved = null;
        }
    };

    /* Pure beat mapping, exposed for the suite. -1 is the count-in, null is
     * past the end of the chart. */
    SB.gridBeatAt = function (pos) {
        if (!activeGrid || typeof pos !== 'number' || !isFinite(pos)) return null;
        var chart = pos - activeGrid.beatsPerBar;
        if (chart < 0) return -1;
        if (chart >= activeGrid.totalBeats) return null;
        return Math.floor(chart);
    };

    /* Which staged system a metronome position belongs to, exposed for the
     * suite. null outside the animated view or before/after the chart. */
    SB.gridSystemAt = function (pos) {
        if (!activeGrid || !activeGrid.anim) return null;
        var beat = SB.gridBeatAt(pos);
        if (beat === null || beat < 0) return null;
        return activeGrid.beatSystem[beat];
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
            lyricCount: activeGrid.lyricCount,
            mode: activeGrid.anim ? 'animate' : 'grid',
            systems: activeGrid.anim ? activeGrid.animSystems.length : null,
            activeSystem: activeGrid.anim ? activeGrid.animSystem : null,
            activeSection: activeGrid.anim && activeGrid.animSystems[activeGrid.animSystem]
                ? activeGrid.animSystems[activeGrid.animSystem].label : null
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
        // The animated view replaces content in place, so there is no page
        // distance left to consume.
        if (!activeGrid || activeGrid.anim || SB.state.chordMode !== 'grid') return null;
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
            // Never split a lyric group across systems: splitting would drop
            // the line's later chord-anchored phrases (only the first
            // sub-system renders the line). If the group is wider than the
            // screen, give it its own system and let it scroll horizontally.
            if (width > avail) {
                flush();
                systems.push(bars);
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

    function buildBarSpec(bar, song, ctx, changeState, lyricW, blockIdx, barIdx) {
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

        var x = BAR_PAD, beats = [], changeXs = [];
        segments.forEach(function (seg) {
            changeXs.push(x);
            var beatW = seg.width / seg.beats;
            for (var i = 0; i < seg.beats; i++) {
                beats.push({ x: x + i * beatW, w: beatW, index: i });
            }
            x += seg.width;
        });

        return {
            segments: segments,
            beats: beats,
            changeXs: changeXs,
            blockIdx: blockIdx,
            barIdx: barIdx,
            width: x + BAR_PAD
        };
    }

    /* One glyph for a strum slot, honouring the global notation preference
     * (arrows ↓ ↑ · or letters D U ·). Mirrors slotGlyph in js/strum.js so
     * the grid lane and the top strum row look identical. */
    function strumGlyph(ch) {
        if (ch === '-') return '\u00b7';          // middle dot for a rest
        if (SB.state.strum.notation === 'letters') return ch;   // 'D' / 'U'
        if (ch === 'D') return '\u2193';          // downward arrow
        if (ch === 'U') return '\u2191';          // upward arrow
        return '\u00b7';
    }

    /* The label shown on a bar's strum button: the overridden pattern's name
     * when the bar carries a bar-level override, otherwise "Inherit". */
    function barStrumText(song, plan, blockIdx, barIdx) {
        var id = (plan && plan.barStrums) ? plan.barStrums[SB.planBarKey(blockIdx, barIdx)] : null;
        if (!id) return 'Inherit';
        var p = SB.strumPatternFor(id, song.time || SB.DEFAULT_TIME, plan);
        return p ? p.name : id;
    }

    function updateBarStrumBtn(btn, song, plan, blockIdx, barIdx) {
        btn.textContent = barStrumText(song, plan, blockIdx, barIdx);
        var overridden = !!(plan && plan.barStrums && plan.barStrums[SB.planBarKey(blockIdx, barIdx)]);
        btn.classList.toggle('grid-bar-strum-overridden', overridden);
        btn.setAttribute('aria-pressed', overridden ? 'true' : 'false');
    }

    function buildBarEl(spec, ctx, song, plan) {
        var bar = SB.el('div', 'grid-bar');
        bar.style.width = spec.width + 'px';
        bar.style.height = ctx.barH + 'px';
        bar.dataset.block = String(spec.blockIdx);
        bar.dataset.bar = String(spec.barIdx);

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

        // Bar-level strum control: opens the bar strum editor. Read-only in
        // the animated view (no editing controls there).
        if (!ctx.animate) {
            var barStrum = SB.el('button', 'grid-bar-strum');
            barStrum.type = 'button';
            barStrum.setAttribute('aria-label', 'Bar strum');
            barStrum.dataset.block = String(spec.blockIdx);
            barStrum.dataset.bar = String(spec.barIdx);
            updateBarStrumBtn(barStrum, song, plan, spec.blockIdx, spec.barIdx);
            bar.appendChild(barStrum);
        }

        spec.beats.forEach(function (b) {
            var resolved = SB.resolveStrumAt(song, { block: spec.blockIdx, bar: spec.barIdx, beat: b.index }, plan);
            var slots = resolved.slots || '';
            var subdiv = resolved.subdiv || 1;

            var beat = SB.el('span', 'grid-beat');
            beat.style.left = b.x + 'px';
            beat.style.width = b.w + 'px';
            beat.setAttribute('data-beat-local', String(b.index));
            beat.setAttribute('data-block', String(spec.blockIdx));
            beat.setAttribute('data-bar', String(spec.barIdx));
            beat.setAttribute('data-strum-source', resolved.source || 'none');
            if (resolved.id) beat.setAttribute('data-strum-id', resolved.id);
            beat.setAttribute('data-subdiv', String(subdiv));
            beat.setAttribute('aria-label', 'Beat ' + String(b.index + 1) + ' — ' + slots);

            // The felt-beat strokes (D U / ↓ ↑ / ·), one cell per subdivision slot.
            var strokes = SB.el('span', 'grid-beat-strokes');
            for (var s = 0; s < slots.length; s++) {
                var slot = SB.el('span', 'grid-beat-slot', strumGlyph(slots[s]));
                if (slots[s] === '-') slot.classList.add('rest');
                strokes.appendChild(slot);
            }
            beat.appendChild(strokes);

            // Mark overridden beats with a visible ring (not colour alone).
            if (resolved.source === 'beat' || resolved.source === 'bar') {
                beat.classList.add('grid-beat-overridden');
            }
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

        var layerW = geom.width +
            (system.classList.contains('has-repeat-end') ? REPEAT_W : 0);
        var layer = SB.el('div', 'grid-lyrics');
        layer.style.width = layerW + 'px';
        var spaceW = measurer.width(' ');

        here.forEach(function (line) {
            var rowStart = line.x || 0;

            var segments = [], x = 0, prevRaw = '';
            line.parts.forEach(function (part) {
                var raw = String(part.text || '');
                var text = raw.replace(/\s+/g, ' ').trim();
                if (!text) return;
                var anchor = part.change == null ? null : geom.byChange[part.change];
                var rel = anchor == null ? null : anchor - rowStart;
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
                    // Always anchor at the chord change when one exists; never
                    // push a phrase right just because the previous phrase was
                    // wide. On narrow screens phrases may overflow their bars,
                    // but chord alignment is preserved.
                    start = rel == null ? natural : rel;
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
        var animate = SB.state.chordMode === 'animate';
        wrap.classList.toggle('chords-animate', animate);

        var em = SB.sheetEmPx();
        var ctx = {
            beatW: Math.max(BEAT_MIN, em * 2.0),
            labelH: Math.ceil(em * 1.35),
            // The beat row holds the felt-beat strokes plus the beat number
            // underneath, so it needs room for two lines of small text.
            beatH: Math.ceil(em * 2.2),
            gap: Math.max(10, em * 0.6),
            diagram: diagramBox(SB.state.chordSize),
            animate: animate
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
        var blocks = gridBlocksFor(song, plan);
        // The per-song edit plan supplies bar/beat strum overrides; fall back
        // to an empty plan when there is no active songbook/song.
        var sbId = SB.state.active && SB.state.active.id;
        var plan = sbId ? SB.loadPlan(sbId, song.id) : SB.emptyPlan();

        /* The animated view swaps whole systems into one stage. Build every
         * system now so its width, lyric anchoring and beat range are final;
         * only the stage's child changes while the song plays. */
        var animStage = null, animStatus = null;
        if (animate) {
            var stageWrap = SB.el('div', 'grid-animate');
            animStage = SB.el('div', 'grid-animate-stage');
            animStage.setAttribute('role', 'group');
            animStage.setAttribute('aria-label', 'Animated chord view');
            animStatus = SB.el('div', 'grid-animate-status sr-only');
            animStatus.setAttribute('aria-live', 'polite');
            wrap.appendChild(stageWrap);
            stageWrap.appendChild(animStage);
            stageWrap.appendChild(animStatus);
        }

        var beatEls = [], beatSystem = [], chordAt = [], animSystems = [];
        var lyricCount = 0;

        blocks.forEach(function (block, blockIdx) {
            var model = block.model;
            if (block.label) lyricSections.push(block.label);
            var lyricW = model ? changeWidths(model, measurer) : {};
            var changeState = { prev: null, index: -1 };
            var specs = (block.bars || []).map(function (bar, barIdx) {
                return buildBarSpec(bar, song, ctx, changeState, lyricW,
                    blockIdx, barIdx);
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
            var section = animate ? null : SB.el('div', 'grid-section');
            // One label per block in the static chart, not one per system: a
            // block that reflows onto a second line would otherwise print its
            // name twice. The animated stage labels each page because it only
            // ever shows one system.
            if (!animate && block.label) {
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
                    system.appendChild(buildBarEl(spec, ctx, song, plan));
                });
                if (block.repeat && last) {
                    system.classList.add('has-repeat-end');
                    system.appendChild(repeatSign('end', ctx.barH));
                }
                if (model) buildLyricLayer(system, geom[si], model.lines, si, avail, measurer);

                // Number the beats across the whole form. The cursor only
                // ever asks for one index, so each system keeps a range of
                // them even though the animated view mounts one at a time.
                var firstBeat = beatEls.length;
                var systemIndex = animSystems.length;
                Array.prototype.forEach.call(system.querySelectorAll('.grid-beat'), function (el, i) {
                    var idx = firstBeat + i;
                    el.dataset.beat = String(idx);
                    beatEls[idx] = el;
                    beatSystem[idx] = systemIndex;
                });
                // Every segment draws a diagram, so the current chord is the
                // change element whose segment covers the active beat. Walk
                // the specs in bar/beat order to map those ranges.
                var changeEls = system.querySelectorAll('.grid-change');
                var ci = 0, beat = firstBeat;
                bars.forEach(function (spec) {
                    spec.segments.forEach(function (seg) {
                        var changeEl = changeEls[ci++];
                        for (var k = 0; k < seg.beats; k++) chordAt[beat + k] = changeEl;
                        beat += seg.beats;
                    });
                });

                if (animate) {
                    var page = SB.el('div', 'grid-animate-page');
                    if (block.label) {
                        page.appendChild(SB.el('div', 'grid-section-label', block.label));
                    }
                    page.appendChild(system);
                    animSystems.push({ el: page, label: block.label || '' });
                } else {
                    section.appendChild(system);
                }
            });
            if (!animate) frag.appendChild(section);
        });

        measurer.done();

        if (animate) {
            /* Size lyric layers and find the tallest page. Giving the stage a
             * stable height means swapping a one-line page for a two-line one
             * cannot nudge the rest of the page (and so cannot look like a
             * scroll). */
            var maxPageH = 0;
            animSystems.forEach(function (page) {
                animStage.appendChild(page.el);
                sizeLyricLayers(page.el, em);
                maxPageH = Math.max(maxPageH, page.el.offsetHeight);
                lyricCount += page.el.querySelectorAll('.grid-lyric').length;
                animStage.removeChild(page.el);
            });
            if (maxPageH) animStage.style.minHeight = Math.ceil(maxPageH) + 'px';
        } else {
            wrap.appendChild(frag);
            sizeLyricLayers(wrap, em);
            lyricCount = wrap.querySelectorAll('.grid-lyric').length;
        }

        activeGrid = {
            song: song,
            plan: plan,
            beatsPerBar: beatsPerBar,
            totalBeats: beatEls.length,
            bpm: bpm,
            beatEls: beatEls,
            beatSystem: beatSystem,
            chordAt: chordAt,
            wrap: wrap,
            phase: 'idle',
            lyricSection: lyricSections.length ? lyricSections[0] : null,
            lyricCount: lyricCount,
            anim: animate,
            animSystems: animate ? animSystems : null,
            animStage: animStage,
            animStatus: animStatus,
            animSystem: null,
            // Saved manual strum pattern, restored when playback stops so a
            // user's choice is not overwritten by playback following sections.
            _strumSaved: null,
            _strumFollowed: false
        };
        wrap.dataset.gridPhase = 'idle';
        if (animate) showAnimSystem(0);

        if (SB.state.metronome.playing) SB.gridOnMetronomeStart();
    }

    SB.renderSheetGrid = renderSheetGrid;

    /* ---------------- grid strum editing (bar / beat overrides) ----------------
     *
     * A single fixed-position editor panel edits either a bar's strum (pick a
     * pattern for the metre, or "Inherit from section/song") or a single beat's
     * subdivision slots (each slot cycles down → up → rest, plus Inherit). The
     * animated view stays read-only: it never opens the editor. Edits are
     * persisted to the per-song edit plan (barStrums / beatStrums) and the grid
     * is rebuilt so the new strokes show immediately.
     */

    var gridEditor = null;
    var gridEditorMode = null;
    var gridEditorBlock = null;
    var gridEditorBar = null;
    var gridEditorBeat = null;

    function gridEditorEl() {
        if (!gridEditor) {
            var el = SB.el('div', 'grid-strum-editor');
            el.setAttribute('hidden', 'true');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-labelledby', 'gridEditorTitle');
            var backdrop = SB.el('div', 'grid-strum-backdrop');
            var sheet = SB.el('div', 'grid-strum-sheet');
            var head = SB.el('div', 'grid-strum-head');
            head.appendChild(SB.el('span', 'grid-strum-kicker', 'Strum'));
            var title = SB.el('h2', 'grid-strum-title');
            title.id = 'gridEditorTitle';
            title.textContent = 'Strum';
            head.appendChild(title);
            var close = SB.el('button', 'grid-strum-close', '\u00d7');
            close.type = 'button';
            close.setAttribute('aria-label', 'Close strum editor');
            head.appendChild(close);
            var body = SB.el('div', 'grid-strum-body');
            sheet.appendChild(head);
            sheet.appendChild(body);
            el.appendChild(backdrop);
            el.appendChild(sheet);
            document.body.appendChild(el);
            gridEditor = el;
            close.addEventListener('click', gridEditorClose);
            backdrop.addEventListener('click', gridEditorClose);
        }
        return gridEditor;
    }

    function gridEditorClose() {
        if (!gridEditor) return;
        gridEditor.setAttribute('hidden', 'true');
        gridEditorMode = gridEditorBlock = gridEditorBar = gridEditorBeat = null;
        if (activeGrid) {
            Array.prototype.forEach.call(activeGrid.wrap.querySelectorAll('.grid-beat.editing'), function (e) {
                e.classList.remove('editing');
            });
        }
    }

    function gridEditApply(setFn) {
        var song = activeGrid && activeGrid.song;
        if (!song) return;
        setFn();
        SB.renderSheetGrid(song);
        // Re-open the editor on the same coordinates so it reflects the new
        // plan and the edited beat/bar is re-highlighted in the rebuilt grid.
        if (gridEditorMode != null) {
            gridEditorShow(gridEditorMode, gridEditorBlock, gridEditorBar, gridEditorBeat);
        }
    }

    function gridEditorShow(mode, block, bar, beat) {
        if (activeGrid && activeGrid.anim) return;   // animated view stays read-only
        var el = gridEditorEl();
        var body = el.querySelector('.grid-strum-body');
        body.textContent = '';
        gridEditorMode = mode;
        gridEditorBlock = block;
        gridEditorBar = bar;
        gridEditorBeat = beat;
        gridEditor.removeAttribute('hidden');
        var song = activeGrid.song;
        var plan = activeGrid.plan;
        var sbId = SB.state.active && SB.state.active.id;
        var title = el.querySelector('.grid-strum-title');
        var time = song.time || SB.DEFAULT_TIME;

        if (mode === 'bar') {
            title.textContent = 'Bar ' + String(bar + 1) + ' strum';
            var cur = (plan && plan.barStrums) ? plan.barStrums[SB.planBarKey(block, bar)] : null;
            var inherit = SB.el('button', 'grid-editor-option');
            inherit.type = 'button';
            inherit.textContent = 'Inherit from section/song';
            inherit.classList.toggle('grid-editor-option-active', cur == null);
            inherit.setAttribute('aria-pressed', String(cur == null));
            inherit.addEventListener('click', function () {
                gridEditApply(function () { SB.setBarOverride(sbId, song.id, block, bar, null); });
            });
            body.appendChild(inherit);
            var list = SB.strumPatternsFor(time).slice();
            var seen = {};
            list.forEach(function (p) { seen[p.id] = true; });
            var custom = (plan && plan.customPatterns) || [];
            custom.forEach(function (p) {
                if (!seen[p.id] && patternFitsLocal(p, time)) { list.push(p); seen[p.id] = true; }
            });
            list.forEach(function (p) {
                var btn = SB.el('button', 'grid-editor-option');
                btn.type = 'button';
                btn.textContent = p.name;
                btn.classList.toggle('grid-editor-option-active', cur === p.id);
                btn.setAttribute('aria-pressed', String(cur === p.id));
                btn.addEventListener('click', (function (pid) {
                    return function () { gridEditApply(function () { SB.setBarOverride(sbId, song.id, block, bar, pid); }); };
                })(p.id));
                body.appendChild(btn);
            });
        } else if (mode === 'beat') {
            title.textContent = 'Beat ' + String(beat + 1) + ' of bar ' + String(bar + 1);
            var resolved = SB.resolveStrumAt(song, { block: block, bar: bar, beat: beat }, plan);
            var slots = (resolved.slots || '').split('');
            var subdiv = resolved.subdiv || 1;
            while (slots.length < subdiv) slots.push('-');
            var label = SB.el('span', 'grid-editor-slot-label');
            label.textContent = 'Slots — tap each to cycle down → up → rest';
            body.appendChild(label);
            var slotsWrap = SB.el('div', 'grid-editor-slots');
            for (var s = 0; s < subdiv; s++) {
                (function (s2) {
                    var ch = slots[s2] || '-';
                    var btn = SB.el('button', 'grid-editor-slot');
                    btn.type = 'button';
                    btn.textContent = strumGlyph(ch);
                    if (ch === '-') btn.classList.add('rest');
                    btn.dataset.slot = String(s2);
                    btn.addEventListener('click', function () {
                        var next = ch === 'D' ? 'U' : (ch === 'U' ? '-' : 'D');
                        var updated = slots.slice();
                        updated[s2] = next;
                        gridEditApply(function () {
                            SB.setBeatOverride(sbId, song.id, block, bar, beat, updated.join(''));
                        });
                        ch = next;   // the button text is refreshed by gridEditApply re-opening the editor
                    });
                    slotsWrap.appendChild(btn);
                })(s);
            }
            body.appendChild(slotsWrap);
            var inherit = SB.el('button', 'grid-editor-option');
            inherit.type = 'button';
            inherit.textContent = 'Inherit (clear this beat\'s override)';
            inherit.classList.toggle('grid-editor-option-active', resolved.source !== 'beat');
            inherit.setAttribute('aria-pressed', String(resolved.source !== 'beat'));
            inherit.addEventListener('click', function () {
                gridEditApply(function () { SB.setBeatOverride(sbId, song.id, block, bar, beat, null); });
            });
            body.appendChild(inherit);
            // Highlight the edited beat in the (rebuilt) grid.
            Array.prototype.forEach.call(activeGrid.wrap.querySelectorAll('.grid-beat'), function (e) {
                if (parseInt(e.dataset.block, 10) === block &&
                    parseInt(e.dataset.bar, 10) === bar &&
                    parseInt(e.dataset.beatLocal, 10) === beat) {
                    e.classList.add('editing');
                }
            });
        }
    }

    /* patternFitsLocal: validate a custom pattern definition for a metre. */
    function patternFitsLocal(p, time) {
        if (!p || !time) return false;
        var subdiv = p.subdiv;
        if (typeof subdiv !== 'number' || subdiv < 1 || subdiv !== Math.floor(subdiv)) return false;
        var slots = p.slots;
        if (typeof slots !== 'string' || !/^[DU-]+$/.test(slots)) return false;
        return slots.length === SB.metronomeBeatsPerBar(time) * subdiv;
    }

    /* Delegated clicks on the sheet: open the bar strum editor or the beat
     * editor. The animated view is read-only and ignores these. Guarded so the
     * module loads under node (tests/plan.py stubs document without
     * addEventListener). */
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', function (ev) {
            if (!activeGrid || activeGrid.anim) return;
            var btn = ev.target.closest('.grid-bar-strum');
            if (btn) {
                ev.preventDefault();
                gridEditorShow('bar', parseInt(btn.dataset.block, 10), parseInt(btn.dataset.bar, 10), 0);
                return;
            }
            var beat = ev.target.closest('.grid-beat');
            if (beat) {
                ev.preventDefault();
                gridEditorShow('beat', parseInt(beat.dataset.block, 10), parseInt(beat.dataset.bar, 10), parseInt(beat.dataset.beatLocal, 10));
            }
        });
    }

})(window.SB = window.SB || {});
