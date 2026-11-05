// Network-first: online sempre pega a versão nova; offline usa a última cópia salva.
// Só arquivos do próprio site; chamadas externas (API do BCB) passam direto.
// Cada página carregada online zera o cache e regrava só os arquivos dessa versão
// (o Vite muda o nome dos .js/.css a cada build; sem isso os antigos ficariam para sempre).
const CACHE = 'utilidades';

// Fila: garante que a limpeza termina antes de gravar os arquivos da página nova.
let queue = Promise.resolve();
const enqueue = (task) => (queue = queue.then(task).catch(() => {}));

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          if (req.mode === 'navigate') enqueue(() => caches.delete(CACHE));
          e.waitUntil(enqueue(() => caches.open(CACHE).then((c) => c.put(req, copy))));
        }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) ?? (await caches.match('./')) ?? Response.error()),
  );
});
