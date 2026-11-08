/* DataRain - анимированный «дождь данных» для первого экрана (сайт V2).
   Перенос React-компонента data-rain.tsx на чистый JavaScript без зависимостей:
   та же физика (поток, обтекание курсора, вихри Кармана), отрисовка и свечение.

   Использование:
     const rain = DataRain.mount(element, { count, flowSpeed, obstacleRadius, autopilot, palette });
     rain.refresh();  // перечитать цвета/количество
     rain.destroy();  // остановить и убрать слушатели

   Цвета берутся из CSS-переменных --dr-calm, --dr-mid, --dr-hot, --dr-core
   (см. css/data-rain.css) или из options.palette.
   При prefers-reduced-motion рисуется один статичный кадр без анимации. */
(function (global) {
  'use strict';

  /* ───────────── константы ───────────── */
  var MAX = 7000;          // ёмкость частиц
  var L = 19;              // точек истории на частицу
  var STEP = 1 / 60;       // фиксированный шаг физики
  var PUFFS = 32;          // пул вихрей
  var TAU = Math.PI * 2;
  var AGE_BUCKETS = 6;
  var SEGS_PER_BUCKET = 3;

  var DEFAULT_CALM = [10, 99, 255];
  var DEFAULT_MID = [0, 212, 255];
  var DEFAULT_HOT = [0, 247, 255];
  var DEFAULT_CORE = [234, 252, 255];

  var BASE_ALPHA = [0.2, 0.32, 0.48];
  var BASE_WIDTH = [0.7, 0.9, 1.2];
  var ALPHA_GAIN = 1.3;
  var HEAD_WIDTH = 1.4;

  var K_RELAX = 1 - Math.exp(-STEP / 0.12);
  var K_Q = 1 - Math.exp(-STEP * 8);
  var K_CURSOR = 1 - Math.exp(-STEP * 18);
  var K_VEL = 1 - Math.exp(-STEP * 10);
  var K_IN = 1 - Math.exp(-STEP / 0.06);
  var K_OUT = 1 - Math.exp(-STEP / 0.2);
  var FIRE_P = 0.03 * STEP;
  var FIRE_DECAY = Math.exp(-STEP / 0.45);
  var PUFF_DECAY = Math.exp(-STEP / 1.1);

  /* ───────────── помощники ───────────── */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseHex(input, fallback) {
    if (!input) return fallback;
    var s = String(input).trim().replace(/^#/, '');
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return fallback;
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* Один член бездивергентного поля покачивания ψ = A/|k|·sin(k·x + ωt + φ) */
  function makeWave(lambda, angle, omega, phase, amp) {
    var k = TAU / lambda;
    return { kx: k * Math.cos(angle), ky: k * Math.sin(angle), om: omega, ph: phase,
      au: amp * Math.sin(angle), av: -amp * Math.cos(angle) };
  }
  var WAVE_0 = makeWave(380, 0.35, 0.18, 0.7, 16);
  var WAVE_1 = makeWave(620, 1.9, 0.27, 2.1, 13);
  var WAVE_2 = makeWave(900, 3.4, 0.35, 4.2, 10);

  /* ───────────── движок ───────────── */
  function mount(root, options) {
    var opts = options || {};
    if (!root) return null;
    if (!root.classList.contains('dr-root')) root.classList.add('dr-root');
    if (opts.fullscreen === false) root.classList.add('dr-root--contained');

    var bloom = document.createElement('canvas'); bloom.className = 'dr-bloom';
    var main = document.createElement('canvas'); main.className = 'dr-main';
    var vignette = document.createElement('div'); vignette.className = 'dr-vignette';
    var grain = document.createElement('div'); grain.className = 'dr-grain';
    root.append(bloom, main, vignette, grain);

    var ctx = main.getContext('2d');
    var bctx = bloom.getContext('2d');
    if (!ctx || !bctx) return null;

    var reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var rand = mulberry32(7);

    var disposed = false, initialised = false, live = false;
    var w = 0, h = 0, dpr = 1, bw = 1, bh = 1;

    var px = new Float32Array(MAX), py = new Float32Array(MAX);
    var vx = new Float32Array(MAX), vy = new Float32Array(MAX);
    var pz = new Float32Array(MAX), v0 = new Float32Array(MAX);
    var qv = new Float32Array(MAX), fire = new Float32Array(MAX);
    var len = new Uint8Array(MAX);
    var hx = new Float32Array(MAX * L), hy = new Float32Array(MAX * L);
    var head = 0;

    var groupList = [];
    for (var gi = 0; gi < 6; gi++) groupList.push(new Int32Array(MAX));
    var groupCount = new Int32Array(6);

    var strokeStyles = new Array(6 * AGE_BUCKETS).fill('');
    var strokeWidths = new Float32Array(6 * AGE_BUCKETS);
    var headStyles = ['', ''];
    var haloGradient = null;

    var pX = new Float32Array(PUFFS), pY = new Float32Array(PUFFS);
    var pGamma = new Float32Array(PUFFS), pAge = new Float32Array(PUFFS);
    var pAlive = new Uint8Array(PUFFS);
    var aX = new Float32Array(PUFFS), aY = new Float32Array(PUFFS);
    var aG = new Float32Array(PUFFS), aC2 = new Float32Array(PUFFS), aR2 = new Float32Array(PUFFS);
    var aCount = 0, puffCursor = 0, shedSign = 1, shedAcc = 0;

    var simTime = 0, liveTime = 0, active = 0, targetCount = 0, quality = 1;

    var pointerActive = false, pointerX = 0, pointerY = 0;
    var idleSince = 0, idleDelay = 1.2, prevSrc = 0;
    var tgtX = 0, tgtY = 0, cx = 0, cy = 0, pcx = 0, pcy = 0, vcx = 0, vcy = 0;
    var influence = 0, curA = 64;

    var raf = 0, last = 0, acc = 0;
    var frameEma = 16.7, workEma = 4, slowFrames = 0, fastFrames = 0;
    var visible = true;

    /* ── стили и палитра ── */
    function buildStyles() {
      var cs = getComputedStyle(root);
      var pal = opts.palette || {};
      var calm = parseHex(pal.calm || cs.getPropertyValue('--dr-calm'), DEFAULT_CALM);
      var mid = parseHex(pal.mid || cs.getPropertyValue('--dr-mid'), DEFAULT_MID);
      var hot = parseHex(pal.hot || cs.getPropertyValue('--dr-hot'), DEFAULT_HOT);
      var core = parseHex(cs.getPropertyValue('--dr-core'), DEFAULT_CORE);
      var colours = [calm, mid, hot];
      for (var g = 0; g < 6; g++) {
        var depth = g < 3 ? 0 : 1;
        var bucket = g % 3;
        var c = colours[bucket];
        for (var ab = 0; ab < AGE_BUCKETS; ab++) {
          var falloff = Math.pow(1 - (ab + 0.5) / AGE_BUCKETS, 1.5);
          var alpha = Math.min(0.95, BASE_ALPHA[bucket] * (depth === 0 ? 0.55 : 1) * falloff * ALPHA_GAIN);
          strokeStyles[g * AGE_BUCKETS + ab] = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha.toFixed(3) + ')';
          var width = BASE_WIDTH[bucket] * (depth === 0 ? 0.75 : 1) * (1 - (0.45 * ab) / AGE_BUCKETS);
          strokeWidths[g * AGE_BUCKETS + ab] = clamp(width, 0.6, 1.3);
        }
      }
      headStyles[0] = 'rgba(' + core[0] + ',' + core[1] + ',' + core[2] + ',0.5)';
      headStyles[1] = 'rgba(' + core[0] + ',' + core[1] + ',' + core[2] + ',0.85)';
      var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',1)');
      grad.addColorStop(0.45, 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',0.32)');
      grad.addColorStop(1, 'rgba(' + hot[0] + ',' + hot[1] + ',' + hot[2] + ',0)');
      haloGradient = grad;
    }

    /* ── частицы ── */
    function seedParticle(i, uniform) {
      var x, y;
      if (uniform) { x = rand() * w; y = rand() * h; }
      else { x = -40 + rand() * (w + 80); y = -40 - rand() * 80; }
      var z = 0.35 + 0.65 * rand();
      var nominal = 70 + 90 * z * z;
      var flow = clamp(opts.flowSpeed != null ? opts.flowSpeed : 1, 0.05, 5);
      pz[i] = z; v0[i] = nominal; len[i] = 9 + Math.floor(rand() * 11);
      px[i] = x; py[i] = y; vx[i] = 0; vy[i] = nominal * flow; qv[i] = 1; fire[i] = 0;
      var base = i * L;
      for (var k = 0; k < L; k++) { hx[base + k] = x; hy[base + k] = y; }
    }
    function seedAll() { for (var i = 0; i < MAX; i++) seedParticle(i, true); }
    function setActive(n, uniform) {
      var next = clamp(Math.round(n), 1, MAX);
      for (var i = active; i < next; i++) seedParticle(i, uniform);
      active = next;
    }
    function applyCount(uniform) {
      var auto = clamp(Math.round((w * h) / 520), 1200, 5200);
      var requested = opts.count;
      targetCount = clamp(Math.round(requested != null ? requested : auto), 1, MAX);
      setActive(targetCount * quality, uniform);
    }

    /* ── вихри ── */
    function spawnPuff(a, speed) {
      var dxn = vcx / speed, dyn = vcy / speed;
      var sign = shedSign; shedSign = -shedSign;
      var j = puffCursor; puffCursor = (puffCursor + 1) % PUFFS;
      pX[j] = cx - dxn * 0.6 * a - dyn * sign * 0.7 * a;
      pY[j] = cy - dyn * 0.6 * a + dxn * sign * 0.7 * a;
      pGamma[j] = clamp(sign * Math.min(speed, 1200) * a * 1.5, -105000, 105000);
      pAge[j] = 0; pAlive[j] = 1;
    }

    /* ── шаг физики ── */
    function simulate() {
      var flow = clamp(opts.flowSpeed != null ? opts.flowSpeed : 1, 0.05, 5);
      var obsR = opts.obstacleRadius != null ? opts.obstacleRadius : 64;
      var autopilotOn = opts.autopilot != null ? opts.autopilot : true;

      head = (head + 1) % L;
      simTime += STEP;
      if (live) liveTime += STEP;

      var ghostOn = !reduced && autopilotOn && !pointerActive && live && liveTime - idleSince >= idleDelay;
      var src = pointerActive ? 2 : ghostOn ? 1 : 0;
      if (src === 1) {
        tgtX = w * (0.5 + 0.32 * Math.sin(0.37 * liveTime));
        tgtY = h * (0.5 + 0.28 * Math.sin(0.53 * liveTime + 1.2));
      } else if (src === 2) { tgtX = pointerX; tgtY = pointerY; }
      var snap = src !== 0 && prevSrc === 0 && influence < 0.05;
      prevSrc = src;

      if (snap) { cx = tgtX; cy = tgtY; pcx = cx; pcy = cy; vcx = 0; vcy = 0; }
      else {
        pcx = cx; pcy = cy;
        cx += (tgtX - cx) * K_CURSOR; cy += (tgtY - cy) * K_CURSOR;
        vcx += ((cx - pcx) / STEP - vcx) * K_VEL; vcy += ((cy - pcy) / STEP - vcy) * K_VEL;
      }

      influence += ((src !== 0 ? 1 : 0) - influence) * (src !== 0 ? K_IN : K_OUT);
      var infl = influence;
      var vcMag = Math.sqrt(vcx * vcx + vcy * vcy);
      var a = obsR + Math.min(vcMag * 0.025, 36);
      curA = a;

      if (infl > 0.3 && vcMag > 60) {
        var dxm = cx - pcx, dym = cy - pcy;
        shedAcc += Math.sqrt(dxm * dxm + dym * dym);
        var guard = 0;
        while (shedAcc >= 28 && guard < 4) { shedAcc -= 28; guard++; spawnPuff(a, vcMag); }
        if (shedAcc >= 28) shedAcc = 0;
      } else shedAcc = 0;

      aCount = 0;
      var puffDrift = 0.5 * 115 * flow * STEP;
      for (var j = 0; j < PUFFS; j++) {
        if (pAlive[j] === 0) continue;
        var age = pAge[j] + STEP;
        if (age > 2.4) { pAlive[j] = 0; continue; }
        pAge[j] = age; pGamma[j] *= PUFF_DECAY; pY[j] += puffDrift;
        var c2p = 676 + 90 * age;
        aX[aCount] = pX[j]; aY[aCount] = pY[j]; aG[aCount] = pGamma[j] / TAU;
        aC2[aCount] = c2p; aR2[aCount] = 36 * c2p; aCount++;
      }

      var ph0 = WAVE_0.om * simTime + WAVE_0.ph, ph1 = WAVE_1.om * simTime + WAVE_1.ph, ph2 = WAVE_2.om * simTime + WAVE_2.ph;
      var obsOn = infl > 0.002, projectOn = infl > 0.05, projScale = Math.min(1, infl * 1.5);
      var respawnBottom = h + 40, respawnRight = w + 120;

      for (var i = 0; i < active; i++) {
        var x0 = px[i], y0 = py[i], z = pz[i], v0e = v0[i] * flow;
        var c0 = Math.cos(WAVE_0.kx * x0 + WAVE_0.ky * y0 + ph0);
        var c1 = Math.cos(WAVE_1.kx * x0 + WAVE_1.ky * y0 + ph1);
        var c2 = Math.cos(WAVE_2.kx * x0 + WAVE_2.ky * y0 + ph2);
        var tx = (WAVE_0.au * c0 + WAVE_1.au * c1 + WAVE_2.au * c2) * z;
        var ty = v0e + (WAVE_0.av * c0 + WAVE_1.av * c1 + WAVE_2.av * c2) * z;

        var zf = 0.55 + 0.45 * z;
        var aE = a * zf;
        var rx = x0 - cx, ry = y0 - cy;
        var pertX = 0, pertY = 0, deficit = 0;

        if (obsOn) {
          var d2 = rx * rx + ry * ry;
          var Ux = -vcx, Uy = v0e - vcy;
          var U = Math.sqrt(Ux * Ux + Uy * Uy);
          if (U > 1e-3) {
            if (U > 900) { var scU = 900 / U; Ux *= scU; Uy *= scU; U = 900; }
            var ex = Ux / U, ey = Uy / U;
            var s = rx * ex + ry * ey;
            var n = -rx * ey + ry * ex;
            if (s > 0 && s < 12 * aE) {
              var wd = 0.9 * aE + 0.2 * s;
              var nn = n / wd;
              deficit = 0.55 * Math.exp(-s / (3 * aE)) * Math.exp(-nn * nn);
            }
            var near = 9 * aE;
            if (d2 < near * near) {
              var rho2 = Math.max(s * s + n * n, aE * aE * 0.64);
              var kk = (aE * aE) / (rho2 * rho2);
              var ds = -U * kk * (s * s - n * n);
              var dn = -U * kk * 2 * s * n;
              var win = 1;
              var inner = 5 * aE;
              if (d2 > inner * inner) {
                var t = (Math.sqrt(d2) - inner) / (4 * aE);
                win = 1 - t * t * (3 - 2 * t);
              }
              pertX = (ds * ex - dn * ey) * win;
              pertY = (ds * ey + dn * ex) * win;
            }
          }
        }

        var vorX = 0, vorY = 0;
        for (var jj = 0; jj < aCount; jj++) {
          var dx = x0 - aX[jj], dy = y0 - aY[jj];
          var d2p = dx * dx + dy * dy + 1e-3;
          var r2 = aR2[jj];
          if (d2p < r2) {
            var f = (aG[jj] * (1 - Math.exp(-d2p / aC2[jj]))) / d2p;
            var wnd = 1 - d2p / r2;
            var fw = f * wnd * wnd * zf;
            vorX += -dy * fw; vorY += dx * fw;
          }
        }

        var keep = 1 - deficit * infl;
        tx = tx * keep + pertX * infl + vorX;
        ty = ty * keep + pertY * infl + vorY;

        var ux = vx[i] + (tx - vx[i]) * K_RELAX;
        var uy = vy[i] + (ty - vy[i]) * K_RELAX;
        var sp2 = ux * ux + uy * uy;
        if (sp2 > 810000) { var sc = 900 / Math.sqrt(sp2); ux *= sc; uy *= sc; }
        var x = x0 + ux * STEP, y = y0 + uy * STEP;

        if (projectOn) {
          var aP = aE * projScale;
          var qx = x - cx, qy = y - cy;
          var q2 = qx * qx + qy * qy;
          var lim = 0.98 * aP;
          if (q2 < lim * lim) {
            var rr = Math.sqrt(q2);
            var nx = rr < 1e-3 ? 0 : qx / rr, ny = rr < 1e-3 ? 1 : qy / rr;
            x = cx + nx * aP; y = cy + ny * aP;
            var vn = (ux - vcx) * nx + (uy - vcy) * ny;
            if (vn < 0) { ux -= vn * nx; uy -= vn * ny; }
          }
        }

        vx[i] = ux; vy[i] = uy; px[i] = x; py[i] = y;

        if (y > respawnBottom || x < -120 || x > respawnRight || y < -600) { seedParticle(i, false); continue; }

        qv[i] += (Math.sqrt(ux * ux + uy * uy) / v0e - qv[i]) * K_Q;
        if (rand() < FIRE_P) fire[i] = 1;
        else { var ff = fire[i] * FIRE_DECAY; fire[i] = ff < 0.01 ? 0 : ff; }

        var slot = i * L + head;
        hx[slot] = x; hy[slot] = y;
      }
    }

    /* ── отрисовка ── */
    function render() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (influence > 0.02 && haloGradient) {
        var speed = Math.sqrt(vcx * vcx + vcy * vcy);
        var r = 1.5 * curA;
        ctx.globalAlpha = Math.min(1, (0.05 + Math.min(speed / 4000, 0.07)) * influence);
        ctx.setTransform(dpr * r, 0, 0, dpr * r, dpr * cx, dpr * cy);
        ctx.fillStyle = haloGradient;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.globalAlpha = 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      groupCount.fill(0);
      for (var i = 0; i < active; i++) {
        var qq = qv[i];
        var b = qq < 1.25 ? 0 : qq < 1.85 ? 1 : 2;
        if (fire[i] > 0.35 && b < 2) b++;
        var g = (pz[i] < 0.62 ? 0 : 3) + b;
        groupList[g][groupCount[g]++] = i;
      }

      for (var g2 = 0; g2 < 6; g2++) {
        var cnt = groupCount[g2];
        if (cnt === 0) continue;
        var list = groupList[g2];
        for (var ab = 0; ab < AGE_BUCKETS; ab++) {
          var k0 = ab * SEGS_PER_BUCKET, k1 = k0 + SEGS_PER_BUCKET;
          ctx.strokeStyle = strokeStyles[g2 * AGE_BUCKETS + ab];
          ctx.lineWidth = strokeWidths[g2 * AGE_BUCKETS + ab];
          ctx.beginPath();
          for (var j = 0; j < cnt; j++) {
            var pi = list[j];
            var segs = len[pi] - 1;
            if (k0 >= segs) continue;
            var base = pi * L;
            var kEnd = Math.min(k1, segs);
            var idx = (head - k0 + L) % L;
            ctx.moveTo(hx[base + idx], hy[base + idx]);
            for (var k = k0; k < kEnd; k++) {
              idx = idx === 0 ? L - 1 : idx - 1;
              ctx.lineTo(hx[base + idx], hy[base + idx]);
            }
          }
          ctx.stroke();
        }
      }

      var prevHead = head === 0 ? L - 1 : head - 1;
      ctx.lineWidth = HEAD_WIDTH;
      for (var depth = 0; depth < 2; depth++) {
        ctx.strokeStyle = headStyles[depth];
        ctx.beginPath();
        for (var bb = 1; bb < 3; bb++) {
          var gg = depth * 3 + bb;
          var c = groupCount[gg];
          var l = groupList[gg];
          for (var m = 0; m < c; m++) {
            var q = l[m];
            if (bb === 1 && fire[q] <= 0.5) continue;
            var bs = q * L;
            ctx.moveTo(hx[bs + head], hy[bs + head]);
            ctx.lineTo(hx[bs + prevHead], hy[bs + prevHead]);
          }
        }
        ctx.stroke();
      }

      bctx.clearRect(0, 0, bw, bh);
      bctx.drawImage(main, 0, 0, bw, bh);
    }

    /* ── жизненный цикл ── */
    function presim(seconds) { var n = Math.round(seconds / STEP); for (var s = 0; s < n; s++) simulate(); }

    function rebuildStatic() {
      seedAll(); active = 0; applyCount(true);
      pointerActive = true; pointerX = w * 0.4; pointerY = h * 0.45;
      tgtX = pointerX; tgtY = pointerY; cx = pcx = pointerX; cy = pcy = pointerY;
      vcx = 0; vcy = 0; influence = 1; prevSrc = 2; aCount = 0; pAlive.fill(0);
      presim(3); render();
    }

    function resize() {
      var rect = root.getBoundingClientRect();
      var nw = Math.max(1, rect.width || window.innerWidth);
      var nh = Math.max(1, rect.height || window.innerHeight);
      var d = Math.min(window.devicePixelRatio || 1, 2);
      if (nw * nh * d * d > 4.5e6) d = Math.sqrt(4.5e6 / (nw * nh));
      if (nw === w && nh === h && d === dpr) return;
      w = nw; h = nh; dpr = d;
      main.width = Math.max(1, Math.round(w * dpr));
      main.height = Math.max(1, Math.round(h * dpr));
      bw = Math.max(1, Math.ceil(w / 4)); bh = Math.max(1, Math.ceil(h / 4));
      bloom.width = bw; bloom.height = bh;
      bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'medium';
      if (!initialised) return;
      if (reduced) { rebuildStatic(); return; }
      for (var i = 0; i < active; i++) {
        if (px[i] < -120 || px[i] > w + 120 || py[i] > h + 40) seedParticle(i, false);
      }
      applyCount(true);
      render();
    }

    /* ── ввод ── */
    function onMove(e) {
      var r = root.getBoundingClientRect();
      pointerX = e.clientX - r.left; pointerY = e.clientY - r.top;
      pointerActive = true;
    }
    function onLeave() {
      if (!pointerActive) return;
      pointerActive = false; idleSince = liveTime; idleDelay = 4;
    }
    function onUp(e) { if (e.pointerType !== 'mouse') onLeave(); }

    /* ── главный цикл ── */
    function frame(now) {
      if (disposed) return;
      var dtRaw = Math.max(0, now - last);
      last = now;
      acc += Math.min(0.05, dtRaw / 1000);
      var t0 = performance.now();
      var n = 0;
      while (acc >= STEP && n < 3) { simulate(); acc -= STEP; n++; }
      if (n === 3) acc = 0;
      if (n > 0) render();
      var work = performance.now() - t0;

      if (dtRaw > 0 && dtRaw < 100) { frameEma += (dtRaw - frameEma) * 0.05; workEma += (work - workEma) * 0.05; }
      if (frameEma > 20) { slowFrames++; fastFrames = 0; }
      else if (frameEma < 18.5 && workEma < 12) { fastFrames++; slowFrames = 0; }
      else { slowFrames = 0; fastFrames = 0; }
      if (slowFrames >= 60 && quality > 0.4) { quality = Math.max(0.4, quality - 0.1); slowFrames = 0; applyCount(false); }
      else if (fastFrames >= 180 && quality < 1) { quality = Math.min(1, quality + 0.05); fastFrames = 0; applyCount(false); }

      raf = requestAnimationFrame(frame);
    }
    function start() {
      cancelAnimationFrame(raf);
      last = performance.now(); acc = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    function onVisibility() {
      if (document.hidden || !visible) stop();
      else if (live && !disposed && !raf) start();
    }

    /* ── запуск ── */
    resize();
    buildStyles();
    seedAll();
    applyCount(true);
    cx = pcx = tgtX = w * 0.5;
    cy = pcy = tgtY = h * 0.5;

    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(root);

    /* Дополнение для сайта: когда первый экран прокручен и не виден, анимация останавливается */
    var io = null;
    if (!reduced && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        onVisibility();
      }, { threshold: 0 });
      io.observe(root);
    }

    if (reduced) {
      initialised = true;
      rebuildStatic();
    } else {
      presim(2.5);
      render();
      initialised = true;
      live = true;
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onMove, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onLeave, { passive: true });
      window.addEventListener('blur', onLeave);
      document.documentElement.addEventListener('pointerleave', onLeave);
      document.addEventListener('visibilitychange', onVisibility);
      start();
    }

    return {
      refresh: function () {
        if (disposed || !initialised) return;
        buildStyles();
        if (reduced) rebuildStatic(); else applyCount(false);
      },
      destroy: function () {
        disposed = true; live = false; stop();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onLeave);
        window.removeEventListener('blur', onLeave);
        document.documentElement.removeEventListener('pointerleave', onLeave);
        document.removeEventListener('visibilitychange', onVisibility);
        ro.disconnect();
        if (io) io.disconnect();
        haloGradient = null;
        root.replaceChildren();
      },
      get stats() { return { active: active, quality: quality, frameMs: frameEma, workMs: workEma, running: raf !== 0 }; }
    };
  }

  global.DataRain = { mount: mount };

  /* Автозапуск на сайте: элемент с id="data-rain" на первом экране */
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('data-rain');
    if (!el) return;
    var narrow = window.innerWidth < 640;
    global.asgDataRain = mount(el, {
      fullscreen: false,
      flowSpeed: 0.85,
      obstacleRadius: narrow ? 46 : 70,
      autopilot: true,
      count: narrow ? 1800 : undefined
    });
  });
})(window);
