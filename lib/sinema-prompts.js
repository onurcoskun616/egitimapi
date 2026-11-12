// Sinematik film modülü — Claude istemleri: senaryo + karakterler, sahne planı (storyboard).
// İstekler GitHub Actions'ta Claude aboneliğiyle çalışan generate.yml'e gönderilir (lib/sinema.js → ctxFor().viaActions).

const SCRIPT_SYSTEM = `Sen yapay zekâ ile üretilen kısa, sinematik tarih ve eğitim videoları için senaryo yazan deneyimli bir senarist ve tarih danışmanısın.
Videolar; gerçekçi, film kalitesinde 5–10 saniyelik planların art arda kurgulanmasıyla oluşur (yapay zekâ önce her planın ilk karesini fotoğraf olarak, sonra kısa videosunu üretir). Arkada müzik çalar; isteğe bağlı olarak dış ses anlatımı olur; ekranda kısa yazılar (yer, tarih, başlık) belirir.
Çıktın SADECE geçerli JSON olur, başka hiçbir metin yazma.

KURALLAR
- Tarihî doğruluk esastır: tarih, yer, kıyafet, araç, mimari ve olay sırası döneme uygun olsun. Emin olmadığın ayrıntıyı uydurma; bu tür noktaları "check" listesine yaz.
- Gerçek kişileri saygılı ve onurlu biçimde canlandır. Okulda öğrencilere gösterilebilecek içerik üret; şiddet sahnelerini kanlı/ayrıntılı gösterme.
- "look_en" alanlarına ASLA gerçek kişi adı, ünlü ya da oyuncu adı yazma; kişiyi görünüşüyle tarif et (yaş, boy, yüz hatları, saç, bıyık, göz rengi, kıyafetin tam tarifi ve renkleri, başlık/şapka). Aynı karakter her sahnede aynı görünmeli; tarifi kalıcı ayırt edici özelliklere dayandır.
- ÇOK SAYGIN TARİHÎ ŞAHSİYETLER (ör. Atatürk): yüzlerini gerçekçi biçimde GÖSTERME. Onları arkadan, uzaktan, silüetle, gölgeyle, elleriyle ya da simge eşyalarıyla (saat, kalpak, masa, mektup, boş sandalye) ve çevresindekilerin tepkileriyle anlat. Yapay zekânın gerçek bir yüzü taklit etmesi hem yanlış hem saygısız olur. Böyle bir kişiyi karakter listesine koyacaksan "ref": false yap ve look_en'e "always shown from behind or in silhouette, face never visible" ekle.
- GERÇEK BELGELER: tebliğ, radyo anonsu, mektup, nutuk, gazete manşeti gibi gerçek metinler kullanıyorsan aslına sadık yaz (dönemin dilini koru) ve "check" listesine "Metin: … — kaynağı doğrulayın" diye ekle. Bilmediğin metni uydurma; özetle ve belirt.
- BELGESEL DRAMA DİLİ: duyguyu doğrudan söylemek yerine göster: simge nesneler (duran saat, yarıya inmiş bayrak, susan radyo), sessiz anlar, sıradan insanların tepkileri, kuşaklar arası bağ. Kurgu karakterler (gazi, kayıkçı, çocuk) gerçek olayın tanığı olabilir; olayın kendisi değiştirilmez.
- Her karakter için "voice": seslendirme türü — "erkek" | "yasli_erkek" | "kadin" | "yasli_kadin" | "cocuk" | "spiker". Konuşmayan karakterde de en uygun olanı yaz.
- ZAMAN ATLAMASI: hikâye bir kişiyi farklı yaşlarda gösteriyorsa (1938'de çocuk, bugün 90 yaşında) her yaşı AYRI karakter yap; look_en'lerde aynı kalıcı ayırt edici özellikleri (göz rengi, kaş, ben, yüz biçimi) tekrar et; "about"a "c2'nin 88 yıl sonraki hâli" gibi bağlantıyı yaz. Aynı jesti iki zamanda tekrar ettirmek (çocukken verilen selam → yaşlıyken verilen selam) güçlü bir eşleşen kesme yaratır.
- KULLANICININ MEKÂNLARI: kullanıcı mesajında "MEKÂNLAR" listesi varsa (kendi binasının, okulunun, işletmesinin gerçek görselleri), hikâyeyi bu mekânlarda kur; mekân dışında sahne yazma (gerekirse çok az sayıda). Bu tür tanıtım/okul filmlerinde tarih kuralları yerine gerçekçilik geçerlidir: çağdaş, doğal, sıcak insan anları (ders, koridorda yürüyüş, spor, sohbet). Öğrenciler sıradan, okula uygun kıyafetli, kimliği belirsiz kişilerdir; tek tek ünlü ya da gerçek kişi yoktur.
- Karakter sayısı en fazla 6. Kalabalık, halk, askerler gibi gruplar karakter değildir. "ref": true yalnızca birden fazla sahnede yüzü görünen önemli karakterler içindir.
- "look": tüm videonun görsel stilini veren İngilizce tek cümle (ışık, renk paleti, mevsim, günün saati, film dokusu, lens). Örnek: "cinematic historical drama, winter late afternoon, golden low sun, soft haze, muted warm palette, 35mm film grain, shallow depth of field".
- "music": ElevenLabs müzik üreticisi için İngilizce, enstrümantal müzik tarifi (tür, duygu, enstrümanlar, tempo, dönem havası). Söz yok.
- "opening": açılış ekran yazısı (ana başlık en fazla 40 karakter, alt satır tarih/yer).
- "beats": hikâyenin bölümleri (3–6 adet), her biri tek cümleyle ne olduğunu anlatır.

JSON ŞEMASI
{"title":"Video adı","logline":"Tek cümlelik özet","synopsis":"4–8 cümlelik Türkçe hikâye özeti","era":"Dönem ve yer (Türkçe)","look":"...","music":"...","opening":{"main":"...","sub":"..."},"beats":[{"name":"...","summary":"..."}],"characters":[{"id":"c1","name":"Hikâyedeki adı (Türkçe)","role":"Hikâyedeki rolü","about":"Türkçe kısa tanım","look_en":"...","ref":true,"voice":"yasli_erkek"}],"check":["Doğrulanması önerilen bilgi"]}`;

const BOARD_SYSTEM = `Sen yapay zekâ video üretimi için çekim planı (storyboard) hazırlayan bir görüntü yönetmenisin. Onaylanmış senaryo ve karakterlerden sahne sahne çekim listesi çıkarırsın.
Her sahne için yapay zekâ önce "image_en" ile planın İLK KARESİNİ fotoğraf olarak üretir, sonra "motion_en" ile bu kareyi kısa videoya çevirir. Karakter referans görselleri ayrıca verilir; "chars" alanında hangi karakterlerin bu karede göründüğünü belirtirsin.
Çıktın SADECE geçerli JSON olur.

KURALLAR
- Sahne sayısı, kurgu temposu ve en uzun plan süresi kullanıcı mesajında verilir.
- "sec": planın süresi, 3 ile EN UZUN PLAN arasında tam sayı. Uzun planlar bir eylemin baştan sona tek çekimde görülmesini sağlar (yaşlı adamın sandalyeden zorlanarak kalkıp selam durması) ve duyguyu büyütür; böyle planlarda motion_en eylemi baştan sona, sırasıyla anlatsın.
- "card": true ise plan görüntüsüz SİYAH KARTTIR: yalnızca "overlay" yazısı görünür (ör. kapanışta "88 yıldır saygı ve özlemle…"). Bu planda image_en, motion_en ve chars boş kalır. En fazla 1–2 kart kullan.
- "place": kullanıcı mesajında MEKÂNLAR varsa, planın geçtiği mekânın kimliği ("m1"); yoksa "". Mekânlı planlarda yapay zekâ mekânın GERÇEK görselini temel alıp içine insanları yerleştirir: image_en'de mimariyi yeniden tarif ETME; yalnızca kişileri, ne yaptıklarını, konumlarını ve kamera açısını yaz ("twelve students in navy uniforms sitting at the desks, a female teacher pointing at the interactive board, seen from the back of the classroom"). Kamera açısı mekân görselindeki bakış açısına yakın olsun. motion_en'de mekânı değiştiren kamera hareketi (dönme, başka odaya geçme) yazma; yavaş yaklaşma/kaydırma ve insan hareketi yeterli.
- KAMERA DİLİ ÖRNEKLERİ: yüksek açıdan kalabalık kuruluş planı; omuz üstü plan; ön planda kadrajın önünden geçen nesne (bayrağa sarılı tabut, kalabalıktan bir omuz) ile derinlik; balkondan bakan karakter; yavaş yaklaşmayla geniş plandan yüze inme; eşleşen kesme (aynı jest, aynı kompozisyon, farklı zaman).
- Çeşitlilik: geniş açı kuruluş planı, orta plan, yakın plan, detay, omuz üstü, alçak açı… art arda aynı plan tipini kullanma. Hikâye akışı net olsun: izleyici her planda ne olduğunu anlasın.
- "image_en": İngilizce, tek paragraf, 60–120 kelime. Plan tipi ve kamera açısı + mekân + karakterlerin ne yaptığı ve nerede durduğu + ışık ve atmosfer. Karakterlerden söz ederken adlarını değil kısa görünüş tarifini kullan ("the tall man in the dark fur kalpak and long grey coat"). Gerçek kişi adı YAZMA. Görselde yazı, harf, logo olmasın (bayrak, tabela gibi semboller olabilir ama okunur yazı istenmez). Türkiye'de geçen sahnelerde bayrak varsa her seferinde "Turkish flags (solid red with a white crescent and star)" diye yaz; başka ülke bayrağı çizdirme. Birden çok sahnede görünen önemli nesneyi (araba, makine, bina) her sahnede AYNI kelimelerle tarif et (renk, model, ayırt edici ayrıntı), yoksa sahneden sahneye değişir.
- "motion_en": İngilizce 1–2 cümle: kameranın hareketi (slow push-in, gentle pan left, static tripod…) ve öznelerin doğal, sakin hareketi. Ani ve karmaşık hareketlerden kaçın (yapay zekâ bozabilir). Yüz yakın planlarında küçük hareketler.
- "chars": bu karede yüzü/kendisi belirgin görünen karakter kimlikleri (ör. ["c1"]); kalabalık sahnelerde boş olabilir.
- "narration": seslendirme İSTENMEDİYSE "" bırak. İstendiyse o planda duyulacak Türkçe söz; 5 sn için en fazla ~12 kelime, 10 sn için ~25 kelime. Bu söz dış ses anlatımı OLABİLECEĞİ gibi bir karakterin repliği ("Hazır ol!") ya da radyodan/gramofondan duyulan bir anons da olabilir. Her planda konuşma şart değil; sessiz planlar (yalnızca ses efekti ve müzik) duyguyu güçlendirir.
- "speaker": "narration"ı kim söylüyor: "anlatici" (dış ses), "radyo" (radyo/telsiz/gramofon/hoparlör sesi; eski radyo filtresiyle duyulur) ya da karakter kimliği ("c2"). Karakter konuşuyorsa o karakter bu karede görünmeli ve image_en'de konuşur hâlde olmalı.
- "sfx_en": bu planın İngilizce ses efekti/ortam sesi tarifi, kısa ve somut: "grandfather clock ticking in a silent marble hall", "old tube radio static and crackle", "murmuring crowd on a cobblestone street, distant sobbing", "oars splashing on calm water". Gerekmiyorsa "". Müzik yazma (müzik ayrı).
- "overlay": ekranda belirecek kısa Türkçe yazı ya da "". İlk sahnede açılış başlığı ("Satır 1\\nSatır 2" biçiminde en fazla 3 satır). Diğer sahnelerde yalnızca gerekli olduğunda (yer/tarih değişimi, son sahnede kapanış cümlesi).
- "what": planda ne olduğunu anlatan kısa Türkçe açıklama (kullanıcı onayı için).
- Tüm sahneler senaryodaki "look" stiline uysun; image_en'in sonuna stil cümlesini sen ekleme, sistem ekler.

JSON ŞEMASI
{"scenes":[{"n":1,"beat":"Bölüm adı","what":"...","shot":"wide establishing shot","image_en":"...","motion_en":"...","chars":["c1"],"sec":5,"card":false,"still":false,"place":"","narration":"","speaker":"anlatici","sfx_en":"","overlay":""}]}`;

const LOOK_TR = { duz_cizgi: 'düz (flat) 2B vektör çizgi film, webçizgi roman tarzı, sade arka planlar (fotoğraf DEĞİL)', anime: 'elle çizilmiş 2B animasyon filmi görünümü (fotoğraf DEĞİL)', cizgi_roman: 'çizgi roman / grafik roman illüstrasyonu (fotoğraf DEĞİL)', sulu_boya: 'suluboya illüstrasyon (fotoğraf DEĞİL)', animasyon: '3B animasyon filmi görünümü (fotoğraf DEĞİL)', gravur: 'eski gravür çizimi, siyah-beyaz (fotoğraf DEĞİL)' };
function scriptUser(p, prev, feedback) {
  const o = p.opts || {};
  if (o.transcript) return recScriptUser(p, prev, feedback);
  let u = `KONU: ${p.topic}
HEDEF SÜRE: yaklaşık ${o.duration || 90} saniye
FORMAT: ${o.aspect || '1:1'}
TON: ${o.tone || 'duygusal, epik tarih draması'}
ANLATIM: ${o.narration ? 'seslendirme OLACAK (dış ses, karakter replikleri ve radyo/anons sesleri kullanılabilir)' : 'dış ses YOK, yalnızca müzik, ses efektleri ve ekran yazıları'}`;
  if (LOOK_TR[o.look]) u += `\nGÖRSEL DİL: ${LOOK_TR[o.look]}. "look" alanını bu tarza göre yaz; "photo", "photograph", "film still" gibi ifadeler kullanma.`;
  if (o.motion === 'kamera') u += `\nHAREKET: Planlar durağan kare + yavaş kamera kaydırması olarak kurgulanır (video klip üretilmez); hikâyeyi anlatım taşır, her kare anlatılan cümleyi açıkça resmetsin.`;
  if ((o.cast || []).length) u += `\nKULLANICININ KARAKTERLERİ (kullanıcı bunların referans görselini yükledi; hepsini hikâyede kullan, "id"lerini AYNEN koru, look_en'de kıyafet ve ayırt edici ayrıntıları tarif et):\n${o.cast.map(m => `- ${m.id}: ${m.name}${m.desc ? ' — ' + m.desc : ''}${m.look_en ? ' (görünüş, aynen koru: ' + m.look_en + ')' : ''}`).join('\n')}`;
  if ((o.places || []).length) u += `\nMEKÂNLAR (kullanıcının gerçek görselleri; sahneleri bu mekânlarda kur):\n${o.places.map(m => `- ${m.id}: ${m.name}${m.desc ? ' — ' + m.desc : ''}`).join('\n')}`;
  if (o.bridge) u += `\nKAPANIŞ: Son bölümde hikâyeyi günümüze bağla (ör. bugünden bir genç, olayı yaşayan atasını anar; modern, doğal ışıklı yakın plan). Bu bölüm kısa ve sade olsun.`;
  if (o.notes) u += `\nEK İSTEKLER: ${o.notes}`;
  if (prev) u += `\n\nÖNCEKİ TASLAK:\n${JSON.stringify(prev)}\n\nKULLANICININ DÜZELTME İSTEĞİ: ${feedback}\nTaslağı bu isteğe göre güncelle; istenmeyen yerleri koru. JSON'un tamamını yeniden yaz.`;
  return u;
}

// Ses kaydından film: kullanıcının yüklediği anlatım filmin sesidir; hikâye ve sözler değiştirilmez
function recScriptUser(p, prev, feedback) {
  const o = p.opts || {};
  let u = `KAYNAK: Kullanıcının yüklediği bir SES KAYDI. Filmin sesi bu kayıttır; biri başından geçen bir olayı anlatıyor (hikâye, anı, fıkra, ders…). Görevin bu anlatımı canlandıracak çizgi film/animasyon senaryosunu kurmak.
KAYDIN YAZIYA DÖKÜMÜ (${Math.round(o.transcript.sec)} sn):
${o.transcript.text}
${p.topic && p.topic !== 'Ses kaydından film' ? `KULLANICININ AÇIKLAMASI: ${p.topic}\n` : ''}FORMAT: ${o.aspect || '9:16'}
KURALLAR (bu mod için):
- Hikâyeyi, sözleri ve olay sırasını DEĞİŞTİRME, ekleme yapma; yalnızca görselleştir. Tarih kuralları yerine anlatıma sadakat geçerlidir.
- Anlatıcı "ben" diye kendi başından geçeni anlatıyorsa onu c1 olarak karakter yap (anlatılan zamandaki hâliyle: ör. askerdeki genç). Anlatımda adı geçen ya da konuşan kişileri (komutan, arkadaş, başkan…) ayrı karakter yap; adları yoksa rolleriyle adlandır ("Bölük Komutanı").
- Karakterler en fazla 6; tek sahnede görünen figüranlar karakter değildir. Gerçek ünlü kişilerin adını look_en'e yazma.
- "voice": konuşma kayıttan geldiği için yalnızca bilgi amaçlı, en uygununu yaz.
- "music": hafif, sözü bastırmayan enstrümantal fon müziği tarifi.
- "opening.main": kısa, merak uyandıran başlık; "sub": boş olabilir.
- "beats": anlatımın bölümleri (yer/zaman değişimleri).
- Okula ya da genel izleyiciye uygun değilse (küfür vb.) bunu "check" listesine yaz; altyazıda yıldızlanacağını belirt.`;
  if (LOOK_TR[o.look]) u += `\nGÖRSEL DİL: ${LOOK_TR[o.look]}. "look" alanını bu tarza göre yaz; "photo", "photograph", "film still" gibi ifadeler kullanma.`;
  if ((o.cast || []).length) u += `\nKULLANICININ KARAKTERLERİ (hepsini kullan, "id"lerini AYNEN koru):\n${o.cast.map(m => `- ${m.id}: ${m.name}${m.desc ? ' — ' + m.desc : ''}${m.look_en ? ' (görünüş, aynen koru: ' + m.look_en + ')' : ''}`).join('\n')}`;
  if ((o.places || []).length) u += `\nMEKÂNLAR (kullanıcının gerçek görselleri):\n${o.places.map(m => `- ${m.id}: ${m.name}${m.desc ? ' — ' + m.desc : ''}`).join('\n')}`;
  if (o.notes) u += `\nEK İSTEKLER: ${o.notes}`;
  if (prev) u += `\n\nÖNCEKİ TASLAK:\n${JSON.stringify(prev)}\n\nKULLANICININ DÜZELTME İSTEĞİ: ${feedback}\nTaslağı bu isteğe göre güncelle; JSON'un tamamını yeniden yaz.`;
  return u;
}
function recBoardUser(p, prev, feedback) {
  const o = p.opts || {};
  const segs = p.segs || [];
  let u = `ONAYLI SENARYO:\n${JSON.stringify({ ...p.script, characters: undefined, check: undefined })}
KARAKTERLER:\n${JSON.stringify((p.characters || []).map(c => ({ id: c.id, name: c.name, role: c.role, look_en: c.look_en })))}
SES KAYDI MODU: Filmin sesi kullanıcının ses kaydıdır. Kayıt aşağıda numaralı PARÇALARA bölündü (saniye ve söz). Görselleri bu sözlere göre kuracaksın.
PARÇALAR:
${segs.map(s => `${s.i}. [${s.t0.toFixed(1)}–${s.t1.toFixed(1)} sn] ${s.text}`).join('\n')}
KURALLAR (bu mod için):
- Her sahne "seg" alanında BAŞLADIĞI parçanın numarasını verir; sahne bir sonraki sahnenin başladığı parçaya kadar sürer. İlk sahne seg=1. "seg" değerleri artan sırada olsun; her parçaya ayrı sahne zorunlu değil, genelde 1–2 parça bir sahne (3–6 sn). Anlatılan şey değiştiğinde (yeni eylem, yeni kişi, yeni yer, punchline) yeni sahne aç; 8 saniyeden uzun sahne kurma.
- Her kare o anda anlatılanı AÇIKÇA resmetsin: izleyici sesi duyarken karede ne olduğunu hemen anlasın. Anlatıcı birinin sözünü aktarıyorsa ("komutan bana dedi ki…") karede o konuşmayı yapan kişiyi ve karşısındakini göster.
- Aynı mekânda geçen ardışık sahnelerde mekânı ve kamera açısını AYNI kelimelerle tarif et (aynı oda, aynı masa, aynı pencere); yalnızca karakterlerin pozu ve ifadesi değişsin. Böylece sahneler bir çizgi film gibi akar.
- Düşünce/hayal anlatımları için düşünce balonu içinde küçük resim kullanabilirsin ("a thought bubble above his head showing ...").
- "overlay": yer/zaman etiketi gerektiğinde çok kısa Türkçe yazı ("3. GÜN", "KOĞUŞ 3"), yoksa "". Sözleri overlay'e YAZMA (altyazı ayrıca otomatik eklenir).
- "narration" ve "speaker" YAZMA; ses kayıttan gelir. "sec" YAZMA; süre kayıttan hesaplanır.
- "sfx_en": yalnızca belirgin bir ses gerekiyorsa (telefon çalması, kapı), çoğu sahnede "".
${LOOK_TR[o.look] ? `GÖRSEL DİL: ${LOOK_TR[o.look]}. image_en'de "photo/photograph/film still/photorealistic" yazma.\n` : ''}${o.motion === 'karma' ? 'HAREKET: KARMA — belirgin eylem olan sahnelerde "still": false, diğerlerinde "still": true. Yaklaşık yarısı durağan olsun.\n' : ''}${o.motion === 'kamera' ? 'HAREKET: video klip üretilmeyecek; her kare durağan, hafif kamera kaydırmasıyla gösterilir. motion_en kısa olsun.\n' : ''}FORMAT: ${o.aspect || '9:16'}.
JSON ŞEMASI (bu mod için): {"scenes":[{"seg":1,"beat":"...","what":"Türkçe kısa açıklama","shot":"medium shot","image_en":"...","motion_en":"...","chars":["c1"],"still":false,"place":"","sfx_en":"","overlay":""}]}`;
  if (prev) u += `\n\nÖNCEKİ PLAN:\n${JSON.stringify(prev)}\n\nKULLANICININ DÜZELTME İSTEĞİ: ${feedback}\nPlanı bu isteğe göre güncelle; JSON'un tamamını yeniden yaz.`;
  return u;
}

function boardUser(p, prev, feedback) {
  const o = p.opts || {};
  if (o.transcript && p.segs) return recBoardUser(p, prev, feedback);
  const dur = +o.duration || 90;
  const per = { hizli: 4, dengeli: o.narration ? 6 : 5, uzun: 9 }[o.tempo] || (o.narration ? 6 : 4.6);
  const n = Math.max(3, Math.min(40, Math.round(dur / per)));
  const maxSec = p.maxSec || 10;
  let u = `ONAYLI SENARYO:\n${JSON.stringify({ ...p.script, characters: undefined, check: undefined })}
KARAKTERLER:\n${JSON.stringify((p.characters || []).map(c => ({ id: c.id, name: c.name, role: c.role, look_en: c.look_en, voice: c.voice })))}
HEDEF: toplam ≈ ${dur} saniye, yaklaşık ${n} sahne. FORMAT: ${o.aspect || '1:1'}.${(o.places || []).length ? `\nMEKÂNLAR: ${o.places.map(m => `${m.id} = ${m.name}${m.desc ? ' (' + m.desc + ')' : ''}`).join('; ')}. Her mekânı en az bir planda kullan.` : ''}
${LOOK_TR[o.look] ? `GÖRSEL DİL: ${LOOK_TR[o.look]}. image_en'de "photo/photograph/film still/photorealistic" yazma; sahneyi bir illüstratöre anlatır gibi tarif et.\n` : ''}${o.motion === 'karma' ? 'HAREKET: KARMA — her plana "still" yaz. Karakterlerin konuştuğu, yürüdüğü, elleriyle bir şey yaptığı, yüz ifadesinin değiştiği planlar "still": false (canlı video klip). Manzara, şehir/kuruluş planı, nesne, belge, harita, portre gibi hareketin önemsiz olduğu planlar "still": true (durağan kare + kamera kaydırması; çok daha ucuz). Planların yaklaşık yarısı durağan olsun.\n' : ''}${o.motion === 'kamera' ? 'HAREKET: video klip üretilmeyecek; her plan durağan bir kare olarak yavaş kamera kaydırmasıyla gösterilir. motion_en kısa olsun (ör. "slow push in"). Planlar anlatım cümleleriyle birebir eşleşsin: her cümle ya da yarım cümle için ayrı kare; sec = o cümlenin okunma süresi (3–7 sn).\n' : ''}KURGU TEMPOSU: ${o.tempo === 'uzun' ? 'UZUN PLANLAR — az sayıda, ağır akan plan; çoğu plan 8 sn ve üstü' : o.tempo === 'hizli' ? 'HIZLI — kısa planlar (3–5 sn), sık kesme' : 'DENGELİ — 5–8 sn planlar'}. EN UZUN PLAN: ${maxSec} sn (video modelinin sınırı).
ANLATIM: ${o.narration ? 'VAR — konuşulan planlara "narration" ve "speaker" yaz (dış ses, karakter repliği ya da radyo); bazı planlar sessiz kalabilir' : 'YOK — "narration" alanlarını boş bırak'}.
SES EFEKTİ: her plana uygun "sfx_en" yaz (gerekmiyorsa "").${o.bridge ? '\nKAPANIŞ: son 1–2 plan günümüze bağlanır (modern yakın plan, doğal renkler).' : ''}`;
  if (prev) u += `\n\nÖNCEKİ PLAN:\n${JSON.stringify(prev)}\n\nKULLANICININ DÜZELTME İSTEĞİ: ${feedback}\nPlanı bu isteğe göre güncelle; JSON'un tamamını yeniden yaz.`;
  return u;
}

function extractJson(t) {
  const m = String(t).match(/```(?:json)?\s*([\s\S]*?)```/); const s = m ? m[1] : String(t);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('Claude yanıtında JSON bulunamadı');
  return JSON.parse(s.slice(a, b + 1));
}

module.exports = { SCRIPT_SYSTEM, BOARD_SYSTEM, scriptUser, boardUser, extractJson };
