(() => {
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const STATUS = { draft: 'Taslak', content_generating: 'İçerik yazılıyor', content_review: 'İçerik onayı bekliyor', visuals_generating: 'Görseller çiziliyor', visuals_review: 'Görsel onayı bekliyor', voicing: 'Seslendiriliyor', rendering: 'Video üretiliyor', delivered: 'Teslim edildi', failed: 'Hata', archived: 'İptal edildi' };
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
        <div class="btns"><button class="primary" type="submit" id="go">İçeriği hazırla</button></div><p class="note" id="msg"></p>
      </form>
      <h2>Projeler</h2><div class="list" id="list"><div class="empty">Yükleniyor…</div></div>`;
    document.getElementById('nf').onsubmit = async e => {
      e.preventDefault(); const btn = document.getElementById('go'); busy(btn, true);
      try { const p = await api('/api/projects', { method: 'POST', body: { title: t.value, brief: b.value, audience: a.value, target_seconds: +d.value } }); location.hash = '#/p/' + p.id; }
      catch (err) { document.getElementById('msg').textContent = err.message; busy(btn, false); }
    };
    const t = document.getElementById('t'), b = document.getElementById('b'), a = document.getElementById('a'), d = document.getElementById('d');
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
    const waitMsg = { content_generating: 'Claude içeriği yazıyor. Bu 1–2 dakika sürebilir.', visuals_generating: 'Sahne çizimleri hazırlanıyor. 1 dakikalık video için 2–3, 4 dakikalık video için 6–9 dakika sürebilir.', voicing: 'ElevenLabs seslendiriyor.', rendering: '' };
    if (waitMsg[p.status] !== undefined && p.status !== 'rendering') {
      const g = d.gen, gp = g && g.progress && g.progress.total ? g.progress : null;
      const gline = g ? (g.status === 'queued' ? 'GitHub işi sırada, birazdan başlayacak.' : gp ? `${gp.done} / ${gp.total} ${p.status === 'visuals_generating' ? 'sahne çizildi' : 'tamamlandı'}` : 'Claude çalışıyor…') : '';
      const gbar = gp ? `<div class="bar"><i style="width:${Math.round(gp.done / gp.total * 100)}%"></i></div>` : '';
      body = `<div class="card wait"><div class="spin" aria-hidden="true"></div><div style="flex:1"><strong>${STATUS[p.status]}</strong><div class="note">${waitMsg[p.status]} Sayfa kendiliğinden yenilenir.</div>${gline ? `<div class="note"><b>${gline}</b></div>` : ''}${gbar}</div></div>`;
      pollTimer = setTimeout(() => route(), 4000);
    } else if (p.status === 'rendering') {
      const pr = d.job ? d.job.progress : 0;
      body = `<div class="card"><strong>Video üretiliyor</strong><p class="note">Kareler GitHub Actions'ta çiziliyor. 80 saniyelik video yaklaşık 7–10 dakika sürer; sayfayı kapatabilirsin.</p><div class="bar"><i style="width:${pr}%"></i></div><p class="note">%${pr} · ${d.job ? (d.job.status === 'queued' ? 'sırada' : 'çiziliyor') : ''}</p></div>`;
      pollTimer = setTimeout(() => route(), 6000);
    } else if (p.status === 'content_review') body = contentReview(d);
    else if (p.status === 'visuals_review') body = visualsReview(d);
    else if (p.status === 'delivered') body = delivered(d);
    else if (p.status === 'failed') { const [stage, ...m] = (p.error || '').split('|'); body = `<div class="card err"><strong>Bir adım başarısız oldu (${esc(stage)})</strong>\n${esc(m.join('|'))}</div><div class="btns"><button class="primary" data-act="retry">Tekrar dene</button><button class="danger" data-act="cancel">Projeyi iptal et</button></div>`; }
    else if (p.status === 'archived') body = `<div class="card">Bu proje iptal edildi.</div>`;
    app.innerHTML = head + body;
    wire(id, d);
  }

  function contentReview(d) {
    const sc = d.content.data.scenes; const chars = sc.reduce((n, s) => n + s.cap.join(' ').length, 0);
    return `<p class="muted">Sürüm ${d.content.version} · ${sc.length} sahne · tahmini ${Math.round(chars / 14.5)} saniye</p>
      <div class="grid">${sc.map(s => `<div class="scene"><h3><small>${esc(s.k)} · ${esc(s.ch)}</small>${esc(s.title)}${s.tag ? ` <span class="pill" style="color:var(--red)">${esc(s.tag.text)}</span>` : ''}</h3><ol>${s.cap.map(x => `<li>${esc(x)}</li>`).join('')}</ol>${s.big ? `<div class="big">${esc(s.big.text)}</div>` : ''}<div class="vis">Görsel: ${esc(s.visual && s.visual.subject)}</div></div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><label for="fb">Düzeltme isteği</label><textarea id="fb" placeholder="Örn. 3. sahneyi kısalt, arızalara bir örnek daha ekle"></textarea>
      <div class="btns"><button class="primary" data-act="content-approve">Onayla, görselleri hazırla</button><button data-act="content-revise">Düzelt</button><button class="danger" data-act="cancel">İptal</button></div></div>`;
  }
  function visualsReview(d) {
    return `<div class="player"><div><div class="canvasWrap"><canvas id="cv" width="1080" height="1920" aria-label="Video önizlemesi"></canvas></div>
      <input type="range" class="scrub" id="scrub" min="0" max="1000" value="0" aria-label="Zaman">
      <div class="btns"><button id="pp">Oynat</button></div><div class="chips" id="chips"></div></div>
      <div><div class="card"><p class="note">Sürüm ${d.visuals.version}. Önizlemede ses yok, süreler tahmini; seslendirmeden sonra sahneler sese göre ayarlanır.</p>
      <label for="sk">Hangi sahne?</label><select id="sk"><option value="">Tüm sahneler</option>${d.visuals.scenes.map(s => `<option value="${esc(s.k)}">${esc(s.k)} · ${esc(s.title)}</option>`).join('')}</select>
      <label for="fb">Düzeltme isteği</label><textarea id="fb" placeholder="Örn. motoru daha büyük çiz, etiketler üst üste biniyor"></textarea>
      <div class="btns"><button data-act="visuals-revise">Yeniden çiz</button></div></div>
      <div class="btns"><button class="primary" data-act="visuals-approve">Onayla: seslendir ve videoyu üret</button><button class="danger" data-act="cancel">İptal</button></div></div></div>`;
  }
  function delivered(d) {
    return `<div class="player"><div><div class="canvasWrap"><video controls playsinline src="${esc(d.videoUrl)}"></video></div></div>
      <div><div class="card"><strong>Video hazır</strong><p class="note">1080×1920, 60 FPS, seslendirme gömülü. İndirme bağlantısı 24 saat geçerlidir; sayfayı yenileyince yenisi oluşur.</p>
      <div class="btns"><a class="btn" href="${esc(d.videoUrl)}" download>MP4 indir</a><button data-act="reopen">Bir sahneyi düzelt</button><button data-act="revoice">Yeniden seslendir</button></div></div></div></div>`;
  }

  async function startPreview(id) {
    const cv = document.getElementById('cv'); if (!cv) return;
    const bundle = await api('/api/projects/' + id + '/bundle');
    const P = window.EVEngine.createPlayer(cv, bundle); let t = 0, playing = false, last = null, raf = 0;
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
    if (d.project.status === 'visuals_review') startPreview(id).catch(e => console.error(e));
    app.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
      const act = btn.dataset.act, fb = document.getElementById('fb');
      if ((act === 'content-revise' || act === 'visuals-revise') && !(fb && fb.value.trim())) { fb.focus(); fb.placeholder = 'Önce ne değişsin, onu yaz'; return; }
      if (act === 'revoice' && !btn.dataset.sure) { btn.dataset.sure = 1; btn.textContent = 'Güncel sesle yeniden üretilsin mi? Tekrar bas'; return; }
      if (act === 'cancel' && !btn.dataset.sure) { btn.dataset.sure = 1; btn.textContent = 'Emin misin? Tekrar bas'; return; }
      busy(btn, true); app.querySelectorAll('[data-act]').forEach(b => b.disabled = true);
      const map = { 'content-approve': ['content/approve'], 'content-revise': ['content/revise', { feedback: fb && fb.value }], 'visuals-approve': ['visuals/approve'], 'visuals-revise': ['visuals/revise', { feedback: fb && fb.value, k: (document.getElementById('sk') || {}).value || null }], cancel: ['cancel'], retry: ['retry'], reopen: ['reopen'], revoice: ['visuals/approve'] }[act];
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
    const m = h.match(/^#\/p\/([\w-]+)/);
    return m ? viewProject(m[1]) : viewList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
