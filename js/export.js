/* Songbook — export
 * writing a songbook back out as a JSON file
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* The JSON shape SB.normalizeSongbook() accepts. Everything the app keeps
     * on a songbook is content and survives the round-trip unchanged; only
     * `imported` is dropped, because it records where this copy is stored
     * rather than what the book contains, and the importer sets it again. */
    SB.songbookJSON = function (sb) {
        var out = {};
        Object.keys(sb).forEach(function (key) {
            if (key !== 'imported') out[key] = sb[key];
        });
        return JSON.stringify(out, null, 2);
    }

    SB.exportSongbook = function (sb) {
        var blob = new Blob([SB.songbookJSON(sb)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = sb.id + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

})(window.SB = window.SB || {});
