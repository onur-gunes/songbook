/* Songbook — ui
 * control-surface preferences: advanced song tools and menus
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- advanced song tools ---------------- */

    /* The song-tools card keeps the controls used on every song visible and
     * puts layout, practice and structure controls behind one disclosure.
     * Expanded is a shared UI state, not per-song state: opening it once keeps
     * it open while moving through the book, and a reload starts collapsed
     * unless the advanced-tools preference below is on. */
    SB.ADVANCED_KEY = SB.NS + ':advanced';
    SB.state.advanced = SB.lsGet(SB.ADVANCED_KEY, false) === true;
    SB.state.toolsOpen = false;

    function label(el, text) {
        if (!el) return;
        var node = el.querySelector('.song-tools-more-label');
        if (node) node.textContent = text;
        else el.textContent = text;
    }

    SB.setSongToolsOpen = function (open) {
        SB.state.toolsOpen = !!open;
        var panel = SB.$('songToolsAdvanced');
        var btn = SB.$('songToolsMoreBtn');
        if (panel) panel.hidden = !open;
        if (btn) {
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.classList.toggle('is-open', !!open);
            label(btn, open ? 'Fewer controls' : 'More controls');
            btn.title = open
                ? 'Hide diagram, tempo, strum and structure controls'
                : 'Show diagram, tempo, strum and structure controls';
        }
        var tools = document.querySelector('.song-tools');
        if (tools) tools.classList.toggle('is-open', !!open);
    };

    SB.toggleSongTools = function () {
        SB.setSongToolsOpen(!SB.state.toolsOpen);
    };

    /* Editing structure needs the Edit/Reset pair even when the panel was
     * folded, so opening the editor reveals it rather than leaving the mode
     * with no visible way out. */
    SB.revealSongTools = function () {
        SB.setSongToolsOpen(true);
    };

    /* Called whenever a song opens: simple mode starts folded, advanced mode
     * starts open. A user who manually folds the panel keeps that choice for
     * the rest of the song. */
    SB.resetSongTools = function () {
        SB.setSongToolsOpen(SB.state.advanced);
    };

    SB.isAdvanced = function () { return !!SB.state.advanced; };

    SB.applyAdvancedMode = function () {
        var on = !!SB.state.advanced;
        var btn = SB.$('advancedToggle');
        if (btn) {
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            var state = btn.querySelector('.menu-item-state');
            if (state) state.textContent = on ? 'On' : 'Off';
        }
        /* Turning the preference on should reveal the tools immediately;
         * turning it off returns the toolbar to its quiet default. */
        SB.setSongToolsOpen(on);
    };

    SB.setAdvanced = function (on) {
        SB.state.advanced = !!on;
        SB.lsSet(SB.ADVANCED_KEY, SB.state.advanced);
        SB.applyAdvancedMode();
    };

    /* ---------------- popover menus ---------------- */
    /* One small menu replaces the flat row of global actions that used to sit
     * beside the instrument toggle: dark mode, the advanced song-tools
     * preference and the tuner. It is plain DOM: the trigger owns
     * aria-expanded, the menu is a role="menu", Escape closes it and returns
     * focus to the trigger, and an outside pointer closes it. */

    var open = null; // { trigger: Element, menu: Element }

    function close() {
        if (!open) return;
        var trigger = open.trigger;
        open.menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        open = null;
        return trigger;
    }

    SB.closeMenus = function () { close(); };

    function menuItems(menu) {
        return Array.prototype.filter.call(
            menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]'),
            function (el) { return !el.hidden && !el.disabled && el.offsetParent !== null; });
    }

    function openMenu(trigger, menu) {
        if (open && open.trigger === trigger) { close(); return; }
        close();
        open = { trigger: trigger, menu: menu };
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        var items = menuItems(menu);
        if (items.length) items[0].focus();
    }

    function bindMenu(triggerId, menuId) {
        var trigger = SB.$(triggerId);
        var menu = SB.$(menuId);
        if (!trigger || !menu) return;

        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            openMenu(trigger, menu);
        });

        /* Menu actions close the popover after they run. The settings toggles
         * are checkboxes: flipping one should not dismiss the menu, so the
         * user can adjust both without reopening it. Actions that open their
         * own dialog (the tuner) manage focus themselves. */
        menu.addEventListener('click', function (e) {
            var item = e.target.closest('[role="menuitem"], [role="menuitemcheckbox"]');
            if (!item) return;
            if (item.getAttribute('role') === 'menuitemcheckbox') return;
            var trigger = close();
            if (trigger && !item.hasAttribute('aria-haspopup')) trigger.focus();
        });

        menu.addEventListener('keydown', function (e) {
            var items = menuItems(menu);
            if (!items.length) return;
            var idx = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                items[(idx + 1 + items.length) % items.length].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                items[(idx - 1 + items.length) % items.length].focus();
            } else if (e.key === 'Home') {
                e.preventDefault();
                items[0].focus();
            } else if (e.key === 'End') {
                e.preventDefault();
                items[items.length - 1].focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                var t = close();
                if (t) t.focus();
            } else if (e.key === 'Tab') {
                /* Let the browser move focus naturally, but never leave an
                 * invisible menu open behind the next control. */
                close();
            }
        });
    }

    SB.initUi = function () {
        var more = SB.$('songToolsMoreBtn');
        if (more) more.addEventListener('click', SB.toggleSongTools);

        bindMenu('settingsBtn', 'settingsMenu');

        var adv = SB.$('advancedToggle');
        if (adv) adv.addEventListener('click', function () {
            SB.setAdvanced(!SB.state.advanced);
        });

        document.addEventListener('pointerdown', function (e) {
            if (!open) return;
            if (e.target.closest && e.target.closest('.menu-wrap')) return;
            close();
        });

        document.addEventListener('keydown', function (e) {
            if (!open || e.key !== 'Escape') return;
            e.preventDefault();
            var t = close();
            if (t) t.focus();
        });

        window.addEventListener('hashchange', function () { close(); });

        SB.applyAdvancedMode();
    };

})(window.SB = window.SB || {});
