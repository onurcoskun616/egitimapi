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
  /* Görsel stiller. teknik: koyu, derinlikli (varsayılan). sade: açık krem zemin, düz renk, kalın mürekkep kontur (editoryal anlatım). */
  const PALETTES = {
    teknik: Object.assign({}, C, { ink: '#eef1f7', paper: '#0c1222', leaf: '#3ee0a1' }),
    sade: { bg: '#f3efe4', fg: '#25272c', muted: '#8b8679', dim: '#cfc8b6', hv: '#e8724f', lv: '#2f4b6e', cool: '#4f9c94', red: '#e2624f', yel: '#e7b53c', green: '#2f8f6f', violet: '#8a6fb3', copper: '#c27a45', steel: '#9aa1ab', ink: '#25272c', paper: '#faf8f1', leaf: '#2f8f6f' },
  };
  PALETTES.sinema = Object.assign({}, PALETTES.teknik, { bg: '#000000', hl: '#8fd3ff' });
  Object.assign(C, PALETTES.teknik);
  let STYLE = 'teknik';
  const FS = '"Inter","Noto Sans","DejaVu Sans",system-ui,sans-serif';
  function setStyle(name) { STYLE = PALETTES[name] ? name : 'teknik'; Object.assign(C, PALETTES[STYLE]); return STYLE; }
  const sade = () => STYLE === 'sade';
  const cine = () => STYLE === 'sinema';
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
  function glow(col, b, fn) { if (sade()) { c.save(); fn(); c.restore(); return; } c.save(); c.shadowColor = col; c.shadowBlur = b; fn(); c.restore(); }
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
    const al = o.al || 'center', fill = !!o.fill, size = o.size || (sade() ? 25 : 22);
    if (sade()) {
      c.font = `800 ${size}px ${FS}`; const w = c.measureText(s).width + size * 1.4, h = size * 1.75; let x0 = al === 'center' ? x - w / 2 : al === 'left' ? x : x - w;
      if (!o.free) { const d = keepIn(x0, y - h / 2, w, h); x0 += d[0]; y += d[1]; }
      rr(x0, y - h / 2, w, h, h / 2); c.fillStyle = fill ? col : C.paper; c.fill(); c.strokeStyle = fill ? C.ink : col; c.lineWidth = 2.5; c.stroke();
      txt(s, x0 + w / 2, y + size * .36, `800 ${size}px ${FS}`, fill ? C.paper : col, 'center'); return w;
    }
    c.font = `800 ${size}px ${FM}`; const w = c.measureText(s).width + size * 1.3, h = size * 1.9; const x0 = al === 'center' ? x - w / 2 : al === 'left' ? x : x - w;
    rr(x0, y - h / 2, w, h, h / 2); c.fillStyle = fill ? col : 'rgba(8,11,20,.88)'; c.fill(); c.strokeStyle = col; c.lineWidth = 2.5; c.stroke();
    txt(s, x0 + w / 2, y + size * .36, `800 ${size}px ${FM}`, fill ? '#05070e' : col, 'center'); return w;
  }
  function callout(s, wx, wy, dx, dy, col, a = 1, sc = 1) {
    if (sade()) return withA(a, () => { c.save(); c.translate(wx, wy); c.scale(1 / sc, 1 / sc);
      c.font = `800 25px ${FS}`; const pw = c.measureText(s).width + 35, ph = 44, d = keepIn(dx - pw / 2, dy - ph / 2, pw, ph); dx += d[0]; dy += d[1];
      c.strokeStyle = col; c.lineWidth = 2.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(dx * .1, dy * .8, dx, dy); c.stroke();
      circle(0, 0, 7, col, C.ink, 2); pill(s, dx, dy, col, { free: true }); c.restore(); });
    withA(a, () => { c.save(); c.translate(wx, wy); c.scale(1 / sc, 1 / sc);
      c.strokeStyle = col; c.lineWidth = 2.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(dx, dy); c.stroke();
      c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fillStyle = col; c.fill(); c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
      pill(s, dx, dy, col); c.restore(); });
  }
  function flowLine(pts, col, u, dir = 1, w = 8, a = 1) {
    if (sade()) return withA(a, () => { c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(...pts[0]); pts.slice(1).forEach(p => c.lineTo(...p));
      c.strokeStyle = C.ink; c.lineWidth = w + 4; c.stroke(); c.strokeStyle = col; c.lineWidth = w; c.stroke();
      c.save(); c.setLineDash([w * 1.4, w * 2.2]); c.lineDashOffset = -dir * u * w * 14; c.strokeStyle = C.paper; c.lineWidth = w * .45; c.stroke(); c.restore(); });
    withA(a, () => { c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(...pts[0]); pts.slice(1).forEach(p => c.lineTo(...p));
      c.strokeStyle = col; c.lineWidth = w; c.globalAlpha *= .55; c.stroke(); c.globalAlpha /= .55;
      c.save(); c.setLineDash([w * 2.6, w * 3]); c.lineDashOffset = -dir * u * w * 22; c.strokeStyle = '#ffffff'; c.lineWidth = w * .5; c.shadowColor = col; c.shadowBlur = w * 2.4; c.stroke(); c.restore(); });
  }
  function pulse(x, y, u, col = C.red, r0 = 30) { const p = (u * 1.2) % 1; c.strokeStyle = col; c.globalAlpha = 1 - p; c.lineWidth = 5; c.beginPath(); c.arc(x, y, r0 + p * 70, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
  function badgeText(s, x, y, col, size = 54) { glow(col, 26, () => txt(s, x, y, `900 ${size}px ${FD}`, col, 'center')); }

  /* ---------- sade stil yardımcıları ---------- */
  // ink(fn, dolgu, kalınlık): fn yolu açar (rr/poly/smooth ya da c.beginPath...), önce dolgu sonra mürekkep kontur
  function ink(fn, fill, w = 4) { fn(); if (fill) { c.fillStyle = fill; c.fill(); } c.strokeStyle = C.ink; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
  // cam(x, y, z, fn): (x,y) noktasını yerinde tutarak z kat yakınlaştırır (makro yakın çekim, ayrıntıya zum)
  // keepIn(x, y, w, h): kutu kartın (görünür alanın) dışına taşıyorsa yerel koordinatta gereken kaydırmayı verir
  let SAFE = null;
  function keepIn(x, y, w, h) {
    if (!SAFE || !sade()) return [0, 0]; const m = c.getTransform(); if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || !m.a || !m.d) return [0, 0];
    const X0 = m.a * x + m.e, Y0 = m.d * y + m.f, W = m.a * w, H = m.d * h; let dx = 0, dy = 0;
    if (W < SAFE.w) { if (X0 < SAFE.x) dx = SAFE.x - X0; else if (X0 + W > SAFE.x + SAFE.w) dx = SAFE.x + SAFE.w - X0 - W; }
    if (H < SAFE.h) { if (Y0 < SAFE.y) dy = SAFE.y - Y0; else if (Y0 + H > SAFE.y + SAFE.h) dy = SAFE.y + SAFE.h - Y0 - H; }
    return [dx / m.a, dy / m.d];
  }
  function cam(x, y, z, fn) { c.save(); c.translate(x - x * z, y - y * z); c.scale(z, z); fn(); c.restore(); }
  // inset(x, y, w, h, fn, {label, col, from:[x,y]}): küçük ek panel; fn(w,h) panelin merkezini (0,0) alarak çizer
  function inset(x, y, w, h, fn, o = {}) {
    const d = keepIn(x, y - 24, w, h + 24); x += d[0]; y += d[1];
    c.save(); rr(x, y, w, h, 22); c.fillStyle = C.paper; c.fill(); c.clip(); c.translate(x + w / 2, y + h / 2); fn(w, h); c.restore();
    rr(x, y, w, h, 22); c.strokeStyle = C.ink; c.lineWidth = 4; c.stroke();
    if (o.from) { c.strokeStyle = o.col || C.red; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(...o.from); c.quadraticCurveTo(o.from[0], y - 10, x + w / 2, y); c.stroke(); circle(o.from[0], o.from[1], 6, o.col || C.red); }
    if (o.label) pill(o.label, x + w / 2, y, o.col || C.red, { size: 20 });
  }
  // leader(noktalar, renk): işaret çizgisi (3 nokta verilirse eğri)
  function leader(pts, col, w = 3) { c.strokeStyle = col || C.red; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(...pts[0]); if (pts.length === 3) c.quadraticCurveTo(...pts[1], ...pts[2]); else pts.slice(1).forEach(p => c.lineTo(...p)); c.stroke(); }
  // seeded(i): her karede aynı 0..1 sayı (parçacık ve nokta dağılımı için; Math.random yerine)
  const seeded = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // grow(u, başla, süre): 0..1 yumuşak büyüme (çizgi uzaması, ağ yayılması)
  const grow = (u, d = 0, l = 1) => e3(cl((u - d) / l));
  // part(a, b, k, renk, kalınlık): a→b doğru parçasının k oranını çizer
  function part(a, b, k, col, w = 4) { if (k <= 0) return; line([a, [lerp(a[0], b[0], k), lerp(a[1], b[1], k)]], col, w); }

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

  const LIB = { C, W, H, FD, FM, FS, ink, cam, inset, leader, seeded, grow, part, cl, ease, e3, outB, lerp, fade, rr, txt, wrap, withA, poly, smooth, lg, rg, glow, shadeHex, line, circle, arrow, box3d, cylV, cylH, bolt, panel, cable, busbar, pill, callout, flowLine, pulse, badgeText, wheel, car, multimeter, gauge, screen, connector, warnTriangle, gear, flame, hero, ctx: () => c };
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
  // Sade stilde yerleşim: ortada mürekkep çerçeveli kart (illüstrasyon), üstte anahtar kelime, altta etiket ve altyazı
  const SADE = {
    dikey: { hx: 450, hy: 780, hs: .9, kwY: 400, kwMax: 76, labelY: 1125, capY: 1235, capW: 780, capFont: 40, capLh: 52 },
    yatay: { hx: 800, hy: 468, hs: .78, kwY: 128, kwMax: 58, labelY: 772, capY: 836, capW: 1240, capFont: 34, capLh: 44 },
    kare: { hx: 450, hy: 452, hs: .62, kwY: 178, kwMax: 50, labelY: 690, capY: 750, capW: 800, capFont: 30, capLh: 40 },
    dikey45: { hx: 450, hy: 565, hs: .74, kwY: 240, kwMax: 60, labelY: 848, capY: 920, capW: 800, capFont: 34, capLh: 46 },
  };
  let F = FORMATS.dikey;
  function setFormat(name) { const b = FORMATS[name] || FORMATS.dikey; F = sade() ? Object.assign({}, b, SADE[name] || SADE.dikey) : b; return F; }

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
  /* ---------- sade stil çerçevesi ---------- */
  const card = () => ({ x: F.hx - 410 * F.hs, y: F.hy - 345 * F.hs, w: 820 * F.hs, h: 690 * F.hs });
  function runScene(sc, u) {
    try { sc.fn(u, sc.capT, { dur: sc.dur, k: sc.k }); }
    catch (e) { const E = root.EVEngine && root.EVEngine.errors; if (E && !E[sc.k]) { E[sc.k] = String(e.message).slice(0, 160); console.warn('Sahne ' + sc.k + ' çizim hatası:', e.message); } c.setTransform(F.S, 0, 0, F.S, 0, 0); if (root.__EV_PREVIEW) txt('Çizim hatası: ' + String(e.message).slice(0, 40), F.hx, F.hy, `700 24px ${FM}`, C.red, 'center'); }
    c.setTransform(F.S, 0, 0, F.S, 0, 0); c.globalAlpha = 1; c.shadowBlur = 0; c.setLineDash([]);
  }
  // Kartın içi: kâğıt zemin + sahne çizimi (kartın dışına taşmaz)
  function sadeCardContent(sc, u, clipW) {
    const k = card(); c.save(); rr(k.x, k.y, clipW == null ? k.w : clipW, k.h, 30); c.clip();
    c.fillStyle = C.paper; c.fillRect(k.x, k.y, k.w, k.h); const S = F.S, m = 16; SAFE = { x: (k.x + m) * S, y: (k.y + m) * S, w: (k.w - 2 * m) * S, h: (k.h - 2 * m) * S }; runScene(sc, u); SAFE = null; c.restore();
  }
  // Anahtar kelime başlığı: *vurgulu* kelime kırmızı. Birden çok satıra bölünebilir (" / " ya da genişlik)
  function keyword(s, a, pop) {
    if (!s) return; const words = []; String(s).toLocaleUpperCase('tr').split(/\s+/).filter(Boolean).forEach(w => { if (/^[·\-–—/|]$/.test(w) && words.length) words[words.length - 1] += ' ' + w; else words.push(w); });
    let size = F.kwMax; const maxW = Math.min(F.W - 120, 760);
    const measure = () => { c.font = `900 ${size}px ${FD}`; const lines = []; let cur = []; words.forEach(w => { const t = [...cur, w].join(' ').replace(/\*/g, ''); if (c.measureText(t).width > maxW && cur.length) { lines.push(cur); cur = [w]; } else cur.push(w); }); if (cur.length) lines.push(cur); return lines; };
    let lines = measure(); while (lines.length > 2 && size > 30) { size -= 4; lines = measure(); }
    withA(a, () => { c.save(); const sc = .92 + .08 * outB(cl(pop)); c.translate(F.W / 2, F.kwY); c.scale(sc, sc); c.font = `900 ${size}px ${FD}`; c.textBaseline = 'alphabetic';
      const lh = size * 1.02, y0 = -(lines.length - 1) * lh;
      lines.forEach((ln, li) => { const parts = ln.map(w => ({ t: w.replace(/\*/g, ''), hl: /^\*.*\*$/.test(w) || /^\*/.test(w) || /\*$/.test(w) })); const full = parts.map(p => p.t).join(' '); let x = -c.measureText(full).width / 2;
        parts.forEach((p, pi) => { c.fillStyle = p.hl ? C.red : C.ink; c.textAlign = 'left'; c.fillText(p.t, x, y0 + li * lh); x += c.measureText(p.t + (pi < parts.length - 1 ? ' ' : '')).width; }); });
      c.restore(); });
  }
  // Altyazıyı konuşmayla eş zamanlı, kısa parçalar halinde gösterir
  function chunks(s) { const ws = String(s).split(/\s+/).filter(Boolean), out = []; let cur = ''; ws.forEach(w => { const t = cur ? cur + ' ' + w : w; if ((t.length > 30 && cur) || (cur && /[,;:.!?]$/.test(cur) && cur.length > 12)) { out.push(cur); cur = w; } else cur = t; }); if (cur) out.push(cur); return out; }
  function sadeCaption(sc, u) {
    let idx = 0; sc.capT.forEach((x, i) => { if (u >= x) idx = i; }); if (u < sc.capT[0] - .05) return;
    const s = sc.cap[idx] || '', rate = sc.capR ? sc.capR[idx] : CPS, el = (u - sc.capT[idx]) * rate;
    const ch = chunks(s); let acc = 0, ci = 0; for (let i = 0; i < ch.length; i++) { if (el >= acc - 2) ci = i; acc += ch[i].length + 1; }
    let start = 0; for (let i = 0; i < ci; i++) start += ch[i].length + 1; const since = (el - start) / rate;
    const fnt = `800 ${F.capFont}px ${FS}`; c.font = fnt; const lines = wrap(ch[ci] || '', F.capW).slice(0, 2);
    withA(cl(since / .18 + .35), () => lines.forEach((ln, i) => txt(ln, F.W / 2, F.capY + i * F.capLh, fnt, C.ink, 'center')));
  }
  function sadeOverlay(P, sc, u, t, total) {
    const k = card();
    // kart çerçevesi + hafif gölge
    rr(k.x, k.y, k.w, k.h, 30); c.strokeStyle = C.ink; c.lineWidth = 5; c.stroke();
    // anahtar kelime: cümleye bağlı (kw dizisi) ya da sahne başında başlık
    let idx = 0; sc.capT.forEach((x, i) => { if (u >= x) idx = i; });
    const kws = Array.isArray(sc.kw) ? sc.kw : null; let kw = kws ? kws[idx] : (u < (sc.capT[1] || sc.dur) ? sc.title : '');
    const st = kws ? sc.capT[idx] : 0; if (kws && !kw && idx > 0 && kws[idx - 1] && u - sc.capT[idx] < .25) kw = kws[idx - 1];
    if (kw) keyword(kw, fade(u, st, .25), (u - st) / .35);
    if (sc.label) pill(String(sc.label).toLocaleUpperCase('tr'), F.W / 2, F.labelY, C.ink, { size: 19 });
    sadeCaption(sc, u);
    c.fillStyle = C.dim; c.fillRect(F.W / 2 - 60, F.H - 34, 120, 4); c.fillStyle = C.ink; c.fillRect(F.W / 2 - 60, F.H - 34, 120 * (t / total), 4);
  }
  function drawSade(P, L, i, u, t, prev) {
    const sc = L.scenes[i];
    if (P.__bare) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height); c.restore(); c.fillStyle = C.paper; c.fillRect(0, 0, F.W, F.H); SAFE = { x: 12 * F.S, y: 12 * F.S, w: (F.W - 24) * F.S, h: (F.H - 24) * F.S }; runScene(sc, u); SAFE = null; return; }
    c.fillStyle = C.bg; c.fillRect(0, 0, F.W, F.H);
    const k = card(); rr(k.x + 6, k.y + 8, k.w, k.h, 30); c.fillStyle = 'rgba(37,39,44,.08)'; c.fill();
    if (prev) { // geçiş: önceki sahne, yenisi soldan sağa silinerek gelir
      sadeCardContent(prev.sc, prev.u); const w = k.w * prev.k; sadeCardContent(sc, u, w);
      if (prev.k < 1) { c.strokeStyle = C.ink; c.lineWidth = 3; c.beginPath(); c.moveTo(k.x + w, k.y); c.lineTo(k.x + w, k.y + k.h); c.stroke(); }
    } else sadeCardContent(sc, u);
    sadeOverlay(P, sc, u, t, L.total);
  }

  /* ---------- sinematik stil: gerçekçi görsel + kamera hareketi + atmosfer + kelime kelime altyazı ---------- */
  const IMGS = {};
  function imgEntry(url) {
    let e = IMGS[url]; if (e) return e; e = IMGS[url] = { ok: false, err: false, img: null };
    if (typeof Image === 'undefined') { e.err = true; return e; }
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { e.ok = true; try { root.dispatchEvent && root.dispatchEvent(new Event('ev-img')); } catch { } };
    im.onerror = () => { e.err = true; }; im.src = url; e.img = im; return e;
  }
  const getImg = url => { if (!url) return null; const e = imgEntry(url); return e.ok ? e.img : null; };
  function preload(bundle) {
    const urls = []; (bundle && bundle.scenes || []).forEach(s => { if (s.img) urls.push(s.img); if (s.img2) urls.push(s.img2); });
    return Promise.all(urls.map(u => new Promise(ok => { const e = imgEntry(u); if (e.ok || e.err || !e.img) return ok(); e.img.addEventListener('load', ok); e.img.addEventListener('error', ok); setTimeout(ok, 45000); })));
  }
  const CINE = {
    dikey: { hookY: .13, cardY: .17, capY: .655, ctaY: .36, cnt: .5 },
    yatay: { hookY: .2, cardY: .18, capY: .83, ctaY: .42, cnt: .5 },
    kare: { hookY: .15, cardY: .15, capY: .8, ctaY: .4, cnt: .5 },
    dikey45: { hookY: .14, cardY: .15, capY: .72, ctaY: .38, cnt: .5 },
  };
  let GRAIN = null;
  function grain() {
    if (GRAIN !== null) return GRAIN; GRAIN = false;
    try { const g = document.createElement('canvas'); g.width = g.height = 192; const x = g.getContext('2d'), d = x.createImageData(192, 192);
      for (let i = 0; i < d.data.length; i += 4) { const v = Math.floor(seeded(i * .37 + 3) * 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0); GRAIN = g; } catch { }
    return GRAIN;
  }
  function coverImg(img, z, ox, oy) {
    const k = Math.max(F.W / img.width, F.H / img.height) * z, w = img.width * k, h = img.height * k;
    const mx = Math.max(0, (w - F.W) / 2), my = Math.max(0, (h - F.H) / 2);
    c.drawImage(img, F.W / 2 - w / 2 + cl(ox, -mx, mx), F.H / 2 - h / 2 + cl(oy, -my, my), w, h);
  }
  function camOf(sc, u) {
    const p = cl(u / Math.max(1, sc.dur)), e = p, A = F.W * .03, B = F.H * .025;
    const br = Math.sin(u * .7) * .004;
    switch (sc.cam) {
      case 'out': return { z: 1.17 - .12 * e + br, x: 0, y: 0 };
      case 'left': return { z: 1.12 + br, x: lerp(A, -A, e), y: 0 };
      case 'right': return { z: 1.12 + br, x: lerp(-A, A, e), y: 0 };
      case 'up': return { z: 1.12 + br, x: 0, y: lerp(-B, B, e) };
      case 'down': return { z: 1.12 + br, x: 0, y: lerp(B, -B, e) };
      default: return { z: 1.04 + .13 * e + br, x: 0, y: 0 };
    }
  }
  function fxLayer(fx, u) {
    const W2 = F.W, H2 = F.H;
    if (fx === 'smoke') for (let i = 0; i < 7; i++) {
      const sp = .025 + seeded(i + 1) * .03, ph = (u * sp + seeded(i + 11)) % 1, x = W2 * (.1 + .8 * seeded(i + 21)) + Math.sin(u * .4 + i) * 30, y = H2 * (1.05 - ph * .9), r = W2 * (.16 + .12 * seeded(i + 31)) * (.7 + ph * .8);
      const a = .13 * Math.sin(ph * Math.PI); c.fillStyle = rg(x, y, 0, r, [[0, `rgba(235,230,220,${a})`], [1, 'rgba(235,230,220,0)']]); c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (fx === 'dust' || fx === 'smoke') for (let i = 0; i < 46; i++) {
      const x = (seeded(i + 40) * W2 + Math.sin(u * .3 + i) * 24 + u * 6 * (seeded(i + 90) - .5)) % W2, y = (seeded(i + 60) * H2 - u * (6 + 10 * seeded(i + 70)) % H2 + H2) % H2;
      const a = .22 + .3 * Math.max(0, Math.sin(u * .9 + i * 1.7)); c.fillStyle = `rgba(255,240,215,${a * .7})`; c.beginPath(); c.arc(x, y, .9 + 1.6 * seeded(i + 80), 0, Math.PI * 2); c.fill();
    }
    if (fx === 'embers') for (let i = 0; i < 26; i++) {
      const ph = (u * (.05 + .05 * seeded(i + 5)) + seeded(i + 15)) % 1, x = W2 * seeded(i + 25) + Math.sin(u * 1.3 + i) * 18, y = H2 * (1 - ph);
      c.fillStyle = `rgba(255,${140 + 60 * seeded(i)},60,${.8 * Math.sin(ph * Math.PI)})`; c.beginPath(); c.arc(x, y, 1.5 + 1.5 * seeded(i + 35), 0, Math.PI * 2); c.fill();
    }
    if (fx === 'rain') { c.strokeStyle = 'rgba(200,215,235,.22)'; c.lineWidth = 1.4; c.beginPath();
      for (let i = 0; i < 90; i++) { const x = (seeded(i + 3) * W2 * 1.2 + u * 80) % (W2 * 1.2) - W2 * .1, y = (seeded(i + 7) * H2 + u * 900 * (.8 + .4 * seeded(i))) % H2; c.moveTo(x, y); c.lineTo(x - 7, y + 26); } c.stroke(); }
    if (fx === 'flicker') { const f = .5 + .5 * Math.sin(u * 9.1) * Math.sin(u * 3.7 + 1) + .2 * Math.sin(u * 23); c.fillStyle = `rgba(0,0,0,${.05 + .07 * cl(f)})`; c.fillRect(0, 0, W2, H2); }
  }
  // Konuşmayla eş zamanlı kelime grupları (en fazla 3 kelime / ~18 harf)
  function wordGroups(s) { const ws = String(s).split(/\s+/).filter(Boolean), g = []; let cur = []; ws.forEach(w => { const t = [...cur, w].join(' '); if (cur.length && (cur.length >= 3 || t.length > 18 || /[.!?…:;]$/.test(cur[cur.length - 1]))) { g.push(cur); cur = [w]; } else cur.push(w); }); if (cur.length) g.push(cur); return g; }
  const norm = w => String(w).toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
  function shadowText(fn) { c.save(); c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 14; c.shadowOffsetY = 2; fn(); c.restore(); }
  function cineCaption(sc, u, Lc) {
    let idx = -1; sc.capT.forEach((x, i) => { if (u >= x - .05) idx = i; }); if (idx < 0) return;
    if (sc.count === idx) return; // geri sayım sırasında altyazı yok
    const s = sc.cap[idx] || '', rate = sc.capR ? sc.capR[idx] : CPS, el = (u - sc.capT[idx]) * rate;
    const gs = wordGroups(s); let acc = 0, gi = 0, gStart = 0; for (let i = 0; i < gs.length; i++) { const len = gs[i].join(' ').length + 1; if (el >= acc - 1) { gi = i; gStart = acc; } acc += len; }
    const end = sc.capT[idx] + s.length / rate + .5; const nextT = sc.capT[idx + 1]; if (u > end && (nextT == null || u < nextT) && u - end > .6) return;
    const hl = new Set((sc.hl || []).flatMap(h => String(h).split(/\s+/)).map(norm));
    const size = Math.round(Math.min(F.W, F.H) * .042), fnt = `800 ${size}px ${FS}`; c.font = fnt;
    const words = gs[gi], sp = c.measureText(' ').width, widths = words.map(w => c.measureText(w).width), tw = widths.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
    const since = (el - gStart) / rate, pop = cl(since / .12), y = F.H * Lc.capY;
    withA(.35 + .65 * pop, () => shadowText(() => { let x = F.W / 2 - tw / 2; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = fnt;
      words.forEach((w, i) => { c.fillStyle = hl.has(norm(w)) ? C.hl : '#ffffff'; c.fillText(w, x, y + (1 - pop) * 6); x += widths[i] + sp; }); }));
  }
  function bigLines(str, maxW, size, weight, font) { c.font = `${weight} ${size}px ${font}`; return String(str).split('\n').flatMap(l => wrap(l.trim(), maxW)); }
  function cineText(sc, u, Lc, bundle) {
    const U = Math.min(F.W, F.H), T = sc.capT, at = i => (i == null ? null : T[Math.min(i, T.length - 1)]);
    // kanca başlığı
    if (sc.hook) { const a = fade(u, .15, .4); let size = Math.round(U * .1); let ls; while (true) { ls = bigLines(String(sc.hook).toLocaleUpperCase('tr'), F.W * .86, size, 900, FD); if (ls.length <= 3 || size < U * .05) break; size -= 4; }
      withA(a, () => shadowText(() => ls.forEach((l, i) => txt(l, F.W / 2, F.H * Lc.hookY + i * size * 1.08 + (1 - a) * 10, `900 ${size}px ${FD}`, '#ffffff', 'center')))); }
    const ansT = sc.answer ? at(sc.answer.at) + .15 : null;
    // soru kartı (cevap gelince yerini cevaba bırakır)
    if (sc.card && u >= at(sc.card.at)) { const a = fade(u, at(sc.card.at), .35) * (ansT != null ? 1 - fade(u, ansT - .25, .25) : 1);
      if (a > 0) { const size = Math.round(U * .04); const ls = bigLines(sc.card.text, F.W * .8, size, 800, FS);
        withA(a, () => shadowText(() => ls.forEach((l, i) => txt(l, F.W / 2, F.H * Lc.cardY + i * size * 1.3, `800 ${size}px ${FS}`, '#ffffff', 'center')))); } }
    // geri sayım
    if (sc.count != null && T[sc.count] != null) { const t0 = T[sc.count], t1 = T[sc.count + 1] != null ? T[sc.count + 1] : sc.dur - .2, seg = (t1 - t0) / 3;
      if (u >= t0 && u < t1) { const n = Math.min(2, Math.floor((u - t0) / seg)), p = ((u - t0) - n * seg) / seg, size = Math.round(U * .17);
        withA(Math.min(1, p * 6, (1 - p) * 4 + .2), () => shadowText(() => { c.save(); c.translate(F.W / 2, F.H * Lc.cnt); const k = .85 + .15 * outB(cl(p * 4)); c.scale(k, k); txt(String(3 - n), 0, size * .35, `900 ${size}px ${FD}`, C.hl, 'center'); c.restore(); })); } }
    // cevap
    if (sc.answer && u >= ansT) { const a = fade(u, ansT, .3), size = Math.round(U * .056), pop = .9 + .1 * outB(cl((u - ansT) / .35));
      withA(a, () => shadowText(() => { c.save(); c.translate(F.W / 2, F.H * Lc.cardY + size * .4); c.scale(pop, pop); const ls = bigLines(sc.answer.text, F.W * .8, size, 900, FS);
        ls.forEach((l, i) => txt(l, 0, i * size * 1.15, `900 ${size}px ${FS}`, C.hl, 'center'));
        if (sc.answer.not) txt(`(${sc.answer.not})`, 0, ls.length * size * 1.15, `800 ${Math.round(size * .78)}px ${FS}`, C.hl, 'center'); c.restore(); })); }
    // yoruma çağrı
    if (sc.cta && u >= at(sc.cta.at)) { const a = fade(u, at(sc.cta.at), .4), size = Math.round(U * .044); const ls = bigLines(sc.cta.text, F.W * .78, size, 800, FS);
      withA(a, () => shadowText(() => ls.forEach((l, i) => txt(l, F.W / 2, F.H * Lc.ctaY + i * size * 1.3, `800 ${size}px ${FS}`, '#ffffff', 'center')))); }
    if (bundle.hud) withA(.75, () => shadowText(() => txt(bundle.hud, F.W - U * .05, U * .075, `700 ${Math.round(U * .026)}px ${FM}`, '#ffffff', 'right')));
  }
  function cineBg(sc, u, bare) {
    const img = getImg(sc.img), cm = camOf(sc, u);
    if (img) { coverImg(img, cm.z, cm.x, cm.y);
      const img2 = sc.img2 && sc.img2_at != null ? getImg(sc.img2) : null;
      if (img2) { const t0 = (sc.capT[sc.img2_at] != null ? sc.capT[sc.img2_at] : sc.dur / 2) + .3; withA(fade(u, t0, 1.2), () => coverImg(img2, cm.z, cm.x, cm.y)); }
    } else { c.fillStyle = lg(0, 0, 0, F.H, [[0, '#1a1712'], [1, '#050505']]); c.fillRect(0, 0, F.W, F.H);
      if (root.__EV_PREVIEW || bare) { txt(sc.img ? 'Görsel yükleniyor…' : 'Görsel henüz üretilmedi', F.W / 2, F.H * .45, `700 ${Math.round(Math.min(F.W, F.H) * .03)}px ${FS}`, 'rgba(255,255,255,.55)', 'center'); } }
    if (bare) return;
    fxLayer(sc.fx, u);
    // okunurluk: üstte ve altta hafif karartma + kenar karartma
    c.fillStyle = lg(0, 0, 0, F.H * .42, [[0, 'rgba(0,0,0,.5)'], [1, 'rgba(0,0,0,0)']]); c.fillRect(0, 0, F.W, F.H * .42);
    c.fillStyle = lg(0, F.H * .55, 0, F.H, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.45)']]); c.fillRect(0, F.H * .55, F.W, F.H * .45);
    c.fillStyle = rg(F.W / 2, F.H / 2, Math.min(F.W, F.H) * .35, Math.hypot(F.W, F.H) * .6, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.5)']]); c.fillRect(0, 0, F.W, F.H);
    const g = grain(); if (g) { const o = Math.floor(u * 24) % 7; withA(.055, () => { c.save(); c.globalCompositeOperation = 'overlay'; c.fillStyle = c.createPattern(g, 'repeat'); c.translate(o * 27, o * 13); c.fillRect(-o * 27, -o * 13, F.W, F.H); c.restore(); }); }
  }
  function drawCine(P, L, i, u, t, bare) {
    const sc = L.scenes[i], Lc = CINE[P.format] || CINE.dikey;
    c.fillStyle = '#000'; c.fillRect(0, 0, F.W, F.H);
    cineBg(sc, u, bare); if (bare) return;
    cineText(sc, u, Lc, P); cineCaption(sc, u, Lc);
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(0, F.H - 4, F.W, 4); c.fillStyle = 'rgba(143,211,255,.9)'; c.fillRect(0, F.H - 4, F.W * (t / L.total), 4);
  }
  function drawScene(P, L, i, u, t) { const sc = L.scenes[i]; if (sade()) return drawSade(P, L, i, u, t); if (P.__bare) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height); c.restore(); } else background(); try { sc.fn(u, sc.capT, { dur: sc.dur, k: sc.k }); } catch (e) { const E = root.EVEngine && root.EVEngine.errors; if (E && !E[sc.k]) { E[sc.k] = String(e.message).slice(0, 160); console.warn('Sahne ' + sc.k + ' çizim hatası:', e.message); } c.setTransform(F.S, 0, 0, F.S, 0, 0); if (root.__EV_PREVIEW) txt('Çizim hatası: ' + String(e.message).slice(0, 40), F.hx, F.hy, `700 24px ${FM}`, C.red, 'center'); } c.setTransform(F.S, 0, 0, F.S, 0, 0); c.globalAlpha = 1; c.shadowBlur = 0; c.setLineDash([]); if (P.__bare) return; header(P, sc, i, u, t); bigNum(sc, u); caption(P, sc, u, t, L.total); }

  function createPlayer(canvas, bundle) {
    const ST = setStyle(bundle.style); setFormat(bundle.format); const FF = F;
    canvas.width = Math.round(FF.W * FF.S); canvas.height = Math.round(FF.H * FF.S); c = canvas.getContext('2d'); c.setTransform(FF.S, 0, 0, FF.S, 0, 0);
    const L = layout(bundle);
    function render(t) {
      setStyle(ST); F = FF; c = canvas.getContext('2d'); c.setTransform(F.S, 0, 0, F.S, 0, 0); t = cl(t, 0, L.total - .001);
      let si = L.scenes.findIndex(s => t >= s.s && t < s.e); if (si < 0) si = L.scenes.length - 1; const u = t - L.scenes[si].s, TR = .6;
      const ox = F.W / 2, oy = F.H / 2, RM = Math.hypot(F.W, F.H) * .62;
      if (cine()) { drawCine(bundle, L, si, u, t); if (u < .5 && si > 0) withA(1 - e3(u / .5), () => drawCine(bundle, L, si - 1, L.scenes[si - 1].dur - .5 + u, t)); return si; }
      if (sade()) { if (u < .55 && si > 0) drawSade(bundle, L, si, u, t, { sc: L.scenes[si - 1], u: L.scenes[si - 1].dur - .001, k: e3(u / .55) }); else drawSade(bundle, L, si, u, t); return si; }
      if (u < TR && si > 0) { drawScene(bundle, L, si - 1, L.scenes[si - 1].dur - .001, t); const r = e3(u / TR) * RM; c.save(); c.beginPath(); c.arc(ox, oy, r, 0, Math.PI * 2); c.clip(); drawScene(bundle, L, si, u, t); c.restore();
        glow(C.hv, 40, () => { c.beginPath(); c.arc(ox, oy, r, 0, Math.PI * 2); c.strokeStyle = `rgba(255,138,42,${1 - u / TR})`; c.lineWidth = 18; c.stroke(); }); }
      else drawScene(bundle, L, si, u, t);
      return si;
    }
    // Yalnızca illüstrasyon (başlık/altyazı yok): soru seçenekleri için sahne karesi
    function still(k, frac) {
      setStyle(ST); F = FF; c = canvas.getContext('2d'); c.setTransform(F.S, 0, 0, F.S, 0, 0);
      const i = L.scenes.findIndex(s => s.k === String(k)); if (i < 0) return null;
      const sc = L.scenes[i]; if (cine()) { drawCine(bundle, L, i, sc.dur * (frac == null ? .5 : frac), sc.s, true); return { x: 0, y: 0, w: F.W * F.S, h: F.H * F.S }; }
      bundle.__bare = true; try { drawScene(bundle, L, i, sc.dur * (frac == null ? .9 : frac), sc.s); } finally { bundle.__bare = false; }
      return { x: (F.hx - 410 * F.hs) * F.S, y: (F.hy - 340 * F.hs) * F.S, w: 820 * F.hs * F.S, h: 690 * F.hs * F.S };
    }
    return { render, still, total: L.total, scenes: L.scenes, format: FF, style: ST, width: canvas.width, height: canvas.height };
  }

  root.EVEngine = { createPlayer, preload, layout, LIB_NAMES, W, H, FORMATS, STYLES: Object.keys(PALETTES), errors: {} };
})(typeof window !== 'undefined' ? window : globalThis);
