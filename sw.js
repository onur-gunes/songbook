/* Songbook service worker — app-shell cache + stale-while-revalidate. */
'use strict';

var VERSION = 'v2';
var SHELL = 'ukb-shell-' + VERSION;
var RUNTIME = 'ukb-runtime-' + VERSION;

var CORE = [
    './',
    'index.html',
    'app.js',
    'chords.js',
    'style.css',
    'manifest.webmanifest',
    'songbooks/index.json',
    'images/icon.svg',
    'images/icon-192.png',
    'images/icon-512.png',
    'images/icon.PNG',
    'images/ukulele-krakow-trans-light.png',
    'images/ukulele-krakow-trans-dark.png'
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(SHELL).then(function (c) {
            return c.addAll(CORE).catch(function () { /* tolerate a missing optional asset */ });
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) {
                if (k !== SHELL && k !== RUNTIME) return caches.delete(k);
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

function isSameOriginGet(req) {
    if (req.method !== 'GET') return false;
    var url = new URL(req.url);
    return url.origin === self.location.origin;
}

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (!isSameOriginGet(req)) return;

    // Navigations: network-first so deploys are picked up, cache fallback offline.
    if (req.mode === 'navigate') {
        e.respondWith(
            fetch(req).then(function (res) {
                var copy = res.clone();
                caches.open(SHELL).then(function (c) { c.put('index.html', copy); });
                return res;
            }).catch(function () {
                return caches.match('index.html').then(function (r) { return r || caches.match('./'); });
            })
        );
        return;
    }

    // Everything else same-origin: stale-while-revalidate.
    e.respondWith(
        caches.match(req).then(function (cached) {
            var network = fetch(req).then(function (res) {
                if (res && res.ok) {
                    var copy = res.clone();
                    caches.open(RUNTIME).then(function (c) { c.put(req, copy); });
                }
                return res;
            }).catch(function () { return cached; });
            return cached || network;
        })
    );
});
