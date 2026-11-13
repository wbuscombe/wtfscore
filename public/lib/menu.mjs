// WTFScore - the one Menu: a scrollable pull-up sheet holding every board
// choice and display setting as a native, labelled <select>, plus the
// screen-name field. Built with createElement and textContent only. The
// controller fills the options; this module only builds and repopulates.
// In a daily league's regular season a Date button, styled like the
// dropdowns, shows the chosen date and is the one way to open the month
// calendar; the Period dropdown then holds Regular season and the named rounds.


export const SCREEN_NAME_MAX = 32;

// Board choices in DOM order. Every league's filters appear in this relative
// order, so a parent control always sits above the controls it narrows:
// Sport, then League, then Season and Week, Date or round.
export const BOARD_KEYS = Object.freeze([]);
export const DISPLAY_KEYS = Object.freeze(['textSize', 'order', 'openLimit', 'zone', 'badges', 'presentation']);
const LABELS = Object.freeze({
  sport: 'Sport', league: 'League', season: 'Season', period: 'Week or round', date: 'Date', subleague: 'AL / NL', subdivision: 'Subdivision', conference: 'Conference', division: 'Division',
  ranking: 'Ranking', tournament: 'Tournament', round: 'Round', favorites: 'Favorite teams', textSize: 'Text size', order: 'Order', openLimit: 'Games open at once', zone: 'Time zone',
  badges: 'Team badges', presentation: 'Presentation', screen: 'Screen',
});

// Control and bidirectional-override characters never reach the title or the
// page; the name is trimmed to SCREEN_NAME_MAX characters.
const UNSAFE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const hex4 = (n) => n.toString(16).padStart(4, '0');
const UNSAFE = new RegExp(`[${UNSAFE_RANGES.map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join('')}]`, 'g');
export function sanitizeScreenName(raw, fallback) {
  const clean = String(raw ?? '').replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  const cut = Array.from(clean).slice(0, SCREEN_NAME_MAX).join('').trim();
  return cut || fallback;
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

const SIGS = new WeakMap();

// groups: [{ label|null, options: [{ value, label }] }]. Options are rebuilt
// only when the list itself changes, so choosing a value never replaces the
// control the person is using.
export function setOptions(doc, select, groups, value) {
  const sig = JSON.stringify(groups.map((g) => [g.label || '', g.options.map((o) => [o.value, o.label])]));
  if (SIGS.get(select) !== sig) {
    for (const c of [...select.childNodes]) select.removeChild(c);
    for (const g of groups) {
      if (!g.options.length) continue;
      const parent = g.label ? el(doc, 'optgroup') : select;
      if (g.label) {
        parent.setAttribute('label', g.label);
        select.appendChild(parent);
      }
      for (const o of g.options) {
        const opt = el(doc, 'option', null, o.label);
        opt.value = o.value;
        parent.appendChild(opt);
      }
    }
    SIGS.set(select, sig);
  }
  for (const opt of optionsOf(select)) opt.selected = opt.value === value;
  select.value = value;
}

export function optionsOf(select) {
  const out = [];
  for (const c of select.children) {
    if (c.tagName === 'OPTION') out.push(c);
    else if (c.tagName === 'OPTGROUP') for (const o of c.children) if (o.tagName === 'OPTION') out.push(o);
  }
  return out;
}

function row(doc, key, parts) {
  const r = el(doc, 'div', 'mrow');
  r.setAttribute('data-row', key);
  const label = el(doc, 'label', 'mlabel', LABELS[key]);
  label.setAttribute('for', `menu-${key}`);
  label.id = `menu-${key}-label`;
  const select = el(doc, 'select', 'msel');
  select.id = `menu-${key}`;
  select.name = key;
  select.tabIndex = 0;
  select.setAttribute('data-key', key);
  r.appendChild(label);
  r.appendChild(select);
  parts.rows.set(key, r);
  parts.labels.set(key, label);
  parts.selects.set(key, select);
  return r;
}

// The sheet starts hidden: while hidden it is out of the tab order and the
// accessibility tree (the stylesheet's first rule keeps [hidden] undisplayed).
export function buildMenu(doc) {
  const scrim = el(doc, 'div', 'scrim');
  scrim.id = 'menu-scrim';
  scrim.hidden = true;
  const sheet = el(doc, 'section', 'sheet');
  sheet.id = 'menu';
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'menu-title');
  sheet.setAttribute('aria-describedby', 'menu-context');
  const head = el(doc, 'div', 'sheet-head');
  const title = el(doc, 'h2', 'sheet-title', 'Menu');
  title.id = 'menu-title';
  const close = el(doc, 'button', 'sheet-close', 'Close');
  close.type = 'button';
  close.tabIndex = 0;
  close.setAttribute('aria-label', 'Close menu');
  head.appendChild(title);
  head.appendChild(close);
  sheet.appendChild(head);
  const context = el(doc, 'p', 'mcontext');
  context.id = 'menu-context';
  sheet.appendChild(context);
  const summary = el(doc, 'p', 'msummary');
  summary.id = 'menu-summary';
  sheet.appendChild(summary);

  const parts = { rows: new Map(), labels: new Map(), selects: new Map() };
  const group = (name) => {
    const g = el(doc, 'div', 'mgroup');
    const h = el(doc, 'h3', 'mhead', name);
    g.appendChild(h);
    sheet.appendChild(g);
    return g;
  };
  const scores = group('Scores');
  // 010: football favorite teams, one labelled native dropdown. Hidden until
  // the board fills it (NFL and NCAAF only).
  const favRow = row(doc, 'favorites', parts);
  favRow.hidden = true;
  scores.appendChild(favRow);
  const clear = el(doc, 'button', 'mbtn', 'Clear filters');
  clear.type = 'button';
  clear.id = 'menu-clear';
  clear.tabIndex = 0;
  scores.appendChild(clear);
  const display = group('Display');
  for (const key of DISPLAY_KEYS) display.appendChild(row(doc, key, parts));
  const screens = group('Screen');
  screens.appendChild(row(doc, 'screen', parts));
  const nameRow = el(doc, 'div', 'mrow');
  nameRow.setAttribute('data-row', 'screenName');
  const nameLabel = el(doc, 'label', 'mlabel', 'Screen name');
  nameLabel.setAttribute('for', 'menu-screen-name');
  const name = el(doc, 'input', 'mtext');
  name.type = 'text';
  name.id = 'menu-screen-name';
  name.name = 'screenName';
  name.tabIndex = 0;
  name.setAttribute('maxlength', String(SCREEN_NAME_MAX));
  name.setAttribute('autocomplete', 'off');
  name.setAttribute('spellcheck', 'false');
  name.setAttribute('data-key', 'screenName');
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(name);
  screens.appendChild(nameRow);
  screens.appendChild(el(doc, 'p', 'mnote', 'Two demo screens, each with its own choices, kept in this tab only. Nothing is saved: reloading the page resets both screens.'));
  sheet.appendChild(el(doc, 'p', 'mnote msim', 'SIMULATED demo: every league board here uses invented teams, players, schedules, groups and ranks at a fixed simulated time. No live data and no real memberships.'));
  return { scrim, sheet, closeBtn: close, title, context, summary, clearBtn: clear, nameInput: name, ...parts };
}
