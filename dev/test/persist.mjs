// Prueba de persistencia: pérdida de IndexedDB, de todo menos el archivo interno, fotos diarias y copia en Drive.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('../../app');
const OUT = process.env.SHOTS || '/tmp/shots';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'es-AR', timezoneId: 'America/Argentina/San_Juan', serviceWorkers: 'block', ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
await ctx.route('https://app.test/**', async (route) => {
  let p = new URL(route.request().url()).pathname; if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) return route.fulfill({ status: 404 });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
});
// Apps Script simulado
let cloud = null; let cloudPosts = 0;
await ctx.route('https://script.google.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'POST') {
    const b = JSON.parse(req.postData());
    if (b.clave !== 'secreta') return route.fulfill({ json: { ok: false, error: 'clave' }, headers: { 'access-control-allow-origin': '*' } });
    cloud = { fecha: new Date().toISOString(), datos: b.datos }; cloudPosts++;
    return route.fulfill({ json: { ok: true, bytes: req.postData().length }, headers: { 'access-control-allow-origin': '*' } });
  }
  const u = new URL(req.url());
  if (u.searchParams.get('clave') !== 'secreta') return route.fulfill({ json: { ok: false, error: 'clave' }, headers: { 'access-control-allow-origin': '*' } });
  return route.fulfill({ json: cloud ? { ok: true, ...cloud } : { ok: false, error: 'sin copia' }, headers: { 'access-control-allow-origin': '*' } });
});
const sheetTop = () => page.locator('.sheet-wrap').last();
const val = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const items = () => val(() => window.__apex.store.S().entries.reduce((n, e) => n + e.items.length, 0));
const boot = async () => { await page.goto('https://app.test/'); await page.waitForSelector('.hero'); await page.waitForTimeout(600); };

await boot();
// cerrar la bienvenida
if (await page.locator('.sheet-wrap').count()) { await shot('p0-bienvenida'); await page.locator('.sheet-wrap [data-sheet-close]').last().click(); await page.waitForTimeout(400); }
// cargar 20 días de datos
await val(() => {
  const st = window.__apex.store; const U = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toLocaleDateString('sv-SE'); };
  for (let i = 0; i < 20; i++) {
    st.addItems(U(i), 'almuerzo', [{ name: 'Pollo', qty: 200, unit: 'g', grams: 200, per100: { kcal: 165, p: 31, c: 0, f: 3.6, s: 0, fb: 0 } }, { name: 'Arroz', qty: 100, unit: 'g', grams: 100, per100: { kcal: 356, p: 7, c: 78, f: 0.6, s: 0, fb: 1 } }]);
    st.upsertBody(U(i), { weight: 61 + i / 10 });
  }
  st.commit('test');
});
await val(() => window.__apex.store.flush());
await page.waitForTimeout(300);
const n0 = await items();
ok('Datos de prueba cargados', n0 === 40, String(n0));
const files = await val(async () => { const d = await navigator.storage.getDirectory(); const out = []; for await (const [n] of d.entries()) out.push(n); return out; });
ok('Copia en archivo interno y foto diaria', files.includes('state.json') && files.some((f) => f.startsWith('snap-')), files.join(', '));
ok('Copia en localStorage', await val(() => !!localStorage.getItem('apextrack_state_v2')));

// 1) Se pierde IndexedDB
await val(() => new Promise((r) => { const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await boot();
ok('Sin IndexedDB: recupera desde las otras copias', (await items()) === 40, `${await items()} alimentos · ${await page.locator('#toast').innerText()}`);

// 2) Se pierden IndexedDB y localStorage: queda el archivo interno
await val(() => new Promise((r) => { localStorage.clear(); const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await boot();
ok('Solo con el archivo interno: recupera', (await items()) === 40, String(await items()));

// 3) Protección: un estado vacío no pisa los datos guardados
await val(() => { const S = window.__apex.store.S(); S.entries = []; S.body = []; S.days = {}; return window.__apex.store.flush(); });
await boot();
ok('Un estado vacío accidental no borra lo guardado', (await items()) === 40, String(await items()));

// 4) Copia en Drive: configurar y subir
await page.locator('[data-act="settings"]').click(); await page.waitForTimeout(400);
await sheetTop().locator('[data-s="cloud"]').click(); await page.waitForTimeout(400);
await shot('p1-drive');
await sheetTop().locator('#c-url').fill('https://script.google.com/macros/s/ABC123/exec');
await sheetTop().locator('#c-tok').fill('secreta');
await sheetTop().locator('[data-c="save"]').click();
await page.waitForTimeout(1200);
await shot('p2-drive-ok');
ok('Sube la copia a Drive', cloudPosts === 1 && cloud.datos.entries.length === 20 && cloud.datos.settings.ai.key === '', `${cloudPosts} subidas · ${await sheetTop().locator('#c-st').innerText()}`);
await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(300);

// 5) Se borra TODO el sitio (como si el navegador lo hubiera limpiado) y se recupera desde Drive
await val(async () => { localStorage.clear(); const d = await navigator.storage.getDirectory(); for await (const [n] of d.entries()) await d.removeEntry(n); await new Promise((r) => { const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
await boot();
ok('Todo borrado: arranca vacío con la bienvenida', (await items()) === 0 && (await page.locator('.sheet-wrap').count()) === 1);
await shot('p3-bienvenida-recuperar');
await sheetTop().locator('.opt[data-v="recuperar"]').click(); await page.waitForTimeout(600);
await shot('p4-recuperar');
await sheetTop().locator('[data-r-x="cloud"]').click(); await page.waitForTimeout(400);
await sheetTop().locator('#c-url').fill('https://script.google.com/macros/s/ABC123/exec');
await sheetTop().locator('#c-tok').fill('secreta');
await sheetTop().locator('[data-c="save"]').click(); await page.waitForTimeout(500);
ok('Con la app vacía no sube nada encima de la copia', cloudPosts === 1, await sheetTop().locator('#c-st').innerText());
await sheetTop().locator('[data-c="pull"]').click(); await page.waitForTimeout(800);
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(800);
ok('Recupera todo desde Drive', (await items()) === 40, `${await items()} · ${await page.locator('#toast').innerText()}`);
await shot('p5-recuperado');

// 6) Se pierde todo menos las fotos diarias: la bienvenida ofrece restaurarlas
await val(() => window.__apex.store.flush()); await page.waitForTimeout(400);
await val(async () => { localStorage.clear(); const d = await navigator.storage.getDirectory(); await d.removeEntry('state.json').catch(() => {}); await new Promise((r) => { const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
await boot();
await page.waitForTimeout(800);
await shot('p6-foto-diaria');
const txt = await page.locator('.sheet-wrap').last().innerText().catch(() => '');
ok('Sin nada más que la foto diaria: ofrece restaurarla', /Encontré tus datos anteriores/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 140));
await sheetTop().locator('[data-r="1"]').click().catch(() => {}); await page.waitForTimeout(800);
ok('Restaura la foto diaria', (await items()) === 40, String(await items()));
console.log(res.join('\n'));
console.log('Errores:', errors.length ? errors.join('\n') : 'ninguno');
await browser.close();
