// WTFScore - the Date calendar in the Menu: one month at a time, Sunday
// first, six weeks so neighbouring days show too. Days with games carry a dot
// and each day's label says how many games; today and the chosen day get
// borders and are named in the label too. Pure date helpers plus a builder
// that uses createElement and textContent only; the board owns the state and
// the handlers.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n) => String(n).padStart(2, '0');

export const keyOf = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
};
export function partsOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}
export const addDays = (key, n) => {
  const { y, m, d } = partsOf(key);
  return keyOf(y, m, d + n);
};
export function addMonths({ y, m }, n) {
  const i = y * 12 + (m - 1) + n;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (key) => {
  const { y, m, d } = partsOf(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
export const monthTitle = ({ y, m }) => `${MONTHS[m - 1]} ${y}`;

// 42 date keys: the Sunday on or before the 1st, then six whole weeks.
export function monthGrid({ y, m }) {
  const first = keyOf(y, m, 1);
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// The same day in another month, kept inside that month (Jan 31 -> Feb 28 or 29).
function sameDayIn(key, n) {
  const { y, m, d } = partsOf(key);
  const to = addMonths({ y, m }, n);
  return keyOf(to.y, to.m, Math.min(d, daysIn(to.y, to.m)));
}

// Keyboard moves on the grid; null for a key the grid does not use.
export function moveKey(key, name) {
  switch (name) {
    case 'ArrowLeft': return addDays(key, -1);
    case 'ArrowRight': return addDays(key, 1);
    case 'ArrowUp': return addDays(key, -7);
    case 'ArrowDown': return addDays(key, 7);
    case 'Home': return addDays(key, -weekday(key));
    case 'End': return addDays(key, 6 - weekday(key));
    case 'PageUp': return sameDayIn(key, -1);
    case 'PageDown': return sameDayIn(key, 1);
    default: return null;
  }
}

export function dayWords(key) {
  const { y, m, d } = partsOf(key);
  return `${WEEKDAYS[weekday(key)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function navButton(doc, cls, text, action, label) {
  const b = el(doc, 'button', cls, text);
  b.type = 'button';
  b.tabIndex = 0;
  b.setAttribute('data-cal', action);
  if (label) b.setAttribute('aria-label', label);
  return b;
}

// Starts hidden; the board fills it with render() before showing it.
export function buildCalendar(doc) {
  const root = el(doc, 'div', 'cal');
  root.id = 'menu-calendar';
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-labelledby', 'menu-calendar-title');
  const head = el(doc, 'div', 'cal-head');
  const prev = navButton(doc, 'cal-nav', '◀', 'prev', 'Previous month');
  const title = el(doc, 'h3', 'cal-title');
  title.id = 'menu-calendar-title';
  title.setAttribute('aria-live', 'polite');
  const next = navButton(doc, 'cal-nav', '▶', 'next', 'Next month');
  head.appendChild(prev);
  head.appendChild(title);
  head.appendChild(next);
  root.appendChild(head);
  const grid = el(doc, 'table', 'cal-grid');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-labelledby', 'menu-calendar-title');
  const thead = el(doc, 'thead');
  const hr = el(doc, 'tr');
  for (const w of WEEKDAYS) {
    const th = el(doc, 'th', 'cal-wd', w.slice(0, 2));
    th.setAttribute('scope', 'col');
    th.setAttribute('abbr', w);
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  grid.appendChild(thead);
  const tbody = el(doc, 'tbody');
  const cells = [];
  for (let r = 0; r < 6; r++) {
    const tr = el(doc, 'tr');
    for (let c = 0; c < 7; c++) {
      const td = el(doc, 'td', 'cal-cell');
      td.setAttribute('role', 'gridcell');
      const b = el(doc, 'button', 'cal-day');
      b.type = 'button';
      b.tabIndex = -1;
      const num = el(doc, 'span', 'cal-num', '');
      const mark = el(doc, 'span', 'cal-mark', '');
      mark.setAttribute('aria-hidden', 'true');
      b.appendChild(num);
      b.appendChild(mark);
      td.appendChild(b);
      tr.appendChild(td);
      cells.push({ td, button: b, num, mark });
    }
    tbody.appendChild(tr);
  }
  grid.appendChild(tbody);
  const scroll = el(doc, 'div', 'cal-scroll');
  scroll.appendChild(grid);
  root.appendChild(scroll);
  const foot = el(doc, 'div', 'cal-foot');
  const today = navButton(doc, 'mbtn cal-today', 'Today', 'today', null);
  const close = navButton(doc, 'mbtn cal-close', 'Close calendar', 'close', null);
  foot.appendChild(today);
  foot.appendChild(close);
  root.appendChild(foot);
  root.appendChild(el(doc, 'p', 'mnote', '• marks a day with games. Arrow keys move by day and week, Page Up and Page Down by month, Escape or Back closes.'));
  return { root, title, grid, scroll, prev, next, today, close, cells };
}

const setFlag = (e, cls, on) => {
  const list = String(e.className || '').split(/\s+/).filter((c) => c && c !== cls);
  if (on) list.push(cls);
  e.className = list.join(' ');
};

// state: { month: { y, m }, focus, selected, today, counts: Map(key -> games) }
export function renderCalendar(cal, state) {
  const keys = monthGrid(state.month);
  const t = monthTitle(state.month);
  if (cal.title.textContent !== t) cal.title.textContent = t;
  keys.forEach((key, i) => {
    const c = cal.cells[i];
    const { m, d } = partsOf(key);
    const n = state.counts ? state.counts.get(key) ?? 0 : 0;
    const inMonth = m === state.month.m;
    c.button.setAttribute('data-key', key);
    if (c.num.textContent !== String(d)) c.num.textContent = String(d);
    c.mark.textContent = n ? '•' : '';
    setFlag(c.button, 'other', !inMonth);
    setFlag(c.button, 'has', n > 0);
    setFlag(c.button, 'today', key === state.today);
    setFlag(c.button, 'sel', key === state.selected);
    const words = [dayWords(key), n ? `${n} game${n === 1 ? '' : 's'}` : 'no games'];
    if (key === state.today) words.push('today');
    if (key === state.selected) words.push('selected');
    c.button.setAttribute('aria-label', words.join(', '));
    c.td.setAttribute('aria-selected', key === state.selected ? 'true' : 'false');
    c.button.tabIndex = key === state.focus ? 0 : -1;
  });
  return keys;
}
