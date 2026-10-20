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
  if (body && body.op === 'avisos') return json_(guardarAvisos_(body));
  if (body && body.op === 'baja') return json_(bajaAvisos_(body));
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
  if (op === 'vapid') {
    const k = PropertiesService.getScriptProperties().getProperty('vapid_pub');
    return json_(k ? { ok: true, key: k } : { ok: false, error: 'Falta correr instalarAvisos()' });
  }
  if (op === 'estado') {
    const a = hoja_('aportes', COL_APORTES); const m = hoja_('mensajes', COL_MENSAJES);
    const av = hoja_('avisos', COL_AVISOS);
    return json_({ ok: true, aportes: Math.max(0, a.getLastRow() - 1), mensajes: Math.max(0, m.getLastRow() - 1), avisos: Math.max(0, av.getLastRow() - 1), avisos_listos: !!PropertiesService.getScriptProperties().getProperty('vapid_pub') });
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

// ===========================================================================
// AVISOS (notificaciones "push" que llegan con la app cerrada)
// ---------------------------------------------------------------------------
// Cada teléfono manda su suscripción y la lista de horarios (próximos 14 días) en que quiere un aviso.
// Cada 5 minutos, enviarAvisos() despierta a los teléfonos que tienen un horario vencido. El push va
// vacío: el propio teléfono decide qué mostrar (por ejemplo, no avisa del almuerzo si ya lo registró).
// La firma VAPID (ECDSA P-256) está implementada acá mismo porque Apps Script no la trae.
// Para activarlo: correr una vez instalarAvisos() y volver a implementar (versión nueva).
// ===========================================================================
const COL_AVISOS = ['id', 'endpoint', 'p256dh', 'auth', 'horarios', 'actualizado', 'ultimo_envio', 'instalacion'];
const CONTACTO = 'mailto:ignacioandino2005@gmail.com';

function guardarAvisos_(body) {
  const sub = body.sub || {};
  const ep = String(sub.endpoint || '');
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(ep) || ep.length > 900) return { ok: false, error: 'suscripcion' };
  const ahora = Date.now();
  const horarios = (Array.isArray(body.times) ? body.times : []).map(Number).filter((t) => t > ahora - 600000 && t < ahora + 16 * 86400000).sort((a, b) => a - b).slice(0, 400);
  const id = hash_(ep);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const h = hoja_('avisos', COL_AVISOS);
    const fila = buscarFila_(h, id);
    const datos = [id, ep, txt_((sub.keys || {}).p256dh, 200), txt_((sub.keys || {}).auth, 100), JSON.stringify(horarios), new Date(), fila ? h.getRange(fila, 7).getValue() : 0, txt_(body.install, 40)];
    if (fila) h.getRange(fila, 1, 1, COL_AVISOS.length).setValues([datos]);
    else h.getRange(h.getLastRow() + 1, 1, 1, COL_AVISOS.length).setValues([datos]);
  } finally { lock.releaseLock(); }
  return { ok: true, horarios: horarios.length };
}
function bajaAvisos_(body) {
  const ep = String((body.sub || {}).endpoint || '');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { const h = hoja_('avisos', COL_AVISOS); const f = buscarFila_(h, hash_(ep)); if (f) h.deleteRow(f); } finally { lock.releaseLock(); }
  return { ok: true };
}
function buscarFila_(h, id) {
  if (h.getLastRow() < 2) return 0;
  const ids = h.getRange(2, 1, h.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).slice(0, 12).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

/** Lo corre el disparador cada 5 minutos. */
function enviarAvisos() {
  const h = hoja_('avisos', COL_AVISOS);
  if (h.getLastRow() < 2) return;
  const ahora = Date.now();
  const filas = h.getRange(2, 1, h.getLastRow() - 1, COL_AVISOS.length).getValues();
  const borrar = [];
  filas.forEach((f, i) => {
    let horarios = [];
    try { horarios = JSON.parse(f[4] || '[]'); } catch (err) { horarios = []; }
    const ultimo = Number(f[6]) || 0;
    // vencidos desde el último envío (los de hace más de 30 minutos ya no sirven)
    const vencidos = horarios.filter((t) => t > ultimo && t <= ahora + 60000 && t > ahora - 30 * 60000);
    if (!vencidos.length) return;
    const r = enviarPush_(f[1]);
    if (r === 404 || r === 410) { borrar.push(i + 2); return; }
    h.getRange(i + 2, 7).setValue(ahora);
    h.getRange(i + 2, 5).setValue(JSON.stringify(horarios.filter((t) => t > ahora)));
  });
  borrar.reverse().forEach((n) => h.deleteRow(n));
}

function enviarPush_(endpoint) {
  const aud = endpoint.match(/^https:\/\/[^/]+/)[0];
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  let jwt = cache.get('jwt_' + aud);
  if (!jwt) { jwt = firmarJwt_(aud, props.getProperty('vapid_priv')); cache.put('jwt_' + aud, jwt, 6 * 3600); }
  const res = UrlFetchApp.fetch(endpoint, {
    method: 'post', payload: '', muteHttpExceptions: true,
    headers: { Authorization: 'vapid t=' + jwt + ', k=' + props.getProperty('vapid_pub'), TTL: '1800', Urgency: 'high' },
  });
  return res.getResponseCode();
}

/** Crea las claves VAPID (una sola vez) y el disparador cada 5 minutos. */
function instalarAvisos() {
  hoja_('avisos', COL_AVISOS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('vapid_priv')) {
    const k = generarClaves_();
    props.setProperty('vapid_priv', k.priv);
    props.setProperty('vapid_pub', k.pub);
  }
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'enviarAvisos').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('enviarAvisos').timeBased().everyMinutes(5).create();
  Logger.log('Clave pública: ' + props.getProperty('vapid_pub'));
}

// ---------------------------------------------------------------------------
// ECDSA P-256 (curva secp256r1) con BigInt
// ---------------------------------------------------------------------------
// Apps Script no acepta números BigInt escritos como 1n: se crean con BigInt().
const K0_ = BigInt(0);
const K1_ = BigInt(1);
const K2_ = BigInt(2);
const K3_ = BigInt(3);
const K4_ = BigInt(4);
const K8_ = BigInt(8);
const K255_ = BigInt(255);
const EC_P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const EC_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const EC_G = [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'), K1_];
const md_ = (a, m) => { const r = a % m; return r < K0_ ? r + m : r; };
function inv_(a, m) {
  let r0 = md_(a, m); let r1 = m; let s0 = K1_; let s1 = K0_;
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return md_(s0, m);
}
function dbl_(pt) {
  const [X, Y, Z] = pt; const p = EC_P;
  if (!Z || !Y) return [K0_, K1_, K0_];
  const delta = Z * Z % p; const gamma = Y * Y % p; const beta = X * gamma % p;
  const alpha = md_(K3_ * (X - delta) * (X + delta), p);
  const X3 = md_(alpha * alpha - K8_ * beta, p);
  const Z3 = md_((Y + Z) * (Y + Z) - gamma - delta, p);
  const Y3 = md_(alpha * (K4_ * beta - X3) - K8_ * gamma * gamma, p);
  return [X3, Y3, Z3];
}
function add_(a, b) {
  const p = EC_P;
  if (!a[2]) return b; if (!b[2]) return a;
  const Z1Z1 = a[2] * a[2] % p; const Z2Z2 = b[2] * b[2] % p;
  const U1 = a[0] * Z2Z2 % p; const U2 = b[0] * Z1Z1 % p;
  const S1 = a[1] * b[2] % p * Z2Z2 % p; const S2 = b[1] * a[2] % p * Z1Z1 % p;
  if (U1 === U2) return S1 === S2 ? dbl_(a) : [K0_, K1_, K0_];
  const H = md_(U2 - U1, p); const I = K4_ * H * H % p; const J = H * I % p; const r = md_(K2_ * (S2 - S1), p); const V = U1 * I % p;
  const X3 = md_(r * r - J - K2_ * V, p);
  const Y3 = md_(r * (V - X3) - K2_ * S1 * J, p);
  const Z3 = md_(((a[2] + b[2]) * (a[2] + b[2]) - Z1Z1 - Z2Z2) * H, p);
  return [X3, Y3, Z3];
}
function mul_(k, pt) {
  let R = [K0_, K1_, K0_];
  for (let i = BigInt(k.toString(2).length - 1); i >= K0_; i--) { R = dbl_(R); if ((k >> i) & K1_) R = add_(R, pt); }
  return R;
}
function afin_(pt) { const zi = inv_(pt[2], EC_P); const zi2 = zi * zi % EC_P; return [pt[0] * zi2 % EC_P, pt[1] * zi2 % EC_P * zi % EC_P]; }
function aBytes_(n, len) { const out = []; for (let i = len - 1; i >= 0; i--) out[i] = Number((n >> BigInt(8 * (len - 1 - i))) & K255_); return out; }
function deBytes_(b) { let n = K0_; for (const x of b) n = (n << K8_) + BigInt((x + 256) % 256); return n; }
const b64u_ = (bytes) => Utilities.base64EncodeWebSafe(bytes.map((x) => (x > 127 ? x - 256 : x))).replace(/=+$/, '');
function azar_() {
  const semilla = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random();
  return md_(deBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, semilla)), EC_N - K1_) + K1_;
}
function generarClaves_() {
  const d = azar_();
  const [x, y] = afin_(mul_(d, EC_G));
  return { priv: d.toString(16), pub: b64u_([4].concat(aBytes_(x, 32), aBytes_(y, 32))) };
}
function firmarJwt_(aud, privHex) {
  const enc = (o) => b64u_(Utilities.newBlob(JSON.stringify(o)).getBytes().map((x) => (x + 256) % 256));
  const datos = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACTO });
  const e = deBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, datos));
  const d = BigInt('0x' + privHex);
  for (;;) {
    const k = azar_();
    const r = md_(afin_(mul_(k, EC_G))[0], EC_N);
    if (!r) continue;
    const s = md_(inv_(k, EC_N) * (e + r * d), EC_N);
    if (!s) continue;
    return datos + '.' + b64u_(aBytes_(r, 32).concat(aBytes_(s, 32)));
  }
}
