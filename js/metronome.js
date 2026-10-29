/* Songbook — metronome
 * click track for the song view, defaulting to the song's bpm
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- metronome ----------------
     *
     * Scheduling: setInterval is not used to make the sound. A timer callback
     * fires whenever the main thread gets round to it, so the gap between
     * clicks wanders by tens of milliseconds and the drift is audible within
     * seconds. Instead this is the standard lookahead scheduler: a coarse
     * timer wakes up every TICK_MS and only *schedules* — every click whose
     * time falls inside the next LOOKAHEAD_S is handed to the AudioContext
     * with an absolute start time. The audio clock, not the timer, decides
     * when a click sounds, so jitter in the timer has no effect on timing as
     * long as it wakes up more often than the lookahead window.
     */

    var BPM_MIN = 20, BPM_MAX = 300;    // mirrors chordpro.py / js/songbooks.js
    var TICK_MS = 25;                   // how often the scheduler wakes up
    var LOOKAHEAD_S = 0.1;              // how far ahead it schedules

    // Click timbre. Beat 1 is higher and louder so the meter is audible
    // rather than a flat pulse.
    var ACCENT_HZ = 1760, BEAT_HZ = 880;
    var ACCENT_GAIN = 0.5, BEAT_GAIN = 0.28;
    var CLICK_S = 0.04;                 // envelope length of a single click

    // Beats per bar for each metre on the schema's allowlist. 6/8 is counted
    // in two dotted-quarter pulses, matching the "felt pulse" definition of
    // bpm in the README — so its bar is 2 pulses, not 6.
    var BEATS_PER_BAR = { '4/4': 4, '3/4': 3, '6/8': 2, '2/4': 2 };

    /* The AudioContext is created lazily inside the start gesture and then
     * kept. It is deliberately not the tuner's: that one is tied to the
     * microphone lifecycle and gets closed when the tuner closes, which would
     * silently kill a running click track. */
    var ctx = null;
    var timer = null;       // setInterval handle for the scheduler
    var nextTime = 0;       // AudioContext time of the next click, seconds
    var beat = 0;           // 0-based index of the next click within the bar
    var startTime = 0;      // AudioContext time of beat 0 (the first click)

    function AudioCtx() { return window.AudioContext || window.webkitAudioContext; }

    SB.metronomeBeatsPerBar = function (time) {
        return BEATS_PER_BAR[time] || 4;
    }

    function clampBpm(v) {
        if (typeof v !== 'number' || !isFinite(v)) return null;
        var bpm = Math.round(v);
        return (bpm >= BPM_MIN && bpm <= BPM_MAX) ? bpm : null;
    }

    /* The per-song override, or null if the user has never set one here.
     * Stored under SB.bpmKey so it lands in the environment's namespace. */
    SB.loadBpmForSong = function (sbId, id) {
        var v = null;
        try { v = clampBpm(parseFloat(window.localStorage.getItem(SB.bpmKey(sbId, id)))); }
        catch (e) { /* ignore */ }
        return v;
    }

    /* Whether the song has any tempo at all: either from the songbook or
     * from a previous user override. Without one there is nothing sensible
     * to count, so the control is hidden entirely. */
    function tempoFor(song) {
        if (!song || !SB.state.active) return null;
        var saved = SB.loadBpmForSong(SB.state.active.id, song.id);
        if (saved !== null) return saved;
        return clampBpm(song.bpm);
    }

    /* ---------------- audio ---------------- */

    function scheduleClick(time, accent) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;
        var peak = accent ? ACCENT_GAIN : BEAT_GAIN;
        // A bare start/stop on the oscillator clicks audibly at both ends;
        // the short ramps make it a percussive tick instead of a pop.
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_S);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + CLICK_S);
    }

    /* Ring buffer of recently scheduled clicks. The whole point of the
     * lookahead scheduler is that these times are exact multiples of the beat
     * apart regardless of timer jitter, so recording them is what makes
     * "stays in time" an assertion rather than a claim (see tests/e2e.html).
     * Bounded, so a long session cannot grow it without limit. */
    var LOG_MAX = 64;
    SB.metronomeLog = [];

    function scheduler() {
        if (!ctx) return;
        var spb = 60 / SB.state.metronome.bpm;
        var beats = SB.state.metronome.beats;
        while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
            scheduleClick(nextTime, beat === 0);
            SB.metronomeLog.push({ time: nextTime, accent: beat === 0 });
            if (SB.metronomeLog.length > LOG_MAX) SB.metronomeLog.shift();
            nextTime += spb;
            beat = (beat + 1) % beats;
        }
    }

    /* The metronome's audio clock, exposed for the strum row so its slot
     * highlight reads the one clock the clicks are on rather than starting a
     * second timer (two independent clocks visibly diverge — see issue #41).
     *
     * Returns null when nothing is counting. Otherwise returns how many beats
     * have elapsed since beat 0 as a float: the integer part is the beat index
     * (unbounded, so the caller can run a count-in first and then subtract it),
     * and the fractional part is the position within the current beat. A caller
     * wanting the slot within a bar takes floor(beats * subdiv) and reduces it
     * modulo the pattern length. Reading currentTime here, not a cached value,
     * is what keeps it locked to the clicks over a long run. */
    SB.metronomePosition = function () {
        if (!ctx || !SB.state.metronome.playing || !SB.state.metronome.bpm) return null;
        var spb = 60 / SB.state.metronome.bpm;
        var beats = (ctx.currentTime - startTime) / spb;
        // Before the first click actually sounds (startTime is a hair ahead of
        // the start gesture) the elapsed count is negative; clamp to 0 so the
        // highlight sits on the downbeat rather than reading a bar behind.
        return beats < 0 ? 0 : beats;
    }

    SB.startMetronome = function () {
        if (SB.state.metronome.playing) return;
        if (!SB.state.metronome.bpm) return;

        // iOS leaves an AudioContext suspended unless it is created and
        // resumed inside the user gesture — the same rule the tuner
        // documents at tuner.js:898. This runs straight off the click
        // handler, with no await before it, so the gesture is still live.
        var Ctor = AudioCtx();
        if (!Ctor) return;
        if (!ctx) {
            try { ctx = new Ctor(); } catch (e) { return; }
        }
        if (ctx.resume) {
            var r = ctx.resume();
            if (r && r.catch) r.catch(function () { /* nothing more to try */ });
        }

        beat = 0;
        SB.metronomeLog.length = 0;
        // Start just far enough ahead that the first click is scheduled
        // rather than fired late.
        nextTime = ctx.currentTime + 0.06;
        // Beat 0 (the accented downbeat) sounds at nextTime. This is the one
        // clock everything downstream reads: the strum row derives its current
        // slot from (currentTime - startTime), so the highlight can never run
        // on a second timer that drifts away from the audio. See
        // SB.metronomePosition below.
        startTime = nextTime;
        SB.state.metronome.playing = true;
        scheduler();
        timer = window.setInterval(scheduler, TICK_MS);
        SB.updateMetronomeUi();
        // The strum row's and the grid cursor's highlights ride this same
        // clock. Starting their render loops here (rather than them polling
        // forever) keeps them off when nothing is counting, while still
        // reading the audio clock when they run.
        if (SB.strumOnMetronomeStart) SB.strumOnMetronomeStart();
        if (SB.gridOnMetronomeStart) SB.gridOnMetronomeStart();
    }

    SB.stopMetronome = function () {
        if (timer) { window.clearInterval(timer); timer = null; }
        if (!SB.state.metronome.playing) return;
        SB.state.metronome.playing = false;
        // The context is deliberately left open: closing it would mean
        // building a new one on the next start, and on iOS that must happen
        // inside a gesture. Not scheduling is enough to be silent.
        SB.updateMetronomeUi();
        if (SB.strumOnMetronomeStop) SB.strumOnMetronomeStop();
        if (SB.gridOnMetronomeStop) SB.gridOnMetronomeStop();
    }

    SB.toggleMetronome = function () {
        if (SB.state.metronome.playing) SB.stopMetronome();
        else SB.startMetronome();
    }

    /* ---------------- bpm ---------------- */

    /* Steps the tempo relative to the current one. Does nothing when there is
     * no tempo to step from: null coerces to 0 in arithmetic, so a bare
     * bpm +/- 1 would clamp to BPM_MIN and invent a tempo for a song that
     * has none, un-hiding the control. The UI hides the stepper in that
     * state, but the guard belongs here rather than relying on that. */
    SB.stepBpm = function (delta) {
        if (SB.state.metronome.bpm === null) return;
        SB.setBpm(SB.state.metronome.bpm + delta);
    }

    SB.setBpm = function (v) {
        if (typeof v !== 'number' || !isFinite(v)) return;
        var bpm = clampBpm(Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(v))));
        if (bpm === null || bpm === SB.state.metronome.bpm) { SB.updateMetronomeUi(); return; }
        // Re-anchor the phase clock so a live tempo change does not make the
        // strum highlight jump or drift: keep the current beat phase fixed and
        // only change how fast it advances from here. Done before writing bpm
        // so the old seconds-per-beat is still in SB.state.metronome.bpm.
        if (SB.state.metronome.playing && ctx) {
            var oldSpb = 60 / SB.state.metronome.bpm;
            var beatsNow = (ctx.currentTime - startTime) / oldSpb;
            startTime = ctx.currentTime - beatsNow * (60 / bpm);
        }
        SB.state.metronome.bpm = bpm;
        SB.updateMetronomeUi();
        if (SB.state.active && SB.state.currentSong) {
            try { window.localStorage.setItem(SB.bpmKey(SB.state.active.id, SB.state.currentSong.id), String(bpm)); }
            catch (e) { /* ignore */ }
        }
        // A tempo change mid-count takes effect from the next scheduled
        // click: the scheduler reads bpm each pass, and anything already
        // handed to the audio clock stays where it was put.
    }

    /* Called from SB.openSong. Picks up the song's tempo (or the user's
     * override), sets the meter, and hides the whole control for songs with
     * no tempo data at all. */
    SB.loadMetronomeForSong = function (song) {
        SB.stopMetronome();
        var bpm = tempoFor(song);
        SB.state.metronome.bpm = bpm;
        SB.state.metronome.beats = SB.metronomeBeatsPerBar(song && song.time);
        SB.updateMetronomeUi();
    }

    SB.updateMetronomeUi = function () {
        var group = SB.$('metronomeGroup');
        if (!group) return;
        var on = SB.state.metronome.bpm !== null;
        group.hidden = !on;
        if (!on) return;
        SB.$('bpmValue').textContent = SB.state.metronome.bpm;
        var btn = SB.$('metronomeBtn');
        btn.textContent = SB.state.metronome.playing ? '⏸' : '▶';
        btn.classList.toggle('playing', SB.state.metronome.playing);
        btn.setAttribute('aria-pressed', SB.state.metronome.playing ? 'true' : 'false');
        var label = SB.state.metronome.playing ? 'Stop the metronome' : 'Start the metronome';
        btn.setAttribute('aria-label', label);
        btn.title = label;
    }

    SB.bindMetronome = function () {
        var btn = SB.$('metronomeBtn');
        if (!btn) return;
        btn.addEventListener('click', SB.toggleMetronome);
        SB.$('bpmDown').addEventListener('click', function () { SB.stepBpm(-1); });
        SB.$('bpmUp').addEventListener('click', function () { SB.stepBpm(1); });
    }

})(window.SB = window.SB || {});
