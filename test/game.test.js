// Tests for the shared rules (game.js) and the secret round list (rounds.js).
// Run with:  node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Game = require(path.join(__dirname, '..', 'game.js'));
const { LAYOUT_MINUTES, SOLD, ROUNDS } = require(path.join(__dirname, '..', 'orders.js')).load().data;   // secret set if present, else rounds.js

// ---------------------------------------------------------------- helpers
function rng(seed) {                       // small seeded random generator (mulberry32) so failures can be repeated
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
const ALL_CELLS = [];
for (let r = 0; r < 10; r++) for (let c = 1; c <= 10; c++) ALL_CELLS.push(Game.cid(r, c));
const PLACEABLE = ALL_CELLS.filter(Game.placeable);
const WALKABLE = ALL_CELLS.filter(function (id) { const k = Game.kindOf(id); return k === 'walk' || k === 'start'; });

function randomLayout(seed, count) {       // all 24 products (or the first `count` of a shuffle) on random placeable cells
  const rnd = rng(seed);
  const cells = shuffle(PLACEABLE, rnd), prods = shuffle(Game.PRODUCTS.map(function (p) { return p.n; }), rnd);
  const layout = {};
  for (let i = 0; i < (count || 24); i++) layout[cells[i]] = { p: prods[i], l: 'TMB'.charAt(Math.floor(rnd() * 3)) };
  return layout;
}
function cleanLayout() {                   // a layout that breaks no storage rule
  const L = {};
  L.J1 = { p: 15, l: 'M' }; L.J2 = { p: 17, l: 'M' }; L.J3 = { p: 24, l: 'M' };
  L.J8 = { p: 13, l: 'M' }; L.J9 = { p: 16, l: 'M' }; L.J10 = { p: 22, l: 'M' };
  const rest = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 18, 19, 20, 21, 23, 9];   // Atta (9) last, far from Eggs (6)
  const shelves = PLACEABLE.filter(function (c) { return Game.kindOf(c) === 'shelf'; });
  rest.forEach(function (p, i) { L[shelves[i]] = { p: p, l: p === 9 ? 'B' : 'M' }; });
  return L;
}

// An independent description of the floor, written from the brief and NOT from game.js internals.
function refWalkable(id, rule) {
  const row = id.charAt(0), col = Number(id.slice(1));
  if (rule && rule.blocked && rule.blocked.includes(id)) return false;
  if (id === 'A3') return true;
  if (row === 'B' || row === 'I') return true;
  if ('CDEFGH'.includes(row) && (col === 3 || col === 6 || col === 9)) return true;
  return false;
}
function refNeighbours(id, rule) {
  const rows = 'ABCDEFGHIJ', r = rows.indexOf(id.charAt(0)), c = Number(id.slice(1)), out = [];
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
    const r2 = r + d[0], c2 = c + d[1];
    if (r2 < 0 || r2 > 9 || c2 < 1 || c2 > 10) return;
    const n = rows.charAt(r2) + c2;
    if (!refWalkable(n, rule)) return;
    if (rule && rule.oneWay && c === 6 && d[0] === -1) return;
    out.push(n);
  });
  return out;
}
function refDistances(from, rule) {        // plain breadth-first search over the reference floor
  const dist = {}; dist[from] = 0;
  const q = [from];
  while (q.length) {
    const x = q.shift();
    refNeighbours(x, rule).forEach(function (n) { if (dist[n] === undefined) { dist[n] = dist[x] + 1; q.push(n); } });
  }
  return dist;
}
function assertLegalWalk(route, rule, msg) {
  for (let i = 1; i < route.length; i++) {
    assert.ok(refNeighbours(route[i - 1], rule).includes(route[i]), (msg || '') + ' illegal step ' + route[i - 1] + ' -> ' + route[i]);
  }
}

// Independent optimum: try every order of the items and every pick-up square, using pathTo for the leg lengths.
function bruteBest(layout, items, rule) {
  const cache = {};
  function d(a, b) {
    const k = a + '>' + b;
    if (cache[k] === undefined) { const p = Game.pathTo(a, b, rule); cache[k] = p ? p.length - 1 : Infinity; }
    return cache[k];
  }
  const spotLists = [];
  for (const it of items) {
    const cell = Game.where(layout, it);
    if (!cell) return null;
    const sp = Game.spots(cell, rule);
    if (!sp.length) return null;
    spotLists.push(sp);
  }
  let best = Infinity;
  const used = new Array(items.length).fill(false);
  (function go(cur, done, sofar) {
    if (sofar >= best) return;
    if (done === items.length) { const t = sofar + d(cur, Game.START); if (t < best) best = t; return; }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      for (const s of spotLists[i]) go(s, done + 1, sofar + d(cur, s));
      used[i] = false;
    }
  })(Game.START, 0, 0);
  if (best === Infinity) return null;
  return Math.max(best, 2);                // a trip is at least "step out and step back"
}
function tripsToCheck(R) { return R.double ? [R.a, R.b, R.a.concat(R.b)] : [R.items]; }
function greedyRoute(layout, items, rule) { // a legal but usually longer route: fetch the items in list order
  let cur = Game.START, route = [Game.START];
  for (const it of items) {
    const sp = Game.spots(Game.where(layout, it), rule);
    const leg = Game.pathTo(cur, sp[sp.length - 1], rule);
    route = route.concat(leg.slice(1)); cur = sp[sp.length - 1];
  }
  route = route.concat(Game.pathTo(cur, Game.START, rule).slice(1));
  if (route.length < 3) route = Game.solve(layout, items, rule).path;
  return route;
}
const SINGLE = ROUNDS.find(function (r) { return r.id === 'o1'; });
const DOUBLE = ROUNDS.find(function (r) { return r.double; });
const FINAL = ROUNDS.find(function (r) { return r.mult; });

// ---------------------------------------------------------------- the map
test('map: every square has the expected kind', function () {
  assert.equal(Game.START, 'A3');
  assert.equal(Game.kindOf('A3'), 'start');
  assert.equal(Game.kindOf('A1'), 'counter'); assert.equal(Game.kindOf('A2'), 'counter');
  for (let c = 4; c <= 10; c++) assert.equal(Game.kindOf('A' + c), 'dock');
  for (let c = 1; c <= 10; c++) { assert.equal(Game.kindOf('B' + c), 'walk'); assert.equal(Game.kindOf('I' + c), 'walk'); }
  ['J1', 'J2', 'J3'].forEach(function (c) { assert.equal(Game.kindOf(c), 'cold'); });
  ['J4', 'J5', 'J6'].forEach(function (c) { assert.equal(Game.kindOf(c), 'spare'); });
  assert.equal(Game.kindOf('J7'), 'gap');
  ['J8', 'J9', 'J10'].forEach(function (c) { assert.equal(Game.kindOf(c), 'chem'); });
  for (const row of 'CDEFGH') {
    [3, 6, 9].forEach(function (c) { assert.equal(Game.kindOf(row + c), 'walk'); });
    [1, 10].forEach(function (c) { assert.equal(Game.kindOf(row + c), 'closed'); });
    [2, 4, 5, 7, 8].forEach(function (c) { assert.equal(Game.kindOf(row + c), 'CDEF'.includes(row) ? 'shelf' : 'closed'); });
  }
  const counts = {};
  ALL_CELLS.forEach(function (c) { const k = Game.kindOf(c); counts[k] = (counts[k] || 0) + 1; });
  assert.deepEqual(counts, { counter: 2, start: 1, dock: 7, walk: 38, shelf: 20, closed: 22, cold: 3, spare: 3, gap: 1, chem: 3 });
});

test('map: placeable squares, cell ids and validCell', function () {
  assert.equal(PLACEABLE.length, 29);
  assert.ok(PLACEABLE.length >= Game.PRODUCTS.length, 'there must be room for every product');
  PLACEABLE.forEach(function (c) { assert.ok(['shelf', 'spare', 'cold', 'chem'].includes(Game.kindOf(c))); });
  ['A3', 'B3', 'J7', 'G2', 'A1', 'A5', 'C3'].forEach(function (c) { assert.equal(Game.placeable(c), false, c); });
  ALL_CELLS.forEach(function (id) { const q = Game.rc(id); assert.equal(Game.cid(q[0], q[1]), id); assert.ok(Game.validCell(id)); });
  assert.equal(ALL_CELLS.length, 100);
  ['', 'A0', 'A11', 'K1', 'a3', 'A3 ', 'A03', 'A1x', 'AA', '3A', null, undefined, 3, {}, ['A3']].forEach(function (bad) {
    assert.equal(Game.validCell(bad), false, String(bad));
  });
});

test('map: the product catalogue is complete', function () {
  assert.equal(Game.PRODUCTS.length, 24);
  Game.PRODUCTS.forEach(function (p, i) {
    assert.equal(p.n, i + 1); assert.equal(Game.product(p.n), p);
    assert.ok(p.name && typeof p.name === 'string'); assert.ok(p.emoji, 'emoji for ' + p.name);
    assert.ok(['', 'FRAGILE', 'HEAVY', 'CHEMICAL', 'COLD'].includes(p.tag));
  });
  assert.equal(new Set(Game.PRODUCTS.map(function (p) { return p.name; })).size, 24);
  const byTag = function (t) { return Game.PRODUCTS.filter(function (p) { return p.tag === t; }).map(function (p) { return p.n; }); };
  assert.deepEqual(byTag('COLD'), [15, 17, 24]);
  assert.deepEqual(byTag('CHEMICAL'), [13, 16, 22]);
  assert.deepEqual(byTag('HEAVY'), [9]);
  assert.deepEqual(byTag('FRAGILE'), [3, 6, 8, 20]);
  assert.ok(byTag('COLD').length <= 3 && byTag('CHEMICAL').length <= 3, 'cold and chemical goods must fit in their zones');
  byTag('CHEMICAL').forEach(function (n) { assert.ok(Game.NOT_FOOD.includes(n), 'a chemical in its own zone must not count as food'); });
});

// ---------------------------------------------------------------- steps / spots / pathTo
test('steps: normal walking', function () {
  assert.deepEqual(Game.steps('A3').sort(), ['B3']);
  assert.deepEqual(Game.steps('B3').sort(), ['A3', 'B2', 'B4', 'C3']);
  assert.deepEqual(Game.steps('B1').sort(), ['B2']);
  assert.deepEqual(Game.steps('D6').sort(), ['C6', 'E6']);
  assert.deepEqual(Game.steps('I6').sort(), ['H6', 'I5', 'I7']);
  assert.deepEqual(Game.steps('I10').sort(), ['I9']);
  assert.deepEqual(Game.steps('B3', null).sort(), Game.steps('B3', {}).sort());
});

test('steps: match an independent model of the floor for every square and every round', function () {
  const rules = [null].concat(ROUNDS);
  rules.forEach(function (rule) {
    WALKABLE.forEach(function (c) {
      if (rule && rule.blocked && rule.blocked.includes(c)) return;
      assert.deepEqual(Game.steps(c, rule).sort(), refNeighbours(c, rule).sort(), c + ' under ' + (rule ? rule.id : 'no rule'));
    });
  });
});

test('steps: oil spill makes aisle 6 one-way (down only)', function () {
  const R = { oneWay: true };
  assert.deepEqual(Game.steps('D6', R), ['E6']);
  assert.deepEqual(Game.steps('C6', R), ['D6']);
  assert.ok(!Game.steps('I6', R).includes('H6'));
  assert.deepEqual(Game.steps('I6', R).sort(), ['I5', 'I7']);
  assert.deepEqual(Game.steps('B6', R).sort(), ['B5', 'B7', 'C6']);          // you may still enter at the top
  assert.deepEqual(Game.steps('D3', R).sort(), ['C3', 'E3']);                // other aisles are not affected
  assert.deepEqual(Game.steps('D9', R).sort(), ['C9', 'E9']);
  assert.ok(Game.steps('H6', R).includes('I6'));
});

test('steps: pallets block squares', function () {
  const R = { blocked: ['B4', 'B5'] };
  assert.deepEqual(Game.steps('B3', R).sort(), ['A3', 'B2', 'C3']);
  assert.deepEqual(Game.steps('B6', R).sort(), ['B7', 'C6']);
  assert.equal(Game.isBlocked(R, 'B4'), true); assert.equal(Game.isBlocked(R, 'B6'), false);
  assert.equal(Game.isBlocked(null, 'B4'), false); assert.equal(Game.isBlocked({}, 'B4'), false);
  assert.equal(Game.walk(1, 4, R), false); assert.equal(Game.walk(1, 4, null), true);
  assert.equal(Game.walk(-1, 3), false); assert.equal(Game.walk(0, 11), false); assert.equal(Game.walk(2, 2), false);
});

test('spots: where you can stand to pick from a shelf', function () {
  assert.deepEqual(Game.spots('C4').sort(), ['B4', 'C3']);
  assert.deepEqual(Game.spots('C5').sort(), ['B5', 'C6']);
  assert.deepEqual(Game.spots('D2'), ['D3']);
  assert.deepEqual(Game.spots('F8'), ['F9']);
  assert.deepEqual(Game.spots('J1'), ['I1']);
  assert.deepEqual(Game.spots('J10'), ['I10']);
  assert.deepEqual(Game.spots('C4', { blocked: ['B4', 'B5'] }), ['C3']);
  assert.deepEqual(Game.spots('C5', { blocked: ['B4', 'B5'] }), ['C6']);
  assert.deepEqual(Game.spots('C5', { oneWay: true }).sort(), ['B5', 'C6']);
  PLACEABLE.forEach(function (c) {
    const sp = Game.spots(c);
    assert.ok(sp.length >= 1, c + ' has nowhere to pick from');
    sp.forEach(function (s) { assert.ok(WALKABLE.includes(s)); assert.notEqual(s, Game.START); });
  });
});

test('pathTo: basics', function () {
  assert.deepEqual(Game.pathTo('B3', 'B3'), ['B3']);
  assert.deepEqual(Game.pathTo('A3', 'B3'), ['A3', 'B3']);
  assert.deepEqual(Game.pathTo('A3', 'E3'), ['A3', 'B3', 'C3', 'D3', 'E3']);
  assert.equal(Game.pathTo('A3', 'I10').length - 1, 15);
  assert.equal(Game.pathTo('A3', 'B3', { blocked: ['B3'] }), null);
  assert.equal(Game.pathTo('B1', 'I10', { blocked: ['B3', 'B2'] }), null);
});

test('pathTo: shortest and legal between every pair of walkway squares, for every round rule', function () {
  const rules = [null].concat(ROUNDS.filter(function (r) { return r.oneWay || r.blocked; }));
  rules.forEach(function (rule) {
    const open = WALKABLE.filter(function (c) { return refWalkable(c, rule); });
    open.forEach(function (from) {
      const dist = refDistances(from, rule);
      open.forEach(function (to) {
        const p = Game.pathTo(from, to, rule), tag = from + '->' + to + ' under ' + (rule ? rule.id : 'no rule');
        if (dist[to] === undefined) { assert.equal(p, null, tag); return; }
        assert.ok(p, tag + ' should be reachable');
        assert.equal(p[0], from); assert.equal(p[p.length - 1], to);
        assert.equal(p.length - 1, dist[to], tag + ' is not the shortest');
        assertLegalWalk(p, rule, tag);
      });
    });
  });
});

test('pathTo: the oil spill forces the long way round', function () {
  const R = { oneWay: true };
  assert.equal(Game.pathTo('I6', 'B6').length - 1, 7);
  const p = Game.pathTo('I6', 'B6', R);
  assert.equal(p.length - 1, 13);                                           // along I, up aisle 3 or 9, along B
  for (let i = 1; i < p.length; i++) assert.ok(!(p[i - 1].slice(1) === '6' && p[i].slice(1) === '6' && p[i] < p[i - 1]), 'walked up aisle 6');
  assert.equal(Game.pathTo('B6', 'I6', R).length - 1, 7);                   // down is still fine
  assert.equal(Game.pathTo('E6', 'D6', R).length - 1, 19);                   // down, along I, up aisle 3, along B, down again
});

// ---------------------------------------------------------------- picking
test('where / missing / pickedOf / isDone', function () {
  const layout = { C4: { p: 1, l: 'M' }, D2: { p: 3, l: 'T' }, J1: { p: 6, l: 'M' } };
  assert.equal(Game.where(layout, 1), 'C4'); assert.equal(Game.where(layout, 2), null); assert.equal(Game.where({}, 1), null);
  assert.deepEqual(Game.missing([1, 2, 3, 9], layout), [2, 9]);
  assert.deepEqual(Game.pickedOf(['A3', 'B3'], [1, 3, 6], layout), {});
  assert.deepEqual(Game.pickedOf(['A3', 'B3', 'B4'], [1, 3, 6], layout), { 1: 1 });
  assert.deepEqual(Game.pickedOf(['A3', 'B3', 'C3', 'D3'], [1, 3, 6], layout), { 1: 1, 3: 1 });
  assert.deepEqual(Game.pickedOf(['A3', 'B3', 'C3', 'D3'], [1, 3, 6, 2], layout), { 1: 1, 3: 1 });   // 2 is not stocked
  assert.deepEqual(Game.pickedOf(['A3', 'B3', 'B4'], [1], layout, { blocked: ['B4'] }), {});          // cannot pick from a blocked square
  const full = ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'I2', 'I1', 'I2', 'I3', 'H3', 'G3', 'F3', 'E3', 'D3', 'C3', 'B3', 'A3'];
  assert.equal(Game.isDone(full, [1, 3, 6], layout), true);
  assert.equal(Game.isDone(full.slice(0, -1), [1, 3, 6], layout), false);   // not back at the counter
  assert.equal(Game.isDone(['A3', 'B3', 'C3', 'D3', 'C3', 'B3', 'A3'], [1, 3, 6], layout), false);    // eggs not picked
  assert.equal(Game.isDone(['A3'], [], layout), false);
  assert.equal(Game.isDone(null, [1], layout), false);
  assert.equal(Game.isDone(full, [1, 2], layout), false);                   // item never stocked
});

// ---------------------------------------------------------------- solve
test('solve: simple known answers', function () {
  const s = Game.solve({ C4: { p: 1, l: 'M' } }, [1]);
  assert.equal(s.meters, 4);                                                // A3 B3 (C3 or B4) B3 A3
  assert.equal(s.path.length - 1, 4);
  assert.equal(Game.solve({ C2: { p: 1, l: 'M' } }, [1]).meters, 4);        // B2 or C3 both touch C2
  assert.equal(Game.solve({ J10: { p: 1, l: 'M' } }, [1]).meters, 30);      // far corner and back
  assert.equal(Game.solve({ C4: { p: 1, l: 'M' } }, [1, 2]), null);         // product 2 is not stocked
  assert.equal(Game.solve({}, [1]), null);
  assert.equal(Game.solve({ C4: { p: 1, l: 'M' } }, [1], { blocked: ['B3'] }), null);   // walled in
  assert.equal(Game.solve({ C5: { p: 1, l: 'M' } }, [1], { blocked: ['B4', 'B5'] }).meters, 34);   // only C6 is left, the long way round
});

test('solve: is optimal (checked against trying every order) for random layouts and every round', function () {
  let checked = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const layout = randomLayout(seed * 7919);
    ROUNDS.forEach(function (R) {
      tripsToCheck(R).forEach(function (items) {
        const s = Game.solve(layout, items, R), want = bruteBest(layout, items, R), tag = 'seed ' + seed + ' round ' + R.id + ' items ' + items.join(',');
        assert.ok(s, tag + ': solve found nothing');
        assert.equal(s.meters, want, tag);
        assert.equal(s.path.length - 1, s.meters, tag);
        assert.equal(s.path[0], 'A3'); assert.equal(s.path[s.path.length - 1], 'A3');
        assertLegalWalk(s.path, R, tag);
        assert.equal(Game.checkRoute(layout, items, s.path, R), null, tag);
        assert.equal(Game.isDone(s.path, items, layout, R), true, tag);
        checked++;
      });
    });
  }
  assert.ok(checked >= 8 * 18);
});

test('solve: also optimal for the clean layout and for clustered layouts', function () {
  const layouts = [cleanLayout()];
  for (let seed = 50; seed < 54; seed++) layouts.push(randomLayout(seed, 24));
  layouts.forEach(function (layout, n) {
    ROUNDS.forEach(function (R) {
      tripsToCheck(R).forEach(function (items) {
        const s = Game.solve(layout, items, R);
        assert.equal(s && s.meters, bruteBest(layout, items, R), 'layout ' + n + ' round ' + R.id);
      });
    });
  });
});

test('solve: no legal route is ever shorter than solve', function () {
  const layout = randomLayout(4242);
  ROUNDS.forEach(function (R) {
    tripsToCheck(R).forEach(function (items) {
      const g = greedyRoute(layout, items, R);
      assert.equal(Game.checkRoute(layout, items, g, R), null, R.id);
      assert.ok(g.length - 1 >= Game.solve(layout, items, R).meters, R.id);
    });
  });
});

// ---------------------------------------------------------------- checkRoute
test('checkRoute: accepts a good route and rejects every kind of bad one', function () {
  const layout = { C4: { p: 1, l: 'M' }, D2: { p: 3, l: 'T' }, C5: { p: 6, l: 'M' } };
  const good = ['A3', 'B3', 'C3', 'D3', 'C3', 'B3', 'B4', 'B5', 'B4', 'B3', 'A3'];
  assert.equal(Game.checkRoute(layout, [1, 3, 6], good, null), null);
  assert.equal(Game.checkRoute(layout, [1, 3, 6], good), null);
  const empty = 'That route is empty.';
  [null, undefined, 'A3,B3,A3', {}, 7, [], ['A3'], ['A3', 'A3']].forEach(function (r) { assert.equal(Game.checkRoute(layout, [1], r), empty); });
  const long = ['A3']; while (long.length < 401) long.push(long.length % 2 ? 'B3' : 'A3');
  assert.equal(long.length, 401); assert.equal(long[400], 'A3');
  assert.equal(Game.checkRoute(layout, [1], long), empty);
  assert.equal(Game.checkRoute(layout, [], long.slice(0, 399)), null);      // 399 squares is still allowed
  const ends = 'A route must start and end at A3.';
  assert.equal(Game.checkRoute(layout, [1], ['B3', 'C3', 'B3', 'A3']), ends);
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', 'C3', 'B3']), ends);
  const illegal = 'That route has an illegal step.';
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'C3', 'B3', 'A3']), illegal);                 // jump
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', 'B3', 'A3']), illegal);                 // standing still
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', 'C4', 'B3', 'A3']), illegal);           // diagonal
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', 'B4', 'C4', 'B4', 'B3', 'A3']), illegal); // walking into a shelf
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'A4', 'B4', 'B3', 'A3']), illegal);           // over the dock
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', 'Z9', 'B3', 'A3']), illegal);
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', null, 'B3', 'A3']), illegal);
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', 42, 'B3', 'A3']), illegal);
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', { toString: function () { return 'C3'; } }, 'B3', 'A3']), illegal);
  assert.equal(Game.checkRoute(layout, [1], ['A3', 'B3', 'B4', 'B3', 'A3'], { blocked: ['B4', 'B5'] }), illegal);   // through a pallet
  const upSix = ['A3', 'B3', 'B4', 'B5', 'B6', 'C6', 'B6', 'B5', 'B4', 'B3', 'A3'];
  assert.equal(Game.checkRoute(layout, [1, 6], upSix, null), null);
  assert.equal(Game.checkRoute(layout, [1, 6], upSix, { oneWay: true }), illegal);               // back up aisle 6
  assert.equal(Game.checkRoute(layout, [1, 2], good), 'Maggi was never stocked.');
  assert.equal(Game.checkRoute(layout, [1, 3, 6], ['A3', 'B3', 'C3', 'B3', 'A3']), 'You have not picked up Bread.');
  assert.equal(Game.checkRoute(layout, [6], ['A3', 'B3', 'B4', 'B3', 'A3']), 'You have not picked up Eggs.');
});

// ---------------------------------------------------------------- penalties
test('penalties: a clean layout costs nothing', function () {
  const L = cleanLayout();
  assert.equal(Object.keys(L).length, 24);
  assert.deepEqual(Game.penalties(L), []);
  assert.deepEqual(Game.penalties({}), []);
});

test('penalties: every rule, one at a time', function () {
  const P = Game.PENALTY;
  const one = function (layout) { return Game.penalties(layout); };
  const pts = function (list) { return list.map(function (x) { return x.pts; }).sort(function (a, b) { return a - b; }); };
  // cold goods
  assert.deepEqual(pts(one({ C2: { p: 15, l: 'M' } })), [P.cold]);
  assert.deepEqual(pts(one({ J4: { p: 17, l: 'M' } })), [P.cold]);            // spare is not cold
  assert.deepEqual(pts(one({ J8: { p: 24, l: 'M' } })), [P.foodInChem, P.cold].sort(function (a, b) { return a - b; }));
  ['J1', 'J2', 'J3'].forEach(function (c) { assert.deepEqual(one({ [c]: { p: 15, l: 'T' } }), []); });
  // chemicals
  assert.deepEqual(pts(one({ C2: { p: 13, l: 'M' } })), [P.chemical]);
  assert.deepEqual(pts(one({ J1: { p: 16, l: 'M' } })), [P.chemical]);
  ['J8', 'J9', 'J10'].forEach(function (c) { assert.deepEqual(one({ [c]: { p: 22, l: 'B' } }), []); });
  // food in the chemical zone, and non-food there is fine
  assert.deepEqual(pts(one({ J9: { p: 1, l: 'M' } })), [P.foodInChem]);
  Game.NOT_FOOD.forEach(function (n) { assert.deepEqual(one({ J9: { p: n, l: 'M' } }), [], Game.product(n).name + ' is not food'); });
  Game.PRODUCTS.filter(function (p) { return !Game.NOT_FOOD.includes(p.n) && !p.tag; }).forEach(function (p) {
    assert.deepEqual(pts(one({ J10: { p: p.n, l: 'M' } })), [P.foodInChem], p.name);
  });
  // heavy
  assert.deepEqual(pts(one({ C2: { p: 9, l: 'T' } })), [P.heavy]);
  assert.deepEqual(pts(one({ C2: { p: 9, l: 'M' } })), [P.heavy]);
  assert.deepEqual(one({ C2: { p: 9, l: 'B' } }), []);
  // fragile
  [3, 6, 8, 20].forEach(function (n) {
    assert.deepEqual(pts(one({ C2: { p: n, l: 'B' } })), [P.fragile]);
    assert.deepEqual(one({ C2: { p: n, l: 'M' } }), []);
    assert.deepEqual(one({ C2: { p: n, l: 'T' } }), []);
  });
  // eggs next to atta (side by side or one above the other, not diagonal, not across an aisle)
  assert.deepEqual(pts(one({ C4: { p: 6, l: 'M' }, C5: { p: 9, l: 'B' } })), [P.eggsAtta]);
  assert.deepEqual(pts(one({ C4: { p: 9, l: 'B' }, D4: { p: 6, l: 'T' } })), [P.eggsAtta]);
  assert.deepEqual(one({ C4: { p: 6, l: 'M' }, D5: { p: 9, l: 'B' } }), []);
  assert.deepEqual(one({ C2: { p: 6, l: 'M' }, C4: { p: 9, l: 'B' } }), []);
  assert.deepEqual(one({ C4: { p: 6, l: 'M' } }), []);
  // they add up, and each has a reason in words
  const many = one({ C4: { p: 6, l: 'B' }, C5: { p: 9, l: 'T' }, D2: { p: 15, l: 'M' }, D4: { p: 13, l: 'M' }, J8: { p: 1, l: 'M' } });
  assert.deepEqual(pts(many), [P.fragile, P.heavy, P.eggsAtta, P.chemical, P.foodInChem, P.cold].sort(function (a, b) { return a - b; }));
  many.forEach(function (x) { assert.ok(typeof x.why === 'string' && x.why.length > 5); assert.ok(x.pts > 0); });
  assert.deepEqual(P, { cold: 75, chemical: 50, foodInChem: 50, heavy: 30, fragile: 30, eggsAtta: 30 });
});

// ---------------------------------------------------------------- scoring
test('scoring numbers', function () {
  assert.deepEqual(Game.SCORE, { base: 150, perMeter: 2, speedBonus: 10, perfectBonus: 20, cartFactor: 1.25 });
  assert.equal(Game.pts(0), 150); assert.equal(Game.pts(10), 130); assert.equal(Game.pts(75), 0); assert.equal(Game.pts(200), 0);
  assert.equal(Game.cartMeters(10), 13); assert.equal(Game.cartMeters(8), 10); assert.equal(Game.cartMeters(41), 52);
  assert.equal(Game.cartPts(10), 280); assert.equal(Game.cartPts(150), 0); assert.equal(Game.cartPts(999), 0);
  assert.deepEqual(Game.tripsOf(SINGLE), [SINGLE.items]);
  assert.deepEqual(Game.tripsOf(DOUBLE, 'A'), [DOUBLE.a, DOUBLE.b]);
  assert.deepEqual(Game.tripsOf(DOUBLE), [DOUBLE.a, DOUBLE.b]);
  assert.deepEqual(Game.tripsOf(DOUBLE, 'B'), [DOUBLE.a.concat(DOUBLE.b)]);
});

test('scoreSubmission: single order', function () {
  const layout = randomLayout(99), R = SINGLE, s = Game.solve(layout, R.items, R);
  const out = Game.scoreSubmission(R, layout, { route: s.path });
  assert.deepEqual(out, { meters: s.meters, score: Math.max(0, 150 - 2 * s.meters), mode: null, route: s.path, route2: null });
  assert.notEqual(out.route, s.path, 'the stored route must be a copy');
  const g = greedyRoute(layout, R.items, R), out2 = Game.scoreSubmission(R, layout, { route: g, mode: 'B', route2: ['junk'] });
  assert.equal(out2.meters, g.length - 1); assert.equal(out2.mode, null); assert.equal(out2.route2, null);   // mode is ignored on single orders
  assert.ok(out2.score <= out.score);
  assert.deepEqual(Game.scoreSubmission(R, layout, {}), { err: 'That route is empty.' });
  assert.deepEqual(Game.scoreSubmission(R, layout, null), { err: 'That route is empty.' });
  assert.deepEqual(Game.scoreSubmission(R, layout), { err: 'That route is empty.' });
  assert.deepEqual(Game.scoreSubmission(R, layout, { route: ['A3', 'B3', 'A3'] }).err.slice(0, 22), 'You have not picked up');
  assert.match(Game.scoreSubmission(R, {}, { route: ['A3', 'B3', 'A3'] }).err, /never stocked/);
});

test('scoreSubmission: a very long walk scores 0, never less', function () {
  const layout = { C4: { p: 1, l: 'M' } }, R = { id: 'x', items: [1], secs: 60 };
  const route = ['A3'];
  for (let i = 0; i < 50; i++) route.push('B3', 'A3');
  const out = Game.scoreSubmission(R, layout, { route: route.slice(0, -1).concat(['B4', 'B3', 'A3']).slice(0) });
  assert.equal(out.err, undefined);
  assert.ok(out.meters > 75);
  assert.equal(out.score, 0);
});

test('scoreSubmission: the final is worth double', function () {
  const layout = randomLayout(123), s = Game.solve(layout, FINAL.items, FINAL);
  assert.equal(FINAL.mult, 2);
  const out = Game.scoreSubmission(FINAL, layout, { route: s.path });
  assert.equal(out.score, Game.pts(s.meters) * 2);
  assert.equal(out.meters, s.meters);
  const plain = Object.assign({}, FINAL); delete plain.mult;
  assert.equal(Game.scoreSubmission(plain, layout, { route: s.path }).score * 2, out.score);
  // a route that ignores the oil spill or the pallets is refused
  const cheat = Game.solve(layout, FINAL.items, null);
  if (Game.checkRoute(layout, FINAL.items, cheat.path, FINAL)) assert.ok(Game.scoreSubmission(FINAL, layout, { route: cheat.path }).err);
});

test('scoreSubmission: double drop, two trips (A)', function () {
  const layout = randomLayout(77), R = DOUBLE;
  const a = Game.solve(layout, R.a, R), b = Game.solve(layout, R.b, R);
  const out = Game.scoreSubmission(R, layout, { mode: 'A', route: a.path, route2: b.path });
  assert.deepEqual(out, { meters: a.meters + b.meters, score: Game.pts(a.meters) + Game.pts(b.meters), mode: 'A', route: a.path, route2: b.path });
  assert.deepEqual(Game.scoreSubmission(R, layout, { route: a.path, route2: b.path }), out);         // A is the default
  // one trip skipped scores 0 for that trip
  assert.deepEqual(Game.scoreSubmission(R, layout, { mode: 'A', route: a.path }), { meters: a.meters, score: Game.pts(a.meters), mode: 'A', route: a.path, route2: null });
  assert.deepEqual(Game.scoreSubmission(R, layout, { mode: 'A', route: null, route2: b.path }), { meters: b.meters, score: Game.pts(b.meters), mode: 'A', route: null, route2: b.path });
  // nothing at all
  assert.deepEqual(Game.scoreSubmission(R, layout, { mode: 'A' }), { err: 'Finish at least one trip first.' });
  assert.deepEqual(Game.scoreSubmission(R, layout, {}), { err: 'Finish at least one trip first.' });
  // a broken trip is an error, not a silent zero
  assert.equal(Game.scoreSubmission(R, layout, { mode: 'A', route: a.path, route2: ['A3', 'B3', 'A3'] }).err.slice(0, 22), 'You have not picked up');
  assert.ok(Game.scoreSubmission(R, layout, { mode: 'A', route: b.path, route2: a.path }).err || a.path.join() === b.path.join());
});

test('scoreSubmission: double drop when one order cannot be delivered', function () {
  const layout = randomLayout(77), R = DOUBLE;
  delete layout[Game.where(layout, R.b[0])];                                  // order B now has an item that was never stocked
  const a = Game.solve(layout, R.a, R);
  assert.deepEqual(Game.scoreSubmission(R, layout, { mode: 'A', route: a.path, route2: a.path }), { meters: a.meters, score: Game.pts(a.meters), mode: 'A', route: a.path, route2: null });
  assert.match(Game.scoreSubmission(R, layout, { mode: 'B', route: a.path }).err, /never stocked/);
  delete layout[Game.where(layout, R.a[0])];
  assert.deepEqual(Game.scoreSubmission(R, layout, { mode: 'A', route: a.path, route2: a.path }), { err: 'Finish at least one trip first.' });
});

test('scoreSubmission: double drop, one heavy cart (B)', function () {
  const layout = randomLayout(77), R = DOUBLE, all = R.a.concat(R.b);
  const s = Game.solve(layout, all, R);
  const out = Game.scoreSubmission(R, layout, { mode: 'B', route: s.path, route2: ['ignored'] });
  const m = Math.ceil(1.25 * s.meters);
  assert.deepEqual(out, { meters: m, score: Math.max(0, 300 - 2 * m), mode: 'B', route: s.path, route2: null });
  const a = Game.solve(layout, R.a, R);
  assert.ok(Game.scoreSubmission(R, layout, { mode: 'B', route: a.path }).err, 'a cart trip must collect both orders');
  const dbl = Object.assign({}, R, { mult: 3 });
  assert.equal(Game.scoreSubmission(dbl, layout, { mode: 'B', route: s.path }).score, out.score * 3);
  assert.equal(Game.scoreSubmission(dbl, layout, { mode: 'A', route: a.path }).score, Game.pts(a.meters) * 3);
});

// ---------------------------------------------------------------- bestFor
test('bestFor: handing in its path scores exactly its score, on every round', function () {
  for (let seed = 1; seed <= 10; seed++) {
    const layout = seed === 10 ? cleanLayout() : randomLayout(seed * 104729);
    ROUNDS.forEach(function (R) {
      const best = Game.bestFor(R, layout), tag = 'seed ' + seed + ' round ' + R.id;
      assert.ok(best, tag);
      const out = Game.scoreSubmission(R, layout, { mode: best.mode, route: best.path, route2: best.path2 });
      assert.equal(out.err, undefined, tag + ': ' + out.err);
      assert.equal(out.score, best.score, tag); assert.equal(out.meters, best.meters, tag); assert.equal(out.mode, best.mode, tag);
      if (!R.double) {
        assert.equal(best.mode, null); assert.equal(best.path2, null);
        assert.equal(best.score, Game.pts(bruteBest(layout, R.items, R)) * (R.mult || 1), tag);
      } else {
        const a = bruteBest(layout, R.a, R), b = bruteBest(layout, R.b, R), ab = bruteBest(layout, R.a.concat(R.b), R);
        const scoreA = Game.pts(a) + Game.pts(b), scoreB = Game.cartPts(Game.cartMeters(ab));
        assert.equal(best.score, Math.max(scoreA, scoreB) * (R.mult || 1), tag);
        assert.equal(best.mode, scoreB > scoreA ? 'B' : 'A', tag);
      }
      // nothing legal beats it
      const trips = Game.tripsOf(R, 'A').map(function (items) { return greedyRoute(layout, items, R); });
      const other = Game.scoreSubmission(R, layout, { mode: 'A', route: trips[0], route2: trips[1] });
      assert.ok(other.score <= best.score, tag);
    });
  }
});

test('bestFor: both ways of doing the double drop can win', function () {
  // Two orders in opposite corners with no shortcut between them: two trips beat the heavy cart.
  const far = {};
  ['J1', 'J2', 'J3', 'D2'].forEach(function (c, i) { far[c] = { p: DOUBLE.a[i], l: 'M' }; });
  ['C7', 'C8', 'C4', 'C5'].forEach(function (c, i) { far[c] = { p: DOUBLE.b[i], l: 'M' }; });
  const bestA = Game.bestFor(DOUBLE, far);
  assert.equal(bestA.mode, 'A');
  assert.equal(bestA.meters, 20 + 12); assert.equal(bestA.score, Game.pts(20) + Game.pts(12));
  assert.ok(bestA.path && bestA.path2);
  // Everything on one aisle: one cart trip is clearly better.
  const near = {};
  ['C2', 'D2', 'E2', 'F2'].forEach(function (c, i) { near[c] = { p: DOUBLE.a[i], l: 'M' }; });
  ['C4', 'D4', 'E4', 'F4'].forEach(function (c, i) { near[c] = { p: DOUBLE.b[i], l: 'M' }; });
  const bestB = Game.bestFor(DOUBLE, near);
  assert.equal(bestB.mode, 'B');
  assert.equal(bestB.meters, Game.cartMeters(10)); assert.equal(bestB.score, Game.cartPts(13)); assert.equal(bestB.path2, null);
});

test('bestFor: layouts with missing products', function () {
  assert.equal(Game.bestFor(SINGLE, {}), null);
  assert.equal(Game.bestFor(DOUBLE, {}), null);
  const layout = randomLayout(31337);
  delete layout[Game.where(layout, SINGLE.items[0])];
  assert.equal(Game.bestFor(SINGLE, layout), null);
  const l2 = randomLayout(31337);
  delete l2[Game.where(l2, DOUBLE.b[1])];
  const best = Game.bestFor(DOUBLE, l2), a = Game.solve(l2, DOUBLE.a, DOUBLE);
  assert.deepEqual(best, { mode: 'A', meters: a.meters, score: Game.pts(a.meters), path: a.path, path2: null });
  const out = Game.scoreSubmission(DOUBLE, l2, { mode: 'A', route: best.path, route2: best.path2 });
  assert.equal(out.score, best.score);
  const l3 = randomLayout(31337);
  delete l3[Game.where(l3, DOUBLE.a[1])];
  const best3 = Game.bestFor(DOUBLE, l3);
  assert.equal(best3.path, null); assert.ok(best3.path2);
  assert.equal(Game.scoreSubmission(DOUBLE, l3, { mode: 'A', route: best3.path, route2: best3.path2 }).score, best3.score);
});

// ---------------------------------------------------------------- rounds.js
test('rounds: the list is well-formed', function () {
  assert.equal(ROUNDS.length, 16);
  assert.equal(new Set(ROUNDS.map(function (r) { return r.id; })).size, 16, 'round ids must be unique');
  assert.equal(new Set(ROUNDS.map(function (r) { return r.label; })).size, 16, 'round labels must be unique');
  ROUNDS.forEach(function (R, i) {
    const tag = 'round ' + R.id;
    assert.match(R.id, /^[a-z0-9]+$/, tag);
    assert.ok(typeof R.label === 'string' && R.label.length > 0 && R.label.length <= 30, tag);
    assert.ok(typeof R.title === 'string' && R.title.length > 0 && R.title.length <= 40, tag);
    assert.ok(Number.isInteger(R.secs) && R.secs >= 30 && R.secs <= 3600, tag + ' secs');
    assert.ok(R.stage === 2 || R.stage === 3, tag + ' stage');
    assert.equal(R.stage, i < 10 ? 2 : 3, tag + ' stage order');
    if (i < 10) { assert.ok(!R.oneWay && !R.blocked && !R.double && !R.mult && !R.crisis, tag + ' must be a plain order'); }
    else assert.ok(typeof R.crisis === 'string' && R.crisis.length > 10, tag + ' needs a crisis line');
    const lists = R.double ? [R.a, R.b] : [R.items];
    if (R.double) assert.equal(R.items, undefined, tag); else { assert.equal(R.a, undefined, tag); assert.equal(R.b, undefined, tag); }
    const all = [].concat.apply([], lists);
    lists.forEach(function (l) { assert.ok(Array.isArray(l) && l.length >= 1 && l.length <= 8, tag + ' items'); });
    all.forEach(function (n) { assert.ok(Number.isInteger(n) && n >= 1 && n <= 24, tag + ' item ' + n); });
    assert.equal(new Set(all).size, all.length, tag + ' lists an item twice');
    assert.ok(all.length <= 12, tag + ' has too many items for solve');
    if (R.blocked) {
      assert.ok(Array.isArray(R.blocked) && R.blocked.length > 0, tag);
      R.blocked.forEach(function (c) {
        assert.ok(Game.validCell(c), tag + ' blocked ' + c);
        assert.equal(Game.kindOf(c), 'walk', tag + ' can only block a walkway square, not ' + c);
      });
      assert.equal(new Set(R.blocked).size, R.blocked.length, tag);
    }
    if (R.oneWay !== undefined) assert.equal(R.oneWay, true, tag);
    if (R.mult !== undefined) assert.ok(Number.isInteger(R.mult) && R.mult >= 1 && R.mult <= 5, tag);
    if (R.double !== undefined) assert.equal(R.double, true, tag);
  });
  const kinds = ROUNDS.slice(10);
  assert.equal(kinds.filter(function (r) { return r.oneWay && !r.blocked; }).length, 2, 'two oil spills');
  assert.equal(kinds.filter(function (r) { return r.blocked && !r.oneWay; }).length, 2, 'two pallet crashes');
  assert.equal(kinds.filter(function (r) { return r.double; }).length, 1, 'one double drop');
  const last = ROUNDS[15];
  assert.ok(last.mult === 2 && last.oneWay && last.blocked, 'the last round is the double-points final boss');
});

test('rounds: sales figures and layout time', function () {
  assert.ok(Number.isFinite(LAYOUT_MINUTES) && LAYOUT_MINUTES * 60 >= 30 && LAYOUT_MINUTES * 60 <= 3600);
  assert.deepEqual(Object.keys(SOLD).map(Number).sort(function (a, b) { return a - b; }), Game.PRODUCTS.map(function (p) { return p.n; }));
  Object.keys(SOLD).forEach(function (k) { assert.ok(Number.isInteger(SOLD[k]) && SOLD[k] > 0, 'sales of ' + k); });
});

test('rounds: every order can be delivered wherever the items were stocked', function () {
  ROUNDS.forEach(function (R) {
    const fromStart = refDistances(Game.START, R);
    PLACEABLE.forEach(function (cell) {
      const sp = Game.spots(cell, R);
      assert.ok(sp.length >= 1, R.id + ': ' + cell + ' cannot be picked from');
      const ok = sp.some(function (s) { return fromStart[s] !== undefined && Game.pathTo(Game.START, s, R) && Game.pathTo(s, Game.START, R); });
      assert.ok(ok, R.id + ': a picker cannot get to ' + cell + ' and back');
      // and solve agrees, for a one-item order on that very square
      const s1 = Game.solve({ [cell]: { p: 1, l: 'M' } }, [1], R);
      assert.ok(s1 && s1.meters >= 2, R.id + ': solve fails for ' + cell);
    });
    // no walkway square is a trap: from anywhere you can reach, you can get home
    Object.keys(fromStart).forEach(function (c) { assert.ok(Game.pathTo(c, Game.START, R), R.id + ': stuck at ' + c); });
  });
});

test('rounds: every order is deliverable and worth points with full random layouts', function () {
  let worst = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const layout = randomLayout(seed * 31 + 5);
    ROUNDS.forEach(function (R) {
      const best = Game.bestFor(R, layout);
      assert.ok(best, 'seed ' + seed + ' ' + R.id);
      Game.tripsOf(R, 'A').forEach(function (items) {
        const s = Game.solve(layout, items, R);
        assert.ok(s, 'seed ' + seed + ' ' + R.id);
        assert.ok(s.path.length <= 400, 'route too long to hand in');
        worst = Math.max(worst, s.meters);
      });
    });
  }
  assert.ok(worst < 400);
});

test('rounds: the round object carries no functions or surprises (it is sent to phones as JSON)', function () {
  ROUNDS.forEach(function (R) {
    assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
    const allowed = ['id', 'stage', 'label', 'title', 'items', 'secs', 'oneWay', 'blocked', 'double', 'a', 'b', 'mult', 'crisis'];
    Object.keys(R).forEach(function (k) { assert.ok(allowed.includes(k), R.id + ' has an unknown field ' + k); });
  });
});
