/* Songbook — idb
 * IndexedDB persistence for imported songbooks
 *
 * Part of the window.SB namespace. Loaded as a classic script in the
 * order set by index.html; see js/core.js for the shared state.
 */
(function (SB) {
    'use strict';

    /* ---------------- IndexedDB (imported songbooks) ---------------- */

    var dbPromise = null;

    function idbOpen() {
        // One cached connection for the page. Opening a fresh one per operation
        // churned connections and never closed them.
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (res, rej) {
            if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
            var req = window.indexedDB.open(SB.NS, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains('songbooks')) db.createObjectStore('songbooks', { keyPath: 'id' });
            };
            req.onsuccess = function () {
                var db = req.result;
                // A newer version in another tab needs this one to let go.
                db.onversionchange = function () {
                    try { db.close(); } catch (e) { /* ignore */ }
                    dbPromise = null;
                };
                res(db);
            };
            req.onerror = function () { dbPromise = null; rej(req.error); };
            req.onblocked = function () { dbPromise = null; rej(new Error('IndexedDB open blocked')); };
        });
        return dbPromise;
    }

    function txError(tx) {
        return tx.error || new Error('IndexedDB transaction failed');
    }

    SB.idbAll = function () {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var rows = [];
                var tx = db.transaction('songbooks', 'readonly');
                var req = tx.objectStore('songbooks').getAll();
                req.onsuccess = function () { rows = req.result || []; };
                // Resolve only once the transaction commits, not when the
                // request happens to return: callers treat this as durable.
                tx.oncomplete = function () { res(rows); };
                tx.onerror = function () { rej(txError(tx)); };
                tx.onabort = function () { rej(txError(tx)); };
            });
        });
    }
    SB.idbPut = function (obj) {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction('songbooks', 'readwrite');
                tx.objectStore('songbooks').put(obj);
                tx.oncomplete = function () { res(); };
                tx.onerror = function () { rej(txError(tx)); };
                tx.onabort = function () { rej(txError(tx)); };
            });
        });
    }
    SB.idbDelete = function (id) {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction('songbooks', 'readwrite');
                tx.objectStore('songbooks').delete(id);
                tx.oncomplete = function () { res(); };
                tx.onerror = function () { rej(txError(tx)); };
                tx.onabort = function () { rej(txError(tx)); };
            });
        });
    }

})(window.SB = window.SB || {});
