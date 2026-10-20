// Servicio de aprendizaje compartido (server/comunidad.gs) con las APIs de Google simuladas,
// y el circuito completo: aportes del teléfono → conocimiento → la IA propia entiende un plato nuevo.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);

// --- simulación mínima de Apps Script ---
const sheets = {};
const files = {};
const props = {};
const Sheet = (name) => ({
  rows: [],
  appendRow(r) { this.rows.push(r); }, setFrozenRows() {},
  getLastRow() { return this.rows.length; },
  getRange(row, col, n, m) {
    const self = this;
    return {
      setValues(v) { for (let i = 0; i < v.length; i++) self.rows[row - 1 + i] = v[i]; },
      getValues() { return self.rows.slice(row - 1, row - 1 + n).map((r) => r.slice(col - 1, col - 1 + m)); },
    };
  },
});
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = Sheet(n)) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  DriveApp: {
    createFile: (n, c) => { const id = 'f' + Object.keys(files).length; files[id] = c; return { getId: () => id, setContent: (x) => { files[id] = x; } }; },
    getFileById: (id) => { if (!(id in files)) throw new Error('no'); return { setContent: (x) => { files[id] = x; }, getBlob: () => ({ getDataAsString: () => files[id] }) }; },
  },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
  Date, JSON, Math, Number, String, Object, Set, Array,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../server/comunidad.gs', import.meta.url), 'utf8'), ctx);

// --- aportes armados por el teléfono (mismo código que usa la app) ---
const { recordsFromDraft } = await import('../../js/community.js');
const AI = await import('../../js/ai.js');
const today = '2026-10-17';
const draftOf = (said, name, qty, unit, grams, per100) => ({
  meta: { engine: 'ia', model: 'gemini-3.5-flash', input: `almuerzo ${said}` }, water: [], habits: [], gym: [],
  groups: [{ date: today, moment: 'almuerzo', items: [{ said, name, qty, unit, grams, liq: false, basis: 'tabla', confidence: 'media', per100 }] }],
});
const pk = { kcal: 165, p: 9, c: 18, f: 6.2, s: 2, fb: 2.5 };
const post = (install, recs) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ v: 1, app: 'test', install, records: recs }) } }).text);
let r1 = post('a', recordsFromDraft(draftOf('dos porciones de guiso de mondongo', 'Guiso de mondongo casero', 2, 'porcion', 500, pk), today));
post('b', recordsFromDraft(draftOf('una porcion de guiso de mondongo', 'Guiso de mondongo casero', 1, 'porcion', 260, { ...pk, kcal: 160 }), today));
post('c', recordsFromDraft(draftOf('guiso de mondongo', 'Guiso de mondongo casero', 1, 'porcion', 240, { ...pk, kcal: 170 }), today));
ok('Guarda los aportes', r1.ok && r1.items === 1 && r1.mensajes === 1 && sheets.aportes.rows.length === 4 && sheets.mensajes.rows.length === 4, JSON.stringify(r1));
ok('Rechaza basura', post('x', [{ t: 'item', name: 'algo', k: 5000 }, { t: 'otro' }]).items === 0);
const bad = JSON.parse(ctx.doPost({ postData: { contents: '{nope' } }).text);
ok('JSON inválido no rompe', bad.ok === false);

const K = JSON.parse(ctx.doGet({ parameter: { op: 'conocimiento' } }).text);
const pastel = K.foods.find((f) => /guiso de mondongo/i.test(f.n));
ok('Arma el conocimiento', K.ok && K.users === 3 && !!pastel, `${K.foods.length} alimentos, ${K.users} personas`);
ok('Valores = mediana y coherentes', pastel && pastel.k === 165 && pastel.users === 3, pastel && `${pastel.k} kcal · ${JSON.stringify(pastel.u)}`);
ok('Medida casera aprendida (porción ≈ 250 g)', pastel && Math.abs(pastel.u.porcion - 250) <= 10, pastel && JSON.stringify(pastel.u));
ok('Frase → alimento', Object.keys(K.phrases).some((p) => /guiso de mondongo/.test(p)), JSON.stringify(K.phrases));
const st = JSON.parse(ctx.doGet({ parameter: { op: 'estado' } }).text);
ok('Estado', st.aportes === 3 && st.mensajes === 3, JSON.stringify(st));

// --- la IA propia lo usa ---
const F = await import('../../js/foods.js');
const before = AI.analyzeOffline('almuerzo una porción de guiso de mondongo', AI.testContext({}, new Date(2026, 9, 17, 13)));
const beforeName = before.groups[0]?.items[0]?.name;
F.setCommunityFoods(K.foods, K.phrases);
const ctxT = AI.testContext({}, new Date(2026, 9, 17, 13));
const after = AI.analyzeOffline('almuerzo una porción de guiso de mondongo', ctxT);
const it = after.groups[0]?.items[0];
ok('La IA propia entiende el plato nuevo', it && /guiso de mondongo/i.test(it.name) && Math.abs(it.grams - 250) <= 10, `antes: ${beforeName} · después: ${it?.name} ${it?.grams} g ${AI.groupTotals(after.groups[0]).kcal} kcal`);
ok('Y lo resuelve sin Gemini', AI.localVerdict(after, 'almuerzo una porción de guiso de mondongo', ctxT).ok);

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('✗')).length;
console.log(fails ? `${fails} FALLAS` : 'Todo bien');
