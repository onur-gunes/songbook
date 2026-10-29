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

        /* The first load after a deploy can run new markup against old code.
         * Navigations are network-first, so index.html comes from the network
         * immediately, but every other asset is stale-while-revalidate and is
         * still served by the OUTGOING worker out of its old cache. The page
         * therefore boots with the new HTML and the previous release's
         * js/*.js: controls that exist in the markup but whose handlers are
         * not in the loaded script do nothing at all until a later visit.
         *
         * The new worker calls skipWaiting() in install, so it activates and
         * claims this client a moment after the document has already run. That
         * claim is the signal that the cache now matches the deploy the markup
         * came from, so reload once to put markup and code back in step.
         *
         * Guarded twice. Only when the page started under a controller: a
         * first-ever registration also fires controllerchange, and there is no
         * mismatch to repair then. And only once per page, so a worker that
         * claims repeatedly can never drive a reload loop. */
        var hadController = !!navigator.serviceWorker.controller;
        var reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (!hadController || reloading) return;
            reloading = true;
            location.reload();
        });

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
        metronomeLog: function () { return SB.metronomeLog.slice(); },
        metronomePosition: function () { return SB.metronomePosition(); },
        strum: SB.state.strum,
        strumPatterns: SB.strumPatterns,
        strumPatternsFor: SB.strumPatternsFor,
        setStrum: SB.setStrum,
        toggleStrumNotation: SB.toggleStrumNotation
    };

})(window.SB = window.SB || {});
