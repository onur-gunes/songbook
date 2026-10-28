/* Songbook — theme
 * light/dark theme and the songbook brand logo
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- theme ---------------- */

    var THEME_KEY = SB.NS + ':theme';

    SB.applyTheme = function (theme) {
        document.documentElement.setAttribute('data-theme', theme);
        var btn = SB.$('themeToggle');
        btn.textContent = theme === 'dark' ? '☾' : '☀';
        btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
        SB.applyBrand();
        SB.lsSet(THEME_KEY, theme);
    }

    /* Brand logo comes from the active songbook; hide it when the songbook has none. */
    SB.applyBrand = function () {
        var logo = SB.$('logo');
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
    SB.initTheme = function () {
        var saved = SB.lsGet(THEME_KEY, null);
        if (saved !== 'dark' && saved !== 'light') {
            saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        SB.applyTheme(saved);
    }

})(window.SB = window.SB || {});
