// service-worker.js
// Caché del App Shell + sincronización en segundo plano de la cola de órdenes.
// Asincronía únicamente con new Promise(), .then(), .catch() y Promise.all().

importScripts('./idb-store.js');

const VERSION_CACHE = 'bitacora-shell-v1';
const ARCHIVOS_SHELL = [
  './',
  './index.html',
  './styles.css',
  './idb-store.js',
  './main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const API_URL = 'https://jsonplaceholder.typicode.com/posts';
const ETIQUETA_SYNC = 'sync-ordenes';

// ---------------------------------------------------------------------------
// Instalación y activación
// ---------------------------------------------------------------------------
self.addEventListener('install', (evento) => {
  console.log('[SW] Instalando', VERSION_CACHE);
  evento.waitUntil(
    caches.open(VERSION_CACHE)
      .then((cache) => cache.addAll(ARCHIVOS_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  console.log('[SW] Activando', VERSION_CACHE);
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((clave) => clave !== VERSION_CACHE).map((clave) => caches.delete(clave))
      ))
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch: Stale-While-Revalidate para recursos GET del mismo origen.
// Responde rápido desde caché y actualiza la copia en segundo plano.
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET' || new URL(peticion.url).origin !== self.location.origin) return;

  evento.respondWith(
    caches.open(VERSION_CACHE).then((cache) => {
      return cache.match(peticion, { ignoreSearch: true }).then((enCache) => {
        const desdeRed = fetch(peticion)
          .then((respuesta) => {
            if (respuesta && respuesta.ok) cache.put(peticion, respuesta.clone());
            return respuesta;
          })
          .catch(() => {
            if (enCache) return enCache;
            if (peticion.mode === 'navigate') return cache.match('./index.html');
            return new Response('', { status: 503, statusText: 'Sin conexión' });
          });

        return enCache || desdeRed;
      });
    })
  );
});

// ---------------------------------------------------------------------------
// Aviso a las pestañas abiertas
// ---------------------------------------------------------------------------
function avisarPestanas(total) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((pestanas) => {
      pestanas.forEach((pestana) => pestana.postMessage({ tipo: 'COLA_ENVIADA', total, momento: Date.now() }));
    });
}

// ---------------------------------------------------------------------------
// Vaciado de la cola en segundo plano
// ---------------------------------------------------------------------------
function vaciarCola() {
  console.log('[SW-Sync] Revisando órdenes en espera...');

  return listarPorEstado('en-espera').then((pendientes) => {
    if (pendientes.length === 0) {
      console.log('[SW-Sync] La cola está vacía.');
      return;
    }

    const envios = pendientes.map((orden) => {
      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[${orden.prioridad.toUpperCase()}] ${orden.equipo}`,
          body: orden.observaciones
        })
      }).then((respuesta) => {
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} en la orden ${orden.id}`);
        return marcarOrden(orden.id, 'enviada');
      });
    });

    // Se devuelve la cadena completa para que waitUntil() espere el resultado
    return Promise.all(envios).then(() => avisarPestanas(pendientes.length));
  });
}

// ---------------------------------------------------------------------------
// Evento sync (Background Sync API)
// ---------------------------------------------------------------------------
self.addEventListener('sync', (evento) => {
  console.log('[SW-Sync] Evento sync:', evento.tag);

  if (evento.tag === ETIQUETA_SYNC) {
    evento.waitUntil(
      vaciarCola().catch((error) => {
        console.error('[SW-Sync] Falló el envío; el navegador lo reintentará:', error);
        throw error; // rechazar waitUntil() provoca el reintento automático
      })
    );
  }
});
