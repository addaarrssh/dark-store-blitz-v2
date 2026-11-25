// DARK STORE BLITZ - game server. Runs only on this laptop. Needs Node.js 20, nothing else.
// Start:  node server.js        Stop:  Ctrl + C
//
// How it is built, in plain words:
//   - game.js holds the rules (shared with the phones). rounds.js holds the secret orders (never sent out early).
//   - Phones and the organiser screen talk to this file in two ways:
//       POST /api            "do this"  (join, place a product, hand in a route, start a round ...)
//       GET  /events?k=...   a live stream: the server pushes a fresh "view" whenever something changes
//   - A "view" is everything one screen is allowed to see. Players never get an order before it starts.
//   - The whole game is kept in memory in S and copied to a save file about once a second.
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const Game = require('./game.js');
const Orders = require('./orders.js');

// Which orders are played: the secret competition set if one was given, otherwise the public practice set (see orders.js).
let ORDERS;
try { ORDERS = Orders.load(); }
catch (e) { console.error('\n  The game cannot start: ' + e.message + '\n'); process.exit(1); }
// The top-four showdown: one extra order at the end that only the four best teams play (see orders.js). SHOWDOWN=0 turns it off.
if (process.env.SHOWDOWN !== '0') ORDERS.data = Orders.withShowdown(ORDERS.data, String(process.env.HOST_PIN || '') + '|' + ORDERS.set);
const { LAYOUT_MINUTES, SOLD, ROUNDS } = ORDERS.data;
const DUEL = ROUNDS.find(r => r.showdown) || null;
// Bounty on the leader: the team in first place when an order starts carries a bounty; every team that beats the
// leader's score on that order earns BOUNTY_PTS. BOUNTY_COUNTS=0 shows it as a badge only (not in the ranking).
const BOUNTY_PTS = 15;
const BOUNTY_COUNTS = process.env.BOUNTY_COUNTS !== '0';
// SHOWDOWN_MODE=title (default): the showdown result decides the order of the top four. SHOWDOWN_MODE=add: its points just add up.
const SHOWDOWN_MODE = process.env.SHOWDOWN_MODE === 'add' ? 'add' : 'title';
const DUEL_SIZE = 4;
const RULES_INFO = { bounty: BOUNTY_PTS, bountyCounts: BOUNTY_COUNTS, showdown: DUEL ? SHOWDOWN_MODE : null, duelSize: DUEL_SIZE,
                     orders: ROUNDS.filter(r => !r.showdown).length };
const PIN_IS_DEFAULT = !process.env.HOST_PIN;      // 123456 is written in the public code: fine at home, not in a competition
const BOOT = crypto.randomBytes(6).toString('hex'); // changes every time the server starts: the organiser screen uses it to notice a restart

const PORT = Number(process.env.PORT) || 3001;
const SAVE = process.env.SAVE_FILE || path.join(__dirname, 'blitz-save.json');   // safety copy of the game

const MAX_TEAMS = 300;
const MAX_BODY = 30 * 1024;          // biggest request we read
const MAX_RESTORE = 8 * 1024 * 1024; // biggest safety copy the organiser can put back
const GRACE_MS = 5 * 60000;          // after an empty start, phones of the old game are kept waiting this long (see holding())
const MAX_STREAMS = 5000;            // live streams in total
const MAX_TEAM_STREAMS = 20;         // live streams for one team (phones + forgotten tabs)
const MAX_HOST_KEYS = 50;
const FLUSH_MS = 100;                // how often changed views are pushed to phones
const HOST_PUSH_MS = 500;            // the organiser screen gets at most 2 pushes a second
const HEARTBEAT_MS = 5000;            // a small "still here" event on every stream, so a phone notices a dead line in seconds
const SLOW_SOCKET_MS = 30000;        // a phone that takes nothing for this long is cut off (it will reconnect)
const PIN_TRIES = 8, PIN_BLOCK_MS = 60000;
const BAD_ALL_MAX = 40;            // wrong organiser PINs from the whole room in one minute before everybody has to wait
const NAME_TRIES = 10, NAME_BLOCK_MS = 5 * 60000;     // wrong PINs for ONE team name, from anywhere, before that name is closed for 5 minutes
// How many NEW teams one phone (one network address) may create. 0 = no limit. The game laptop itself is never limited.
// Through a tunnel many phones can share one address, so the limit is 10 times higher there.
const ADDR_TEAMS = /^\d+$/.test(String(process.env.TEAMS_PER_ADDRESS || '')) ? Number(process.env.TEAMS_PER_ADDRESS) : 5;
const PROXY_FACTOR = 10;
// A hand-in that arrives sooner than this after the order opened was not tapped by a human: no speed bonus, and the organiser sees a flag.
const FAST_BASE_MS = 1500, FAST_STEP_MS = 100;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ROUND_IDS = new Set(ROUNDS.map(r => r.id));
const LEVEL_OK = { T: 1, M: 1, B: 1 };

// ---------- game state ----------
// S is the whole game. S.teams is a Map (team id -> team) so a strange id typed by a user can never hit a built-in name.
function fresh(pin, hostKeys) {
  return {
    phase: 'lobby', endsAt: 0, pausedLeft: 0, timer: true, demo: false, joinOpen: true, showSales: false,
    ri: -1, done: [], msg: null, layoutSecs: LAYOUT_MINUTES * 60, teams: new Map(),
    startedAt: 0,                    // when the running order was opened (ms)
    podium: 0,                       // final results: how many podium places the organiser has revealed so far (0..3)
    hunt: Object.create(null),       // round id -> id of the team that carried the bounty in it ('' = no bounty)
    duel: [],                        // ids of the showdown teams (the top four when it started)
    hostPin: pin || process.env.HOST_PIN || '889900', hostKeys: hostKeys || []
  };
}
let S = fresh(process.env.HOST_PIN || '889900');
const byKey = new Map();             // team key -> team
const byName = new Map();            // lower-case team name -> team
const live = new Map();              // team id -> { streams:Set, g, ok, body }  (things we never save)
const hostStreams = new Set();
const bestCache = new Map();         // "teamId|roundId" -> best possible result for that layout
const liveRoute = new Map();         // team id -> {route, at}: showdown routes while they are being walked (never saved)
let liveVer = 0;                     // goes up whenever a live showdown route changed

function reindex() {
  byKey.clear(); byName.clear();
  for (const t of S.teams.values()) {
    byKey.set(t.key, t); byName.set(t.name.toLowerCase(), t);
    for (const k of t.alt || []) if (!byKey.has(k)) byKey.set(k, t);
  }
}
function rt(t) {
  let x = live.get(t.id);
  if (!x) { x = { streams: new Set(), g: -1, ok: false, body: '' }; live.set(t.id, x); }
  return x;
}
const started = () => S.phase !== 'lobby' && S.phase !== 'layout';       // true once layouts are locked
const roundNow = () => (S.phase === 'order' || S.phase === 'reveal') ? ROUNDS[S.ri] || null : null;

// ---------- "something changed" flags ----------
// A team action only touches that team's phones (and the organiser). A global change touches everybody.
// Nothing is sent here: the flush timer further down does the sending, so 300 teams acting at once stay cheap.
let ver = 0;                         // goes up on every change; scoreboards are worked out again only when it moved
let gver = 0;                        // goes up on every global change
let saveDirty = false, allDirty = false, hostDirty = false;
const dirtyTeams = new Set();
function touchTeam(t, save) {
  ver++; rt(t).ok = false; dirtyTeams.add(t.id); hostDirty = true;
  if (save !== false) saveDirty = true;
}
function touchAll() { ver++; gver++; allDirty = true; hostDirty = true; saveDirty = true; }

// ---------- saving and loading ----------
function snapshot() {
  const teams = {};
  for (const t of S.teams.values()) teams[t.id] = t;
  return JSON.stringify(Object.assign({}, S, { teams, savedAt: Date.now() }));
}
// The safety copy the organiser screen keeps (and can put back after a restart). Same as the save file, but without
// the organiser PIN and logins: those never leave the server.
function backupBody() {
  const teams = {};
  for (const t of S.teams.values()) teams[t.id] = t;
  return JSON.stringify(Object.assign({}, S, { teams, savedAt: Date.now(), hostPin: undefined, hostKeys: undefined, boot: BOOT, orders: ORDERS.set }));
}
let saving = false, lastSaved = 0;
function saveSoon() {                // at most one write in flight; write a temp file, then swap it in (never a half file)
  if (!saveDirty || saving) return;
  saveDirty = false; saving = true;
  const tmp = SAVE + '.tmp';
  fs.writeFile(tmp, snapshot(), e => {
    if (e) { saving = false; saveDirty = true; return console.error('  Could not save the game:', e.message); }
    fs.rename(tmp, SAVE, e2 => {
      saving = false;
      if (e2) { saveDirty = true; console.error('  Could not save the game:', e2.message); }
      else lastSaved = Date.now();
    });
  });
}
function saveTick() {                // once a second. While a clock is running the save is refreshed every 5 s even if nobody
  // did anything, so after a crash we know (to within 5 s) how much time was really left.
  if (S.endsAt && !S.pausedLeft && Date.now() - lastSaved > 5000) saveDirty = true;
  saveSoon();
}
function saveNow() {                 // used when the server is being stopped
  try { const tmp = SAVE + '.now.tmp'; fs.writeFileSync(tmp, snapshot()); fs.renameSync(tmp, SAVE); saveDirty = false; }
  catch (e) { console.error('  Could not save the game:', e.message); }
}

// Take a saved game apart piece by piece and keep only what makes sense. A broken save must never stop the game.
function cleanTeam(x) {
  if (!x || typeof x !== 'object') return null;
  if (typeof x.id !== 'string' || typeof x.key !== 'string' || typeof x.name !== 'string' || typeof x.pin !== 'string') return null;
  const t = { id: x.id, key: x.key, name: x.name, pin: x.pin, layout: {}, res: {}, adj: [] };
  if (typeof x.from === 'string' && x.from) t.from = x.from.slice(0, 64);       // the address that created the team
  if (x.layout && typeof x.layout === 'object') {
    for (const cell of Object.keys(x.layout)) {
      const it = x.layout[cell];
      if (Game.validCell(cell) && Game.placeable(cell) && it && Number.isInteger(it.p) && it.p >= 1 && it.p <= 24 && has(LEVEL_OK, it.l)) {
        t.layout[cell] = { p: it.p, l: it.l };
      }
    }
  }
  if (x.res && typeof x.res === 'object') {
    for (const id of Object.keys(x.res)) {
      const r = x.res[id];
      if (!ROUND_IDS.has(id) || !r || typeof r !== 'object') continue;
      t.res[id] = {
        meters: Number(r.meters) || 0, score: Number(r.score) || 0, bonus: Number(r.bonus) || 0, perfect: Number(r.perfect) || 0,
        mode: r.mode === 'A' || r.mode === 'B' ? r.mode : null, at: Number(r.at) || 0,
        route: Array.isArray(r.route) ? r.route.filter(Game.validCell) : null,
        route2: Array.isArray(r.route2) ? r.route2.filter(Game.validCell) : null
      };
      if (r.fast === true) t.res[id].fast = true;
    }
  }
  if (Array.isArray(x.adj)) {
    for (const a of x.adj) if (a && Number.isInteger(a.pts)) t.adj.push({ pts: a.pts, why: String(a.why || '').slice(0, 60) });
  }
  // extra keys: phones that joined again after a restart, before the organiser put the game back (see restore)
  if (Array.isArray(x.alt)) { const alt = x.alt.filter(k => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k) && k !== t.key).slice(-8); if (alt.length) t.alt = alt; }
  return t;
}
// Builds a game from a saved one (the save file, or a safety copy from the organiser screen). Throws if it is not a game.
function revive(d, pin, quiet) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('not a saved game');
    const n = fresh(pin);
    if (['lobby', 'layout', 'locked', 'order', 'reveal', 'final'].includes(d.phase)) n.phase = d.phase;
    n.endsAt = Number(d.endsAt) > 0 ? Number(d.endsAt) : 0;
    n.pausedLeft = Number(d.pausedLeft) > 0 ? Number(d.pausedLeft) : 0;
    n.timer = d.timer !== false; n.demo = d.demo === true; n.joinOpen = d.joinOpen !== false; n.showSales = d.showSales === true;
    n.ri = Number.isInteger(d.ri) && d.ri >= 0 && d.ri < ROUNDS.length ? d.ri : -1;
    n.done = Array.isArray(d.done) ? d.done.filter(x => ROUND_IDS.has(x)) : [];
    n.msg = d.msg && typeof d.msg.text === 'string' && d.msg.text ? { text: d.msg.text.slice(0, 140), at: Number(d.msg.at) || 0 } : null;
    n.layoutSecs = Number(d.layoutSecs) >= 30 && Number(d.layoutSecs) <= 3600 ? Number(d.layoutSecs) : LAYOUT_MINUTES * 60;
    if (d.teams && typeof d.teams === 'object') {
      for (const id of Object.keys(d.teams)) {
        const t = cleanTeam(d.teams[id]);
        if (t && t.id === id && n.teams.size < MAX_TEAMS) n.teams.set(id, t);
      }
    }
    if ((n.phase === 'order' || n.phase === 'reveal') && n.ri < 0) n.phase = 'locked';
    n.startedAt = Number(d.startedAt) > 0 ? Number(d.startedAt) : 0;
    n.podium = n.phase === 'final' && Number.isInteger(d.podium) && d.podium > 0 ? Math.min(3, d.podium) : 0;
    if (d.hunt && typeof d.hunt === 'object') {
      for (const id of Object.keys(d.hunt)) if (ROUND_IDS.has(id) && typeof d.hunt[id] === 'string') n.hunt[id] = d.hunt[id].slice(0, 32);
    }
    if (Array.isArray(d.duel)) n.duel = d.duel.filter(x => typeof x === 'string' && x).map(x => x.slice(0, 32)).slice(0, DUEL_SIZE);
    // A clock that was running when the server stopped is PAUSED, so nobody loses time to a restart.
    // Time left is counted from the moment of the last save (not from now): the minutes the server was down do not count.
    // The organiser presses Resume when the room is ready.
    if (n.timer && n.endsAt && (n.phase === 'layout' || n.phase === 'order')) {
      const then = Number(d.savedAt) > 0 && Number(d.savedAt) <= Date.now() ? Number(d.savedAt) : Date.now();
      n.pausedLeft = Math.max(30000, n.endsAt - then); n.endsAt = 0;
      if (!quiet) console.log('  The clock was running when the server stopped. It is PAUSED now: press Resume on the organiser screen.');
    }
    if (n.phase !== 'layout' && n.phase !== 'order') { n.endsAt = 0; n.pausedLeft = 0; }
    return n;
}
let coldStart = true;                // true when the server started with no saved game at all
function load() {
  let raw;
  try { raw = fs.readFileSync(SAVE, 'utf8'); } catch (e) { return; }          // no save yet: a new game
  try {
    const d = JSON.parse(raw);
    const n = revive(d, process.env.HOST_PIN || (d && typeof d.hostPin === 'string' && d.hostPin ? d.hostPin : null));
    // organiser logins survive a restart, unless the PIN was changed from outside
    if (Array.isArray(d.hostKeys) && n.hostPin === d.hostPin) n.hostKeys = d.hostKeys.filter(k => typeof k === 'string' && /^[0-9a-f]{32}$/.test(k)).slice(-MAX_HOST_KEYS);
    S = n; saveDirty = true; coldStart = false;
    console.log('  Picked up the saved game (' + S.teams.size + ' teams) from ' + path.basename(SAVE));
  } catch (e) {
    const bad = SAVE + '.corrupt-' + Date.now();
    try { fs.renameSync(SAVE, bad); } catch (e2) {}
    console.error('  The save file could not be read (' + e.message + '). Starting a new game. The old file was kept as ' + path.basename(bad));
  }
}
load();
S.hostPin = String(process.env.HOST_PIN || '889900');
reindex();
saveDirty = true;                    // make sure the organiser PIN is on disk from the first second

// ---------- coming back after the server lost everything ----------
// On a free cloud host the save file does not survive a restart: the server comes back with an empty lobby. The organiser
// screen keeps a safety copy in its browser and offers to put it back (restore). Until then, phones of the old game are
// told to WAIT instead of "your team is gone", so they keep their place and carry on by themselves after the restore.
let graceUntil = coldStart ? Date.now() + GRACE_MS : 0;
const holding = () => graceUntil > Date.now();
const HOLD = JSON.stringify({ ok: false, hold: true, err: 'The game server restarted. Wait a moment: the organiser is bringing the game back.' });

function restore(d) {
  const n = revive(d, S.hostPin, true);
  n.hostKeys = S.hostKeys;
  // A phone that joined again while the game was empty made a new, empty team. Same name and same PIN: it is the same
  // team, so its new key simply becomes one more key of the team that comes back.
  const names = new Map();
  for (const t of n.teams.values()) names.set(t.name.toLowerCase(), t);
  for (const c of S.teams.values()) {
    const t = names.get(c.name.toLowerCase());
    if (!t || t.key === c.key || !samePin(c.pin, t.pin)) continue;
    t.alt = (t.alt || []).filter(k => k !== c.key).concat(c.key).slice(-8);
  }
  // hang up every phone without saying "gone": each one reconnects by itself and finds its team again
  for (const x of Array.from(live.values())) for (const s of Array.from(x.streams)) dropStream(s, false);
  S = n; graceUntil = 0;
  live.clear(); bestCache.clear(); dirtyTeams.clear(); warmJob++; reindex();
  liveRoute.clear(); liveVer++;
  badTeam.clear(); badName.clear();
  touchAll();
  const R = roundNow();
  if (R) warmBest(R);
  console.log('  The organiser put a safety copy back: ' + S.teams.size + ' teams, phase "' + S.phase + '".');
  return { ok: true, teams: S.teams.size, phase: S.phase, paused: S.pausedLeft > 0 };
}

// ---------- the clock ----------
function endOrder() {
  const R = ROUNDS[S.ri];
  S.phase = 'reveal'; S.endsAt = 0; S.pausedLeft = 0;
  if (R && !S.done.includes(R.id)) S.done.push(R.id);
  touchAll();
}
function tick() {                    // runs 4 times a second, and before every action so nobody sneaks in late
  if (!S.timer || S.pausedLeft || !S.endsAt || Date.now() < S.endsAt) return;
  if (S.phase === 'layout') { S.phase = 'locked'; S.endsAt = 0; touchAll(); }
  else if (S.phase === 'order') endOrder();
  else { S.endsAt = 0; touchAll(); }
}

// ---------- scores ----------
const orderPts = r => r ? r.score + r.bonus + r.perfect : 0;
const huntOf = id => has(S.hunt, id) && typeof S.hunt[id] === 'string' ? S.hunt[id] : '';
// Bounty points team t earned on round id. Worked out from the results (never stored), and only once the order is
// closed, so a Redo or a replayed round always gives the right answer.
function bountyOf(t, id) {
  const lead = huntOf(id);
  if (!lead || lead === t.id || !has(t.res, id) || !S.done.includes(id)) return 0;
  const L = S.teams.get(lead);
  if (!L) return 0;
  return orderPts(t.res[id]) > orderPts(L.res[id]) ? BOUNTY_PTS : 0;
}
function totals(t) {
  let p = 0, m = 0, a = 0, bty = 0;
  for (const id of Object.keys(t.res)) { const r = t.res[id]; p += r.score + r.bonus + r.perfect; m += r.meters; bty += bountyOf(t, id); }
  for (const x of t.adj) a += x.pts;
  const penList = started() ? Game.penalties(t.layout) : [];       // layout mistakes only count once layouts are locked
  let pen = 0;
  for (const x of penList) pen += x.pts;
  return { pts: p + a - pen + (BOUNTY_COUNTS ? bty : 0), meters: m, pen, penList, adjSum: a, bounty: bty };
}
const byTotal = (x, y) => y.tot.pts - x.tot.pts || x.tot.meters - y.tot.meters || (x.t.name < y.t.name ? -1 : x.t.name > y.t.name ? 1 : 0);
// true unless this is a double-drop hand-in that delivered only one of the two orders
const fullRes = (R, r) => !R.double || r.mode === 'B' || !!(r.route && r.route2);
// The final results keep the podium secret until the organiser reveals it: places 1..hidden are masked on the phones.
function podiumHidden() {
  const places = Math.min(3, S.teams.size);
  // The showdown result decides the podium, so its reveal keeps the same secret on the phones as the final does.
  if (S.phase === 'reveal' && DUEL && ROUNDS[S.ri] === DUEL) return places;
  if (S.phase !== 'final') return 0;
  return places - Math.min(S.podium, places);
}
// The scoreboard and everything built from it is worked out once per change, not once per phone.
let calc = { ver: -1 };
function derived() {
  if (calc.ver === ver) return calc;
  const rows = [];
  for (const t of S.teams.values()) rows.push({ t, tot: totals(t) });
  rows.sort(byTotal);
  // Showdown in "title" mode: once it is closed, its teams take the first places in the order of their showdown result.
  if (DUEL && SHOWDOWN_MODE === 'title' && S.duel.length && S.done.includes(DUEL.id)) {
    const inDuel = new Set(S.duel), fin = rows.filter(x => inDuel.has(x.t.id)), rest = rows.filter(x => !inDuel.has(x.t.id));
    const dp = x => has(x.t.res, DUEL.id) ? orderPts(x.t.res[DUEL.id]) : -1;
    const dm = x => has(x.t.res, DUEL.id) ? x.t.res[DUEL.id].meters : Infinity;
    fin.sort((x, y) => dp(y) - dp(x) || dm(x) - dm(y) || byTotal(x, y));
    rows.length = 0; rows.push(...fin, ...rest);
  }
  const rank = new Map(), tot = new Map();
  rows.forEach((x, i) => { rank.set(x.t.id, i + 1); tot.set(x.t.id, x.tot); });
  const R = roundNow();
  let submitted = 0, perfect = 0, sum = 0, bestMeters = null, top = null;
  if (R) {
    for (const t of S.teams.values()) {
      const r = t.res[R.id];
      if (!r) continue;
      submitted++; sum += r.meters;
      if (r.perfect) perfect++;
      // "shortest walk" only compares complete deliveries (on the double drop: both orders delivered)
      if (fullRes(R, r) && (bestMeters === null || r.meters < bestMeters)) bestMeters = r.meters;
      const total = r.score + r.bonus + r.perfect;
      if (!top || total > top.total || (total === top.total && (r.meters < top.r.meters || (r.meters === top.r.meters && r.at < top.r.at)))) top = { t, r, total };
    }
  }
  const hid = podiumHidden();
  calc = {
    ver, rows, rank, tot, hid,
    top10: rows.slice(0, 10).map((x, i) => i < hid ? { name: '', pts: null, meters: null, hid: true } : { name: x.t.name, pts: x.tot.pts, meters: x.tot.meters }),
    stats: { submitted, perfect, avgMeters: submitted ? Math.round(sum / submitted) : null, bestMeters },
    top
  };
  return calc;
}
function bestOf(t, R) {              // the best this team could have done with its own layout (slow-ish, so remembered)
  const k = t.id + '|' + R.id;
  if (bestCache.has(k)) return bestCache.get(k);
  let out = null;
  try { out = Game.bestFor(R, t.layout); } catch (e) { console.error(e); }
  bestCache.set(k, out);
  return out;
}
// When an order starts, work out every team's best route in small slices in the background,
// so the "reveal" screen is instant even with 300 teams.
let warmJob = 0;
function warmBest(R) {
  const job = ++warmJob, ids = R.showdown ? S.duel.filter(id => S.teams.has(id)) : Array.from(S.teams.keys());
  let i = 0;
  (function slice() {
    if (job !== warmJob) return;
    const until = Date.now() + 6;
    while (i < ids.length && Date.now() < until) { const t = S.teams.get(ids[i++]); if (t) bestOf(t, R); }
    if (i < ids.length) setTimeout(slice, 15);
  })();
}

let urlCache = { at: 0, urls: [] };
function lanUrls() {
  if (Date.now() - urlCache.at < 5000) return urlCache.urls;
  const out = [], n = os.networkInterfaces();
  for (const k of Object.keys(n)) for (const a of n[k] || []) {
    if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push('http://' + a.address + ':' + PORT);
  }
  urlCache = { at: Date.now(), urls: out };
  return out;
}

// ---------- what each screen is allowed to see ----------
// Views are built WITHOUT the clock reading ("now"), so we can tell whether anything really changed.
// withNow() adds it at the last moment.
const withNow = body => '{"now":' + Date.now() + ',' + body.slice(1);
const pickRes = r => r ? { meters: r.meters, score: r.score, bonus: r.bonus, perfect: r.perfect, mode: r.mode, route: r.route, route2: r.route2 } : null;

function playerBody(t) {
  const x = rt(t);
  if (x.g === gver && x.ok) return x.body;         // nothing changed for this team since last time
  const R = roundNow(), reveal = S.phase === 'reveal', tot = totals(t);
  const showBoard = reveal || S.phase === 'final';
  // rank is shown between rounds only: while an order is running nobody can see how the others are doing
  const showRank = S.phase === 'locked' || showBoard;
  const d = (showBoard || showRank) ? derived() : null;
  let best = null;
  const inDuel = !!(R && R.showdown && S.duel.includes(t.id));
  if (R && reveal && (!R.showdown || inDuel)) { const b = bestOf(t, R); if (b) best = { meters: b.meters, score: b.score, mode: b.mode, path: b.path, path2: b.path2 }; }
  const lead = R ? huntOf(R.id) : '', leadT = lead ? S.teams.get(lead) : null;
  // final results: a team on a podium place that is still secret only learns "you are in the top 3"
  let rank = showRank ? d.rank.get(t.id) || null : null, top3 = false;
  if (rank && d.hid && rank <= d.hid) { rank = null; top3 = true; }
  x.body = JSON.stringify({
    ok: true, phase: S.phase, endsAt: S.endsAt, pausedLeft: S.pausedLeft, timer: S.timer, demo: S.demo, msg: S.msg,
    ri: S.ri, roundCount: ROUNDS.length, podium: S.phase === 'final' ? S.podium : 0,
    round: R,                                            // null unless an order is running or being revealed
    sa: R ? S.startedAt : 0,                             // when this order was opened: a replayed order is a new one for the phones
    sales: S.showSales ? SOLD : null,
    team: { name: t.name, layout: t.layout, pts: tot.pts, meters: tot.meters, pen: tot.pen, penList: tot.penList, adj: t.adj,
            rank, top3, devices: x.streams.size, bounty: tot.bounty },
    mine: R ? pickRes(t.res[R.id]) : null,
    best,
    board: showBoard ? d.top10 : null,
    teamCount: S.teams.size,
    stats: reveal ? d.stats : null,
    rules: RULES_INFO,
    hunt: leadT ? { target: leadT.name, me: lead === t.id, got: reveal ? bountyOf(t, R.id) : 0 } : null,
    duel: R && R.showdown ? { in: inDuel, names: S.duel.map(id => S.teams.get(id)).filter(Boolean).map(u => u.name) } : null
  });
  x.g = gver; x.ok = true;
  return x.body;
}

let hostCache = { ver: -1, lv: -1, body: '' };
function hostBody() {
  if (hostCache.ver === ver && hostCache.lv === liveVer) return hostCache.body;
  const d = derived(), R = roundNow(), reveal = S.phase === 'reveal';
  let devices = 0, teams = [];
  for (const t of S.teams.values()) {
    const tot = d.tot.get(t.id), n = rt(t).streams.size, r = R ? t.res[R.id] : null;
    let best = null;
    if (R && reveal && (!R.showdown || S.duel.includes(t.id))) { const b = bestOf(t, R); if (b) best = { meters: b.meters, score: b.score, mode: b.mode }; }
    devices += n;
    teams.push({
      id: t.id, name: t.name, placed: Object.keys(t.layout).length, devices: n, pts: tot.pts, meters: tot.meters, pen: tot.pen,
      penList: tot.penList, adj: t.adj,
      res: r ? { meters: r.meters, score: r.score, bonus: r.bonus, perfect: r.perfect, mode: r.mode, full: fullRes(R, r), fast: !!r.fast,
                 at: r.at, bty: bountyOf(t, R.id) } : null,
      best
    });
  }
  let spotlight = null;
  if (reveal && d.top) {
    spotlight = { name: d.top.t.name, layout: d.top.t.layout, mode: d.top.r.mode, route: d.top.r.route, route2: d.top.r.route2,
                  meters: d.top.r.meters, total: d.top.total };
  }
  const body = JSON.stringify({
    ok: true, phase: S.phase, endsAt: S.endsAt, pausedLeft: S.pausedLeft, timer: S.timer, demo: S.demo, joinOpen: S.joinOpen,
    showSales: S.showSales, msg: S.msg, ri: S.ri, done: S.done, podium: S.phase === 'final' ? S.podium : 0,
    rounds: ROUNDS.map(r => ({ id: r.id, label: r.label, title: r.title, stage: r.stage, showdown: !!r.showdown })),
    round: R, urls: lanUrls(), sales: SOLD, layoutSecs: S.layoutSecs,
    boot: BOOT, safety: { defaultPin: PIN_IS_DEFAULT, orders: ORDERS.set },
    teams,
    board: d.rows.map(x => ({ name: x.t.name, pts: x.tot.pts, meters: x.tot.meters, pen: x.tot.pen, bounty: x.tot.bounty })),
    stats: { teams: S.teams.size, devices, submitted: d.stats.submitted, perfect: d.stats.perfect },
    spotlight,
    rules: RULES_INFO,
    hunt: huntView(R),
    duel: duelView(R)
  });
  hostCache = { ver, lv: liveVer, body };
  return body;
}
// Who carries the bounty in round R, and (once it is closed) who beat them.
function huntView(R) {
  const lead = R ? huntOf(R.id) : '', L = lead ? S.teams.get(lead) : null;
  if (!L) return null;
  const claimed = [];
  if (S.done.includes(R.id)) for (const t of S.teams.values()) if (bountyOf(t, R.id)) claimed.push(t.name);
  return { target: L.name, pts: BOUNTY_PTS, counts: BOUNTY_COUNTS, claimed: claimed.slice(0, 40), n: claimed.length };
}
// The showdown teams with their live (or handed-in) routes, for the big screens.
function duelView(R) {
  if (!R || !R.showdown) return null;
  const teams = [];
  for (const id of S.duel) {
    const t = S.teams.get(id);
    if (!t) continue;
    const r = t.res[R.id], lr = liveRoute.get(id);
    teams.push({ id, name: t.name, layout: t.layout, done: !!r, route: r ? r.route : lr ? lr.route : null,
                 meters: r ? r.meters : null, pts: r ? orderPts(r) : null });
  }
  return { mode: SHOWDOWN_MODE, teams };
}

// ---------- live streams (Server-Sent Events) ----------
// One stream = one open phone or organiser screen. s = { res, team|null, last, blocked, since, stale }
let streamCount = 0;
function push(s, body) {
  if (s.blocked) { s.stale = true; return; }           // that phone is not keeping up: skip, it gets the newest view later
  s.last = body;
  let ok = false;
  try { ok = s.res.write('event: view\ndata: ' + withNow(body) + '\n\n'); } catch (e) { return dropStream(s); }
  if (!ok) { s.blocked = true; s.since = Date.now(); }
}
function dropStream(s, gone) {
  if (s.dead) return;
  s.dead = true; streamCount--;
  // gone === true: tell the phone its team was removed.  gone === false: the line is dead, just cut it.
  try {
    if (gone === false) s.res.destroy();
    else { if (gone) s.res.write('event: gone\ndata: {}\n\n'); s.res.end(); }
  } catch (e) {}
  if (s.team) {
    const x = live.get(s.team.id);
    if (x) x.streams.delete(s);
    if (S.teams.get(s.team.id) === s.team) touchTeam(s.team, false);      // "devices" went down by one
  } else hostStreams.delete(s);
}
function openStream(req, res, key) {
  const team = byKey.get(key) || null, isHost = !team && S.hostKeys.includes(key);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive'
  });
  if (!team && !isHost) return res.end(holding() ? 'retry: 3000\n\n' : 'event: gone\ndata: {}\n\n');
  if (streamCount >= MAX_STREAMS) return res.end('retry: 5000\n\n');
  try { req.socket.setNoDelay(true); req.socket.setTimeout(0); } catch (e) {}
  const s = { res, team, last: null, blocked: false, since: 0, stale: false, dead: false };
  streamCount++;
  res.write('retry: 2000\n\n');
  const bye = () => dropStream(s, false);
  res.on('close', bye); res.on('error', bye); req.on('error', bye);
  res.on('drain', () => {                               // the phone caught up: send what it missed
    s.blocked = false;
    if (!s.stale || s.dead) return;
    s.stale = false; s.last = null;
    if (s.team) dirtyTeams.add(s.team.id); else hostDirty = true;
  });
  if (team) {
    const x = rt(team);
    if (x.streams.size >= MAX_TEAM_STREAMS) dropStream(x.streams.values().next().value);     // too many tabs: oldest goes
    x.streams.add(s);
    touchTeam(team, false);                             // "devices" went up by one
    push(s, playerBody(team));
  } else {
    hostStreams.add(s);
    push(s, hostBody());
  }
}
function flushTeam(id) {
  const t = S.teams.get(id), x = live.get(id);
  if (!t || !x || !x.streams.size) return;
  const body = playerBody(t);
  for (const s of x.streams) if (s.last !== body) push(s, body);
}
let lastHostPush = 0;
function flush() {
  if (allDirty) { allDirty = false; dirtyTeams.clear(); for (const id of live.keys()) flushTeam(id); }
  else if (dirtyTeams.size) { const ids = Array.from(dirtyTeams); dirtyTeams.clear(); for (const id of ids) flushTeam(id); }
  const now = Date.now();
  const gap = DUEL && S.phase === 'order' && ROUNDS[S.ri] === DUEL ? 200 : HOST_PUSH_MS;     // the showdown is drawn live: push faster
  if (hostDirty && now - lastHostPush >= gap) {
    hostDirty = false; lastHostPush = now;
    if (hostStreams.size) { const body = hostBody(); for (const s of hostStreams) if (s.last !== body) push(s, body); }
  }
}
function heartbeat() {               // keeps Wi-Fi routers from closing quiet connections, clears out dead phones, and lets every
  // phone see that its line is alive (a real event, not a comment: the browser must be able to notice it)
  const now = Date.now(), all = Array.from(hostStreams);
  for (const x of live.values()) for (const s of x.streams) all.push(s);
  for (const s of all) {
    if (s.blocked) { if (now - s.since > SLOW_SOCKET_MS) dropStream(s, false); continue; }
    try { if (!s.res.write('event: hb\ndata: 1\n\n')) { s.blocked = true; s.since = now; } } catch (e) { dropStream(s, false); }
  }
}
function closeTeamStreams(t) {       // the team was removed: tell its phones and hang up
  const x = live.get(t.id);
  if (x) for (const s of Array.from(x.streams)) dropStream(s, true);
  live.delete(t.id);
}

// ---------- wrong-PIN protection ----------
const badHost = new Map();           // ip -> { n, until, at }      organiser PIN
const badTeam = new Map();           // ip|team name -> { n, until, at }   team PIN, per phone
const badName = new Map();           // team name -> { n, until, at }      team PIN, from anywhere (stops a guessing machine)
let badAll = { n: 0, from: 0, until: 0 };              // all wrong organiser PINs together (stops a guessing machine)
function blocked(map, k) { const x = map.get(k); return !!x && x.until > Date.now(); }
function strike(map, k, max, blockMs) {
  const now = Date.now();
  let x = map.get(k);
  if (!x || now - x.at > 10 * 60000) x = { n: 0, until: 0, at: now };
  x.n++; x.at = now;
  if (x.n >= max) { x.n = 0; x.until = now + (blockMs || PIN_BLOCK_MS); }
  map.delete(k); map.set(k, x);      // newest record last
  if (map.size > 20000) prune(map, 15000);
}
// Forget old wrong-PIN records. Never wipes the whole list: a block that is still running stays, unless the list is
// absurdly long, and then only the oldest records go.
function prune(map, keep) {
  const now = Date.now();
  for (const [k, x] of map) if (x.until < now && now - x.at > 10 * 60000) map.delete(k);
  if (keep && map.size > keep) for (const [k, x] of map) { if (map.size <= keep) break; if (x.until < now) map.delete(k); }
  if (keep && map.size > keep) for (const k of map.keys()) { if (map.size <= keep) break; map.delete(k); }
}
function samePin(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- actions ----------
const fail = err => ({ ok: false, err });

function hlogin(b, ip, local) {
  const now = Date.now();
  // "local" = typed on this laptop itself. The room-wide block never locks the organiser's own laptop out.
  if (blocked(badHost, ip) || (badAll.until > now && !local)) return { ok: false, badPin: true, wait: true, err: 'Too many wrong PINs. Wait one minute, then try again.' };
  if (!samePin(b.hp == null ? '' : b.hp, S.hostPin)) {
    strike(badHost, ip, PIN_TRIES);
    if (now - badAll.from > 60000) badAll = { n: 0, from: now, until: 0 };
    if (++badAll.n >= BAD_ALL_MAX) badAll.until = now + PIN_BLOCK_MS;
    return { ok: false, badPin: true, err: 'Wrong organiser PIN.' };
  }
  badHost.delete(ip);
  const k = crypto.randomBytes(16).toString('hex');
  S.hostKeys.push(k);
  if (S.hostKeys.length > MAX_HOST_KEYS) S.hostKeys.splice(0, S.hostKeys.length - MAX_HOST_KEYS);
  saveDirty = true;
  return { ok: true, k };
}

function join(b, who) {
  const ip = who.ip;
  // tidy the name: no invisible characters, single spaces
  const name = String(b.name == null ? '' : b.name).replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202e\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  const pin = typeof b.pin === 'number' ? String(b.pin) : String(b.pin == null ? '' : b.pin).trim();
  if (Array.from(name).length < 2) return fail('Team name is too short. Use at least 2 letters.');
  if (Array.from(name).length > 24) return fail('Team name is too long. Use 24 letters at most.');
  if (!/^\d{4}$/.test(pin)) return fail('The team PIN must be exactly 4 digits.');
  const low = name.toLowerCase(), guard = ip + '|' + low;
  let t = byName.get(low), created = false;
  if (t) {                           // a second phone joining an existing team: always allowed with the right PIN
    if (blocked(badName, low)) return fail('Too many wrong PINs for that team. Wait 5 minutes, or ask the organiser for a new PIN.');
    if (blocked(badTeam, guard)) return fail('Too many wrong PINs for that team. Wait one minute, then try again.');
    if (!samePin(pin, t.pin)) {
      strike(badTeam, guard, 6);                          // this phone
      strike(badName, low, NAME_TRIES, NAME_BLOCK_MS);    // and this team name, whoever is guessing
      return fail('That team name is taken, or the PIN is wrong.');
    }
    badTeam.delete(guard);
  } else {
    // No team has this name. After the start that is nearly always a typing mistake, so say so.
    const hint = 'No team is called "' + name + '". Check the spelling: it must match your teammates exactly. ';
    if (started()) return fail(hint + 'New teams cannot join now: the game has already started.');
    if (!S.joinOpen) return fail(hint + 'New teams cannot join now: the organiser has closed the lobby.');
    if (S.teams.size >= MAX_TEAMS) return fail('The game is full.');
    if (ADDR_TEAMS && !who.local) {  // one phone must not be able to fill the whole lobby with made-up teams
      let mine = 0;
      for (const x of S.teams.values()) if (x.from === ip) mine++;
      if (mine >= ADDR_TEAMS * (who.proxied ? PROXY_FACTOR : 1)) return fail('Too many new teams came from this phone already (' + mine + '). Ask the organiser for help.');
    }
    t = { id: crypto.randomBytes(6).toString('hex'), key: crypto.randomBytes(16).toString('hex'), name, pin, layout: {}, res: {}, adj: [], from: ip };
    S.teams.set(t.id, t); byKey.set(t.key, t); byName.set(low, t);
    created = true;
    touchAll();                      // everybody's "teams joined" count changes
  }
  // created tells the phone whether it started a NEW team or joined one that was there (a typo in the name makes a new one)
  return { ok: true, k: t.key, name: t.name, created, devices: rt(t).streams.size };
}

// A showdown team's phone sends the route it is walking, a few times a second, so the big screens can draw it live.
// Only the route is checked (start at START, legal steps); nothing is scored here.
function trace(t, b) {
  const R = ROUNDS[S.ri];
  if (S.phase !== 'order' || !R || !R.showdown || b.round !== R.id || !S.duel.includes(t.id) || has(t.res, R.id)) return { ok: false, err: 'No live route now.' };
  const rt = b.route;
  if (!Array.isArray(rt) || !rt.length || rt.length > 400 || rt[0] !== Game.START) return { ok: false, err: 'That route did not work.' };
  for (let i = 1; i < rt.length; i++) {
    if (!Game.validCell(rt[i]) || Game.steps(rt[i - 1], R).indexOf(rt[i]) < 0) return { ok: false, err: 'That route did not work.' };
  }
  const old = liveRoute.get(t.id);
  if (old && old.route.length === rt.length && old.route.every((c, i) => c === rt[i])) return { ok: true };
  liveRoute.set(t.id, { route: rt.slice(), at: Date.now() });
  liveVer++; hostDirty = true;
  return { ok: true };
}

// Returns a problem in words, or nothing if it worked.
function teamAct(a, b, t, who) {
  if (a === 'state') return;
  if (a === 'place' || a === 'remove') {
    if (S.phase !== 'layout') return S.phase === 'lobby' ? 'Round 1 has not started yet.' : 'Layouts are locked.';
    const cell = b.cell;
    if (!Game.validCell(cell) || !Game.placeable(cell)) return 'That square cannot hold a product.';
    if (a === 'remove') {
      if (has(t.layout, cell)) { delete t.layout[cell]; bestCache.clear(); touchTeam(t); }
      return;
    }
    const p = typeof b.p === 'number' ? b.p : NaN, l = b.l;
    if (!Number.isInteger(p) || p < 1 || p > 24 || typeof l !== 'string' || !has(LEVEL_OK, l)) return 'Pick a product and a level.';
    const old = Game.where(t.layout, p);
    if (old) delete t.layout[old];   // a product lives in one place only: placing it again moves it
    t.layout[cell] = { p, l };
    bestCache.clear(); touchTeam(t);
    return;
  }
  if (a === 'submit') {
    const R = ROUNDS[S.ri];
    if (S.phase !== 'order' || !R || b.round !== R.id) return 'Too late, this order is closed.';
    if (R.showdown && !S.duel.includes(t.id)) return 'Only the top four teams play the showdown. Watch the big screen!';
    if (has(t.res, R.id)) return 'You already handed this one in.';
    const out = Game.scoreSubmission(R, t.layout, { route: b.route, route2: b.route2, mode: b.mode });
    if (!out || out.err) return (out && out.err) || 'That route did not work.';
    // Faster than any human can tap it (a script did the walking): the hand-in counts, but it gets no speed bonus,
    // takes no speed-bonus place from the others, and the organiser sees a flag. Never applied on the game laptop itself.
    const at = Date.now(), walked = (out.route ? out.route.length - 1 : 0) + (out.route2 ? out.route2.length - 1 : 0);
    const fast = !(who && who.local) && S.startedAt > 0 && at - S.startedAt < FAST_BASE_MS + FAST_STEP_MS * walked;
    // speed bonus: the first few teams to hand in (3, or one team in ten when the room is big)
    let earlier = 0;
    for (const x of S.teams.values()) if (has(x.res, R.id) && !x.res[R.id].fast) earlier++;
    const slots = R.showdown ? 1 : Math.max(3, Math.ceil(S.teams.size * 0.10));       // showdown: only the first to finish
    const bonus = !fast && earlier < slots ? Game.SCORE.speedBonus : 0;
    // perfect bonus: nobody could have done better with this layout
    const best = bestOf(t, R);
    const perfect = best && out.score >= best.score ? Game.SCORE.perfectBonus : 0;
    t.res[R.id] = { meters: out.meters, score: out.score, bonus, perfect, mode: out.mode, at, route: out.route, route2: out.route2 };
    if (fast) t.res[R.id].fast = true;
    if (R.showdown) { liveRoute.delete(t.id); liveVer++; }      // the handed-in route takes over from the live one
    touchTeam(t);
    return;
  }
  if (a === 'replay') {
    if (!S.demo) return 'Trying again is only allowed in practice mode.';
    const R = ROUNDS[S.ri];
    if (S.phase !== 'order' || !R) return 'No order is running.';
    if (has(t.res, R.id)) { delete t.res[R.id]; touchTeam(t); }
    return;
  }
  return 'Unknown action.';
}

const HOST_ACTIONS = new Set(['hstate', 'hlayout', 'hlock', 'hround', 'hend', 'hfinal', 'htime', 'hpause', 'htimer', 'hdemo', 'hjoin', 'hsales', 'hmsg', 'hkick', 'hadjust', 'hredo', 'hreset', 'hpodium', 'hpin']);
const TEAM_ACTIONS = new Set(['state', 'place', 'remove', 'submit', 'replay', 'trace']);

// Returns a problem in words, a ready reply object, or nothing if it worked.
function hostAct(a, b) {
  const now = Date.now();
  const teamOf = () => (typeof b.tid === 'string' && S.teams.get(b.tid)) || null;
  if (a === 'hstate') return;
  if (a === 'hlayout') {
    const noOrderYet = S.ri < 0 && !S.done.length;
    if (S.phase !== 'lobby' && !(S.phase === 'locked' && noOrderYet)) {
      return S.phase === 'layout' ? 'Round 1 is already running.' : 'Layouts cannot be reopened once orders have started.';
    }
    const secs = Math.min(3600, Math.max(30, Math.round(Number(b.secs)) || LAYOUT_MINUTES * 60));
    S.phase = 'layout'; S.layoutSecs = secs; S.pausedLeft = 0; S.endsAt = S.timer ? now + secs * 1000 : 0;
    bestCache.clear(); graceUntil = 0;                     // a new game is really starting: old phones are told to join again
  } else if (a === 'hlock') {
    if (S.phase !== 'layout') return 'Round 1 is not running.';
    S.phase = 'locked'; S.endsAt = 0; S.pausedLeft = 0; bestCache.clear();
  } else if (a === 'hround') {
    const i = typeof b.i === 'number' ? b.i : typeof b.i === 'string' && b.i.trim() !== '' ? Number(b.i) : NaN;
    if (!Number.isInteger(i) || i < 0 || i >= ROUNDS.length) return 'No such order.';
    if (!started()) return 'Lock the layouts first.';
    const R = ROUNDS[i];
    let played = false;
    for (const t of S.teams.values()) if (has(t.res, R.id)) { played = true; break; }
    if (played && b.force !== true) return { ok: false, need: R.label + ' was already played. Play it again and wipe its old scores?' };
    if (S.phase === 'order' && S.ri !== i) { const old = ROUNDS[S.ri]; if (old && !S.done.includes(old.id)) S.done.push(old.id); }
    for (const t of S.teams.values()) delete t.res[R.id];
    S.done = S.done.filter(x => x !== R.id);
    liveRoute.clear(); liveVer++;
    // Bounty: it goes on the leader at this moment, once an order has been played, the leader has points and the room
    // has at least 3 teams. The showdown has no bounty: it takes the top four instead.
    if (R.showdown) S.duel = [];
    ver++;                                               // results were wiped: work the ranking out again
    const rows = derived().rows, top = rows[0];
    S.hunt[R.id] = !R.showdown && top && S.teams.size >= 3 && S.done.length > 0 && top.tot.pts > 0 ? top.t.id : '';
    if (R.showdown) S.duel = rows.slice(0, DUEL_SIZE).map(x => x.t.id);
    S.ri = i; S.phase = 'order'; S.pausedLeft = 0; S.endsAt = S.timer ? now + R.secs * 1000 : 0;
    S.startedAt = now; S.podium = 0;
    warmBest(R);
  } else if (a === 'hend') {
    if (S.phase !== 'order') return 'No order is running.';
    endOrder();
  } else if (a === 'hfinal') {
    if (!started()) return 'The game has not started.';
    if (S.phase === 'order') endOrder();
    if (S.phase !== 'final') S.podium = 0;                 // the podium starts hidden: the organiser reveals 3rd, 2nd, 1st
    S.phase = 'final'; S.endsAt = 0; S.pausedLeft = 0;
  } else if (a === 'hpodium') {                            // {step}: how many podium places are revealed (0 = all hidden)
    if (S.phase !== 'final') return 'The final results are not showing.';
    const n = typeof b.step === 'number' ? b.step : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 3) return 'No such podium step.';
    S.podium = Math.min(n, Math.min(3, S.teams.size));
  } else if (a === 'htime') {
    const secs = Math.round(Number(b.secs));
    if (!Number.isFinite(secs) || !secs) return 'Say how many seconds to add.';
    if (!S.timer) return 'The clock is switched off.';
    const add = Math.max(-3600, Math.min(3600, secs)) * 1000;
    if (S.pausedLeft) S.pausedLeft = Math.max(1000, S.pausedLeft + add);
    else if (S.endsAt) S.endsAt = Math.max(now, S.endsAt + add);
    else return 'No timer is running.';
  } else if (a === 'hpause') {
    if (!S.timer) return 'The clock is switched off.';
    if (S.pausedLeft) { S.endsAt = now + S.pausedLeft; S.pausedLeft = 0; }
    else if (S.endsAt) { S.pausedLeft = Math.max(1, S.endsAt - now); S.endsAt = 0; }
    else return 'No timer is running.';
  } else if (a === 'htimer') {
    S.timer = !S.timer; S.pausedLeft = 0;
    if (!S.timer) S.endsAt = 0;
    else if (S.phase === 'order' && ROUNDS[S.ri]) S.endsAt = now + ROUNDS[S.ri].secs * 1000;
    else if (S.phase === 'layout') S.endsAt = now + S.layoutSecs * 1000;
  } else if (a === 'hdemo') {
    S.demo = !S.demo;
  } else if (a === 'hjoin') {
    S.joinOpen = !S.joinOpen;
  } else if (a === 'hsales') {
    S.showSales = !S.showSales;
  } else if (a === 'hmsg') {
    const text = String(b.text == null ? '' : b.text).replace(/\s+/g, ' ').trim().slice(0, 140);
    S.msg = text ? { text, at: now } : null;
  } else if (a === 'hkick') {
    const t = teamOf();
    if (!t) return 'That team is not in the game.';
    S.teams.delete(t.id); byKey.delete(t.key); byName.delete(t.name.toLowerCase());
    for (const k of t.alt || []) if (byKey.get(k) === t) byKey.delete(k);
    closeTeamStreams(t);
    liveRoute.delete(t.id); liveVer++;
    for (const k of Array.from(bestCache.keys())) if (k.startsWith(t.id + '|')) bestCache.delete(k);
  } else if (a === 'hadjust') {
    const t = teamOf();
    if (!t) return 'That team is not in the game.';
    const p = typeof b.pts === 'number' ? b.pts : NaN;
    if (!Number.isInteger(p) || !p || Math.abs(p) > 1000) return 'Points must be a whole number between -1000 and 1000, and not 0.';
    if (t.adj.length >= 50) return 'That team already has too many adjustments.';
    t.adj.push({ pts: p, why: String(b.why == null ? '' : b.why).replace(/\s+/g, ' ').trim().slice(0, 60) });
  } else if (a === 'hpin') {                               // {tid, pin}: a team forgot its PIN, the organiser sets a new one
    const t = teamOf();
    if (!t) return 'That team is not in the game.';
    const pin = typeof b.pin === 'number' ? String(b.pin) : String(b.pin == null ? '' : b.pin).trim();
    if (!/^\d{4}$/.test(pin)) return 'The team PIN must be exactly 4 digits.';
    t.pin = pin;
    const low = t.name.toLowerCase();                      // old wrong-PIN blocks for this team are lifted
    badName.delete(low);
    for (const k of Array.from(badTeam.keys())) if (k.endsWith('|' + low)) badTeam.delete(k);
  } else if (a === 'hredo') {
    const t = teamOf(), R = roundNow();
    if (!R) return 'No order is running or being shown.';
    if (!t) return 'That team is not in the game.';
    delete t.res[R.id];
    liveRoute.delete(t.id); liveVer++;
  } else if (a === 'hreset') {
    for (const t of Array.from(S.teams.values())) closeTeamStreams(t);
    S = fresh(S.hostPin, S.hostKeys);
    live.clear(); bestCache.clear(); dirtyTeams.clear(); warmJob++; reindex();
    liveRoute.clear(); liveVer++;
    badTeam.clear(); badName.clear(); graceUntil = 0;
  } else return 'Unknown action.';
  touchAll();
}

// One request in, one reply out. Replies are strings of JSON, ready to send.
function act(b, who) {
  tick();
  const a = typeof b.a === 'string' ? b.a : '';
  if (a === 'join') return JSON.stringify(join(b, who));
  if (a === 'hlogin') return JSON.stringify(hlogin(b, who.ip, who.local));
  const k = typeof b.k === 'string' ? b.k : '';
  if (HOST_ACTIONS.has(a)) {
    if (!k || !S.hostKeys.includes(k)) return JSON.stringify({ ok: false, badPin: true, err: 'Type the organiser PIN again.' });
    const r = hostAct(a, b);
    if (typeof r === 'string') return JSON.stringify(fail(r));
    return r ? JSON.stringify(r) : withNow(hostBody());
  }
  if (TEAM_ACTIONS.has(a)) {
    const t = k ? byKey.get(k) : null;
    if (!t) return holding() ? HOLD : JSON.stringify({ ok: false, gone: true, err: 'Your team is not in the game any more. Join again.' });
    if (a === 'trace') return JSON.stringify(trace(t, b));        // small reply: phones send these many times a second
    const e = teamAct(a, b, t, who);
    return e ? JSON.stringify(fail(e)) : withNow(playerBody(t));
  }
  return JSON.stringify(fail('Unknown action.'));
}

// ---------- the final table as a spreadsheet file ----------
function csv() {
  const cell = v => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s;       // so a team name can never run as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [['rank', 'team', 'points', 'meters', 'penalties', 'adjustments'].concat(ROUNDS.map(r => r.label)).map(cell).join(',')];
  derived().rows.forEach((x, i) => {
    const row = [i + 1, x.t.name, x.tot.pts, x.tot.meters, x.tot.pen, x.tot.adjSum];
    for (const R of ROUNDS) { const r = x.t.res[R.id]; row.push(r ? r.score + r.bonus + r.perfect : ''); }
    lines.push(row.map(cell).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

// ---------- web server ----------
// Phones get game.js WITHOUT the route solver (solve / bestFor). With it, one line typed into a phone's browser would
// print the perfect route for every order. game.js marks those functions with /*<server-only name>*/ ... /*</server-only>*/.
function browserGame() {
  let src;
  try { src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'); } catch (e) { return null; }
  let cut = 0;
  const out = src.replace(/\/\*<server-only (\w+)>\*\/[\s\S]*?\/\*<\/server-only>\*\//g, (m, name) => {
    cut++;
    return 'function ' + name + '() { return null; }   // not sent to phones: only the server works out the best route';
  });
  let ok = cut === 2 && !/frontier|<\/?server-only/.test(out);
  if (ok) { try { new vm.Script(out); } catch (e) { ok = false; } }
  if (!ok) {
    console.error('  WARNING: could not cut the route solver out of game.js (its server-only marks are missing or broken).');
    console.error('  The game still works, but phones can read the solver. Restore game.js from the original copy.');
    return Buffer.from(src);
  }
  return Buffer.from(out);
}
const GAME_JS = browserGame();       // made once at startup
// Only these files can ever be fetched. rounds.js and the save file are not on the list, so they cannot leak.
const FILES = {
  '/': ['public/player.html', 'text/html'], '/host': ['public/host.html', 'text/html'],
  '/spectator': ['public/spectator.html', 'text/html'], '/spectator.html': ['public/spectator.html', 'text/html'],
  '/game.js': ['game.js', 'text/javascript'],
  '/kit.js': ['public/kit.js', 'text/javascript'], '/kit.css': ['public/kit.css', 'text/css'],
  '/kit3d.js': ['public/kit3d.js', 'text/javascript'],
  '/player.js': ['public/player.js', 'text/javascript'], '/player.css': ['public/player.css', 'text/css'],
  '/host.js': ['public/host.js', 'text/javascript'], '/host.css': ['public/host.css', 'text/css']
};
function text(res, code, msg, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra));
  res.end(msg);
}
function json(res, code, str) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(str);
}
// Who is asking?  { ip, local, proxied }
//   local   = a browser on this laptop itself (not through a tunnel)
//   proxied = it came through a tunnel/proxy running on this laptop
// The X-Forwarded-For header is believed ONLY when the connection comes from this laptop (a tunnel). A phone on the Wi-Fi
// can write anything it likes into that header, so for phones the real network address always counts. From a tunnel we
// take the LAST address in the list: that is the one the tunnel itself added; anything before it was sent by the caller.
const loopback = a => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
function whoIs(req) {
  const a = (req.socket && req.socket.remoteAddress) || 'unknown', f = req.headers['x-forwarded-for'];
  if (loopback(a) && typeof f === 'string' && f.trim()) {
    const hops = f.split(',');
    return { ip: hops[hops.length - 1].trim().slice(0, 64) || a, local: false, proxied: true };
  }
  return { ip: a, local: loopback(a), proxied: false };
}

function handle(req, res) {
  const raw = String(req.url || '/'), q = raw.indexOf('?');
  const url = (q < 0 ? raw : raw.slice(0, q)).replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1));

  if (req.method === 'POST' && url === '/api') {
    const chunks = [];
    let size = 0, over = false;
    req.on('data', c => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; json(res, 413, JSON.stringify(fail('That request is too big.'))); req.resume(); }
      else chunks.push(c);
    });
    req.on('error', () => {});
    req.on('end', () => {
      if (over) return;
      let b, out, code = 200;
      try { b = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch (e) { b = undefined; }
      if (!b || typeof b !== 'object' || Array.isArray(b)) { code = 400; out = JSON.stringify(fail('That request could not be read.')); }
      else {
        try { out = act(b, whoIs(req)); }
        catch (e) { console.error(e); out = JSON.stringify(fail('Something went wrong. Try again.')); }
      }
      json(res, code, out);
    });
    return;
  }
  // The organiser puts a safety copy back (after a restart that lost the game). Signed-in organisers only.
  if (req.method === 'POST' && url === '/restore') {
    const k = query.get('k') || '';
    if (!k || !S.hostKeys.includes(k)) { req.resume(); return json(res, 403, JSON.stringify({ ok: false, badPin: true, err: 'Type the organiser PIN again.' })); }
    const chunks = [];
    let size = 0, over = false;
    req.on('data', c => {
      if (over) return;
      size += c.length;
      if (size > MAX_RESTORE) { over = true; chunks.length = 0; json(res, 413, JSON.stringify(fail('That safety copy is too big.'))); req.resume(); }
      else chunks.push(c);
    });
    req.on('error', () => {});
    req.on('end', () => {
      if (over) return;
      let out;
      try {
        const d = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        if (!d || typeof d !== 'object' || !d.teams || typeof d.teams !== 'object' || typeof d.phase !== 'string') throw new Error('not a safety copy');
        tick();
        out = restore(d);
      } catch (e) { out = fail('That file is not a safety copy of this game.'); }
      json(res, 200, JSON.stringify(out));
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Not allowed', { Allow: 'GET, POST' });

  if (url === '/healthz') return text(res, 200, 'ok');
  if (url === '/events') {
    if (req.method !== 'GET') return text(res, 405, 'Not allowed');
    tick();
    return openStream(req, res, query.get('k') || '');
  }
  if (url === '/export.csv') {
    const k = query.get('k') || '';
    if (!k || !S.hostKeys.includes(k)) return text(res, 403, 'Open the organiser screen and sign in first.');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="dark-store-blitz-results.csv"' });
    return res.end(csv());
  }
  if (url === '/backup') {             // the whole game as one file: the organiser screen fetches it every few seconds
    const k = query.get('k') || '';
    if (!k || !S.hostKeys.includes(k)) return text(res, 403, 'Open the organiser screen and sign in first.');
    tick();
    const head = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (query.get('dl')) head['Content-Disposition'] = 'attachment; filename="dark-store-blitz-safety-copy.json"';
    res.writeHead(200, head);
    return res.end(req.method === 'HEAD' ? undefined : backupBody());
  }
  if (url === '/favicon.ico') { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
  if (has(FILES, url)) {
    const f = FILES[url];
    if (url === '/game.js' && GAME_JS) {
      res.writeHead(200, { 'Content-Type': f[1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : GAME_JS);
    }
    fs.readFile(path.join(__dirname, f[0]), (e, data) => {
      if (e) return text(res, 404, 'Not found: ' + path.basename(f[0]) + ' is missing.');
      res.writeHead(200, { 'Content-Type': f[1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
    return;
  }
  text(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  try { handle(req, res); }
  catch (e) {
    console.error(e);
    try { if (!res.headersSent) text(res, 500, 'Something went wrong.'); else res.end(); } catch (e2) {}
  }
});
// Phones keep one connection open between taps. Node's default closes an idle one after 5 s, exactly when a phone may be
// re-using it (the request is then lost). Keep idle connections for 75 s instead.
server.keepAliveTimeout = 75000;
server.headersTimeout = 80000;
server.on('clientError', (e, socket) => { try { socket.destroy(); } catch (e2) {} });
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log('\n  The game is already running in another Terminal window (port ' + PORT + ' is busy). Close that one first.\n');
  else console.log('\n  The server could not start: ' + e.message + '\n');
  process.exit(1);
});

// A bug in one request must never take the whole room down: write it in the window and keep serving.
process.on('uncaughtException', e => { console.error('  Unexpected problem (the game keeps running):', e); });
process.on('unhandledRejection', e => { console.error('  Unexpected problem (the game keeps running):', e); });

let timers = [];
server.listen(PORT, '0.0.0.0', () => {
  timers = [
    setInterval(tick, 250),
    setInterval(flush, FLUSH_MS),
    setInterval(saveTick, 1000),
    setInterval(heartbeat, HEARTBEAT_MS),
    setInterval(() => {                                 // forget old wrong-PIN records
      for (const m of [badHost, badTeam, badName]) prune(m);
    }, 60000)
  ];
  const urls = lanUrls();
  console.log('\n  DARK STORE BLITZ is running. Keep this window open.\n');
  console.log('  Organiser screen (this laptop):  http://localhost:' + PORT + '/host');
  console.log('  Organiser PIN:                   ' + S.hostPin + (PIN_IS_DEFAULT ? '   (the public default: set HOST_PIN before a competition)' : ''));
  console.log('  Orders:                          ' + (ORDERS.set === 'secret' ? 'the SECRET competition set (' + ORDERS.from + ')' : 'the public PRACTICE set (rounds.js). Not for a competition.'));
  console.log('  Bounty / showdown:               +' + BOUNTY_PTS + (BOUNTY_COUNTS ? ' (counts)' : ' (badge only)') + '  /  ' +
    (DUEL ? DUEL.label + ', ' + (SHOWDOWN_MODE === 'title' ? 'decides the title' : 'points add up') : 'off'));
  console.log('  Players type this on phones:     ' + (urls.join('   or   ') || 'connect this laptop to Wi-Fi, then start again'));
  console.log('\n  To stop the game press Ctrl + C\n');

  // Keep-alive ping loop for Render free tier so it never spins down
  const pingUrl = process.env.RENDER_EXTERNAL_URL || '';      // set by Render itself: a game on a laptop pings nobody
  if (pingUrl) {
    const proto = pingUrl.startsWith('https') ? require('https') : require('http');
    const pingTimer = setInterval(() => {
      try {
        proto.get(pingUrl + '/healthz', res => { res.resume(); }).on('error', () => {});
      } catch (e) {}
    }, 10 * 60 * 1000);
    if (pingTimer.unref) pingTimer.unref();
  }
});

let stopping = false;
function stop() {                    // Ctrl + C: save first, then hang up politely
  if (stopping) return;
  stopping = true;
  saveNow();
  for (const t of timers) clearInterval(t);
  for (const s of Array.from(hostStreams)) { try { s.res.end(); } catch (e) {} }
  for (const x of live.values()) for (const s of x.streams) { try { s.res.end(); } catch (e) {} }
  console.log('\n  Game saved. Bye!\n');
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
