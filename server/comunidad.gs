// ApexTrack — servicio de aprendizaje compartido de la IA propia.
// Lo instala UNA sola vez el desarrollador (no cada persona que usa la app). Pasos en dev/SERVIDOR.md.
//
// Recibe aportes anónimos (doPost) y los guarda en la planilla:
//   · hoja "aportes":  un alimento por fila (lo que dijo la persona y lo que entendió Gemini)
//   · hoja "mensajes": el mensaje completo y su resultado (datos para entrenar un modelo propio más adelante)
// Devuelve el conocimiento acumulado (doGet ?op=conocimiento): alimentos con sus valores por 100 g
// (mediana de todos los aportes), medidas caseras y las frases con que se los nombra.

const MIN_PERSONAS = 1;      // personas distintas que tienen que coincidir para publicar un alimento (subirlo a 2-3 con más usuarios)
const MAX_ALIMENTOS = 3000;
const REARMAR_CADA_H = 12;   // el conocimiento se rearma como mucho cada 12 horas
const ARCHIVO = 'ApexTrack_conocimiento.json';

const COL_APORTES = ['fecha', 'instalacion', 'version', 'dicho', 'alimento_dicho', 'nombre', 'cantidad', 'unidad', 'gramos', 'liquido', 'estado', 'base', 'confianza', 'editado', 'kcal', 'prot', 'carb', 'grasa', 'azucar', 'fibra', 'alcohol', 'ingredientes', 'modelo'];
const COL_MENSAJES = ['fecha', 'instalacion', 'version', 'mensaje', 'resultado', 'agua', 'habitos', 'gym', 'modelo'];

function hoja_(nombre, columnas) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(nombre);
  if (!h) { h = ss.insertSheet(nombre); h.appendRow(columnas); h.setFrozenRows(1); }
  return h;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
const num_ = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : ''; };
const txt_ = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
function norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Recibir aportes
// ---------------------------------------------------------------------------
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'json' }); }
  if (!body || body.v !== 1 || !Array.isArray(body.records)) return json_({ ok: false, error: 'formato' });
  const inst = txt_(body.install, 40);
  const ver = txt_(body.app, 12);
  const ahora = new Date();
  const items = []; const msgs = [];
  for (const r of body.records.slice(0, 100)) {
    if (!r || typeof r !== 'object') continue;
    if (r.t === 'item') {
      const kcal = num_(r.k, 900);
      if (kcal === '' || !txt_(r.name, 100).trim()) continue;
      items.push([ahora, inst, ver, txt_(r.said, 120), txt_(r.food, 80), txt_(r.name, 100), num_(r.qty, 10000), txt_(r.unit, 12), num_(r.grams, 5000), r.liq ? 1 : 0, txt_(r.state, 10), txt_(r.basis, 12), txt_(r.conf, 6), r.edited ? 1 : 0,
        kcal, num_(r.p, 100), num_(r.c, 100), num_(r.f, 100), num_(r.s, 100), num_(r.fb, 100), num_(r.al, 100), num_(r.ing, 50), txt_(r.model, 40)]);
    } else if (r.t === 'msg') {
      msgs.push([ahora, inst, ver, txt_(r.text, 1000), txt_(JSON.stringify(r.items || []), 20000), num_(r.water, 50), num_(r.habits, 50), num_(r.gym, 50), txt_(r.model, 40)]);
    }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (items.length) { const h = hoja_('aportes', COL_APORTES); h.getRange(h.getLastRow() + 1, 1, items.length, COL_APORTES.length).setValues(items); }
    if (msgs.length) { const h = hoja_('mensajes', COL_MENSAJES); h.getRange(h.getLastRow() + 1, 1, msgs.length, COL_MENSAJES.length).setValues(msgs); }
  } finally { lock.releaseLock(); }
  return json_({ ok: true, items: items.length, mensajes: msgs.length });
}

// ---------------------------------------------------------------------------
// Entregar el conocimiento
// ---------------------------------------------------------------------------
function doGet(e) {
  const op = (e && e.parameter && e.parameter.op) || 'conocimiento';
  if (op === 'estado') {
    const a = hoja_('aportes', COL_APORTES); const m = hoja_('mensajes', COL_MENSAJES);
    return json_({ ok: true, aportes: Math.max(0, a.getLastRow() - 1), mensajes: Math.max(0, m.getLastRow() - 1) });
  }
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('archivo');
  const at = Number(props.getProperty('armado') || 0);
  let texto = null;
  if (id && Date.now() - at < REARMAR_CADA_H * 3600000) { try { texto = DriveApp.getFileById(id).getBlob().getDataAsString(); } catch (err) { texto = null; } }
  if (!texto) texto = rearmar();
  return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.JSON);
}

const mediana_ = (a) => { const s = a.filter((x) => x !== '' && Number.isFinite(Number(x))).map(Number).sort((x, y) => x - y); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1_ = (n) => Math.round(n * 10) / 10;

/** Junta todos los aportes y guarda el conocimiento en un archivo de Drive. También se puede correr a mano. */
function rearmar() {
  const h = hoja_('aportes', COL_APORTES);
  const filas = h.getLastRow() > 1 ? h.getRange(2, 1, h.getLastRow() - 1, COL_APORTES.length).getValues() : [];
  const C = {}; COL_APORTES.forEach((c, i) => { C[c] = i; });
  const grupos = {};
  const frases = {};
  const personas = new Set();
  for (const f of filas) {
    const clave = norm_(f[C.nombre]);
    if (clave.length < 2) continue;
    const peso = f[C.editado] ? 2 : 1; // lo que la persona corrigió vale el doble
    const g = grupos[clave] || (grupos[clave] = { nombres: {}, inst: new Set(), k: [], p: [], c: [], f: [], s: [], fb: [], al: [], unidades: {}, liq: 0, n: 0, frases: {} });
    g.nombres[f[C.nombre]] = (g.nombres[f[C.nombre]] || 0) + 1;
    g.inst.add(f[C.instalacion]); personas.add(f[C.instalacion]);
    for (let i = 0; i < peso; i++) {
      g.k.push(f[C.kcal]); g.p.push(f[C.prot]); g.c.push(f[C.carb]); g.f.push(f[C.grasa]); g.s.push(f[C.azucar]); g.fb.push(f[C.fibra]); g.al.push(f[C.alcohol]);
    }
    g.liq += f[C.liquido] ? 1 : 0; g.n++;
    const u = String(f[C.unidad] || '');
    const q = Number(f[C.cantidad]); const gr = Number(f[C.gramos]);
    if (u && u !== 'g' && u !== 'ml' && q > 0 && gr > 0 && gr / q <= 2000) (g.unidades[u] = g.unidades[u] || []).push(gr / q);
    const dicho = norm_(f[C.alimento_dicho]);
    if (dicho.length >= 3 && dicho.length <= 60) {
      g.frases[dicho] = (g.frases[dicho] || 0) + 1;
      (frases[dicho] = frases[dicho] || {})[clave] = ((frases[dicho] || {})[clave] || 0) + 1;
    }
  }
  const foods = [];
  for (const clave of Object.keys(grupos)) {
    const g = grupos[clave];
    if (g.inst.size < MIN_PERSONAS) continue;
    const per = { k: mediana_(g.k), p: mediana_(g.p), c: mediana_(g.c), f: mediana_(g.f), s: mediana_(g.s), fb: mediana_(g.fb), al: mediana_(g.al) };
    const atw = 4 * per.p + 4 * per.c + 9 * per.f + 2 * per.fb + 7 * per.al;
    if (atw > 0 && Math.abs(per.k - atw) > Math.max(15, 0.25 * Math.max(per.k, atw))) per.k = atw; // incoherente: manda la suma de macros
    if (per.k > 900 || per.p + per.c + per.f + per.fb + per.al > 105) continue;
    const u = {};
    for (const un of Object.keys(g.unidades)) u[un] = r1_(mediana_(g.unidades[un]));
    const nombre = Object.keys(g.nombres).sort((a, b) => g.nombres[b] - g.nombres[a])[0];
    const alias = Object.keys(g.frases).sort((a, b) => g.frases[b] - g.frases[a]).filter((x) => x !== clave).slice(0, 10);
    foods.push({ id: 'com_' + clave.replace(/ /g, '_').slice(0, 40), n: nombre, a: [clave].concat(alias), k: r1_(per.k), p: r1_(per.p), c: r1_(per.c), f: r1_(per.f), s: r1_(Math.min(per.s, per.c)), fb: r1_(per.fb), al: r1_(per.al), u: u, liq: g.liq * 2 > g.n ? 1 : 0, users: g.inst.size, veces: g.n });
  }
  foods.sort((a, b) => b.users - a.users || b.veces - a.veces);
  const publicados = foods.slice(0, MAX_ALIMENTOS);
  const ids = new Set(publicados.map((x) => x.id));
  // frase → alimento, solo si casi siempre significa lo mismo
  const mapa = {};
  for (const dicho of Object.keys(frases)) {
    const op = frases[dicho]; const tot = Object.values(op).reduce((a, b) => a + b, 0);
    const mejor = Object.keys(op).sort((a, b) => op[b] - op[a])[0];
    const id = 'com_' + mejor.replace(/ /g, '_').slice(0, 40);
    if (op[mejor] / tot >= 0.6 && op[mejor] >= MIN_PERSONAS && ids.has(id)) mapa[dicho] = id;
  }
  const out = JSON.stringify({ ok: true, at: new Date().toISOString(), users: personas.size, records: filas.length, foods: publicados.map((x) => { const y = Object.assign({}, x); delete y.veces; return y; }), phrases: mapa });
  const props = PropertiesService.getScriptProperties();
  let file = null;
  const id = props.getProperty('archivo');
  if (id) { try { file = DriveApp.getFileById(id); file.setContent(out); } catch (err) { file = null; } }
  if (!file) { file = DriveApp.createFile(ARCHIVO, out, 'application/json'); props.setProperty('archivo', file.getId()); }
  props.setProperty('armado', String(Date.now()));
  return out;
}

/** Correlo una vez a mano: crea las hojas y un disparador que rearma el conocimiento cada noche. */
function instalar() {
  hoja_('aportes', COL_APORTES);
  hoja_('mensajes', COL_MENSAJES);
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'rearmar').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('rearmar').timeBased().everyDays(1).atHour(4).create();
  rearmar();
}
