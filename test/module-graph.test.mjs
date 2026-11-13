// Runtime call-graph check, in its own process: loading the page's controller
// resolves no comparison, summary, G1, browser-measure or preset module, so
// normal startup and input cannot run that code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const resolved = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    resolved.push(r.url);
    return r;
  },
});

test('the page controller loads only scoreboard modules', async () => {
  await import('../public/lib/board.mjs');
  const pub = [...new Set(resolved.filter((u) => u.includes('/public/')).map((u) => u.slice(u.indexOf('/public/') + '/public/'.length)))].sort();
  console.log(`page module graph (${pub.length}): ${pub.join(', ')}`);
  for (const banned of ['lib/metrics.mjs', 'lib/g1.mjs', 'lib/measure.mjs', 'lib/presets.mjs']) {
    assert.ok(!pub.includes(banned), `${banned} must not load with the page`);
  }
  for (const needed of ['lib/board.mjs', 'lib/board-layout.mjs', 'lib/render.mjs', 'lib/chrome.mjs', 'lib/model.mjs', 'lib/fixtures.mjs', 'lib/catalog.mjs', 'lib/sports.mjs', 'lib/menu.mjs']) {
    assert.ok(pub.includes(needed), `${needed} loads`);
  }
});
