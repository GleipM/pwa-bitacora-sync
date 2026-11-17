// main.js
// Interfaz, envío con respaldo local (patrón Outbox), Background Sync y respaldo por evento 'online'.
// Asincronía únicamente con new Promise(), .then(), .catch() y Promise.all().

const API_URL = 'https://jsonplaceholder.typicode.com/posts';
const ETIQUETA_SYNC = 'sync-ordenes';

const formOrden = document.getElementById('form-orden');
const campoEquipo = document.getElementById('equipo');
const campoPrioridad = document.getElementById('prioridad');
const campoObservaciones = document.getElementById('observaciones');
const listaCola = document.getElementById('lista-cola');
const btnLimpiar = document.getElementById('btn-limpiar');
const indicadorConexion = document.getElementById('indicador-conexion');
const contadorPendientes = document.getElementById('contador-pendientes');
const contadorEnviadas = document.getElementById('contador-enviadas');

// ---------------------------------------------------------------------------
// Service Worker: registro y escucha de mensajes
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (evento) => {
    if (evento.data && evento.data.tipo === 'COLA_ENVIADA') {
      console.log(`[UI] El SW envió ${evento.data.total} orden(es). Refrescando cola...`);
      pintarCola();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then((registro) => console.log('[SW] Activo en scope:', registro.scope))
      .catch((error) => console.error('[SW] Falló el registro:', error));
  });
}

// ---------------------------------------------------------------------------
// Estado de conexión
// ---------------------------------------------------------------------------
function refrescarIndicador() {
  const enLinea = navigator.onLine;
  indicadorConexion.textContent = enLinea ? 'Conectado' : 'Desconectado';
  indicadorConexion.className = `pill ${enLinea ? 'conectado' : 'desconectado'}`;
}

// ---------------------------------------------------------------------------
// READ: pinta la cola guardada en IndexedDB
// ---------------------------------------------------------------------------
function fechaCorta(ms) {
  return new Date(ms).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function crearElementoOrden(orden) {
  const li = document.createElement('li');
  li.className = `orden ${orden.estado}`;

  const cuerpo = document.createElement('div');
  cuerpo.className = 'orden-cuerpo';

  const titulo = document.createElement('strong');
  titulo.textContent = `OS-${String(orden.id).padStart(4, '0')} · ${orden.equipo}`;

  const detalle = document.createElement('small');
  detalle.textContent = `Registrada ${fechaCorta(orden.creadaEn)}`;
  if (orden.enviadaEn) detalle.textContent += ` · Enviada ${fechaCorta(orden.enviadaEn)}`;

  cuerpo.appendChild(titulo);
  cuerpo.appendChild(detalle);

  const etiquetas = document.createElement('div');
  etiquetas.className = 'orden-etiquetas';

  const prioridad = document.createElement('span');
  prioridad.className = `tag prioridad-${orden.prioridad}`;
  prioridad.textContent = orden.prioridad;

  const estado = document.createElement('span');
  estado.className = `tag estado-${orden.estado}`;
  estado.textContent = orden.estado === 'en-espera' ? 'en espera' : 'enviada';

  etiquetas.appendChild(prioridad);
  etiquetas.appendChild(estado);

  li.appendChild(cuerpo);
  li.appendChild(etiquetas);
  return li;
}

function pintarCola() {
  return listarOrdenes()
    .then((ordenes) => {
      listaCola.innerHTML = '';

      const enEspera = ordenes.filter((o) => o.estado === 'en-espera').length;
      contadorPendientes.textContent = `${enEspera} en espera`;
      contadorEnviadas.textContent = `${ordenes.length - enEspera} enviadas`;

      if (ordenes.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'sin-ordenes';
        vacio.textContent = 'No hay órdenes registradas todavía.';
        listaCola.appendChild(vacio);
        return;
      }

      ordenes
        .sort((a, b) => b.creadaEn - a.creadaEn)
        .forEach((orden) => listaCola.appendChild(crearElementoOrden(orden)));
    })
    .catch((error) => console.error('[Cola] No se pudo leer IndexedDB:', error));
}

// ---------------------------------------------------------------------------
// CREATE: intenta enviar; si falla, guarda en la cola y agenda Background Sync
// ---------------------------------------------------------------------------
function agendarSincronizacion() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    return navigator.serviceWorker.ready
      .then((registro) => {
        console.log(`[Cola] Agendando etiqueta "${ETIQUETA_SYNC}"...`);
        return registro.sync.register(ETIQUETA_SYNC);
      });
  }
  console.log('[Cola] Background Sync no disponible: se usará el evento online.');
  return Promise.resolve();
}

function enviarAlServidor(orden) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `[${orden.prioridad.toUpperCase()}] ${orden.equipo}`,
      body: orden.observaciones
    })
  }).then((respuesta) => {
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    return respuesta.json();
  });
}

function registrarOrden(datos) {
  const ahora = Date.now();

  return enviarAlServidor(datos)
    .then(() => insertarOrden({ ...datos, estado: 'enviada', creadaEn: ahora, enviadaEn: Date.now(), intentos: 1 }))
    .catch(() => {
      console.warn('[Cola] Envío fallido. Guardando orden en IndexedDB...');
      return insertarOrden({ ...datos, estado: 'en-espera', creadaEn: ahora, intentos: 0 })
        .then(() => agendarSincronizacion())
        .catch((error) => console.error('[Cola] No se pudo agendar la sincronización:', error));
    })
    .then(() => pintarCola());
}

// ---------------------------------------------------------------------------
// UPDATE (respaldo): reenvío desde la página cuando no existe SyncManager
// ---------------------------------------------------------------------------
function reenviarDesdePagina() {
  console.log('[Cola] Red recuperada. Revisando órdenes en espera...');

  return listarPorEstado('en-espera')
    .then((pendientes) => {
      if (pendientes.length === 0) {
        console.log('[Cola] Nada que reenviar.');
        return;
      }
      return Promise.all(
        pendientes.map((orden) => enviarAlServidor(orden).then(() => marcarOrden(orden.id, 'enviada')))
      );
    })
    .then(() => pintarCola())
    .catch((error) => console.error('[Cola] Error en el reenvío:', error));
}

// ---------------------------------------------------------------------------
// Eventos de red: solo reenvía la página si el SW no puede hacerlo
// ---------------------------------------------------------------------------
window.addEventListener('online', () => {
  refrescarIndicador();
  if (!('SyncManager' in window)) reenviarDesdePagina();
});

window.addEventListener('offline', refrescarIndicador);

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------
formOrden.addEventListener('submit', (evento) => {
  evento.preventDefault();

  const datos = {
    equipo: campoEquipo.value.trim(),
    prioridad: campoPrioridad.value,
    observaciones: campoObservaciones.value.trim()
  };

  if (!datos.equipo || !datos.observaciones) return;

  formOrden.reset();
  registrarOrden(datos).catch((error) => console.error('[Cola] Error al registrar:', error));
});

// ---------------------------------------------------------------------------
// DELETE: limpia las órdenes ya enviadas
// ---------------------------------------------------------------------------
btnLimpiar.addEventListener('click', () => {
  listarPorEstado('enviada')
    .then((enviadas) => Promise.all(enviadas.map((orden) => borrarOrden(orden.id))))
    .then((borradas) => {
      console.log(`[Cola] ${borradas.length} orden(es) eliminada(s).`);
      return pintarCola();
    })
    .catch((error) => console.error('[Cola] Error al limpiar:', error));
});

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
refrescarIndicador();
pintarCola().then(() => {
  if (navigator.onLine && !('SyncManager' in window)) reenviarDesdePagina();
});
