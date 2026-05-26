// NutriOPS Service Worker — network-first com cache fallback
// __BUILD_ID__ é substituído no build (scripts/version-sw.js). Em dev fica fixo.
const CACHE = 'nutriops-__BUILD_ID__';

self.addEventListener('install', (e) => {
  // Ativa o novo SW imediatamente, sem esperar a aba fechar.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html'])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Don't intercept Supabase or external API calls — let them fail naturally
  if (!url.origin.includes(self.location.hostname)) return;
  // Don't intercept hot-reload
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules')) return;

  e.respondWith(
    caches.match(e.request).then((cached) =>
      fetch(e.request)
        .then((res) => {
          // Cache successful GET responses for app shell
          if (e.request.method === 'GET' && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached ?? new Response('Offline — NutriOPS está sem conexão', { status: 503 }))
    )
  );
});

// Message from app: force sync
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
