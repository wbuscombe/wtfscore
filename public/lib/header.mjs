// Foreground game selectors. Closed buttons navigate like the board; only an
// explicitly opened, labelled listbox changes its active option.
import { buildCalendar } from './calendar.mjs';

const KEYS = ['league', 'period', 'subleague', 'subdivision', 'conference', 'division', 'ranking', 'tournament', 'round'];
const BACK = new Set(['Escape', 'Esc', 'GoBack', 'BrowserBack']);
const SELECT = new Set(['Enter', ' ', 'Spacebar', 'Select']);
function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Popup geometry is relative to the invoker, but both edges stay in the safe
// viewport. Right-aligning to a narrow button alone can put a wide panel offscreen.
export function fitHeaderPanel(anchor, panelWidth, viewport) {
  const width = Math.min(panelWidth, viewport.w * .9);
  const left = Math.max(viewport.w * .05, Math.min(anchor.left, viewport.w * .95 - width));
  return { left: left - anchor.left, maxHeight: Math.max(100, viewport.h * .95 - anchor.bottom - 4) };
}

export function buildGameControls(doc, root, menuBtn) {
  const strip = el(doc, 'div', 'header-controls');
  const pickers = new Map();
  const rows = new Map();
  const labels = new Map();
  let opened = null;
  let choose = () => {};
  let down = () => {};
  let dailyOpen = () => {};
  let dailyClose = () => {};
  let daily = false;
  let dailyShown = false;

  function fit(panel, button) {
    const win = doc.defaultView;
    if (!win || !button.getBoundingClientRect) return;
    const b = button.getBoundingClientRect();
    panel.style.setProperty('max-width', `${win.innerWidth * .9}px`);
    panel.style.setProperty('left', '0px');
    panel.style.setProperty('right', 'auto');
    const box = fitHeaderPanel(b, panel.getBoundingClientRect().width, { w: win.innerWidth, h: win.innerHeight });
    panel.style.setProperty('left', `${box.left}px`);
    panel.style.setProperty('max-height', `${box.maxHeight}px`);
  }
  function revealInPanel(node) {
    if (!node || !node.getBoundingClientRect || !periodPanel.getBoundingClientRect) return;
    const box = periodPanel.getBoundingClientRect(), r = node.getBoundingClientRect();
    if (r.top < box.top + 6) periodPanel.scrollTop += r.top - box.top - 6;
    else if (r.bottom > box.bottom - 6) periodPanel.scrollTop += r.bottom - box.bottom + 6;
    if (r.left < box.left + 6) periodPanel.scrollLeft = (periodPanel.scrollLeft || 0) + r.left - box.left - 6;
    else if (r.right > box.right - 6) periodPanel.scrollLeft = (periodPanel.scrollLeft || 0) + r.right - box.right + 6;
  }
  function close(refocus = true) {
    const p = opened;
    opened = null;
    if (!p) return false;
    p.list.hidden = true;
    p.button.setAttribute('aria-expanded', 'false');
    if (refocus) p.button.focus({ preventScroll: true });
    return true;
  }
  function closeAll(refocus = true) {
    const had = close(refocus);
    if (dailyShown) dailyClose(refocus);
    return had;
  }
  function active(p, index) {
    if (!p.options.length) return;
    p.index = Math.max(0, Math.min(p.options.length - 1, index));
    for (let i = 0; i < p.options.length; i++) p.options[i].tabIndex = i === p.index ? 0 : -1;
    const option = p.options[p.index];
    option.focus({ preventScroll: true });
    // Scroll the options panel alone, never the board behind it.
    if (Number.isFinite(option.offsetTop) && p.list.clientHeight) {
      if (option.offsetTop < p.list.scrollTop) p.list.scrollTop = option.offsetTop;
      const bottom = option.offsetTop + option.offsetHeight;
      if (bottom > p.list.scrollTop + p.list.clientHeight) p.list.scrollTop = bottom - p.list.clientHeight;
    }
  }
  function open(p) {
    if (p.key === 'period' && daily) { dailyOpen(); return; }
    if (opened === p) { close(true); return; }
    closeAll(false);
    opened = p;
    p.list.hidden = false;
    p.button.setAttribute('aria-expanded', 'true');
    fit(p.list, p.button);
    active(p, Math.max(0, p.options.findIndex(o => o.getAttribute('data-value') === p.selected)));
  }
  function commit(p, value) {
    close(false);
    choose(p.key, value);
    p.button.focus({ preventScroll: true });
  }
  for (const key of KEYS) {
    const row = el(doc, 'div', 'header-choice');
    row.hidden = true;
    row.setAttribute('data-header-row', key);
    const label = el(doc, 'span', 'sr-only', key);
    label.id = `header-${key}-label`;
    const button = el(doc, 'button', 'header-picker');
    button.type = 'button';
    button.tabIndex = 0;
    button.id = `header-${key}`;
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `header-${key}-options`);
    const list = el(doc, 'div', 'header-options');
    list.id = `header-${key}-options`;
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', label.id);
    row.appendChild(label);
    row.appendChild(button);
    row.appendChild(list);
    strip.appendChild(row);
    const p = { key, row, label, button, list, options: [], selected: null, index: 0, signature: '' };
    pickers.set(key, p); rows.set(key, row); labels.set(key, label);
    button.addEventListener('click', () => open(p));
    button.addEventListener('keydown', e => {
      if (!SELECT.has(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) open(p);
    });
    list.addEventListener('click', e => {
      const o = e.target.closest('[role="option"]');
      if (o && list.contains(o)) { e.stopPropagation(); commit(p, o.getAttribute('data-value')); }
    });
    list.addEventListener('keydown', e => {
      e.stopPropagation();
      if (BACK.has(e.key)) { e.preventDefault(); close(true); }
      else if (SELECT.has(e.key)) { e.preventDefault(); if (!e.repeat) commit(p, p.options[p.index].getAttribute('data-value')); }
      else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        active(p, e.key === 'Home' ? 0 : e.key === 'End' ? p.options.length - 1 : p.index + (e.key === 'ArrowUp' ? -1 : 1));
      } else if (e.key === 'Tab') close(false);
    });
  }
  root.appendChild(strip);
  const periodPanel = el(doc, 'section', 'header-options header-period-panel');
  periodPanel.id = 'header-period-panel'; periodPanel.hidden = true;
  periodPanel.setAttribute('role', 'dialog'); periodPanel.setAttribute('aria-label', 'Date, season and rounds');
  const phases = el(doc, 'div', 'header-phases');
  const calendar = buildCalendar(doc);
  calendar.root.id = 'header-calendar';
  calendar.title.id = 'header-calendar-title';
  calendar.root.setAttribute('aria-labelledby', calendar.title.id);
  calendar.grid.setAttribute('aria-labelledby', calendar.title.id);
  periodPanel.appendChild(phases); periodPanel.appendChild(calendar.root);
  rows.get('period').appendChild(periodPanel);
  periodPanel.addEventListener('click', e => {
    const b = e.target.closest('[data-period]') || e.target.closest('[data-season]');
    if (!b || !phases.contains(b)) return;
    e.stopPropagation();
    const season = b.getAttribute('data-season');
    const value = b.getAttribute('data-period');
    dailyClose(false);
    choose(season ? 'season' : 'period', season || value);
    pickers.get('period').button.focus({ preventScroll: true });
  });
  periodPanel.addEventListener('keydown', e => {
    if (BACK.has(e.key)) { e.preventDefault(); e.stopPropagation(); dailyClose(true); }
    else if (e.key === 'Select' && phases.contains(e.target)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) e.target.click(); }
    else if (e.key === 'Tab') {
      const buttons = [...periodPanel.querySelectorAll('button')].filter(x => !x.hidden && x.tabIndex !== -1);
      if (!buttons.length) return;
      const i = buttons.indexOf(doc.activeElement);
      if ((!e.shiftKey && i === buttons.length - 1) || (e.shiftKey && i === 0)) { e.preventDefault(); const target = buttons[e.shiftKey ? buttons.length - 1 : 0]; target.focus({ preventScroll: true }); revealInPanel(target); }
    }
  });

  function visibleButtons() { return [...pickers.values()].filter(p => !p.row.hidden).map(p => p.button).concat(menuBtn); }
  root.addEventListener('keydown', e => {
    if (opened || dailyShown) return;
    const bs = visibleButtons(); const i = bs.indexOf(e.target);
    if (i < 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); bs[Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)))].focus({ preventScroll: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); down(e.target); }
  });
  doc.addEventListener('click', e => {
    if (opened && !opened.row.contains(e.target)) close(true);
    if (dailyShown && !rows.get('period').contains(e.target)) dailyClose(true);
  });

  function setPicker(key, { label, groups, value, text = null, visible = true }) {
    const p = pickers.get(key);
    if (!visible) { if (opened === p) close(false); p.row.hidden = true; return; }
    const sig = JSON.stringify(groups);
    if (p.signature !== sig) {
      for (const c of [...p.list.childNodes]) p.list.removeChild(c);
      p.options = [];
      groups.forEach((g, gi) => {
        if (!g.options.length) return;
        const group = el(doc, 'div', 'header-option-group');
        if (g.label) {
          group.setAttribute('role', 'group'); group.setAttribute('aria-label', g.label);
          group.appendChild(el(doc, 'div', 'header-group-label', g.label));
        }
        g.options.forEach((o, oi) => {
          const b = el(doc, 'button', 'header-option', o.label);
          b.type = 'button'; b.tabIndex = -1; b.id = `header-${key}-option-${gi}-${oi}`;
          b.value = o.value; b.setAttribute('role', 'option'); b.setAttribute('data-value', o.value);
          group.appendChild(b); p.options.push(b);
        });
        p.list.appendChild(group);
      });
      p.signature = sig;
    }
    p.selected = value; p.button.value = value;
    const chosen = p.options.find(o => o.getAttribute('data-value') === value);
    p.label.textContent = label;
    p.button.textContent = text || (chosen ? chosen.textContent : label);
    p.button.setAttribute('aria-label', `${label}, ${p.button.textContent}`);
    for (const o of p.options) o.setAttribute('aria-selected', o.getAttribute('data-value') === value ? 'true' : 'false');
    p.row.hidden = false;
  }
  function setDaily(on, seasons, periods, seasonId, periodId) {
    daily = on;
    const p = pickers.get('period');
    p.button.setAttribute('aria-haspopup', on ? 'dialog' : 'listbox');
    p.button.setAttribute('aria-controls', on ? periodPanel.id : p.list.id);
    if (!on) { if (dailyShown) dailyClose(false); return; }
    for (const c of [...phases.childNodes]) phases.removeChild(c);
    const group = (name, choices, attr) => {
      const g = el(doc, 'div', 'header-phase-group'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', name);
      g.appendChild(el(doc, 'h3', 'header-group-label', name));
      for (const o of choices) {
        const b = el(doc, 'button', 'mbtn', o.label); b.type = 'button'; b.tabIndex = 0; b.setAttribute(attr, o.value);
        b.setAttribute('aria-pressed', String(attr === 'data-season' ? o.value === seasonId : o.value === periodId || (o.value === 'regular' && /^d\d{4}-\d{2}-\d{2}$/.test(periodId))));
        g.appendChild(b);
      }
      phases.appendChild(g);
    };
    group('Season', [...seasons].sort((a,b) => Number(Boolean(b.current)) - Number(Boolean(a.current))).map(s => ({ value: s.id, label: s.label })), 'data-season');
    group('Regular season', [{ value: 'regular', label: 'Regular season' }], 'data-period');
    group('Rounds', periods.filter(p => p.phase !== 'regular').map(p => ({ value: p.id, label: p.label })), 'data-period');
  }
  return {
    strip, pickers, rows, labels, periodPanel, calendar, phases, setPicker, setDaily, closeAll, revealInPanel,
    configure(handlers) { choose = handlers.choose; down = handlers.down; dailyOpen = handlers.openCalendar; dailyClose = handlers.closeCalendar; },
    get anyOpen() { return Boolean(opened || dailyShown); },
    showDaily() { close(false); dailyShown = true; periodPanel.hidden = false; pickers.get('period').button.setAttribute('aria-expanded', 'true'); fit(periodPanel, pickers.get('period').button); },
    hideDaily(refocus) { dailyShown = false; periodPanel.hidden = true; pickers.get('period').button.setAttribute('aria-expanded', 'false'); if (refocus) pickers.get('period').button.focus({ preventScroll: true }); },
    layout() {
      if (opened) { fit(opened.list, opened.button); active(opened, opened.index); }
      if (dailyShown) { fit(periodPanel, pickers.get('period').button); if (periodPanel.contains(doc.activeElement)) revealInPanel(doc.activeElement); }
    },
    focusNearest(x) {
      const bs = visibleButtons();
      const center = (b, i) => b.getBoundingClientRect ? b.getBoundingClientRect().x + b.getBoundingClientRect().width / 2 : i * 120 + 60;
      const b = bs.reduce((a,b,i) => Math.abs(center(b,i)-x)<Math.abs(center(a,bs.indexOf(a))-x)?b:a,bs[0]);
      if (b) b.focus({ preventScroll: true });
      const win = doc.defaultView;
      if (win && root.getBoundingClientRect && win.scrollBy) {
        const top = root.getBoundingClientRect().top;
        if (top < 8) win.scrollBy(0, top - 8);
      }
    },
  };
}
