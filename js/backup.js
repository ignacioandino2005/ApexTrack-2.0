// ApexTrack — copia automática en Google Drive (a través de un Apps Script propio del usuario)
// y recuperación de datos (Drive, fotos diarias internas, archivo .json).
import { todayISO, esc, fmt } from './util.js';
import * as store from './store.js';

export const SCRIPT_CODE = `// ApexTrack — copia automática en tu Google Drive
// 1) Cambiá la clave de abajo por una palabra secreta tuya (la misma que vas a poner en la app).
const CLAVE = 'CAMBIAME-por-una-clave-secreta';
const CARPETA = 'ApexTrack copias';
const ARCHIVO = 'ApexTrack_copia_automatica.json';
const ANTERIOR = 'ApexTrack_copia_dia_anterior.json';

function carpeta_() {
  const it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}
function archivo_(nombre) {
  const it = carpeta_().getFilesByName(nombre);
  return it.hasNext() ? it.next() : null;
}
function respuesta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.clave !== CLAVE) return respuesta_({ ok: false, error: 'clave' });
    const texto = JSON.stringify(body.datos);
    let f = archivo_(ARCHIVO);
    if (f) {
      // una vez por día se guarda también la copia del día anterior
      const hoy = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
      const dia = Utilities.formatDate(f.getLastUpdated(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd');
      if (dia !== hoy) {
        const prev = archivo_(ANTERIOR);
        if (prev) prev.setContent(f.getBlob().getDataAsString()); else carpeta_().createFile(ANTERIOR, f.getBlob().getDataAsString(), 'application/json');
      }
      f.setContent(texto);
    } else {
      f = carpeta_().createFile(ARCHIVO, texto, 'application/json');
    }
    return respuesta_({ ok: true, bytes: texto.length, fecha: new Date().toISOString() });
  } catch (err) {
    return respuesta_({ ok: false, error: String(err) });
  }
}
function doGet(e) {
  if ((e.parameter || {}).clave !== CLAVE) return respuesta_({ ok: false, error: 'clave' });
  const nombre = (e.parameter || {}).cual === 'anterior' ? ANTERIOR : ARCHIVO;
  const f = archivo_(nombre);
  if (!f) return respuesta_({ ok: false, error: 'sin copia' });
  return respuesta_({ ok: true, fecha: f.getLastUpdated().toISOString(), datos: JSON.parse(f.getBlob().getDataAsString()) });
}
`;

const B = () => store.S().settings.backup;
const MIN_GAP = 3 * 3600000; // como mucho una subida cada 3 horas (y siempre al menos una por día)

function payload() {
  const S = JSON.parse(JSON.stringify(store.S()));
  S.settings.ai.key = ''; // la clave de la IA no sale del teléfono
  S.settings.backup.cloudToken = '';
  return S;
}

/** Sube la copia. force: aunque no haya cambios o haya pasado poco tiempo. */
export async function cloudPush({ force = false } = {}) {
  const b = B();
  if (!b.cloudUrl || !b.cloudToken) return { ok: false, skipped: 'sin configurar' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, skipped: 'sin conexión' };
  const data = store.S();
  if (!force) {
    const newDay = !b.lastCloudAt || new Date(b.lastCloudAt).toLocaleDateString('sv-SE') !== todayISO();
    const changed = (data.updatedAt || 0) > (b.lastCloudAt || 0);
    if (!newDay && (!changed || Date.now() - (b.lastCloudAt || 0) < MIN_GAP)) return { ok: true, skipped: 'al día' };
    if (store.richness(data) < 3) return { ok: false, skipped: 'sin datos' }; // nunca subir un estado vacío encima de la copia
  }
  try {
    const r = await fetch(b.cloudUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ clave: b.cloudToken, datos: payload() }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error === 'clave' ? 'La clave no coincide con la del script' : (j.error || 'Error del script'));
    b.lastCloudAt = Date.now(); b.lastCloudError = '';
    store.save();
    return { ok: true, bytes: j.bytes };
  } catch (e) {
    b.lastCloudError = String(e.message || e).slice(0, 160);
    store.save();
    return { ok: false, error: b.lastCloudError };
  }
}

export async function cloudPull(cual = 'ultima') {
  const b = B();
  if (!b.cloudUrl || !b.cloudToken) throw new Error('La copia en Drive no está configurada.');
  const url = `${b.cloudUrl}${b.cloudUrl.includes('?') ? '&' : '?'}clave=${encodeURIComponent(b.cloudToken)}${cual === 'anterior' ? '&cual=anterior' : ''}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error === 'clave' ? 'La clave no coincide con la del script.' : j.error === 'sin copia' ? 'Todavía no hay ninguna copia en Drive.' : (j.error || 'No se pudo leer la copia.'));
  return { fecha: j.fecha, data: j.datos };
}

/** Programa la copia: al abrir, al volver a la app y cada 30 min mientras está abierta. */
export function scheduleCloud() {
  const tick = () => { cloudPush().catch(() => {}); };
  setTimeout(tick, 8000);
  setInterval(tick, 30 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick(); });
}

export function describe(d) {
  const items = (d.entries || []).reduce((n, e) => n + (e.items || []).length, 0);
  const dates = (d.entries || []).map((e) => e.date).sort();
  return `${fmt(items)} alimentos${dates.length ? ` del ${dates[0].split('-').reverse().join('/')} al ${dates[dates.length - 1].split('-').reverse().join('/')}` : ''}, ${(d.body || []).length} pesajes`;
}
export { esc };
