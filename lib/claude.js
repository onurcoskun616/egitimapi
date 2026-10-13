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

const CONTENT_SYSTEM = `Sen meslek lisesi ve teknik eğitim için kısa, dikey (9:16) anlatım videoları yazan uzman bir eğitimcisin.
Görevin: verilen konuyu baştan sona, doğru ve sade Türkçeyle sahnelere bölmek. Çıktın SADECE geçerli JSON olur.

Kurallar:
- Her sahnede 2 ya da 3 altyazı cümlesi ("cap") olur. Her cap 55–100 karakter arası, seslendirmede okunacak doğal Türkçe. Cümle içinde iki nokta, kısaltma ve birim kullanılabilir ama telaffuzu kolay olsun.
- Toplam karakter sayısı ≈ hedef saniye × 12 olmalı (öğrencinin rahat dinleyeceği konuşma hızı saniyede ~12 harf). Cümleleri kısa ve net tut, bir cümlede tek fikir olsun.
- "title" en fazla 18 karakter, büyük harfe uygun. "ch" bölüm etiketi, 1–2 kelime (GİRİŞ, YAPI, ARIZA, GÜVENLİK gibi).
- "big": sahnenin vurgu sayısı/ifadesi (ör. "400 V → 14 V", "≈ 15.000 dev/dk") ve hangi cümlede belireceği "at" (0 tabanlı). Yoksa null.
- "visual": çizer için tarif. "subject" çizilecek nesneler (somut, teknik parça adlarıyla), "animation" ne hareket edecek ve hangi cümleyle başlayacak, "callouts" en fazla 4 kısa etiket (büyük harf).
- Arıza/teşhis sahnelerinde "tag" ile sıklık verilebilir ({"text":"ÇOK SIK","color":"red"}) ve "warn": true.
- Teknik doğruluk esastır. Emin olmadığın sayı verme. Yüksek gerilim, basınçlı sistem, kimyasal gibi tehlikeli işlerde "yalnızca yetkili ve eğitimli personel" uyarısı ekle.
- Marka logosu, gerçek kişi, telifli karakter kullanma.
- KAYNAK verildiyse: içeriği öncelikle kaynaktan kur. Kaynaktaki terimleri, sayıları, uç adlarını ve sıralamayı aynen kullan; kaynakla çelişme, kaynakta olmayan sayı uydurma. Her sahneye "src" yaz: o sahnede dayandığın sayfalar [{"doc":"kaynak adı","p":sayfa}]. Kaynakta karşılığı olmayan genel bilgi kullandıysan "src": [] bırak. Kaynak verilmediyse "src": [].
Renk adları: yel, hv (turuncu), lv (mavi), green, red, cool (camgöbeği), violet.

JSON şeması:
{"topic":"kısa konu adı","scenes":[{"k":"1","ch":"GİRİŞ","title":"...","cap":["...","..."],"big":{"text":"...","at":1,"color":"yel"}|null,"tag":null,"warn":false,"visual":{"subject":"...","animation":"...","callouts":["..."]},"src":[{"doc":"...","p":12}]}]}`;


const SADE_CONTENT = `
GÖRSEL STİL: SADE ANLATIM (açık krem zemin, düz renkli, kalın konturlu editoryal çizim). Bu videoda ek kurallar:
- Kök düzeyde "anchor": videonun baştan sona kullanılacak ANA GÖRSEL SAHNESİ; tek, somut ve çizilebilir bir nesne ya da düzenek (ör. "yaprak üstünde kelebek", "pil, anahtar ve lambadan oluşan basit devre", "torna aynasına bağlı iş parçası"). Sahnelerin çoğu bu ana sahneye yakınlaşarak, onu değiştirerek ya da ona parça ekleyerek ilerlesin; izleyici neye baktığını hiç kaybetmesin.
- Her sahnede "kw": "cap" ile AYNI uzunlukta dizi. Her eleman 1–3 kelimelik BÜYÜK HARF anahtar ifade ya da "" (boş). Cümlelerin yaklaşık yarısında dolu olsun. İfadedeki en önemli tek kelimeyi yıldız içine al: "AYAĞIYLA *TAT* ALIYOR", "*MALİYET*".
- "kw" içinde iki farklı kavram arasına "=" koyma; benzetme için "≈" ya da "GİBİ", neden-sonuç için "→" kullan ("GERİLİM ≈ BASINÇ", "AKIM ↑ → PARLAKLIK ↑"). "=" yalnızca gerçek eşitlik ve formül için. Bir cümlenin kw'si, o cümlenin SONUNDA söylenen sonucu önceden vermesin (sonuç bir sonraki cümlenin kw'sine ya da boş bırakılır).
- Her sahnede "label": çizimin gerçeği nasıl temsil ettiğini dürüstçe söyleyen etiket: "ŞEMATİK" (yalnızca standart sembollerle çizilmiş şema), "TEMSİLİ" (resimli çizim, benzetme), "TEMSİLİ · HIZLANDIRILMIŞ", "BÜYÜTÜLMÜŞ", "KESİT" ya da null.
- Cümleleri ilişkiyi doğru kuracak şekilde yaz: "gerilim akımı artırır" yerine "gerilim arttıkça akım artar".
- Cümleler kısa ve vurucu olsun; her cümle çizimde bir değişime (yakınlaşma, yeni parça, büyüme, karşılaştırma) karşılık gelsin. "visual.animation" bu değişimleri cümle cümle yazsın.
- "big" ve "tag" kullanma (null).
JSON şemasına ekle: {"topic":"...","anchor":"...","scenes":[{..., "kw":["...",""], "label":"ŞEMATİK"}]}`;

const { toneText } = require('./tones');
const { sourcesBlock } = require('./sources');
// Sinematik kısa video: gerçekçi yapay zekâ görselleri + kelime kelime altyazı + kanca/soru/geri sayım/cevap kurgusu
const SINEMA_CONTENT = `Sen sosyal medyada (Reels, Shorts) çok izlenen, öğretici ve merak uyandıran kısa sinematik videolar yazan bir senaristsin. Çıktın SADECE geçerli JSON olur.
Video; gerçekçi, sinematik, sakin hareketli fotoğraflar üzerine kelime kelime akan altyazı ve ekran yazılarıyla anlatılır. Her sahnenin görselini sen tarif edersin (İngilizce), yapay zekâ üretir.

KALIPLAR (kullanıcı birini seçer):
- "soru": Kanca sahnesi → 2–4 soru sahnesi → kapanış. Her soru sahnesi: soru ekranda kart olarak yazılır ve okunur ("card"), "Üç. İki. Bir." geri sayımı ("count"), cevap ve sık verilen yanlış cevap ("answer": {"text":"4 kişi","not":"5 değil"}), cevabın kısa nedeni. Sorular dikkat, mantık ya da ders konusuyla ilgili, cevabı kesin ve doğru olsun. Tuzaklı sorularda tuzağı nedenle açıkla.
- "algi": Dikkat / algı oyunu. İzleyiciye bir şey yaptırılır ya da tahmin ettirilir (ör. aklından sayı tutmak, bir şeye dikkat etmek), görsellere tekrar eden gizli bir motif saklanır ("motif", "hud"), sonunda numara AÇIKLANIR: hangi psikolojik ya da bilimsel etkiye dayandığı (hazırlama/priming, seçici dikkat, değişim körlüğü vb.) adıyla ve kısaca söylenir. İzleyiciyi kandırıp bırakma; öğret.
- "anlatim": Bir konuyu sinematik sahnelerle anlatır (tarih, bilim, meslek). Kanca → 3–5 anlatım sahnesi → kapanış (özet + soru).

KURALLAR:
- İlk sahne "role":"kanca": "hook" alanında 2–5 kelimelik büyük, merak uyandıran başlık (soru biçimi iyi çalışır). Hakaret, aşağılama, korkutma, tıklama tuzağı yok ("gerizekalı" gibi sözler YASAK); öğrenciye ve okula uygun ol. Kanca cümleleri kurgunun kuralını söyler ("Düşünme, ilk geleni söyle.").
- Son sahne "role":"kapanis": öğretici kısa sonuç + "cta": izleyiciyi yoruma çağıran kısa yazı ("Kaç tanesini bildin? Yorumlara yaz.").
- Cümleler ("cap") KISA ve vurucu: 15–70 karakter, konuşma dili. Her sahnede 2–5 cümle. Toplam karakter ≈ hedef saniye × 11.
- "hl": sahnede mavi vurgulanacak 1–4 önemli kelime (cümlede geçtiği haliyle).
- "card": ekranda kalacak yazı (soru metni, en fazla 3 kısa satır, satırları \\n ile ayır) ve hangi cümlede belireceği "at" (0 tabanlı). Yoksa null.
- "count": geri sayım cümlesinin sırası (o cümle tam olarak "Üç. İki. Bir." olsun). Yoksa null.
- "answer": {"text","not"|null,"at"} — cevabın ekranda belireceği cümle. Yoksa null.
- "img": sahnenin görsel tarifi, İNGİLİZCE, 25–60 kelime. Somut: yer, nesneler, ışık, kamera açısı. Dikey/yatay kompozisyon fark etmeksizin ana nesne ortada ya da alt yarıda olsun, üst üçte birde yazı için sade alan kalsın. Görselde YAZI, harf, logo, marka, tanınabilir gerçek kişi olmasın (yalnızca motif sayısı/işareti olabilir). İnsanlar varsa arkadan, uzaktan ya da yüzü gölgede.
- "img2": sahne içinde durum değişimi gerekiyorsa (lamba yanar, mum söner, bardak boşalır, kapı açılır) AYNI görselin değişmiş hali için İngilizce düzenleme talimatı ("Turn the lamp on, warm light fills the room"); "img2_at" değişimin olacağı cümle. Gerekmiyorsa null. Videoda en fazla 3 sahnede kullan.
- "cam": kamera hareketi: "in" (yavaş yaklaş), "out", "left", "right", "up", "down".
- "fx": atmosfer efekti: "smoke", "dust", "flicker" (mum/lamba titremesi), "rain", "embers" ya da "none".
- Kök düzeyde "look": TÜM görsellere eklenecek ortak İngilizce stil tarifi (ör. "cinematic photo, dark moody 1970s interior, warm tungsten practical lights, deep shadows, 35mm film grain, shallow depth of field"). Videonun konusuna uygun seç; bütün sahneler aynı dünyada geçsin.
- Kök düzeyde "hud": ekranın köşesinde baştan sona duracak küçük yazı (ör. "07:07") ya da null. "motif": algı oyununda saklanan motifin Türkçe açıklaması ya da null; motif görsellerde geçecekse "img" içinde açıkça yaz (ör. "a brass number 7 on the door").
- Konuya ve doğruluğa sadık kal; uydurma bilimsel iddia yok.

JSON şeması:
{"topic":"...","look":"...","hud":null,"motif":null,"scenes":[{"k":"1","ch":"KANCA","title":"kısa sahne adı","role":"kanca","hook":"...","cap":["...","..."],"hl":["..."],"card":null,"count":null,"answer":null,"cta":null,"img":"...","img2":null,"img2_at":null,"cam":"in","fx":"dust"}]}`;
// "Ya olsaydı" düşünce deneyi: canlı sayaç + kelime kelime açılan altyazı kutusu + hesapla kanıt + seri kapanışı
const DENEY_CONTENT = `Sen kısa, merak uyandıran "Ya ... olsaydı?" düşünce deneyi videoları yazan bir bilim ve matematik anlatıcısısın (Reels/Shorts tarzı, 25–90 sn). Çıktın SADECE geçerli JSON olur.

KURGU (sırayla, her madde 1 sahne; gerekirse 4. ve 5. madde birleşebilir):
1. Kanca: "Ya ... olsaydı?" sorusu, somut ve şaşırtıcı.
2. Sezgi: izleyicinin çoğunun vereceği (yanlış ya da eksik) tahmin ("Neredeyse hiçbir şey, değil mi?").
3. Sonuç: şaşırtıcı gerçek sonuç, somut bir ölçekle (top, kedi, otobüs, futbol sahası…).
4. Neden: kısa hesap ya da formülle kanıt; adım adım, sayılar doğru.
5. Genelleme / karşılaştırma: aynı sonucun farklı ölçeklerde geçerli olup olmadığı.
6. Çıkarım: tek cümlelik akılda kalan ders.
İstenirse bir sahnede "tahmin et" anı olur: o sahnede "count" cümlesi tam olarak "Üç. İki. Bir." ve ardından "answer".

KURALLAR:
- Cümleler ("cap") KISA ve vurucu: 15–80 karakter. Her sahnede 1–3 cümle. Toplam karakter ≈ hedef saniye × 12.
- "hl": sahnede SARI vurgulanacak sayı ve kilit ifadeler (cümlede geçtiği haliyle, ör. "1 metre", "16 santim", "2π").
- "meter": ekranın sol üstündeki canlı sayaç. Sayı sayarak değişsin: {"label":"EK İP","sub":"EKVATORU SARAN İP","from":0,"to":1,"dec":2,"unit":"m","prefix":"+","at":0}. Sayı değil ifade gösterilecekse: {"label":"YARIÇAP ARTIŞI","text":"1÷2π = 0,159 m","sub":"ÇEVRE = 2π × YARIÇAP","at":0}. label ve sub BÜYÜK HARF, en fazla 24 karakter. Her sahnede olsun; sahneler boyunca hikâyeyi anlatan büyüklüğü izlesin.
- Sayılar ve hesaplar KESİNLİKLE doğru olsun; yuvarlamayı tutarlı yap (15,9 cm ≈ 16 santim gibi). Ondalık ayırıcı virgül.
- "bg": sahnenin zemini: "indigo" (varsayılan, diyagram ve karşılaştırma), "night" (koyu, formül/hesap), "sky" (yer seviyesinden görünüm: üstte gökyüzü, altta kum/zemin; ufuk çizgisi var).
- "visual": çizer için tarif. "subject" çizilecek nesneler (somut), "animation" cümle cümle ne değişecek, "callouts" en fazla 3 kısa etiket. Ölçek abartılıyorsa bunu söyle.
- Kök düzeyde "note": ekranın altında duracak dürüstlük notu (ör. "Ölçekler ve ip kalınlığı gösterim amaçlıdır · ideal model"). "next": serinin bir sonraki bölümü için merak uyandıran "Ya ... olsaydı?" sorusu.
- Hakaret, korkutma, tıklama tuzağı yok; okula uygun. Kaynak verildiyse ona dayan.
- "big", "tag" null; "warn" false; "src" kaynak sayfaları ya da [].

JSON şeması:
{"topic":"...","note":"...","next":"Ya ... olsaydı?","scenes":[{"k":"1","ch":"SORU","title":"kısa sahne adı","cap":["..."],"hl":["..."],"meter":{...},"bg":"indigo","count":null,"answer":null,"big":null,"tag":null,"warn":false,"visual":{"subject":"...","animation":"...","callouts":["..."]},"src":[]}]}`;

function normDeney(d) {
  const n = (v, len) => (Number.isInteger(v) && v >= 0 && v < len ? v : null);
  d.scenes.forEach(s => {
    const L = s.cap.length;
    s.hl = Array.isArray(s.hl) ? s.hl.slice(0, 8).map(String) : [];
    s.bg = ['indigo', 'night', 'sky'].includes(s.bg) ? s.bg : 'indigo';
    const m = s.meter;
    if (m && (m.text || Number.isFinite(+m.to))) s.meter = { label: String(m.label || '').slice(0, 28), sub: m.sub ? String(m.sub).slice(0, 34) : '', text: m.text ? String(m.text).slice(0, 26) : null, from: +m.from || 0, to: +m.to || 0, dec: Math.max(0, Math.min(8, +m.dec || 0)), unit: m.unit ? String(m.unit).slice(0, 6) : '', prefix: m.prefix ? String(m.prefix).slice(0, 2) : '', at: n(m.at, L) ?? 0 };
    else s.meter = null;
    s.count = n(s.count, L);
    if (s.answer && s.answer.text) s.answer = { text: String(s.answer.text).slice(0, 40), not: s.answer.not ? String(s.answer.not).slice(0, 40) : null, at: n(s.answer.at, L) ?? L - 1 }; else s.answer = null;
    s.big = null; s.tag = null; s.warn = !!s.warn; if (!Array.isArray(s.src)) s.src = [];
  });
  d.note = d.note ? String(d.note).slice(0, 90) : null; d.next = d.next ? String(d.next).slice(0, 80) : null;
  return d;
}

const CINE_MODES = { soru: 'Kalıp: soru (soru-cevap, geri sayım ve cevap).', algi: 'Kalıp: algi (dikkat/algı oyunu, gizli motif ve sonunda bilimsel açıklama).', anlatim: 'Kalıp: anlatim (sinematik konu anlatımı).' };

async function generateContent(p, previous, feedback, ctx, sources) {
  let user = `Konu: ${p.title}\nAyrıntı / istek: ${p.brief}\nHedef kitle: ${p.audience || 'meslek lisesi öğrencileri'}\nHedef süre: ${p.target_seconds} saniye\n`;
  const tt = toneText(p.tone);
  if (tt) user += `Anlatım dili (bütün altyazı cümlelerinde, başlıklarda ve vurgu ifadelerinde bu üsluba uy; seslendirmede doğal okunacak şekilde yaz): ${tt}\n`;
  const sb = sourcesBlock(sources);
  if (sb) user += `\nKAYNAKLAR (içeriği bunlara dayandır; köşeli parantezdeki [ad | s.N] işaretleri sayfa numarasıdır):\n${sb}\n`;
  if (previous) user += `\nÖnceki taslak:\n${JSON.stringify(previous)}\n\nKullanıcının düzeltme isteği: ${feedback}\nYalnızca istenen kısmı değiştir, geri kalanı aynen koru. Tam JSON'u yeniden ver.`;
  if (p.visual_style === 'sinema') user += (CINE_MODES[p.cine_mode] || CINE_MODES.anlatim) + '\n';
  const so = p.style_opts || {};
  if (p.visual_style === 'deney') { if (so.series) user += `Seri adı: ${so.series}\n`; if (so.next) user += `Serinin sıradaki bölümü (next alanına aynen yaz): ${so.next}\n`; }
  const sys = p.visual_style === 'deney' ? DENEY_CONTENT : p.visual_style === 'sinema' ? SINEMA_CONTENT : p.visual_style === 'sade' ? CONTENT_SYSTEM + SADE_CONTENT : CONTENT_SYSTEM;
  const [r] = await complete([{ system: sys, user, max: 16000 }], ctx);
  if (r.error) throw new Error(r.error);
  const { text, usage } = r;
  const data = extractJson(text);
  data.scenes.forEach((s, i) => { s.k = String(i + 1); if (!Array.isArray(s.cap)) s.cap = [String(s.cap || '')]; });
  if (p.visual_style === 'sinema') normCine(data);
  if (p.visual_style === 'deney') { normDeney(data); if (so.next) data.next = String(so.next).slice(0, 80); }
  return { data, usage };
}


const SCENE_SYSTEM_SADE = `Sen eğitim videoları için Canvas 2D sahne kodu yazan bir illüstratör ve motion tasarımcısısın. Stil: SADE ANLATIM — krem kâğıt üzerinde düz renkli, kalın mürekkep konturlu, sakin ve anlaşılır editoryal çizim (bilim anlatımı videoları gibi).
Çıktın SADECE bir \`\`\`js kod bloğu: function(u, T, S) fonksiyonunun GÖVDESİ. Başka açıklama yazma.

ÇERÇEVE (motor çizer, sen çizme): krem arka plan, ortadaki yuvarlak köşeli KART ve çerçevesi, kartın üstündeki anahtar kelime başlığı, kartın altındaki etiket (ŞEMATİK vb.) ve altyazı.
SENİN ALANIN: kartın içi. Çizimi hero(() => { ... }, u) içinde, merkez (0,0) olacak şekilde x −400…+400, y −335…+335 aralığında yap. Kartın dışına taşan kısım kesilir.
Parametreler: u = sahne içi saniye; T = cümlelerin başlangıç saniyeleri (T[0]≈0.9, T[1], ...); S = {dur, k}. Her görsel değişimi bir cümleye bağla: fade(u, T[1]), grow(u, T[1], 1.2).

RENKLER (yalnızca bunlar): C.paper (kâğıt), C.ink (mürekkep/kontur, koyu), C.red (somon/kırmızı vurgu), C.yel (hardal), C.lv (lacivert), C.leaf (yaprak yeşili), C.cool (deniz yeşili), C.copper (bakır), C.steel (gri metal), C.muted (soluk), C.dim (çok soluk). Yazı fontları: FD (kalın başlık), FS (sade metin).

KÜTÜPHANE:
- ink(() => rr(x,y,w,h,r) | poly(noktalar) | smooth(noktalar) | (c.beginPath(), c.arc(...)), dolguRengi, konturKalınlığı=4): şekli DÜZ renkle doldurur ve mürekkep konturla çizer. Neredeyse her şekli bununla çiz.
- line(noktalar, renk, kalınlık), circle(x,y,r,dolgu,kontur,kalınlık), arrow(x1,y1,x2,y2,renk,kalınlık,uç), part(a,b,k,renk,kalınlık) çizginin k oranı (uzayan çizgi).
- Zaman: fade(u, başla, süre=.45), grow(u, başla, süre=1) 0..1 yumuşak büyüme, cl, ease, e3, outB, lerp.
- cam(x, y, zum, () => {...}): (x,y) noktasına yakınlaşır (ör. zum = 1 + 1.5*grow(u, T[1], 1.2)); ayrıntıya makro yakın çekim için.
- inset(x, y, w, h, (w,h) => {...}, {label:'YAVRU TIRTIL', col:C.red, from:[x0,y0]}): kartın içinde küçük ek panel; yakın görünüm, iç yapı ya da karşılaştırma. from verilirse işaret çizgisi çeker.
- pill(yazı, x, y, renk, {size}) küçük etiket; callout(yazı, hedefX, hedefY, dx, dy, renk, alfa) işaret noktası + eğri çizgi + etiket; leader(noktalar, renk).
- flowLine(noktalar, renk, u, yön, kalınlık): akan hat (akım, sıvı, besin akışı) — kesik çizgiler hareket eder.
- seeded(i): her karede aynı 0..1 sayı; parçacık, nokta, molekül dağılımı için. Math.random KULLANMA.
- txt(yazı,x,y,\`800 28px \${FS}\`,C.ink,'center'), withA(alfa, ()=>{}), const c = ctx() ham tuval.

STİL KURALLARI:
- Düz renk; degrade (lg, rg), parlama (glow), gölge, 3B kutu ve metalik yüzey YOK. box3d, cylV, cylH, panel, cable, busbar, car, gear gibi teknik stil nesnelerini kullanma.
- Kontur kalınlığı 4–6, uçlar yuvarlak. Nesneler basit geometrik formlarla, sevimli ama doğru oranlarla çizilsin (canlı, makine parçası, devre elemanı). Teknik doğruluk korunur: parça adları, bağlantılar ve oranlar gerçeğe uygun.
- Az ama anlamlı hareket: büyüme, yakınlaşma, akış, kalınlaşma/incelme, belirip kaybolma. Sahnede en fazla 3 etiket. Kartın içine uzun yazı yazma (başlık ve altyazı motorda).
- KADRAJ: Her şey x −390…+390, y −325…+325 içinde kalsın; ek panel (inset) ve etiketler kartın kenarına değmesin (motor taşanı içeri iter ama sen baştan içeride tasarla). Işık konisi gibi büyük şekiller de kartın içinde bitsin.
- HARFE BENZEYEN ŞEKİL YOK: akkor lamba teli zikzak ("M" ya da "W" gibi) çizilmez; teli küçük bir yay/helezon (birkaç küçük yarım daire) olarak çiz ve iki ucunu duy içindeki iki bağlantı ayağına bağla. Daire içine tek harf (M, G, A, V) yalnızca gerçekten o ölçü aleti/makine kastediliyorsa yazılır.
- BAĞLANTI: Devrede her eleman kablonun ÜSTÜNDE değil, kablo kesilip iki ucuna bağlanarak yer alır (direnç, anahtar, ampermetre). Akım varsa anahtar KAPALI çizilir (kol iki kontağa da değer). Lambanın kabloları cam balondan değil, duy/tabandan girer.
- KARŞILAŞTIRMA: "artar/azalır, parlaklaşır/sönükleşir" anlatılıyorsa önce mevcut durumu (önce) açıkça göster, sonra değişimi belirgin farkla (ışık halkası en az %50 büyüyüp/küçülsün, ok sayısı ve hızı değişsin) göster.
- DEĞER: Gösterge ve kadranlarda ölçek rakamları olsun (ör. 0-1-2-3 A); ibre söylenen değerde dursun. Formülde sayı yerine koyarken birimleri yaz: "I = 6 V / 3 Ω = 2 A". Seri pillerde toplam gerilimi yaz ("1,5 V + 1,5 V = 3 V"). Bağlantı çizgileri (part, leader) hedef nesneye kadar uzansın.
- Sonucu gösteren etiket ya da değer, anlatımda söylendiği andan önce belirmesin (cümle sonuna doğru: fade(u, T[i] + 2) ya da sonraki cümle).
- SÜREKLİLİK: Videonun ana sahnesi ("anchor") her sahnede aynı yerde ve aynı ölçekte dursun; değişiklikleri onun üzerine yap. Önceki ve sonraki sahne tarifleri sana verilir; geçişler doğal olsun.

ÖRNEK (pil-lamba devresi, ana sahne; ikinci cümlede akım akar ve lamba yanar):
\`\`\`js
hero(() => {
  const c = ctx(); const on = u > T[1];
  ink(() => rr(-300, -60, 120, 200, 18), C.yel); ink(() => rr(-275, -95, 70, 36, 8), C.steel);
  txt('+', -240, 30, \`900 56px \${FD}\`, C.ink, 'center');
  flowLine([[-240, -95], [-240, -230], [240, -230], [240, -40]], on ? C.red : C.dim, u, 1, 10);
  flowLine([[240, 120], [240, 230], [-240, 230], [-240, 140]], on ? C.lv : C.dim, u, 1, 10);
  ink(() => { c.beginPath(); c.arc(240, 40, 80, 0, Math.PI * 2); }, on ? C.yel : C.paper, 5);
  withA(fade(u, T[1] + .3), () => { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line([[240 + Math.cos(a) * 100, 40 + Math.sin(a) * 100], [240 + Math.cos(a) * 130, 40 + Math.sin(a) * 130]], C.ink, 5); } });
  callout('PİL', -240, -60, -60, -210, C.red, fade(u, T[0] + .4));
  callout('LAMBA', 240, 40, 0, 220, C.lv, fade(u, T[1] + .6));
}, u);
\`\`\`

ÖRNEK (aynı devrede dirence yakınlaşma ve ek panelde formül):
\`\`\`js
hero(() => {
  const z = 1 + 1.4 * grow(u, T[0] + .4, 1.4);
  cam(0, 0, z, () => {
    line([[-400, 0], [-120, 0]], C.ink, 14); line([[120, 0], [400, 0]], C.ink, 14);
    ink(() => rr(-120, -45, 240, 90, 20), C.copper, 5);
    [-60, -10, 40].forEach((x, i) => ink(() => rr(x, -45, 18, 90, 4), [C.red, C.yel, C.lv][i], 3));
    for (let i = 0; i < (u > T[1] ? 4 : 9); i++) { const p = (u * .5 + seeded(i)) % 1; circle(-400 + p * 800, (seeded(i + 9) - .5) * 20, 7, C.lv, C.ink, 2); }
  });
  withA(fade(u, T[1]), () => inset(120, 150, 260, 150, () => txt('I = V / R', 0, 14, \`900 40px \${FD}\`, C.ink, 'center'), { label: 'FORMÜL', col: C.red, from: [60, 40] }));
}, u);
\`\`\``;

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

TEKNİK DOĞRULUK (en önemli kural): Çizim, bir meslek öğretmeninin bakıp "evet, gerçekte böyle" diyeceği kadar doğru olmalı.
- Devre ve bağlantılarda her kablonun iki ucu da bir yere bağlı görünsün; boşta biten, "aşağı inip kaybolan" kablo çizme. Bağlantının sonucu (ör. uçların kısa devre edilip yıldız noktası oluşması, üçgende U1–W2, V1–U2, W1–V2 bağlanması) çizimde açıkça görünsün.
- Etiketlerde MEB ders kitaplarındaki standart Türkçe terimleri kullan (ör. "YILDIZ NOKTASI", "MÜHÜRLEME KONTAĞI", "TERMİK RÖLE"); uydurma ya da argo kısaltma ("Y KÖPRÜ" gibi) yazma.
- Klemens ve uç adları standart olsun (U1 V1 W1 / U2 V2 W2, L1 L2 L3, A1 A2, 13-14, 95-96). Sembolleri IEC/TS gösterimine yakın çiz.
- Gösterge ve ekranlardaki sayılar, anlatılan durumla tutarlı olsun (ör. zaman rölesi saymadan "0,0 s" yazıyorsa sönük gösterme, anlamlı bir değer göster).
- Konuyu temsil etmeyen süs nesnesi, alakasız silüet ya da sembolik metafor (terazi, ampul vb.) yerine mümkünse gerçek ekipmanı çiz; metafor kullanırsan yanında gerçek parça da görünsün.

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

const SCENE_SYSTEM_DENEY = `Sen "Ya ... olsaydı?" düşünce deneyi videoları için Canvas 2D sahne kodu yazan bir bilim illüstratörü ve motion tasarımcısısın.
Çıktın SADECE bir \`\`\`js kod bloğu: function(u, T, S) fonksiyonunun GÖVDESİ. Başka açıklama yazma.

ÇERÇEVE (motor çizer, SEN ÇİZME): zemin (S.bg: "indigo" mor-lacivert, "night" koyu, "sky" gökyüzü + kum zemin, ufuk çizgisi hero koordinatında y = −200), sol üstte canlı sayaç, üstte kelime kelime açılan altyazı kutusu, sağ üstte seri adı, altta dürüstlük notu. Yazıyı motor yazar; sen kartın içine uzun cümle yazma.
SENİN ALANIN: illüstrasyon. hero(() => { ... }, u) içinde merkez (0,0), x −400…+400, y −330…+330. Dışına taşma.
Parametreler: u = sahne içi saniye; T = cümle başlangıçları (T[0]≈0.9, T[1]…); S = {dur, k, bg}. Her değişimi bir cümleye bağla: fade(u, T[1]), grow(u, T[0] + .3, 1.2).

RENKLER: C.yel (sarı vurgu, değerler), C.cool (camgöbeği: çember, şema çizgisi), C.fg (beyaz), C.muted, C.dim, C.red, C.green, C.lv (mavi), C.violet, C.hv (turuncu), C.copper, C.steel. Fontlar: FD (kalın), FS (sade), FM (daktilo/mono: sayılar ve küçük teknik etiketler).

KÜTÜPHANE (ek):
- globe(x, y, r, u, {spin}) gerçekçi gölgeli Dünya küresi (dönen kıtalar). sun(x, y, r, u) parlayan Güneş. ball(x, y, r, 'basket'|'tennis'|'foot') top.
- ring(x, y, rx, ry, renk, kalınlık, 'back'|'front'|'full', {dash}) küre etrafında halka: önce ring(...,'back') sonra küre sonra ring(...,'front') çiz → halka kürenin arkasından dolanır. dash: [8,10] kesikli.
- Teknik kütüphanenin geri kalanı: line, circle, arrow, part(a,b,k,renk,kalınlık), rr, poly, smooth, lg, rg, glow, withA, txt, pill, callout, flowLine, cam(x,y,zum,fn) yakınlaştırma, inset(...), seeded(i), grow, fade, lerp, ctx().
- "sky" zemininde perspektif: ufuk y = −200. Yere yakın nesneler aşağıda ve büyük, uzaktakiler ufka yakın ve küçük. Gölgeleri yere koyu yarı saydam elipsle çiz. Kum zemini motor çizer.

STİL: Temiz, modern bilim anlatımı; düz renk + yumuşak gölge, ince parlama (glow) yalnızca vurguda. Şemalarda camgöbeği çizgi, sarı değer, beyaz etiket; ölçü çizgilerinde FM fontu. Sahnede en fazla 3 etiket. Rastgele sayı yok (seeded kullan). Her şey u'ya bağlı.
DOĞRULUK: Çizimdeki sayılar, oranlar ve formüller anlatımla birebir aynı olsun. Ölçek abartılıyorsa (ip kalınlığı gibi) bu bilinçli olsun; oranları ters gösterme.

ÖRNEK (halkalı Dünya, ikinci cümlede halka büyür):
\`\`\`js
hero(() => {
  const g = grow(u, T[1], 1.4), rx = 250 + 40 * g, ry = 62 + 10 * g;
  ring(0, 20, rx, ry, C.yel, 7, 'back');
  globe(0, 20, 210, u);
  ring(0, 20, rx, ry, C.yel, 7, 'front');
  withA(fade(u, T[1] + .6), () => callout('+1 METRE', rx, 20, 60, -120, C.yel));
}, u);
\`\`\`

ÖRNEK (çember şeması ve formül, night zemin):
\`\`\`js
hero(() => {
  const c = ctx(), g = grow(u, T[0] + .2, 1.2);
  c.beginPath(); c.arc(0, -40, 170 * g, 0, Math.PI * 2); c.strokeStyle = C.cool; c.lineWidth = 7; c.stroke();
  part([0, -40], [170, -40], grow(u, T[0] + 1.2, .8), C.yel, 5); circle(0, -40, 7, C.yel);
  withA(fade(u, T[0] + 1.6), () => txt('r', 85, -58, \`800 32px \${FS}\`, C.fg, 'center'));
  withA(fade(u, T[1]), () => { c.save(); c.setLineDash([6, 10]); c.beginPath(); c.arc(0, -40, 196, 0, Math.PI * 2); c.strokeStyle = C.yel; c.lineWidth = 4; c.stroke(); c.restore(); });
  withA(fade(u, T[0] + 2), () => txt('ÇEVRE = 2π × r', 0, 230, \`900 44px \${FS}\`, C.fg, 'center'));
  withA(fade(u, T[1] + .5), () => txt('+1 m → r + 1/2π = 15,9 cm', 0, 285, \`800 30px \${FS}\`, C.yel, 'center'));
}, u);
\`\`\``;

function scenePrompt(scene, topic, feedback, prevCode, srcText, opts = {}) {
  let user = `Video konusu: ${topic}\nSahne JSON:\n${JSON.stringify(scene, null, 1)}\nCümle sayısı: ${scene.cap.length} (T[0]..T[${scene.cap.length - 1}])\n`;
  if (opts.style === 'deney') { user += `Zemin (S.bg): ${scene.bg || 'indigo'}\n`; if (opts.prev) user += `Önceki sahne: ${opts.prev}\n`; if (opts.next) user += `Sonraki sahne: ${opts.next}\n`; }
  if (opts.style === 'sade') {
    if (opts.anchor) user += `\nVideonun ana sahnesi (anchor; her sahnede aynı yerde/ölçekte tut): ${opts.anchor}\n`;
    if (opts.prev) user += `Önceki sahne: ${opts.prev}\n`;
    if (opts.next) user += `Sonraki sahne: ${opts.next}\n`;
  }
  if (srcText) user += `\nKaynaktan ilgili bölüm (çizimdeki parça adları, uç adları, bağlantılar ve değerler buna uymalı):\n${srcText}\n`;
  if (prevCode) user += `\nÖnceki kod:\n\`\`\`js\n${prevCode}\n\`\`\`\nKullanıcının düzeltme isteği: ${feedback}\nİsteği uygula, beğenilen kısımları koru.`;
  return { system: opts.style === 'deney' ? SCENE_SYSTEM_DENEY : opts.style === 'sade' ? SCENE_SYSTEM_SADE : SCENE_SYSTEM, user, max: 8000 };
}
const FAIL_CODE = msg => `hero(() => { txt('Bu sahne çizilemedi', 0, -20, \`900 44px \${FD}\`, C.red, 'center'); txt('Düzeltme notuyla yeniden çizdir', 0, 30, \`700 22px \${FM}\`, C.muted, 'center'); }, u); // ${String(msg).replace(/\n/g, ' ').slice(0, 120)}`;

// jobs: [{scene, feedback, prevCode}] → [{code, usage}]
async function generateSceneCodes(jobs, topic, ctx, opts = {}) {
  const res = await complete(jobs.map(j => scenePrompt(j.scene, topic, j.feedback, j.prevCode, j.srcText, { ...opts, prev: j.prev, next: j.next })), ctx);
  return res.map(r => {
    if (!r || r.error) return { code: FAIL_CODE(r ? r.error : 'yanıt yok'), usage: null };
    const code = extractCode(r.text);
    try { new Function('u', 'T', 'S', code); } catch (e) { return { code: FAIL_CODE('sözdizimi: ' + e.message), usage: r.usage }; }
    return { code, usage: r.usage };
  });
}

// Sinematik içerik alanlarını güvenli hale getir (sayı aralıkları, eksik alanlar)
function normCine(d) {
  const n = (v, len) => (Number.isInteger(v) && v >= 0 && v < len ? v : null);
  d.scenes.forEach((s, i) => {
    const L = s.cap.length;
    s.role = ['kanca', 'soru', 'anlatim', 'kapanis'].includes(s.role) ? s.role : (i === 0 ? 'kanca' : i === d.scenes.length - 1 ? 'kapanis' : 'anlatim');
    s.hl = Array.isArray(s.hl) ? s.hl.slice(0, 6).map(String) : [];
    if (s.card && s.card.text) s.card = { text: String(s.card.text).slice(0, 160), at: n(s.card.at, L) ?? 0 }; else s.card = null;
    s.count = n(s.count, L);
    if (s.answer && s.answer.text) s.answer = { text: String(s.answer.text).slice(0, 40), not: s.answer.not ? String(s.answer.not).slice(0, 40) : null, at: n(s.answer.at, L) ?? L - 1 }; else s.answer = null;
    if (s.cta && s.cta.text) s.cta = { text: String(s.cta.text).slice(0, 90), at: n(s.cta.at, L) ?? L - 1 }; else s.cta = null;
    s.img2_at = s.img2 ? (n(s.img2_at, L) ?? Math.min(1, L - 1)) : null; if (!s.img2) s.img2 = null;
    s.cam = ['in', 'out', 'left', 'right', 'up', 'down'].includes(s.cam) ? s.cam : 'in';
    s.fx = ['smoke', 'dust', 'flicker', 'rain', 'embers', 'none'].includes(s.fx) ? s.fx : 'dust';
    s.visual = { subject: s.img || '', animation: [s.img2 ? 'Değişim: ' + s.img2 : '', 'Kamera: ' + s.cam, 'Efekt: ' + s.fx].filter(Boolean).join(' · '), callouts: [] };
    s.big = null; s.tag = null; s.warn = false; if (!Array.isArray(s.src)) s.src = [];
  });
  d.hud = d.hud ? String(d.hud).slice(0, 16) : null;
  return d;
}

// Kullanıcının Türkçe görsel düzeltme isteğini İngilizce görsel tarifine çevirir
async function reviseImagePrompt(scene, look, feedback, ctx) {
  const system = 'You rewrite image-generation prompts. Output ONLY JSON: {"img":"...","img2":"..."|null}. Keep the scene and style, apply the user\'s requested change (given in Turkish). English, 25-60 words, no text/letters/logos in the image.';
  const user = `Style: ${look || ''}\nCurrent prompt: ${scene.img}\nCurrent state-change edit: ${scene.img2 || 'none'}\nScene narration (Turkish): ${scene.cap.join(' ')}\nUser request (Turkish): ${feedback}`;
  const [r] = await complete([{ system, user, max: 1200 }], ctx);
  if (!r || r.error) throw new Error((r && r.error) || 'yanıt yok');
  const j = extractJson(r.text); return { img: String(j.img || scene.img), img2: scene.img2 ? (j.img2 ? String(j.img2) : scene.img2) : null, usage: r.usage };
}

module.exports = { normDeney, DENEY_CONTENT, SCENE_SYSTEM_DENEY, normCine, reviseImagePrompt, SINEMA_CONTENT, generateContent, generateSceneCodes, SCENE_SYSTEM, SCENE_SYSTEM_SADE, useApi, extractJson, MODEL, complete };
