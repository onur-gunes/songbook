/* Songbook — author
 * creating editable songbooks from inside the app
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order set
 * by index.html; it depends on SB.createSongbook (js/songbooks.js) and the
 * routing helpers. Authoring writes only ever target imported books; bundled
 * books stay read-only.
 */
(function (SB) {
    'use strict';

    var lastFocus = null;

    function overlay() { return SB.$('newBookOverlay'); }

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
        SB.createSongbook({
            name: name,
            description: SB.$('newBookDescription').value,
            instrument: SB.$('newBookInstrument').value
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
         * keyboard user reaches the announced explanation. */
        if (button) button.disabled = false;

        addSources.forEach(function (source) {
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
            addSources = [];
            renderAddPreview();
            return;
        }
        Promise.all(jobs).then(function (entries) {
            if (seq !== addPreviewSeq) return;
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
     * state, which is gone by then; focus belongs on the bar's Add button. */
    function closeAddSongs(restore) {
        var el = addOverlay();
        if (!el) return;
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('pattern-open');
        addPreviewSeq += 1;
        if (restore === false) {
            var add = SB.$('addSongBtn');
            if (add && !add.hidden) {
                try { add.focus({ preventScroll: true }); } catch (e) { add.focus(); }
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
                window.alert(summary);
            }, function (err) {
                setAddError(err.message || 'Could not add the songs.');
                if (button) button.disabled = false;
            });
    }

    SB.openAddSongs = openAddSongs;
    SB.closeAddSongs = closeAddSongs;

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

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (addEl && !addEl.hidden) {
                e.preventDefault();
                closeAddSongs(true);
            } else if (el && !el.hidden) {
                e.preventDefault();
                close(true);
            }
        });
    };

})(window.SB = window.SB || {});
