/* Songbook — import
 * importing a songbook JSON from disk
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- import ---------------- */

    /* sourceName travels on the error rather than in its message so a batch
     * caller can put the filename in front of the reason exactly once. */
    function importError(message, sourceName) {
        var err = new Error(message);
        err.sourceName = sourceName;
        return err;
    }

    function readFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () {
                reject(importError('could not read file', file.name));
            };
            reader.readAsText(file);
        });
    }

    /* One code path for every source (a chosen file now, a URL later):
     * parse -> normalize -> persist -> replace or append in memory. It does
     * not route or alert; the caller decides what to do with a batch result. */
    SB.importSongbookData = function (raw, sourceName) {
        return new Promise(function (resolve, reject) {
            var data = raw;
            if (typeof raw === 'string') {
                try { data = JSON.parse(raw); }
                catch (err) {
                    reject(importError('not valid JSON: ' + err.message, sourceName));
                    return;
                }
            }
            var sb;
            try { sb = SB.normalizeSongbook(data); }
            catch (err) {
                reject(importError(err.message, sourceName));
                return;
            }

            /* A bundled id belongs to the app, not the user: replacing it
             * would shadow shipped content and disappear on the next deploy.
             * An imported id is the user's own copy, so offer to replace it. */
            var bundled = SB.state.bundled.some(function (b) { return b.id === sb.id; });
            if (bundled) {
                reject(importError('a bundled songbook already uses the id "' + sb.id + '"', sourceName));
                return;
            }
            var existing = null;
            for (var i = 0; i < SB.state.imported.length; i++) {
                if (SB.state.imported[i].id === sb.id) { existing = SB.state.imported[i]; break; }
            }
            if (existing && !window.confirm('Replace the imported songbook "' + existing.name + '"?')) {
                reject(importError('replace cancelled', sourceName));
                return;
            }

            sb.imported = true;
            SB.idbPut(sb).then(function () {
                var index = -1;
                for (var j = 0; j < SB.state.imported.length; j++) {
                    if (SB.state.imported[j].id === sb.id) { index = j; break; }
                }
                if (index >= 0) SB.state.imported[index] = sb;
                else SB.state.imported.push(sb);
                SB.rebuildIndex();
                resolve(sb);
            }, function (err) {
                reject(importError('could not save: ' + err.message, sourceName));
            });
        });
    };

    SB.importSongbook = function (file) {
        return readFile(file).then(function (raw) {
            return SB.importSongbookData(raw, file.name);
        });
    }

})(window.SB = window.SB || {});
