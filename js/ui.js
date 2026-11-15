/* Songbook — ui
 * the song-tools disclosure and the songbook popover menu
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- song tools disclosure ---------------- */

    /* The song-tools card keeps the controls used on every song visible
     * (transpose, chord placement, text size, tempo) and puts layout,
     * labelling and structure controls behind one disclosure.
     * Expanded is DOM state rather than per-song state: opening it once keeps
     * it open while moving through the book, and a reload starts collapsed. */
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
                ? 'Hide strum, diagram, labels and structure controls'
                : 'Show strum, diagram, labels and structure controls';
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

    /* ---------------- popover menu ---------------- */
    /* One small menu replaces the flat row of rare songbook file actions. It is
     * plain DOM: the trigger owns aria-expanded, the menu is a role="menu",
     * Escape closes it and returns focus to the trigger, and an outside
     * pointer closes it. */

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

        /* A menu action closes the popover after it runs, then hands focus
         * back to the trigger unless the action opened something of its own. */
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

        bindMenu('bookMenuBtn', 'bookMenu');

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

        var panel = SB.$('songToolsAdvanced');
        if (panel) SB.setSongToolsOpen(!panel.hidden);
    };

})(window.SB = window.SB || {});

