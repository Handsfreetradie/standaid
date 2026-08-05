/// <reference lib="webworker" />
// Single service worker for StandAId: precaches the app shell (so the
// PWA installs/updates correctly) and caches recently-viewed standard
// PDFs for offline access on site. Previously these were two separate
// service worker files that both claimed the "/sw.js" filename — the
// PWA build step silently overwrote the PDF one on every deploy, and
// its aggressive app-shell precaching meant phones kept running old
// cached JS after a release. One file, one source of truth.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { clientsClaim } from "workbox-core";

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/~oauth/],
  }),
);

// Offline PDF access — cache the last 10 standards viewed, refreshing
// from the network first so an update to a standard's PDF isn't stuck
// stale, but falling back to the cached copy when offline on site.
registerRoute(
  ({ url }) => url.hostname.includes("supabase.co") && url.pathname.includes(".pdf"),
  new NetworkFirst({
    cacheName: "standaid-pdfs-v1",
    plugins: [new ExpirationPlugin({ maxEntries: 10 })],
  }),
);
