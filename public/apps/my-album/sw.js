"use strict";

const SHELL_CACHE_PREFIX = "my-album-shell-";
const SHELL_CACHE_NAME = `${SHELL_CACHE_PREFIX}v5`;
const SHELL_FILES = [
  "./index.html",
  "./styles.css?v=lan-api-5",
  "./app.js?v=lan-api-5",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL("./index.html", self.registration.scope))),
    );
    return;
  }

  if (request.destination === "script" || request.destination === "style") {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});
