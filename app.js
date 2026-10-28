/* Songbook — app */
(function () {
    'use strict';

    if (typeof ChordKit === 'undefined') {
        document.body.textContent = 'Failed to load chords.js';
        return;
    }

    /* ---------------- helpers ---------------- */

    var $ = function (id) { return document.getElementById(id); };
    var SEP = '\u0000';
    var NS = 'songbook';        // storage namespace prefix

    function lsGet(key, fallback) {
        try {
            var v = window.localStorage.getItem(key);
            return v === null ? fallback : JSON.parse(v);
        } catch (e) { return fallback; }
    }
    function lsSet(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function compositeId(sbId, songId) { return sbId + SEP + songId; }

    var FAV_KEY = NS + ':favorites';
    var RECENT_KEY = NS + ':recent';
    var RECENT_MAX = 15;

    /* ---------------- shared state ----------------
     * Every value read or written by more than one section lives here, so
     * the sections can be split into separate files later without relying
     * on a shared closure. Anything used by a single section stays a local
     * var in that section.
     *
     * Declared after the helpers above because several initialisers call
     * lsGet() / use NS.
     */
    var SB = window.SB = window.SB || {};
    SB.state = {
        /* songbook store */
        bundled: [],
        imported: [],
        bySb: {},
        active: null,           // current songbook
        byId: {},               // active songs by id
        currentSong: null,

        /* personal data */
        favorites: new Set(lsGet(FAV_KEY, [])),   // composite "sbId\0songId"
        recent: lsGet(RECENT_KEY, []),            // [{sb,id}]

        /* instrument + transpose */
        instrument: lsGet(NS + ':instrument', null),
        transpose: 0,

        /* list view */
        state: {
            q: '',
            levels: new Set(),
            isNew: false,
            favOnly: false,
            sort: 'title',
            compact: false
        },

        /* song view + auto-scroll */
        scrollState: { raf: null, last: 0, pos: 0, playing: false, started: false, finished: false, lastY: null },
        scrollSpeed: 1,
        textSize: 1,
        chordSize: 1,
        chordPin: true,
        chordMode: 'inline',
        showNumbers: false
    };

    /* ---------------- theme ---------------- */

    var THEME_KEY = NS + ':theme';

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        var btn = $('themeToggle');
        btn.textContent = theme === 'dark' ? '☾' : '☀';
        btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
        applyBrand();
        lsSet(THEME_KEY, theme);
    }

    /* Brand logo comes from the active songbook; hide it when the songbook has none. */
    function applyBrand() {
        var logo = $('logo');
        if (!logo) return;
        var light = (SB.state.active && SB.state.active.logo) || '';
        var dark = (SB.state.active && (SB.state.active.logoDark || SB.state.active.logo)) || '';
        var dark_on = document.documentElement.getAttribute('data-theme') === 'dark';
        var src = dark_on ? dark : light;
        if (src) {
            logo.src = src;
            logo.hidden = false;
        } else {
            logo.hidden = true;
            logo.removeAttribute('src');
        }
    }
    function initTheme() {
        var saved = lsGet(THEME_KEY, null);
        if (saved !== 'dark' && saved !== 'light') {
            saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        applyTheme(saved);
    }

    /* ---------------- IndexedDB (imported songbooks) ---------------- */

    function idbOpen() {
        return new Promise(function (res, rej) {
            if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
            var req = window.indexedDB.open(NS, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains('songbooks')) db.createObjectStore('songbooks', { keyPath: 'id' });
            };
            req.onsuccess = function () { res(req.result); };
            req.onerror = function () { rej(req.error); };
        });
    }
    function idbAll() {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var t = db.transaction('songbooks', 'readonly').objectStore('songbooks').getAll();
                t.onsuccess = function () { res(t.result || []); };
                t.onerror = function () { rej(t.error); };
            });
        });
    }
    function idbPut(obj) {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var t = db.transaction('songbooks', 'readwrite').objectStore('songbooks').put(obj);
                t.onsuccess = function () { res(); };
                t.onerror = function () { rej(t.error); };
            });
        });
    }
    function idbDelete(id) {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var t = db.transaction('songbooks', 'readwrite').objectStore('songbooks').delete(id);
                t.onsuccess = function () { res(); };
                t.onerror = function () { rej(t.error); };
            });
        });
    }

    /* ---------------- songbook store ---------------- */


    function activeSongs() { return SB.state.active ? SB.state.active.songs : []; }
    function allSongbooks() { return SB.state.bundled.concat(SB.state.imported); }

    function normalizeSong(s, index) {
        if (!s || typeof s !== 'object') throw new Error('bad song entry');
        return {
            id: String(s.id || ('song-' + (index + 1))),
            n: typeof s.n === 'number' ? s.n : (index + 1),
            title: String(s.title || 'Untitled'),
            artist: String(s.artist || ''),
            level: (s.level === 'Easy' || s.level === 'Medium' || s.level === 'Hard') ? s.level : 'Medium',
            new: !!s.new,
            key: s.key ? String(s.key) : '',
            sheetKey: s.sheetKey ? String(s.sheetKey) : '',
            capo: (typeof s.capo === 'number' && isFinite(s.capo)) ? s.capo : null,
            dur: typeof s.dur === 'number' ? s.dur : 4,
            chords: Array.isArray(s.chords) ? s.chords.map(String) : [],
            sheet: Array.isArray(s.sheet) ? s.sheet : (s.sheet ? s.sheet : [])
        };
    }

    function normalizeSongbook(raw) {
        if (Array.isArray(raw)) raw = { songs: raw };
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.songs)) {
            throw new Error('not a songbook (missing "songs" array)');
        }
        var id = String(raw.id || '').trim();
        var name = String(raw.name || raw.title || '').trim();
        if (!id || !name) throw new Error('songbook needs an "id" and a "name"');
        if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error('songbook "id" must be letters, numbers and dashes');
        return {
            id: id,
            name: name,
            description: String(raw.description || ''),
            instrument: (raw.instrument === 'guitar' || raw.instrument === 'ukulele') ? raw.instrument : 'ukulele',
            logo: String(raw.logo || ''),
            logoDark: String(raw.logoDark || ''),
            songs: raw.songs.map(normalizeSong)
        };
    }

    function loadBundled() {
        if (window.__SONGBOOKS__ && window.__SONGBOOKS__.length) {
            return Promise.resolve(window.__SONGBOOKS__.map(normalizeSongbook));
        }
        return fetch('songbooks/index.json', { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('songbooks/index.json ' + r.status);
            return r.json();
        }).then(function (manifest) {
            var entries = (manifest && manifest.songbooks) || [];
            return Promise.all(entries.map(function (e) {
                return fetch('songbooks/' + e.file, { cache: 'no-cache' }).then(function (r) {
                    if (!r.ok) throw new Error(e.file + ' ' + r.status);
                    return r.json();
                });
            }));
        }).then(function (list) {
            return list.map(function (raw, i) {
                try { return normalizeSongbook(raw); }
                catch (err) { throw new Error('bundled songbook ' + i + ': ' + err.message); }
            });
        });
    }

    function rebuildIndex() {
        SB.state.bySb = {};
        allSongbooks().forEach(function (sb) { SB.state.bySb[sb.id] = sb; });
        buildSongbookSelect();
    }

    function setActive(sb) {
        SB.state.active = sb;
        SB.state.byId = {};
        if (sb) sb.songs.forEach(function (s) { SB.state.byId[s.id] = s; });
        var sel = $('songbookSelect');
        if (sel && sb) sel.value = sb.id;
        var rm = $('removeSongsBtn');
        if (rm) rm.hidden = !(sb && sb.imported);
        applyBrand();
    }

    function buildSongbookSelect() {
        var sel = $('songbookSelect');
        if (!sel) return;
        sel.textContent = '';
        allSongbooks().forEach(function (sb) {
            var opt = el('option', null, sb.name + (sb.imported ? ' (imported)' : ''));
            opt.value = sb.id;
            sel.appendChild(opt);
        });
    }

    function defaultSongbook() {
        return SB.state.bundled[0] || allSongbooks()[0] || null;
    }

    /* ---------------- personal data ---------------- */

    function saveFavorites() { lsSet(FAV_KEY, Array.from(SB.state.favorites)); }
    function isFav(sbId, songId) { return SB.state.favorites.has(compositeId(sbId, songId)); }

    function addRecent(sbId, songId) {
        SB.state.recent = [{ sb: sbId, id: songId }].concat(SB.state.recent.filter(function (r) {
            return !(r.sb === sbId && r.id === songId);
        })).slice(0, RECENT_MAX);
        lsSet(RECENT_KEY, SB.state.recent);
    }

    function noteKey(sbId, songId) { return NS + ':note:' + sbId + SEP + songId; }
    function speedKey(sbId, songId) { return NS + ':speed:' + sbId + SEP + songId; }
    function sizeKey(sbId, songId) { return NS + ':size:' + sbId + SEP + songId; }

    /* ---------------- instrument ---------------- */

    if (SB.state.instrument !== 'ukulele' && SB.state.instrument !== 'guitar') SB.state.instrument = null;

    function applyInstrumentUi() {
        Array.prototype.forEach.call(document.querySelectorAll('.instrument-btn'), function (b) {
            var on = b.dataset.instrument === SB.state.instrument;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }
    function setInstrument(inst) {
        if (inst !== 'ukulele' && inst !== 'guitar') return;
        SB.state.instrument = inst;
        lsSet(NS + ':instrument', SB.state.instrument);
        applyInstrumentUi();
        closeVoicingChooser();
        if (SB.state.currentSong) renderChordStrip(SB.state.currentSong);
    }

    /* ---------------- transpose ---------------- */

    var SEMIS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
    var NOTE_RE = /^([A-G])(sharp|flat|b|#)?/;

    function transposeNote(part, semis) {
        if (!part) return null;
        var m = part.match(NOTE_RE);
        if (!m) return null;
        var semi = SEMIS[m[1]];
        if (m[2] === '#' || m[2] === 'sharp') semi += 1;
        else if (m[2] === 'b' || m[2] === 'flat') semi -= 1;
        var idx = ((semi + semis) % 12 + 12) % 12;
        return NOTE_NAMES[idx] + part.slice(m[0].length);
    }
    function transposeToken(tok, semis) {
        if (!semis) return tok;
        var out = '', rest = tok;
        var lead = rest.match(/^\/+/);
        if (lead) { out += lead[0]; rest = rest.slice(lead[0].length); }
        var trail = '';
        var tr = rest.match(/\/+$/);
        if (tr) { trail = tr[0]; rest = rest.slice(0, rest.length - tr[0].length); }
        if (rest === '') return tok;
        var parts = rest.split('/');
        var moved = parts.map(function (p) { return transposeNote(p, semis); });
        if (moved.some(function (t) { return t === null; })) return tok;
        return out + moved.join('/') + trail;
    }
    function transposeChordValue(val, semis) {
        if (!semis) return val;
        var m = val.match(/^\[([\s\S]*)\]$/);
        if (!m) return val;
        var inner = m[1];
        var out = inner.split(/\s+/).map(function (t) { return transposeToken(t, semis); }).join(' ');
        return '[' + out + ']';
    }

    // Chart key -> display name, transposed. FC is the legacy encoding of F/C.
    function transposeChartName(name, semis) {
        var n = name === 'FC' ? 'F/C' : name;
        if (!semis) return n;
        return n.split('/').map(function (tok) { return transposeNote(tok, semis) || tok; }).join('/');
    }
    function displayChord(name) {
        return name.replace(/sharp/g, '#').replace(/flat/g, 'b');
    }

    var stripSortPrefix = function (t) {
        return t.replace(/^[🔥🎂\s]+/, '').replace(/^#?\d+\s*[-–—]\s+/, '').replace(/^The\s+/i, '');
    };

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
                    var span = el('span', 'chord');
                    appendNoteContent(span, child);
                    dst.appendChild(span);
                } else {
                    appendNoteContent(dst, child);
                }
            }
        }
    }

    function noteNode(val) {
        var note = el('span', 'seg-note');
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
                lineDiv.appendChild(el('span', 'seg-chord', chordLabelFn(val)));
            } else if (SEG_CLASS[kind]) {
                lineDiv.appendChild(el('span', SEG_CLASS[kind], val));
            } else if (kind === 'y') {
                lineDiv.appendChild(noteNode(val));
            } else {
                lineDiv.appendChild(document.createTextNode(val));
            }
        });
    }

    function inlineChordLabel(val) {
        var cv = transposeChordValue(val, SB.state.transpose);
        var m = cv.match(/^\[([\s\S]*)\]$/);
        return m ? '[' + mapChordTokens(m[1]) + ']' : cv;
    }

    function renderSheet(song) {
        if (SB.state.chordMode === 'above') { renderSheetAbove(song); return; }
        var wrap = $('sheet');
        wrap.textContent = '';
        var frag = document.createDocumentFragment();
        (song.sheet || []).forEach(function (line) {
            var lineDiv = el('div', 'line');
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
        var cv = transposeChordValue(val, SB.state.transpose);
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
        var cs = getComputedStyle($('sheet'));
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
        return parseFloat(getComputedStyle($('sheet')).fontSize) || 14.4;
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

        var div = el('div', 'line line-stacked');
        var ranges = splitLyric(parts, L, avail);
        if (!ranges.length) ranges = [[0, L.length]];
        ranges.forEach(function (r) {
            var unit = el('div', 'ln-unit');
            unit.setAttribute('data-start', r[0]);
            var chor = el('div', 'ln-chords');
            var minGap = sheetEmPx() * 0.5;
            var prevRight = null;
            chords.forEach(function (c) {
                if (c.col >= r[0] && c.col < r[1]) {
                    var left = lyricPrefixWidth(parts, r[0], c.col);
                    // Keep a chord at its lyric column, but never let it run
                    // into the one before it: proportional lyric gaps can be
                    // narrower than the chord name itself.
                    if (prevRight !== null && left < prevRight + minGap) left = prevRight + minGap;
                    var sp = el('span', 'seg-chord', c.label);
                    sp.style.left = left + 'px';
                    sp.setAttribute('data-col', c.col);
                    chor.appendChild(sp);
                    prevRight = left + chordLabelWidth(c.label);
                }
            });
            unit.appendChild(chor);
            var ly = el('div', 'ln-lyric');
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
                ly.appendChild(cls ? el('span', cls, txt) : document.createTextNode(txt));
            });
            unit.appendChild(ly);
            div.appendChild(unit);
        });
        return div;
    }

    function renderSheetAbove(song) {
        var wrap = $('sheet');
        wrap.textContent = '';
        var frag = document.createDocumentFragment();
        var avail = Math.max(1, wrap.clientWidth - 0.5);
        (song.sheet || []).forEach(function (line) {
            var lineDiv = el('div', 'line');
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

    function updateTransposeLabel() {
        $('trValue').textContent = (SB.state.transpose > 0 ? '+' : '') + SB.state.transpose;
    }

    // Fold a semitone offset into the -5..6 range (nearest direction).
    function wrapSigned(x) {
        var r = ((x % 12) + 12) % 12;
        return r > 6 ? r - 12 : r;
    }

    // Original-key badge plus the capo needed to sound like the recording.
    // base capo = recording key - written (sheet) key, so live capo follows
    // the transpose control: live = wrapSigned(capo - transpose).
    function updateKeyHints() {
        var sec = $('origKey');
        if (!sec) return;
        var song = SB.state.currentSong;
        if (!song || !song.key) { sec.hidden = true; return; }
        sec.hidden = false;
        $('origKeyValue').textContent = song.key;

        var part = $('capoPart');
        var val = $('capoValue');
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

    /* ---------------- chord strip (ChordKit) ---------------- */

    // Tonic the sheet chords are written in: the curated sheetKey when present,
    // otherwise recording key minus capo.
    function songTonic(song) {
        if (!song) return null;
        if (song.sheetKey) {
            var sk = ChordKit.parse(song.sheetKey);
            if (sk) return { pc: sk.rootPc, minor: sk.type.id === 'm', name: song.sheetKey };
        }
        if (!song.key) return null;
        var k = ChordKit.parse(song.key);
        if (!k) return null;
        var capo = (typeof song.capo === 'number' && isFinite(song.capo)) ? song.capo : 0;
        return { pc: ((k.rootPc - capo) % 12 + 12) % 12, minor: k.type.id === 'm', name: '' };
    }

    // The number is computed from the untransposed chord and tonic so it stays
    // put as the user transposes.
    function addChordDegree(item, name, song) {
        if (!SB.state.showNumbers) return;
        var tonic = songTonic(song);
        if (!tonic) return;
        var deg = ChordKit.scaleDegree(name, tonic.pc, tonic.minor, tonic.name);
        if (deg) item.appendChild(el('span', 'cdeg', deg));
    }

    function pickKey(chordName) { return NS + ':pick:' + SB.state.instrument + ':' + chordName; }

    function storedPick(chordName) {
        try {
            var s = window.localStorage.getItem(pickKey(chordName));
            if (!s) return null;
            var f = s.split(',').map(Number);
            var n = ChordKit.instrumentOf(SB.state.instrument).tuning.length;
            if (f.length === n && f.every(function (v) { return v >= -1 && v <= 12; })) return f;
        } catch (e) { /* ignore */ }
        return null;
    }
    function savePick(chordName, frets) {
        try { window.localStorage.setItem(pickKey(chordName), frets.join(',')); } catch (e) { /* ignore */ }
    }

    function voicingsFor(chordName) { return ChordKit.voicings(chordName, SB.state.instrument); }

    function chosenVoicing(chordName) {
        var list = voicingsFor(chordName);
        if (!list.length) return null;
        var pick = storedPick(chordName);
        if (pick) {
            var key = pick.join(',');
            for (var i = 0; i < list.length; i++) if (list[i].join(',') === key) return list[i];
        }
        return list[0];
    }

    function renderChordStrip(song) {
        var strip = $('chordStrip');
        strip.textContent = '';
        (song.chords || []).forEach(function (name) {
            var tname = transposeChartName(name, SB.state.transpose);
            var label = displayChord(tname);
            if (ChordKit.isMutedName(tname)) {
                var citem = el('div', 'chord-item chuck');
                var cimg = new Image();
                cimg.alt = 'Chuck – all strings muted';
                cimg.title = 'Chuck – mute all strings and strum';
                cimg.src = ChordKit.dataUri(SB.state.instrument, ChordKit.mutedVoicing(SB.state.instrument));
                citem.appendChild(el('span', 'cname', 'Chuck'));
                citem.appendChild(cimg);
                strip.appendChild(citem);
                return;
            }
            var hard = ChordKit.chordDifficulty(tname) === 'hard';
            var item = el('div', 'chord-item' + (hard ? ' hard' : ''));
            var list = voicingsFor(tname);
            if (list.length) {
                var v = chosenVoicing(tname);
                var img = new Image();
                img.alt = label + ' chord diagram';
                img.title = label + (hard ? ' (hard chord – easy alternative in the picker)' : ' – click to choose voicing');
                img.src = ChordKit.dataUri(SB.state.instrument, v);
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.setAttribute('aria-label', label + ' chord diagram – choose voicing');
                var openSel = function (e) { e.preventDefault(); showVoicingChooser(strip, item, tname, label, img); };
                item.addEventListener('click', openSel);
                item.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSel(e); }
                });
                item.appendChild(el('span', 'cname', label));
                addChordDegree(item, name, song);
                item.appendChild(img);
            } else {
                item.classList.add('no-diagram');
                item.appendChild(el('span', 'cname', label));
                addChordDegree(item, name, song);
                item.appendChild(el('span', 'missing', 'no diagram'));
            }
            strip.appendChild(item);
        });
    }

    var voicingEsc = null;

    function closeVoicingChooser() {
        var ov = document.getElementById('voicingChooser');
        if (ov) ov.remove();
        if (voicingEsc) { document.removeEventListener('keydown', voicingEsc); voicingEsc = null; }
    }

    function showVoicingChooser(strip, item, chordName, label, img) {
        closeVoicingChooser();
        var shapes = voicingsFor(chordName);
        if (!shapes.length) return;
        var cur = chosenVoicing(chordName);
        var curKey = cur ? cur.join(',') : '';
        var ov = el('div', 'chooser-overlay');
        ov.id = 'voicingChooser';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-label', 'Choose voicing for ' + label);
        var box = el('div', 'chooser');
        var head = el('div', 'chooser-head');
        head.appendChild(el('span', 'chooser-title', label + ' – choose a voicing (' + ChordKit.instrumentOf(SB.state.instrument).label + ')'));
        var closeBtn = el('button', 'chooser-close');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', closeVoicingChooser);
        head.appendChild(closeBtn);
        box.appendChild(head);
        var grid = el('div', 'chooser-grid');
        var hard = ChordKit.chordDifficulty(chordName) === 'hard';
        shapes.slice(0, 60).forEach(function (f, i) {
            var opt = el('button');
            opt.type = 'button';
            var easy = hard && i === 1;
            var fretsTxt = f.map(function (v) { return v < 0 ? 'x' : (v === 0 ? 'o' : v); }).join(' ');
            opt.title = 'Fretting ' + fretsTxt + (easy ? ' – easy alternative' : '');
            if (easy) opt.classList.add('easy');
            if (f.join(',') === curKey) opt.classList.add('sel');
            var oi = new Image();
            oi.alt = '';
            oi.src = ChordKit.dataUri(SB.state.instrument, f);
            opt.appendChild(oi);
            opt.appendChild(el('span', 'choosing-frets', fretsTxt));
            opt.addEventListener('click', function () {
                savePick(chordName, f);
                img.src = ChordKit.dataUri(SB.state.instrument, f);
                closeVoicingChooser();
            });
            grid.appendChild(opt);
        });
        box.appendChild(grid);
        ov.appendChild(box);
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeVoicingChooser(); });
        voicingEsc = function (e) { if (e.key === 'Escape') closeVoicingChooser(); };
        document.addEventListener('keydown', voicingEsc);
        document.body.appendChild(ov);
    }

    /* ---------------- recent ---------------- */

    function renderRecent() {
        var block = $('recentBlock');
        var list = $('recentList');
        list.textContent = '';
        var items = SB.state.recent.filter(function (r) { return SB.state.bySb[r.sb] && SB.state.bySb[r.sb].songs.some(function (s) { return s.id === r.id; }); });
        if (!items.length) { block.hidden = true; return; }
        block.hidden = false;
        items.forEach(function (r) {
            var sb = SB.state.bySb[r.sb];
            var s = sb.songs.filter(function (x) { return x.id === r.id; })[0];
            var li = document.createElement('li');
            var b = el('button', null, s.title);
            b.type = 'button';
            b.addEventListener('click', function () { location.hash = '#/' + sb.id + '/' + s.id; });
            li.appendChild(b);
            list.appendChild(li);
        });
    }

    /* ---------------- list view ---------------- */

    try { SB.state.state.compact = window.localStorage.getItem(NS + ':compact') === '1'; } catch (e) { /* ignore */ }

    function applyViewToggle() {
        var b = $('viewToggle');
        b.setAttribute('aria-pressed', SB.state.state.compact ? 'true' : 'false');
        b.textContent = SB.state.state.compact ? '▤' : '☰';
        b.setAttribute('aria-label', SB.state.state.compact
            ? 'Switch back to card view'
            : 'Switch to compact one-line song list');
        b.title = SB.state.state.compact ? 'Back to cards' : 'Compact list';
        $('songList').classList.toggle('is-compact', SB.state.state.compact);
    }

    // Diacritic-insensitive fold: typing "pszczolka" finds "Pszczółka".
    function fold(s) {
        return String(s).toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\u0142/g, 'l');
    }

    function filteredSongs() {
        var q = fold(SB.state.state.q.trim());
        var sbId = SB.state.active ? SB.state.active.id : '';
        var out = activeSongs().filter(function (s) {
            if (SB.state.state.levels.size && !SB.state.state.levels.has(s.level)) return false;
            if (SB.state.state.isNew && !s.new) return false;
            if (SB.state.state.favOnly && !isFav(sbId, s.id)) return false;
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
            out.sort(function (a, b) { return stripSortPrefix(a.title).localeCompare(stripSortPrefix(b.title), 'en', { sensitivity: 'base' }); });
        }
        return out;
    }

    function renderList() {
        var songs = filteredSongs();
        var total = activeSongs().length;
        var ul = $('songList');
        ul.textContent = '';
        var frag = document.createDocumentFragment();
        var sbId = SB.state.active ? SB.state.active.id : '';
        songs.forEach(function (s) {
            var li = el('li', 'song-row');
            li.dataset.id = s.id;

            var a = document.createElement('a');
            a.className = 'song-link';
            a.href = '#/' + sbId + '/' + s.id;
            a.appendChild(el('span', 'row-num', String(s.n)));
            var main = el('span', 'row-main');
            main.appendChild(el('span', 'row-title', s.title));
            main.appendChild(el('span', 'row-artist', s.artist));
            a.appendChild(main);
            a.appendChild(el('span', 'row-level level-' + s.level, s.level));
            li.appendChild(a);

            var on = isFav(sbId, s.id);
            var star = el('button', 'star-btn' + (on ? ' on' : ''), on ? '★' : '☆');
            star.type = 'button';
            star.setAttribute('aria-label', 'Toggle favorite for ' + s.title);
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            star.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                toggleFavorite(sbId, s.id);
            });
            li.appendChild(star);

            frag.appendChild(li);
        });
        ul.appendChild(frag);

        $('emptyState').hidden = songs.length > 0;
        $('resultCount').textContent = songs.length === total
            ? total + ' songs'
            : songs.length + ' of ' + total + ' songs';
        $('searchClear').hidden = !SB.state.state.q;
        applyViewToggle();
    }

    function toggleFavorite(sbId, songId) {
        var cid = compositeId(sbId, songId);
        if (SB.state.favorites.has(cid)) SB.state.favorites.delete(cid);
        else SB.state.favorites.add(cid);
        saveFavorites();
        if (!$('listView').hidden && SB.state.active && SB.state.active.id === sbId) {
            if (SB.state.state.favOnly) renderList();
            else updateStarInPlace(songId);
        }
        if (SB.state.currentSong && SB.state.active && SB.state.active.id === sbId && SB.state.currentSong.id === songId) updateFavBtn();
    }

    function updateStarInPlace(id) {
        var rows = document.querySelectorAll('#songList .song-row');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].dataset.id !== id) continue;
            var star = rows[i].querySelector('.star-btn');
            if (!star) break;
            var on = isFav(SB.state.active.id, id);
            star.classList.toggle('on', on);
            star.textContent = on ? '★' : '☆';
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            break;
        }
    }

    function updateFavBtn() {
        if (!SB.state.currentSong || !SB.state.active) return;
        var on = isFav(SB.state.active.id, SB.state.currentSong.id);
        var btn = $('favBtn');
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

    function bindListControls() {
        var input = $('search');
        input.addEventListener('input', function () {
            SB.state.state.q = input.value;
            renderList();
        });
        $('searchClear').addEventListener('click', function () {
            input.value = '';
            SB.state.state.q = '';
            renderList();
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
                renderList();
            });
        });

        document.querySelectorAll('.sort-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                SB.state.state.sort = b.dataset.sort;
                syncSortButtons();
                renderList();
            });
        });
        syncSortButtons();

        $('randomBtn').addEventListener('click', function () {
            var songs = filteredSongs();
            if (!songs.length || !SB.state.active) return;
            var pick = songs[Math.floor(Math.random() * songs.length)];
            location.hash = '#/' + SB.state.active.id + '/' + pick.id;
        });

        $('recentClear').addEventListener('click', function () {
            SB.state.recent = [];
            lsSet(RECENT_KEY, SB.state.recent);
            renderRecent();
        });

        $('viewToggle').addEventListener('click', function () {
            SB.state.state.compact = !SB.state.state.compact;
            try { window.localStorage.setItem(NS + ':compact', SB.state.state.compact ? '1' : '0'); } catch (e) { /* ignore */ }
            renderList();
        });

        $('songbookSelect').addEventListener('change', function () {
            location.hash = '#/' + this.value;
        });
        $('importBtn').addEventListener('click', function () { $('importFile').click(); });
        $('importFile').addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (file) importSongbook(file);
            e.target.value = '';
        });
        $('removeSongsBtn').addEventListener('click', function () {
            if (!SB.state.active || !SB.state.active.imported) return;
            if (!window.confirm('Remove imported songbook "' + SB.state.active.name + '"? Your notes and favorites for it are kept.')) return;
            var id = SB.state.active.id;
            idbDelete(id).then(function () {
                SB.state.imported = SB.state.imported.filter(function (sb) { return sb.id !== id; });
                rebuildIndex();
                location.hash = '#/' + (defaultSongbook() ? defaultSongbook().id : '');
            }).catch(function (err) { window.alert('Could not remove: ' + err.message); });
        });
    }

    /* ---------------- import ---------------- */

    function importSongbook(file) {
        var reader = new FileReader();
        reader.onload = function () {
            var sb;
            try {
                sb = normalizeSongbook(JSON.parse(reader.result));
            } catch (err) {
                window.alert('Import failed: ' + err.message);
                return;
            }
            if (SB.state.bySb[sb.id]) {
                window.alert('A songbook with id "' + sb.id + '" already exists. Rename it (the "id" field) and try again.');
                return;
            }
            sb.imported = true;
            idbPut(sb).then(function () {
                SB.state.imported.push(sb);
                rebuildIndex();
                location.hash = '#/' + sb.id;
            }).catch(function (err) { window.alert('Could not save import: ' + err.message); });
        };
        reader.onerror = function () { window.alert('Could not read file.'); };
        reader.readAsText(file);
    }

    /* ---------------- song view ---------------- */

    function navContext() {
        var list = filteredSongs();
        var idx = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === SB.state.currentSong.id) { idx = i; break; }
        if (idx === -1) {
            list = activeSongs().slice().sort(function (a, b) { return a.n - b.n; });
            for (var j = 0; j < list.length; j++) if (list[j].id === SB.state.currentSong.id) { idx = j; break; }
        }
        return { list: list, idx: idx };
    }

    function updateNavButtons() {
        var ctx = navContext();
        $('prevBtn').disabled = ctx.idx <= 0;
        $('nextBtn').disabled = ctx.idx === -1 || ctx.idx >= ctx.list.length - 1;
    }

    function openSong(id) {
        closeVoicingChooser();
        var song = SB.state.byId[id];
        if (!song) { location.hash = '#/' + (SB.state.active ? SB.state.active.id : ''); return; }
        SB.state.currentSong = song;
        addRecent(SB.state.active.id, id);
        resetScroll(true);
        SB.state.scrollSpeed = loadSpeedForSong(SB.state.active.id, id);
        updateSpeedLabel();
        SB.state.textSize = loadTextSizeForSong(SB.state.active.id, id);
        applyTextSize();

        SB.state.transpose = 0;
        updateTransposeLabel();

        $('songNumber').textContent = '#' + song.n;
        $('songTitle').textContent = song.title;
        $('songArtist').textContent = song.artist;
        var badge = $('songLevel');
        badge.textContent = song.level;
        badge.className = 'level-badge level-' + song.level;
        updateKeyHints();
        updateFavBtn();

        renderChordStrip(song);
        renderSheet(song);

        var note = '';
        try { note = window.localStorage.getItem(noteKey(SB.state.active.id, id)) || ''; } catch (e) { /* ignore */ }
        $('notesBox').value = note;
        $('notesStatus').classList.remove('show');

        updateNavButtons();
        $('sheet').focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }

    function bindSongControls() {
        $('trUp').addEventListener('click', function () {
            if (SB.state.transpose >= 11) return;
            SB.state.transpose++;
            updateTransposeLabel();
            updateKeyHints();
            if (SB.state.currentSong) { renderChordStrip(SB.state.currentSong); renderSheet(SB.state.currentSong); }
        });
        $('trDown').addEventListener('click', function () {
            if (SB.state.transpose <= -11) return;
            SB.state.transpose--;
            updateTransposeLabel();
            updateKeyHints();
            if (SB.state.currentSong) { renderChordStrip(SB.state.currentSong); renderSheet(SB.state.currentSong); }
        });

        $('favBtn').addEventListener('click', function () {
            if (SB.state.currentSong && SB.state.active) toggleFavorite(SB.state.active.id, SB.state.currentSong.id);
        });

        $('prevBtn').addEventListener('click', function () {
            var ctx = navContext();
            if (ctx.idx > 0) location.hash = '#/' + SB.state.active.id + '/' + ctx.list[ctx.idx - 1].id;
        });
        $('nextBtn').addEventListener('click', function () {
            var ctx = navContext();
            if (ctx.idx !== -1 && ctx.idx < ctx.list.length - 1) location.hash = '#/' + SB.state.active.id + '/' + ctx.list[ctx.idx + 1].id;
        });

        $('notesSave').addEventListener('click', saveNotes);
        $('notesBox').addEventListener('keydown', function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNotes(); }
        });

        $('scrollBtn').addEventListener('click', toggleAutoScroll);
        $('scrollReset').addEventListener('click', function () { resetScroll(false); });
        $('speedDown').addEventListener('click', function () { setSpeed(SB.state.scrollSpeed - 0.1); });
        $('speedUp').addEventListener('click', function () { setSpeed(SB.state.scrollSpeed + 0.1); });
        $('sizeDown').addEventListener('click', function () { setTextSize(SB.state.textSize - 0.1); });
        $('sizeUp').addEventListener('click', function () { setTextSize(SB.state.textSize + 0.1); });
        $('chordSizeDown').addEventListener('click', function () { setChordSize(SB.state.chordSize - 0.1); });
        $('chordSizeUp').addEventListener('click', function () { setChordSize(SB.state.chordSize + 0.1); });
        $('chordPinBtn').addEventListener('click', function () {
            SB.state.chordPin = !SB.state.chordPin;
            try { window.localStorage.setItem(NS + ':chordPin', SB.state.chordPin ? '1' : '0'); } catch (e) { /* ignore */ }
            applyChordSettings();
        });
        Array.prototype.forEach.call(document.querySelectorAll('.chord-mode-btn[data-chord-mode]'), function (b) {
            b.addEventListener('click', function () { setChordMode(b.dataset.chordMode); });
        });
        $('numbersBtn').addEventListener('click', function () {
            SB.state.showNumbers = !SB.state.showNumbers;
            try { window.localStorage.setItem(NS + ':numbers', SB.state.showNumbers ? '1' : '0'); } catch (e) { /* ignore */ }
            applyNumbers();
            if (SB.state.currentSong) renderChordStrip(SB.state.currentSong);
        });
        applyChordSettings();
        applyChordMode();
        applyNumbers();
        $('sheet').addEventListener('pointerdown', sheetPointerDown);
        $('sheet').addEventListener('pointermove', sheetPointerMove);
        $('sheet').addEventListener('pointerup', sheetPointerEnd);
        $('sheet').addEventListener('pointercancel', sheetPointerEnd);

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
            sheetResizeT = setTimeout(function () { renderSheet(SB.state.currentSong); }, 150);
        }, { passive: true });
    }

    function saveNotes() {
        if (!SB.state.currentSong || !SB.state.active) return;
        try { window.localStorage.setItem(noteKey(SB.state.active.id, SB.state.currentSong.id), $('notesBox').value); } catch (e) { /* ignore */ }
        var st = $('notesStatus');
        st.textContent = 'Saved';
        st.classList.add('show');
        clearTimeout(saveNotes._t);
        saveNotes._t = setTimeout(function () { st.classList.remove('show'); }, 1500);
    }

    /* ---------------- auto-scroll ---------------- */

    try { SB.state.showNumbers = window.localStorage.getItem(NS + ':numbers') === '1'; } catch (e) { /* ignore */ }
    try {
        var _cs = parseFloat(window.localStorage.getItem(NS + ':chordSize'));
        if (_cs >= 0.6 && _cs <= 1.5) SB.state.chordSize = Math.round(_cs * 10) / 10;
    } catch (e) { /* ignore */ }
    try { SB.state.chordPin = window.localStorage.getItem(NS + ':chordPin') !== '0'; } catch (e) { /* ignore */ }
    try {
        var _cm = window.localStorage.getItem(NS + ':chordMode');
        if (_cm === 'inline' || _cm === 'above') SB.state.chordMode = _cm;
    } catch (e) { /* ignore */ }

    function applyChordSettings() {
        document.documentElement.style.setProperty('--chord-size', SB.state.chordSize);
        $('chordSizeValue').textContent = Math.round(SB.state.chordSize * 100) + '%';
        var p = $('chordPinBtn');
        p.setAttribute('aria-pressed', SB.state.chordPin ? 'true' : 'false');
        p.textContent = SB.state.chordPin ? '📌' : '📍';
        p.setAttribute('aria-label', SB.state.chordPin
            ? 'Chord strip pinned to the top — click to let it scroll with the lyrics'
            : 'Chord strip scrolls — click to keep it pinned to the top');
        p.title = SB.state.chordPin
            ? 'Pinned — click to let the chord strip scroll'
            : 'Not pinned — click to keep the chord strip at the top';
        $('chordStrip').classList.toggle('is-static', !SB.state.chordPin);
    }

    function setChordSize(v) {
        SB.state.chordSize = Math.min(1.5, Math.max(0.6, Math.round(v * 10) / 10));
        applyChordSettings();
        try { window.localStorage.setItem(NS + ':chordSize', String(SB.state.chordSize)); } catch (e) { /* ignore */ }
    }

    function applyChordMode() {
        $('sheet').classList.toggle('chords-above', SB.state.chordMode === 'above');
        Array.prototype.forEach.call(document.querySelectorAll('.chord-mode-btn[data-chord-mode]'), function (b) {
            var on = b.dataset.chordMode === SB.state.chordMode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function applyNumbers() {
        var btn = $('numbersBtn');
        if (!btn) return;
        btn.classList.toggle('active', SB.state.showNumbers);
        btn.setAttribute('aria-pressed', SB.state.showNumbers ? 'true' : 'false');
    }

    function setChordMode(mode) {
        if (mode !== 'inline' && mode !== 'above') return;
        if (mode === SB.state.chordMode) return;
        SB.state.chordMode = mode;
        try { window.localStorage.setItem(NS + ':chordMode', SB.state.chordMode); } catch (e) { /* ignore */ }
        applyChordMode();
        if (SB.state.currentSong) renderSheet(SB.state.currentSong);
    }

    var pinch = { pts: {}, active: false, base: 0 };
    function pinchDistance(a, b) {
        var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    function sheetPointerDown(e) {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        pinch.pts[e.pointerId] = e;
        var ids = Object.keys(pinch.pts);
        if (ids.length === 2) {
            pinch.active = true;
            pinch.base = pinchDistance(pinch.pts[ids[0]], pinch.pts[ids[1]]) || 1;
        }
    }
    function sheetPointerMove(e) {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        if (!pinch.pts[e.pointerId]) return;
        pinch.pts[e.pointerId] = e;
        if (!pinch.active || Object.keys(pinch.pts).length !== 2) return;
        var ids = Object.keys(pinch.pts);
        var d = pinchDistance(pinch.pts[ids[0]], pinch.pts[ids[1]]);
        if (d < 8) return;
        var ratio = d / pinch.base;
        if (ratio >= 1.15) { setTextSize(SB.state.textSize + 0.1); pinch.base = d; }
        else if (ratio <= 1 / 1.15) { setTextSize(SB.state.textSize - 0.1); pinch.base = d; }
    }
    function sheetPointerEnd(e) {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        delete pinch.pts[e.pointerId];
        if (Object.keys(pinch.pts).length < 2) { pinch.active = false; pinch.base = 0; }
    }

    function loadSpeedForSong(sbId, id) {
        var v = 1;
        try {
            var s = parseFloat(window.localStorage.getItem(speedKey(sbId, id)));
            if (s >= 0.2 && s <= 3) v = Math.round(s * 10) / 10;
        } catch (e) { /* ignore */ }
        return v;
    }
    function updateSpeedLabel() { $('speedValue').textContent = SB.state.scrollSpeed.toFixed(1) + '×'; }

    function loadTextSizeForSong(sbId, id) {
        var v = 1;
        try {
            var s = parseFloat(window.localStorage.getItem(sizeKey(sbId, id)));
            if (s >= 0.7 && s <= 1.5) v = Math.round(s * 10) / 10;
        } catch (e) { /* ignore */ }
        return v;
    }
    function applyTextSize() {
        $('sheet').style.setProperty('--sheet-size', SB.state.textSize);
        $('sizeValue').textContent = Math.round(SB.state.textSize * 100) + '%';
    }
    function setTextSize(v) {
        v = Math.min(1.5, Math.max(0.7, Math.round(v * 10) / 10));
        if (v === SB.state.textSize) { applyTextSize(); return; }
        SB.state.textSize = v;
        applyTextSize();
        if (SB.state.chordMode === 'above' && SB.state.currentSong) renderSheet(SB.state.currentSong);
        if (SB.state.active && SB.state.currentSong) {
            try { window.localStorage.setItem(sizeKey(SB.state.active.id, SB.state.currentSong.id), String(SB.state.textSize)); } catch (e) { /* ignore */ }
        }
    }
    function setSpeed(v) {
        v = Math.min(3, Math.max(0.2, Math.round(v * 10) / 10));
        if (v === SB.state.scrollSpeed) { updateSpeedLabel(); return; }
        SB.state.scrollSpeed = v;
        updateSpeedLabel();
        if (SB.state.active && SB.state.currentSong) {
            try { window.localStorage.setItem(speedKey(SB.state.active.id, SB.state.currentSong.id), String(SB.state.scrollSpeed)); } catch (e) { /* ignore */ }
        }
    }
    var ABOVE_SCROLL_FACTOR = 1.75;
    function scrollDurationMs() {
        var d = ((SB.state.currentSong && SB.state.currentSong.dur ? SB.state.currentSong.dur : 4) * 60 * 1000) / SB.state.scrollSpeed;
        return SB.state.chordMode === 'above' ? d * ABOVE_SCROLL_FACTOR : d;
    }
    // Pixels per millisecond for the whole sheet at the current speed.
    // Always full-sheet-relative, so it is independent of current position.
    function targetVel() {
        var b = scrollBounds();
        var d = scrollDurationMs();
        return (b > 0 && d > 0) ? b / d : 0;
    }
    function scrollBounds() {
        var doc = document.documentElement;
        return Math.max(0, doc.scrollHeight - window.innerHeight);
    }
    function sheetStartY() {
        var top = $('sheet').getBoundingClientRect().top + window.pageYOffset - 70;
        return Math.min(Math.max(0, top), scrollBounds());
    }
    function freshScrollAnchor() {
        SB.state.scrollState.pos = Math.min(Math.max(window.pageYOffset, 0), scrollBounds());
        SB.state.scrollState.started = true;
        SB.state.scrollState.finished = false;
    }
    function startScroll() {
        if (!SB.state.currentSong || scrollBounds() <= 0) return;
        if (!SB.state.scrollState.started || SB.state.scrollState.finished) freshScrollAnchor();
        else SB.state.scrollState.pos = Math.min(Math.max(window.pageYOffset, 0), scrollBounds());
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

        var max = scrollBounds();
        SB.state.scrollState.pos += targetVel() * dt;
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
    function resetScroll(keepPosition) {
        SB.state.scrollState.playing = false;
        if (SB.state.scrollState.raf) cancelAnimationFrame(SB.state.scrollState.raf);
        SB.state.scrollState.raf = null;
        SB.state.scrollState.last = 0;
        SB.state.scrollState.lastY = null;
        SB.state.scrollState.started = false;
        SB.state.scrollState.finished = false;
        if (!keepPosition) window.scrollTo(0, sheetStartY());
        SB.state.scrollState.pos = Math.min(Math.max(window.pageYOffset, 0), scrollBounds());
        updateScrollBtn();
    }
    function toggleAutoScroll() {
        if (SB.state.scrollState.playing) pauseScroll();
        else startScroll();
    }
    function updateScrollBtn() {
        var btn = $('scrollBtn');
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

    /* ---------------- routing ---------------- */

    function route() {
        var h = location.hash || '';
        var m = h.match(/^#\/([^\/]+)(?:\/(.+))?$/);
        var sb = null, songId = null;
        if (m) {
            sb = SB.state.bySb[decodeURIComponent(m[1])];
            if (m[2]) songId = decodeURIComponent(m[2]);
        }
        // A bare "#/" means "back to the song list I'm browsing" — keep the
        // current songbook instead of snapping to the default starter one.
        if (!sb) sb = (SB.state.active && SB.state.bySb[SB.state.active.id]) || defaultSongbook();
        if (!sb) return;

        setActive(sb);

        if (songId && SB.state.byId[songId]) {
            $('listView').hidden = true;
            $('songView').hidden = false;
            openSong(songId);
        } else {
            resetScroll(true);
            SB.state.currentSong = null;
            $('songView').hidden = true;
            $('listView').hidden = false;
            renderList();
            renderRecent();
            window.scrollTo(0, 0);
        }
    }

    /* ---------------- keyboard ---------------- */

    function bindKeyboard() {
        document.addEventListener('keydown', function (e) {
            if ($('tunerOverlay') && !$('tunerOverlay').hidden) return;
            var t = e.target;
            var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

            if (e.key === 'Escape') {
                if (t === $('search')) {
                    $('search').value = '';
                    SB.state.state.q = '';
                    renderList();
                    t.blur();
                    return;
                }
                if (typing) { t.blur(); return; }
                if (!$('songView').hidden) { location.hash = '#/' + (SB.state.active ? SB.state.active.id : ''); return; }
                if (SB.state.state.q) {
                    $('search').value = '';
                    SB.state.state.q = '';
                    renderList();
                }
                return;
            }
            if (typing) return;

            if (e.key === '/') {
                if (!$('listView').hidden) { e.preventDefault(); $('search').focus(); }
                return;
            }
            if (!$('songView').hidden && !e.repeat) {
                var onControl = t && t.closest && t.closest('button, a');
                if (e.key === ' ' && !onControl) { e.preventDefault(); toggleAutoScroll(); }
                else if (e.key === 'ArrowLeft' && !onControl) { $('prevBtn').click(); }
                else if (e.key === 'ArrowRight' && !onControl) { $('nextBtn').click(); }
            }
        });
    }

    /* ---------------- data-uri demo helper (kept for tests) ---------------- */

    function chordSvg(chordName) {
        var v = chosenVoicing(chordName);
        return v ? ChordKit.dataUri(SB.state.instrument, v) : null;
    }

    /* ---------------- init ---------------- */

    function showFatal(msg) {
        var b = $('bootMsg');
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
        initTheme();
        $('themeToggle').addEventListener('click', function () {
            var cur = document.documentElement.getAttribute('data-theme');
            applyTheme(cur === 'dark' ? 'light' : 'dark');
        });
        Array.prototype.forEach.call(document.querySelectorAll('.instrument-btn'), function (b) {
            b.addEventListener('click', function () { setInstrument(b.dataset.instrument); });
        });

        var tunerBtn = $('tunerBtn');
        if (tunerBtn && window.SongbookTuner) {
            tunerBtn.addEventListener('click', function () {
                window.SongbookTuner.open({
                    getInstrument: function () { return SB.state.instrument; },
                    setInstrument: setInstrument
                });
            });
        }

        bindListControls();
        bindSongControls();
        bindKeyboard();
        updateSpeedLabel();
        registerServiceWorker();
        window.addEventListener('hashchange', route);

        Promise.all([loadBundled(), idbAll().catch(function () { return []; })]).then(function (res) {
            SB.state.bundled = res[0];
            SB.state.imported = res[1].map(function (raw) {
                try { var sb = normalizeSongbook(raw); sb.imported = true; return sb; }
                catch (e) { return null; }
            }).filter(Boolean);
            if (!SB.state.bundled.length && !SB.state.imported.length) { showFatal('No songbooks available.'); return; }
            if (!SB.state.instrument) SB.state.instrument = (defaultSongbook() && defaultSongbook().instrument) || 'ukulele';
            applyInstrumentUi();
            rebuildIndex();
            $('bootMsg').hidden = true;
            route();
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
        transposeChordValue: transposeChordValue,
        transposeToken: transposeToken,
        transposeNote: transposeNote,
        transposeChartName: transposeChartName,
        displayChord: displayChord,
        noteNode: noteNode,
        stripSortPrefix: stripSortPrefix,
        filteredSongs: filteredSongs,
        state: SB.state.state,
        favorites: SB.state.favorites,
        activeSongs: activeSongs,
        allSongbooks: allSongbooks,
        getActive: function () { return SB.state.active; },
        getSong: function (id) { return SB.state.byId[id]; },
        setInstrument: setInstrument,
        getInstrument: function () { return SB.state.instrument; },
        chordSvg: chordSvg,
        scrollState: SB.state.scrollState,
        scrollBounds: scrollBounds,
        targetVel: targetVel
    };
})();
