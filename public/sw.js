// Service Worker for offline PDF access. Caches the last 10 PDFs viewed.
// When offline, serves cached PDFs instead of fetching.

const CACHE_NAME = "standaid-pdfs-v1";
const MAX_CACHE_ITEMS = 10;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(cacheNames.map((name) => (name !== CACHE_NAME ? caches.delete(name) : Promise.resolve()))),
    ),
  );
  self.clients.claim();
});

// Intercept fetch requests for PDFs
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only cache PDF fetches from Supabase storage
  if (url.hostname.includes("supabase.co") && url.pathname.includes(".pdf")) {
    event.respondWith(handlePdfFetch(event.request));
  } else {
    // Network-first for everything else
    event.respondWith(networkFirst(event.request));
  }
});

async function handlePdfFetch(request) {
  try {
    // Try network first
    const response = await fetch(request);
    if (response.ok) {
      // Cache successful responses
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, response.clone());
        // Prune old entries if cache is too large
        pruneCache();
      });
      return response;
    }
  } catch {
    // Network failed, try cache
  }

  // Fall back to cache
  const cached = await caches.match(request);
  if (cached) return cached;

  // No cache, return offline page
  return new Response("PDF not available offline. Please check your connection.", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain" },
  });
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("Offline", { status: 503 });
  }
}

async function pruneCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length > MAX_CACHE_ITEMS) {
    // Remove oldest entries
    for (let i = 0; i < keys.length - MAX_CACHE_ITEMS; i++) {
      cache.delete(keys[i]);
    }
  }
}
