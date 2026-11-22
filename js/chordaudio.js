/* Songbook — chord playback for the chord explorer
 *
 * A tiny Web Audio plucked-string synth. It is intentionally dependency-free
 * and only creates an AudioContext from a user gesture (the Strum/Arpeggio
 * buttons), so it works under the same iOS restrictions as the metronome.
 */
(function (SB) {
    'use strict';

    var ctx = null;

    function audioCtx() {
        if (ctx) {
            if (ctx.state === 'suspended') ctx.resume();
            return ctx;
        }
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        try {
            ctx = new AudioCtx();
        } catch (e) {
            return null;
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function pluck(context, midi, when, duration, level) {
        var freq = midiToFreq(midi);
        var osc = context.createOscillator();
        var filter = context.createBiquadFilter();
        var gain = context.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, when);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.min(7000, freq * 7), when);
        filter.Q.setValueAtTime(0.6, when);

        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(level, when + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);
        osc.start(when);
        osc.stop(when + duration + 0.05);
    }

    /* Play a fretted voicing. `frets` uses -1 for a muted string; `capo` is
     * added to every sounding fret. Returns false when Web Audio is missing. */
    SB.playChord = function (frets, instrumentId, mode, capo) {
        var context = audioCtx();
        if (!context || !frets || !frets.length) return false;

        var instrument = ChordKit.instrumentOf(instrumentId);
        var offset = Number(capo) || 0;
        var notes = [];
        for (var i = 0; i < frets.length && i < instrument.tuning.length; i++) {
            if (frets[i] < 0) continue;
            notes.push(instrument.tuning[i] + offset + frets[i]);
        }
        if (!notes.length) return false;

        // Strum low to high; the arpeggio uses the same order with a wider gap.
        notes.sort(function (a, b) { return a - b; });
        var now = context.currentTime + 0.03;
        var arpeggio = mode === 'arpeggio';
        var step = arpeggio ? 0.14 : 0.035;
        var duration = arpeggio ? 1.35 : 1.05;
        var level = arpeggio ? 0.10 : 0.085;

        notes.forEach(function (midi, index) {
            pluck(context, midi, now + index * step, duration, level);
        });
        return true;
    };
})(window.SB = window.SB || {});
