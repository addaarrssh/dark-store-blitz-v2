/* DARK STORE BLITZ - player.js : the phone screen.
   Everything is drawn from the PLAYER VIEW the server sends (Kit.connect -> onView). The map, the top bar and the
   timer are built once and only patched; the other regions are re-drawn only when their own HTML really changed. */
(function () {
  'use strict';
  var G = window.Game, K = window.Kit;
  if (!G || !K) return;
  var esc = K.esc;
  function $(id) { return document.getElementById(id); }

  var keyStore = K.store('dsb_team');        // {k, name}
  var nameStore = K.store('dsb_teamname');   // {name} kept after "gone" so joining again is quick
  var draftStore = K.store('dsb_draft');     // the route being drawn for the running order
  var rankStore = K.store('dsb_rank');       // {k, i}: the corps rank this phone last showed for the team

  var me = null;          // {k, name}
  var conn = null;        // Kit.connect handle
  var V = null;           // newest view
  var status = '';
  var map = null, demoMap = null, demoTok = 0, demoT = 0;
  var no3d = false, map3d = null;       // the 3D map: only for the route replay on the result screen (Kit3D), never for tapping
  var cache = {};         // region id -> last html
  var ui = { sheet: null, sel: null, pick: null, pickNext: null, msgHid: 0, just: 0, newTeam: null };
  var pend = [];          // layout changes sent but not confirmed yet
  var D = null;           // route draft {id, k, mode, trip, r:{a,b,c}, m:{a,b,c}}
  var seenGot = {}, lastCtx = '', seenForce = false, seenT = 0;
  var sending = false, armed = false, armT = 0;
  var lastRouteSig = null;
  var rvKey = '', rvTok = 0, rvDone = false, rvCounted = '';
  var boardSig = '';
  var flags = { soon: false, urgent: false };
  var scShown = null, finalFx = false, finalWin = false, clockH = null;
  var wake = null, wakeBusy = false;      // the screen wake lock (keeps the phone awake while the team is in the game)
  var traceT = 0, traceSig = '', traceAt = 0, promoT = 0;

  // ------------------------------------------------------------------ small helpers
  function setHtml(id, html) {
    if (cache[id] === html) return false;
    cache[id] = html;
    $(id).innerHTML = html;
    return true;
  }
  function show(id, on) { var e = $(id); if (e.hidden === !on) return; e.hidden = !on; }
  function lvName(l) { return (G.LEVELS[l] || String(l || '')).toLowerCase(); }
  function copyLayout(L) { var o = {}, k; for (k in L) if (Object.prototype.hasOwnProperty.call(L, k)) o[k] = L[k]; return o; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function signed(n) { return (n > 0 ? '+' : '−') + Math.abs(n); }

  // the layout as this phone should show it: the server's layout plus changes still on their way
  function eff(v) {
    var L = v.team.layout || {};
    if (!pend.length) return L;
    var o = copyLayout(L), i, op, old;
    for (i = 0; i < pend.length; i++) {
      op = pend[i];
      if (op.t === 'remove') delete o[op.cell];
      else { old = G.where(o, op.p); if (old) delete o[old]; o[op.cell] = { p: op.p, l: op.l }; }
    }
    return o;
  }
  // squares that got a penalty. Only for the screen AFTER the layouts are locked: while teams are still placing,
  // the phone must never say whether a placement is right or wrong (the organiser explains the rules once).
  function warnCells(L) {
    var out = [], c, one, e, a, q1, q2;
    for (c in L) { one = {}; one[c] = L[c]; if (G.penalties(one).length) out.push(c); }
    e = G.where(L, 6); a = G.where(L, 9);
    if (e && a) {
      q1 = G.rc(e); q2 = G.rc(a);
      if (Math.abs(q1[0] - q2[0]) + Math.abs(q1[1] - q2[1]) === 1) { if (out.indexOf(e) < 0) out.push(e); if (out.indexOf(a) < 0) out.push(a); }
    }
    return out;
  }
  // ------------------------------------------------------------------ the rules
  // The FULL rules (placing rules + penalty list) are only shown in the lobby. Once Round 1 has started the same button
  // opens helpHtml() instead, so no team gets coached by its phone while it plays.
  function rsec(icon, title, body, cls) {
    return '<section class="rb' + (cls ? ' ' + cls : '') + '"><h3><i>' + icon + '</i><span>' + title + '</span></h3>' + body + '</section>';
  }
  function rlist(items) { return '<ul>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
  function rulesHtml() {
    var P = G.PENALTY;
    return '<div class="rules">' +
      rsec('🏪', 'The job', '<p>You run a tiny dark store. First your team decides where all 24 products go. Then orders come in: walk from <b>START (A3)</b>, collect the items, walk back to START. <b>Less walking, more points.</b></p>', 'lead') +
      rsec('📦', 'Round 1 · stock your store', rlist([
        'One product per shelf square. Pick a level: <b>top</b>, <b>middle</b> or <b>bottom</b>.',
        'Cold items go in <b>J1 to J3</b> only.',
        'Chemicals go in <b>J8 to J10</b> only. No food there.',
        'Atta is heavy: <b>bottom level</b>.',
        'Fragile items <b>never</b> on the bottom level.',
        'Eggs must <b>not</b> sit next to Atta.',
        'A product you leave out makes every order with it score <b>0</b>.',
        'Everyone in your team can place at the same time. The store is shared.'])) +
      rsec('⚠️', 'Layout penalties', '<ul class="pts">' + [
        ['Cold item outside J1 to J3', P.cold], ['Chemical outside J8 to J10', P.chemical], ['Food in the chemical zone', P.foodInChem],
        ['Atta not on the bottom', P.heavy], ['Fragile item on the bottom', P.fragile], ['Eggs next to Atta', P.eggsAtta]
      ].map(function (x) { return '<li><span>' + x[0] + '</span><b>−' + x[1] + '</b></li>'; }).join('') +
        '</ul><p class="note">Counted once, when the layouts lock. They add up.</p>', 'warnsec') +
      playHtml() +
      '<p class="rules-once"><b>Read these now.</b> Once Round 1 starts, your phone does not show the placing rules or the penalties again, and it does not warn you about a wrong shelf.</p></div>';
  }
  // walking, points, bounty, ranks, surprises, showdown: the same text in the rules and in the help
  function playHtml() {
    var S = G.SCORE, R = (V && V.rules) || {}, n = R.duelSize || 4, out = '';
    out += rsec('🏃', 'Orders · walking', rlist([
      'Tap a walkway square to walk there. Tap a shelf to walk next to it.',
      'Walk only on walkway squares, never through shelves.',
      'Every trip starts and ends at <b>START (A3)</b>. One square = <b>1 meter</b>.',
      'Stand on a walkway square that touches a shelf to pick its item. Picking is free.',
      'Your team hands in <b>once</b> per order. Any teammate can do it.']));
    out += rsec('🧮', 'Points', '<ul class="pts">' +
      '<li><span>Each order</span><b>' + S.base + ' − ' + S.perMeter + ' × meters</b></li>' +
      '<li><span>Fast hand-in (first few teams)</span><b>+' + S.speedBonus + '</b></li>' +
      '<li><span>Perfect route (shortest your store allows)</span><b>+' + S.perfectBonus + '</b></li>' +
      (R.bounty ? '<li><span>Beat the leader on an order</span><b>+' + R.bounty + '</b></li>' : '') +
      '</ul><p class="note">Tie? The team that walked less in total wins.</p>');
    if (R.bounty) out += rsec('🎯', 'Bounty on the leader', '<p>The team in <b>1st place</b> when an order starts carries a bounty. Every team that beats the leader\'s score on that order gets <b>+' + R.bounty + '</b>' +
      (R.bountyCounts === false ? ' as a badge of honour (it does not change the ranking)' : '') + '. Your phone shows who the leader is when the order starts.</p>');
    out += rsec('🎖️', 'Corps ranks', '<p>As your points grow, your phone promotes your team through the ranks of the Demon Slayer Corps:</p><p class="ranks">' +
      RANKS.map(function (r, i) { return '<span' + (i === RANKS.length - 1 ? ' class="h"' : '') + '>' + r + '</span>'; }).join('') + '</p>');
    out += rsec('🌪️', 'Surprises', rlist(['Later orders bring trouble: one-way aisles, blocked squares, two orders at once. The screen tells you what changed.',
      'The final boss order is worth <b>double</b> points.']));
    if (R.showdown) out += rsec('⚔️', 'Top-' + n + ' showdown', '<p>After the last order, the <b>top ' + n + '</b> teams play one extra order alone, with every step drawn live on the big screen. ' +
      (R.showdown === 'title' ? '<b>Its result decides the title</b> and the order of the top ' + n + '.' : 'Its points add to your total.') + ' Everyone else watches.</p>', 'duelsec');
    return out;
  }
  // Help while the game runs: how to use the screen, walking and points. NO placement rules, NO penalty list.
  function helpHtml() {
    return '<div class="rules">' + rsec('📱', 'This screen', rlist([
      'Round 1: tap a shelf square, choose the product, then the level. Tap a product in the list to find it or move it.',
      'Orders: the pink shelves hold the items you need. The list shows the shelf and the level of each one.',
      'Undo takes back your last tap. Clear wipes the whole route. Undo right after a Clear brings it back.'])) + playHtml() + '</div>';
  }
  function adjHtml(adj) {
    if (!adj || !adj.length) return '';
    return '<p><b>From the organiser:</b></p><ul class="pens">' + adj.map(function (x) {
      return '<li><b>' + signed(x.pts) + '</b> ' + esc(x.why || 'points adjustment') + '</li>';
    }).join('') + '</ul>';
  }
  function billHtml(title, items, L, pk) {
    var n = 0, many = items.length > 5, rows = items.map(function (p) {
      var prod = G.product(p), w = G.where(L, p), ok = !!(pk && pk[p]);
      if (ok) n++;
      return '<li class="' + (ok ? 'ok' : '') + (w ? '' : ' miss') + (ok && ui.just === p ? ' justgot' : '') + '"><span>' + (ok ? '✔ ' : '') + prod.emoji + ' ' + esc(prod.name) +
        '</span><span>' + (w ? w + ' ' + (many ? String(L[w].l) : lvName(L[w].l)) : (many ? 'none' : 'not stocked')) + '</span></li>';
    }).join('');
    return '<div class="bill' + (many ? ' many' : '') + '">' + (pk ? '<span class="cnt">' + n + '/' + items.length + ' picked</span>' : '') + '<h2>' + esc(title) + '</h2><ul>' + rows + '</ul></div>';
  }
  function namesOf(list) { return list.map(function (p) { return esc(G.product(p).name); }).join(', '); }

  // ------------------------------------------------------------------ corps ranks (phone only: the team's points decide them)
  var RANKS = ['Mizunoto', 'Mizunoe', 'Kanoto', 'Kanoe', 'Tsuchinoto', 'Tsuchinoe', 'Hinoto', 'Hinoe', 'Kinoto', 'Kinoe', 'Hashira'];
  var RANK_AT = [0, .03, .07, .12, .18, .25, .33, .42, .52, .63, .76];    // share of "about 100 points per order"
  var rankSeen = -1;                                                      // the rank this phone has shown (promotions wait for the reveal)
  function rankSteps(v) {
    var n = (v && v.rules && v.rules.orders) || (v && v.roundCount) || 10;
    return RANK_AT.map(function (f) { return Math.round(f * n * 100); });
  }
  function rankOf(v) { var s = rankSteps(v), p = v.team.pts, i = 0; while (i + 1 < s.length && p >= s[i + 1]) i++; return i; }
  function shownRank(v) { var i = rankOf(v); return rankSeen >= 0 ? Math.min(rankSeen, i) : i; }
  function rankHtml(v) {
    var s = rankSteps(v), i = shownRank(v), top = i === RANKS.length - 1, p = v.team.pts;
    var pct = top ? 100 : Math.max(0, Math.min(100, Math.round((p - s[i]) / Math.max(1, s[i + 1] - s[i]) * 100)));
    return '<div class="rank' + (top ? ' hashira' : '') + '"><span class="rank-k">Corps rank ' + (i + 1) + ' of ' + RANKS.length + '</span><b>' + RANKS[i] + '</b>' +
      '<div class="rank-bar"><i style="width:' + pct + '%"></i></div>' +
      '<span class="rank-n">' + (top ? 'The highest rank in the corps.' : Math.max(1, s[i + 1] - p) + ' more points to ' + RANKS[i + 1]) + '</span></div>';
  }
  function checkRank(v) {
    if (!me || !v || !v.team) return;
    var i = rankOf(v), s = rankStore.get(), was = s && s.k === me.k && typeof s.i === 'number' ? s.i : -1;
    if (was < 0 || i < was) { rankStore.set({ k: me.k, i: i }); rankSeen = i; return; }     // first view, or points went down: no fuss
    rankSeen = was;
    if (i === was || v.phase === 'order' || v.phase === 'layout' || v.phase === 'lobby') return;   // promotions wait until the order is over
    rankStore.set({ k: me.k, i: i }); rankSeen = i;
    promote(i);
  }
  function promote(i) {
    var box = $('promo'), top = i === RANKS.length - 1, pips = '', j;
    for (j = 0; j < RANKS.length; j++) pips += '<i class="' + (j < i ? 'on' : j === i ? 'now' : '') + '"></i>';
    box.innerHTML = '<div class="promo-in"><p class="promo-k">' + (top ? 'Hashira!' : 'Promoted') + '</p><p class="promo-r">' + RANKS[i] + '</p>' +
      '<p class="promo-s">' + (top ? 'Your team reached the highest rank of the Demon Slayer Corps.' : 'Rank ' + (i + 1) + ' of ' + RANKS.length + ' in the Demon Slayer Corps') + '</p>' +
      '<div class="promo-pips">' + pips + '</div><p class="promo-t">Tap to continue</p></div>';
    box.className = 'promo' + (top ? ' hashira' : '');
    box.hidden = false;
    K.sound(top ? 'fanfare' : 'done');
    K.vibrate(top ? [100, 60, 100, 60, 300] : [80, 50, 120]);
    K.confetti({ count: top ? 220 : 80, ms: top ? 3600 : 2200 });
    clearTimeout(promoT);
    promoT = setTimeout(hidePromo, top ? 5200 : 3400);
  }
  function hidePromo() { clearTimeout(promoT); var b = $('promo'); if (b) b.hidden = true; }

  // ------------------------------------------------------------------ bounty + showdown
  function huntHtml(v) {
    var H = v.hunt, R = v.round, pts = v.rules && v.rules.bounty;
    if (!H || !R || R.showdown || !pts) return '';
    return '<div class="hunt' + (H.me ? ' me' : '') + '"><b>🎯</b><span>' + (H.me ? '<b>Bounty on you!</b> Every team that beats your score on this order gets +' + pts + '.'
      : 'Bounty on <b>' + esc(H.target) + '</b>. Beat their score on this order: <b>+' + pts + '</b>') + '</span></div>';
  }
  function duelWatchHtml(v) {
    var names = (v.duel && v.duel.names) || [];
    return '<div class="card dark duelwatch a-pop"><p class="dw-k">⚔️ Showdown</p><h2>The top ' + names.length + ' are racing</h2><ol class="dw-list">' +
      names.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ol><p>Every step they take is drawn live on the big screen. Look up!</p></div>';
  }
  function orderToast(v) {
    if (v.round && v.round.showdown && v.duel && v.duel.in) K.toast('⚔️ You made the top ' + v.duel.names.length + '! Every step you take is live on the big screen.', 'ok');
    else if (v.hunt && v.hunt.me) K.toast('🎯 You lead. Every team is hunting you this order!', 'bad');
  }
  // Showdown: the route being walked goes to the server (a few times a second at most) so the big screens draw it live.
  function pushTrace() {
    if (traceT) return;
    traceT = setTimeout(function () {
      traceT = 0;
      var v = V;
      if (!conn || !v || v.phase !== 'order' || !v.round || !v.round.showdown || !v.duel || !v.duel.in || v.mine || !D || D.id !== v.round.id) return;
      var rt = D.r.a, sig = v.round.id + ':' + rt.join(',');
      if (sig === traceSig && Date.now() - traceAt < 4000) return;
      traceSig = sig; traceAt = Date.now();
      conn.send({ a: 'trace', round: v.round.id, route: rt }).then(function (r) { if (r && r.net) traceSig = ''; });
    }, 150);
  }

  // ------------------------------------------------------------------ keep the phone awake
  // Screen Wake Lock: while this phone is in a team and the page is showing, the screen must not dim or lock (teams
  // talk for a minute and the phone would fall asleep and drop off the game). The browser takes the lock away when the
  // page is hidden, so it is asked for again when the page comes back and on every tap (some browsers want a tap first).
  // Where the browser cannot do it (older iPhones, Firefox) nothing happens and nothing breaks.
  function wakeSync() {
    var want = !!me && document.visibilityState !== 'hidden', w, p;
    if (!want) {
      if (wake) { w = wake; wake = null; try { p = w.release(); if (p && p.then) p.then(null, function () {}); } catch (e) {} }
      return;
    }
    if (wake || wakeBusy) return;
    try {
      if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
      p = navigator.wakeLock.request('screen');
    } catch (e) { return; }
    if (!p || !p.then) return;
    wakeBusy = true;
    p.then(function (lock) {
      wakeBusy = false;
      wake = lock;
      try { lock.addEventListener('release', function () { if (wake === lock) wake = null; }); } catch (e) {}
      wakeSync();                    // the team may have left, or the page gone away, while the browser was answering
    }, function () { wakeBusy = false; });        // refused (battery saver, no tap yet...): the next tap tries again
  }

  // ------------------------------------------------------------------ join
  function showJoin(note) {
    if (conn) { conn.close(); conn = null; }
    V = null; me = null; D = null; pend = []; sending = false;
    hidePromo();
    wakeSync();
    ui.sheet = null; ui.sel = null; renderSheet();
    demoOn(false); drop3d();
    show('app', false); show('wait', false); show('join', true);
    var n = $('joinNote');
    n.textContent = note || ''; n.hidden = !note;
    var last = nameStore.get();
    if (last && last.name && !$('jName').value) $('jName').value = last.name;
    $('jBtn').disabled = false;
  }
  function joinNote(text) { var n = $('joinNote'); n.textContent = text; n.hidden = false; n.classList.remove('a-shake'); void n.offsetWidth; n.classList.add('a-shake'); }
  function onJoin(ev) {
    ev.preventDefault();
    var name = $('jName').value.replace(/\s+/g, ' ').trim(), pin = $('jPin').value.replace(/\D/g, ''), btn = $('jBtn');
    if (btn.disabled) return;
    if (name.length < 2) return joinNote('Type a team name with at least 2 letters.');
    if (pin.length !== 4) return joinNote('The team PIN must be exactly 4 digits.');
    btn.disabled = true; btn.textContent = 'Joining…';
    K.post({ a: 'join', name: name, pin: pin }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Join the game';
      if (!r.ok || !r.k) return joinNote(r.err || 'That did not work. Try again.');
      $('jPin').value = '';
      var m = { k: r.k, name: r.name || name };
      if (!keyStore.set(m)) K.toast('This phone cannot remember your team. Do not close this page.', 'bad');
      nameStore.set({ name: m.name });
      // a typo in the team name silently makes a brand-new team, so always say which of the two happened
      ui.newTeam = r.created === true ? m.name : null;
      start(m);
      if (r.created === false) K.toast('You joined team ' + m.name + '. ' + plural((r.devices || 0) + 1, 'phone is', 'phones are') + ' connected now.', 'ok');
    });
  }

  // ------------------------------------------------------------------ connection
  function start(m) {
    me = m; V = null; cache = {}; scShown = null; boardSig = ''; rvKey = ''; finalFx = false; lastRouteSig = null; lastCtx = '';
    rankSeen = -1; traceSig = '';
    $('board').innerHTML = '';
    show('join', false); show('app', false); show('wait', true);
    $('wait').textContent = 'Connecting…';
    conn = K.connect({ key: m.k, role: 'player', onView: onView, onStatus: onStatus, onGone: onGone });
    wakeSync();
  }
  function onGone() {
    conn = null;
    keyStore.clear();
    showJoin('Your team is not in the game any more. The organiser removed it or started a new game. Join again.');
  }
  function onStatus(s) {
    status = s;
    var c = $('conn'), strip = $('strip');
    c.className = 'conn ' + (s === 'live' ? 'live' : s === 'polling' ? 'polling' : 'offline');
    c.setAttribute('aria-label', s === 'live' ? 'connected' : s === 'polling' ? 'reconnecting' : 'offline');
    if (s === 'live') strip.hidden = true;
    else {
      strip.hidden = false;
      strip.className = 'strip' + (s === 'polling' ? ' polling' : '');
      strip.textContent = s === 'polling' ? 'Reconnecting… you can keep playing.' : 'No connection. Check the Wi-Fi. This screen shows the last thing it received.';
    }
    if (!V) $('wait').textContent = s === 'offline' ? 'Cannot reach the game. Check you are on the same Wi-Fi as the organiser.' : 'Connecting…';
  }
  function onView(v) {
    if (!v || !v.team) return;
    var prev = V;
    V = v;
    changes(prev, v);
    checkRank(v);
    if (!prev) { show('wait', false); show('app', true); }
    render();
  }
  function changes(prev, v) {
    var pr = prev ? prev.phase : null, rid = v.round ? v.round.id : null, prid = prev && prev.round ? prev.round.id : null;
    if (pr !== v.phase || rid !== prid) {
      if (ui.sheet === 'place') ui.sheet = null;
      // a new order (or Round 1) must never start hidden behind the Rules / Help sheet
      // (and a result, or the locked layout with its penalties, must not arrive hidden behind it either)
      if (ui.sheet && prev) {
        ui.sheet = null;
        if (v.phase === 'order' || v.phase === 'layout') K.toast((v.phase === 'order' && v.round ? v.round.label : 'Round 1') + ' has started.');
      }
      ui.sel = null; ui.pick = null; ui.pickNext = null;
      armed = false; sending = false;
      if (v.phase !== 'layout') pend = [];
      if (prev) { try { window.scrollTo(0, 0); } catch (e) {} }
    }
    if (v.phase !== 'final') { finalFx = false; finalWin = false; }
    if (!prev) return;
    if (v.phase === 'order' && (pr !== 'order' || rid !== prid)) { K.vibrate([150, 70, 150]); K.sound(v.round && v.round.crisis ? 'buzzer' : 'pop'); orderToast(v); }
    else if (v.phase === 'reveal' && pr === 'order') { K.sound('buzzer'); K.vibrate(250); }
    else if (v.phase === 'locked' && pr === 'layout') { K.sound('buzzer'); K.vibrate(250); }
    else if (v.phase === 'layout' && pr === 'lobby') { K.sound('pop'); K.vibrate(150); }
    if (v.phase === 'order' && pr === 'order' && rid === prid) {
      if (v.mine && !prev.mine && !sending) K.toast('A teammate handed in for your team.', 'ok');
      if (!v.mine && prev.mine) K.toast('Your hand-in was cleared. You can walk this order again.');
    }
    if (v.msg && (!prev.msg || prev.msg.at !== v.msg.at)) { K.vibrate(80); K.sound('pop'); }
    var a0 = prev.team && prev.team.adj ? prev.team.adj.length : 0, a1 = v.team.adj ? v.team.adj.length : 0, x;
    if (a1 > a0) { x = v.team.adj[a1 - 1]; K.toast('The organiser gave your team ' + signed(x.pts) + ' points' + (x.why ? ': ' + x.why : '.'), x.pts > 0 ? 'ok' : 'bad'); }
  }

  // ------------------------------------------------------------------ the route draft (lives on this phone, survives a refresh)
  function okRoute(rt, R) {
    if (!Array.isArray(rt) || !rt.length || rt.length > 400 || rt[0] !== G.START) return false;
    for (var i = 1; i < rt.length; i++) if (!G.validCell(rt[i]) || G.steps(rt[i - 1], R).indexOf(rt[i]) < 0) return false;
    return true;
  }
  function okMarks(m, len) {
    if (!Array.isArray(m)) return [];
    var out = [], last = 0, i;
    for (i = 0; i < m.length; i++) {
      if (typeof m[i] !== 'number' || m[i] % 1 || m[i] <= last || m[i] >= len) return [];
      out.push(m[i]); last = m[i];
    }
    return out;
  }
  function draftFor(R, L) {
    if (D && D.id === R.id && D.k === me.k) return D;
    var s = draftStore.get(), keys = ['a', 'b', 'c'], i, x, rt;
    D = { id: R.id, k: me.k, mode: null, trip: 0, r: { a: [G.START], b: [G.START], c: [G.START] }, m: { a: [], b: [], c: [] }, cleared: null };
    if (s && s.id === R.id && s.k === me.k && s.r && typeof s.r === 'object') {
      if (R.double && (s.mode === 'A' || s.mode === 'B')) D.mode = s.mode;
      if (D.mode === 'B' && G.missing(R.a.concat(R.b), L).length) D.mode = null;
      D.trip = s.trip === 1 ? 1 : 0;
      for (i = 0; i < keys.length; i++) {
        x = keys[i]; rt = s.r[x];
        if (okRoute(rt, R)) { D.r[x] = rt.slice(); D.m[x] = okMarks(s.m && s.m[x], rt.length); }
      }
      x = s.cleared;                 // the route that Clear wiped last (Undo brings it back)
      if (x && keys.indexOf(x.key) >= 0 && okRoute(x.r, R) && x.r.length > 1) D.cleared = { key: x.key, r: x.r.slice(), m: okMarks(x.m, x.r.length) };
    }
    return D;
  }
  function saveDraft() { if (D) draftStore.set(D); }
  function curKey(R, d) { return !R.double ? 'a' : d.mode === 'B' ? 'c' : d.trip ? 'b' : 'a'; }
  function curItems(R, d) { return !R.double ? R.items : d.mode === 'B' ? R.a.concat(R.b) : d.trip ? R.b : R.a; }

  // ------------------------------------------------------------------ the top bar, message, timers
  function renderTop(v) {
    var who = $('who'), sc = $('sc'), lobbyish = v.phase === 'lobby' || v.phase === 'layout';
    if (who.textContent !== v.team.name) who.textContent = v.team.name;
    sc.hidden = lobbyish;
    if (lobbyish) scShown = null;
    else if (scShown === null) { sc._kitNum = v.team.pts; sc.textContent = v.team.pts + ' pts'; scShown = v.team.pts; }
    else if (scShown !== v.team.pts) { scShown = v.team.pts; K.countUp(sc, v.team.pts, { suffix: ' pts', ms: 900 }); }
    var rk = $('rk'), ri = shownRank(v), rn = lobbyish ? '' : '🎖 ' + RANKS[ri], rcl = 'rk' + (ri === RANKS.length - 1 ? ' hashira' : '');
    rk.hidden = lobbyish;
    if (rk.textContent !== rn) rk.textContent = rn;
    if (rk.className !== rcl) rk.className = rcl;
    var q = $('qBtn'), qt = v.phase === 'lobby' ? 'Rules' : 'Help';
    if (q.textContent !== qt) q.textContent = qt;
    var pz = v.pausedLeft > 0;
    $('pz').hidden = !pz;
    if (pz) $('hdr').classList.add('is-paused'); else $('hdr').classList.remove('is-paused');
    var m = $('msg'), on = !!(v.msg && v.msg.text && ui.msgHid !== v.msg.at);
    m.hidden = !on;
    if (on && setHtml('msg', esc(v.msg.text) + '<small>From the organiser. Tap to hide.</small>')) { m.classList.remove('a-flash'); void m.offsetWidth; m.classList.add('a-flash'); }
    if (!on) cache.msg = null;
  }
  function tickFlags() {
    if (!V) return;
    var left = K.timeLeft(V), paused = V.pausedLeft > 0;
    var soon = left != null && !paused && left <= 30000 && (V.phase === 'order' || V.phase === 'layout');
    var urgent = V.phase === 'layout' && left != null && left <= 120000;
    if (soon !== flags.soon) { flags.soon = soon; if (soon) $('tm').classList.add('soon'); else $('tm').classList.remove('soon'); }
    if (urgent !== flags.urgent) { flags.urgent = urgent; render(); }
  }

  // ------------------------------------------------------------------ lobby demo (a tiny map with the picker walking in a loop)
  function demoOn(on) {
    if (on && !demoMap) {
      // The demo order matches no real order, and its route is written out here: phones are not sent the route solver.
      var box = $('demoBox'), L = { C4: { p: 5, l: 'M' }, E7: { p: 11, l: 'T' }, D2: { p: 21, l: 'M' } }, items = [5, 11, 21], tok;
      var path = ['A3', 'B3', 'C3', 'D3', 'C3', 'B3', 'B4', 'B5', 'B6', 'C6', 'D6', 'E6', 'D6', 'C6', 'B6', 'B5', 'B4', 'B3', 'A3'];
      try { demoMap = K.createMap(box, {}); } catch (e) { demoMap = null; return; }
      demoMap.update({ layout: L, items: items, route: [G.START] });
      tok = ++demoTok;
      (function loop() {
        if (tok !== demoTok || !demoMap) return;
        demoMap.play(path, { speed: 260, maxMs: 9000, delay: 700 }).then(function () {
          if (tok !== demoTok) return;
          demoT = setTimeout(loop, K.reducedMotion() ? 60000 : 1800);
        });
      })();
    } else if (!on && demoMap) {
      demoTok++; clearTimeout(demoT);
      demoMap.destroy(); demoMap = null;
    }
  }

  // ------------------------------------------------------------------ the map
  function mapSet(o) {
    if (!map) return;
    if ('route' in o) {
      var sig = o.route ? o.route.join(',') : '';
      if (sig === lastRouteSig) delete o.route; else lastRouteSig = sig;
    }
    map.update(o);
  }
  function onCell(id, kind, info) {
    var v = V, p;
    if (!v) return;
    if (v.phase === 'layout') { if (G.placeable(id)) openPlace(id); else K.toast('That is a walkway. Tap a shelf square to stock it.'); return; }
    if (v.phase === 'order' && !v.mine) return walkTo(id);
    if (info && info.item && (p = G.product(info.item.p))) K.toast(id + ': ' + p.emoji + ' ' + p.name + ', ' + lvName(info.item.l) + ' level');
  }
  function onPick(p) {
    if (!V || V.phase !== 'order' || V.mine) return;
    seenGot[p] = 1; ui.just = p;
    setTimeout(function () { if (ui.just === p) ui.just = 0; }, 900);
    setTimeout(render, 0);          // never re-enter the map while it is in the middle of painting
  }

  // ------------------------------------------------------------------ Round 1: placing
  function openPlace(cell) {
    var L = eff(V), cur = L[cell];
    ui.sel = cell;
    ui.pick = ui.pickNext || (cur ? cur.p : null);
    ui.pickNext = null;
    ui.sheet = 'place';
    render();
  }
  function closeSheet() { ui.sheet = null; ui.sel = null; ui.pick = null; render(); }
  function sendLayout(op, body) {
    if (!conn) return;
    pend.push(op);
    K.sound('pop');
    conn.send(body).then(function (r) {
      var i = pend.indexOf(op);
      if (i >= 0) pend.splice(i, 1);
      if (!r.ok && !r.gone) {
        K.toast((r.net ? 'No connection: that change was NOT saved. ' : '') + (r.net ? 'Try again.' : r.err), 'bad');
        K.sound('error');
      }
      render();
    });
  }
  function doPlace(cell, p, l) {
    ui.sheet = null; ui.sel = null; ui.pick = null;
    sendLayout({ t: 'place', cell: cell, p: p, l: l }, { a: 'place', cell: cell, p: p, l: l });
    render();
  }
  function doRemove(cell) {
    ui.sheet = null; ui.sel = null; ui.pick = null;
    sendLayout({ t: 'remove', cell: cell }, { a: 'remove', cell: cell });
    render();
  }
  function placeSheetHtml(v) {
    var L = eff(v), cell = ui.sel, cur = L[cell], z = G.kindOf(cell), sales = v.sales;
    var note = z === 'cold' ? 'Cold zone' : z === 'chem' ? 'Chemical zone' : z === 'spare' ? 'Spare shelf at the back' : 'Shelf';
    var h = '<div class="sheet-head"><h2>' + cell + '</h2><span>' + note + '</span><button type="button" class="x" data-act="close" aria-label="Close">✕</button></div>' +
      '<div class="sheet-body"><p class="pstep">1. Which product goes here?</p><div class="chips">';
    G.PRODUCTS.forEach(function (p) {
      var at = G.where(L, p.n), other = at && at !== cell;
      h += '<button type="button" class="chip' + (other ? ' used' : '') + (ui.pick === p.n ? ' sel' : '') + '" data-act="pick" data-p="' + p.n + '"><b>' + p.n + '</b> ' + p.emoji + ' ' + esc(p.name) + ' ' + K.tagHtml(p) +
        (sales && sales[p.n] != null ? '<em>' + esc(sales[p.n]) + ' sold per hour</em>' : '') +
        (other ? '<em>now in ' + at + ', tap to move it here</em>' : at === cell ? '<em>on this shelf now</em>' : '<em>not placed yet</em>') +
        '</button>';
    });
    h += '</div></div><div class="sheet-foot"><p class="pstep">' + (ui.pick ? '2. Which level for ' + esc(G.product(ui.pick).name) + '? Tap one to save.' : '2. Then the level. Choose a product first.') + '</p><div class="lvls">';
    ['T', 'M', 'B'].forEach(function (l) {
      h += '<button type="button" class="lvl' + (cur && ui.pick === cur.p && cur.l === l ? ' sel' : '') + '" data-act="lvl" data-l="' + l + '"' + (ui.pick ? '' : ' disabled') + '>' + G.LEVELS[l] + '</button>';
    });
    return h + '</div>' + (cur ? '<button type="button" class="link" data-act="remove">Empty this shelf</button>' : '') + '</div>';
  }
  // shown after this phone CREATED a team (a typo in the name makes a new team instead of joining the real one)
  function newTeamHtml(v) {
    if (!ui.newTeam || ui.newTeam !== v.team.name) return '';
    if (v.team.devices > 1) { ui.newTeam = null; return ''; }       // a teammate found it: the name was right
    return '<div class="card newteam"><p><b>You started a NEW team: ' + esc(v.team.name) + '.</b> Did you mean to join teammates who are already in? Then the team name must be typed exactly like theirs.</p>' +
      '<p class="newteam-btns"><button type="button" class="btn2 small" data-act="oknew">This is right</button><button type="button" class="btn2 small" data-act="leave">Join another team</button></p></div>';
  }
  function layoutParts(v, out) {
    var L = eff(v), n = Object.keys(L).length, total = G.PRODUCTS.length, left = total - n, sales = v.sales;
    out.head = newTeamHtml(v) + '<p class="kick">Round 1: stock your store<span class="sub">Tap a shelf square, choose the product, then the level.</span></p>' +
      '<p class="tip dev">📱 ' + plural(v.team.devices || 1, 'phone is', 'phones are') + ' working on the store of <b>' + esc(v.team.name) + '</b>.</p>' +
      '<div class="prog"><b>' + n + ' of ' + total + '</b><span>placed</span><div class="prog-bar"><i style="width:' + Math.round(n / total * 100) + '%"></i></div></div>' +
      (left ? '<p class="leftn' + (flags.urgent ? ' urgent' : '') + '">' + (flags.urgent ? '⏰ Hurry: ' : '') + plural(left, 'product is', 'products are') + ' not placed yet. Orders with ' + (left === 1 ? 'it' : 'them') + ' score 0.</p>'
            : '<p class="leftn">All 24 placed. You can still move things until the time is up.</p>');
    out.cap = '';        // no hints here: the phone never says whether a placement breaks a rule
    out.foot = '<h3>Your 24 products</h3>' + (sales ? '<p class="tip">The organiser is showing how many of each are sold per hour.</p>' : '') +
      '<ul class="plist">' + G.PRODUCTS.map(function (p) {
        var at = G.where(L, p.n);
        return '<li class="' + (at ? 'in' : '') + '" data-act="prod" data-p="' + p.n + '"><b>' + p.n + '</b><span class="em">' + p.emoji + '</span><span class="nm">' + esc(p.name) + ' ' + K.tagHtml(p) + '</span>' +
          (sales && sales[p.n] != null ? '<em>' + esc(sales[p.n]) + '/hr</em>' : '') + '<u>' + (at ? at + ' ' + lvName(L[at].l) : 'not placed') + '</u></li>';
      }).join('') + '</ul>';
    out.map = { layout: L, rule: null, items: [], route: null, ghost: null, edit: true, sel: ui.sheet === 'place' ? ui.sel : null, warn: null };
  }
  function lockedParts(v, out) {
    var L = v.team.layout, pl = v.team.penList || [], miss = G.PRODUCTS.filter(function (p) { return !G.where(L, p.n); });
    var h = '<div class="card"><h2>Layout locked</h2>';
    h += pl.length ? '<ul class="pens">' + pl.map(function (x) { return '<li><b>−' + x.pts + '</b> ' + esc(x.why) + '</li>'; }).join('') + '</ul><p><b>Penalties: −' + v.team.pen + ' points.</b></p>'
                   : '<p>No penalties. Clean layout.</p>';
    if (miss.length) h += '<p class="alert">Not stocked: ' + miss.map(function (p) { return p.emoji + ' ' + esc(p.name); }).join(', ') + '. Any order with these scores 0.</p>';
    h += adjHtml(v.team.adj) + '<p>Orders are next. Watch the big screen.</p></div>';
    out.head = h + rankHtml(v);
    out.cap = '<p class="tip">This is your store. Tap a shelf to see what is on it.' + (pl.length ? ' Squares with a pink ! got a penalty.' : '') + '</p>';
    out.map = { layout: L, rule: null, items: [], route: null, ghost: null, edit: false, sel: null, warn: warnCells(L) };
  }

  // ------------------------------------------------------------------ orders
  function kickHtml(v, R, extra) {
    return '<p class="kick">' + esc(R.label) + (extra || '') + (R.mult > 1 ? ' <span class="dbl">' + (R.mult === 2 ? 'DOUBLE' : 'x' + R.mult) + ' POINTS</span>' : '') +
      (R.showdown ? ' <span class="dbl duel">⚔️ TOP ' + ((v.rules && v.rules.duelSize) || 4) + '</span>' : '') +
      '<span class="sub">' + esc(R.title || '') + '</span></p>';
  }
  function crisisHtml(R) { return R.crisis ? '<div class="alert crisis a-shake" role="alert">⚠️ ' + esc(R.crisis) + '</div>' : ''; }
  function badgesHtml(m, bty) {
    var b = '';
    if (bty) b += '<span class="badge bty">🎯 Bounty +' + bty + '</span>';
    if (m.bonus) b += '<span class="badge">⚡ Fast hand-in +' + m.bonus + '</span>';
    if (m.perfect) b += '<span class="badge">⭐ Perfect route +' + m.perfect + '</span>';
    return b ? '<div class="badges">' + b + '</div>' : '';
  }
  function planName(mode) { return mode === 'B' ? 'Plan B (one heavy trip)' : 'Plan A (two trips)'; }
  function orderParts(v, out) {
    var R = v.round, L = v.team.layout, m = v.mine, mult = R.mult || 1, all = R.double ? R.a.concat(R.b) : R.items;
    out.crisis = crisisHtml(R);
    if (R.showdown && !(v.duel && v.duel.in)) { out.head = kickHtml(v, R) + duelWatchHtml(v); lastCtx = ''; return; }    // the others watch
    var h = kickHtml(v, R) + huntHtml(v) + (R.showdown && !m ? '<p class="live-note">Live · every step you take is on the big screen</p>' : '');
    out.map = { layout: L, rule: R, ghost: null, edit: false, sel: null, warn: null };

    if (m) {                                                     // handed in (by this phone or a teammate's)
      var tot = m.score + m.bonus + m.perfect;
      h += '<div class="card dark handed a-pop"><h2>Handed in ✔</h2><p class="num">' + m.meters + ' m</p>' +
        '<p>' + tot + ' points' + (m.mode ? ' on ' + planName(m.mode) : '') + '.' + (m.bonus || m.perfect ? ' That is ' + m.score + ' for the route plus bonuses.' : '') + '</p>' + badgesHtml(m) +
        '<p class="waitbuzz">Waiting for the buzzer</p>' +
        (v.demo ? '<button type="button" class="btn2 wide" data-act="replay">Try again (practice mode)</button>' : '') + '</div>';
      out.head = h;
      out.cap = '<p class="tip">This is the route your team handed in.</p>';
      out.map.items = !R.double ? R.items : m.mode === 'B' ? all : (m.route ? R.a : R.b);
      out.map.route = m.route || m.route2 || null;
      lastCtx = '';
      return;
    }

    var d = draftFor(R, L);
    if (R.double && !d.mode) {                                   // double drop: choose a plan first
      var mm = G.missing(all, L);
      h += billHtml('First order', R.a, L, null) + billHtml('Second order', R.b, L, null) +
        '<p class="tip">Both orders came in together. Pick a plan. You can switch until you hand in.</p>' +
        '<button type="button" class="opt" data-act="mode" data-m="A"><b>Plan A: two trips</b><span>Deliver each order on its own trip. Each trip scores ' + G.SCORE.base + ' − ' + G.SCORE.perMeter + ' × meters.</span></button>' +
        '<button type="button" class="opt" data-act="mode" data-m="B"' + (mm.length ? ' disabled' : '') + '><b>Plan B: one big trip</b><span>' +
        (mm.length ? 'Not possible. You never stocked ' + namesOf(mm) + '.' : 'Collect all ' + all.length + ' items in one walk. The cart is heavy, so meters × ' + G.SCORE.cartFactor + '. Scores ' + (2 * G.SCORE.base) + ' − ' + G.SCORE.perMeter + ' × that.') + '</span></button>';
      out.head = h;
      out.cap = '<p class="tip">Pink shelves are the items of both orders.</p>';
      out.map.items = all; out.map.route = null;
      lastCtx = '';
      return;
    }

    var key = curKey(R, d), items = curItems(R, d), route = d.r[key], miss = G.missing(items, L);
    var done = { a: false, b: false, c: false };
    if (!R.double) done.a = G.isDone(d.r.a, R.items, L, R);
    else if (d.mode === 'B') done.c = G.isDone(d.r.c, all, L, R);
    else { done.a = G.isDone(d.r.a, R.a, L, R); done.b = G.isDone(d.r.b, R.b, L, R); }
    if (R.double) {
      h += '<div class="tabs">' + (d.mode === 'A'
        ? '<button type="button" class="tab' + (key === 'a' ? ' sel' : '') + '" data-act="trip" data-i="0">Trip 1' + (done.a ? ' ✔' : '') + '</button><button type="button" class="tab' + (key === 'b' ? ' sel' : '') + '" data-act="trip" data-i="1">Trip 2' + (done.b ? ' ✔' : '') + '</button>'
        : '<span class="tab sel">Plan B: one heavy trip</span>') + '<button type="button" class="link" data-act="mode" data-m="">Change plan</button></div>';
    }
    var title = !R.double ? R.title : d.mode === 'B' ? 'Both orders' : key === 'a' ? 'First order' : 'Second order';
    var pk = G.pickedOf(route, items, L, R), ctx = R.id + '|' + d.mode + '|' + key, jump = ctx !== lastCtx, shown = {}, p;
    if (jump || seenForce) { seenGot = {}; for (p in pk) seenGot[p] = 1; }
    lastCtx = ctx; seenForce = false;
    for (p in pk) if (seenGot[p]) shown[p] = 1;
    var allGot = items.every(function (x) { return pk[x]; }), steps = route.length - 1, meters = d.mode === 'B' ? G.cartMeters(steps) : steps;
    var here = d.mode === 'B' ? G.cartPts(meters) * mult : G.pts(meters) * mult;

    if (miss.length) {
      h += '<div class="card warn"><h2>' + (R.double ? 'This trip scores 0' : 'This order scores 0') + '</h2><p>You never stocked ' + namesOf(miss) + '.' +
        (R.double && d.mode === 'A' ? ' You can still deliver the other trip.' : ' Nothing to walk this time. Wait for the next order.') + '</p></div>' + billHtml(title, items, L, null);
      out.cap = '';
    } else {
      h += billHtml(title, items, L, shown);
      out.cap = '<p class="tip">' + (!allGot ? 'Tap a walkway square to walk there. Tap a pink shelf to walk next to it and grab the item.'
        : !done[key] ? '<b>You have everything.</b> Now walk back to START (A3).'
        : '<b>Route complete: ' + meters + ' m = ' + here + ' points.</b> Hand it in, or press Clear and try a shorter way.') + '</p>';
    }
    out.head = h;
    out.map.items = items; out.map.route = route; out.jump = jump;
    if (R.showdown) pushTrace();

    // bottom bar
    var anyDone = done.a || done.b || done.c, now = 0, sub;
    if (!R.double) now = done.a ? here : 0;
    else if (d.mode === 'B') now = done.c ? here : 0;
    else now = ((done.a ? G.pts(d.r.a.length - 1) : 0) + (done.b ? G.pts(d.r.b.length - 1) : 0)) * mult;
    if (anyDone) sub = now + ' points if you hand in now' + (d.mode === 'A' && done.a !== done.b ? ' (one trip only)' : '');
    else if (miss.length) sub = 'this trip scores 0';
    else sub = (d.mode === 'B' ? steps + ' steps × ' + G.SCORE.cartFactor + '. ' : '') + (steps ? here + ' points at this distance' : 'tap the map to start walking');
    if (R.double || !miss.length) out.bar = { meters: meters, sub: sub, canClear: route.length > 1 && !miss.length,
      canUndo: (route.length > 1 || !!(d.cleared && d.cleared.key === key)) && !miss.length, canHand: anyDone, ready: done[key] };
  }
  function walkTo(id) {
    var v = V, R = v.round, L = v.team.layout;
    if (R.showdown && !(v.duel && v.duel.in)) return;
    var d = draftFor(R, L);
    if (R.double && !d.mode) return K.toast('Choose Plan A or Plan B first.');
    var key = curKey(R, d), items = curItems(R, d), was, x;
    if (G.missing(items, L).length) return K.toast('This one cannot be delivered: an item was never stocked.', 'bad');
    x = K.extendRoute(d.r[key], id, R);
    if (x.err) { K.toast(x.err, 'bad'); K.sound('error'); return; }
    if (!x.added) return;
    was = G.isDone(d.r[key], items, L, R);
    if (d.cleared && d.cleared.key === key) d.cleared = null;       // a new walk has begun: the cleared one is gone for good
    d.m[key].push(d.r[key].length);
    d.r[key] = x.route;
    armed = false;
    saveDraft();
    K.sound('step');
    if (!was && G.isDone(x.route, items, L, R)) K.vibrate(40);
    clearTimeout(seenT);
    seenT = setTimeout(function () { seenForce = true; render(); }, 2600);      // safety net: the list always catches up with the map
    render();
  }
  function undo(clear) {
    var v = V;
    if (!v || v.phase !== 'order' || v.mine || !v.round || !D || D.id !== v.round.id || sending) return;
    var R = v.round, key = curKey(R, D), mk = D.m[key], c = D.cleared;
    if (D.r[key].length < 2) {
      // nothing is drawn. If Clear has just wiped a route, Undo brings it back (a slip of the thumb must not cost the round).
      if (clear || !c || c.key !== key) return;
      D.r[key] = c.r; D.m[key] = c.m; D.cleared = null;
      K.toast('Your route is back.', 'ok');
    } else if (clear) {
      D.cleared = { key: key, r: D.r[key], m: mk };
      D.r[key] = [G.START]; D.m[key] = [];
      K.toast('Route cleared. Tap Undo to get it back.');
    } else if (!mk.length) { D.r[key] = [G.START]; D.m[key] = []; }
    else D.r[key] = D.r[key].slice(0, mk.pop());
    armed = false; seenForce = true;
    saveDraft();
    render();
  }
  function submit() {
    var v = V;
    if (!v || v.phase !== 'order' || v.mine || sending || !conn) return;
    var R = v.round, L = v.team.layout, d = draftFor(R, L), body = { a: 'submit', round: R.id }, f0, f1, open;
    if (!R.double) { if (!G.isDone(d.r.a, R.items, L, R)) return; body.route = d.r.a; }
    else if (d.mode === 'B') { if (!G.isDone(d.r.c, R.a.concat(R.b), L, R)) return; body.mode = 'B'; body.route = d.r.c; }
    else if (d.mode === 'A') {
      f0 = G.isDone(d.r.a, R.a, L, R); f1 = G.isDone(d.r.b, R.b, L, R);
      if (!f0 && !f1) return;
      open = (!f0 && !G.missing(R.a, L).length) ? 1 : (!f1 && !G.missing(R.b, L).length) ? 2 : 0;     // a trip that could still earn points
      if (open && !armed) {
        armed = true;
        clearTimeout(armT);
        armT = setTimeout(function () { armed = false; render(); }, 6000);
        K.toast('Trip ' + open + ' is not finished and would score 0. Tap Hand in again to hand in anyway.', 'bad');
        render();
        return;
      }
      body.mode = 'A'; body.route = f0 ? d.r.a : null; body.route2 = f1 ? d.r.b : null;
    } else return;
    sending = true; armed = false;
    render();
    conn.send(body).then(function (r) {
      if (r.ok) { K.sound('done'); K.vibrate([60, 40, 60]); K.confetti({ count: 40, ms: 1500 }); }
      else if (!r.gone) {
        K.toast(r.net ? 'No connection: your route was NOT handed in. Tap Hand in again.' : r.err, 'bad');
        K.sound('error');
        if (!r.net && conn) conn.refresh();
      }
      sending = false;
      render();
    });
  }
  function renderBar(b) {
    show('bar', !!b);
    if (!b) return;
    var num = $('mtNum'), sub = $('mtSub'), hand = $('bHand'), t = b.meters + ' m';
    if (num.textContent !== t) num.textContent = t;
    if (sub.textContent !== b.sub) sub.textContent = b.sub;
    $('bUndo').disabled = !b.canUndo || sending;
    $('bClear').disabled = !b.canClear || sending;
    hand.disabled = !b.canHand || sending;
    t = sending ? 'Sending…' : armed ? 'Sure? Hand in' : 'Hand in';
    if (hand.textContent !== t) hand.textContent = t;
    hand.className = 'btn' + (armed ? ' armed' : b.ready && b.canHand && !sending ? ' ready' : '');
  }

  // ------------------------------------------------------------------ reveal + final
  function revealParts(v, out) {
    var R = v.round, m = v.mine, b = v.best, st = v.stats, h, got = (v.hunt && v.hunt.got) || 0, counts = !(v.rules && v.rules.bountyCounts === false);
    var tot = m ? m.score + m.bonus + m.perfect + (counts ? got : 0) : 0;
    out.crisis = '';
    if (R.showdown && !(v.duel && v.duel.in)) {
      out.head = kickHtml(v, R, ' result') + '<div class="card dark duelwatch"><p class="dw-k">⚔️ Showdown over</p><h2>' +
        (v.rules && v.rules.showdown === 'title' ? 'The title is decided' : 'The points are in') + '</h2><p>Watch the big screen for the best run.</p></div>' + rankHtml(v);
      return;
    }
    h = kickHtml(v, R, ' result') + '<div class="card result"><p class="num"><span id="rvNum">' + tot + '</span> <small>pts</small></p>';
    if (m) {
      h += badgesHtml(m, got);
      if (!R.double) {
        h += '<p>You walked ' + m.meters + ' m. ' + (b ? (m.meters <= b.meters ? 'That is the shortest route possible with your layout.' : 'Shortest possible with your layout: ' + b.meters + ' m.') : '') + '</p>';
      } else {
        h += '<p>You walked ' + m.meters + ' m on ' + planName(m.mode) + (m.mode === 'A' && (!m.route || !m.route2) ? ', but only one trip was handed in' : '') + '.</p>';
        if (b) h += '<p class="bestline">' + (m.score >= b.score ? 'That is the best score possible with your layout.' : 'Best possible with your layout: ' + b.score + ' points on ' + planName(b.mode) + ', ' + b.meters + ' m.') + '</p>';
      }
      if (m.bonus || m.perfect || got || R.mult > 1) h += '<p class="tip">' + m.score + ' for the route' + (R.mult > 1 ? ' (double points)' : '') + (m.bonus ? ' + ' + m.bonus + ' fast hand-in' : '') +
        (m.perfect ? ' + ' + m.perfect + ' perfect route' : '') + (got ? ' + ' + got + ' bounty' + (counts ? '' : ' (badge only)') : '') + '.</p>';
    } else {
      h += '<p>' + (b ? 'Nothing was handed in before the buzzer.' : 'You could not deliver this one. An item was never stocked.') + '</p>';
      if (b) h += '<p class="bestline">Shortest possible with your layout: ' + b.meters + ' m, worth ' + b.score + ' points' + (b.mode ? ' on ' + planName(b.mode) : '') + '.</p>';
    }
    if (v.hunt && v.hunt.me) h += '<p class="tip">🎯 You carried the bounty on this order.</p>';
    if (v.team.rank) h += '<p><b>Your team is #' + v.team.rank + ' of ' + v.teamCount + '</b> with ' + v.team.pts + ' points.</p>';
    out.head = h + '</div>' + rankHtml(v);
    out.cap = '<p class="cap">' + (m ? '<span><i class="ky"></i>Solid: your route</span>' : '') + (b && b.path && b.path2 ? '<span class="cap2d"><i class="ky g"></i>Shortest trip 1</span><span class="cap2d"><i class="ky g2"></i>Shortest trip 2</span><span class="cap3d"><i class="ky g"></i>Dashed: shortest possible, both trips</span>'
        : b ? '<span><i class="ky g"></i>Dashed: shortest possible</span>' : '') +
      (m ? '<button type="button" class="link" data-act="again">Watch again</button>' : '') + '</p>';
    if (st) {
      out.foot = '<div class="stats"><div><b>' + st.submitted + '</b>of ' + plural(v.teamCount, 'team', 'teams') + ' handed in</div><div><b>' + st.perfect + '</b>perfect ' + (st.perfect === 1 ? 'route' : 'routes') + '</div>' +
        '<div><b>' + (st.avgMeters == null ? '–' : st.avgMeters + ' m') + '</b>average walk</div><div><b>' + (st.bestMeters == null ? '–' : st.bestMeters + ' m') + '</b>shortest walk</div></div>';
    }
    out.map = { layout: v.team.layout, rule: R, edit: false, sel: null, warn: null };       // route, items and ghost belong to the replay
    out.rv = R.id + '|' + (m ? m.meters + ':' + m.score + ':' + m.mode : 'none') + '|' + (b ? b.meters + ':' + b.mode : 'x');
    out.rvTot = tot;
  }
  // The result replay runs on the 3D map when this phone can do it. If the phone turns out to be too slow, Kit3D tells us
  // (onSlow): the 3D map goes away, the flat map comes back and the replay starts again there. That phone stays flat after that.
  function drop3d() {
    if (map3d) { try { map3d.destroy(); } catch (e) {} map3d = null; }
    var w = $('mapWrap');
    show('map3dBox', false); show('mapBox', true);
    if (w) w.classList.remove('is3d');
  }
  function want3d() {
    var K3 = window.Kit3D, ok = false;
    if (map3d) return true;
    if (no3d) return false;
    try { ok = !!(K3 && K3.supported && K3.supported()); } catch (e) { ok = false; }
    if (!ok) return false;
    show('map3dBox', true);
    try {
      map3d = K3.createMap($('map3dBox'), { lite: true, sound: true, onSlow: function () {
        if (!map3d) return;
        no3d = true;
        drop3d();
        if (V && V.phase === 'reveal') runReveal();
      } });
    } catch (e) { map3d = null; }
    if (!map3d) { drop3d(); return false; }
    show('mapBox', false);
    $('mapWrap').classList.add('is3d');
    return true;
  }
  function runReveal() {
    var v = V, tok = ++rvTok, rmap = map3d || map;      // the map the replay runs on
    if (!v || v.phase !== 'reveal' || !v.round || !rmap) return;
    var R = v.round, L = v.team.layout, m = v.mine, b = v.best, all = R.double ? R.a.concat(R.b) : R.items, trips = [];
    var ghost = b ? (b.path && b.path2 ? [b.path, b.path2] : (b.path || b.path2 || null)) : null;
    if (m) {
      if (!R.double) trips.push([m.route, R.items]);
      else if (m.mode === 'B') trips.push([m.route, all]);
      else { if (m.route) trips.push([m.route, R.a]); if (m.route2) trips.push([m.route2, R.b]); }
    }
    trips = trips.filter(function (t) { return t[0] && t[0].length; });
    lastRouteSig = null;
    rmap.update({ layout: L, rule: R, edit: false, sel: null, warn: null, ghost: null, picked: null, items: trips.length ? trips[0][1] : all, route: null });
    function fin() {
      if (tok !== rvTok || !V || V.phase !== 'reveal') return;
      rmap.update({ ghost: ghost });
    }
    function step(i) {
      if (tok !== rvTok) return;
      if (i >= trips.length) return fin();
      rmap.play(trips[i][0], { items: trips[i][1], delay: i ? 800 : 600, speed: 110, maxMs: 6000 }).then(function (ok) {
        if (!ok || tok !== rvTok) return;
        setTimeout(function () { step(i + 1); }, 350);
      });
    }
    step(0);
  }
  function finalParts(v, out) {
    // The podium is revealed on the big screen, one place at a time. Until its place is shown, a top-3 team only
    // learns that it is on the podium (the server sends team.top3 instead of the rank).
    var t = v.team, pos = t.rank || 0, secret = !!t.top3, i;
    if (!pos && !secret && v.board) for (i = 0; i < v.board.length; i++) if (!v.board[i].hid && v.board[i].name === t.name) pos = i + 1;
    out.head = '<div class="card dark final a-pop"><h2>Game over</h2>' +
      (secret ? '<p class="num top3">TOP 3</p><p><b>Your team is on the podium!</b> Watch the big screen to see which place.</p>'
              : pos ? '<p class="num">#' + pos + '</p><p>of ' + plural(v.teamCount, 'team', 'teams') + '</p>' : '') +
      '<p><b>' + t.pts + ' points</b>, ' + t.meters + ' m walked' + (t.pen ? ', −' + t.pen + ' layout penalties' : '') + '.</p>' +
      (pos && pos <= 3 ? '<p class="badges"><span class="badge">🏆 Top 3. Well played!</span></p>' : '') + adjHtml(t.adj) + '</div>' + rankHtml(v);
    out.pos = pos;
  }
  function renderBoard(v) {
    var on = !!(v.board && (v.phase === 'reveal' || v.phase === 'final')), ol = $('board'), meEl = $('boardMe');
    show('boardWrap', on);
    if (!on) return;
    var sig = JSON.stringify(v.board) + '|' + v.team.name;
    if (sig !== boardSig) {
      boardSig = sig;
      var fill = function (box) {
        box.innerHTML = v.board.map(function (t, i) {
          if (t.hid) return '<li data-key="h:' + i + '" class="mask"><span>? ? ?</span><b></b></li>';       // podium place not revealed yet
          return '<li data-key="t:' + esc(t.name) + '"' + (t.name === v.team.name ? ' class="you"' : '') + '><span>' + esc(t.name) + '</span><b>' + t.pts + '</b></li>';
        }).join('');
      };
      if (ol.children.length) K.flipList(ol, fill, { ms: 650 }); else fill(ol);
    }
    var inTop = v.board.some(function (t) { return !t.hid && t.name === v.team.name; });
    var secretTop = v.board.some(function (t) { return t.hid; });
    $('boardNote').hidden = !secretTop;
    meEl.hidden = inTop || !v.team.rank;
    if (!meEl.hidden) meEl.textContent = 'Your team: #' + v.team.rank + ' of ' + v.teamCount + ', ' + v.team.pts + ' points';
  }

  // ------------------------------------------------------------------ sheets
  function renderSheet() {
    var host = $('sheetHost'), html = '', was = cache.sheetKind || null, kind = ui.sheet, body, top = 0, full;
    if (kind === 'place' && (!V || V.phase !== 'layout' || !ui.sel)) kind = ui.sheet = null;
    if (kind === 'rules') kind = !V || V.phase === 'lobby' ? 'rules' : 'help';
    if (kind === 'rules' || kind === 'help') {
      // the full rules only while the game has not started; in every later phase the same button opens the help
      full = kind === 'rules';
      html = '<div class="sheet-head"><h2>' + (full ? 'Rules' : 'Help') + '</h2><button type="button" class="x" data-act="close" aria-label="Close">✕</button></div><div class="sheet-body">' + (full ? rulesHtml() : helpHtml()) +
        '<div class="sheetx"><button type="button" class="btn2 small" data-act="mute">Sound: ' + (K.mute() ? 'off' : 'on') + '</button>' +
        (me ? '<span class="tip">Team: ' + esc(me.name) + '</span><button type="button" class="link" data-act="leave">Use another team on this phone</button>' : '') + '</div></div>';
    } else if (kind === 'place') html = placeSheetHtml(V);
    if (html) html = '<div class="scrim' + (was === kind ? ' noanim' : '') + '" data-act="close"></div><div class="sheet' + (was === kind ? ' noanim' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    if (cache.sheetHost !== html) {
      body = host.querySelector('.sheet-body');
      if (body && was === kind) top = body.scrollTop;
      cache.sheetHost = html;
      host.innerHTML = html;
      body = host.querySelector('.sheet-body');
      if (body && top) body.scrollTop = top;
    }
    cache.sheetKind = kind;
    if (kind) document.body.classList.add('noscroll'); else document.body.classList.remove('noscroll');
  }

  // ------------------------------------------------------------------ the one render
  function render() {
    var v = V;
    if (!v || !me) { renderSheet(); return; }
    var ph = v.phase, out = { crisis: '', head: '', cap: '', foot: '', map: null, bar: null, jump: false, rv: '', rvTot: 0, pos: 0 };
    renderTop(v);

    if (ph === 'lobby') {
      out.head = newTeamHtml(v) + '<div class="card dark inlobby"><p class="inl-k">You are in</p><h2>' + esc(v.team.name) + '</h2>' +
        '<div class="inl-row"><span>📱 <b>' + (v.team.devices || 1) + '</b> ' + ((v.team.devices || 1) === 1 ? 'phone' : 'phones') + '</span>' +
        '<span>👥 <b>' + v.teamCount + '</b> ' + (v.teamCount === 1 ? 'team' : 'teams') + ' in</span></div>' +
        '<p class="tip">Teammates join on their own phones with the same team name and PIN.</p><p class="waitbuzz">Waiting for the organiser to start</p></div>' +
        '<p class="readme">📖 Read the rules below while you wait. They disappear when Round 1 starts.</p>';
    } else if (ph === 'layout') layoutParts(v, out);
    else if (ph === 'locked') lockedParts(v, out);
    else if (ph === 'order' && v.round) orderParts(v, out);
    else if (ph === 'reveal' && v.round) revealParts(v, out);
    else if (ph === 'final') finalParts(v, out);
    else out.head = '<div class="card"><h2>One moment</h2><p>Waiting for the organiser.</p></div>';

    setHtml('rCrisis', out.crisis);
    var headNew = setHtml('rHead', out.head);
    show('lobby', ph === 'lobby');
    setHtml('lobbyRules', ph === 'lobby' ? rulesHtml() : '');      // the rules card leaves the page when the game starts
    demoOn(ph === 'lobby');
    show('mapWrap', !!out.map);
    setHtml('rCap', out.cap);
    setHtml('rFoot', out.foot);
    renderBar(ph === 'order' ? out.bar : null);
    renderBoard(v);

    if (out.map) {
      if (!map) { map = K.createMap($('mapBox'), { onCell: onCell, onPick: onPick, sound: true }); setHtml('legend', K.legendHtml()); }
      if (ph !== 'reveal') {
        rvTok++; rvKey = ''; rvCounted = '';
        drop3d();
        if (out.jump) mapSet({ route: null });               // another trip or plan: the picker jumps, it does not walk
        mapSet(out.map);
      } else {
        map.update(out.map);
        want3d();
        if (out.rv !== rvKey) { rvKey = out.rv; runReveal(); }
      }
    } else { rvTok++; rvKey = ''; rvCounted = ''; drop3d(); }
    show('legend', !!out.map && !map3d && (ph === 'layout' || ph === 'locked'));     // the colour key only matters while stocking

    if (ph === 'reveal' && headNew && rvCounted !== out.rv) {     // roll the points up once per result
      rvCounted = out.rv;
      var n = $('rvNum');
      if (n && out.rvTot) K.countUp(n, out.rvTot, { from: 0, ms: 1100 });
      if (v.mine && v.mine.perfect) setTimeout(function () { K.confetti({ count: 70, ms: 2000 }); }, 700);
    }
    if (ph === 'final') {
      if (!finalFx) { finalFx = true; if (!(out.pos && out.pos <= 3)) K.sound('done'); }
      // the party starts when this team's podium place is shown (for a top-3 team: when the organiser reveals it)
      if (out.pos && out.pos <= 3 && !finalWin) { finalWin = true; K.confetti(); K.sound('fanfare'); K.vibrate([100, 60, 100, 60, 300]); }
    }
    renderSheet();
  }

  // ------------------------------------------------------------------ taps
  function onAct(act, el) {
    var v = V, p, d, R;
    if (act === 'promo') { hidePromo(); return; }
    if (act === 'rules') { ui.sheet = ui.sheet === 'rules' ? null : 'rules'; if (ui.sheet) ui.sel = null; render(); if (!v) renderSheet(); return; }
    if (act === 'close') { ui.sheet = null; ui.sel = null; ui.pick = null; render(); return; }
    if (act === 'mute') { K.mute(!K.mute()); if (!K.mute()) K.sound('pop'); renderSheet(); return; }
    if (act === 'oknew') { ui.newTeam = null; render(); return; }
    if (act === 'leave') {
      if (!window.confirm('Leave team "' + (me ? me.name : '') + '" on this phone? Your team stays in the game. You can join it again with the same name and PIN.')) return;
      keyStore.clear();
      ui.newTeam = null;
      showJoin('');
      return;
    }
    if (!v) return;
    if (act === 'msghide') { if (v.msg) ui.msgHid = v.msg.at; renderTop(v); return; }

    if (v.phase === 'layout') {
      if (act === 'pick') { ui.pick = Number(el.getAttribute('data-p')) || null; renderSheet(); return; }
      if (act === 'lvl') { if (ui.sel && ui.pick) doPlace(ui.sel, ui.pick, el.getAttribute('data-l')); return; }
      if (act === 'remove') { if (ui.sel) doRemove(ui.sel); return; }
      if (act === 'prod') {
        p = Number(el.getAttribute('data-p'));
        var at = G.where(eff(v), p);
        if (at) { ui.pickNext = p; openPlace(at); }
        else {
          ui.pickNext = p;
          K.toast('Now tap the shelf square where ' + G.product(p).name + ' should go.');
          try { $('mapWrap').scrollIntoView({ behavior: K.reducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (e) { $('mapWrap').scrollIntoView(); }
        }
        return;
      }
    }
    if (v.phase === 'order' && v.round) {
      R = v.round;
      if (act === 'submit') return submit();
      if (act === 'undo') return undo(false);
      if (act === 'clear') return undo(true);
      if (act === 'replay') {
        if (!conn) return;
        el.disabled = true;
        conn.send({ a: 'replay' }).then(function (r) { if (!r.ok && !r.gone) { K.toast(r.err, 'bad'); render(); } });
        return;
      }
      if (v.mine) return;
      d = draftFor(R, v.team.layout);
      if (act === 'mode' && R.double) {
        p = el.getAttribute('data-m');
        if (p === 'B' && G.missing(R.a.concat(R.b), v.team.layout).length) return;
        d.mode = p === 'A' || p === 'B' ? p : null;
        armed = false; saveDraft(); K.sound('pop'); render();
        return;
      }
      if (act === 'trip' && R.double) { d.trip = el.getAttribute('data-i') === '1' ? 1 : 0; armed = false; saveDraft(); K.sound('pop'); render(); return; }
    }
    if (act === 'again' && v.phase === 'reveal') { K.sound('pop'); runReveal(); try { $('mapWrap').scrollIntoView({ block: map3d ? 'start' : 'center' }); } catch (e) {} }
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target, act = null;
    while (t && t !== document.body && t.getAttribute) {
      if ((act = t.getAttribute('data-act'))) break;
      t = t.parentNode;
    }
    if (!act || !t || t.disabled) return;
    onAct(act, t);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Escape' || ev.keyCode === 27) && ui.sheet) { ui.sheet = null; ui.sel = null; ui.pick = null; render(); }
  });
  document.addEventListener('visibilitychange', wakeSync);
  window.addEventListener('pageshow', wakeSync);
  document.addEventListener('click', wakeSync, true);
  document.addEventListener('touchend', wakeSync, true);
  $('join').addEventListener('submit', onJoin);
  $('jPin').addEventListener('input', function () { var c = this.value.replace(/\D/g, '').slice(0, 4); if (c !== this.value) this.value = c; });

  // ------------------------------------------------------------------ go
  // When the clock on this phone reaches 0:00 the buzzer normally arrives over the live line within a moment.
  // If it has not arrived (the line died quietly), ask the server instead of sitting at 0:00.
  function zeroCheck() {
    if (conn && V && (V.phase === 'order' || V.phase === 'layout') && !(V.pausedLeft > 0) && K.timeLeft(V) === 0) conn.refresh();
  }
  clockH = K.clock($('tm'), function () { return V; }, { hurry: 10, sound: true, onZero: function () { setTimeout(zeroCheck, 1200); setTimeout(zeroCheck, 4000); } });
  setInterval(tickFlags, 250);
  var saved = keyStore.get();
  if (saved && typeof saved.k === 'string' && saved.k) start({ k: saved.k, name: saved.name || '' });
  else showJoin('');
})();
