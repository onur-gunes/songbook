/* Songbook — list
 * list view: search, filters, sort and the songbook picker
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- list view ---------------- */

    try { SB.state.state.compact = window.localStorage.getItem(SB.NS + ':compact') === '1'; } catch (e) { /* ignore */ }

    function applyViewToggle() {
        var b = SB.$('viewToggle');
        b.setAttribute('aria-pressed', SB.state.state.compact ? 'true' : 'false');
        b.textContent = SB.state.state.compact ? '▤' : '☰';
        b.setAttribute('aria-label', SB.state.state.compact
            ? 'Switch back to card view'
            : 'Switch to compact one-line song list');
        b.title = SB.state.state.compact ? 'Back to cards' : 'Compact list';
        SB.$('songList').classList.toggle('is-compact', SB.state.state.compact);
    }

    // Diacritic-insensitive fold: typing "pszczolka" finds "Pszczółka".
    function fold(s) {
        return String(s).toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\u0142/g, 'l');
    }

    SB.filteredSongs = function () {
        var q = fold(SB.state.state.q.trim());
        var sbId = SB.state.active ? SB.state.active.id : '';
        var out = SB.activeSongs().filter(function (s) {
            if (SB.state.state.levels.size && !SB.state.state.levels.has(s.level)) return false;
            if (SB.state.state.isNew && !s.new) return false;
            if (SB.state.state.favOnly && !SB.isFav(sbId, s.id)) return false;
            if (q) {
                var hay = fold(s.title + ' ' + s.artist);
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
        if (SB.isEditingBook()) {
            /* Move up/down reorder `n`. Sorting by title while they do that
             * would renumber the badges without moving a row, so edit mode
             * shows the book's own order instead. */
            out.sort(function (a, b) { return a.n - b.n; });
        } else if (SB.state.state.sort === 'artist') {
            out.sort(function (a, b) {
                var c = a.artist.localeCompare(b.artist, 'en', { sensitivity: 'base' });
                return c !== 0 ? c : a.n - b.n;
            });
        } else {
            out.sort(function (a, b) { return SB.stripSortPrefix(a.title).localeCompare(SB.stripSortPrefix(b.title), 'en', { sensitivity: 'base' }); });
        }
        return out;
    }

    /* The list view has two independent "nothing here" cases: no songbooks at
     * all (first run, or after removing the last import) and a search/filter
     * with no matches inside a book. Only the former owns the import call to
     * action and hides the list toolbar; the latter still needs the toolbar so
     * the user can clear the search. */
    SB.renderEmptyState = function () {
        var empty = SB.allSongbooks().length === 0;
        var box = SB.$('emptyState');
        if (box) box.hidden = !empty;
        var toolbar = SB.$('listControls');
        if (toolbar) toolbar.hidden = empty;
        /* With no books there is nothing to pick, refresh or export. Keep the
         * entry actions (New/Import) in place for the test-visible "top import"
         * affordance, but drop the picker and file row so the first-run card is
         * the only thing asking for a decision. */
        var bar = document.querySelector('.songbook-bar');
        if (bar) bar.classList.toggle('is-empty', empty);
        if (!empty) return;
        var list = SB.$('songList');
        if (list) list.textContent = '';
        var result = SB.$('resultCount');
        if (result) result.textContent = '';
        var noMatches = SB.$('noMatches');
        if (noMatches) noMatches.hidden = true;
        var emptyBook = SB.$('emptyBookState');
        if (emptyBook) emptyBook.hidden = true;
    }

    function rowAction(action, icon, label, ariaLabel) {
        var button = SB.el('button', 'row-action row-action-' + action);
        button.type = 'button';
        button.dataset.action = action;
        button.title = label;
        button.setAttribute('aria-label', ariaLabel);
        button.appendChild(SB.el('span', 'row-action-icon', icon));
        button.appendChild(SB.el('span', 'row-action-label', label));
        return button;
    }

    /* The bar carries browsing actions by default. Adding songs, duplicating a
     * book and removing it are authoring/maintenance actions, so they live
     * inside the per-book edit mode and the read-only bar stays calm.
     * Duplicate is the exception for a bundled book: bundled books have no
     * edit mode, and duplication is their only route to an editable copy. */
    function syncAuthoringBar() {
        var book = SB.state.active;
        var editing = SB.isEditingBook();
        var imported = !!(book && book.imported);
        function show(id, visible) {
            var b = SB.$(id);
            if (b) b.hidden = !visible;
        }
        show('addSongBtn', editing && imported);
        show('removeSongsBtn', editing && imported);
        show('duplicateBookBtn', !!book && (!imported || editing));
    }
    SB.syncAuthoringBar = syncAuthoringBar;

    /* Mirrors applyViewToggle: the button is the mode's only affordance, so it
     * carries the pressed state and the label. The sort buttons are disabled
     * because edit mode shows book order, not the chosen title/artist order. */
    function applyEditToggle() {
        var editing = SB.isEditingBook();
        var b = SB.$('editBookBtn');
        if (b) {
            b.setAttribute('aria-pressed', editing ? 'true' : 'false');
            b.textContent = editing ? 'Done' : 'Edit songbook';
            b.title = editing ? 'Leave edit mode' : 'Reorder, edit and remove songs';
        }
        /* The banner, not the browsing bar, is where the task mode lives. It
         * names the book being edited so a row action can never be mistaken
         * for a change to some other book, and it keeps Add/Remove in one
         * stable place instead of inserting them among New/Import on toggle. */
        var banner = SB.$('editModeBar');
        if (banner) {
            banner.hidden = !editing;
            if (editing && SB.state.active) {
                var name = SB.$('editModeName');
                if (name) name.textContent = SB.state.active.name;
            }
        }
        Array.prototype.forEach.call(document.querySelectorAll('.sort-btn'), function (s) {
            s.disabled = editing;
            s.title = editing ? 'Rows show book order while editing' : '';
        });
        syncAuthoringBar();
    }

    SB.renderList = function () {
        /* A repaint replaces the buttons, so an armed Remove cannot survive it;
         * drop the pending state with the DOM rather than leaving a prompt up. */
        if (SB.resetRemoveConfirm) SB.resetRemoveConfirm();
        if (!SB.state.active) {
            SB.$('songList').textContent = '';
            SB.$('resultCount').textContent = '';
            SB.$('noMatches').hidden = true;
            SB.renderEmptyState();
            return;
        }
        var songs = SB.filteredSongs();
        var total = SB.activeSongs().length;
        /* A zero-song book is a real state (a freshly created book), not an
         * empty search: show the "No songs yet" block and hide the search and
         * filter toolbar, which has nothing to act on. */
        var bookEmpty = total === 0;
        var emptyBook = SB.$('emptyBookState');
        if (emptyBook) emptyBook.hidden = !bookEmpty;
        var emptyAdd = SB.$('emptyAddSongBtn');
        if (emptyAdd) emptyAdd.hidden = !(bookEmpty && SB.state.active.imported);
        var toolbar = SB.$('listControls');
        if (toolbar) toolbar.hidden = bookEmpty;
        var ul = SB.$('songList');
        ul.textContent = '';
        ul.classList.toggle('is-editing', SB.isEditingBook());
        var frag = document.createDocumentFragment();
        var sbId = SB.state.active ? SB.state.active.id : '';
        var editable = SB.isEditingBook();
        var bookSongs = SB.state.active.songs;
        songs.forEach(function (s) {
            var li = SB.el('li', 'song-row' + (editable ? ' has-actions' : ''));
            li.dataset.id = s.id;

            var a = document.createElement('a');
            a.className = 'song-link';
            a.href = SB.routeHash(sbId, s.id);
            a.appendChild(SB.el('span', 'row-num', String(s.n)));
            var main = SB.el('span', 'row-main');
            main.appendChild(SB.el('span', 'row-title', s.title));
            main.appendChild(SB.el('span', 'row-artist', s.artist));
            a.appendChild(main);
            a.appendChild(SB.el('span', 'row-level level-' + s.level, s.level));
            li.appendChild(a);

            var on = SB.isFav(sbId, s.id);
            var star = SB.el('button', 'star-btn' + (on ? ' on' : ''), on ? '★' : '☆');
            star.type = 'button';
            star.setAttribute('aria-label', 'Toggle favorite for ' + s.title);
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            star.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                SB.toggleFavorite(sbId, s.id);
            });

            var tools = SB.el('div', 'row-tools');
            tools.appendChild(star);
            if (editable) {
                /* The four authoring actions are one dock, not four separate
                 * pills: the row stays a row, and Remove sits at the edge
                 * where a destructive action belongs. */
                var actions = SB.el('div', 'row-actions');
                var pos = bookSongs.indexOf(s);

                var edit = rowAction('edit', '✎', 'Edit source',
                    'Edit source for ' + s.title);
                edit.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    SB.editSongSource(s.id);
                });
                actions.appendChild(edit);

                var up = rowAction('up', '↑', 'Move up',
                    'Move ' + s.title + ' up in the book');
                up.disabled = pos <= 0;
                up.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    SB.moveSongInList(s.id, -1);
                });
                actions.appendChild(up);

                var down = rowAction('down', '↓', 'Move down',
                    'Move ' + s.title + ' down in the book');
                down.disabled = pos < 0 || pos >= bookSongs.length - 1;
                down.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    SB.moveSongInList(s.id, 1);
                });
                actions.appendChild(down);

                var remove = rowAction('remove', '✕', 'Remove',
                    'Remove ' + s.title + ' from the book');
                remove.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    SB.removeSongFromList(s.id);
                });
                actions.appendChild(remove);

                tools.appendChild(actions);
            }
            li.appendChild(tools);

            frag.appendChild(li);
        });
        ul.appendChild(frag);

        SB.$('noMatches').hidden = bookEmpty || songs.length > 0;
        SB.$('resultCount').textContent = bookEmpty ? '' : (songs.length === total
            ? total + ' songs'
            : songs.length + ' of ' + total + ' songs');
        SB.$('searchClear').hidden = !SB.state.state.q;
        applyEditToggle();
        applyViewToggle();
    }

    SB.toggleFavorite = function (sbId, songId) {
        var cid = SB.compositeId(sbId, songId);
        if (SB.state.favorites.has(cid)) SB.state.favorites.delete(cid);
        else SB.state.favorites.add(cid);
        SB.saveFavorites();
        if (!SB.$('listView').hidden && SB.state.active && SB.state.active.id === sbId) {
            if (SB.state.state.favOnly) SB.renderList();
            else updateStarInPlace(songId);
        }
        if (SB.state.currentSong && SB.state.active && SB.state.active.id === sbId && SB.state.currentSong.id === songId) SB.updateFavBtn();
    }

    function updateStarInPlace(id) {
        var rows = document.querySelectorAll('#songList .song-row');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].dataset.id !== id) continue;
            var star = rows[i].querySelector('.star-btn');
            if (!star) break;
            var on = SB.isFav(SB.state.active.id, id);
            star.classList.toggle('on', on);
            star.textContent = on ? '★' : '☆';
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            break;
        }
    }

    SB.updateFavBtn = function () {
        if (!SB.state.currentSong || !SB.state.active) return;
        var on = SB.isFav(SB.state.active.id, SB.state.currentSong.id);
        var btn = SB.$('favBtn');
        btn.textContent = on ? '★' : '☆';
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function syncSortButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.sort-btn'), function (b) {
            var on = b.dataset.sort === SB.state.state.sort;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function syncFilterButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.filter-btn'), function (b) {
            var lv = b.dataset.level;
            var on = lv === 'New' ? SB.state.state.isNew
                : lv === 'Favorites' ? SB.state.state.favOnly
                : lv === 'All' ? SB.state.state.levels.size === 0
                : SB.state.state.levels.has(lv);
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    /* A batch gets one report, not one alert per file. A failure carries the
     * file's own name (sourceName) so the reason reads as "<name> — <why>". */
    function summarizeImport(results) {
        var imported = 0;
        var failed = [];
        results.forEach(function (r) {
            if (r.ok) imported++;
            else failed.push(r);
        });
        var msg = imported + ' imported';
        if (failed.length) {
            msg += ', ' + failed.length + ' failed: ' + failed.map(function (f) {
                return f.name + ' — ' + f.reason;
            }).join('; ');
        }
        return msg;
    }

    SB.bindListControls = function () {
        var input = SB.$('search');
        input.addEventListener('input', function () {
            SB.state.state.q = input.value;
            SB.renderList();
        });
        SB.$('searchClear').addEventListener('click', function () {
            input.value = '';
            SB.state.state.q = '';
            SB.renderList();
            input.focus();
        });

        document.querySelectorAll('.filter-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                var lv = b.dataset.level;
                if (lv === 'New') SB.state.state.isNew = !SB.state.state.isNew;
                else if (lv === 'Favorites') SB.state.state.favOnly = !SB.state.state.favOnly;
                else if (lv === 'All') SB.state.state.levels.clear();
                else if (SB.state.state.levels.has(lv)) SB.state.state.levels.delete(lv);
                else SB.state.state.levels.add(lv);
                syncFilterButtons();
                SB.renderList();
            });
        });

        document.querySelectorAll('.sort-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                SB.state.state.sort = b.dataset.sort;
                syncSortButtons();
                SB.renderList();
            });
        });
        syncSortButtons();

        SB.$('randomBtn').addEventListener('click', function () {
            var songs = SB.filteredSongs();
            if (!songs.length || !SB.state.active) return;
            var pick = songs[Math.floor(Math.random() * songs.length)];
            location.hash = SB.routeHash(SB.state.active.id, pick.id);
        });

        SB.$('recentClear').addEventListener('click', function () {
            SB.state.recent = [];
            SB.lsSet(SB.RECENT_KEY, SB.state.recent);
            SB.renderRecent();
        });

        SB.$('viewToggle').addEventListener('click', function () {
            SB.state.state.compact = !SB.state.state.compact;
            try { window.localStorage.setItem(SB.NS + ':compact', SB.state.state.compact ? '1' : '0'); } catch (e) { /* ignore */ }
            SB.renderList();
        });

        SB.$('songbookSelect').addEventListener('change', function () {
            location.hash = SB.routeHash(this.value);
        });
        SB.$('importBtn').addEventListener('click', function () { SB.$('importFile').click(); });
        SB.$('emptyImportBtn').addEventListener('click', function () { SB.$('importFile').click(); });

        /* The URL form is one shared control: reachable from the bar when a
         * library already exists and from the empty state on first run. File
         * import stays the primary action because it has no CORS constraint. */
        var urlForm = SB.$('importUrlForm');
        var urlInput = SB.$('importUrl');
        var urlToggle = SB.$('importUrlToggle');
        var urlBtn = SB.$('importUrlBtn');

        function setUrlForm(open) {
            if (!urlForm) return;
            urlForm.hidden = !open;
            urlToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) urlInput.focus();
            else urlInput.value = '';
        }

        function reportUrlFailure(err, fallbackName) {
            window.alert(summarizeImport([{
                ok: false,
                name: err.sourceName || fallbackName,
                reason: err.message
            }]));
        }

        urlToggle.addEventListener('click', function () { setUrlForm(urlForm.hidden); });
        var emptyUrlBtn = SB.$('emptyImportUrlBtn');
        if (emptyUrlBtn) emptyUrlBtn.addEventListener('click', function () { setUrlForm(true); });
        SB.$('importUrlCancel').addEventListener('click', function () { setUrlForm(false); });

        urlForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var url = urlInput.value.trim();
            if (!url) { urlInput.focus(); return; }
            urlBtn.disabled = true;
            SB.importSongbookFromUrl(url).then(function (sb) {
                setUrlForm(false);
                var hash = SB.routeHash(sb.id);
                if (location.hash === hash) SB.route();
                else location.hash = hash;
            }, function (err) {
                reportUrlFailure(err, url);
            }).then(function () { urlBtn.disabled = false; });
        });

        SB.$('refreshSongsBtn').addEventListener('click', function () {
            var sb = SB.state.active;
            if (!sb || !sb.sourceUrl) return;
            var btn = SB.$('refreshSongsBtn');
            btn.disabled = true;
            SB.refreshSongbook(sb).then(function (next) {
                /* Route through the rebuilt index so state.active and the
                 * rendered view point at the replaced record, not the old
                 * object that was just overwritten. */
                if (SB.state.active && SB.state.active.id === next.id) SB.route();
            }, function (err) {
                window.alert('Refresh failed: ' + err.message);
            }).then(function () { btn.disabled = false; });
        });

        SB.$('importFile').addEventListener('change', function (e) {
            var files = Array.prototype.slice.call(e.target.files || []);
            e.target.value = '';
            if (!files.length) return;

            /* Serial, not Promise.all: a later duplicate must see the earlier
             * file's replace prompt and in-memory entry, and one bad file must
             * only fail its own slot in the batch. */
            var results = [];
            var last = null;
            function step(i) {
                if (i >= files.length) {
                    window.alert(summarizeImport(results));
                    if (last) {
                        var hash = SB.routeHash(last.id);
                        if (location.hash === hash) SB.route();
                        else location.hash = hash;
                    }
                    return;
                }
                var file = files[i];
                SB.importSongbook(file).then(function (sb) {
                    results.push({ ok: true, sb: sb });
                    last = sb;
                }, function (err) {
                    results.push({
                        ok: false,
                        name: err.sourceName || file.name,
                        reason: err.message
                    });
                }).then(function () { step(i + 1); });
            }
            step(0);
        });
        SB.$('exportSongsBtn').addEventListener('click', function () {
            if (SB.state.active) SB.exportSongbook(SB.state.active);
        });
        SB.$('removeSongsBtn').addEventListener('click', function () {
            if (!SB.state.active || !SB.state.active.imported) return;
            if (!window.confirm('Remove imported songbook "' + SB.state.active.name + '"? Your notes and favorites for it are kept.')) return;
            var id = SB.state.active.id;
            SB.idbDelete(id).then(function () {
                SB.state.imported = SB.state.imported.filter(function (sb) { return sb.id !== id; });
                SB.rebuildIndex();
                location.hash = SB.routeHash(SB.defaultSongbook() ? SB.defaultSongbook().id : '');
            }).catch(function (err) { window.alert('Could not remove: ' + err.message); });
        });
    }

})(window.SB = window.SB || {});
