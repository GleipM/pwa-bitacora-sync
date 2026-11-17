# pwa-bitacora-sync

PWA de **Bitácora de Mantenimiento**: registro de órdenes de servicio que funciona sin conexión (Temas 5.1 – 5.3).

- **idb-store.js** – capa de IndexedDB envuelta en Promesas (`conectarBD`, `insertarOrden`, `listarOrdenes`, `listarPorEstado`, `marcarOrden`, `borrarOrden`), con índice `por_estado`.
- **main.js** – interfaz, envío con respaldo local (patrón Outbox), registro de la etiqueta `sync-ordenes`, recepción de mensajes del SW y reenvío por evento `online` en navegadores sin `SyncManager`.
- **service-worker.js** – App Shell en Cache API (`bitacora-shell-v1`) con estrategia *Stale-While-Revalidate* y vaciado de la cola en segundo plano (evento `sync`).

Cada orden guarda equipo, prioridad (baja/media/alta), observaciones, estado (`en-espera` / `enviada`), fechas y número de intentos.

100% JavaScript Vanilla, sin librerías; la asincronía se resuelve solo con `new Promise()`, `.then()`, `.catch()` y `Promise.all()`.
