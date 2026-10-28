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
                if (!SB.$('songView').hidden) { location.hash = '#/' + (SB.state.active ? SB.state.active.id : ''); return; }
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
                var onControl = t && t.closest && t.closest('button, a');
                if (e.key === ' ' && !onControl) { e.preventDefault(); SB.toggleAutoScroll(); }
                else if (e.key === 'ArrowLeft' && !onControl) { SB.$('prevBtn').click(); }
                else if (e.key === 'ArrowRight' && !onControl) { SB.$('nextBtn').click(); }
            }
        });
    }

})(window.SB = window.SB || {});
