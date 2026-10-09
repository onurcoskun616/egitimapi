/* Eğitim video motoru: çizim kütüphanesi + oynatıcı.
   Aynı dosya hem tarayıcıdaki önizlemede hem de GitHub Actions render'ında kullanılır.
   Sahne kodu: function(u, T, S) gövdesi. u = sahne içindeki saniye, T = cümle başlangıç saniyeleri, S = {dur,k}.
   Tuval mantıksal boyutu 900x1600 (çıktı 1080x1920). */
(function (root) {
  'use strict';
  const W = 900, H = 1600;
  const FD = '"Archivo","Inter Display","Arial Black",sans-serif';
  const FM = '"JetBrains Mono","DejaVu Sans Mono",Menlo,monospace';
  const C = { bg: '#05070e', fg: '#eef1f7', muted: '#8a94ad', dim: '#3a4560', hv: '#ff8a2a', lv: '#3fb0ff', cool: '#2ee6c9', red: '#ff4f4f', yel: '#ffc93c', green: '#3ee0a1', violet: '#b48cff', copper: '#e08a4a', steel: '#8d97ab' };
  let c = null; // aktif 2D bağlam

  /* ---------- yardımcılar ---------- */
  const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const e3 = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const outB = x => { const s = 1.5; x = x - 1; return x * x * ((s + 1) * x + s) + 1; };
  const lerp = (a, b, k) => a + (b - a) * k;
  const fade = (u, d = 0, l = .45) => ease(cl((u - d) / l));
  function rr(x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
  function txt(s, x, y, f, col, al = 'left') { c.font = f; c.fillStyle = col; c.textAlign = al; c.textBaseline = 'alphabetic'; c.fillText(s, x, y); }
  function wrap(s, maxW) { const ws = String(s).split(' '), ls = []; let l = ''; ws.forEach(w => { const t = l ? l + ' ' + w : w; if (c.measureText(t).width > maxW && l) { ls.push(l); l = w; } else l = t; }); if (l) ls.push(l); return ls; }
  function withA(a, fn) { if (a <= 0) return; const g = c.globalAlpha; c.globalAlpha = g * a; fn(); c.globalAlpha = g; }
  function poly(p) { c.beginPath(); c.moveTo(...p[0]); for (let i = 1; i < p.length; i++) c.lineTo(...p[i]); c.closePath(); }
  function smooth(p) { c.beginPath(); const n = p.length, m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; c.moveTo(...m(p[n - 1], p[0])); for (let i = 0; i < n; i++) c.quadraticCurveTo(p[i][0], p[i][1], ...m(p[i], p[(i + 1) % n])); c.closePath(); }
  // Hatalı renk yazımlarını onar: 'rgb(1,2,3)66' → rgba, '#abc' + '80' → #aabbcc80
  function fixColor(col) {
    if (typeof col !== 'string') return 'rgba(0,0,0,0)';
    let m = col.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)([0-9a-f]{2})$/i);
    if (m) return `rgba(${m[1]},${m[2]},${m[3]},${(parseInt(m[4], 16) / 255).toFixed(3)})`;
    m = col.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f]{2})$/i);
    if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}${m[4]}`;
    return col;
  }
  function addStops(g, stops) { (stops || []).forEach(([o, col]) => { o = Math.min(1, Math.max(0, +o || 0)); try { g.addColorStop(o, fixColor(col)); } catch { try { g.addColorStop(o, 'rgba(0,0,0,0)'); } catch { } } }); return g; }
  function lg(x0, y0, x1, y1, stops) { return addStops(c.createLinearGradient(x0, y0, x1, y1), stops); }
  function rg(x, y, r0, r1, stops) { return addStops(c.createRadialGradient(x, y, Math.max(0, r0), x, y, Math.max(0, r1)), stops); }
  function glow(col, b, fn) { c.save(); c.shadowColor = col; c.shadowBlur = b; fn(); c.restore(); }
  // #rrggbb döndürür; böylece shadeHex(c) + '66' gibi saydamlık eklemeleri de geçerli renk olur
  function shadeHex(h, a) { if (typeof h !== 'string' || h[0] !== '#') return h; let x = h.slice(1); if (x.length === 3 || x.length === 4) x = x.split('').map(ch => ch + ch).join(''); const al = x.length === 8 ? x.slice(6) : ''; const n = parseInt(x.slice(0, 6), 16); if (isNaN(n)) return h; const r = n >> 16, g = (n >> 8) & 255, b = n & 255; a = +a || 0; const f = v => Math.max(0, Math.min(255, Math.round(a < 0 ? v * (1 + a) : v + (255 - v) * a))); return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('') + al; }
  function line(pts, col, w = 4) { c.beginPath(); c.moveTo(...pts[0]); pts.slice(1).forEach(p => c.lineTo(...p)); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); }
  function circle(x, y, r, fill, stroke, w = 3) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = w; c.stroke(); } }
  function arrow(x1, y1, x2, y2, col, w = 6, head = 24) { const a = Math.atan2(y2 - y1, x2 - x1); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2 - Math.cos(a) * head * .5, y2 - Math.sin(a) * head * .5); c.stroke(); c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - Math.cos(a - .45) * head, y2 - Math.sin(a - .45) * head); c.lineTo(x2 - Math.cos(a + .45) * head, y2 - Math.sin(a + .45) * head); c.closePath(); c.fill(); }

  /* ---------- 3D ilkel şekiller ---------- */
  function box3d(x, y, w, h, d, o = {}) {
    const top = o.top || '#3b4256', front = o.front || '#2a3043', side = o.side || '#1b2030', edge = o.edge || 'rgba(255,255,255,.18)';
    const ox = d * .6, oy = -d * .45;
    poly([[x, y], [x + w, y], [x + w + ox, y + oy], [x + ox, y + oy]]); c.fillStyle = top; c.fill();
    poly([[x + w, y], [x + w + ox, y + oy], [x + w + ox, y + oy + h], [x + w, y + h]]); c.fillStyle = side; c.fill();
    c.fillStyle = typeof front === 'string' ? lg(0, y, 0, y + h, [[0, front], [1, shadeHex(front, -.35)]]) : front; c.fillRect(x, y, w, h);
    c.strokeStyle = edge; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w + ox, y + oy); c.stroke();
    if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = 3; poly([[x, y], [x + ox, y + oy], [x + w + ox, y + oy], [x + w + ox, y + oy + h], [x + w, y + h], [x, y + h]]); c.stroke(); }
    return (fx, fy) => [x + fx * w + fy * ox, y + fy * oy];
  }
  function cylV(cx, ty, r, h, dark, light, topc) {
    dark = dark || '#2a3043'; light = light || '#8d97ab';
    const ry = r * .3; c.fillStyle = lg(cx - r, 0, cx + r, 0, [[0, dark], [.35, light], [.6, shadeHex(light, -.15)], [1, dark]]);
    c.beginPath(); c.moveTo(cx - r, ty); c.lineTo(cx - r, ty + h); c.ellipse(cx, ty + h, r, ry, 0, Math.PI, 0, true); c.lineTo(cx + r, ty); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(cx, ty, r, ry, 0, 0, Math.PI * 2); c.fillStyle = topc || shadeHex(light, .2); c.fill();
  }
  function cylH(x, cy, len, r, dark, light) {
    dark = dark || '#2a3043'; light = light || '#8d97ab';
    c.fillStyle = lg(0, cy - r, 0, cy + r, [[0, dark], [.35, light], [.65, shadeHex(light, -.15)], [1, dark]]); c.fillRect(x, cy - r, len, r * 2);
    c.beginPath(); c.ellipse(x + len, cy, r * .3, r, 0, 0, Math.PI * 2); c.fillStyle = shadeHex(light, .2); c.fill();
  }
  function bolt(x, y, r = 6) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = lg(x - r, y - r, x + r, y + r, [[0, '#e6ebf4'], [1, '#5d6880']]); c.fill(); }
  function panel(x, y, w, h, stroke) { rr(x, y, w, h, 26); c.fillStyle = lg(0, y, 0, y + h, [[0, '#1a2134'], [1, '#0b0f1b']]); c.fill(); c.strokeStyle = stroke || 'rgba(255,255,255,.18)'; c.lineWidth = 3; c.stroke(); [[x + 18, y + 18], [x + w - 18, y + 18], [x + 18, y + h - 18], [x + w - 18, y + h - 18]].forEach(([a, b]) => bolt(a, b, 7)); }
  function cable(pts, col = C.hv, w = 18, hot = false) { c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(...pts[0]); pts.slice(1).forEach(p => c.lineTo(...p)); c.strokeStyle = '#3a2412'; c.lineWidth = w + 8; c.stroke(); c.strokeStyle = col; c.lineWidth = w; c.stroke(); if (hot) glow(col, 22, () => { c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = w * .35; c.stroke(); }); }
  function busbar(pts, hot) { c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(...pts[0]); pts.slice(1).forEach(p => c.lineTo(...p)); c.strokeStyle = '#5a3a24'; c.lineWidth = 18; c.stroke(); c.strokeStyle = hot ? '#ffb066' : '#a8653a'; c.lineWidth = 10; c.stroke(); if (hot) glow(C.hv, 22, () => { c.strokeStyle = 'rgba(255,170,90,.7)'; c.lineWidth = 6; c.stroke(); }); }

  /* ---------- etiketler ---------- */
  function pill(s, x, y, col, o = {}) {
    const size = o.size || 22, al = o.al || 'center', fill = !!o.fill;
    c.font = `800 ${size}px ${FM}`; const w = c.measureText(s).width + size * 1.3, h = size * 1.9; const x0 = al === 'center' ? x - w / 2 : al === 'left' ? x : x - w;
    rr(x0, y - h / 2, w, h, h / 2); c.fillStyle = fill ? col : 'rgba(8,11,20,.88)'; c.fill(); c.strokeStyle = col; c.lineWidth = 2.5; c.stroke();
    txt(s, x0 + w / 2, y + size * .36, `800 ${size}px ${FM}`, fill ? '#05070e' : col, 'center'); return w;
  }
  function callout(s, wx, wy, dx, dy, col, a = 1, sc = 1) {
    withA(a, () => { c.save(); c.translate(wx, wy); c.scale(1 / sc, 1 / sc);
      c.strokeStyle = col; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(dx, dy); c.stroke();
      c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fillStyle = col; c.fill(); c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
      pill(s, dx, dy, col); c.restore(); });
  }
  function flowLine(pts, col, u, dir = 1, w = 8, a = 1) {
    withA(a, () => { c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(...pts[0]); pts.slice(1).forEach(p => c.lineTo(...p));
      c.strokeStyle = col; c.lineWidth = w; c.globalAlpha *= .55; c.stroke(); c.globalAlpha /= .55;
      c.save(); c.setLineDash([w * 2.6, w * 3]); c.lineDashOffset = -dir * u * w * 22; c.strokeStyle = '#ffffff'; c.lineWidth = w * .5; c.shadowColor = col; c.shadowBlur = w * 2.4; c.stroke(); c.restore(); });
  }
  function pulse(x, y, u, col = C.red, r0 = 30) { const p = (u * 1.2) % 1; c.strokeStyle = col; c.globalAlpha = 1 - p; c.lineWidth = 5; c.beginPath(); c.arc(x, y, r0 + p * 70, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
  function badgeText(s, x, y, col, size = 54) { glow(col, 26, () => txt(s, x, y, `900 ${size}px ${FD}`, col, 'center')); }

  /* ---------- hazır nesneler ---------- */
  const BODY = [[0, -70], [-6, -150], [22, -200], [120, -232], [262, -246], [362, -338], [470, -382], [640, -382], [762, -332], [884, -256], [1040, -226], [1090, -192], [1102, -132], [1096, -70], [1060, -50], [40, -48]];
  const WH = [[230, -92], [880, -92]];
  function wheel(x, y, a, alpha = 1) { withA(alpha, () => { c.save(); c.translate(x, y); c.beginPath(); c.arc(0, 0, 92, 0, Math.PI * 2); c.fillStyle = '#0d111c'; c.fill(); c.strokeStyle = '#242c40'; c.lineWidth = 6; c.stroke();
    c.beginPath(); c.arc(0, 0, 62, 0, Math.PI * 2); c.fillStyle = lg(-50, -50, 50, 50, [[0, '#eef2f8'], [1, '#6f7a92']]); c.fill();
    c.rotate(a); c.fillStyle = 'rgba(30,38,58,.85)'; for (let i = 0; i < 5; i++) { c.rotate(Math.PI * 2 / 5); poly([[14, -6], [56, -16], [56, 16], [14, 6]]); c.fill(); }
    c.beginPath(); c.arc(0, 0, 16, 0, Math.PI * 2); c.fillStyle = '#2a3350'; c.fill(); c.restore(); }); }
  function carWindows(a, b) { [[[384, -330], [482, -368], [553, -370], [553, -266], [372, -266]], [[569, -370], [636, -370], [748, -302], [744, -266], [569, -266]]].forEach(p => { poly(p); c.fillStyle = lg(0, -370, 0, -266, [[0, a], [1, b]]); c.fill(); }); }
  /* Yan görünüş otomobil. Yerel koordinat: x 0..1100 (ön sağda), y 0 = zemin. ghost=true ise X-ray görünüm. Kullanım: c.save(); c.translate(x,y); c.scale(s,s); car(false, u); c.restore(); */
  function car(ghost = false, u = 0, paint = '#3468d8') {
    if (!ghost) {
      smooth(BODY); c.fillStyle = lg(0, -390, 0, -40, [[0, shadeHex(paint, .35)], [.25, paint], [.6, shadeHex(paint, -.3)], [1, shadeHex(paint, -.65)]]); c.fill();
      c.save(); smooth(BODY); c.clip(); WH.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 106, 0, Math.PI * 2); c.fillStyle = '#04060c'; c.fill(); });
      c.fillStyle = lg(0, -280, 0, -230, [[0, 'rgba(255,255,255,0)'], [.5, 'rgba(255,255,255,.32)'], [1, 'rgba(255,255,255,0)']]); c.fillRect(-10, -282, 1130, 52);
      c.strokeStyle = 'rgba(4,10,30,.55)'; c.lineWidth = 3; c.beginPath(); c.moveTo(560, -262); c.lineTo(556, -70); c.moveTo(360, -262); c.lineTo(350, -80); c.moveTo(770, -262); c.lineTo(770, -90); c.stroke(); c.restore();
      carWindows('#1a2846', '#070d1c'); c.fillStyle = '#fff4c7'; rr(1046, -198, 52, 10, 5); c.fill(); c.fillStyle = '#ff2e3e'; rr(-4, -196, 24, 10, 5); c.fill();
      WH.forEach(([x, y]) => wheel(x, y, -u * 4, 1));
    } else {
      smooth(BODY); c.fillStyle = 'rgba(20,44,96,.38)'; c.fill();
      glow('rgba(63,176,255,.8)', 18, () => { smooth(BODY); c.strokeStyle = 'rgba(120,200,255,.85)'; c.lineWidth = 4; c.stroke(); });
      c.save(); smooth(BODY); c.clip(); c.strokeStyle = 'rgba(120,200,255,.1)'; c.lineWidth = 1.5; for (let x = 0; x < 1110; x += 40) { c.beginPath(); c.moveTo(x, -400); c.lineTo(x, 0); c.stroke(); } c.restore();
      carWindows('rgba(40,80,150,.35)', 'rgba(20,40,80,.2)'); WH.forEach(([x, y]) => wheel(x, y, 0, .45));
    }
  }
  function multimeter(x, y, val, col = '#1b2030') { rr(x, y, 170, 270, 26); c.fillStyle = lg(x, y, x + 170, y + 270, [[0, '#ffd23f'], [1, '#c99a00']]); c.fill(); rr(x + 16, y + 20, 138, 74, 10); c.fillStyle = '#b8c4a8'; c.fill();
    txt(val, x + 146, y + 76, `800 30px ${FM}`, col, 'right'); c.beginPath(); c.arc(x + 85, y + 170, 46, 0, Math.PI * 2); c.fillStyle = '#1b2030'; c.fill(); c.save(); c.translate(x + 85, y + 170); c.rotate(-.6); c.fillStyle = '#ffd23f'; c.fillRect(-4, -40, 8, 30); c.restore(); }
  function gauge(x, y, r, v, col = C.green, label = '') { c.lineCap = 'round'; c.lineWidth = r * .14; c.beginPath(); c.arc(x, y, r, Math.PI * .75, Math.PI * 2.25); c.strokeStyle = '#1b2234'; c.stroke();
    c.beginPath(); c.arc(x, y, r, Math.PI * .75, Math.PI * (.75 + 1.5 * cl(v))); c.strokeStyle = col; c.stroke(); if (label) txt(label, x, y + r * .15, `900 ${Math.round(r * .4)}px ${FD}`, C.fg, 'center'); }
  function screen(x, y, w, h) { rr(x, y, w, h, 40); c.fillStyle = lg(0, y, 0, y + h, [[0, '#2a3044'], [1, '#0e121e']]); c.fill(); rr(x + 22, y + 22, w - 44, h - 44, 28); c.fillStyle = '#03050a'; c.fill(); }
  function connector(x, y, gap = 0, pinCol = '#d4af37') { cable([[x - 260, y], [x - 120 - gap, y]], C.hv, 26);
    rr(x - 130 - gap, y - 70, 150, 140, 18); c.fillStyle = lg(0, y - 70, 0, y + 70, [[0, '#ff9a3c'], [1, '#b85400']]); c.fill();
    rr(x + 30, y - 90, 200, 180, 18); c.fillStyle = lg(0, y - 90, 0, y + 90, [[0, '#59627a'], [1, '#262c3c']]); c.fill();
    c.fillStyle = '#d4af37'; rr(x + 18 - gap, y - 40, 24, 20, 4); c.fill(); rr(x + 18 - gap, y + 20, 24, 20, 4); c.fill(); c.fillStyle = pinCol; rr(x + 12 - gap, y - 8, 30, 16, 4); c.fill(); }
  function warnTriangle(x, y, s = 1) { c.save(); c.translate(x, y); c.scale(s, s); poly([[0, -180], [180, 130], [-180, 130]]); c.fillStyle = C.yel; c.fill(); c.lineJoin = 'round'; c.strokeStyle = '#111'; c.lineWidth = 16; c.stroke(); poly([[10, -70], [-45, 50], [0, 50], [-30, 120], [50, 10], [5, 10], [40, -70]]); c.fillStyle = '#111'; c.fill(); c.restore(); }
  function gear(x, y, r, u = 0, col = '#8d97ab', teeth = 12) { c.save(); c.translate(x, y); c.rotate(u); c.beginPath(); for (let i = 0; i < teeth * 2; i++) { const a = i * Math.PI / teeth, rad = i % 2 ? r : r * 1.15; c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); } c.closePath(); c.fillStyle = lg(-r, -r, r, r, [[0, shadeHex(col, .3)], [1, shadeHex(col, -.4)]]); c.fill(); c.beginPath(); c.arc(0, 0, r * .3, 0, Math.PI * 2); c.fillStyle = '#0b0f1b'; c.fill(); c.restore(); }
  function flame(x, y, s = 1, u = 0) { const fl = i => 1 + .09 * Math.sin(u * 13 + i * 2.1); const f = (dx, w, h, col) => { c.beginPath(); c.moveTo(x + dx - w / 2, y); c.bezierCurveTo(x + dx - w * .62, y - h * .45, x + dx - w * .12, y - h * .6, x + dx, y - h); c.bezierCurveTo(x + dx + w * .12, y - h * .6, x + dx + w * .62, y - h * .45, x + dx + w / 2, y); c.closePath(); c.fillStyle = col; c.fill(); };
    glow('rgba(255,110,20,.8)', 40, () => { f(-50 * s, 140 * s, 240 * s * fl(1), '#ff5a1f'); f(50 * s, 140 * s, 220 * s * fl(2), '#ff5a1f'); f(0, 170 * s, 300 * s * fl(3), '#ff5a1f'); }); f(0, 110 * s, 200 * s * fl(4), '#ff9b2e'); f(0, 70 * s, 130 * s * fl(5), '#ffd45a'); }
  function hero(fn, u, sc = 1, dy = 0, cy = 800) { const k = 1.04 - .04 * e3(cl(u / 6)); c.save(); c.translate(F.hx + Math.sin(u * .3) * 6, F.hy + (cy - 800 + dy) * F.hs + Math.cos(u * .25) * 4); c.scale(sc * k * F.hs, sc * k * F.hs); fn(); c.restore(); }

  const LIB = { C, W, H, FD, FM, cl, ease, e3, outB, lerp, fade, rr, txt, wrap, withA, poly, smooth, lg, rg, glow, shadeHex, line, circle, arrow, box3d, cylV, cylH, bolt, panel, cable, busbar, pill, callout, flowLine, pulse, badgeText, wheel, car, multimeter, gauge, screen, connector, warnTriangle, gear, flame, hero, ctx: () => c };
  const LIB_NAMES = Object.keys(LIB);

  function compileScene(code) {
    try { const f = new Function(...LIB_NAMES, 'u', 'T', 'S', '"use strict";\n' + code); const vals = LIB_NAMES.map(n => LIB[n]); return (u, T, S) => f(...vals, u, T, S); }
    catch (e) { return () => { txt('Sahne kodu hatası', F.hx, F.hy - 20, `900 46px ${FD}`, C.red, 'center'); txt(String(e.message).slice(0, 60), F.hx, F.hy + 40, `700 22px ${FM}`, C.muted, 'center'); }; }
  }

  /* ---------- zamanlama ---------- */
  const CPS = 15, LEAD = .9, GAP = .45;
  function layout(bundle) {
    const scenes = bundle.scenes.map(s => Object.assign({}, s));
    scenes.forEach(s => {
      if (!s.capT) { let tt = LEAD; s.capT = s.cap.map(x => { const st = tt; tt += x.length / CPS + GAP; return st; }); s.dur = Math.max(s.minDur || 6, Math.ceil((tt + .6) * 2) / 2); s.capR = s.cap.map(() => CPS); }
    });
    let acc = 0; scenes.forEach(s => { s.s = acc; acc += s.dur; s.e = acc; s.fn = compileScene(s.code || ''); });
    return { scenes, total: acc };
  }

  /* ---------- biçimler ----------
     Sahne kodu her zaman 900×1600 düzenindeki hero alanına (merkez 0,0; x ±400, y −330…+340) çizer.
     Biçim; tuval boyutunu, hero alanının yerini/ölçeğini ve çerçeve öğelerinin yerleşimini belirler. */
  const FORMATS = {
    dikey: { label: '9:16', W: 900, H: 1600, S: 1.2, hx: 450, hy: 800, hs: 1,
      brandY: 66, chipY: 232, titleX: 56, titleY: 300, titleW: 790, titleMax: 84, titleMin: 40,
      big: { x: 56, y: 1270, size: 64 }, cap: { x: 56, y: 1352, w: 770, font: 27, lh: 42, lines: 3 }, barY: 1530, footY: 1566 },
    yatay: { label: '16:9', W: 1600, H: 900, S: 1.2, hx: 1115, hy: 470, hs: 1,
      brandY: 56, chipY: 150, titleX: 56, titleY: 210, titleW: 560, titleMax: 64, titleMin: 34,
      big: { x: 56, y: 520, size: 52 }, cap: { x: 56, y: 600, w: 540, font: 25, lh: 38, lines: 4 }, barY: 830, footY: 866 },
    kare: { label: '1:1', W: 900, H: 900, S: 1.2, hx: 450, hy: 462, hs: .72,
      brandY: 50, chipY: 82, titleX: 56, titleY: 134, titleW: 790, titleMax: 58, titleMin: 30,
      big: { x: 56, y: 752, size: 42 }, cap: { x: 56, y: 776, w: 780, font: 22, lh: 32, lines: 2 }, barY: 862, footY: 888, noFoot: true },
    dikey45: { label: '4:5', W: 900, H: 1125, S: 1.2, hx: 450, hy: 540, hs: .8,
      brandY: 56, chipY: 100, titleX: 56, titleY: 156, titleW: 790, titleMax: 66, titleMin: 34,
      big: { x: 56, y: 878, size: 52 }, cap: { x: 56, y: 910, w: 770, font: 25, lh: 37, lines: 3 }, barY: 1060, footY: 1094 },
  };
  let F = FORMATS.dikey;
  function setFormat(name) { F = FORMATS[name] || FORMATS.dikey; return F; }

  /* ---------- çerçeve ---------- */
  function bgGrid() { c.fillStyle = 'rgba(120,150,210,.12)'; for (let x = 38; x < F.W; x += 76) for (let y = 38; y < F.H; y += 76) { c.fillRect(x - 6, y - 1, 12, 2); c.fillRect(x - 1, y - 6, 2, 12); } }
  function background() { c.fillStyle = C.bg; c.fillRect(0, 0, F.W, F.H); c.fillStyle = rg(F.hx, F.hy - 40, 40, 760, [[0, 'rgba(30,50,100,.38)'], [1, 'rgba(5,7,14,0)']]); c.fillRect(0, 0, F.W, F.H); bgGrid(); }
  function header(P, sc, si, u, t) {
    const R = F.W - 40;
    c.fillStyle = C.yel; c.fillRect(40, F.brandY - 10, 10, 10);
    c.font = `800 17px ${FM}`; let brand = (P.brand || 'NASIL ÇALIŞIR') + '  ·  ' + (P.topic || '').toUpperCase(); while (c.measureText(brand).width > F.W - 330 && brand.length > 10) brand = brand.slice(0, -2);
    txt(brand, 58, F.brandY, `800 17px ${FM}`, C.muted);
    const s = Math.floor(t); txt(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.floor((t % 1) * 100)).padStart(2, '0')}   F${String(Math.floor(t * 60)).padStart(5, '0')}`, R, F.brandY, `800 17px ${FM}`, C.muted, 'right');
    const k = fade(u, .15, .5); withA(k, () => {
      const col = sc.warn ? C.red : C.lv; c.font = `800 20px ${FM}`; const lb = `${si + 1} · ${(sc.ch || '').toUpperCase()}`; const w = c.measureText(lb).width + 34;
      rr(F.titleX, F.chipY, w, 40, 20); c.fillStyle = 'rgba(8,11,20,.9)'; c.fill(); c.strokeStyle = col; c.lineWidth = 2.5; c.stroke(); txt(lb, F.titleX + w / 2, F.chipY + 27, `800 20px ${FM}`, col, 'center');
      if (sc.tag) pill(sc.tag.text, F.titleX + w + 14, F.chipY + 20, sc.tag.color || C.yel, { al: 'left', fill: true, size: 18 });
      const title = (sc.title || '').toUpperCase(); let size = title.length > 15 ? Math.round(F.titleMax * .79) : F.titleMax; c.font = `900 ${size}px ${FD}`; while (c.measureText(title).width > F.titleW && size > F.titleMin) { size -= 2; c.font = `900 ${size}px ${FD}`; }
      c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 20; c.fillStyle = sc.tcol ? sc.tcol : lg(0, F.titleY, 0, F.titleY + size, [[0, '#ffffff'], [1, '#b9c2d6']]); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(title, F.titleX - 24 * (1 - k), F.titleY + size * .92); c.restore();
    });
  }
  function bigNum(sc, u) { const b = sc.big; if (!b || !b.text) return; const at = sc.capT[Math.min(sc.capT.length - 1, b.at || 0)] + (b.at ? 0 : 1.2); if (u < at) return;
    withA(fade(u, at, .4), () => { c.save(); c.shadowColor = b.color || C.yel; c.shadowBlur = 26; let size = b.text.length > 16 ? Math.round(F.big.size * .78) : F.big.size; c.font = `900 ${size}px ${FD}`; while (c.measureText(b.text).width > F.cap.w + 20 && size > 24) { size -= 2; c.font = `900 ${size}px ${FD}`; } c.fillStyle = b.color || C.yel; c.textAlign = 'left'; c.fillText(b.text, F.big.x, F.big.y); c.restore(); }); }
  function caption(P, sc, u, t, total) {
    const K = F.cap; let idx = 0; sc.capT.forEach((x, i) => { if (u >= x) idx = i; }); const st = sc.capT[idx], y0 = K.y, fnt = `800 ${K.font}px ${FM}`;
    c.font = fnt; const lines = wrap(sc.cap[idx] || '', K.w).slice(0, K.lines);
    c.fillStyle = C.yel; c.fillRect(K.x, y0 - 6, 6, Math.max(2, lines.length) * K.lh + 12); let shown = Math.floor((u - st) * (sc.capR ? sc.capR[idx] : CPS));
    lines.forEach((ln, i) => { const part = ln.slice(0, Math.max(0, shown)); shown -= ln.length + 1; c.font = fnt; const pw = c.measureText(part).width;
      txt(part, K.x + 28, y0 + K.lh * .72 + i * K.lh, fnt, C.fg); if (part.length < ln.length) txt(ln.slice(part.length), K.x + 28 + pw, y0 + K.lh * .72 + i * K.lh, fnt, 'rgba(238,241,247,.2)'); });
    const bw = F.W - 112; c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(56, F.barY, bw, 3); c.fillStyle = C.yel; c.fillRect(56, F.barY, bw * (t / total), 3); c.fillRect(56 + bw * (t / total) - 2, F.barY - 6, 4, 15);
    if (!F.noFoot) { txt((sc.ch || '').toUpperCase(), 56, F.footY, `800 15px ${FM}`, C.muted); txt(`${Math.round(F.W * F.S)}×${Math.round(F.H * F.S)} · 60 FPS`, F.W - 56, F.footY, `800 15px ${FM}`, C.muted, 'right'); }
  }
  function drawScene(P, L, i, u, t) { const sc = L.scenes[i]; background(); try { sc.fn(u, sc.capT, { dur: sc.dur, k: sc.k }); } catch (e) { const E = root.EVEngine && root.EVEngine.errors; if (E && !E[sc.k]) { E[sc.k] = String(e.message).slice(0, 160); console.warn('Sahne ' + sc.k + ' çizim hatası:', e.message); } c.setTransform(F.S, 0, 0, F.S, 0, 0); if (root.__EV_PREVIEW) txt('Çizim hatası: ' + String(e.message).slice(0, 40), F.hx, F.hy, `700 24px ${FM}`, C.red, 'center'); } c.setTransform(F.S, 0, 0, F.S, 0, 0); c.globalAlpha = 1; c.shadowBlur = 0; c.setLineDash([]); if (P.__bare) return; header(P, sc, i, u, t); bigNum(sc, u); caption(P, sc, u, t, L.total); }

  function createPlayer(canvas, bundle) {
    setFormat(bundle.format); const FF = F;
    canvas.width = Math.round(FF.W * FF.S); canvas.height = Math.round(FF.H * FF.S); c = canvas.getContext('2d'); c.setTransform(FF.S, 0, 0, FF.S, 0, 0);
    const L = layout(bundle);
    function render(t) {
      F = FF; c = canvas.getContext('2d'); c.setTransform(F.S, 0, 0, F.S, 0, 0); t = cl(t, 0, L.total - .001);
      let si = L.scenes.findIndex(s => t >= s.s && t < s.e); if (si < 0) si = L.scenes.length - 1; const u = t - L.scenes[si].s, TR = .6;
      const ox = F.W / 2, oy = F.H / 2, RM = Math.hypot(F.W, F.H) * .62;
      if (u < TR && si > 0) { drawScene(bundle, L, si - 1, L.scenes[si - 1].dur - .001, t); const r = e3(u / TR) * RM; c.save(); c.beginPath(); c.arc(ox, oy, r, 0, Math.PI * 2); c.clip(); drawScene(bundle, L, si, u, t); c.restore();
        glow(C.hv, 40, () => { c.beginPath(); c.arc(ox, oy, r, 0, Math.PI * 2); c.strokeStyle = `rgba(255,138,42,${1 - u / TR})`; c.lineWidth = 18; c.stroke(); }); }
      else drawScene(bundle, L, si, u, t);
      return si;
    }
    // Yalnızca illüstrasyon (başlık/altyazı yok): soru seçenekleri için sahne karesi
    function still(k, frac) {
      F = FF; c = canvas.getContext('2d'); c.setTransform(F.S, 0, 0, F.S, 0, 0);
      const i = L.scenes.findIndex(s => s.k === String(k)); if (i < 0) return null;
      const sc = L.scenes[i]; bundle.__bare = true; try { drawScene(bundle, L, i, sc.dur * (frac == null ? .9 : frac), sc.s); } finally { bundle.__bare = false; }
      return { x: (F.hx - 410 * F.hs) * F.S, y: (F.hy - 340 * F.hs) * F.S, w: 820 * F.hs * F.S, h: 690 * F.hs * F.S };
    }
    return { render, still, total: L.total, scenes: L.scenes, format: FF, width: canvas.width, height: canvas.height };
  }

  root.EVEngine = { createPlayer, layout, LIB_NAMES, W, H, FORMATS, errors: {} };
})(typeof window !== 'undefined' ? window : globalThis);
