// Teknik denetim: her sahnenin çizilmiş karelerini Claude'a gösterip öğretmen gözüyle hata raporu alır.
const AUDIT_SYSTEM = `Sen meslek lisesinde 20 yıllık deneyimi olan bir alan öğretmeni ve titiz bir teknik editörsün.
Sana eğitim videosunun bir sahnesinden alınmış 3 kare (soldan sağa: sahnenin başı, ortası, sonu), sahnenin seslendirme cümleleri, çizim tarifi ve varsa ders kaynağından ilgili sayfa verilecek.
Görevin: görüntüyü dikkatle incele ve bir öğretmenin ya da öğrencinin itiraz edeceği her sorunu bul.

Kontrol listesi:
1. Teknik doğruluk: parçalar, bağlantılar, semboller, uç adları (U1 V1 W1, L1 L2 L3, A1-A2 vb.), akış yönleri gerçekte olduğu gibi mi? Boşta biten kablo, yanlış bağlanmış uç, olmayan parça var mı?
2. Terim: etiketler MEB ders kitaplarındaki standart Türkçe terimlerle mi yazılmış? Uydurma ya da yanlış terim var mı?
3. Değer tutarlılığı: göstergelerdeki sayılar, birimler, yüzdeler anlatımla ve kaynakla uyumlu mu?
4. İlgi: görsel, o anda anlatılan cümleyi gerçekten gösteriyor mu, yoksa alakasız ya da süs mü?
5. Okunurluk: üst üste binen, kesilen, çok küçük ya da arka plana karışan yazı/etiket var mı?
6. Kaynak: kaynak verildiyse çizim ve metin kaynakla çelişiyor mu?
7. Metin: seslendirme cümlelerinde teknik hata varsa "metin" türünde belirt (bu, görsel düzeltmeyle çözülmez).

Kurallar: Yalnızca gerçekten gördüğün sorunları yaz, uydurma. Önemsiz estetik tercihleri yazma. Sorun yoksa severity "yok" ve issues boş olsun.
Önce Read aracıyla verilen görüntü dosyasını aç, sonra yanıtını SADECE şu JSON ile ver:
{"severity":"yok|düşük|orta|yüksek","summary":"tek cümlelik değerlendirme","issues":[{"type":"bağlantı|terim|değer|ilgi|okunurluk|kaynak|metin","detail":"ne yanlış","fix":"nasıl düzeltilmeli"}],"fix_note":"çizim sorunları için çizere verilecek tek paragraflık, uygulanabilir düzeltme talimatı; çizim sorunu yoksa boş"}`;

function auditPrompt(scene, topic, srcText) {
  const v = scene.visual || {};
  let u = `Video konusu: ${topic}\nSahne ${scene.k}: ${scene.title} (${scene.ch || ''})\n`;
  u += `Seslendirme cümleleri:\n${(scene.cap || []).map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`;
  if (scene.big && scene.big.text) u += `Ekrandaki vurgu yazısı: ${scene.big.text}\n`;
  u += `Çizim tarifi: ${v.subject || '-'}\nAnimasyon: ${v.animation || '-'}\nEtiketler: ${(v.callouts || []).join(', ') || '-'}\n`;
  if (srcText) u += `\nDers kaynağından ilgili sayfa:\n${srcText}\n`;
  u += `\nİncelenecek görüntü dosyası: {{IMAGE}}\n`;
  return u;
}

const SEV = ['yok', 'düşük', 'orta', 'yüksek'];
function normalize(r) {
  if (!r || typeof r !== 'object') return null;
  const severity = SEV.includes(r.severity) ? r.severity : (r.issues && r.issues.length ? 'orta' : 'yok');
  const issues = (Array.isArray(r.issues) ? r.issues : []).slice(0, 8).map(i => ({ type: String(i.type || 'genel').slice(0, 20), detail: String(i.detail || '').slice(0, 400), fix: String(i.fix || '').slice(0, 400) })).filter(i => i.detail);
  return { severity: issues.length ? severity : 'yok', summary: String(r.summary || '').slice(0, 300), issues, fix_note: String(r.fix_note || '').slice(0, 1200) };
}

module.exports = { AUDIT_SYSTEM, auditPrompt, normalize };
