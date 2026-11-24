// DARK STORE BLITZ - picks the set of orders the server plays, and checks it.
//
// rounds.js is in the project folder (and on GitHub), so anybody can read it: it is the PRACTICE set.
// The real competition orders are kept out of the project. The server looks for them in this order:
//   1. ROUNDS_B64   an environment variable holding the whole set (used on Render: set it in the dashboard)
//   2. ROUNDS_FILE  an environment variable with the path of a file like rounds.js
//   3. rounds.secret.js   next to server.js (never uploaded: it is in .gitignore)
//   4. rounds.js    the public practice set
// To make the value for Render from rounds.secret.js:   node tools/secret-orders.js
'use strict';
const fs = require('fs'), path = require('path');
const Game = require('./game.js');

const WALK = id => Game.validCell(id) && Game.kindOf(id) === 'walk';
const isInt = Number.isInteger;

// Returns a problem in words, or '' when the set is fine. The server refuses to start with a broken secret set:
// better to find out at start-up than in the middle of an order.
function check(d) {
  if (!d || typeof d !== 'object') return 'it is not a set of orders';
  if (!(Number(d.LAYOUT_MINUTES) * 60 >= 30 && Number(d.LAYOUT_MINUTES) * 60 <= 3600)) return 'LAYOUT_MINUTES must be between 0.5 and 60';
  if (!d.SOLD || typeof d.SOLD !== 'object') return 'SOLD is missing';
  for (const p of Game.PRODUCTS) if (!(isInt(d.SOLD[p.n]) && d.SOLD[p.n] > 0)) return 'SOLD has no figure for product ' + p.n;
  if (!Array.isArray(d.ROUNDS) || d.ROUNDS.length < 1 || d.ROUNDS.length > 40) return 'ROUNDS must be a list of 1 to 40 orders';
  const ids = new Set(), labels = new Set();
  for (const R of d.ROUNDS) {
    if (!R || typeof R !== 'object') return 'an order is empty';
    const tag = 'order ' + R.id + ': ';
    if (typeof R.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(R.id)) return 'an order has a bad id';
    if (ids.has(R.id)) return tag + 'the id is used twice';
    ids.add(R.id);
    if (typeof R.label !== 'string' || !R.label || R.label.length > 30) return tag + 'bad label';
    if (labels.has(R.label)) return tag + 'the label is used twice';
    labels.add(R.label);
    if (typeof R.title !== 'string' || !R.title || R.title.length > 40) return tag + 'bad title';
    if (!isInt(R.secs) || R.secs < 30 || R.secs > 3600) return tag + 'secs must be 30 to 3600';
    if (R.stage !== 2 && R.stage !== 3) return tag + 'stage must be 2 or 3';
    if (R.crisis !== undefined && (typeof R.crisis !== 'string' || R.crisis.length > 200)) return tag + 'bad crisis line';
    const lists = R.double ? [R.a, R.b] : [R.items];
    if (R.double ? R.items !== undefined : (R.a !== undefined || R.b !== undefined)) return tag + 'use items, or (for a double drop) a and b';
    const all = [];
    for (const l of lists) {
      if (!Array.isArray(l) || l.length < 1 || l.length > 8) return tag + 'needs 1 to 8 items';
      for (const n of l) { if (!isInt(n) || n < 1 || n > 24) return tag + 'no such product: ' + n; all.push(n); }
    }
    if (new Set(all).size !== all.length) return tag + 'lists a product twice';
    if (all.length > 12) return tag + 'has too many items';
    if (R.blocked !== undefined) {
      if (!Array.isArray(R.blocked) || !R.blocked.length || !R.blocked.every(WALK)) return tag + 'blocked must be walkway squares';
      if (new Set(R.blocked).size !== R.blocked.length) return tag + 'blocks a square twice';
    }
    if (R.oneWay !== undefined && R.oneWay !== true) return tag + 'oneWay can only be true';
    if (R.double !== undefined && R.double !== true) return tag + 'double can only be true';
    if (R.mult !== undefined && !(isInt(R.mult) && R.mult >= 1 && R.mult <= 5)) return tag + 'mult must be 1 to 5';
    for (const k of Object.keys(R)) {
      if (!['id', 'stage', 'label', 'title', 'items', 'a', 'b', 'secs', 'oneWay', 'blocked', 'double', 'mult', 'crisis'].includes(k)) return tag + 'unknown setting "' + k + '"';
    }
    // every order must be deliverable: with every product on a shelf, the solver has to find a route
    const full = {};
    let n = 0;
    for (let r = 0; r < 10 && n < 24; r++) for (let c = 1; c <= 10 && n < 24; c++) {
      const id = Game.cid(r, c);
      if (Game.placeable(id)) full[id] = { p: ++n, l: 'M' };
    }
    let best = null;
    try { best = Game.bestFor(R, full); } catch (e) { best = null; }
    if (!best) return tag + 'cannot be delivered (check the blocked squares)';
  }
  return '';
}

// Only the plain data is kept: a round object is sent to phones as JSON, so it must carry nothing else.
function plain(d) { return JSON.parse(JSON.stringify({ LAYOUT_MINUTES: Number(d.LAYOUT_MINUTES), SOLD: d.SOLD, ROUNDS: d.ROUNDS })); }

function encode(d) { return Buffer.from(JSON.stringify(plain(d)), 'utf8').toString('base64'); }

// -> { set: 'secret' | 'practice', from: where it came from, data: {LAYOUT_MINUTES, SOLD, ROUNDS} }
// Throws (with a message in plain words) when a secret set was given but is broken.
function load(env, dir) {
  env = env || process.env; dir = dir || __dirname;
  let data = null, from = '';
  if (env.ROUNDS_B64 && String(env.ROUNDS_B64).trim()) {
    from = 'ROUNDS_B64';
    try { data = JSON.parse(Buffer.from(String(env.ROUNDS_B64).trim(), 'base64').toString('utf8')); }
    catch (e) { throw new Error('The secret orders in ROUNDS_B64 could not be read. Copy the value again from render-secrets.txt (all of it, one line).'); }
  } else {
    const file = path.resolve(dir, env.ROUNDS_FILE || 'rounds.secret.js');
    if (env.ROUNDS_FILE || fs.existsSync(file)) {
      from = path.basename(file);
      try { data = require(file); } catch (e) { throw new Error('The secret orders in ' + from + ' could not be read: ' + e.message); }
    }
  }
  if (data) {
    const err = check(data);
    if (err) throw new Error('The secret orders (' + from + ') are not right: ' + err + '.');
    return { set: 'secret', from, data: plain(data) };
  }
  const pub = require(path.resolve(dir, 'rounds.js')), err = check(pub);
  if (err) throw new Error('rounds.js is not right: ' + err + '.');
  return { set: 'practice', from: 'rounds.js', data: plain(pub) };
}

module.exports = { check, load, encode };
