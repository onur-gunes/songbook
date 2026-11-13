/* Songbook — author
 * creating, editing and duplicating songbooks from inside the app
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order set
 * by index.html; it depends on the authoring helpers in js/songbooks.js and on
 * the routing helpers. Authoring writes only ever target imported books;
 * bundled books stay read-only unless duplicated into an imported copy.
 */
(function (SB) {
    'use strict';

    var lastFocus = null;

    /* Authoring outcomes belong on one polite live region, not in a blocking
     * alert: the batch summary is the primary success feedback for adding
     * songs, and it should not interrupt a screen reader or steal focus. */
    function setAuthorStatus(message, isError) {
        var box = SB.$('authorStatus');
        if (!box) return;
        box.textContent = message || '';
        box.classList.toggle('is-error', !!message && !!isError);
    }
    SB.setAuthorStatus = setAuthorStatus;

    function overlay() { return SB.$('newBookOverlay'); }

    /* Keep Tab inside the open authoring dialog, like the pattern editor and
     * the structure editor do. Without this, Tab can land on controls behind
     * the overlay even though the dialog is marked aria-modal. */
    function trapFocus(event, sheetId) {
        if (event.key !== 'Tab') return false;
        var sheet = SB.$(sheetId);
        if (!sheet) return false;
        var focusables = Array.prototype.filter.call(
            sheet.querySelectorAll(
                'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
            function (el) {
                return !el.disabled && !el.hidden && el.offsetParent !== null;
            });
        if (!focusables.length) {
            event.preventDefault();
            return true;
        }
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var active = document.activeElement;
        if (!active || active === sheet || !sheet.contains(active)) {
            event.preventDefault();
            first.focus();
            return true;
        }
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
            return true;
        }
        if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
            return true;
        }
        return false;
    }

    function setError(message) {
        var box = SB.$('newBookError');
        if (!box) return;
        box.textContent = message || '';
        box.hidden = !message;
        if (message) {
            try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
        }
    }

    function open() {
        var el = overlay();
        if (!el) return;
        lastFocus = document.activeElement;
        setError('');
        var form = SB.$('newBookForm');
        if (form) form.reset();
        var instrument = SB.$('newBookInstrument');
        if (instrument) {
            instrument.value = SB.state.instrument === 'guitar' ? 'guitar' : 'ukulele';
        }
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        document.body.classList.add('pattern-open');
        var name = SB.$('newBookName');
        if (name) {
            try { name.focus({ preventScroll: true }); } catch (e) { name.focus(); }
        }
    }

    /* `restore` is false after a successful create: the opener may be the
     * first-run empty state, which is hidden by then, so focus belongs on the
     * new book's picker instead. */
    function close(restore) {
        var el = overlay();
        if (!el) return;
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('pattern-open');
        if (restore !== false && lastFocus && lastFocus.focus) {
            try { lastFocus.focus({ preventScroll: true }); } catch (e) { lastFocus.focus(); }
        }
    }

    function submit(event) {
        event.preventDefault();
        var nameInput = SB.$('newBookName');
        var name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            setError('Enter a name for the songbook.');
            if (nameInput) nameInput.focus();
            return;
        }
        var button = SB.$('newBookCreate');
        if (button) button.disabled = true;
        var description = SB.$('newBookDescription');
        var instrument = SB.$('newBookInstrument');
        SB.createSongbook({
            name: name,
            description: description ? description.value : '',
            instrument: instrument ? instrument.value : SB.state.instrument
        }).then(function (sb) {
            close(false);
            var hash = SB.routeHash(sb.id);
            if (location.hash === hash) SB.route();
            else location.hash = hash;
            var picker = SB.$('songbookSelect');
            if (picker) {
                try { picker.focus({ preventScroll: true }); } catch (e) { picker.focus(); }
            }
        }, function (err) {
            setError(err.message || 'Could not create the songbook.');
        }).then(function () {
            if (button) button.disabled = false;
        });
    }

    /* ---------------- add songs ---------------- */

    var addLastFocus = null;
    var addSources = [];
    /* Reading files is async, so a slow read must not paint over a newer
     * preview after the user has changed the textarea or picked other files. */
    var addPreviewSeq = 0;
    /* True while the current preview is still being read/parsed. Add is
     * disabled meanwhile: addSources describes the *previous* input until the
     * batch resolves, so submitting would add the wrong songs. */
    var addReading = false;

    function addOverlay() { return SB.$('addSongOverlay'); }

    function setAddError(message) {
        var box = SB.$('addSongError');
        if (!box) return;
        box.textContent = message || '';
        box.hidden = !message;
        if (message) {
            try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
        }
    }

    function readAddFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result)); };
            reader.onerror = function () { reject(new Error('could not read file')); };
            reader.readAsText(file);
        });
    }

    /* Parsing a source is also its preview: the normalized song is exactly
     * what will be stored, so the counts the user sees cannot drift from the
     * chart they get. A blank source or a missing title is fatal because the
     * build rejects those songs; parser warnings stay warnings. */
    function parseAddSource(name, text) {
        var source = String(text == null ? '' : text);
        if (!source.trim()) return { name: name, ok: false, reason: 'empty file' };
        var parsed;
        try {
            parsed = SB.parseChordPro(source, { number: 1, allowTrustedNotes: false });
        } catch (err) {
            return { name: name, ok: false, reason: err.message || 'could not parse ChordPro' };
        }
        if (!parsed.song.title || !String(parsed.song.title).trim()) {
            return { name: name, ok: false, reason: 'missing {title}' };
        }
        var song;
        try {
            song = SB.normalizeSongbook({
                id: 'preview', name: 'Preview', songs: [parsed.song]
            }).songs[0];
        } catch (err) {
            return { name: name, ok: false, reason: err.message || 'invalid song' };
        }
        song.chordpro = source.trim();
        return { name: name, ok: true, song: song, warnings: parsed.warnings || [] };
    }

    function gridCounts(song) {
        if (!SB.gridBlocksFor) return null;
        try {
            var blocks = SB.gridBlocksFor(song, null);
            var bars = blocks.reduce(function (sum, block) {
                return sum + (block.bars || []).length;
            }, 0);
            return { sections: blocks.length, bars: bars };
        } catch (e) {
            return null;
        }
    }

    function previewMeta(song) {
        var parts = [
            song.time || '—',
            song.bpm ? song.bpm + ' bpm' : '— bpm',
            song.strum || 'no strum'
        ];
        var counts = gridCounts(song);
        if (counts) {
            parts.push(counts.sections + (counts.sections === 1 ? ' section' : ' sections'));
            parts.push(counts.bars + (counts.bars === 1 ? ' bar' : ' bars'));
        }
        return parts.join(' · ');
    }

    function renderSourceList(list, sources) {
        list.textContent = '';
        sources.forEach(function (source) {
            var li = SB.el('li', 'add-song-item' + (source.ok ? '' : ' is-error'));
            var head = SB.el('p', 'add-song-item-head');
            head.appendChild(SB.el('span', 'add-song-item-title',
                source.ok ? source.song.title : source.name));
            if (source.ok && source.song.artist) {
                head.appendChild(SB.el('span', 'add-song-item-artist', source.song.artist));
            } else if (!source.ok) {
                head.appendChild(SB.el('span', 'add-song-item-artist', source.name));
            }
            li.appendChild(head);

            if (!source.ok) {
                li.appendChild(SB.el('p', 'add-song-item-error', source.reason));
            } else {
                li.appendChild(SB.el('p', 'add-song-meta', previewMeta(source.song)));
                if (source.warnings.length) {
                    var warnings = SB.el('ul', 'add-song-warnings');
                    source.warnings.forEach(function (warning) {
                        warnings.appendChild(SB.el('li', null, warning));
                    });
                    li.appendChild(warnings);
                }
            }
            list.appendChild(li);
        });
    }

    function renderAddPreview() {
        var box = SB.$('addSongPreview');
        var list = SB.$('addSongPreviewList');
        var button = SB.$('addSongAdd');
        if (!box || !list) return;
        list.textContent = '';
        if (!addSources.length) {
            box.hidden = true;
            if (button) button.disabled = true;
            return;
        }
        box.hidden = false;
        /* Keep Add enabled even when every source is bad: submitting is how a
         * keyboard user reaches the announced explanation. But never while the
         * batch is still being read — the preview still describes old input. */
        if (button) button.disabled = addReading;
        renderSourceList(list, addSources);
    }

    function refreshAddPreview() {
        var seq = ++addPreviewSeq;
        /* Editing the input clears a previous submit error: it described the
         * sources as they were, not the ones now in the preview. */
        setAddError('');
        var textarea = SB.$('addSongText');
        var fileInput = SB.$('addSongFile');
        var text = textarea ? textarea.value : '';
        var files = fileInput ? Array.prototype.slice.call(fileInput.files || []) : [];
        var jobs = [];
        if (text.trim()) jobs.push(Promise.resolve({ name: 'Pasted text', text: text }));
        files.forEach(function (file) {
            jobs.push(readAddFile(file).then(function (content) {
                return { name: file.name, text: content };
            }, function () {
                return { name: file.name, error: 'could not read file' };
            }));
        });
        if (!jobs.length) {
            addReading = false;
            addSources = [];
            renderAddPreview();
            return;
        }
        addReading = true;
        var add = SB.$('addSongAdd');
        if (add) add.disabled = true;
        Promise.all(jobs).then(function (entries) {
            if (seq !== addPreviewSeq) return;
            addReading = false;
            addSources = entries.map(function (entry) {
                if (entry.error) return { name: entry.name, ok: false, reason: entry.error };
                return parseAddSource(entry.name, entry.text);
            });
            renderAddPreview();
        });
    }

    function openAddSongs() {
        var el = addOverlay();
        if (!el) return;
        var book = SB.state.active;
        if (!book || !book.imported) return;
        addLastFocus = document.activeElement;
        addSources = [];
        addReading = false;
        addPreviewSeq += 1;
        setAddError('');
        var form = SB.$('addSongForm');
        if (form) form.reset();
        var box = SB.$('addSongPreview');
        if (box) box.hidden = true;
        var list = SB.$('addSongPreviewList');
        if (list) list.textContent = '';
        var add = SB.$('addSongAdd');
        if (add) add.disabled = true;
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        document.body.classList.add('pattern-open');
        var textarea = SB.$('addSongText');
        if (textarea) {
            try { textarea.focus({ preventScroll: true }); } catch (e) { textarea.focus(); }
        }
    }

    /* After a successful add the opener may have been the zero-song empty
     * state, which is gone by then; focus belongs on the bar's Add button when
     * edit mode keeps it visible, and on the edit toggle otherwise. */
    function closeAddSongs(restore) {
        var el = addOverlay();
        if (!el) return;
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('pattern-open');
        addPreviewSeq += 1;
        addReading = false;
        if (restore === false) {
            /* Add is an edit-mode action now, so after adding to a read-only
             * list the surviving affordance is the edit toggle. */
            var add = SB.$('addSongBtn');
            if (add && !add.hidden) {
                try { add.focus({ preventScroll: true }); } catch (e) { add.focus(); }
            } else {
                var edit = SB.$('editBookBtn');
                if (edit && !edit.hidden) {
                    try { edit.focus({ preventScroll: true }); } catch (e) { edit.focus(); }
                }
            }
            return;
        }
        if (addLastFocus && addLastFocus.focus) {
            try { addLastFocus.focus({ preventScroll: true }); } catch (e) { addLastFocus.focus(); }
        }
    }

    function describeFailure(source) {
        return source.name + ' — ' + source.reason;
    }

    function submitAddSongs(event) {
        event.preventDefault();
        if (addReading) {
            setAddError('Still reading the selected files — try again in a moment.');
            return;
        }
        var good = addSources.filter(function (source) { return source.ok; });
        var bad = addSources.filter(function (source) { return !source.ok; });
        if (!addSources.length) {
            setAddError('Paste ChordPro or choose a file first.');
            return;
        }
        if (!good.length) {
            setAddError('Nothing added: ' + bad.map(describeFailure).join('; '));
            return;
        }
        var book = SB.state.active;
        if (!book || !book.imported) {
            setAddError('Only imported songbooks can be edited.');
            return;
        }
        var button = SB.$('addSongAdd');
        if (button) button.disabled = true;
        SB.addSongsToBook(book, good.map(function (source) { return source.song; }))
            .then(function () {
                closeAddSongs(false);
                var summary = good.length + ' added';
                if (bad.length) {
                    summary += ', ' + bad.length + ' failed: '
                        + bad.map(describeFailure).join('; ');
                }
                setAuthorStatus(summary);
            }, function (err) {
                setAddError(err.message || 'Could not add the songs.');
                if (button) button.disabled = false;
            });
    }

    SB.openAddSongs = openAddSongs;
    SB.closeAddSongs = closeAddSongs;

    /* ---------------- edit source ---------------- */

    var editLastFocus = null;
    var editSong = null;

    function editOverlay() { return SB.$('editSourceOverlay'); }

    function setEditError(message) {
        var box = SB.$('editSourceError');
        if (!box) return;
        box.textContent = message || '';
        box.hidden = !message;
        if (message) {
            try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
        }
    }

    function findActiveSong(songId) {
        var book = SB.state.active;
        if (!book) return null;
        for (var i = 0; i < book.songs.length; i++) {
            if (book.songs[i].id === songId) return book.songs[i];
        }
        return null;
    }

    /* Re-parsing the whole source on every keystroke is the preview: the user
     * sees exactly the song Save would store, including any warnings. */
    function refreshEditPreview() {
        var textarea = SB.$('editSourceText');
        var box = SB.$('editSourcePreview');
        var list = SB.$('editSourcePreviewList');
        if (!textarea || !editSong) return;
        setEditError('');
        if (!textarea.value.trim()) {
            if (box) box.hidden = true;
            if (list) list.textContent = '';
            return;
        }
        var result = parseAddSource('Source', textarea.value);
        if (box) box.hidden = false;
        if (list) renderSourceList(list, [result]);
    }

    function openEditSource(songId) {
        var el = editOverlay();
        if (!el) return;
        var book = SB.state.active;
        if (!book || !book.imported) return;
        var song = findActiveSong(songId);
        if (!song) return;

        editLastFocus = document.activeElement;
        editSong = song;
        setEditError('');
        var heading = SB.$('editSourceSong');
        if (heading) {
            heading.textContent = song.title + (song.artist ? ' — ' + song.artist : '');
        }

        var hasSource = typeof song.chordpro === 'string' && !!song.chordpro.trim();
        var field = SB.$('editSourceField');
        var unavailable = SB.$('editSourceUnavailable');
        var save = SB.$('editSourceSave');
        var cancel = SB.$('editSourceCancel');
        var textarea = SB.$('editSourceText');
        var preview = SB.$('editSourcePreview');
        var list = SB.$('editSourcePreviewList');

        if (field) field.hidden = !hasSource;
        if (unavailable) unavailable.hidden = hasSource;
        if (save) {
            save.hidden = !hasSource;
            save.disabled = false;
        }
        if (cancel) cancel.textContent = hasSource ? 'Cancel' : 'Close';
        if (textarea) textarea.value = hasSource ? song.chordpro : '';
        if (preview) preview.hidden = true;
        if (list) list.textContent = '';

        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        document.body.classList.add('pattern-open');
        if (hasSource) {
            refreshEditPreview();
            if (textarea) {
                try { textarea.focus({ preventScroll: true }); } catch (e) { textarea.focus(); }
            }
        } else if (unavailable) {
            try { unavailable.focus({ preventScroll: true }); } catch (e) { unavailable.focus(); }
        }
    }

    function closeEditSource(restore) {
        var el = editOverlay();
        if (!el) return;
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('pattern-open');
        editSong = null;
        if (restore !== false && editLastFocus && editLastFocus.focus) {
            try { editLastFocus.focus({ preventScroll: true }); } catch (e) { editLastFocus.focus(); }
        }
    }

    function submitEditSource(event) {
        event.preventDefault();
        if (!editSong) return;
        if (!(typeof editSong.chordpro === 'string' && editSong.chordpro.trim())) return;
        var textarea = SB.$('editSourceText');
        var source = textarea ? textarea.value : '';
        var result = parseAddSource('Source', source);
        if (!result.ok) {
            setEditError('Could not save: ' + result.reason);
            return;
        }
        var songId = editSong.id;
        var button = SB.$('editSourceSave');
        if (button) button.disabled = true;
        SB.updateSongInBook(SB.state.active, songId, result.song).then(function () {
            closeEditSource(false);
            focusRowAction(songId, 'edit');
            setAuthorStatus('Updated “' + result.song.title + '”.');
        }, function (err) {
            setEditError(err.message || 'Could not save the source.');
            if (button) button.disabled = false;
        });
    }

    /* After a re-render the old buttons are gone, so focus is restored by song
     * id. A disabled target (the first row's Move up, say) falls back to Edit. */
    function focusRowAction(songId, action) {
        var rows = document.querySelectorAll('#songList .song-row');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].dataset.id !== songId) continue;
            var target = rows[i].querySelector('[data-action="' + action + '"]');
            if (!target || target.disabled) {
                target = rows[i].querySelector('[data-action="edit"]');
            }
            if (target) {
                try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
            }
            return;
        }
    }

    SB.editSongSource = function (songId) {
        resetRemoveConfirm();
        openEditSource(songId);
    };
    SB.closeEditSource = closeEditSource;

    SB.moveSongInList = function (songId, delta) {
        var book = SB.state.active;
        if (!book || !book.imported) return;
        resetRemoveConfirm();
        SB.moveSongInBook(book, songId, delta).then(function () {
            focusRowAction(songId, delta < 0 ? 'up' : 'down');
        }, function (err) {
            setAuthorStatus('Could not move the song: ' + err.message, true);
        });
    };

    /* Removing is destructive and has no undo, but a blocking confirm() would
     * be the only modal in an otherwise inline authoring flow. The row's own
     * Remove button asks instead: the first press arms it ("Confirm") and
     * announces what to do, the second performs the removal. Escape, the
     * timeout, or any other row action backs out. */
    var pendingRemove = null;
    var pendingRemoveTimer = null;

    function removeButton(songId) {
        var rows = document.querySelectorAll('#songList .song-row');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].dataset.id === songId) {
                return rows[i].querySelector('[data-action="remove"]');
            }
        }
        return null;
    }

    function armRemoveButton(button, on) {
        if (!button) return;
        var label = button.querySelector('.row-action-label');
        if (on) {
            button.dataset.baseLabel = button.getAttribute('aria-label') || '';
            button.dataset.baseText = label ? label.textContent : '';
            button.classList.add('is-confirming');
            button.setAttribute('aria-label', 'Confirm removing this song from the songbook');
            if (label) label.textContent = 'Confirm';
        } else {
            button.classList.remove('is-confirming');
            if (button.dataset.baseLabel) {
                button.setAttribute('aria-label', button.dataset.baseLabel);
            }
            if (label && button.dataset.baseText) label.textContent = button.dataset.baseText;
            delete button.dataset.baseLabel;
            delete button.dataset.baseText;
        }
    }

    function resetRemoveConfirm() {
        if (pendingRemoveTimer !== null) {
            window.clearTimeout(pendingRemoveTimer);
            pendingRemoveTimer = null;
        }
        if (pendingRemove === null) return;
        armRemoveButton(removeButton(pendingRemove), false);
        pendingRemove = null;
        setAuthorStatus('');
    }

    SB.removeSongFromList = function (songId) {
        var book = SB.state.active;
        if (!book || !book.imported) return;
        var song = findActiveSong(songId);
        if (!song) return;
        if (pendingRemove !== songId) {
            resetRemoveConfirm();
            pendingRemove = songId;
            armRemoveButton(removeButton(songId), true);
            setAuthorStatus('Remove “' + song.title + '” from “' + book.name
                + '”? Its notes, favourite and local edits are removed too.'
                + ' Press Confirm, or Escape to cancel.');
            pendingRemoveTimer = window.setTimeout(resetRemoveConfirm, 8000);
            return;
        }
        resetRemoveConfirm();

        var index = book.songs.indexOf(song);
        var neighbor = book.songs[index + 1] || book.songs[index - 1] || null;
        var last = book.songs.length === 1;
        SB.removeSongFromBook(book, songId).then(function () {
            setAuthorStatus('Removed “' + song.title + '” from “' + book.name + '”.');
            if (last) {
                var emptyAdd = SB.$('emptyAddSongBtn');
                var add = SB.$('addSongBtn');
                var target = (emptyAdd && !emptyAdd.hidden) ? emptyAdd : add;
                if (target && !target.hidden) {
                    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
                }
            } else if (neighbor) {
                focusRowAction(neighbor.id, 'remove');
            }
        }, function (err) {
            setAuthorStatus('Could not remove the song: ' + err.message, true);
        });
    };

    SB.resetRemoveConfirm = resetRemoveConfirm;

    /* Duplicate works on bundled books too; the new book is imported and the
     * source is never written. */
    SB.duplicateActiveSongbook = function () {
        resetRemoveConfirm();
        var book = SB.state.active;
        if (!book) return;
        var button = SB.$('duplicateBookBtn');
        if (button) button.disabled = true;
        SB.duplicateSongbook(book).then(function (copy) {
            var hash = SB.routeHash(copy.id);
            if (location.hash === hash) SB.route();
            else location.hash = hash;
            var picker = SB.$('songbookSelect');
            if (picker) {
                try { picker.focus({ preventScroll: true }); } catch (e) { picker.focus(); }
            }
            setAuthorStatus('Duplicated as “' + copy.name + '”.');
        }, function (err) {
            setAuthorStatus('Could not duplicate the songbook: ' + err.message, true);
        }).then(function () {
            if (button) button.disabled = false;
        });
    };

    SB.openNewSongbook = open;
    SB.closeNewSongbook = close;

    SB.bindAuthorControls = function () {
        var newBtn = SB.$('newSongbookBtn');
        if (newBtn) newBtn.addEventListener('click', open);
        var emptyBtn = SB.$('emptyNewSongbookBtn');
        if (emptyBtn) emptyBtn.addEventListener('click', open);
        var addBtn = SB.$('addSongBtn');
        if (addBtn) addBtn.addEventListener('click', openAddSongs);
        var emptyAddBtn = SB.$('emptyAddSongBtn');
        if (emptyAddBtn) emptyAddBtn.addEventListener('click', openAddSongs);
        var duplicateBtn = SB.$('duplicateBookBtn');
        if (duplicateBtn) duplicateBtn.addEventListener('click', SB.duplicateActiveSongbook);

        /* The toggle flips a per-book, session-scoped task mode; renderList
         * repaints the rows and the button carries the pressed state. */
        var editBookBtn = SB.$('editBookBtn');
        if (editBookBtn) editBookBtn.addEventListener('click', function () {
            var book = SB.state.active;
            if (!book || !book.imported) return;
            SB.state.editingBook = SB.isEditingBook() ? null : book.id;
            SB.renderList();
            setAuthorStatus(SB.isEditingBook()
                ? 'Edit mode: rows show book order and their edit, move and remove actions.'
                : '');
        });

        var el = overlay();
        if (el) {
            var closeBtn = SB.$('newBookClose');
            if (closeBtn) closeBtn.addEventListener('click', function () { close(true); });
            var cancel = SB.$('newBookCancel');
            if (cancel) cancel.addEventListener('click', function () { close(true); });
            var form = SB.$('newBookForm');
            if (form) form.addEventListener('submit', submit);
            el.addEventListener('click', function (e) {
                if (e.target === el) close(true);
            });
        }

        var addEl = addOverlay();
        if (addEl) {
            var addClose = SB.$('addSongClose');
            if (addClose) addClose.addEventListener('click', function () { closeAddSongs(true); });
            var addCancel = SB.$('addSongCancel');
            if (addCancel) addCancel.addEventListener('click', function () { closeAddSongs(true); });
            var addForm = SB.$('addSongForm');
            if (addForm) addForm.addEventListener('submit', submitAddSongs);
            var addText = SB.$('addSongText');
            if (addText) addText.addEventListener('input', refreshAddPreview);
            var addFile = SB.$('addSongFile');
            if (addFile) addFile.addEventListener('change', refreshAddPreview);
            var chooseFile = SB.$('addSongFileBtn');
            if (chooseFile && addFile) {
                chooseFile.addEventListener('click', function () { addFile.click(); });
            }
            addEl.addEventListener('click', function (e) {
                if (e.target === addEl) closeAddSongs(true);
            });
        }

        var editEl = editOverlay();
        if (editEl) {
            var editClose = SB.$('editSourceClose');
            if (editClose) editClose.addEventListener('click', function () { closeEditSource(true); });
            var editCancel = SB.$('editSourceCancel');
            if (editCancel) editCancel.addEventListener('click', function () { closeEditSource(true); });
            var editForm = SB.$('editSourceForm');
            if (editForm) editForm.addEventListener('submit', submitEditSource);
            var editText = SB.$('editSourceText');
            if (editText) editText.addEventListener('input', refreshEditPreview);
            editEl.addEventListener('click', function (e) {
                if (e.target === editEl) closeEditSource(true);
            });
        }

        document.addEventListener('keydown', function (e) {
            if (editEl && !editEl.hidden) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeEditSource(true);
                } else {
                    trapFocus(e, 'editSourceDialog');
                }
            } else if (addEl && !addEl.hidden) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeAddSongs(true);
                } else {
                    trapFocus(e, 'addSongDialog');
                }
            } else if (el && !el.hidden) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    close(true);
                } else {
                    trapFocus(e, 'newBookDialog');
                }
            } else if (e.key === 'Escape' && pendingRemove !== null) {
                /* Back out of an armed Remove and keep focus where it was. */
                var armed = pendingRemove;
                e.preventDefault();
                resetRemoveConfirm();
                var armedButton = removeButton(armed);
                if (armedButton) {
                    try { armedButton.focus({ preventScroll: true }); } catch (err) { armedButton.focus(); }
                }
            }
        });
    };

})(window.SB = window.SB || {});
