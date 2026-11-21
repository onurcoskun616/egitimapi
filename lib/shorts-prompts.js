// Shorts Stüdyosu: Claude'un sahne planı istemleri ve plan doğrulama.
const TEMPLATES = {
  siralama: 'SIRALAMA / GERİ SAYIM — "en yüksek / en uzun / en hızlı / en kalabalık N ..." gibi sayısal bir değere göre sıralanabilen konular.',
  mekanizma: 'MEKANİZMA / KESİT — bir makinenin içinin nasıl çalıştığı. Şu an hazır mekanizmalar: 4zamanli (4 zamanlı benzinli motor + dizel bonus).',
  tanitim: 'TANITIM — bir kurumu, kanalı, ekibi, ürünü ya da etkinliği tanıtan, terminal/"ajan" estetiğinde (yeşil-kehribar, matris yağmuru) heyecanlı duyuru videosu: zaman çizelgesi, terminal pencereleri, oyun tarzı ekip seçimi, güç çubukları, vurgulu cümle, tarih-saatli kapanış.',
  konusan: 'KONUŞAN KARAKTER — kullanıcının yüklediği fotoğraftan çizilen bir karakter kameraya bakarak konuşur (dudak senkronlu); bir öğretmenin, bir uzmanın ya da maskotun izleyiciye doğrudan anlattığı her konu, duyuru ya da mesaj.',
  karsilastirma: 'BOYUT / ÖLÇEK KARŞILAŞTIRMA — küre biçimli gök cisimlerinin (uydu, gezegen, yıldız) boyutlarının yan yana, kamera uzaklaşarak karşılaştırılması.',
};
// Konuşan karakter çizim tarzları (Sinema'daki görsel dillerle aynı)
const CHAR_STYLES = {
  animasyon: { tr: 'Animasyon filmi (3D)', en: 'Stylized 3D animated feature film character: appealing stylized proportions, soft global illumination, rich colors, clean shapes, expressive friendly face. A 3D animation frame, NOT a photograph.' },
  karikatur: { tr: 'Gerçekçi karikatür', en: 'Photorealistic portrait with gently exaggerated caricature features (slightly bigger head and expressive eyes) but realistic skin texture and real clothing, natural light. Looks like a real comedy film still.' },
  duz_cizgi: { tr: 'Düz çizgi film (2D)', en: 'Flat 2D vector cartoon: simple flat shapes, clean dark outlines, no gradients, friendly slightly caricatured face, tidy flat background. A flat cartoon illustration, NOT a photograph, NOT 3D.' },
  anime: { tr: 'Anime / el çizimi', en: 'Classic hand-drawn 2D animated feature film look: clean expressive linework, cel-shaded character, soft hand-painted background, warm light. NOT a photograph, NOT 3D.' },
  cizgi_roman: { tr: 'Çizgi roman', en: 'Modern European comic book illustration: bold clean ink outlines, cel shading with painterly texture, saturated warm colors. NOT a photograph.' },
  sulu_boya: { tr: 'Suluboya', en: 'Soft watercolor illustration with visible paper texture, loose ink linework, gentle washes of color. NOT a photograph.' },
  gercekci: { tr: 'Gerçekçi (fotoğraf gibi)', en: 'Photorealistic cinematic portrait photo, soft natural light, shallow depth of field.' },
};
const MECH_SECTIONS = { intro: 5, parts: 5, emme: 8, sik: 8, is: 8, egz: 8, fast: 8, dizel: 5, outro: 5 };
const KINDS = ['moon', 'mercury', 'mars', 'venus', 'earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun', 'sirius', 'arcturus', 'betel', 'rock', 'ice', 'gas', 'star_white', 'star_yellow', 'star_orange', 'star_red', 'star_blue'];
const PALETTES = ['day', 'sunset', 'dusk', 'dawn', 'golden', 'night'];

const SYSTEM = `Sen YouTube Shorts / Reels / TikTok için 60 saniyelik dikey (1080x1920) bilgi videoları planlayan bir içerik yönetmenisin. Görüntüler yapay zekâyla değil, KODLA çizilir; bu yüzden yalnızca aşağıdaki şablonların izin verdiği alanları doldurursun. Çıktın SADECE geçerli JSON olur.

ŞABLON SEÇİMİ: Gezegen, uydu ve yıldız BOYUTLARI konusu her zaman "karsilastirma" şablonudur (küreler yan yana çizilir). Dağlar "siralama" + bg="dag". Diğer sayısal sıralamalar "siralama" + bg="soyut" + her öğeye emoji.

ŞABLONLAR:
${Object.entries(TEMPLATES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

GENEL KURALLAR:
- Dil Türkçe; büyük harf başlıklarda Türkçe karakterleri doğru yaz (İ, Ş, Ğ, Ü, Ö, Ç).
- SESLENDİRME METNİ ("caption") bir anlatıcının doğal, akıcı konuşmasıdır; sahneler arka arkaya okununca TEK bir hikâye gibi akmalı (bağlaçlar kullan: "Ama", "Üstelik", "Peki ya…", "Sırada…"). Kurallar:
  · Kısa, tam cümleler; yarım cümle ya da "Merkür: 4.879 km." gibi liste dili YOK.
  · Sembol ve kısaltma YOK: ~ * % / ( ) : ; – yerine kelime kullan ("yaklaşık", "yüzde", "kilometre").
  · Büyük sayıları konuşma diline yuvarla ("139.820 km" değil "yaklaşık 140 bin kilometre"); kesin değer zaten ekranda yazıyor. Bir cümlede en fazla bir sayı.
  · Ekrandaki sayıyı aynen tekrar etme; ona anlam kat ("Dünya'nın 11 katı", "bir yılda bunun yarısı").
  · Her sahnenin cümlesi sahne süresine sığmalı: saniyede en fazla ~2,3 kelime.
- Toplam süre 55–62 sn. Her sahnenin "caption"ı seslendirme ve altyazı cümlesidir: 1–2 kısa, akıcı cümle, en fazla 95 karakter; saniyede ~13 harften hızlı olmasın (5 sn'lik sahnede ≤ 60–65 karakter idealdir).
- Merak uyandıran bir açılış ("Sonuncusu 5 bin metreyi aşıyor!") ve izleyiciyi yoruma çağıran bir kapanış yaz.
- Başlıklar kısa olmalı: "name" ≤ 18 karakter, "sub"/"place" ≤ 28 karakter, "compare" ≤ 24 karakter, "title_big" ≤ 10 karakter.
- DOĞRULUK: Sayı ya da olgu içeren HER bilgiyi web aramasıyla güncel ve güvenilir kaynaklardan doğrula (resmî kurumlar, ansiklopediler, NASA/ESA, Harita Genel Müdürlüğü vb.). Kaynaklar arasında farklı değerler varsa en yaygın kabul göreni kullan ve o öğeye "note" ekle (ör. "*Kaynaklara göre 640–1000 kat"). Emin olamadığın bilgiyi kullanma.
- Kullandığın kaynakları "sources" listesine yaz; kontrol edilmesini önerdiğin noktaları "check" listesine yaz.

ŞEMALAR:
1) siralama:
{"template":"siralama","title":"kısa konu","unit":"m","bg":"dag" (konu dağlarsa) | "soyut" (diğer her şey),
 "scenes":[
  {"type":"intro","dur":5,"title_top":"TÜRKİYE'NİN","title_main":"EN YÜKSEK","title_big":"10 DAĞI","icon":"🏔️","caption":"..."},
  {"type":"item","dur":5,"rank":10,"name":"...","sub":"alt ad ya da null","place":"konum ya da null","value":3524,"value_text":null,"palette":"${PALETTES.join('|')}","kind":"vol|jag (yalnız bg=dag)","icon":"tek emoji","body":null,"note":null,"caption":"..."},
  ... (rank büyükten küçüğe, 1 en sonda; 5–10 öğe; öğe sahnesi 4–6 sn),
  {"type":"outro","dur":5,"title":"SIRALAMA","caption":"... Yorumlara yaz!"}]}
 GÖRSEL BAĞ: bg="soyut" ise HER öğeye o öğeyi en iyi temsil eden TEK bir renkli emoji yaz ("icon": uyku → "😴", televizyon → "📺", köprü → "🌉", araba → "🚗"); izleyici anlatılanı ekranda görmeli. Öğe bir gezegen/uydu/yıldız ise "icon" yerine "body" alanına gök cismi türünü yaz (${KINDS.join('|')}); ekranda 3B küre çizilir. Girişe de konuyu anlatan bir "icon" koy.
 "value" sayı olmalı ve HER ZAMAN üstteki "unit" biriminde olmalı (çubuk grafik bu değerlerle karşılaştırır; ör. unit "yıl" ise 7 ay → 0.58). Gösterimi farklı istiyorsan "value_text" yaz ("~7 ay", "~1,2 milyar"); value_text başka birim içeriyorsa birim ekranda tekrar eklenmez. "note" en fazla 70 karakter.

2) mekanizma (yalnız mechanism="4zamanli"):
{"template":"mekanizma","mechanism":"4zamanli","title":"kısa konu",
 "scenes":[{"key":"intro","dur":5,"title1":"MOTOR NASIL","title2":"ÇALIŞIR?","subtitle":"4 zamanlı benzinli motor","caption":"..."},
  {"key":"parts","dur":5,"caption":"..."},{"key":"emme","dur":8,"caption":"..."},{"key":"sik","dur":8,"caption":"..."},
  {"key":"is","dur":8,"caption":"..."},{"key":"egz","dur":8,"caption":"..."},{"key":"fast","dur":8,"caption":"..."},
  {"key":"dizel","dur":5,"caption":"..."} (isteğe bağlı),{"key":"outro","dur":5,"caption":"..."}]}
 Sahne anahtarları ve sırası sabittir; yalnızca metinleri ve süreleri (±2 sn) değiştirebilirsin. Konu bu mekanizmayla anlatılamıyorsa bu şablonu SEÇME.

3) karsilastirma:
{"template":"karsilastirma","title":"kısa konu","unit":"km","size_label":"Çap","group":5,
 "objects":[{"name":"Ay","kind":"${KINDS.join('|')}","size":3474,"size_text":null,"compare":null,"note":null}, ... küçükten büyüğe ...],
 "scenes":[{"type":"group","dur":6,"title1":"DÜNYA ÇOK MU","title2":"BÜYÜK?","caption":"..."},
  {"type":"focus","obj":5,"dur":5,"caption":"..."}, ... (her biri objects içindeki bir indise odaklanır, artan sırada),
  {"type":"outro","obj":<son nesne indisi>,"dur":7,"title1":"DÜNYA","title2":"TOZ ZERRESİ BİLE DEĞİL","caption":"... Yorumlara yaz!"}]}
 İlk "group" sahnesi objects[0..group-1]'i yan yana gösterir. "size" aynı birimde sayı. Gerçek adı olan gezegen/yıldız için kendi "kind"ını, diğerleri için rock/ice/gas/star_* kullan.

YAPAY ZEKÂ SES EFEKTİ: Her sahneye isteğe bağlı "sfx_en" alanı ekle: o sahnenin ORTAM sesini anlatan kısa İngilizce tarif (ör. "cold mountain wind howling, distant eagle cry", "busy workshop ambience, metal tools clinking", "deep space hum with soft shimmering tones"). Konuşma, müzik ya da şarkı isteme; sahnede belirgin bir ortam yoksa "" bırak. Ateşleme, sayaç, geçiş gibi zamanlamalı sesler zaten kodla üretiliyor, onları tekrar yazma.

4) tanitim:
{"template":"tanitim","title":"kısa ad","channel":"",
 "scenes":[
  {"type":"years","dur":6,"items":[{"year":"1963","label":"Karatahta ve tebeşir"},{"year":"2025","label":"Uzaktan eğitim"},{"year":"2026–2027","label":""}],"tag":"Eğitim ajanları çağı","statement":"Ajanlar devrede","caption":"..."},
  {"type":"terminal","dur":8,"channel":"Ses kanalı: Ajan 3.14","windows":[
     {"title":"site.adresi","lines":["> GET ...","200 OK","...yükleniyor"]},
     {"title":"tarama.exe","lines":["... taranıyor","... taranıyor"],"progress":true},
     {"title":"ses_analiz.exe","kind":"wave","label":"ÖĞRETMEN SES ANALİZİ"},
     {"title":"kontrol.log","kind":"approve","label":"ÖĞRETMEN KONTROLÜ","status":"ONAYLANDI"}],"caption":"..."},
  {"type":"roster","dur":10,"title":"PLAYER SELECT","grid_title":"Göreve hazırız!","cards":[{"name":"Ajan 9.8","role":"Fen · Fizik","stats":{"Bilgi":95,"Hız":90,"Enerji":100},"photo":null}],"caption":"..."},
  {"type":"powerup","dur":5,"title":"POWER-UP!","bars":[{"label":"Yorulmaz","value":"∞"}],"caption":"..."},
  {"type":"statement","dur":7,"caption":"Büyük yazılacak duygusal cümle; vurgulanacak kelimeleri *yıldız* içine al."},
  {"type":"finale","dur":6,"title":"...","date":"Pazartesi","time":"16:30","button":"Start","footer":["...","..."],"caption":"..."}]}
 Sahne türleri istenen sırada ve tekrar ederek kullanılabilir (ör. 2–3 terminal sahnesi). Terminal pencere satırları kısa (≤ 42 karakter), bir pencerede ≤ 7 satır, bir sahnede ≤ 3 pencere. Kart adları ≤ 14, rolleri ≤ 22 karakter; en fazla 8 kart. Gerçek kişi adı ya da fotoğraf UYDURMA; fotoğrafları kullanıcı yükler ("photo": null bırak). Tarih/saat/yer gibi duyuru bilgilerini kullanıcının yazdığından al; yazmadıysa "check" listesine "tarih ve saati girin" ekle.

5) konusan:
{"template":"konusan","title":"kısa ad","scenes":[{"type":"talk","dur":8,"title":"ekranın üstünde kısa başlık (≤ 28 karakter, boş olabilir)","caption":"karakterin bu sahnede söylediği 1–3 cümle"}]}
 Karakter izleyiciye BİRİNCİ ŞAHISLA, samimi ve doğal konuşur ("Merhaba, ben…", "Bugün size…"). 3–8 sahne; her sahnede en fazla 35 kelime (≈ 15 sn). Seslendirme kuralları (sembol yok, sayılar konuşma dilinde) aynen geçerlidir. Kullanıcı konuşma metnini kendisi verdiyse (tırnak içinde ya da "metin:" diye) kelimesi kelimesine aynen kullan, yalnızca cümle sınırlarından sahnelere böl; düzeltme yapma. Görsel/karakter alanı YAZMA ("character" alanını sistem doldurur).

Ek alanlar (her şablonda en üst düzeyde): "sources":[{"title":"...","url":"https://..."}], "check":["..."].`;

function userPrompt(p, prev, feedback) {
  const o = p.opts || {};
  let u = `KONU: ${p.topic}\nŞABLON: ${o.template && o.template !== 'otomatik' ? o.template + ' (bu şablonu kullan)' : 'otomatik — konuya en uygun şablonu sen seç'}`;
  if (o.notes) u += `\nEK İSTEKLER: ${o.notes}`;
  if (prev) u += `\n\nÖNCEKİ PLAN:\n${JSON.stringify(prev)}\n\nKULLANICININ DÜZELTME İSTEĞİ: ${feedback}\nPlanı bu isteğe göre güncelle; JSON'un tamamını yeniden yaz.`;
  return u;
}

const num = (v, a, b, d) => { const n = +v; return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
const str = (v, n) => v == null ? null : String(v).slice(0, n);

// Claude'un (ya da kullanıcının) planını şablon kurallarına göre denetler; düzeltilebilecekleri düzeltir, olmayanlar için hata atar.
function normalize(j) {
  if (!j || typeof j !== 'object') throw new Error('Plan boş');
  const t = j.template; if (!TEMPLATES[t]) throw new Error('Geçersiz şablon: ' + t);
  if (!Array.isArray(j.scenes) || j.scenes.length < (t === 'konusan' ? 1 : 3)) throw new Error('Planda en az 3 sahne olmalı');
  const out = { template: t, title: str(j.title, 80) || '' };
  const cap = s => str(s.caption, 200) || '';
  if (t === 'siralama') {
    out.unit = str(j.unit, 8) || ''; out.bg = j.bg === 'dag' ? 'dag' : 'soyut';
    const intro = j.scenes.find(s => s.type === 'intro') || {}; const outro = j.scenes.find(s => s.type === 'outro') || {};
    const items = j.scenes.filter(s => s.type === 'item');
    if (items.length < 3 || items.length > 12) throw new Error('Sıralamada 3–12 öğe olmalı');
    const icon = v => (v && /\p{Extended_Pictographic}/u.test(v)) ? String(v).trim().slice(0, 8) : null;
    out.scenes = [{ type: 'intro', dur: num(intro.dur, 3, 8, 5), title_top: str(intro.title_top, 30) || '', title_main: str(intro.title_main, 24) || '', title_big: str(intro.title_big, 14) || '', icon: icon(intro.icon), caption: cap(intro) }]
      .concat(items.map((s, i) => ({ type: 'item', dur: num(s.dur, 3, 8, 5), rank: Math.round(num(s.rank, 1, 99, items.length - i)), name: str(s.name, 40) || '?', sub: str(s.sub, 40), place: str(s.place, 40), value: s.value == null || s.value === '' ? null : +s.value, value_text: str(s.value_text, 24), palette: PALETTES.includes(s.palette) ? s.palette : null, kind: s.kind === 'vol' ? 'vol' : s.kind === 'jag' ? 'jag' : null, icon: icon(s.icon), body: KINDS.includes(s.body) ? s.body : null, note: str(s.note, 80), caption: cap(s) })))
      .concat([{ type: 'outro', dur: num(outro.dur, 4, 8, 5), title: str(outro.title, 24) || 'SIRALAMA', caption: cap(outro) }]);
    for (const s of out.scenes) if (s.type === 'item' && s.value != null && !Number.isFinite(s.value)) throw new Error(`“${s.name}” için değer sayı olmalı`);
  } else if (t === 'konusan') {
    out.scenes = j.scenes.slice(0, 12).map(s => ({ type: 'talk', dur: num(s.dur, 2, 30, 8), title: str(s.title, 40) || '', caption: str(s.caption, 420) || '' })).filter(s => s.caption.trim());
    if (!out.scenes.length) throw new Error('Konuşma metni boş');
    const c = j.character || {};
    out.character = { name: str(c.name, 30) || '', ready: !!c.ready && c.ready !== 'false', style: CHAR_STYLES[c.style] ? c.style : 'animasyon', setting: str(c.setting, 160) || '',
      photo: typeof c.photo === 'string' && /^sinema\/yuklenen\/[0-9a-f-]+\.(jpg|png|webp)$/.test(c.photo) ? c.photo : null,
      portrait: typeof c.portrait === 'string' && (/^shorts\/[0-9a-z-]+\/karakter\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(c.portrait) || c.portrait === c.photo) ? c.portrait : null,
      portrait_of: str(c.portrait_of, 200) || null };
  } else if (t === 'tanitim') {
    out.channel = str(j.channel, 30) || '';
    const TYPES = ['years', 'terminal', 'roster', 'powerup', 'statement', 'finale'];
    out.scenes = j.scenes.filter(s => TYPES.includes(s.type)).slice(0, 14).map(s => {
      const o = { type: s.type, dur: num(s.dur, 3, 14, 6), caption: cap(s) };
      if (s.type === 'years') { o.items = (s.items || []).slice(0, 5).map(x => ({ year: str(x.year, 12) || '', label: str(x.label, 30) || '' })); o.tag = str(s.tag, 30) || ''; o.statement = str(s.statement, 24) || ''; }
      if (s.type === 'terminal') { o.channel = str(s.channel, 26) || ''; o.windows = (s.windows || []).slice(0, 3).map(w => ({ title: str(w.title, 30) || 'terminal', kind: ['lines', 'wave', 'approve'].includes(w.kind) ? w.kind : 'lines', lines: (w.lines || []).slice(0, 8).map(l => str(l, 46)), progress: !!w.progress, check: w.check !== false, label: str(w.label, 30) || '', status: str(w.status, 16) || '' })); }
      if (s.type === 'roster') { o.title = str(s.title, 20) || 'PLAYER SELECT'; o.grid_title = str(s.grid_title, 22) || ''; o.cards = (s.cards || []).slice(0, 8).map(c => ({ name: str(c.name, 16) || '?', role: str(c.role, 24) || '', stats: Object.fromEntries(Object.entries(c.stats || {}).slice(0, 4).map(([k, v]) => [str(k, 10), num(v, 0, 100, 80)])), photo: typeof c.photo === 'string' && /^sinema\/yuklenen\//.test(c.photo) ? c.photo : null })); }
      if (s.type === 'powerup') { o.title = str(s.title, 18) || 'POWER-UP!'; o.bars = (s.bars || []).slice(0, 5).map(b => ({ label: str(b.label, 16) || '', value: str(b.value, 6) || '∞' })); }
      if (s.type === 'finale') { for (const f of ['title', 'date', 'time', 'button']) o[f] = str(s[f], 24) || ''; o.footer = (s.footer || []).slice(0, 3).map(x => str(x, 34)); }
      return o;
    });
    if (out.scenes.length < 2) throw new Error('Tanıtımda en az 2 sahne olmalı');
  } else if (t === 'mekanizma') {
    if ((j.mechanism || '4zamanli') !== '4zamanli') throw new Error('Şu an yalnızca 4 zamanlı motor mekanizması hazır');
    out.mechanism = '4zamanli';
    const byKey = Object.fromEntries(j.scenes.map(s => [s.key, s]));
    out.scenes = Object.keys(MECH_SECTIONS).filter(k => byKey[k] || k !== 'dizel').map(k => {
      const s = byKey[k] || {}; const d = MECH_SECTIONS[k];
      const o = { key: k, dur: num(s.dur, d - 2, d + 3, d), caption: cap(s) };
      for (const f of ['title1', 'title2', 'subtitle', 'title', 'chip']) if (s[f]) o[f] = str(s[f], 30);
      if (s.labels && typeof s.labels === 'object') o.labels = Object.fromEntries(Object.entries(s.labels).map(([a, b]) => [a, str(b, 20)]));
      return o;
    });
  } else {
    out.unit = str(j.unit, 8) || 'km'; out.size_label = str(j.size_label, 16) || 'Çap';
    const objs = (j.objects || []).map(o => ({ name: str(o.name, 24) || '?', kind: KINDS.includes(o.kind) ? o.kind : 'rock', size: +o.size, size_text: str(o.size_text, 24), compare: str(o.compare, 30), note: str(o.note, 80) }));
    if (objs.length < 3) throw new Error('Karşılaştırmada en az 3 nesne olmalı');
    for (const o of objs) if (!(o.size > 0)) throw new Error(`“${o.name}” için boyut pozitif sayı olmalı`);
    out.objects = objs; out.group = Math.round(num(j.group, 1, Math.min(8, objs.length), Math.min(5, objs.length)));
    const sc = j.scenes.map(s => ({ type: ['group', 'focus', 'outro'].includes(s.type) ? s.type : 'focus', obj: Math.round(num(s.obj, 0, objs.length - 1, objs.length - 1)), dur: num(s.dur, 3, 10, 5), title1: str(s.title1, 24), title2: str(s.title2, 30), size_label: str(s.size_label, 16), caption: cap(s) }));
    if (sc[0].type !== 'group') sc.unshift({ type: 'group', obj: out.group - 1, dur: 6, title1: '', title2: '', caption: '' });
    if (sc[sc.length - 1].type !== 'outro') sc.push({ type: 'outro', obj: objs.length - 1, dur: 7, title1: '', title2: '', caption: '' });
    out.scenes = sc;
  }
  out.scenes.forEach((s, i) => { const src = (t === 'mekanizma' ? j.scenes.find(x => x.key === s.key) : j.scenes[i]) || {}; s.sfx_en = str(src.sfx_en != null ? src.sfx_en : s.sfx_en, 200) || ''; });
  const total = out.scenes.reduce((a, s) => a + s.dur, 0);
  if ((t === "konusan" ? total < 2 : total < 20) || total > 180) throw new Error(`Toplam süre ${Math.round(total)} sn; uygun aralık 20–180 sn`);
  return out;
}

module.exports = { SYSTEM, userPrompt, normalize, CHAR_STYLES, TEMPLATES, KINDS, PALETTES, MECH_SECTIONS };
