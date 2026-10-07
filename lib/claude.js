// Claude: içerik taslağı ve sahne çizim kodu üretimi.
// ANTHROPIC_API_KEY varsa doğrudan API kullanılır; yoksa istekler GitHub Actions'ta
// Claude aboneliğiyle (CLAUDE_CODE_OAUTH_TOKEN) çalışan generate.yml iş akışına gönderilir.
const crypto = require('crypto');
const MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const useApi = () => !!process.env.ANTHROPIC_API_KEY;

async function callApi(system, user, maxTokens = 8000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Claude API: ' + (j.error && j.error.message || r.status));
  const text = j.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, usage: j.usage };
}

// items: [{system,user,max}] → [{text,usage}|{error}]
async function complete(items, ctx) {
  if (useApi()) {
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await callApi(items[k].system, items[k].user, items[k].max); } catch (e) { out[k] = { error: e.message }; } } }));
    return out;
  }
  return ctx.viaActions(items, MODEL());
}

function extractJson(t) {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); const s = m ? m[1] : t;
  const a = s.indexOf('{'), b = s.lastIndexOf('}'); return JSON.parse(s.slice(a, b + 1));
}
function extractCode(t) { const m = t.match(/```(?:js|javascript)?\s*([\s\S]*?)```/); return (m ? m[1] : t).trim(); }

function extractJson(t) {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); const s = m ? m[1] : t;
  const a = s.indexOf('{'), b = s.lastIndexOf('}'); return JSON.parse(s.slice(a, b + 1));
}
function extractCode(t) { const m = t.match(/```(?:js|javascript)?\s*([\s\S]*?)```/); return (m ? m[1] : t).trim(); }

const CONTENT_SYSTEM = `Sen meslek lisesi ve teknik eğitim için kısa, dikey (9:16) anlatım videoları yazan uzman bir eğitimcisin.
Görevin: verilen konuyu baştan sona, doğru ve sade Türkçeyle sahnelere bölmek. Çıktın SADECE geçerli JSON olur.

Kurallar:
- Her sahnede 2 ya da 3 altyazı cümlesi ("cap") olur. Her cap 55–100 karakter arası, seslendirmede okunacak doğal Türkçe. Cümle içinde iki nokta, kısaltma ve birim kullanılabilir ama telaffuzu kolay olsun.
- Toplam karakter sayısı ≈ hedef saniye × 14,5 olmalı (konuşma hızı saniyede ~14,5 harf).
- "title" en fazla 18 karakter, büyük harfe uygun. "ch" bölüm etiketi, 1–2 kelime (GİRİŞ, YAPI, ARIZA, GÜVENLİK gibi).
- "big": sahnenin vurgu sayısı/ifadesi (ör. "400 V → 14 V", "≈ 15.000 dev/dk") ve hangi cümlede belireceği "at" (0 tabanlı). Yoksa null.
- "visual": çizer için tarif. "subject" çizilecek nesneler (somut, teknik parça adlarıyla), "animation" ne hareket edecek ve hangi cümleyle başlayacak, "callouts" en fazla 4 kısa etiket (büyük harf).
- Arıza/teşhis sahnelerinde "tag" ile sıklık verilebilir ({"text":"ÇOK SIK","color":"red"}) ve "warn": true.
- Teknik doğruluk esastır. Emin olmadığın sayı verme. Yüksek gerilim, basınçlı sistem, kimyasal gibi tehlikeli işlerde "yalnızca yetkili ve eğitimli personel" uyarısı ekle.
- Marka logosu, gerçek kişi, telifli karakter kullanma.
Renk adları: yel, hv (turuncu), lv (mavi), green, red, cool (camgöbeği), violet.

JSON şeması:
{"topic":"kısa konu adı","scenes":[{"k":"1","ch":"GİRİŞ","title":"...","cap":["...","..."],"big":{"text":"...","at":1,"color":"yel"}|null,"tag":null,"warn":false,"visual":{"subject":"...","animation":"...","callouts":["..."]}}]}`;

const { toneText } = require('./tones');
async function generateContent(p, previous, feedback, ctx) {
  let user = `Konu: ${p.title}\nAyrıntı / istek: ${p.brief}\nHedef kitle: ${p.audience || 'meslek lisesi öğrencileri'}\nHedef süre: ${p.target_seconds} saniye\n`;
  const tt = toneText(p.tone);
  if (tt) user += `Anlatım dili (bütün altyazı cümlelerinde, başlıklarda ve vurgu ifadelerinde bu üsluba uy; seslendirmede doğal okunacak şekilde yaz): ${tt}\n`;
  if (previous) user += `\nÖnceki taslak:\n${JSON.stringify(previous)}\n\nKullanıcının düzeltme isteği: ${feedback}\nYalnızca istenen kısmı değiştir, geri kalanı aynen koru. Tam JSON'u yeniden ver.`;
  const [r] = await complete([{ system: CONTENT_SYSTEM, user, max: 16000 }], ctx);
  if (r.error) throw new Error(r.error);
  const { text, usage } = r;
  const data = extractJson(text);
  data.scenes.forEach((s, i) => { s.k = String(i + 1); });
  return { data, usage };
}

const SCENE_SYSTEM = `Sen dikey eğitim videoları için Canvas 2D sahne kodu yazan bir motion-graphics tasarımcısısın.
Çıktın SADECE bir \`\`\`js kod bloğu: function(u, T, S) fonksiyonunun GÖVDESİ. Başka açıklama yazma.

ÇERÇEVE (motor çizer, sen çizme): arka plan, üst bilgi, adım etiketi, büyük başlık (y 230–390), büyük vurgu yazısı (y≈1270), altyazı (y 1330–1450), ilerleme çubuğu.
SENİN ALANIN: illüstrasyon. Mantıksal tuval 900×1600. Çizimi hero(() => { ... }, u, ölçek, dy) içinde, merkez (0,0) olacak şekilde ve x −400…+400, y −330…+340 aralığında yap (ekranda y≈470–1140 bölgesine düşer).
Parametreler: u = sahne içi saniye; T = cümlelerin başlangıç saniyeleri (T[0]≈0.9, T[1], T[2]...); S = {dur, k}. Olayları T'ye bağla: ör. fade(u, T[1]) ikinci cümlede belirir.

KÜTÜPHANE (global fonksiyonlar):
- C renkleri: C.fg, C.muted, C.dim, C.hv (turuncu), C.lv (mavi), C.cool, C.red, C.yel, C.green, C.violet, C.copper, C.steel. FD = kalın başlık fontu, FM = mono font.
- Zaman: cl(v,a,b), ease(x), e3(x), outB(x), lerp(a,b,k), fade(u, başla, süre=.45) → 0..1.
- Ham tuval: const c = ctx(); (gerekirse c.save(), c.translate, c.rotate, c.arc vb.)
- Şekil: rr(x,y,w,h,r) yol açar (sonra c.fill()), poly(noktalar), smooth(noktalar), circle(x,y,r,fill,stroke,w), line(noktalar,renk,kalınlık), arrow(x1,y1,x2,y2,renk,kalınlık,uç), lg(x0,y0,x1,y1,[[0,renk],[1,renk]]) doğrusal degrade, rg(x,y,r0,r1,stops) dairesel degrade, glow(renk,bulanıklık,()=>{...}), withA(alfa,()=>{...}), shadeHex('#hex', -0.3 koyu | 0.3 açık).
- Metin: txt(yazı,x,y,\`800 22px \${FM}\`,renk,'left'|'center'|'right'), badgeText(yazı,x,y,renk,boyut).
- 3D: box3d(x,y,w,h,d,{top,front,side,stroke}) → üst yüzey eşleme fonksiyonu döndürür (fx,fy)=>[x,y]; cylV(cx,üstY,r,h,koyu,açık,kapakRenk) dikey silindir; cylH(x,cy,uzunluk,r,koyu,açık) yatay silindir; bolt(x,y,r); panel(x,y,w,h,çerçeveRenk) cıvatalı kutu; cable(noktalar,renk,kalınlık,aktif) kalın kablo; busbar(noktalar,aktif) bakır bara.
- Etiket: pill(yazı,x,y,renk,{fill,size,al}); callout(yazı, hedefX, hedefY, etiketDx, etiketDy, renk, alfa) — işaret noktası + çizgi + etiket; flowLine(noktalar,renk,u,yön,kalınlık,alfa) akan akım/sıvı hattı; pulse(x,y,u,renk,r0) arıza halkası.
- Hazır nesneler: car(ghost:boolean,u,boyaRengi) yan görünüş otomobil, yerel x 0..1100 y −390..0 (kullanım: c.save(); c.translate(-550*s, 200); c.scale(s,s); car(true,u); c.restore()); wheel(x,y,açı); multimeter(x,y,'12,6 V'); gauge(x,y,r,0..1,renk,etiket); screen(x,y,w,h) gösterge ekranı çerçevesi; connector(x,y,boşluk,pinRengi) YG konnektör; warnTriangle(x,y,ölçek); gear(x,y,r,açı,renk,diş); flame(x,y,ölçek,u).

STİL: koyu zemin üzerinde profesyonel, gölgeli, derinlikli çizim. Metalik parçalar degrade ile, aktif hatlar glow ile. Her sahnede en fazla 4 callout, fade(u, T[i]) ile sırayla gelsin. Animasyon sürekli canlı olsun (dönme, akış, yanıp sönme) ama sakin. Yazıların çizim alanı dışına taşmasın. Rastgele sayı (Math.random) KULLANMA; aynı u için aynı kare çizilmeli. Her şey u'ya bağlı olsun.

ÖRNEK 1 (ön şarj devresi):
\`\`\`js
hero(() => {
  const c = ctx();
  const pre = u > T[1] && u < T[2] + 1, main = u > T[2];
  const Vc = u < T[1] ? 0 : main ? 355 : 355 * (1 - Math.exp(-(u - T[1]) * 1.1));
  panel(-400, -300, 800, 560, 'rgba(255,138,42,.5)');
  txt('BATARYA BAĞLANTI KUTUSU', -370, -250, \`800 18px \${FM}\`, C.muted);
  cable([[-470, -150], [-330, -150]], C.hv, 18); cable([[-470, 150], [-330, 150]], C.hv, 18);
  busbar([[-330, -150], [-100, -150]], main); busbar([[60, -150], [230, -150], [230, -90]], main);
  busbar([[-330, 150], [230, 150], [230, 100]], u > T[1]);
  busbar([[-230, -150], [-230, -215], [0, -215], [150, -215], [150, -150]], pre);
  rr(-175, -238, 130, 46, 23); c.fillStyle = lg(0, -238, 0, -192, [[0, '#f3eee2'], [1, '#b9b2a2']]); c.fill();
  rr(-100, -190, 200, 80, 16); c.fillStyle = lg(0, -190, 0, -110, [[0, '#3a4258'], [1, '#151a28']]); c.fill();
  rr(-60, main ? -158 : -178, 120, 10, 4); c.fillStyle = main ? '#ffb066' : C.copper; c.fill();
  cylV(300, -110, 64, 230, '#1b2a4a', '#4a6ea8', '#c9d2e3');
  const lvl = Vc / 355; c.save(); c.beginPath(); c.rect(236, 120 - 220 * lvl, 128, 220 * lvl); c.clip(); c.globalAlpha = .55; cylV(300, -100, 56, 215, '#7a3a10', lvl > .95 ? C.green : C.hv); c.restore();
  txt(Math.round(Vc) + ' V', 300, 200, \`900 40px \${FD}\`, lvl > .95 ? C.green : C.yel, 'center');
  callout('ÖN ŞARJ DİRENCİ', -110, -215, -40, -120, C.hv, fade(u, T[1]));
  callout('KONDANSATÖR', 300, 0, 0, -330, C.lv, fade(u, T[1] + .5));
  if (u > T[2] + 1) glow(C.green, 30, () => pill('READY', 0, 210, C.green, { fill: true, size: 30 }));
}, u, .92);
\`\`\`

ÖRNEK 2 (araç üzerinde parça gösterme, X-ray):
\`\`\`js
const c = ctx();
const s = 0.72 * (1 + 0.25 * e3(cl((u - T[1]) / 1.4)));
c.save(); c.translate(450 - 560 * s, 1000); c.scale(s, s);
car(u >= 2.2, u);
if (u >= 2.2) {
  box3d(270, -104, 590, 46, 30, { top: '#5a3a22', front: '#3a2414', side: '#24170e', stroke: 'rgba(255,138,42,.9)' });
  flowLine([[275, -80], [262, -150], [280, -182]], C.hv, u, 1, 10);
  glow(C.hv, 30, () => box3d(255, -206, 100, 40, 22, { top: '#a9b3c7', front: '#7d889f', side: '#4e5870', stroke: C.hv }));
  callout('YG BATARYA', 565, -80, 0, 150, C.hv, fade(u, T[0] + 2.4), s);
  callout('İNVERTER', 305, -182, -40, -170, C.hv, fade(u, T[1]), s);
}
c.restore();
\`\`\``;

function scenePrompt(scene, topic, feedback, prevCode) {
  let user = `Video konusu: ${topic}\nSahne JSON:\n${JSON.stringify(scene, null, 1)}\nCümle sayısı: ${scene.cap.length} (T[0]..T[${scene.cap.length - 1}])\n`;
  if (prevCode) user += `\nÖnceki kod:\n\`\`\`js\n${prevCode}\n\`\`\`\nKullanıcının düzeltme isteği: ${feedback}\nİsteği uygula, beğenilen kısımları koru.`;
  return { system: SCENE_SYSTEM, user, max: 8000 };
}
const FAIL_CODE = msg => `hero(() => { txt('Bu sahne çizilemedi', 0, -20, \`900 44px \${FD}\`, C.red, 'center'); txt('Düzeltme notuyla yeniden çizdir', 0, 30, \`700 22px \${FM}\`, C.muted, 'center'); }, u); // ${String(msg).replace(/\n/g, ' ').slice(0, 120)}`;

// jobs: [{scene, feedback, prevCode}] → [{code, usage}]
async function generateSceneCodes(jobs, topic, ctx) {
  const res = await complete(jobs.map(j => scenePrompt(j.scene, topic, j.feedback, j.prevCode)), ctx);
  return res.map(r => {
    if (!r || r.error) return { code: FAIL_CODE(r ? r.error : 'yanıt yok'), usage: null };
    const code = extractCode(r.text);
    try { new Function('u', 'T', 'S', code); } catch (e) { return { code: FAIL_CODE('sözdizimi: ' + e.message), usage: r.usage }; }
    return { code, usage: r.usage };
  });
}

module.exports = { generateContent, generateSceneCodes, SCENE_SYSTEM, useApi };
