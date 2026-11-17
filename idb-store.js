// idb-store.js
// Capa de acceso a IndexedDB envuelta en Promesas (Vanilla JS).
// La usan main.js (vía <script>) y service-worker.js (vía importScripts).

const NOMBRE_BD = 'bitacora-sync-db';
const VERSION_BD = 1;
const ALMACEN = 'ordenes_servicio';

// Abre la base de datos y crea el almacén si no existe
function conectarBD() {
  return new Promise((resolve, reject) => {
    const solicitud = indexedDB.open(NOMBRE_BD, VERSION_BD);

    // onupgradeneeded corre solo al crear la BD o al subir VERSION_BD:
    // es el único momento en que se permite modificar el esquema.
    solicitud.onupgradeneeded = (evento) => {
      const bd = evento.target.result;
      if (!bd.objectStoreNames.contains(ALMACEN)) {
        const almacen = bd.createObjectStore(ALMACEN, { keyPath: 'id', autoIncrement: true });
        almacen.createIndex('por_estado', 'estado', { unique: false });
      }
    };

    solicitud.onsuccess = (evento) => resolve(evento.target.result);
    solicitud.onerror = (evento) => reject(evento.target.error);
  });
}

// CREATE: inserta una orden y resuelve con su id cuando la transacción se confirma
function insertarOrden(orden) {
  return conectarBD().then((bd) => {
    return new Promise((resolve, reject) => {
      const tx = bd.transaction(ALMACEN, 'readwrite');
      const peticion = tx.objectStore(ALMACEN).add(orden);
      let nuevoId;

      peticion.onsuccess = (evento) => { nuevoId = evento.target.result; };

      tx.oncomplete = () => resolve(nuevoId);
      tx.onerror = (evento) => reject(evento.target.error);
    });
  });
}

// READ: devuelve todas las órdenes guardadas
function listarOrdenes() {
  return conectarBD().then((bd) => {
    return new Promise((resolve, reject) => {
      const tx = bd.transaction(ALMACEN, 'readonly');
      const peticion = tx.objectStore(ALMACEN).getAll();

      peticion.onsuccess = (evento) => resolve(evento.target.result);
      peticion.onerror = (evento) => reject(evento.target.error);
    });
  });
}

// READ por índice: solo las órdenes con un estado concreto
function listarPorEstado(estado) {
  return conectarBD().then((bd) => {
    return new Promise((resolve, reject) => {
      const tx = bd.transaction(ALMACEN, 'readonly');
      const indice = tx.objectStore(ALMACEN).index('por_estado');
      const peticion = indice.getAll(estado);

      peticion.onsuccess = (evento) => resolve(evento.target.result);
      peticion.onerror = (evento) => reject(evento.target.error);
    });
  });
}

// UPDATE: lee y reescribe la orden dentro de la misma transacción
function marcarOrden(id, estado) {
  return conectarBD().then((bd) => {
    return new Promise((resolve, reject) => {
      const tx = bd.transaction(ALMACEN, 'readwrite');
      const almacen = tx.objectStore(ALMACEN);
      const lectura = almacen.get(id);

      lectura.onsuccess = (evento) => {
        const orden = evento.target.result;
        if (!orden) {
          reject(new Error(`La orden ${id} no existe`));
          return;
        }
        orden.estado = estado;
        orden.enviadaEn = Date.now();
        orden.intentos = (orden.intentos || 0) + 1;
        almacen.put(orden);
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = (evento) => reject(evento.target.error);
    });
  });
}

// DELETE: elimina una orden por su llave primaria
function borrarOrden(id) {
  return conectarBD().then((bd) => {
    return new Promise((resolve, reject) => {
      const tx = bd.transaction(ALMACEN, 'readwrite');
      tx.objectStore(ALMACEN).delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (evento) => reject(evento.target.error);
    });
  });
}
