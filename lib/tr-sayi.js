// Türkçe seslendirme için sayıları yazıya çevirir: "3.682 m" → "üç bin altı yüz seksen iki metre",
// "3,7 km" → "üç virgül yedi kilometre", "%40" → "yüzde kırk", "~25" → "yaklaşık yirmi beş", "10. sırada" → "onuncu sırada".
// speakable(metin) → { text: okunacak metin, map: [{ start, len, word }] } — her özgün kelimenin okunan metindeki yeri
// (altyazıda rakamlar korunurken kelime zamanları seslendirmeden alınabilsin diye).

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const BIG = ['', 'bin', 'milyon', 'milyar', 'trilyon'];

function under1000(n) {
  const h = Math.floor(n / 100), r = n % 100, t = Math.floor(r / 10), o = r % 10;
  const out = [];
  if (h) out.push(h === 1 ? 'yüz' : ONES[h] + ' yüz');
  if (t) out.push(TENS[t]);
  if (o) out.push(ONES[o]);
  return out.join(' ');
}
function intWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'sıfır';
  const parts = []; let i = 0;
  while (n > 0 && i < BIG.length) {
    const g = n % 1000;
    if (g) parts.unshift(i === 1 && g === 1 ? 'bin' : (under1000(g) + (BIG[i] ? ' ' + BIG[i] : '')));
    n = Math.floor(n / 1000); i++;
  }
  return parts.join(' ');
}
const ORD = { bir: 'birinci', iki: 'ikinci', 'üç': 'üçüncü', 'dört': 'dördüncü', 'beş': 'beşinci', 'altı': 'altıncı', yedi: 'yedinci', sekiz: 'sekizinci', dokuz: 'dokuzuncu', on: 'onuncu', yirmi: 'yirminci', otuz: 'otuzuncu', 'kırk': 'kırkıncı', elli: 'ellinci', 'altmış': 'altmışıncı', 'yetmiş': 'yetmişinci', seksen: 'sekseninci', doksan: 'doksanıncı', 'yüz': 'yüzüncü', bin: 'bininci', milyon: 'milyonuncu', milyar: 'milyarıncı', 'sıfır': 'sıfırıncı' };
function ordWords(n) { const w = intWords(n).split(' '); w[w.length - 1] = ORD[w[w.length - 1]] || w[w.length - 1]; return w.join(' '); }

// "3.682" / "3,7" / "0,05" / "1.300,5" / "3.7" → okunuş
function numWords(s) {
  s = s.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) { const [i, d] = s.replace(/\./g, '').split(','); return intWords(+i) + (d ? ' virgül ' + decWords(d) : ''); }
  if (/^\d+,\d+$/.test(s)) { const [i, d] = s.split(','); return intWords(+i) + ' virgül ' + decWords(d); }
  if (/^\d+\.\d{1,2}$/.test(s) || /^\d+\.\d{4,}$/.test(s)) { const [i, d] = s.split('.'); return intWords(+i) + ' virgül ' + decWords(d); }
  if (/^\d+$/.test(s)) return s.length > 1 && s[0] === '0' ? s.split('').map(c => intWords(+c)).join(' ') : intWords(+s);
  return null;
}
function decWords(d) { const z = d.match(/^0+/); return (z ? z[0].split('').map(() => 'sıfır').join(' ') + ' ' : '') + (d.replace(/^0+/, '') ? intWords(+d.replace(/^0+/, '')) : '').trim(); }

const UNITS = { km: 'kilometre', m: 'metre', cm: 'santimetre', mm: 'milimetre', kg: 'kilogram', g: 'gram', t: 'ton', sn: 'saniye', dk: 'dakika', sa: 'saat', 'km²': 'kilometrekare', km2: 'kilometrekare', 'm²': 'metrekare', m2: 'metrekare', 'm³': 'metreküp', m3: 'metreküp', '°c': 'derece', '°': 'derece', kw: 'kilovat', kwh: 'kilovatsaat', w: 'vat', v: 'volt', a: 'amper', hp: 'beygir', bg: 'beygir', nm: 'newton metre', 'km/sa': 'kilometre bölü saat', 'km/s': 'kilometre bölü saniye', 'm/s': 'metre bölü saniye', 'dev/dk': 'devir bölü dakika', rpm: 'devir bölü dakika', l: 'litre', ml: 'mililitre', bar: 'bar', psi: 'psi', mb: 'megabayt', gb: 'gigabayt', tl: 'lira', '$': 'dolar', '€': 'avro' };

// Tek bir kelimeyi (noktalama dahil) okunuşa çevirir; next: sonraki kelime (sıra sayısı tahmini için)
function speakWord(w, next, prevNum) {
  let m = w.match(/^([("“'«]*)(.*?)([)"”'».,;:!?…]*)$/u); let [, pre, core, post] = m;
  if (!core) return w;
  const low = core.toLocaleLowerCase('tr');
  // önceki kelime sayıysa ve bu kelime birimse
  if (prevNum && UNITS[low] && !/\d/.test(core)) return pre + UNITS[low] + post;
  let lead = '';
  if (core[0] === '~' || core[0] === '≈') { lead = 'yaklaşık '; core = core.slice(1); }
  if (core[0] === '%') { lead += 'yüzde '; core = core.slice(1); }
  if (core[0] === '+' && /\d/.test(core[1] || '')) { lead += 'artı '; core = core.slice(1); }
  if (core[0] === '-' && /\d/.test(core[1] || '')) { lead += 'eksi '; core = core.slice(1); }
  // aralık: 640–1000, 3-5
  const rng = core.match(/^([\d.,]+)[–—-]([\d.,]+)$/);
  if (rng) { const a = numWords(rng[1]), b = numWords(rng[2]); if (a && b) return pre + lead + a + ' ile ' + b + post; }
  // sayı + ek ("1.300'den", "4'ü") ya da sayı + bitişik birim ("3,7km")
  const nm = core.match(/^([\d.,]*\d)(?:['’]([a-zçğıöşü]+))?([a-zA-Z°²³/$€]+)?$/u);
  if (nm) {
    let num = nm[1], suf = nm[2] || '', unit = nm[3] || '';
    // cümle sonu değilse "10." sıra sayısıdır ("10. sırada")
    if (/^\d+$/.test(num) && post.startsWith('.') && !post.slice(1) && next && /^[a-zçğıöşü]/u.test(next)) return pre + lead + ordWords(+num) + suf;
    const words = numWords(num);
    if (words) {
      let out = lead + words;
      if (suf) out = out + suf;   // yazarın uyumladığı ek doğrudan okunuşa eklenir: "yüz" + "den" → "yüzden"
      if (unit && UNITS[unit.toLocaleLowerCase('tr')]) out += ' ' + UNITS[unit.toLocaleLowerCase('tr')];
      return pre + out + post;
    }
  }
  return pre + lead + core + post;
}

function speakable(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let out = ''; const map = [];
  words.forEach((w, i) => {
    const prevNum = i > 0 && /\d/.test(words[i - 1]) && !/[.!?]$/.test(words[i - 1]);
    const sp = speakWord(w, words[i + 1], prevNum);
    if (out) out += ' ';
    map.push({ start: out.length, len: sp.length, word: w });
    out += sp;
  });
  return { text: out, map };
}

module.exports = { speakable, intWords, numWords, ordWords };
