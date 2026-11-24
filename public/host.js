/* DARK STORE BLITZ - host.js : the organiser screen.
   The top part ("stage") is what the hall reads on the projector. The bottom bar ("dock") and the slide-out
   "Control room" are what the organiser uses. Everything is drawn from the HOST VIEW the server pushes.
   Regions are only redrawn when their own data changed, so the map, the clocks and the animations keep running. */
(function () {
  'use strict';
  var Kit = window.Kit, Game = window.Game, esc = Kit.esc;

  // ------------------------------------------------------------------ tiny helpers
  function $(id) { return document.getElementById(id); }
  function put(el, html) { if (el._h === html) return false; el._h = html; el.innerHTML = html; return true; }
  function txt(el, s) { s = String(s); if (el._t !== s) { el._t = s; el.textContent = s; } }
  function show(el, on) { on = !!on; if (el.hidden === !on) return; el.hidden = !on; }
  function many(n, one, more) { return n + ' ' + (n === 1 ? one : (more || one + 's')); }
  function ordinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'; }
  function resTotal(r) { return r ? r.score + r.bonus + r.perfect : 0; }

  // ------------------------------------------------------------------ state
  var keyStore = Kit.store('dsb_host');
  Kit.store('dsb_host_final').clear();      // older versions kept the podium step in this browser; the server keeps it now
  var conn = null, V = null, hostKey = '', status = '';
  var prevPhase = null, prevRound = null;
  var ui = { drawer: false, search: '', sort: 'rank', open: null, mins: 0, hold: false, finalStep: 0 };
  var PHASES = ['lobby', 'layout', 'locked', 'order', 'reveal', 'final'];

  // ------------------------------------------------------------------ sign in
  function showLogin(note) {
    if (conn) { conn.close(); conn = null; }
    V = null; prevPhase = null; prevRound = null; hostKey = '';
    closeDialog(null);
    show($('help'), false); show($('rules'), false);
    show($('app'), false); show($('wait'), false); show($('login'), true);
    var n = $('loginNote');
    n.textContent = note || ''; show(n, !!note);
    $('hp').value = '';
    try { $('hp').focus(); } catch (e) {}
  }
  $('login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var hp = $('hp').value.replace(/\s+/g, ''), b = $('loginBtn');
    if (!hp || b.disabled) return;
    b.disabled = true;
    Kit.post({ a: 'hlogin', hp: hp }).then(function (r) {
      b.disabled = false;
      if (r.ok && r.k) { keyStore.set({ k: r.k }); start(r.k); return; }
      var n = $('loginNote');
      n.textContent = r.err || 'That did not work. Try again.'; show(n, true);
      var f = $('login');
      f.classList.remove('a-shake'); void f.offsetWidth; f.classList.add('a-shake');
      $('hp').select();
    });
  });
  function start(k) {
    hostKey = k;
    show($('login'), false); show($('app'), false); show($('wait'), true);
    conn = Kit.connect({
      key: k, role: 'host', onView: onView, onStatus: onStatus,
      onGone: function () { keyStore.clear(); showLogin('This screen was signed out. Type the organiser PIN again.'); }
    });
  }

  // ------------------------------------------------------------------ sending actions
  function send(body, okText) {
    if (!conn) return Promise.resolve({ ok: false });
    return conn.send(body).then(function (r) {
      if (r.ok) { if (okText) Kit.toast(okText, 'ok'); }
      else if (!r.need && !r.badPin) { Kit.toast(r.err || 'That did not work.', 'bad'); Kit.sound('error'); }
      return r;
    });
  }

  // ------------------------------------------------------------------ confirm / input box
  // ask({title, text, ok, danger, fields:[{name,label,type,value,max,placeholder}], type:'RESET'}) -> Promise<values object | null>
  var dlgDone = null, dlgCheck = null, dlgAt = 0;
  function closeDialog(val) {
    var d = dlgDone;
    dlgDone = null; dlgCheck = null;
    var box = $('dlg');
    box.innerHTML = ''; show(box, false);
    if (d) d(val);
  }
  function ask(o) {
    closeDialog(null);
    return new Promise(function (resolve) {
      var h = '<div class="scrim" data-dlg="cancel"></div><form class="hdlg' + (o.danger ? ' danger' : '') + '" role="dialog" aria-modal="true" autocomplete="off" novalidate>' +
        '<div class="hdlg-head"><h2>' + esc(o.title) + '</h2></div><div class="hdlg-body">';
      if (o.text) h += '<p>' + esc(o.text) + '</p>';
      (o.fields || []).forEach(function (f) {
        h += '<label class="field">' + esc(f.label) + '<input name="' + esc(f.name) + '"' + (f.type === 'number' ? ' inputmode="numeric"' : '') +
          (f.max ? ' maxlength="' + f.max + '"' : '') + ' value="' + esc(f.value == null ? '' : f.value) + '" placeholder="' + esc(f.placeholder || '') + '"></label>';
      });
      if (o.type) h += '<label class="field">Type ' + esc(o.type) + ' to go on<input name="_type" autocapitalize="characters" spellcheck="false"></label>';
      h += '<p class="hdlg-err" id="dlgErr"></p></div><div class="hdlg-foot">' +
        '<button type="button" class="btn2" data-dlg="cancel">' + esc(o.cancel || 'Cancel') + ' <kbd>Esc</kbd></button>' +
        '<button type="submit" class="btn' + (o.danger ? ' hot' : '') + '" id="dlgOk">' + esc(o.ok || 'Yes') + ' <kbd>Enter</kbd></button></div></form>';
      var box = $('dlg');
      box.innerHTML = h; show(box, true);
      dlgDone = resolve; dlgAt = Date.now();
      var form = box.querySelector('form'), okBtn = $('dlgOk');
      function values() {
        var out = {}, ins = form.querySelectorAll('input'), i;
        for (i = 0; i < ins.length; i++) out[ins[i].name] = ins[i].value;
        return out;
      }
      if (o.type) {
        okBtn.disabled = true;
        form.addEventListener('input', function () { okBtn.disabled = String(values()._type).trim().toUpperCase() !== o.type; });
      }
      dlgCheck = function () {
        var v = values(), err = '';
        if (o.type && String(v._type).trim().toUpperCase() !== o.type) return;
        if (o.check) err = o.check(v) || '';
        if (err) { $('dlgErr').textContent = err; return; }
        closeDialog(v);
      };
      form.addEventListener('submit', function (ev) { ev.preventDefault(); if (dlgCheck) dlgCheck(); });
      var first = form.querySelector('input') || okBtn;
      try { first.focus(); if (first.select) first.select(); } catch (e) {}
    });
  }

  // ------------------------------------------------------------------ connection badge
  function onStatus(s) {
    status = s;
    $('conn').className = 'conn ' + s;
    txt($('connTxt'), s === 'live' ? 'live' : s === 'polling' ? 'slow link' : 'no connection');
    var lost = $('lost');
    if (s === 'live' || !V) { show(lost, false); if (V && V.phase === 'order') fitTicket(); return; }
    txt(lost, s === 'polling'
      ? 'The live link dropped. This screen still updates every few seconds and reconnects by itself.'
      : 'NO CONNECTION to the game laptop. This is the last state we saw. Reconnecting…');
    show(lost, true);
  }

  // ------------------------------------------------------------------ view arrives
  function onView(v) {
    var first = !V;
    V = v;
    if (first) { show($('wait'), false); show($('login'), false); show($('app'), true); onStatus(status); safetyToast(v); }
    backupDirty = true;
    offerRestore(v);
    var rid = v.round ? v.round.id : null;
    var changed = v.phase !== prevPhase;
    if (!first && changed) phaseSound(prevPhase, v.phase);
    // The podium step lives on the server (v.podium), so every organiser screen and every phone reveal in step.
    var step = v.phase === 'final' ? Math.min(v.podium || 0, podiumPlaces(v)) : 0;
    if (v.phase === 'final' && prevPhase === 'final' && step > ui.finalStep) podiumFx(v, step);
    ui.finalStep = step;
    // leaving the results screen: stop the best-run replay (it would keep walking and dinging behind the next order)
    if (v.phase !== 'reveal' && spotMap && spotSig !== null) { spotRun++; spotSig = null; spotMap.update({ route: null, ghost: null }); }
    PHASES.forEach(function (p) { show($('s-' + p), p === v.phase); });
    if (v.phase !== 'lobby') show($('rules'), false);         // the rules are only on the wall before Round 1 starts

    renderTop(v);
    renderDock(v);
    if (v.phase === 'lobby') renderLobby(v);
    else if (v.phase === 'layout') renderLayout(v);
    else if (v.phase === 'locked') renderLocked(v);
    else if (v.phase === 'order') renderOrder(v, changed || rid !== prevRound);
    else if (v.phase === 'reveal') renderReveal(v, changed || rid !== prevRound);
    else if (v.phase === 'final') renderFinal(v, changed);
    if (ui.drawer) renderDrawer(v);
    layClock.tick(); ordClock.tick();
    prevPhase = v.phase; prevRound = rid;
  }
  function phaseSound(from, to) {
    if ((from === 'order' && to === 'reveal') || (from === 'layout' && to === 'locked')) Kit.sound('buzzer');
    else if (to === 'final') Kit.sound('fanfare');
    else if (to === 'order' || to === 'layout') Kit.sound('done');
  }

  // The clocks tick by themselves between pushes from the server.
  // If a clock reaches 0:00 and the buzzer has not arrived over the live line, ask the server (never sit at 0:00).
  function zeroCheck() {
    if (conn && V && (V.phase === 'order' || V.phase === 'layout') && !(V.pausedLeft > 0) && Kit.timeLeft(V) === 0) conn.refresh();
  }
  function onZero() { setTimeout(zeroCheck, 1200); setTimeout(zeroCheck, 4000); }
  var layClock = Kit.clock($('layTimer'), function () { return V && V.phase === 'layout' ? V : null; }, { hurry: 60, onZero: onZero });
  var ordClock = Kit.clock($('ordTimer'), function () { return V && V.phase === 'order' ? V : null; }, { hurry: 10, sound: true, onZero: onZero });

  // ------------------------------------------------------------------ top bar
  function renderTop(v) {
    var R = v.round, name = '';
    if (v.phase === 'lobby') name = 'Lobby · teams are joining';
    else if (v.phase === 'layout') name = 'Round 1 · Build your store';
    else if (v.phase === 'locked') name = 'Layouts locked';
    else if (v.phase === 'order') name = R ? R.label + ' · ' + R.title + '  (' + (v.ri + 1) + ' of ' + v.rounds.length + ')' : 'Order';
    else if (v.phase === 'reveal') name = R ? 'Results · ' + R.label : 'Results';
    else name = 'Final results';
    txt($('phaseName'), name);
    var f = '';
    if (v.demo) f += '<span class="flag">PRACTICE MODE · teams can retry</span>';
    if (v.timer === false) f += '<span class="flag calm">NO CLOCK</span>';
    if (!v.joinOpen && (v.phase === 'lobby' || v.phase === 'layout')) f += '<span class="flag calm">JOINING LOCKED</span>';
    put($('flags'), f);
    txt($('counts'), '👥 ' + many(v.stats.teams, 'team') + '  ·  📱 ' + many(v.stats.devices, 'phone'));
    var paused = v.pausedLeft > 0 && (v.phase === 'layout' || v.phase === 'order');
    show($('pausebar'), paused);
    var m = $('msgbar');
    if (v.msg && v.msg.text) {
      txt(m, '📣 ' + v.msg.text);
      var mc = 'msgbar' + (v.msg.text.length > 60 ? ' long' : '');       // long messages: smaller letters, two lines
      if (m.className !== mc) m.className = mc;
      show(m, true);
    } else show(m, false);
  }

  // ------------------------------------------------------------------ dock (bottom bar)
  function btn(act, label, o) {
    o = o || {};
    return '<button type="button" class="dk' + (o.primary ? ' dk-go' : '') + (o.hot ? ' dk-hot' : '') + '" data-act="' + act + '"' +
      (o.primary ? ' data-primary="1"' : '') + (o.v != null ? ' data-v="' + esc(o.v) + '"' : '') + (o.off ? ' disabled' : '') +
      ' title="' + esc(o.tip || '') + '">' + label + (o.primary ? ' <kbd>N</kbd>' : '') + (o.key ? ' <kbd>' + o.key + '</kbd>' : '') + '</button>';
  }
  function nextIndex(v) {
    var i;
    if (v.phase === 'locked') { for (i = 0; i < v.rounds.length; i++) if (v.done.indexOf(v.rounds[i].id) < 0) return i; return null; }
    if (v.phase === 'reveal') {
      // the next round that was NOT played yet. (After replaying an old round, "Next" must not offer to wipe a finished one.)
      for (i = v.ri + 1; i < v.rounds.length; i++) if (v.done.indexOf(v.rounds[i].id) < 0) return i;
      for (i = 0; i < v.ri; i++) if (v.done.indexOf(v.rounds[i].id) < 0) return i;
      return null;
    }
    return null;
  }
  // Upcoming surprise rounds keep their name secret on the projector.
  function publicLabel(v, i) { var r = v.rounds[i]; return r.stage === 3 ? 'Surprise round' : r.label; }
  function startName(v, i) { var r = v.rounds[i]; return r.stage === 3 ? 'the surprise round' : r.label; }
  function podiumPlaces(v) { return Math.min(3, v.board.length); }

  function renderDock(v) {
    var p = v.phase, h = '', paused = v.pausedLeft > 0, clockOn = v.timer !== false, running = paused || v.endsAt > 0, nx;
    var pauseBtn = btn('pause', paused ? '▶ Resume clock' : '⏸ Pause clock', {
      hot: paused, off: !clockOn || !running, key: 'Space',
      tip: paused ? 'Start the clock again for everybody' : 'Freeze the clock for everybody. Teams can still work and hand in.'
    });
    var noTime = !clockOn || !running;
    if (p === 'lobby') {
      var def = Math.round((v.layoutSecs || 1800) / 60), cur = ui.mins || def, opts = [5, 10, 15, 20, 25, 30, 40, 45, 60];
      if (opts.indexOf(cur) < 0) { opts.push(cur); opts.sort(function (a, b) { return a - b; }); }
      h += '<label class="dk-pick" title="How long teams get to build their store">Round 1 length <select id="mins">' +
        opts.map(function (m) { return '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + m + ' min</option>'; }).join('') + '</select></label>';
      h += btn('start1', '▶ Start Round 1', { primary: true, tip: 'Open the warehouse on every phone and start the Round 1 clock' });
      h += btn('rules', '📋 Show rules', { key: 'R', tip: 'Put the rules and the scoring on this screen, to explain them before Round 1. They are not shown while teams play.' });
      h += btn('joinlock', v.joinOpen ? '🔒 Lock joining' : '🔓 Open joining', { tip: v.joinOpen ? 'Stop new teams from joining. Teams already in can still reconnect.' : 'Let new teams join again' });
    } else if (p === 'layout') {
      h += btn('addtime', '+1 min', { v: 60, off: noTime, tip: 'Add one minute to the clock' });
      h += btn('addtime', '−1 min', { v: -60, off: noTime, tip: 'Take one minute off the clock' });
      h += pauseBtn;
      h += btn('sales', v.showSales ? 'Hide sales per hour' : 'Show sales per hour', { tip: v.showSales ? 'Take the sales table off this screen and off the phones' : 'Show how often each product is sold, here and on every phone' });
      h += btn('lock', '🔒 Lock layouts now', { primary: true, tip: 'End Round 1 now. Layout mistakes are counted and nobody can move products any more.' });
    } else if (p === 'locked') {
      nx = nextIndex(v);
      if (nx != null) h += btn('next', '▶ Start ' + esc(publicLabel(v, nx)), { primary: true, tip: 'Send the order to every phone and start its clock' });
      else h += btn('final', '🏁 Show final results', { primary: true, tip: 'End the game and open the podium' });
      var canReopen = v.ri < 0 && !v.done.length;
      h += btn('reopen', '↩ Reopen layouts for 5 min', { off: !canReopen, tip: canReopen ? 'Let teams fix their store for 5 more minutes' : 'Not possible once an order has been played' });
    } else if (p === 'order') {
      h += btn('addtime', '+30 s', { v: 30, off: noTime, tip: 'Add 30 seconds to the clock' });
      h += pauseBtn;
      h += btn('end', '⏹ End order now', { primary: true, tip: 'Close this order early. Teams that have not handed in get 0 for it.' });
    } else if (p === 'reveal') {
      nx = nextIndex(v);
      if (nx != null) h += btn('next', '▶ Next: ' + esc(publicLabel(v, nx)), { primary: true, tip: 'Send the next order to every phone and start its clock. You are asked first.' });
      else h += btn('final', '🏁 Show final results', { primary: true, tip: 'End the game and open the podium' });
      h += btn('replay', '↻ Replay best run', { off: !v.spotlight, tip: 'Show the best route of this round again on the map' });
      if (nx != null) h += btn('final', '🏁 Final results', { tip: 'End the game early and open the podium' });
    } else if (p === 'final') {
      var places = podiumPlaces(v), left = places - ui.finalStep;
      // the button rests for a moment after each reveal, so a double click (or N pressed twice) cannot show two places at once
      if (left > 0) h += btn('podium', left === 1 ? '🏆 Reveal the WINNER' : 'Reveal ' + ordinal(left) + ' place', { primary: true, off: revealBusy || Date.now() - lastRevealAt < REVEAL_GAP, tip: 'Show the next team on the podium, here and on every phone' });
      else h += btn('party', '🎉 More confetti', { tip: 'Celebrate again' });
      h += '<a class="dk" href="/export.csv?k=' + encodeURIComponent(hostKey) + '" download="dark-store-blitz-results.csv" title="Save the final table as a file for Excel">⬇ Download results (CSV)</a>';
    }
    put($('dockMain'), h);
    txt($('muteBtn'), Kit.mute() ? '🔇 Sound off' : '🔊 Sound on');
  }

  // ------------------------------------------------------------------ LOBBY
  var seenNames = null, lobbyShown = -1;
  function renderLobby(v) {
    var pub = location.protocol === 'https:', urls = v.urls || [];
    var main = pub ? location.origin : (urls[0] || location.origin), shown = main.replace(/^https?:\/\//, '');
    var u = $('joinUrl');
    if (u._t !== shown) { txt(u, shown); fitUrl(); }
    var alt = '';
    if (!pub && !urls.length) alt = 'This laptop is not on Wi-Fi yet. Connect it, then phones can join.';
    else if (!pub && urls.length > 1) alt = 'or  ' + urls.slice(1, 3).map(function (x) { return x.replace(/^https?:\/\//, ''); }).join('   or   ');
    txt($('joinAlt'), alt);
    txt($('step1'), pub ? 'Use any internet connection on your phone.' : 'Connect your phone to the same Wi-Fi as this screen.');

    var n = v.teams.length, el = $('lobbyN');
    if (lobbyShown !== n) {
      if (lobbyShown < 0) { el.textContent = String(n); el._kitNum = n; }
      else { Kit.countUp(el, n, { ms: 500 }); if (n > lobbyShown) Kit.sound('pop'); }
      lobbyShown = n;
    }
    txt($('lobbyNLabel'), n === 1 ? 'team in' : 'teams in');
    put($('joinState'), v.joinOpen ? 'Joining is open. Teammates join with the same team name and PIN.' : '<b>Joining is locked.</b> No new teams can come in.');

    // newest names first; only the last few are shown so 300 teams never flood the screen
    var firstTime = !seenNames, MAXN = 18, h = '', i, t;
    if (firstTime) seenNames = {};
    for (i = n - 1; i >= 0 && i >= n - MAXN; i--) {
      t = v.teams[i];
      h += '<span class="chip' + (!firstTime && !seenNames[t.id] ? ' a-pop' : '') + '">' + esc(t.name) + '</span>';
    }
    if (n > MAXN) h += '<span class="chip more">+ ' + (n - MAXN) + ' more</span>';
    put($('lobbyNames'), h);
    seenNames = {};
    for (i = 0; i < n; i++) seenNames[v.teams[i].id] = 1;
  }

  // The join address is as big as the column allows, whatever its length.
  function fitUrl() {
    var u = $('joinUrl');
    if (!u.offsetParent) return;
    u.style.fontSize = '6.2em';
    var room = u.parentNode.clientWidth, w = u.scrollWidth;
    if (w > room && w > 0) u.style.fontSize = (6.2 * room / w * 0.96).toFixed(2) + 'em';
  }
  window.addEventListener('resize', fitUrl);

  // ------------------------------------------------------------------ ROUND 1
  function clockNote(v) {
    if (v.timer === false) return 'No clock: this round ends when the organiser ends it.';
    if (v.pausedLeft > 0) return 'The clock is paused.';
    return '';
  }
  function renderLayout(v) {
    var n = v.teams.length, b = [0, 0, 0, 0], i, p;
    for (i = 0; i < n; i++) { p = v.teams[i].placed; b[p >= 24 ? 3 : p >= 12 ? 2 : p >= 1 ? 1 : 0]++; }
    txt($('layNote'), clockNote(v));
    put($('layProgTxt'), '<b>' + b[3] + '</b> of ' + n + ' teams fully stocked');
    var h = '';
    [3, 2, 1, 0].forEach(function (k) {
      var w = n ? b[k] / n * 100 : (k === 0 ? 100 : 0);
      h += '<i class="d' + k + '" style="width:' + w.toFixed(2) + '%">' + (b[k] && w > 6 ? b[k] : '') + '</i>';
    });
    var bar = $('layDist');
    if (bar._h !== h) {                       // keep the same four bars so their width can slide
      if (bar.children.length === 4) {
        var kids = bar.children;
        [3, 2, 1, 0].forEach(function (k, j) {
          var w = n ? b[k] / n * 100 : (k === 0 ? 100 : 0);
          kids[j].style.width = w.toFixed(2) + '%'; kids[j].textContent = b[k] && w > 6 ? b[k] : '';
        });
        bar._h = h;
      } else put(bar, h);
    }
    var side;
    if (v.showSales && v.sales) {
      var rows = Game.PRODUCTS.map(function (pr) { return { pr: pr, n: Number(v.sales[pr.n]) || 0 }; });
      rows.sort(function (x, y) { return y.n - x.n || x.pr.n - y.pr.n; });
      side = '<div class="hcard"><h3>Sold per hour</h3><ol class="sales">' + rows.map(function (r) {
        return '<li><i>' + r.pr.emoji + '</i><span>' + esc(r.pr.name) + '</span><b>' + r.n + '</b></li>';
      }).join('') + '</ol></div>';
    } else {
      // No placement rules here: the organiser explains them before Round 1 (Show rules in the lobby). Teams must not read them off the wall.
      side = '<div class="hcard"><h3>What to do now</h3><ul class="todo">' +
        '<li><i>📦</i><span>Put all 24 products on shelves. Tap an empty shelf on your phone.</span></li>' +
        '<li><i>🤝</i><span>Work as one team. Every phone of your team shows the same store.</span></li>' +
        '<li><i>🔒</i><span>When the clock hits 0:00 the stores are locked and checked.</span></li>' +
        '<li><i>🚫</i><span>A product that is not on a shelf cannot be delivered.</span></li>' +
        '</ul></div>';
    }
    put($('laySide'), side);
  }

  // ------------------------------------------------------------------ LAYOUTS LOCKED
  function mistakeKind(why) {
    if (/is cold but/.test(why)) return 'Cold product outside the cold zone';
    if (/is a chemical but/.test(why)) return 'Chemical outside the chemical zone';
    if (/food in the chemical/.test(why)) return 'Food in the chemical zone';
    if (/is heavy but/.test(why)) return 'Heavy product not on the bottom level';
    if (/is fragile but/.test(why)) return 'Fragile product on the bottom level';
    if (/Eggs are next to Atta/.test(why)) return 'Eggs right next to Atta';
    return why;
  }
  function renderLocked(v) {
    var n = v.teams.length, clean = 0, bad = 0, unfinished = 0, total = 0, kinds = {}, list = [], i, j, t, k, pl;
    for (i = 0; i < n; i++) {
      t = v.teams[i]; pl = t.penList || [];
      if (t.placed < 24) unfinished++;
      if (pl.length) bad++; else if (t.placed >= 24) clean++;
      total += t.pen || 0;
      for (j = 0; j < pl.length; j++) {
        k = mistakeKind(pl[j].why);
        if (!kinds[k]) { kinds[k] = { name: k, n: 0, pts: 0 }; list.push(kinds[k]); }
        kinds[k].n++; kinds[k].pts += pl[j].pts;
      }
    }
    put($('lockStats'),
      '<div class="stat dark"><b>' + clean + '<small> of ' + n + '</small></b><span>clean layouts: everything placed, no mistakes</span></div>' +
      '<div class="stat"><b>' + bad + '</b><span>' + (bad === 1 ? 'layout' : 'layouts') + ' with mistakes</span></div>' +
      '<div class="stat"><b>' + unfinished + '</b><span>' + (unfinished === 1 ? 'team' : 'teams') + ' did not place all 24 products</span></div>' +
      '<div class="stat pink"><b>' + (total ? '−' + total : '0') + '</b><span>penalty points handed out in total</span></div>');
    txt($('lockNote'), 'Mistakes cost points once. A product that is not on a shelf cannot be delivered.');
    list.sort(function (a, b) { return b.n - a.n || b.pts - a.pts; });
    var max = list.length ? list[0].n : 1;
    put($('lockMistakes'), list.length ? list.slice(0, 6).map(function (m) {
      return '<div class="mis"><i style="width:' + (m.n / max * 100).toFixed(1) + '%"></i><p><span>' + esc(m.name) + '</span><em>' + m.n + ' times · −' + m.pts + ' pts</em></p></div>';
    }).join('') : '<p class="none">' + (n ? 'No mistakes at all. Every layout follows the rules.' : 'No teams in the game.') + '</p>');
  }

  // ------------------------------------------------------------------ ORDER
  // The projector maps are drawn in 3D when this browser can do it smoothly (kit3d.js), else as the flat map from kit.js.
  // If the 3D map turns out to be too slow, onSlow swaps it for the flat one in the same box.
  function makeMap(box, holder, sound, onSlow) {
    var m = null, K3 = window.Kit3D;
    if (K3 && K3.supported()) {
      try { m = K3.createMap(box, { sound: sound, sway: true, onSlow: function () { setTimeout(onSlow, 0); } }); m.is3d = true; }
      catch (e) { m = null; box.innerHTML = ''; }
    }
    if (!m) m = Kit.createMap(box, sound ? { sound: true } : {});
    holder.classList.toggle('is3d', !!m.is3d);
    return m;
  }
  function ordMapSlow() {
    if (!ordMap || !ordMap.is3d) return;
    ordMap.destroy(); ordMap = null; ordMapRound = null;
    if (V && V.phase === 'order') renderOrder(V, false);       // builds the flat map and shows the round on it again
  }
  function spotMapSlow() {
    if (!spotMap || !spotMap.is3d) return;
    spotRun++; spotMap.destroy(); spotMap = null; spotSig = null;
    if (V && V.phase === 'reveal') playSpot(V, true);          // flat map, replay from the start
  }
  var ordMap = null, ordMapRound = null, tick = { round: null, seen: {}, list: [], n: 0 };
  function itemLi(p) {
    var pr = Game.product(p);
    return pr ? '<li><i>' + pr.emoji + '</i><span>' + esc(pr.name) + '</span>' + Kit.tagHtml(pr) + '</li>' : '';
  }
  function ticketHtml(R, small) {
    var h = '<p class="kicker">' + esc(R.label) + '</p><h2>' + esc(R.title) + '</h2>';
    if (R.double) {
      h += '<div class="ab"><div><p class="dbl">Order A</p><ul class="items">' + R.a.map(itemLi).join('') + '</ul></div>' +
        '<div><p class="dbl">Order B</p><ul class="items">' + R.b.map(itemLi).join('') + '</ul></div></div>';
    } else {
      h += '<ul class="items' + (!small && R.items.length > 5 ? ' cols2' : '') + '">' + R.items.map(itemLi).join('') + '</ul>';
    }
    if (R.mult && R.mult !== 1) h += '<p class="worth">Worth ' + (R.mult === 2 ? 'DOUBLE' : R.mult + ' x') + ' points</p>';
    return h;
  }
  // The whole ticket must always be readable: if it is taller than its place (long order, pause bar or a message on
  // screen, small window) or a product name is cut off, the letters shrink step by step until everything fits.
  var tixSig = '';
  function fitTicket() {
    var tk = $('ticket'), row = tk.parentNode;
    if (!tk.offsetParent) return;
    var sig = tk._h + '|' + row.clientWidth + 'x' + row.clientHeight + '|' + tk.className;
    if (sig === tixSig) return;
    tixSig = sig;
    var f = 1, names = tk.querySelectorAll('.items li span');
    function clips() {
      if (tk.scrollHeight > tk.clientHeight + 1) return true;
      for (var i = 0; i < names.length; i++) if (names[i].scrollWidth > names[i].clientWidth + 1) return true;      // a product name cut off with "…"
      return false;
    }
    tk.style.fontSize = '';
    while (f > 0.55 && clips()) { f -= 0.05; tk.style.fontSize = f.toFixed(2) + 'em'; }
  }
  window.addEventListener('resize', function () { if (V && V.phase === 'order') fitTicket(); });
  // the room for the ticket also changes without a new view (the "no connection" bar comes and goes): fit again then
  if (window.ResizeObserver) { try { new ResizeObserver(function () { if (V && V.phase === 'order') fitTicket(); }).observe($('ticket').parentNode); } catch (e) {} }
  function renderOrder(v, fresh) {
    var R = v.round;
    if (!R) return;
    var hasMap = !!(R.oneWay || (R.blocked && R.blocked.length)), small = hasMap;
    var c = $('crisis');
    if (R.crisis) {
      if (put(c, '<b>' + (R.stage === 3 ? 'SURPRISE' : 'NOTE') + '</b>' + esc(R.crisis)) || fresh) { c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; }
      show(c, true);
    } else show(c, false);
    var tk = $('ticket');
    tk.className = 'tix' + (small ? ' small' : '') + (R.double ? ' dbl2' : '');
    put(tk, ticketHtml(R, small));
    $('s-order').classList.toggle('hasmap', hasMap);          // rounds with a map: the left side gets more room
    show($('ordMapBox'), hasMap);
    if (hasMap) {
      if (!ordMap) ordMap = makeMap($('ordMap'), $('ordMapBox'), false, ordMapSlow);
      if (ordMapRound !== R.id) {
        ordMapRound = R.id;
        ordMap.update({ layout: {}, items: [], route: null, ghost: null, rule: null });     // clear, so the pallets drop in again
        setTimeout(function () { if (ordMap && V && V.round && V.round.id === R.id) ordMap.update({ rule: V.round }); }, 500);
      }
      var cap = [];
      if (R.oneWay) cap.push('Aisle 6 is one-way: only downwards');
      if (R.blocked && R.blocked.length) cap.push('Blocked: ' + R.blocked.join(', '));
      txt($('ordMapCap'), cap.join('  ·  '));
    }
    txt($('ordNote'), clockNote(v));
    fitTicket();

    // progress + ticker of the latest hand-ins
    var n = v.teams.length, sub = v.stats.submitted, i, t, added = 0;
    put($('ordProgTxt'), '<b>' + sub + '</b> of ' + n + ' handed in');
    var w = (n ? Math.min(100, sub / n * 100) : 0).toFixed(1) + '%', bar = $('ordBar');
    if (bar._w !== w) { bar._w = w; bar.style.width = w; }
    var silent = tick.round !== R.id || fresh && !tick.list.length && sub > 3;
    if (tick.round !== R.id) { tick = { round: R.id, seen: {}, list: [], n: 0 }; }
    var now = {};
    for (i = 0; i < n; i++) {
      t = v.teams[i];
      if (!t.res) continue;
      now[t.id] = 1;
      if (!tick.seen[t.id] && !silent) { tick.list.unshift({ k: ++tick.n, name: t.name, bonus: t.res.bonus > 0 }); added++; }
    }
    tick.seen = now;
    if (tick.list.length > 6) tick.list.length = 6;
    var newest = tick.n - added;
    put($('ticker'), tick.list.map(function (x) {
      return '<li' + (x.k > newest ? ' class="a-rise"' : '') + '><span>✅ ' + esc(x.name) + '</span><em>' + (x.bonus ? '⚡ speed bonus' : 'handed in') + '</em></li>';
    }).join(''));
    if (added) Kit.sound('pop');
  }

  // ------------------------------------------------------------------ REVEAL
  var spotMap = null, spotSig = null, spotRun = 0, boardSig = null, shownPts = Object.create(null);      // no prototype: keys are team names
  function spotCaption(sp, trip) {
    if (!sp) return 'Nobody delivered this order.';
    return '⭐ Best run: <b>' + esc(sp.name) + '</b> <em>' + sp.meters + ' m walked · ' + sp.total + ' points' + (trip ? ' · ' + esc(trip) : '') + '</em>';
  }
  function playSpot(v, force) {
    var sp = v.spotlight, R = v.round;
    if (!R) return;
    var sig = JSON.stringify([R.id, sp ? [sp.name, sp.meters, sp.total, sp.mode, sp.route, sp.route2] : null]);
    if (sig === spotSig && !force) return;
    spotSig = sig;
    if (!spotMap) spotMap = makeMap($('spotMap'), $('s-reveal'), true, spotMapSlow);
    var run = ++spotRun, cap = $('spotCap');
    if (!sp) {
      put(cap, spotCaption(null));
      spotMap.update({ layout: {}, rule: R, items: [], route: null, ghost: null });
      return;
    }
    var trips = [];
    if (R.double) {
      if (sp.mode === 'B') { if (sp.route) trips.push([sp.route, R.a.concat(R.b), 'one trip, heavy cart']); }
      else {
        if (sp.route) trips.push([sp.route, R.a, 'trip 1 of 2']);
        if (sp.route2) trips.push([sp.route2, R.b, sp.route ? 'trip 2 of 2' : 'only order B']);
      }
    } else if (sp.route) trips.push([sp.route, R.items, '']);
    if (!trips.length) {
      put(cap, spotCaption(sp));
      spotMap.update({ layout: sp.layout || {}, rule: R, items: [], route: null, ghost: null });
      return;
    }
    (function go(i) {
      if (run !== spotRun || i >= trips.length) return;
      put(cap, spotCaption(sp, trips[i][2]));
      spotMap.play(trips[i][0], { layout: sp.layout || {}, rule: R, items: trips[i][1], ghost: null, speed: 150, maxMs: 9000, delay: i ? 700 : 900 })
        .then(function (ok) { if (ok && run === spotRun) setTimeout(function () { go(i + 1); }, 1200); });
    })(0);
  }
  function renderBoard(v, fresh) {
    var top = v.board.slice(0, 10), sig = JSON.stringify(top);
    if (sig === boardSig && !fresh) return;
    boardSig = sig;
    // where each team stood before this round: its points now minus what this round gave it
    var base = Object.create(null), i, t;
    if (fresh) for (i = 0; i < v.teams.length; i++) { t = v.teams[i]; base[t.name] = t.pts - resTotal(t.res); }
    var from = top.map(function (x) {
      if (fresh && base[x.name] != null) return base[x.name];
      return shownPts[x.name] != null ? shownPts[x.name] : x.pts;
    });
    var ol = $('revBoard');
    Kit.flipList(ol, function () {
      ol.innerHTML = top.map(function (x, j) {
        return '<li data-key="' + esc(x.name) + '"><span>' + esc(x.name) + '</span><em>' + x.meters + ' m</em><b>' + from[j] + '</b></li>';
      }).join('');
    }, { ms: 900 });
    var bs = ol.querySelectorAll('li > b');
    for (i = 0; i < bs.length && i < top.length; i++) if (from[i] !== top[i].pts) Kit.countUp(bs[i], top[i].pts, { from: from[i], ms: 1400 });
    shownPts = Object.create(null);
    for (i = 0; i < v.board.length; i++) shownPts[v.board[i].name] = v.board[i].pts;
    txt($('revBoardNote'), v.board.length > 10 ? 'of ' + v.board.length + ' teams' : '');
  }
  function renderReveal(v, fresh) {
    var R = v.round;
    if (!R) return;
    txt($('revTitle'), 'Results · ' + R.label + ' · ' + R.title);
    var n = v.teams.length, best = null, who = '', cnt = 0, i, t;
    for (i = 0; i < n; i++) {
      t = v.teams[i];
      if (!t.res || t.res.full === false) continue;        // double drop: a team that delivered only one order is not "the shortest walk"
      if (best === null || t.res.meters < best) { best = t.res.meters; who = t.name; cnt = 1; }
      else if (t.res.meters === best) cnt++;
    }
    put($('revStats'),
      '<div class="stat dark"><b>' + v.stats.submitted + '<small> of ' + n + '</small></b><span>teams delivered</span></div>' +
      '<div class="stat"><b>' + v.stats.perfect + '</b><span>perfect routes: the shortest their own store allows</span></div>' +
      '<div class="stat pink"><b>' + (best === null ? '–' : best + '<small> m</small>') + '</b><span>' +
        (best === null ? 'shortest walk' : 'shortest walk' + (cnt === 1 ? ': ' + esc(who) : ' (' + cnt + ' teams)')) + '</span></div>');
    renderBoard(v, fresh);
    playSpot(v, fresh);
  }

  // ------------------------------------------------------------------ FINAL
  var MEDAL = ['', '🥇', '🥈', '🥉'], podSig = null;
  function renderFinal(v, fresh) {
    if (fresh) podSig = null;
    var places = podiumPlaces(v), step = Math.min(ui.finalStep, places);
    var open = function (place) { return place <= places && place > places - step; };
    var sig = JSON.stringify([v.board.slice(0, 3), step, places]);
    if (sig !== podSig) {
      podSig = sig;
      var h = '';
      [2, 1, 3].forEach(function (pl) {
        var t = v.board[pl - 1];
        if (!t) { h += '<div class="pod p' + pl + ' none"></div>'; return; }
        if (!open(pl)) { h += '<div class="pod p' + pl + ' hid"><span class="place">' + ordinal(pl) + ' place</span><span class="q">?</span></div>'; return; }
        h += '<div class="pod p' + pl + (ui.justShown === pl ? ' show' : '') + '"><span class="medal">' + MEDAL[pl] + '</span><span class="place">' + ordinal(pl) + ' place</span>' +
          '<span class="pname">' + esc(t.name) + '</span><span class="ppts">' + t.pts + '</span><span class="pm">points · ' + t.meters + ' m walked</span></div>';
      });
      put($('podium'), h);
      ui.justShown = 0;
    }
    txt($('finHead'), 'Full ranking · ' + many(v.board.length, 'team'));
    var rows = '', i, t2, masked;
    for (i = 0; i < v.board.length; i++) {
      t2 = v.board[i]; masked = i < 3 && !open(i + 1);
      rows += masked ? '<tr class="mask"><td class="n">' + (i + 1) + '</td><td class="nm">? ? ?</td><td class="m"></td><td class="p"></td></tr>'
        : '<tr><td class="n">' + (i + 1) + '</td><td class="nm">' + esc(t2.name) + '</td><td class="m">' + t2.meters + ' m</td><td class="p">' + t2.pts + '</td></tr>';
    }
    put($('finList'), rows ? '<table>' + rows + '</table>' : '<p class="none">No teams in the game.</p>');
  }
  var REVEAL_GAP = 1500, lastRevealAt = 0, revealBusy = false;
  // Ask the server to reveal the next podium place. The server keeps the step, so phones and this screen show it together.
  function revealPodium() {
    if (!V || V.phase !== 'final' || revealBusy) return;
    var places = podiumPlaces(V), now = Date.now();
    if (ui.finalStep >= places || now - lastRevealAt < REVEAL_GAP) return;       // too soon after the last reveal: ignore
    lastRevealAt = now; revealBusy = true;
    renderDock(V);
    setTimeout(function () { if (V) renderDock(V); }, REVEAL_GAP + 60);
    send({ a: 'hpodium', step: ui.finalStep + 1 }).then(function () { revealBusy = false; if (V) renderDock(V); });
  }
  // A new place has just been revealed (called from onView when v.podium went up).
  function podiumFx(v, step) {
    ui.justShown = podiumPlaces(v) - step + 1;
    if (ui.justShown === 1) { Kit.sound('fanfare'); Kit.confetti({ ms: 5000, count: 320 }); setTimeout(function () { if (V && V.phase === 'final') Kit.confetti({ ms: 4000 }); }, 2200); }
    else Kit.sound('done');
  }

  // ------------------------------------------------------------------ RULES SHEET (lobby only)
  // The organiser puts this on the projector to explain the game before Round 1. Phones do not coach while teams play.
  function namesOf(tag) {
    return Game.PRODUCTS.filter(function (p) { return p.tag === tag; }).map(function (p) { return p.name; }).join(', ');
  }
  function rulesHtml() {
    var P = Game.PENALTY, S = Game.SCORE;
    function rule(icon, head, text, pts, each) {
      return '<li><i>' + icon + '</i><span><b>' + head + '</b><small>' + esc(text) + '</small></span><em>−' + pts + (each ? '<small>each</small>' : '') + '</em></li>';
    }
    function line(icon, html) { return '<li><i>' + icon + '</i><span>' + html + '</span></li>'; }
    return '<div class="rcol"><h3>Round 1 · Build your store</h3><ol class="rlist">' +
      rule('🧊', 'Cold products: cold zone only, J1 to J3', namesOf('COLD'), P.cold, true) +
      rule('🧪', 'Chemicals: chemical zone only, J8 to J10', namesOf('CHEMICAL') + '. No food in that zone (−' + P.foodInChem + ' each).', P.chemical, true) +
      rule('🏋️', 'Heavy products on the bottom level', namesOf('HEAVY'), P.heavy, false) +
      rule('🥚', 'Fragile products NOT on the bottom level', namesOf('FRAGILE'), P.fragile, true) +
      rule('↔️', 'Eggs never right next to Atta', 'Not on a square that touches the Atta square.', P.eggsAtta, false) +
      '</ol><p class="rnote">Mistakes are counted once, when the layouts are locked. They add up.</p></div>' +
      '<div class="rcol"><h3>Orders · less walking, more points</h3><ul class="rpts">' +
      line('🏃', 'Start and end at <b>START</b>. One square walked = <b>1 meter</b>.') +
      line('🧮', 'Points for an order = <b>' + S.base + ' − ' + S.perMeter + ' × meters</b>.') +
      line('⚡', '<b>+' + S.speedBonus + '</b> speed bonus for the first teams to hand in.') +
      line('⭐', '<b>+' + S.perfectBonus + '</b> for the shortest route your own store allows.') +
      line('🚫', 'Not handed in, or a product is not on a shelf = <b>0</b> for that order.') +
      line('🏆', 'Most points wins. On a tie: the team that walked less.') +
      '</ul><p class="rnote">Tip: what sells most should be closest to START.</p></div>';
  }

  // ------------------------------------------------------------------ CONTROL ROOM
  function renderDrawer(v) {
    var started = v.phase !== 'lobby' && v.phase !== 'layout', h = '';
    v.rounds.forEach(function (r, i) {
      var cur = (v.phase === 'order' || v.phase === 'reveal') && v.ri === i, done = v.done.indexOf(r.id) >= 0;
      var secret = r.stage === 3 && !done && !cur;
      h += '<button type="button" class="rp' + (cur ? ' cur' : done ? ' done' : '') + (r.stage === 3 ? ' s3' : '') + '" data-act="jump" data-v="' + i + '"' + (started ? '' : ' disabled') +
        ' title="' + esc((started ? 'Start ' : 'Lock the layouts first. ') + r.label + ': ' + r.title + (done ? ' (already played)' : '')) + '">' +
        esc(secret ? 'Surprise ' + (i + 1) : r.label) + (done && !cur ? ' ✓' : '') + '</button>';
    });
    h += '<button type="button" class="rp fin" data-act="final"' + (started && v.phase !== 'final' ? '' : ' disabled') + ' title="End the game and open the podium">🏁 Final results</button>';
    put($('drRounds'), h);

    function sw(act, on, name, note, risky) {
      return '<button type="button" class="sw' + (on ? ' on' : '') + (risky ? ' risky' : '') + '" data-act="' + act + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" title="' + esc(note) + '">' +
        '<i></i><span><b>' + esc(name) + ': ' + (on ? 'ON' : 'OFF') + '</b><small>' + esc(note) + '</small></span></button>';
    }
    put($('drSwitches'),
      sw('timer', v.timer !== false, 'Clock', v.timer !== false ? 'Rounds end by themselves when time is up.' : 'No clock: rounds only end when you end them.') +
      sw('demo', !!v.demo, 'Practice mode', 'Practice only - teams can retry an order. Keep OFF in the competition.', true) +
      sw('joinlock', !!v.joinOpen, 'Joining', v.joinOpen ? 'New teams can join until Round 1 is locked.' : 'No new teams. Teams already in can reconnect.') +
      sw('sales', !!v.showSales, 'Sales per hour', v.showSales ? 'Teams can see how often each product sells.' : 'Hidden from teams.'));

    renderSafety(v);
    txt($('msgNow'), v.msg && v.msg.text ? 'On screens now: “' + v.msg.text + '”' : 'No message on the screens right now.');
    $('msgClear').disabled = !(v.msg && v.msg.text);
    renderTeams(v);
  }
  function renderTeams(v) {
    if (ui.hold) return;                      // a button in the table is being pressed: do not pull it away
    var rank = Object.create(null), i, q = ui.search.toLowerCase(), list = [], t, R = v.round, inRound = !!R;
    for (i = 0; i < v.board.length; i++) rank[v.board[i].name] = i + 1;
    for (i = 0; i < v.teams.length; i++) { t = v.teams[i]; if (!q || t.name.toLowerCase().indexOf(q) >= 0) list.push(t); }
    var byRank = function (a, b) { return (rank[a.name] || 9999) - (rank[b.name] || 9999); };
    var sorts = {
      rank: byRank,
      name: function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; },
      placed: function (a, b) { return a.placed - b.placed || byRank(a, b); },
      devices: function (a, b) { return a.devices - b.devices || byRank(a, b); },
      pen: function (a, b) { return b.pen - a.pen || byRank(a, b); },
      round: function (a, b) { return (a.res ? 1 : 0) - (b.res ? 1 : 0) || resTotal(b.res) - resTotal(a.res) || byRank(a, b); }
    };
    list.sort(sorts[ui.sort] || byRank);
    txt($('tCount'), q ? list.length + ' of ' + v.teams.length + ' shown' : '(' + v.teams.length + ')');
    var h = '';
    for (i = 0; i < list.length; i++) {
      t = list[i];
      var res = t.res, cell = '–';
      if (inRound) {
        cell = res ? resTotal(res) + ' pts · ' + res.meters + ' m' + (res.perfect ? ' ⭐' : '') + (res.bonus ? ' ⚡' : '') + (res.mode ? ' · ' + (res.mode === 'B' ? 'cart' : res.full === false ? '1 trip only' : '2 trips') : '') : 'not handed in';
        if (res && res.fast) cell += ' <b class="fastflag" title="Handed in faster than a person can tap it. No speed bonus was given.">⚠ too fast</b>';
        if (t.best && res) cell += ' <small>(best ' + t.best.meters + ' m)</small>';
      }
      h += '<tr class="row' + (t.devices ? '' : ' zero') + '" data-row="' + t.id + '">' +
        '<td>' + (rank[t.name] || '') + '</td><td class="nm">' + esc(t.name) + '</td><td class="dv">' + t.devices + '</td><td>' + t.placed + '/24</td>' +
        '<td><b>' + t.pts + '</b></td><td' + (t.pen ? ' class="pen"' : '') + '>' + (t.pen ? '−' + t.pen : '0') + '</td><td>' + cell + '</td>' +
        '<td class="acts">' +
        '<button type="button" class="mini" data-act="adjust" data-v="' + t.id + '" title="Add or take away points for this team, with a reason">± Points</button>' +
        '<button type="button" class="mini" data-act="redo" data-v="' + t.id + '"' + (inRound && res ? '' : ' disabled') + ' title="Delete this team\'s result for the current order so it can hand in again">Redo</button>' +
        '<button type="button" class="mini" data-act="pin" data-v="' + t.id + '" title="Set a new 4-digit PIN for this team, when they forgot theirs and cannot get back in">New PIN</button>' +
        '<button type="button" class="mini bad" data-act="kick" data-v="' + t.id + '" title="Remove this team from the game for good">Remove</button></td></tr>';
      if (ui.open === t.id) {
        var d = '';
        d += '<b>Layout penalties:</b> ' + (t.penList && t.penList.length ? '<ul>' + t.penList.map(function (p) { return '<li>−' + p.pts + ' · ' + esc(p.why) + '</li>'; }).join('') + '</ul>'
          : (v.phase === 'lobby' || v.phase === 'layout' ? 'counted when layouts are locked.<br>' : 'none.<br>'));
        d += '<b>Point adjustments:</b> ' + (t.adj && t.adj.length ? '<ul>' + t.adj.map(function (a) { return '<li>' + (a.pts > 0 ? '+' : '−') + Math.abs(a.pts) + ' · ' + esc(a.why || 'no reason given') + '</li>'; }).join('') + '</ul>' : 'none.<br>');
        if (res && res.fast) d += '<b>⚠ Too fast:</b> this order was handed in faster than a person can tap the route (a script may have done it). It got no speed bonus. Have a look at this team.<br>';
        d += 'Walked ' + t.meters + ' m in total. ' + many(t.devices, 'phone') + ' connected.';
        h += '<tr class="detail"><td colspan="8">' + d + '</td></tr>';
      }
    }
    put($('tBody'), h || '<tr><td colspan="8">' + (q ? 'No team has that name.' : 'No teams yet.') + '</td></tr>');
  }
  function teamById(id) {
    if (!V) return null;
    for (var i = 0; i < V.teams.length; i++) if (V.teams[i].id === id) return V.teams[i];
    return null;
  }
  function setDrawer(on) {
    ui.drawer = !!on;
    show($('drawer'), ui.drawer); show($('drawerScrim'), ui.drawer);
    if (ui.drawer && V) renderDrawer(V);
  }

  // ------------------------------------------------------------------ what every control does
  function startRound(i, force) {
    return send({ a: 'hround', i: i, force: !!force }).then(function (r) {
      if (r.ok || !r.need) return r;
      return ask({ title: 'Play it again?', text: r.need, ok: 'Yes, wipe and replay', danger: true }).then(function (yes) {
        return yes ? startRound(i, true) : r;
      });
    });
  }
  function goFinal() {
    ask({ title: 'Show the final results?', text: 'This ends the game and opens the podium.' + (V && V.phase === 'order' ? ' The running order is closed first.' : ''), ok: 'Yes, show the podium', cancel: 'Not yet' })
      .then(function (yes) { if (yes) send({ a: 'hfinal' }); });
  }
  var ACT = {
    start1: function () {
      var mins = Number(($('mins') || {}).value) || Math.round((V.layoutSecs || 1800) / 60), n = V.teams.length;
      ask({ title: 'Start Round 1?', text: (n ? many(n, 'team') + ' get ' : 'No team has joined yet. Teams would get ') + mins + ' minutes to build their store. The clock starts on every phone straight away.', ok: 'Start Round 1', cancel: 'Not yet' })
        .then(function (yes) { if (yes) send({ a: 'hlayout', secs: mins * 60 }); });
    },
    joinlock: function () { send({ a: 'hjoin' }).then(function (r) { if (r.ok) Kit.toast(r.joinOpen ? 'Joining is open again.' : 'Joining is locked.', 'ok'); }); },
    addtime: function (v) {
      var s = Number(v) || 0, left = Kit.timeLeft(V);
      var go = function () { send({ a: 'htime', secs: s }).then(function (r) { if (r.ok) Kit.toast((s > 0 ? 'Added ' : 'Removed ') + (Math.abs(s) >= 60 ? many(Math.abs(s) / 60, 'minute') : Math.abs(s) + ' seconds') + '.', 'ok'); }); };
      // taking away more time than is left would end the round on the spot: ask first
      if (s < 0 && left != null && left <= -s * 1000 + 1500) {
        ask({ title: 'Take away ALL the time that is left?', text: 'Only ' + Kit.fmtTime(left) + ' is left on the clock. Taking ' + many(Math.round(-s / 60), 'minute') + ' off ends ' + (V.phase === 'layout' ? 'Round 1' : 'this order') + ' for everybody right now.', ok: 'Yes, end it now', danger: true })
          .then(function (yes) { if (yes) go(); });
      } else go();
    },
    pause: function () { send({ a: 'hpause' }); },
    sales: function () { send({ a: 'hsales' }).then(function (r) { if (r.ok) Kit.toast(r.showSales ? 'Teams can now see sales per hour.' : 'Sales per hour are hidden again.', 'ok'); }); },
    lock: function () {
      var n = 0, i;
      for (i = 0; i < V.teams.length; i++) if (V.teams[i].placed < 24) n++;
      ask({ title: 'Lock all layouts now?', text: 'Round 1 ends for everybody.' + (n ? ' ' + many(n, 'team has', 'teams have') + ' not placed all 24 products yet.' : ' Every team has placed all 24 products.'), ok: 'Lock layouts' })
        .then(function (yes) { if (yes) send({ a: 'hlock' }); });
    },
    reopen: function () {
      ask({ title: 'Reopen layouts for 5 minutes?', text: 'Every team can move products again. Penalties are counted again when the 5 minutes are over.', ok: 'Reopen for 5 min' })
        .then(function (yes) { if (yes) send({ a: 'hlayout', secs: 300 }); });
    },
    // Starting an order moves the whole hall: always ask first, so a slip on the N key or a double click cannot skip ahead.
    next: function () {
      var i = nextIndex(V), from = V.phase;
      if (i == null) return goFinal();
      var name = startName(V, i);
      ask({ title: 'Start ' + name + '?', text: 'The clock starts on every phone straight away.' + (from === 'locked' ? ' After this, layouts can never be reopened.' : ''), ok: 'Start ' + name, cancel: 'Not yet' })
        .then(function (yes) {
          if (!yes || !V) return;
          // the game moved on while the box was open (another organiser screen): do not start anything on top of it
          if (V.phase !== from || nextIndex(V) !== i) { Kit.toast('The game has moved on. Nothing was started.', 'bad'); return; }
          startRound(i);
        });
    },
    end: function () {
      var left = V.stats.teams - V.stats.submitted;
      ask({ title: 'End this order now?', text: left > 0 ? many(left, 'team has', 'teams have') + ' not handed in yet and will get 0 for this order.' : 'Every team has handed in.', ok: 'End the order' })
        .then(function (yes) { if (yes) send({ a: 'hend' }); });
    },
    final: goFinal,
    replay: function () { if (V && V.phase === 'reveal') playSpot(V, true); },
    podium: function () {
      if (!V || V.phase !== 'final' || revealBusy) return;
      var left = podiumPlaces(V) - ui.finalStep;
      if (left <= 0 || Date.now() - lastRevealAt < REVEAL_GAP) return;
      var what = left === 1 ? 'the WINNER' : ordinal(left) + ' place';
      ask({ title: 'Reveal ' + what + '?', text: 'It shows here and on every phone at the same moment.', ok: 'Reveal ' + what, cancel: 'Not yet' })
        .then(function (yes) { if (yes) revealPodium(); });
    },
    party: function () { Kit.sound('fanfare'); Kit.confetti({ ms: 4000, count: 300 }); },
    drawer: function () { setDrawer(!ui.drawer); },
    help: function () { var h = $('help'); show(h, h.hidden); },
    rules: function () {
      var r = $('rules');
      if (r.hidden && (!V || V.phase !== 'lobby')) return;
      if (r.hidden) put($('rulesBody'), rulesHtml());
      show(r, r.hidden);
    },
    mute: function () { Kit.mute(!Kit.mute()); txt($('muteBtn'), Kit.mute() ? '🔇 Sound off' : '🔊 Sound on'); if (!Kit.mute()) Kit.sound('pop'); },
    fs: function () {
      var d = document, e = d.documentElement;
      try {
        if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
        else (e.requestFullscreen || e.webkitRequestFullscreen).call(e);
      } catch (err) { Kit.toast('Full screen is not possible in this browser. Try the F11 key.', 'bad'); }
    },
    jump: function (v) {
      var i = Number(v), r = V.rounds[i];
      if (!r) return;
      var running = V.phase === 'order';
      ask({ title: 'Start ' + r.label + '?', text: '“' + r.title + '” goes to every phone and its clock starts.' + (running ? ' The order that is running now is closed first.' : ''), ok: 'Start ' + r.label })
        .then(function (yes) { if (yes) startRound(i).then(function (x) { if (x.ok) setDrawer(false); }); });
    },
    timer: function () {
      var on = V.timer !== false, live = V.phase === 'layout' || V.phase === 'order';
      ask({
        title: on ? 'Switch the clock off?' : 'Switch the clock on?',
        text: on ? 'Rounds will only end when you end them.' + (live ? ' The running clock is removed.' : '')
                 : 'Rounds end by themselves again.' + (live ? ' The clock of the running round starts again from full time.' : ''),
        ok: on ? 'Clock off' : 'Clock on'
      }).then(function (yes) { if (yes) send({ a: 'htimer' }); });
    },
    demo: function () {
      if (V.demo) return send({ a: 'hdemo' }, 'Practice mode is off. Every team gets one try per order.');
      ask({ title: 'Switch practice mode on?', text: 'Practice only - teams can retry an order as often as they like. Never use this in the real competition.', ok: 'Practice mode on', danger: true })
        .then(function (yes) { if (yes) send({ a: 'hdemo' }); });
    },
    msgclear: function () { send({ a: 'hmsg', text: '' }, 'Message cleared.'); },
    adjust: function (id) {
      var t = teamById(id);
      if (!t) return;
      ask({
        title: 'Adjust points: ' + t.name, text: 'The team has ' + t.pts + ' points now. The team can see the reason.', ok: 'Apply',
        fields: [{ name: 'pts', label: 'Points to add. Use a minus sign to take points away.', type: 'number', placeholder: 'for example 20 or -20', max: 5 },
                 { name: 'why', label: 'Reason (60 letters at most)', max: 60, placeholder: 'for example: phone crashed in Order 3' }],
        check: function (x) {
          var p = Number(String(x.pts).replace(/\s+/g, '').replace('−', '-'));
          if (!/\d/.test(x.pts) || !isFinite(p) || p !== Math.round(p) || !p || Math.abs(p) > 1000) return 'Type a whole number between -1000 and 1000, not 0.';
          if (!String(x.why).trim()) return 'Give a short reason.';
          return '';
        }
      }).then(function (x) {
        if (!x) return;
        var p = Number(String(x.pts).replace(/\s+/g, '').replace('−', '-'));
        send({ a: 'hadjust', tid: id, pts: p, why: String(x.why).trim() }, (p > 0 ? '+' : '') + p + ' points for ' + t.name + '.');
      });
    },
    pin: function (id) {
      var t = teamById(id);
      if (!t) return;
      ask({
        title: 'New PIN for ' + t.name, ok: 'Set the new PIN',
        text: 'For a team that forgot its PIN and cannot get back in. Ask the team which 4 digits they want and type them here. Phones of this team that are still in stay in. Careful: the hall can read this box if this screen is on the projector.',
        fields: [{ name: 'pin', label: 'New team PIN (exactly 4 digits)', type: 'number', max: 4, placeholder: '4 digits' }],
        check: function (x) { return /^\d{4}$/.test(String(x.pin).trim()) ? '' : 'Type exactly 4 digits.'; }
      }).then(function (x) {
        if (x) send({ a: 'hpin', tid: id, pin: String(x.pin).trim() }, 'New PIN set for ' + t.name + '. They join with their team name and the new PIN.');
      });
    },
    redo: function (id) {
      var t = teamById(id), R = V.round;
      if (!t || !R) return;
      ask({ title: 'Let ' + t.name + ' redo ' + R.label + '?', text: 'Their result for this order is deleted.' + (V.phase === 'order' ? ' They can hand in again while the order is running.' : ' The order is already closed, so they score 0 for it unless you play it again.'), ok: 'Delete the result', danger: true })
        .then(function (yes) { if (yes) send({ a: 'hredo', tid: id }, 'Result deleted for ' + t.name + '.'); });
    },
    kick: function (id) {
      var t = teamById(id);
      if (!t) return;
      ask({ title: 'Remove ' + t.name + '?', text: 'The team, its layout and its score are deleted and its phones are signed out. This cannot be undone.', ok: 'Remove the team', danger: true })
        .then(function (yes) { if (yes) send({ a: 'hkick', tid: id }, t.name + ' was removed.'); });
    },
    reset: function () {
      ask({ title: 'Reset the whole game?', text: 'This wipes all ' + many(V.teams.length, 'team') + ', every layout and every score. All phones are signed out. This cannot be undone.', ok: 'Go on…', danger: true })
        .then(function (yes) {
          if (!yes) return null;
          return ask({ title: 'Are you really sure?', text: 'Everything is deleted. Only the organiser PIN stays.', type: 'RESET', ok: 'Wipe everything', danger: true });
        })
        .then(function (yes) {
          if (!yes) return;
          send({ a: 'hreset' }, 'The game was reset. The lobby is empty.').then(function (r) { if (r.ok) { backupStore.clear(); setDrawer(false); seenNames = null; lobbyShown = -1; boardSig = null; shownPts = Object.create(null); spotSig = null; } });
        });
    },
    restorelast: function () {
      var b = backupStore.get();
      if (b && b.game) confirmRestore(b.game, b.at, true);
    },
    discardcopy: function () {
      ask({ title: 'Throw the old safety copy away?', text: 'The copy of the earlier game is deleted from this browser. It cannot be put back afterwards.', ok: 'Throw it away', danger: true })
        .then(function (yes) { if (yes) { backupStore.clear(); backupDirty = true; if (V) renderSafety(V); } });
    },
    restorefile: function () { var f = $('restoreFile'); f.value = ''; f.click(); },
    signout: function () {
      ask({ title: 'Sign out of this screen?', text: 'The game keeps running. You need the organiser PIN to come back.', ok: 'Sign out' })
        .then(function (yes) { if (yes) { keyStore.clear(); showLogin(''); } });
    }
  };

  // ------------------------------------------------------------------ safety copy
  // A free cloud host forgets the whole game when it restarts. So this screen fetches the whole game every few seconds
  // and keeps it in this browser. If the server comes back empty, the organiser is asked whether to put the copy back.
  var backupStore = Kit.store('dsb_backup');     // {at, boot, teams, phase, ri, game}
  var backupDirty = false, backupBusy = false, backupFail = false, backupAt = 0, askedBoot = '';
  var BACKUP_MS = 8000, BACKUP_OLD = 24 * 3600 * 1000;
  // true while this browser holds a copy of an earlier game that is worth more than what the server has now
  function oldCopy(v) {
    var b = backupStore.get();
    if (!b || !b.game || !b.boot || !v || !v.boot || b.boot === v.boot) return null;
    if (v.phase !== 'lobby' || !(b.teams > v.teams.length) || Date.now() - b.at > BACKUP_OLD) return null;
    return b;
  }
  function clockTime(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function whereWas(g) {
    var names = { lobby: 'in the lobby', layout: 'in Round 1 (building stores)', locked: 'layouts locked', order: 'an order was running', reveal: 'showing an order\'s results', final: 'final results' };
    return names[g.phase] || g.phase;
  }
  function countTeams(g) { var n = 0, k; for (k in (g.teams || {})) if (Object.prototype.hasOwnProperty.call(g.teams, k)) n++; return n; }
  function backupTick() {
    if (!conn || !V || !hostKey || backupBusy || !V.teams.length || oldCopy(V)) return;
    if (!backupDirty && Date.now() - backupAt < 30000) return;       // nothing happened; still refresh now and then for the clock
    backupBusy = true; backupDirty = false;
    var x = new XMLHttpRequest(), boot = V.boot;
    x.open('GET', '/backup?k=' + encodeURIComponent(hostKey), true);
    x.timeout = 15000;
    x.onloadend = function () {
      backupBusy = false;
      var g = null;
      if (x.status === 200) { try { g = JSON.parse(x.responseText); } catch (e) { g = null; } }
      if (!g || !g.teams || g.boot !== boot) { backupDirty = true; return; }
      var n = countTeams(g);
      if (!n) return;
      backupFail = !backupStore.set({ at: Date.now(), boot: g.boot, teams: n, phase: g.phase, ri: g.ri, game: g });
      if (!backupFail) backupAt = Date.now();
      if (ui.drawer && V) renderSafety(V);
    };
    try { x.send(); } catch (e) { backupBusy = false; }
  }
  setInterval(backupTick, BACKUP_MS);

  function doRestore(game) {
    var x = new XMLHttpRequest();
    x.open('POST', '/restore?k=' + encodeURIComponent(hostKey), true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 30000;
    x.onloadend = function () {
      var r = null;
      try { r = JSON.parse(x.responseText); } catch (e) { r = null; }
      if (!r || !r.ok) { Kit.toast((r && r.err) || 'The game could not be put back. Check the connection and try again.', 'bad'); Kit.sound('error'); return; }
      var b = backupStore.get();
      if (b && V) { b.boot = V.boot; backupStore.set(b); }           // it is the running game again: do not offer it twice
      backupDirty = true; seenNames = null; lobbyShown = -1;
      Kit.toast('The game is back: ' + many(r.teams, 'team') + '.' + (r.paused ? ' The clock is PAUSED: press Resume when the room is ready.' : ''), 'ok');
      if (V) renderSafety(V);
    };
    try { x.send(JSON.stringify(game)); } catch (e) { Kit.toast('The game could not be put back.', 'bad'); }
  }
  function confirmRestore(game, at, restarted) {
    var n = countTeams(game), now = V ? V.teams.length : 0;
    return ask({
      title: restarted ? 'Put the game back?' : 'Replace the game with this file?',
      text: 'Safety copy from ' + clockTime(at) + ': ' + many(n, 'team') + ', ' + whereWas(game) + '. ' +
        (now ? 'It REPLACES what is on the server now (' + many(now, 'team') + '). ' : '') +
        'Layouts, scores and team PINs come back. A running clock comes back paused. Phones reconnect by themselves.',
      ok: 'Put the game back', cancel: 'Not now', danger: !!now, type: now && !restarted ? 'RESTORE' : ''
    }).then(function (yes) { if (yes) doRestore(game); return !!yes; });
  }
  // called on every view: the server restarted and came back empty, and this browser still has the game
  function offerRestore(v) {
    var b = oldCopy(v);
    if (!b || askedBoot === v.boot) return;
    askedBoot = v.boot;
    Kit.sound('error');
    ask({
      title: 'The game server restarted',
      text: 'It came back EMPTY. This screen kept a safety copy from ' + clockTime(b.at) + ': ' + many(b.teams, 'team') + ', ' + whereWas(b.game) + '. ' +
        'Put the game back? Layouts, scores and team PINs come back, a running clock comes back paused, and phones reconnect by themselves.',
      ok: 'Put the game back', cancel: 'Not now'
    }).then(function (yes) {
      if (yes) doRestore(b.game);
      else Kit.toast('The safety copy is kept. You find it in the Control room.', 'ok');
      if (V) renderSafety(V);
    });
  }
  function safetyNotes(v) {
    var s = v.safety || {}, out = [];
    if (s.defaultPin) out.push('The organiser PIN is the default one from the public code. Anyone who knows it can open this screen and reset the game. Set HOST_PIN on the server before the competition.');
    if (s.orders === 'practice') out.push('These are the public PRACTICE orders: anyone can read them on GitHub. Load the secret set (ROUNDS_B64) before the competition.');
    return out;
  }
  function safetyToast(v) {
    var n = safetyNotes(v).length;
    if (n && location.protocol === 'https:') Kit.toast('Safety check: ' + many(n, 'warning') + '. Open the Control room.', 'bad');
  }
  function renderSafety(v) {
    var box = $('drSafety');
    if (!box) return;
    var h = '', notes = safetyNotes(v), b = backupStore.get(), old = oldCopy(v), k = encodeURIComponent(hostKey);
    notes.forEach(function (t) { h += '<p class="alert">⚠ ' + esc(t) + '</p>'; });
    if (!notes.length) h += '<p class="dr-tip">✓ Secret orders are loaded and the organiser PIN is not the default one.</p>';
    if (old) {
      h += '<p class="alert">A safety copy of an earlier game is waiting: ' + esc(clockTime(old.at)) + ', ' + esc(many(old.teams, 'team')) + ', ' + esc(whereWas(old.game)) + '. No new copy is made until you decide.</p>' +
        '<button type="button" class="btn small" data-act="restorelast" title="Bring the teams, layouts and scores of that game back">↩ Put that game back…</button> ' +
        '<button type="button" class="btn2 small" data-act="discardcopy" title="Delete the old copy and start keeping copies of this game">Throw it away…</button>';
    } else if (backupFail) {
      h += '<p class="alert">⚠ This browser could not keep the safety copy (no room left). Use the download button after every round instead.</p>';
    } else if (b && b.boot === v.boot) {
      h += '<p class="dr-tip">✓ Safety copy kept in this browser: ' + esc(clockTime(b.at)) + ', ' + esc(many(b.teams, 'team')) + '. Keep this screen open: it is what brings the game back if the server restarts.</p>';
    } else {
      h += '<p class="dr-tip">A safety copy is kept in this browser once the first team has joined. Keep this screen open during the game.</p>';
    }
    h += '<div class="dr-tools"><a class="btn2 small" href="/backup?dl=1&k=' + k + '" download="dark-store-blitz-safety-copy.json" title="Save the whole game as a file on this laptop">⬇ Download safety copy</a> ' +
      '<a class="btn2 small" href="/export.csv?k=' + k + '" download="dark-store-blitz-results.csv" title="Save the table as it stands now, for Excel">⬇ Download results (CSV)</a> ' +
      '<button type="button" class="btn2 small" data-act="restorefile" title="Put a downloaded safety copy back">⬆ Restore from a file…</button></div>';
    put(box, h);
  }
  $('restoreFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var g = null;
      try { g = JSON.parse(String(rd.result)); } catch (e) { g = null; }
      if (!g || !g.teams || typeof g.phase !== 'string') { Kit.toast('That file is not a safety copy of this game.', 'bad'); return; }
      confirmRestore(g, Number(g.savedAt) || Date.now(), false);
    };
    rd.readAsText(f);
  });

  // ------------------------------------------------------------------ clicks, typing, keys
  document.addEventListener('click', function (ev) {
    var t = ev.target, act = null, row = null, d = null;
    while (t && t !== document) {
      if (t.getAttribute) {
        if ((d = t.getAttribute('data-dlg'))) break;
        if ((act = t.getAttribute('data-act'))) break;
        if ((row = t.getAttribute('data-row'))) break;
      }
      t = t.parentNode;
    }
    // the second click of a double click lands on the dark background: it must not close the box that the first click opened
    if (d) { ev.preventDefault(); if (Date.now() - dlgAt > 400) closeDialog(null); return; }
    if (act) {
      if (t.disabled || !ACT[act]) return;
      if (t.tagName === 'BUTTON') { ev.preventDefault(); try { t.blur(); } catch (e) {} }
      if (!V && act !== 'help') return;
      ACT[act](t.getAttribute('data-v'));
      return;
    }
    if (row && V) { ui.open = ui.open === row ? null : row; ui.hold = false; renderTeams(V); }
  });
  // While the mouse is down inside the team table the table is not redrawn, so a click always lands on its button.
  $('tBody').addEventListener('pointerdown', function () { ui.hold = true; });
  document.addEventListener('pointerup', function () { if (ui.hold) setTimeout(function () { ui.hold = false; if (V && ui.drawer) renderTeams(V); }, 0); });
  document.addEventListener('pointercancel', function () { ui.hold = false; });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'mins') ui.mins = Number(t.value) || 0;
    else if (t.id === 'tSort') { ui.sort = t.value; if (V) renderTeams(V); }
  });
  $('tSearch').addEventListener('input', function () { ui.search = this.value.trim(); if (V) renderTeams(V); });
  $('msgForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var text = $('msgText').value.replace(/\s+/g, ' ').trim();
    if (!text) { Kit.toast('Type a message first.', 'bad'); return; }
    send({ a: 'hmsg', text: text }, 'Message sent to every phone.').then(function (r) { if (r.ok) $('msgText').value = ''; });
  });

  document.addEventListener('keydown', function (ev) {
    var k = ev.key, t = ev.target, tag = t && t.tagName;
    if (k === 'Escape') {
      if (dlgDone) closeDialog(null);
      else if (!$('help').hidden) show($('help'), false);
      else if (!$('rules').hidden) show($('rules'), false);
      else if (ui.drawer) setDrawer(false);
      return;
    }
    // A question box is open: only Enter (yes) and Esc (no) answer it. Space on its buttons does nothing, and N is ignored,
    // so pressing N twice (or N then the pause key) can never confirm by accident.
    if (dlgDone) {
      if ((k === ' ' || k === 'Spacebar') && tag === 'BUTTON') ev.preventDefault();
      // a held Enter key never answers a box: one long press must not open a question and say yes to it
      else if (k === 'Enter' && ev.repeat) ev.preventDefault();
      // Enter still means yes when a click on the dark background took the focus out of the box
      else if (k === 'Enter' && !$('dlg').contains(t)) { ev.preventDefault(); if (!ev.repeat && dlgCheck) dlgCheck(); }
      return;
    }
    if (!V || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (k === ' ' || k === 'Spacebar') {
      ev.preventDefault();
      if (tag === 'BUTTON' || tag === 'A') { try { t.blur(); } catch (e) {} }
      if (ev.repeat) return;
      if ((V.phase === 'layout' || V.phase === 'order') && V.timer !== false && (V.pausedLeft > 0 || V.endsAt > 0)) ACT.pause();
      else Kit.toast('No clock is running.', 'bad');
    } else if (k === 'n' || k === 'N') {
      if (ev.repeat || !$('help').hidden) return;
      var b = $('dockMain').querySelector('[data-primary]');
      if (b && !b.disabled) { ev.preventDefault(); ACT[b.getAttribute('data-act')](b.getAttribute('data-v')); }
    } else if (k === 'r' || k === 'R') {
      if (!ev.repeat && $('help').hidden && !ui.drawer) ACT.rules();
    } else if (k === 'f' || k === 'F') {
      if (!ev.repeat) ACT.fs();
    }
  });
  // a Space key-up must never press a button that happens to have the focus
  document.addEventListener('keyup', function (ev) {
    var t = ev.target;
    if ((ev.key === ' ' || ev.key === 'Spacebar') && t && t.tagName === 'BUTTON' && (dlgDone || t.getAttribute('data-act'))) ev.preventDefault();
  });

  // ------------------------------------------------------------------ go
  var saved = keyStore.get();
  if (saved && typeof saved.k === 'string' && saved.k) start(saved.k); else showLogin('');
})();
