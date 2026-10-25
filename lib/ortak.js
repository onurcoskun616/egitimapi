// Ortak yazılı sınav hazırlığı: MEB "konu soru dağılım tablosu" (senaryolar) dosyasını okur; seçilen senaryolardan
// hazırlık video serisi ve senaryodaki soru dağılımına uygun kazanım testi üretir; öğrenci test sayfası ve sonuçlar.
const norm = v => (v == null ? '' : String(v)).replace(/\r/g, '').trim();
const oneLine = s => norm(s).replace(/\s+/g, ' ');
const num = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.').trim()); return Number.isFinite(n) ? n : null; };
const titleCase = s => s.toLocaleLowerCase('tr').replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('tr')).replace(/\b(Ve|İle|Veya)\b/g, w => w.toLocaleLowerCase('tr')).replace(/(^|\s)(\p{L})\.(\p{L})\./gu, (m, a, b, c) => a + b.toLocaleUpperCase('tr') + '.' + c.toLocaleUpperCase('tr') + '.');

// Kazanım kodu: "TDE2.1.", "A.2.16.", "B.1-B.12", "F.9.1.2." gibi
// Örnekler: TDE2.1 · A.2.16 · B.1-B.12 · FB.5.1.1 · M.8.1.1.1 · ENG.5.1.R2 · T.O.5.1 · İTA.8.1.1 · SB.5.2.3.Yaşadığı (boşluksuz)
const CODE_RE = /^\s*([A-ZÇĞİÖŞÜ]\.\d+(?:\.\d+)*\s*-\s*[A-ZÇĞİÖŞÜ]\.\d+(?:\.\d+)*|(?:[A-ZÇĞİÖŞÜ]{1,5}(?:\.|\s(?=\d))){1,2}[A-Z]{0,2}\d+(?:\.[A-Z]{0,2}\d+)*|(?:[A-ZÇĞİÖŞÜ]{1,5}\.?)?\d+(?:\.\d+)+)\.?(?=\s|[A-ZÇĞİÖŞÜa-zçğıöşü“"(]|$)\s*/;
const isHeadCell = v => /öğrenme\s*çıktı|kazanım/i.test(norm(v));

/* sheets: [{name, rows: [[hücre, …], …]}] (birleştirilmiş hücrelerde değer yalnız ilk hücrede) */
function parseWorkbook(sheets) {
  const grades = [], appendix = []; let subject = null, period = null;
  for (const sh of sheets || []) {
    const rows = (sh.rows || []).map(r => (Array.isArray(r) ? r : []));
    // başlık satırı: ilk 4 sütundan biri "Öğrenme Çıktıları"/"Kazanım(lar)", sağında sınav adları ya da alt satırda "Senaryo"
    const hi = rows.findIndex((r, i) => r.slice(0, 4).some(isHeadCell) && (r.slice(2).some(x => /ortak|sınav|yazılı/i.test(norm(x))) || (rows[i + 1] || []).some(x => /^senaryo/i.test(oneLine(x)))));
    if (hi < 0) { // ek sayfa (ör. EK 5): düz metin olarak sakla
      const text = rows.map(r => r.map(norm).filter(Boolean).join(' · ')).filter(Boolean).join('\n').slice(0, 20000);
      if (text) appendix.push({ name: oneLine(sh.name).slice(0, 60), text });
      continue;
    }
    const head = rows.slice(0, hi).map(r => oneLine(r.find(x => norm(x)) || '')).filter(Boolean);
    const gm = (oneLine(sh.name) + ' ' + head.join(' ')).match(/(\d{1,2})\s*\.?\s*s[ıi]n[ıi]f/i);
    const grade = gm ? +gm[1] : null;
    const tl = head.find(h => /dersi?$/i.test(h) || /s[ıi]n[ıi]f\s+.+ders/i.test(h));
    const gsub = tl ? titleCase(tl).replace(/^\d{1,2}\s*\.?\s*s[ıi]n[ıi]f[ıi]?\s*/i, '').replace(/\s*dersi?\s*$/i, '').trim() || null : null;
    if (gsub && !subject) subject = gsub;
    const pl = head.find(h => /dönem|donem/i.test(h)); if (pl && !period) period = titleCase(pl);
    const H = rows[hi], Sc = rows[hi + 1] || [];
    const KC = H.slice(0, 4).findIndex(isHeadCell), KO = KC >= 2 ? KC - 1 : -1; // kazanım sütunu, varsa konu sütunu (tema hep 0)
    const ncol = Math.max(H.length, Sc.length, ...rows.slice(hi).map(r => r.length));
    // sütun → sınav / senaryo eşlemesi
    const exams = []; let curExam = null;
    for (let c = KC + 1; c < ncol; c++) {
      const h = oneLine(H[c]), sv = oneLine(Sc[c]);
      if (h) { curExam = { name: h, note: null, scenarios: [] }; exams.push(curExam); }
      if (!curExam) continue;
      if (/^senaryo\s*\d+/i.test(sv)) curExam.scenarios.push({ label: sv.replace(/\s+/g, ' '), n: +sv.match(/\d+/)[0], col: c, items: [], total: 0 });
      else if (sv) curExam.note = (curExam.note ? curExam.note + ' ' : '') + sv;
    }
    // kazanım satırları
    let tema = '', konu = '';
    for (let r = hi + 2; r < rows.length; r++) {
      const row = rows[r]; if (!row.some(x => norm(x))) continue;
      if (norm(row[0])) { tema = oneLine(row[0]); if (KO < 0) konu = ''; } if (KO > 0 && norm(row[KO])) konu = norm(row[KO]);
      const text = oneLine(row[KC]); if (!text) continue; // toplam satırı ya da boş
      const cm = text.match(CODE_RE), code = cm ? cm[1].replace(/\s*-\s*/g, '-').replace(/\s+/g, '.') : null;
      const SK = /^\s*(OKUMA|YAZMA|DİNLEME\/İZLEME|DİNLEME|KONUŞMA)/i, skill = (konu.match(SK) || tema.match(SK) || [])[1] || null;
      const item = { tema, konu: konu.slice(0, 1500), skill: skill ? skill.toLocaleUpperCase('tr') : null, code, text: text.slice(0, 600) };
      for (const ex of exams) for (const s of ex.scenarios) { const n = num(row[s.col]); if (n && n > 0) { s.items.push({ ...item, count: n }); s.total += n; } }
      // hiçbir senaryoda yoksa da kazanım listesinde dursun (video için seçilebilir)
      (exams.all || (exams.all = [])).push(item);
    }
    const all = exams.all || []; delete exams.all;
    exams.forEach(e => e.scenarios.forEach(s => delete s.col));
    grades.push({ grade, subject: gsub, sheet: oneLine(sh.name).slice(0, 40), title: head[0] || oneLine(sh.name), exams, kazanimlar: all });
  }
  if (!grades.length) throw Object.assign(new Error('Dosyada soru dağılım tablosu bulunamadı. Beklenen: her sınıf ayrı sayfada; başlık satırında "Öğrenme Çıktıları" ya da "Kazanım" sütunu ve sağında sınav/senaryo sütunları'), { code: 400 });
  return { subject, period, grades: grades.sort((a, b) => (a.grade || 99) - (b.grade || 99)), appendix };
}

// Seçilen senaryoların birleşimi: her kazanım için en yüksek soru sayısı (ve hangi senaryolarda geçtiği)
function combine(plan, grade, examIdx, scenNs) {
  const g = plan.grades.find(x => String(x.grade) === String(grade)) || plan.grades[0]; if (!g) return null;
  const ex = g.exams[examIdx] || g.exams[0]; if (!ex) return { grade: g, exam: null, items: [] };
  const pick = ex.scenarios.filter(s => !scenNs || !scenNs.length || scenNs.includes(s.n));
  const map = new Map();
  for (const s of pick) for (const it of s.items) { const k = it.tema + '|' + (it.code || '') + '|' + it.text; const cur = map.get(k) || { ...it, count: 0, in: [] }; cur.count = Math.max(cur.count, it.count); cur.in.push(s.n); map.set(k, cur); }
  // dosyadaki sırayı koru
  const key = k => k.tema + '|' + (k.code || '') + '|' + k.text, order = g.kazanimlar.map(key);
  const items = [...map.values()].sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)));
  return { grade: g, exam: ex, scenarios: pick.map(s => s.n), items };
}

const TEST_SYSTEM = `Sen Millî Eğitim Bakanlığı ortak yazılı sınavlarına hazırlayan deneyimli bir öğretmen ve ölçme-değerlendirme uzmanısın. Görevin, verilen "konu soru dağılım tablosu" senaryosuna BİREBİR uyan bir kazanım testi hazırlamak. Çıktın SADECE geçerli JSON olur.

KURALLAR:
- Her kazanım için istenen sayıda soru yaz (sayılar listede verilir); soruların "kazanim_code" ve "kazanim" alanları o kazanımı göstersin. Toplam soru sayısı listedeki toplamla aynı olsun.
- Soru türü kullanıcı seçimine göre: "mc" = çoktan seçmeli (4 seçenek A–D, tek doğru), "open" = açık uçlu (ortak yazılı sınav tarzı, kısa/uzun cevaplı). "karışık" seçildiyse okuma/anlama kazanımlarında çoktan seçmeli ve açık uçlu dengeli, YAZMA kazanımlarında açık uçlu (yazma görevi) kullan.
- Sorular kazanımın ölçtüğü beceriyi gerçekten ölçsün (MEB öğretim programı terimleriyle), sınıf düzeyine uygun olsun. Ortak yazılı sınav soru tarzını örnek al: metne dayalı, gerekçe isteyen, beceri temelli sorular.
- METİNLER: Okuma kazanımları için soruların dayanacağı metinleri "passages" alanına yaz. Metin ya ÖZGÜN olsun (tema içeriğine uygun, senin yazdığın şiir/hikâye/makale vb.) ya da telif süresi kesin dolmuş klasik bir metin olsun (yazarı en az 70 yıl önce ölmüş: ör. halk ve divan şiiri, Yunus Emre, Karacaoğlan, Fuzûlî, Tanzimat yazarları); klasik metni yazarken kelimesi kelimesine doğru olduğundan emin değilsen özgün metin yaz. Yaşayan ya da telifi süren yazarların metinlerini KULLANMA. Özgün metinlerde "source":"özgün metin", klasik metinlerde "source":"Yazar – Eser".
- Çoktan seçmelide çeldiriciler makul olsun, doğru cevap tek ve tartışmasız olsun; cevap şıkları dengeli dağılsın.
- Açık uçlu sorularda "model_answer" (örnek tam puanlık cevap) ve "rubric" (puanlama ölçütleri ve puanları) yaz.
- Puanlar: toplam 100 olacak şekilde "points" dağıt.
- Dil: açık, yazım ve noktalamaya uygun Türkçe. Ders yabancı dil ise (İngilizce vb.) okuma metinleri, soru kökleri ve seçenekler o dilde ve sınıf düzeyine uygun olsun; açıklama, örnek cevap ve puanlama Türkçe olabilir.
- Matematik ve fen gibi derslerde metin gerekmiyorsa "passages" boş olabilir; sayısal sorularda hesap adımlarını "explain"/"model_answer" içinde göster.

JSON şeması:
{"title":"...","instructions":"öğrenciye kısa yönerge","passages":[{"id":"M1","title":"...","type":"şiir|hikâye|...","source":"özgün metin","text":"..."}],"questions":[{"n":1,"kazanim_code":"TDE2.2","kazanim":"...","type":"mc","passage":"M1"|null,"stem":"...","options":["...","...","...","..."],"answer":"B","explain":"kısa çözüm","points":5},{"n":2,"kazanim_code":"TDE4.3","kazanim":"...","type":"open","passage":null,"stem":"...","model_answer":"...","rubric":[{"criterion":"...","points":4}],"points":10}]}`;

const KONU_ADD = `

BU İSTEK BİR KONU PEKİŞTİRME SETİDİR (yukarıdaki kurallar geçerli, şu farklarla):
- Amaç konuyu öğretmek ve kavramı oturtmak: her kazanım için verilen sayıda soru, kolaydan zora sıralı.
- Kısa metinler kullan (şiir 4–8 dize, düzyazı 1–2 paragraf); her metne en az 2 soru bağla.
- Kavram ve terim bilgisini yoklayan, örnek üzerinden düşündüren sorular yaz; aynı kalıbı tekrarlama.
- HER çoktan seçmeli soruya öğretici bir "explain" yaz (neden doğru, çeldiriciler neden yanlış). Açık uçlularda model_answer kısa ve öğretici olsun.
- "title" alanına "Konu soruları" ifadesini koy.`;

function testPrompt(spec, opts, prev, feedback) {
  let u = (spec.kind === 'konu' ? 'TÜR: KONU PEKİŞTİRME SORULARI (ortak sınav simülasyonu değil)\n' : 'TÜR: MUHTEMEL ORTAK SINAV SORULARI (senaryodaki dağılıma birebir uy)\n') + `Ders: ${spec.subject || ''}\nSınıf: ${spec.grade}. sınıf\nSınav: ${spec.exam}\nSenaryo: ${spec.scenarios.map(n => 'Senaryo ' + n).join(', ')}\nSoru türü: ${({ mc: 'çoktan seçmeli', open: 'açık uçlu', mix: 'karışık (ortak yazılı tarzı)' })[opts.qtype] || 'karışık'}\nZorluk: ${opts.level || 'orta'}\n\nKAZANIMLAR VE SORU SAYILARI:\n`;
  spec.items.forEach(it => { u += `- [${it.code || '—'}] ${it.text} → ${it.n} soru${it.skill ? ` (${it.skill})` : ''}\n  Tema: ${it.tema}\n  Konu (içerik çerçevesi): ${oneLine(it.konu).slice(0, 400)}\n`; });
  u += `\nToplam soru: ${spec.items.reduce((a, b) => a + b.n, 0)}\n`;
  if (spec.appendix) u += `\nEK BİLGİ (yazma kazanımları açıklaması):\n${spec.appendix.slice(0, 4000)}\n`;
  if (prev && feedback) u += `\nÖnceki test:\n${JSON.stringify(prev).slice(0, 30000)}\n\nÖğretmenin düzeltme isteği: ${feedback}\nYalnızca istenen kısmı değiştir, geri kalanı koru. Tam JSON'u yeniden ver.`;
  return u;
}

function validateTest(d, spec) {
  if (!d || !Array.isArray(d.questions) || !d.questions.length) throw new Error('Test boş döndü');
  const passages = (Array.isArray(d.passages) ? d.passages : []).slice(0, 12).map((p, i) => ({ id: String(p.id || 'M' + (i + 1)).slice(0, 8), title: String(p.title || '').slice(0, 120), type: String(p.type || '').slice(0, 30), source: String(p.source || 'özgün metin').slice(0, 120), text: String(p.text || '').slice(0, 6000) }));
  const pid = new Set(passages.map(p => p.id));
  const qs = d.questions.slice(0, 80).map((q, i) => {
    const type = q.type === 'mc' && Array.isArray(q.options) && q.options.length >= 3 ? 'mc' : 'open';
    const o = { n: i + 1, kazanim_code: String(q.kazanim_code || '').slice(0, 20), kazanim: String(q.kazanim || '').slice(0, 400), type, passage: pid.has(String(q.passage)) ? String(q.passage) : null, stem: String(q.stem || '').slice(0, 2500), points: Math.max(1, Math.round(+q.points || 5)) };
    if (type === 'mc') { o.options = q.options.slice(0, 5).map(x => String(x).replace(/^\s*[A-E][).]\s*/, '').slice(0, 400)); const L = 'ABCDE'.slice(0, o.options.length); o.answer = L.includes(String(q.answer || '').trim().toUpperCase()[0]) ? String(q.answer).trim().toUpperCase()[0] : 'A'; o.explain = String(q.explain || '').slice(0, 800); }
    else { o.model_answer = String(q.model_answer || '').slice(0, 2500); o.rubric = (Array.isArray(q.rubric) ? q.rubric : []).slice(0, 8).map(r => ({ criterion: String(r.criterion || '').slice(0, 300), points: Math.max(0, +r.points || 0) })); }
    return o;
  });
  // puanları 100'e ölçekle
  const tot = qs.reduce((a, b) => a + b.points, 0); if (tot && tot !== 100) { let acc = 0; qs.forEach((q, i) => { q.points = i === qs.length - 1 ? Math.max(1, 100 - acc) : Math.max(1, Math.round(q.points * 100 / tot)); acc += q.points; }); }
  return { title: String(d.title || '').slice(0, 160), instructions: String(d.instructions || '').slice(0, 800), passages, questions: qs };
}

// Öğrenciye gidecek sürüm: cevap ve ölçütler yok
const publicTest = d => ({ title: d.title, instructions: d.instructions, passages: d.passages, questions: d.questions.map(q => ({ n: q.n, kazanim_code: q.kazanim_code, type: q.type, passage: q.passage, stem: q.stem, options: q.options, points: q.points })) });

function scoreAttempt(d, answers) {
  let mcT = 0, mcC = 0, pts = 0, ptsMc = 0; const per = {};
  for (const q of d.questions) {
    const k = q.kazanim_code || q.kazanim.slice(0, 30); per[k] = per[k] || { code: q.kazanim_code, text: q.kazanim, mc: 0, ok: 0, open: 0 };
    if (q.type === 'mc') { mcT++; ptsMc += q.points; per[k].mc++; if (String(answers[q.n] || '').toUpperCase() === q.answer) { mcC++; pts += q.points; per[k].ok++; } }
    else per[k].open++;
  }
  return { mc_total: mcT, mc_correct: mcC, score: ptsMc ? Math.round(pts / ptsMc * 100) : null, per_kazanim: Object.values(per) };
}

module.exports = function ortak(ctx) {
  const { on, db, q, send, readBody, isAdmin, claude, ctxFor, logClaude, now, shortId, publicBase, series, storage } = ctx;
  const own = (req, row) => row && (isAdmin(req.user) || row.owner_id === req.user.id);

  // --- senaryo dosyaları ---
  on('POST', '/api/ortak/plans', async (req, res) => {
    const b = await readBody(req, 8e6);
    let data; try { data = parseWorkbook(b.sheets); } catch (e) { return send(res, e.code || 400, { error: e.message }); }
    const title = String(b.title || `${data.subject || 'Ders'}${data.period ? ' · ' + data.period : ''}`).slice(0, 160);
    const row = await db.insert('exam_plans', { owner_id: req.user.id, title, subject: data.subject, source_name: String(b.name || '').slice(0, 160), data });
    send(res, 201, { id: row.id, title, summary: data.grades.map(g => ({ grade: g.grade, exams: g.exams.map(e => ({ name: e.name, note: e.note, scenarios: e.scenarios.map(s => s.n) })) })) });
  });
  on('GET', '/api/ortak/plans', async (req, res) => {
    const rows = await db.select('exam_plans', `owner_id=eq.${q(req.user.id)}&select=id,title,subject,source_name,created_at,data&order=created_at.desc`);
    send(res, 200, rows.map(r => ({ id: r.id, title: r.title, subject: r.subject, source_name: r.source_name, created_at: r.created_at, grades: r.data.grades.map(g => g.grade) })));
  });
  on('GET', '/api/ortak/plans/:id', async (req, res, { id }) => {
    const r = await db.one('exam_plans', `id=eq.${q(id)}`); if (!own(req, r)) return send(res, 404, { error: 'Bulunamadı' });
    send(res, 200, r);
  });
  on('DELETE', '/api/ortak/plans/:id', async (req, res, { id }) => {
    const r = await db.one('exam_plans', `id=eq.${q(id)}&select=id,owner_id`); if (!own(req, r)) return send(res, 404, { error: 'Bulunamadı' });
    await db.remove('exam_plans', `id=eq.${q(id)}`); send(res, 200, { ok: true });
  });

  // --- hazırlık video serisi: seçilen kazanımlardan eğitim + plan (mevcut seri kuyruğuyla üretilir) ---
  on('POST', '/api/ortak/plans/:id/series', async (req, res, { id }) => {
    const r = await db.one('exam_plans', `id=eq.${q(id)}`); if (!own(req, r)) return send(res, 404, { error: 'Bulunamadı' });
    const b = await readBody(req, 20000);
    const cmb = combine(r.data, b.grade, +b.exam || 0, (b.scenarios || []).map(Number)); if (!cmb || !cmb.exam) return send(res, 400, { error: 'Sınav seçilemedi' });
    let items = cmb.items;
    if (b.all) items = cmb.grade.kazanimlar.map(k => { const f = cmb.items.find(x => x.tema === k.tema && x.text === k.text) || {}; return { ...k, count: f.count || 0, in: f.in || [] }; });
    if (Array.isArray(b.pick) && b.pick.length) items = items.filter((_, i) => b.pick.includes(i));
    if (!items.length) return send(res, 400, { error: 'Seçili senaryolarda kazanım yok' });
    const g = cmb.grade, subj = r.data.subject || r.subject || '';
    const scen = cmb.scenarios.length ? 'Senaryo ' + cmb.scenarios.join(', ') : 'Tüm senaryolar';
    const temas = [...new Set(items.map(i => i.tema))];
    const units = temas.map((t, i) => ({ n: i + 1, title: t.replace(/^\d+\.\s*(tema|ünite)\s*:\s*/i, ''), hours: '', outcome: `${items.filter(x => x.tema === t).length} kazanım` }));
    const weeks = items.map((it, i) => ({
      week: i + 1, unit: temas.indexOf(it.tema) + 1, title: (it.code ? it.code + ' · ' : '') + it.text.replace(CODE_RE, '').slice(0, 90),
      content: `${oneLine(it.konu).slice(0, 600)}`, kazanimlar: [it.text],
      uygulama: it.count ? `Ortak sınavda bu kazanımdan ${it.count} soru (${it.in.map(n => 'Senaryo ' + n).join(', ')}).` : 'Seçili senaryolarda bu kazanımdan soru yok; konu tekrarı.',
      olcme: it.count ? `${it.count} soru · ${it.in.map(n => 'S' + n).join(', ')}` : '—',
      brief: examBrief(subj, g.grade, cmb.exam.name, scen, it),
    }));
    const D = b.defaults || {};
    const plan = { kind: 'ortak', title: `${g.grade}. sınıf ${subj} · ${cmb.exam.name}`, subject: subj, audience: `${g.grade}. sınıf öğrencileri`, units, weeks, exam: { plan_id: r.id, grade: g.grade, exam: cmb.exam.name, scenarios: cmb.scenarios },
      defaults: { tone: D.tone || 'samimi', format: D.format || 'dikey', target_seconds: Math.min(300, Math.max(60, +D.target_seconds || 120)), visual_style: D.visual_style || 'sade' } };
    const c = await db.insert('courses', { teacher_id: req.user.id, title: `${plan.title} · ${scen} hazırlık`.slice(0, 140), subject: subj, level: `${g.grade}. sınıf`, description: `${cmb.exam.name} (${scen}) için kazanım kazanım hazırlık videoları. Her video bir kazanımı, ortak sınav soru tarzını ve çözüm yolunu anlatır.`, status: 'draft', access: 'request', visibility: 'unlisted', plan });
    send(res, 201, { course_id: c.id, weeks: weeks.length });
  });

  // --- kazanım testi ---
  const RUN = new Set();
  async function runTest(testId) {
    if (RUN.has(testId)) return; RUN.add(testId);
    try {
      const t = await db.one('exam_tests', `id=eq.${q(testId)}`);
      await db.update('exam_tests', `id=eq.${q(testId)}`, { status: 'generating', error: null, updated_at: now() });
      const user = testPrompt(t.spec, t.opts || {}, t.feedback ? t.data : null, t.feedback);
      const [r] = await claude.complete([{ system: t.spec.kind === 'konu' ? TEST_SYSTEM + KONU_ADD : TEST_SYSTEM, user, max: 24000 }], ctxFor(null, 'exam_test:' + testId));
      if (!r || r.error) throw new Error((r && r.error) || 'yanıt yok');
      const data = validateTest(claude.extractJson(r.text), t.spec);
      await logClaude(null, r.usage, 'ortak sınav testi');
      await db.update('exam_tests', `id=eq.${q(testId)}`, { status: 'ready', data, title: data.title || t.title, feedback: null, updated_at: now() });
    } catch (e) { console.error('test', e); await db.update('exam_tests', `id=eq.${q(testId)}`, { status: 'failed', error: String(e.message).slice(0, 600), updated_at: now() }).catch(() => {}); }
    finally { RUN.delete(testId); }
  }
  // yarım kalan üretimleri sürdür (sunucu yeniden başlarsa)
  setTimeout(async () => { try { for (const t of await db.select('exam_tests', 'status=eq.generating&select=id')) runTest(t.id); } catch { } }, 8000);

  on('POST', '/api/ortak/plans/:id/test', async (req, res, { id }) => {
    const r = await db.one('exam_plans', `id=eq.${q(id)}`); if (!own(req, r)) return send(res, 404, { error: 'Bulunamadı' });
    const b = await readBody(req, 20000);
    const cmb = combine(r.data, b.grade, +b.exam || 0, (b.scenarios || []).map(Number)); if (!cmb || !cmb.exam) return send(res, 400, { error: 'Sınav seçilemedi' });
    if (!cmb.items.length) return send(res, 400, { error: cmb.exam.note ? 'Bu sınav için senaryo yok: ' + cmb.exam.note.slice(0, 200) : 'Seçili senaryolarda kazanım yok' });
    const mult = Math.min(3, Math.max(1, +b.multiplier || 1));
    const items = cmb.items.map(it => ({ tema: it.tema, konu: it.konu, skill: it.skill, code: it.code, text: it.text, n: it.count * mult }));
    const total = items.reduce((a, b) => a + b.n, 0); if (total > 60) return send(res, 400, { error: `Çok fazla soru (${total}); kat sayısını düşürün` });
    const spec = { subject: r.data.subject || r.subject, grade: cmb.grade.grade, exam: cmb.exam.name, scenarios: cmb.scenarios, items, appendix: items.some(i => /^B\./.test(i.code || '') || /EK\s*\d/i.test(i.text)) ? (r.data.appendix || []).map(a => a.text).join('\n').slice(0, 6000) : null };
    const opts = { qtype: ['mc', 'open', 'mix'].includes(b.qtype) ? b.qtype : 'mix', level: ['kolay', 'orta', 'zor'].includes(b.level) ? b.level : 'orta', multiplier: mult };
    const title = `${spec.grade}. sınıf ${spec.subject || ''} · ${spec.exam} · ${cmb.scenarios.map(n => 'S' + n).join('+')} kazanım testi`.slice(0, 160);
    const t = await db.insert('exam_tests', { owner_id: req.user.id, plan_id: r.id, title, spec, opts, status: 'generating' });
    runTest(t.id); send(res, 202, { id: t.id });
  });
  on('GET', '/api/ortak/tests', async (req, res) => send(res, 200, await db.select('exam_tests', `owner_id=eq.${q(req.user.id)}&select=id,title,status,published,code,created_at,plan_id&order=created_at.desc`)));
  on('GET', '/api/ortak/tests/:id', async (req, res, { id }) => {
    const t = await db.one('exam_tests', `id=eq.${q(id)}`); if (!own(req, t)) return send(res, 404, { error: 'Bulunamadı' });
    const attempts = await db.select('test_attempts', `test_id=eq.${q(id)}&select=id,student_name,student_class,score,mc_total,mc_correct,per_kazanim,answers,created_at&order=created_at.desc&limit=500`);
    send(res, 200, { test: t, attempts, url: t.code ? `${publicBase()}/test/${t.code}` : null });
  });
  on('POST', '/api/ortak/tests/:id/revise', async (req, res, { id }) => {
    const t = await db.one('exam_tests', `id=eq.${q(id)}`); if (!own(req, t)) return send(res, 404, { error: 'Bulunamadı' });
    const b = await readBody(req, 4000); if (!b.feedback || t.status !== 'ready') return send(res, 400, { error: 'Düzeltme notu yazın (test hazır olmalı)' });
    await db.update('exam_tests', `id=eq.${q(id)}`, { feedback: String(b.feedback).slice(0, 1500), status: 'generating' }); runTest(id); send(res, 202, { ok: true });
  });
  on('POST', '/api/ortak/tests/:id/retry', async (req, res, { id }) => {
    const t = await db.one('exam_tests', `id=eq.${q(id)}`); if (!own(req, t)) return send(res, 404, { error: 'Bulunamadı' });
    if (t.status !== 'failed') return send(res, 400, { error: 'Test başarısız durumda değil' }); runTest(id); send(res, 202, { ok: true });
  });
  on('POST', '/api/ortak/tests/:id/publish', async (req, res, { id }) => {
    const t = await db.one('exam_tests', `id=eq.${q(id)}`); if (!own(req, t)) return send(res, 404, { error: 'Bulunamadı' });
    const b = await readBody(req, 1000); if (t.status !== 'ready') return send(res, 400, { error: 'Test henüz hazır değil' });
    const patch = { published: !!b.on, updated_at: now() }; if (b.on && !t.code) patch.code = shortId();
    const r2 = await db.update('exam_tests', `id=eq.${q(id)}`, patch); send(res, 200, { code: r2.code, published: r2.published, url: r2.code ? `${publicBase()}/test/${r2.code}` : null });
  });
  on('DELETE', '/api/ortak/tests/:id', async (req, res, { id }) => {
    const t = await db.one('exam_tests', `id=eq.${q(id)}&select=id,owner_id`); if (!own(req, t)) return send(res, 404, { error: 'Bulunamadı' });
    await db.remove('exam_tests', `id=eq.${q(id)}`); send(res, 200, { ok: true });
  });


  // ===== Ortak sınav çalışması: adım adım akış =====
  // 1 konu anlatım videoları → 2 konu soruları → 3 muhtemel sınav soruları → 4 sınav (uygula, sonuçlar) → 5 soru çözüm videoları
  const S_STEPS = ['videos', 'practice', 'exam', 'apply', 'solutions'];
  const ownStudy = async (req, id) => { const s = await db.one('exam_studies', `id=eq.${q(id)}`); return own(req, s) ? s : null; };
  const failCode = (res, e) => { if (e.code) return send(res, e.code, { error: e.message }); throw e; };

  on('POST', '/api/ortak/studies', async (req, res) => {
    const b = await readBody(req, 20000);
    const r = await db.one('exam_plans', `id=eq.${q(b.plan_id)}`); if (!own(req, r)) return send(res, 404, { error: 'Senaryo dosyası bulunamadı' });
    const cmb = combine(r.data, b.grade, +b.exam || 0, (b.scenarios || []).map(Number)); if (!cmb || !cmb.exam) return send(res, 400, { error: 'Sınav seçilemedi' });
    if (!cmb.exam.scenarios.length) return send(res, 400, { error: cmb.exam.note ? 'Bu sınav için senaryo yayımlanmamış: ' + cmb.exam.note.slice(0, 200) : 'Bu sınavda senaryo yok' });
    let items = cmb.grade.kazanimlar.map(k => { const f = cmb.items.find(x => x.tema === k.tema && x.text === k.text) || {}; return { tema: k.tema, konu: k.konu, skill: k.skill, code: k.code, text: k.text, count: f.count || 0, in: f.in || [] }; });
    if (Array.isArray(b.pick) && b.pick.length) items = items.filter((_, i) => b.pick.includes(i)); else items = items.filter(i => i.count);
    if (!items.length) return send(res, 400, { error: 'Seçili senaryolarda kazanım yok' });
    const subject = cmb.grade.subject || r.data.subject || r.subject || '';
    const scen = cmb.scenarios.length ? cmb.scenarios : cmb.exam.scenarios.map(x => x.n);
    const title = `${cmb.grade.grade}. sınıf ${subject} · ${cmb.exam.name} · Senaryo ${scen.join(', ')}`.slice(0, 200);
    const appendix = items.some(i => /^B\./.test(i.code || '') || /EK\s*\d/i.test(i.text)) ? (r.data.appendix || []).map(a => a.text).join('\n').slice(0, 6000) : null;
    const st = await db.insert('exam_studies', { owner_id: req.user.id, plan_id: r.id, title, subject, grade: cmb.grade.grade, exam_name: cmb.exam.name, scenarios: scen, items, appendix });
    send(res, 201, { id: st.id });
  });
  on('GET', '/api/ortak/studies', async (req, res) => {
    const rows = await db.select('exam_studies', `owner_id=eq.${q(req.user.id)}&select=id,title,grade,exam_name,scenarios,items,video_course_id,practice_test_id,exam_test_id,solution_course_id,skipped,created_at&order=created_at.desc`);
    const exIds = rows.map(s => s.exam_test_id).filter(Boolean);
    const pub = new Set(exIds.length ? (await db.select('exam_tests', `id=in.(${exIds.map(q).join(',')})&published=is.true&select=id`)).map(t => t.id) : []);
    send(res, 200, rows.map(s => ({ id: s.id, title: s.title, grade: s.grade, exam_name: s.exam_name, scenarios: s.scenarios, kazanim: s.items.length, created_at: s.created_at,
      done: [s.video_course_id || s.skipped.includes('videos'), s.practice_test_id || s.skipped.includes('practice'), s.exam_test_id, pub.has(s.exam_test_id) || s.skipped.includes('apply'), s.solution_course_id || s.skipped.includes('solutions')].filter(Boolean).length })));
  });

  async function courseState(cid) {
    if (!cid) return null;
    const c = await db.one('courses', `id=eq.${q(cid)}&select=id,title,plan`); if (!c) return null;
    const ids = c.plan.weeks.map(w => w.project_id).filter(Boolean);
    const ps = ids.length ? await db.select('projects', `id=in.(${ids.map(q).join(',')})&select=id,status,title`) : [];
    const pm = Object.fromEntries(ps.map(p => [p.id, p]));
    return { id: c.id, title: c.title, defaults: c.plan.defaults, items: c.plan.weeks.map(w => ({ week: w.week, title: w.title, qn: w.qn || null, project_id: w.project_id || null, status: w.project_id && pm[w.project_id] ? pm[w.project_id].status : null })) };
  }
  async function testState(tid, withStats) {
    if (!tid) return null;
    const t = await db.one('exam_tests', `id=eq.${q(tid)}&select=id,title,status,error,published,code,opts,data,spec`); if (!t) return null;
    const o = { id: t.id, title: t.title, status: t.status, error: t.error, published: t.published, code: t.code, url: t.code ? `${publicBase()}/test/${t.code}` : null, opts: t.opts,
      total: t.data ? t.data.questions.length : t.spec.items.reduce((a, b) => a + b.n, 0), mc: t.data ? t.data.questions.filter(x => x.type === 'mc').length : null };
    if (withStats && t.data) {
      const at = await db.select('test_attempts', `test_id=eq.${q(tid)}&select=answers,score,mc_correct,mc_total`);
      o.attempts = at.length; o.avg = at.length ? Math.round(at.reduce((a, b) => a + (b.score || 0), 0) / at.length) : null;
      o.questions = t.data.questions.map(qq => { const n = at.length; const wrong = qq.type === 'mc' ? at.filter(a => String((a.answers || {})[qq.n] || '').toUpperCase() !== qq.answer).length : null;
        return { n: qq.n, type: qq.type, kazanim_code: qq.kazanim_code, stem: qq.stem.slice(0, 220), answer: qq.answer || null, wrong_pct: n && wrong != null ? Math.round(wrong / n * 100) : null }; });
    }
    return o;
  }
  on('GET', '/api/ortak/studies/:id', async (req, res, { id }) => {
    const s = await ownStudy(req, id); if (!s) return send(res, 404, { error: 'Bulunamadı' });
    const [videos, practice, exam, solutions] = await Promise.all([courseState(s.video_course_id), testState(s.practice_test_id), testState(s.exam_test_id, true), courseState(s.solution_course_id)]);
    send(res, 200, { study: { ...s, appendix: undefined }, videos, practice, exam, solutions, share: s.share_code ? { on: s.shared, code: s.share_code, url: `${publicBase()}/calisma/${s.share_code}` } : null });
  });
  on('DELETE', '/api/ortak/studies/:id', async (req, res, { id }) => {
    const s = await ownStudy(req, id); if (!s) return send(res, 404, { error: 'Bulunamadı' });
    await db.remove('exam_studies', `id=eq.${q(id)}`); send(res, 200, { ok: true });
  });
  on('POST', '/api/ortak/studies/:id/skip', async (req, res, { id }) => {
    const s = await ownStudy(req, id); if (!s) return send(res, 404, { error: 'Bulunamadı' });
    const b = await readBody(req, 1000); if (!['videos', 'practice', 'apply', 'solutions'].includes(b.step)) return send(res, 400, { error: 'Bu adım atlanamaz' });
    const sk = new Set(s.skipped); b.undo ? sk.delete(b.step) : sk.add(b.step);
    await db.update('exam_studies', `id=eq.${q(id)}`, { skipped: [...sk], updated_at: now() }); send(res, 200, { ok: true });
  });

  // 1. adım: konu anlatım videoları (kazanım başına bir video, hemen sıraya alınır)
  on('POST', '/api/ortak/studies/:id/videos', async (req, res, { id }) => {
    const s = await ownStudy(req, id); if (!s) return send(res, 404, { error: 'Bulunamadı' });
    const b = await readBody(req, 8000); const D = b.defaults || {};
    const defaults = { tone: D.tone || 'samimi', format: D.format || 'dikey', target_seconds: Math.min(300, Math.max(60, +D.target_seconds || 120)), visual_style: D.visual_style || 'sade' };
    let c = s.video_course_id && await db.one('courses', `id=eq.${q(s.video_course_id)}`);
    if (!c) {
      const items = s.items, temas = [...new Set(items.map(i => i.tema))], scen = 'Senaryo ' + s.scenarios.join(', ');
      const weeks = items.map((it, i) => ({ week: i + 1, unit: temas.indexOf(it.tema) + 1, title: (it.code ? it.code + ' · ' : '') + it.text.replace(CODE_RE, '').slice(0, 90), content: oneLine(it.konu).slice(0, 600), kazanimlar: [it.text],
        uygulama: it.count ? `Ortak sınavda bu kazanımdan ${it.count} soru (${it.in.map(n => 'Senaryo ' + n).join(', ')}).` : 'Seçili senaryolarda soru yok; konu tekrarı.', olcme: it.count ? `${it.count} soru` : '—', brief: examBrief(s.subject, s.grade, s.exam_name, scen, it) }));
      const plan = { kind: 'ortak', title: s.title, subject: s.subject, audience: `${s.grade}. sınıf öğrencileri`, units: temas.map((t, i) => ({ n: i + 1, title: t.replace(/^\d+\.\s*(tema|ünite)\s*:\s*/i, ''), hours: '', outcome: `${items.filter(x => x.tema === t).length} kazanım` })), weeks, exam: { plan_id: s.plan_id, study_id: s.id }, defaults };
      c = await db.insert('courses', { teacher_id: req.user.id, title: `${s.title} · Konu anlatımı`.slice(0, 140), subject: s.subject, level: `${s.grade}. sınıf`, description: `${s.exam_name} hazırlığı: senaryodaki her kazanım için konu anlatım videosu.`, status: 'draft', access: 'request', visibility: 'unlisted', plan });
      await db.update('exam_studies', `id=eq.${q(id)}`, { video_course_id: c.id, updated_at: now() });
    }
    const weeks = Array.isArray(b.weeks) && b.weeks.length ? b.weeks : c.plan.weeks.filter(w => !w.project_id).map(w => w.week);
    try { const created = await series.produce(req.user, c, weeks, defaults); send(res, 200, { created: created.length }); } catch (e) { failCode(res, e); }
  });

  // 2. ve 3. adım: konu soruları / muhtemel sınav soruları
  async function makeTest(req, s, kind, b) {
    const level = ['kolay', 'orta', 'zor'].includes(b.level) ? b.level : (kind === 'konu' ? 'kolay' : 'orta');
    const qtype = ['mc', 'open', 'mix'].includes(b.qtype) ? b.qtype : 'mix';
    let items, mult = 1;
    if (kind === 'konu') { const per = Math.min(6, Math.max(2, +b.per || 3)); items = s.items.map(it => ({ tema: it.tema, konu: it.konu, skill: it.skill, code: it.code, text: it.text, n: per })); }
    else { mult = Math.min(3, Math.max(1, +b.multiplier || 1)); items = s.items.filter(it => it.count).map(it => ({ tema: it.tema, konu: it.konu, skill: it.skill, code: it.code, text: it.text, n: it.count * mult })); }
    const total = items.reduce((a, x) => a + x.n, 0);
    if (!total) throw Object.assign(new Error('Soru üretilecek kazanım yok'), { code: 400 });
    if (total > 60) throw Object.assign(new Error(`Çok fazla soru (${total}); sayıyı düşürün`), { code: 400 });
    const spec = { kind, subject: s.subject, grade: s.grade, exam: s.exam_name, scenarios: s.scenarios, items, appendix: s.appendix };
    const title = `${s.grade}. sınıf ${s.subject || ''} · ${kind === 'konu' ? 'Konu soruları' : 'Muhtemel sınav soruları'} · S${s.scenarios.join('+')}`.slice(0, 160);
    const t = await db.insert('exam_tests', { owner_id: req.user.id, plan_id: s.plan_id, title, spec, opts: { qtype, level, multiplier: mult, kind }, status: 'generating' });
    runTest(t.id); return t;
  }
  for (const [path, kind, col] of [['practice', 'konu', 'practice_test_id'], ['exam', 'sinav', 'exam_test_id']]) {
    on('POST', `/api/ortak/studies/:id/${path}`, async (req, res, { id }) => {
      const s = await ownStudy(req, id); if (!s) return send(res, 404, { error: 'Bulunamadı' });
      const b = await readBody(req, 4000);
      try { const t = await makeTest(req, s, kind, b); await db.update('exam_studies', `id=eq.${q(id)}`, { [col]: t.id, updated_at: now() }); send(res, 202, { id: t.id }); } catch (e) { failCode(res, e); }
    });
  }

  // 5. adım: soru çözüm videoları (sınavdaki seçilen sorular; en çok yanlış yapılanlar önce önerilir)
  on('POST', '/api/ortak/studies/:id/solutions', async (req, res, { id }) => {
    const s = await ownStudy(req, id); if (!s) return send(res, 404, { error: 'Bulunamadı' });
    const t = s.exam_test_id && await db.one('exam_tests', `id=eq.${q(s.exam_test_id)}`); if (!t || t.status !== 'ready') return send(res, 400, { error: 'Önce sınav sorularını hazırlayın' });
    const b = await readBody(req, 8000); const D = b.defaults || {};
    const defaults = { tone: D.tone || 'samimi', format: D.format || 'dikey', target_seconds: Math.min(300, Math.max(60, +D.target_seconds || 90)), visual_style: D.visual_style || 'sade' };
    const P = Object.fromEntries((t.data.passages || []).map(p => [p.id, p]));
    let c = s.solution_course_id && await db.one('courses', `id=eq.${q(s.solution_course_id)}`);
    if (!c) {
      const weeks = t.data.questions.map(qq => ({ week: qq.n, qn: qq.n, unit: 1, title: `Soru ${qq.n} çözümü${qq.kazanim_code ? ' · ' + qq.kazanim_code : ''}`, content: qq.stem.slice(0, 400), kazanimlar: [qq.kazanim].filter(Boolean), uygulama: qq.type === 'mc' ? `Doğru cevap: ${qq.answer}` : 'Açık uçlu', olcme: qq.type === 'mc' ? 'Çoktan seçmeli' : 'Açık uçlu', brief: solutionBrief(s, qq, P[qq.passage]) }));
      const plan = { kind: 'ortak', title: `${s.title} · Soru çözümleri`, subject: s.subject, audience: `${s.grade}. sınıf öğrencileri`, units: [{ n: 1, title: 'Muhtemel sınav soruları', hours: '', outcome: `${weeks.length} soru` }], weeks, exam: { plan_id: s.plan_id, study_id: s.id }, defaults };
      c = await db.insert('courses', { teacher_id: req.user.id, title: `${s.title} · Soru çözümleri`.slice(0, 140), subject: s.subject, level: `${s.grade}. sınıf`, description: `${s.exam_name} muhtemel sınav sorularının adım adım çözüm videoları.`, status: 'draft', access: 'request', visibility: 'unlisted', plan });
      await db.update('exam_studies', `id=eq.${q(id)}`, { solution_course_id: c.id, updated_at: now() });
    }
    const want = (Array.isArray(b.questions) ? b.questions : []).map(Number);
    if (!want.length) return send(res, 400, { error: 'Çözüm videosu yapılacak soruları seçin' });
    try { const created = await series.produce(req.user, c, want, defaults); send(res, 200, { created: created.length }); } catch (e) { failCode(res, e); }
  });

  // ===== Öğrenciye tek bağlantı: konu videoları → konu soruları → sınav → soru çözüm videoları =====
  on('POST', '/api/ortak/studies/:id/share', async (req, res, { id }) => {
    const s = await ownStudy(req, id); if (!s) return send(res, 404, { error: 'Bulunamadı' });
    const b = await readBody(req, 1000); if (b.on && !s.exam_test_id) return send(res, 400, { error: 'Önce sınav sorularını hazırlayın' });
    const patch = { shared: !!b.on, updated_at: now() }; if (b.on && !s.share_code) patch.share_code = shortId();
    const r = await db.update('exam_studies', `id=eq.${q(id)}`, patch);
    send(res, 200, { shared: r.shared, code: r.share_code, url: r.share_code ? `${publicBase()}/calisma/${r.share_code}` : null });
  });
  const VURL = new Map();
  async function videoOf(pid) {
    const c = VURL.get(pid); if (c && c.exp > Date.now()) return c.v;
    const p = await db.one('projects', `id=eq.${q(pid)}&select=id,status,format,thumb_path,title`); if (!p || p.status !== 'delivered') return null;
    const jobs = await db.select('render_jobs', `project_id=eq.${q(pid)}&status=eq.done&order=created_at.desc&select=format,output_path&limit=5`);
    const j = jobs.find(x => (x.format || 'dikey') === (p.format || 'dikey') && x.output_path) || jobs.find(x => x.output_path); if (!j) return null;
    const v = { url: await storage.signedUrl(j.output_path, 8 * 3600), poster: p.thumb_path ? await storage.signedUrl(p.thumb_path, 8 * 3600).catch(() => null) : null, format: j.format || p.format || 'dikey' };
    VURL.set(pid, { v, exp: Date.now() + 6 * 3600e3 }); return v;
  }
  async function sharedStudy(code) { return db.one('exam_studies', `share_code=eq.${q(String(code).toUpperCase())}&shared=is.true`); }
  on('GET', '/api/calisma/:code', async (req, res, { code }) => {
    const s = await sharedStudy(code); if (!s) return send(res, 404, { error: 'Çalışma bulunamadı ya da kapalı' });
    const course = async cid => { if (!cid) return []; const c = await db.one('courses', `id=eq.${q(cid)}&select=plan`); if (!c) return []; const out = []; for (const w of c.plan.weeks) { if (!w.project_id) continue; const v = await videoOf(w.project_id); if (v) out.push({ title: w.title, qn: w.qn || null, kazanim: (w.kazanimlar || [])[0] || null, ...v }); } return out; };
    const test = async tid => { if (!tid) return null; const t = await db.one('exam_tests', `id=eq.${q(tid)}&select=status,data`); return t && t.status === 'ready' ? publicTest(t.data) : null; };
    const [videos, solutions, practice, exam] = await Promise.all([course(s.video_course_id), course(s.solution_course_id), test(s.practice_test_id), test(s.exam_test_id)]);
    send(res, 200, { title: s.title, subject: s.subject, grade: s.grade, exam_name: s.exam_name, videos, practice, exam, solutions: solutions.map(v => ({ qn: v.qn, title: v.title, url: v.url, poster: v.poster, format: v.format })) });
  }, 'public');
  on('POST', '/api/calisma/:code/:part', async (req, res, { code, part }) => {
    if (!['practice', 'exam'].includes(part)) return send(res, 404, { error: 'Bulunamadı' });
    const s = await sharedStudy(code); if (!s) return send(res, 404, { error: 'Çalışma bulunamadı ya da kapalı' });
    const tid = part === 'exam' ? s.exam_test_id : s.practice_test_id; const t = tid && await db.one('exam_tests', `id=eq.${q(tid)}&select=id,data,status`);
    if (!t || t.status !== 'ready') return send(res, 404, { error: 'Sorular hazır değil' });
    const b = await readBody(req, 60000); const name = String(b.name || '').trim().slice(0, 80);
    if (part === 'exam' && name.length < 2) return send(res, 400, { error: 'Adınızı yazın' });
    const answers = {}; for (const qq of t.data.questions) { const v = (b.answers || {})[qq.n]; if (v != null) answers[qq.n] = String(v).slice(0, qq.type === 'mc' ? 1 : 4000); }
    const sc = scoreAttempt(t.data, answers);
    if (name.length >= 2) await db.insert('test_attempts', { test_id: t.id, study_id: s.id, student_name: name, student_class: String(b.cls || '').slice(0, 40) || null, answers, ...sc });
    send(res, 200, { ...sc, review: t.data.questions.map(qq => qq.type === 'mc' ? { n: qq.n, type: 'mc', answer: qq.answer, given: answers[qq.n] || null, explain: qq.explain } : { n: qq.n, type: 'open', given: answers[qq.n] || '', model_answer: qq.model_answer, rubric: qq.rubric }) });
  }, 'public');

  // --- öğrenci tarafı (herkese açık, test kodu ile) ---
  on('GET', '/api/test/:code', async (req, res, { code }) => {
    const t = await db.one('exam_tests', `code=eq.${q(String(code).toUpperCase())}&published=is.true&select=id,title,data,status`);
    if (!t || t.status !== 'ready') return send(res, 404, { error: 'Test bulunamadı ya da kapalı' });
    send(res, 200, { title: t.title, test: publicTest(t.data) });
  }, 'public');
  on('POST', '/api/test/:code', async (req, res, { code }) => {
    const t = await db.one('exam_tests', `code=eq.${q(String(code).toUpperCase())}&published=is.true&select=id,data,status`);
    if (!t || t.status !== 'ready') return send(res, 404, { error: 'Test bulunamadı ya da kapalı' });
    const b = await readBody(req, 60000); const name = String(b.name || '').trim().slice(0, 80); if (name.length < 2) return send(res, 400, { error: 'Adınızı yazın' });
    const answers = {}; for (const qq of t.data.questions) { const v = (b.answers || {})[qq.n]; if (v != null) answers[qq.n] = String(v).slice(0, qq.type === 'mc' ? 1 : 4000); }
    const sc = scoreAttempt(t.data, answers);
    await db.insert('test_attempts', { test_id: t.id, student_name: name, student_class: String(b.cls || '').slice(0, 40) || null, user_id: req.user ? req.user.id : null, answers, ...sc });
    // sonuç: çoktan seçmelide doğru cevap ve açıklama; açık uçluda örnek cevap ve ölçüt (öz değerlendirme için)
    send(res, 200, { ...sc, review: t.data.questions.map(qq => qq.type === 'mc' ? { n: qq.n, type: 'mc', answer: qq.answer, given: answers[qq.n] || null, explain: qq.explain } : { n: qq.n, type: 'open', given: answers[qq.n] || '', model_answer: qq.model_answer, rubric: qq.rubric }) });
  }, 'public');

  return { parseWorkbook, combine };
};

// Hazırlık videosu brifi: kazanımı, ortak sınav soru tarzını ve örnek soru çözümünü anlatır
function examBrief(subject, grade, exam, scen, it) {
  let b = `Ortak yazılı sınava hazırlık videosu. Ders: ${subject}, ${grade}. sınıf. Sınav: ${exam} (${scen}).\n`;
  b += `Kazanım: ${it.text}\nTema: ${it.tema}\nKonu (içerik çerçevesi): ${oneLine(it.konu).slice(0, 700)}\n`;
  if (it.count) b += `Bu kazanımdan ortak sınavda ${it.count} soru bekleniyor.\n`;
  if (/ingilizce|almanca|fransızca|arapça|yabancı dil/i.test(subject || '')) b += `Bu bir yabancı dil dersi: anlatım Türkçe, örnek cümleler, kelimeler ve örnek soru ${subject} dilinde olsun.\n`;
  b += `\nVideoda: kazanımın neyi ölçtüğünü sade bir dille açıkla; gerekli kavramları örnekle öğret; ortak sınavda bu kazanımla ilgili nasıl bir soru gelebileceğini göster (özgün bir örnek soru yaz ve adım adım çöz); öğrencilerin sık yaptığı hataları ve cevap yazarken dikkat edilecekleri söyle; son sahnede kısa bir tekrar yap. Telifli modern metinleri alıntılama; örnek metinler özgün ya da telif süresi dolmuş klasik metinler olsun.`;
  return b.slice(0, 4000);
}
// Soru çözüm videosu brifi
function solutionBrief(s, qq, passage) {
  let b = `Soru çözüm videosu. Ders: ${s.subject}, ${s.grade}. sınıf, ${s.exam_name} hazırlığı. Bu, ortak sınavda çıkabilecek bir sorunun adım adım çözümüdür.\n`;
  b += `Kazanım: ${qq.kazanim || qq.kazanim_code}\n`;
  if (passage) b += `\nSorunun dayandığı metin (${passage.title}${passage.source ? ', ' + passage.source : ''}):\n${passage.text.slice(0, 1400)}\n`;
  b += `\nSORU ${qq.n}: ${qq.stem}\n`;
  if (qq.type === 'mc') b += qq.options.map((o, i) => `${'ABCDE'[i]}) ${o}`).join('\n') + `\nDoğru cevap: ${qq.answer}\nAçıklama: ${qq.explain || ''}\n`;
  else b += `Örnek tam puanlık cevap: ${qq.model_answer}\nPuanlama: ${(qq.rubric || []).map(r => r.criterion + ' (' + r.points + ')').join('; ')}\n`;
  b += `\nVideoda: soruyu ekranda göster ve sesli oku; soru kökünde ne istendiğini (anahtar kelimeleri) vurgula; metindeki ipuçlarını tek tek göster; ${qq.type === 'mc' ? 'her seçeneği ele, çeldiricilerin neden yanlış olduğunu açıkla, doğru cevaba ulaş' : 'tam puan alan bir cevabın nasıl kurulacağını puanlama ölçütlerine göre adım adım yaz'}; son sahnede bu tip sorularda dikkat edilecek 2–3 noktayı özetle. Metni ve soruyu aynen kullan, yeni metin uydurma.`;
  return b.slice(0, 4000);
}
module.exports.parseWorkbook = parseWorkbook;
module.exports.combine = combine;
module.exports.validateTest = validateTest;
module.exports.scoreAttempt = scoreAttempt;
module.exports.examBrief = examBrief;
