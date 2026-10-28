/* Songbook — router
 * hash routing
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- routing ---------------- */

    SB.route = function () {
        var h = location.hash || '';
        var m = h.match(/^#\/([^\/]+)(?:\/(.+))?$/);
        var sb = null, songId = null;
        if (m) {
            sb = SB.state.bySb[decodeURIComponent(m[1])];
            if (m[2]) songId = decodeURIComponent(m[2]);
        }
        // A bare "#/" means "back to the song list I'm browsing" — keep the
        // current songbook instead of snapping to the default starter one.
        if (!sb) sb = (SB.state.active && SB.state.bySb[SB.state.active.id]) || SB.defaultSongbook();
        if (!sb) return;

        SB.setActive(sb);

        if (songId && SB.state.byId[songId]) {
            SB.$('listView').hidden = true;
            SB.$('songView').hidden = false;
            SB.openSong(songId);
        } else {
            SB.resetScroll(true);
            SB.state.currentSong = null;
            SB.$('songView').hidden = true;
            SB.$('listView').hidden = false;
            SB.renderList();
            SB.renderRecent();
            window.scrollTo(0, 0);
        }
    }

})(window.SB = window.SB || {});
