/* Songbook — personal
 * favourites, per-song notes and the recently-played list
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- personal data ---------------- */

    SB.saveFavorites = function () { SB.lsSet(SB.FAV_KEY, Array.from(SB.state.favorites)); }
    SB.isFav = function (sbId, songId) { return SB.state.favorites.has(SB.compositeId(sbId, songId)); }

    SB.addRecent = function (sbId, songId) {
        SB.state.recent = [{ sb: sbId, id: songId }].concat(SB.state.recent.filter(function (r) {
            return !(r.sb === sbId && r.id === songId);
        })).slice(0, SB.RECENT_MAX);
        SB.lsSet(SB.RECENT_KEY, SB.state.recent);
    }

    SB.noteKey = function (sbId, songId) { return SB.NS + ':note:' + sbId + SB.SEP + songId; }
    SB.speedKey = function (sbId, songId) { return SB.NS + ':speed:' + sbId + SB.SEP + songId; }
    SB.sizeKey = function (sbId, songId) { return SB.NS + ':size:' + sbId + SB.SEP + songId; }
    SB.bpmKey = function (sbId, songId) { return SB.NS + ':bpm:' + sbId + SB.SEP + songId; }
    SB.strumKey = function (sbId, songId) { return SB.NS + ':strum:' + sbId + SB.SEP + songId; }

    /* ---------------- recent ---------------- */

    SB.renderRecent = function () {
        var block = SB.$('recentBlock');
        var list = SB.$('recentList');
        list.textContent = '';
        var items = SB.state.recent.filter(function (r) { return SB.state.bySb[r.sb] && SB.state.bySb[r.sb].songs.some(function (s) { return s.id === r.id; }); });
        if (!items.length) { block.hidden = true; return; }
        block.hidden = false;
        items.forEach(function (r) {
            var sb = SB.state.bySb[r.sb];
            var s = sb.songs.filter(function (x) { return x.id === r.id; })[0];
            var li = document.createElement('li');
            var b = SB.el('button', null, s.title);
            b.type = 'button';
            b.addEventListener('click', function () { location.hash = '#/' + sb.id + '/' + s.id; });
            li.appendChild(b);
            list.appendChild(li);
        });
    }

})(window.SB = window.SB || {});
