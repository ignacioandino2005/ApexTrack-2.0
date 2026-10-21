// ApexTrack — gasto energético estimado (basal + actividad + digestión), actividades del día
// y cálculo de metas a partir de los datos de la persona.
import { todayISO, round0, round1, uid, parseISO } from './util.js';
import * as store from './store.js';

// MET (equivalente metabólico) de actividades comunes — Compendium of Physical Activities
export const ACTS = {
  caminata: { label: 'Caminata', met: 3.5, icon: 'walk' },
  caminata_rapida: { label: 'Caminata rápida', met: 4.8, icon: 'walk' },
  correr: { label: 'Correr', met: 9, icon: 'bolt' },
  bici: { label: 'Bicicleta', met: 7, icon: 'bolt' },
  natacion: { label: 'Natación', met: 7, icon: 'drop' },
  futbol: { label: 'Fútbol', met: 7, icon: 'bolt' },
  tenis: { label: 'Tenis / pádel', met: 7, icon: 'bolt' },
  baile: { label: 'Baile', met: 5, icon: 'bolt' },
  eliptico: { label: 'Elíptico / cinta', met: 5, icon: 'bolt' },
  yoga: { label: 'Yoga / estiramiento', met: 2.5, icon: 'star' },
  pesas: { label: 'Pesas (fuera de la rutina)', met: 5, icon: 'dumbbell' },
  otro: { label: 'Otra actividad', met: 4.5, icon: 'bolt' },
};
export const LEVELS = {
  sedentario: { label: 'Sedentario', sub: 'Trabajo sentado, casi sin ejercicio', f: 1.2 },
  ligero: { label: 'Ligero', sub: 'Ejercicio 1 a 3 días por semana', f: 1.375 },
  moderado: { label: 'Moderado', sub: 'Ejercicio 3 a 5 días por semana', f: 1.55 },
  alto: { label: 'Alto', sub: 'Ejercicio intenso 6 a 7 días o trabajo físico', f: 1.725 },
};
export const GOALS = {
  bajar: { label: 'Bajar de peso', sub: 'Déficit de calorías, cuidando el músculo' },
  recomp: { label: 'Bajar grasa y ganar músculo', sub: 'Déficit chico con mucha proteína' },
  mantener: { label: 'Mantener el peso', sub: 'Comer lo que gastás' },
  subir: { label: 'Subir de peso / masa muscular', sub: 'Superávit moderado' },
};

export function profile() { return store.S().settings.profile; }
export function ageOf(p = profile()) { const y = Number(p.birthYear); return y > 1900 ? Math.max(12, new Date().getFullYear() - y) : 30; }
export function weightOn(date = todayISO()) { return store.latestWeight(date)?.kg || Number(profile().weightKg) || 70; }

/** Metabolismo basal (Mifflin-St Jeor) */
export function bmr({ sex = 'm', kg = 70, cm = 170, age = 30 } = {}) {
  return round0(10 * kg + 6.25 * cm - 5 * age + (sex === 'f' ? -161 : 5));
}

/**
 * Largo del paso (m) según la altura y el sexo: caminando ≈ 41,5 % de la altura (41,3 % en mujeres),
 * corriendo ≈ 65 %. Se usa para pasar de distancia a pasos y al revés.
 */
export function stepLength(type = 'caminata', p = profile()) {
  const h = (Number(p.heightCm) || 170) / 100;
  if (type === 'correr') return h * 0.65;
  return h * (p.sex === 'f' ? 0.413 : 0.415) * (type === 'caminata_rapida' ? 1.07 : 1);
}
const isWalkRun = (type) => type === 'caminata' || type === 'caminata_rapida' || type === 'correr';
/** Pasos de una actividad: los que se cargaron, o calculados desde la distancia. */
export function stepsOf(a) {
  if (Number(a.steps) > 0) return Math.round(Number(a.steps));
  if (Number(a.km) > 0 && isWalkRun(a.type)) return Math.round((Number(a.km) * 1000) / stepLength(a.type));
  return 0;
}
export const stepsEstimated = (a) => !(Number(a.steps) > 0) && stepsOf(a) > 0;

/** Calorías de una actividad (sin contar el basal, que ya está en la cuenta) */
export function actKcal(a, kg) {
  if (Number(a.kcal) > 0 && a.manual) return round0(a.kcal);
  const t = ACTS[a.type] || ACTS.otro;
  const walk = a.type === 'caminata' || a.type === 'caminata_rapida';
  let km = Number(a.km) || 0;
  if (!km && Number(a.steps) > 0 && (walk || a.type === 'correr')) km = (Number(a.steps) * stepLength(a.type)) / 1000;
  if (km > 0 && (walk || a.type === 'correr')) {
    // costo neto aproximado por km: caminar ≈ 0,5 kcal/kg/km; correr ≈ 0,9 kcal/kg/km
    return round0(km * kg * (a.type === 'correr' ? 0.9 : a.type === 'caminata_rapida' ? 0.6 : 0.5));
  }
  const min = Number(a.min) || 0;
  return round0(Math.max(0, t.met - 1) * kg * (min / 60));
}

/** Duración de la sesión de gimnasio del día (min), o 60 si no se sabe */
function gymMinutes(date) {
  const ses = store.S().gym.sessions.filter((s) => s.date === date);
  let min = 0;
  for (const s of ses) if (s.finishedAt && s.startedAt) min += Math.min(150, (s.finishedAt - s.startedAt) / 60000);
  if (!min && store.day(date).gym === 'fui') min = 60;
  return round0(min);
}

/** Gasto del día: basal × 1,2 (vida diaria) + actividades + gimnasio + digestión (10 % de lo comido) */
export function dayEnergy(date = todayISO()) {
  const p = profile();
  const kg = weightOn(date);
  const b = bmr({ sex: p.sex, kg, cm: Number(p.heightCm) || 170, age: ageOf(p) });
  const base = round0(b * 1.2);
  const items = (store.day(date).activity || []).map((a) => ({ ...a, kcal: actKcal(a, kg) }));
  const gmin = gymMinutes(date);
  const gym = gmin ? round0(4 * kg * (gmin / 60)) : 0; // pesas: MET 5 − 1
  const act = items.reduce((x, a) => x + a.kcal, 0) + gym;
  const eaten = store.dayTotals(date).kcal;
  const tef = round0(eaten * 0.1);
  return { kg, bmr: b, base, items, gym, gymMin: gmin, act, tef, eaten, total: base + act + tef, balance: eaten - (base + act + tef) };
}

/** Objetivo: el elegido, o deducido comparando la meta de calorías con el mantenimiento */
export function goalMode() {
  const p = profile();
  if (GOALS[p.goal]) return p.goal;
  const g = store.goals();
  const b = bmr({ sex: p.sex, kg: weightOn(), cm: Number(p.heightCm) || 170, age: ageOf(p) });
  const maint = b * (LEVELS[p.level]?.f || ((g.gymDays || 0) >= 3 ? 1.55 : 1.375));
  if (g.kcal < maint * 0.92) return 'bajar';
  if (g.kcal > maint * 1.08) return 'subir';
  return 'mantener';
}
export const isCut = () => ['bajar', 'recomp'].includes(goalMode());

/** Metas sugeridas a partir de los datos (cálculo propio, sin IA) */
export function calcTargets({ sex = 'm', age = 30, cm = 170, kg = 70, level = 'moderado', goal = 'mantener', gymDays = 3 } = {}) {
  const b = bmr({ sex, kg, cm, age });
  const tdee = b * (LEVELS[level]?.f || 1.55);
  const mult = { bajar: 0.8, recomp: 0.9, mantener: 1, subir: 1.1 }[goal] || 1;
  let kcal = Math.round((tdee * mult) / 50) * 50;
  kcal = Math.max(sex === 'f' ? 1300 : 1500, kcal);
  const pPerKg = { bajar: 2.0, recomp: 2.2, mantener: 1.6, subir: 1.8 }[goal] || 1.6;
  const p = Math.round(kg * pPerKg);
  const f = Math.round(Math.max(kg * 0.8, (kcal * 0.25) / 9));
  const c = Math.max(50, Math.round((kcal - p * 4 - f * 9) / 4));
  return {
    kcal, p, c, f, sugarMax: Math.round((kcal * 0.1) / 4), waterMl: Math.round((kg * 35) / 250) * 250, gymDays,
    bmr: b, tdee: round0(tdee),
  };
}

// ---------- Actividades del día ----------
export function addActivity(date, a) {
  const d = store.ensureDay(date);
  d.activity = d.activity || [];
  const item = { id: uid('ac'), type: ACTS[a.type] ? a.type : 'otro', min: Number(a.min) || 0, km: Number(a.km) || 0, steps: Number(a.steps) || 0, note: a.note || '' };
  if (a.kcal && a.manual) { item.kcal = round0(a.kcal); item.manual = true; }
  if (a.source) {
    item.source = a.source;
    // una captura nueva del reloj reemplaza a la anterior del mismo día (los totales del reloj se acumulan)
    if (a.source === 'reloj') d.activity = d.activity.filter((x) => x.source !== 'reloj' && x.source !== 'pasos');
  }
  d.activity.push(item);
  return item;
}
export function removeActivity(date, id) {
  const d = store.ensureDay(date);
  d.activity = (d.activity || []).filter((x) => x.id !== id);
}
export function describeAct(a) {
  const t = ACTS[a.type] || ACTS.otro;
  const parts = [];
  if (a.min) parts.push(`${a.min} min`);
  if (a.km) parts.push(`${round1(a.km)} km`);
  if (a.steps) parts.push(`${Number(a.steps).toLocaleString('es-AR')} pasos`);
  else if (stepsEstimated(a)) parts.push(`≈ ${stepsOf(a).toLocaleString('es-AR')} pasos`);
  if (a.manual && a.kcal) parts.push(`${round0(a.kcal)} kcal medidas`);
  return `${a.source === 'reloj' ? 'Reloj' : t.label}${parts.length ? ' · ' + parts.join(' · ') : ''}${a.note && a.note !== 'reloj' ? ' · ' + a.note : ''}`;
}
export { parseISO };
