// DARK STORE BLITZ - the rules of the game, in one place.
// The server (Node) and every screen (browser) load THIS file, so they can never disagree.
// It holds no secrets: upcoming orders and sales figures live in rounds.js, which only the server reads.
// The two route-solver functions (solve, bestFor) are marked "server-only": phones get this file without them.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Game = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROWS = 'ABCDEFGHIJ';
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var START = 'A3';
  var LEVELS = { T: 'Top', M: 'Middle', B: 'Bottom' };
  var SCORE = { base: 150, perMeter: 2, speedBonus: 10, perfectBonus: 20, cartFactor: 1.25 };
  var PENALTY = { cold: 75, chemical: 50, foodInChem: 50, heavy: 30, fragile: 30, eggsAtta: 30 };

  var PRODUCTS = [
    [1, 'Milk', '', '🥛'], [2, 'Maggi', '', '🍜'], [3, 'Bread', 'FRAGILE', '🍞'], [4, 'Coke', '', '🥤'],
    [5, 'Potato & Onion', '', '🥔'], [6, 'Eggs', 'FRAGILE', '🥚'], [7, 'Sunflower Oil', '', '🌻'],
    [8, 'Chips', 'FRAGILE', '🍟'], [9, 'Atta 5kg', 'HEAVY', '🌾'], [10, 'Handwash', '', '🧼'],
    [11, 'Dairy Milk', '', '🍫'], [12, 'Bananas', '', '🍌'], [13, 'Harpic', 'CHEMICAL', '🚽'],
    [14, 'Colgate', '', '🦷'], [15, 'Cornetto', 'COLD', '🍦'], [16, 'Surf Excel', 'CHEMICAL', '🧺'],
    [17, 'Frozen Peas', 'COLD', '🧊'], [18, 'Coffee', '', '☕'], [19, 'Batteries', '', '🔋'],
    [20, 'Olive Oil', 'FRAGILE', '🍾'], [21, 'Band-Aid Kit', '', '🩹'], [22, 'Mosquito Refill', 'CHEMICAL', '🦟'],
    [23, 'Almonds', '', '🌰'], [24, 'Greek Yogurt', 'COLD', '🥣']
  ].map(function (x) { return { n: x[0], name: x[1], tag: x[2], emoji: x[3] }; });
  var NOT_FOOD = [10, 13, 14, 16, 19, 21, 22];

  // ---------- the map ----------
  // r is 0..9 (rows A..J), c is 1..10. A cell id is a string like "B6".
  function kind(r, c) {
    if (r === 0) return c === 3 ? 'start' : c < 3 ? 'counter' : 'dock';
    if (r === 1 || r === 8) return 'walk';
    if (r === 9) return c <= 3 ? 'cold' : c <= 6 ? 'spare' : c === 7 ? 'gap' : 'chem';
    if (c === 3 || c === 6 || c === 9) return 'walk';
    if (r <= 5 && (c === 2 || c === 4 || c === 5 || c === 7 || c === 8)) return 'shelf';
    return 'closed';
  }
  function cid(r, c) { return ROWS.charAt(r) + c; }
  function rc(s) { return [ROWS.indexOf(s.charAt(0)), Number(s.slice(1))]; }
  function validCell(s) { return typeof s === 'string' && /^[A-J](10|[1-9])$/.test(s); }
  function kindOf(id) { var q = rc(id); return kind(q[0], q[1]); }
  function placeable(id) { var k = kindOf(id); return k === 'shelf' || k === 'spare' || k === 'cold' || k === 'chem'; }

  // A "rule" is the round being played (or null). It may carry:
  //   oneWay: true          aisle 6 can only be walked downward
  //   blocked: ['B4', ...]  walkway squares nobody can stand on
  function isBlocked(rule, id) { return !!(rule && rule.blocked && rule.blocked.indexOf(id) >= 0); }
  function walk(r, c, rule) {
    if (r < 0 || r > 9 || c < 1 || c > 10) return false;
    var k = kind(r, c);
    return (k === 'walk' || k === 'start') && !isBlocked(rule, cid(r, c));
  }
  function steps(cell, rule) {            // walkway squares you may step to from here
    var q = rc(cell), out = [], i, dr, dc;
    for (i = 0; i < 4; i++) {
      dr = DIRS[i][0]; dc = DIRS[i][1];
      if (!walk(q[0] + dr, q[1] + dc, rule)) continue;
      if (rule && rule.oneWay && q[1] === 6 && dr === -1) continue;   // oil spill: never walk up aisle 6
      out.push(cid(q[0] + dr, q[1] + dc));
    }
    return out;
  }
  function spots(cell, rule) {            // walkway squares that touch a shelf square (where you can pick from)
    var q = rc(cell), out = [], i;
    for (i = 0; i < 4; i++) if (walk(q[0] + DIRS[i][0], q[1] + DIRS[i][1], rule)) out.push(cid(q[0] + DIRS[i][0], q[1] + DIRS[i][1]));
    return out;
  }
  function where(layout, p) { for (var k in layout) if (layout[k] && layout[k].p === p) return k; return null; }
  function product(n) { return PRODUCTS[n - 1]; }

  function pathTo(from, to, rule) {       // shortest legal walk between two walkway squares, or null
    if (from === to) return [from];
    var prev = {}, q = [from], x, ns, i, n, out;
    prev[from] = '';
    while (q.length) {
      x = q.shift(); ns = steps(x, rule);
      for (i = 0; i < ns.length; i++) {
        n = ns[i];
        if (prev[n] !== undefined) continue;
        prev[n] = x;
        if (n === to) { out = [to]; while (out[0] !== from) out.unshift(prev[out[0]]); return out; }
        q.push(n);
      }
    }
    return null;
  }
  function pickedOf(route, items, layout, rule) {   // {productNumber: 1} for every item this route has collected
    var st = {}, out = {}, i, j, w, sp;
    for (i = 0; i < route.length; i++) st[route[i]] = 1;
    for (i = 0; i < items.length; i++) {
      w = where(layout, items[i]);
      if (!w) continue;
      sp = spots(w, rule);
      for (j = 0; j < sp.length; j++) if (st[sp[j]]) { out[items[i]] = 1; break; }
    }
    return out;
  }
  function missing(items, layout) { return items.filter(function (p) { return !where(layout, p); }); }
  function isDone(route, items, layout, rule) {
    if (!route || route.length < 2 || route[route.length - 1] !== START) return false;
    var pk = pickedOf(route, items, layout, rule);
    return items.every(function (p) { return pk[p]; });
  }

  // Shortest possible trip: {meters, path} or null if an item is not stocked or cannot be reached.
  // (The server cuts everything between the two server-only marks out of the copy it sends to phones.)
  /*<server-only solve>*/
  function solve(layout, items, rule) {
    var pick = {}, i, j, cell, sp, full = (1 << items.length) - 1;
    for (i = 0; i < items.length; i++) {
      cell = where(layout, items[i]);
      if (!cell) return null;
      sp = spots(cell, rule);
      for (j = 0; j < sp.length; j++) pick[sp[j]] = (pick[sp[j]] || 0) | (1 << i);
    }
    var m0 = pick[START] || 0, k0 = START + '|' + m0;
    var parent = {}, frontier = [[START, m0, k0]], d = 0, next, f, ns, n, m, k, out;
    parent[k0] = '';
    while (frontier.length) {
      next = [];
      for (i = 0; i < frontier.length; i++) {
        f = frontier[i];
        if (f[0] === START && f[1] === full && d > 0) {
          out = []; k = f[2];
          while (k) { out.unshift(k.split('|')[0]); k = parent[k]; }
          return { meters: d, path: out };
        }
        ns = steps(f[0], rule);
        for (j = 0; j < ns.length; j++) {
          n = ns[j]; m = f[1] | (pick[n] || 0); k = n + '|' + m;
          if (parent[k] === undefined) { parent[k] = f[2]; next.push([n, m, k]); }
        }
      }
      frontier = next; d++;
    }
    return null;
  }
  /*</server-only>*/

  // Returns a problem in words, or null if the route is fine.
  function checkRoute(layout, items, route, rule) {
    if (!Array.isArray(route) || route.length < 3 || route.length > 400) return 'That route is empty.';
    if (route[0] !== START || route[route.length - 1] !== START) return 'A route must start and end at ' + START + '.';
    for (var i = 1; i < route.length; i++) {
      if (!validCell(route[i]) || steps(route[i - 1], rule).indexOf(route[i]) < 0) return 'That route has an illegal step.';
    }
    var pk = pickedOf(route, items, layout, rule);
    for (i = 0; i < items.length; i++) {
      if (!where(layout, items[i])) return product(items[i]).name + ' was never stocked.';
      if (!pk[items[i]]) return 'You have not picked up ' + product(items[i]).name + '.';
    }
    return null;
  }

  function penalties(layout) {            // [{pts, why}] for one team's layout
    var out = [], cell, it, k, p;
    for (cell in layout) {
      it = layout[cell]; k = kindOf(cell); p = product(it.p);
      if (p.tag === 'COLD' && k !== 'cold') out.push({ pts: PENALTY.cold, why: p.name + ' is cold but not in J1 to J3' });
      if (p.tag === 'CHEMICAL' && k !== 'chem') out.push({ pts: PENALTY.chemical, why: p.name + ' is a chemical but not in J8 to J10' });
      if (k === 'chem' && NOT_FOOD.indexOf(it.p) < 0) out.push({ pts: PENALTY.foodInChem, why: p.name + ' is food in the chemical zone' });
      if (p.tag === 'HEAVY' && it.l !== 'B') out.push({ pts: PENALTY.heavy, why: p.name + ' is heavy but not on the bottom level' });
      if (p.tag === 'FRAGILE' && it.l === 'B') out.push({ pts: PENALTY.fragile, why: p.name + ' is fragile but on the bottom level' });
    }
    var e = where(layout, 6), a = where(layout, 9);
    if (e && a) {
      var q1 = rc(e), q2 = rc(a);
      if (Math.abs(q1[0] - q2[0]) + Math.abs(q1[1] - q2[1]) === 1) out.push({ pts: PENALTY.eggsAtta, why: 'Eggs are next to Atta' });
    }
    return out;
  }

  // ---------- scoring ----------
  // A round R is one of:
  //   single: {id, label, title, items:[...], secs, oneWay?, blocked?, mult?}
  //   double: {id, label, title, double:true, a:[...], b:[...], secs, mult?}
  // mult multiplies the points of the round (the finale is worth double).
  function pts(meters) { return Math.max(0, SCORE.base - SCORE.perMeter * meters); }
  function cartMeters(steps_) { return Math.ceil(SCORE.cartFactor * steps_); }
  function cartPts(meters) { return Math.max(0, 2 * SCORE.base - SCORE.perMeter * meters); }
  function tripsOf(R, mode) { return !R.double ? [R.items] : mode === 'B' ? [R.a.concat(R.b)] : [R.a, R.b]; }

  // sub = {route, route2, mode}. Returns {err} or {meters, score, mode, route, route2}. Bonuses are added by the server.
  function scoreSubmission(R, layout, sub) {
    var mult = R.mult || 1, why, meters = 0, score = 0;
    sub = sub || {};
    if (!R.double) {
      if ((why = checkRoute(layout, R.items, sub.route, R))) return { err: why };
      meters = sub.route.length - 1;
      return { meters: meters, score: pts(meters) * mult, mode: null, route: sub.route.slice(), route2: null };
    }
    if (sub.mode === 'B') {
      if ((why = checkRoute(layout, R.a.concat(R.b), sub.route, R))) return { err: why };
      meters = cartMeters(sub.route.length - 1);
      return { meters: meters, score: cartPts(meters) * mult, mode: 'B', route: sub.route.slice(), route2: null };
    }
    var pairs = [[R.a, sub.route], [R.b, sub.route2]], kept = [null, null], any = false, i;
    for (i = 0; i < 2; i++) {
      if (pairs[i][1] == null || missing(pairs[i][0], layout).length) continue;      // a skipped trip scores 0
      if ((why = checkRoute(layout, pairs[i][0], pairs[i][1], R))) return { err: why };
      meters += pairs[i][1].length - 1; score += pts(pairs[i][1].length - 1); kept[i] = pairs[i][1].slice(); any = true;
    }
    if (!any) return { err: 'Finish at least one trip first.' };
    return { meters: meters, score: score * mult, mode: 'A', route: kept[0], route2: kept[1] };
  }

  // The best this layout could have scored on round R: {meters, score, mode, path, path2} or null.
  /*<server-only bestFor>*/
  function bestFor(R, layout) {
    var mult = R.mult || 1, s;
    if (!R.double) {
      s = solve(layout, R.items, R);
      return s ? { meters: s.meters, score: pts(s.meters) * mult, mode: null, path: s.path, path2: null } : null;
    }
    var a = solve(layout, R.a, R), b = solve(layout, R.b, R), out = null;
    if (a || b) {
      out = { mode: 'A', meters: (a ? a.meters : 0) + (b ? b.meters : 0), score: ((a ? pts(a.meters) : 0) + (b ? pts(b.meters) : 0)) * mult, path: a ? a.path : null, path2: b ? b.path : null };
      if (a && b) {
        s = solve(layout, R.a.concat(R.b), R);
        var m = cartMeters(s.meters), sc = cartPts(m) * mult;
        if (sc > out.score) out = { mode: 'B', meters: m, score: sc, path: s.path, path2: null };
      }
    }
    return out;
  }
  /*</server-only>*/

  return {
    ROWS: ROWS, DIRS: DIRS, START: START, LEVELS: LEVELS, SCORE: SCORE, PENALTY: PENALTY, PRODUCTS: PRODUCTS, NOT_FOOD: NOT_FOOD,
    kind: kind, kindOf: kindOf, cid: cid, rc: rc, validCell: validCell, placeable: placeable, isBlocked: isBlocked, walk: walk,
    steps: steps, spots: spots, where: where, product: product, pathTo: pathTo, pickedOf: pickedOf, missing: missing, isDone: isDone,
    solve: solve, checkRoute: checkRoute, penalties: penalties, pts: pts, cartMeters: cartMeters, cartPts: cartPts, tripsOf: tripsOf,
    scoreSubmission: scoreSubmission, bestFor: bestFor
  };
});
