/* DARK STORE BLITZ - kit3d.js : the 3D warehouse, for the projector and for result replays.
   Load AFTER game.js and kit.js:  <script src="/kit3d.js"></script>   Everything lives on window.Kit3D. It brings its own CSS.
   It is a look-only map (nobody taps on it), built with plain CSS 3D transforms - no libraries, works offline.

   var map = Kit3D.createMap(containerEl, {sound:false, sway:true, lite:false, onSlow(), onPick(productNumber, cellId), onArrive(cellId)})
       lite:true  = the phone version: no blur/shadow filters and no camera sway, so it stays light.
       onSlow()   = this device dropped under 30 frames a second while the cart was driving. The device is remembered as
                    "too slow for 3D" (Kit3D.supported() is false from then on): swap to the flat Kit.createMap().
   map.update({layout, rule, items, route, ghost, picked})   same meaning as Kit.createMap().update(); only the keys you pass change.
       route grows -> the cart drives the new squares; anything else -> it jumps. route:null hides the cart.
       ghost = route, or [route, route2], or null (dashed line: the shortest possible route)
   map.play(route, {speed, maxMs, delay, ghost, layout, items, rule}) -> Promise<boolean>   replays a whole route; true when it finished.
   map.walking()   map.el   map.destroy()
   Drag on the map to turn the camera. Kit3D.supported() is false on browsers without CSS 3D (then use Kit.createMap). */
(function (root) {
  'use strict';
  var doc = root.document, G = root.Game, S = 50;
  var HEIGHT = { shelf: 36, spare: 30, cold: 30, chem: 30, counter: 24, dock: 5, closed: 12, gap: 5 };
  var CSS = [
    "@property --k3rx{syntax:'<angle>';inherits:true;initial-value:56deg}",
    "@property --k3rz{syntax:'<angle>';inherits:true;initial-value:-34deg}",
    ".k3d{position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;perspective:1500px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;",
    "background:radial-gradient(120% 90% at 50% 20%,#2a2f55 0,#12142a 55%,#07080f 100%);border:3px solid #000;box-shadow:5px 5px 0 #000}",
    "@supports not (aspect-ratio:1){.k3d{height:0;padding-bottom:75%}}",
    ".k3d.drag{cursor:grabbing}",
    ".k3d-floor{position:absolute;left:50%;top:50%;width:500px;height:500px;margin:-250px 0 0 -250px;transform-style:preserve-3d;--k3rx:56deg;--k3rz:-34deg;--k3sc:1;",
    "transform:scale(var(--k3sc)) rotateX(var(--k3rx)) rotateZ(var(--k3rz));will-change:transform;background:#1b1d2e;box-shadow:0 0 0 4px #000,0 0 80px 20px rgba(0,0,0,.5)}",
    ".k3d-floor.sway{animation:k3sway 16s ease-in-out infinite alternate}",
    "@keyframes k3sway{from{--k3rz:-44deg}to{--k3rz:-24deg}}",
    ".k3d-tile{position:absolute;width:50px;height:50px;background:#E8E6DA;box-shadow:inset 0 0 0 1px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font:800 13px/1 var(--disp,Impact,sans-serif);color:rgba(0,0,0,.4)}",
    ".k3d-tile.start{background:#FF2D87;color:#000;animation:k3home 1.2s infinite alternate}",
    ".k3d-tile.on{background:#C5CEFF}",
    ".k3d-tile.blk{background:repeating-linear-gradient(45deg,#000 0 6px,#FFE500 6px 12px)}",
    ".k3d-tile.oneway::after{content:'\\25BC';color:#2B4BFF;font-size:20px;animation:k3flow .7s linear infinite}",
    "@keyframes k3home{to{box-shadow:inset 0 0 0 5px #000}}",
    "@keyframes k3flow{from{transform:translateY(-16px);opacity:0}40%{opacity:1}to{transform:translateY(16px);opacity:0}}",
    ".k3d-box{position:absolute;transform-style:preserve-3d;--b:var(--side);--m:var(--side);--t:var(--side)}",
    ".k3d-f{position:absolute;left:0;top:0;box-shadow:inset 0 0 0 1px #000}",
    ".k3d-ft{background:var(--topc);font:800 15px/1 var(--disp,Impact,sans-serif);padding:3px 4px;color:var(--num,#000);overflow:hidden}",
    ".k3d-fn,.k3d-fs{transform-origin:50% 0;transform:rotateX(90deg);background:linear-gradient(to bottom,var(--b) 0 30%,#000 30% 35%,var(--m) 35% 65%,#000 65% 70%,var(--t) 70%)}",
    ".k3d-fw,.k3d-fe{transform-origin:0 50%;transform:rotateY(-90deg);background:linear-gradient(to right,var(--b) 0 30%,#000 30% 35%,var(--m) 35% 65%,#000 65% 70%,var(--t) 70%)}",
    ".k3d-fn,.k3d-fw{filter:brightness(.8)}.k3d-fe{filter:brightness(.62)}",
    ".k3d-shelf,.k3d-spare{--topc:#fff;--side:#d9d9d9}",
    ".k3d-shelf.full,.k3d-spare.full{--topc:#111;--side:#3a3a3a;--num:#FFE500}",
    ".k3d-cold{--topc:#BFE0FF;--side:#8fc3f5}.k3d-cold.full{--topc:#2B4BFF;--side:#1c31b8;--num:#fff}",
    ".k3d-chem{--topc:#FFD9A8;--side:#f0b56a}.k3d-chem.full{--topc:#FF9A2E;--side:#c96f10}",
    ".k3d-counter{--topc:#000;--side:#222;--num:#fff}.k3d-dock{--topc:#9a9a9a;--side:#777}.k3d-closed{--topc:#2a2a2a;--side:#1a1a1a}.k3d-gap{--topc:#444;--side:#333}",
    ".k3d-pallet{--topc:#b98545;--side:#8a5a22;animation:k3drop .75s cubic-bezier(.3,.7,.4,1) both}",
    ".k3d-pallet .k3d-ft{background:repeating-linear-gradient(90deg,#b98545 0 8px,#8a5a22 8px 10px)}",
    "@keyframes k3drop{0%{transform:translateZ(520px);opacity:0}15%{opacity:1}62%{transform:translateZ(0)}76%{transform:translateZ(22px)}88%{transform:translateZ(0)}94%{transform:translateZ(6px)}100%{transform:translateZ(0)}}",
    ".k3d-box.lv-B{--b:#FFE500}.k3d-box.lv-M{--m:#FFE500}.k3d-box.lv-T{--t:#FFE500}",
    ".k3d-box.tgt .k3d-ft{background:#FF2D87}",
    ".k3d-box.got .k3d-ft{background:#fff;color:#000;text-decoration:line-through}",
    ".k3d-box.pop{animation:k3pop .35s ease-out}",
    "@keyframes k3pop{40%{transform:translateZ(14px)}}",
    ".k3d-bb{position:absolute;width:0;height:0;transform-style:preserve-3d;pointer-events:none;transform:translateZ(var(--h,0px)) rotateZ(calc(var(--k3rz) * -1)) rotateX(calc(var(--k3rx) * -1))}",
    ".k3d-bb>span{position:absolute;left:0;bottom:0;transform:translateX(-50%);font-size:26px;line-height:1;white-space:nowrap;filter:drop-shadow(0 2px 0 rgba(0,0,0,.5))}",
    ".k3d-bb.tgt>span{filter:drop-shadow(0 2px 0 rgba(0,0,0,.5))}",
    ".k3d-bb.got>span{opacity:.15}",
    ".k3d-bb.dim>span{opacity:.45}",
    "@keyframes k3bob{to{transform:translateX(-50%) translateY(-10px) scale(1.2)}}",
    ".k3d-fly{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;pointer-events:none}",
    ".k3d-cart{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;transition:transform .11s linear;will-change:transform;pointer-events:none}",
    ".k3d-cart.hide{display:none}",
    ".k3d-shadow{position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.45);filter:blur(3px)}",
    ".k3d-body{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;transition:transform .15s}",
    ".k3d-cart .k3d-box{--topc:#FF2D87;--side:#c21463}",
    ".k3d-cart .k3d-bb>span{font-size:30px}",
    ".k3d-cart .k3d-load>span{font-size:16px;bottom:34px;letter-spacing:-3px}",
    ".k3d-path{position:absolute;left:0;top:0;width:500px;height:500px;pointer-events:none;transform:translateZ(1px);overflow:visible}",
    ".k3d-path polyline{fill:none;stroke:#2B4BFF;stroke-width:.14;stroke-linejoin:round;stroke-linecap:round}",
    ".k3d-path .ghost{stroke:#FF2D87;stroke-dasharray:.2 .2;stroke-width:.09}",
    ".k3d.lite .k3d-bb>span{filter:none}.k3d.lite .k3d-shadow{filter:none;background:rgba(0,0,0,.3)}",
    ".k3d.lite .k3d-fn,.k3d.lite .k3d-fw,.k3d.lite .k3d-fe{filter:none}.k3d.lite .k3d-fn::after,.k3d.lite .k3d-fw::after,.k3d.lite .k3d-fe::after{content:'';position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.22)}",
    ".k3d.lite .k3d-fe::after{background:rgba(0,0,0,.4)}.k3d.lite .k3d-floor{box-shadow:0 0 0 4px #000}",
    "@media (prefers-reduced-motion:reduce){.k3d-floor.sway,.k3d-tile.start,.k3d-tile.oneway::after,.k3d-box.tgt .k3d-ft,.k3d-bb.tgt>span,.k3d-pallet{animation:none}}"
  ].join('\n');
  var styled = false;
  function style() {
    if (styled) return; styled = true;
    var s = doc.createElement('style'); s.textContent = CSS; doc.head.appendChild(s);
  }
  var SLOW_KEY = 'dsb_3d_slow';
  function slowFlag() { try { return root.localStorage.getItem(SLOW_KEY) === '1'; } catch (e) { return false; } }
  function supported() {
    if (slowFlag()) return false;
    try { return !!(root.CSS && root.CSS.supports && root.CSS.supports('transform-style', 'preserve-3d')); } catch (e) { return false; }
  }
  function reduced() { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function el(cls, parent) { var d = doc.createElement('div'); d.className = cls; if (parent) parent.appendChild(d); return d; }
  function box(parent, x, y, w, d, h, cls) {
    var b = el('k3d-box ' + cls, parent), f;
    b.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + d + 'px';
    f = el('k3d-f k3d-ft', b); f.style.cssText = 'width:' + w + 'px;height:' + d + 'px;transform:translateZ(' + h + 'px)';
    f = el('k3d-f k3d-fn', b); f.style.cssText = 'width:' + w + 'px;height:' + h + 'px';
    f = el('k3d-f k3d-fs', b); f.style.cssText = 'width:' + w + 'px;height:' + h + 'px;top:' + d + 'px';
    f = el('k3d-f k3d-fw', b); f.style.cssText = 'width:' + h + 'px;height:' + d + 'px';
    f = el('k3d-f k3d-fe', b); f.style.cssText = 'width:' + h + 'px;height:' + d + 'px;left:' + w + 'px';
    return b;
  }
  function billboard(parent, x, y, h, text, cls) {
    var b = el('k3d-bb ' + (cls || ''), parent);
    b.style.cssText = 'left:' + x + 'px;top:' + y + 'px;--h:' + h + 'px';
    var s = doc.createElement('span'); s.textContent = text; b.appendChild(s);
    return b;
  }
  function centre(id) { var q = G.rc(id); return [(q[1] - 0.5) * S, (q[0] + 0.5) * S]; }
  function pointsOf(route) { return (route || []).map(function (x) { var q = G.rc(x); return (q[1] - 0.5) + ',' + (q[0] + 0.5); }).join(' '); }
  function same(a, b) { if (a === b) return true; if (!a || !b || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function startsWith(longer, shorter) { if (!longer || !shorter || shorter.length > longer.length) return false; for (var i = 0; i < shorter.length; i++) if (longer[i] !== shorter[i]) return false; return true; }
  function call(fn, a, b) { if (typeof fn === 'function') { try { fn(a, b); } catch (e) { if (root.console) root.console.error(e); } } }

  function createMap(container, opts) {
    opts = opts || {};
    style();
    var stage = el('k3d' + (opts.lite ? ' lite' : ''), container), floor = el('k3d-floor' + (opts.sway === false || opts.lite ? '' : ' sway'), stage);
    var st = { layout: {}, rule: null, items: [], route: null, ghost: null, picked: null };
    var tiles = {}, boxes = {}, bbs = {}, pallets = [], shown = null, got = {}, token = 0, moving = false, heading = 0, dead = false, ruleSig = '';
    var cam = { rx: 56, rz: -34 }, drag = null, timers = [];

    var r, c, k, id, b;
    for (r = 0; r < 10; r++) for (c = 1; c <= 10; c++) {
      k = G.kind(r, c); id = G.cid(r, c);
      if (k === 'walk' || k === 'start') {
        b = el('k3d-tile' + (k === 'start' ? ' start' : ''), floor);
        b.style.left = (c - 1) * S + 'px'; b.style.top = r * S + 'px';
        if (k === 'start') b.textContent = G.START;
        tiles[id] = b;
      } else {
        b = box(floor, (c - 1) * S, r * S, S, S, HEIGHT[k], 'k3d-' + k);
        if (k === 'counter' && c === 1) b.firstChild.textContent = 'COUNTER';
        boxes[id] = b;
      }
    }
    var ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'k3d-path'); svg.setAttribute('viewBox', '0 0 10 10');
    var ghostA = doc.createElementNS(ns, 'polyline'), ghostB = doc.createElementNS(ns, 'polyline'), pathEl = doc.createElementNS(ns, 'polyline');
    ghostA.setAttribute('class', 'ghost'); ghostB.setAttribute('class', 'ghost');
    svg.appendChild(ghostA); svg.appendChild(ghostB); svg.appendChild(pathEl); floor.appendChild(svg);
    var cart = el('k3d-cart hide', floor);
    el('k3d-shadow', cart);
    var body = el('k3d-body', cart);
    box(body, -14, -14, 28, 28, 16, 'k3d-cartbox');
    billboard(cart, 0, 0, 16, '🧑‍🔧');
    var load = billboard(cart, 0, 0, 16, '', 'k3d-load');

    function later(fn, ms) { var t = setTimeout(function () { timers.splice(timers.indexOf(t), 1); fn(); }, ms); timers.push(t); return t; }
    function fit() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (w && h) floor.style.setProperty('--k3sc', Math.min(w / 800, h / 640).toFixed(3));
    }
    function applyCam() {
      floor.classList.remove('sway');
      floor.style.setProperty('--k3rx', cam.rx + 'deg'); floor.style.setProperty('--k3rz', cam.rz + 'deg');
    }
    function onDown(e) { drag = { x: e.clientX, y: e.clientY, rx: cam.rx, rz: cam.rz, on: false }; }
    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.on && Math.abs(dx) + Math.abs(dy) < 10) return;
      drag.on = true; stage.classList.add('drag');
      cam.rz = drag.rz + dx * 0.4; cam.rx = Math.max(0, Math.min(74, drag.rx - dy * 0.3));
      applyCam();
    }
    function onUp() { drag = null; stage.classList.remove('drag'); }
    stage.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('resize', fit);
    var ro = null;
    if (root.ResizeObserver) { ro = new root.ResizeObserver(fit); ro.observe(stage); }
    fit(); later(fit, 60);

    // ---------- patching ----------
    function patchLayout() {
      var L = st.layout || {}, id2, it, bx, q;
      for (id2 in boxes) {
        if (!G.placeable(id2)) continue;
        bx = boxes[id2]; it = L[id2]; q = G.rc(id2);
        bx.classList.toggle('full', !!it);
        bx.classList.remove('lv-T', 'lv-M', 'lv-B');
        if (it) bx.classList.add('lv-' + it.l);
        bx.firstChild.textContent = it ? it.p : '';
        if (bbs[id2]) { bbs[id2].parentNode.removeChild(bbs[id2]); delete bbs[id2]; }
        if (it && G.product(it.p)) bbs[id2] = billboard(floor, (q[1] - 0.5) * S, (q[0] + 0.5) * S, HEIGHT[G.kindOf(id2)], G.product(it.p).emoji);
      }
    }
    function patchRule() {
      var R = st.rule, sig = R ? (R.oneWay ? '1' : '0') + '|' + (R.blocked || []).join(',') : '';
      if (sig === ruleSig) return;
      ruleSig = sig;
      pallets.forEach(function (p) { if (p.parentNode) p.parentNode.removeChild(p); }); pallets = [];
      Object.keys(tiles).forEach(function (t) {
        var q = G.rc(t);
        tiles[t].classList.toggle('blk', G.isBlocked(R, t));
        tiles[t].classList.toggle('oneway', !!(R && R.oneWay) && q[1] === 6 && q[0] >= 2 && q[0] <= 7);
      });
      ((R && R.blocked) || []).forEach(function (t, n) {
        if (!G.validCell(t)) return;
        var q = G.rc(t), p = box(floor, (q[1] - 1) * S + 5, q[0] * S + 5, 40, 40, 26, 'k3d-pallet');
        p.style.animationDelay = (n * 0.12) + 's';
        pallets.push(p);
      });
    }
    function pickedNow() {
      if (st.picked) return st.picked;
      return shown ? G.pickedOf(shown, st.items || [], st.layout || {}, st.rule) : {};
    }
    function paint() {
      var on = {}, need = {}, pk = pickedNow(), items = st.items || [], L = st.layout || {}, i, w, has = items.length > 0;
      if (shown) for (i = 0; i < shown.length; i++) on[shown[i]] = 1;
      Object.keys(tiles).forEach(function (t) { tiles[t].classList.toggle('on', !!on[t] && t !== G.START); });
      pathEl.setAttribute('points', shown && shown.length > 1 ? pointsOf(shown) : '');
      for (i = 0; i < items.length; i++) { w = G.where(L, items[i]); if (w) need[w] = items[i]; }
      Object.keys(boxes).forEach(function (t) {
        var p = need[t], bx = boxes[t], bb = bbs[t];
        bx.classList.toggle('tgt', !!p && !pk[p]); bx.classList.toggle('got', !!p && !!pk[p]);
        if (bb) { bb.classList.toggle('tgt', !!p && !pk[p]); bb.classList.toggle('got', !!p && !!pk[p]); bb.classList.toggle('dim', has && !p); }
      });
      load.firstChild.textContent = items.filter(function (p) { return pk[p]; }).map(function (p) { return G.product(p).emoji; }).join('');
    }
    function place(cell, instant) {
      var p = centre(cell);
      if (instant) { cart.style.transition = 'none'; }
      cart.style.transform = 'translate3d(' + p[0] + 'px,' + p[1] + 'px,0)';
      if (instant) { void cart.offsetWidth; cart.style.transition = ''; }
    }
    function face(from, to) {
      var a = G.rc(from), b2 = G.rc(to), want = b2[0] > a[0] ? 180 : b2[0] < a[0] ? 0 : b2[1] > a[1] ? 90 : -90;
      heading += ((want - heading) % 360 + 540) % 360 - 180;
      body.style.transform = 'rotateZ(' + heading + 'deg)';
    }
    function fly(p, shelf, at) {
      var bx = boxes[shelf];
      if (bx) { bx.classList.remove('pop'); void bx.offsetWidth; bx.classList.add('pop'); }
      if (opts.sound && root.Kit && root.Kit.sound) root.Kit.sound('pick');
      var f = el('k3d-fly', floor);
      if (!f.animate || reduced()) { floor.removeChild(f); return; }
      var s = centre(shelf), c2 = centre(at), h = HEIGHT[G.kindOf(shelf)] || 30;
      billboard(f, 0, 0, 0, G.product(p).emoji);
      var a = f.animate([
        { transform: 'translate3d(' + s[0] + 'px,' + s[1] + 'px,' + h + 'px)' },
        { transform: 'translate3d(' + (s[0] + c2[0]) / 2 + 'px,' + (s[1] + c2[1]) / 2 + 'px,' + (h + 70) + 'px)', offset: 0.45 },
        { transform: 'translate3d(' + c2[0] + 'px,' + c2[1] + 'px,22px)' }
      ], { duration: 480, easing: 'ease-in-out' });
      a.onfinish = a.oncancel = function () { if (f.parentNode) f.parentNode.removeChild(f); };
    }
    function arrive(cell) {
      var pk = st.picked ? st.picked : G.pickedOf(shown, st.items || [], st.layout || {}, st.rule), items = st.items || [], i, w;
      for (i = 0; i < items.length; i++) {
        if (pk[items[i]] && !got[items[i]]) {
          got[items[i]] = 1; w = G.where(st.layout || {}, items[i]);
          if (w) fly(items[i], w, cell);
          call(opts.onPick, items[i], w);
        }
      }
      paint();
      call(opts.onArrive, cell);
    }
    function jumpTo(route) {                 // show a route at once, no walking
      token++; moving = false;
      shown = route ? route.slice() : null; got = {};
      cart.classList.toggle('hide', !shown || !shown.length);
      if (shown && shown.length) {
        place(shown[shown.length - 1], true);
        var pk = G.pickedOf(shown, st.items || [], st.layout || {}, st.rule), p;
        for (p in pk) got[p] = 1;
      }
      paint();
    }
    // Smoothness guard: while the cart drives we count frames. Under 30 fps for a full second = this device cannot do 3D
    // smoothly. We remember that (so Kit3D.supported() is false from now on) and tell the screen through opts.onSlow().
    var slowTold = false;
    function watch(my) {
      if (!root.requestAnimationFrame || slowTold) return;
      var t0 = 0, n = 0, bad = 0;
      (function f(now) {
        if (dead || my !== token || !moving) return;
        if (!t0) t0 = now;
        n++;
        if (now - t0 >= 500) {
          bad = (n * 1000 / (now - t0)) < 30 ? bad + 1 : 0;
          t0 = now; n = 0;
          if (bad >= 2) {
            slowTold = true;
            try { root.localStorage.setItem(SLOW_KEY, '1'); } catch (e) {}
            call(opts.onSlow);
            return;
          }
        }
        root.requestAnimationFrame(f);
      })(0);
    }
    function walk(squares, ms, my) {          // drive the cart over these squares; resolves true if not cut short
      return new Promise(function (done) {
        var i = 0;
        moving = true; watch(my);
        cart.style.transitionDuration = ms + 'ms';
        (function next() {
          if (dead || my !== token) return done(false);
          if (i >= squares.length) { moving = false; return done(true); }
          var cell = squares[i++], prev = shown[shown.length - 1];
          if (prev !== cell) face(prev, cell);
          shown.push(cell); place(cell);
          later(function () { if (dead || my !== token) return done(false); arrive(cell); next(); }, ms);
        })();
      });
    }

    var api = {
      el: stage,
      update: function (o) {
        if (dead || !o) return api;
        var k2, routeGiven = Object.prototype.hasOwnProperty.call(o, 'route');
        for (k2 in o) if (k2 !== 'route' && Object.prototype.hasOwnProperty.call(st, k2)) st[k2] = o[k2];
        if ('layout' in o) patchLayout();
        if ('rule' in o) patchRule();
        if ('ghost' in o) {
          var g = st.ghost, two = g && g.length && Array.isArray(g[0]);
          ghostA.setAttribute('points', pointsOf(two ? g[0] : g)); ghostB.setAttribute('points', pointsOf(two ? g[1] : null));
        }
        if (routeGiven) {
          var want = o.route;
          if (!same(want, st.route)) {
            var grows = want && shown && !moving && startsWith(want, shown) && want.length > shown.length;
            st.route = want ? want.slice() : null;
            if (grows && !reduced() && !doc.hidden) {
              var extra = want.slice(shown.length);
              walk(extra, extra.length > 8 ? 70 : 110, ++token);
            } else jumpTo(st.route);
          }
        }
        paint();
        return api;
      },
      play: function (route, o) {
        if (dead || !route || !route.length) return Promise.resolve(false);
        o = o || {};
        var rest = {}, k2;
        for (k2 in o) if (k2 === 'layout' || k2 === 'items' || k2 === 'rule' || k2 === 'ghost') rest[k2] = o[k2];
        api.update(rest);
        st.route = route.slice();
        if (reduced() || doc.hidden) { jumpTo(route); return Promise.resolve(true); }
        jumpTo([route[0]]);
        var my = token, ms = Math.max(25, Math.min(o.speed || 90, (o.maxMs || 7000) / route.length));
        return new Promise(function (done) {
          later(function () {
            if (dead || my !== token) return done(false);
            walk(route.slice(1), ms, my).then(done);
          }, o.delay || 0);
        });
      },
      walking: function () { return moving; },
      destroy: function () {
        dead = true; token++;
        timers.forEach(clearTimeout); timers = [];
        root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerup', onUp); root.removeEventListener('resize', fit);
        if (ro) ro.disconnect();
        if (stage.parentNode) stage.parentNode.removeChild(stage);
      }
    };
    patchLayout(); paint();
    return api;
  }

  root.Kit3D = { createMap: createMap, supported: supported, forget: function () { try { root.localStorage.removeItem(SLOW_KEY); } catch (e) {} } };
})(typeof self !== 'undefined' ? self : this);
