/* Songbook — idb
 * IndexedDB persistence for imported songbooks
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- IndexedDB (imported songbooks) ---------------- */

    function idbOpen() {
        return new Promise(function (res, rej) {
            if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
            var req = window.indexedDB.open(SB.NS, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains('songbooks')) db.createObjectStore('songbooks', { keyPath: 'id' });
            };
            req.onsuccess = function () { res(req.result); };
            req.onerror = function () { rej(req.error); };
        });
    }
    SB.idbAll = function () {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var t = db.transaction('songbooks', 'readonly').objectStore('songbooks').getAll();
                t.onsuccess = function () { res(t.result || []); };
                t.onerror = function () { rej(t.error); };
            });
        });
    }
    SB.idbPut = function (obj) {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var t = db.transaction('songbooks', 'readwrite').objectStore('songbooks').put(obj);
                t.onsuccess = function () { res(); };
                t.onerror = function () { rej(t.error); };
            });
        });
    }
    SB.idbDelete = function (id) {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var t = db.transaction('songbooks', 'readwrite').objectStore('songbooks').delete(id);
                t.onsuccess = function () { res(); };
                t.onerror = function () { rej(t.error); };
            });
        });
    }

})(window.SB = window.SB || {});
