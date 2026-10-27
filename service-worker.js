'use strict';
// Minimal safe PWA service worker: does not cache authenticated pages or API data.
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
