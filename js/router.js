/* Songbook — router
 * hash routing
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- routing ---------------- */

    /* A hash can be edited by hand, restored from an old bookmark, or typed
     * with a stray '%'. decodeURIComponent throws on those, which used to take
     * the whole router down; fall back to the raw segment and let the lookup
     * below decide whether it names anything. */
    function decodePart(value) {
        try { return decodeURIComponent(value); }
        catch (e) { return value; }
    }

    SB.route = function () {
        var h = location.hash || '';
        var m = h.match(/^#\/([^\/]+)(?:\/(.+))?$/);
        var sb = null, songId = null;
        if (m) {
            sb = SB.state.bySb[decodePart(m[1])];
            if (m[2]) songId = decodePart(m[2]);
        }
        // A bare "#/" means "back to the song list I'm browsing" — keep the
        // current songbook instead of snapping to the default starter one.
        if (!sb) sb = (SB.state.active && SB.state.bySb[SB.state.active.id]) || SB.defaultSongbook();
        if (!sb) {
            /* With no books at all there is nothing to route to, but the list
             * view is still usable: show the empty state instead of leaving
             * both views hidden. This is also the path after the last book is
             * removed. */
            SB.setActive(null);
            SB.resetScroll(true);
            SB.stopMetronome();
            SB.state.currentSong = null;
            SB.$('songView').hidden = true;
            SB.$('listView').hidden = false;
            SB.renderEmptyState();
            return;
        }

        SB.setActive(sb);

        if (songId && SB.state.byId[songId]) {
            SB.$('listView').hidden = true;
            SB.$('songView').hidden = false;
            SB.openSong(songId);
        } else {
            SB.resetScroll(true);
            SB.stopMetronome();
            SB.state.currentSong = null;
            SB.$('songView').hidden = true;
            SB.$('listView').hidden = false;
            SB.renderList();
            SB.renderRecent();
            window.scrollTo(0, 0);
        }
    }

})(window.SB = window.SB || {});
