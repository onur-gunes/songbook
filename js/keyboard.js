/* Songbook — keyboard
 * global keyboard shortcuts
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- keyboard ---------------- */

    SB.bindKeyboard = function () {
        document.addEventListener('keydown', function (e) {
            if (SB.$('tunerOverlay') && !SB.$('tunerOverlay').hidden) return;
            // The voicing chooser is a modal: its own Escape closes it and its
            // Space activates the focused option. Letting the global shortcuts
            // run too used to navigate back and start auto-scroll at once.
            if (document.getElementById('voicingChooser')) return;
            // A target handler that already consumed the key (e.g. Space on a
            // chord diagram) must not trigger the global action as well.
            if (e.defaultPrevented) return;
            var t = e.target;
            var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

            if (e.key === 'Escape') {
                if (t === SB.$('search')) {
                    SB.$('search').value = '';
                    SB.state.state.q = '';
                    SB.renderList();
                    t.blur();
                    return;
                }
                if (typing) { t.blur(); return; }
                if (!SB.$('songView').hidden) { location.hash = SB.routeHash(SB.state.active ? SB.state.active.id : ''); return; }
                if (SB.state.state.q) {
                    SB.$('search').value = '';
                    SB.state.state.q = '';
                    SB.renderList();
                }
                return;
            }
            if (typing) return;

            if (e.key === '/') {
                if (!SB.$('listView').hidden) { e.preventDefault(); SB.$('search').focus(); }
                return;
            }
            if (!SB.$('songView').hidden && !e.repeat) {
                var onControl = t && t.closest && t.closest('button, a, [role="button"]');
                if (e.key === ' ' && !onControl) { e.preventDefault(); SB.toggleAutoScroll(); }
                else if (e.key === 'ArrowLeft' && !onControl) { SB.$('prevBtn').click(); }
                else if (e.key === 'ArrowRight' && !onControl) { SB.$('nextBtn').click(); }
            }
        });
    }

})(window.SB = window.SB || {});
