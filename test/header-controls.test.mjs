import { fitHeaderPanel } from '../public/lib/header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeWindow, FakeEvent } from './fake-dom.mjs';
import { mountBoard } from '../public/lib/board.mjs';
import { LEAGUES } from '../public/lib/catalog.mjs';
function setup(width=1440,height=900){const win=new FakeWindow({width,height,now:Date.parse('2026-11-12T20:30:00Z')});const doc=win.document;const root=doc.createElement('div');doc.body.appendChild(root);return {win,doc,app:mountBoard({win,doc,root})};}
const click=e=>{assert.ok(e,'real control exists');e.dispatchEvent(new FakeEvent('click'));};
const key=(e,k)=>e.dispatchEvent(new FakeEvent('keydown',{key:k}));
function picker(run,name){const b=run.doc.getElementById('header-'+name);assert.ok(b,`${name} is an actual foreground header button`);same(b.tagName,'BUTTON');assert.ok(run.app.header.root.contains(b));return b;}
function open(run,name){const b=picker(run,name);click(b);const list=run.doc.getElementById(b.getAttribute('aria-controls'));assert.ok(list&&!list.hidden,'picker is open');return {b,list};}
function options(list){return list.all(e=>e.getAttribute('role')==='option');}
function choose(run,name,value){const {list}=open(run,name);const o=options(list).find(e=>e.getAttribute('data-value')===value);assert.ok(o,`${name} offers ${value}`);click(o);return picker(run,name);}
test('all 42 ordered league switches use the foreground League picker and replace real board results',()=>{
 for(const from of LEAGUES)for(const to of LEAGUES){if(from.id===to.id)continue;const r=setup();if(from.id!=='nfl')choose(r,'league',from.id);const b=choose(r,'league',to.id);same(r.app.view.league.id,to.id);same(r.doc.activeElement,b);assert.deepEqual([...r.app.cards.keys()].sort(),r.app.view.games.map(g=>g.id).sort());assert.ok(r.app.view.games.every(g=>g.league===to.id));r.doc.releaseDetachedCreatedNodes();}
});
test('weekly period is next to League, starts at Week 11, groups current season first and retains past seasons/postseason',()=>{
 const r=setup();const p=picker(r,'period');assert.match(p.textContent,/Week 11/);const {list}=open(r,'period');const opts=options(list);assert.ok(opts.length>r.app.view.periods.length);same(r.doc.activeElement,opts.find(e=>e.getAttribute('aria-selected')==='true'));assert.ok(list.all(e=>e.getAttribute('role')==='group').length>=2);assert.ok(opts.some(e=>/Wild Card|Bowl|Championship/i.test(e.textContent)));key(r.doc.activeElement,'Escape');same(r.doc.activeElement,p);same(p.getAttribute('aria-expanded'),'false');
 for(const name of ['sport','league','season','period','date','conference','division','ranking','tournament','round'])same(r.app.menu.rows.has(name),false,`${name} is not duplicated in Menu`);
});
test('division/conference and MLB AL/NL foreground choices filter the board immediately',()=>{
 const r=setup();for(const league of ['nfl','mlb','ncaaf']){choose(r,'league',league);for(const c of r.app.view.controls.filter(c=>c.visible&&['conference','division','subleague','subdivision'].includes(c.key))){const option=c.options.find(o=>o.value!=='all');if(!option)continue;choose(r,c.key,option.value);same(r.app.view.view.filters[c.key],option.value);assert.deepEqual([...r.app.cards.keys()].sort(),r.app.view.games.map(g=>g.id).sort());}}
});
test('header arrows navigate without changing values; Select opens and Back cancels with focus returned',()=>{
 const r=setup();const league=picker(r,'league');league.focus();const before=r.app.view.league.id;key(league,'ArrowRight');same(r.doc.activeElement,picker(r,'period'));same(r.app.view.league.id,before);key(r.doc.activeElement,'ArrowDown');same(r.doc.activeElement.tagName,'ARTICLE');key(r.doc.activeElement,'ArrowUp');assert.ok(r.app.header.root.contains(r.doc.activeElement));league.focus();key(league,'Select');const list=r.doc.getElementById(league.getAttribute('aria-controls'));same(list.hidden,false);const selected=r.doc.activeElement;key(selected,'End');notSame(r.doc.activeElement,selected);key(r.doc.activeElement,'GoBack');same(r.app.view.league.id,before);same(r.doc.activeElement,league);same(list.hidden,true);
});
test('daily period opens a calendar dialog even from postseason and an exact empty date stays selected',()=>{
 const r=setup();choose(r,'league','mlb');const period=picker(r,'period');same(period.getAttribute('aria-haspopup'),'dialog');click(period);same(r.app.calendarOpen,true);same(r.app.header.periodPanel.getAttribute('role'),'dialog');assert.ok(r.app.header.periodPanel.contains(r.app.header.calendar.root));for(let i=0;i<12&&!r.app.header.calendar.cells.some(c=>c.button.getAttribute('data-key')==='2027-02-03');i++)click(r.app.header.calendar.next);click(r.app.header.calendar.cells.find(c=>c.button.getAttribute('data-key')==='2027-02-03').button);same(r.app.view.period.dateKey,'2027-02-03');same(r.app.cards.size,0);same(r.doc.activeElement,period);assert.match(period.textContent,/Feb/);click(period);same(r.app.calendarOpen,true);key(r.doc.activeElement,'Escape');same(r.doc.activeElement,period);
});
test('college tournament/ranking and round remain foreground controls with real current options',()=>{
 const r=setup();for(const league of ['ncaab','ncaaw']){choose(r,'league',league);picker(r,'ranking');const p=picker(r,'period');click(p);const round=r.app.header.periodPanel.all(e=>e.getAttribute('data-period')==='weekend-1')[0];click(round);for(const c of r.app.view.controls.filter(c=>c.visible)){const b=picker(r,c.key);same(b.value,c.value);}picker(r,'tournament');picker(r,'round');}
});
test('wrapped header geometry stays above every first-row card on phone and TV',()=>{
 for(const [w,h]of[[390,844],[430,932],[960,540],[1920,1080]]){const r=setup(w,h);picker(r,'league');for(const league of ['nfl','ncaaf']){choose(r,'league',league);const g=r.app.layout.frame;assert.ok(g.header.h>=44);for(const p of r.app.layout.placements)assert.ok(p.y>=g.header.y+g.header.h+g.gap-0.01);}}
 for(const w of [360,375,390,430,960,1920]){const anchor={left:w*.3,bottom:100};const width=w*.9;const panel=fitHeaderPanel(anchor,width,{w,h:540});assert.ok(anchor.left+panel.left>=w*.05-.01);assert.ok(anchor.left+panel.left+width<=w*.95+.01);if(w<=430)assert.ok(w*.9-16>=7*44,'seven calendar targets fit after scoped padding');}
 const r=setup(390,844);r.win.scrollY=100;r.app.header.root.getBoundingClientRect=()=>({top:-20});r.app.header.focusNearest(0);same(r.win.scrolls.at(-1)[1],-28,'Up reveals an offscreen header');
 const panel=r.app.header.periodPanel;const scroll=r.app.header.calendar.scroll;scroll.getBoundingClientRect=()=>({top:50,bottom:150,left:0,right:200});const day=r.app.header.calendar.cells[0].button;day.getBoundingClientRect=()=>({top:170,bottom:214,left:10,right:54});r.app.header.revealInPanel(day);same(scroll.scrollTop,70,'calendar focus scrolls the date grid');same(panel.scrollTop,0,'the footer panel stays still');

});

test('live picker state survives composition: commit/cancel restore it and an outside card click only cancels',()=>{
 const r=setup();const league=picker(r,'league');click(league);same(r.app.header.anyOpen,true);key(r.doc.activeElement,'Escape');same(r.app.header.anyOpen,false);choose(r,'league','nba');same(r.app.header.anyOpen,false);click(picker(r,'period'));same(r.app.header.anyOpen,true);key(r.doc.activeElement,'Escape');same(r.app.header.anyOpen,false);choose(r,'league','nfl');const id=r.app.order.find(id=>r.app.view.games.find(g=>g.id===id).status==='live');const before=r.app.stats.activations;click(league);same(r.app.header.anyOpen,true);click(r.app.cards.get(id).sections[1]);same(r.app.header.anyOpen,false);same(r.app.stats.activations,before);same(r.app.popup.open,false);same(r.doc.activeElement,league);
 click(league);click(r.app.header.menuBtn);same(r.app.header.anyOpen,false);same(r.app.menuOpen,true);click(r.app.menu.closeBtn);same(r.doc.activeElement,league,'Menu returns to the picker invoker after cancelling its open listbox');
 choose(r,'league','nba');const period=picker(r,'period');click(period);same(r.app.header.anyOpen,true);click(r.app.header.menuBtn);same(r.app.header.anyOpen,false);click(r.app.menu.closeBtn);same(r.doc.activeElement,period,'Menu returns to the calendar invoker after cancellation');
});

function same(a,b,msg) { const short=x=>x===null||typeof x!=='object'&&typeof x!=='function'?String(x).slice(0,160):'<object>'; assert.ok(a===b,msg||`${short(a)} !== ${short(b)}`); }

function notSame(a,b,msg) { assert.ok(a!==b,msg||'Expected different values or identities'); }
