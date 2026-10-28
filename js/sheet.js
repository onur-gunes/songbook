/* Songbook — sheet
 * both sheet renderers (inline chords and chords-above-lyrics)
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- sheet rendering ---------------- */


    // Legacy `y` notes were authored as HTML. Imported songbooks are
    // untrusted, so rebuild them from an allowlist instead of assigning
    // innerHTML: only text, <br>, and <span class="chord"> survive.
    function appendNoteContent(dst, src) {
        for (var child = src.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 3) {
                dst.appendChild(document.createTextNode(child.nodeValue));
            } else if (child.nodeType === 1) {
                if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' ||
                    child.tagName === 'TEMPLATE') continue;
                if (child.tagName === 'BR') {
                    dst.appendChild(document.createElement('br'));
                } else if (child.tagName === 'SPAN' &&
                           (' ' + (child.getAttribute('class') || '') + ' ').indexOf(' chord ') !== -1) {
                    var span = SB.el('span', 'chord');
                    appendNoteContent(span, child);
                    dst.appendChild(span);
                } else {
                    appendNoteContent(dst, child);
                }
            }
        }
    }

    SB.noteNode = function (val) {
        var note = SB.el('span', 'seg-note');
        var parsed = new DOMParser().parseFromString(String(val == null ? '' : val), 'text/html');
        appendNoteContent(note, parsed.body);
        return note;
    }

    // Styled text kinds map 1:1 to a span class. `c` and `y` are not here:
    // chords need transposing and notes need sanitising, so both renderers
    // handle them explicitly below.
    var SEG_CLASS = { m: 'seg-muted', b: 'seg-bold', i: 'seg-italic' };

    // Shared kind-dispatch for whole-line rendering. The inline and
    // chords-above renderers differ only in how a chord is labelled —
    // inline keeps the [brackets], above strips them — so that is the one
    // thing they pass in.
    function appendLineSegments(lineDiv, line, chordLabelFn) {
        line.forEach(function (seg) {
            var kind = seg[0], val = seg[1];
            if (kind === 'c') {
                lineDiv.appendChild(SB.el('span', 'seg-chord', chordLabelFn(val)));
            } else if (SEG_CLASS[kind]) {
                lineDiv.appendChild(SB.el('span', SEG_CLASS[kind], val));
            } else if (kind === 'y') {
                lineDiv.appendChild(SB.noteNode(val));
            } else {
                lineDiv.appendChild(document.createTextNode(val));
            }
        });
    }

    function inlineChordLabel(val) {
        var cv = SB.transposeChordValue(val, SB.state.transpose);
        var m = cv.match(/^\[([\s\S]*)\]$/);
        return m ? '[' + mapChordTokens(m[1]) + ']' : cv;
    }

    SB.renderSheet = function (song) {
        if (SB.state.chordMode === 'above') { renderSheetAbove(song); return; }
        var wrap = SB.$('sheet');
        wrap.textContent = '';
        var frag = document.createDocumentFragment();
        (song.sheet || []).forEach(function (line) {
            var lineDiv = SB.el('div', 'line');
            var isPre = line.some(function (seg) { return seg[0] === 'p'; });
            if (isPre) lineDiv.classList.add('is-pre');
            appendLineSegments(lineDiv, line, inlineChordLabel);
            frag.appendChild(lineDiv);
        });
        wrap.appendChild(frag);
    }

    /* ---- classic chord-sheet rendering (chords above the lyrics) ---- */

    // "NC"/muted markers read as a percussive "chuck" in the lyric line.
    function mapChordTokens(inner) {
        return inner.split(/\s+/).map(function (t) {
            return ChordKit.isMutedName(t) ? 'chuck' : t;
        }).join(' ');
    }

    function chordLabel(val) {
        var cv = SB.transposeChordValue(val, SB.state.transpose);
        var m = cv.match(/^\[([\s\S]*)\]$/);
        return m ? mapChordTokens(m[1]) : cv;
    }

    function plainText(seg) {
        var val = seg[1];
        if (seg[0] === 'y') return val.replace(/<[^>]*>/g, '');
        return val;
    }

    // Greedy word wrap by rendered pixel width. The sheet uses a proportional
    // font and the lyric layer is white-space:pre, so a fixed character count
    // (or the browser's own reflow) would either wrap far too early or not at
    // all — we have to measure the text ourselves.
    function splitLyric(parts, text, width) {
        var out = [], i = 0, n = text.length;
        if (!n) return out;
        while (i < n) {
            if (lyricPrefixWidth(parts, i, n) <= width) { out.push([i, n]); break; }
            var lastSpace = -1, j;
            for (j = i + 1; j <= n; j++) {
                if (lyricPrefixWidth(parts, i, j) > width) break;
                if (text.charAt(j - 1) === ' ') lastSpace = j - 1;
            }
            var end = lastSpace > i ? lastSpace : Math.max(i + 1, j - 1);
            out.push([i, end]);
            i = end;
            while (i < n && text.charAt(i) === ' ') i++;
        }
        return out;
    }

    // Chords above the lyrics are placed at exact pixel columns so they line up
    // even with a proportional font: each chord's left edge = the rendered width
    // of the lyric text running up to its column.
    var lyricsCtx = null;
    function lyricsMeasureCtx() {
        if (!lyricsCtx) lyricsCtx = document.createElement('canvas').getContext('2d');
        return lyricsCtx;
    }

    function sheetFontFor(kind) {
        var cs = getComputedStyle(SB.$('sheet'));
        var fam = cs.fontFamily || 'Verdana, Tahoma, sans-serif';
        var size = parseFloat(cs.fontSize) || 14.4;
        var style = 'normal', weight = '400';
        if (kind === 'b') weight = '700';
        else if (kind === 'i') style = 'italic';
        else if (kind === 'y') { style = 'italic'; size *= 0.88; }
        return style + ' ' + weight + ' ' + size + 'px ' + fam;
    }

    function lyricPrefixWidth(parts, r0, upto) {
        var ctx = lyricsMeasureCtx();
        var x = 0;
        parts.forEach(function (p) {
            var s = Math.max(p.start, r0), e = Math.min(p.start + p.text.length, upto);
            if (s >= e) return;
            ctx.font = sheetFontFor(p.kind);
            x += ctx.measureText(p.text.slice(s - p.start, e - p.start)).width;
        });
        return x;
    }

    function sheetEmPx() {
        return parseFloat(getComputedStyle(SB.$('sheet')).fontSize) || 14.4;
    }

    // Width of a chord label as drawn (bold, same size as the sheet). Used to
    // keep consecutive chords from overlapping when the lyric column is narrow.
    function chordLabelWidth(label) {
        var ctx = lyricsMeasureCtx();
        ctx.font = sheetFontFor('b');
        return ctx.measureText(label).width;
    }

    function buildAboveLine(line, avail) {
        var hasWord = false, L = '', parts = [], chords = [], prevEnd = 0, hadChord = false;
        line.forEach(function (seg) {
            if (seg[0] === 'c') {
                var label = chordLabel(seg[1]);
                var col = hadChord ? Math.max(L.length, prevEnd + 1) : L.length;
                chords.push({ col: col, label: label });
                prevEnd = col + label.length;
                hadChord = true;
                return;
            }
            var t = plainText(seg);
            if (hadChord && /^\s/.test(t)) {
                t = t.replace(/^\s+/, '');
                if (L.length && !/\s$/.test(L)) t = ' ' + t;
            }
            if (t.replace(/\s/g, '').length) hadChord = false;
            parts.push({ kind: seg[0], text: t, start: L.length });
            L += t;
            if (/\S/.test(t)) hasWord = true;
        });

        var div = SB.el('div', 'line line-stacked');
        var ranges = splitLyric(parts, L, avail);
        if (!ranges.length) ranges = [[0, L.length]];
        ranges.forEach(function (r) {
            var unit = SB.el('div', 'ln-unit');
            unit.setAttribute('data-start', r[0]);
            var chor = SB.el('div', 'ln-chords');
            var minGap = sheetEmPx() * 0.5;
            var prevRight = null;
            chords.forEach(function (c) {
                if (c.col >= r[0] && c.col < r[1]) {
                    var left = lyricPrefixWidth(parts, r[0], c.col);
                    // Keep a chord at its lyric column, but never let it run
                    // into the one before it: proportional lyric gaps can be
                    // narrower than the chord name itself.
                    if (prevRight !== null && left < prevRight + minGap) left = prevRight + minGap;
                    var sp = SB.el('span', 'seg-chord', c.label);
                    sp.style.left = left + 'px';
                    sp.setAttribute('data-col', c.col);
                    chor.appendChild(sp);
                    prevRight = left + chordLabelWidth(c.label);
                }
            });
            unit.appendChild(chor);
            var ly = SB.el('div', 'ln-lyric');
            parts.forEach(function (p) {
                var cs = Math.max(p.start, r[0]), ce = Math.min(p.start + p.text.length, r[1]);
                if (cs >= ce) return;
                var txt = p.text.slice(cs - p.start, ce - p.start);
                if (!txt) return;
                // Not appendLineSegments: these are character slices of
                // text already flattened by plainText(), so a `y` note has
                // had its markup stripped and must stay a plain span —
                // re-parsing a fragment of it as HTML would be wrong.
                var cls = p.kind === 'y' ? 'seg-note' : SEG_CLASS[p.kind];
                ly.appendChild(cls ? SB.el('span', cls, txt) : document.createTextNode(txt));
            });
            unit.appendChild(ly);
            div.appendChild(unit);
        });
        return div;
    }

    function renderSheetAbove(song) {
        var wrap = SB.$('sheet');
        wrap.textContent = '';
        var frag = document.createDocumentFragment();
        var avail = Math.max(1, wrap.clientWidth - 0.5);
        (song.sheet || []).forEach(function (line) {
            var lineDiv = SB.el('div', 'line');
            var isPre = line.some(function (s) { return s[0] === 'p'; });
            if (isPre) lineDiv.classList.add('is-pre');
            else {
                var hasChord = line.some(function (s) { return s[0] === 'c'; });
                var hasWord = line.some(function (s) {
                    return s[0] !== 'c' && /\S/.test(plainText(s));
                });
                if (hasChord && hasWord) {
                    frag.appendChild(buildAboveLine(line, avail));
                    return;
                }
            }
            appendLineSegments(lineDiv, line, chordLabel);
            frag.appendChild(lineDiv);
        });
        wrap.appendChild(frag);
    }

    SB.updateTransposeLabel = function () {
        SB.$('trValue').textContent = (SB.state.transpose > 0 ? '+' : '') + SB.state.transpose;
    }

    // Fold a semitone offset into the -5..6 range (nearest direction).
    function wrapSigned(x) {
        var r = ((x % 12) + 12) % 12;
        return r > 6 ? r - 12 : r;
    }

    // Original-key badge plus the capo needed to sound like the recording.
    // base capo = recording key - written (sheet) key, so live capo follows
    // the transpose control: live = wrapSigned(capo - transpose).
    SB.updateKeyHints = function () {
        var sec = SB.$('origKey');
        if (!sec) return;
        var song = SB.state.currentSong;
        if (!song || !song.key) { sec.hidden = true; return; }
        sec.hidden = false;
        SB.$('origKeyValue').textContent = song.key;

        var part = SB.$('capoPart');
        var val = SB.$('capoValue');
        if (!part || !val) return;
        if (typeof song.capo !== 'number' || !isFinite(song.capo)) {
            part.hidden = true;
            val.textContent = '';
            return;
        }
        var rel = wrapSigned(song.capo - SB.state.transpose);
        part.hidden = false;
        if (rel > 0) val.textContent = 'Capo ' + rel;
        else if (rel === 0) val.textContent = 'No capo';
        else val.textContent = 'No capo · transpose ' + rel;
    }

})(window.SB = window.SB || {});
