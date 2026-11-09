/* Songbook — editor
 * Step 6: structural edit mode for chords, lengths, beats, time signature,
 * bar/section structure, plus Reset.
 *
 * Edit mode works on the per-song edit plan (plan.grid / plan.time), never on
 * the imported songbook. Chords, lengths, bars and beats live in plan.grid;
 * strum overrides (plan.barStrums / plan.beatStrums) are a separate layer and
 * are never rewritten by structural edits — they are only renumbered when
 * bars or beats are inserted/removed so existing overrides keep pointing at
 * the same musical moment. A structural edit is persisted only when every bar
 * sums to the current metre; an invalid bar shows an error and is not saved.
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order set
 * by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* Canonical metres, mirrored from js/songbooks.js and chordpro.py. */
    var TIMES = ['4/4', '3/4', '6/8', '2/4'];

    /* Section roles offered to the editor, in UI order: the shared canonical
     * enum from js/sections.js, mirrored from chordpro.py and guarded by
     * tests/sections.py — one enum, not a second copy that can drift. `other`
     * is last so an unrecognised section still gets a role rather than none. */
    var ROLES = (SB.SECTION_ROLES && SB.SECTION_ROLES.slice()) || [
        'intro', 'verse', 'pre_chorus', 'chorus', 'bridge',
        'outro', 'interlude', 'solo', 'tag', 'other'];

    var ROLE_LABELS = {
        intro: 'Intro', verse: 'Verse', pre_chorus: 'Pre-chorus',
        chorus: 'Chorus', bridge: 'Bridge', outro: 'Outro',
        interlude: 'Interlude', solo: 'Solo', tag: 'Tag', other: 'Other'
    };

    var overlay = null;
    var sheet = null;

    /* Working copy of the structure being edited. Edited in memory, persisted
     * to the plan only when every bar sums to the metre. */
    var working = null;         // { time, blocks: [{label, role, bars}] }
    var workingSong = null;     // song the working copy belongs to
    var errorMessage = null;    // current validation message, or null

    /* ---------------- model helpers ---------------- */

    function beatsPerBar(time) { return SB.metronomeBeatsPerBar(time) || 4; }

    function validChord(name) {
        if (typeof name !== 'string' || !name.trim()) return false;
        if (ChordKit.isMutedName(name)) return true;
        return !!ChordKit.parse(name);
    }

    /* Deep-copy a grid block array into the editor's working shape. */
    function copyBlocks(blocks) {
        return (blocks || []).map(function (block) {
            return {
                label: String(block.label || ''),
                role: SB.isSectionRole(block.role) ? block.role : 'other',
                bars: (block.bars || []).map(function (bar) {
                    return { beats: (bar.beats || []).map(function (seg) {
                        return { chord: String(seg.chord || ''), beats: seg.beats || 1 };
                    }) };
                })
            };
        });
    }

    function blockKey(b) { return String(b); }

    /* Renumber positional strum overrides after bars/beats are inserted or
     * removed within one block. barStrums keys are block:bar, beatStrums keys
     * are block:bar:beat. Removed positions lose their overrides; later
     * positions shift down so an override stays on the same musical moment. */
    function renumberStrums(plan, blockIdx, removedBars, removedBeats) {
        var b = blockKey(blockIdx);
        var barStrums = plan.barStrums || {};
        var beatStrums = plan.beatStrums || {};
        var newBar = {}, newBeat = {};

        Object.keys(barStrums).forEach(function (key) {
            var parts = key.split(':');
            if (parts.length !== 2 || parts[0] !== b) {
                newBar[key] = barStrums[key]; return;
            }
            var barIdx = parseInt(parts[1], 10);
            if (removedBars && removedBars.has(barIdx)) return; // bar dropped
            var shift = 0;
            removedBars.forEach(function (ri) { if (ri < barIdx) shift++; });
            newBar[b + ':' + (barIdx - shift)] = barStrums[key];
        });
        plan.barStrums = newBar;

        Object.keys(beatStrums).forEach(function (key) {
            var parts = key.split(':');
            if (parts.length !== 3 || parts[0] !== b) {
                newBeat[key] = beatStrums[key]; return;
            }
            var barIdx = parseInt(parts[1], 10);
            var beatIdx = parseInt(parts[2], 10);
            var rb = removedBeats && removedBeats[barIdx];
            if (rb && rb.has(beatIdx)) return; // this beat dropped
            var barShift = 0, beatShift = 0;
            removedBars.forEach(function (ri) { if (ri < barIdx) barShift++; });
            var beatsHere = (rb || new Set());
            beatsHere.forEach(function (ei) { if (ei < beatIdx) beatShift++; });
            newBeat[(b + ':' + (barIdx - barShift) + ':' + (beatIdx - beatShift))] = beatStrums[key];
        });
        plan.beatStrums = newBeat;
    }

    /* Re-key positional strum overrides when a block is removed, so later
     * blocks' block index shifts down by one. */
    function rekeyStrumsByBlock(plan, removedBlockIdx) {
        var newBar = {}, newBeat = {};
        Object.keys(plan.barStrums || {}).forEach(function (key) {
            var parts = key.split(':');
            if (parts.length !== 2) { newBar[key] = plan.barStrums[key]; return; }
            var bi = parseInt(parts[0], 10);
            if (bi === removedBlockIdx) return;
            if (bi > removedBlockIdx) bi -= 1;
            newBar[bi + ':' + parts[1]] = plan.barStrums[key];
        });
        plan.barStrums = newBar;
        Object.keys(plan.beatStrums || {}).forEach(function (key) {
            var parts = key.split(':');
            if (parts.length !== 3) { newBeat[key] = plan.beatStrums[key]; return; }
            var bi = parseInt(parts[0], 10);
            if (bi === removedBlockIdx) return;
            if (bi > removedBlockIdx) bi -= 1;
            newBeat[bi + ':' + parts[1] + ':' + parts[2]] = plan.beatStrums[key];
        });
        plan.beatStrums = newBeat;
    }

    /* Validate every bar of the working grid sums to the metre. Returns null
     * when valid, else a user-facing message. */
    function validateWorking() {
        if (!working) return null;
        var bpb = beatsPerBar(working.time);
        for (var bi = 0; bi < working.blocks.length; bi++) {
            var block = working.blocks[bi];
            for (var ri = 0; ri < block.bars.length; ri++) {
                var total = 0;
                (block.bars[ri].beats || []).forEach(function (seg) {
                    total += seg.beats || 0;
                });
                if (total !== bpb) {
                    return 'Bar ' + String(ri + 1) + ' of "' +
                        (block.label || 'section') + '" sums to ' + String(total) +
                        ' beats, but the metre is ' + working.time +
                        ' (' + String(bpb) + ' felt beats per bar).';
                }
            }
        }
        return null;
    }

    function currentPlan() {
        if (!SB.state.active || !workingSong) return SB.emptyPlan();
        return SB.loadPlan(SB.state.active.id, workingSong.id);
    }

    /* Persist the working copy (grid + time) plus any strum renumbering already
     * applied to `plan`, but only when the grid is valid against the metre. */
    function saveWorking(plan) {
        if (!SB.state.active || !workingSong || !working) return false;
        plan = plan || currentPlan();
        errorMessage = validateWorking();
        if (errorMessage) return false;
        plan.time = working.time;
        plan.grid = copyBlocks(working.blocks);
        SB.savePlan(SB.state.active.id, workingSong.id, plan);
        renderSheet();
        if (SB.updateEditUi) SB.updateEditUi();
        return true;
    }

    function renderSheet() {
        if (SB.state.currentSong && SB.renderSheetGrid) {
            var plan = currentPlan();
            SB.renderSheetGrid(SB.state.currentSong, plan);
        }
    }

    function applyChange(fn) {
        if (!working) return;
        var plan = currentPlan();
        fn(plan);
        saveWorking(plan);
        renderPanel();
    }

    /* ---------------- panel rendering ---------------- */

    function renderPanel() {
        if (!overlay || !sheet) return;
        var body = sheet.querySelector('.editor-body');
        if (!body) return;
        body.textContent = '';

        var err = SB.el('p', 'editor-error', errorMessage || '');
        err.hidden = !errorMessage;
        err.setAttribute('aria-live', 'assertive');
        body.appendChild(err);

        var timeWrap = SB.el('div', 'editor-field');
        var timeLabel = SB.el('label', null, 'Time signature');
        timeWrap.appendChild(timeLabel);
        var timeSel = SB.el('select', 'editor-time');
        TIMES.forEach(function (t) {
            var o = SB.el('option', null, t);
            o.value = t;
            if (t === working.time) o.selected = true;
            timeSel.appendChild(o);
        });
        timeSel.addEventListener('change', function () {
            applyChange(function (plan) {
                working.time = timeSel.value;
                // Changing the metre may make existing bars invalid; validation
                // in saveWorking decides whether it sticks.
            });
        });
        timeWrap.appendChild(timeSel);
        body.appendChild(timeWrap);

        working.blocks.forEach(function (block, bi) {
            var section = SB.el('div', 'editor-section');
            var head = SB.el('div', 'editor-section-head');
            var roleSel = SB.el('select', 'editor-role');
            ROLES.forEach(function (r) {
                var o = SB.el('option', null, ROLE_LABELS[r]);
                o.value = r;
                if (r === block.role) o.selected = true;
                roleSel.appendChild(o);
            });
            roleSel.addEventListener('change', function () {
                block.role = roleSel.value;
                saveWorking(currentPlan());
                renderPanel();
            });
            var labelInput = SB.el('input', 'editor-section-label');
            labelInput.type = 'text';
            labelInput.value = block.label;
            labelInput.placeholder = 'Section name';
            labelInput.addEventListener('change', function () {
                block.label = labelInput.value.trim();
                saveWorking(currentPlan());
            });
            var rmSec = SB.el('button', 'editor-remove-section', 'Remove section');
            rmSec.type = 'button';
            rmSec.setAttribute('aria-label', 'Remove this section');
            rmSec.addEventListener('click', function () {
                applyChange(function (plan) {
                    if (working.blocks.length <= 1) return;
                    working.blocks.splice(bi, 1);
                    rekeyStrumsByBlock(plan, bi);
                });
            });
            head.appendChild(SB.el('span', 'editor-section-kicker', 'Section'));
            head.appendChild(roleSel);
            head.appendChild(labelInput);
            head.appendChild(rmSec);
            section.appendChild(head);

            block.bars.forEach(function (bar, ri) {
                var barEl = SB.el('div', 'editor-bar');
                var beatsWrap = SB.el('div', 'editor-beats');
                (bar.beats || []).forEach(function (seg, ei) {
                    var beat = SB.el('div', 'editor-beat');
                    var chordIn = SB.el('input', 'editor-chord');
                    chordIn.type = 'text';
                    chordIn.value = seg.chord;
                    chordIn.placeholder = 'Chord';
                    chordIn.title = 'Chord name';
                    chordIn.addEventListener('change', function () {
                        var v = chordIn.value.trim();
                        if (!validChord(v)) {
                            chordIn.classList.add('editor-invalid');
                            return;
                        }
                        chordIn.classList.remove('editor-invalid');
                        seg.chord = v;
                        saveWorking(currentPlan());
                    });
                    chordIn.addEventListener('blur', function () {
                        chordIn.classList.remove('editor-invalid');
                    });
                    var lenWrap = SB.el('span', 'editor-length-wrap');
                    var lenLabel = SB.el('span', 'editor-beat-len', '×' + String(seg.beats || 1));
                    var lenIn = SB.el('input', 'editor-length');
                    lenIn.type = 'number';
                    lenIn.min = '1';
                    lenIn.value = String(seg.beats || 1);
                    lenIn.title = 'Felt beats';
                    lenIn.addEventListener('change', function () {
                        var v = parseInt(lenIn.value, 10);
                        if (!(v >= 1)) { lenIn.value = String(seg.beats || 1); return; }
                        seg.beats = v;
                        saveWorking(currentPlan());
                    });
                    lenWrap.appendChild(lenLabel);
                    lenWrap.appendChild(lenIn);
                    var rmBeat = SB.el('button', 'editor-remove-beat', '\u00d7');
                    rmBeat.type = 'button';
                    rmBeat.setAttribute('aria-label', 'Remove beat ' + String(ei + 1));
                    rmBeat.addEventListener('click', function () {
                        applyChange(function (plan) {
                            var beats = working.blocks[bi].bars[ri].beats;
                            if (beats.length <= 1) return;
                            var removed = new Set([ei]);
                            beats.splice(ei, 1);
                            renumberStrums(plan, bi, new Set(), { ri: removed });
                        });
                    });
                    beat.appendChild(chordIn);
                    beat.appendChild(lenWrap);
                    beat.appendChild(rmBeat);
                    beatsWrap.appendChild(beat);
                });
                var addBeat = SB.el('button', 'editor-add-beat', '+ beat');
                addBeat.type = 'button';
                addBeat.setAttribute('aria-label', 'Add a beat to this bar');
                addBeat.addEventListener('click', function () {
                    applyChange(function (plan) {
                        // Added at the end: inherits (no override), nothing shifts.
                        working.blocks[bi].bars[ri].beats.push({ chord: '', beats: 1 });
                    });
                });
                var rmBar = SB.el('button', 'editor-remove-bar', 'Remove bar');
                rmBar.type = 'button';
                rmBar.setAttribute('aria-label', 'Remove this bar');
                rmBar.addEventListener('click', function () {
                    applyChange(function (plan) {
                        var removedBars = new Set([ri]);
                        working.blocks[bi].bars.splice(ri, 1);
                        renumberStrums(plan, bi, removedBars, null);
                    });
                });
                barEl.appendChild(beatsWrap);
                barEl.appendChild(addBeat);
                barEl.appendChild(rmBar);
                section.appendChild(barEl);
            });

            var addBar = SB.el('button', 'editor-add-bar', '+ bar');
            addBar.type = 'button';
            addBar.setAttribute('aria-label', 'Add a bar to this section');
            addBar.addEventListener('click', function () {
                applyChange(function (plan) {
                    working.blocks[bi].bars.push({ beats: [{ chord: '', beats: beatsPerBar(working.time) }] });
                });
            });
            section.appendChild(addBar);
            body.appendChild(section);
        });

        var addSec = SB.el('button', 'editor-add-section', '+ section');
        addSec.type = 'button';
        addSec.setAttribute('aria-label', 'Add a new section');
        addSec.addEventListener('click', function () {
            applyChange(function (plan) {
                working.blocks.push({ label: '', role: 'other',
                    bars: [{ beats: [{ chord: '', beats: beatsPerBar(working.time) }] }] });
            });
        });
        body.appendChild(addSec);

        var note = SB.el('p', 'editor-hint');
        note.textContent = 'Chords, lengths, bars and beats are stored in this song\'s edit plan. ' +
            'Strum overrides are untouched by structural edits. Reset clears all local edits.';
        body.appendChild(note);
    }

    /* ---------------- overlay ---------------- */

    function editorEl() {
        if (!overlay) {
            var el = SB.el('div', 'structure-editor');
            el.setAttribute('hidden', 'true');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-labelledby', 'editorTitle');
            var backdrop = SB.el('div', 'structure-backdrop');
            var sh = SB.el('div', 'structure-sheet');
            var head = SB.el('div', 'structure-head');
            head.appendChild(SB.el('span', 'structure-kicker', 'Edit'));
            var title = SB.el('h2', 'structure-title');
            title.id = 'editorTitle';
            title.textContent = 'Edit structure';
            head.appendChild(title);
            var close = SB.el('button', 'structure-close', '\u00d7');
            close.type = 'button';
            close.setAttribute('aria-label', 'Close structure editor');
            head.appendChild(close);
            var body = SB.el('div', 'editor-body');
            sh.appendChild(head);
            sh.appendChild(body);
            el.appendChild(backdrop);
            el.appendChild(sh);
            document.body.appendChild(el);
            overlay = el;
            sheet = sh;
            close.addEventListener('click', closeEditor);
            backdrop.addEventListener('click', closeEditor);
        }
        return overlay;
    }

    function closeEditor() {
        if (!overlay) return;
        overlay.setAttribute('hidden', 'true');
        document.body.classList.remove('structure-open');
        if (SB.updateEditUi) SB.updateEditUi();
    }

    function openEditor() {
        if (!SB.state.active || !SB.state.currentSong) return;
        var el = editorEl();
        el.removeAttribute('hidden');
        document.body.classList.add('structure-open');
        workingSong = SB.state.currentSong;
        var plan = currentPlan();
        var source = (plan.grid && plan.grid.length) ? plan.grid :
            (SB.state.currentSong.grid && SB.state.currentSong.grid.length)
                ? SB.state.currentSong.grid : null;
        var base = source ? copyBlocks(source) : null;
        if (!base && SB.gridBlocksFor) {
            var derived = SB.gridBlocksFor(SB.state.currentSong, {
                grid: null, time: plan.time || SB.state.currentSong.time || SB.DEFAULT_TIME
            });
            base = derived.map(function (b) {
                return { label: b.label || '', role: b.role || 'other',
                    bars: (b.bars || []).map(function (bar) {
                        return { beats: (bar.beats || []).map(function (seg) {
                            return { chord: seg.chord, beats: seg.beats };
                        }) };
                    }) };
            });
        }
        var time = plan.time || SB.state.currentSong.time || SB.DEFAULT_TIME;
        working = {
            time: time,
            blocks: base || [{ label: '', role: 'other',
                bars: [{ beats: [{ chord: '', beats: beatsPerBar(time) }] }] }]
        };
        workingSong = SB.state.currentSong;
        errorMessage = null;
        renderPanel();
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }

    /* ---------------- public API ---------------- */

    SB.isEditing = function () { return !!SB.state.editMode; };

    SB.toggleEdit = function () {
        SB.state.editMode = !SB.state.editMode;
        if (SB.updateEditUi) SB.updateEditUi();
        if (SB.state.editMode) openEditor();
        else closeEditor();
        if (SB.state.currentSong) {
            SB.renderChordStrip(SB.state.currentSong);
            renderSheet();
        }
    };

    SB.resetStructure = function () {
        if (!SB.state.active || !SB.state.currentSong) return false;
        var sbId = SB.state.active.id;
        var songId = SB.state.currentSong.id;
        if (!SB.hasLocalEdits(sbId, songId)) return false;
        if (!confirm('Reset “' + String(SB.state.currentSong.title || 'this song') +
            '” to its songbook version? This clears all local strum, pattern ' +
            'and structure edits.')) return false;
        SB.clearPlan(sbId, songId);
        SB.state.editMode = false;
        working = null;
        workingSong = null;
        if (SB.updateEditUi) SB.updateEditUi();
        closeEditor();
        if (SB.loadStrumForSong) SB.loadStrumForSong(SB.state.currentSong);
        renderSheet();
        return true;
    };

    SB.editHasChanges = function () {
        if (!SB.state.active || !SB.state.currentSong) return false;
        return SB.hasLocalEdits(SB.state.active.id, SB.state.currentSong.id);
    };

    SB.editError = function () { return errorMessage; };

    /* Reflect edit mode and whether there are local edits on the toolbar
     * buttons (Edit pressed state, Reset disabled/visible state). Called on
     * boot, on song change and whenever edit state changes. */
    SB.updateEditUi = function () {
        var editBtn = SB.$('editBtn');
        var resetBtn = SB.$('resetBtn');
        if (editBtn) {
            editBtn.setAttribute('aria-pressed', SB.state.editMode ? 'true' : 'false');
            editBtn.classList.toggle('active', SB.state.editMode);
            editBtn.textContent = SB.state.editMode ? 'Edit ▸' : 'Edit';
            editBtn.title = SB.state.editMode
                ? 'Structure editing is on — open the panel above to change chords, bars and metre'
                : 'Structure editing is off — structure is read-only in play mode';
        }
        if (resetBtn) {
            var hasEdits = SB.editHasChanges();
            resetBtn.disabled = !hasEdits;
            resetBtn.hidden = !hasEdits;
            resetBtn.title = hasEdits
                ? 'Reset this song to its songbook version (clears local strum and structure edits)'
                : 'No local edits to reset';
        }
    };

    /* Trap Tab/Escape inside the editor overlay. */
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('keydown', function (e) {
            if (!overlay || overlay.hidden) return;
            if (e.key === 'Escape') { e.preventDefault(); closeEditor(); return; }
            if (e.key !== 'Tab') return;
            var focusables = Array.prototype.filter.call(
                sheet.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
                function (el) { return !el.disabled && !el.hidden && el.offsetParent !== null; });
            if (!focusables.length) { e.preventDefault(); return; }
            var first = focusables[0], last = focusables[focusables.length - 1];
            var active = document.activeElement;
            if (!active || active === overlay || !sheet.contains(active)) { e.preventDefault(); first.focus(); return; }
            if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        });
    }

})(window.SB = window.SB || {});
