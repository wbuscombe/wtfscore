import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument } from './fake-dom.mjs';
import { generateWeek, DISPLAY_ZONE } from '../public/lib/fixtures.mjs';
import { buildCard, cardLabel, statusInfo, formatKickoff, downDistance, yardLine, fieldModel, safeColor, contrastRatio, setCardStage, nextAction, buildScorecard, buildSituationPanel, buildLeaders, buildTeamStats, driveModel } from '../public/lib/render.mjs';
import { buildCatalog, DEFAULT_ZONE } from '../public/lib/catalog.mjs';

const week = generateWeek();
const byId = new Map(week.games.map((g) => [g.id, g]));
const ALLOWED_TAGS = new Set(['ARTICLE', 'DIV', 'SPAN', 'BUTTON']);

function render(game, teams = week.teams) {
  const doc = new FakeDocument();
  const ref = buildCard(doc, game, teams, { zone: DISPLAY_ZONE });
  return { doc, ref };
}
const actions = (root) => root.all((e) => e.tagName === 'BUTTON').map((b) => b.getAttribute('data-action'));

test('every fixture card renders with only safe element types and no HTML sinks', () => {
  for (const g of week.games) {
    const { doc, ref } = render(g);
    for (const e of doc.created) assert.ok(ALLOWED_TAGS.has(e.tagName), `${g.id}: ${e.tagName}`);
    assert.equal(ref.root.getAttribute('data-id'), g.id);
    assert.equal(ref.root.getAttribute('role'), 'group');
    assert.equal(ref.root.tabIndex, 0, 'every card is a keyboard stop');
    assert.ok(ref.root.getAttribute('aria-label').length > 20);
    assert.equal(ref.sections[2].hidden, true);
    assert.equal(ref.sections[3].hidden, true);
  }
});

test('cards use human words: no stage numbers, no bare symbols as controls', () => {
  for (const g of week.games) {
    const { ref } = render(g);
    const text = ref.root.textContent;
    assert.doesNotMatch(text, /\b[23] · /, `${g.id} section labels carry no stage numbers`);
    assert.doesNotMatch(ref.root.getAttribute('aria-label'), /stage \d/i);
    for (const b of ref.root.all((e) => e.tagName === 'BUTTON')) {
      assert.match(b.textContent, /^(more|leaders|close)$/, `${g.id} button text ${b.textContent}`);
      assert.match(b.getAttribute('aria-label'), /^(Show situation|Show leaders|Close details), [A-Z]{3} at [A-Z]{3}$/);
      assert.equal(b.tabIndex, -1, 'inner buttons are pointer and assistive-technology targets; the card is the keyboard stop');
    }
  }
});

test('hostile strings render as inert text', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>" onmouseover="x" & &amp;';
  const g = structuredClone(byId.get('g11-149'));
  g.lastPlay.text = evil;
  g.network = evil;
  g.leaders.passing.name = evil;
  g.statusDetail = evil;
  const teams = structuredClone(week.teams);
  teams[g.away] = { ...teams[g.away], abbr: '<b>X</b>', name: evil, record: evil, color: 'red;background:url(http://x)' };
  const { doc, ref } = render(g, teams);
  for (const e of doc.created) assert.ok(ALLOWED_TAGS.has(e.tagName), `unexpected element ${e.tagName}`);
  const text = ref.root.textContent;
  assert.ok(text.includes(evil), 'hostile text kept verbatim as text');
  assert.ok(text.includes('<b>X</b>'));
  const chips = ref.root.byClass('chip').filter((c) => c.style.getPropertyValue('--chip'));
  assert.ok(chips.some((c) => c.style.getPropertyValue('--chip') === '#6b7280'), 'invalid color falls back');
  for (const c of chips) assert.match(c.style.getPropertyValue('--chip'), /^#[0-9a-f]{6}$/);
});

test('color validation and contrast helper', () => {
  assert.equal(safeColor('#ABCDEF'), '#abcdef');
  assert.equal(safeColor('#abc'), '#6b7280');
  assert.equal(safeColor('javascript:alert(1)'), '#6b7280');
  assert.ok(contrastRatio('#ffffff', '#000000') > 20);
  assert.ok(contrastRatio('#123456', '#123456') < 1.01);
});

test('pregame: kickoff time in the screen zone, network, blank linescore, 0-0, no open control', () => {
  const g = byId.get('g11-108');
  const { ref } = render(g);
  const s = statusInfo(g, DISPLAY_ZONE).text;
  assert.match(s, /^Sun 7:20\sPM$/);
  assert.ok(ref.root.textContent.includes('Northlight'));
  const rows = ref.root.byClass('trow');
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.deepEqual(r.byClass('q').map((q) => q.textContent), ['', '', '', '', '']);
    assert.equal(r.byClass('tot')[0].textContent, '0');
  }
  assert.ok(!actions(ref.root).includes('advance'), 'no open control');
  assert.equal(ref.act, null);
  assert.equal(ref.expandable, false);
  assert.ok(cardLabel(g, week.teams, 1, DISPLAY_ZONE).includes('No details: pregame.'));
});

test('TBD, postponed and unknown states are labeled, never shown as live', () => {
  assert.equal(statusInfo(byId.get('g11-121'), DISPLAY_ZONE).text, 'Mon · time TBD');
  const pp = render(byId.get('g11-162')).ref;
  assert.equal(statusInfo(byId.get('g11-162'), DISPLAY_ZONE).text, 'Postponed');
  for (const r of pp.root.byClass('trow')) assert.equal(r.byClass('tot')[0].textContent, '–');
  const unk = byId.get('g11-118');
  const info = statusInfo(unk, DISPLAY_ZONE);
  assert.equal(info.tone, 'unknown');
  assert.ok(info.text.includes('STATUS_CODE_47'));
  const ur = render(unk).ref;
  assert.ok(!actions(ur.root).includes('advance'));
  assert.equal(ur.root.byClass('poss').filter((p) => p.textContent).length, 0, 'no possession shown for unknown status');
});

test('cross-midnight kickoff formats per zone', () => {
  const g = byId.get('g11-166');
  assert.equal(formatKickoff(g.kickoff, 'America/Chicago').weekday, 'Mon');
  assert.equal(formatKickoff(g.kickoff, 'America/New_York').weekday, 'Tue');
  assert.match(formatKickoff(g.kickoff, 'America/New_York').time, /^12:15\sAM$/);
});

test('OT column appears only for overtime games', () => {
  const ot = render(byId.get('g11-104')).ref;
  assert.equal(ot.root.byClass('lhead')[0].byClass('ot')[0].textContent, 'OT');
  assert.equal(ot.root.byClass('trow')[0].byClass('ot')[0].textContent, '3');
  const reg = render(byId.get('g11-157')).ref;
  assert.equal(reg.root.byClass('lhead')[0].byClass('ot')[0].textContent, '');
});

test('situation: field direction, yard line, down and distance, two-line last play with full text', () => {
  const g = byId.get('g11-183');
  assert.equal(downDistance(g.situation), '1st & Goal');
  assert.equal(yardLine(g), 'SMC 8');
  const fm = fieldModel(g);
  assert.equal(fm.direction, 'right');
  assert.ok(fm.ball > 80 && fm.ball < 100);
  const { ref } = render(g);
  const s2 = ref.sections[2];
  assert.ok(s2.byClass('field').length === 1);
  assert.match(s2.byClass('field')[0].getAttribute('aria-label'), /toward the right end zone, ball on SMC 8/);
  assert.match(s2.byClass('dd')[0].textContent, /1st & Goal · SMC 8 · WCW ball/);
  assert.equal(s2.byClass('slabel')[0].textContent, 'Situation · WCW at SMC');
  const play = s2.byClass('play')[0];
  assert.equal(play.getAttribute('data-clip-ok'), 'line-clamp');
  assert.equal(play.title, g.lastPlay.text);
  assert.deepEqual(actions(ref.root), ['collapse'], '010: no per-game More/Leaders button; only close in the situation');
  assert.equal(ref.act, null);
  assert.match(ref.root.getAttribute('aria-label'), /Details closed\. Enter shows the situation\.$/);
  const home = byId.get('g11-140');
  assert.equal(fieldModel(home).direction, 'left');
  assert.equal(yardLine(home), 'DPS 39');
});

test('long last play keeps its complete text for assistive tech and hover', () => {
  const g = byId.get('g11-195');
  const play = render(g).ref.sections[2].byClass('play')[0];
  assert.ok(g.lastPlay.text.length > 120);
  assert.equal(play.textContent, g.lastPlay.text);
  assert.equal(play.title, g.lastPlay.text);
  assert.match(render(g).ref.sections[2].byClass('dd')[0].textContent, /^Kickoff · CPL kicking from CPL 35/);
});

test('leaders: passing, rushing and receiving with name, team and yards; missing labeled', () => {
  const g = byId.get('g11-149');
  const rows = render(g).ref.sections[3].byClass('ldr');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.byClass('lcat')[0].textContent), ['PASS', 'RUSH', 'REC']);
  assert.match(rows[0].byClass('lline')[0].textContent, /^CCQ · 302 yds/);
  const miss = render(byId.get('g11-112')).ref;
  const r3 = miss.sections[3].byClass('ldr');
  assert.ok(r3[2].hasClass('miss'));
  assert.ok(r3[2].textContent.includes('Not available'));
  assert.ok(miss.sections[2].textContent.includes('Situation not available'));
  assert.ok(miss.sections[2].byClass('snote')[0].hasClass('miss'));
  assert.ok(miss.root.textContent.includes('Network TBA'));
  assert.ok(miss.root.byClass('tag-miss')[0].textContent === 'Missing data');
});

test('finals show last play without a field graphic; cues are tagged in text, not color only', () => {
  const fin = render(byId.get('g11-157')).ref;
  assert.equal(fin.sections[2].byClass('field').length, 0);
  assert.ok(fin.sections[2].textContent.includes('Final · no live field position'));
  const td = render(byId.get('g11-195')).ref;
  assert.ok(td.root.hasClass('td'));
  assert.equal(td.root.byClass('tag-td')[0].textContent, 'TD');
  const rz = render(byId.get('g11-183')).ref;
  assert.equal(rz.root.byClass('tag-rz')[0].textContent, 'RZ');
  const fg = render(byId.get('g11-126')).ref;
  assert.equal(fg.root.byClass('tag-td').length, 0, 'no strong cue for a field goal');
  const corr = render(byId.get('g11-171')).ref;
  assert.equal(corr.root.byClass('tag-corr')[0].textContent, 'Corrected');
});

test('010: setCardStage shows exactly the sections of one stage on the same element and relabels the card (no per-game control)', () => {
  const g = byId.get('g11-149');
  const { doc, ref } = render(g);
  const created = doc.created.length;
  assert.equal(ref.act, null);
  const expect = [
    [2, false, true, /Situation open\. Enter shows leaders, Escape closes\.$/],
    [3, false, false, /Situation and leaders open\. Enter closes, Escape steps back\.$/],
    [1, true, true, /Details closed\. Enter shows the situation\.$/],
  ];
  for (const [stage, h2, h3, label] of expect) {
    assert.equal(setCardStage(ref, g, week.teams, DISPLAY_ZONE, stage), stage);
    assert.equal(ref.root.getAttribute('data-stage'), String(stage));
    assert.equal(ref.root.hasClass('open'), stage > 1);
    assert.equal(ref.sections[2].hidden, h2);
    assert.equal(ref.sections[3].hidden, h3);
    assert.ok(!actions(ref.root).includes('advance'), 'no More/Leaders button at any stage');
    assert.match(ref.root.getAttribute('aria-label'), label);
  }
  assert.equal(doc.created.length, created, 'no element created or replaced');
  assert.deepEqual(nextAction(1), { text: 'more', verb: 'Show situation' });
  const pre = render(byId.get('g11-108')).ref;
  assert.equal(setCardStage(pre, byId.get('g11-108'), week.teams, DISPLAY_ZONE, 3), 1, 'pregame never opens');
  assert.equal(pre.sections[2].hidden, true);
});

// ---------- 008: TV cards and the TV details parts ----------
const nfl = new Map(buildCatalog().resolve({ league: 'nfl' }, DEFAULT_ZONE).games.map((g) => [g.localId, g]));
const tvTags = new Set(['DIV', 'SPAN', 'BUTTON', 'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'P']);

test('010 TV cards: no per-game button; the card says Enter opens the details window; a card never opens in place on TV; phone labels come back unchanged', () => {
  const doc = new FakeDocument();
  const g = nfl.get('g11-149');
  const ref = buildCard(doc, g, week.teams, { zone: DISPLAY_ZONE, mode: 'tv' });
  assert.equal(ref.act, null);
  assert.ok(!actions(ref.root).includes('advance'), 'the whole card opens the details window');
  assert.match(ref.root.getAttribute('aria-label'), /Enter opens the game details\.$/);
  assert.equal(setCardStage(ref, g, week.teams, DISPLAY_ZONE, 3, 'tv'), 1, 'stage stays 1 on TV');
  assert.equal(ref.sections[2].hidden, true);
  assert.equal(setCardStage(ref, g, week.teams, DISPLAY_ZONE, 2, 'phone'), 2);
  assert.match(ref.root.getAttribute('aria-label'), /Situation open\. Enter shows leaders, Escape closes\.$/);
  assert.equal(cardLabel(g, week.teams, 1, DISPLAY_ZONE), cardLabel(g, week.teams, 1, DISPLAY_ZONE, 'phone'), 'phone wording is the default');
});

test('TV details parts: the scorecard has the full score and no button; the Situation panel draws the drive; Leaders and Team stats are plain, labelled and safe', () => {
  const doc = new FakeDocument();
  const g = nfl.get('g11-183');
  const sc = buildScorecard(doc, g, week.teams, { zone: DISPLAY_ZONE });
  assert.equal(sc.className, 'pscore');
  assert.equal(sc.all((e) => e.tagName === 'BUTTON').length, 0);
  assert.equal(sc.byClass('trow').length, 2);
  assert.equal(sc.byClass('tot').map((e) => e.textContent).join(), 'T,7,3');
  const sit = buildSituationPanel(doc, g, week.teams);
  const field = sit.byClass('field')[0];
  assert.equal(sit.byClass('dstart').length, 1);
  const dm = driveModel(g);
  assert.ok(Math.abs(Math.abs(dm.end - dm.start) - (g.drive.yards / 120) * 100) < 1e-9, 'the drawn drive is as long as its yards');
  assert.equal(sit.byClass('dstart')[0].style.getPropertyValue('left'), `${dm.start}%`);
  assert.equal(sit.byClass('los')[0].style.getPropertyValue('left'), `${fieldModel(g).ball}%`);
  assert.ok(Math.abs(dm.end - fieldModel(g).ball) < 1e-9, 'the drive ends at the ball');
  const startWords = g.drive.start > 50 ? `the WCW ${100 - g.drive.start}` : g.drive.start === 50 ? 'midfield' : `the SMC ${g.drive.start}`;
  assert.equal(field.getAttribute('aria-label'), `Field: WCW driving toward the right end zone, ball on SMC 8, drive started at ${startWords}`);
  assert.match(sit.textContent, /Drive · WCW · \d+ plays, \d+ yards/);
  const fin = buildSituationPanel(doc, nfl.get('g11-157'), week.teams);
  assert.equal(fin.byClass('field').length, 0, 'a final draws no live field');
  assert.doesNotMatch(fin.textContent, /Drive/, 'and no drive');
  // 008002: the catalog's g11-112 has an invented current drive; the raw fixture
  // with only a last completed drive still renders its gaps honestly
  const now112 = buildSituationPanel(doc, nfl.get('g11-112'), week.teams);
  assert.match(now112.textContent, /2nd & 6 · ZHG 41 · ZHG ball ←/);
  assert.match(now112.textContent, /Drive · ZHG · 2 plays, 16 yards/);
  assert.doesNotMatch(now112.textContent, /Situation not available|Current ball position not available/);
  const blank = buildSituationPanel(doc, { ...byId.get('g11-112'), drive: { team: 'away', direction: 'right', start: 47, end: 7, yards: 40, plays: 9, inProgress: false, result: 'Field goal' } }, week.teams);
  assert.match(blank.textContent, /Situation not available/);
  assert.match(blank.textContent, /Last drive · YWK field goal/);
  assert.match(blank.textContent, /Current ball position not available/);
  const ld = buildLeaders(doc, nfl.get('g11-112'));
  assert.equal(ld.byClass('ldr').length, 3);
  assert.equal(ld.byClass('miss').length >= 1, true, 'the missing receiving leader is labelled');
  const ts = buildTeamStats(doc, g, week.teams);
  assert.deepEqual(ts.all((e) => e.tagName === 'TH' && e.getAttribute('scope') === 'col').map((e) => e.textContent), ['Team', 'WCW', 'SMC']);
  assert.equal(ts.all((e) => e.tagName === 'TH' && e.getAttribute('scope') === 'row').length, 6);
  assert.match(ts.textContent, /Invented for this demo, like every score here\. Not live statistics\./);
  assert.match(buildTeamStats(doc, nfl.get('g11-108'), week.teams).textContent, /^Team stats not available$/, 'a pregame game has none');
  for (const e of doc.created) assert.ok(tvTags.has(e.tagName) || e.tagName === 'ARTICLE', e.tagName);
});
