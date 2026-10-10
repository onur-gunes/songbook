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
        var light = (active && active.logo) || '';
        var dark = (active && (active.logoDark || active.logo)) || '';
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

    var bundled = [];
    var imported = [];
    var bySb = {};
    var active = null;          // current songbook
    var byId = {};              // active songs by id
    var currentSong = null;

    function activeSongs() { return active ? active.songs : []; }
    function allSongbooks() { return bundled.concat(imported); }

    function normalizeSong(s, index) {
        if (!s || typeof s !== 'object') throw new Error('bad song entry');
        return {
            id: String(s.id || ('song-' + (index + 1))),
            n: typeof s.n === 'number' ? s.n : (index + 1),
            title: String(s.title || 'Untitled'),
            artist: String(s.artist || ''),
            level: (s.level === 'Easy' || s.level === 'Medium' || s.level === 'Hard') ? s.level : 'Medium',
            new: !!s.new,
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
        bySb = {};
        allSongbooks().forEach(function (sb) { bySb[sb.id] = sb; });
        buildSongbookSelect();
    }

    function setActive(sb) {
        active = sb;
        byId = {};
        if (sb) sb.songs.forEach(function (s) { byId[s.id] = s; });
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
        return bundled[0] || allSongbooks()[0] || null;
    }

    /* ---------------- personal data ---------------- */

    var FAV_KEY = NS + ':favorites';
    var RECENT_KEY = NS + ':recent';
    var RECENT_MAX = 15;

    var favorites = new Set(lsGet(FAV_KEY, []));   // composite "sbId\0songId"
    var recent = lsGet(RECENT_KEY, []);            // [{sb,id}]

    function saveFavorites() { lsSet(FAV_KEY, Array.from(favorites)); }
    function isFav(sbId, songId) { return favorites.has(compositeId(sbId, songId)); }

    function addRecent(sbId, songId) {
        recent = [{ sb: sbId, id: songId }].concat(recent.filter(function (r) {
            return !(r.sb === sbId && r.id === songId);
        })).slice(0, RECENT_MAX);
        lsSet(RECENT_KEY, recent);
    }

    function noteKey(sbId, songId) { return NS + ':note:' + sbId + SEP + songId; }
    function speedKey(sbId, songId) { return NS + ':speed:' + sbId + SEP + songId; }
    function sizeKey(sbId, songId) { return NS + ':size:' + sbId + SEP + songId; }

    /* ---------------- instrument ---------------- */

    var instrument = lsGet(NS + ':instrument', null);
    if (instrument !== 'ukulele' && instrument !== 'guitar') instrument = null;

    function applyInstrumentUi() {
        Array.prototype.forEach.call(document.querySelectorAll('.instrument-btn'), function (b) {
            var on = b.dataset.instrument === instrument;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }
    function setInstrument(inst) {
        if (inst !== 'ukulele' && inst !== 'guitar') return;
        instrument = inst;
        lsSet(NS + ':instrument', instrument);
        applyInstrumentUi();
        closeVoicingChooser();
        if (currentSong) renderChordStrip(currentSong);
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

    var transpose = 0;

    function renderSheet(song) {
        var wrap = $('sheet');
        wrap.textContent = '';
        var frag = document.createDocumentFragment();
        (song.sheet || []).forEach(function (line) {
            var lineDiv = el('div', 'line');
            if (line.length === 1 && line[0][0] === 'p') {
                lineDiv.classList.add('is-pre');
                lineDiv.textContent = line[0][1];
                frag.appendChild(lineDiv);
                return;
            }
            line.forEach(function (seg) {
                var kind = seg[0], val = seg[1];
                if (kind === 'c') {
                    lineDiv.appendChild(el('span', 'seg-chord', transposeChordValue(val, transpose)));
                } else if (kind === 'm') {
                    lineDiv.appendChild(el('span', 'seg-muted', val));
                } else if (kind === 'b') {
                    lineDiv.appendChild(el('span', 'seg-bold', val));
                } else if (kind === 'i') {
                    lineDiv.appendChild(el('span', 'seg-italic', val));
                } else if (kind === 'y') {
                    var note = el('span', 'seg-note');
                    note.innerHTML = val;
                    lineDiv.appendChild(note);
                } else {
                    lineDiv.appendChild(document.createTextNode(val));
                }
            });
            frag.appendChild(lineDiv);
        });
        wrap.appendChild(frag);
    }

    function updateTransposeLabel() {
        $('trValue').textContent = (transpose > 0 ? '+' : '') + transpose;
    }

    /* ---------------- chord strip (ChordKit) ---------------- */

    function pickKey(chordName) { return NS + ':pick:' + instrument + ':' + chordName; }

    function storedPick(chordName) {
        try {
            var s = window.localStorage.getItem(pickKey(chordName));
            if (!s) return null;
            var f = s.split(',').map(Number);
            var n = ChordKit.instrumentOf(instrument).tuning.length;
            if (f.length === n && f.every(function (v) { return v >= -1 && v <= 12; })) return f;
        } catch (e) { /* ignore */ }
        return null;
    }
    function savePick(chordName, frets) {
        try { window.localStorage.setItem(pickKey(chordName), frets.join(',')); } catch (e) { /* ignore */ }
    }

    function voicingsFor(chordName) { return ChordKit.voicings(chordName, instrument); }

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
            var tname = transposeChartName(name, transpose);
            var label = displayChord(tname);
            var hard = ChordKit.chordDifficulty(tname) === 'hard';
            var item = el('div', 'chord-item' + (hard ? ' hard' : ''));
            var list = voicingsFor(tname);
            if (list.length) {
                var v = chosenVoicing(tname);
                var img = new Image();
                img.alt = label + ' chord diagram';
                img.title = label + (hard ? ' (hard chord – easy alternative in the picker)' : ' – click to choose voicing');
                img.loading = 'lazy';
                img.src = ChordKit.dataUri(instrument, v);
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.setAttribute('aria-label', label + ' chord diagram – choose voicing');
                var openSel = function (e) { e.preventDefault(); showVoicingChooser(strip, item, tname, label, img); };
                item.addEventListener('click', openSel);
                item.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSel(e); }
                });
                item.appendChild(el('span', 'cname', label));
                item.appendChild(img);
            } else {
                item.classList.add('no-diagram');
                item.appendChild(el('span', 'cname', label));
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
        head.appendChild(el('span', 'chooser-title', label + ' – choose a voicing (' + ChordKit.instrumentOf(instrument).label + ')'));
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
            oi.src = ChordKit.dataUri(instrument, f);
            opt.appendChild(oi);
            opt.appendChild(el('span', 'choosing-frets', fretsTxt));
            opt.addEventListener('click', function () {
                savePick(chordName, f);
                img.src = ChordKit.dataUri(instrument, f);
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
        var items = recent.filter(function (r) { return bySb[r.sb] && bySb[r.sb].songs.some(function (s) { return s.id === r.id; }); });
        if (!items.length) { block.hidden = true; return; }
        block.hidden = false;
        items.forEach(function (r) {
            var sb = bySb[r.sb];
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

    var state = {
        q: '',
        levels: new Set(),
        isNew: false,
        favOnly: false,
        sort: 'title',
        compact: false
    };
    try { state.compact = window.localStorage.getItem(NS + ':compact') === '1'; } catch (e) { /* ignore */ }

    function applyViewToggle() {
        var b = $('viewToggle');
        b.setAttribute('aria-pressed', state.compact ? 'true' : 'false');
        b.textContent = state.compact ? '▤' : '☰';
        b.setAttribute('aria-label', state.compact
            ? 'Switch back to card view'
            : 'Switch to compact one-line song list');
        b.title = state.compact ? 'Back to cards' : 'Compact list';
        $('songList').classList.toggle('is-compact', state.compact);
    }

    // Diacritic-insensitive fold: typing "pszczolka" finds "Pszczółka".
    function fold(s) {
        return String(s).toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\u0142/g, 'l');
    }

    function filteredSongs() {
        var q = fold(state.q.trim());
        var sbId = active ? active.id : '';
        var out = activeSongs().filter(function (s) {
            if (state.levels.size && !state.levels.has(s.level)) return false;
            if (state.isNew && !s.new) return false;
            if (state.favOnly && !isFav(sbId, s.id)) return false;
            if (q) {
                var hay = fold(s.title + ' ' + s.artist);
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
        if (state.sort === 'artist') {
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
        var sbId = active ? active.id : '';
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
        $('searchClear').hidden = !state.q;
        applyViewToggle();
    }

    function toggleFavorite(sbId, songId) {
        var cid = compositeId(sbId, songId);
        if (favorites.has(cid)) favorites.delete(cid);
        else favorites.add(cid);
        saveFavorites();
        if (!$('listView').hidden && active && active.id === sbId) {
            if (state.favOnly) renderList();
            else updateStarInPlace(songId);
        }
        if (currentSong && active && active.id === sbId && currentSong.id === songId) updateFavBtn();
    }

    function updateStarInPlace(id) {
        var rows = document.querySelectorAll('#songList .song-row');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].dataset.id !== id) continue;
            var star = rows[i].querySelector('.star-btn');
            if (!star) break;
            var on = isFav(active.id, id);
            star.classList.toggle('on', on);
            star.textContent = on ? '★' : '☆';
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            break;
        }
    }

    function updateFavBtn() {
        if (!currentSong || !active) return;
        var on = isFav(active.id, currentSong.id);
        var btn = $('favBtn');
        btn.textContent = on ? '★' : '☆';
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function syncSortButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.sort-btn'), function (b) {
            var on = b.dataset.sort === state.sort;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function syncFilterButtons() {
        Array.prototype.forEach.call(document.querySelectorAll('.filter-btn'), function (b) {
            var lv = b.dataset.level;
            var on = lv === 'New' ? state.isNew
                : lv === 'Favorites' ? state.favOnly
                : lv === 'All' ? state.levels.size === 0
                : state.levels.has(lv);
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function bindListControls() {
        var input = $('search');
        input.addEventListener('input', function () {
            state.q = input.value;
            renderList();
        });
        $('searchClear').addEventListener('click', function () {
            input.value = '';
            state.q = '';
            renderList();
            input.focus();
        });

        document.querySelectorAll('.filter-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                var lv = b.dataset.level;
                if (lv === 'New') state.isNew = !state.isNew;
                else if (lv === 'Favorites') state.favOnly = !state.favOnly;
                else if (lv === 'All') state.levels.clear();
                else if (state.levels.has(lv)) state.levels.delete(lv);
                else state.levels.add(lv);
                syncFilterButtons();
                renderList();
            });
        });

        document.querySelectorAll('.sort-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                state.sort = b.dataset.sort;
                syncSortButtons();
                renderList();
            });
        });
        syncSortButtons();

        $('randomBtn').addEventListener('click', function () {
            var songs = filteredSongs();
            if (!songs.length || !active) return;
            var pick = songs[Math.floor(Math.random() * songs.length)];
            location.hash = '#/' + active.id + '/' + pick.id;
        });

        $('recentClear').addEventListener('click', function () {
            recent = [];
            lsSet(RECENT_KEY, recent);
            renderRecent();
        });

        $('viewToggle').addEventListener('click', function () {
            state.compact = !state.compact;
            try { window.localStorage.setItem(NS + ':compact', state.compact ? '1' : '0'); } catch (e) { /* ignore */ }
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
            if (!active || !active.imported) return;
            if (!window.confirm('Remove imported songbook "' + active.name + '"? Your notes and favorites for it are kept.')) return;
            var id = active.id;
            idbDelete(id).then(function () {
                imported = imported.filter(function (sb) { return sb.id !== id; });
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
            if (bySb[sb.id]) {
                window.alert('A songbook with id "' + sb.id + '" already exists. Rename it (the "id" field) and try again.');
                return;
            }
            sb.imported = true;
            idbPut(sb).then(function () {
                imported.push(sb);
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
        for (var i = 0; i < list.length; i++) if (list[i].id === currentSong.id) { idx = i; break; }
        if (idx === -1) {
            list = activeSongs().slice().sort(function (a, b) { return a.n - b.n; });
            for (var j = 0; j < list.length; j++) if (list[j].id === currentSong.id) { idx = j; break; }
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
        var song = byId[id];
        if (!song) { location.hash = '#/' + (active ? active.id : ''); return; }
        currentSong = song;
        addRecent(active.id, id);
        resetScroll(true);
        scrollSpeed = loadSpeedForSong(active.id, id);
        updateSpeedLabel();
        textSize = loadTextSizeForSong(active.id, id);
        applyTextSize();

        transpose = 0;
        updateTransposeLabel();

        $('songNumber').textContent = '#' + song.n;
        $('songTitle').textContent = song.title;
        $('songArtist').textContent = song.artist;
        var badge = $('songLevel');
        badge.textContent = song.level;
        badge.className = 'level-badge level-' + song.level;
        updateFavBtn();

        renderChordStrip(song);
        renderSheet(song);

        var note = '';
        try { note = window.localStorage.getItem(noteKey(active.id, id)) || ''; } catch (e) { /* ignore */ }
        $('notesBox').value = note;
        $('notesStatus').classList.remove('show');

        updateNavButtons();
        $('sheet').focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }

    function bindSongControls() {
        $('trUp').addEventListener('click', function () {
            if (transpose >= 11) return;
            transpose++;
            updateTransposeLabel();
            if (currentSong) { renderChordStrip(currentSong); renderSheet(currentSong); }
        });
        $('trDown').addEventListener('click', function () {
            if (transpose <= -11) return;
            transpose--;
            updateTransposeLabel();
            if (currentSong) { renderChordStrip(currentSong); renderSheet(currentSong); }
        });

        $('favBtn').addEventListener('click', function () {
            if (currentSong && active) toggleFavorite(active.id, currentSong.id);
        });

        $('prevBtn').addEventListener('click', function () {
            var ctx = navContext();
            if (ctx.idx > 0) location.hash = '#/' + active.id + '/' + ctx.list[ctx.idx - 1].id;
        });
        $('nextBtn').addEventListener('click', function () {
            var ctx = navContext();
            if (ctx.idx !== -1 && ctx.idx < ctx.list.length - 1) location.hash = '#/' + active.id + '/' + ctx.list[ctx.idx + 1].id;
        });

        $('notesSave').addEventListener('click', saveNotes);
        $('notesBox').addEventListener('keydown', function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNotes(); }
        });

        $('scrollBtn').addEventListener('click', toggleAutoScroll);
        $('scrollReset').addEventListener('click', function () { resetScroll(false); });
        $('speedDown').addEventListener('click', function () { setSpeed(scrollSpeed - 0.1); });
        $('speedUp').addEventListener('click', function () { setSpeed(scrollSpeed + 0.1); });
        $('sizeDown').addEventListener('click', function () { setTextSize(textSize - 0.1); });
        $('sizeUp').addEventListener('click', function () { setTextSize(textSize + 0.1); });
        $('chordSizeDown').addEventListener('click', function () { setChordSize(chordSize - 0.1); });
        $('chordSizeUp').addEventListener('click', function () { setChordSize(chordSize + 0.1); });
        $('chordPinBtn').addEventListener('click', function () {
            chordPin = !chordPin;
            try { window.localStorage.setItem(NS + ':chordPin', chordPin ? '1' : '0'); } catch (e) { /* ignore */ }
            applyChordSettings();
        });
        applyChordSettings();
        $('sheet').addEventListener('pointerdown', sheetPointerDown);
        $('sheet').addEventListener('pointermove', sheetPointerMove);
        $('sheet').addEventListener('pointerup', sheetPointerEnd);
        $('sheet').addEventListener('pointercancel', sheetPointerEnd);

        window.addEventListener('scroll', function () {
            if (!scrollState.playing || scrollState.lastY === null) return;
            if (Math.abs(window.pageYOffset - scrollState.lastY) > 2) reanchorKeepSpeed();
        }, { passive: true });
    }

    function saveNotes() {
        if (!currentSong || !active) return;
        try { window.localStorage.setItem(noteKey(active.id, currentSong.id), $('notesBox').value); } catch (e) { /* ignore */ }
        var st = $('notesStatus');
        st.textContent = 'Saved';
        st.classList.add('show');
        clearTimeout(saveNotes._t);
        saveNotes._t = setTimeout(function () { st.classList.remove('show'); }, 1500);
    }

    /* ---------------- auto-scroll ---------------- */

    var scrollState = { raf: null, last: 0, elapsed: 0, durMs: 1, from: 0, playing: false, started: false, finished: false, lastY: null };
    var scrollSpeed = 1;
    var textSize = 1;
    var chordSize = 1;
    var chordPin = true;
    try {
        var _cs = parseFloat(window.localStorage.getItem(NS + ':chordSize'));
        if (_cs >= 0.6 && _cs <= 1.5) chordSize = Math.round(_cs * 10) / 10;
    } catch (e) { /* ignore */ }
    try { chordPin = window.localStorage.getItem(NS + ':chordPin') !== '0'; } catch (e) { /* ignore */ }

    function applyChordSettings() {
        document.documentElement.style.setProperty('--chord-size', chordSize);
        $('chordSizeValue').textContent = Math.round(chordSize * 100) + '%';
        var p = $('chordPinBtn');
        p.setAttribute('aria-pressed', chordPin ? 'true' : 'false');
        p.textContent = chordPin ? '📌' : '📍';
        p.setAttribute('aria-label', chordPin
            ? 'Chord strip pinned to the top — click to let it scroll with the lyrics'
            : 'Chord strip scrolls — click to keep it pinned to the top');
        p.title = chordPin
            ? 'Pinned — click to let the chord strip scroll'
            : 'Not pinned — click to keep the chord strip at the top';
        $('chordStrip').classList.toggle('is-static', !chordPin);
    }

    function setChordSize(v) {
        chordSize = Math.min(1.5, Math.max(0.6, Math.round(v * 10) / 10));
        applyChordSettings();
        try { window.localStorage.setItem(NS + ':chordSize', String(chordSize)); } catch (e) { /* ignore */ }
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
        if (ratio >= 1.15) { setTextSize(textSize + 0.1); pinch.base = d; }
        else if (ratio <= 1 / 1.15) { setTextSize(textSize - 0.1); pinch.base = d; }
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
    function updateSpeedLabel() { $('speedValue').textContent = scrollSpeed.toFixed(1) + '×'; }

    function loadTextSizeForSong(sbId, id) {
        var v = 1;
        try {
            var s = parseFloat(window.localStorage.getItem(sizeKey(sbId, id)));
            if (s >= 0.7 && s <= 1.5) v = Math.round(s * 10) / 10;
        } catch (e) { /* ignore */ }
        return v;
    }
    function applyTextSize() {
        $('sheet').style.setProperty('--sheet-size', textSize);
        $('sizeValue').textContent = Math.round(textSize * 100) + '%';
    }
    function setTextSize(v) {
        v = Math.min(1.5, Math.max(0.7, Math.round(v * 10) / 10));
        if (v === textSize) { applyTextSize(); return; }
        textSize = v;
        applyTextSize();
        if (active && currentSong) {
            try { window.localStorage.setItem(sizeKey(active.id, currentSong.id), String(textSize)); } catch (e) { /* ignore */ }
        }
    }
    function setSpeed(v) {
        v = Math.min(3, Math.max(0.2, Math.round(v * 10) / 10));
        if (v === scrollSpeed) { updateSpeedLabel(); return; }
        var f = scrollState.durMs > 0 ? scrollState.elapsed / scrollState.durMs : 0;
        scrollSpeed = v;
        scrollState.durMs = scrollDurationMs();
        scrollState.elapsed = Math.min(1, f) * scrollState.durMs;
        updateSpeedLabel();
        if (active && currentSong) {
            try { window.localStorage.setItem(speedKey(active.id, currentSong.id), String(scrollSpeed)); } catch (e) { /* ignore */ }
        }
    }
    function reanchorKeepSpeed() {
        if (!scrollState.playing) return;
        var max = scrollBounds();
        if (max <= 0) return;
        var remaining = scrollState.durMs - scrollState.elapsed;
        var spanLeft = max - scrollState.from;
        var v = (remaining > 0 && spanLeft > 0) ? spanLeft / remaining : 0;
        scrollState.from = Math.min(Math.max(window.pageYOffset, 0), max);
        scrollState.elapsed = 0;
        scrollState.durMs = v > 0 ? Math.max((max - scrollState.from) / v, 1) : scrollDurationMs();
        scrollState.lastY = window.pageYOffset;
    }
    function scrollDurationMs() {
        return ((currentSong && currentSong.dur ? currentSong.dur : 4) * 60 * 1000) / scrollSpeed;
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
        scrollState.from = Math.min(Math.max(window.pageYOffset, 0), scrollBounds());
        scrollState.elapsed = 0;
        scrollState.durMs = scrollDurationMs();
        scrollState.started = true;
        scrollState.finished = false;
    }
    function reanchorElapsed() {
        scrollState.durMs = scrollDurationMs();
        var max = scrollBounds();
        var span = max - scrollState.from;
        var y = window.pageYOffset;
        if (y <= scrollState.from || span <= 0) {
            scrollState.from = Math.min(Math.max(y, 0), max);
            scrollState.elapsed = 0;
            return;
        }
        var f = (y - scrollState.from) / span;
        scrollState.elapsed = Math.min(1, f) * scrollState.durMs;
    }
    function startScroll() {
        if (!currentSong || scrollBounds() <= 0) return;
        if (!scrollState.started || scrollState.finished) freshScrollAnchor();
        else reanchorElapsed();
        scrollState.playing = true;
        scrollState.last = 0;
        scrollState.lastY = window.pageYOffset;
        scrollState.raf = requestAnimationFrame(stepScroll);
        updateScrollBtn();
    }
    function stepScroll(ts) {
        if (!scrollState.playing) return;
        if (scrollState.lastY !== null && Math.abs(window.pageYOffset - scrollState.lastY) > 2) reanchorKeepSpeed();
        if (!scrollState.last) scrollState.last = ts;
        var dt = Math.min(ts - scrollState.last, 100);
        scrollState.last = ts;
        scrollState.elapsed += dt;
        var f = Math.min(1, scrollState.elapsed / scrollState.durMs);
        var y = scrollState.from + (scrollBounds() - scrollState.from) * f;
        window.scrollTo(0, y);
        scrollState.lastY = window.pageYOffset;
        if (f >= 1) {
            scrollState.playing = false;
            scrollState.finished = true;
            scrollState.raf = null;
            scrollState.last = 0;
            updateScrollBtn();
            return;
        }
        scrollState.raf = requestAnimationFrame(stepScroll);
    }
    function pauseScroll() {
        scrollState.playing = false;
        if (scrollState.raf) cancelAnimationFrame(scrollState.raf);
        scrollState.raf = null;
        scrollState.last = 0;
        scrollState.lastY = null;
        updateScrollBtn();
    }
    function resetScroll(keepPosition) {
        scrollState.playing = false;
        if (scrollState.raf) cancelAnimationFrame(scrollState.raf);
        scrollState.raf = null;
        scrollState.last = 0;
        scrollState.lastY = null;
        scrollState.started = false;
        scrollState.finished = false;
        scrollState.elapsed = 0;
        if (!keepPosition) window.scrollTo(0, sheetStartY());
        updateScrollBtn();
    }
    function toggleAutoScroll() {
        if (scrollState.playing) pauseScroll();
        else startScroll();
    }
    function updateScrollBtn() {
        var btn = $('scrollBtn');
        if (scrollState.playing) {
            btn.textContent = '⏸';
            btn.setAttribute('aria-label', 'Pause auto-scroll');
        } else if (scrollState.started && !scrollState.finished) {
            btn.textContent = '▶';
            btn.setAttribute('aria-label', 'Resume auto-scroll');
        } else {
            btn.textContent = '▶';
            btn.setAttribute('aria-label', 'Start auto-scroll');
        }
        btn.title = btn.getAttribute('aria-label') + ' (Space)';
        btn.classList.toggle('playing', scrollState.playing);
    }

    /* ---------------- routing ---------------- */

    function route() {
        var h = location.hash || '';
        var m = h.match(/^#\/([^\/]+)(?:\/(.+))?$/);
        var sb = null, songId = null;
        if (m) {
            sb = bySb[decodeURIComponent(m[1])];
            if (m[2]) songId = decodeURIComponent(m[2]);
        }
        // A bare "#/" means "back to the song list I'm browsing" — keep the
        // current songbook instead of snapping to the default starter one.
        if (!sb) sb = (active && bySb[active.id]) || defaultSongbook();
        if (!sb) return;

        setActive(sb);

        if (songId && byId[songId]) {
            $('listView').hidden = true;
            $('songView').hidden = false;
            openSong(songId);
        } else {
            resetScroll(true);
            currentSong = null;
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
            var t = e.target;
            var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

            if (e.key === 'Escape') {
                if (t === $('search')) {
                    $('search').value = '';
                    state.q = '';
                    renderList();
                    t.blur();
                    return;
                }
                if (typing) { t.blur(); return; }
                if (!$('songView').hidden) { location.hash = '#/' + (active ? active.id : ''); return; }
                if (state.q) {
                    $('search').value = '';
                    state.q = '';
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
        return v ? ChordKit.dataUri(instrument, v) : null;
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

        bindListControls();
        bindSongControls();
        bindKeyboard();
        updateSpeedLabel();
        registerServiceWorker();
        window.addEventListener('hashchange', route);

        Promise.all([loadBundled(), idbAll().catch(function () { return []; })]).then(function (res) {
            bundled = res[0];
            imported = res[1].map(function (raw) {
                try { var sb = normalizeSongbook(raw); sb.imported = true; return sb; }
                catch (e) { return null; }
            }).filter(Boolean);
            if (!bundled.length && !imported.length) { showFatal('No songbooks available.'); return; }
            if (!instrument) instrument = (defaultSongbook() && defaultSongbook().instrument) || 'ukulele';
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
        stripSortPrefix: stripSortPrefix,
        filteredSongs: filteredSongs,
        state: state,
        favorites: favorites,
        activeSongs: activeSongs,
        allSongbooks: allSongbooks,
        getActive: function () { return active; },
        getSong: function (id) { return byId[id]; },
        setInstrument: setInstrument,
        getInstrument: function () { return instrument; },
        chordSvg: chordSvg,
        scrollState: scrollState,
        scrollBounds: scrollBounds
    };
})();
