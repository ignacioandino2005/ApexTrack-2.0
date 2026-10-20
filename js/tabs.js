// ApexTrack — pestañas personalizables extra: Actividad (pasos, reloj y gasto) y Agua.
import { todayISO, addDays, weekStart, dateRange, fmt, round0, esc, vibrate } from './util.js';
import * as store from './store.js';
import * as EN from './energy.js';
import { icon } from './icons.js';
import { weekBars } from './charts.js';
import { toast, promptText, confirmDialog } from './ui.js';
import { parseNum } from './util.js';

// ---------------------------------------------------------------------------
// ACTIVIDAD
// ---------------------------------------------------------------------------
const stepsOn = (d) => (store.day(d).activity || []).reduce((x, a) => x + (Number(a.steps) || 0), 0);

export function renderActividad() {
  const today = todayISO();
  const en = EN.dayEnergy(today);
  const steps = stepsOn(today);
  const watch = (store.day(today).activity || []).find((a) => a.source === 'reloj');
  const ws = weekStart(today);
  const days = dateRange(ws, addDays(ws, 6));
  const chart = weekBars({ days: days.map((d) => ({ date: d, value: d > today ? 0 : EN.dayEnergy(d).act })), sel: today, unit: 'kcal', today, height: 160 });
  const stepsChart = weekBars({ days: days.map((d) => ({ date: d, value: stepsOn(d) })), goal: store.S().settings.goals.steps || 8000, sel: today, unit: 'pasos', today, height: 150 });
  const list = en.items.map((a) => `<div class="kv"><span>${icon(a.source === 'reloj' ? 'watch' : 'walk', 18)}${esc(EN.describeAct(a))}</span><span style="display:flex;gap:8px;align-items:center"><b>${fmt(a.kcal)} kcal</b><button class="icon-btn" style="width:36px;height:36px" data-act="act-del" data-id="${esc(a.id)}" aria-label="Borrar">${icon('trash', 18)}</button></span></div>`).join('');
  return `<h1 class="view-title">Actividad</h1>
    <section class="hero" aria-label="Gasto del día">
      <div class="hero-row">
        <div><div class="hero-num">${fmt(en.total)}</div><div class="hero-goal">kcal gastadas hoy (estimado)</div></div>
        <div class="hero-left ${en.balance > 0 && EN.isCut() ? 'over' : ''}"><b>${en.balance > 0 ? '+' : '−'}${fmt(Math.abs(en.balance))}</b><span>balance (comido ${fmt(en.eaten)})</span></div>
      </div>
      <div class="stack-legend" style="margin-top:10px"><span>Basal y vida diaria <b>${fmt(en.base)}</b></span><span>Actividad <b>${fmt(en.act - en.gym)}</b></span><span>Gimnasio <b>${fmt(en.gym)}</b></span><span>Digestión <b>${fmt(en.tef)}</b></span></div>
    </section>
    <section class="panel">
      <div class="kv"><span>${icon('walk', 18)}Pasos de hoy</span><button class="weight-btn" data-act="steps-set">${steps ? fmt(steps) : 'Cargar'}</button></div>
      <div class="kv"><span>${icon('watch', 18)}Reloj o app de salud</span><button class="weight-btn" data-act="watch-shot">${watch ? `${fmt(EN.actKcal(watch, en.kg))} kcal` : 'Cargar captura'}</button></div>
      <p class="note" style="margin:8px 0 0">Compartí a ApexTrack una captura de Samsung Health, Mi Fitness o Zepp (botón Compartir → ApexTrack) y la IA lee los pasos y las calorías del reloj.</p>
    </section>
    <div class="section-head"><h3>Pasos de la semana</h3></div>
    <section class="panel">${stepsChart}</section>
    <div class="section-head"><h3>Actividades de hoy</h3><button class="link" data-act="activity-add">Agregar</button></div>
    <section class="panel">${list || '<p class="muted" style="margin:0">Sin actividades. Contalas al registrar ("caminé 40 minutos") o tocá Agregar.</p>'}</section>
    <div class="section-head"><h3>Calorías de actividad · semana</h3></div>
    <section class="panel">${chart}</section>`;
}

async function setSteps() {
  const today = todayISO();
  const cur = stepsOn(today);
  const v = await promptText({ title: 'Pasos de hoy', label: 'Los que marca tu reloj o el teléfono', value: cur ? String(cur) : '', type: 'text', inputmode: 'numeric', suffix: 'pasos' });
  if (v == null) return;
  const n = Math.round(parseNum(v));
  if (!(n >= 0) || n > 100000) { toast('Poné un número de pasos válido', { kind: 'error' }); return; }
  const d = store.ensureDay(today);
  d.activity = (d.activity || []).filter((a) => !(a.source === 'pasos'));
  // los pasos de otras actividades ya cargadas se descuentan para no contarlos dos veces
  const other = (d.activity || []).reduce((x, a) => x + (Number(a.steps) || 0), 0);
  if (n > other) { const a = EN.addActivity(today, { type: 'caminata', steps: n - other, note: 'pasos del día' }); a.source = 'pasos'; }
  store.commit('pasos');
  toast(`Pasos de hoy: ${fmt(n)}`);
}

// ---------------------------------------------------------------------------
// AGUA
// ---------------------------------------------------------------------------
export function renderAgua() {
  const today = todayISO();
  const S = store.S();
  const goal = S.settings.goals.waterMl || 2500;
  const glass = S.settings.ui.glassMl || 250;
  const w = store.day(today).water || 0;
  const pct = Math.min(100, Math.round((w / goal) * 100));
  const ws = weekStart(today);
  const days = dateRange(ws, addDays(ws, 6));
  const chart = weekBars({ days: days.map((d) => ({ date: d, value: (store.day(d).water || 0) / 1000 })), goal: goal / 1000, sel: today, unit: 'L', dec: 1, today, height: 160 });
  let streak = 0;
  for (let d = addDays(today, w >= goal ? 0 : -1); (store.day(d).water || 0) >= goal; d = addDays(d, -1)) streak++;
  const last30 = dateRange(addDays(today, -29), today).filter((d) => (store.day(d).water || 0) >= goal).length;
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const pace = Math.round(goal * Math.max(0, Math.min(1, (h - 8) / 14)));
  return `<h1 class="view-title">Agua</h1>
    <section class="panel water-big">
      <div class="wb-ring" style="--p:${pct}"><div><b>${fmt(w / 1000, 2)}</b><small>de ${fmt(goal / 1000, 1)} L</small></div></div>
      <p class="muted" style="text-align:center;margin:10px 0 0">${w >= goal ? '¡Llegaste a la meta de hoy!' : w >= pace ? `Vas bien: a esta hora conviene llevar ${fmt(pace / 1000, 1)} L.` : `Vas atrasado: a esta hora conviene llevar ${fmt(pace / 1000, 1)} L (faltan ${Math.ceil((pace - w) / glass)} vasos).`}</p>
      <div class="water-quick" style="justify-content:center;margin-top:14px">
        <button class="chip soft" data-act="water-add" data-ml="${glass}">${icon('plus', 16)} Vaso ${glass} ml</button>
        <button class="chip soft" data-act="water-add" data-ml="500">${icon('plus', 16)} 500 ml</button>
        <button class="chip soft" data-act="water-add" data-ml="1000">${icon('plus', 16)} 1 L</button>
        <button class="chip soft" data-act="water-add" data-ml="-${glass}">${icon('minus', 16)} Quitar vaso</button>
        <button class="chip soft" data-act="water-custom">Otra cantidad</button>
      </div>
    </section>
    <section class="panel"><div class="kv"><span>${icon('star', 18)}Racha en la meta</span><b>${streak} ${streak === 1 ? 'día' : 'días'}</b></div><div class="kv"><span>${icon('calendar', 18)}Últimos 30 días</span><b>${last30} de 30 en la meta</b></div></section>
    <div class="section-head"><h3>Esta semana</h3></div>
    <section class="panel">${chart}</section>`;
}

export const tabActions = {
  'steps-set': () => setSteps(),
  'act-del': async (el) => {
    if (!(await confirmDialog({ title: '¿Borrar esta actividad?', ok: 'Borrar', danger: true }))) return;
    EN.removeActivity(todayISO(), el.dataset.id); vibrate(10); store.commit('actividad');
  },
};
export { round0 };
