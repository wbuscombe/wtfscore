// Minimal fake DOM for Node tests. HTML-parsing sinks throw, so code that
// touched them would fail loudly. It models only what the board uses: element
// trees, attributes, classes, styles, bubbling events, focus that respects
// hidden and inert subtrees (as the stylesheet's [hidden] rule and the inert
// attribute do in a browser), and a window whose frames and timers are counted.
// It is a model for behaviour tests, not a browser.
// A window may carry a fixed clock (new FakeWindow({ now })) so date
// anchoring is tested at chosen instants, never at the wall clock; events may
// carry `detail` (0 for a click a key or remote produced); elements have a
// scrollTop the TV details window moves.
// A window made with { blurOnMove: true } models the browser rule that an
// element moved out of and back into the document loses focus, so a reorder
// must give focus back itself. Off by default: earlier tests keep their model.

const NATIVE_FOCUSABLE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);

export class FakeStyle {
  constructor() {
    this.props = new Map();
    this.writes = 0;
  }
  setProperty(k, v) {
    this.writes++;
    this.props.set(k, String(v));
  }
  getPropertyValue(k) {
    return this.props.get(k) ?? '';
  }
  removeProperty(k) {
    this.props.delete(k);
  }
}

class FakeText {
  constructor(t) {
    this.nodeType = 3;
    this.data = String(t);
    this.parentNode = null;
  }
  get textContent() {
    return this.data;
  }
  get nodeValue() {
    return this.data;
  }
}

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.key = init.key;
    this.repeat = Boolean(init.repeat);
    this.detail = init.detail;
    this.timeStamp = init.timeStamp ?? 0;
    this.target = null;
    this.currentTarget = null;
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this.listeners.get(type);
    if (l) this.listeners.set(type, l.filter((f) => f !== fn));
  }
  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }
  fire(evt) {
    for (const fn of [...(this.listeners.get(evt.type) || [])]) {
      evt.currentTarget = this;
      fn.call(this, evt);
    }
  }
}

const SELECTOR_PART = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;

// Compound simple selectors only (tag, #id, .class, [attr], [attr="v"]).
function parseSelector(sel) {
  const s = String(sel).trim();
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let consumed = 0;
  SELECTOR_PART.lastIndex = 0;
  let m;
  while ((m = SELECTOR_PART.exec(s)) !== null) {
    if (m.index !== consumed) break;
    consumed += m[0].length;
    if (m[1]) out.tag = m[1].toUpperCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else out.attrs.push([m[4], m[5]]);
  }
  if (consumed !== s.length || s.length === 0) throw new Error(`fake DOM supports compound selectors only: ${s}`);
  return out;
}

class FakeClassList {
  constructor(el) {
    this.el = el;
  }
  list() {
    return String(this.el.className || '').split(/\s+/).filter(Boolean);
  }
  contains(c) {
    return this.list().includes(c);
  }
  add(...cs) {
    const l = this.list();
    for (const c of cs) if (!l.includes(c)) l.push(c);
    this.el.className = l.join(' ');
  }
  remove(...cs) {
    this.el.className = this.list().filter((c) => !cs.includes(c)).join(' ');
  }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : Boolean(force);
    if (on) this.add(c);
    else this.remove(c);
    return on;
  }
}

export class FakeElement extends FakeTarget {
  constructor(tag, doc = null) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.childNodes = [];
    this.attributes = new Map();
    this.style = new FakeStyle();
    this.className = '';
    this.title = '';
    this.type = '';
    this.id = '';
    this.name = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.focusCalls = 0;
    this.scrollTop = 0;
  }
  get parentElement() {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }
  get hidden() {
    return this.attributes.has('hidden');
  }
  set hidden(v) {
    if (v) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }
  get inert() {
    return this.attributes.has('inert');
  }
  set inert(v) {
    if (v) this.attributes.set('inert', '');
    else this.attributes.delete('inert');
  }
  get tabIndex() {
    if (this.attributes.has('tabindex')) return Number(this.attributes.get('tabindex'));
    return NATIVE_FOCUSABLE.has(this.tagName) ? 0 : -1;
  }
  set tabIndex(v) {
    this.attributes.set('tabindex', String(Math.trunc(Number(v))));
  }
  get classList() {
    return new FakeClassList(this);
  }
  appendChild(child) {
    const doc = this.ownerDocument;
    if (doc && doc.blurOnMove && child.parentNode && child instanceof FakeElement && doc.activeElement && doc.activeElement !== doc.body && child.contains(doc.activeElement)) {
      const lost = doc.activeElement;
      doc.activeElement = doc.body;
      lost.dispatchEvent(new FakeEvent('focusout'));
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    if (child instanceof FakeElement) this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.childNodes = this.childNodes.filter((n) => n !== child);
    this.children = this.children.filter((n) => n !== child);
    child.parentNode = null;
    return child;
  }
  setAttribute(k, v) {
    if (String(k).toLowerCase().startsWith('on')) throw new Error(`event-handler attribute ${k} must not be set`);
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  hasAttribute(k) {
    return this.attributes.has(k);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    const t = new FakeText(v);
    t.parentNode = this;
    this.childNodes = [t];
    this.children = [];
  }
  get innerHTML() {
    throw new Error('innerHTML must not be read');
  }
  set innerHTML(_v) {
    throw new Error('innerHTML must not be written');
  }
  get outerHTML() {
    throw new Error('outerHTML must not be used');
  }
  set outerHTML(_v) {
    throw new Error('outerHTML must not be used');
  }
  insertAdjacentHTML() {
    throw new Error('insertAdjacentHTML must not be used');
  }
  matches(sel) {
    const p = parseSelector(sel);
    if (p.tag && p.tag !== this.tagName) return false;
    if (p.id && p.id !== this.id) return false;
    for (const c of p.classes) if (!this.hasClass(c)) return false;
    for (const [k, v] of p.attrs) {
      if (!this.attributes.has(k)) return false;
      if (v !== undefined && this.attributes.get(k) !== v) return false;
    }
    return true;
  }
  closest(sel) {
    for (let e = this; e instanceof FakeElement; e = e.parentNode) if (e.matches(sel)) return e;
    return null;
  }
  querySelectorAll(sel) {
    return [...this.walk()].filter((e) => e !== this && e.matches(sel));
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n instanceof FakeDocument;
  }
  // Mirrors the browser: nothing inside a hidden (display:none) or inert
  // subtree can take focus; only native controls and [tabindex] elements can.
  focusable() {
    if (this.disabled || !this.isConnected) return false;
    for (let e = this; e instanceof FakeElement; e = e.parentNode) if (e.hidden || e.inert) return false;
    return this.attributes.has('tabindex') || NATIVE_FOCUSABLE.has(this.tagName);
  }
  focus() {
    const doc = this.ownerDocument;
    this.focusCalls++;
    if (!doc || !this.focusable() || doc.activeElement === this) return;
    const prev = doc.activeElement;
    doc.activeElement = this;
    if (prev && prev !== doc.body && prev.dispatchEvent) prev.dispatchEvent(new FakeEvent('focusout'));
    this.dispatchEvent(new FakeEvent('focusin'));
  }
  blur() {
    const doc = this.ownerDocument;
    if (doc && doc.activeElement === this) {
      doc.activeElement = doc.body;
      this.dispatchEvent(new FakeEvent('focusout'));
    }
  }
  click() {
    return this.dispatchEvent(new FakeEvent('click'));
  }
  dispatchEvent(evt) {
    if (!evt.target) evt.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    const top = path[path.length - 1];
    if (top instanceof FakeDocument && top.defaultView) path.push(top.defaultView);
    for (const n of path) {
      n.fire(evt);
      if (!evt.bubbles || evt.propagationStopped) break;
    }
    return !evt.defaultPrevented;
  }
  *walk() {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
  all(pred) {
    return [...this.walk()].filter(pred);
  }
  hasClass(c) {
    return String(this.className || '').split(/\s+/).includes(c);
  }
  byClass(c) {
    return this.all((e) => e.hasClass(c));
  }
}

export class FakeDocument extends FakeTarget {
  constructor() {
    super();
    this.nodeType = 9;
    this.parentNode = null;
    this.defaultView = null;
    this.created = [];
    this.documentElement = new FakeElement('html', this);
    this.documentElement.parentNode = this;
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
    this.documentElement.clientWidth = 1280;
    this.activeElement = this.body;
    this.blurOnMove = false;
  }
  createElement(tag) {
    const e = new FakeElement(tag, this);
    this.created.push(e);
    return e;
  }
  // Explicit test-case cleanup, after creation-history assertions are recorded.
  // Keep the connected DOM and its listeners; release only inventory references.
  releaseDetachedCreatedNodes() {
    const before = this.created.length;
    this.created = this.created.filter((node) => node.isConnected);
    return before - this.created.length;
  }
  getElementById(id) {
    for (const e of this.documentElement.walk()) if (e.id === id) return e;
    return null;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  write() {
    throw new Error('document.write must not be used');
  }
}

export class FakeWindow extends FakeTarget {
  constructor({ width = 1280, height = 800, search = '', now = null, blurOnMove = false } = {}) {
    super();
    if (now !== null) this.Date = { now: () => now };
    this.document = new FakeDocument();
    this.document.defaultView = this;
    this.document.blurOnMove = Boolean(blurOnMove);
    this.document.documentElement.clientWidth = width;
    this.innerWidth = width;
    this.innerHeight = height;
    this.devicePixelRatio = 2;
    this.scrollY = 0;
    this.location = { search, pathname: '/' };
    this.frames = [];
    this.timers = [];
    this.frameCalls = 0;
    this.timerCalls = 0;
    this.scrolls = [];
    this.historyCalls = 0;
    this.marks = [];
    const self = this;
    this.history = {
      replaceState() {
        self.historyCalls++;
      },
      pushState() {
        self.historyCalls++;
      },
    };
    let clock = 1000;
    this.performance = {
      now: () => (clock += 0.125),
      mark: (n) => self.marks.push(['mark', n]),
      measure: (n) => self.marks.push(['measure', n]),
    };
  }
  requestAnimationFrame(fn) {
    this.frameCalls++;
    this.frames.push(fn);
    return this.frames.length;
  }
  setTimeout(fn) {
    this.timerCalls++;
    this.timers.push(fn);
    return this.timers.length;
  }
  clearTimeout() {}
  scrollBy(x, y) {
    this.scrolls.push([x, y]);
    this.scrollY = Math.max(0, this.scrollY + y);
  }
  resize(width, height) {
    this.innerWidth = width;
    this.innerHeight = height;
    this.document.documentElement.clientWidth = width;
    this.fire(new FakeEvent('resize', { bubbles: false }));
  }
  flush(limit = 50) {
    for (let i = 0; i < limit && (this.frames.length || this.timers.length); i++) {
      for (const fn of this.frames.splice(0)) fn(this.performance.now());
      for (const fn of this.timers.splice(0)) fn();
    }
  }
}

// Test helpers drive the actual foreground widgets, rather than adding hidden
// native selects to satisfy old Menu tests. Season and date share the period
// button; offered values below are read from its real options or dialog.
export function uiControl(app, key) {
  const native = app.menu.selects.get(key);
  if (native) return native;
  const p = app.header.pickers.get(['date', 'season'].includes(key) ? 'period' : key);
  if (!p) throw new Error(`No actual control for ${key}`);
  return p.button;
}
export function uiRow(app, key) {
  return app.menu.rows.get(key) || app.header.rows.get(['date', 'season'].includes(key) ? 'period' : key);
}
export function uiLabel(app, key) {
  return app.menu.labels.get(key) || app.header.labels.get(['date', 'season'].includes(key) ? 'period' : key);
}
export function uiOptions(app, key) {
  const native = app.menu.selects.get(key);
  if (native) {
    const out = [];
    for (const c of native.children) {
      if (c.tagName === 'OPTION') out.push(c);
      else for (const o of c.children) if (o.tagName === 'OPTION') out.push(o);
    }
    return out;
  }
  const p = app.header.pickers.get(key === 'season' ? 'period' : key);
  if (!p) throw new Error(`No actual choices for ${key}`);
  if (app.view.daily && ['season', 'period'].includes(key)) {
    const attr = key === 'season' ? 'data-season' : 'data-period';
    return app.header.phases.querySelectorAll('button').filter(b => b.hasAttribute(attr)).map(node => ({ node, value: node.getAttribute(attr), textContent: node.textContent, selected: node.getAttribute('aria-pressed') === 'true' }));
  }
  if (key === 'season') {
    const seen = new Set();
    return p.options.filter(node => { const id = node.value.split('|')[0]; if (seen.has(id)) return false; seen.add(id); return true; }).map(node => ({ node, value: node.value.split('|')[0], textContent: node.parentNode.getAttribute('aria-label').split(' · ')[0], selected: node.value.split('|')[0] === p.button.value.split('|')[0] }));
  }
  return p.options.filter(node => key !== 'period' || node.value.split('|')[0] === p.button.value.split('|')[0]).map(node => ({ node, value: key === 'period' ? node.value.split('|')[1] : node.value, textContent: node.textContent, selected: node.getAttribute('aria-selected') === 'true' }));
}
export function uiValue(app, key) {
  if (key === 'season') return uiOptions(app, key).find(o => o.selected).value;
  const value = uiControl(app, key).value;
  if (key === 'period') return app.view.daily ? /^d\d{4}-\d{2}-\d{2}$/.test(value) ? 'regular' : value : value.split('|')[1];
  return value;
}
export function uiChoose(app, key, value) {
  const click = node => { if (!node) throw new Error(`Not offered: ${key} ${value}`); node.dispatchEvent(new FakeEvent('click')); };
  if (app.header.anyOpen) app.board.ownerDocument.activeElement.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
  const native = app.menu.selects.get(key);
  if (native) {
    if (!app.menuOpen) click(app.header.menuBtn);
    native.focus(); native.value = String(value); native.dispatchEvent(new FakeEvent('change'));
    return native;
  }
  if (app.menuOpen) click(app.menu.closeBtn);
  const button = uiControl(app, key);
  button.focus(); click(button);
  if (button.getAttribute('aria-expanded') !== 'true') throw new Error(`Actual ${key} picker did not open`);
  if (key === 'season' && !app.view.daily) {
    const period = app.catalog.equivalentPeriod(app.view.view.league, app.view.view.season, String(value), app.view.view.period, app.settings.zone);
    click(app.header.pickers.get('period').options.find(o => o.value === `${value}|${period}`));
  } else if (app.view.daily && ['season', 'period'].includes(key)) {
    if (key === 'period' && /^d\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const date = String(value).slice(1), cal = app.header.calendar;
      const cell = () => cal.cells.find(c => c.button.getAttribute('data-key') === date);
      for (let i = 0; i < 36 && !cell(); i++) click(date < app.calendarState.focus ? cal.prev : cal.next);
      click(cell() && cell().button);
    } else {
      const attr = key === 'season' ? 'data-season' : 'data-period';
      click(app.header.phases.querySelectorAll('button').find(b => b.getAttribute(attr) === String(value)));
    }
  } else {
    const encoded = key === 'period' ? `${app.view.view.season}|${value}` : String(value);
    click(app.header.pickers.get(key).options.find(o => o.value === encoded));
  }
  return button;
}
