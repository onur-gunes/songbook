/* Songbook — instrument
 * ukulele/guitar selection
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- instrument ---------------- */

    if (SB.state.instrument !== 'ukulele' && SB.state.instrument !== 'guitar') SB.state.instrument = null;

    SB.applyInstrumentUi = function () {
        Array.prototype.forEach.call(document.querySelectorAll('.instrument-btn'), function (b) {
            var on = b.dataset.instrument === SB.state.instrument;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }
    SB.setInstrument = function (inst) {
        if (inst !== 'ukulele' && inst !== 'guitar') return;
        SB.state.instrument = inst;
        SB.lsSet(SB.NS + ':instrument', SB.state.instrument);
        SB.applyInstrumentUi();
        SB.closeVoicingChooser();
        if (SB.state.currentSong) SB.renderChordStrip(SB.state.currentSong);
    }

})(window.SB = window.SB || {});
