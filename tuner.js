/*!
 * Songbook Tuner — microphone pitch detection and tuner UI.
 *
 * The pitch engine is adapted from fgnass/tuner (https://github.com/fgnass/tuner),
 * a hybrid YIN + FFT harmonic-refinement detector with octave guards and
 * One-Euro smoothing. Used under the MIT license:
 *
 * MIT License
 *
 * Copyright (c) 2026 Felix Gnass
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(function (root) {
    'use strict';

    var NS = 'songbook';
    var A4_MIN = 430;
    var A4_MAX = 450;
    var CAPTURE_SIZE = 8192;
    var DETECT_INTERVAL_MS = 40;
    var HOLD_MS = 700;
    var CLARITY_GATE = 0.9;
    var NEW_NOTE_CENTS = 250;
    var STABILITY_WINDOW = 5;
    var STABILITY_CENTS = 20;
    var NOISE_FLOOR_MIN = 5e-4;
    var NOISE_RISE = 0.02;
    var NOISE_FALL = 0.30;
    var TONAL_CLARITY = 0.6;
    var SNR_LO = 6, SNR_HI = 30;
    var GATE_NOISY = 0.93, GATE_CLEAN = 0.82;
    var WINDOW_NOISY = 7, WINDOW_CLEAN = 3;
    var LOWPASS_HZ = 5000;
    var IN_TUNE_CENTS = 3;
    var METER_RANGE = 50;
    var METER_TRAVEL = 0.9;

    var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var IS_ANDROID = /Android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');

    /* ======================================================================
     * Pitch engine (adapted from fgnass/tuner, MIT)
     * ==================================================================== */

    function createPitchDetector(options) {
        options = options || {};
        var minFreq = options.minFreq || 28;
        var maxFreq = options.maxFreq || 1500;

        var RMS_THRESHOLD = 0.004;
        var YIN_THRESHOLD = 0.2;
        var YIN_FALLBACK = 0.6;
        var MAX_HARMONICS = 12;
        var HARMONIC_TOLERANCE = 0.06;
        var RELATIVE_PEAK_THRESHOLD = 5e-3;
        var SUBHARMONIC_FLOOR = 1e-4;
        var SUBHARMONIC_PROMINENCE = 12;

        var yinBuf = new Float32Array(0);
        var window = new Float32Array(0);
        var re1 = new Float32Array(0);
        var im1 = new Float32Array(0);
        var re2 = new Float32Array(0);
        var im2 = new Float32Array(0);
        var mag2 = new Float32Array(0);
        var fftSize = 0;
        var hop = 0;

        function ensureSized(bufLen) {
            var m = floorPow2(bufLen);
            while (m + (m >> 2) > bufLen && m > 256) m >>= 1;
            if (m === fftSize) return;
            fftSize = m;
            hop = m >> 2;
            window = new Float32Array(m);
            for (var i = 0; i < m; i++) {
                window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (m - 1)));
            }
            re1 = new Float32Array(m);
            im1 = new Float32Array(m);
            re2 = new Float32Array(m);
            im2 = new Float32Array(m);
            mag2 = new Float32Array((m >> 1) + 1);
        }

        function detect(buffer, sampleRate) {
            var n = buffer.length;
            var sumSquares = 0;
            for (var i = 0; i < n; i++) sumSquares += buffer[i] * buffer[i];
            var rms = Math.sqrt(sumSquares / n);
            if (rms < RMS_THRESHOLD) return { freq: -1, clarity: 0, rms: 0 };

            var seed = yin(buffer, sampleRate, minFreq, maxFreq);
            if (seed.freq <= 0) return { freq: -1, clarity: seed.clarity, rms: rms };

            ensureSized(n);
            var refinedFreq = refine(buffer, sampleRate, seed.freq);

            return {
                freq: refinedFreq > 0 ? refinedFreq : seed.freq,
                clarity: seed.clarity,
                rms: rms
            };
        }

        function yin(buffer, sampleRate, fMin, fMax) {
            var W = n2(buffer.length);
            var minLag = Math.max(2, Math.floor(sampleRate / fMax));
            var maxLag = Math.min(W - 1, Math.ceil(sampleRate / fMin));
            if (maxLag <= minLag) return { freq: -1, clarity: 0 };

            if (yinBuf.length < maxLag + 1) yinBuf = new Float32Array(maxLag + 1);
            var yinArr = yinBuf;
            yinArr[0] = 1;
            var runningSum = 0;
            for (var tau = 1; tau <= maxLag; tau++) {
                var sum = 0;
                for (var j = 0; j < W; j++) {
                    var d = buffer[j] - buffer[j + tau];
                    sum += d * d;
                }
                runningSum += sum;
                yinArr[tau] = runningSum > 0 ? (sum * tau) / runningSum : 1;
            }

            var lag = -1;
            for (var t = minLag; t <= maxLag; t++) {
                if (yinArr[t] < YIN_THRESHOLD) {
                    while (t + 1 <= maxLag && yinArr[t + 1] < yinArr[t]) t++;
                    lag = t;
                    break;
                }
            }
            if (lag === -1) {
                var best = minLag;
                for (var b = minLag + 1; b <= maxLag; b++) {
                    if (yinArr[b] < yinArr[best]) best = b;
                }
                if (yinArr[best] > YIN_FALLBACK) return { freq: -1, clarity: 1 - yinArr[best] };
                lag = best;
            }

            var refinedLag = parabolicMin(yinArr, lag);
            return { freq: sampleRate / refinedLag, clarity: 1 - yinArr[lag] };
        }

        function refine(buffer, sampleRate, f0Seed) {
            var m = fftSize;
            var half = m >> 1;
            var df = sampleRate / m;

            transform(buffer, 0, re1, im1);
            transform(buffer, hop, re2, im2);

            var maxMag2 = 0;
            for (var k = 1; k <= half; k++) {
                var p = re1[k] * re1[k] + im1[k] * im1[k];
                mag2[k] = p;
                if (p > maxMag2) maxMag2 = p;
            }
            if (maxMag2 === 0) return -1;

            var peakThreshold = maxMag2 * RELATIVE_PEAK_THRESHOLD;

            function prominentPeakNear(freq) {
                var center = Math.round(freq / df);
                var tb = Math.max(2, Math.round((HARMONIC_TOLERANCE * freq) / df));
                var kp = -1;
                for (var n = Math.max(1, center - tb); n <= Math.min(half - 1, center + tb); n++) {
                    if (mag2[n] >= mag2[n - 1] && mag2[n] >= mag2[n + 1] &&
                        (kp < 0 || mag2[n] > mag2[kp])) kp = n;
                }
                if (kp < 0 || mag2[kp] < maxMag2 * SUBHARMONIC_FLOOR) return false;
                var wlo = Math.max(1, center - 6 * tb);
                var whi = Math.min(half - 1, center + 6 * tb);
                var neighbourhood = [];
                for (var q = wlo; q <= whi; q++) {
                    if (Math.abs(q - kp) > 1) neighbourhood.push(mag2[q]);
                }
                neighbourhood.sort(function (a, b) { return a - b; });
                var floor = neighbourhood.length > 0
                    ? neighbourhood[neighbourhood.length >> 1] : 0;
                return mag2[kp] >= SUBHARMONIC_PROMINENCE * floor;
            }

            var f0Base = f0Seed;
            for (var i = 0; i < 2; i++) {
                var sub = f0Base / 2;
                if (sub < minFreq) break;
                if (prominentPeakNear(sub) && prominentPeakNear(1.5 * f0Base)) f0Base = sub;
                else break;
            }

            var tolBins = Math.max(1, Math.round((HARMONIC_TOLERANCE * f0Base) / df));
            var sumW = 0;
            var sumWFoverH = 0;
            var nyquist = sampleRate * 0.5;

            for (var h = 1; h <= MAX_HARMONICS; h++) {
                var expected = h * f0Base;
                if (expected > nyquist * 0.95) break;

                var center = Math.round(expected / df);
                var kp = -1;
                var best = peakThreshold;
                for (var k2 = Math.max(1, center - tolBins); k2 <= Math.min(half - 1, center + tolBins); k2++) {
                    if (mag2[k2] > best && mag2[k2] >= mag2[k2 - 1] && mag2[k2] >= mag2[k2 + 1]) {
                        best = mag2[k2];
                        kp = k2;
                    }
                }
                if (kp < 0) continue;

                var frac = parabolicOffset(mag2[kp - 1], mag2[kp], mag2[kp + 1]);
                var freqH = (kp + frac) * df;

                var freqPhase = instantaneousFreq(kp, sampleRate);
                if (isFinite(freqPhase) && Math.abs(freqPhase - freqH) < df) freqH = freqPhase;

                var mag = Math.sqrt(mag2[kp]);
                var w = aWeight(freqH) * mag;
                sumW += w;
                sumWFoverH += w * (freqH / h);
            }

            if (sumW === 0) return -1;
            return sumWFoverH / sumW;
        }

        function transform(buffer, offset, re, im) {
            var m = fftSize;
            for (var i = 0; i < m; i++) {
                re[i] = buffer[offset + i] * window[i];
                im[i] = 0;
            }
            fft(re, im);
        }

        function instantaneousFreq(k, sampleRate) {
            var m = fftSize;
            var phase1 = Math.atan2(im1[k], re1[k]);
            var phase2 = Math.atan2(im2[k], re2[k]);
            var expected = (2 * Math.PI * k * hop) / m;
            var dev = princarg(phase2 - phase1 - expected);
            var omega = (2 * Math.PI * k) / m + dev / hop;
            return (omega * sampleRate) / (2 * Math.PI);
        }

        return { detect: detect, minFreq: minFreq, maxFreq: maxFreq };
    }

    function n2(n) { return n >> 1; }

    function floorPow2(n) {
        var p = 1;
        while (p << 1 <= n) p <<= 1;
        return p;
    }

    function princarg(phase) {
        return phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));
    }

    function parabolicMin(arr, i) {
        if (i <= 0 || i >= arr.length - 1) return i;
        var a = arr[i - 1], b = arr[i], c = arr[i + 1];
        var denom = a - 2 * b + c;
        if (denom <= 0) return i;
        return i + (0.5 * (a - c)) / denom;
    }

    function parabolicOffset(left, center, right) {
        var denom = left - 2 * center + right;
        if (denom >= 0) return 0;
        return (0.5 * (left - right)) / denom;
    }

    function aWeight(f) {
        var f2 = f * f;
        var num = 12194 * 12194 * f2 * f2;
        var den = (f2 + 20.6 * 20.6) *
            Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
            (f2 + 12194 * 12194);
        return den > 0 ? num / den : 0;
    }

    function fft(re, im) {
        var n = re.length;
        if (n <= 1) return;
        for (var i = 1, j = 0; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var tr = re[i]; re[i] = re[j]; re[j] = tr;
                var ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (var len = 2; len <= n; len <<= 1) {
            var half = len >> 1;
            var ang = (-2 * Math.PI) / len;
            var wr = Math.cos(ang);
            var wi = Math.sin(ang);
            for (var start = 0; start < n; start += len) {
                var cr = 1, ci = 0;
                for (var k = 0; k < half; k++) {
                    var a = start + k;
                    var b = a + half;
                    var xr = re[b] * cr - im[b] * ci;
                    var xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                    var ncr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = ncr;
                }
            }
        }
    }

    /* ======================================================================
     * Notes, target tracking and smoothing
     * ==================================================================== */

    function noteFromMidi(midi, a4) {
        var semis = midi - 69;
        return {
            semitones: semis,
            midi: midi,
            name: NOTE_NAMES[((midi % 12) + 12) % 12],
            octave: Math.floor(midi / 12) - 1,
            freq: a4 * Math.pow(2, semis / 12)
        };
    }

    function noteFromName(label, a4) {
        var match = /^([A-G])(#|b)?(-?\d+)$/.exec(String(label).trim());
        if (!match) throw new Error('Invalid note: ' + label);
        var index = NOTE_NAMES.indexOf(match[1]);
        var octave = parseInt(match[3], 10);
        var midi = (octave + 1) * 12 + index;
        if (match[2] === '#') midi++;
        if (match[2] === 'b') midi--;
        return noteFromMidi(midi, a4);
    }

    function centsOff(freq, refFreq) {
        return 1200 * Math.log(freq / refFreq) / Math.LN2;
    }

    function nearestNote(freq, a4) {
        var midi = 69 + Math.round(12 * Math.log(freq / a4) / Math.LN2);
        var note = noteFromMidi(midi, a4);
        return { note: note, cents: centsOff(freq, note.freq) };
    }

    function octaveSnap(freq, current) {
        if (!current || current <= 0) return freq;
        var semis = 12 * Math.log(freq / current) / Math.LN2;
        var oct = Math.round(semis / 12);
        if (oct !== 0 && Math.abs(semis - oct * 12) < 1) return freq / Math.pow(2, oct);
        return freq;
    }

    function TargetTracker() {
        this.currentSemitone = null;
        this.currentIndex = -1;
    }
    TargetTracker.prototype.reset = function () {
        this.currentSemitone = null;
        this.currentIndex = -1;
    };
    TargetTracker.prototype.chromatic = function (freq, a4) {
        if (this.currentSemitone !== null) {
            var cur = noteFromMidi(69 + this.currentSemitone, a4);
            var c = centsOff(freq, cur.freq);
            if (Math.abs(c) <= 65) return { note: cur, cents: c };
        }
        var nearest = nearestNote(freq, a4);
        this.currentSemitone = nearest.note.semitones;
        return nearest;
    };
    TargetTracker.prototype.string = function (freq, notes) {
        var best = 0;
        var bestAbs = Infinity;
        for (var i = 0; i < notes.length; i++) {
            var a = Math.abs(centsOff(freq, notes[i].freq));
            if (a < bestAbs) { bestAbs = a; best = i; }
        }
        if (this.currentIndex >= 0 && this.currentIndex < notes.length && this.currentIndex !== best) {
            var currentAbs = Math.abs(centsOff(freq, notes[this.currentIndex].freq));
            if (currentAbs - bestAbs < 30) best = this.currentIndex;
        }
        this.currentIndex = best;
        return { index: best, cents: centsOff(freq, notes[best].freq) };
    };

    function OneEuroFilter(minCutoff, beta, dCutoff) {
        this.minCutoff = minCutoff == null ? 0.6 : minCutoff;
        this.beta = beta == null ? 0.06 : beta;
        this.dCutoff = dCutoff == null ? 1.0 : dCutoff;
        this.xPrev = null;
        this.dxPrev = 0;
    }
    OneEuroFilter.prototype.reset = function () {
        this.xPrev = null;
        this.dxPrev = 0;
    };
    OneEuroFilter.prototype.filter = function (x, dt) {
        if (this.xPrev === null || dt <= 0) {
            this.xPrev = x;
            this.dxPrev = 0;
            return x;
        }
        var dx = (x - this.xPrev) / dt;
        var dxHat = this.dxPrev + smoothingAlpha(this.dCutoff, dt) * (dx - this.dxPrev);
        var cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        var xHat = this.xPrev + smoothingAlpha(cutoff, dt) * (x - this.xPrev);
        this.xPrev = xHat;
        this.dxPrev = dxHat;
        return xHat;
    };
    function smoothingAlpha(cutoff, dt) {
        var tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dt);
    }

    /* ======================================================================
     * Instrument presets
     * ==================================================================== */

    var INSTRUMENTS = {
        ukulele: {
            id: 'ukulele',
            label: 'Ukulele',
            range: { min: 130, max: 900 },
            tunings: [
                { id: 'uke-standard', name: 'Standard · high G', strings: ['G4', 'C4', 'E4', 'A4'] },
                { id: 'uke-low-g', name: 'Low G', strings: ['G3', 'C4', 'E4', 'A4'] },
                { id: 'uke-baritone', name: 'Baritone', strings: ['D3', 'G3', 'B3', 'E4'] }
            ]
        },
        guitar: {
            id: 'guitar',
            label: 'Guitar',
            range: { min: 55, max: 700 },
            tunings: [
                { id: 'guitar-standard', name: 'Standard', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
                { id: 'guitar-drop-d', name: 'Drop D', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
                { id: 'guitar-half-step', name: 'Half-step down', strings: ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'] },
                { id: 'guitar-dadgad', name: 'DADGAD', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] }
            ]
        }
    };

    function tuningById(instrument, id) {
        var list = INSTRUMENTS[instrument].tunings;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return list[0];
    }

    function storedTuning(instrument) {
        var saved = lsGet(NS + ':tuner:tuning:' + instrument, null);
        if (saved) {
            var list = INSTRUMENTS[instrument].tunings;
            for (var i = 0; i < list.length; i++) if (list[i].id === saved) return saved;
        }
        return INSTRUMENTS[instrument].tunings[0].id;
    }

    /* ======================================================================
     * Small helpers
     * ==================================================================== */

    function lsGet(key, fallback) {
        try {
            var v = window.localStorage.getItem(key);
            return v === null ? fallback : JSON.parse(v);
        } catch (e) { return fallback; }
    }
    function lsSet(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function adaptFromSnr(snrDb) {
        var t = clamp((snrDb - SNR_LO) / (SNR_HI - SNR_LO), 0, 1);
        return {
            gate: GATE_NOISY + (GATE_CLEAN - GATE_NOISY) * t,
            window: Math.round(WINDOW_NOISY + (WINDOW_CLEAN - WINDOW_NOISY) * t),
            quality: t
        };
    }
    function fmtCents(c) {
        var r = Math.round(c);
        return (r > 0 ? '+' : '') + r + '\u00a2';
    }

    /* ======================================================================
     * UI state
     * ==================================================================== */

    var state = {
        open: false,
        status: 'idle',
        instrument: 'ukulele',
        tuningId: null,
        a4: (function () {
            var saved = lsGet(NS + ':tuner:a4', 440);
            return typeof saved === 'number' && isFinite(saved) && saved >= A4_MIN && saved <= A4_MAX
                ? saved : 440;
        })(),
        auto: true,
        manualIndex: -1,
        notes: [],
        detector: null,
        tracker: new TargetTracker(),
        filter: new OneEuroFilter(0.6, 0.06, 1.0),

        hasReading: false,
        targetIndex: -1,
        targetNote: null,
        cents: null,
        smoothedFreq: -1,
        detectedFreq: -1,
        clarity: 0,
        displayCents: 0,

        recentCents: [],
        lastGoodAt: 0,
        lastDetectAt: 0,
        lastFilterAt: 0,

        noiseFloor: NOISE_FLOOR_MIN,
        snrDb: 0,
        effGate: CLARITY_GATE,
        effWindow: STABILITY_WINDOW,
        confTarget: 0,
        confidence: 0,

        raf: 0,
        meterRaf: 0,
        stream: null,
        ctx: null,
        analyser: null,
        buffer: null,
        source: null,
        highpass: null,
        lowpass: null,
        session: 0,
        gumPending: null,
        retriedPermission: false
    };

    var opts = {};
    var els = {};
    var lastFocus = null;
    var bound = false;

    function applyInstrument(id) {
        if (!INSTRUMENTS[id]) id = 'ukulele';
        state.instrument = id;
        state.tuningId = storedTuning(id);
        if (state.manualIndex >= 0) {
            state.auto = true;
            state.manualIndex = -1;
        }
        var range = INSTRUMENTS[id].range;
        state.detector = createPitchDetector({ minFreq: range.min, maxFreq: range.max });
        state.notes = notesForTuning(state.tuningId);
        state.tracker.reset();
        resetTracking();
        buildTuningSelect();
        rebuildStrings();
        updateInstrumentTabs();
        render();
    }

    function notesForTuning(id) {
        var tuning = tuningById(state.instrument, id);
        var out = [];
        for (var i = 0; i < tuning.strings.length; i++) {
            out.push(noteFromName(tuning.strings[i], state.a4));
        }
        return out;
    }

    function resetTracking() {
        state.filter.reset();
        state.recentCents.length = 0;
        state.smoothedFreq = -1;
        state.detectedFreq = -1;
        state.clarity = 0;
        state.lastGoodAt = 0;
        state.lastFilterAt = 0;
        state.hasReading = false;
        state.targetIndex = -1;
        state.targetNote = null;
        state.cents = null;
        state.displayCents = 0;
        state.snrDb = 0;
        state.effGate = CLARITY_GATE;
        state.effWindow = STABILITY_WINDOW;
        state.confTarget = 0;
        state.confidence = 0;
        renderConfidence();
    }

    /* ======================================================================
     * Rendering
     * ==================================================================== */

    function render() {
        if (!els.overlay) return;

        var has = state.hasReading && state.targetNote;
        var inTune = has && Math.abs(state.cents) <= IN_TUNE_CENTS;

        els.display.classList.toggle('in-tune', inTune);
        els.display.classList.toggle('is-idle', !has);

        if (has) {
            var name = state.targetNote.name;
            var accidental = '';
            if (name.length > 1) {
                accidental = name.slice(1);
                name = name.slice(0, 1);
            }
            setText(els.noteName, name);
            setText(els.accidental, accidental === '#' ? '\u266f' : '\u266d');
            els.accidental.hidden = !accidental;
            setText(els.octave, String(state.targetNote.octave));
            setText(els.cents, fmtCents(state.cents));
            setText(els.freq, state.smoothedFreq.toFixed(1) + ' Hz');
        } else {
            setText(els.noteName, '\u2014');
            els.accidental.hidden = true;
            setText(els.octave, '');
            setText(els.cents, '');
            setText(els.freq, '');
        }

        var listening = state.status === 'listening';
        var requesting = state.status === 'requesting';
        var startText = listening ? 'Stop listening' : requesting ? 'Waiting\u2026' : 'Start listening';
        setText(els.start, startText);
        els.start.classList.toggle('listening', listening);
        els.start.disabled = requesting;

        var statusText;
        if (state.status === 'idle') statusText = 'Tap start, then play a string.';
        else if (state.status === 'requesting') statusText = 'Waiting for microphone\u2026';
        else if (state.status === 'insecure') statusText = 'Microphone needs HTTPS. Open the hosted app or serve this folder over localhost.';
        else if (state.status === 'os-denied') statusText = IS_ANDROID
            ? 'Chrome is blocked from the microphone. Allow it in Settings \u2192 Apps \u2192 Chrome \u2192 Permissions, then retry.'
            : 'Your device is blocking Chrome from the microphone. Allow it in system settings, then retry.';
        else if (state.status === 'denied') statusText = IS_ANDROID
            ? 'Microphone blocked for this site. Tap the lock icon \u2192 Permissions \u2192 Microphone \u2192 Allow, then retry.'
            : 'Microphone blocked. Allow microphone access for this site in Chrome, then retry.';
        else if (state.status === 'no-device') statusText = 'No microphone found on this device.';
        else if (state.status === 'busy') statusText = 'Microphone is busy or unavailable. Close other apps using it and retry.';
        else if (state.status === 'unsupported') statusText = 'This browser does not support microphone input.';
        else if (state.status === 'error') statusText = 'Could not access the microphone.';
        else if (!has) statusText = 'Listening\u2026 play a string.';
        else if (inTune) statusText = 'In tune';
        else if (Math.abs(state.cents) > 250) statusText = 'That sounds like another string.';
        else statusText = state.cents < 0 ? 'Tune up' : 'Tune down';
        setText(els.status, statusText);

        setText(els.calValue, String(state.a4));
        renderStrings();
    }

    function renderStrings() {
        var has = state.hasReading;
        var inTune = has && Math.abs(state.cents) <= IN_TUNE_CENTS;
        if (els.autoBtn) {
            els.autoBtn.classList.toggle('active', state.auto);
            els.autoBtn.setAttribute('aria-pressed', state.auto ? 'true' : 'false');
            els.autoBtn.classList.remove('in-tune');
        }
        for (var i = 0; i < state.stringEls.length; i++) {
            var b = state.stringEls[i];
            var active = state.auto ? (state.targetIndex === i) : (state.manualIndex === i);
            b.classList.toggle('active', active);
            b.classList.toggle('in-tune', !!active && inTune);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
    }

    function setText(node, text) {
        if (node && node.textContent !== text) node.textContent = text;
    }

    function updateInstrumentTabs() {
        for (var i = 0; i < els.tabs.length; i++) {
            var b = els.tabs[i];
            var on = b.getAttribute('data-tuner-instrument') === state.instrument;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    function buildTuningSelect() {
        if (!els.tuning) return;
        els.tuning.textContent = '';
        var list = INSTRUMENTS[state.instrument].tunings;
        for (var i = 0; i < list.length; i++) {
            var opt = document.createElement('option');
            opt.value = list[i].id;
            opt.textContent = list[i].name;
            els.tuning.appendChild(opt);
        }
        els.tuning.value = state.tuningId;
    }

    function rebuildStrings() {
        if (!els.strings) return;
        els.strings.textContent = '';
        els.strings.style.setProperty('--tuner-cols', String(state.notes.length + 1));

        els.autoBtn = document.createElement('button');
        els.autoBtn.type = 'button';
        els.autoBtn.className = 'tuner-string tuner-string-auto';
        els.autoBtn.setAttribute('aria-label', 'Automatically detect the string');
        els.autoBtn.setAttribute('aria-pressed', 'true');
        var autoNote = document.createElement('span');
        autoNote.className = 'tuner-string-note';
        autoNote.textContent = 'Auto';
        var autoSub = document.createElement('span');
        autoSub.className = 'tuner-string-sub';
        autoSub.textContent = 'nearest';
        els.autoBtn.appendChild(autoNote);
        els.autoBtn.appendChild(autoSub);
        els.autoBtn.addEventListener('click', function () {
            state.auto = true;
            state.manualIndex = -1;
            state.tracker.reset();
            resetTracking();
            render();
        });
        els.strings.appendChild(els.autoBtn);

        state.stringEls = [];
        for (var i = 0; i < state.notes.length; i++) {
            (function (index) {
                var note = state.notes[index];
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'tuner-string';
                b.setAttribute('aria-label', 'Tune ' + note.name + note.octave + ' string');
                b.setAttribute('aria-pressed', 'false');

                var nameEl = document.createElement('span');
                nameEl.className = 'tuner-string-note';
                nameEl.textContent = note.name.replace('#', '\u266f');
                var octEl = document.createElement('span');
                octEl.className = 'tuner-string-oct';
                octEl.textContent = String(note.octave);

                b.appendChild(nameEl);
                b.appendChild(octEl);
                b.addEventListener('click', function () {
                    state.auto = false;
                    state.manualIndex = index;
                    state.tracker.reset();
                    resetTracking();
                    render();
                });
                els.strings.appendChild(b);
                state.stringEls.push(b);
            })(i);
        }
        renderStrings();
    }

    function meterLoop() {
        if (!state.open) { state.meterRaf = 0; return; }
        var target = state.hasReading ? state.cents : 0;
        state.displayCents += (target - state.displayCents) * 0.22;
        if (Math.abs(target - state.displayCents) < 0.05) state.displayCents = target;
        var cents = clamp(state.displayCents, -METER_RANGE, METER_RANGE);
        var left = 50 + cents * METER_TRAVEL;
        if (els.needle) els.needle.style.left = left.toFixed(2) + '%';
        state.confidence += (state.confTarget - state.confidence) * 0.15;
        renderConfidence();
        state.meterRaf = requestAnimationFrame(meterLoop);
    }

    function renderConfidence() {
        if (!els.confidence) return;
        var pct = Math.round(clamp(state.confidence, 0, 1) * 100);
        els.confidence.style.width = pct + '%';
        els.confidence.classList.toggle('good', state.confidence >= 0.7);
        els.confidence.classList.toggle('ok', state.confidence >= 0.4 && state.confidence < 0.7);
    }

    /* ======================================================================
     * Audio lifecycle
     * ==================================================================== */

    // Chrome refuses microphone access to file:// documents and its prompts
    // never persist there, so asking anyway just produces a prompt loop.
    function originProblem() {
        if (window.isSecureContext === false) return 'insecure';
        if (typeof location !== 'undefined' && location.protocol === 'file:') return 'insecure';
        return null;
    }

    function statusForError(err, permissionState) {
        var name = err && err.name;
        var message = (err && err.message) || '';
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device';
        if (name === 'NotReadableError' || name === 'TrackStartError') return 'busy';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
            // Chrome reports an OS-level block as "Permission denied by
            // system" on desktop. On Android the message is generic, but if
            // the site permission is already granted the block is at the
            // OS/app layer too.
            if (/system/i.test(message) || permissionState === 'granted') return 'os-denied';
            return 'denied';
        }
        return 'error';
    }

    function refineDeniedStatus() {
        if (!navigator.permissions || !navigator.permissions.query) return;
        var query;
        try {
            query = navigator.permissions.query({ name: 'microphone' });
        } catch (e) {
            return;
        }
        if (!query || !query.then) return;
        query.then(function (permission) {
            if (state.status !== 'denied') return;
            if (!permission || permission.state !== 'granted') return;
            // The site grant is in place, so a rejection is either an OS
            // block or a transient failure while the dialog had focus. Retry
            // once, then report it as an OS-level block.
            if (!state.retriedPermission) {
                state.retriedPermission = true;
                state.status = 'idle';
                render();
                // Give the page a moment to regain focus after the system
                // dialog before retrying, if it is still open.
                window.setTimeout(function () { if (state.open) start(); }, 250);
                return;
            }
            state.status = 'os-denied';
            render();
        }).catch(function () { /* permission name unsupported */ });
    }

    function start() {
        if (!state.open) return;
        if (state.status === 'requesting' || state.status === 'listening') return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            state.status = 'unsupported';
            render();
            return;
        }
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            state.status = 'unsupported';
            render();
            return;
        }
        var originError = originProblem();
        if (originError) {
            state.status = originError;
            render();
            return;
        }

        // A prompt may still be pending after the tuner was closed and
        // reopened. Never stack another getUserMedia request on top of it:
        // each one shows its own prompt, which looks like a prompt loop.
        if (state.gumPending) {
            state.status = 'requesting';
            render();
            return;
        }

        // Create and resume the AudioContext inside the click gesture. iOS
        // requires this; doing it after the getUserMedia await can leave a
        // context permanently suspended.
        var ctx;
        try {
            ctx = new AudioCtx();
            state.ctx = ctx;
        } catch (e) {
            state.status = 'error';
            render();
            return;
        }
        var resumed = ctx.resume ? ctx.resume() : Promise.resolve();
        // Swallow rejection here; the context is not required to start the
        // stream, and openAudio() nudges it again once capture is live.
        if (resumed && resumed.catch) resumed.catch(function () { /* handled below */ });

        var session = ++state.session;
        state.status = 'requesting';
        render();

        var request = navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        state.gumPending = request;

        request.then(function (stream) {
            if (state.gumPending === request) state.gumPending = null;
            if (!state.open || session !== state.session) {
                stopTracks(stream);
                // The user closed/reopened the tuner while the prompt was up.
                // Let them start again now that permission was answered.
                if (state.open && state.status === 'requesting') {
                    state.status = 'idle';
                    render();
                }
                return;
            }
            state.stream = stream;
            openAudio(stream, ctx, session);
        }).catch(function (err) {
            if (state.gumPending === request) state.gumPending = null;
            if (session !== state.session) {
                closeContext(ctx);
                if (state.open && state.status === 'requesting') {
                    state.status = 'idle';
                    render();
                }
                return;
            }
            releaseAudio();
            state.status = statusForError(err);
            render();
            if (state.status === 'denied') refineDeniedStatus();
        });
    }

    function openAudio(stream, ctx, session) {
        if (!state.open || !ctx || session !== state.session) {
            stopTracks(stream);
            closeContext(ctx);
            return;
        }
        state.stream = stream;
        var source = ctx.createMediaStreamSource(stream);
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = Math.max(20, INSTRUMENTS[state.instrument].range.min * 0.7);
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = LOWPASS_HZ;
        var analyser = ctx.createAnalyser();
        analyser.fftSize = CAPTURE_SIZE;
        source.connect(hp);
        hp.connect(lp);
        lp.connect(analyser);

        state.source = source;
        state.highpass = hp;
        state.lowpass = lp;
        state.analyser = analyser;
        state.buffer = new Float32Array(analyser.fftSize);
        state.lastDetectAt = 0;
        state.noiseFloor = NOISE_FLOOR_MIN;
        // Never block capture on resume(): some Android builds keep the
        // promise pending while the permission dialog is on screen. Nudge the
        // context now that the graph is wired and let the loop wait for data.
        if (ctx.state !== 'running' && ctx.resume) {
            try {
                var resuming = ctx.resume();
                if (resuming && resuming.catch) resuming.catch(function () { /* ignore */ });
            } catch (e) { /* ignore */ }
        }
        state.status = 'listening';
        resetTracking();
        render();
        state.raf = requestAnimationFrame(loop);
    }

    function closeContext(ctx) {
        if (!ctx || ctx.state === 'closed' || !ctx.close) return;
        var closing = ctx.close();
        if (closing && closing.catch) closing.catch(function () { /* ignore */ });
    }

    function releaseAudio() {
        state.session++;
        if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
        if (state.stream) stopTracks(state.stream);
        closeContext(state.ctx);
        state.stream = null;
        state.ctx = null;
        state.analyser = null;
        state.buffer = null;
        state.source = null;
        state.highpass = null;
        state.lowpass = null;
    }

    function stopTracks(stream) {
        try {
            var tracks = stream.getTracks();
            for (var i = 0; i < tracks.length; i++) tracks[i].stop();
        } catch (e) { /* ignore */ }
    }

    function stop() {
        releaseAudio();
        state.status = 'idle';
        resetTracking();
        render();
    }

    function loop(now) {
        if (state.status !== 'listening') { state.raf = 0; return; }
        if (!state.lastDetectAt || now - state.lastDetectAt >= DETECT_INTERVAL_MS) {
            state.lastDetectAt = now;
            state.analyser.getFloatTimeDomainData(state.buffer);
            var result = state.detector.detect(state.buffer, state.ctx.sampleRate);
            processResult(result, now);
        }
        state.raf = requestAnimationFrame(loop);
    }

    function processResult(result, now) {
        state.detectedFreq = result.freq;
        state.clarity = result.clarity;
        var listening = state.status === 'listening';

        // Classify by a loose fixed bar so floor-tracking doesn't depend on
        // the adaptive gate, then derive a live SNR and tune the gate to it.
        var tonal = result.freq > 0 && result.clarity >= TONAL_CLARITY;
        if (!tonal && result.rms > 0) {
            var a = result.rms > state.noiseFloor ? NOISE_RISE : NOISE_FALL;
            state.noiseFloor += a * (result.rms - state.noiseFloor);
        }
        state.noiseFloor = Math.max(state.noiseFloor, NOISE_FLOOR_MIN);

        var rmsNow = result.rms > 0 ? result.rms : state.noiseFloor;
        state.snrDb = 20 * Math.log(rmsNow / state.noiseFloor) / Math.LN10;
        var adapt = adaptFromSnr(state.snrDb);
        state.effGate = adapt.gate;
        state.effWindow = adapt.window;

        var confident = result.freq > 0 && result.clarity >= state.effGate;
        var clarityScore = clamp((result.clarity - 0.5) / (0.97 - 0.5), 0, 1);
        state.confTarget = confident ? (0.5 * clarityScore + 0.5 * adapt.quality) : 0;

        if (confident) {
            var absCents = 1200 * Math.log(result.freq) / Math.LN2;
            state.recentCents.push(absCents);
            while (state.recentCents.length > state.effWindow) state.recentCents.shift();

            var stable = state.recentCents.length >= state.effWindow;
            if (stable) {
                var lo = state.recentCents[0], hi = state.recentCents[0];
                for (var i = 1; i < state.recentCents.length; i++) {
                    if (state.recentCents[i] < lo) lo = state.recentCents[i];
                    if (state.recentCents[i] > hi) hi = state.recentCents[i];
                }
                if (hi - lo > STABILITY_CENTS) stable = false;
            }

            if (stable) {
                var prev = state.smoothedFreq;
                var f = octaveSnap(result.freq, prev);
                var jump = prev > 0 ? Math.abs(1200 * Math.log(f / prev) / Math.LN2) : Infinity;
                if (prev > 0 && jump > NEW_NOTE_CENTS) {
                    state.filter.reset();
                    state.lastFilterAt = 0;
                }
                var dt = state.lastFilterAt > 0
                    ? Math.min(0.2, (now - state.lastFilterAt) / 1000)
                    : DETECT_INTERVAL_MS / 1000;
                state.lastFilterAt = now;
                var smoothedCents = state.filter.filter(1200 * Math.log(f) / Math.LN2, dt);
                state.smoothedFreq = Math.pow(2, smoothedCents / 1200);
                state.lastGoodAt = now;
                updateTarget();
                render();
            }
        } else {
            // Decay the window instead of clearing it, so a single noisy frame
            // doesn't drop an otherwise stable lock.
            if (state.recentCents.length) state.recentCents.shift();
            if (listening && state.lastGoodAt && now - state.lastGoodAt > HOLD_MS) {
                state.filter.reset();
                state.smoothedFreq = -1;
                state.lastFilterAt = 0;
                state.hasReading = false;
                state.targetIndex = -1;
                state.targetNote = null;
                state.cents = null;
                render();
            }
        }
    }

    function updateTarget() {
        var notes = state.notes;
        if (!notes.length || state.smoothedFreq <= 0) return;
        var index, cents;
        if (state.auto) {
            var hit = state.tracker.string(state.smoothedFreq, notes);
            index = hit.index;
            cents = hit.cents;
        } else {
            index = state.manualIndex;
            if (index < 0 || index >= notes.length) {
                state.auto = true;
                index = 0;
                return updateTarget();
            }
            cents = centsOff(state.smoothedFreq, notes[index].freq);
        }
        if (state.targetIndex !== index) state.displayCents = cents;
        state.targetIndex = index;
        state.targetNote = notes[index];
        state.cents = cents;
        state.hasReading = true;
    }

    /* ======================================================================
     * Open / close / wiring
     * ==================================================================== */

    function initDom() {
        if (bound) return true;
        els.overlay = document.getElementById('tunerOverlay');
        if (!els.overlay) return false;

        els.sheet = els.overlay.querySelector('.tuner-sheet');
        els.display = document.getElementById('tunerDisplay');
        els.noteName = document.getElementById('tunerNoteName');
        els.accidental = document.getElementById('tunerAccidental');
        els.octave = document.getElementById('tunerNoteOctave');
        els.cents = document.getElementById('tunerCents');
        els.freq = document.getElementById('tunerFreq');
        els.needle = document.getElementById('tunerNeedle');
        els.confidence = document.getElementById('tunerConfidence');
        els.status = document.getElementById('tunerStatus');
        els.strings = document.getElementById('tunerStrings');
        els.start = document.getElementById('tunerStart');
        els.calValue = document.getElementById('tunerCalValue');
        els.tuning = document.getElementById('tunerTuning');
        els.close = document.getElementById('tunerClose');
        els.tabs = document.querySelectorAll('[data-tuner-instrument]');
        state.stringEls = [];

        els.close.addEventListener('click', close);
        els.overlay.addEventListener('mousedown', function (e) {
            if (e.target === els.overlay) close();
        });
        els.start.addEventListener('click', function () {
            if (state.status === 'listening') stop();
            else {
                state.retriedPermission = false;
                start();
            }
        });
        document.getElementById('tunerCalDown').addEventListener('click', function () {
            setA4(state.a4 - 1);
        });
        document.getElementById('tunerCalUp').addEventListener('click', function () {
            setA4(state.a4 + 1);
        });
        els.tuning.addEventListener('change', function () {
            state.tuningId = els.tuning.value;
            lsSet(NS + ':tuner:tuning:' + state.instrument, state.tuningId);
            state.notes = notesForTuning(state.tuningId);
            state.tracker.reset();
            resetTracking();
            rebuildStrings();
            render();
        });
        for (var i = 0; i < els.tabs.length; i++) {
            els.tabs[i].addEventListener('click', function () {
                var id = this.getAttribute('data-tuner-instrument');
                if (!INSTRUMENTS[id] || id === state.instrument) return;
                if (opts.setInstrument) opts.setInstrument(id);
                applyInstrument(id);
            });
        }
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('visibilitychange', function () {
            if (document.hidden && state.open && state.status === 'listening') stop();
        });
        window.addEventListener('pagehide', function () {
            if (state.open) releaseAudio();
        });
        bound = true;
        return true;
    }

    function setA4(value) {
        state.a4 = clamp(Math.round(value), A4_MIN, A4_MAX);
        lsSet(NS + ':tuner:a4', state.a4);
        state.notes = notesForTuning(state.tuningId);
        state.tracker.reset();
        resetTracking();
        render();
    }

    function open(options) {
        if (state.open) return;
        if (!initDom()) return;
        opts = options || {};
        var instrument = opts.getInstrument ? opts.getInstrument() : opts.instrument;
        if (!INSTRUMENTS[instrument]) instrument = 'ukulele';
        state.instrument = instrument;
        state.tuningId = storedTuning(instrument);
        state.auto = true;
        state.manualIndex = -1;
        state.status = 'idle';
        state.retriedPermission = false;
        state.open = true;
        lastFocus = document.activeElement;

        document.body.classList.add('tuner-open');
        els.overlay.hidden = false;
        els.overlay.removeAttribute('aria-hidden');
        applyInstrument(instrument);

        state.meterRaf = requestAnimationFrame(meterLoop);
        window.setTimeout(function () {
            if (state.open) (els.sheet || els.start).focus();
        }, 0);
    }

    function close() {
        if (!state.open) return;
        stop();
        state.open = false;
        document.body.classList.remove('tuner-open');
        if (els.overlay) {
            els.overlay.hidden = true;
            els.overlay.setAttribute('aria-hidden', 'true');
        }
        if (state.meterRaf) { cancelAnimationFrame(state.meterRaf); state.meterRaf = 0; }
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        lastFocus = null;
    }

    function onKeyDown(e) {
        if (!state.open) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if (e.key === 'Tab') {
            var focusable = els.overlay.querySelectorAll('button, select, a[href]');
            var list = [];
            for (var i = 0; i < focusable.length; i++) {
                if (!focusable[i].disabled) list.push(focusable[i]);
            }
            if (!list.length) return;
            var first = list[0], last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    root.SongbookTuner = {
        open: open,
        close: close,
        isOpen: function () { return state.open; },
        _test: {
            createPitchDetector: createPitchDetector,
            noteFromName: noteFromName,
            nearestNote: nearestNote,
            centsOff: centsOff,
            octaveSnap: octaveSnap,
            adaptFromSnr: adaptFromSnr,
            statusForError: statusForError,
            originProblem: originProblem,
            gumPending: function () { return !!state.gumPending; },
            setConfidence: function (value) {
                state.confidence = clamp(value, 0, 1);
                renderConfidence();
            },
            detectorRange: function () {
                if (!state.detector) return null;
                return { min: state.detector.minFreq, max: state.detector.maxFreq };
            }
        }
    };
})(typeof window !== 'undefined' ? window : this);
