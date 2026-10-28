/* Songbook — autoscroll
 * auto-scroll, text/chord sizing and pinch zoom
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- auto-scroll ---------------- */

    try { SB.state.showNumbers = window.localStorage.getItem(SB.NS + ':numbers') === '1'; } catch (e) { /* ignore */ }
    try {
        var _cs = parseFloat(window.localStorage.getItem(SB.NS + ':chordSize'));
        if (_cs >= 0.6 && _cs <= 1.5) SB.state.chordSize = Math.round(_cs * 10) / 10;
    } catch (e) { /* ignore */ }
    try { SB.state.chordPin = window.localStorage.getItem(SB.NS + ':chordPin') !== '0'; } catch (e) { /* ignore */ }
    try {
        var _cm = window.localStorage.getItem(SB.NS + ':chordMode');
        if (_cm === 'inline' || _cm === 'above') SB.state.chordMode = _cm;
    } catch (e) { /* ignore */ }

    SB.applyChordSettings = function () {
        document.documentElement.style.setProperty('--chord-size', SB.state.chordSize);
        SB.$('chordSizeValue').textContent = Math.round(SB.state.chordSize * 100) + '%';
        var p = SB.$('chordPinBtn');
        p.setAttribute('aria-pressed', SB.state.chordPin ? 'true' : 'false');
        p.textContent = SB.state.chordPin ? '📌' : '📍';
        p.setAttribute('aria-label', SB.state.chordPin
            ? 'Chord strip pinned to the top — click to let it scroll with the lyrics'
            : 'Chord strip scrolls — click to keep it pinned to the top');
        p.title = SB.state.chordPin
            ? 'Pinned — click to let the chord strip scroll'
            : 'Not pinned — click to keep the chord strip at the top';
        SB.$('chordStrip').classList.toggle('is-static', !SB.state.chordPin);
    }

    SB.setChordSize = function (v) {
        SB.state.chordSize = Math.min(1.5, Math.max(0.6, Math.round(v * 10) / 10));
        SB.applyChordSettings();
        try { window.localStorage.setItem(SB.NS + ':chordSize', String(SB.state.chordSize)); } catch (e) { /* ignore */ }
    }

    SB.applyChordMode = function () {
        SB.$('sheet').classList.toggle('chords-above', SB.state.chordMode === 'above');
        Array.prototype.forEach.call(document.querySelectorAll('.chord-mode-btn[data-chord-mode]'), function (b) {
            var on = b.dataset.chordMode === SB.state.chordMode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    SB.applyNumbers = function () {
        var btn = SB.$('numbersBtn');
        if (!btn) return;
        btn.classList.toggle('active', SB.state.showNumbers);
        btn.setAttribute('aria-pressed', SB.state.showNumbers ? 'true' : 'false');
    }

    SB.setChordMode = function (mode) {
        if (mode !== 'inline' && mode !== 'above') return;
        if (mode === SB.state.chordMode) return;
        SB.state.chordMode = mode;
        try { window.localStorage.setItem(SB.NS + ':chordMode', SB.state.chordMode); } catch (e) { /* ignore */ }
        SB.applyChordMode();
        if (SB.state.currentSong) SB.renderSheet(SB.state.currentSong);
    }

    var pinch = { pts: {}, active: false, base: 0 };
    function pinchDistance(a, b) {
        var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    SB.sheetPointerDown = function (e) {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        pinch.pts[e.pointerId] = e;
        var ids = Object.keys(pinch.pts);
        if (ids.length === 2) {
            pinch.active = true;
            pinch.base = pinchDistance(pinch.pts[ids[0]], pinch.pts[ids[1]]) || 1;
        }
    }
    SB.sheetPointerMove = function (e) {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        if (!pinch.pts[e.pointerId]) return;
        pinch.pts[e.pointerId] = e;
        if (!pinch.active || Object.keys(pinch.pts).length !== 2) return;
        var ids = Object.keys(pinch.pts);
        var d = pinchDistance(pinch.pts[ids[0]], pinch.pts[ids[1]]);
        if (d < 8) return;
        var ratio = d / pinch.base;
        if (ratio >= 1.15) { SB.setTextSize(SB.state.textSize + 0.1); pinch.base = d; }
        else if (ratio <= 1 / 1.15) { SB.setTextSize(SB.state.textSize - 0.1); pinch.base = d; }
    }
    SB.sheetPointerEnd = function (e) {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        delete pinch.pts[e.pointerId];
        if (Object.keys(pinch.pts).length < 2) { pinch.active = false; pinch.base = 0; }
    }

    SB.loadSpeedForSong = function (sbId, id) {
        var v = 1;
        try {
            var s = parseFloat(window.localStorage.getItem(SB.speedKey(sbId, id)));
            if (s >= 0.2 && s <= 3) v = Math.round(s * 10) / 10;
        } catch (e) { /* ignore */ }
        return v;
    }
    SB.updateSpeedLabel = function () { SB.$('speedValue').textContent = SB.state.scrollSpeed.toFixed(1) + '×'; }

    SB.loadTextSizeForSong = function (sbId, id) {
        var v = 1;
        try {
            var s = parseFloat(window.localStorage.getItem(SB.sizeKey(sbId, id)));
            if (s >= 0.7 && s <= 1.5) v = Math.round(s * 10) / 10;
        } catch (e) { /* ignore */ }
        return v;
    }
    SB.applyTextSize = function () {
        SB.$('sheet').style.setProperty('--sheet-size', SB.state.textSize);
        SB.$('sizeValue').textContent = Math.round(SB.state.textSize * 100) + '%';
    }
    SB.setTextSize = function (v) {
        v = Math.min(1.5, Math.max(0.7, Math.round(v * 10) / 10));
        if (v === SB.state.textSize) { SB.applyTextSize(); return; }
        SB.state.textSize = v;
        SB.applyTextSize();
        if (SB.state.chordMode === 'above' && SB.state.currentSong) SB.renderSheet(SB.state.currentSong);
        if (SB.state.active && SB.state.currentSong) {
            try { window.localStorage.setItem(SB.sizeKey(SB.state.active.id, SB.state.currentSong.id), String(SB.state.textSize)); } catch (e) { /* ignore */ }
        }
    }
    SB.setSpeed = function (v) {
        v = Math.min(3, Math.max(0.2, Math.round(v * 10) / 10));
        if (v === SB.state.scrollSpeed) { SB.updateSpeedLabel(); return; }
        SB.state.scrollSpeed = v;
        SB.updateSpeedLabel();
        if (SB.state.active && SB.state.currentSong) {
            try { window.localStorage.setItem(SB.speedKey(SB.state.active.id, SB.state.currentSong.id), String(SB.state.scrollSpeed)); } catch (e) { /* ignore */ }
        }
    }
    var ABOVE_SCROLL_FACTOR = 1.75;
    function scrollDurationMs() {
        var d = ((SB.state.currentSong && SB.state.currentSong.dur ? SB.state.currentSong.dur : 4) * 60 * 1000) / SB.state.scrollSpeed;
        return SB.state.chordMode === 'above' ? d * ABOVE_SCROLL_FACTOR : d;
    }
    // Pixels per millisecond for the whole sheet at the current speed.
    // Always full-sheet-relative, so it is independent of current position.
    SB.targetVel = function () {
        var b = SB.scrollBounds();
        var d = scrollDurationMs();
        return (b > 0 && d > 0) ? b / d : 0;
    }
    SB.scrollBounds = function () {
        var doc = document.documentElement;
        return Math.max(0, doc.scrollHeight - window.innerHeight);
    }
    function sheetStartY() {
        var top = SB.$('sheet').getBoundingClientRect().top + window.pageYOffset - 70;
        return Math.min(Math.max(0, top), SB.scrollBounds());
    }
    function freshScrollAnchor() {
        SB.state.scrollState.pos = Math.min(Math.max(window.pageYOffset, 0), SB.scrollBounds());
        SB.state.scrollState.started = true;
        SB.state.scrollState.finished = false;
    }
    function startScroll() {
        if (!SB.state.currentSong || SB.scrollBounds() <= 0) return;
        if (!SB.state.scrollState.started || SB.state.scrollState.finished) freshScrollAnchor();
        else SB.state.scrollState.pos = Math.min(Math.max(window.pageYOffset, 0), SB.scrollBounds());
        SB.state.scrollState.playing = true;
        SB.state.scrollState.last = 0;
        SB.state.scrollState.lastY = window.pageYOffset;
        SB.state.scrollState.raf = requestAnimationFrame(stepScroll);
        updateScrollBtn();
    }
    function stepScroll(ts) {
        if (!SB.state.scrollState.playing) return;
        // If the user scrolled manually since the last frame, follow them —
        // resync pos to the real offset, no velocity recomputation needed.
        if (SB.state.scrollState.lastY !== null && Math.abs(window.pageYOffset - SB.state.scrollState.lastY) > 2) {
            SB.state.scrollState.pos = window.pageYOffset;
        }
        if (!SB.state.scrollState.last) SB.state.scrollState.last = ts;
        var dt = Math.min(ts - SB.state.scrollState.last, 100);
        SB.state.scrollState.last = ts;

        var max = SB.scrollBounds();
        SB.state.scrollState.pos += SB.targetVel() * dt;
        if (SB.state.scrollState.pos > max) SB.state.scrollState.pos = max;
        var y = SB.state.scrollState.pos;
        window.scrollTo(0, y);
        SB.state.scrollState.lastY = window.pageYOffset;

        if (y >= max) {
            SB.state.scrollState.playing = false;
            SB.state.scrollState.finished = true;
            SB.state.scrollState.raf = null;
            SB.state.scrollState.last = 0;
            updateScrollBtn();
            return;
        }
        SB.state.scrollState.raf = requestAnimationFrame(stepScroll);
    }
    function pauseScroll() {
        SB.state.scrollState.playing = false;
        if (SB.state.scrollState.raf) cancelAnimationFrame(SB.state.scrollState.raf);
        SB.state.scrollState.raf = null;
        SB.state.scrollState.last = 0;
        SB.state.scrollState.lastY = null;
        updateScrollBtn();
    }
    SB.resetScroll = function (keepPosition) {
        SB.state.scrollState.playing = false;
        if (SB.state.scrollState.raf) cancelAnimationFrame(SB.state.scrollState.raf);
        SB.state.scrollState.raf = null;
        SB.state.scrollState.last = 0;
        SB.state.scrollState.lastY = null;
        SB.state.scrollState.started = false;
        SB.state.scrollState.finished = false;
        if (!keepPosition) window.scrollTo(0, sheetStartY());
        SB.state.scrollState.pos = Math.min(Math.max(window.pageYOffset, 0), SB.scrollBounds());
        updateScrollBtn();
    }
    SB.toggleAutoScroll = function () {
        if (SB.state.scrollState.playing) pauseScroll();
        else startScroll();
    }
    function updateScrollBtn() {
        var btn = SB.$('scrollBtn');
        if (SB.state.scrollState.playing) {
            btn.textContent = '⏸';
            btn.setAttribute('aria-label', 'Pause auto-scroll');
        } else if (SB.state.scrollState.started && !SB.state.scrollState.finished) {
            btn.textContent = '▶';
            btn.setAttribute('aria-label', 'Resume auto-scroll');
        } else {
            btn.textContent = '▶';
            btn.setAttribute('aria-label', 'Start auto-scroll');
        }
        btn.title = btn.getAttribute('aria-label') + ' (Space)';
        btn.classList.toggle('playing', SB.state.scrollState.playing);
    }

})(window.SB = window.SB || {});
