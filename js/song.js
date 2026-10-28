/* Songbook — song
 * song view and its controls
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- song view ---------------- */

    function navContext() {
        var list = SB.filteredSongs();
        var idx = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === SB.state.currentSong.id) { idx = i; break; }
        if (idx === -1) {
            list = SB.activeSongs().slice().sort(function (a, b) { return a.n - b.n; });
            for (var j = 0; j < list.length; j++) if (list[j].id === SB.state.currentSong.id) { idx = j; break; }
        }
        return { list: list, idx: idx };
    }

    function updateNavButtons() {
        var ctx = navContext();
        SB.$('prevBtn').disabled = ctx.idx <= 0;
        SB.$('nextBtn').disabled = ctx.idx === -1 || ctx.idx >= ctx.list.length - 1;
    }

    SB.openSong = function (id) {
        SB.closeVoicingChooser();
        var song = SB.state.byId[id];
        if (!song) { location.hash = '#/' + (SB.state.active ? SB.state.active.id : ''); return; }
        SB.state.currentSong = song;
        SB.addRecent(SB.state.active.id, id);
        SB.resetScroll(true);
        SB.state.scrollSpeed = SB.loadSpeedForSong(SB.state.active.id, id);
        SB.updateSpeedLabel();
        SB.state.textSize = SB.loadTextSizeForSong(SB.state.active.id, id);
        SB.applyTextSize();

        SB.state.transpose = 0;
        SB.updateTransposeLabel();

        SB.$('songNumber').textContent = '#' + song.n;
        SB.$('songTitle').textContent = song.title;
        SB.$('songArtist').textContent = song.artist;
        var badge = SB.$('songLevel');
        badge.textContent = song.level;
        badge.className = 'level-badge level-' + song.level;
        SB.updateKeyHints();
        SB.updateFavBtn();

        SB.renderChordStrip(song);
        SB.renderSheet(song);

        var note = '';
        try { note = window.localStorage.getItem(SB.noteKey(SB.state.active.id, id)) || ''; } catch (e) { /* ignore */ }
        SB.$('notesBox').value = note;
        SB.$('notesStatus').classList.remove('show');

        updateNavButtons();
        SB.$('sheet').focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }

    SB.bindSongControls = function () {
        SB.$('trUp').addEventListener('click', function () {
            if (SB.state.transpose >= 11) return;
            SB.state.transpose++;
            SB.updateTransposeLabel();
            SB.updateKeyHints();
            if (SB.state.currentSong) { SB.renderChordStrip(SB.state.currentSong); SB.renderSheet(SB.state.currentSong); }
        });
        SB.$('trDown').addEventListener('click', function () {
            if (SB.state.transpose <= -11) return;
            SB.state.transpose--;
            SB.updateTransposeLabel();
            SB.updateKeyHints();
            if (SB.state.currentSong) { SB.renderChordStrip(SB.state.currentSong); SB.renderSheet(SB.state.currentSong); }
        });

        SB.$('favBtn').addEventListener('click', function () {
            if (SB.state.currentSong && SB.state.active) SB.toggleFavorite(SB.state.active.id, SB.state.currentSong.id);
        });

        SB.$('prevBtn').addEventListener('click', function () {
            var ctx = navContext();
            if (ctx.idx > 0) location.hash = '#/' + SB.state.active.id + '/' + ctx.list[ctx.idx - 1].id;
        });
        SB.$('nextBtn').addEventListener('click', function () {
            var ctx = navContext();
            if (ctx.idx !== -1 && ctx.idx < ctx.list.length - 1) location.hash = '#/' + SB.state.active.id + '/' + ctx.list[ctx.idx + 1].id;
        });

        SB.$('notesSave').addEventListener('click', saveNotes);
        SB.$('notesBox').addEventListener('keydown', function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNotes(); }
        });

        SB.$('scrollBtn').addEventListener('click', SB.toggleAutoScroll);
        SB.$('scrollReset').addEventListener('click', function () { SB.resetScroll(false); });
        SB.$('speedDown').addEventListener('click', function () { SB.setSpeed(SB.state.scrollSpeed - 0.1); });
        SB.$('speedUp').addEventListener('click', function () { SB.setSpeed(SB.state.scrollSpeed + 0.1); });
        SB.$('sizeDown').addEventListener('click', function () { SB.setTextSize(SB.state.textSize - 0.1); });
        SB.$('sizeUp').addEventListener('click', function () { SB.setTextSize(SB.state.textSize + 0.1); });
        SB.$('chordSizeDown').addEventListener('click', function () { SB.setChordSize(SB.state.chordSize - 0.1); });
        SB.$('chordSizeUp').addEventListener('click', function () { SB.setChordSize(SB.state.chordSize + 0.1); });
        SB.$('chordPinBtn').addEventListener('click', function () {
            SB.state.chordPin = !SB.state.chordPin;
            try { window.localStorage.setItem(SB.NS + ':chordPin', SB.state.chordPin ? '1' : '0'); } catch (e) { /* ignore */ }
            SB.applyChordSettings();
        });
        Array.prototype.forEach.call(document.querySelectorAll('.chord-mode-btn[data-chord-mode]'), function (b) {
            b.addEventListener('click', function () { SB.setChordMode(b.dataset.chordMode); });
        });
        SB.$('numbersBtn').addEventListener('click', function () {
            SB.state.showNumbers = !SB.state.showNumbers;
            try { window.localStorage.setItem(SB.NS + ':numbers', SB.state.showNumbers ? '1' : '0'); } catch (e) { /* ignore */ }
            SB.applyNumbers();
            if (SB.state.currentSong) SB.renderChordStrip(SB.state.currentSong);
        });
        SB.applyChordSettings();
        SB.applyChordMode();
        SB.applyNumbers();
        SB.$('sheet').addEventListener('pointerdown', SB.sheetPointerDown);
        SB.$('sheet').addEventListener('pointermove', SB.sheetPointerMove);
        SB.$('sheet').addEventListener('pointerup', SB.sheetPointerEnd);
        SB.$('sheet').addEventListener('pointercancel', SB.sheetPointerEnd);

        window.addEventListener('scroll', function () {
            if (!SB.state.scrollState.playing || SB.state.scrollState.lastY === null) return;
            if (Math.abs(window.pageYOffset - SB.state.scrollState.lastY) > 2) {
                SB.state.scrollState.pos = window.pageYOffset;
                SB.state.scrollState.lastY = window.pageYOffset;
            }
        }, { passive: true });

        var sheetResizeT = null;
        window.addEventListener('resize', function () {
            if (SB.state.chordMode !== 'above' || !SB.state.currentSong) return;
            clearTimeout(sheetResizeT);
            sheetResizeT = setTimeout(function () { SB.renderSheet(SB.state.currentSong); }, 150);
        }, { passive: true });
    }

    function saveNotes() {
        if (!SB.state.currentSong || !SB.state.active) return;
        try { window.localStorage.setItem(SB.noteKey(SB.state.active.id, SB.state.currentSong.id), SB.$('notesBox').value); } catch (e) { /* ignore */ }
        var st = SB.$('notesStatus');
        st.textContent = 'Saved';
        st.classList.add('show');
        clearTimeout(saveNotes._t);
        saveNotes._t = setTimeout(function () { st.classList.remove('show'); }, 1500);
    }

})(window.SB = window.SB || {});
