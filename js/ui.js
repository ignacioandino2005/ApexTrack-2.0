// ApexTrack — componentes de interfaz: hojas inferiores, selectores, calendario, avisos.
import { icon } from './icons.js';
import { esc, todayISO, addMonths, monthStart, parseISO, isoDate, addDays, MESES, fmtDayLong, cap, vibrate, parseNum } from './util.js';

// ---------- Hojas (bottom sheets) con soporte del botón atrás de Android ----------
const stack = [];
let ignorePop = 0;
let deferredBack = null;
let backCount = 0;
let rootBack = null;
export function setRootBack(fn) { rootBack = fn; }

window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop--; return; }
  if (stack.length) { stack[stack.length - 1].close(undefined, true); return; }
  if (rootBack) rootBack();
});

export function sheetsOpen() { return stack.length; }

/**
 * Abre una hoja inferior. Devuelve { el, body, foot, close(result), setTitle, done (Promise) }
 */
export function openSheet({ title = '', body = '', footer = '', cls = '', full = false, onClose = null, dismissable = true } = {}) {
  const host = document.getElementById('sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="scrim"></div>
    <section class="sheet ${full ? 'sheet-full' : ''} ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-head">
        <div class="grab" aria-hidden="true"></div>
        <h2 class="sheet-title">${esc(title)}</h2>
        <button class="icon-btn sheet-x" data-sheet-close aria-label="Cerrar">${icon('x', 22)}</button>
      </header>
      <div class="sheet-body">${body}</div>
      <footer class="sheet-foot" ${footer ? '' : 'hidden'}>${footer}</footer>
    </section>`;
  host.appendChild(wrap);
  document.body.classList.add('has-sheet');
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const s = {
    el: wrap,
    sheet: wrap.querySelector('.sheet'),
    body: wrap.querySelector('.sheet-body'),
    foot: wrap.querySelector('.sheet-foot'),
    done,
    closed: false,
    setTitle(t) { wrap.querySelector('.sheet-title').textContent = t; },
    setFooter(html) { s.foot.innerHTML = html; s.foot.hidden = !html; },
    setBody(html) { s.body.innerHTML = html; },
    close(result, fromPop = false) {
      if (s.closed) return;
      s.closed = true;
      const i = stack.indexOf(s);
      if (i >= 0) stack.splice(i, 1);
      // Volver atrás en el historial se hace un instante después: si enseguida se abre otra hoja
      // (elegir una opción y pasar al formulario), se reutiliza la misma entrada y no se desordena.
      if (!fromPop) { backCount++; clearTimeout(deferredBack); deferredBack = setTimeout(() => { const n = backCount; deferredBack = null; backCount = 0; if (n > 0) { ignorePop++; history.go(-n); } }, 60); }
      wrap.classList.add('closing');
      setTimeout(() => { wrap.remove(); if (!stack.length) document.body.classList.remove('has-sheet'); }, 220);
      if (onClose) { try { onClose(result); } catch (e) { console.error(e); } }
      resolveDone(result);
    },
  };
  stack.push(s);
  if (backCount > 0) { backCount--; history.replaceState({ sheet: stack.length }, ''); if (!backCount) { clearTimeout(deferredBack); deferredBack = null; } } else history.pushState({ sheet: stack.length }, '');
  requestAnimationFrame(() => wrap.classList.add('open'));
  wrap.querySelector('.scrim').addEventListener('click', () => { if (dismissable) s.close(); });
  wrap.querySelector('[data-sheet-close]').addEventListener('click', () => s.close());
  // deslizar hacia abajo para cerrar
  const head = wrap.querySelector('.sheet-head');
  let y0 = null; let dy = 0;
  head.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; s.sheet.style.transition = 'none'; head.setPointerCapture(e.pointerId); });
  head.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); s.sheet.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (y0 == null) return; y0 = null; s.sheet.style.transition = ''; s.sheet.style.transform = ''; if (dy > 110 && dismissable) s.close(); };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  return s;
}

export function closeAllSheets() { while (stack.length) stack[stack.length - 1].close(); }

// ---------- Aviso breve (toast) con acción opcional ----------
let toastTimer = null;
export function toast(msg, { action = '', onAction = null, ms = 3200, kind = '' } = {}) {
  const el = document.getElementById('toast');
  el.className = `toast show ${kind}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action)}</button>` : ''}`;
  if (action && onAction) el.querySelector('.toast-act').onclick = () => { el.classList.remove('show'); onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Confirmación ----------
export function confirmDialog({ title = '¿Seguro?', text = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false } = {}) {
  const s = openSheet({
    title, cls: 'sheet-compact',
    body: text ? `<p class="muted pad">${esc(text)}</p>` : '',
    footer: `<button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button>`,
  });
  s.foot.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) s.close(b.dataset.r === '1'); });
  return s.done.then((r) => !!r);
}

// ---------- Selector de opción (reemplaza los <select> nativos) ----------
export function pickOption({ title = 'Elegí', options = [], value = null, allowCustom = false, customLabel = 'Otro…' } = {}) {
  const list = options.map((o) => `
    <button class="opt ${o.value === value ? 'on' : ''}" data-v="${esc(o.value)}">
      <span class="opt-main">${o.icon ? icon(o.icon, 20) : ''}<span>${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></span>
      ${o.value === value ? icon('check', 20, 'opt-check') : ''}
    </button>`).join('');
  const s = openSheet({ title, cls: 'sheet-compact', body: `<div class="opt-list">${list}${allowCustom ? `<button class="opt" data-custom="1"><span class="opt-main">${icon('plus', 20)}<span>${esc(customLabel)}</span></span></button>` : ''}</div>` });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    vibrate(8);
    if (b.dataset.custom) {
      const v = await promptText({ title: customLabel, label: 'Nombre' });
      if (v) s.close({ custom: v });
      return;
    }
    const opt = options.find((o) => String(o.value) === b.dataset.v);
    s.close(opt ? opt.value : b.dataset.v);
  });
  return s.done;
}

// ---------- Campo de texto simple ----------
export function promptText({ title = '', label = '', value = '', placeholder = '', type = 'text', inputmode = '', suffix = '' } = {}) {
  const s = openSheet({
    title, cls: 'sheet-compact',
    body: `<label class="field"><span>${esc(label)}</span><div class="input-wrap"><input class="input" type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">${suffix ? `<em>${esc(suffix)}</em>` : ''}</div></label>`,
    footer: `<button class="btn ghost" data-r="0">Cancelar</button><button class="btn primary" data-r="1">Listo</button>`,
  });
  const inp = s.body.querySelector('input');
  setTimeout(() => { inp.focus(); inp.select?.(); }, 250);
  const submit = () => s.close(inp.value.trim());
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  s.foot.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; if (b.dataset.r === '1') submit(); else s.close(null); });
  return s.done.then((v) => (v === undefined ? null : v));
}

/** Formulario con varios campos numéricos o de texto. fields: [{key,label,value,type,suffix,step,placeholder,full}] */
export function formSheet({ title = '', intro = '', fields = [], submitText = 'Guardar', extraFooter = '' } = {}) {
  const html = `${intro ? `<p class="muted pad-b">${intro}</p>` : ''}<div class="form-grid">${fields.map((f) => {
    if (f.type === 'textarea') return `<label class="field full"><span>${esc(f.label)}</span><textarea class="input" data-k="${f.key}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea></label>`;
    if (f.type === 'date') return `<div class="field ${f.full ? 'full' : ''}"><span>${esc(f.label)}</span><button class="input date-field" data-k="${f.key}" data-date="${esc(f.value)}">${icon('calendar', 18)}<span>${esc(cap(fmtDayLong(f.value)))}</span></button></div>`;
    const num = f.type === 'number';
    return `<label class="field ${f.full ? 'full' : ''}"><span>${esc(f.label)}</span><div class="input-wrap"><input class="input" data-k="${f.key}" type="${num ? 'text' : (f.type || 'text')}" ${num ? 'inputmode="decimal"' : ''} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">${f.suffix ? `<em>${esc(f.suffix)}</em>` : ''}</div></label>`;
  }).join('')}</div>`;
  const s = openSheet({ title, body: html, footer: `${extraFooter}<button class="btn ghost" data-r="0">Cancelar</button><button class="btn primary" data-r="1">${esc(submitText)}</button>` });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('.date-field');
    if (!b) return;
    const fd = fields.find((x) => x.key === b.dataset.k) || {};
    const d = await pickDate({ value: b.dataset.date, max: fd.max || null, title: fd.label || 'Elegí un día' });
    if (d) { b.dataset.date = d; b.querySelector('span').textContent = cap(fmtDayLong(d)); }
  });
  s.foot.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    if (b.dataset.r !== '1') { s.close(null); return; }
    const out = {};
    for (const f of fields) {
      const el = s.body.querySelector(`[data-k="${f.key}"]`);
      if (!el) continue;
      if (f.type === 'date') out[f.key] = el.dataset.date;
      else if (f.type === 'number') { const v = parseNum(el.value); out[f.key] = Number.isFinite(v) ? v : (el.value.trim() === '' ? '' : NaN); }
      else out[f.key] = el.value;
    }
    s.close(out);
  });
  return s.done.then((v) => (v === undefined ? null : v));
}

// ---------- Calendario propio (sin el selector nativo) ----------
/**
 * marks(iso) → 'meta' | 'cerca' | 'bajo' | 'dato' | null  (puntito de color)
 */
export function pickDate({ title = 'Elegí un día', value = todayISO(), max = null, marks = null } = {}) {
  let month = monthStart(value);
  const today = todayISO();
  const maxD = max || addDays(today, 1);
  const s = openSheet({ title, cls: 'sheet-compact sheet-cal', body: '<div class="cal"></div>', footer: `<button class="btn ghost" data-go="today">${icon('today', 18)} Hoy</button><button class="btn ghost" data-go="yesterday">Ayer</button>` });
  const box = s.body.querySelector('.cal');
  const render = () => {
    const first = parseISO(month);
    const lead = (first.getDay() + 6) % 7;
    const start = addDays(month, -lead);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const inMonth = d.slice(0, 7) === month.slice(0, 7);
      if (i >= 35 && !inMonth && cells.length >= 35) break;
      const mk = marks ? marks(d) : null;
      const dis = d > maxD;
      cells.push(`<button class="cal-d ${inMonth ? '' : 'out'} ${d === value ? 'sel' : ''} ${d === today ? 'tod' : ''}" data-d="${d}" ${dis ? 'disabled' : ''}>
        <span>${parseISO(d).getDate()}</span>${mk ? `<i class="dot ${mk}"></i>` : ''}</button>`);
    }
    const m = parseISO(month);
    box.innerHTML = `
      <div class="cal-head">
        <button class="icon-btn" data-nav="-1" aria-label="Mes anterior">${icon('left')}</button>
        <strong>${cap(MESES[m.getMonth()])} ${m.getFullYear()}</strong>
        <button class="icon-btn" data-nav="1" aria-label="Mes siguiente" ${addMonths(month, 1) > maxD ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      <div class="cal-w">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="cal-g">${cells.join('')}</div>
      ${marks ? '<div class="cal-legend"><span><i class="dot meta"></i>en meta</span><span><i class="dot cerca"></i>cerca</span><span><i class="dot bajo"></i>bajo</span></div>' : ''}`;
  };
  render();
  box.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { month = addMonths(month, Number(nav.dataset.nav)); render(); return; }
    const d = e.target.closest('[data-d]');
    if (d && !d.disabled) { vibrate(8); s.close(d.dataset.d); }
  });
  // deslizar entre meses
  let x0 = null;
  box.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  box.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) { const nm = addMonths(month, dx < 0 ? 1 : -1); if (nm <= maxD) { month = nm; render(); } }
  });
  s.foot.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    s.close(b.dataset.go === 'today' ? today : addDays(today, -1));
  });
  return s.done.then((v) => v || null);
}

// ---------- Utilidades de interacción ----------
export function onLongPress(el, fn, ms = 520) {
  let t = null;
  el.addEventListener('pointerdown', (e) => { t = setTimeout(() => { t = null; vibrate(20); fn(e); }, ms); });
  const cancel = () => { if (t) { clearTimeout(t); t = null; } };
  el.addEventListener('pointerup', cancel); el.addEventListener('pointerleave', cancel); el.addEventListener('pointercancel', cancel);
}

export function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.classList.add('busy'); if (text) btn.innerHTML = `<span class="spin"></span><span>${esc(text)}</span>`; }
  else { btn.disabled = false; btn.classList.remove('busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export { isoDate };
