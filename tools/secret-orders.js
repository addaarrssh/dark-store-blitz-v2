// DARK STORE BLITZ - checks the secret orders and writes the two values Render needs.
//   node tools/secret-orders.js
// Reads rounds.secret.js, checks every order can be delivered, and writes render-secrets.txt (never uploaded):
//   HOST_PIN     the organiser PIN (made once, kept on later runs)
//   ROUNDS_B64   the secret orders, packed into one line
// Paste both into Render: Dashboard > dark-store-blitz > Environment. Saving them restarts the server, so do it
// BEFORE the competition, never during it.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Orders = require('../orders.js');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'rounds.secret.js'), OUT = path.join(ROOT, 'render-secrets.txt');

if (!fs.existsSync(SRC)) { console.error('\n  rounds.secret.js is missing. Copy rounds.js to rounds.secret.js and change the orders in it.\n'); process.exit(1); }
let data;
try { data = require(SRC); } catch (e) { console.error('\n  rounds.secret.js could not be read: ' + e.message + '\n'); process.exit(1); }
const err = Orders.check(data);
if (err) { console.error('\n  rounds.secret.js is not right: ' + err + '.\n'); process.exit(1); }

const pub = require(path.join(ROOT, 'rounds.js'));
const sig = R => JSON.stringify(R.double ? [R.a, R.b] : R.items);
const same = data.ROUNDS.filter(R => pub.ROUNDS.some(P => sig(P) === sig(R))).map(R => R.label);

let pin = '';
try { const m = /^HOST_PIN=(\d{6,12})\s*$/m.exec(fs.readFileSync(OUT, 'utf8')); if (m) pin = m[1]; } catch (e) {}
const fresh = !pin;
if (fresh) pin = String(crypto.randomInt(10000000, 100000000));        // 8 digits

fs.writeFileSync(OUT, [
  '# Dark Store Blitz - secrets for Render. Keep this file to yourself (it is not uploaded to GitHub).',
  '# Render dashboard > dark-store-blitz > Environment > add both, then Save. Do it before the competition:',
  '# saving restarts the server.',
  '',
  'HOST_PIN=' + pin,
  '',
  'ROUNDS_B64=' + Orders.encode(data),
  ''
].join('\n'), { mode: 0o600 });

console.log('\n  The secret orders are fine: ' + data.ROUNDS.length + ' orders, every one can be delivered.');
if (same.length) console.log('  WARNING: these orders ask for exactly the same products as a public practice order: ' + same.join(', ') + '.');
console.log('  Wrote render-secrets.txt' + (fresh ? ' with a new organiser PIN.' : ' (the organiser PIN in it was kept).'));
console.log('  Open it, and paste HOST_PIN and ROUNDS_B64 into Render > Environment.\n');
