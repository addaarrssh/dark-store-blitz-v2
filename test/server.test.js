// DARK STORE BLITZ - server checks. Starts the real server on a spare port with a throw-away save file.
//   node --test test/
// These cover the things that are easy to break by accident: what phones may see and when, wrong-PIN protection,
// the hidden podium, the "too fast" flag, and coming back after a crash.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const Game = require('../game.js');
const { ROUNDS } = require('../orders.js').load().data;      // the same set the server picks (secret if present, else practice)

const ROOT = path.join(__dirname, '..');
const PORT = 3400 + Math.floor(Math.random() * 400);
const PIN = '246813';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsb-test-'));
const SAVE = path.join(TMP, 'save.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let child = null;
function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { PORT: String(PORT), HOST_PIN: PIN, SAVE_FILE: SAVE, TEAMS_PER_ADDRESS: '2' })
    });
    let out = '', done = false;
    const seen = d => { out += d; if (!done && /is running/.test(out)) { done = true; resolve(); } };
    child.stdout.on('data', seen); child.stderr.on('data', seen);
    child.on('exit', () => { if (!done) { done = true; reject(new Error('the server did not start:\n' + out)); } });
    setTimeout(() => { if (!done) { done = true; reject(new Error('the server did not start in time:\n' + out)); } }, 8000);
  });
}
function stopServer(signal) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode) return resolve();
    child.once('exit', () => resolve());
    child.kill(signal || 'SIGTERM');
  });
}

// One request. opts: {headers, host} - host lets a test come in over the Wi-Fi address instead of 127.0.0.1.
function req(method, p, body, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = Object.assign({}, opts.headers);
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const r = http.request({ host: opts.host || '127.0.0.1', port: PORT, path: p, method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    r.setTimeout(8000, () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end(data);
  });
}
const api = (body, opts) => req('POST', '/api', body, opts).then(r => r.json);
const from = ip => ({ headers: { 'X-Forwarded-For': ip } });        // "this came through a tunnel, from that address"
let HK = '';
const host = body => api(Object.assign({ k: HK }, body));

// a layout with every product placed and no penalties, the same for every test team
function goodLayout() {
  const out = [], cold = ['J1', 'J2', 'J3'], chem = ['J8', 'J9', 'J10'], shelves = [];
  for (let r = 0; r < 10; r++) for (let c = 1; c <= 10; c++) {
    const id = Game.cid(r, c), k = Game.kindOf(id);
    if (k === 'shelf' || k === 'spare') shelves.push(id);
  }
  for (const p of Game.PRODUCTS) {
    const cell = p.tag === 'COLD' ? cold.pop() : p.tag === 'CHEMICAL' ? chem.pop() : shelves.shift();
    out.push([cell, p.n, p.tag === 'HEAVY' ? 'B' : 'M']);
  }
  return out;
}
async function stock(key) {
  const L = {};
  for (const s of goodLayout()) {
    const r = await api({ a: 'place', k: key, cell: s[0], p: s[1], l: s[2] });
    assert.ok(r.ok, 'place refused: ' + r.err);
    L[s[0]] = { p: s[1], l: s[2] };
  }
  return L;
}
function lanAddress() {
  const n = os.networkInterfaces();
  for (const k of Object.keys(n)) for (const a of n[k] || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
  return null;
}

test.before(async () => {
  await startServer();
  const r = await api({ a: 'hlogin', hp: PIN });
  assert.ok(r.ok && r.k, 'organiser login failed');
  HK = r.k;
});
test.after(async () => {
  await stopServer('SIGTERM');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
});

test('phones get game.js without the route solver, and never rounds.js', async () => {
  const g = await req('GET', '/game.js');
  assert.strictEqual(g.status, 200);
  assert.ok(!/frontier|<\/?server-only/.test(g.text), 'the solver is still in the file sent to phones');
  const box = { self: {} };
  vm.runInNewContext(g.text, box);
  const BG = box.self.Game;
  assert.ok(BG && typeof BG.scoreSubmission === 'function' && typeof BG.pathTo === 'function', 'the browser copy of the rules is broken');
  assert.strictEqual(BG.solve({ C4: { p: 5, l: 'M' } }, [5], null), null, 'solve() must do nothing in the browser copy');
  assert.strictEqual(BG.bestFor(ROUNDS[0], {}), null);
  assert.ok(Game.solve({ C4: { p: 5, l: 'M' } }, [5], null), 'the server copy must still solve');
  for (const p of ['/rounds.js', '/server.js', '/blitz-save.json', '/public/../rounds.js']) assert.strictEqual((await req('GET', p)).status, 404, p);
});

test('the lobby demo route in player.js is a legal, complete route for its own little order', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'player.js'), 'utf8');
  const m = /var path = (\[[^\]]+\]);/.exec(src);
  assert.ok(m, 'demo path not found in player.js');
  const route = JSON.parse(m[1].replace(/'/g, '"'));
  const L = { C4: { p: 5, l: 'M' }, E7: { p: 11, l: 'T' }, D2: { p: 21, l: 'M' } };
  assert.strictEqual(Game.checkRoute(L, [5, 11, 21], route, null), null);
  assert.strictEqual(route.length - 1, Game.solve(L, [5, 11, 21], null).meters);
  for (const R of ROUNDS) {
    const items = R.double ? R.a.concat(R.b) : R.items;
    assert.ok(![5, 11, 21].every(p => items.includes(p)), 'the demo shows a real order: ' + R.id);
  }
});

test('join says whether a team was created or joined; a wrong name after the start is explained', async () => {
  const a = await api({ a: 'join', name: 'Rockets', pin: '1111' });
  assert.ok(a.ok && a.created === true && a.devices === 0);
  const b = await api({ a: 'join', name: '  rockets ', pin: '1111' });
  assert.ok(b.ok && b.created === false && b.k === a.k);
  const c = await api({ a: 'join', name: 'Rockets', pin: '2222' });
  assert.ok(!c.ok && /PIN is wrong/.test(c.err));
});

test('a made-up X-Forwarded-For from a phone on the Wi-Fi is ignored', async t => {
  const lan = lanAddress();
  if (!lan) return t.skip('this machine has no Wi-Fi/LAN address to test from');
  let made;
  try { made = await api({ a: 'join', name: 'Lan Victim', pin: '7391' }, { host: lan }); } catch (e) { return t.skip('cannot reach the server over ' + lan); }
  assert.ok(made.ok);
  let blockedAt = 0;
  for (let i = 0; i < 9 && !blockedAt; i++) {
    const r = await api({ a: 'join', name: 'Lan Victim', pin: String(1000 + i) }, { host: lan, headers: { 'X-Forwarded-For': '10.1.1.' + i } });
    assert.ok(!r.ok);
    if (/Too many wrong PINs/.test(r.err)) blockedAt = i + 1;
  }
  assert.strictEqual(blockedAt, 7, 'the 7th wrong PIN from one phone must be blocked whatever header it sends');
  // and one phone cannot fill the lobby: the test server allows 2 new teams per address (Lan Victim was the first)
  assert.ok((await api({ a: 'join', name: 'Lan Two', pin: '1234' }, { host: lan })).ok);
  const third = await api({ a: 'join', name: 'Lan Three', pin: '1234' }, { host: lan, headers: { 'X-Forwarded-For': '10.9.9.9' } });
  assert.ok(!third.ok && /Too many new teams/.test(third.err), 'a third new team from the same phone must be refused');
});

test('guessing one team PIN from many addresses is stopped; the organiser can set a new PIN', async () => {
  const made = await api({ a: 'join', name: 'Victim', pin: '7391' }, from('10.2.0.1'));
  assert.ok(made.ok);
  let wrong = 0, blocked = false;
  for (let i = 0; i < 14 && !blocked; i++) {
    const r = await api({ a: 'join', name: 'victim', pin: String(2000 + i) }, from('10.2.1.' + i));     // a new address every time
    assert.ok(!r.ok);
    if (/Too many wrong PINs/.test(r.err)) blocked = true; else wrong++;
  }
  assert.ok(blocked && wrong === 10, 'the team name must close after 10 wrong PINs (it took ' + wrong + ')');
  const right = await api({ a: 'join', name: 'Victim', pin: '7391' }, from('10.2.2.2'));
  assert.ok(!right.ok, 'while the name is closed even the right PIN waits (otherwise guessing would go on)');
  const hv = await host({ a: 'hstate' });
  const tid = hv.teams.find(x => x.name === 'Victim').id;
  assert.ok(!(await host({ a: 'hpin', tid, pin: '12' })).ok);
  assert.ok((await host({ a: 'hpin', tid, pin: '4040' })).ok);
  assert.ok(!JSON.stringify(await host({ a: 'hstate' })).includes('4040'), 'team PINs must not be in the organiser view');
  const again = await api({ a: 'join', name: 'Victim', pin: '4040' }, from('10.2.2.2'));
  assert.ok(again.ok && again.k === made.k, 'the new PIN must let the team back in, with the same team');
  assert.ok(!(await api({ a: 'join', name: 'Victim', pin: '7391' }, from('10.2.2.3'))).ok, 'the old PIN must stop working');
});

test('one address cannot fill the lobby (through a tunnel the limit is 10 times higher)', async () => {
  let ok = 0, refused = null;
  for (let i = 0; i < 22; i++) {
    const r = await api({ a: 'join', name: 'Flood ' + i, pin: '1234' }, from('10.3.3.3'));
    if (r.ok) ok++; else refused = r.err;
  }
  assert.strictEqual(ok, 20);
  assert.match(String(refused), /Too many new teams/);
  const hv = await host({ a: 'hstate' });
  for (const t of hv.teams) if (/^Flood /.test(t.name)) await host({ a: 'hkick', tid: t.id });
  assert.ok((await api({ a: 'join', name: 'Flood again', pin: '1234' }, from('10.3.3.3'))).ok, 'removing teams must free the places');
});

test('the live stream sends a real "hb" event (a phone can notice a dead line)', async () => {
  const j = await api({ a: 'join', name: 'Rockets', pin: '1111' });
  const got = await new Promise((resolve, reject) => {
    let buf = '';
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/events?k=' + j.k, agent: false }, res => {
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; if (/event: hb\ndata: 1\n\n/.test(buf)) { r.destroy(); resolve(buf); } });
    });
    r.on('error', e => { if (!/event: hb/.test(buf)) reject(e); });
    r.end();
    setTimeout(() => { r.destroy(); resolve(buf); }, 7500);
  });
  assert.match(got, /event: view\ndata: \{/);
  assert.match(got, /event: hb\ndata: 1\n\n/);
});

test('a whole small game: too-fast flag, double drop, hidden podium, Next button data', async () => {
  let hv = await host({ a: 'hreset' });
  assert.ok(hv.ok && hv.phase === 'lobby' && hv.teams.length === 0);
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta'], T = {};
  for (let i = 0; i < names.length; i++) {
    const j = await api({ a: 'join', name: names[i], pin: '1234' }, from('10.4.0.' + i));
    assert.ok(j.ok && j.created);
    T[names[i]] = { k: j.k, ip: '10.4.0.' + i };
  }
  hv = await host({ a: 'hlayout', secs: 600 });
  assert.strictEqual(hv.phase, 'layout');
  let L = null;
  for (const n of names) L = await stock(T[n].k);
  const typo = await api({ a: 'join', name: 'Alpa', pin: '1234' }, from('10.4.0.9'));
  assert.ok(typo.ok && typo.created === true, 'during Round 1 a new name still makes a new team (and says so)');
  T.Alpa = { k: typo.k, ip: '10.4.0.9' };
  hv = await host({ a: 'hlock' });
  assert.strictEqual(hv.phase, 'locked');
  const late = await api({ a: 'join', name: 'Alhpa', pin: '1234' }, from('10.4.0.10'));
  assert.ok(!late.ok && /No team is called "Alhpa"/.test(late.err) && /spelling/.test(late.err), late.err);

  // ---- Order 1: a script hands in at once (through the "tunnel", so it is not the game laptop), a person later
  hv = await host({ a: 'hround', i: 0 });
  assert.ok(hv.ok && hv.phase === 'order' && hv.round.id === 'o1');
  const R1 = hv.round, best1 = Game.solve(L, R1.items, R1);
  const pv = await api({ a: 'state', k: T.Alpha.k });
  assert.ok(pv.round && pv.round.id === 'o1' && !pv.board && !pv.best);
  const bot = await api({ a: 'submit', k: T.Alpha.k, round: 'o1', route: best1.path }, from(T.Alpha.ip));
  assert.ok(bot.ok && bot.mine.perfect === Game.SCORE.perfectBonus);
  assert.strictEqual(bot.mine.bonus, 0, 'a hand-in faster than a person can tap gets no speed bonus');
  assert.ok(!('fast' in bot.mine), 'the flag is for the organiser only');
  await sleep(FAST_WAIT(best1.path.length - 1));
  const human = await api({ a: 'submit', k: T.Bravo.k, round: 'o1', route: best1.path }, from(T.Bravo.ip));
  assert.ok(human.ok);
  assert.strictEqual(human.mine.bonus, Game.SCORE.speedBonus, 'a normal hand-in still gets the speed bonus (the flagged one took no place)');
  const second = await api({ a: 'submit', k: T.Bravo.k, round: 'o1', route: best1.path }, from(T.Bravo.ip));
  assert.ok(!second.ok && /already/.test(second.err));
  hv = await host({ a: 'hend' });
  assert.strictEqual(hv.phase, 'reveal');
  const row = n => hv.teams.find(x => x.name === n);
  assert.strictEqual(row('Alpha').res.fast, true);
  assert.strictEqual(row('Bravo').res.fast, false);

  // ---- the double drop: "shortest walk" must not be the team that delivered only one order
  const iDouble = ROUNDS.findIndex(r => r.double);
  hv = await host({ a: 'hround', i: iDouble });
  assert.ok(hv.ok && hv.round.double);
  const RD = hv.round, a = Game.solve(L, RD.a, RD), b = Game.solve(L, RD.b, RD);
  await sleep(FAST_WAIT(a.meters + b.meters));
  const one = await api({ a: 'submit', k: T.Alpha.k, round: RD.id, mode: 'A', route: a.path }, from(T.Alpha.ip));
  const two = await api({ a: 'submit', k: T.Bravo.k, round: RD.id, mode: 'A', route: a.path, route2: b.path }, from(T.Bravo.ip));
  assert.ok(one.ok && two.ok && one.mine.meters < two.mine.meters);
  hv = await host({ a: 'hend' });
  assert.strictEqual(row('Alpha').res.full, false);
  assert.strictEqual(row('Bravo').res.full, true);
  const rv = await api({ a: 'state', k: T.Charlie.k });
  assert.strictEqual(rv.stats.bestMeters, two.mine.meters, 'shortest walk must be the complete delivery');
  assert.strictEqual(rv.stats.submitted, 2);
  // what the Next button works from: after replaying Order 1 the next unplayed round is Order 2, not a finished one
  assert.deepStrictEqual(hv.done, ['o1', RD.id]);

  // ---- final: the podium is hidden on the phones until the organiser reveals it, place by place
  hv = await host({ a: 'hfinal' });
  assert.ok(hv.phase === 'final' && hv.podium === 0);
  const top = hv.board.slice(0, 3).map(x => x.name);
  const keyOf = n => (T[n] || {}).k;
  const first = keyOf(top[0]), third = keyOf(top[2]);
  const outsider = Object.keys(T).find(n => top.indexOf(n) < 0);
  let v1 = await api({ a: 'state', k: first });
  assert.ok(v1.team.rank === null && v1.team.top3 === true && v1.podium === 0);
  assert.ok(v1.board.slice(0, 3).every(x => x.hid && !x.name && x.pts === null), 'the top 3 must be masked');
  assert.ok(!JSON.stringify(v1.board).includes(top[1]), 'a hidden name leaked');
  if (outsider) {
    const vo = await api({ a: 'state', k: keyOf(outsider) });
    assert.ok(vo.team.rank > 3 && !vo.team.top3);
  }
  assert.ok(!(await host({ a: 'hpodium', step: 7 })).ok);
  hv = await host({ a: 'hpodium', step: 1 });
  assert.strictEqual(hv.podium, 1);
  let v3 = await api({ a: 'state', k: third });
  assert.ok(v3.team.rank === 3 && !v3.team.top3 && v3.board[2].name === top[2] && v3.board[1].hid && v3.board[0].hid);
  v1 = await api({ a: 'state', k: first });
  assert.ok(v1.team.rank === null && v1.team.top3 === true, 'the winner is still secret after step 1');
  await host({ a: 'hpodium', step: 2 });
  hv = await host({ a: 'hpodium', step: 3 });
  assert.strictEqual(hv.podium, 3);
  v1 = await api({ a: 'state', k: first });
  assert.ok(v1.team.rank === 1 && v1.board[0].name === top[0] && !v1.board.some(x => x.hid));
  // starting a round again leaves the final screen and hides the podium for the next time
  hv = await host({ a: 'hround', i: 1 });
  assert.ok(hv.ok && hv.phase === 'order' && hv.podium === 0);
  hv = await host({ a: 'hfinal' });
  assert.strictEqual(hv.podium, 0);
});
// long enough after the order opened that a hand-in of this many steps is believable (server: 1.5 s + 0.1 s a step)
function FAST_WAIT(steps) { return 1500 + 100 * steps + 250; }

test('after a crash in the middle of an order the clock comes back paused, without losing the time the server was down', async () => {
  let hv = await host({ a: 'hround', i: 2 });
  assert.ok(hv.ok && hv.phase === 'order');
  const secs = ROUNDS[2].secs;
  await sleep(1600);                              // the save file is written about once a second
  await stopServer('SIGKILL');
  await sleep(2500);                              // the server is "down"
  await startServer();
  hv = await host({ a: 'hstate' });
  assert.ok(hv.ok, 'the organiser key must survive a restart');
  assert.strictEqual(hv.phase, 'order');
  assert.strictEqual(hv.endsAt, 0);
  assert.ok(hv.pausedLeft > secs * 1000 - 2300, 'time left came back as ' + hv.pausedLeft + ' ms: the down time was taken off');
  assert.ok(hv.pausedLeft <= secs * 1000);
  assert.ok(hv.teams.length >= 4, 'teams must survive a restart');
  hv = await host({ a: 'hpause' });
  assert.ok(hv.endsAt > Date.now() && hv.pausedLeft === 0, 'Resume must start the clock again');
});

// ---------------------------------------------------------------- the server lost everything (free cloud host)
function rawPost(p, text) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(text);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject);
    r.end(data);
  });
}
function firstEvent(key) {            // what the live stream says first to this key
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/events?k=' + key, agent: false }, res => {
      let text = '';
      res.on('data', c => { text += c; if (/event: (view|gone)/.test(text)) { r.destroy(); resolve(text); } });
      res.on('end', () => resolve(text));
    });
    r.on('error', e => { if (e.code === 'ECONNRESET') return; reject(e); });
    setTimeout(() => { r.destroy(); resolve('timeout'); }, 4000);
  });
}

test('the safety copy is for the organiser only, and never holds the organiser PIN', async () => {
  assert.strictEqual((await req('GET', '/backup')).status, 403);
  assert.strictEqual((await req('GET', '/backup?k=' + '0'.repeat(32))).status, 403);
  assert.strictEqual((await rawPost('/restore?k=' + '0'.repeat(32), '{}')).status, 403);
  const b = await req('GET', '/backup?k=' + HK);
  assert.strictEqual(b.status, 200);
  assert.ok(b.json && b.json.teams && typeof b.json.boot === 'string');
  assert.ok(b.text.indexOf(PIN) < 0 && b.text.indexOf(HK) < 0 && !('hostPin' in b.json) && !('hostKeys' in b.json));
  const bad = await rawPost('/restore?k=' + HK, '{"hello":1}');
  assert.ok(bad.json && bad.json.ok === false, 'something that is not a safety copy must be refused');
  assert.strictEqual((await host({ a: 'hstate' })).teams.length, Object.keys(b.json.teams).length, 'a refused restore must change nothing');
});

test('the server restarts EMPTY in the middle of an order: phones wait, the organiser puts the game back, everybody carries on', async () => {
  const before = await host({ a: 'hstate' });
  assert.strictEqual(before.phase, 'order');
  const copy = (await req('GET', '/backup?k=' + HK)).text;
  const game = JSON.parse(copy), ids = Object.keys(game.teams);
  const rockets = ids.map(id => game.teams[id]).find(t => t.name === 'Delta');
  const scored = ids.map(id => game.teams[id]).find(t => Object.keys(t.res).length > 0);
  assert.ok(rockets && scored);
  const oldView = await api({ a: 'state', k: scored.key });
  assert.ok(oldView.ok);

  await stopServer('SIGKILL');
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true });     // the cloud host threw the disk away
  await startServer();

  // the organiser has to sign in again, and sees an empty lobby from a new start
  assert.ok((await host({ a: 'hstate' })).badPin, 'old organiser logins are gone with the disk');
  HK = (await api({ a: 'hlogin', hp: PIN })).k;
  let hv = await host({ a: 'hstate' });
  assert.ok(hv.phase === 'lobby' && hv.teams.length === 0 && hv.boot !== before.boot);

  // phones of the old game are told to wait: not "your team is gone", which would throw them back to the join screen
  const held = await api({ a: 'state', k: scored.key });
  assert.ok(!held.ok && held.hold === true && !held.gone, 'an old phone must be held, not signed out');
  assert.ok(!/event: gone/.test(await firstEvent(scored.key)), 'the live stream must not say gone either');

  // one impatient phone joins again with its team name and PIN (an empty new team), and a stranger appears too
  const again = await api({ a: 'join', name: 'Delta', pin: '1234' });
  assert.ok(again.ok && again.created === true && again.k !== rockets.key);
  const stranger = await api({ a: 'join', name: 'Stranger', pin: '9999' });
  assert.ok(stranger.ok);

  const back = await rawPost('/restore?k=' + HK, copy);
  assert.ok(back.json && back.json.ok, 'restore failed: ' + JSON.stringify(back.json));
  assert.strictEqual(back.json.teams, ids.length);
  assert.strictEqual(back.json.paused, true, 'a running clock comes back paused');

  hv = await host({ a: 'hstate' });
  assert.ok(hv.ok, 'the organiser stays signed in after a restore');
  assert.strictEqual(hv.phase, 'order');
  assert.strictEqual(hv.ri, before.ri);
  assert.ok(hv.endsAt === 0 && hv.pausedLeft > 0 && hv.pausedLeft <= ROUNDS[before.ri].secs * 1000);
  assert.deepStrictEqual(hv.board, before.board, 'the scoreboard is exactly what it was');
  assert.deepStrictEqual(hv.done, before.done);

  // old phones carry on with the key they always had
  const now = await api({ a: 'state', k: scored.key });
  assert.ok(now.ok && now.team.name === oldView.team.name && now.team.pts === oldView.team.pts);
  assert.deepStrictEqual(now.team.layout, oldView.team.layout);
  assert.ok(/event: view/.test(await firstEvent(scored.key)));
  // the phone that joined again is on its real team, with the layout that team built
  const re = await api({ a: 'state', k: again.k });
  assert.ok(re.ok && re.team.name === 'Delta');
  assert.deepStrictEqual(re.team.layout, (await api({ a: 'state', k: rockets.key })).team.layout);
  // the stranger was not part of the game that came back
  assert.ok((await api({ a: 'state', k: stranger.k })).gone);
  // team PINs came back too
  assert.ok((await api({ a: 'join', name: 'Delta', pin: '1234' })).created === false);

  // and all of it is on disk again, with the extra key: one more plain restart keeps it
  await sleep(1600);
  await stopServer('SIGTERM');
  await startServer();
  assert.ok((await api({ a: 'state', k: again.k })).ok, 'the re-joined phone must survive a normal restart');
  assert.strictEqual((await host({ a: 'hstate' })).teams.length, ids.length);
});

test('once the organiser starts a new game, phones of an old game are told to join again', async () => {
  await stopServer('SIGKILL');
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true });
  await startServer();
  HK = (await api({ a: 'hlogin', hp: PIN })).k;
  const ghost = 'ab'.repeat(16);
  assert.ok((await api({ a: 'state', k: ghost })).hold);
  assert.ok((await host({ a: 'hlayout', secs: 60 })).ok);
  assert.ok((await api({ a: 'state', k: ghost })).gone);
  assert.ok(/event: gone/.test(await firstEvent(ghost)));
});

// ---------------------------------------------------------------- secret orders
function startWith(env, port) {       // a second server, for a moment. resolves {child, out, code}
  return new Promise(resolve => {
    const c = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { PORT: String(port), SAVE_FILE: path.join(TMP, 'other-' + port + '.json') }, env) });
    let out = '', done = false;
    const fin = code => { if (!done) { done = true; resolve({ child: c, out, code }); } };
    const seen = d => { out += d; if (/is running/.test(out)) fin(null); };
    c.stdout.on('data', seen); c.stderr.on('data', seen);
    c.on('exit', code => fin(code));
    setTimeout(() => fin('timeout'), 8000);
  });
}
test('secret orders come from outside the project; a broken set stops the server at once', async () => {
  const Orders = require('../orders.js');
  const pub = require('../rounds.js');
  const mine = JSON.parse(JSON.stringify(pub));
  mine.ROUNDS[0].title = 'Only The Organiser Knows'; mine.ROUNDS[0].items = [24, 23, 22];
  const port = PORT + 500;
  const s = await startWith({ ROUNDS_B64: Orders.encode(mine), HOST_PIN: '135790' }, port);
  try {
    assert.strictEqual(s.code, null, 'the server did not start:\n' + s.out);
    const post = body => new Promise((resolve, reject) => {
      const data = Buffer.from(JSON.stringify(body));
      const r = http.request({ host: '127.0.0.1', port, path: '/api', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, res => {
        let t = ''; res.on('data', c => t += c); res.on('end', () => resolve(JSON.parse(t)));
      });
      r.on('error', reject); r.end(data);
    });
    const k = (await post({ a: 'hlogin', hp: '135790' })).k;
    const hv = await post({ a: 'hstate', k });
    assert.strictEqual(hv.rounds[0].title, 'Only The Organiser Knows');
    assert.deepStrictEqual(hv.safety, { defaultPin: false, orders: 'secret' });
  } finally { s.child.kill('SIGKILL'); }

  const broken = JSON.parse(JSON.stringify(pub));
  broken.ROUNDS[3].items = [1, 1, 99];
  for (const bad of ['this is not base64 json', Orders.encode(broken)]) {
    const b = await startWith({ ROUNDS_B64: bad }, port + 1);
    try { assert.strictEqual(b.code, 1, 'a broken secret set must stop the server, not fall back to the public orders:\n' + b.out); }
    finally { b.child.kill('SIGKILL'); }
    assert.ok(/cannot start/.test(b.out));
  }
  // the checker itself
  assert.strictEqual(Orders.check(pub), '');
  const stuck = JSON.parse(JSON.stringify(pub));
  stuck.ROUNDS[0].blocked = ['B1', 'B2', 'B3', 'B4'];
  assert.ok(/cannot be delivered|blocked/.test(Orders.check(stuck)), Orders.check(stuck));
});
