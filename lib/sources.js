// Kullanıcının yüklediği kaynaklar (MEB modülü, ders kitabı, katalog...) için istem yardımcıları.
// Kaynak: { name, pages: [sayfa metni, ...] } — sayfa numarası 1'den başlar.
const MAX_TOTAL = 150000;   // içerik istemine girecek en fazla karakter
const MAX_SCENE = 6000;     // sahne başına ilgili sayfa metni

const clean = s => String(s || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function sourcesBlock(sources) {
  if (!sources || !sources.length) return '';
  const total = sources.reduce((n, s) => n + s.pages.reduce((m, p) => m + p.length, 0), 0) || 1;
  const cut = total > MAX_TOTAL;
  let out = '';
  for (const s of sources) {
    const size = s.pages.reduce((m, p) => m + p.length, 0);
    let budget = cut ? Math.floor(MAX_TOTAL * size / total) : Infinity;
    out += `\n### KAYNAK: ${s.name}\n`;
    for (let i = 0; i < s.pages.length && budget > 0; i++) {
      const t = clean(s.pages[i]); if (!t) continue;
      const part = t.slice(0, budget); budget -= part.length;
      out += `[${s.name} | s.${i + 1}]\n${part}\n`;
    }
    if (budget <= 0) out += `[… ${s.name} kaynağının devamı uzunluk sınırı nedeniyle kısaltıldı]\n`;
  }
  return out;
}

// Sahnenin src alanındaki sayfaların metni (yoksa boş)
function pagesFor(sources, src) {
  if (!sources || !sources.length || !Array.isArray(src) || !src.length) return '';
  let out = '';
  for (const r of src) {
    const s = sources.find(x => x.name === r.doc) || sources.find(x => x.name && r.doc && x.name.toLowerCase().includes(String(r.doc).toLowerCase()));
    const p = parseInt(r.p, 10);
    if (!s || !p || !s.pages[p - 1]) continue;
    out += `[${s.name} | s.${p}]\n${clean(s.pages[p - 1])}\n`;
    if (out.length > MAX_SCENE) break;
  }
  return out.slice(0, MAX_SCENE);
}

module.exports = { sourcesBlock, pagesFor };
