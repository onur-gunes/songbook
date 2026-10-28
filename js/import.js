/* Songbook — import
 * importing a songbook JSON from disk
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- import ---------------- */

    SB.importSongbook = function (file) {
        var reader = new FileReader();
        reader.onload = function () {
            var sb;
            try {
                sb = SB.normalizeSongbook(JSON.parse(reader.result));
            } catch (err) {
                window.alert('Import failed: ' + err.message);
                return;
            }
            if (SB.state.bySb[sb.id]) {
                window.alert('A songbook with id "' + sb.id + '" already exists. Rename it (the "id" field) and try again.');
                return;
            }
            sb.imported = true;
            SB.idbPut(sb).then(function () {
                SB.state.imported.push(sb);
                SB.rebuildIndex();
                location.hash = '#/' + sb.id;
            }).catch(function (err) { window.alert('Could not save import: ' + err.message); });
        };
        reader.onerror = function () { window.alert('Could not read file.'); };
        reader.readAsText(file);
    }

})(window.SB = window.SB || {});
