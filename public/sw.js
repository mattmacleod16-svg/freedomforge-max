const CACHE_NAME = 'freedomforge-v5';
const PRECACHE = [
  '/',
  '/manifest.json',
  '/freedomforge-icon-192.png',
  '/freedomforge-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // For API mutations (non-GET), handle offline queueing
  if (request.method !== 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(async (err) => {
          // Network error on mutation — queue for later replay
          console.log('[SW] Mutation failed, queuing for replay:', request.method, url.pathname);
          try {
            // Queue request to IndexedDB for later replay
            const payload = await request.clone().json().catch(() => null);
            const queueEntry = {
              id: crypto.randomUUID(),
              endpoint: url.pathname,
              method: request.method,
              payload,
              timestamp: Date.now(),
              attemptCount: 0,
              maxAttempts: 5,
            };
            
            // Store in IndexedDB via client-side hook
            // (Client will handle actual DB writing via postMessage)
            self.clients.matchAll().then((clients) => {
              clients.forEach((client) => {
                client.postMessage({
                  type: 'QUEUE_MUTATION',
                  data: queueEntry,
                });
              });
            });
          } catch (e) {
            console.error('[SW] Failed to queue mutation:', e);
          }
          
          // Return 503 response
          return new Response(
            JSON.stringify({ error: 'offline', queued: true }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        })
    );
    return;
  }

  // Skip other API requests
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Network-first for HTML pages
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.match(/\.(png|jpg|svg|js|css|woff2?)$/) || url.pathname === '/manifest.json')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// Listen for sync messages from client
self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'SYNC_QUEUE') {
    console.log('[SW] Received SYNC_QUEUE message');
    try {
      const response = await fetch('/api/sync/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      // Notify client of sync result
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'QUEUE_SYNCED', result });
        });
      });
    } catch (e) {
      console.error('[SW] Queue sync failed:', e);
    }
  }
});
