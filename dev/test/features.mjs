// Funciones de la 2.5: pestañas nuevas y flechita, recordatorios (service worker real), resumen
// semanal con IA simulada, capturas compartidas del reloj y accesos directos.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('../..');
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(req.method === 'POST' ? 405 : 404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8766);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR', timezoneId: 'America/Argentina/San_Juan' });
await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8766' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push service|AbortError|Registration failed/i.test(m.text())) errors.push('console: ' + m.text()); });
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
const val = (fn, a) => page.evaluate(fn, a);
const shot = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${n}.png` }); };
const sheetTop = () => page.locator('.sheet-wrap').last();
const closeSheet = async () => { await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(300); };

// configuración de prueba: servidor de la comunidad simulado
await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = '';\nexport const COMMUNITY_URL = 'https://comunidad.test/exec';\n" }));
const comm = { posts: [] };
await ctx.route('https://comunidad.test/**', (r) => {
  const q = r.request();
  if (q.method() === 'POST') { const b = JSON.parse(q.postData()); comm.posts.push(b); return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ok: true, horarios: (b.times || []).length } }); }
  const u = new URL(q.url());
  if (u.searchParams.get('op') === 'vapid') return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ok: true, key: 'BK96qkf--vc986EMsIeBrYpS2D1PQ5x8b1xvdPjfnLp9cyk9U2V6Kx3b3RAhqLM3TzwkSyNHTQ1NqzT1RcT6pX8' } });
  return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ok: true, foods: [], phrases: {} } });
});
let aiCalls = 0;
await ctx.route('**/generativelanguage.googleapis.com/**', (r) => {
  if (r.request().url().includes('/models?')) return r.fulfill({ json: { models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] } });
  aiCalls++;
  const body = JSON.stringify(r.request().postDataJSON());
  let out;
  if (/coach que revisa el registro/.test(body)) out = { titulo: 'Buena semana', puntaje: 7.5, resumen: 'Vas bien con la proteína.', bien: ['Proteína alta'], mal: ['Poca agua'], mejorar: ['Tomá 2 vasos más'], cambiar: ['Cambiá la gaseosa por agua con gas: −200 kcal'], evitar: ['Picar después de cenar'], proximo_paso: 'Agua con cada comida' };
  else out = { transcript: '', items: [], water: [], habits: [], gym: [], weight: [], skipped: [], questions: [], activity: [{ date: new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/San_Juan' }), type: 'caminata', steps: 9450, km: 6.8, kcal: 412, from_device: true, minutes: 75 }] };
  return r.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] } });
});

await page.goto('http://localhost:8766/');
await page.waitForSelector('.hero');
await page.waitForSelector('.sheet-wrap', { timeout: 3000 }).then(() => closeSheet()).catch(() => {});
// datos de la semana pasada y de hoy
await val(() => {
  const st = window.__apex.store; const S = st.S();
  S.settings.ai.key = 'AQ.prueba'; S.settings.goals = { ...S.settings.goals, kcal: 2400, p: 150, waterMl: 2500, gymDays: 4 };
  const D = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toLocaleDateString('sv-SE'); };
  for (let i = 1; i <= 14; i++) {
    st.addItems(D(i), 'almuerzo', [{ name: 'Pollo', qty: 250, unit: 'g', grams: 250, per100: { kcal: 165, p: 31, c: 0, f: 3.6, s: 0, fb: 0 } }, { name: 'Arroz', qty: 150, unit: 'g', grams: 150, per100: { kcal: 356, p: 7, c: 78, f: 0.6, s: 0, fb: 1 } }]);
    st.addItems(D(i), 'cena', [{ name: 'Gaseosa común', qty: 500, unit: 'ml', grams: 500, liq: true, per100: { kcal: 42, p: 0, c: 10.6, f: 0, s: 10.6, fb: 0 } }, { name: 'Pizza muzzarella', qty: 3, unit: 'porcion', grams: 360, per100: { kcal: 260, p: 11, c: 30, f: 10, s: 2, fb: 1.5 } }]);
    st.addWater(D(i), 1500); if (i % 2) st.setGym(D(i), 'fui', '');
    st.upsertBody(D(i), { weight: 75 - i * 0.05 });
  }
  st.commit('test');
  return st.flush();
});
await page.reload(); await page.waitForSelector('.hero'); await page.waitForTimeout(1200);

// --- Resumen semanal automático
const wk = await val(() => window.__apex.store.S().weekly || []);
ok('Arma solo el resumen de la semana pasada', wk.length === 1 && wk[0].full && wk[0].st.logged === 7, wk[0] && `${wk[0].from} a ${wk[0].to}, ${wk[0].st.score}/10`);
ok('Muestra el aviso en Hoy', await page.locator('[data-act="weekly-open"]').count() === 1);
await shot('f01-hoy-resumen');
await page.waitForTimeout(800);
ok('Pide sola los consejos a la IA (1 consulta)', aiCalls === 1 && !!(await val(() => window.__apex.store.S().weekly[0].ai)), `${aiCalls} consultas`);
await page.locator('[data-act="weekly-open"]').click(); await page.waitForTimeout(500);
const wtxt = await sheetTop().innerText();
await shot('f02-resumen-semanal');
ok('Resumen: números, mejorar, cambiar e IA', /Proteína por día/.test(wtxt) && /Qué mejorar/.test(wtxt) && /Qué cambiar/.test(wtxt) && /gaseosa por agua con gas/i.test(wtxt), wtxt.replace(/\s+/g, ' ').slice(0, 160));
ok('Consejo concreto sin IA (lo que más calorías sumó)', /Pizza muzzarella/.test(wtxt));
await closeSheet();
ok('El aviso desaparece una vez visto', await page.locator('[data-act="weekly-open"]').count() === 0);

// --- Ajustes: orden de Personalizar
await page.locator('[data-act="settings"]').click(); await page.waitForTimeout(400);
const firstRow = await sheetTop().locator('.set-group:has(h3:text("Personalizar")) [data-s]').first().getAttribute('data-s');
ok('"Pestaña personalizable" es la primera de Personalizar', firstRow === 'slot', firstRow);
// --- Recordatorios
await sheetTop().locator('[data-s="avisos"]').click(); await page.waitForTimeout(400);
await shot('f03-recordatorios');
await sheetTop().locator('[data-n="master"]').click(); await page.waitForTimeout(2500);
const rem = await val(() => window.__apex.store.S().settings.reminders);
ok('Activa los recordatorios', rem.on === true, `push=${rem.push} ${rem.pushError || ''}`);
await shot('f04-recordatorios-on');
await sheetTop().locator('[data-n="edit"][data-id="r_almuerzo"]').click(); await page.waitForTimeout(400);
await shot('f05-editar');
await sheetTop().locator('[data-e="h+"]').click(); await sheetTop().locator('[data-e="m+"]').click();
await sheetTop().locator('[data-e="day"][data-d="0"]').click();
await sheetTop().locator('[data-e="save"]').click(); await page.waitForTimeout(300);
const alm = await val(() => window.__apex.store.S().settings.reminders.list.find((x) => x.id === 'r_almuerzo'));
ok('Editar hora y días', alm.time === '15:00' && !alm.days.includes(0), `${alm.time} ${alm.days.join(',')}`);
await closeSheet(); await closeSheet();
// el service worker muestra un aviso vencido (almuerzo de hoy sin registrar)
await val(async () => {
  const S = window.__apex.store.S();
  const now = new Date(); const t = new Date(now.getTime() - 5 * 60000);
  S.settings.reminders.list.push({ id: 'r_test', type: 'comida', ref: 'merienda', time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`, days: [0, 1, 2, 3, 4, 5, 6], on: true, onlyIfMissing: true });
  window.__apex.store.commit('x'); await window.__apex.store.flush();
  const reg = await navigator.serviceWorker.ready; reg.active.postMessage('avisos');
});
await page.waitForTimeout(1500);
const notes = await val(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.tag}: ${n.title}`));
ok('El service worker muestra el aviso vencido', notes.some((n) => /^r_test: .*merienda/i.test(n)), notes.join(' | '));
await val(async () => (await navigator.serviceWorker.ready).active.postMessage('avisos'));
await page.waitForTimeout(800);
const notes2 = await val(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length);
ok('No lo repite', notes2 === notes.length);

// --- Pestañas personalizables: flechita
await page.locator('#slot-more').click(); await page.waitForTimeout(300);
await shot('f06-flechita');
const opts = await page.locator('#slot-menu [data-slot-go]').count();
ok('La flechita despliega las 5 pestañas', opts === 5, String(opts));
await page.locator('#slot-menu [data-slot-go="agua"]').click(); await page.waitForTimeout(400);
ok('Abre Agua sin cambiar la principal', (await val(() => window.__apex.ui.tab)) === 'agua' && (await val(() => window.__apex.store.S().settings.ui.slotTab || 'gym')) === 'gym');
await shot('f07-agua');
await page.locator('#view [data-act="water-add"][data-ml="500"]').click(); await page.waitForTimeout(300);
ok('Agua: sumar 500 ml a hoy', (await val(() => window.__apex.store.day(new Date().toLocaleDateString('sv-SE')).water)) === 500);
await page.locator('.tab[data-tab="hoy"]').click(); await page.waitForTimeout(300);
ok('Al volver, el botón muestra la principal', (await page.locator('.tab[data-slot]').getAttribute('data-tab')) === 'gym');
await page.locator('.tab[data-slot]').click(); await page.waitForTimeout(300);
ok('Tocar la pestaña (sin flechita) abre la principal', (await val(() => window.__apex.ui.tab)) === 'gym');
await page.locator('#slot-more').click(); await page.waitForTimeout(200);
await page.locator('#slot-menu [data-slot-go="actividad"]').click(); await page.waitForTimeout(400);
await shot('f08-actividad');
ok('Pestaña Actividad', /Pasos de hoy/.test(await page.locator('#view').innerText()));

// --- Captura del reloj compartida desde otra app (Web Share Target)
const png = fs.readFileSync(path.join(ROOT, 'icons/icon-192.png')).toString('base64');
await val(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const fd = new FormData(); fd.append('text', 'Samsung Health'); fd.append('imagen', new File([bin], 'captura.png', { type: 'image/png' }));
  await fetch('./compartir', { method: 'POST', body: fd });
}, png);
await page.goto('http://localhost:8766/?accion=compartir'); await page.waitForSelector('.hero'); await page.waitForTimeout(1500);
const lg = await sheetTop().innerText().catch(() => '');
ok('Abre Registrar con la captura compartida', /Foto adjunta/.test(lg) && /Samsung Health/.test(await sheetTop().locator('#lg-text').inputValue()), lg.replace(/\s+/g, ' ').slice(0, 80));
await sheetTop().locator('[data-l="analyze"]').click();
await page.waitForSelector('[data-r="save"]', { timeout: 10000 }).catch(() => {});
await shot('f09-reloj');
await sheetTop().locator('[data-r="save"]').click(); await page.waitForTimeout(500);
const acts = await val(() => (window.__apex.store.day(new Date().toLocaleDateString('sv-SE')).activity || []));
ok('Guarda pasos y calorías del reloj', acts.length === 1 && acts[0].steps === 9450 && acts[0].kcal === 412 && acts[0].source === 'reloj', JSON.stringify(acts[0]));

// --- Accesos directos (?accion=)
await page.goto('http://localhost:8766/?accion=habito&id=creatina&hecho=1'); await page.waitForSelector('.hero'); await page.waitForTimeout(800);
ok('Notificación "Hecho" marca el suplemento', await val(() => !!window.__apex.store.day(new Date().toLocaleDateString('sv-SE')).habits?.creatina));
await page.goto('http://localhost:8766/?accion=registrar&momento=cena'); await page.waitForSelector('.hero'); await page.waitForTimeout(800);
ok('Notificación de comida abre Registrar en esa comida', /Cena/.test(await sheetTop().innerText().catch(() => '')));
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
ok('Manifiesto: 4 accesos directos y compartir', man.shortcuts.length === 4 && man.share_target?.action === './compartir');

console.log(res.join('\n'));
console.log('Errores:', errors.length ? errors.join('\n') : 'ninguno');
await browser.close(); server.close();
