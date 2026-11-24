/* DARK STORE BLITZ - kit.js : the shared browser toolkit for the player screen and the organiser screen.
   Load order in a page:  <link rel="stylesheet" href="/kit.css">  <script src="/game.js"></script>  <script src="/kit.js"></script>
   Everything lives on window.Kit. No dependencies, no network requests except /api and /events. Plain ES5 + Promise.

   ============================== API REFERENCE ==============================

   ---- 1. TALKING TO THE SERVER ----
   Kit.post(body) -> Promise<reply>
       One POST /api with a JSON body, no key added. Use it for {a:'join',...} and {a:'hlogin',...}.
       NEVER rejects. On a network problem it resolves {ok:false, err:'No connection...', net:true}.

   Kit.connect({key, role:'player'|'host', onView(view), onStatus(status), onGone()}) -> conn
       Opens the live stream GET /events?k=key and keeps it alive (reconnects with backoff + jitter; while the stream is
       down it polls POST /api {a:'state'} (player) or {a:'hstate'} (host) every ~2.5 s). The server sends an "hb" event
       every 5 s; when nothing at all arrives for 13 s the stream counts as dead and is opened again.
         onView(view)    called with the PLAYER VIEW / HOST VIEW every time its content really changed (the 'now' field
                         alone changing does not count). Render from this, and only from this.
         onStatus(s)     'live' (stream is up) | 'polling' (stream down, server still answers) | 'offline' (server not reachable)
         onGone()        the key is no longer known (team kicked / game reset / host key wiped). The connection is already
                         closed when this is called: forget the stored key and show the join / PIN form.
       conn.send(body) -> Promise<reply>   POST /api with {k:key} merged in. If the reply is a view it is applied through
                         onView (an older reply never overwrites a newer view). Resolves with the raw reply; never rejects.
                         Use reply.ok / reply.err / reply.need for feedback, but draw the screen from onView.
       conn.view()     the newest view (or null)      conn.status()   the current status string
       conn.refresh()  ask for a fresh view right now (also done automatically when the phone wakes up)
       conn.close()    stop everything (no more callbacks)

   Kit.serverNow()        server clock in ms (kept in sync from view.now)
   Kit.timeLeft(view)     ms left on the running timer. Paused -> the frozen view.pausedLeft. No timer running or
                          timers switched off -> null.
   Kit.fmtTime(ms)        "m:ss" (rounds up, so 0:00 really means over). null -> "--:--"
   Kit.clock(el, getView, {hurry:10, sound:false, onZero}) -> {stop(), tick()}
       Keeps el.textContent = fmtTime(timeLeft(getView())) 5 times a second. Adds class "hurry" in the last `hurry`
       seconds, "paused" while paused, "noclock" when there is no timer. sound:true beeps each second of the hurry time.
       onZero() fires once when the clock hits 0:00. Call stop() when you throw the element away.

   ---- 2. SMALL HELPERS ----
   Kit.esc(text)          escape for innerHTML (also safe inside "double quoted" attributes)
   Kit.toast(text, kind)  short message at the top. kind: 'ok' | 'bad' | undefined
   Kit.sound(name)        tick | step | pick | pop | done | buzzer | fanfare | error. Silent until the first tap
                          (unlocked automatically on the first tap anywhere), silent on failure, silent when muted.
   Kit.mute(on)           Kit.mute(true/false) sets + remembers it; Kit.mute() just returns the current setting.
   Kit.vibrate(ms)        ms may be a number or a pattern array. Silent where not supported.
   Kit.store(name) -> {get(), set(obj), clear()}    localStorage as JSON; get() gives null when missing or blocked.
   Kit.reducedMotion()    true when the device asks for less animation
   Kit.legendHtml()       the small colour legend for under a map (HTML string)
   Kit.tagHtml(product)   '<span class="tag t-cold">COLD</span>' for a Game.product(), '' if it has no tag

   ---- 3. THE WAREHOUSE MAP ----
   var map = Kit.createMap(containerEl, {onCell(id, kind, info), onPick(productNumber, cellId), onArrive(cellId), sound:false})
       Builds the 10x10 warehouse ONCE inside containerEl (appended; give it an empty div). It takes the width of the
       container and stays square; everything inside scales with it (phone to projector).
       onCell fires when a walkway, the start square or a shelf-type square is tapped:
           id   'B6'      kind  Game.kindOf(id): 'walk' | 'start' | 'shelf' | 'spare' | 'cold' | 'chem'
           info {item: layout[id] or null, blocked: true if a pallet is on it}
       onPick fires each time the picker collects an order item (in step with the animation). sound:true also plays
       Kit.sound('pick') at that moment. onArrive fires for every square the picker reaches.

   map.update({layout, rule, items, picked, route, edit, ghost, sel, warn}) -> map
       MERGES: only the keys you pass change, the rest keep their last value. Cheap to call often - it only patches
       classes and text of the existing squares, so running animations are never restarted.
         layout  {cell:{p,l}}              what is stocked where (team.layout)
         rule    the round object or null  rule.oneWay -> animated arrows down aisle 6; rule.blocked -> pallets drop in
         items   [productNumbers]          the order being picked: those shelves pulse until picked, other stock is dimmed
         route   ['A3','B3',...] or null   every square walked so far, starting at 'A3'. null hides the picker.
                   - grows (old route is the beginning of the new one): the picker WALKS the new squares
                   - anything else (undo, clear, another trip): the picker jumps there at once
         picked  {productNumber:1} or null normally leave it out: the map works it out itself from the squares the picker
                                           has reached, so shelves tick off exactly when the picker gets there
         ghost   route, or [route, route2], or null   dashed line(s), e.g. the shortest possible route (best.path, best.path2)
         edit    true in Round 1: empty shelf squares invite a tap
         sel     a cell id to highlight (the square being edited), or null
         warn    [cell ids] to mark with a pink warning corner (e.g. squares that cause penalties), or null
   map.play(route, {speed, maxMs, delay, ghost, layout, items, rule}) -> Promise<boolean>
       Replays a whole route from its first square with the walking + picking animation (result screens, projector).
       speed = ms per square (default 90); the whole replay never takes longer than maxMs (default 7000).
       Other keys are applied like update() first. Resolves true when the replay finished, false if it was cut short by
       another play(), by an update() that passes a DIFFERENT route, or by destroy(). While a replay runs you may keep
       calling update() without a `route` key (or with the very same route) - that does not disturb it.
       With reduced motion (or a hidden tab) it shows the end result at once and still resolves true.
   map.walking()   true while the picker is still moving         map.el   the root element (class "map")
   map.destroy()   removes the map and stops every timer/listener

   Kit.extendRoute(route, cellId, rule) -> {route, added} | {err}
       The "tap to walk" logic. Tap on a walkway/start square: walk there by the shortest legal way. Tap on a shelf-type
       square: walk to the nearest square next to it. Returns a NEW route array (added = squares added, 0 if already
       there), or {err:'plain words'} when it cannot be done. Typical use in a player screen:
           onCell: function (id) { var x = Kit.extendRoute(route, id, round); if (x.err) return Kit.toast(x.err, 'bad');
                                   route = x.route; map.update({route: route}); }
       Done check: Game.isDone(route, items, layout, round).  Undo: route = route.slice(0, -1) (or back to a saved length).

   ---- 4. SHOW-OFF HELPERS ----
   Kit.countUp(el, toNumber, {ms:700, from, prefix:'', suffix:''}) -> Promise
       Rolls the number in el from what it shows now (or `from`) up/down to toNumber.
   Kit.confetti({count, ms:2800}) -> Promise      full-screen burst in the game colours; removes itself.
   Kit.flipList(containerEl, renderFn, {ms:500}) -> Promise
       Animates rows of a list to their new places (FLIP). Every row (direct child of containerEl) needs a stable
       data-key attribute (e.g. the team name). renderFn(containerEl) must update the list in any way you like
       (setting innerHTML is fine). Rows that kept their key glide from the old place to the new one; rows that climbed
       get class "flip-up" for the length of the move; brand-new rows get class "flip-in". Example:
           Kit.flipList(ol, function () { ol.innerHTML = board.map(function (t) {
               return '<li data-key="' + Kit.esc(t.name) + '"><span>' + Kit.esc(t.name) + '</span><b>' + t.pts + '</b></li>'; }).join(''); });

   ---- kit.css gives you (see the file for the full list) ----
   tokens: --tape --ink --rush --frz --ice --chem --floor --go --disp --body --mono
   .btn .btn2 (+ .small .wide) .link .card .warn .alert .num .kick .tip .tag .t-cold/.t-chemical/.t-fragile/.t-heavy
   .top (.who .sc .q .tm) .bar .scrim .sheet (.sheet-head .x .sheet-body .sheet-foot) .toast .board (li.you) .bill
   .legend .pill .conn (.conn.live/.polling/.offline) .hurry .off .field (label + input) .wait .logo
   animations you can put on anything: .a-pop .a-shake .a-rise .a-flash .a-pulse
   =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document || null;
  var Game = root.Game || null;
  if (!Game && typeof module === 'object' && module.exports) { try { Game = require('../game.js'); } catch (e) { Game = null; } }

  // ------------------------------------------------------------------ tiny utilities
  function call(fn) {
    if (typeof fn !== 'function') return undefined;
    try { return fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
    catch (e) { if (root.console && root.console.error) root.console.error(e); return undefined; }
  }
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function hiddenDoc() { return !!(doc && doc.hidden); }
  function raf(fn) {
    if (root.requestAnimationFrame) return root.requestAnimationFrame(function () { fn(); });
    return setTimeout(fn, 16);
  }
  function caf(id) {
    if (!id) return;
    if (root.cancelAnimationFrame) root.cancelAnimationFrame(id); else clearTimeout(id);
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function toggle(e, cls, on) {
    if (on) e.classList.add(cls); else e.classList.remove(cls);
  }
  function sameArr(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return ESC[ch]; }); }

  // ------------------------------------------------------------------ server clock
  var clockOff = 0, clockSet = false;
  function syncClock(serverMs) {
    if (typeof serverMs !== 'number' || !isFinite(serverMs)) return;
    var off = serverMs - Date.now();
    // A message always arrives a little late, so the largest offset seen is the most accurate one.
    if (!clockSet || off > clockOff || Math.abs(off - clockOff) > 3000) { clockOff = off; clockSet = true; }
    else clockOff += (off - clockOff) * 0.05;
  }
  function serverNow() { return Date.now() + clockOff; }
  function timeLeft(view) {
    if (!view) return null;
    if (view.pausedLeft > 0) return view.pausedLeft;
    if (view.timer === false || !(view.endsAt > 0)) return null;
    return Math.max(0, view.endsAt - serverNow());
  }
  function fmtTime(ms) {
    if (ms == null || !isFinite(ms)) return '--:--';
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  // ------------------------------------------------------------------ POST /api
  var NET_ERR = 'No connection. Check the Wi-Fi and try again.';
  // resolves {reply, text}; never rejects
  function rawPost(body, ms) {
    return new Promise(function (resolve) {
      var done = false, x, timer = 0;
      function fin(reply, text) {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve({ reply: reply, text: text || '' });
      }
      function fail() { fin({ ok: false, err: NET_ERR, net: true }); }
      try {
        x = new root.XMLHttpRequest();
        x.open('POST', '/api', true);
        x.setRequestHeader('Content-Type', 'application/json');
        x.onreadystatechange = function () {
          if (x.readyState !== 4) return;
          var text = '', r = null;
          try { text = x.responseText || ''; } catch (e) { text = ''; }
          if (!x.status || !text) return fail();
          try { r = JSON.parse(text); } catch (e) { r = null; }
          if (!r || typeof r !== 'object') return fin({ ok: false, err: 'The server is busy. Try again.', net: true });
          if (r.ok !== true && !r.err) r.err = 'That did not work. Try again.';
          fin(r, text);
        };
        x.onerror = fail; x.onabort = fail; x.ontimeout = fail;
        timer = setTimeout(function () { try { x.abort(); } catch (e) {} fail(); }, ms || 10000);
        x.send(JSON.stringify(body || {}));
      } catch (e) { fail(); }
    });
  }
  function post(body) { return rawPost(body, 10000).then(function (r) { return r.reply; }); }

  // ------------------------------------------------------------------ live connection
  function stripNow(text) { return String(text).replace(/"now":-?\d+(\.\d+)?,?/, ''); }

  function connect(o) {
    o = o || {};
    var key = String(o.key || ''), stateAct = o.role === 'host' ? 'hstate' : 'state';
    var closed = false, es = null, live = false, status = '', view = null;
    var lastNow = 0, lastSig = null, lastMsgAt = 0, pollOk = true;
    var backoff = 0, reTimer = 0, pollTimer = 0, pollBusy = false, safeTimer = 0;

    function setStatus(s) { if (closed || s === status) return; status = s; call(o.onStatus, s); }
    function refreshStatus() { setStatus(live ? 'live' : pollOk ? 'polling' : 'offline'); }

    // returns true if this view was shown (or is the same as the one shown)
    function apply(v, text) {
      if (closed || !v || v.ok !== true || typeof v.phase !== 'string') return false;
      var n = typeof v.now === 'number' ? v.now : 0;
      if (n && lastNow && n < lastNow && lastNow - n < 60000) return false;     // older than what is on screen
      if (n) lastNow = n;
      var sig = stripNow(text);
      if (sig === lastSig) return true;
      lastSig = sig; view = v;
      call(o.onView, v);
      return true;
    }
    function gone() {
      if (closed) return;
      shut();
      call(o.onGone);
    }
    function handle(r) {                    // r = {reply, text} from rawPost
      if (closed) return;
      var reply = r.reply;
      if (reply.gone || reply.badPin) return gone();
      if (reply.ok === true && typeof reply.phase === 'string') { syncClock(reply.now); apply(reply, r.text); }
    }

    // ---- stream
    function dropStream() {
      var s = es;
      es = null; live = false;
      if (s) { try { s.close(); } catch (e) {} }
    }
    function openStream() {
      if (closed || es || !root.EventSource) return;
      var src;
      try { src = new root.EventSource('/events?k=' + encodeURIComponent(key)); }
      catch (e) { startPolling(); scheduleRe(); return; }
      es = src;
      src.addEventListener('view', function (ev) {
        if (es !== src || closed) return;
        var v = null;
        try { v = JSON.parse(ev.data); } catch (e) { v = null; }
        if (!v) return;
        lastMsgAt = Date.now(); backoff = 0;
        syncClock(v.now);
        live = true; pollOk = true;
        stopPolling(); refreshStatus();
        apply(v, ev.data);
      });
      src.addEventListener('gone', function () { if (es === src) gone(); });
      // the server's "still here" signal (every 5 s). Without it a dead line would look exactly like a quiet one.
      src.addEventListener('hb', function () { if (es === src && !closed) lastMsgAt = Date.now(); });
      src.onerror = function () {
        if (es !== src || closed) return;
        dropStream();
        startPolling(); scheduleRe();
      };
    }
    function scheduleRe() {
      if (closed || reTimer || !root.EventSource) return;
      var wait = Math.min(8000, 1000 * Math.pow(2, backoff)) * (0.6 + Math.random() * 0.8);
      backoff = Math.min(backoff + 1, 6);
      reTimer = setTimeout(function () { reTimer = 0; openStream(); }, wait);
    }
    function reconnectNow() {
      if (closed) return;
      clearTimeout(reTimer); reTimer = 0; backoff = 0;
      dropStream();
      openStream();
      if (!es) startPolling();
      else setTimeout(function () { if (!closed && !live) startPolling(); }, 3000);     // the new stream is slow too: poll next to it
    }

    // ---- polling fallback
    function pollOnce() {
      if (closed || pollBusy) return Promise.resolve(false);
      pollBusy = true;
      return rawPost({ a: stateAct, k: key }, 7000).then(function (r) {
        pollBusy = false;
        if (closed) return false;
        var bad = !!r.reply.net;
        if (!live) { pollOk = !bad; refreshStatus(); }
        handle(r);
        return !bad;
      });
    }
    function startPolling() {
      if (closed || pollTimer) return;
      function loop() {
        pollTimer = 0;
        if (closed || live) return;
        pollOnce().then(function () {
          if (closed || live || pollTimer) return;
          pollTimer = setTimeout(loop, 2200 + Math.random() * 800);
        });
      }
      pollTimer = setTimeout(loop, 150 + Math.random() * 900);     // spread out: 200 phones must not all ask at once
    }
    function stopPolling() { clearTimeout(pollTimer); pollTimer = 0; }

    // ---- safety net: a stream can die silently (phone slept, Wi-Fi changed). The server sends a small "hb" event
    //      every 5 s. If NOTHING arrived for 13 s the stream is dead: open a new one and ask for the news right away.
    var DEAD_MS = 13000;
    function safety() {
      if (closed || !live || hiddenDoc() || Date.now() - lastMsgAt < DEAD_MS) return;
      reconnectNow();
      pollOnce();
    }
    function onWake() {
      if (closed || hiddenDoc()) return;
      if (!es || es.readyState === 2 || !live) reconnectNow();
      pollOnce();
    }
    function onOnline() { if (!closed) { reconnectNow(); pollOnce(); } }

    function shut() {
      closed = true;
      dropStream(); stopPolling();
      clearTimeout(reTimer); reTimer = 0;
      clearInterval(safeTimer); safeTimer = 0;
      if (doc) doc.removeEventListener('visibilitychange', onWake);
      if (root.removeEventListener) { root.removeEventListener('online', onOnline); root.removeEventListener('pageshow', onWake); }
    }

    function send(body) {
      if (closed) return Promise.resolve({ ok: false, err: 'This screen is no longer connected. Reload the page.' });
      var b = {}, k;
      for (k in (body || {})) if (Object.prototype.hasOwnProperty.call(body, k)) b[k] = body[k];
      b.k = key;
      return rawPost(b, 10000).then(function (r) { handle(r); return r.reply; });
    }

    if (doc) doc.addEventListener('visibilitychange', onWake);
    if (root.addEventListener) { root.addEventListener('online', onOnline); root.addEventListener('pageshow', onWake); }
    safeTimer = setInterval(safety, 4000 + Math.random() * 2000);
    if (root.EventSource) openStream(); else startPolling();
    // if the stream has not delivered within 3 s, start polling next to it (slow or blocked streams)
    setTimeout(function () { if (!closed && !live) startPolling(); }, 3000);

    return {
      send: send,
      close: shut,
      refresh: function () { return pollOnce(); },
      view: function () { return view; },
      status: function () { return status; }
    };
  }

  // ------------------------------------------------------------------ localStorage
  function store(name) {
    return {
      get: function () {
        try { var s = root.localStorage.getItem(name); return s ? JSON.parse(s) : null; } catch (e) { return null; }
      },
      set: function (obj) {
        try { root.localStorage.setItem(name, JSON.stringify(obj)); return true; } catch (e) { return false; }
      },
      clear: function () { try { root.localStorage.removeItem(name); } catch (e) {} }
    };
  }

  // ------------------------------------------------------------------ toast
  var toastEl = null, toastT = 0;
  function toast(text, kind) {
    if (!doc || !doc.body) return;
    if (!toastEl) {
      toastEl = el('div', 'toast');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      doc.body.appendChild(toastEl);
    }
    text = String(text == null ? '' : text);
    toastEl.textContent = text;
    toastEl.className = 'toast' + (kind ? ' toast-' + kind : '');
    void toastEl.offsetWidth;                       // so the slide-in runs again
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { if (toastEl) toastEl.classList.remove('show'); }, Math.max(2200, Math.min(6000, 1200 + text.length * 55)));
  }

  // ------------------------------------------------------------------ sound + vibration
  var actx = null, muteStore = store('dsb_mute'), muted = !!muteStore.get(), audioHooked = false;
  // each note: [frequency, start s, length s, wave, volume, slide-to frequency]
  var SOUNDS = {
    tick:    [[880, 0, 0.05, 'square', 0.05]],
    step:    [[300, 0, 0.035, 'triangle', 0.05]],
    pop:     [[420, 0, 0.09, 'sine', 0.14, 840]],
    pick:    [[660, 0, 0.07, 'triangle', 0.16], [990, 0.07, 0.12, 'triangle', 0.16]],
    done:    [[523, 0, 0.1, 'triangle', 0.16], [659, 0.1, 0.1, 'triangle', 0.16], [784, 0.2, 0.1, 'triangle', 0.16], [1047, 0.3, 0.26, 'triangle', 0.18]],
    error:   [[220, 0, 0.11, 'square', 0.08], [165, 0.12, 0.18, 'square', 0.08]],
    buzzer:  [[150, 0, 0.55, 'sawtooth', 0.16], [113, 0, 0.55, 'square', 0.08]],
    fanfare: [[523, 0, 0.12, 'square', 0.09], [523, 0.14, 0.12, 'square', 0.09], [523, 0.28, 0.12, 'square', 0.09], [659, 0.42, 0.3, 'square', 0.09],
              [587, 0.74, 0.12, 'square', 0.09], [659, 0.88, 0.12, 'square', 0.09], [784, 1.02, 0.5, 'square', 0.1],
              [392, 0.42, 0.3, 'triangle', 0.12], [523, 1.02, 0.5, 'triangle', 0.12]]
  };
  function audio(create) {
    if (actx || !create) return actx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { actx = null; }
    return actx;
  }
  function unlockAudio() {
    var a = audio(true);
    if (!a) return;
    try {
      if (a.state !== 'running' && a.resume) { var p = a.resume(); if (p && p.catch) p.catch(function () {}); }
      if (!unlockAudio.primed) {                    // old iOS needs one sound started inside a tap
        var b = a.createBuffer(1, 1, 22050), s = a.createBufferSource();
        s.buffer = b; s.connect(a.destination); s.start(0);
        unlockAudio.primed = true;
      }
    } catch (e) {}
  }
  function hookAudio() {
    if (audioHooked || !doc) return;
    audioHooked = true;
    ['touchend', 'pointerup', 'click', 'keydown'].forEach(function (t) {
      doc.addEventListener(t, function () { if (!actx || actx.state !== 'running') unlockAudio(); }, true);
    });
  }
  function sound(name) {
    if (muted) return;
    try {
      var notes = SOUNDS[name], a = audio(false);
      if (!notes || !a || a.state !== 'running') return;
      var t0 = a.currentTime + 0.01;
      notes.forEach(function (n) {
        var osc = a.createOscillator(), g = a.createGain(), t = t0 + n[1], d = n[2];
        osc.type = n[3] || 'sine';
        osc.frequency.setValueAtTime(n[0], t);
        if (n[5]) osc.frequency.exponentialRampToValueAtTime(n[5], t + d);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(n[4] || 0.1, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(g); g.connect(a.destination);
        osc.start(t); osc.stop(t + d + 0.03);
      });
    } catch (e) {}
  }
  function mute(on) {
    if (on === undefined) return muted;
    muted = !!on;
    if (muted) muteStore.set(1); else muteStore.clear();
    return muted;
  }
  function vibrate(ms) {
    try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(ms); } catch (e) {}
  }

  // ------------------------------------------------------------------ small HTML bits
  function legendHtml() {
    return '<div class="legend"><span><i class="lg-walk"></i>Walkway</span><span><i class="lg-shelf"></i>Shelf</span>' +
      '<span><i class="lg-cold"></i>Cold zone</span><span><i class="lg-chem"></i>Chemical zone</span><span><i class="lg-closed"></i>Closed</span></div>';
  }
  function tagHtml(p) {
    return '';
  }

  // ------------------------------------------------------------------ tap-to-walk
  var MAX_ROUTE = 400;                               // same limit as Game.checkRoute
  function extendRoute(route, id, rule) {
    if (!route || !route.length) route = [Game.START];
    if (!Game.validCell(id)) return { err: 'That is not a square.' };
    var cur = route[route.length - 1], k = Game.kindOf(id), best = null, sp, i, p;
    if (Game.isBlocked(rule, id)) return { err: 'That square is blocked. Walk around it.' };
    if (k === 'walk' || k === 'start') {
      if (id === cur) return { route: route, added: 0 };
      best = Game.pathTo(cur, id, rule);
      if (!best) return { err: 'You cannot walk there from here.' };
    } else if (Game.placeable(id)) {
      sp = Game.spots(id, rule);
      if (sp.indexOf(cur) >= 0) return { route: route, added: 0 };
      for (i = 0; i < sp.length; i++) {
        p = Game.pathTo(cur, sp[i], rule);
        if (p && (!best || p.length < best.length)) best = p;
      }
      if (!best) return { err: 'You cannot reach that shelf from here.' };
    } else return { err: 'Tap a walkway square or a shelf.' };
    if (route.length + best.length - 1 > MAX_ROUTE) return { err: 'This route is too long. Undo some steps.' };
    return { route: route.concat(best.slice(1)), added: best.length - 1 };
  }

  // ------------------------------------------------------------------ THE MAP
  var SVGNS = 'http://www.w3.org/2000/svg';
  var WALK_MS = 80;                                  // one square, for short hops

  function createMap(container, opts) {
    opts = opts || {};
    var rootEl = el('div', 'map'), colsEl = el('div', 'map-cols'), rowsEl = el('div', 'map-rows');
    var sq = el('div', 'map-sq'), grid = el('div', 'map-grid');
    var cells = {}, cellList = [], i, r, c;

    for (i = 1; i <= 10; i++) colsEl.appendChild(el('span', '', String(i)));
    for (i = 0; i < 10; i++) rowsEl.appendChild(el('span', '', Game.ROWS.charAt(i)));

    for (r = 0; r < 10; r++) for (c = 1; c <= 10; c++) buildCell(r, c);

    function buildCell(r, c) {
      var k = Game.kind(r, c), id = Game.cid(r, c), span = 1, e, o;
      if (k === 'counter') { if (c !== 1) return; span = 2; }
      if (k === 'dock') { if (c !== 4) return; span = 7; }
      var place = Game.placeable(id), tap = place || k === 'walk' || k === 'start';
      e = el(tap ? 'button' : 'div', 'c k-' + k);
      e.style.gridRow = String(r + 1);
      e.style.gridColumn = span > 1 ? c + ' / span ' + span : String(c);
      if (tap) { e.type = 'button'; e.setAttribute('data-id', id); e.setAttribute('aria-label', id); }
      o = { id: id, el: e, kind: k, r: r, c: c, place: place, f: {}, p: 0, lv: '', n: null, e: null, l: null };
      if (k === 'counter') e.textContent = 'Counter';
      else if (k === 'dock') e.textContent = 'Unloading dock (not used)';
      else if (k === 'gap') e.textContent = 'gap';
      else if (k === 'start') e.appendChild(el('span', 'st', 'START'));
      else if (place) {
        e.appendChild(el('small', 'id', id));
        o.n = el('b', 'n'); o.e = el('span', 'e'); o.l = el('i', 'l');
        e.appendChild(o.n); e.appendChild(o.l); e.appendChild(o.e);
      }
      grid.appendChild(e);
      cells[id] = o; cellList.push(o);
    }

    // overlays: ghost lines + walked line (SVG), the picker, flying emoji
    var svg = doc.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'map-path');
    svg.setAttribute('viewBox', '0 0 10 10');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    function poly(cls) { var p = doc.createElementNS(SVGNS, 'polyline'); p.setAttribute('class', cls); p.setAttribute('points', ''); svg.appendChild(p); return p; }
    // the dashed ghost lines are added AFTER the walked line, so they are drawn on top of it and stay visible where both overlap
    var line = poly('ln'), gh1 = poly('gh'), gh2 = poly('gh gh2');
    var av = el('div', 'map-av'), avIn = el('div', 'map-av-in', '🛒'), avN = el('i', 'map-av-n');
    av.setAttribute('aria-hidden', 'true');
    av.appendChild(avIn); av.appendChild(avN);
    av.style.display = 'none';
    grid.appendChild(svg); grid.appendChild(av);

    sq.appendChild(grid);
    rootEl.appendChild(colsEl); rootEl.appendChild(rowsEl); rootEl.appendChild(sq);
    container.appendChild(rootEl);

    // ---- state
    var st = { layout: {}, rule: null, items: [], picked: null, route: null, edit: false, ghost: null, sel: null, warn: null };
    var vis = [];              // squares the picker has reached so far (what is drawn)
    var queue = [];            // squares it still has to walk
    var seg = null;            // the step in progress {to, t0, dur}
    var shown = {};            // productNumber -> 1 for items shown as picked
    var fresh = true;          // next picked-sync is silent (no flying emoji)
    var playing = null;        // {resolve, route, dur}
    var dead = false, rafId = 0, wdTimer = 0, playTimer = 0, lineBase = '', lastGhost = null, avX = 0, avY = 0, avShown = false, unit = 0;
    var api;

    // ---- size: everything inside scales from --u (the width of one square in px)
    function measure() {
      if (dead) return;
      var w = sq.clientWidth;
      if (!w) return;
      var u = Math.round(w) / 10;
      if (u !== unit) { unit = u; rootEl.style.setProperty('--u', u + 'px'); }
    }
    var ro = null;
    if (root.ResizeObserver) {
      try { ro = new root.ResizeObserver(function () { measure(); }); ro.observe(sq); } catch (e) { ro = null; }
    }
    function onResize() { measure(); }
    if (root.addEventListener) { root.addEventListener('resize', onResize); root.addEventListener('orientationchange', onResize); }

    // ---- low level drawing
    function flag(o, name, on) {
      on = !!on;
      if (!!o.f[name] === on) return;
      o.f[name] = on;
      toggle(o.el, name, on);
    }
    function pt(id) { var q = Game.rc(id); return (q[1] - 0.5) + ',' + (q[0] + 0.5); }
    function pointsOf(route) { return route && route.length > 1 ? route.map(pt).join(' ') : ''; }
    function placeAv(x, y) {
      avX = x; avY = y;
      av.style.transform = 'translate3d(' + (Math.round(x * 1000) / 10) + '%,' + (Math.round(y * 1000) / 10) + '%,0)';
    }
    function placeAt(id) { var q = Game.rc(id); placeAv(q[1] - 1, q[0]); }
    function showAv(on) {
      if (on === avShown) return;
      avShown = on;
      av.style.display = on ? '' : 'none';
    }
    function drawLine(extra) {
      var s = lineBase;
      if (extra) s += (s ? ' ' : '') + extra;
      if (s.indexOf(' ') < 0) s = '';                // one point is not a line
      line.setAttribute('points', s);
    }
    function rebase() { lineBase = vis.map(pt).join(' '); }

    // ---- picked items (drives the pulsing targets, the pop and the flying emoji)
    function syncPicked() {
      var now = {}, items = st.items, cnt = 0, i, p, has, w, o;
      if (st.picked) now = st.picked;
      else if (vis.length && items.length) now = Game.pickedOf(vis, items, st.layout, st.rule);
      var next = {};
      for (i = 0; i < items.length; i++) {
        p = items[i]; has = !!now[p];
        if (has) { next[p] = 1; cnt++; }
        if (has && !shown[p] && !fresh) {
          w = Game.where(st.layout, p); o = w ? cells[w] : null;
          if (o) pickFx(o, p);
        }
      }
      shown = next; fresh = false;
      var txt = cnt ? String(cnt) : '';
      if (avN.textContent !== txt) avN.textContent = txt;
    }
    function pickFx(o, p) {
      flag(o, 'got', true); flag(o, 'tgt', false);
      o.el.classList.remove('pop'); void o.el.offsetWidth; o.el.classList.add('pop');
      setTimeout(function () { if (!dead) o.el.classList.remove('pop'); }, 520);
      av.classList.remove('bump'); void av.offsetWidth; av.classList.add('bump');
      setTimeout(function () { if (!dead) av.classList.remove('bump'); }, 380);
      if (avShown && !reducedMotion() && !hiddenDoc()) {
        var prod = Game.product(p), f = el('div', 'map-fly', prod ? prod.emoji : '');
        f.style.transform = 'translate3d(' + ((o.c - 1) * 100) + '%,' + (o.r * 100) + '%,0) scale(1.7)';
        grid.appendChild(f);
        void f.offsetWidth;
        f.style.transform = 'translate3d(' + (Math.round(avX * 1000) / 10) + '%,' + (Math.round(avY * 1000) / 10) + '%,0) scale(0.45)';
        f.style.opacity = '0.15';
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 560);
      }
      if (opts.sound) sound('pick');
      call(opts.onPick, p, o.id);
    }

    // ---- full repaint (diffs against what is already on the page)
    function paint() {
      if (dead) return;
      if (!unit || !ro) measure();
      syncPicked();
      var L = st.layout, rule = st.rule, items = st.items, need = {}, on = {}, warn = {}, i, w, o, it, pn, lv, prod, hasItems = items.length > 0;
      for (i = 0; i < items.length; i++) { w = Game.where(L, items[i]); if (w) need[w] = items[i]; }
      for (i = 0; i < vis.length; i++) on[vis[i]] = 1;
      if (st.warn) for (i = 0; i < st.warn.length; i++) warn[st.warn[i]] = 1;
      var oneWay = !!(rule && rule.oneWay);
      for (i = 0; i < cellList.length; i++) {
        o = cellList[i];
        if (o.place) {
          it = L[o.id] || null; pn = it ? Number(it.p) || 0 : 0; lv = it && it.l ? String(it.l) : '';
          if (pn !== o.p || lv !== o.lv) {
            o.p = pn; o.lv = lv;
            prod = pn ? Game.product(pn) : null;
            o.n.textContent = pn ? String(pn) : '';
            o.e.textContent = prod ? prod.emoji : '';
            o.l.textContent = lv;
            o.el.setAttribute('aria-label', o.id + (prod ? ': ' + prod.name + ', ' + (Game.LEVELS[lv] || lv) + ' level' : ': empty'));
          }
          flag(o, 'full', pn > 0);
          flag(o, 'tgt', need[o.id] && !shown[need[o.id]]);
          flag(o, 'got', need[o.id] && shown[need[o.id]]);
          flag(o, 'dim', hasItems && pn > 0 && !need[o.id]);
          flag(o, 'ed', st.edit);
          flag(o, 'sel', st.sel === o.id);
          flag(o, 'bad', warn[o.id]);
        } else if (o.kind === 'walk' || o.kind === 'start') {
          flag(o, 'on', on[o.id]);
          flag(o, 'blk', Game.isBlocked(rule, o.id));
          flag(o, 'ow', oneWay && o.c === 6 && o.r >= 2 && o.r <= 7);
          flag(o, 'sel', st.sel === o.id);
        }
      }
      toggle(rootEl, 'is-edit', st.edit);
      toggle(rootEl, 'is-route', vis.length > 0);
      // ghost line(s)
      if (st.ghost !== lastGhost) {
        lastGhost = st.ghost;
        var g = st.ghost, g1 = null, g2 = null;
        if (g && g.length) {
          if (typeof g[0] === 'string') g1 = g;
          else { g1 = g[0] || null; g2 = g[1] || null; }
        }
        gh1.setAttribute('points', pointsOf(g1));
        gh2.setAttribute('points', pointsOf(g2));
      }
      // picker + walked line (when a step is in progress the animation frame draws them)
      showAv(vis.length > 0);
      if (!seg) {
        if (vis.length) placeAt(vis[vis.length - 1]);
        drawLine('');
      }
    }

    // ---- walking
    function curDur() {
      if (playing) return playing.dur;
      var n = queue.length;
      return n <= 5 ? WALK_MS : Math.max(26, (WALK_MS * 5 + (n - 5) * 34) / n);     // long hops speed up
    }
    function arrive(id) {
      vis.push(id);
      lineBase += (lineBase ? ' ' : '') + pt(id);
      var o = cells[id];
      if (o) flag(o, 'on', true);
      syncPicked();
      call(opts.onArrive, id);
    }
    function frame() {
      rafId = 0;
      if (dead) return;
      var now = Date.now(), guard = 0, p, a, b;
      while (queue.length && guard++ < 1000) {
        if (!seg) seg = { to: queue[0], t0: now, dur: curDur() };
        p = (now - seg.t0) / seg.dur;
        if (p < 1) {
          a = Game.rc(vis[vis.length - 1]); b = Game.rc(seg.to);
          var x = a[1] - 1 + (b[1] - a[1]) * p, y = a[0] + (b[0] - a[0]) * p;
          placeAv(x, y);
          drawLine((Math.round((x + 0.5) * 100) / 100) + ',' + (Math.round((y + 0.5) * 100) / 100));
          if (!rafId) rafId = raf(frame);
          return;
        }
        var end = seg.t0 + seg.dur, reached = seg.to;
        queue.shift();
        seg = null;
        arrive(reached);
        if (dead) return;
        // carry the leftover time into the next step so the speed stays even (but never race after a stall)
        if (queue.length) seg = { to: queue[0], t0: Math.max(end, now - 400), dur: curDur() };
      }
      endWalk();
    }
    function endWalk() {
      caf(rafId); rafId = 0;
      clearTimeout(wdTimer); wdTimer = 0;
      seg = null; queue = [];
      av.classList.remove('walking');
      if (vis.length) placeAt(vis[vis.length - 1]);
      drawLine('');
      if (playing) endPlay(true);
    }
    function flushWalk() {                           // finish the walk at once (hidden tab, reduced motion, watchdog)
      if (dead) return;
      caf(rafId); rafId = 0;
      var q = queue, i;
      queue = []; seg = null;
      for (i = 0; i < q.length; i++) {
        vis.push(q[i]);
        if (cells[q[i]]) flag(cells[q[i]], 'on', true);
        call(opts.onArrive, q[i]);
      }
      rebase();
      syncPicked();
      endWalk();
    }
    function startWalk() {
      if (dead) return;
      if (!queue.length) return endWalk();
      if (reducedMotion() || hiddenDoc()) return flushWalk();
      av.classList.add('walking');
      clearTimeout(wdTimer);
      wdTimer = setTimeout(flushWalk, queue.length * curDur() + 1500);          // never leave a walk (or a promise) hanging
      if (!rafId) rafId = raf(frame);
    }
    function stopWalk() {
      caf(rafId); rafId = 0;
      clearTimeout(wdTimer); wdTimer = 0;
      clearTimeout(playTimer); playTimer = 0;
      seg = null; queue = [];
      av.classList.remove('walking');
    }
    function endPlay(ok) {
      if (!playing) return;
      var p = playing;
      playing = null;
      clearTimeout(playTimer); playTimer = 0;
      p.resolve(!!ok);
    }
    function setRoute(route) {
      if (playing) {
        if (route && sameArr(route, playing.route)) return;
        endPlay(false);
      }
      st.route = route && route.length ? route.slice() : null;
      if (!st.route) { stopWalk(); vis = []; rebase(); fresh = true; return; }
      var r = st.route, n = 0, max = Math.min(vis.length, r.length);
      while (n < max && vis[n] === r[n]) n++;
      if (vis.length && n === vis.length) {          // the route grew: walk the new squares
        var q = r.slice(n);
        if (seg && q[0] !== seg.to) seg = null;
        queue = q;
        if (queue.length) startWalk(); else endWalk();
      } else {                                       // undo / clear / a different trip: jump
        stopWalk();
        vis = r.slice(); rebase(); fresh = true;
      }
    }

    function update(o) {
      if (dead || !o) return api;
      var newCtx = false;
      if ('layout' in o) st.layout = o.layout || {};
      if ('rule' in o) st.rule = o.rule || null;
      if ('items' in o) {
        var ni = o.items || [];
        if (!sameArr(ni, st.items)) { newCtx = true; st.items = ni.slice(); }
      }
      if ('picked' in o) st.picked = o.picked || null;
      if ('edit' in o) st.edit = !!o.edit;
      if ('ghost' in o) st.ghost = o.ghost || null;
      if ('sel' in o) st.sel = o.sel || null;
      if ('warn' in o) st.warn = o.warn || null;
      if ('route' in o) setRoute(o.route);
      if (newCtx) fresh = true;
      paint();
      return api;
    }

    function play(route, o) {
      o = o || {};
      if (dead || !route || !route.length) return Promise.resolve(false);
      endPlay(false);
      stopWalk();
      if ('layout' in o) st.layout = o.layout || {};
      if ('rule' in o) st.rule = o.rule || null;
      if ('items' in o) st.items = (o.items || []).slice();
      if ('ghost' in o) st.ghost = o.ghost || null;
      st.picked = null;
      st.route = route.slice();
      vis = [route[0]]; rebase(); fresh = true;
      // clear the old trail before painting the new start
      for (var i = 0; i < cellList.length; i++) if (cellList[i].f.on) flag(cellList[i], 'on', false);
      paint();
      var n = route.length - 1;
      var per = Math.max(12, Math.min(o.speed > 0 ? o.speed : 90, (o.maxMs > 0 ? o.maxMs : 7000) / Math.max(1, n)));
      return new Promise(function (resolve) {
        var me = { resolve: resolve, route: route.slice(), dur: per };
        playing = me;
        if (!n) return endPlay(true);
        var go = function () {
          playTimer = 0;
          if (dead || playing !== me) return;
          queue = route.slice(1);
          startWalk();
        };
        if (reducedMotion() || hiddenDoc()) go();
        else playTimer = setTimeout(go, o.delay >= 0 ? o.delay : 250);
      });
    }

    function onVis() { if (hiddenDoc() && queue.length && !playTimer) flushWalk(); }
    if (doc) doc.addEventListener('visibilitychange', onVis);

    function onClick(ev) {
      var t = ev.target, id = null;
      while (t && t !== grid) {
        if (t.getAttribute && (id = t.getAttribute('data-id'))) break;
        t = t.parentNode;
      }
      if (!id || !cells[id] || dead) return;
      call(opts.onCell, id, cells[id].kind, { item: st.layout[id] || null, blocked: Game.isBlocked(st.rule, id) });
    }
    grid.addEventListener('click', onClick);

    function destroy() {
      if (dead) return;
      stopWalk();
      endPlay(false);
      dead = true;
      grid.removeEventListener('click', onClick);
      if (doc) doc.removeEventListener('visibilitychange', onVis);
      if (root.removeEventListener) { root.removeEventListener('resize', onResize); root.removeEventListener('orientationchange', onResize); }
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    }

    api = { update: update, play: play, destroy: destroy, el: rootEl, walking: function () { return queue.length > 0 || !!playTimer; } };
    measure();
    paint();
    raf(measure);
    return api;
  }

  // ------------------------------------------------------------------ countUp
  function countUp(e, to, o) {
    o = o || {};
    to = Number(to) || 0;
    var from = o.from != null ? Number(o.from) || 0
      : typeof e._kitNum === 'number' ? e._kitNum
      : parseFloat(String(e.textContent).replace(/[^0-9.\-]/g, '')) || 0;
    var ms = o.ms > 0 ? o.ms : 700, pre = o.prefix || '', suf = o.suffix || '';
    var id = e._kitCU = (e._kitCU || 0) + 1;
    function put(v) { e.textContent = pre + v + suf; }
    e._kitNum = to;
    return new Promise(function (resolve) {
      if (from === to || reducedMotion() || hiddenDoc()) { put(to); return resolve(); }
      var t0 = Date.now(), done = false;
      function fin() {
        if (done) return;
        done = true;
        if (e._kitCU === id) put(to);
        resolve();
      }
      function fr() {
        if (done) return;
        if (e._kitCU !== id) return fin();           // a newer countUp took over this element
        var p = (Date.now() - t0) / ms;
        if (p >= 1) return fin();
        put(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
        raf(fr);
      }
      put(Math.round(from));
      raf(fr);
      setTimeout(fin, ms + 400);
    });
  }

  // ------------------------------------------------------------------ confetti
  function confetti(o) {
    o = o || {};
    return new Promise(function (resolve) {
      if (!doc || !doc.body || reducedMotion() || hiddenDoc()) return resolve();
      var cv = doc.createElement('canvas'), ctx = cv.getContext ? cv.getContext('2d') : null;
      if (!ctx) return resolve();
      var W = root.innerWidth || 360, H = root.innerHeight || 640, dpr = Math.min(2, root.devicePixelRatio || 1);
      var ms = o.ms > 0 ? o.ms : 2800, n = o.count > 0 ? o.count : (W < 700 ? 90 : 200), big = Math.max(1, W / 900);
      var cols = ['#FFE500', '#000000', '#FF2D87', '#2B4BFF', '#FFFFFF', '#FF9A2E'], ps = [], i, done = false;
      cv.className = 'confetti';
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.scale(dpr, dpr);
      for (i = 0; i < n; i++) {
        ps.push({
          x: Math.random() * W, y: -20 - Math.random() * H * 0.6,
          vx: (Math.random() - 0.5) * 220 * big, vy: (220 + Math.random() * 380) * Math.max(1, H / 800),
          w: (6 + Math.random() * 8) * big, h: (4 + Math.random() * 6) * big,
          a: Math.random() * 6.28, va: (Math.random() - 0.5) * 12, col: cols[i % cols.length], ph: Math.random() * 6.28
        });
      }
      doc.body.appendChild(cv);
      var t0 = Date.now(), last = t0;
      function fin() {
        if (done) return;
        done = true;
        if (cv.parentNode) cv.parentNode.removeChild(cv);
        resolve();
      }
      function fr() {
        if (done) return;
        var now = Date.now(), dt = Math.min(0.05, (now - last) / 1000), t = now - t0, p;
        last = now;
        if (t >= ms) return fin();
        ctx.clearRect(0, 0, W, H);
        ctx.globalAlpha = t > ms - 500 ? Math.max(0, (ms - t) / 500) : 1;
        for (i = 0; i < ps.length; i++) {
          p = ps[i];
          p.x += (p.vx + Math.sin(t / 300 + p.ph) * 60) * dt; p.y += p.vy * dt; p.a += p.va * dt;
          if (p.y > H + 30) continue;
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.a);
          ctx.fillStyle = p.col;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        raf(fr);
      }
      raf(fr);
      setTimeout(fin, ms + 600);
    });
  }

  // ------------------------------------------------------------------ flipList (FLIP: First, Last, Invert, Play)
  function flipList(box, render, o) {
    o = o || {};
    var ms = o.ms > 0 ? o.ms : 500, anim = !reducedMotion() && !hiddenDoc();
    var first = Object.create(null), had = 0, kids, i, k, e;      // no prototype: a row key may be any text, even "__proto__"
    if (anim) {
      kids = box.children;
      for (i = 0; i < kids.length; i++) {
        k = kids[i].getAttribute('data-key');
        if (k != null) { first[k] = kids[i].getBoundingClientRect(); had++; }
      }
    }
    call(render, box);
    if (!anim) return Promise.resolve();
    kids = box.children;
    var vh = root.innerHeight || 2000, list = [], moved = [], a, b, dx, dy, token = Date.now() + Math.random();
    for (i = 0; i < kids.length; i++) {              // write: drop any transform left from an earlier flip
      e = kids[i];
      if (e.getAttribute('data-key') == null) continue;
      e.style.transition = 'none'; e.style.transform = '';
      e.classList.remove('flip-up'); e.classList.remove('flip-in');
      list.push(e);
    }
    for (i = 0; i < list.length; i++) list[i]._kitRect = list[i].getBoundingClientRect();     // read
    for (i = 0; i < list.length; i++) {              // write: put every row back where it was
      e = list[i]; b = e._kitRect; e._kitRect = null;
      a = first[e.getAttribute('data-key')];
      if (!a) { if (had) e.classList.add('flip-in'); e.style.transition = ''; continue; }
      dx = a.left - b.left; dy = a.top - b.top;
      if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || ((a.bottom < 0 || a.top > vh) && (b.bottom < 0 || b.top > vh))) { e.style.transition = ''; continue; }
      e.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      if (dy > 1) e.classList.add('flip-up');
      e._kitFlip = token;
      moved.push(e);
    }
    if (!moved.length) return Promise.resolve();
    void box.offsetWidth;                            // make the browser take the "before" picture
    for (i = 0; i < moved.length; i++) {
      moved[i].style.transition = 'transform ' + ms + 'ms cubic-bezier(.2,.8,.2,1)';
      moved[i].style.transform = '';
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        for (var j = 0; j < moved.length; j++) {
          if (moved[j]._kitFlip !== token) continue;
          moved[j].style.transition = '';
          moved[j].classList.remove('flip-up');
        }
        resolve();
      }, ms + 60);
    });
  }

  // ------------------------------------------------------------------ clock
  function clock(e, getView, o) {
    o = o || {};
    var hurry = (o.hurry == null ? 10 : o.hurry) * 1000, lastTxt = null, lastSec = null, zero = false, firstRun = true, t = 0;
    function tick() {
      var v = call(getView) || null, left = timeLeft(v), txt = fmtTime(left), paused = !!(v && v.pausedLeft > 0);
      if (txt !== lastTxt) { e.textContent = txt; lastTxt = txt; }
      toggle(e, 'hurry', left != null && !paused && left <= hurry);
      toggle(e, 'paused', paused);
      toggle(e, 'noclock', left == null);
      var sec = left == null ? null : Math.ceil(left / 1000);
      if (sec !== lastSec) {
        if (!firstRun && o.sound && sec != null && !paused && sec > 0 && sec * 1000 <= hurry) sound('tick');
        lastSec = sec;
      }
      if (left === 0 && !paused) { if (!zero && !firstRun) call(o.onZero); zero = true; } else zero = false;
      firstRun = false;
    }
    tick();
    t = setInterval(tick, 200);
    return { stop: function () { clearInterval(t); t = 0; }, tick: tick };
  }

  hookAudio();

  var Kit = {
    post: post, connect: connect, serverNow: serverNow, timeLeft: timeLeft, fmtTime: fmtTime, clock: clock,
    esc: esc, toast: toast, sound: sound, mute: mute, unlockAudio: unlockAudio, vibrate: vibrate, store: store,
    reducedMotion: reducedMotion, legendHtml: legendHtml, tagHtml: tagHtml,
    createMap: createMap, extendRoute: extendRoute,
    countUp: countUp, confetti: confetti, flipList: flipList,
    _syncClock: syncClock
  };
  if (typeof module === 'object' && module.exports) module.exports = Kit;
  root.Kit = Kit;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
