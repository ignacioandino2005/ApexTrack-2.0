// ApexTrack — Perfil y metas: a mano, calculadas con tus datos, o contándoselo a la IA.
import { todayISO, esc, fmt, round1, parseNum } from './util.js';
import * as store from './store.js';
import * as AI from './ai.js';
import * as EN from './energy.js';
import { icon } from './icons.js';
import { openSheet, toast, setBusy } from './ui.js';
import { canDictate, startDictation } from './voice.js';

export function openGoals() {
  const S = store.S();
  const p = { ...S.settings.profile };
  const g = { ...S.settings.goals };
  const st = {
    name: p.name || '', sex: p.sex || 'm', birthYear: p.birthYear || '', heightCm: p.heightCm || '', weightKg: store.latestWeight()?.kg || p.weightKg || '',
    goalWeight: p.goalWeight || '', level: p.level || '', goal: p.goal || '', gymDays: g.gymDays ?? 3, rawGrains: p.rawGrains !== false,
    kcal: g.kcal, p: g.p, c: g.c, f: g.f, sugarMax: g.sugarMax || '', waterMl: g.waterMl || 2500,
    aiText: '', explanation: '', dict: null,
  };
  const chips = (key, opts) => `<div class="chip-row wrap">${opts.map(([v, l]) => `<button class="chip ${String(st[key]) === String(v) ? 'on' : ''}" data-ch="${key}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const num = (key, label, suffix = '', ph = '') => `<label class="field"><span>${esc(label)}</span><div class="input-wrap"><input class="input" data-n="${key}" inputmode="decimal" value="${st[key] === '' || st[key] == null ? '' : String(st[key]).replace('.', ',')}" placeholder="${esc(ph)}">${suffix ? `<em>${esc(suffix)}</em>` : ''}</div></label>`;
  const sumLine = () => { const k = (Number(st.p) || 0) * 4 + (Number(st.c) || 0) * 4 + (Number(st.f) || 0) * 9; return `Tus macros suman <b>${fmt(k)}</b> kcal${st.kcal ? ` (meta ${fmt(st.kcal)})` : ''}.`; };
  const draw = () => `
    <div class="goal-ai panel" style="box-shadow:none;background:var(--surface-2)">
      <h3 class="sub-h" style="margin-top:0">${icon('sparkle', 16)} Contale a la IA y arma tus metas</h3>
      <div class="composer"><textarea class="input" id="g-ai" rows="4" placeholder="Ej.: Soy mujer, tengo 34 años, mido 1,62 y peso 70 kg. Voy al gimnasio 3 veces por semana y quiero bajar grasa sin perder músculo.">${esc(st.aiText)}</textarea>
      ${canDictate() ? `<button class="mic-big ${st.dict ? 'rec' : ''}" data-x="mic" aria-label="Dictar">${icon(st.dict ? 'stop' : 'mic', 22)}</button>` : ''}</div>
      <button class="btn primary" style="width:100%;margin-top:10px" data-x="ai">${icon('sparkle', 18)} Calcular con IA</button>
      ${st.explanation ? `<div class="banner info" style="margin:12px 0 0">${icon('info', 20)}<div class="grow">${esc(st.explanation)}</div></div>` : ''}
    </div>
    <h3 class="sub-h">Tus datos</h3>
    <label class="field"><span>Nombre</span><input class="input" data-t="name" value="${esc(st.name)}"></label>
    <div class="field"><span>Sexo</span>${chips('sex', [['m', 'Hombre'], ['f', 'Mujer']])}</div>
    <div class="form-grid">
      ${num('birthYear', 'Año de nacimiento', '', '1995')}
      ${num('heightCm', 'Altura', 'cm', '170')}
      ${num('weightKg', 'Peso actual', 'kg', '70')}
      ${num('goalWeight', 'Peso objetivo', 'kg', 'opcional')}
    </div>
    <div class="field"><span>Actividad habitual</span>${chips('level', Object.entries(EN.LEVELS).map(([k, v]) => [k, v.label]))}</div>
    <div class="field"><span>Objetivo</span>${chips('goal', Object.entries(EN.GOALS).map(([k, v]) => [k, v.label]))}</div>
    <div class="form-grid">${num('gymDays', 'Días de gimnasio por semana', '', '3')}</div>
    <button class="set-row-btn" data-x="raw" style="padding-left:0;padding-right:0">${icon('info', 20)}<span class="grow">Peso el arroz y los fideos en crudo<small>Así la IA interpreta "200 g de arroz" como arroz seco</small></span><span class="switch ${st.rawGrains ? 'on' : ''}"></span></button>
    <button class="btn" style="width:100%;margin-top:6px" data-x="calc">${icon('bolt', 18)} Calcular metas con estos datos</button>
    <h3 class="sub-h">Metas diarias</h3>
    <div class="form-grid">
      ${num('kcal', 'Calorías', 'kcal')}${num('p', 'Proteína', 'g')}${num('c', 'Carbohidratos', 'g')}${num('f', 'Grasas', 'g')}${num('sugarMax', 'Azúcares máx.', 'g')}${num('waterMl', 'Agua', 'ml')}
    </div>
    <p class="note" id="g-sum">${sumLine()}</p>`;
  const s = openSheet({ title: 'Perfil y metas', full: true, body: draw(), footer: '<button class="btn ghost" data-x="cancel">Cancelar</button><button class="btn primary" data-x="save">Guardar</button>' });
  const redraw = () => { const y = s.body.scrollTop; s.setBody(draw()); s.body.scrollTop = y; };
  const stopDict = () => { if (st.dict) { st.dict.stop(); st.dict = null; } };
  s.done.then(stopDict);
  s.body.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'g-ai') st.aiText = el.value;
    else if (el.dataset.t) st[el.dataset.t] = el.value;
    else if (el.dataset.n) { const v = parseNum(el.value); st[el.dataset.n] = el.value.trim() === '' ? '' : (Number.isFinite(v) ? v : st[el.dataset.n]); const sm = s.body.querySelector('#g-sum'); if (sm) sm.innerHTML = sumLine(); }
  });
  const applyTargets = (t) => { Object.assign(st, { kcal: t.kcal, p: t.p, c: t.c, f: t.f, sugarMax: t.sugarMax, waterMl: t.waterMl }); };
  const dataOk = () => Number(st.weightKg) > 25 && Number(st.heightCm) > 100;
  const handler = async (e) => {
    const b = e.target.closest('[data-x], [data-ch]');
    if (!b) return;
    if (b.dataset.ch) { st[b.dataset.ch] = b.dataset.v; redraw(); return; }
    const k = b.dataset.x;
    if (k === 'cancel') s.close();
    else if (k === 'raw') { st.rawGrains = !st.rawGrains; b.querySelector('.switch').classList.toggle('on', st.rawGrains); }
    else if (k === 'mic') {
      if (st.dict) { stopDict(); redraw(); return; }
      const base = st.aiText ? st.aiText + ' ' : '';
      st.dict = startDictation({ onText: (fin, interim) => { st.aiText = (base + fin + (interim ? ' ' + interim : '')).trim(); const ta = s.body.querySelector('#g-ai'); if (ta) ta.value = st.aiText; }, onState: (x) => { if (x !== 'escuchando') { st.dict = null; } } });
      redraw();
    } else if (k === 'calc') {
      if (!dataOk()) { toast('Completá al menos altura y peso'); return; }
      const t = EN.calcTargets({ sex: st.sex, age: st.birthYear ? new Date().getFullYear() - Number(st.birthYear) : 30, cm: Number(st.heightCm), kg: Number(st.weightKg), level: st.level || 'moderado', goal: st.goal || 'mantener', gymDays: Number(st.gymDays) || 0 });
      applyTargets(t);
      st.explanation = `Gasto estimado: ${fmt(t.tdee)} kcal por día (basal ${fmt(t.bmr)}). Para "${EN.GOALS[st.goal || 'mantener'].label.toLowerCase()}": ${fmt(t.kcal)} kcal con ${fmt(t.p)} g de proteína.`;
      redraw();
      s.body.querySelector('#g-sum')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (k === 'ai') {
      stopDict();
      const text = (st.aiText || '').trim();
      if (text.length < 10) { toast('Contá tus datos y qué querés lograr'); return; }
      if (!S.settings.ai.key) { toast('Primero cargá tu clave de Gemini en Ajustes → Inteligencia artificial', { kind: 'error', ms: 5000 }); return; }
      setBusy(b, true, 'Calculando…');
      try {
        const r = await AI.planGoals(text, { onStatus: (m) => { b.innerHTML = `<span class="spin"></span><span>${esc(m)}</span>`; } });
        if (r.sex === 'm' || r.sex === 'f') st.sex = r.sex;
        if (r.age > 10 && r.age < 100) st.birthYear = new Date().getFullYear() - Math.round(r.age);
        if (r.heightCm > 100 && r.heightCm < 230) st.heightCm = Math.round(r.heightCm);
        if (r.weightKg > 25 && r.weightKg < 300) st.weightKg = round1(r.weightKg);
        if (r.goalWeightKg > 25 && r.goalWeightKg < 300) st.goalWeight = round1(r.goalWeightKg);
        if (EN.LEVELS[r.level]) st.level = r.level;
        if (EN.GOALS[r.goal]) st.goal = r.goal;
        if (r.gymDays >= 0 && r.gymDays <= 7) st.gymDays = Math.round(r.gymDays);
        // control: si la IA se aleja mucho del cálculo estándar, se usa el cálculo
        const ref = dataOk() ? EN.calcTargets({ sex: st.sex, age: st.birthYear ? new Date().getFullYear() - Number(st.birthYear) : 30, cm: Number(st.heightCm), kg: Number(st.weightKg), level: st.level || 'moderado', goal: st.goal || 'mantener', gymDays: Number(st.gymDays) || 0 }) : null;
        const t = { kcal: Math.round(r.kcal / 10) * 10, p: Math.round(r.protein), c: Math.round(r.carbs), f: Math.round(r.fat), sugarMax: Math.round(r.sugarMax || (r.kcal * 0.1) / 4), waterMl: Math.round((r.waterMl || (Number(st.weightKg) || 70) * 35) / 50) * 50 };
        let note = '';
        if (ref && Math.abs(t.kcal - ref.kcal) / ref.kcal > 0.25) { applyTargets(ref); note = ` La propuesta de la IA (${fmt(t.kcal)} kcal) se alejaba mucho del cálculo estándar, así que usé ${fmt(ref.kcal)} kcal.`; }
        else applyTargets(t);
        st.explanation = `${r.explanation || ''}${note}${r.missing?.length ? ` Supuse: ${r.missing.join(', ')}; corregilo abajo si no es así.` : ''}`;
        redraw();
        toast('Metas calculadas: revisalas y tocá Guardar');
      } catch (err) {
        setBusy(b, false);
        toast(err.message || 'No se pudo calcular', { kind: 'error', ms: 5000 });
      }
    } else if (k === 'save') {
      const P = S.settings.profile; const G = S.settings.goals;
      P.name = String(st.name || '').trim();
      P.sex = st.sex === 'f' ? 'f' : 'm';
      P.birthYear = Number(st.birthYear) > 1900 ? Math.round(st.birthYear) : null;
      if (Number(st.heightCm) >= 100 && Number(st.heightCm) <= 250) P.heightCm = Math.round(st.heightCm);
      P.goalWeight = Number(st.goalWeight) >= 25 && Number(st.goalWeight) <= 300 ? round1(st.goalWeight) : null;
      P.level = EN.LEVELS[st.level] ? st.level : '';
      P.goal = EN.GOALS[st.goal] ? st.goal : '';
      P.rawGrains = !!st.rawGrains;
      const kg = Number(st.weightKg);
      if (kg >= 25 && kg <= 300) { P.weightKg = round1(kg); if (store.latestWeight()?.kg !== round1(kg)) store.upsertBody(todayISO(), { weight: round1(kg) }); }
      for (const key of ['kcal', 'p', 'c', 'f', 'sugarMax', 'waterMl']) if (Number(st[key]) >= 0 && st[key] !== '') G[key] = Math.round(Number(st[key]));
      if (Number(st.gymDays) >= 0 && Number(st.gymDays) <= 7) G.gymDays = Math.round(st.gymDays);
      store.commit('metas');
      s.close();
      const sum = G.p * 4 + G.c * 4 + G.f * 9;
      toast(Math.abs(sum - G.kcal) > G.kcal * 0.1 ? `Guardado. Ojo: tus macros suman ${fmt(sum)} kcal y la meta es ${fmt(G.kcal)}` : 'Perfil y metas guardados', { ms: 5000 });
    }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
  return s.done;
}
