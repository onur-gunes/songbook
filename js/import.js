/* Songbook — import
 * importing a songbook JSON from disk or a URL
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

    /* One code path for every source (a chosen file or a URL): parse ->
     * normalize -> persist -> replace or append in memory. It does not route
     * or alert; the caller decides what to do with a batch result.
     *
     * `options.sourceUrl` is storage bookkeeping (where a URL import came
     * from), never part of the normalised songbook. `options.confirmReplace`
     * is false for a Refresh: the user has already asked to replace. */
    SB.importSongbookData = function (raw, sourceName, options) {
        options = options || {};
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
            if (existing && options.confirmReplace !== false &&
                    !window.confirm('Replace the imported songbook "' + existing.name + '"?')) {
                reject(importError('replace cancelled', sourceName));
                return;
            }

            sb.imported = true;
            if (options.sourceUrl) sb.sourceUrl = options.sourceUrl;
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

    /* ---------------- import from URL ---------------- */

    /* A cross-origin fetch that the host has not opted into fails before any
     * status exists, and the browser deliberately hides why. Say so in the
     * error instead of surfacing the opaque "Failed to fetch", and name the
     * header the host has to send. */
    var CORS_HINT = 'the host must send Access-Control-Allow-Origin';

    function fetchSongbookText(url) {
        return fetch(url, { cache: 'no-store' }).then(function (response) {
            if (response.status === 404) throw importError('not found (404)', url);
            if (!response.ok) throw importError('server returned HTTP ' + response.status, url);
            return response.text();
        }).catch(function (err) {
            /* Keep the specific status/parse-shaped errors above; only an
             * opaque fetch or body-read failure gets the CORS explanation. */
            if (err && err.sourceName) throw err;
            throw importError('could not fetch (network error or CORS blocked; ' +
                CORS_HINT + ')', url);
        });
    }

    /* fetch -> text -> the same parse/validate/persist path as a file. The
     * URL is remembered so the songbook can be refreshed later. */
    SB.importSongbookFromUrl = function (url, options) {
        var clean = String(url == null ? '' : url).trim();
        if (!clean) return Promise.reject(importError('enter a URL', ''));
        return fetchSongbookText(clean).then(function (raw) {
            var opts = options || {};
            return SB.importSongbookData(raw, clean, {
                sourceUrl: clean,
                confirmReplace: opts.confirmReplace
            });
        });
    }

    /* Re-fetch an imported songbook from the URL it came from and replace the
     * stored copy. No replace prompt: clicking Refresh is the confirmation. */
    SB.refreshSongbook = function (sb) {
        if (!sb || !sb.sourceUrl) {
            return Promise.reject(importError('this songbook has no source URL',
                sb ? sb.name : ''));
        }
        return SB.importSongbookFromUrl(sb.sourceUrl, { confirmReplace: false });
    }

})(window.SB = window.SB || {});
