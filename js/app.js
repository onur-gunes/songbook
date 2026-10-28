/* Songbook — app
 * entry point: init, service worker, test export
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- data-uri demo helper (kept for tests) ---------------- */

    function chordSvg(chordName) {
        var v = SB.chosenVoicing(chordName);
        return v ? ChordKit.dataUri(SB.state.instrument, v) : null;
    }

    /* ---------------- init ---------------- */

    function showFatal(msg) {
        var b = SB.$('bootMsg');
        b.hidden = false;
        b.classList.add('boot-error');
        b.textContent = msg;
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        if (location.search.indexOf('nosw') !== -1) return;
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () { /* offline-only nicety */ });
        });
    }

    function init() {
        SB.initTheme();
        SB.$('themeToggle').addEventListener('click', function () {
            var cur = document.documentElement.getAttribute('data-theme');
            SB.applyTheme(cur === 'dark' ? 'light' : 'dark');
        });
        Array.prototype.forEach.call(document.querySelectorAll('.instrument-btn'), function (b) {
            b.addEventListener('click', function () { SB.setInstrument(b.dataset.instrument); });
        });

        var tunerBtn = SB.$('tunerBtn');
        if (tunerBtn && window.SongbookTuner) {
            tunerBtn.addEventListener('click', function () {
                window.SongbookTuner.open({
                    getInstrument: function () { return SB.state.instrument; },
                    setInstrument: SB.setInstrument
                });
            });
        }

        SB.bindListControls();
        SB.bindSongControls();
        SB.bindKeyboard();
        SB.updateSpeedLabel();
        registerServiceWorker();
        window.addEventListener('hashchange', SB.route);

        Promise.all([SB.loadBundled(), SB.idbAll().catch(function () { return []; })]).then(function (res) {
            SB.state.bundled = res[0];
            SB.state.imported = res[1].map(function (raw) {
                try { var sb = SB.normalizeSongbook(raw); sb.imported = true; return sb; }
                catch (e) { return null; }
            }).filter(Boolean);
            if (!SB.state.bundled.length && !SB.state.imported.length) { showFatal('No songbooks available.'); return; }
            if (!SB.state.instrument) SB.state.instrument = (SB.defaultSongbook() && SB.defaultSongbook().instrument) || 'ukulele';
            SB.applyInstrumentUi();
            SB.rebuildIndex();
            SB.$('bootMsg').hidden = true;
            SB.route();
        }).catch(function (err) {
            var hint = location.protocol === 'file:'
                ? ' Open the single-file build, or serve the folder (python3 -m http.server).'
                : '';
            showFatal('Could not load songbooks: ' + err.message + '.' + hint);
        });
    }

    init();

    /* exposed for tests */
    window.songbookTest = {
        ChordKit: ChordKit,
        transposeChordValue: SB.transposeChordValue,
        transposeToken: SB.transposeToken,
        transposeNote: SB.transposeNote,
        transposeChartName: SB.transposeChartName,
        displayChord: SB.displayChord,
        noteNode: SB.noteNode,
        stripSortPrefix: SB.stripSortPrefix,
        filteredSongs: SB.filteredSongs,
        state: SB.state.state,
        favorites: SB.state.favorites,
        activeSongs: SB.activeSongs,
        allSongbooks: SB.allSongbooks,
        getActive: function () { return SB.state.active; },
        getSong: function (id) { return SB.state.byId[id]; },
        setInstrument: SB.setInstrument,
        getInstrument: function () { return SB.state.instrument; },
        chordSvg: chordSvg,
        scrollState: SB.state.scrollState,
        scrollBounds: SB.scrollBounds,
        targetVel: SB.targetVel,
        metronome: SB.state.metronome,
        metronomeBeatsPerBar: SB.metronomeBeatsPerBar,
        metronomeLog: function () { return SB.metronomeLog.slice(); }
    };

})(window.SB = window.SB || {});
