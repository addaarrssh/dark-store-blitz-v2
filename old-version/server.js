// DARK STORE BLITZ - game server. Runs only on this laptop. Needs Node.js, nothing else.
// Start:  node server.js        Stop:  Ctrl + C
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const LAYOUT_MINUTES = 30;                               // length of Round 1
const SAVE = path.join(__dirname, 'blitz-save.json');    // safety copy, removed by "Reset game"

const PRODUCTS = [
  [1, 'Milk', 120, ''], [2, 'Maggi', 110, ''], [3, 'Bread', 95, 'FRAGILE'], [4, 'Coke', 85, ''],
  [5, 'Potato & Onion', 80, ''], [6, 'Eggs', 75, 'FRAGILE'], [7, 'Sunflower Oil', 60, ''],
  [8, 'Chips', 55, 'FRAGILE'], [9, 'Atta 5kg', 45, 'HEAVY'], [10, 'Handwash', 40, ''],
  [11, 'Dairy Milk', 38, ''], [12, 'Bananas', 35, ''], [13, 'Harpic', 25, 'CHEMICAL'],
  [14, 'Colgate', 20, ''], [15, 'Cornetto', 18, 'COLD'], [16, 'Surf Excel', 15, 'CHEMICAL'],
  [17, 'Frozen Peas', 12, 'COLD'], [18, 'Coffee', 10, ''], [19, 'Batteries', 8, ''],
  [20, 'Olive Oil', 5, 'FRAGILE'], [21, 'Band-Aid Kit', 4, ''], [22, 'Mosquito Refill', 3, 'CHEMICAL'],
  [23, 'Almonds', 2, ''], [24, 'Greek Yogurt', 2, 'COLD']
].map(([n, name, sold, tag]) => ({ n, name, sold, tag }));
const NOT_FOOD = [10, 13, 14, 16, 19, 21, 22];

const ROUNDS = [
  { id: 'o1', label: 'Order 1', title: 'Breakfast Rush', items: [1, 3, 6], secs: 180 },
  { id: 'o2', label: 'Order 2', title: 'Midnight Munchies', items: [2, 4, 8, 11], secs: 180 },
  { id: 'o3', label: 'Order 3', title: 'Monthly Grocery', items: [9, 7, 14], secs: 180 },
  { id: 'o4', label: 'Order 4', title: 'Cleaning Day', items: [13, 16, 10, 14], secs: 180 },
  { id: 'o5', label: 'Order 5', title: 'Cold Chain', items: [15, 17, 24, 1], secs: 180 },
  { id: 'o6', label: 'Order 6', title: 'Office Snack', items: [12, 18, 23], secs: 180 },
  { id: 'o7', label: 'Order 7', title: 'Emergency', items: [21, 22, 10], secs: 180 },
  { id: 'o8', label: 'Order 8', title: 'Party Rush', items: [4, 8, 1, 12], secs: 180 },
  { id: 'o9', label: 'Order 9', title: 'Heavy & Fragile', items: [9, 20, 6], secs: 180 },
  { id: 'o10', label: 'Order 10', title: 'Gourmet', items: [20, 24, 2], secs: 180 },
  { id: 'c1a', label: 'Oil spill 1', title: 'Monthly Grocery, again', items: [9, 7, 14], oneWay: true, secs: 180 },
  { id: 'c1b', label: 'Oil spill 2', title: 'Office Snack, again', items: [12, 18, 23], oneWay: true, secs: 180 },
  { id: 'c2', label: 'Double drop', title: 'Two orders at once', double: true, a: [1, 9, 7, 12], b: [2, 4, 8, 6], secs: 240 }
];

// ---------- the map ----------
const ROWS = 'ABCDEFGHIJ', DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function kind(r, c) {
  if (r === 0) return c === 3 ? 'start' : c < 3 ? 'counter' : 'dock';
  if (r === 1 || r === 8) return 'walk';
  if (r === 9) return c <= 3 ? 'cold' : c <= 6 ? 'spare' : c === 7 ? 'gap' : 'chem';
  if (c === 3 || c === 6 || c === 9) return 'walk';
  if (r <= 5 && (c === 2 || c === 4 || c === 5 || c === 7 || c === 8)) return 'shelf';
  return 'closed';
}
const cid = (r, c) => ROWS[r] + c;
const rc = s => [ROWS.indexOf(s[0]), Number(s.slice(1))];
const walk = (r, c) => r >= 0 && r <= 9 && c >= 1 && c <= 10 && (kind(r, c) === 'walk' || kind(r, c) === 'start');
const placeable = (r, c) => ['shelf', 'spare', 'cold', 'chem'].includes(kind(r, c));
const where = (layout, p) => Object.keys(layout).find(k => layout[k].p === p) || null;
const nameOf = p => PRODUCTS[p - 1].name;
const pts = m => Math.max(0, 150 - 2 * m);

function steps(cell, oneWay) {            // walkway squares you may step to from here
  const [r, c] = rc(cell), out = [];
  for (const [dr, dc] of DIRS) {
    if (!walk(r + dr, c + dc)) continue;
    if (oneWay && c === 6 && dr === -1) continue;      // oil spill: never walk up aisle 6
    out.push(cid(r + dr, c + dc));
  }
  return out;
}
function spots(cell) {                    // walkway squares that touch a shelf square
  const [r, c] = rc(cell);
  return DIRS.filter(([dr, dc]) => walk(r + dr, c + dc)).map(([dr, dc]) => cid(r + dr, c + dc));
}

function solve(layout, items, oneWay) {   // shortest possible trip in meters, or null if an item is not stocked
  const pick = {};
  for (let i = 0; i < items.length; i++) {
    const cell = where(layout, items[i]);
    if (!cell) return null;
    for (const w of spots(cell)) pick[w] = (pick[w] || 0) | (1 << i);
  }
  const full = (1 << items.length) - 1;
  let frontier = [['A3', 0]], d = 0;
  const seen = new Set(['A3|0']);
  while (frontier.length) {
    const next = [];
    for (const [cell, mask] of frontier) {
      if (cell === 'A3' && mask === full) return d;
      for (const n of steps(cell, oneWay)) {
        const m = mask | (pick[n] || 0), k = n + '|' + m;
        if (!seen.has(k)) { seen.add(k); next.push([n, m]); }
      }
    }
    frontier = next; d++;
  }
  return null;
}

function checkRoute(layout, items, route, oneWay) {   // returns a problem in words, or nothing if the route is fine
  if (!Array.isArray(route) || route.length < 3 || route.length > 400) return 'That route is empty.';
  if (route[0] !== 'A3' || route[route.length - 1] !== 'A3') return 'A route must start and end at A3.';
  for (let i = 1; i < route.length; i++) {
    if (typeof route[i] !== 'string' || !steps(route[i - 1], oneWay).includes(route[i])) return 'That route has an illegal step.';
  }
  const stood = new Set(route);
  for (const p of items) {
    const cell = where(layout, p);
    if (!cell) return nameOf(p) + ' was never stocked.';
    if (!spots(cell).some(w => stood.has(w))) return 'You have not picked up ' + nameOf(p) + '.';
  }
}

function penalties(layout) {
  const out = [];
  for (const cell of Object.keys(layout)) {
    const { p, l } = layout[cell], k = kind(...rc(cell)), tag = PRODUCTS[p - 1].tag, nm = nameOf(p);
    if (tag === 'COLD' && k !== 'cold') out.push({ pts: 75, why: nm + ' is cold but not in J1 to J3' });
    if (tag === 'CHEMICAL' && k !== 'chem') out.push({ pts: 50, why: nm + ' is a chemical but not in J8 to J10' });
    if (k === 'chem' && !NOT_FOOD.includes(p)) out.push({ pts: 50, why: nm + ' is food in the chemical zone' });
    if (tag === 'HEAVY' && l !== 'B') out.push({ pts: 30, why: nm + ' is heavy but not on the bottom level' });
    if (tag === 'FRAGILE' && l === 'B') out.push({ pts: 30, why: nm + ' is fragile but on the bottom level' });
  }
  const e = where(layout, 6), a = where(layout, 9);
  if (e && a) {
    const [r1, c1] = rc(e), [r2, c2] = rc(a);
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1) out.push({ pts: 30, why: 'Eggs are next to Atta' });
  }
  return out;
}

// ---------- game state ----------
function fresh(pin) {
  return { phase: 'lobby', endsAt: 0, noTimer: true, ri: -1, showSales: false, done: [], teams: {}, hostPin: pin || String(crypto.randomInt(100000, 1000000)) };
}
let S = fresh(), dirty = false, bestCache = {};
try { S = Object.assign(fresh(), JSON.parse(fs.readFileSync(SAVE, 'utf8'))); console.log('  Picked up the saved game from blitz-save.json'); } catch (e) {}

const started = () => S.phase !== 'lobby' && S.phase !== 'layout';
function endRound() {
  const R = ROUNDS[S.ri];
  S.phase = 'reveal'; S.endsAt = 0; dirty = true;
  if (R && !S.done.includes(R.id)) S.done.push(R.id);
}
function tick() {
  if (S.noTimer || !S.endsAt || Date.now() < S.endsAt) return;
  if (S.phase === 'layout') { S.phase = 'locked'; S.endsAt = 0; dirty = true; }
  else if (S.phase === 'order') endRound();
}
setInterval(() => {
  tick();
  if (dirty) { dirty = false; try { fs.writeFileSync(SAVE, JSON.stringify(S)); } catch (e) {} }
}, 1000);

function totals(t) {
  let p = 0, m = 0;
  for (const k of Object.keys(t.res)) { p += t.res[k].score + t.res[k].bonus; m += t.res[k].meters; }
  const pen = started() ? penalties(t.layout).reduce((s, x) => s + x.pts, 0) : 0;
  return { pts: p - pen, meters: m, pen };
}
function board() {
  return Object.values(S.teams).map(t => Object.assign({ name: t.name }, totals(t)))
    .sort((a, b) => b.pts - a.pts || a.meters - b.meters || a.name.localeCompare(b.name));
}
function best(t, R) {                      // the best this team could have done with its own layout
  const key = t.id + '|' + R.id;
  if (key in bestCache) return bestCache[key];
  let out = null;
  if (!R.double) {
    const m = solve(t.layout, R.items, R.oneWay);
    if (m != null) out = { meters: m, score: pts(m) };
  } else {
    const a = solve(t.layout, R.a), b = solve(t.layout, R.b);
    if (a != null || b != null) {
      out = { mode: 'A', meters: (a || 0) + (b || 0), score: (a == null ? 0 : pts(a)) + (b == null ? 0 : pts(b)) };
      if (a != null && b != null) {
        const m = Math.ceil(1.25 * solve(t.layout, R.a.concat(R.b))), s = Math.max(0, 300 - 2 * m);
        if (s > out.score) out = { mode: 'B', meters: m, score: s };
      }
    }
  }
  return (bestCache[key] = out);
}
function lanUrls() {
  const out = [], n = os.networkInterfaces();
  for (const k of Object.keys(n)) for (const a of n[k]) {
    if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push('http://' + a.address + ':' + PORT);
  }
  return out;
}

// ---------- what each screen is allowed to see ----------
function playerView(t) {
  const R = (S.phase === 'order' || S.phase === 'reveal') ? ROUNDS[S.ri] : null;
  return {
    ok: true, now: Date.now(), phase: S.phase, endsAt: S.endsAt, noTimer: !!S.noTimer,
    products: PRODUCTS.map(p => ({ n: p.n, name: p.name, tag: p.tag, sold: S.showSales ? p.sold : null })),
    team: Object.assign({ name: t.name, layout: t.layout, penList: started() ? penalties(t.layout) : [] }, totals(t)),
    round: R || null,
    mine: R ? t.res[R.id] || null : null,
    best: R && S.phase === 'reveal' ? best(t, R) : null,
    board: S.phase === 'reveal' || S.phase === 'final' ? board() : null
  };
}
function hostView() {
  const R = ROUNDS[S.ri] || null;
  return {
    ok: true, now: Date.now(), phase: S.phase, endsAt: S.endsAt, noTimer: !!S.noTimer, showSales: S.showSales, ri: S.ri, done: S.done,
    rounds: ROUNDS.map(r => ({ id: r.id, label: r.label })), round: R, urls: lanUrls(), products: PRODUCTS,
    teams: Object.values(S.teams).map(t => Object.assign({
      id: t.id, name: t.name, placed: Object.keys(t.layout).length,
      penList: started() ? penalties(t.layout) : [],
      res: R ? t.res[R.id] || null : null,
      best: R && S.phase === 'reveal' ? best(t, R) : null
    }, totals(t))),
    board: board()
  };
}

// ---------- actions ----------
function join(b) {
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 24), pin = String(b.pin || '').trim();
  if (name.length < 2) return { ok: false, err: 'Team name is too short.' };
  if (!/^\d{4}$/.test(pin)) return { ok: false, err: 'The team PIN must be 4 digits.' };
  let t = Object.values(S.teams).find(x => x.name.toLowerCase() === name.toLowerCase());
  if (t) {
    if (t.pin !== pin) return { ok: false, err: 'That team name is taken, or the PIN is wrong.' };
  } else {
    if (started()) return { ok: false, err: 'The game has already started. Ask the organiser.' };
    if (Object.keys(S.teams).length >= 80) return { ok: false, err: 'The game is full.' };
    t = { id: crypto.randomBytes(5).toString('hex'), name, pin, layout: {}, res: {} };
    S.teams[t.id] = t; dirty = true;
  }
  return { ok: true, tid: t.id, pin: t.pin };
}

function teamAct(a, b, t) {
  if (a === 'replay' || a === 'reset_order') {
    const R = ROUNDS[S.ri];
    if (R && t.res[R.id]) { delete t.res[R.id]; dirty = true; }
    return;
  }
  if (a === 'place' || a === 'remove') {
    if (S.phase !== 'layout') return S.phase === 'lobby' ? 'Round 1 has not started yet.' : 'Layouts are locked.';
    const cell = String(b.cell);
    if (!/^[A-J](10|[1-9])$/.test(cell) || !placeable(...rc(cell))) return 'That square cannot hold a product.';
    if (a === 'remove') { delete t.layout[cell]; dirty = true; return; }
    const p = Number(b.p), l = String(b.l);
    if (!Number.isInteger(p) || p < 1 || p > 24 || !['T', 'M', 'B'].includes(l)) return 'Pick a product and a level.';
    const old = where(t.layout, p);
    if (old) delete t.layout[old];
    t.layout[cell] = { p, l }; dirty = true; return;
  }
  if (a === 'submit') {
    const R = ROUNDS[S.ri];
    if (S.phase !== 'order' || !R || b.round !== R.id) return 'Too late, this order is closed.';
    if (t.res[R.id]) return 'You already handed this one in.';
    let meters = 0, score = 0, mode = null, why;
    if (!R.double) {
      if ((why = checkRoute(t.layout, R.items, b.route, R.oneWay))) return why;
      meters = b.route.length - 1; score = pts(meters);
    } else if (b.mode === 'B') {
      if ((why = checkRoute(t.layout, R.a.concat(R.b), b.route, false))) return why;
      mode = 'B'; meters = Math.ceil(1.25 * (b.route.length - 1)); score = Math.max(0, 300 - 2 * meters);
    } else {
      mode = 'A';
      let any = false;
      for (const [items, route] of [[R.a, b.route], [R.b, b.route2]]) {
        if (route == null || items.some(p => !where(t.layout, p))) continue;     // skipped trip scores 0
        if ((why = checkRoute(t.layout, items, route, false))) return why;
        meters += route.length - 1; score += pts(route.length - 1); any = true;
      }
      if (!any) return 'Finish at least one trip first.';
    }
    const earlier = Object.values(S.teams).filter(x => x.res[R.id]).length;
    t.res[R.id] = { meters, score, mode, bonus: earlier < 3 ? 10 : 0, at: Date.now() };
    dirty = true;
  }
}

function hostAct(a, b) {
  const now = Date.now();
  if (a === 'hstate') return;
  if (a === 'hlayout') {
    if (S.phase !== 'lobby' && !(S.phase === 'locked' && !S.done.length)) return 'Layouts cannot be reopened once orders have started.';
    const secs = Math.min(3600, Math.max(30, Number(b.secs) || LAYOUT_MINUTES * 60));
    S.phase = 'layout'; S.endsAt = now + secs * 1000; bestCache = {};
  } else if (a === 'htime') {
    if (!S.endsAt) return 'No timer is running.';
    S.endsAt += (Number(b.secs) || 60) * 1000;
  } else if (a === 'hlock') {
    if (S.phase !== 'layout') return 'Round 1 is not running.';
    S.phase = 'locked'; S.endsAt = 0;
  } else if (a === 'hnotimer') {
    S.noTimer = !S.noTimer;
    if (S.noTimer) S.endsAt = 0;
    else if (S.phase === 'order') S.endsAt = Date.now() + (ROUNDS[S.ri] ? ROUNDS[S.ri].secs : 180) * 1000;
  } else if (a === 'hround') {
    const R = ROUNDS[b.i];
    if (!R) return 'No such order.';
    if (!started()) return 'Lock the layouts first.';
    const teams = Object.values(S.teams);
    if (teams.some(t => t.res[R.id]) && !b.force) return { ok: false, need: R.label + ' was already played. Play it again and wipe its old scores?' };
    for (const t of teams) delete t.res[R.id];
    S.done = S.done.filter(x => x !== R.id);
    S.ri = Number(b.i); S.phase = 'order'; S.endsAt = S.noTimer ? 0 : now + R.secs * 1000;
  } else if (a === 'hend') {
    if (S.phase !== 'order') return 'No order is running.';
    endRound();
  } else if (a === 'hfinal') {
    if (!started()) return 'The game has not started.';
    S.phase = 'final'; S.endsAt = 0;
  } else if (a === 'hsales') {
    S.showSales = !S.showSales;
  } else if (a === 'hkick') {
    if (Object.prototype.hasOwnProperty.call(S.teams, String(b.tid))) delete S.teams[b.tid];
  } else if (a === 'hreset') {
    S = fresh(S.hostPin); bestCache = {}; dirty = false;
    try { fs.unlinkSync(SAVE); } catch (e) {}
    return;
  } else return 'Unknown action.';
  dirty = true;
}

function act(b) {
  tick();
  const a = String(b.a || '');
  if (a === 'join') return join(b);
  if (a[0] === 'h') {
    if (String(b.hp) !== S.hostPin) return { ok: false, badPin: true, err: 'Wrong host PIN.' };
    const r = hostAct(a, b);
    if (typeof r === 'string') return { ok: false, err: r };
    return r || hostView();
  }
  const t = Object.prototype.hasOwnProperty.call(S.teams, String(b.tid)) ? S.teams[b.tid] : null;
  if (!t || t.pin !== String(b.pin)) return { ok: false, gone: true };
  const e = teamAct(a, b, t);
  return e ? { ok: false, err: e } : playerView(t);
}

// ---------- web server ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0].replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && (url === '/' || url === '/host')) {
    fs.readFile(path.join(__dirname, 'index.html'), (e, data) => {
      if (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end('index.html is missing. It must sit next to server.js.'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (req.method === 'POST' && url === '/api') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 30000) req.destroy(); });
    req.on('end', () => {
      let out;
      try { out = act(JSON.parse(body || '{}') || {}); }
      catch (e) { console.error(e); out = { ok: false, err: 'Something went wrong. Try again.' }; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
});
server.on('error', e => {
  console.log(e.code === 'EADDRINUSE' ? '\n  The game is already running in another Terminal window. Close that one first.\n' : e);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  const urls = lanUrls();
  console.log('\n  DARK STORE BLITZ is running. Keep this window open.\n');
  console.log('  Organiser screen (this laptop):  http://localhost:' + PORT + '/host');
  console.log('  Host PIN:                        ' + S.hostPin);
  console.log('  Players type this on phones:     ' + (urls.join('   or   ') || 'connect this laptop to Wi-Fi, then start again'));
  console.log('\n  To stop the game press Ctrl + C\n');
});
