// WTFScore - page chrome, built with createElement and textContent only: one
// quiet header line with the single Menu button, the choice lists the Menu
// offers, and the developer-only diagnostics list (created only when
// diagnostics are switched on).

import { buildGameControls } from './header.mjs';

export const TEXT_SIZES = Object.freeze([
  Object.freeze({ value: 'standard', label: 'Standard', scale: 7 }),
  Object.freeze({ value: 'large', label: 'Large', scale: 8 }),
  Object.freeze({ value: 'larger', label: 'Larger', scale: 9 }),
  Object.freeze({ value: 'largest', label: 'Largest', scale: 10 }),
]);

export const OPEN_LIMITS = Object.freeze([1, 2, 3, 4, 5, 6]);

export const ORDERS = Object.freeze([
  Object.freeze({ value: 'kickoff', label: 'Start time' }),
  Object.freeze({ value: 'status', label: 'Live games first' }),
]);

export const BADGE_CHOICES = Object.freeze([
  Object.freeze({ value: 'off', label: 'Off' }),
  Object.freeze({ value: 'on', label: 'Local generated' }),
]);

export const DIAG_LINES = Object.freeze(['mode', 'counts', 'settings', 'last', 'timing', 'focus', 'layout', 'visible', 'bounds', 'model']);

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

export function buildHeader(doc, { title, simulatedNote }) {
  const root = el(doc, 'header', 'head');
  root.id = 'head';
  const titleEl = el(doc, 'span', 'head-title sr-only', title);
  titleEl.setAttribute('role', 'heading');
  titleEl.setAttribute('aria-level', '1');
  const sim = el(doc, 'span', 'head-sim', 'SIMULATED');
  sim.title = simulatedNote;
  const btn = el(doc, 'button', 'menu-btn', 'Menu');
  btn.type = 'button';
  btn.id = 'menu-btn';
  btn.tabIndex = 0; // set explicitly so Safari's default Tab order includes it
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'menu');
  root.appendChild(titleEl);
  const controls = buildGameControls(doc, root, btn);
  root.appendChild(sim);
  root.appendChild(btn);
  return Object.assign(controls, { root, title: titleEl, sim, menuBtn: btn });
}

export function buildDiagnostics(doc) {
  const root = el(doc, 'section', 'diag');
  root.id = 'diag';
  root.setAttribute('aria-label', 'Developer diagnostics');
  const list = el(doc, 'ul', 'diag-lines');
  const lines = new Map();
  for (const key of DIAG_LINES) {
    const li = el(doc, 'li', 'diag-line');
    li.id = `diag-${key}`;
    li.setAttribute('data-key', key);
    list.appendChild(li);
    lines.set(key, li);
  }
  root.appendChild(list);
  return { root, lines };
}
