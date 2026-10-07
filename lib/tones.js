// Anlatım dilleri: içerik yazımında Claude'a verilen üslup talimatları
const TONES = {
  akademik: ['Akademik ve resmi', 'Nesnel ve ölçülü bir dil kullan. Terimleri ilk geçtiği yerde tanımla, kesin ifadeler seç, günlük deyim ve espri kullanma. Hitap gerekiyorsa "siz" kullan.'],
  samimi: ['Sıcak ve samimi', 'İzleyiciye "sen" diye hitap et. Cesaretlendirici, içten ve sakin bir öğretmen gibi konuş. Gündelik hayattan benzetmeler kullan, kısa cümleler kur. Teknik doğruluktan ödün verme.'],
  akran: ['Akran anlatımı', 'Aynı yaştaki bir öğrenci arkadaşına anlatıyormuş gibi konuş. "Biz", "hadi bakalım", "ben de ilk başta karıştırmıştım" gibi doğal ifadeler kullan. Argo ve kaba söz yok, teknik bilgi doğru kalsın.'],
  usta: ['Usta-çırak', 'Atölyede deneyimli bir usta çırağına gösteriyormuş gibi anlat. "Bak şimdi", "dikkat et", "sahada şöyle olur" gibi ifadeler, pratik ipuçları ve iş güvenliği vurgusu kullan.'],
  hikaye: ['Hikâye ile anlatım', 'Konuyu kısa bir hikâye üzerinden anlat: bir karakter ve bir durum kur (ör. servise gelen bir araç, atölyede bir iş). Her sahne hikâyeyi ilerletirken bir bilgi öğretsin, sonda ders net özetlensin.'],
  merak: ['Soru-cevap, merak uyandıran', 'Sahnelerin çoğu bir soruyla açılsın ("Peki bu nasıl oluyor?"), cevap adım adım verilsin. Merak uyandır, sahneleri "ama asıl önemli olan..." gibi bağlantılarla birbirine bağla.'],
  belgesel: ['Belgesel anlatıcısı', 'Ağırbaşlı, etkileyici bir belgesel anlatıcısı gibi konuş. Görsel betimleme ağırlıklı olsun ("Şimdi motorun içine giriyoruz"), cümleler akıcı ve vurgulu olsun.'],
  sinav: ['Sınav odaklı özet', 'Yoğun ve net anlat: tanım, kural, sayı ve ipucu ağırlıklı kısa cümleler. Kritik bilgileri "Unutma:" ya da "Sınavda dikkat:" ile vurgula.'],
};
function toneText(tone) {
  if (!tone) return null;
  if (tone.startsWith('ozel:')) return `Kullanıcının tarif ettiği anlatım dili: ${tone.slice(5).trim()}`;
  const t = TONES[tone]; return t ? `${t[0]}. ${t[1]}` : null;
}
module.exports = { TONES, toneText };
