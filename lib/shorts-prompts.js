// Shorts Stüdyosu: Claude'un sahne planı istemleri ve plan doğrulama.
const TEMPLATES = {
  siralama: 'SIRALAMA / GERİ SAYIM — "en yüksek / en uzun / en hızlı / en kalabalık N ..." gibi sayısal bir değere göre sıralanabilen konular.',
  mekanizma: 'MEKANİZMA / KESİT — bir makinenin içinin nasıl çalıştığı. Şu an hazır mekanizmalar: 4zamanli (4 zamanlı benzinli motor + dizel bonus).',
  karsilastirma: 'BOYUT / ÖLÇEK KARŞILAŞTIRMA — küre biçimli gök cisimlerinin (uydu, gezegen, yıldız) boyutlarının yan yana, kamera uzaklaşarak karşılaştırılması.',
};
const MECH_SECTIONS = { intro: 5, parts: 5, emme: 8, sik: 8, is: 8, egz: 8, fast: 8, dizel: 5, outro: 5 };
const KINDS = ['moon', 'mercury', 'mars', 'venus', 'earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun', 'sirius', 'arcturus', 'betel', 'rock', 'ice', 'gas', 'star_white', 'star_yellow', 'star_orange', 'star_red', 'star_blue'];
const PALETTES = ['day', 'sunset', 'dusk', 'dawn', 'golden', 'night'];

const SYSTEM = `Sen YouTube Shorts / Reels / TikTok için 60 saniyelik dikey (1080x1920) bilgi videoları planlayan bir içerik yönetmenisin. Görüntüler yapay zekâyla değil, KODLA çizilir; bu yüzden yalnızca aşağıdaki şablonların izin verdiği alanları doldurursun. Çıktın SADECE geçerli JSON olur.

ŞABLONLAR:
${Object.entries(TEMPLATES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

GENEL KURALLAR:
- Dil Türkçe; büyük harf başlıklarda Türkçe karakterleri doğru yaz (İ, Ş, Ğ, Ü, Ö, Ç).
- Toplam süre 55–62 sn. Her sahnenin "caption"ı seslendirme ve altyazı cümlesidir: 1–2 kısa, akıcı cümle, en fazla 95 karakter; saniyede ~13 harften hızlı olmasın (5 sn'lik sahnede ≤ 60–65 karakter idealdir).
- Merak uyandıran bir açılış ("Sonuncusu 5 bin metreyi aşıyor!") ve izleyiciyi yoruma çağıran bir kapanış yaz.
- Başlıklar kısa olmalı: "name" ≤ 18 karakter, "sub"/"place" ≤ 28 karakter, "compare" ≤ 24 karakter, "title_big" ≤ 10 karakter.
- DOĞRULUK: Sayı ya da olgu içeren HER bilgiyi web aramasıyla güncel ve güvenilir kaynaklardan doğrula (resmî kurumlar, ansiklopediler, NASA/ESA, Harita Genel Müdürlüğü vb.). Kaynaklar arasında farklı değerler varsa en yaygın kabul göreni kullan ve o öğeye "note" ekle (ör. "*Kaynaklara göre 640–1000 kat"). Emin olamadığın bilgiyi kullanma.
- Kullandığın kaynakları "sources" listesine yaz; kontrol edilmesini önerdiğin noktaları "check" listesine yaz.

ŞEMALAR:
1) siralama:
{"template":"siralama","title":"kısa konu","unit":"m","bg":"dag" (konu dağlarsa) | "soyut" (diğer her şey),
 "scenes":[
  {"type":"intro","dur":5,"title_top":"TÜRKİYE'NİN","title_main":"EN YÜKSEK","title_big":"10 DAĞI","caption":"..."},
  {"type":"item","dur":5,"rank":10,"name":"...","sub":"alt ad ya da null","place":"konum ya da null","value":3524,"value_text":null,"palette":"${PALETTES.join('|')}","kind":"vol|jag (yalnız bg=dag)","note":null,"caption":"..."},
  ... (rank büyükten küçüğe, 1 en sonda; 5–10 öğe; öğe sahnesi 4–6 sn),
  {"type":"outro","dur":5,"title":"SIRALAMA","caption":"... Yorumlara yaz!"}]}
 "value" sayı olmalı (sayaç 0'dan bu değere sayar). Sayı çok büyük/küçükse "value_text" ile göster ("~1,2 milyar").

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
  if (!Array.isArray(j.scenes) || j.scenes.length < 3) throw new Error('Planda en az 3 sahne olmalı');
  const out = { template: t, title: str(j.title, 80) || '' };
  const cap = s => str(s.caption, 200) || '';
  if (t === 'siralama') {
    out.unit = str(j.unit, 8) || ''; out.bg = j.bg === 'dag' ? 'dag' : 'soyut';
    const intro = j.scenes.find(s => s.type === 'intro') || {}; const outro = j.scenes.find(s => s.type === 'outro') || {};
    const items = j.scenes.filter(s => s.type === 'item');
    if (items.length < 3 || items.length > 12) throw new Error('Sıralamada 3–12 öğe olmalı');
    out.scenes = [{ type: 'intro', dur: num(intro.dur, 3, 8, 5), title_top: str(intro.title_top, 30) || '', title_main: str(intro.title_main, 24) || '', title_big: str(intro.title_big, 14) || '', caption: cap(intro) }]
      .concat(items.map((s, i) => ({ type: 'item', dur: num(s.dur, 3, 8, 5), rank: Math.round(num(s.rank, 1, 99, items.length - i)), name: str(s.name, 40) || '?', sub: str(s.sub, 40), place: str(s.place, 40), value: s.value == null || s.value === '' ? null : +s.value, value_text: str(s.value_text, 24), palette: PALETTES.includes(s.palette) ? s.palette : null, kind: s.kind === 'vol' ? 'vol' : s.kind === 'jag' ? 'jag' : null, note: str(s.note, 80), caption: cap(s) })))
      .concat([{ type: 'outro', dur: num(outro.dur, 4, 8, 5), title: str(outro.title, 24) || 'SIRALAMA', caption: cap(outro) }]);
    for (const s of out.scenes) if (s.type === 'item' && s.value != null && !Number.isFinite(s.value)) throw new Error(`“${s.name}” için değer sayı olmalı`);
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
  const total = out.scenes.reduce((a, s) => a + s.dur, 0);
  if (total < 20 || total > 120) throw new Error(`Toplam süre ${Math.round(total)} sn; 20–120 sn arasında olmalı`);
  return out;
}

module.exports = { SYSTEM, userPrompt, normalize, TEMPLATES, KINDS, PALETTES, MECH_SECTIONS };
