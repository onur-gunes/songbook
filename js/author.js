/* Songbook — author
 * creating editable songbooks from inside the app
 *
 * Part of the window.SB namespace. Loaded as a classic script in the order set
 * by index.html; it depends on SB.createSongbook (js/songbooks.js) and the
 * routing helpers. Authoring writes only ever target imported books; bundled
 * books stay read-only.
 */
(function (SB) {
    'use strict';

    var lastFocus = null;

    function overlay() { return SB.$('newBookOverlay'); }

    function setError(message) {
        var box = SB.$('newBookError');
        if (!box) return;
        box.textContent = message || '';
        box.hidden = !message;
        if (message) {
            try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
        }
    }

    function open() {
        var el = overlay();
        if (!el) return;
        lastFocus = document.activeElement;
        setError('');
        var form = SB.$('newBookForm');
        if (form) form.reset();
        var instrument = SB.$('newBookInstrument');
        if (instrument) {
            instrument.value = SB.state.instrument === 'guitar' ? 'guitar' : 'ukulele';
        }
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        document.body.classList.add('pattern-open');
        var name = SB.$('newBookName');
        if (name) {
            try { name.focus({ preventScroll: true }); } catch (e) { name.focus(); }
        }
    }

    /* `restore` is false after a successful create: the opener may be the
     * first-run empty state, which is hidden by then, so focus belongs on the
     * new book's picker instead. */
    function close(restore) {
        var el = overlay();
        if (!el) return;
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('pattern-open');
        if (restore !== false && lastFocus && lastFocus.focus) {
            try { lastFocus.focus({ preventScroll: true }); } catch (e) { lastFocus.focus(); }
        }
    }

    function submit(event) {
        event.preventDefault();
        var nameInput = SB.$('newBookName');
        var name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            setError('Enter a name for the songbook.');
            if (nameInput) nameInput.focus();
            return;
        }
        var button = SB.$('newBookCreate');
        if (button) button.disabled = true;
        SB.createSongbook({
            name: name,
            description: SB.$('newBookDescription').value,
            instrument: SB.$('newBookInstrument').value
        }).then(function (sb) {
            close(false);
            var hash = SB.routeHash(sb.id);
            if (location.hash === hash) SB.route();
            else location.hash = hash;
            var picker = SB.$('songbookSelect');
            if (picker) {
                try { picker.focus({ preventScroll: true }); } catch (e) { picker.focus(); }
            }
        }, function (err) {
            setError(err.message || 'Could not create the songbook.');
        }).then(function () {
            if (button) button.disabled = false;
        });
    }

    SB.openNewSongbook = open;
    SB.closeNewSongbook = close;

    SB.bindAuthorControls = function () {
        var newBtn = SB.$('newSongbookBtn');
        if (newBtn) newBtn.addEventListener('click', open);
        var emptyBtn = SB.$('emptyNewSongbookBtn');
        if (emptyBtn) emptyBtn.addEventListener('click', open);

        var el = overlay();
        if (!el) return;
        var closeBtn = SB.$('newBookClose');
        if (closeBtn) closeBtn.addEventListener('click', function () { close(true); });
        var cancel = SB.$('newBookCancel');
        if (cancel) cancel.addEventListener('click', function () { close(true); });
        var form = SB.$('newBookForm');
        if (form) form.addEventListener('submit', submit);
        el.addEventListener('click', function (e) {
            if (e.target === el) close(true);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !el.hidden) {
                e.preventDefault();
                close(true);
            }
        });
    };

})(window.SB = window.SB || {});
