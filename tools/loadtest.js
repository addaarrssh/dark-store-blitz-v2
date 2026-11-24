#!/usr/bin/env node
// DARK STORE BLITZ - load test. Plays a whole game with bot teams and checks the server's sums.
//
//   node tools/loadtest.js --url http://localhost:3001 --pin <organiser PIN> --teams 200 [--phones 2] [--rounds all]
//   node tools/loadtest.js --url http://localhost:3001 --pin <organiser PIN> --smoke        (5 teams, fast)
//
// Other switches:
//   --rounds 6        play only the first 6 orders          --window 5000   bots hand in within this many ms
//   --layout-ms 15000 how long bots take to stock shelves    --seed 42       repeat the same random choices
//   --reset           wipe the game before AND after the run. Without it the tool refuses to touch a game
//                     that already has teams in it (so it can never spoil a real competition by accident).
//
// It needs nothing but Node.js 20. Exit code 0 = everything matched, 1 = something was wrong.
'use strict';
const http = require('http');
const path = require('path');
const Game = require(path.join(__dirname, '..', 'game.js'));

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true;
}
if (opt.help || !opt.pin) {
  console.log('Usage: node tools/loadtest.js --url http://localhost:3001 --pin <organiser PIN> [--teams 200] [--phones 2] [--rounds all] [--smoke] [--reset]');
  process.exit(opt.help ? 0 : 1);
}
const SMOKE = !!opt.smoke;
const BASE = new URL(String(opt.url || 'http://localhost:3001'));
const TEAMS = Math.max(1, Math.min(300, parseInt(opt.teams, 10) || (SMOKE ? 5 : 200)));
const PHONES = Math.max(1, Math.min(10, parseInt(opt.phones, 10) || 2));
const WINDOW = Math.max(100, parseInt(opt.window, 10) || (SMOKE ? 400 : 5000));
const LAYOUT_MS = Math.max(200, parseInt(opt['layout-ms'], 10) || (SMOKE ? 1000 : 15000));
const SEED = parseInt(opt.seed, 10) || (Date.now() % 1000000);
const ROUNDS_WANTED = opt.rounds && opt.rounds !== 'all' && opt.rounds !== true ? Math.max(1, parseInt(opt.rounds, 10) || 1) : Infinity;

// ---------------------------------------------------------------- small tools
let seedState = SEED >>> 0;
function rnd() {                              // seeded, so a failing run can be repeated with --seed
  seedState = (seedState + 0x6D2B79F5) >>> 0;
  let t = seedState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = a => a[Math.floor(rnd() * a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function sortedLayout(l) { const o = {}; Object.keys(l || {}).sort().forEach(k => { o[k] = { p: l[k].p, l: l[k].l }; }); return o; }

const failures = [];
let failCount = 0;
function fail(msg) { failCount++; if (failures.length < 40) failures.push(msg); }
function check(cond, msg) { if (!cond) fail(msg); return !!cond; }
function log(s) { console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + s); }

const roundCache = {};                        // round id -> round, as the server revealed it
const lat = {};                               // action -> [ms]
function record(name, ms) { (lat[name] || (lat[name] = [])).push(ms); }
function pct(arr, p) { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; }
function line(name, arr) {
  const f = v => String(Math.round(v)).padStart(6);
  return '  ' + name.padEnd(26) + String(arr.length).padStart(7) + f(pct(arr, 0.5)) + f(pct(arr, 0.95)) + f(pct(arr, 0.99)) + f(pct(arr, 1));
}

// ---------------------------------------------------------------- talking to the server
const apiAgent = new http.Agent({ keepAlive: true, maxSockets: 128 });
let netErrors = 0, httpErrors = 0, retries = 0;
function api(body, label, retried) {
  return new Promise(resolve => {
    const data = Buffer.from(JSON.stringify(body)), t0 = now();
    const req = http.request({ host: BASE.hostname, port: BASE.port || 80, path: '/api', method: 'POST', agent: apiAgent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        record(label || body.a, now() - t0);
        if (res.statusCode !== 200) httpErrors++;
        let j;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { j = { ok: false, err: 'reply was not JSON' }; httpErrors++; }
        if (j && j.ok && j.round && j.round.id) roundCache[j.round.id] = j.round;   // remembered for the final recomputation
        resolve(j);
      });
      res.on('error', () => { netErrors++; resolve({ ok: false, netErr: true, err: 'network error' }); });
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', e => {
      // A kept-alive connection that the server closed at the very moment we re-used it: the request never arrived.
      // Browsers send it again by themselves; so do we, once. It is counted as a retry, not as a failure.
      if (!retried && e.code === 'ECONNRESET' && req.reusedSocket) { retries++; return resolve(api(body, label, true)); }
      netErrors++; resolve({ ok: false, netErr: true, err: 'network error: ' + e.message });
    });
    req.end(data);
  });
}
function get(p) {
  return new Promise(resolve => {
    const req = http.request({ host: BASE.hostname, port: BASE.port || 80, path: p, method: 'GET', agent: apiAgent }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', () => resolve({ status: 0, body: '' }));
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

// A minimal Server-Sent Events reader: one open stream, like one open phone.
const sse = { opened: 0, drops: 0, reconnects: 0, events: 0, gone: 0, heartbeats: 0, delays: [], badJson: 0 };
let shuttingDown = false;
function Stream(key, owner, onView) { this.key = key; this.owner = owner; this.onView = onView; this.last = null; this.count = 0; this.want = null; this.req = null; this.closed = false; this.open(); }
Stream.prototype.open = function () {
  const self = this;
  let buf = '';
  const req = http.request({ host: BASE.hostname, port: BASE.port || 80, path: '/events?k=' + encodeURIComponent(this.key), method: 'GET', agent: false,
    headers: { Accept: 'text/event-stream' } }, res => {
    if (res.statusCode !== 200) { fail('stream answered HTTP ' + res.statusCode); return; }
    sse.opened++;
    res.setEncoding('utf8');
    res.on('data', chunk => {
      const got = now();
      buf += chunk;
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, cut); buf = buf.slice(cut + 2);
        let ev = 'message', data = '';
        for (const ln of block.split('\n')) {
          if (ln.charAt(0) === ':') { sse.heartbeats++; continue; }
          if (ln.startsWith('event:')) ev = ln.slice(6).trim();
          else if (ln.startsWith('data:')) data += ln.slice(5).replace(/^ /, '');
        }
        if (ev === 'gone') { sse.gone++; self.goneSeen = true; continue; }
        if (ev !== 'view' || !data) continue;
        let v;
        try { v = JSON.parse(data); } catch (e) { sse.badJson++; continue; }
        sse.events++; self.count++; self.last = v; self.lastAt = got;
        if (typeof v.now === 'number') sse.delays.push(Math.max(0, got - v.now));
        if (self.want && self.want.pred(v)) { const w = self.want; self.want = null; w.hit(got); }
        if (self.onView) self.onView(v, self);
      }
    });
    res.on('end', lost); res.on('error', lost); res.on('close', lost);
  });
  let done = false;
  function lost() {
    if (done) return; done = true;
    if (self.closed || shuttingDown || self.goneSeen) return;   // "gone" = the server said goodbye on purpose: do not come back
    sse.drops++;
    setTimeout(() => { if (!self.closed && !shuttingDown) { sse.reconnects++; self.open(); } }, 500);
  }
  req.on('error', lost);
  req.end();
  this.req = req;
};
Stream.prototype.close = function () { this.closed = true; try { this.req.destroy(); } catch (e) {} };

const playerStreams = [];
let hostStream = null;
const fan = {};                               // label -> {all:[ms till the LAST stream had it], each:[ms per stream], missing}
// Start watching BEFORE doing the action. Resolves when every player stream has shown a view that passes pred.
function watch(pred, timeoutMs) {
  const times = [];
  let left = playerStreams.length, finish;
  const done = new Promise(r => { finish = r; });
  playerStreams.forEach(s => { s.want = { pred, hit: at => { times.push(at); if (--left === 0) finish(); } }; });
  if (!left) finish();
  const timer = setTimeout(() => finish(), timeoutMs || 10000);
  return {
    wait: async function (label, t0) {
      await done; clearTimeout(timer);
      playerStreams.forEach(s => { if (s.want && s.want.pred === pred) s.want = null; });
      const f = fan[label] || (fan[label] = { all: [], each: [], missing: 0 });
      times.forEach(t => f.each.push(Math.max(0, t - t0)));
      if (left > 0) { f.missing += left; fail(label + ': ' + left + ' of ' + playerStreams.length + ' streams never showed the change'); }
      else if (times.length) f.all.push(Math.max(0, Math.max.apply(null, times) - t0));
      return left === 0;
    }
  };
}

// The tool's own delay (if this number is big, the bots - not the server - were the slow part).
let lagMax = 0, lagLast = now();
const lagTimer = setInterval(() => { const t = now(), lag = t - lagLast - 20; if (lag > lagMax) lagMax = lag; lagLast = t; }, 20);

// ---------------------------------------------------------------- bots
const ALL_CELLS = [];
for (let r = 0; r < 10; r++) for (let c = 1; c <= 10; c++) ALL_CELLS.push(Game.cid(r, c));
const PLACEABLE = ALL_CELLS.filter(Game.placeable);
const KINDS = ['smart', 'sloppy', 'incomplete', 'smart', 'sloppy', 'smart', 'sloppy', 'smart', 'sloppy', 'smart'];

function planLayout(kind) {                   // a list of [cell, product, level]
  const out = [];
  if (kind === 'smart') {                     // cold in the cold room, chemicals in their zone, heavy low, fragile high
    const zone = { COLD: shuffle(['J1', 'J2', 'J3']), CHEMICAL: shuffle(['J8', 'J9', 'J10']) };
    const shelves = shuffle(PLACEABLE.filter(c => Game.kindOf(c) === 'shelf' || Game.kindOf(c) === 'spare'));
    for (const p of shuffle(Game.PRODUCTS)) {
      const cell = zone[p.tag] ? zone[p.tag].pop() : shelves.pop();
      out.push([cell, p.n, p.tag === 'HEAVY' ? 'B' : p.tag === 'FRAGILE' ? pick(['T', 'M']) : pick(['T', 'M', 'B'])]);
    }
  } else {                                    // anything anywhere
    const cells = shuffle(PLACEABLE);
    for (const p of shuffle(Game.PRODUCTS)) out.push([cells.pop(), p.n, pick(['T', 'M', 'B'])]);
    if (kind === 'incomplete') out.length = 21;   // three products never make it to a shelf
  }
  return out;
}
function localPlace(layout, cell, p, l) { const old = Game.where(layout, p); if (old) delete layout[old]; layout[cell] = { p, l }; }

function seeView(bot, v) { bot.view = v; inspect(v, bot); }
let leaks = 0;
function inspect(v, bot) {                    // things a phone must never be shown too early
  const inRound = v.phase === 'order' || v.phase === 'reveal';
  if (!inRound && v.round) { leaks++; fail(bot.name + ' was sent a round while phase is ' + v.phase); }
  if (v.sales && !salesShown) { leaks++; fail(bot.name + ' was sent sales figures that were not revealed'); }
  if (v.phase !== 'reveal' && (v.best || v.stats)) { leaks++; fail(bot.name + ' was sent the best route / stats outside the reveal (' + v.phase + ')'); }
  if (v.phase !== 'reveal' && v.phase !== 'final' && v.board) { leaks++; fail(bot.name + ' was sent the scoreboard during ' + v.phase); }
  if ((v.phase === 'lobby' || v.phase === 'layout') && v.team && v.team.penList && v.team.penList.length) fail(bot.name + ' was shown penalties before the lock');
}
let salesShown = false;

async function doLayout(bot) {
  const plan = planLayout(bot.kind), gap = LAYOUT_MS / (plan.length + 4);
  await sleep(rnd() * gap * 2);
  for (const step of plan) {
    const r = await api({ a: 'place', k: bot.key, cell: step[0], p: step[1], l: step[2] });
    if (check(r.ok, bot.name + ' place ' + step.join('/') + ' refused: ' + r.err)) { localPlace(bot.layout, step[0], step[1], step[2]); seeView(bot, r); }
    await sleep(rnd() * gap * 2);
  }
  if (bot.kind !== 'smart') {                 // sloppy teams change their minds
    const free = PLACEABLE.filter(c => !bot.layout[c]);
    const used = Object.keys(bot.layout);
    if (free.length && used.length) {         // move a product to an empty square
      const from = pick(used), it = bot.layout[from], to = pick(free);
      const r = await api({ a: 'place', k: bot.key, cell: to, p: it.p, l: it.l }, 'place');
      if (check(r.ok, bot.name + ' move refused: ' + r.err)) { localPlace(bot.layout, to, it.p, it.l); seeView(bot, r); }
    }
    const cell = pick(Object.keys(bot.layout)), it = bot.layout[cell];
    let r = await api({ a: 'remove', k: bot.key, cell });
    if (check(r.ok, bot.name + ' remove refused: ' + r.err)) { delete bot.layout[cell]; seeView(bot, r); }
    if (bot.kind === 'sloppy') {              // ...and puts it back
      r = await api({ a: 'place', k: bot.key, cell, p: it.p, l: it.l }, 'place');
      if (check(r.ok, bot.name + ' re-place refused: ' + r.err)) { localPlace(bot.layout, cell, it.p, it.l); seeView(bot, r); }
    }
    r = await api({ a: 'place', k: bot.key, cell: 'B3', p: 1, l: 'M' }, 'place (bad, refused)');
    check(!r.ok, bot.name + ' was allowed to put a product on the walkway');
    r = await api({ a: 'place', k: bot.key, cell: 'C2', p: 25, l: 'M' }, 'place (bad, refused)');
    check(!r.ok, bot.name + ' was allowed to place product 25');
  }
  const r = await api({ a: 'state', k: bot.key });
  if (check(r.ok, bot.name + ' state failed: ' + r.err)) {
    seeView(bot, r);
    check(same(sortedLayout(r.team.layout), sortedLayout(bot.layout)), bot.name + ': the server layout differs from what the bot placed');
  }
}

function greedy(layout, items, rule) {        // a legal route that fetches the items in list order (usually too long)
  let cur = Game.START, route = [Game.START];
  for (const it of items) {
    const cell = Game.where(layout, it);
    if (!cell) return null;
    const sp = Game.spots(cell, rule);
    let leg = null, s;
    for (s of shuffle(sp)) { leg = Game.pathTo(cur, s, rule); if (leg) break; }
    if (!leg) return null;
    route = route.concat(leg.slice(1)); cur = s;
  }
  const home = Game.pathTo(cur, Game.START, rule);
  if (!home) return null;
  route = route.concat(home.slice(1));
  if (route.length < 3 || route.length > 400) return null;
  return route;
}
function buildSubmission(bot, R) {            // what this bot hands in, or null if it has nothing it could deliver
  const smartRoute = rnd() < 0.6;
  if (!R.double) {
    if (smartRoute) { const s = Game.solve(bot.layout, R.items, R); return s ? { route: s.path } : null; }
    const g = greedy(bot.layout, R.items, R);
    return g ? { route: g } : null;
  }
  if (smartRoute) {
    const b = Game.bestFor(R, bot.layout);
    return b ? { mode: b.mode, route: b.path, route2: b.path2 } : null;
  }
  const a = greedy(bot.layout, R.a, R), b = greedy(bot.layout, R.b, R), roll = rnd();
  if (a && b && roll < 0.35) { const all = greedy(bot.layout, R.a.concat(R.b), R); if (all) return { mode: 'B', route: all }; }
  if (a && roll > 0.85) return { mode: 'A', route: a };                    // only bothered with one trip
  if (a || b) return { mode: 'A', route: a, route2: b };
  return null;
}

const accepted = {};                          // round id -> how many submissions the server took
let refusedAsExpected = 0;
async function playRound(bot, R, state) {
  const roll = rnd();
  await sleep(250 + rnd() * WINDOW);
  // The order must have reached this phone over its live stream.
  let seen = bot.streams.some(s => s.last && s.last.phase === 'order' && s.last.round && s.last.round.id === R.id);
  if (!seen) {
    const r = await api({ a: 'state', k: bot.key });
    fail(bot.name + ' did not get ' + R.id + ' over its stream in time' + (r.ok && r.round ? ' (the poll had it)' : ''));
  }
  if (roll < 0.08) { state.idle.push(bot); return; }                       // this team never hands in
  const sub = buildSubmission(bot, R);
  if (!sub) {                                  // cannot deliver: the server must say no to a made-up route
    const r = await api({ a: 'submit', k: bot.key, round: R.id, route: ['A3', 'B3', 'A3'] }, 'submit (bad, refused)');
    check(!r.ok, bot.name + ' scored on ' + R.id + ' with an empty walk');
    refusedAsExpected++; state.idle.push(bot);
    return;
  }
  if (roll > 0.95) {                           // wrong round id, then a route through a shelf: both must be refused
    let r = await api({ a: 'submit', k: bot.key, round: 'zz', route: sub.route, route2: sub.route2, mode: sub.mode }, 'submit (bad, refused)');
    check(!r.ok, bot.name + ' handed in for a round that is not running'); refusedAsExpected++;
    r = await api({ a: 'submit', k: bot.key, round: R.id, route: ['A3', 'B3', 'C3', 'C4', 'C3', 'B3', 'A3'], mode: sub.mode }, 'submit (bad, refused)');
    check(!r.ok, bot.name + ' walked through a shelf and scored'); refusedAsExpected++;
  }
  const body = { a: 'submit', k: bot.key, round: R.id, route: sub.route, route2: sub.route2, mode: sub.mode };
  let r;
  if (roll > 0.88 && roll <= 0.95) {           // two phones of one team press the button at the same moment
    const both = await Promise.all([api(body), api(body)]);
    const oks = both.filter(x => x.ok).length;
    check(oks === 1, bot.name + ' ' + R.id + ': two phones at once, ' + oks + ' submissions accepted (should be exactly 1)');
    if (oks > 1) state.dupes++;
    r = both.find(x => x.ok) || both[0];
  } else r = await api(body);
  if (!check(r.ok, bot.name + ' ' + R.id + ' submission refused: ' + r.err)) { state.idle.push(bot); return; }
  accepted[R.id] = (accepted[R.id] || 0) + 1;
  seeView(bot, r);
  const mine = r.mine, want = Game.scoreSubmission(R, bot.layout, sub), best = Game.bestFor(R, bot.layout);
  if (!check(mine && !want.err, bot.name + ' ' + R.id + ': no result in the reply')) return;
  const perfect = best && want.score >= best.score ? Game.SCORE.perfectBonus : 0;
  check(mine.meters === want.meters && mine.score === want.score, bot.name + ' ' + R.id + ': server says ' + mine.meters + ' m / ' + mine.score + ' pts, the rules say ' + want.meters + ' m / ' + want.score);
  check(mine.perfect === perfect, bot.name + ' ' + R.id + ': perfect bonus is ' + mine.perfect + ', should be ' + perfect);
  check(mine.bonus === 0 || mine.bonus === Game.SCORE.speedBonus, bot.name + ' ' + R.id + ': strange speed bonus ' + mine.bonus);
  check(mine.mode === want.mode, bot.name + ' ' + R.id + ': mode ' + mine.mode + ' should be ' + want.mode);
  bot.res[R.id] = { meters: want.meters, score: want.score, perfect, bonus: mine.bonus };
  bot.sub[R.id] = sub;
  if (roll > 0.78 && roll <= 0.88) {           // tries to hand in a second time
    const again = await api(body, 'submit (again, refused)');
    if (!check(!again.ok, bot.name + ' ' + R.id + ': a second submission was accepted')) state.dupes++;
    else check(/already/i.test(String(again.err)), bot.name + ' ' + R.id + ': odd wording for a repeat: ' + again.err);
    refusedAsExpected++;
  }
}

// ---------------------------------------------------------------- the run
async function main() {
  const started = now();
  log('Dark Store Blitz load test: ' + TEAMS + ' teams x ' + PHONES + ' phones against ' + BASE.origin + (SMOKE ? '  (smoke)' : '') + '  seed ' + SEED);

  const hz = await get('/healthz');
  if (hz.status !== 200) { console.error('The server does not answer at ' + BASE.origin + ' (is it running?).'); process.exit(1); }

  // organiser login (one wrong try first: it must be refused)
  let r = await api({ a: 'hlogin', hp: '000000x' }, 'hlogin (wrong, refused)');
  check(!r.ok && r.badPin, 'a wrong organiser PIN was not refused');
  r = await api({ a: 'hlogin', hp: String(opt.pin) });
  if (!r.ok) { console.error('Organiser login failed: ' + (r.err || 'no reply') + '  (check --pin)'); process.exit(1); }
  const HK = r.k;
  const host = (body, label) => api(Object.assign({ k: HK }, body), label);
  let hv = await host({ a: 'hstate' });
  if (!hv.ok) { console.error('hstate failed: ' + hv.err); process.exit(1); }
  if (hv.phase !== 'lobby' || hv.teams.length) {
    if (!opt.reset) {
      console.error('This server already has a game on it (phase "' + hv.phase + '", ' + hv.teams.length + ' teams).\nAdd --reset to wipe it first. NEVER do that on a real competition.');
      process.exit(1);
    }
    hv = await host({ a: 'hreset' });
    check(hv.ok && hv.phase === 'lobby' && !hv.teams.length, 'hreset did not give an empty lobby');
  } else {
    // An empty lobby: resetting it changes nothing, but it ends the "old phones wait" minutes after an empty start,
    // so the unknown-key checks below get the plain answer.
    hv = await host({ a: 'hreset' });
  }
  if (!hv.timer) hv = await host({ a: 'htimer' });
  if (hv.demo) hv = await host({ a: 'hdemo' });
  if (!hv.joinOpen) hv = await host({ a: 'hjoin' });
  if (hv.showSales) hv = await host({ a: 'hsales' });
  check(hv.timer && !hv.demo && hv.joinOpen && !hv.showSales, 'could not put the switches in competition position');
  const roundList = hv.rounds.slice(0, Math.min(hv.rounds.length, ROUNDS_WANTED));

  // doors that must stay shut
  for (const p of ['/rounds.js', '/server.js', '/blitz-save.json', '/..%2frounds.js', '/public/../rounds.js', '/tools/loadtest.js']) {
    const x = await get(p);
    check(x.status === 404 || x.status === 400 || x.status === 403, 'GET ' + p + ' answered ' + x.status + ' (secret files must not be served)');
    check(x.body.indexOf('LAYOUT_MINUTES') < 0 && x.body.indexOf('Breakfast Rush') < 0, 'GET ' + p + ' leaked the secret rounds');
  }
  const gjs = await get('/game.js');
  check(gjs.status === 200, 'GET /game.js should be served');
  check(gjs.body.indexOf('frontier') < 0 && gjs.body.indexOf('scoreSubmission') > 0, 'GET /game.js must be sent to phones WITHOUT the route solver');
  r = await api({ a: 'state', k: 'nope' }, 'state (bad key, refused)');
  check(!r.ok && r.gone, 'an unknown team key was not answered with gone:true');
  r = await api({ a: 'hstate', k: 'nope' }, 'hstate (bad key, refused)');
  check(!r.ok && r.badPin, 'an unknown organiser key was not answered with badPin:true');
  const csvNo = await get('/export.csv?k=nope');
  check(csvNo.status !== 200, 'the results file was given out without the organiser key');
  const copyNo = await get('/backup?k=nope');
  check(copyNo.status !== 200, 'the safety copy was given out without the organiser key');
  await new Promise(resolve => {             // an unknown key on the stream must get "gone" and be hung up
    const before = sse.gone;
    const s = new Stream('nope', null, null);
    setTimeout(() => { check(sse.gone === before + 1, 'a stream with an unknown key did not get the "gone" event'); s.close(); sse.gone = before; sse.opened = 0; resolve(); }, 600);
  });

  hostStream = new Stream(HK, null, null);

  // ---- teams join
  const bots = [];
  for (let i = 0; i < TEAMS; i++) {
    bots.push({ i, name: 'Bot ' + String(i + 1).padStart(3, '0'), pin: String(1000 + Math.floor(rnd() * 9000)), kind: KINDS[i % KINDS.length], key: null,
      streams: [], layout: {}, res: {}, sub: {}, adj: 0, view: null });
  }
  log('joining ' + TEAMS + ' teams...');
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(24, TEAMS) }, async () => {
    while (next < bots.length) {
      const bot = bots[next++];
      await sleep(rnd() * 40);
      const j = await api({ a: 'join', name: (rnd() < 0.3 ? '  ' : '') + bot.name, pin: bot.pin });
      if (!check(j.ok && j.k, bot.name + ' could not join: ' + j.err)) continue;
      bot.key = j.k;
      for (let p = 1; p < PHONES; p++) {     // more phones of the same team join with the same name and PIN
        const j2 = await api({ a: 'join', name: p % 2 ? bot.name.toUpperCase() : bot.name, pin: bot.pin }, 'join (2nd phone)');
        check(j2.ok && j2.k === bot.key, bot.name + ': second phone did not land in the same team');
      }
      for (let p = 0; p < PHONES; p++) { const s = new Stream(bot.key, bot, v => inspect(v, bot)); bot.streams.push(s); playerStreams.push(s); }
    }
  }));
  const live = bots.filter(b => b.key);
  if (!live.length) { console.error('No bot could join.'); return finish(started, 1); }
  r = await api({ a: 'join', name: live[0].name, pin: live[0].pin === '1234' ? '4321' : '1234' }, 'join (wrong pin, refused)');
  check(!r.ok, 'joining an existing team with the wrong PIN was allowed');
  r = await api({ a: 'join', name: 'X', pin: '1234' }, 'join (bad, refused)');
  check(!r.ok, 'a 1-letter team name was allowed');
  // every phone should be connected and counted
  for (let tries = 0; tries < 50; tries++) {
    if (playerStreams.every(s => s.last && s.last.team && s.last.team.devices === PHONES && s.last.teamCount === live.length)) break;
    await sleep(100);
  }
  const lagging = playerStreams.filter(s => !(s.last && s.last.team && s.last.team.devices === PHONES && s.last.teamCount === live.length)).length;
  check(lagging === 0, lagging + ' streams never showed the right "devices"/"teamCount" in the lobby');
  log(live.length + ' teams in, ' + playerStreams.length + ' player streams open');

  // ---- Round 1: stocking the shelves
  let w = watch(v => v.phase === 'layout'), t0 = now();
  hv = await host({ a: 'hlayout', secs: 900 });
  check(hv.ok && hv.phase === 'layout' && hv.endsAt > now(), 'hlayout failed: ' + hv.err);
  await w.wait('start Round 1', t0);
  log('Round 1: bots are stocking shelves (about ' + Math.round(LAYOUT_MS / 1000) + ' s)...');
  await Promise.all(live.map(doLayout));
  w = watch(v => v.phase === 'locked'); t0 = now();
  hv = await host({ a: 'hlock' });
  check(hv.ok && hv.phase === 'locked', 'hlock failed: ' + hv.err);
  await w.wait('lock layouts', t0);
  const tidOf = {};
  hv.teams.forEach(t => { tidOf[t.name] = t.id; });
  for (const bot of live) {
    bot.pen = Game.penalties(bot.layout).reduce((a, x) => a + x.pts, 0);
    const t = hv.teams.find(x => x.name === bot.name);
    if (!check(t, bot.name + ' is missing from the organiser view')) continue;
    check(t.pen === bot.pen, bot.name + ': penalties ' + t.pen + ' should be ' + bot.pen);
    check(t.placed === Object.keys(bot.layout).length, bot.name + ': placed ' + t.placed + ' should be ' + Object.keys(bot.layout).length);
    const v = bot.streams[0].last;
    check(v && v.phase === 'locked' && v.team.pen === bot.pen && v.team.pts === -bot.pen, bot.name + ': phone does not show the locked layout penalties');
  }
  r = await api({ a: 'join', name: 'Late Bot', pin: '1234' }, 'join (late, refused)');
  check(!r.ok, 'a brand-new team was allowed to join after the lock');
  r = await api({ a: 'place', k: live[0].key, cell: 'J4', p: 1, l: 'M' }, 'place (bad, refused)');
  check(!r.ok, 'a product was placed after the lock');
  r = await api({ a: 'replay', k: live[0].key }, 'replay (refused)');
  check(!r.ok, 'replay was allowed with demo mode off');

  // ---- the orders
  let dupes = 0;
  for (let n = 0; n < roundList.length; n++) {
    const meta = roundList[n];
    w = watch(v => v.phase === 'order' && v.round && v.round.id === meta.id); t0 = now();
    hv = await host({ a: 'hround', i: n });
    if (hv.need) hv = await host({ a: 'hround', i: n, force: true });
    if (!check(hv.ok && hv.phase === 'order' && hv.round && hv.round.id === meta.id, 'hround ' + n + ' failed: ' + (hv.err || hv.need))) break;
    const R = hv.round;
    await w.wait('start order', t0);
    const state = { idle: [], dupes: 0 };
    const plays = Promise.all(live.map(b => playRound(b, R, state)));

    if (n === 2) {                             // pause and resume in the middle of an order
      await sleep(Math.min(300, WINDOW / 2));
      w = watch(v => v.pausedLeft > 0); t0 = now();
      let p = await host({ a: 'hpause' });
      check(p.ok && p.pausedLeft > 0 && p.endsAt === 0, 'hpause did not pause');
      await w.wait('pause', t0);
      p = await host({ a: 'htime', secs: 30 });
      check(p.ok && p.pausedLeft > 30000, 'htime did not add time while paused');
      p = await host({ a: 'hpause' });
      check(p.ok && p.pausedLeft === 0 && p.endsAt > now(), 'hpause did not resume');
    }
    if (n === 3) {                             // a message to every phone
      const text = 'Load test says hi ' + SEED;
      w = watch(v => v.msg && v.msg.text === text); t0 = now();
      const m = await host({ a: 'hmsg', text });
      check(m.ok && m.msg && m.msg.text === text, 'hmsg failed');
      await w.wait('message to all', t0);
      await host({ a: 'hmsg', text: '' });
    }
    await plays;
    dupes += state.dupes;
    const done = live.filter(b => b.res[R.id]);

    // end the order: sometimes with the button, sometimes by letting the clock run out
    w = watch(v => v.phase === 'reveal' && v.round && v.round.id === R.id);
    if (n % 2 === 0) {
      t0 = now();
      hv = await host({ a: 'hend' });
      check(hv.ok && hv.phase === 'reveal', 'hend failed: ' + hv.err);
      await w.wait('end order (button)', t0);
    } else {
      const cur = await host({ a: 'hstate' });
      const cut = -(Math.floor((cur.endsAt - now()) / 1000) - 1);
      const t = cut < 0 ? await host({ a: 'htime', secs: cut }) : cur;
      check(t.ok && t.phase === 'order' && t.endsAt > 0, 'htime failed: ' + t.err);
      await w.wait('end order (clock ran out)', t.endsAt);
      hv = await host({ a: 'hstate' });
      check(hv.phase === 'reveal', 'the order did not end when the clock ran out (phase ' + hv.phase + ')');
    }
    check(hv.done.indexOf(R.id) >= 0, R.id + ' is not in the "done" list after it ended');
    // too late now
    const lateBot = state.idle.find(b => Game.bestFor(R, b.layout));
    if (lateBot) {
      const best = Game.bestFor(R, lateBot.layout);
      const late = await api({ a: 'submit', k: lateBot.key, round: R.id, route: best.path, route2: best.path2, mode: best.mode }, 'submit (late, refused)');
      check(!late.ok, lateBot.name + ' handed in ' + R.id + ' after it was closed');
      refusedAsExpected++;
    }
    // the organiser's numbers
    check(hv.stats.submitted === done.length, R.id + ': organiser sees ' + hv.stats.submitted + ' submissions, bots made ' + done.length);
    const quota = Math.max(3, Math.ceil(live.length * 0.10));
    const withBonus = done.filter(b => b.res[R.id].bonus > 0).length;
    check(withBonus === Math.min(done.length, quota), R.id + ': ' + withBonus + ' teams got the speed bonus, should be ' + Math.min(done.length, quota));
    let topTotal = -1;
    for (const bot of live) {
      const t = hv.teams.find(x => x.name === bot.name), e = bot.res[R.id];
      if (!t) { fail(bot.name + ' vanished from the organiser view'); continue; }
      if (e) {
        topTotal = Math.max(topTotal, e.score + e.bonus + e.perfect);
        check(t.res && t.res.meters === e.meters && t.res.score === e.score && t.res.bonus === e.bonus && t.res.perfect === e.perfect, R.id + ' ' + bot.name + ': organiser result differs from the bot record');
      } else check(!t.res, R.id + ' ' + bot.name + ': has a result on the server but never handed in');
      const best = Game.bestFor(R, bot.layout);
      check(best ? (t.best && t.best.score === best.score && t.best.meters === best.meters && t.best.mode === best.mode) : !t.best, R.id + ' ' + bot.name + ': "best possible" on the organiser screen is wrong');
      // and what the phones show in the reveal
      for (const s of bot.streams) {
        const v = s.last;
        if (!v || v.phase !== 'reveal') continue;       // already reported by the watch
        check(e ? (v.mine && v.mine.score === e.score && v.mine.meters === e.meters && v.mine.bonus === e.bonus && v.mine.perfect === e.perfect) : !v.mine, R.id + ' ' + bot.name + ': phone shows the wrong result');
        check(best ? (v.best && v.best.score === best.score && Array.isArray(v.best.path || v.best.path2)) : !v.best, R.id + ' ' + bot.name + ': phone shows the wrong best route');
        check(Array.isArray(v.board) && v.board.length === Math.min(10, live.length), R.id + ' ' + bot.name + ': phone has no top-10');
        check(v.stats && v.stats.submitted === done.length, R.id + ' ' + bot.name + ': phone stats are off');
      }
    }
    if (done.length) check(hv.spotlight && hv.spotlight.total === topTotal && Array.isArray(hv.spotlight.route || hv.spotlight.route2), R.id + ': spotlight is missing or not the best result');
    else check(!hv.spotlight, R.id + ': spotlight without any submission');

    if (n === 1 && done.length) {              // a dispute: the organiser deletes one result
      const bot = done[0];
      const x = await host({ a: 'hredo', tid: tidOf[bot.name] });
      const t = x.ok && x.teams.find(q => q.name === bot.name);
      if (check(t && !t.res, 'hredo did not delete the result of ' + bot.name)) { delete bot.res[R.id]; accepted[R.id]--; }
    }
    if (n === 2) {                             // manual points, up and down
      for (const bot of live.slice(0, 3)) {
        const p = bot.i % 2 ? -15 : 25;
        const x = await host({ a: 'hadjust', tid: tidOf[bot.name], pts: p, why: 'load test' });
        if (check(x.ok, 'hadjust failed: ' + x.err)) bot.adj += p;
      }
      const x = await host({ a: 'hadjust', tid: tidOf[live[0].name], pts: 5000, why: 'too much' }, 'hadjust (bad, refused)');
      check(!x.ok, 'an adjustment of 5000 points was allowed');
    }
    log(meta.label.padEnd(15) + ' ' + String(done.length).padStart(3) + '/' + live.length + ' handed in, ' + done.filter(b => b.res[R.id] && b.res[R.id].perfect).length + ' perfect' + (failCount ? '   [' + failCount + ' problems so far]' : ''));
  }

  // ---- the end
  w = watch(v => v.phase === 'final'); t0 = now();
  hv = await host({ a: 'hfinal' });
  check(hv.ok && hv.phase === 'final', 'hfinal failed: ' + hv.err);
  await w.wait('final table', t0);
  hv = await host({ a: 'hstate' });

  // The podium is a secret until the organiser reveals it: no phone may show places 1 to 3 (or its own top-3 rank) yet.
  const places = Math.min(3, live.length), topNames = hv.board.slice(0, places).map(x => x.name);
  check(hv.podium === 0, 'the podium should start hidden (podium is ' + hv.podium + ')');
  let spoiled = 0;
  for (const bot of live) {
    const onPodium = topNames.indexOf(bot.name) >= 0;
    for (const st of bot.streams) {
      const v = st.last;
      if (!v || v.phase !== 'final' || !Array.isArray(v.board)) continue;
      const hid = v.board.filter(x => x.hid).length;
      const leak = v.board.some(x => topNames.indexOf(x.name) >= 0) || v.board.slice(0, places).some(x => x.name || x.pts != null);
      const rankOk = onPodium ? (v.team.rank === null && v.team.top3 === true) : (v.team.rank > places && !v.team.top3);
      if (hid !== places || leak || !rankOk) spoiled++;
    }
  }
  check(spoiled === 0, spoiled + ' phones could see podium places before the organiser revealed them');
  for (let step = 1; step <= places; step++) {
    w = watch(v => v.phase === 'final' && v.podium === step); t0 = now();
    const x = await host({ a: 'hpodium', step });
    check(x.ok && x.podium === step, 'hpodium ' + step + ' failed: ' + x.err);
    await w.wait('podium reveal', t0);
  }
  hv = await host({ a: 'hstate' });

  // Every total worked out again from the rules alone.
  const want = live.map(bot => {
    let pts = bot.adj - bot.pen, meters = 0;
    for (const id of Object.keys(bot.res)) { const e = bot.res[id]; pts += e.score + e.bonus + e.perfect; meters += e.meters; }
    // the score part is recomputed from the stored route, not from what the server said
    for (const id of Object.keys(bot.res)) {
      const R = roundCache[id];
      if (R) { const again = Game.scoreSubmission(R, bot.layout, bot.sub[id]); if (again.err || again.score !== bot.res[id].score) fail(bot.name + ' ' + id + ': recomputed score differs'); }
    }
    return { name: bot.name, pts, meters, pen: bot.pen };
  });
  want.sort((a, b) => b.pts - a.pts || a.meters - b.meters || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  check(hv.board.length === want.length, 'the final table has ' + hv.board.length + ' teams, expected ' + want.length);
  let wrongRows = 0;
  want.forEach((e, i) => {
    const g = hv.board[i];
    if (!g || g.name !== e.name || g.pts !== e.pts || g.meters !== e.meters || g.pen !== e.pen) {
      wrongRows++;
      if (wrongRows <= 5) fail('final table row ' + (i + 1) + ': server ' + JSON.stringify(g) + ' expected ' + JSON.stringify(e));
    }
  });
  if (wrongRows > 5) fail('...and ' + (wrongRows - 5) + ' more wrong rows in the final table');
  for (let i = 1; i < hv.board.length; i++) {
    const a = hv.board[i - 1], b = hv.board[i];
    check(a.pts > b.pts || (a.pts === b.pts && (a.meters < b.meters || (a.meters === b.meters && a.name <= b.name))), 'the final table is out of order at row ' + (i + 1));
  }
  const rankOf = {};
  want.forEach((e, i) => { rankOf[e.name] = i + 1; });
  for (const bot of live) {
    const e = want[rankOf[bot.name] - 1];
    for (const s of bot.streams) {
      const v = s.last;
      if (!v || v.phase !== 'final') continue;
      check(v.team.pts === e.pts && v.team.meters === e.meters && v.team.rank === rankOf[bot.name], bot.name + ': phone shows ' + v.team.pts + ' pts rank ' + v.team.rank + ', expected ' + e.pts + ' pts rank ' + rankOf[bot.name]);
      check(same(v.board, want.slice(0, 10).map(x => ({ name: x.name, pts: x.pts, meters: x.meters }))), bot.name + ': phone top-10 differs from the real top-10');
    }
  }
  let totalAccepted = 0, totalKept = 0;
  Object.keys(accepted).forEach(id => { totalAccepted += accepted[id]; });
  live.forEach(b => { totalKept += Object.keys(b.res).length; });
  check(totalAccepted === totalKept, 'accepted submissions (' + totalAccepted + ') and kept results (' + totalKept + ') do not match');
  check(dupes === 0, dupes + ' duplicate submissions were accepted');
  const csv = await get('/export.csv?k=' + HK);
  if (check(csv.status === 200, 'export.csv answered ' + csv.status)) {
    const rows = csv.body.trim().split(/\r?\n/);
    check(rows.length === want.length + 1, 'export.csv has ' + (rows.length - 1) + ' teams, expected ' + want.length);
    check(/^rank,team,points,meters,penalties,adjustments,/.test(rows[0]), 'export.csv has an unexpected header: ' + rows[0].slice(0, 60));
    want.forEach((e, i) => {
      const c = (rows[i + 1] || '').split(',');
      if (!(Number(c[0]) === i + 1 && c[1] === e.name && Number(c[2]) === e.pts && Number(c[3]) === e.meters && Number(c[4]) === e.pen)) fail('export.csv row ' + (i + 1) + ' is wrong: ' + (rows[i + 1] || '').slice(0, 60));
    });
  }
  check(hostStream.last && hostStream.count > 3, 'the organiser stream got almost nothing');
  check(sse.gone === 0, sse.gone + ' streams were told their team is gone');
  check(sse.drops === 0, sse.drops + ' streams were dropped by the server during the game');
  check(leaks === 0, leaks + ' views carried something a phone should not see yet');
  check(netErrors === 0, netErrors + ' requests failed on the network');
  check(httpErrors === 0, httpErrors + ' requests got a non-200 or unreadable reply');
  if (opt.reset) { const x = await host({ a: 'hreset' }); check(x.ok && !x.teams.length, 'the closing hreset failed'); }
  finish(started, failCount ? 1 : 0, live.length, totalKept);
}
function finish(started, code, teams, results) {
  shuttingDown = true;
  clearInterval(lagTimer);
  playerStreams.forEach(s => s.close());
  if (hostStream) hostStream.close();
  apiAgent.destroy();
  const head = '  ' + ''.padEnd(26) + '  count   p50   p95   p99   max';
  console.log('\n================ RESULTS ================');
  console.log('Run time: ' + ((now() - started) / 1000).toFixed(1) + ' s    teams: ' + (teams || 0) + '    player streams: ' + playerStreams.length + '    results kept: ' + (results || 0));
  console.log('\nRequest latency in ms (send -> full reply)');
  console.log(head);
  Object.keys(lat).sort().forEach(k => console.log(line(k, lat[k])));
  const all = [].concat.apply([], Object.keys(lat).map(k => lat[k]));
  console.log(line('ALL REQUESTS', all));
  console.log('\nLive stream (SSE)');
  console.log(head);
  console.log(line('view age on arrival', sse.delays));
  Object.keys(fan).forEach(k => { console.log(line(k + ' (each)', fan[k].each)); });
  console.log('\nTime from the organiser action until EVERY phone had the new view (ms)');
  Object.keys(fan).forEach(k => {
    const f = fan[k];
    console.log('  ' + k.padEnd(28) + (f.all.length ? 'worst ' + String(Math.round(Math.max.apply(null, f.all))).padStart(5) + '   typical ' + String(Math.round(pct(f.all, 0.5))).padStart(5) + '   (' + f.all.length + 'x)' : 'never complete') + (f.missing ? '   MISSING on ' + f.missing + ' streams' : ''));
  });
  console.log('\nStreams: ' + sse.opened + ' opened, ' + sse.events + ' views received, ' + sse.drops + ' dropped, ' + sse.reconnects + ' reconnects, ' + sse.badJson + ' unreadable');
  console.log('Requests: ' + all.length + ' sent, ' + retries + ' sent again after a closed connection, ' + netErrors + ' network errors, ' + httpErrors + ' bad replies, ' + refusedAsExpected + ' bad submissions correctly refused');
  console.log('The test tool itself was at most ' + Math.round(lagMax) + ' ms behind (large values here mean the bots, not the server, were busy).');
  if (failCount) {
    console.log('\nFAILED: ' + failCount + ' problem' + (failCount === 1 ? '' : 's'));
    failures.forEach(f => console.log('  - ' + f));
    if (failCount > failures.length) console.log('  ...and ' + (failCount - failures.length) + ' more');
  } else if (code) console.log('\nFAILED');
  else console.log('\nPASSED: every total, bonus, penalty and the order of the final table match the rules. No duplicate submission was accepted.');
  process.exitCode = code;
  setTimeout(() => process.exit(code), 200);
}

main().catch(e => { console.error(e); fail('the load test itself crashed: ' + e.message); finish(now(), 1); });
