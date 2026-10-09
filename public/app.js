(() => {
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const STATUS = { draft: 'Taslak', content_generating: 'İçerik hazırlanıyor', content_review: 'İçerik onayı bekliyor', visuals_generating: 'Görseller hazırlanıyor', visuals_review: 'Görsel onayı bekliyor', voicing: 'Seslendiriliyor', rendering: 'Video üretiliyor', delivered: 'Teslim edildi', failed: 'Hata', archived: 'İptal edildi' };
  const STEP_OF = { content_generating: 0, content_review: 0, visuals_generating: 1, visuals_review: 1, voicing: 2, rendering: 3, delivered: 4 };
  let pollTimer = null, player = null;

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.endsWith('/login')) { location.hash = '#/login'; throw new Error('Giriş gerekli'); }
    if (!r.ok) throw new Error(j.error || 'İstek başarısız');
    return j;
  }
  function stop() { clearTimeout(pollTimer); pollTimer = null; if (player) { player.stop(); player = null; } }
  const busy = (btn, on) => { if (btn) { btn.disabled = on; } };

  /* ---------- kaynak dosyaları (tarayıcıda metne çevrilir) ---------- */
  const loadScript = src => new Promise((ok, no) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Kütüphane yüklenemedi')); document.head.appendChild(s); });
  async function extractFile(f) {
    const name = f.name.replace(/\.[^.]+$/, '').slice(0, 100), ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await window.pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise; const pages = [];
      for (let i = 1; i <= Math.min(doc.numPages, 800); i++) { const tc = await (await doc.getPage(i)).getTextContent(); let t = '', lastY = null; for (const it of tc.items) { if (lastY !== null && Math.abs(it.transform[5] - lastY) > 4) t += '\n'; t += it.str + (it.hasEOL ? '\n' : ''); lastY = it.transform[5]; } pages.push(t.replace(/[ \t]+/g, ' ').trim()); }
      return { name, pages };
    }
    if (ext === 'docx') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
      const r = await window.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() }); return { name, pages: chunk(r.value) };
    }
    if (['txt', 'md', 'csv'].includes(ext)) return { name, pages: chunk(await f.text()) };
    throw new Error(`${f.name}: desteklenmeyen dosya türü (PDF, DOCX, TXT yükleyin)`);
  }
  // Sayfası olmayan metinleri ~3000 karakterlik "sayfalara" böl
  function chunk(t) { const out = []; let cur = ''; for (const para of String(t).split(/\n\s*\n/)) { if ((cur + para).length > 3000 && cur) { out.push(cur.trim()); cur = ''; } cur += para + '\n\n'; } if (cur.trim()) out.push(cur.trim()); return out; }
  async function extractAll(files, msgEl) {
    const out = [];
    for (const f of files) {
      if (msgEl) msgEl.textContent = `${f.name} okunuyor…`;
      const s = await extractFile(f); const chars = s.pages.reduce((n, p) => n + p.length, 0);
      if (chars < 200) throw new Error(`${f.name}: metin bulunamadı. Taranmış (fotoğraf) PDF olabilir; metin seçilebilen bir PDF yükleyin.`);
      out.push(s);
    }
    if (msgEl) msgEl.textContent = '';
    return out;
  }

  /* ---------- giriş ---------- */
  function viewLogin() {
    app.innerHTML = `<h1>Giriş</h1><form class="card" id="f" style="max-width:420px"><label for="pw">Şifre</label><input id="pw" type="password" autocomplete="current-password" required><div class="btns"><button class="primary" type="submit">Giriş yap</button></div><p class="note" id="msg"></p></form>`;
    document.getElementById('f').onsubmit = async e => { e.preventDefault(); try { await api('/api/login', { method: 'POST', body: { password: document.getElementById('pw').value } }); location.hash = '#/'; } catch (err) { document.getElementById('msg').textContent = err.message; } };
  }

  /* ---------- liste ---------- */
  async function viewList() {
    app.innerHTML = `<h1>Yeni eğitim videosu</h1>
      <form class="card" id="nf">
        <label for="t">Konu</label><input id="t" required maxlength="120" placeholder="Örn. Elektrikli araçta AG ve YG sistemleri">
        <label for="b">Ne anlatılsın?</label><textarea id="b" required placeholder="Parçaların görevleri, sık arızalar, belirtiler ve çözümler…"></textarea>
        <div class="grid two"><div><label for="a">Hedef kitle</label><input id="a" placeholder="Meslek lisesi 11. sınıf"></div>
        <div><label for="d">Süre</label><select id="d"><option value="60">60 saniye</option><option value="90" selected>90 saniye</option><option value="150">2,5 dakika</option><option value="240">4 dakika</option></select></div></div>
        <label for="src">Kaynak dosyalar <span class="muted">(isteğe bağlı: MEB modülü, ders kitabı, katalog — PDF, DOCX, TXT)</span></label><input id="src" type="file" multiple accept=".pdf,.docx,.txt,.md">
        <p class="note">Kaynak yüklerseniz içerik bu kaynağa dayanarak yazılır; terimler, değerler ve bağlantılar kaynakla uyumlu olur ve her sahnede kaynak sayfası gösterilir.</p>
        <label for="fm">Video biçimi</label><select id="fm"><option value="dikey">Dikey 9:16 · Instagram Reels, TikTok, YouTube Shorts</option><option value="yatay">Yatay 16:9 · YouTube, sunum, akıllı tahta</option><option value="kare">Kare 1:1 · Instagram ve Facebook gönderisi</option><option value="dikey45">Dikey 4:5 · Instagram ve Facebook akışı</option></select>
        <label for="tn">Anlatım dili</label><select id="tn" required><option value="">Seçin…</option></select>
        <p class="note" id="tnd">İçeriğin hangi üslupla anlatılacağını seçin.</p>
        <div id="tnoWrap" hidden><label for="tno">Anlatım dilini tarif edin</label><input id="tno" maxlength="300" placeholder="Örn. esprili ama saygılı, kısa cümlelerle, futbol benzetmeleri kullanan"></div>
        <div class="btns"><button class="primary" type="submit" id="go">İçeriği hazırla</button></div><p class="note" id="msg"></p>
      </form>
      <h2>Projeler</h2><div class="list" id="list"><div class="empty">Yükleniyor…</div></div>`;
    document.getElementById('nf').onsubmit = async e => {
      e.preventDefault(); const btn = document.getElementById('go'); busy(btn, true); const msg = document.getElementById('msg');
      try {
        const files = [...(document.getElementById('src').files || [])];
        const sources = files.length ? await extractAll(files, msg) : [];
        const p = await api('/api/projects', { method: 'POST', body: { title: t.value, brief: b.value, audience: a.value, target_seconds: +d.value, tone: tn.value, tone_note: tno.value, format: document.getElementById('fm').value, sources } }); location.hash = '#/p/' + p.id; }
      catch (err) { document.getElementById('msg').textContent = err.message; busy(btn, false); }
    };
    const t = document.getElementById('t'), b = document.getElementById('b'), a = document.getElementById('a'), d = document.getElementById('d');
    const tn = document.getElementById('tn'), tno = document.getElementById('tno'), tnd = document.getElementById('tnd'), tnoWrap = document.getElementById('tnoWrap');
    api('/api/tones').then(list => {
      tn.insertAdjacentHTML('beforeend', list.map(x => `<option value="${esc(x.k)}">${esc(x.label)}</option>`).join('') + '<option value="ozel">Diğer (kendim tarif edeyim)</option>');
      tn.onchange = () => { const x = list.find(y => y.k === tn.value); tnd.textContent = x ? x.desc : tn.value === 'ozel' ? 'Aşağıya istediğiniz üslubu kısaca yazın.' : 'İçeriğin hangi üslupla anlatılacağını seçin.'; tnoWrap.hidden = tn.value !== 'ozel'; tno.required = tn.value === 'ozel'; };
    }).catch(() => {});
    try {
      const list = await api('/api/projects');
      document.getElementById('list').innerHTML = list.length ? list.map(p => `<a class="row" href="#/p/${p.id}"><span>${esc(p.title)}</span><span class="pill st-${p.status}">${STATUS[p.status] || p.status}</span></a>`).join('') : '<div class="empty">Henüz proje yok. Yukarıdan ilk konunu yaz.</div>';
    } catch (e) { }
  }

  /* ---------- proje ---------- */
  async function viewProject(id) {
    let d; try { d = await api('/api/projects/' + id); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const p = d.project, step = STEP_OF[p.status] ?? -1;
    const steps = ['İçerik', 'Görseller', 'Ses', 'Video', 'Teslim'].map((s, i) => `<span class="${i < step ? 'done' : i === step ? 'on' : ''}">${i + 1} · ${s}</span>`).join('');
    let body = '';
    const head = `<p class="muted"><a href="#/">← Projeler</a></p><h1>${esc(p.title)}</h1><div class="steps">${steps}</div>`;
    const waitMsg = { content_generating: 'Eğitim içeriği hazırlanıyor, lütfen bekleyiniz. Bu işlem 1–2 dakika sürebilir.', visuals_generating: 'Sahne görselleri hazırlanıyor, lütfen bekleyiniz. 1 dakikalık video için 2–3, 4 dakikalık video için 5–8 dakika sürebilir.', voicing: 'Seslendirme yapılıyor, lütfen bekleyiniz.', rendering: '' };
    if (waitMsg[p.status] !== undefined && p.status !== 'rendering') {
      const g = d.gen, gp = g && g.progress && g.progress.total ? g.progress : null;
      const gline = g ? (g.status === 'queued' ? 'Çalışma başlatılıyor…' : gp ? `${gp.done} / ${gp.total} ${p.status === 'visuals_generating' ? 'sahne hazır' : 'tamamlandı'}` : 'Çalışma sürüyor…') : '';
      const gbar = gp ? `<div class="bar"><i style="width:${Math.round(gp.done / gp.total * 100)}%"></i></div>` : '';
      body = `<div class="card wait"><div class="spin" aria-hidden="true"></div><div style="flex:1"><strong>${STATUS[p.status]}</strong><div class="note">${waitMsg[p.status]} Sayfa kendiliğinden yenilenir.</div>${gline ? `<div class="note"><b>${gline}</b></div>` : ''}${gbar}</div></div>`;
      pollTimer = setTimeout(() => route(), 4000);
    } else if (p.status === 'rendering') {
      const pr = d.job ? d.job.progress : 0;
      body = `<div class="card"><strong>Video üretiliyor</strong><p class="note">Video hazırlanıyor, lütfen bekleyiniz. 1 dakikalık video yaklaşık 4–5, 4 dakikalık video 12–15 dakika sürer; sayfayı kapatabilirsiniz.</p><div class="bar"><i style="width:${pr}%"></i></div><p class="note">%${pr} · ${d.job && d.job.status === 'queued' ? 'başlatılıyor' : 'hazırlanıyor'}</p></div>`;
      pollTimer = setTimeout(() => route(), 6000);
    } else if (p.status === 'content_review') body = contentReview(d);
    else if (p.status === 'visuals_review') body = visualsReview(d);
    else if (p.status === 'delivered') body = delivered(d);
    else if (p.status === 'failed') { const [stage, ...m] = (p.error || '').split('|'); const SN = { content: 'İçerik hazırlama', visuals: 'Görsel hazırlama', voice: 'Seslendirme', render: 'Video üretimi' }; body = `<div class="card err"><strong>${esc(SN[stage] || 'Bir adım')} tamamlanamadı.</strong>\nTekrar deneyebilirsiniz; sorun sürerse yöneticinize bildirin.<details style="margin-top:8px"><summary>Teknik ayrıntı</summary>${esc(m.join('|'))}</details></div><div class="btns"><button class="primary" data-act="retry">Tekrar dene</button><button class="danger" data-act="cancel">Projeyi iptal et</button></div>`; }
    else if (p.status === 'archived') body = `<div class="card">Bu proje iptal edildi.</div>`;
    app.innerHTML = head + body;
    wire(id, d);
  }

  function contentReview(d) {
    const sc = d.content.data.scenes; const chars = sc.reduce((n, s) => n + s.cap.join(' ').length, 0);
    const srcs = d.sources || [];
    const srcLine = s => (s.src && s.src.length) ? `<div class="vis">Kaynak: ${s.src.map(r => `${esc(r.doc)} s.${esc(r.p)}`).join(', ')}</div>` : (srcs.length ? `<div class="vis" style="color:var(--yel)">Kaynakta karşılığı yok (genel bilgi)</div>` : '');
    return `<p class="muted">Sürüm ${d.content.version} · ${sc.length} sahne · tahmini ${Math.round(chars / 14.5)} saniye${srcs.length ? ` · Kaynak: ${srcs.map(x => esc(x.name)).join(', ')}` : ''}</p>
      <div class="grid">${sc.map(s => `<div class="scene"><h3><small>${esc(s.k)} · ${esc(s.ch)}</small>${esc(s.title)}${s.tag ? ` <span class="pill" style="color:var(--red)">${esc(s.tag.text)}</span>` : ''}</h3><ol>${s.cap.map(x => `<li>${esc(x)}</li>`).join('')}</ol>${s.big ? `<div class="big">${esc(s.big.text)}</div>` : ''}<div class="vis">Görsel: ${esc(s.visual && s.visual.subject)}</div>${srcLine(s)}</div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><label for="fb">Düzeltme isteği</label><textarea id="fb" placeholder="Örn. 3. sahneyi kısalt, arızalara bir örnek daha ekle"></textarea>
      <div class="btns"><button class="primary" data-act="content-approve">Onayla, görselleri hazırla</button><button data-act="content-revise">Düzelt</button><button class="danger" data-act="cancel">İptal</button></div></div>
      <div class="card" style="margin-top:12px"><label for="src2">Kaynak ekle</label><input id="src2" type="file" multiple accept=".pdf,.docx,.txt,.md"><div class="btns"><button data-act="add-source">Kaynağı ekle ve içeriği kaynağa göre yeniden yaz</button></div><p class="note" id="srcmsg"></p></div>`;
  }
  function visualsReview(d) {
    return `<div class="player"><div><div class="canvasWrap"><canvas id="cv" width="1080" height="1920" aria-label="Video önizlemesi"></canvas></div>
      <input type="range" class="scrub" id="scrub" min="0" max="1000" value="0" aria-label="Zaman">
      <div class="btns"><button id="pp">Oynat</button></div><div class="chips" id="chips"></div></div>
      <div><div id="scene-warn"></div><div class="card"><p class="note">Sürüm ${d.visuals.version}. Önizlemede ses yok, süreler tahmini; seslendirmeden sonra sahneler sese göre ayarlanır.</p>
      <label for="sk">Hangi sahne?</label><select id="sk"><option value="">Tüm sahneler</option>${d.visuals.scenes.map(s => `<option value="${esc(s.k)}">${esc(s.k)} · ${esc(s.title)}</option>`).join('')}</select>
      <label for="fb">Düzeltme isteği</label><textarea id="fb" placeholder="Örn. motoru daha büyük çiz, etiketler üst üste biniyor"></textarea>
      <div class="btns"><button data-act="visuals-revise">Yeniden çiz</button></div></div>
      <div class="btns"><button class="primary" data-act="visuals-approve">Onayla: seslendir ve videoyu üret</button><button class="danger" data-act="cancel">İptal</button></div></div></div>
      <div id="audit" class="audit"></div>`;
  }

  /* ---------- etkileşimli ders (öğretmen) ---------- */
  const QT = { mcq: 'Çoktan seçmeli', image: 'Görsel seçme', blank: 'Boşluk doldurma', tf: 'Doğru / yanlış', order: 'Sıralama' };
  async function viewLesson(id) {
    let d; try { d = await api(`/api/projects/${id}/quiz`); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const p = d.project, Q = d.quiz;
    let html = `<p class="muted"><a href="#/p/${esc(id)}">← ${esc(p.title)}</a></p><h1>Etkileşimli ders</h1>`;
    if (p.quiz_status === 'generating') { html += `<div class="card wait"><div class="spin" aria-hidden="true"></div><div><strong>Sorular hazırlanıyor</strong><div class="note">Kazanımlar ve bölüm sonu soruları hazırlanıyor, lütfen bekleyiniz. Sayfa kendiliğinden yenilenir.</div></div></div>`; pollTimer = setTimeout(route, 5000); }
    else if (p.quiz_status === 'failed') html += `<div class="card err"><strong>Sorular hazırlanamadı.</strong><details><summary>Teknik ayrıntı</summary>${esc(p.quiz_error || '')}</details><div class="btns"><button class="primary" data-q="gen">Tekrar dene</button></div></div>`;
    if (!Q && p.quiz_status !== 'generating') html += `<div class="card"><p>Bu video için henüz soru hazırlanmadı.</p><div class="btns"><button class="primary" data-q="gen">Soruları hazırla</button></div></div>`;
    if (Q) {
      const link = p.share_id ? `${location.origin}/izle/${p.share_id}` : '';
      html += `<div class="card"><strong>Paylaşım</strong>${p.quiz_published && link ? `<p class="note">Öğrenciler bu bağlantıdan dersi açar; şifre gerekmez.</p><div class="grid two" style="align-items:center"><div><input readonly value="${esc(link)}" id="lnk" onclick="this.select()"><div class="btns"><button data-q="copy">Bağlantıyı kopyala</button><a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Öğrenci gözüyle aç</a><button class="danger" data-q="unpub">Yayından kaldır</button></div></div><div id="qr" style="background:#fff;padding:10px;border-radius:12px;width:max-content"></div></div>` : `<p class="note">Soruları inceleyin; hazır olduğunda yayınlayıp bağlantıyı ya da QR kodu öğrencilerle paylaşın.</p><div class="btns"><button class="primary" data-q="pub">Yayınla ve bağlantı oluştur</button></div>`}</div>`;
      html += `<h2>Kazanımlar</h2><div class="card"><ul class="kz">${Q.kazanimlar.map(k => `<li><b>${esc(k.id)}</b> ${esc(k.text)}</li>`).join('')}</ul></div>`;
      html += `<h2>Bölüm sonu soruları <span class="muted" style="font-size:14px">· sürüm ${d.version}</span></h2>`;
      html += Q.checkpoints.map((c, ci) => `<div class="card" style="margin-bottom:12px"><strong>${ci + 1}. durak · ${esc(c.title || '')}</strong> <span class="muted">(${esc(c.after_k)}. sahneden sonra)</span>${c.questions.map((x, qi) => qCard(x, ci, qi)).join('')}</div>`).join('');
      html += `<div class="card"><label for="qfb">Sorularda değişiklik isteği</label><textarea id="qfb" placeholder="Örn. 2. duraktaki soruyu daha zor yap, daha fazla görsel seçme sorusu ekle"></textarea><div class="btns"><button data-q="regen">Soruları yeniden hazırla</button></div></div>`;
      html += resultsHtml(d);
    }
    app.innerHTML = html;
    if (Q) drawThumbs(id, Q);
    if (p.quiz_published && p.share_id) loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { const el = document.getElementById('qr'); if (el && window.QRCode) new window.QRCode(el, { text: `${location.origin}/izle/${p.share_id}`, width: 150, height: 150 }); }).catch(() => {});
    app.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => {
      const a = b.dataset.q; b.disabled = true;
      try {
        if (a === 'gen') await api(`/api/projects/${id}/quiz/generate`, { method: 'POST', body: {} });
        else if (a === 'regen') { const f = document.getElementById('qfb').value.trim(); if (!f) { b.disabled = false; document.getElementById('qfb').focus(); return; } await api(`/api/projects/${id}/quiz/generate`, { method: 'POST', body: { feedback: f } }); }
        else if (a === 'pub') await api(`/api/projects/${id}/quiz/publish`, { method: 'POST', body: { on: true } });
        else if (a === 'unpub') await api(`/api/projects/${id}/quiz/publish`, { method: 'POST', body: { on: false } });
        else if (a === 'copy') { await navigator.clipboard.writeText(document.getElementById('lnk').value).catch(() => {}); b.textContent = 'Kopyalandı'; setTimeout(() => { b.textContent = 'Bağlantıyı kopyala'; b.disabled = false; }, 1500); return; }
        else if (a === 'del') { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Emin misiniz?'; b.disabled = false; return; } await api(`/api/projects/${id}/quiz/delete`, { method: 'POST', body: { cp: +b.dataset.cp, qi: +b.dataset.qi } }); }
        else if (a === 'csv') { csv(d); b.disabled = false; return; }
        route();
      } catch (e) { alertBox(e.message); b.disabled = false; }
    });
  }
  const loadScriptOnce = src => new Promise((ok, no) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  function qCard(x, ci, qi) {
    const okS = 'style="color:var(--green);font-weight:800"';
    let body = '';
    if (x.type === 'mcq') body = `<p>${esc(x.q)}</p><ol type="A">${x.options.map((o, i) => `<li ${i === x.answer ? okS : ''}>${esc(o)}${i === x.answer ? ' ✓' : ''}</li>`).join('')}</ol>`;
    if (x.type === 'tf') body = `<p>${esc(x.q)}</p><p ${okS}>Cevap: ${x.answer ? 'Doğru' : 'Yanlış'}</p>`;
    if (x.type === 'image') body = `<p>${esc(x.q)}</p><div class="thumbs">${x.options.map((o, i) => `<figure><canvas width="246" height="207" data-k="${esc(o.k)}" data-at="${o.at}"></canvas><figcaption ${i === x.answer ? okS : ''}>${i + 1}. sahne ${esc(o.k)}${i === x.answer ? ' ✓' : ''}</figcaption></figure>`).join('')}</div>`;
    if (x.type === 'blank') { let n = 0; body = `<p>${esc(x.text).replace(/___/g, () => `<b ${okS}>[${esc(x.answer[n++])}]</b>`)}</p><p class="note">Kelime bankası: ${x.bank.map(esc).join(' · ')}</p>`; }
    if (x.type === 'order') body = `<p>${esc(x.q)}</p><ol>${x.items.map(t => `<li>${esc(t)}</li>`).join('')}</ol><p class="note">Öğrenciye karışık sırada gösterilir.</p>`;
    return `<div class="qcard"><div class="aud-head"><span class="pill">${QT[x.type] || x.type}</span><span class="muted">${esc(x.kazanim || '')}</span></div>${body}${x.explain ? `<p class="note">Açıklama: ${esc(x.explain)}</p>` : ''}<div class="btns"><button class="danger" data-q="del" data-cp="${ci}" data-qi="${qi}">Soruyu sil</button></div></div>`;
  }
  async function drawThumbs(id, Q) {
    const cvs = [...app.querySelectorAll('canvas[data-k]')]; if (!cvs.length) return;
    try {
      const bundle = await api(`/api/projects/${id}/bundle?audio=1`); delete bundle.audioUrl;
      const off = document.createElement('canvas'), P = window.EVEngine.createPlayer(off, bundle);
      cvs.forEach(cv => { const r = P.still(cv.dataset.k, +cv.dataset.at); if (r) cv.getContext('2d').drawImage(off, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height); });
    } catch (e) { console.warn(e); }
  }
  function resultsHtml(d) {
    const A = d.attempts || [], fin = A.filter(a => a.summary);
    const kz = (d.quiz && d.quiz.kazanimlar) || [];
    const rate = k => { const xs = fin.map(a => (a.summary.kazanimlar || []).find(z => z.id === k.id)).filter(Boolean); return xs.length ? Math.round(xs.filter(z => z.learned).length / xs.length * 100) : null; };
    let h = `<h2>Öğrenci sonuçları <span class="muted" style="font-size:14px">· ${A.length} başlayan, ${fin.length} tamamlayan</span></h2>`;
    if (!A.length) return h + `<div class="card"><p class="muted">Henüz kimse dersi açmadı.</p></div>`;
    h += `<div class="card"><strong>Kazanım bazında sınıf durumu</strong><ul class="kz">${kz.map(k => { const r = rate(k); return `<li><b>${esc(k.id)}</b> ${esc(k.text)} <span class="pill" style="color:${r == null ? 'var(--muted)' : r >= 70 ? 'var(--green)' : r >= 40 ? 'var(--yel)' : 'var(--red)'}">${r == null ? '—' : '%' + r + ' öğrendi'}</span></li>`; }).join('')}</ul></div>`;
    h += `<div class="card" style="margin-top:12px;overflow:auto"><table class="tbl"><thead><tr><th>Öğrenci</th><th>Sınıf/No</th><th>Tarih</th><th>Puan</th>${kz.map(k => `<th title="${esc(k.text)}">${esc(k.id)}</th>`).join('')}</tr></thead><tbody>${A.map(a => { const s = a.summary; return `<tr><td>${esc(a.student_name)}</td><td>${esc(a.student_class || '')}</td><td>${new Date(a.started_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${s ? '%' + s.pct : '<span class="muted">sürüyor</span>'}</td>${kz.map(k => { const z = s && (s.kazanimlar || []).find(y => y.id === k.id); return `<td>${z ? (z.learned ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--yel)">↻</span>') : ''}</td>`; }).join('')}</tr>`; }).join('')}</tbody></table><div class="btns"><button data-q="csv">CSV indir</button></div><p class="note">✓ öğrendi · ↻ tekrar etmeli (o kazanımın sorularının en az üçte ikisi doğru sayılır).</p></div>`;
    return h;
  }
  function csv(d) {
    const kz = d.quiz.kazanimlar, rows = [['Öğrenci', 'Sınıf/No', 'Başlangıç', 'Bitiş', 'Doğru', 'Soru', 'Puan %', ...kz.map(k => k.id + ' ' + k.text)]];
    for (const a of d.attempts) { const s = a.summary || {}; rows.push([a.student_name, a.student_class || '', a.started_at, a.finished_at || '', s.correct ?? '', s.total ?? '', s.pct ?? '', ...kz.map(k => { const z = (s.kazanimlar || []).find(y => y.id === k.id); return z ? (z.learned ? 'öğrendi' : 'tekrar') : ''; })]); }
    const text = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = 'ders-sonuclari.csv'; a.click();
  }

  /* ---------- teknik denetim paneli ---------- */
  const SEVC = { 'yok': 'var(--green)', 'düşük': 'var(--lv)', 'orta': 'var(--yel)', 'yüksek': 'var(--red)', 'bilinmiyor': 'var(--muted)' };
  const SEVL = { 'yok': 'Sorun yok', 'düşük': 'Küçük', 'orta': 'Orta', 'yüksek': 'Ciddi', 'bilinmiyor': 'Denetlenemedi' };
  async function loadAudit(id) {
    const el = document.getElementById('audit'); if (!el) return;
    let a; try { a = await api(`/api/projects/${id}/audit`); } catch (e) { return; }
    if (!document.getElementById('audit')) return;
    const rows = a.titles.map(t => ({ ...t, r: a.scenes[t.k] }));
    const done = rows.filter(x => x.r);
    const cnt = s => done.filter(x => x.r.severity === s).length;
    let head = '';
    if (a.status === 'running') { const p = a.progress && a.progress.total ? a.progress : null; head = `<div class="card wait"><div class="spin" aria-hidden="true"></div><div style="flex:1"><strong>Teknik denetim yapılıyor</strong><div class="note">Her sahne öğretmen gözüyle kontrol ediliyor, lütfen bekleyiniz. Bu sırada önizlemeyi inceleyebilirsiniz.</div>${p ? `<div class="note"><b>${p.done} / ${p.total} sahne denetlendi</b></div><div class="bar"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></div>` : ''}</div></div>`; setTimeout(() => loadAudit(id), 6000); }
    else if (a.status === 'failed') head = `<div class="card err">Teknik denetim tamamlanamadı.<details><summary>Teknik ayrıntı</summary>${esc(a.error || '')}</details><div class="btns"><button data-aud="rerun">Denetimi yeniden başlat</button></div></div>`;
    else if (a.status === 'none') head = `<div class="card"><strong>Teknik denetim</strong><p class="note">Bu sürüm için denetim yapılmamış.</p><div class="btns"><button data-aud="rerun">Denetimi başlat</button></div></div>`;
    if (done.length) {
      const bad = done.filter(x => ['orta', 'yüksek', 'düşük'].includes(x.r.severity) && (x.r.fix_note || (x.r.issues || []).length));
      head += `<div class="card"><strong>Teknik denetim raporu</strong><p class="note">${done.length} sahne denetlendi · <b style="color:var(--red)">${cnt('yüksek')} ciddi</b> · <b style="color:var(--yel)">${cnt('orta')} orta</b> · ${cnt('düşük')} küçük · <b style="color:var(--green)">${cnt('yok')} sorunsuz</b></p>
        ${bad.length ? `<div class="btns"><button class="primary" data-aud="fixall">Sorunlu ${bad.length} sahneyi önerilerle düzelt</button>${a.status !== 'running' ? '<button data-aud="rerun">Yeniden denetle</button>' : ''}</div>` : (a.status === 'done' ? '<div class="btns"><button data-aud="rerun">Yeniden denetle</button></div>' : '')}</div>`;
    }
    const cards = rows.map(x => {
      const r = x.r;
      const img = r && r.sheetUrl ? `<img loading="lazy" src="${esc(r.sheetUrl)}" alt="Sahne ${esc(x.k)} kareleri">` : `<div class="noimg">${a.status === 'running' ? 'Bekleniyor…' : 'Görüntü yok'}</div>`;
      const badge = r ? `<span class="sev" style="border-color:${SEVC[r.severity] || 'var(--muted)'};color:${SEVC[r.severity] || 'var(--muted)'}">${SEVL[r.severity] || esc(r.severity)}</span>` : '';
      const issues = r && r.issues && r.issues.length ? `<ul>${r.issues.map(i => `<li><b>${esc(i.type)}:</b> ${esc(i.detail)}${i.fix ? `<br><span class="muted">Öneri: ${esc(i.fix)}</span>` : ''}</li>`).join('')}</ul>` : '';
      const fix = r && r.severity !== 'yok' && (r.fix_note || (r.issues || []).length) ? `<div class="btns"><button data-aud="fix" data-k="${esc(x.k)}">Bu sahneyi öneriyle yeniden çiz</button></div>` : '';
      return `<div class="aud-scene"><div class="aud-head"><b>${esc(x.k)} · ${esc(x.title)}</b>${badge}</div>${img}${r && r.summary ? `<p class="note">${esc(r.summary)}</p>` : ''}${issues}${fix}</div>`;
    }).join('');
    el.innerHTML = `<h2>Toplu sahne görünümü ve teknik denetim</h2>${head}<div class="aud-grid">${cards}</div>`;
    el.querySelectorAll('[data-aud]').forEach(btn => btn.onclick = async () => {
      const act = btn.dataset.aud; btn.disabled = true;
      try {
        if (act === 'rerun') await api(`/api/projects/${id}/audit`, { method: 'POST' });
        else if (act === 'fix') await api(`/api/projects/${id}/visuals/fix`, { method: 'POST', body: { ks: [btn.dataset.k] } });
        else if (act === 'fixall') await api(`/api/projects/${id}/visuals/fix`, { method: 'POST', body: {} });
        route();
      } catch (e) { alertBox(e.message); btn.disabled = false; }
    });
  }
  const ASPECT = { dikey: '9/16', yatay: '16/9', kare: '1/1', dikey45: '4/5' };
  function delivered(d) {
    const vids = d.videos || [], F = d.formats || {};
    const others = Object.keys(F).filter(k => !vids.some(v => v.format === k));
    const links = vids.map(v => `<a class="btn" href="${esc(v.url)}" download>${esc(v.label)} indir</a>`).join('');
    const more = others.length ? `<label for="nf2">Başka biçimde de üret</label><select id="nf2">${others.map(k => `<option value="${esc(k)}">${esc(F[k])}</option>`).join('')}</select><div class="btns"><button data-act="render-format">Bu biçimde üret</button></div><p class="note">İçerik, görseller ve ses aynı kalır; yalnızca video yeni ölçüde hazırlanır.</p>` : '';
    return `<div class="player"><div><div class="canvasWrap" style="aspect-ratio:${ASPECT[d.mainFormat] || '9/16'}"><video controls playsinline src="${esc(d.videoUrl)}"></video></div></div>
      <div><div class="card"><strong>Video hazır</strong><p class="note">60 FPS, seslendirme gömülü. İndirme bağlantıları 24 saat geçerlidir; sayfayı yenileyince yenisi oluşur.</p>
      <div class="btns">${links}</div>${more}
      <div class="btns"><button data-act="reopen">Bir sahneyi düzelt</button><button data-act="revoice">Yeniden seslendir</button></div></div>
      <div class="card" style="margin-top:12px"><strong>Etkileşimli ders</strong><p class="note">Video bölüm sonlarında durup öğrenciye soru sorar; sonuçlar kazanım bazında size raporlanır.${d.quizStatus === 'generating' ? ' Sorular hazırlanıyor…' : d.quizStatus === 'ready' ? ' Sorular hazır.' : ''}</p><div class="btns"><a class="btn primary" href="#/p/${esc(d.project.id)}/ders">Soruları ve sonuçları aç</a></div></div></div></div>`;
  }

  async function startPreview(id) {
    const cv = document.getElementById('cv'); if (!cv) return;
    const bundle = await api('/api/projects/' + id + '/bundle');
    window.__EV_PREVIEW = true; window.EVEngine.errors = {};
    // Ön kontrol: her sahneyi ekran dışında birkaç anda çizip hata veren sahneleri bul
    try {
      const off = document.createElement('canvas'), Q = window.EVEngine.createPlayer(off, bundle);
      Q.scenes.forEach(s => { for (let j = 1; j <= 8; j++) Q.render(s.s + s.dur * j / 9); });
    } catch (e) { console.error(e); }
    const bad = Object.keys(window.EVEngine.errors);
    const warnEl = document.getElementById('scene-warn');
    if (warnEl) warnEl.innerHTML = bad.length ? `<div class="card err" style="margin:10px 0">Çizim hatası olan sahne: <b>${bad.map(esc).join(', ')}</b>. Onaylamadan önce bu sahneyi seçip “Yeniden çiz” ile düzelttir (ör. not: “çizim hatasını düzelt”).</div>` : '';
    const P = window.EVEngine.createPlayer(cv, bundle); if (cv.parentElement) cv.parentElement.style.aspectRatio = `${P.width}/${P.height}`; let t = 0, playing = false, last = null, raf = 0;
    const scrub = document.getElementById('scrub'), pp = document.getElementById('pp');
    const chips = document.getElementById('chips'); chips.innerHTML = P.scenes.map((s, i) => `<button data-i="${i}">${esc(s.k)}</button>`).join('');
    const sk = document.getElementById('sk');
    function frame(ts) { if (playing && last != null) { t += (ts - last) / 1000; if (t >= P.total) { t = P.total - .001; playing = false; pp.textContent = 'Oynat'; } } last = ts; const si = P.render(t); scrub.value = Math.round(t / P.total * 1000); [...chips.children].forEach((b, i) => b.classList.toggle('on', i === si)); raf = requestAnimationFrame(frame); }
    document.fonts.ready.then(() => { raf = requestAnimationFrame(frame); });
    pp.onclick = () => { playing = !playing; if (playing && t >= P.total - .01) t = 0; pp.textContent = playing ? 'Duraklat' : 'Oynat'; };
    scrub.oninput = () => { t = scrub.value / 1000 * P.total; };
    chips.onclick = e => { const i = e.target.dataset.i; if (i == null) return; t = P.scenes[i].s + .65; if (sk) sk.value = P.scenes[i].k; };
    player = { stop: () => cancelAnimationFrame(raf) };
  }

  function wire(id, d) {
    if (d.project.status === 'visuals_review') { startPreview(id).catch(e => console.error(e)); loadAudit(id); }
    app.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
      const act = btn.dataset.act, fb = document.getElementById('fb');
      if ((act === 'content-revise' || act === 'visuals-revise') && !(fb && fb.value.trim())) { fb.focus(); fb.placeholder = 'Önce ne değişsin, onu yaz'; return; }
      if (act === 'add-source') {
        const files = [...(document.getElementById('src2').files || [])], m = document.getElementById('srcmsg'); if (!files.length) { m.textContent = 'Önce dosya seçin'; return; }
        busy(btn, true);
        try { const sources = await extractAll(files, m); await api(`/api/projects/${id}/sources`, { method: 'POST', body: { sources } }); await api(`/api/projects/${id}/content/revise`, { method: 'POST', body: { feedback: 'Yeni eklenen kaynak dosyalarını kullanarak içeriği kaynağa dayandır: terimleri, değerleri ve sıralamayı kaynağa göre düzelt, her sahneye kaynak sayfalarını (src) yaz.' } }); route(); }
        catch (e) { m.textContent = e.message; busy(btn, false); }
        return;
      }
      if (act === 'revoice' && !btn.dataset.sure) { btn.dataset.sure = 1; btn.textContent = 'Güncel sesle yeniden üretilsin mi? Tekrar bas'; return; }
      if (act === 'cancel' && !btn.dataset.sure) { btn.dataset.sure = 1; btn.textContent = 'Emin misin? Tekrar bas'; return; }
      busy(btn, true); app.querySelectorAll('[data-act]').forEach(b => b.disabled = true);
      const map = { 'content-approve': ['content/approve'], 'content-revise': ['content/revise', { feedback: fb && fb.value }], 'visuals-approve': ['visuals/approve'], 'visuals-revise': ['visuals/revise', (() => { const k = (document.getElementById('sk') || {}).value || null, er = window.EVEngine && window.EVEngine.errors || {}; let f = fb && fb.value; if (k && er[k]) f += ` (Tarayıcıdaki çizim hatası: ${er[k]})`; return { feedback: f, k }; })()], cancel: ['cancel'], retry: ['retry'], reopen: ['reopen'], revoice: ['visuals/approve'], 'render-format': ['render', { format: (document.getElementById('nf2') || {}).value }] }[act];
      try { await api(`/api/projects/${id}/${map[0]}`, { method: 'POST', body: map[1] || {} }); route(); } catch (e) { alertBox(e.message); busy(btn, false); app.querySelectorAll('[data-act]').forEach(b => b.disabled = false); }
    });
  }
  function alertBox(m) { const el = document.createElement('div'); el.className = 'card err'; el.style.marginTop = '12px'; el.textContent = m; app.appendChild(el); }

  async function route() {
    stop();
    const h = location.hash || '#/';
    if (h === '#/login') return viewLogin();
    const me = await api('/api/me').catch(() => ({ ok: false }));
    if (!me.ok) { location.hash = '#/login'; return viewLogin(); }
    const m = h.match(/^#\/p\/([\w-]+)(\/ders)?/);
    return m ? (m[2] ? viewLesson(m[1]) : viewProject(m[1])) : viewList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
