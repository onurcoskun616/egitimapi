// Etkileşimli ders: kazanımlar ve bölüm sonu kontrol noktası soruları.
// Soru türleri: mcq (çoktan seçmeli), image (görsel seçme: seçenekler sahne kareleri),
// blank (boşluk doldurma, kelime bankası), tf (doğru/yanlış), order (sıralama).

const QUIZ_SYSTEM = `Sen meslek lisesi için ölçme-değerlendirme uzmanı bir öğretmensin. Bir eğitim videosunun sahne metinlerinden, video izlenirken bölüm aralarında sorulacak etkileşimli kontrol soruları hazırlarsın. Çıktın SADECE geçerli JSON olur.

İlkeler:
- Önce videonun 3–6 ölçülebilir kazanımını yaz (ör. "Yıldız-üçgen yol vermede K2 kontaktörünün görevini açıklar"). Kazanım fiilleri ölçülebilir olsun: açıklar, ayırt eder, sıralar, hesaplar, seçer, tanır.
- Kontrol noktalarını bölüm sonlarına koy ("after_k": o bölümün son sahnesinin k değeri). Kısa bölümleri birleştir: kontrol noktaları kabaca her 40–90 saniyede bir olsun, en fazla 6 kontrol noktası. Son kontrol noktası son sahneden sonra olsun.
- Her kontrol noktasında 1–3 soru. Sorular YALNIZCA o noktaya kadar videoda anlatılanları ölçsün; anlatılmayan bilgi sorma.
- Soru türlerini çeşitlendir; videonun tamamında her türden en az bir soru olsun (uygunsa):
  * "mcq": 4 seçenek, tek doğru. Çeldiriciler makul ve öğrencinin tipik yanılgılarından olsun. Doğru cevabın yerini değiştir.
  * "image": öğrenciye sahne karelerinden 3–4 görsel gösterilir, doğru olanı seçer. Seçenekler {"k":"sahne no","at":0.9} biçiminde (at: sahnenin 0–1 arası anı; 0.9 genelde her şeyin göründüğü an). Görseller birbirinden açıkça farklı olmalı ve soru yalnızca görsele bakarak cevaplanabilmeli (başlık/altyazı görünmez). Görsel tarifinde neyin çizildiğine dikkat et.
  * "blank": "text" içinde boşluklar ___ (üç alt çizgi) ile; "answer" boşluk sırasıyla doğru kelimeler; "bank" doğru kelimeler + 2–3 çeldirici kelime (karışık sırada).
  * "tf": "q" bir önerme, "answer" true/false. Yanlış önermeler tipik bir hatayı içersin.
  * "order": "items" adımlar DOĞRU sırada (3–5 madde); öğrenciye karıştırılarak gösterilir.
- Her soruda "explain": doğru cevabın neden doğru olduğunu 1–2 cümleyle, videodaki anlatıma atıf yaparak açıkla. Her soruda "kazanim": ilgili kazanım id'si.
- Dil: sade, kısa, meslek lisesi öğrencisine uygun Türkçe. Soru metni en fazla 140 karakter, seçenekler en fazla 70 karakter.
- Teknik doğruluk esastır; kaynak verildiyse kaynakla çelişme.

JSON şeması:
{"kazanimlar":[{"id":"K1","text":"..."}],
 "checkpoints":[{"after_k":"3","title":"bölüm adı","questions":[
   {"type":"mcq","q":"...","options":["...","...","...","..."],"answer":2,"explain":"...","kazanim":"K1"},
   {"type":"image","q":"...","options":[{"k":"2","at":0.9},{"k":"4","at":0.9},{"k":"6","at":0.9}],"answer":0,"explain":"...","kazanim":"K2"},
   {"type":"blank","text":"Yıldız bağlantıda her sargıya ___ gerilim düşer.","answer":["230 V"],"bank":["230 V","400 V","690 V"],"explain":"...","kazanim":"K2"},
   {"type":"tf","q":"...","answer":false,"explain":"...","kazanim":"K3"},
   {"type":"order","q":"...","items":["1. adım","2. adım","3. adım"],"explain":"...","kazanim":"K4"}]}]}`;

// Ardışık aynı "ch" sahneleri bir bölüm sayılır
function chapters(scenes) {
  const out = [];
  for (const s of scenes) {
    const sec = Math.round((s.cap || []).join(' ').length / 14.5);
    const last = out[out.length - 1];
    if (last && last.ch === s.ch) { last.ks.push(s.k); last.sec += sec; }
    else out.push({ ch: s.ch, ks: [s.k], sec });
  }
  return out;
}

function quizPrompt(p, scenes, srcBlock, previous, feedback) {
  let u = `Video: ${p.title}\nHedef kitle: ${p.audience || 'meslek lisesi öğrencileri'}\n\nBölümler (tahmini süre):\n`;
  for (const c of chapters(scenes)) u += `- ${c.ch}: sahne ${c.ks.join(', ')} (~${c.sec} sn)\n`;
  u += `\nSahneler:\n`;
  for (const s of scenes) u += `[${s.k}] ${s.ch} · ${s.title}\n  Anlatım: ${(s.cap || []).join(' ')}\n  Görsel: ${(s.visual && s.visual.subject) || '-'}\n`;
  if (srcBlock) u += `\nDers kaynağı:\n${srcBlock}\n`;
  if (previous) u += `\nÖnceki soru seti:\n${JSON.stringify(previous)}\n\nÖğretmenin düzeltme isteği: ${feedback}\nİsteği uygula, geri kalanını koru. Tam JSON'u yeniden ver.`;
  return u;
}

// Claude çıktısını doğrula, bozuk soruları ayıkla
function validate(q, scenes) {
  const ks = new Set(scenes.map(s => s.k));
  const kaz = (Array.isArray(q.kazanimlar) ? q.kazanimlar : []).filter(x => x && x.id && x.text).map(x => ({ id: String(x.id), text: String(x.text).slice(0, 200) }));
  const kids = new Set(kaz.map(x => x.id));
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const cps = [];
  for (const cp of Array.isArray(q.checkpoints) ? q.checkpoints : []) {
    if (!cp || !ks.has(String(cp.after_k))) continue;
    const qs = [];
    for (const x of Array.isArray(cp.questions) ? cp.questions : []) {
      if (!x || !x.type) continue;
      const base = { type: x.type, explain: str(x.explain, 400), kazanim: kids.has(String(x.kazanim)) ? String(x.kazanim) : (kaz[0] && kaz[0].id) || null };
      if (x.type === 'mcq' && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.options.length)
        qs.push({ ...base, q: str(x.q, 200), options: x.options.slice(0, 5).map(o => str(o, 100)), answer: x.answer });
      else if (x.type === 'image' && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(x.answer) && x.answer < x.options.length) {
        const opts = x.options.map(o => ({ k: String(o && o.k), at: Math.min(0.99, Math.max(0.05, +(o && o.at) || 0.9)) }));
        if (opts.every(o => ks.has(o.k))) qs.push({ ...base, q: str(x.q, 200), options: opts.slice(0, 4), answer: x.answer });
      } else if (x.type === 'blank' && typeof x.text === 'string' && Array.isArray(x.answer)) {
        const n = (x.text.match(/___/g) || []).length;
        if (n && n === x.answer.length) { const ans = x.answer.map(a => str(a, 60)); const bank = [...new Set([...(Array.isArray(x.bank) ? x.bank : []).map(b => str(b, 60)), ...ans])].slice(0, 8); qs.push({ ...base, text: str(x.text, 300), answer: ans, bank }); }
      } else if (x.type === 'tf' && typeof x.answer === 'boolean') qs.push({ ...base, q: str(x.q, 200), answer: x.answer });
      else if (x.type === 'order' && Array.isArray(x.items) && x.items.length >= 3) qs.push({ ...base, q: str(x.q, 200), items: x.items.slice(0, 6).map(i => str(i, 100)) });
    }
    if (qs.length) cps.push({ after_k: String(cp.after_k), title: str(cp.title, 60), questions: qs.slice(0, 4) });
  }
  // sahne sırasına göre diz, aynı noktadakileri birleştir
  const order = scenes.map(s => s.k);
  cps.sort((a, b) => order.indexOf(a.after_k) - order.indexOf(b.after_k));
  const merged = [];
  for (const c of cps) { const l = merged[merged.length - 1]; if (l && l.after_k === c.after_k) l.questions.push(...c.questions); else merged.push(c); }
  if (!merged.length) throw new Error('Geçerli soru üretilemedi');
  return { kazanimlar: kaz, checkpoints: merged };
}

// Öğrenciye giden sürüm: cevaplar ve açıklamalar yok; sıralama maddeleri karışık
function publicQuiz(quiz, seed) {
  let s = seed || 1; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return {
    kazanimlar: quiz.kazanimlar,
    checkpoints: quiz.checkpoints.map(c => ({ after_k: c.after_k, title: c.title, questions: c.questions.map(x => {
      const o = { type: x.type, kazanim: x.kazanim };
      if (x.type === 'mcq') Object.assign(o, { q: x.q, options: x.options });
      if (x.type === 'image') Object.assign(o, { q: x.q, options: x.options });
      if (x.type === 'tf') Object.assign(o, { q: x.q });
      if (x.type === 'blank') Object.assign(o, { text: x.text, bank: shuffle(x.bank), slots: x.answer.length });
      if (x.type === 'order') { const items = x.items.map((t, i) => ({ id: i, t })); let sh = shuffle(items); if (sh.every((it, i) => it.id === i)) sh = sh.reverse(); Object.assign(o, { q: x.q, items: sh }); }
      return o;
    }) })),
  };
}

const norm = v => String(v || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
function check(x, r) {
  if (x.type === 'mcq' || x.type === 'image') return +r === x.answer;
  if (x.type === 'tf') return r === x.answer || r === String(x.answer);
  if (x.type === 'blank') return Array.isArray(r) && r.length === x.answer.length && r.every((v, i) => norm(v) === norm(x.answer[i]));
  if (x.type === 'order') return Array.isArray(r) && r.length === x.items.length && r.every((v, i) => +v === i);
  return false;
}
function correctText(x) {
  if (x.type === 'mcq') return x.options[x.answer];
  if (x.type === 'image') return `${x.answer + 1}. görsel`;
  if (x.type === 'tf') return x.answer ? 'Doğru' : 'Yanlış';
  if (x.type === 'blank') return x.answer.join(' · ');
  if (x.type === 'order') return x.items.map((t, i) => `${i + 1}) ${t}`).join('  ');
  return '';
}

// Her sorunun SON cevabına göre kazanım özeti
function summarize(quiz, answers) {
  const last = {};
  for (const a of answers || []) last[`${a.cp}:${a.qi}`] = a;
  const per = {};
  quiz.kazanimlar.forEach(k => { per[k.id] = { id: k.id, text: k.text, total: 0, correct: 0 }; });
  let total = 0, correct = 0;
  quiz.checkpoints.forEach((c, ci) => c.questions.forEach((x, qi) => {
    const a = last[`${ci}:${qi}`]; total++; if (a && a.correct) correct++;
    const k = per[x.kazanim]; if (k) { k.total++; if (a && a.correct) k.correct++; }
  }));
  const list = Object.values(per).filter(k => k.total).map(k => ({ ...k, learned: k.correct / k.total >= 0.66 }));
  return { total, correct, pct: total ? Math.round(correct / total * 100) : 0, kazanimlar: list };
}

module.exports = { QUIZ_SYSTEM, quizPrompt, validate, publicQuiz, check, correctText, summarize, chapters };
