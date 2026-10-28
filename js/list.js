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
        if (SB.state.state.sort === 'artist') {
            out.sort(function (a, b) {
                var c = a.artist.localeCompare(b.artist, 'en', { sensitivity: 'base' });
                return c !== 0 ? c : a.n - b.n;
            });
        } else {
            out.sort(function (a, b) { return SB.stripSortPrefix(a.title).localeCompare(SB.stripSortPrefix(b.title), 'en', { sensitivity: 'base' }); });
        }
        return out;
    }

    SB.renderList = function () {
        var songs = SB.filteredSongs();
        var total = SB.activeSongs().length;
        var ul = SB.$('songList');
        ul.textContent = '';
        var frag = document.createDocumentFragment();
        var sbId = SB.state.active ? SB.state.active.id : '';
        songs.forEach(function (s) {
            var li = SB.el('li', 'song-row');
            li.dataset.id = s.id;

            var a = document.createElement('a');
            a.className = 'song-link';
            a.href = '#/' + sbId + '/' + s.id;
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
            li.appendChild(star);

            frag.appendChild(li);
        });
        ul.appendChild(frag);

        SB.$('emptyState').hidden = songs.length > 0;
        SB.$('resultCount').textContent = songs.length === total
            ? total + ' songs'
            : songs.length + ' of ' + total + ' songs';
        SB.$('searchClear').hidden = !SB.state.state.q;
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
            location.hash = '#/' + SB.state.active.id + '/' + pick.id;
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
            location.hash = '#/' + this.value;
        });
        SB.$('importBtn').addEventListener('click', function () { SB.$('importFile').click(); });
        SB.$('importFile').addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (file) SB.importSongbook(file);
            e.target.value = '';
        });
        SB.$('removeSongsBtn').addEventListener('click', function () {
            if (!SB.state.active || !SB.state.active.imported) return;
            if (!window.confirm('Remove imported songbook "' + SB.state.active.name + '"? Your notes and favorites for it are kept.')) return;
            var id = SB.state.active.id;
            SB.idbDelete(id).then(function () {
                SB.state.imported = SB.state.imported.filter(function (sb) { return sb.id !== id; });
                SB.rebuildIndex();
                location.hash = '#/' + (SB.defaultSongbook() ? SB.defaultSongbook().id : '');
            }).catch(function (err) { window.alert('Could not remove: ' + err.message); });
        });
    }

})(window.SB = window.SB || {});
