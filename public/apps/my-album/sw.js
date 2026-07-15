"use strict";

const SHELL_CACHE_PREFIX = "my-album-shell-";
const SHELL_CACHE_NAME = `${SHELL_CACHE_PREFIX}v26`;
const SHELL_FILES = [
  "./index.html",
  "./styles.css?v=album-ux-26",
  "./app.js?v=album-ux-26",
  "./metadata-worker.js?v=album-ux-26",
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

  if (["script", "style", "worker"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});
