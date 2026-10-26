(() => {
  const app = document.getElementById('app');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const STATUS = { queued: 'Sırada', draft: 'Taslak', content_generating: 'İçerik hazırlanıyor', content_review: 'İçerik onayı bekliyor', visuals_generating: 'Görseller hazırlanıyor', visuals_review: 'Görsel onayı bekliyor', voicing: 'Seslendiriliyor', rendering: 'Video üretiliyor', delivered: 'Teslim edildi', failed: 'Hata', archived: 'İptal edildi' };
  const STEP_OF = { content_generating: 0, content_review: 0, visuals_generating: 1, visuals_review: 1, voicing: 2, rendering: 3, delivered: 4 };
  let pollTimer = null, player = null;

  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.startsWith('/api/auth/')) { location.hash = '#/giris?r=' + encodeURIComponent(location.hash || '#/'); throw new Error('Giriş gerekli'); }
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

  function setSub(t) { const el = document.querySelector('.top .sub'); if (el) el.textContent = t; }

  /* ---------- liste ---------- */
  // Öğretmen ana sayfası: adım adım yeni video + videolarım
  const FMT_OPTS = [['yatay', 'Yatay 16:9', 'YouTube, akıllı tahta, sunum', '16/9'], ['dikey', 'Dikey 9:16', 'Reels, TikTok, Shorts', '9/16'], ['kare', 'Kare 1:1', 'Instagram ve Facebook gönderisi', '1/1'], ['dikey45', 'Dikey 4:5', 'Instagram ve Facebook akışı', '4/5']];
  const STY_OPTS = [['teknik', 'Teknik', 'Koyu zemin, derinlikli, ayrıntılı çizim'], ['sade', 'Sade anlatım', 'Açık zemin, düz renk, anahtar kelimeli editoryal anlatım'], ['hikaye', 'Hikâye', 'Bölümlü özgün öykü, düz çizim, vurgulu altyazı'], ['nasil', 'Nasıl çalışır', 'Röntgen/kesit, hızlı çekim, sayaç, vurgu etiketleri'], ['tarih', 'Çizgi tarih', 'Çizgi karakterler, harita, çizgi roman başlıkları'], ['deney', 'Ya olsaydı', 'Düşünce deneyi: canlı sayaç, hesapla kanıt, seri kapanışı'], ['sinema', 'Sinematik', 'Gerçekçi görseller, kelime kelime altyazı (Reels/Shorts)']];
  const CINE_OPTS = [['soru', 'Soru‑cevap', 'Soru kartı, 3‑2‑1 geri sayım, cevap'], ['algi', 'Dikkat / algı oyunu', 'Gizli motif, sonunda bilimsel açıklama'], ['anlatim', 'Sinematik anlatım', 'Konuyu gerçekçi sahnelerle anlatır']];
  const DUR_OPTS = [[60, '1 dk'], [90, '1,5 dk'], [150, '2,5 dk'], [240, '4 dk']];
  const SPD_OPTS = [['yavas', 'Yavaş', 'ders dinler gibi'], ['normal', 'Normal', 'önerilen'], ['hizli', 'Hızlı', 'tekrar ve özet']];
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
  const radios = (name, opts, cur, render) => opts.map(o => `<label class="tile"><input type="radio" name="${name}" value="${esc(o[0])}" ${String(o[0]) === String(cur) ? 'checked' : ''}>${render(o)}</label>`).join('');
  async function viewList() {
    setSub('Konu yaz · onayla · video al');
    const P = ME.plan; const quota = P ? `<p class="note">${esc(P.plan)} paketi · bu ay ${ME.used} / ${P.limits.videos_per_month} video · <a href="#/paketim">Paketim</a></p>` : `<div class="card" style="border-color:rgba(255,201,60,.5);margin-bottom:12px">Video üretmek için etkin bir paketiniz yok. <a href="#/paketim">Paket seçin</a>.</div>`;
    const def = { tone: lsGet('v_tone', ''), fmt: lsGet('v_fmt', 'yatay'), dur: lsGet('v_dur', '150'), spd: lsGet('v_spd', 'normal'), sty: lsGet('v_sty', 'teknik'), cm: lsGet('v_cm', 'soru') };
    app.innerHTML = `<div id="guide"></div><div id="waiting"></div>
      <h1>Yeni eğitim videosu</h1>${quota}
      <form class="card wiz" id="nf" novalidate>
        <ol class="wsteps" aria-label="Adımlar"><li data-i="1" class="on">Konu</li><li data-i="2">Anlatım</li><li data-i="3">Biçim</li><li data-i="4">Kaynak</li></ol>
        <section class="wstep" data-s="1">
          <label for="t">Konu</label><input id="t" maxlength="120" placeholder="Örn. Elektrikli araçta AG ve YG sistemleri" autocomplete="off">
          <label for="b">Ne anlatılsın?</label><textarea id="b" placeholder="Parçaların görevleri, sık arızalar, belirtiler ve çözümler…"></textarea>
          <label for="a">Hedef kitle <span class="muted opt">(isteğe bağlı)</span></label><input id="a" placeholder="Meslek lisesi 11. sınıf">
        </section>
        <section class="wstep" data-s="2" hidden>
          <label>Anlatım dili</label><div class="tiles" id="tones"><div class="empty">Yükleniyor…</div></div>
          <div id="tnoWrap" hidden><label for="tno">Anlatım dilini tarif edin</label><input id="tno" maxlength="300" placeholder="Örn. esprili ama saygılı, kısa cümlelerle"></div>
          <label>Anlatım hızı</label><div class="tiles row3">${radios('spd', SPD_OPTS, def.spd, o => `<b>${o[1]}</b><span>${o[2]}</span>`)}</div>
        </section>
        <section class="wstep" data-s="3" hidden>
          <label>Görsel stil</label><div class="tiles">${radios('sty', STY_OPTS, def.sty, o => `<i class="stprev st-${o[0]}" aria-hidden="true"><b></b><i></i><em></em></i><b>${o[1]}</b><span>${o[2]}</span>`)}</div>
          <div id="hkWrap" hidden><label>Seri</label><div class="tiles row3">${radios('hkm', [['new', 'Yeni seri', 'İlk bölüm'], ['continue', 'Seriye devam', 'Sonraki bölüm']], 'new', o => `<b>${o[1]}</b><span>${o[2]}</span>`)}</div>
            <div id="hkNew"><label for="hkt">Seri adı</label><input id="hkt" maxlength="60" placeholder="Ör. Gezgin Tohum"></div>
            <div id="hkCont" hidden><label for="hks">Hangi seri?</label><select id="hks"><option value="">Yükleniyor…</option></select></div>
            <p class="note">Konu ve ayrıntıya öğretilecek bilgiyi yazın (ör. "Güneş Sistemi'nde yaşanabilir bölge, gezegenlerin atmosferi"). Claude bunu özgün bir öykünün içine yerleştirir. Devam bölümlerinde karakterler, dünya ve olaylar seri defterinden hatırlanır.</p></div>
          <div id="nsWrap" hidden><label for="nhan">Hesap adı <span class="muted opt">(isteğe bağlı; kapanışta görünür, ör. @otomotivatolyesi)</span></label><input id="nhan" maxlength="30" placeholder="@hesabiniz" value="${esc(lsGet('v_nhan', ''))}">
            <label for="ncta">Kapanış çağrısı</label><input id="ncta" maxlength="30" value="${esc(lsGet('v_ncta', 'Arkadaşına gönder'))}">
            <p class="note">Konuyu "Debriyaj nasıl çalışır?" gibi yazın. Her cümle ayrı bir çekimle anlatılır: dış görünüş → röntgen → parçaya yakınlaşma → değerler → sık yapılan hata. Sosyal medya için Dikey 9:16, 1 dk önerilir.</p></div>
          <div id="thWrap" hidden><label for="tser">Seri adı <span class="muted opt">(isteğe bağlı; ilk sahnede künye olarak görünür)</span></label><input id="tser" maxlength="30" placeholder="Dünya Tarihi" value="${esc(lsGet('v_tser', ''))}">
            <label for="tep">Bölüm <span class="muted opt">(isteğe bağlı)</span></label><input id="tep" maxlength="20" placeholder="Bölüm 1">
            <label for="tnext">Sıradaki bölüm konusu <span class="muted opt">(isteğe bağlı; boş bırakılırsa önerilir)</span></label><input id="tnext" maxlength="80" placeholder="Mısır'da yazı: hiyeroglif">
            <p class="note">Konu temsili karakterlerle küçük bir hikâyeye dönüştürülür: harita, dönem etiketi, çizgi roman başlıkları. Tanınmış tarihî kişilere uydurma söz yazılmaz. Sosyal medya için Dikey 9:16, 1–1,5 dk önerilir.</p></div>
          <div id="dnWrap" hidden><label for="dser">Seri adı <span class="muted opt">(sağ üstte ve kapanışta görünür)</span></label><input id="dser" maxlength="30" value="${esc(lsGet('v_dser', 'Ya Olsaydı'))}">
            <label for="dnext">Sıradaki bölüm <span class="muted opt">(isteğe bağlı; boş bırakılırsa önerilir)</span></label><input id="dnext" maxlength="80" placeholder="Ya bütün buzullar erimiş olsaydı?">
            <p class="note">Konuyu "Ya … olsaydı?" sorusu gibi yazın: “Ya Dünya'yı saran ipi 1 metre uzatsaydık?”. Zamanla biriken olaylarda (“Ya bir yıl hiç durmadan yağmur yağsaydı?”) video tek bir mekânda zaman atlamalı anlatılır: tarih tabelası, yükselen su, yağmur/kar/sis. Sosyal medya için en uygun biçim: Dikey 9:16, 1 dk.</p></div>
          <div id="cmWrap" hidden><label>Sinematik kalıp</label><div class="tiles row3">${radios('cm', CINE_OPTS, def.cm, o => `<b>${o[1]}</b><span>${o[2]}</span>`)}</div>
            <p class="note" id="cmNote">Her sahne için gerçekçi görsel üretilir (video başına yaklaşık 0,15–0,40 $ ek görsel maliyeti). Sosyal medya için en uygun biçim: Dikey 9:16, 1 dk.</p></div>
          <label>Video biçimi</label><div class="tiles">${radios('fmt', FMT_OPTS, def.fmt, o => `<i class="ar" style="aspect-ratio:${o[3]}"></i><b>${o[1]}</b><span>${o[2]}</span>`)}</div>
          <label>Süre</label><div class="tiles row4">${radios('dur', DUR_OPTS, def.dur, o => `<b>${o[1]}</b>`)}</div>
          <label>Logo</label><div class="tiles row3">${radios('lgm', [['default', 'Varsayılan logom', 'Profilinizdeki logo'], ['custom', 'Bu videoya özel', 'Dosya seçin'], ['none', 'Logo yok', '']], 'default', o => `<b>${o[1]}</b>${o[2] ? `<span>${o[2]}</span>` : ''}`)}</div>
          <div id="wlg" hidden>${logoFields('wl', null)}</div>
        </section>
        <section class="wstep" data-s="4" hidden>
          <label for="src">Kaynak dosyalar <span class="muted opt">(isteğe bağlı)</span></label><input id="src" type="file" multiple accept=".pdf,.docx,.txt,.md">
          <p class="note">MEB modülü, ders kitabı ya da katalog yüklerseniz içerik bu kaynağa dayanarak yazılır; terimler ve değerler kaynakla uyumlu olur.</p>
          <div class="summary" id="sum"></div>
        </section>
        <div class="wnav"><button type="button" id="wback" hidden>Geri</button><button type="button" class="primary" id="wnext">Devam</button><button class="primary" type="submit" id="go" hidden>İçeriği hazırla</button></div>
        <p class="note err-t" id="msg"></p>
      </form>
      <div class="vhead"><h2>${ME.user.role === 'admin' ? 'Tüm videolar' : 'Videolarım'}</h2><div class="chips" id="vf"><button type="button" data-f="" class="on">Tümü</button><button type="button" data-f="wait">Onayımı bekleyen</button><button type="button" data-f="work">Hazırlanan</button><button type="button" data-f="done">Teslim edilen</button></div></div>
      <div class="list" id="list"><div class="empty">Yükleniyor…</div></div>`;
    const f = document.getElementById('nf'), msg = document.getElementById('msg');
    let step = 1, tones = [];
    const val = n => (f.querySelector(`input[name="${n}"]:checked`) || {}).value;
    const show = n => {
      step = n; f.querySelectorAll('.wstep').forEach(s => s.hidden = +s.dataset.s !== n);
      f.querySelectorAll('.wsteps li').forEach(li => { const i = +li.dataset.i; li.className = i === n ? 'on' : i < n ? 'done' : ''; });
      document.getElementById('wback').hidden = n === 1; document.getElementById('wnext').hidden = n === 4; document.getElementById('go').hidden = n !== 4; msg.textContent = '';
      if (n === 4) { const tx = tones.find(x => x.k === val('tone')); const fo = FMT_OPTS.find(o => o[0] === val('fmt')); const du = DUR_OPTS.find(o => String(o[0]) === val('dur')); const sp = SPD_OPTS.find(o => o[0] === val('spd')); const sy = STY_OPTS.find(o => o[0] === val('sty')); const cmo = val('sty') === 'sinema' ? CINE_OPTS.find(o => o[0] === val('cm')) : null;
        document.getElementById('sum').innerHTML = `<b>Özet</b><ul><li>${esc(document.getElementById('t').value)}</li><li>${esc(val('tone') === 'ozel' ? 'Özel anlatım' : tx ? tx.label : '')} · ${esc(sp ? sp[1] : '')} hız</li><li>${esc(fo ? fo[1] : '')} · ${esc(du ? du[1] : '')} · ${esc(sy ? sy[1] : '')} stil${cmo ? ' · ' + esc(cmo[1]) : ''}</li></ul>`; }
      f.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    const check = n => {
      if (n === 1) { if (document.getElementById('t').value.trim().length < 3) return 'Konuyu yazın'; if (document.getElementById('b').value.trim().length < 10) return 'Ne anlatılacağını birkaç kelimeyle yazın'; }
      if (n === 3 && val('sty') === 'hikaye' && val('hkm') === 'continue' && !document.getElementById('hks').value) return 'Devam edilecek seriyi seçin (henüz seriniz yoksa Yeni seri seçin)';
      if (n === 3 && val('lgm') === 'custom' && !wlst.data) return 'Bu videoya özel logo için bir dosya seçin (ya da Varsayılan logom / Logo yok seçin)';
      if (n === 2) { if (!val('tone')) return 'Bir anlatım dili seçin'; if (val('tone') === 'ozel' && document.getElementById('tno').value.trim().length < 3) return 'Anlatım dilini kısaca tarif edin'; }
      return '';
    };
    // görsel servisi bağlı değilse sinematik seçenek pasif (seçilirse görsel adımında takılırdı)
    if (!ME.cine) { const r = f.querySelector('input[name="sty"][value="sinema"]'); if (r) { if (r.checked) f.querySelector('input[name="sty"][value="teknik"]').checked = true; r.disabled = true; const t = r.closest('.tile'); t.classList.add('off'); t.title = 'Görsel servisi bağlanınca açılır'; const sp = t.querySelector('span'); if (sp) sp.textContent = 'Yakında: görsel servisi bağlanınca açılır'; } }
    const wlst = {}, wlget = wireLogoFields('wl', wlst);
    f.querySelectorAll('input[name="lgm"]').forEach(r => r.addEventListener('change', () => { document.getElementById('wlg').hidden = val('lgm') !== 'custom'; }));
    const syncCine = () => { const on = val('sty') === 'sinema'; document.getElementById('cmWrap').hidden = !on; document.getElementById('dnWrap').hidden = val('sty') !== 'deney'; document.getElementById('thWrap').hidden = val('sty') !== 'tarih'; document.getElementById('nsWrap').hidden = val('sty') !== 'nasil'; document.getElementById('hkWrap').hidden = val('sty') !== 'hikaye'; if (val('sty') === 'hikaye') loadSeries(); };
    let seriesLoaded = false;
    const loadSeries = async () => { if (seriesLoaded) return; seriesLoaded = true; const sel = document.getElementById('hks'); try { const list = await api('/api/my/story-series'); sel.innerHTML = list.length ? list.map(x => `<option value="${esc(x.id)}">${esc(x.title)} · ${x.episodes} bölüm</option>`).join('') : '<option value="">Henüz seriniz yok</option>'; } catch { sel.innerHTML = '<option value="">Yüklenemedi</option>'; } };
    f.querySelectorAll('input[name="hkm"]').forEach(r => r.addEventListener('change', () => { document.getElementById('hkNew').hidden = val('hkm') !== 'new'; document.getElementById('hkCont').hidden = val('hkm') !== 'continue'; }));
    f.querySelectorAll('input[name="sty"]').forEach(r => r.addEventListener('change', () => { syncCine();
      if (['sinema', 'deney', 'tarih', 'nasil', 'hikaye'].includes(val('sty'))) { const fm = f.querySelector('input[name="fmt"][value="dikey"]'), du = f.querySelector('input[name="dur"][value="60"]'); if (fm) fm.checked = true; if (du) du.checked = true; } })); syncCine();
    document.getElementById('wnext').onclick = () => { const e = check(step); if (e) { msg.textContent = e; return; } show(step + 1); };
    document.getElementById('wback').onclick = () => show(step - 1);
    f.querySelectorAll('.wsteps li').forEach(li => li.onclick = () => { const i = +li.dataset.i; for (let k = 1; k < i; k++) { const e = check(k); if (e) { show(k); msg.textContent = e; return; } } show(i); });
    f.onsubmit = async e => {
      e.preventDefault(); for (let k = 1; k <= 3; k++) { const er = check(k); if (er) { show(k); msg.textContent = er; return; } }
      const btn = document.getElementById('go'); busy(btn, true);
      try {
        const files = [...(document.getElementById('src').files || [])];
        const sources = files.length ? await extractAll(files, msg) : [];
        ['tone', 'fmt', 'dur', 'spd', 'sty', 'cm'].forEach(k => lsSet('v_' + k, val(k))); lsSet('v_dser', document.getElementById('dser').value); lsSet('v_tser', document.getElementById('tser').value); lsSet('v_nhan', document.getElementById('nhan').value); lsSet('v_ncta', document.getElementById('ncta').value);
        const p = await api('/api/projects', { method: 'POST', body: { title: document.getElementById('t').value, brief: document.getElementById('b').value, audience: document.getElementById('a').value, target_seconds: +val('dur'), tone: val('tone'), tone_note: document.getElementById('tno').value, format: val('fmt'), speech_rate: val('spd'), visual_style: val('sty'), cine_mode: val('cm'), series: document.getElementById('dser').value, next_topic: document.getElementById('dnext').value, series_t: document.getElementById('tser').value, episode: document.getElementById('tep').value, next_topic_t: document.getElementById('tnext').value, handle: document.getElementById('nhan').value, cta: document.getElementById('ncta').value, story: val('sty') === 'hikaye' ? { mode: val('hkm'), title: document.getElementById('hkt').value, series_id: document.getElementById('hks').value } : null, logo: val('lgm') === 'default' ? null : { mode: val('lgm'), ...(val('lgm') === 'custom' ? wlget() : {}) }, sources } });
        location.hash = '#/p/' + p.id;
      } catch (err) { msg.textContent = err.message; busy(btn, false); }
    };
    api('/api/tones').then(list => {
      tones = list;
      document.getElementById('tones').innerHTML = radios('tone', list.map(x => [x.k, x.label, String(x.desc || '').split(/(?<=[.!?])\s/)[0]]).concat([['ozel', 'Diğer', 'Kendim tarif edeyim']]), def.tone, o => `<b>${esc(o[1])}</b><span>${esc(o[2])}</span>`);
      f.querySelectorAll('input[name="tone"]').forEach(r => r.onchange = () => { document.getElementById('tnoWrap').hidden = val('tone') !== 'ozel'; });
    }).catch(() => {});
    let list = [];
    try { list = await api('/api/projects'); } catch (e) { }
    const WAIT = ['content_review', 'visuals_review'], WORK = ['queued', 'content_generating', 'visuals_generating', 'voicing', 'rendering'];
    const draw = flt => {
      const L = list.filter(p => !flt || (flt === 'wait' ? WAIT.includes(p.status) : flt === 'work' ? WORK.includes(p.status) : p.status === 'delivered'));
      document.getElementById('list').innerHTML = L.length ? L.map(p => `<a class="row lrow" href="#/p/${p.id}">${thumbBox(p.thumb)}<span class="lmain"><span class="ltitle">${esc(p.title)}</span><span class="note">${fmtDate(p.updated_at)}</span></span><span class="pill st-${p.status}">${STATUS[p.status] || p.status}</span></a>`).join('') : `<div class="empty">${list.length ? 'Bu filtrede video yok.' : 'Henüz video yok. Yukarıdan ilk konunu yaz.'}</div>`;
    };
    draw('');
    document.querySelectorAll('#vf button').forEach(b => b.onclick = () => { document.querySelectorAll('#vf button').forEach(x => x.classList.toggle('on', x === b)); draw(b.dataset.f); });
    const w = list.filter(p => WAIT.includes(p.status));
    if (w.length) document.getElementById('waiting').innerHTML = `<a class="waitbar" href="#/p/${w[0].id}"><b>${w.length} video onayınızı bekliyor</b><span>${esc(w[0].title)}${w.length > 1 ? ` ve ${w.length - 1} video daha` : ''} →</span></a>`;
    if (!list.length && lsGet('rehber_kapali', '') !== '1') {
      document.getElementById('guide').innerHTML = `<div class="card guide"><button type="button" class="gclose" aria-label="Kapat">✕</button><b class="gt">3 adımda ilk videonuz</b>
        <ol class="gsteps"><li><span>1</span><div><b>Konuyu yazın</b><p>Konu ve ne anlatılacağını yazın, anlatım dilini ve biçimi seçin. İsterseniz MEB modülünü kaynak olarak ekleyin.</p></div></li>
        <li><span>2</span><div><b>İçeriği ve görselleri onaylayın</b><p>1–2 dakikada sahne sahne metin gelir; düzeltme isteyebilirsiniz. Sonra görseller çizilir, onları da inceleyip onaylarsınız.</p></div></li>
        <li><span>3</span><div><b>Videonuzu alın, öğrencilere açın</b><p>Seslendirme ve video kendiliğinden hazırlanır. Ders kodu ve QR ile paylaşın ya da bir eğitime ekleyin; soruların sonuçlarını takip edin.</p></div></li></ol>
        <div class="btns"><button class="primary" id="gstart">Başlayalım</button></div></div>`;
      document.querySelector('.gclose').onclick = () => { lsSet('rehber_kapali', '1'); document.getElementById('guide').innerHTML = ''; };
      document.getElementById('gstart').onclick = () => { document.getElementById('t').focus(); f.scrollIntoView({ behavior: 'smooth' }); };
    }
  }

  /* ---------- proje ---------- */
  async function viewProject(id) {
    let d; try { d = await api('/api/projects/' + id); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const p = d.project, step = STEP_OF[p.status] ?? -1;
    const steps = ['İçerik', 'Görseller', 'Ses', 'Video', 'Teslim'].map((s, i) => `<span class="${i < step ? 'done' : i === step ? 'on' : ''}">${i + 1} · ${s}</span>`).join('');
    let body = '';
    const rb = qsOf().get('r'), head = `<p class="muted">${rb && rb.startsWith('#/ortak-sinav') ? `<a href="${esc(rb)}">← Ortak sınav çalışmasına dön</a>` : '<a href="#/projeler">← Videolar</a>'}</p><h1>${esc(p.title)}</h1><div class="steps">${steps}</div>`;
    const waitMsg = { content_generating: 'Eğitim içeriği hazırlanıyor, lütfen bekleyiniz. Bu işlem 1–2 dakika sürebilir.', visuals_generating: 'Sahne görselleri hazırlanıyor, lütfen bekleyiniz. 1 dakikalık video için 2–3, 4 dakikalık video için 5–8 dakika sürebilir.', voicing: 'Seslendirme yapılıyor, lütfen bekleyiniz.', rendering: '' };
    if (waitMsg[p.status] !== undefined && p.status !== 'rendering') {
      const g = d.gen, gp = g && g.progress && g.progress.total ? g.progress : null;
      const gline = g ? (g.status === 'queued' ? 'Çalışma başlatılıyor…' : gp ? `${gp.done} / ${gp.total} ${p.status === 'visuals_generating' ? 'sahne hazır' : 'tamamlandı'}` : 'Çalışma sürüyor…') : '';
      const gbar = gp ? `<div class="bar"><i style="width:${Math.round(gp.done / gp.total * 100)}%"></i></div>` : '';
      body = `<div class="card wait"><div class="spin" aria-hidden="true"></div><div style="flex:1"><strong>${STATUS[p.status]}</strong><div class="note">${waitMsg[p.status]} Sayfa kendiliğinden yenilenir.</div>${gline ? `<div class="note"><b>${gline}</b></div>` : ''}${gbar}</div></div>`;
      if (!document.querySelector('.pushnudge')) setTimeout(() => pushNudge('proje'), 800);
      pollTimer = setTimeout(() => route(), 4000);
    } else if (p.status === 'queued') {
      body = `<div class="card wait"><div class="spin" aria-hidden="true"></div><div><strong>Sırada</strong><div class="note">Bu video bir serinin parçası. Önündeki içerikler hazırlanınca bunun içeriği de kendiliğinden hazırlanmaya başlar; lütfen bekleyiniz. Sayfa kendiliğinden yenilenir.</div></div></div>`;
      pollTimer = setTimeout(() => route(), 8000);
    } else if (p.status === 'rendering') {
      const pr = d.job ? d.job.progress : 0;
      body = `<div class="card"><strong>Video üretiliyor</strong><p class="note">Video hazırlanıyor, lütfen bekleyiniz. 1 dakikalık video yaklaşık 4–5, 4 dakikalık video 12–15 dakika sürer; sayfayı kapatabilirsiniz.</p><div class="bar"><i style="width:${pr}%"></i></div><p class="note">%${pr} · ${d.job && d.job.status === 'queued' ? 'başlatılıyor' : 'hazırlanıyor'}</p></div>`;
      pollTimer = setTimeout(() => route(), 6000);
    } else if (p.status === 'content_review') body = contentReview(d);
    else if (p.status === 'visuals_review') body = visualsReview(d);
    else if (p.status === 'delivered') body = delivered(d);
    else if (p.status === 'failed') { const [stage, ...m] = (p.error || '').split('|'); const SN = { content: 'İçerik hazırlama', visuals: 'Görsel hazırlama', voice: 'Seslendirme', render: 'Video üretimi' }; body = `<div class="card err"><strong>${esc(SN[stage] || 'Bir adım')} tamamlanamadı.</strong>\nTekrar deneyebilirsiniz; sorun sürerse yöneticinize bildirin.<details style="margin-top:8px"><summary>Teknik ayrıntı</summary>${esc(m.join('|'))}</details></div><div class="btns"><button class="primary" data-act="retry">Tekrar dene</button><button class="danger" data-act="cancel">Projeyi iptal et</button></div>`; }
    else if (p.status === 'archived') body = `<div class="card">Bu proje iptal edildi.</div>`;
    app.innerHTML = head + body + (p.status !== 'archived' && !/_generating$|^voicing$|^rendering$|^queued$/.test(p.status) ? '<div id="logoproj"></div>' : '');
    if (document.getElementById('logoproj')) logoProjectCard(document.getElementById('logoproj'), id);
    wire(id, d);
  }

  function contentReview(d) {
    const sc = d.content.data.scenes; const chars = sc.reduce((n, s) => n + s.cap.join(' ').length, 0);
    const srcs = d.sources || [];
    const srcLine = s => (s.src && s.src.length) ? `<div class="vis">Kaynak: ${s.src.map(r => `${esc(r.doc)} s.${esc(r.p)}`).join(', ')}</div>` : (srcs.length ? `<div class="vis" style="color:var(--yel)">Kaynakta karşılığı yok (genel bilgi)</div>` : '');
    return `<p class="muted">Sürüm ${d.content.version} · ${sc.length} sahne · tahmini ${Math.round(chars / 14.5)} saniye${srcs.length ? ` · Kaynak: ${srcs.map(x => esc(x.name)).join(', ')}` : ''}</p>
      <div class="grid">${sc.map(s => `<div class="scene"><h3><small>${esc(s.k)} · ${esc(s.ch)}</small>${esc(s.title)}${s.tag ? ` <span class="pill" style="color:var(--red)">${esc(s.tag.text)}</span>` : ''}</h3><ol>${s.cap.map(x => `<li>${esc(x)}</li>`).join('')}</ol>${s.big ? `<div class="big">${esc(s.big.text)}</div>` : ''}<div class="vis">Görsel: ${esc(s.visual && s.visual.subject)}</div>${srcLine(s)}</div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><label for="fb">Düzeltme isteği</label><textarea id="fb" placeholder="Örn. 3. sahneyi kısalt, arızalara bir örnek daha ekle"></textarea>
      <div class="btns stickyact"><button class="primary" data-act="content-approve">Onayla, görselleri hazırla</button><button data-act="content-revise">Düzelt</button><button class="danger" data-act="cancel">İptal</button></div></div>
      <div class="card" style="margin-top:12px"><label for="src2">Kaynak ekle</label><input id="src2" type="file" multiple accept=".pdf,.docx,.txt,.md"><div class="btns"><button data-act="add-source">Kaynağı ekle ve içeriği kaynağa göre yeniden yaz</button></div><p class="note" id="srcmsg"></p></div>`;
  }
  const SR = { yavas: 'Yavaş · ders dinler gibi, en anlaşılır', normal: 'Normal · öğrenci için önerilen', hizli: 'Hızlı · tekrar ve özet için' };
  const SR_OPTS = cur => Object.entries(SR).map(([k, v]) => `<option value="${k}" ${k === (cur || 'normal') ? 'selected' : ''}>${v}</option>`).join('');
  function visualsReview(d) {
    return `<div class="player"><div><div class="canvasWrap"><canvas id="cv" width="1080" height="1920" aria-label="Video önizlemesi"></canvas></div>
      <input type="range" class="scrub" id="scrub" min="0" max="1000" value="0" aria-label="Zaman">
      <div class="btns"><button id="pp">Oynat</button></div><div class="chips" id="chips"></div></div>
      <div><div id="scene-warn"></div><div class="card"><p class="note">Sürüm ${d.visuals.version}. Önizlemede ses yok, süreler tahmini; seslendirmeden sonra sahneler sese göre ayarlanır.</p>
      <label for="sk">Hangi sahne?</label><select id="sk"><option value="">Tüm sahneler</option>${d.visuals.scenes.map(s => `<option value="${esc(s.k)}">${esc(s.k)} · ${esc(s.title)}</option>`).join('')}</select>
      <label for="fb">Düzeltme isteği</label><textarea id="fb" placeholder="Örn. motoru daha büyük çiz, etiketler üst üste biniyor"></textarea>
      <div class="btns"><button data-act="visuals-revise">Yeniden çiz</button></div></div>
      <div class="card" style="margin-top:12px"><label for="sr">Anlatım hızı</label><select id="sr">${SR_OPTS(d.project.speech_rate)}</select></div>
      <div class="btns stickyact"><button class="primary" data-act="visuals-approve">Onayla: seslendir ve videoyu üret</button><button class="danger" data-act="cancel">İptal</button></div></div></div>
      <div id="audit" class="audit"></div>`;
  }

  /* ---------- yayına hazırlık: altyazı, kapak, YouTube metni, QR ---------- */
  const fmtT = (t, ms) => { const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60), x = Math.round((t % 1) * 1000); const p = n => String(n).padStart(2, '0'); return ms ? `${p(h)}:${p(m)}:${p(s)},${String(x).padStart(3, '0')}` : (h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`); };
  const download = (name, data, type) => { const a = document.createElement('a'); a.href = String(data).startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  const slug = t => String(t || 'video').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  async function setupPublish(id, d) {
    const box = document.getElementById('pub'); if (!box) return;
    const bundle = await api(`/api/projects/${id}/bundle?audio=1`); delete bundle.audioUrl;
    const L = window.EVEngine.layout(bundle), title = d.project.title.trim();
    // altyazı: her cümle seslendirmedeki başlangıcından bir sonrakine kadar
    const cues = []; L.scenes.forEach(sc => sc.cap.forEach((c, i) => { const a = sc.s + sc.capT[i], b = i + 1 < sc.cap.length ? sc.s + sc.capT[i + 1] : sc.e; cues.push({ a, b: Math.max(a + 0.8, b - 0.05), t: c }); }));
    const srt = cues.map((c, i) => `${i + 1}\n${fmtT(c.a, 1)} --> ${fmtT(c.b, 1)}\n${wrap2(c.t)}\n`).join('\n');
    // YouTube bölümleri: ardışık aynı "ch" sahneleri; ilk bölüm 0:00
    const ch = []; L.scenes.forEach(sc => { const l = ch[ch.length - 1]; if (l && l.ch === sc.ch) return; ch.push({ ch: sc.ch, t: sc.s, title: sc.title }); });
    let qz = null; try { qz = await api(`/api/projects/${id}/quiz`); } catch { }
    const kaz = qz && qz.quiz ? qz.quiz.kazanimlar : [];
    const code = qz && qz.project.quiz_published ? qz.project.share_id : null;
    const lessonUrl = code ? `${location.origin}/izle/${code}` : null;
    const cap = s => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1).toLocaleLowerCase('tr');
    const text = () => {
      const intro = L.scenes[0] ? L.scenes[0].cap.join(' ') : '';
      let t = `BAŞLIK\n${title}\n\nAÇIKLAMA\n${intro}\n\n`;
      if (kaz.length) t += `Bu videoda öğrenecekleriniz:\n${kaz.map(k => '• ' + k.text).join('\n')}\n\n`;
      if (ch.length >= 3) t += `Bölümler:\n${ch.map(c => `${fmtT(c.t)} ${cap(c.ch)}`).join('\n')}\n\n`;
      if (lessonUrl) t += `Etkileşimli ders (sorularla): ${lessonUrl}  · Ders kodu: ${code}\n\n`;
      const tags = ['#meslekeğitimi', '#mesleklisesi', ...title.split(/\s+/).filter(w => w.length > 3).slice(0, 4).map(w => '#' + w.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, ''))];
      t += [...new Set(tags)].join(' ');
      return t;
    };
    // kapak
    const sel = document.getElementById('thsc');
    sel.innerHTML = L.scenes.map(s => `<option value="${esc(s.k)}">${esc(s.k)} · ${esc(s.title)}</option>`).join('');
    const best = L.scenes.find(s => !/GİRİŞ|ÖZET/i.test(s.ch || '')) || L.scenes[0]; if (best) sel.value = best.k;
    const off = document.createElement('canvas'), P = window.EVEngine.createPlayer(off, bundle);
    await document.fonts.ready;
    const drawThumb = () => {
      const fm = document.getElementById('thfm').value, cv = document.getElementById('thcv');
      const [W, H] = fm === 'yt' ? [1280, 720] : fm === 'v' ? [1080, 1920] : [1080, 1080]; cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.fillStyle = '#05070e'; g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(W * .7, H * .5, 20, W * .7, H * .5, Math.max(W, H) * .7); rg.addColorStop(0, 'rgba(30,50,100,.55)'); rg.addColorStop(1, 'rgba(5,7,14,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(120,150,210,.12)'; for (let x = 30; x < W; x += 64) for (let y = 30; y < H; y += 64) { g.fillRect(x - 5, y - 1, 10, 2); g.fillRect(x - 1, y - 5, 2, 10); }
      const r = P.still(sel.value, 0.92);
      const art = fm === 'yt' ? [W * .48, H * .06, W * .5, H * .88] : fm === 'v' ? [W * .04, H * .36, W * .92, H * .5] : [W * .08, H * .34, W * .84, H * .6];
      if (r) {
        const sc = Math.min(art[2] / r.w, art[3] / r.h), w = r.w * sc, h = r.h * sc, x0 = art[0] + (art[2] - w) / 2, y0 = art[1] + (art[3] - h) / 2;
        g.drawImage(off, r.x, r.y, r.w, r.h, x0, y0, w, h);
      }
      const tx = fm === 'yt' ? 56 : 64, tw = fm === 'yt' ? W * .41 : W - 128, ty = fm === 'yt' ? 150 : fm === 'v' ? 240 : 120;
      g.fillStyle = '#ffc93c'; g.fillRect(tx, ty - 70, 16, 16); g.font = `800 ${fm === 'yt' ? 22 : 28}px "JetBrains Mono", monospace`; g.fillStyle = '#8a94ad'; g.fillText('EĞİTİM STÜDYOSU', tx + 28, ty - 54);
      let size = fm === 'yt' ? 86 : 110; const words = title.toLocaleUpperCase('tr').split(/\s+/); let lines;
      const fit = () => { g.font = `900 ${size}px Archivo, sans-serif`; lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > tw && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); };
      fit(); while ((lines.length > (fm === 'yt' ? 4 : 3) || lines.some(l => g.measureText(l).width > tw)) && size > 36) { size -= 4; fit(); }
      g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 24; g.fillStyle = '#fff'; lines.forEach((l, i) => g.fillText(l, tx, ty + size * .95 + i * size * 1.02)); g.shadowBlur = 0;
      const by = ty + size * 1.02 * lines.length + 30; g.fillStyle = '#ffc93c'; g.fillRect(tx, by, 120, 8);
      if (code && fm !== 'yt') { g.font = '800 34px "JetBrains Mono", monospace'; g.fillStyle = '#3fb0ff'; g.fillText('Ders kodu: ' + code, tx, H - 90); }
    };
    sel.onchange = drawThumb; document.getElementById('thfm').onchange = drawThumb; drawThumb();
    const out = document.getElementById('pubout');
    box.querySelectorAll('[data-pub]').forEach(b => b.onclick = async () => {
      const a = b.dataset.pub;
      if (a === 'srt') download(slug(title) + '.srt', srt, 'application/x-subrip;charset=utf-8');
      if (a === 'thumb') download(slug(title) + '-kapak.png', document.getElementById('thcv').toDataURL('image/png'));
      if (a === 'text') { const t = text(); out.innerHTML = `<label for="yt">YouTube metni</label><textarea id="yt" rows="14" readonly>${esc(t)}</textarea><div class="btns"><button id="ytc">Kopyala</button></div><p class="note">YouTube'a yüklerken başlık ve açıklama alanlarına yapıştırın; .srt dosyasını “Altyazılar” bölümünden ekleyin. Bölümler, açıklamadaki zaman damgalarından otomatik oluşur.</p>`; document.getElementById('ytc').onclick = () => { navigator.clipboard.writeText(t).catch(() => {}); document.getElementById('ytc').textContent = 'Kopyalandı'; }; }
    });
    if (lessonUrl) {
      out.insertAdjacentHTML('beforebegin', `<div id="qrbox" style="margin-top:14px"><label>Etkileşimli ders QR kodu · ${esc(code)}</label><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div id="qr2" style="background:#fff;padding:12px;border-radius:12px"></div><button data-pub2="qr">QR kodu indir (PNG)</button></div></div>`);
      loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => {
        const el = document.getElementById('qr2'); if (!el || !window.QRCode) return; new window.QRCode(el, { text: lessonUrl, width: 160, height: 160, correctLevel: window.QRCode.CorrectLevel.M });
        box.querySelector('[data-pub2="qr"]').onclick = () => { const big = document.createElement('div'); new window.QRCode(big, { text: lessonUrl, width: 1000, height: 1000, correctLevel: window.QRCode.CorrectLevel.M }); setTimeout(() => { const c = big.querySelector('canvas'); if (c) download(slug(title) + '-qr.png', c.toDataURL('image/png')); }, 100); };
      }).catch(() => {});
    }
  }
  function wrap2(t) { if (t.length <= 42) return t; const w = t.split(' '); let a = '', i = 0; while (i < w.length && (a + ' ' + w[i]).trim().length <= Math.ceil(t.length / 2) + 6) a = (a + ' ' + w[i++]).trim(); return a + '\n' + w.slice(i).join(' '); }

  /* ---------- yayına hazırlık ---------- */
  const COVERS = { yt: { w: 1280, h: 720, label: 'YouTube kapağı 16:9 (1280×720)' }, reel: { w: 1080, h: 1920, label: 'Reels / Shorts / TikTok kapağı 9:16' }, sq: { w: 1080, h: 1080, label: 'Instagram gönderi 1:1' } };
  async function viewPublish(id) {
    let d; try { d = await api(`/api/projects/${id}/publish`); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const p = d.project, m = p.publish_meta;
    const copyBtn = (key, label) => `<button data-copy="${key}">${label || 'Kopyala'}</button>`;
    let html = `<p class="muted"><a href="#/p/${esc(id)}">← ${esc(p.title)}</a></p><h1>Yayına hazırlık</h1>`;
    // altyazı
    html += `<div class="card"><strong>1 · Altyazı dosyası</strong><p class="note">Videodaki seslendirmeyle saniyesi saniyesine eşleşir. YouTube'da <i>Altyazılar → Dosya yükle → Zamanlamalı</i> ile yükleyin; işitme engelli öğrenciler ve otomatik çeviri için kullanılır.</p>
      <div class="btns"><a class="btn primary" href="/api/projects/${esc(id)}/subtitles.srt" download>SRT indir</a><a class="btn" href="/api/projects/${esc(id)}/subtitles.vtt" download>VTT indir</a></div>
      ${d.chapters.length >= 3 ? `<p class="note" style="margin-top:12px">YouTube bölümleri (açıklamaya otomatik eklenir):</p><pre class="chap">${d.chapters.map(c => `${esc(c.label)} ${esc(c.name)}`).join('\n')}</pre>` : ''}</div>`;
    // metinler
    html += `<div class="card" style="margin-top:14px"><strong>2 · Başlık, açıklama ve etiketler</strong>`;
    if (p.publish_status === 'generating') { html += `<div class="wait" style="margin-top:10px"><div class="spin" aria-hidden="true"></div><div class="note">Yayın metinleri hazırlanıyor, lütfen bekleyiniz…</div></div>`; pollTimer = setTimeout(route, 5000); }
    else if (!m) html += `${p.publish_status === 'failed' ? `<p class="err">Metinler hazırlanamadı.</p><details><summary>Teknik ayrıntı</summary>${esc(p.publish_error || '')}</details>` : '<p class="note">Videoya uygun YouTube başlığı, açıklaması, etiketleri ve sosyal medya metni hazırlanır.</p>'}<div class="btns"><button class="primary" data-p="gen">Metinleri hazırla</button></div>`;
    else html += `
      <label>YouTube başlığı</label><div class="cp"><input readonly id="t_title" value="${esc(m.youtube_title)}">${copyBtn('t_title')}</div>
      <label>YouTube açıklaması</label><div class="cp"><textarea readonly id="t_desc" rows="10">${esc(d.full_description || '')}</textarea>${copyBtn('t_desc')}</div>
      <label>YouTube etiketleri</label><div class="cp"><input readonly id="t_tags" value="${esc(m.tags.join(', '))}">${copyBtn('t_tags')}</div>
      <label>Reels / TikTok / Shorts metni</label><div class="cp"><textarea readonly id="t_soc" rows="5">${esc(m.social_caption + (m.hashtags.length ? '\n\n' + m.hashtags.join(' ') : '') + (d.lessonUrl ? '\n\nEtkileşimli ders kodu: ' + p.share_id : ''))}</textarea>${copyBtn('t_soc')}</div>
      <label for="pfb">Değişiklik isteği</label><textarea id="pfb" rows="2" placeholder="Örn. başlık daha merak uyandırıcı olsun, etiketlere 'elektrik' ekle"></textarea><div class="btns"><button data-p="regen">Metinleri yeniden hazırla</button></div>`;
    html += `</div>`;
    // kapak
    html += `<div class="card" style="margin-top:14px"><strong>3 · Kapak görseli</strong><p class="note">Videodaki sahne çiziminden kapak oluşturulur. Ölçüyü ve sahneyi seçin, yazıları düzenleyin, PNG olarak indirin.</p>
      <div class="grid two"><div><label for="cv_f">Ölçü</label><select id="cv_f">${Object.entries(COVERS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <label for="cv_k">Görsel (sahne)</label><select id="cv_k">${d.scenes.map(s => `<option value="${esc(s.k)}">${esc(s.k)} · ${esc(s.title)}</option>`).join('')}</select>
      <label for="cv_t">Kapak başlığı</label><input id="cv_t" maxlength="40" value="${esc((m && m.cover_title) || p.title.toLocaleUpperCase('tr'))}">
      <label for="cv_s">Alt yazı</label><input id="cv_s" maxlength="50" value="${esc((m && m.cover_sub) || '')}">
      <label class="chk"><input type="checkbox" id="cv_b" ${d.lessonUrl ? 'checked' : ''}> “Etkileşimli ders” rozeti${d.lessonUrl ? ` ve ders kodu (${esc(p.share_id)})` : ''}</label>
      <div class="btns"><button class="primary" id="cv_dl">PNG indir</button></div></div>
      <div><canvas id="cover" class="coverprev"></canvas></div></div></div>`;
    // QR
    if (d.lessonUrl) html += `<div class="card" style="margin-top:14px"><strong>4 · QR kod</strong><p class="note">Etkileşimli dersin QR kodu. Afişe, çalışma kâğıdına ya da video açıklamasına koyabilirsiniz.</p><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div id="qr2" style="background:#fff;padding:12px;border-radius:12px"></div><div><div class="lcode">Ders kodu: <b>${esc(p.share_id)}</b></div><p class="note">${esc(d.lessonUrl)}</p><div class="btns"><button id="qr_dl">QR kodu PNG indir</button></div></div></div></div>`;
    app.innerHTML = html;
    app.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { const el = document.getElementById(b.dataset.copy); try { await navigator.clipboard.writeText(el.value); } catch { el.select(); document.execCommand('copy'); } const t = b.textContent; b.textContent = 'Kopyalandı'; setTimeout(() => b.textContent = t, 1400); });
    app.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => { b.disabled = true; try { const fb = b.dataset.p === 'regen' ? document.getElementById('pfb').value.trim() : null; if (b.dataset.p === 'regen' && !fb) { b.disabled = false; document.getElementById('pfb').focus(); return; } await api(`/api/projects/${id}/publish/generate`, { method: 'POST', body: { feedback: fb } }); route(); } catch (e) { alertBox(e.message); b.disabled = false; } });
    if (d.lessonUrl) loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { const el = document.getElementById('qr2'); if (el && window.QRCode) new window.QRCode(el, { text: d.lessonUrl, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M }); }).catch(() => {});
    const qd = document.getElementById('qr_dl'); if (qd) qd.onclick = () => { const c = document.querySelector('#qr2 canvas'); if (c) { const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `ders-${p.share_id}-qr.png`; a.click(); } };
    // kapak çizimi
    let bundle = null, still = null;
    try { bundle = await api(`/api/projects/${id}/bundle?audio=1`); delete bundle.audioUrl; } catch { }
    const cover = document.getElementById('cover'); if (!cover || !bundle) return;
    const draw = async () => {
      const f = COVERS[document.getElementById('cv_f').value], k = document.getElementById('cv_k').value;
      if (!still || still.k !== k) { const off = document.createElement('canvas'); const P = window.EVEngine.createPlayer(off, { ...bundle, format: 'dikey' }); const r = P.still(k, 0.92); still = { k, img: off, r }; }
      await document.fonts.ready;
      drawCover(cover, f, still, { title: document.getElementById('cv_t').value, sub: document.getElementById('cv_s').value, badge: document.getElementById('cv_b').checked, code: d.lessonUrl ? p.share_id : null });
    };
    ['cv_f', 'cv_k', 'cv_t', 'cv_s', 'cv_b'].forEach(x => document.getElementById(x).addEventListener('input', draw));
    document.getElementById('cv_dl').onclick = () => cover.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `kapak-${document.getElementById('cv_f').value}.png`; a.click(); }, 'image/png');
    draw();
  }
  // Kapak: koyu zemin + ızgara, sahne çizimi, büyük başlık, marka ve rozet
  function drawCover(cv, f, st, o) {
    cv.width = f.w; cv.height = f.h; const c = cv.getContext('2d'), W = f.w, H = f.h, land = W > H * 1.2, S = Math.min(W, H) / 1080, pad = 64 * S;
    const bg = c.createRadialGradient(W * (land ? .7 : .5), H * .55, 10, W * .5, H * .5, Math.max(W, H) * .8); bg.addColorStop(0, '#16264a'); bg.addColorStop(1, '#05070e'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(120,150,210,.10)'; const g = 80 * S; for (let x = g / 2; x < W; x += g) for (let y = g / 2; y < H; y += g) { c.fillRect(x - 7 * S, y - 1, 14 * S, 2); c.fillRect(x - 1, y - 7 * S, 2, 14 * S); }
    // başlık satırları (önce ölç)
    const tw = land ? W * .42 : W - pad * 2, maxLines = 3;
    let size = (land ? 96 : H > W * 1.3 ? 112 : 84) * S; const words = (o.title || '').toLocaleUpperCase('tr').split(/\s+/).filter(Boolean);
    const lines = () => { c.font = `900 ${size}px Archivo, sans-serif`; const L = []; let cur = ''; for (const w of words) { const t = (cur + ' ' + w).trim(); if (c.measureText(t).width > tw && cur) { L.push(cur); cur = w; } else cur = t; } if (cur) L.push(cur); return L; };
    let L = lines(); while ((L.length > maxLines || L.some(l => c.measureText(l).width > tw)) && size > 36 * S) { size -= 3 * S; L = lines(); }
    const lh = size * 1.02, subH = o.sub ? 54 * S : 0, textH = L.length * lh + 18 * S + 10 * S + 24 * S + subH;
    const bh = 62 * S, bottom = H - pad - (o.badge ? bh + 24 * S : 0);
    const ty = land ? (H - textH) / 2 : pad + 70 * S;
    // görsel kutusu
    const r = st.r, ar = r.w / r.h; let bx, by, bw, bhh;
    if (land) { bx = W * .47; by = H * .1; bw = W * .51; bhh = H * .8; }
    else { bx = pad * .5; by = ty + textH + 20 * S; bw = W - pad; bhh = bottom - by - 10 * S; }
    let iw = bw, ih = iw / ar; if (ih > bhh) { ih = bhh; iw = ih * ar; }
    const ix = bx + (bw - iw) / 2, iy = by + (bhh - ih) / 2;
    if (ih > 40) { c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 40 * S; c.drawImage(st.img, r.x, r.y, r.w, r.h, ix, iy, iw, ih); c.restore(); }
    // marka
    c.fillStyle = '#ffc93c'; c.fillRect(pad, pad, 18 * S, 18 * S); c.font = `900 ${30 * S}px Archivo, sans-serif`; c.fillStyle = '#eef1f7'; c.textBaseline = 'top'; c.fillText('EĞİTİM STÜDYOSU', pad + 30 * S, pad - 6 * S);
    // başlık
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 24 * S; c.textBaseline = 'top'; c.font = `900 ${size}px Archivo, sans-serif`;
    L.forEach((l, i) => { const gr = c.createLinearGradient(0, ty + i * lh, 0, ty + (i + 1) * lh); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#c9d2e3'); c.fillStyle = gr; c.fillText(l, pad, ty + i * lh); });
    c.restore();
    let y = ty + L.length * lh + 18 * S; c.fillStyle = '#ffc93c'; c.fillRect(pad, y, 120 * S, 10 * S); y += 34 * S;
    if (o.sub) { let fs = 34 * S; c.font = `800 ${fs}px "JetBrains Mono", monospace`; while (c.measureText(o.sub).width > tw && fs > 18 * S) { fs -= 2 * S; c.font = `800 ${fs}px "JetBrains Mono", monospace`; } c.fillStyle = '#c9d2e3'; c.textBaseline = 'top'; c.fillText(o.sub, pad, y); }
    if (o.badge) {
      const txt = o.code ? `ETKİLEŞİMLİ DERS · KOD ${o.code}` : 'ETKİLEŞİMLİ DERS'; c.font = `900 ${30 * S}px "JetBrains Mono", monospace`; const bw2 = c.measureText(txt).width + 48 * S;
      const x0 = pad, y0 = H - pad - bh;
      c.fillStyle = '#3fb0ff'; c.beginPath(); if (c.roundRect) c.roundRect(x0, y0, bw2, bh, bh / 2); else c.rect(x0, y0, bw2, bh); c.fill(); c.fillStyle = '#05070e'; c.textBaseline = 'middle'; c.fillText(txt, x0 + 24 * S, y0 + bh / 2 + 2 * S);
    }
  }

  /* ---------- tüm dersler ve sonuçlar ---------- */
  async function viewLessons() {
    let list; try { list = await api('/api/lessons'); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    app.innerHTML = `<h1>Dersler ve sonuçlar</h1><p class="muted">Etkileşimli dersi olan videolar. Satıra tıklayınca soruları, ders kodunu, öğrenci tablosunu ve CSV indirme düğmesini görürsünüz.</p>
      ${list.length ? `<div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Ders</th><th>Kod</th><th>Durum</th><th>Başlayan</th><th>Tamamlayan</th><th>Ortalama</th></tr></thead><tbody>${list.map(p => `<tr class="clk" data-href="#/p/${esc(p.id)}/ders"><td><a href="#/p/${esc(p.id)}/ders">${esc(p.title)}</a></td><td><b style="letter-spacing:.12em">${esc(p.share_id || '—')}</b></td><td>${p.quiz_published ? '<span style="color:var(--green)">Yayında</span>' : p.quiz_status === 'generating' ? 'Sorular hazırlanıyor' : p.quiz_status === 'failed' ? '<span style="color:var(--red)">Hata</span>' : 'Yayında değil'}</td><td>${p.started}</td><td>${p.finished}</td><td>${p.avg == null ? '—' : '%' + p.avg}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card"><p class="muted">Henüz etkileşimli ders yok. Teslim edilmiş bir videonun sayfasında “Soruları ve sonuçları aç” ile başlayabilirsiniz.</p></div>'}`;
    app.querySelectorAll('tr.clk').forEach(r => r.onclick = e => { if (e.target.tagName !== 'A') location.hash = r.dataset.href; });
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
      html += `<div class="card"><strong>Paylaşım</strong>${p.quiz_published && link ? `<p class="note">Öğrenciler ana sayfadaki <b>Öğrenci girişi</b>ne bu kodu yazar, ya da bağlantıyı / QR kodu açar. Şifre gerekmez.</p><div class="lcode">Ders kodu: <b>${esc(p.share_id)}</b></div><div class="grid two" style="align-items:center"><div><input readonly value="${esc(link)}" id="lnk" onclick="this.select()"><div class="btns"><button data-q="copy">Bağlantıyı kopyala</button><a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Öğrenci gözüyle aç</a><button class="danger" data-q="unpub">Yayından kaldır</button></div></div><div id="qr" style="background:#fff;padding:10px;border-radius:12px;width:max-content"></div></div>` : `<p class="note">Soruları inceleyin; hazır olduğunda yayınlayıp bağlantıyı ya da QR kodu öğrencilerle paylaşın.</p><div class="btns"><button class="primary" data-q="pub">Yayınla ve bağlantı oluştur</button></div>`}</div>`;
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
    if (a.cine) {
      el.innerHTML = `<h2>Sahne görselleri</h2>${a.warn ? `<div class="card" style="border-color:rgba(255,201,60,.5)">${esc(a.warn)}</div>` : ''}<p class="note">Beğenmediğiniz görseli aşağıdaki düzeltme kutusundan sahne seçip ne istediğinizi yazarak yeniden ürettirebilirsiniz (ör. "daha aydınlık olsun, masada saat de olsun").</p>
        <div class="aud-grid">${a.scenes.map(x => `<div class="aud-scene"><div class="aud-head"><b>${esc(x.k)} · ${esc(x.title)}</b></div><div class="cinepair">${x.img ? `<img loading="lazy" src="${esc(x.img)}" alt="Sahne ${esc(x.k)} görseli">` : '<div class="noimg">Görsel yok</div>'}${x.img2 ? `<img loading="lazy" src="${esc(x.img2)}" alt="Sahne ${esc(x.k)} değişim sonrası">` : ''}</div>${x.img2 ? `<p class="note">Sağdaki görsele geçiş: “${esc(x.change)}” cümlesinde.</p>` : ''}</div>`).join('')}</div>`;
      return;
    }
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
      <label for="sr">Anlatım hızı</label><select id="sr">${SR_OPTS(d.project.speech_rate)}</select><p class="note">Hızı değiştirip "Yeniden seslendir"e basarsanız aynı görsellerle yeni hızda ses ve video üretilir.</p>
      <div class="btns"><button data-act="reopen">Bir sahneyi düzelt</button><button data-act="revoice">Yeniden seslendir</button></div></div>
      <div class="card" style="margin-top:12px" id="pub"><strong>Yayına hazırlık</strong><p class="note">YouTube ve sosyal medyaya yüklemeden önce gerekenler.</p>
        <div class="btns"><button data-pub="srt">Altyazı dosyası (.srt)</button><button data-pub="text">YouTube başlık, açıklama ve bölümler</button></div>
        <label for="thsc">Kapak görseli</label><div class="grid two" style="align-items:end"><div><select id="thsc"></select></div><div><select id="thfm"><option value="yt">YouTube kapağı 1280×720</option><option value="v">Dikey kapak 1080×1920 (Reels, Shorts)</option><option value="sq">Kare kapak 1080×1080</option></select></div></div>
        <canvas id="thcv" class="thprev" width="1280" height="720"></canvas><div class="btns"><button data-pub="thumb">Kapağı indir (PNG)</button></div>
        <div id="pubout"></div></div>
      <div class="card" style="margin-top:12px"><strong>Etkileşimli ders</strong><p class="note">Video bölüm sonlarında durup öğrenciye soru sorar; sonuçlar kazanım bazında size raporlanır.${d.quizStatus === 'generating' ? ' Sorular hazırlanıyor…' : d.quizStatus === 'ready' ? ' Sorular hazır.' : ''}</p><div class="btns"><a class="btn primary" href="#/p/${esc(d.project.id)}/ders">Soruları ve sonuçları aç</a></div></div>
      <div class="card" style="margin-top:12px"><strong>Yayına hazırlık</strong><p class="note">YouTube ve sosyal medya için altyazı dosyası, kapak görseli, başlık, açıklama ve etiketler.</p><div class="btns"><a class="btn primary" href="#/p/${esc(d.project.id)}/yayin">Yayına hazırlık sayfasını aç</a></div></div></div></div>`;
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
    if (d.project.status === 'delivered') setupPublish(id, d).catch(e => console.error(e));
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
      const map = { 'content-approve': ['content/approve'], 'content-revise': ['content/revise', { feedback: fb && fb.value }], 'visuals-approve': ['visuals/approve', { speech_rate: (document.getElementById('sr') || {}).value }], 'visuals-revise': ['visuals/revise', (() => { const k = (document.getElementById('sk') || {}).value || null, er = window.EVEngine && window.EVEngine.errors || {}; let f = fb && fb.value; if (k && er[k]) f += ` (Tarayıcıdaki çizim hatası: ${er[k]})`; return { feedback: f, k }; })()], cancel: ['cancel'], retry: ['retry'], reopen: ['reopen'], revoice: ['visuals/approve', { speech_rate: (document.getElementById('sr') || {}).value }], 'render-format': ['render', { format: (document.getElementById('nf2') || {}).value }] }[act];
      try { await api(`/api/projects/${id}/${map[0]}`, { method: 'POST', body: map[1] || {} }); route(); } catch (e) { alertBox(e.message); busy(btn, false); app.querySelectorAll('[data-act]').forEach(b => b.disabled = false); }
    });
  }
  /* ================= hesaplar, vitrin, eğitimler, yönetim ================= */
  let ME = { user: null };
  const tl = c => c == null ? '' : (c / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' TL';
  const ACCESS = { open: 'Serbest katılım', request: 'Öğretmen onayıyla', paid: 'Ücretli' };
  const ENR = { pending: 'Onay bekliyor', approved: 'Kayıtlı', rejected: 'Reddedildi', revoked: 'Erişim kapatıldı' };
  const qsOf = () => new URLSearchParams((location.hash.split('?')[1]) || '');
  const isTeacher = () => ME.user && (ME.user.role === 'admin' || (ME.user.role === 'teacher' && ME.user.status === 'active'));
  const fmtDate = d => d ? new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toLocaleUpperCase('tr')).join('');

  // Basit çizgi simgeler (alt menü)
  const IC = {
    home: '<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  const icon = k => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
  const THEMES = ['', 'light', 'dark'], THEME_L = { '': 'Tema: otomatik', light: 'Tema: açık', dark: 'Tema: koyu' }, THEME_I = { '': '◐', light: '☀', dark: '☾' };
  const curTheme = () => document.documentElement.dataset.theme || '';
  function setTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; try { t ? localStorage.setItem('tema', t) : localStorage.removeItem('tema'); } catch { } nav(); }
  function nav() {
    let el = document.getElementById('tbar'); if (el) el.remove();
    let bb = document.getElementById('bbar'); if (bb) bb.remove();
    const u = ME.user; let links = [], tabs = [];
    if (!u) {
      links = ['<a href="#/">Eğitimler</a>', '<a href="#/giris">Giriş</a>', '<a href="#/kayit" class="navcta">Kayıt ol</a>'];
      tabs = [['#/', 'home', 'Eğitimler'], ['#/?ara=1', 'search', 'Ara'], ['#/giris', 'key', 'Giriş'], ['#/kayit', 'user', 'Kayıt ol']];
    } else {
      if (u.role === 'student') {
        links = ['<a href="#/">Eğitimler</a>', '<a href="#/derslerim">Derslerim</a>'];
        tabs = [['#/', 'home', 'Ana sayfa'], ['#/derslerim', 'book', 'Derslerim'], ['#/?ara=1', 'search', 'Ara'], ['#/profil', 'user', 'Profil']];
      } else if (isTeacher()) {
        links = ['<a href="#/projeler">Videolar</a>', '<a href="#/egitimler">Eğitimlerim</a>', '<a href="#/ortak-sinav">Ortak sınav</a>', `<a href="#/talepler">Talepler${ME.pending ? ` <b class="badge">${ME.pending}</b>` : ''}</a>`, '<a href="#/sonuclar">Sonuçlar</a>', '<a href="#/paketim">Paketim</a>'];
        tabs = [['#/projeler', 'video', 'Videolar'], ['#/egitimler', 'layers', 'Eğitimler'], ['#/talepler', 'inbox', 'Talepler', ME.pending], ['#/sonuclar', 'chart', 'Sonuçlar'], ['#/profil', 'user', 'Profil']];
      } else tabs = [['#/', 'home', 'Ana sayfa'], ['#/profil', 'user', 'Profil']];
      if (u.role === 'admin') links.push('<a href="#/yonetim">Yönetim</a>');
      links.push(`<a href="#/profil" title="Profil">${esc(u.name)}</a>`, '<button type="button" id="logout" class="linkbtn">Çıkış</button>');
    }
    if (!isStandalone()) links.push(`<a href="#/uygulama" class="appl" title="Telefon uygulaması">📱 Uygulama</a>`);
    const th = curTheme();
    document.querySelector('.top').insertAdjacentHTML('beforeend', `<nav id="tbar" class="tbar" aria-label="Ana menü">${links.join('')}<button type="button" class="themebtn" id="themebtn" title="${THEME_L[th]}" aria-label="${THEME_L[th]}">${THEME_I[th]}</button></nav>`);
    const hcur = location.hash || '#/', hbase = hcur.split('?')[0];
    const active = h => { const b = h.split('?')[0]; if (h.includes('ara=1')) return hcur.includes('ara=1'); if (b === '#/') return (hbase === '#/' || hbase === '#') && !hcur.includes('ara=1'); return hbase === b || hbase.startsWith(b + '/') || (b === '#/projeler' && hbase.startsWith('#/p/')) || (b === '#/egitimler' && (hbase.startsWith('#/egitimler') || hbase.startsWith('#/ortak-sinav'))); };
    document.body.insertAdjacentHTML('beforeend', `<nav id="bbar" class="bbar" aria-label="Alt menü">${tabs.map(([h, ic, l, n]) => `<a href="${h}" class="${active(h) ? 'on' : ''}" ${active(h) ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span>${n ? `<b class="bdot">${n}</b>` : ''}</a>`).join('')}</nav>`);
    document.getElementById('themebtn').onclick = () => setTheme(THEMES[(THEMES.indexOf(curTheme()) + 1) % 3]);
    const lo = document.getElementById('logout'); if (lo) lo.onclick = logout;
    document.querySelectorAll('#tbar a').forEach(a => { if (a.getAttribute('href') === hbase) a.classList.add('on'); });
  }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); ME = { user: null }; location.hash = '#/'; route(); }

  /* ---------- vitrin ---------- */
  async function viewStore() {
    setSub('Öğretmenlerin hazırladığı etkileşimli ders videoları');
    app.innerHTML = `<section class="hero"><div><h1 class="home-h">Ustasından öğren,<br>sorularla pekiştir.</h1>
      <p class="muted home-p">Öğretmenlerin hazırladığı anlatımlı ders videoları bölüm aralarında durur ve soru sorar. Bir öğretmen seç, eğitimine katılım talebi gönder; onaylayınca dersler açılır.</p>
      ${ME.user ? '' : '<div class="btns"><a class="btn primary" href="#/kayit">Öğrenci olarak kaydol</a><a class="btn" href="#/kayit?rol=ogretmen">Öğretmen başvurusu</a></div>'}</div>
      <form class="card codebox" id="sf"><label for="code">Ders kodun var mı?</label><div class="cp"><input id="code" required maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Örn. K7M2PX"><button class="primary" type="submit" id="sgo">Derse gir</button></div><p class="note err-t" id="smsg"></p></form></section>
      <h2>Öğretmenler</h2><div id="tlist" class="tgrid"><div class="empty">Yükleniyor…</div></div>
      <h2>Eğitimler</h2><div class="cfilter"><input id="cq" placeholder="Eğitim, ders ya da öğretmen ara"></div><div id="clist" class="cgrid"></div>`;
    document.getElementById('sf').onsubmit = async e => {
      e.preventDefault(); const b = document.getElementById('sgo'), m = document.getElementById('smsg'); const code = document.getElementById('code').value.trim().replace(/\s+/g, '');
      b.disabled = true; m.textContent = '';
      try { const r = await fetch('/api/l/' + encodeURIComponent(code) + '/check'); const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 401 && r.status !== 403) throw new Error(j.error || 'Ders bulunamadı'); location.href = '/izle/' + encodeURIComponent(j.code || code.toUpperCase()); }
      catch (err) { m.textContent = err.message === 'Ders bulunamadı ya da yayında değil' ? 'Bu kodla bir ders bulunamadı. Kodu kontrol edin.' : err.message; b.disabled = false; }
    };
    let d; try { d = await api('/api/catalog'); } catch (e) { document.getElementById('tlist').innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    document.getElementById('tlist').innerHTML = d.teachers.length ? d.teachers.map(t => `<a class="tcard" href="#/o/${esc(t.slug)}"><span class="av">${esc(initials(t.name))}</span><span><b>${esc(t.name)}</b><span class="note">${esc([t.subject, t.school].filter(Boolean).join(' · '))}</span><span class="note">${t.courses} eğitim</span></span></a>`).join('') : '<div class="empty">Henüz yayında eğitim yok.</div>';
    const draw = () => {
      const k = document.getElementById('cq').value.trim().toLocaleLowerCase('tr');
      const list = d.courses.filter(c => !k || [c.title, c.subject, c.description, c.teacher.name].join(' ').toLocaleLowerCase('tr').includes(k));
      document.getElementById('clist').innerHTML = list.length ? list.map(courseCard).join('') : '<div class="empty">Eşleşen eğitim yok.</div>';
    };
    document.getElementById('cq').oninput = draw; draw();
    if (qsOf().get('ara')) { const cq = document.getElementById('cq'); cq.scrollIntoView({ block: 'center' }); setTimeout(() => cq.focus(), 50); }
  }
  const courseCard = c => `<a class="ccard" href="#/e/${esc(c.id)}">${thumbBox(c.thumb, 'ccover')}<span class="ctag">${esc(c.subject || 'Eğitim')}</span><b>${esc(c.title)}</b>${c.teacher ? `<span class="note">${esc(c.teacher.name)}</span>` : ''}<span class="cmeta"><span>${c.lessons} ders</span><span class="acc acc-${c.access}">${c.access === 'paid' ? tl(c.price_cents) : ACCESS[c.access]}</span></span></a>`;

  async function viewTeacher(slug) {
    let d; try { d = await api('/api/t/' + encodeURIComponent(slug)); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const t = d.teacher; setSub(t.name);
    app.innerHTML = `<p class="muted"><a href="#/">← Tüm eğitimler</a></p><div class="tprof"><span class="av big">${esc(initials(t.name))}</span><div><h1>${esc(t.name)}</h1><p class="muted">${esc([t.subject, t.school].filter(Boolean).join(' · '))}</p></div></div>
      ${t.bio ? `<div class="card"><p style="margin:0;white-space:pre-wrap">${esc(t.bio)}</p></div>` : ''}
      <h2>Eğitimleri</h2><div class="cgrid">${d.courses.length ? d.courses.map(c => courseCard({ ...c, teacher: null })).join('') : '<div class="empty">Yayında eğitim yok.</div>'}</div>`;
  }

  async function viewCourse(id) {
    let d; try { d = await api('/api/courses/' + id); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const c = d.course, e = d.enrollment, t = c.teacher || {}; setSub(c.title);
    let action = '';
    const approved = e && e.status === 'approved';
    if (d.mine) action = `<p class="note">Bu sizin eğitiminiz.</p><div class="btns"><a class="btn" href="#/egitimler/${esc(c.id)}">Düzenle</a></div>`;
    else if (!ME.user) action = `<p>${c.access === 'open' ? 'Kaydolup hemen başlayabilirsiniz.' : c.access === 'paid' ? `Ücret: <b>${tl(c.price_cents)}</b>` : 'Katılmak için öğretmenden onay istenir.'}</p><div class="btns"><a class="btn primary" href="#/kayit?r=${encodeURIComponent('#/e/' + c.id)}">Kaydol ve katıl</a><a class="btn" href="#/giris?r=${encodeURIComponent('#/e/' + c.id)}">Giriş yap</a></div>`;
    else if (ME.user.role !== 'student') action = '<p class="note">Eğitimlere öğrenci hesabıyla katılınır.</p>';
    else if (approved) action = '<p style="color:var(--green)"><b>✓ Bu eğitime kayıtlısınız.</b> Aşağıdan derslere başlayın.</p>';
    else if (e && e.status === 'pending') action = `<p><b>Talebiniz ${e.source === 'purchase' ? 'ödeme onayı' : 'öğretmenin onayını'} bekliyor.</b></p><div class="btns"><button data-c="cancel">Talebi geri çek</button></div>`;
    else if (e && e.status === 'revoked') action = '<p class="err-t">Öğretmen bu eğitime erişiminizi kapattı.</p>';
    else action = `${e && e.status === 'rejected' ? '<p class="note">Önceki talebiniz kabul edilmedi. Yeniden talep gönderebilirsiniz.</p>' : ''}${c.access === 'paid' ? `<p>Ücret: <b>${tl(c.price_cents)}</b> <span class="note">· Çevrim içi ödeme yakında</span></p>` : ''}${c.access !== 'open' ? '<label for="rm">Öğretmene not (isteğe bağlı)</label><input id="rm" maxlength="500" placeholder="Örn. 11-B sınıfındayım">' : ''}<div class="btns"><button class="primary" data-c="req">${c.access === 'open' ? 'Eğitime katıl' : c.access === 'paid' ? 'Satın alma talebi gönder' : 'Katılım talebi gönder'}</button></div>`;
    app.innerHTML = `<p class="muted"><a href="#/">← Tüm eğitimler</a>${t.slug ? ` · <a href="#/o/${esc(t.slug)}">${esc(t.name)}</a>` : ''}</p>
      <span class="ctag">${esc(c.subject || 'Eğitim')}${c.level ? ' · ' + esc(c.level) : ''}</span><h1>${esc(c.title)}</h1>
      <div class="grid two" style="align-items:start"><div>${c.description ? `<div class="card"><p style="margin:0;white-space:pre-wrap">${esc(c.description)}</p></div>` : ''}
        <h2>Dersler <span class="muted" style="font-size:14px">· ${d.lessons.length}</span></h2><div class="list">${d.lessons.map(l => l.code ? lessonRow(l, l.n - 1) : `<div class="row locked lrow">${thumbBox(l.thumb)}<span class="lmain"><span class="ltitle"><b class="muted">${l.n}.</b> ${esc(l.title)}</span></span><span class="note">${l.ready ? '🔒' : 'hazırlanıyor'}</span></div>`).join('') || '<div class="empty">Henüz ders yok.</div>'}</div></div>
        <div class="card"><div class="tprof sm"><span class="av">${esc(initials(t.name))}</span><div><b>${esc(t.name || '')}</b><div class="note">${esc([t.subject, t.school].filter(Boolean).join(' · '))}</div></div></div>
        <p class="note">${ACCESS[c.access]}${c.access === 'paid' ? ' · ' + tl(c.price_cents) : ''}</p>${action}<p class="note err-t" id="cmsg"></p></div></div>`;
    app.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
      b.disabled = true; const m = document.getElementById('cmsg');
      try {
        if (b.dataset.c === 'cancel') { await api(`/api/courses/${id}/cancel`, { method: 'POST' }); return route(); }
        const r = await api(`/api/courses/${id}/request`, { method: 'POST', body: { message: (document.getElementById('rm') || {}).value } });
        await route(); const m2 = document.getElementById('cmsg'); if (m2) { m2.style.color = 'var(--green)'; m2.textContent = r.message; }
      } catch (err) { m.textContent = err.message; b.disabled = false; }
    });
  }

  /* ---------- giriş / kayıt ---------- */
  const goBack = def => { const r = qsOf().get('r'); if (r && r.startsWith('/izle/')) location.href = r; else location.hash = r && r.startsWith('#/') ? r : def; };
  const homeOf = u => u.role === 'student' ? '#/derslerim' : u.role === 'admin' ? '#/yonetim' : '#/projeler';
  function viewLogin() {
    setSub('Giriş');
    const r = qsOf().get('r');
    app.innerHTML = `<form class="card auth" id="lf"><h1>Giriş yap</h1>
      <label for="em">E-posta</label><input id="em" type="text" inputmode="email" autocomplete="username" required>
      <label for="pw">Şifre</label><input id="pw" type="password" autocomplete="current-password" required>
      <div class="btns"><button class="primary" type="submit" id="go">Giriş yap</button></div><p class="note err-t" id="msg"></p>
      <p class="note">Hesabınız yok mu? <a href="#/kayit${r ? '?r=' + encodeURIComponent(r) : ''}">Kayıt olun</a>. Şifrenizi unuttuysanız öğretmeninizden ya da yöneticiden yeni şifre isteyin.</p></form>`;
    document.getElementById('lf').onsubmit = async e => {
      e.preventDefault(); const b = document.getElementById('go'); b.disabled = true;
      try { const j = await api('/api/auth/login', { method: 'POST', body: { email: document.getElementById('em').value, password: document.getElementById('pw').value } }); ME = { user: j.user }; goBack(homeOf(j.user)); route(); }
      catch (err) { document.getElementById('msg').textContent = err.message; b.disabled = false; }
    };
  }
  function viewRegister() {
    setSub('Kayıt');
    let role = qsOf().get('rol') === 'ogretmen' ? 'teacher' : 'student';
    const draw = () => {
      app.innerHTML = `<form class="card auth" id="rf"><h1>Kayıt ol</h1>
        <div class="seg" role="tablist"><button type="button" role="tab" aria-selected="${role === 'student'}" data-r="student">Öğrenciyim</button><button type="button" role="tab" aria-selected="${role === 'teacher'}" data-r="teacher">Öğretmenim</button></div>
        <p class="note">${role === 'student' ? 'Öğretmenlerin eğitimlerine katılım talebi gönderin, derslerinizi ve sonuçlarınızı tek yerden izleyin.' : 'Başvurunuz yönetici onayından sonra açılır. Onaylanınca deneme paketiyle video üretmeye ve eğitim yayınlamaya başlarsınız.'}</p>
        <label for="nm">Ad soyad</label><input id="nm" required minlength="3" maxlength="80" autocomplete="name">
        <label for="em">E-posta</label><input id="em" type="email" required autocomplete="email">
        <label for="pw">Şifre <span class="muted" style="text-transform:none;letter-spacing:0">(en az 8 karakter)</span></label><input id="pw" type="password" required minlength="8" autocomplete="new-password">
        <label for="sc">${role === 'student' ? 'Okul / sınıf' : 'Okul / kurum'} <span class="muted" style="text-transform:none;letter-spacing:0">(isteğe bağlı)</span></label><input id="sc" maxlength="120">
        ${role === 'teacher' ? `<label for="sj">Branş</label><input id="sj" required maxlength="80" placeholder="Örn. Elektrik-Elektronik Teknolojisi"><label for="bi">Kendinizi kısaca tanıtın</label><textarea id="bi" maxlength="1000" placeholder="Deneyiminiz, verdiğiniz dersler…"></textarea>` : ''}
        <div class="btns"><button class="primary" type="submit" id="go">${role === 'student' ? 'Kaydol' : 'Başvuruyu gönder'}</button></div><p class="note err-t" id="msg"></p>
        <p class="note">Zaten hesabınız var mı? <a href="#/giris${qsOf().get('r') ? '?r=' + encodeURIComponent(qsOf().get('r')) : ''}">Giriş yapın</a>.</p></form>`;
      app.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { role = b.dataset.r; draw(); });
      document.getElementById('rf').onsubmit = async e => {
        e.preventDefault(); const b = document.getElementById('go'); b.disabled = true; const v = id => (document.getElementById(id) || {}).value;
        try { const j = await api('/api/auth/register', { method: 'POST', body: { role, name: v('nm'), email: v('em'), password: v('pw'), school: v('sc'), subject: v('sj'), bio: v('bi') } }); ME = { user: j.user }; if (role === 'teacher') location.hash = '#/basvuru'; else goBack('#/'); route(); }
        catch (err) { document.getElementById('msg').textContent = err.message; b.disabled = false; }
      };
    };
    draw();
  }
  function viewPendingTeacher() {
    setSub('Öğretmen başvurusu');
    const st = ME.user.status;
    app.innerHTML = `<div class="card auth"><h1>${st === 'pending' ? 'Başvurunuz alındı' : 'Hesap durumu'}</h1><p>${st === 'pending' ? `Teşekkürler ${esc(ME.user.name)}. Başvurunuz yönetici tarafından inceleniyor. Onaylandığında bu sayfadan video üretmeye ve eğitim yayınlamaya başlayabilirsiniz.` : 'Hesabınız şu an etkin değil.'}</p><div class="btns"><button id="rf">Durumu yenile</button><a class="btn" href="#/profil">Profil</a></div></div>`;
    document.getElementById('rf').onclick = () => route();
  }

  /* ---------- profil ---------- */
  /* ---------- logo ---------- */
  const LOGO_POS_OPTS = [['tr', 'Sağ üst'], ['tl', 'Sol üst'], ['br', 'Sağ alt'], ['bl', 'Sol alt']];
  const LOGO_SIZE_OPTS = [['0.1', 'Küçük'], ['0.14', 'Orta'], ['0.2', 'Büyük']];
  const LOGO_OP_OPTS = [['1', 'Tam görünür'], ['0.8', 'Hafif saydam'], ['0.55', 'Saydam (filigran)']];
  // Dosyayı en fazla 600 px'e küçültüp PNG'ye çevirir (saydamlık korunur)
  function fileToLogo(file) {
    return new Promise((ok, no) => {
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return no(new Error('PNG, JPG, WEBP ya da SVG seçin'));
      if (file.size > 8e6) return no(new Error('Dosya çok büyük (en fazla 8 MB)'));
      const r = new FileReader(); r.onerror = () => no(new Error('Dosya okunamadı'));
      r.onload = () => { const im = new Image(); im.onerror = () => no(new Error('Görsel açılamadı')); im.onload = () => {
        const k = Math.min(1, 600 / Math.max(im.width || 600, im.height || 600)), cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round((im.width || 600) * k)); cv.height = Math.max(1, Math.round((im.height || 600) * k));
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); ok(cv.toDataURL('image/png')); }; im.src = r.result; };
      r.readAsDataURL(file);
    });
  }
  const optsHtml = (opts, cur) => opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
  // Logo ayar kutusu: önizleme (konum/boyut/saydamlık örnek kare üstünde), dosya, konum, boyut, saydamlık
  function logoFields(pfx, l) {
    l = l || {};
    return `<div class="logoprev" id="${pfx}pv"><div class="lpframe"><img id="${pfx}img" alt="" ${l.url ? `src="${esc(l.url)}"` : 'hidden'}></div></div>
      <label for="${pfx}f">Logo dosyası <span class="muted opt">(PNG önerilir; saydam arka planlı logo en iyi sonucu verir)</span></label><input id="${pfx}f" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">
      <div class="grid3"><div><label for="${pfx}pos">Konum</label><select id="${pfx}pos">${optsHtml(LOGO_POS_OPTS, l.pos || 'tr')}</select></div>
      <div><label for="${pfx}sz">Boyut</label><select id="${pfx}sz">${optsHtml(LOGO_SIZE_OPTS, l.size || 0.14)}</select></div>
      <div><label for="${pfx}op">Saydamlık</label><select id="${pfx}op">${optsHtml(LOGO_OP_OPTS, l.opacity != null ? (l.opacity >= .95 ? 1 : l.opacity >= .7 ? .8 : .55) : .8)}</select></div></div>`;
  }
  function wireLogoFields(pfx, state) {
    const img = document.getElementById(pfx + 'img'), fr = img.parentElement;
    const apply = () => { const pos = document.getElementById(pfx + 'pos').value, sz = +document.getElementById(pfx + 'sz').value; fr.className = 'lpframe p-' + pos; img.style.width = (sz * 100 / .56) + '%'; img.style.opacity = document.getElementById(pfx + 'op').value; };
    ['pos', 'sz', 'op'].forEach(k => document.getElementById(pfx + k).onchange = apply); apply();
    document.getElementById(pfx + 'f').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { state.data = await fileToLogo(f); img.src = state.data; img.hidden = false; } catch (err) { alert(err.message); e.target.value = ''; } };
    return () => ({ pos: document.getElementById(pfx + 'pos').value, size: +document.getElementById(pfx + 'sz').value, opacity: +document.getElementById(pfx + 'op').value, data: state.data || undefined });
  }
  async function logoProfileCard(el, note) {
    let d; try { d = await api('/api/me/logo'); } catch (e) { el.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    el.innerHTML = `<p class="note">Bu logo, aksi seçilmedikçe <b>bütün videolarınıza</b> eklenir. Bir videoda farklı logo ya da logosuz video isterseniz o videonun sayfasından değiştirebilirsiniz.</p>${logoFields('ml', d.logo)}
      <div class="btns"><button class="primary" id="mlsave">Kaydet</button>${d.logo ? '<button class="danger" id="mldel">Logoyu kaldır</button>' : ''}</div><p class="note" id="mlmsg" ${note ? 'style="color:var(--green)"' : ''}>${note || ''}</p>`;
    const st = {}, get = wireLogoFields('ml', st), msg = document.getElementById('mlmsg');
    document.getElementById('mlsave').onclick = async () => { try { await api('/api/me/logo', { method: 'POST', body: get() }); logoProfileCard(el, 'Kaydedildi. Yeni üretilen videolarda kullanılacak.'); } catch (e) { msg.style.color = ''; msg.textContent = e.message; } };
    const del = document.getElementById('mldel'); if (del) del.onclick = async () => { if (!confirm('Varsayılan logo kaldırılsın mı?')) return; await api('/api/me/logo', { method: 'POST', body: { remove: true } }); logoProfileCard(el); };
  }
  async function logoProjectCard(el, id) {
    let d; try { d = await api(`/api/projects/${id}/logo`); } catch (e) { el.innerHTML = ''; return; }
    const r = (v, l, extra = '') => `<label class="tile"><input type="radio" name="lgm" value="${v}" ${d.mode === v ? 'checked' : ''}><b>${l}</b>${extra ? `<span>${extra}</span>` : ''}</label>`;
    el.innerHTML = `<h2>Logo</h2><div class="card"><div class="tiles row3">${r('default', 'Varsayılan logom', d.hasDefault ? 'Profildeki logo' : 'Henüz yok — <a href="#/profil">Profil</a>')}${r('custom', 'Bu videoya özel')}${r('none', 'Logo yok')}</div>
      <div id="lgc" hidden>${logoFields('pl', d.custom)}</div>
      <div class="btns"><button class="primary" id="lgsave">Logoyu kaydet</button></div><p class="note" id="lgmsg">Değişiklik bir sonraki video üretiminde uygulanır (teslim edilmiş videoyu yeni logoyla almak için "Başka biçimde üret" kullanılabilir).</p></div>`;
    const st = {}, get = wireLogoFields('pl', st), cw = document.getElementById('lgc'), mode = () => (el.querySelector('input[name="lgm"]:checked') || {}).value || 'default';
    const sync = () => { cw.hidden = mode() !== 'custom'; }; el.querySelectorAll('input[name="lgm"]').forEach(x => x.onchange = sync); sync();
    document.getElementById('lgsave').onclick = async () => { const msg = document.getElementById('lgmsg'); try { await api(`/api/projects/${id}/logo`, { method: 'POST', body: { mode: mode(), ...(mode() === 'custom' ? get() : {}) } }); msg.style.color = 'var(--green)'; msg.textContent = 'Kaydedildi. Önizleme sayfa yenilenince güncellenir.'; } catch (e) { msg.style.color = ''; msg.textContent = e.message; } };
  }

  async function viewProfile() {
    setSub('Profil');
    const u = ME.user;
    const qlinks = [u.role !== 'student' && isTeacher() ? ['#/paketim', 'Paketim'] : null, u.role === 'admin' ? ['#/yonetim', 'Yönetim'] : null, u.role === 'student' ? ['#/derslerim', 'Derslerim'] : ['#/projeler', 'Videolar'], ['#/', 'Eğitim vitrini'], isStandalone() ? null : ['#/uygulama', 'Telefon uygulaması']].filter(Boolean);
    app.innerHTML = `<h1>Profil</h1>
      <div class="card qcard"><div class="qlinks">${qlinks.map(([h, l]) => `<a class="btn" href="${h}">${l}</a>`).join('')}<button type="button" class="btn danger" id="lo2">Çıkış yap</button></div>
      <label for="thm">Görünüm</label><select id="thm"><option value="">Otomatik (telefonun ayarı)</option><option value="light">Açık</option><option value="dark">Koyu</option></select></div>
      ${u.role !== 'student' && isTeacher() ? '<h2>Logom</h2><div class="card" id="logoc"><p class="note">Yükleniyor…</p></div>' : ''}
      <h2>Bildirimler</h2><div class="card" id="pushc"><p class="note">Yükleniyor…</p></div>
      <h2>Bilgilerim</h2><form class="card" id="pf"><label for="nm">Ad soyad</label><input id="nm" value="${esc(u.name)}" required minlength="3">
      <label>E-posta</label><input value="${esc(u.email)}" disabled>
      <label for="sc">Okul / kurum</label><input id="sc" value="${esc(u.school || '')}" maxlength="120">
      ${u.role !== 'student' ? `<label for="sj">Branş</label><input id="sj" value="${esc(u.subject || '')}" maxlength="80"><label for="bi">Tanıtım</label><textarea id="bi" maxlength="1000">${esc(u.bio || '')}</textarea>
      <label for="sl">Profil adresi</label><div class="cp"><span class="note" style="align-self:center">${esc(location.origin)}/#/o/</span><input id="sl" value="${esc(u.slug || '')}" maxlength="60"></div>` : ''}
      <div class="btns"><button class="primary" type="submit">Kaydet</button>${u.role !== 'student' && u.slug ? `<a class="btn" href="#/o/${esc(u.slug)}">Herkese açık profilim</a>` : ''}</div><p class="note" id="m1"></p></form>
      <h2>Şifre değiştir</h2><form class="card" id="wf"><label for="op">Mevcut şifre</label><input id="op" type="password" required autocomplete="current-password"><label for="np">Yeni şifre</label><input id="np" type="password" required minlength="8" autocomplete="new-password"><div class="btns"><button type="submit">Şifreyi değiştir</button></div><p class="note" id="m2"></p></form>`;
    const thm = document.getElementById('thm'); thm.value = curTheme(); thm.onchange = () => setTheme(thm.value);
    pushCard(document.getElementById('pushc'));
    if (document.getElementById('logoc')) logoProfileCard(document.getElementById('logoc'));
    document.getElementById('lo2').onclick = logout;
    const v = id => (document.getElementById(id) || {}).value;
    document.getElementById('pf').onsubmit = async e => { e.preventDefault(); const m = document.getElementById('m1'); try { const body = { name: v('nm'), school: v('sc') }; if (u.role !== 'student') Object.assign(body, { subject: v('sj'), bio: v('bi'), slug: v('sl') }); await api('/api/me/profile', { method: 'POST', body }); m.style.color = 'var(--green)'; m.textContent = 'Kaydedildi.'; } catch (err) { m.style.color = ''; m.textContent = err.message; } };
    document.getElementById('wf').onsubmit = async e => { e.preventDefault(); const m = document.getElementById('m2'); try { await api('/api/me/profile', { method: 'POST', body: { password: v('op'), new_password: v('np') } }); m.style.color = 'var(--green)'; m.textContent = 'Şifreniz değişti.'; e.target.reset(); } catch (err) { m.style.color = ''; m.textContent = err.message; } };
  }

  /* ---------- öğrenci paneli ---------- */
  // ders satırı: kapak, başlık, ilerleme
  const thumbBox = (src, cls = 'lthumb') => `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<i aria-hidden="true">${icon('video')}</i>`}</span>`;
  const progBadge = p => !p ? '' : p.done ? `<span class="okmark" title="Tamamlandı">✓${p.score != null ? ` %${p.score}` : ''}</span>` : p.pct ? `<span class="pctxt">%${p.pct}</span>` : '';
  const lessonRow = (l, i) => `<a class="row lrow" href="/izle/${esc(l.code)}">${thumbBox(l.thumb)}<span class="lmain"><span class="ltitle"><b class="muted">${i + 1}.</b> ${esc(l.title)}</span>${l.progress && !l.progress.done && l.progress.pct ? `<span class="pbar"><i style="width:${l.progress.pct}%"></i></span>` : ''}</span>${progBadge(l.progress) || `<span class="note">${l.quiz ? 'Başla ▶' : 'İzle ▶'}</span>`}</a>`;
  async function viewMyLearning() {
    setSub('Derslerim');
    let d; try { d = await api('/api/me/courses'); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const ok = d.courses.filter(x => x.enrollment.status === 'approved'), wait = d.courses.filter(x => x.enrollment.status === 'pending'), other = d.courses.filter(x => !['approved', 'pending'].includes(x.enrollment.status));
    const c = d.continue;
    const cont = c ? `<a class="contcard" href="/izle/${esc(c.code)}">${thumbBox(c.thumb, 'cthumb2')}<span class="cinfo"><span class="ctag">${c.first ? 'Başla' : c.next ? 'Sıradaki ders' : 'Kaldığın yerden devam et'}</span><b>${esc(c.title)}</b><span class="note">${esc(c.course)}</span>${c.progress && !c.progress.done && c.progress.pct ? `<span class="pbar"><i style="width:${c.progress.pct}%"></i></span>` : ''}</span><span class="playbtn" aria-hidden="true">▶</span></a>` : '';
    setTimeout(() => pushNudge('ogrenci'), 1500);
    app.innerHTML = `<h1>Derslerim</h1>${cont}
      ${ok.length ? ok.map(x => { const n = (x.lessons || []).length, dn = x.done || 0; return `<div class="card mcourse"><div class="aud-head"><div><a href="#/e/${esc(x.course.id)}"><b style="font:800 18px var(--display)">${esc(x.course.title)}</b></a><div class="note">${esc(x.course.teacher ? x.course.teacher.name : '')}</div></div><span class="pill" style="color:${n && dn === n ? 'var(--green)' : 'var(--muted)'}">${n ? `${dn}/${n} ders` : 'Kayıtlı'}</span></div>
        ${n ? `<div class="pbar big" title="${dn}/${n} tamamlandı"><i style="width:${Math.round(dn / n * 100)}%"></i></div>` : ''}
        <div class="list" style="margin-top:10px">${(x.lessons || []).map(lessonRow).join('') || '<div class="empty">Bu eğitimde henüz izlenebilir ders yok.</div>'}</div></div>`; }).join('') : `<div class="card"><p>Henüz kayıtlı olduğunuz bir eğitim yok.</p><div class="btns"><a class="btn primary" href="#/">Eğitimlere göz at</a></div></div>`}
      ${wait.length ? `<h2>Onay bekleyen talepler</h2><div class="list">${wait.map(x => `<a class="row" href="#/e/${esc(x.course.id)}"><span>${esc(x.course.title)} <span class="note">· ${esc(x.course.teacher ? x.course.teacher.name : '')}</span></span><span class="pill" style="color:var(--yel-t)">${x.enrollment.source === 'purchase' ? 'Ödeme bekliyor' : 'Onay bekliyor'}</span></a>`).join('')}</div>` : ''}
      ${other.length ? `<h2>Diğer</h2><div class="list">${other.map(x => `<a class="row" href="#/e/${esc(x.course.id)}"><span>${esc(x.course.title)}</span><span class="note">${ENR[x.enrollment.status]}</span></a>`).join('')}</div>` : ''}
      ${d.results.length ? `<h2>Sonuçlarım</h2><div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Ders</th><th>Tarih</th><th>Puan</th><th>Kazanım</th></tr></thead><tbody>${d.results.map(r => `<tr><td>${r.code ? `<a href="/izle/${esc(r.code)}">${esc(r.title || '')}</a>` : esc(r.title || '')}</td><td>${fmtDate(r.finished_at || r.started_at)}</td><td>${r.summary ? '%' + r.summary.pct : '<span class="note">yarım</span>'}</td><td>${r.summary ? `${r.summary.learned}/${r.summary.kazanim}` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  }

  /* ---------- öğretmen: eğitimlerim ---------- */
  async function viewMyCourses() {
    setSub('Eğitimlerim');
    let list; try { list = await api('/api/my/courses'); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    app.innerHTML = `<h1>Eğitimlerim</h1><p class="muted">Videolarınızı eğitim (ders serisi) olarak gruplayın; öğrenciler ana sayfadaki vitrinden görüp katılım talebi gönderir.</p>
      <form class="card" id="nc"><label for="ct">Yeni eğitim adı</label><div class="cp"><input id="ct" required minlength="3" maxlength="140" placeholder="Örn. Asenkron motorlar ve yol verme"><button class="primary" type="submit">Oluştur</button></div><p class="note err-t" id="m"></p></form>
      <a class="promo" href="#/ortak-sinav"><span class="pico" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3h6v3H9zM8.5 12l2 2 4-4M8.5 17h7"/></svg></span><span class="ptx"><b>Ortak sınav hazırlığı</b><span>MEB senaryolarından hazırlık videoları ve kazanım testi</span></span><span class="parr" aria-hidden="true">→</span></a>
      <h2>Eğitimler</h2><div class="list">${list.length ? list.map(c => `<a class="row" href="#/egitimler/${esc(c.id)}"><span><b>${esc(c.title)}</b><span class="note"> · ${c.lessons} ders · ${c.students} öğrenci${c.pending ? ` · <b style="color:var(--yel)">${c.pending} talep</b>` : ''}</span></span><span class="pill" style="color:${c.status === 'published' ? 'var(--green)' : 'var(--muted)'}">${c.status === 'published' ? 'Yayında' : 'Taslak'}</span></a>`).join('') : '<div class="empty">Henüz eğitim yok. Yukarıdan ilkini oluşturun.</div>'}</div>`;
    document.getElementById('nc').onsubmit = async e => { e.preventDefault(); try { const c = await api('/api/my/courses', { method: 'POST', body: { title: document.getElementById('ct').value } }); location.hash = '#/egitimler/' + c.id; } catch (err) { document.getElementById('m').textContent = err.message; } };
  }
  async function viewEditCourse(cid) {
    let d, projects; try { [d, projects] = await Promise.all([api('/api/my/courses/' + cid), api('/api/projects')]); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const c = d.course; setSub(c.title);
    let items = d.items.map(p => p.id);
    const pm = Object.fromEntries(projects.map(p => [p.id, p])); d.items.forEach(p => { if (!pm[p.id]) pm[p.id] = p; });
    const sellable = ME.plan && ME.plan.limits && ME.plan.limits.sell_courses;
    app.innerHTML = `<p class="muted"><a href="#/egitimler">← Eğitimlerim</a></p><h1>${esc(c.title)}</h1>
      <form class="card" id="cf"><label for="ct">Eğitim adı</label><input id="ct" value="${esc(c.title)}" required minlength="3" maxlength="140">
        <div class="grid two"><div><label for="cs">Ders / alan</label><input id="cs" value="${esc(c.subject || '')}" maxlength="80" placeholder="Elektrik-Elektronik"></div><div><label for="cl">Düzey</label><input id="cl" value="${esc(c.level || '')}" maxlength="80" placeholder="11. sınıf"></div></div>
        <label for="cd">Açıklama</label><textarea id="cd" maxlength="3000" placeholder="Bu eğitimde neler öğrenilecek, kimler için uygun…">${esc(c.description || '')}</textarea>
        <div class="grid two"><div><label for="ca">Katılım</label><select id="ca"><option value="request">Öğretmen onayıyla (talep)</option><option value="open">Serbest (kayıtlı her öğrenci)</option><option value="paid" ${sellable ? '' : 'disabled'}>Ücretli${sellable ? '' : ' (paketiniz izin vermiyor)'}</option></select></div>
          <div id="pw2"><label for="cp">Fiyat (TL)</label><input id="cp" inputmode="decimal" value="${c.price_cents ? c.price_cents / 100 : ''}" placeholder="Örn. 149"></div></div>
        <label for="cv">Görünürlük</label><select id="cv"><option value="public">Vitrinde listelensin</option><option value="unlisted">Listelenmesin (yalnızca bağlantıyla)</option></select>
        <h2 style="margin-top:22px">Dersler</h2><p class="note">Sıralamak için okları kullanın. Yalnızca teslim edilmiş videolar öğrencilere açılır.</p><div id="items" class="list"></div>
        <label for="add">Video ekle</label><div class="cp"><select id="add"></select><button type="button" id="addb">Ekle</button></div>
        <div class="btns"><button class="primary" type="submit" data-s="published">Kaydet ve yayınla</button><button type="submit" data-s="draft">Taslak olarak kaydet</button><a class="btn" href="#/e/${esc(c.id)}">Önizle</a><button type="button" class="danger" id="del">Eğitimi sil</button></div><p class="note" id="m"></p></form>
      <div id="plan"></div>
      <h2>Öğrenci ekle</h2><form class="card" id="gf"><p class="note">Siteye kayıtlı bir öğrenciyi talep beklemeden bu eğitime ekleyin.</p><div class="cp"><input id="ge" type="email" required placeholder="ogrenci@ornek.com"><button type="submit">Ekle</button></div><p class="note" id="gm"></p></form>`;
    if (c.plan && Array.isArray(c.plan.weeks)) drawPlan(c, pm);
    document.getElementById('ca').value = c.access; document.getElementById('cv').value = c.visibility;
    const pw = () => { document.getElementById('pw2').hidden = document.getElementById('ca').value !== 'paid'; }; document.getElementById('ca').onchange = pw; pw();
    const drawItems = () => {
      document.getElementById('items').innerHTML = items.length ? items.map((id, i) => { const p = pm[id] || { title: '?' }; return `<div class="row"><span><b class="muted">${i + 1}.</b> ${esc(p.title)} ${p.status !== 'delivered' ? '<span class="note">(henüz teslim edilmedi)</span>' : ''}</span><span class="ibtn"><button type="button" data-u="${i}" ${i ? '' : 'disabled'} aria-label="Yukarı">↑</button><button type="button" data-d="${i}" ${i < items.length - 1 ? '' : 'disabled'} aria-label="Aşağı">↓</button><button type="button" data-x="${i}" aria-label="Çıkar">✕</button></span></div>`; }).join('') : '<div class="empty">Henüz ders eklenmedi.</div>';
      const free = projects.filter(p => !items.includes(p.id) && p.status !== 'failed');
      document.getElementById('add').innerHTML = free.length ? free.map(p => `<option value="${esc(p.id)}">${esc(p.title)}${p.status !== 'delivered' ? ' (hazırlanıyor)' : ''}</option>`).join('') : '<option value="">Eklenecek video yok</option>';
      app.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { const i = +b.dataset.u; [items[i - 1], items[i]] = [items[i], items[i - 1]]; drawItems(); });
      app.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const i = +b.dataset.d; [items[i + 1], items[i]] = [items[i], items[i + 1]]; drawItems(); });
      app.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { items.splice(+b.dataset.x, 1); drawItems(); });
    };
    drawItems();
    document.getElementById('addb').onclick = () => { const v = document.getElementById('add').value; if (v) { items.push(v); drawItems(); } };
    let want = 'published'; app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { want = b.dataset.s; });
    document.getElementById('cf').onsubmit = async e => {
      e.preventDefault(); const m = document.getElementById('m'); const v = id => document.getElementById(id).value;
      try { const r = await api('/api/my/courses/' + cid, { method: 'POST', body: { title: v('ct'), subject: v('cs'), level: v('cl'), description: v('cd'), access: v('ca'), price: v('cp'), visibility: v('cv'), items, status: want } }); m.style.color = r.warning ? 'var(--yel)' : 'var(--green)'; m.textContent = r.warning || (r.status === 'published' ? 'Kaydedildi, eğitim yayında.' : 'Taslak olarak kaydedildi.'); }
      catch (err) { m.style.color = ''; m.textContent = err.message; }
    };
    document.getElementById('del').onclick = async () => { if (!confirm('Bu eğitim silinsin mi? Öğrencilerin erişimi kapanır; videolarınız silinmez.')) return; await api('/api/my/courses/' + cid, { method: 'DELETE' }); location.hash = '#/egitimler'; };
    document.getElementById('gf').onsubmit = async e => { e.preventDefault(); const m = document.getElementById('gm'); try { const r = await api(`/api/my/courses/${cid}/grant`, { method: 'POST', body: { email: document.getElementById('ge').value } }); m.style.color = 'var(--green)'; m.textContent = `${r.name} eğitime eklendi.`; e.target.reset(); } catch (err) { m.style.color = ''; m.textContent = err.message; } };
  }
  async function viewRequests() {
    setSub('Katılım talepleri ve öğrenciler');
    let list; try { list = await api('/api/my/requests'); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const pend = list.filter(x => x.status === 'pending'), rest = list.filter(x => x.status !== 'pending');
    const row = x => `<tr><td><b>${esc(x.student ? x.student.name : '?')}</b><div class="note">${esc(x.student ? x.student.email : '')}${x.student && x.student.school ? ' · ' + esc(x.student.school) : ''}</div>${x.message ? `<div class="note" style="white-space:normal;max-width:360px">“${esc(x.message)}”</div>` : ''}</td><td>${esc(x.course.title)}</td><td>${fmtDate(x.created_at)}</td><td>${x.status === 'pending' ? (x.source === 'purchase' ? '<span class="note">ödeme bekleniyor</span>' : `<span class="ibtn"><button class="primary" data-e="${esc(x.id)}" data-a="approve">Kabul et</button><button data-e="${esc(x.id)}" data-a="reject">Reddet</button></span>`) : x.status === 'approved' ? `<span style="color:var(--green)">Kayıtlı</span> <button class="linkbtn" data-e="${esc(x.id)}" data-a="revoke">erişimi kapat</button>` : `${ENR[x.status]}${x.status !== 'rejected' ? ` <button class="linkbtn" data-e="${esc(x.id)}" data-a="restore">yeniden aç</button>` : ''}`}</td></tr>`;
    app.innerHTML = `<h1>Talepler ve öğrenciler</h1>
      <h2>Bekleyen talepler <span class="muted" style="font-size:14px">· ${pend.length}</span></h2>${pend.length ? `<div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Öğrenci</th><th>Eğitim</th><th>Tarih</th><th></th></tr></thead><tbody>${pend.map(row).join('')}</tbody></table></div>` : '<div class="empty">Bekleyen talep yok.</div>'}
      <h2>Öğrenciler</h2>${rest.length ? `<div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Öğrenci</th><th>Eğitim</th><th>Tarih</th><th>Durum</th></tr></thead><tbody>${rest.map(row).join('')}</tbody></table></div>` : '<div class="empty">Henüz öğrenci yok.</div>'}<p class="note err-t" id="m"></p>`;
    app.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => { if (b.dataset.a === 'revoke' && !confirm('Bu öğrencinin eğitime erişimi kapatılsın mı?')) return; b.disabled = true; try { await api('/api/my/enrollments/' + b.dataset.e, { method: 'POST', body: { action: b.dataset.a } }); route(); } catch (err) { document.getElementById('m').textContent = err.message; b.disabled = false; } });
  }
  async function viewPlan() {
    setSub('Paketim');
    let plans, orders; try { [plans, orders] = await Promise.all([api('/api/plans'), api('/api/my/orders')]); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const P = ME.plan, pend = orders.find(o => o.kind === 'plan' && o.status === 'pending');
    const L = P ? P.limits : null;
    app.innerHTML = `<h1>Paketim</h1>
      <div class="card">${P ? `<div class="aud-head"><b style="font:800 20px var(--display)">${esc(P.plan)}</b>${P.until ? `<span class="note">${fmtDate(P.until)} tarihine kadar</span>` : ''}</div>
        <p>Bu ay <b>${ME.used}</b> / ${L.videos_per_month} video üretildi.</p><div class="bar"><i style="width:${Math.min(100, Math.round(ME.used / Math.max(1, L.videos_per_month) * 100))}%"></i></div>
        <p class="note">Video başına en fazla ${Math.round(L.max_seconds / 60 * 10) / 10} dakika · en fazla ${L.students} öğrenci · ${L.sell_courses ? 'ücretli eğitim satabilir' : 'ücretli eğitim satamaz'}</p>` : '<p><b>Etkin paketiniz yok.</b> Video üretmek için aşağıdan bir paket isteyin.</p>'}</div>
      ${pend ? `<div class="card" style="margin-top:12px;border-color:rgba(255,201,60,.5)"><b>Bekleyen paket talebi:</b> ${esc((plans.find(p => p.id === pend.ref_id) || {}).name || '')} · ${fmtDate(pend.created_at)}<p class="note">Çevrim içi ödeme yakında. Şimdilik yönetici onayladığında paketiniz etkinleşir.</p></div>` : ''}
      <h2>Paketler</h2><div class="pgrid">${plans.filter(p => p.audience === 'teacher').map(p => `<div class="card plan ${P && P.code === p.code ? 'cur' : ''}"><b>${esc(p.name)}</b><div class="price">${p.price_cents ? tl(p.price_cents) + '<span class="note"> / ay</span>' : 'Ücretsiz'}</div><ul><li>${p.limits.videos_per_month} video / ay</li><li>Video başına ${Math.round(p.limits.max_seconds / 60 * 10) / 10} dk</li><li>${p.limits.students} öğrenci</li><li>${p.limits.sell_courses ? 'Ücretli eğitim satışı' : 'Ücretsiz eğitimler'}</li></ul>${P && P.code === p.code ? '<span class="pill" style="color:var(--green)">Mevcut paket</span>' : `<button data-p="${esc(p.code)}">Bu paketi iste</button>`}</div>`).join('')}</div><p class="note" id="m"></p>`;
    app.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => { b.disabled = true; const m = document.getElementById('m'); try { const r = await api('/api/my/plan', { method: 'POST', body: { code: b.dataset.p } }); m.style.color = 'var(--green)'; m.textContent = r.message; setTimeout(route, 1500); } catch (err) { m.textContent = err.message; b.disabled = false; } });
  }

  /* ---------- yönetim ---------- */
  async function viewAdmin() {
    setSub('Yönetim');
    const tab = qsOf().get('t') || 'ogretmen';
    const tabs = { ogretmen: 'Öğretmen başvuruları', kullanici: 'Kullanıcılar', proje: 'Video sahipleri', siparis: 'Siparişler', paket: 'Paketler', maliyet: 'Maliyet ve kâr' };
    let s = {}; try { s = await api('/api/admin/summary'); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    app.innerHTML = `<h1>Yönetim</h1><div class="stats"><div><b>${s.teachers}</b><span>öğretmen</span></div><div><b>${s.pendingTeachers}</b><span>başvuru</span></div><div><b>${s.students}</b><span>öğrenci</span></div><div><b>${s.courses}</b><span>yayında eğitim</span></div><div><b>${s.pendingOrders}</b><span>bekleyen sipariş</span></div><div><b>${s.unowned}</b><span>sahipsiz video</span></div></div>
      <div class="seg wide">${Object.entries(tabs).map(([k, v]) => `<a href="#/yonetim?t=${k}" aria-selected="${k === tab}">${v}</a>`).join('')}</div><div id="ad"><div class="empty">Yükleniyor…</div></div><p class="note err-t" id="m"></p>`;
    const el = document.getElementById('ad'), msg = t => { document.getElementById('m').textContent = t; };
    const act = async (path, body, okMsg) => { try { const r = await api(path, { method: 'POST', body }); if (r.password) prompt('Yeni geçici şifre (kopyalayıp kullanıcıya iletin; giriş yaptıktan sonra Profil sayfasından değiştirebilir):', r.password); else if (okMsg) msg(okMsg); viewAdmin(); } catch (e) { msg(e.message); } };
    if (tab === 'ogretmen' || tab === 'kullanici') {
      const us = await api('/api/admin/users' + (tab === 'ogretmen' ? '?role=teacher' : ''));
      const plans = await api('/api/plans');
      const ST = { pending: '<span style="color:var(--yel)">Onay bekliyor</span>', active: '<span style="color:var(--green)">Etkin</span>', rejected: 'Reddedildi', suspended: '<span style="color:var(--red)">Askıda</span>' };
      const RL = { admin: 'Yönetici', teacher: 'Öğretmen', student: 'Öğrenci' };
      const sorted = tab === 'ogretmen' ? [...us].sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0)) : us;
      el.innerHTML = `<div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Ad</th><th>Rol</th><th>Durum</th>${tab === 'ogretmen' ? '<th>Paket</th><th>Video</th>' : ''}<th>Kayıt</th><th></th></tr></thead><tbody>${sorted.map(u => `<tr><td><b>${esc(u.name)}</b><div class="note">${esc(u.email)}${u.school ? ' · ' + esc(u.school) : ''}${u.subject ? ' · ' + esc(u.subject) : ''}</div></td><td>${RL[u.role]}</td><td>${ST[u.status]}</td>${tab === 'ogretmen' ? `<td>${u.plan ? esc(u.plan.name) + (u.plan.until ? `<div class="note">${fmtDate(u.plan.until)}</div>` : '') : '—'}</td><td>${u.projects}</td>` : ''}<td>${fmtDate(u.created_at)}</td><td><span class="ibtn">${u.status === 'pending' ? `<button class="primary" data-u="${u.id}" data-a="approve">Onayla</button><button data-u="${u.id}" data-a="reject">Reddet</button>` : ''}${u.status === 'active' && u.role !== 'admin' ? `<button data-u="${u.id}" data-a="suspend">Askıya al</button>` : ''}${['suspended', 'rejected'].includes(u.status) ? `<button data-u="${u.id}" data-a="activate">Etkinleştir</button>` : ''}${u.role === 'teacher' && u.status === 'active' ? `<select data-plan="${u.id}" aria-label="Paket ata"><option value="">Paket ata…</option>${plans.map(p => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</select>` : ''}${u.id === ME.user.id ? '' : `<button data-u="${u.id}" data-a="reset_password">Şifre sıfırla</button>`}</span></td></tr>`).join('') || '<tr><td colspan="7" class="note">Kayıt yok</td></tr>'}</tbody></table></div>`;
      el.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { if (['reject', 'suspend', 'reset_password'].includes(b.dataset.a) && !confirm('Emin misiniz?')) return; b.disabled = true; act('/api/admin/users/' + b.dataset.u, { action: b.dataset.a }); });
      el.querySelectorAll('[data-plan]').forEach(s => s.onchange = () => { if (s.value) act('/api/admin/users/' + s.dataset.plan, { action: 'set_plan', plan: s.value, days: 30 }, 'Paket atandı (30 gün).'); });
    } else if (tab === 'proje') {
      const d = await api('/api/admin/projects');
      const opts = sel => `<option value="">— sahipsiz —</option>${d.owners.filter(o => o.status === 'active').map(o => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.name)} (${esc(o.email)})</option>`).join('')}`;
      el.innerHTML = `<div class="btns" style="margin-top:0"><button id="thb">Eksik kapak görsellerini oluştur</button></div><p class="note">Platform açılmadan önce üretilen videolar sahipsizdir ve yalnızca yönetici görür. Her videoyu bir öğretmene atayın; öğretmen kendi panelinde görür ve eğitimlerine ekleyebilir.</p><div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Video</th><th>Durum</th><th>Sahibi</th></tr></thead><tbody>${d.projects.map(p => `<tr><td><a href="#/p/${p.id}">${esc(p.title)}</a></td><td>${STATUS[p.status] || p.status}</td><td><select data-own="${p.id}">${opts(p.owner_id)}</select></td></tr>`).join('')}</tbody></table></div>`;
      document.getElementById('thb').onclick = async e => { e.target.disabled = true; try { const r = await api('/api/admin/thumbs', { method: 'POST' }); msg(r.count ? `${r.count} video için kapak hazırlanıyor, birkaç dakika sürer.` : 'Kapağı eksik video yok.'); } catch (err) { msg(err.message); e.target.disabled = false; } };
      el.querySelectorAll('[data-own]').forEach(s => s.onchange = () => act(`/api/admin/projects/${s.dataset.own}/owner`, { owner_id: s.value || null }, 'Sahip güncellendi.'));
    } else if (tab === 'siparis') {
      const os = await api('/api/admin/orders');
      const OS = { pending: '<span style="color:var(--yel)">Bekliyor</span>', paid: '<span style="color:var(--green)">Ödendi</span>', canceled: 'İptal', failed: 'Başarısız', refunded: 'İade' };
      el.innerHTML = `<p class="note">Çevrim içi ödeme henüz bağlı değil. Ödemeyi (havale vb.) aldığınızda “Ödendi” deyin: paket talebinde paket 30 günlüğüne açılır, eğitim satın almada öğrenci eğitime kaydolur.</p><div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Tarih</th><th>Kullanıcı</th><th>Tür</th><th>Ürün</th><th>Tutar</th><th>Durum</th><th></th></tr></thead><tbody>${os.map(o => `<tr><td>${fmtDate(o.created_at)}</td><td>${esc(o.user ? o.user.name : '')}<div class="note">${esc(o.user ? o.user.email : '')}</div></td><td>${o.kind === 'plan' ? 'Paket' : 'Eğitim'}</td><td>${esc(o.item)}</td><td>${o.amount_cents ? tl(o.amount_cents) : 'Ücretsiz'}</td><td>${OS[o.status] || o.status}</td><td>${o.status === 'pending' ? `<span class="ibtn"><button class="primary" data-o="${o.id}" data-a="paid">Ödendi / onayla</button><button data-o="${o.id}" data-a="cancel">İptal</button></span>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="note">Sipariş yok</td></tr>'}</tbody></table></div>`;
      el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { b.disabled = true; act('/api/admin/orders/' + b.dataset.o, { action: b.dataset.a }, 'Sipariş güncellendi.'); });
    } else if (tab === 'maliyet') {
      return viewFinance(el, msg);
    } else if (tab === 'paket') {
      const plans = await api('/api/plans');
      el.innerHTML = `<p class="note">Fiyatlar ödeme sistemi bağlandığında kullanılır. Sınırlar hemen geçerli olur.</p>${plans.map(p => `<form class="card" data-pl="${p.id}" style="margin-bottom:12px"><div class="grid two"><div><label>Paket adı</label><input name="name" value="${esc(p.name)}"></div><div><label>Aylık fiyat (TL)</label><input name="price" inputmode="decimal" value="${p.price_cents / 100}"></div></div>
        <div class="grid two"><div><label>Aylık video</label><input name="videos_per_month" type="number" min="0" value="${p.limits.videos_per_month}"></div><div><label>Video başına saniye</label><input name="max_seconds" type="number" min="30" value="${p.limits.max_seconds}"></div><div><label>Öğrenci sınırı</label><input name="students" type="number" min="0" value="${p.limits.students}"></div><div><label class="chk" style="margin-top:38px"><input name="sell_courses" type="checkbox" ${p.limits.sell_courses ? 'checked' : ''}> Ücretli eğitim satabilir</label></div></div>
        <div class="btns"><button type="submit">Kaydet</button></div></form>`).join('')}`;
      el.querySelectorAll('[data-pl]').forEach(f => f.onsubmit = e => { e.preventDefault(); const v = n => f.elements[n]; act('/api/admin/plans/' + f.dataset.pl, { name: v('name').value, price: v('price').value, limits: { videos_per_month: v('videos_per_month').value, max_seconds: v('max_seconds').value, students: v('students').value, sell_courses: v('sell_courses').checked } }, 'Paket kaydedildi.'); });
    }
  }


  /* ---------- yönetim: maliyet ve kâr ---------- */
  const TL = v => v == null || !isFinite(v) ? '—' : (Math.abs(v) < 10 ? v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('tr-TR')) + ' TL';
  const dk = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—';
  async function viewFinance(el, msg) {
    const per = qsOf().get('p') || 'month';
    const PER = { month: 'Bu ay', last: 'Geçen ay', '30': 'Son 30 gün', '90': 'Son 90 gün', all: 'Tüm zamanlar' }; // sıralama korunur
    let d; try { d = await api('/api/admin/finance?p=' + per); } catch (e) { el.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const S = d.summary, C = d.costs, un = Object.fromEntries(d.teachers.map(t => [t.id, t.name]));
    const prof = S.profit >= 0 ? 'var(--green)' : 'var(--red)';
    const verdict = x => x.price === 0 ? '<span class="note">ücretsiz</span>' : x.margin_worst == null ? '—' : x.margin_worst < 0 ? '<b style="color:var(--red)">Zarar riski</b>' : x.margin_worst < x.price * 0.5 ? '<b style="color:var(--yel)">İnce kâr</b>' : '<b style="color:var(--green)">Sağlıklı</b>';
    el.innerHTML = `<div class="seg" style="margin-top:0">${Object.entries(PER).map(([k, v]) => `<a href="#/yonetim?t=maliyet&p=${k}" aria-selected="${k === per}">${v}</a>`).join('')}</div>
      <div class="stats">
        <div><b>${TL(S.revenue)}</b><span>gelir (paket ${TL(S.revPlan)} · komisyon ${TL(S.revComm)})</span></div>
        <div><b>${TL(S.variable)}</b><span>değişken maliyet (${S.videos} video)</span></div>
        <div><b>${TL(S.fixed)}</b><span>sabit gider (dönem payı)</span></div>
        <div><b style="color:${prof}">${TL(S.profit)}</b><span>net kâr / zarar</span></div>
        <div><b>${TL(S.avgVideo)}</b><span>teslim edilen video başına</span></div>
        <div><b>${TL(S.avgMin)}</b><span>video dakikası başına</span></div>
      </div>
      <p class="note">Maliyet dağılımı: Claude ${TL(S.byProvider.claude)} · ElevenLabs ${TL(S.byProvider.eleven)} · Görseller (fal.ai) ${TL(S.byProvider.images || 0)} · GitHub Actions ${TL(S.byProvider.actions)}. ${C.claude_billing === 'subscription' ? `Claude şu an <b>abonelikle</b> hesaplanıyor (değişken maliyete eklenmedi). API'ye geçilse bu dönem yaklaşık <b>${TL(S.claudeApiTry)}</b> tutardı.` : 'Claude <b>API fiyatıyla</b> hesaplanıyor (ANTHROPIC_API_KEY ile çalışınca ödenecek tutar).'}${S.estimated ? ' Eski kayıtlarda girdi/çıktı ayrımı olmadığı için Claude tutarının bir kısmı tahminidir.' : ''} Video başı tutara içerik ve görsel düzeltmeleri, denetim, sorular ve başarısız denemeler dahildir.</p>

      <h2>Paketler kârlı mı?</h2><p class="note">Öğretmen paketini sonuna kadar kullanırsa (her ay tüm video hakkı, her video en uzun sürede) oluşacak değişken maliyet. Önerilen en düşük fiyat bu maliyetin 3 katıdır. Claude her zaman API fiyatıyla hesaplanır (video dakikası başına ${TL(S.avgMinApi)}), çünkü başka öğretmenler için üretim API anahtarıyla yapılır.</p>
      <div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Paket</th><th>Aylık fiyat</th><th>Hak</th><th>En kötü maliyet</th><th>Fark</th><th>Önerilen en düşük fiyat</th><th>Durum</th></tr></thead><tbody>${d.planCheck.map(x => `<tr><td><b>${esc(x.name)}</b>${x.active ? '' : ' <span class="note">(kapalı)</span>'}</td><td>${TL(x.price)}</td><td>${x.videos} video × ${Math.round(x.max_seconds / 60 * 10) / 10} dk</td><td>${TL(x.worst)}</td><td style="color:${x.margin_worst < 0 ? 'var(--red)' : 'inherit'}">${TL(x.margin_worst)}</td><td>${TL(x.min_price)}</td><td>${verdict(x)}</td></tr>`).join('')}</tbody></table></div>
      ${S.avgMin == null ? '<p class="note">Bu dönemde teslim edilmiş video olmadığı için paket hesabı yapılamadı. "Tüm zamanlar"ı seçin.</p>' : ''}

      <h2>Öğretmen bazında</h2><div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Öğretmen</th><th>Video</th><th>Teslim</th><th>Maliyet</th><th>Gelir</th><th>Kâr</th></tr></thead><tbody>${d.teachers.map(t => `<tr><td>${esc(t.name)}</td><td>${t.videos}</td><td>${t.delivered}</td><td>${TL(t.cost)}</td><td>${TL(t.revenue)}</td><td style="color:${t.profit < 0 ? 'var(--red)' : 'var(--green)'}">${TL(t.profit)}</td></tr>`).join('') || '<tr><td colspan="6" class="note">Kayıt yok</td></tr>'}</tbody></table></div>

      <h2>Video bazında <button class="linkbtn" id="csv" style="font-size:13px;margin-left:8px">CSV indir</button></h2><div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Video</th><th>Öğretmen</th><th>Süre</th><th>Claude</th><th>Ses</th><th>Actions</th><th>Toplam</th><th>Dakika başı</th><th>Düzeltme</th></tr></thead><tbody>${d.projects.map(x => `<tr><td><a href="#/p/${x.id}">${esc(x.title)}</a>${x.delivered ? '' : ' <span class="note">(' + esc(STATUS[x.status] || x.status) + ')</span>'}</td><td>${esc(un[x.owner_id || '-'] || '')}</td><td>${dk(x.seconds)}</td><td>${TL(x.usd.claude * C.usd_try)}<div class="note">${Math.round(x.tokens / 1000)}k token</div></td><td>${TL(x.usd.eleven * C.usd_try)}<div class="note">${x.chars.toLocaleString('tr-TR')} kr</div></td><td>${TL(x.usd.actions * C.usd_try)}<div class="note">${x.minutes} dk</div></td><td><b>${TL(x.try_total)}</b></td><td>${TL(x.try_per_min)}</td><td>${x.revisions}${x.failed ? ` · ${x.failed} hatalı üretim` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="note">Bu dönemde üretim yok</td></tr>'}</tbody></table></div>

      <h2>Fiyat ayarları</h2><form class="card" id="cf">
        <div class="grid two"><div><label>Dolar kuru (TL)</label><input name="usd_try" inputmode="decimal" value="${C.usd_try}"></div>
        <div><label>Claude hesaplama</label><select name="claude_billing"><option value="api" ${C.claude_billing === 'api' ? 'selected' : ''}>API fiyatı (token başına)</option><option value="subscription" ${C.claude_billing === 'subscription' ? 'selected' : ''}>Abonelik (sabit gider)</option></select></div></div>
        <div class="grid two"><div><label>Claude girdi $ / milyon token</label><input name="claude_in" inputmode="decimal" value="${C.claude_in}"></div><div><label>Claude çıktı $ / milyon token</label><input name="claude_out" inputmode="decimal" value="${C.claude_out}"></div>
        <div><label>Önbelleğe yazma $ / milyon</label><input name="claude_cw" inputmode="decimal" value="${C.claude_cw}"></div><div><label>Önbellekten okuma $ / milyon</label><input name="claude_cr" inputmode="decimal" value="${C.claude_cr}"></div>
        <div><label>ElevenLabs $ / 1000 karakter</label><input name="eleven_per_1k" inputmode="decimal" value="${C.eleven_per_1k}"></div><div><label>GitHub Actions $ / dakika</label><input name="actions_per_min" inputmode="decimal" value="${C.actions_per_min}"></div>
        <div><label>Eğitim satış komisyonu (%)</label><input name="commission_pct" inputmode="decimal" value="${C.commission_pct}"></div></div>
        <label style="margin-top:18px">Aylık sabit giderler (TL)</label><div id="fx">${(C.fixed || []).map(f => `<div class="cp" style="margin-bottom:6px"><input data-fn value="${esc(f.name)}"><input data-ft inputmode="decimal" value="${f.try}" style="max-width:160px"></div>`).join('')}</div>
        <div class="btns"><button type="button" id="fxa">Gider ekle</button><button class="primary" type="submit">Kaydet ve yeniden hesapla</button></div>
        <p class="note">Varsayılanlar: Claude Opus 5.5 API fiyatı (4 $ girdi, 20 $ çıktı), ElevenLabs Creator paketi (22 $ / 121 bin karakter ≈ 0,18 $), herkese açık depoda GitHub Actions ücretsiz, kur 49,2 TL. Kendi faturalarınıza göre güncelleyin.</p></form>`;
    document.getElementById('fxa').onclick = () => document.getElementById('fx').insertAdjacentHTML('beforeend', '<div class="cp" style="margin-bottom:6px"><input data-fn placeholder="Gider adı"><input data-ft inputmode="decimal" placeholder="0" style="max-width:160px"></div>');
    document.getElementById('cf').onsubmit = async e => {
      e.preventDefault(); const f = e.target, body = {};
      ['usd_try', 'claude_billing', 'claude_in', 'claude_out', 'claude_cw', 'claude_cr', 'eleven_per_1k', 'actions_per_min', 'commission_pct'].forEach(k => body[k] = f.elements[k].value);
      body.fixed = [...f.querySelectorAll('#fx .cp')].map(r => ({ name: r.querySelector('[data-fn]').value, try: r.querySelector('[data-ft]').value || 0 }));
      try { await api('/api/admin/finance/costs', { method: 'POST', body }); viewFinance(el, msg); msg('Fiyatlar kaydedildi.'); } catch (err) { msg(err.message); }
    };
    document.getElementById('csv').onclick = () => {
      const rows = [['Video', 'Öğretmen', 'Durum', 'Süre (sn)', 'Claude TL', 'Ses TL', 'Actions TL', 'Toplam TL', 'Dakika başı TL', 'Token', 'Karakter', 'Düzeltme']].concat(d.projects.map(x => [x.title, un[x.owner_id || '-'] || '', STATUS[x.status] || x.status, x.seconds, (x.usd.claude * C.usd_try).toFixed(2), (x.usd.eleven * C.usd_try).toFixed(2), (x.usd.actions * C.usd_try).toFixed(2), x.try_total.toFixed(2), x.try_per_min == null ? '' : x.try_per_min.toFixed(2), x.tokens, x.chars, x.revisions]));
      const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `maliyet-${per}.csv`; a.click();
    };
  }

  /* ---------- yıllık plan (seri) ---------- */
  const TONE_L = { akademik: 'Akademik ve resmi', samimi: 'Sıcak ve samimi', akran: 'Akran anlatımı', usta: 'Usta-çırak', hikaye: 'Hikâye', merak: 'Soru-cevap', belgesel: 'Belgesel', sinav: 'Sınav odaklı' };
  const FMT_L = { yatay: 'Yatay 16:9', dikey: 'Dikey 9:16', kare: 'Kare 1:1', dikey45: 'Dikey 4:5' };
  function drawPlan(c, pm) {
    const P = c.plan, el = document.getElementById('plan'), D = P.defaults || {}, OK = P.kind === 'ortak';
    const units = Object.fromEntries((P.units || []).map(u => [u.n, u]));
    const made = P.weeks.filter(w => w.project_id).length, ready = P.weeks.filter(w => w.project_id && pm[w.project_id] && pm[w.project_id].status === 'delivered').length;
    let lastU = null;
    const rows = P.weeks.map(w => {
      const p = w.project_id && pm[w.project_id];
      const head = w.unit !== lastU ? (OK ? `<tr class="urow"><td colspan="5"><b>${esc((units[w.unit] || {}).title || '')}</b> <span class="note">· ${esc((units[w.unit] || {}).outcome || '')}</span></td></tr>` : `<tr class="urow"><td colspan="5"><b>${w.unit}. Öğrenme birimi · ${esc((units[w.unit] || {}).title || '')}</b> <span class="note">· ${(units[w.unit] || {}).hours || ''} ders saati · ${esc((units[w.unit] || {}).outcome || '')}</span></td></tr>`) : ''; lastU = w.unit;
      const st = !w.project_id ? `<label class="chk"><input type="checkbox" data-w="${w.week}"> Üret</label>` : p ? `<a href="#/p/${esc(w.project_id)}"><span class="pill st-${esc(p.status)}">${esc(STATUS[p.status] || p.status)}</span></a>` : '<span class="note">oluşturuldu</span>';
      return head + `<tr><td><b>${w.week}</b></td><td style="white-space:normal;min-width:220px"><b>${esc(w.title)}</b>${w.unit_end ? ' <span class="pill" style="color:var(--yel)">Değerlendirme</span>' : ''}<details><summary class="note">${OK ? 'Konu ve sınavdaki yeri' : 'İçerik ve uygulama'}</summary><p class="note" style="white-space:normal">${esc(w.content)}</p><p class="note" style="white-space:normal"><b>${OK ? 'Ortak sınav' : 'Uygulama'}:</b> ${esc(w.uygulama || '')}</p></details></td><td style="white-space:normal;min-width:220px"><ul class="kzl">${(w.kazanimlar || []).map(k => `<li>${esc(k)}</li>`).join('')}</ul></td><td style="white-space:normal;min-width:200px" class="note">${esc(w.olcme || '')}</td><td>${st}</td></tr>`;
    }).join('');
    el.innerHTML = `<h2>${OK ? 'Ortak sınav hazırlık planı' : 'Yıllık plan'} <span class="muted" style="font-size:14px">· ${P.weeks.length} ${OK ? 'kazanım' : 'hafta'} · ${made} video oluşturuldu · ${ready} teslim edildi</span></h2>
      ${OK ? `<a class="promo" style="margin:0 0 12px" href="${(P.exam || {}).study_id ? '#/ortak-sinav/c/' + esc(P.exam.study_id) + '/1' : '#/ortak-sinav'}"><span class="pico" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3h6v3H9zM8.5 12l2 2 4-4M8.5 17h7"/></svg></span><span class="ptx"><b>Ortak sınav çalışmasına dön</b><span>Adım adım: videolar, konu soruları, sınav, çözüm videoları</span></span><span class="parr" aria-hidden="true">→</span></a>` : ''}
      <div class="card"><p class="note" style="margin-top:0">${OK ? `Her kazanım için bir hazırlık videosu: kazanımın ne ölçtüğü, örnek ortak sınav sorusu ve çözümü, sık yapılan hatalar + video içinde kontrol soruları.` :'Her hafta: bir anlatımlı video + video içinde bölüm sonu soruları (kazanım takibi, sonuçlar “Sonuçlar” sayfasında) + atölye uygulaması ve rubrik.'} Videolar ${esc(FMT_L[D.format] || D.format || '')}, ${esc(TONE_L[D.tone] || D.tone || '')} anlatımla, yaklaşık ${Math.round((D.target_seconds || 180) / 60 * 10) / 10} dakika.</p>
      <div class="btns" style="margin-top:0"><button class="primary" id="prod">Seçili ${OK ? 'kazanımların' : 'haftaların'} videolarını üret</button><button id="selnext">Sıradaki 5 ${OK ? 'kazanımı' : 'haftayı'} seç</button><button id="prt">Planı yazdır / PDF</button></div><p class="note" id="pm"></p></div>
      <div class="card" style="overflow:auto;margin-top:12px" id="plantbl"><table class="tbl plan"><thead><tr><th>${OK ? 'No' : 'Hafta'}</th><th>Konu</th><th>Kazanımlar</th><th>${OK ? 'Sınavdaki soru' : 'Ölçme ve değerlendirme'}</th><th>Video</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    document.getElementById('selnext').onclick = () => { let n = 0; el.querySelectorAll('[data-w]').forEach(x => { x.checked = n < 5; if (n < 5) n++; }); };
    document.getElementById('prt').onclick = () => {
      const w = window.open('', '_blank'); if (!w) return;
      w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(P.title)} · Yıllık plan</title><style>body{font:12px/1.4 Arial,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:5px;vertical-align:top;text-align:left}th{background:#eee}.urow td{background:#f6f6f6}ul{margin:0;padding-left:16px}details,summary,label{display:none}.pill{font-weight:bold}</style></head><body><h1>${esc(P.title)} · Yıllık plan</h1><p>${esc(P.subject || '')} · ${esc(P.level || '')} · Haftalık 2 ders saati · ${P.weeks.length} hafta</p><p>${esc(P.description || '')}</p>${document.getElementById('plantbl').innerHTML.replace(/<details>[\s\S]*?<\/details>/g, '')}</body></html>`);
      w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
    };
    document.getElementById('prod').onclick = async e => {
      const weeks = [...el.querySelectorAll('[data-w]:checked')].map(x => +x.dataset.w), m = document.getElementById('pm');
      if (!weeks.length) { m.textContent = 'Önce üretilecek haftaları işaretleyin.'; return; }
      if (!confirm(`${weeks.length} ${OK ? 'kazanımın' : 'haftanın'} videosu sıraya alınsın mı? İçerikler sırayla hazırlanır, her biri onayınıza gelir.`)) return;
      e.target.disabled = true;
      try { const r = await api(`/api/my/courses/${c.id}/produce`, { method: 'POST', body: { weeks } }); alert(r.message); route(); } catch (err) { m.textContent = err.message; e.target.disabled = false; }
    };
  }

  /* ---------- ortak yazılı sınav hazırlığı ---------- */
  const QT_L = { mix: 'Karışık (ortak yazılı tarzı)', mc: 'Çoktan seçmeli', open: 'Açık uçlu' };
  async function xlsxToSheets(file) {
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map(n => ({ name: n, rows: window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: false, blankrows: true }) }));
  }
  const OS_STEPS = [
    ['🎬', 'Konu anlatım videoları', 'Senaryodaki her kazanım için bir konu anlatım videosu.'],
    ['✏️', 'Konu soruları', 'Her kazanım için kolaydan zora pekiştirme soruları ve açıklamalı çözümleri.'],
    ['🎯', 'Muhtemel sınav soruları', 'Senaryonun soru dağılımına birebir uyan, ortak sınavda çıkabilecek sorular.'],
    ['📝', 'Sınavı uygula', 'Muhtemel soruları öğrencilere açın ya da yazdırın; sonuçları görün.'],
    ['🎥', 'Soru çözüm videoları', 'Sınav sorularının adım adım çözüm videoları; en çok yanlış yapılanlar önce.'],
  ];
  const vidOpts = (sec) => `<div class="grid3"><div><label>Video stili</label><select data-o="visual_style"><option value="sade">Sade anlatım</option><option value="teknik">Teknik</option><option value="nasil">Nasıl çalışır</option><option value="tarih">Çizgi tarih</option><option value="deney">Ya olsaydı</option></select></div><div><label>Biçim</label><select data-o="format"><option value="dikey">Dikey 9:16</option><option value="yatay">Yatay 16:9</option><option value="kare">Kare 1:1</option></select></div><div><label>Süre</label><select data-o="target_seconds"><option value="60" ${sec === 60 ? 'selected' : ''}>1 dk</option><option value="90" ${sec === 90 ? 'selected' : ''}>1,5 dk</option><option value="120" ${sec === 120 ? 'selected' : ''}>2 dk</option><option value="180">3 dk</option></select></div></div>`;
  const readOpts = box => Object.fromEntries([...box.querySelectorAll('[data-o]')].map(x => [x.dataset.o, x.dataset.o === 'target_seconds' ? +x.value : x.value]));
  const vidList = v => `<div class="list oslist">${v.items.filter(i => i.project_id).map(i => `<a class="row" href="#/p/${esc(i.project_id)}"><span>${esc(i.title)}</span><span class="pill st-${esc(i.status || '')}">${esc(STATUS[i.status] || i.status || '')}</span></a>`).join('')}</div>`;

  async function viewOrtak() {
    setSub('Ortak sınav hazırlığı');
    let studies; try { studies = await api('/api/ortak/studies'); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    app.innerHTML = `<h1>Ortak sınav hazırlığı</h1><p class="muted">MEB senaryolarına göre adım adım çalışma. Her adım kendi sayfasında yapılır, bitince bir sonrakine geçilir.</p>
      <a class="promo" href="#/ortak-sinav/yeni/1"><span class="pico" aria-hidden="true" style="font-size:28px;font-weight:800">+</span><span class="ptx"><b>Yeni çalışma başlat</b><span>Senaryo dosyası → sınıf → sınav → senaryo</span></span><span class="parr" aria-hidden="true">→</span></a>
      <h2>Çalışmalarım</h2>${studies.length ? `<div class="list">${studies.map(s => `<a class="row oscard" href="#/ortak-sinav/c/${esc(s.id)}"><span><b>${s.grade}. sınıf · ${esc(s.exam_name)}</b><span class="note" style="display:block">Senaryo ${esc(s.scenarios.join(', '))} · ${s.kazanim} kazanım</span><span class="osdots">${OS_STEPS.map((_, i) => `<i class="${i < s.done ? 'on' : ''}"></i>`).join('')}</span></span><span class="pill">${s.done}/5</span></a>`).join('')}</div>` : '<div class="empty">Henüz çalışma yok. Yukarıdan ilkini başlatın.</div>'}`;
  }

  // ----- yeni çalışma sihirbazı: her sayfada tek işlem -----
  let WZ = { plan: null, P: null, g: null, ex: null, sc: [] };
  const WZ_T = ['Senaryo dosyası', 'Sınıf düzeyi', 'Sınav', 'Senaryolar'];
  async function viewWizard(n) {
    setSub('Yeni ortak sınav çalışması');
    if (n > 1 && !WZ.P) { location.hash = '#/ortak-sinav/yeni/1'; return; }
    const D = WZ.P && WZ.P.data, g = D && D.grades.find(x => x.grade === WZ.g), ex = g && WZ.ex != null ? g.exams[WZ.ex] : null;
    if ((n > 2 && !g) || (n > 3 && !ex)) { location.hash = '#/ortak-sinav/yeni/' + (g ? 3 : 2); return; }
    const head = `<p><a href="${n > 1 ? '#/ortak-sinav/yeni/' + (n - 1) : '#/ortak-sinav'}">← ${n > 1 ? WZ_T[n - 2] : 'Ortak sınav hazırlığı'}</a></p>
      <div class="pgbar">${WZ_T.map((t, i) => `<span class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}"><i>${i + 1 < n ? '✓' : i + 1}</i><em>${t}</em></span>`).join('')}</div>
      <h1 class="pgt">${WZ_T[n - 1]}</h1>`;
    let body = '';
    if (n === 1) {
      let plans = []; try { plans = await api('/api/ortak/plans'); } catch { }
      body = `<p class="muted">MEB'in yayımladığı "Konu Soru Dağılım Tablosu" Excel dosyasını yükleyin${plans.length ? ' ya da daha önce yüklediğiniz bir dosyayı seçin' : ''}.</p>
        <div class="card"><label for="ox">Excel dosyası (.xlsx)</label><input type="file" id="ox" accept=".xlsx,.xls"><div class="btns"><button class="primary big" id="oup">Yükle ve devam et →</button></div><p class="note">Her sınıf ayrı sayfada olmalı; "Öğrenme Çıktıları" ya da "Kazanım" sütunu ve sağında sınav/senaryo sütunları. Tüm dersler (Türkçe, Matematik, Fen, Sosyal, İngilizce, Din Kültürü, Edebiyat…) desteklenir.</p><p class="note err-t" id="om"></p></div>
        ${plans.length ? `<h2>Yüklenmiş dosyalar</h2><div class="pickl">${plans.map(p => `<button data-pl="${esc(p.id)}" class="${p.id === WZ.plan ? 'on' : ''}"><b>${esc(p.title)}</b><span>${esc(p.source_name || '')} · ${p.grades.join(', ')}. sınıf</span><i>→</i></button>`).join('')}</div>` : ''}`;
    } else if (n === 2) {
      body = `<p class="muted">Hangi sınıf için çalışma hazırlanacak?</p><div class="gradebtns big">${D.grades.map(x => `<button class="${x.grade === WZ.g ? 'on' : ''}" data-g="${x.grade}"><b>${x.grade}</b><span>. sınıf</span></button>`).join('')}</div>`;
    } else if (n === 3) {
      body = `<p class="muted">${g.grade}. sınıf · hangi ortak sınav?</p><div class="pickl">${g.exams.map((e, i) => `<button data-ex="${i}" class="${i === WZ.ex ? 'on' : ''}" ${e.scenarios.length ? '' : 'disabled'}><b>${esc(e.name)}</b><span>${e.scenarios.length ? e.scenarios.length + ' senaryo' : 'Senaryo yayımlanmadı'}</span><i>→</i></button>`).join('')}</div>${g.exams.filter(e => e.note).map(e => `<p class="note" style="border-left:3px solid var(--yel);padding-left:8px">${esc(e.name)}: ${esc(e.note)}</p>`).join('')}`;
    } else {
      const sc = new Set(WZ.sc), pick = ex.scenarios.filter(s => sc.has(s.n));
      const cnt = (s, k) => { const it = s.items.find(i => i.tema === k.tema && i.text === k.text); return it ? it.count : 0; };
      const rows = g.kazanimlar.map(k => ({ k, mx: Math.max(0, ...pick.map(s => cnt(s, k))) })).filter(r => r.mx), tot = rows.reduce((a, r) => a + r.mx, 0);
      body = `<p class="muted">${g.grade}. sınıf · ${esc(ex.name)}. Bir ya da birkaç senaryo seçin; birden fazla seçerseniz her kazanım için en yüksek soru sayısı alınır.</p>
        <div class="scbtns">${ex.scenarios.map(s => `<button class="${sc.has(s.n) ? 'on' : ''}" data-s="${s.n}"><b>${esc(s.label)}</b><span>${s.total} soru</span></button>`).join('')}</div>
        ${pick.length ? `<div class="kzbox"><p><b>${rows.length} kazanım</b> · sınavda toplam <b>${tot}</b> soru</p><ul>${rows.map(r => `<li><span class="kc">${r.mx}</span>${esc(r.k.text)}</li>`).join('')}</ul></div>` : '<p class="note">Henüz senaryo seçilmedi.</p>'}
        <div class="pgnav"><span></span><button class="primary big" id="wzgo" ${pick.length ? '' : 'disabled'}>Çalışmayı oluştur →</button></div><p class="note err-t" id="wzm"></p>`;
    }
    app.innerHTML = head + body;
    const loadPlan = async id => { WZ = { plan: id, P: await api('/api/ortak/plans/' + id), g: null, ex: null, sc: [] }; location.hash = '#/ortak-sinav/yeni/2'; };
    const up = document.getElementById('oup'); if (up) up.onclick = async () => {
      const f = document.getElementById('ox').files[0], m = document.getElementById('om'); if (!f) { m.textContent = 'Önce dosyayı seçin.'; return; }
      up.disabled = true; m.textContent = 'Dosya okunuyor…';
      try { const sheets = await xlsxToSheets(f); const r = await api('/api/ortak/plans', { method: 'POST', body: { name: f.name, sheets } }); await loadPlan(r.id); } catch (err) { m.textContent = err.message; up.disabled = false; }
    };
    app.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => loadPlan(b.dataset.pl));
    app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { if (WZ.g !== +b.dataset.g) { WZ.g = +b.dataset.g; WZ.ex = null; WZ.sc = []; } location.hash = '#/ortak-sinav/yeni/3'; });
    app.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { if (WZ.ex !== +b.dataset.ex) { WZ.ex = +b.dataset.ex; WZ.sc = []; } location.hash = '#/ortak-sinav/yeni/4'; });
    app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { const v = +b.dataset.s; WZ.sc = WZ.sc.includes(v) ? WZ.sc.filter(x => x !== v) : [...WZ.sc, v]; viewWizard(4); });
    const go = document.getElementById('wzgo'); if (go) go.onclick = async () => { go.disabled = true; try { const r = await api('/api/ortak/studies', { method: 'POST', body: { plan_id: WZ.plan, grade: WZ.g, exam: WZ.ex, scenarios: WZ.sc } }); WZ = { plan: WZ.plan, P: WZ.P, g: null, ex: null, sc: [] }; location.hash = '#/ortak-sinav/c/' + r.id + '/1'; } catch (err) { document.getElementById('wzm').textContent = err.message; go.disabled = false; } };
  }

  // ----- çalışma: her adım ayrı sayfa -----
  const OS_SHORT = ['Konu videoları', 'Konu soruları', 'Sınav soruları', 'Sınavı uygula', 'Çözüm videoları'];
  const PH = { queued: 'wait', content_generating: 'work', content_review: 'act', visuals_generating: 'work', visuals_review: 'act', voicing: 'work', rendering: 'work', delivered: 'done', failed: 'err', archived: 'off' };
  function videoBoard(C, back) {
    const its = C.items.filter(i => i.project_id), by = k => its.filter(i => PH[i.status] === k);
    const cr = its.filter(i => i.status === 'content_review'), vr = its.filter(i => i.status === 'visuals_review');
    const pct = its.length ? Math.round(its.reduce((a, i) => a + ({ queued: 0, content_generating: 10, content_review: 25, visuals_generating: 40, visuals_review: 60, voicing: 75, rendering: 88, delivered: 100 }[i.status] || 0), 0) / its.length) : 0;
    const row = i => {
      const st = i.status, link = `#/p/${esc(i.project_id)}?r=${encodeURIComponent(back)}`;
      let act = '';
      if (st === 'content_review') act = `<button data-peek="${esc(i.project_id)}">Metni oku</button><button class="primary" data-ap="content" data-pid="${esc(i.project_id)}">İçeriği onayla</button>`;
      else if (st === 'visuals_review') act = `<a class="btn" href="${link}">Görselleri izle</a><button class="primary" data-ap="visuals" data-pid="${esc(i.project_id)}">Görselleri onayla</button>`;
      else if (st === 'delivered') act = `<a class="btn" href="${link}">▶ Videoyu izle</a>`;
      else if (st === 'failed') act = `<button data-retryp="${esc(i.project_id)}">Yeniden dene</button>`;
      return `<div class="vrow ph-${PH[st] || 'wait'}"><div class="vt"><b>${esc(i.title)}</b><span class="pill st-${esc(st || '')}">${esc(STATUS[st] || st || '')}</span></div>${act ? `<div class="vact">${act}</div>` : ''}<div class="peek" data-peekbox="${esc(i.project_id)}" hidden></div></div>`;
    };
    return `<div class="vsum"><div class="vbar"><i style="width:${pct}%"></i></div><p><b>${by('done').length}/${its.length}</b> video tamamlandı${by('act').length ? ` · <b style="color:var(--yel-t)">${by('act').length} video onayınızı bekliyor</b>` : ''}${by('work').length + by('wait').length ? ` · ${by('work').length + by('wait').length} video hazırlanıyor` : ''}</p>
      ${cr.length > 1 || vr.length > 1 ? `<div class="btns" style="margin-top:0">${cr.length > 1 ? `<button class="primary" data-apall="content">Bekleyen ${cr.length} içeriği onayla</button>` : ''}${vr.length > 1 ? `<button class="primary" data-apall="visuals">Bekleyen ${vr.length} görseli onayla</button>` : ''}</div>` : ''}
      <p class="note">Her video sırayla: içerik hazırlanır → <b>içerik onayınız</b> → görseller çizilir → <b>görsel onayınız</b> → seslendirme → video. Onay bekleyenler bu sayfada; sayfa kendiliğinden yenilenir.</p></div>
      <div class="vlist">${its.map(row).join('')}</div>`;
  }
  function wireBoard(C) {
    const its = C.items.filter(i => i.project_id);
    const ap = async (kind, pid) => api(`/api/projects/${pid}/${kind}/approve`, { method: 'POST', body: {} });
    app.querySelectorAll('[data-ap]').forEach(b => b.onclick = async () => { b.disabled = true; try { await ap(b.dataset.ap, b.dataset.pid); route(); } catch (e) { alert(e.message); b.disabled = false; } });
    app.querySelectorAll('[data-apall]').forEach(b => b.onclick = async () => { const k = b.dataset.apall, list = its.filter(i => i.status === (k === 'content' ? 'content_review' : 'visuals_review')); if (!confirm(`${list.length} videonun ${k === 'content' ? 'içeriği' : 'görselleri'} onaylansın mı?`)) return; b.disabled = true; for (const i of list) { try { await ap(k, i.project_id); } catch { } } route(); });
    app.querySelectorAll('[data-retryp]').forEach(b => b.onclick = async () => { b.disabled = true; await api(`/api/projects/${b.dataset.retryp}/retry`, { method: 'POST' }).catch(e => alert(e.message)); route(); });
    app.querySelectorAll('[data-peek]').forEach(b => b.onclick = async () => {
      const box = app.querySelector(`[data-peekbox="${b.dataset.peek}"]`); if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = '<p class="note">Yükleniyor…</p>';
      try { const d = await api('/api/projects/' + b.dataset.peek); const sc = d.content.data.scenes;
        box.innerHTML = `<ol class="peekl">${sc.map(s => `<li><b>${esc(s.title)}</b><span>${esc(s.cap.join(' '))}</span></li>`).join('')}</ol><label>Düzeltme isteği (isteğe bağlı)</label><div class="cp"><input data-fb placeholder="Örn. örnek soruyu daha kolay yap"><button data-rev="${esc(b.dataset.peek)}">Düzelt</button></div>`;
        box.querySelector('[data-rev]').onclick = async e => { const v = box.querySelector('[data-fb]').value.trim(); if (!v) return; e.target.disabled = true; try { await api(`/api/projects/${b.dataset.peek}/content/revise`, { method: 'POST', body: { feedback: v } }); route(); } catch (err) { alert(err.message); e.target.disabled = false; } };
      } catch (e) { box.innerHTML = `<p class="err-t">${esc(e.message)}</p>`; }
    });
  }

  async function viewStudy(id, stepArg) {
    let d; try { d = await api('/api/ortak/studies/' + id); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const S = d.study, sk = new Set(S.skipped), V = d.videos, PR = d.practice, EX = d.exam, SO = d.solutions;
    setSub('Ortak sınav çalışması');
    const tReady = t => t && t.status === 'ready';
    const vDone = C => C && C.items.filter(i => i.project_id).length && C.items.filter(i => i.project_id).every(i => ['delivered', 'archived'].includes(i.status));
    const done = [vDone(V) || sk.has('videos'), tReady(PR) || sk.has('practice'), tReady(EX), !!(EX && (EX.published || EX.attempts)) || sk.has('apply'), vDone(SO) || sk.has('solutions')];
    const open = [true, done[0] || !!V, done[1] || !!PR, tReady(EX), done[3]];
    let step = stepArg ? stepArg - 1 : Math.max(0, done.findIndex(x => !x)); if (step < 0) step = 4;
    if (!open[step]) step = open.lastIndexOf(true) >= 0 ? Math.min(step, open.lastIndexOf(true)) : 0;
    const back = `#/ortak-sinav/c/${id}/${step + 1}`;
    if (!stepArg && location.hash !== back) { history.replaceState(null, '', back); }
    let body = '', busy = false, nextOk = done[step], nextWarn = '';
    const testPage = (t, label, isPractice) => {
      if (t.status === 'generating') { busy = true; return `<div class="osbusy big">⏳ ${label} hazırlanıyor (${t.total} soru).<br><span class="note">Birkaç dakika sürer; sayfa kendiliğinden yenilenir.</span></div>`; }
      if (t.status === 'failed') return `<div class="card err">Hazırlanamadı: ${esc(t.error || '')}</div><div class="btns"><button class="primary" data-retry="${t.id}">Yeniden dene</button></div>`;
      return `<div class="okbox">✓ <b>${t.total} soru hazır</b> · ${t.mc} çoktan seçmeli, ${t.total - t.mc} açık uçlu</div>
        <div class="btns"><a class="btn primary" href="#/ortak-sinav/t/${esc(t.id)}">Soruları incele · düzelt · yazdır</a>${isPractice ? `<button data-pub="${t.id}" data-on="${t.published ? 0 : 1}">${t.published ? 'Öğrencilere kapat' : 'Öğrencilere alıştırma olarak aç'}</button>` : ''}</div>
        ${isPractice && t.published && t.url ? `<p class="note">Alıştırma bağlantısı: <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.url)}</a> · kod <b>${esc(t.code)}</b></p>` : ''}`;
    };
    if (step === 0) {
      if (!V && !sk.has('videos')) body = `<p class="muted">Seçtiğiniz senaryolardaki ${S.items.length} kazanımın her biri için bir konu anlatım videosu üretilir.</p><div class="kzbox"><ul>${S.items.map(i => `<li><span class="kc">${i.count || '–'}</span>${esc(i.text)}</li>`).join('')}</ul></div><div class="card" style="margin-top:12px">${vidOpts(120)}<div class="btns"><button class="primary big" data-act="videos">${S.items.length} videoyu üret</button></div><p class="note">Her video bir video hakkı kullanır.</p></div><p><button data-skip="videos" class="linkbtn">Bu adımı atla</button></p>`;
      else if (sk.has('videos') && !V) body = `<p class="note">Bu adım atlandı.</p><button data-unskip="videos">Geri al</button>`;
      else { body = videoBoard(V, back) + (V.items.some(i => !i.project_id) ? `<div class="btns"><button data-act="videos">Kalan ${V.items.filter(i => !i.project_id).length} videoyu üret</button></div>` : ''); busy = V.items.some(i => i.project_id && ['wait', 'work'].includes(PH[i.status])); if (!done[0]) nextWarn = 'Videoların hepsi henüz tamamlanmadı. Yine de sonraki adıma geçilsin mi? (Videolar arka planda tamamlanmaya devam eder.)'; nextOk = true; }
    } else if (step === 1) {
      if (PR) body = testPage(PR, 'Konu soruları', true);
      else if (sk.has('practice')) body = `<p class="note">Bu adım atlandı.</p><button data-unskip="practice">Geri al</button>`;
      else body = `<p class="muted">Her kazanım için kolaydan zora pekiştirme soruları ve açıklamalı çözümleri hazırlanır.</p><div class="card"><div class="grid3"><div><label>Kazanım başına soru</label><select data-t="per"><option>2</option><option selected>3</option><option>4</option><option>5</option></select></div><div><label>Soru türü</label><select data-t="qtype"><option value="mix">Karışık</option><option value="mc">Çoktan seçmeli</option><option value="open">Açık uçlu</option></select></div><div><label>Zorluk</label><select data-t="level"><option>kolay</option><option selected>orta</option><option>zor</option></select></div></div><div class="btns"><button class="primary big" data-act="practice">Konu sorularını hazırla</button></div></div><p><button data-skip="practice" class="linkbtn">Bu adımı atla</button></p>`;
    } else if (step === 2) {
      if (EX) body = testPage(EX, 'Muhtemel sınav soruları');
      else body = `<p class="muted">Senaryodaki soru dağılımına birebir uyan, ortak sınavda çıkabilecek sorular hazırlanır.</p><div class="kzbox"><p><b>Senaryo dağılımı</b> · toplam ${S.items.reduce((a, b) => a + b.count, 0)} soru</p><ul>${S.items.filter(i => i.count).map(i => `<li><span class="kc">${i.count}</span>${esc(i.text)}</li>`).join('')}</ul></div><div class="card" style="margin-top:12px"><div class="grid3"><div><label>Soru sayısı</label><select data-t="multiplier"><option value="1">Senaryodaki kadar</option><option value="2">2 katı</option><option value="3">3 katı</option></select></div><div><label>Soru türü</label><select data-t="qtype"><option value="mix">Ortak sınav tarzı</option><option value="mc">Çoktan seçmeli</option><option value="open">Açık uçlu</option></select></div><div><label>Zorluk</label><select data-t="level"><option>kolay</option><option selected>orta</option><option>zor</option></select></div></div><div class="btns"><button class="primary big" data-act="exam">Sınav sorularını hazırla</button></div></div>`;
    } else if (step === 3) {
      body = `<p class="muted">Sınavı çevrimiçi uygulayın ya da kâğıdını yazdırın.</p><div class="card"><div class="btns" style="margin-top:0"><button class="${EX.published ? '' : 'primary big'}" data-pub="${EX.id}" data-on="${EX.published ? 0 : 1}">${EX.published ? 'Sınavı öğrencilere kapat' : 'Sınavı öğrencilere aç'}</button><a class="btn" href="#/ortak-sinav/t/${esc(EX.id)}">Sınav kâğıdı ve cevap anahtarı</a></div>
        ${EX.published && EX.url ? `<div class="osqr"><div id="sqr"></div><div><p style="margin:0">Sınav kodu <b style="font-size:24px">${esc(EX.code)}</b></p><p class="note"><a href="${esc(EX.url)}" target="_blank" rel="noopener">${esc(EX.url)}</a></p><p class="note">Öğrenciler bağlantıdan ya da QR'dan telefonla girer; sonuçlar buraya gelir.</p></div></div>` : ''}</div>
        ${EX.attempts ? `<div class="okbox"><b>${EX.attempts}</b> öğrenci çözdü · çoktan seçmeli ortalama <b>${EX.avg}</b> · <a href="#/ortak-sinav/t/${esc(EX.id)}">ayrıntılı sonuçlar</a></div>` : EX.published ? '<p class="note">Henüz çözen yok. Sonuçlar geldikçe burada görünür.</p>' : ''}
        ${EX.published || sk.has('apply') ? '' : `<p><button data-skip="apply" class="linkbtn">Kâğıt üzerinde uyguladım, devam et</button></p>`}`;
    } else {
      const made = new Set(SO ? SO.items.filter(i => i.project_id).map(i => i.qn) : []);
      const qs = [...(EX.questions || [])].sort((a, b) => (b.wrong_pct ?? -1) - (a.wrong_pct ?? -1)).filter(q => !made.has(q.n));
      if (SO && made.size) { body = videoBoard(SO, back); busy = SO.items.some(i => i.project_id && ['wait', 'work'].includes(PH[i.status])); }
      if (qs.length) body += `${made.size ? '<h2>Başka sorular için çözüm videosu</h2>' : `<p class="muted">Çözüm videosu üretilecek soruları seçin. ${EX.attempts ? 'Sorular en çok yanlış yapılandan başlayarak sıralandı; %40 ve üzeri işaretli.' : ''}</p>`}
        <div class="qpick">${qs.map(q => `<label class="chk qrow"><input type="checkbox" data-q="${q.n}" ${q.wrong_pct != null && q.wrong_pct >= 40 ? 'checked' : ''}><span><b>Soru ${q.n}</b> ${q.kazanim_code ? `<span class="pill">${esc(q.kazanim_code)}</span>` : ''} ${q.type === 'mc' ? '' : '<span class="pill">açık uçlu</span>'}${q.wrong_pct != null ? ` <span class="pill" style="color:${q.wrong_pct >= 40 ? 'var(--red)' : 'var(--green)'}">%${q.wrong_pct} yanlış</span>` : ''}<span class="note" style="display:block">${esc(q.stem)}${q.stem.length >= 220 ? '…' : ''}</span></span></label>`).join('')}</div>
        <div class="card">${vidOpts(90)}<div class="btns"><button class="primary big" data-act="solutions">Seçili soruların çözüm videolarını üret</button><button id="qall">Tümünü seç</button></div></div>`;
      if (!SO && !sk.has('solutions')) body += `<p><button data-skip="solutions" class="linkbtn">Bu adımı atla</button></p>`;
      const SH = d.share;
      body += `<div class="card sharecard"><h2 style="margin-top:0">📤 Öğrencilere tek bağlantı</h2><p class="note">Öğrenci bu bağlantıyla sırayla: konu anlatım videolarını izler → konu sorularını çözer → sınavı olur → doğru cevapları ve soru çözüm videolarını izler. Yalnızca tamamlanmış videolar görünür.</p>
        ${SH && SH.on ? `<div class="osqr"><div id="cqr"></div><div><p style="margin:0">Çalışma kodu <b style="font-size:24px">${esc(SH.code)}</b></p><p class="note" style="word-break:break-all"><a href="${esc(SH.url)}" target="_blank" rel="noopener">${esc(SH.url)}</a></p><div class="btns" style="margin-top:6px"><button id="ccopy">Bağlantıyı kopyala</button><button data-share="0" class="linkbtn">Bağlantıyı kapat</button></div></div></div>` : `<div class="btns"><button class="primary big" data-share="1">Öğrenci bağlantısını oluştur</button></div>`}</div>`;
    }
    const nav = `<div class="pgnav">${step > 0 ? `<a class="btn" href="#/ortak-sinav/c/${id}/${step}">← ${OS_SHORT[step - 1]}</a>` : '<span></span>'}${step < 4 ? `<button class="${nextOk ? 'primary big' : ''}" id="pgnext" ${nextOk ? '' : 'disabled'}>${OS_SHORT[step + 1]} →</button>` : (done[4] ? '<a class="btn primary big" href="#/ortak-sinav">Çalışma tamamlandı ✓</a>' : '<span></span>')}</div>${!nextOk && step < 4 ? '<p class="note" style="text-align:right">Bu adım bitince sonraki adım açılır.</p>' : ''}`;
    app.innerHTML = `<p><a href="#/ortak-sinav">← Çalışmalarım</a></p><p class="note" style="margin:0">${S.grade}. sınıf · ${esc(S.exam_name)} · Senaryo ${esc(S.scenarios.join(', '))} · ${S.items.length} kazanım</p>
      <div class="pgbar five">${OS_SHORT.map((t, i) => { const cls = i === step ? 'on' : done[i] ? 'done' : open[i] ? '' : 'lock'; return open[i] && i !== step ? `<a class="${cls}" href="#/ortak-sinav/c/${id}/${i + 1}"><i>${done[i] ? '✓' : i + 1}</i><em>${t}</em></a>` : `<span class="${cls}"><i>${done[i] ? '✓' : i + 1}</i><em>${t}</em></span>`; }).join('')}</div>
      <h1 class="pgt">${OS_STEPS[step][0]} ${OS_STEPS[step][1]}</h1><div id="pgbody">${body}</div><p class="note err-t" id="pgm"></p>${nav}
      <p style="margin-top:28px"><button id="sdel" class="linkbtn">Çalışmayı sil</button></p>`;
    const msg = t => { document.getElementById('pgm').textContent = t; };
    document.getElementById('sdel').onclick = async () => { if (!confirm('Çalışma silinsin mi? Üretilmiş videolar ve testler silinmez.')) return; await api('/api/ortak/studies/' + id, { method: 'DELETE' }); location.hash = '#/ortak-sinav'; };
    const nx = document.getElementById('pgnext'); if (nx) nx.onclick = () => { if (nextWarn && !confirm(nextWarn)) return; location.hash = `#/ortak-sinav/c/${id}/${step + 2}`; };
    app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const act = b.dataset.act, body = {};
      app.querySelectorAll('[data-t]').forEach(x => body[x.dataset.t] = x.value);
      if (act === 'videos' || act === 'solutions') body.defaults = readOpts(app);
      if (act === 'solutions') { body.questions = [...app.querySelectorAll('[data-q]:checked')].map(x => +x.dataset.q); if (!body.questions.length) { msg('En az bir soru işaretleyin.'); return; } if (!confirm(`${body.questions.length} çözüm videosu üretilsin mi? Her video bir video hakkı kullanır.`)) return; }
      if (act === 'videos' && !confirm('Konu anlatım videoları sıraya alınsın mı? Her video bir video hakkı kullanır.')) return;
      b.disabled = true;
      try { await api(`/api/ortak/studies/${id}/${act}`, { method: 'POST', body }); route(); } catch (err) { msg(err.message); b.disabled = false; }
    });
    app.querySelectorAll('[data-skip],[data-unskip]').forEach(b => b.onclick = async () => { await api(`/api/ortak/studies/${id}/skip`, { method: 'POST', body: { step: b.dataset.skip || b.dataset.unskip, undo: !!b.dataset.unskip } }); if (b.dataset.skip && step < 4) location.hash = `#/ortak-sinav/c/${id}/${step + 2}`; else route(); });
    app.querySelectorAll('[data-pub]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api(`/api/ortak/tests/${b.dataset.pub}/publish`, { method: 'POST', body: { on: b.dataset.on === '1' } }); route(); } catch (err) { msg(err.message); b.disabled = false; } });
    app.querySelectorAll('[data-retry]').forEach(b => b.onclick = async () => { await api(`/api/ortak/tests/${b.dataset.retry}/retry`, { method: 'POST' }); route(); });
    app.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api(`/api/ortak/studies/${id}/share`, { method: 'POST', body: { on: b.dataset.share === '1' } }); route(); } catch (err) { msg(err.message); b.disabled = false; } });
    const cc = document.getElementById('ccopy'); if (cc) cc.onclick = async () => { try { await navigator.clipboard.writeText(d.share.url); cc.textContent = 'Kopyalandı ✓'; } catch { prompt('Bağlantı:', d.share.url); } };
    if (step === 4 && d.share && d.share.on) loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { const el = document.getElementById('cqr'); if (el && window.QRCode) new window.QRCode(el, { text: d.share.url, width: 130, height: 130, correctLevel: window.QRCode.CorrectLevel.M }); }).catch(() => {});
    const qa = document.getElementById('qall'); if (qa) qa.onclick = () => app.querySelectorAll('[data-q]').forEach(x => x.checked = true);
    if (step === 0 && V) wireBoard(V); if (step === 4 && SO) wireBoard(SO);
    if (step === 3 && EX.published && EX.url) loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { const el = document.getElementById('sqr'); if (el && window.QRCode) new window.QRCode(el, { text: EX.url, width: 130, height: 130, correctLevel: window.QRCode.CorrectLevel.M }); }).catch(() => {});
    const hereNow = location.hash;
    const poll = () => { if (location.hash !== hereNow) return; const a = document.activeElement; if ((a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) || app.querySelector('.peek:not([hidden])')) { pollTimer = setTimeout(poll, 8000); return; } route(); };
    if (busy || (step === 3 && EX.published)) pollTimer = setTimeout(poll, busy ? 8000 : 20000);
  }
  const tblHtml = t => t ? `<table class="ttbl">${t.headers.length ? `<thead><tr>${t.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${t.rows.map(r => `<tr>${r.map(c => `<td class="${c ? '' : 'blank'}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
  const keyHtml = (x, mdl) => `<div class="tkey">${x.answer_table ? tblHtml(x.answer_table) : ''}<p><b>TAM PUAN:</b> ${esc(mdl || '')}</p>${x.partial ? `<p><b>KISMİ PUAN:</b> ${esc(x.partial)}</p>` : ''}${x.wrong ? `<p><b>SIFIR PUAN:</b> ${esc(x.wrong)}</p>` : ''}${(x.rubric || []).length ? `<ul>${x.rubric.map(r => `<li>${esc(r.criterion)} <b>(${r.points} puan)</b></li>`).join('')}</ul>` : ''}</div>`;
  function testHtml(d, withKey) {
    const P = Object.fromEntries((d.passages || []).map(p => [p.id, p])); const shown = new Set();
    return d.questions.map(q => {
      let pre = '';
      if (q.passage && P[q.passage] && !shown.has(q.passage)) { const p = P[q.passage]; shown.add(q.passage); pre = `<div class="tpass"><b>${esc(p.title || 'Metin')}</b>${p.source ? ` <span class="note">(${esc(p.source)})</span>` : ''}<div class="ttext">${esc(p.text).replace(/&lt;(\/?)u&gt;/g, '<$1u>')}</div></div>`; }
      const ref = q.passage && P[q.passage] && !pre ? `<span class="note">(${esc(P[q.passage].title || q.passage)} metnine göre)</span> ` : '';
      const crit = q.show_criteria && (q.rubric || []).length && !withKey ? `<p class="note" style="margin:6px 0 2px">Değerlendirmede aşağıdaki kriterler dikkate alınacaktır.</p><ul class="tcrit">${q.rubric.map(r => `<li>${esc(r.criterion)}</li>`).join('')}</ul>` : '';
      let body;
      if (q.type === 'mc') body = `<ol class="topts" type="A">${q.options.map((o, i) => `<li class="${withKey && 'ABCDE'[i] === q.answer ? 'ok' : ''}">${esc(o)}</li>`).join('')}</ol>` + (withKey ? `<p class="tkey"><b>Cevap: ${q.answer}</b>${q.explain ? ' · ' + esc(q.explain) : ''}</p>` : '');
      else if (q.parts) body = q.parts.map(p => `<div class="tpart"><p><b>${esc(p.label)})</b> ${esc(p.stem)} <span class="note">(${p.points} puan)</span></p>${withKey ? '' : tblHtml(p.table) + (p.table ? '' : '<div class="tlines"></div>')}${withKey ? keyHtml(p, p.answer) : ''}</div>`).join('');
      else body = (withKey ? '' : tblHtml(q.table) + crit + (q.table ? '' : `<div class="tlines${q.show_criteria ? ' long' : ''}"></div>`)) + (withKey ? keyHtml(q, q.model_answer) : '');
      return pre + `<div class="tq"><p><b>${q.n}.</b> ${ref}${esc(q.stem)} <span class="note">(${q.points} puan${q.kazanim_code ? ' · ' + esc(q.kazanim_code) : ''})</span></p>${body}</div>`;
    }).join('');
  }
  // MEB biçimi: soru – öğrenme çıktısı – beceriler tablosu ve puanlama tablosu
  function testTables(d) {
    const rows = d.questions.map(q => `<tr><td>${q.n}</td><td>${esc(q.kazanim || q.kazanim_code || '')}</td><td>${esc((q.skills || []).join(', '))}</td></tr>`).join('');
    const cols = d.questions.flatMap(q => q.parts ? q.parts.map(p => [q.n + '.' + p.label, p.points]) : [[String(q.n), q.points]]);
    return `<h3 class="ttl">SORU – ÖĞRENME ÇIKTISI – BECERİLER</h3><table class="ttbl"><thead><tr><th>Soru</th><th>Öğrenme çıktısı</th><th>Beceriler</th></tr></thead><tbody>${rows}</tbody></table>
      <h3 class="ttl">PUANLAMA TABLOSU</h3><table class="ttbl pt"><tr>${cols.map(c => `<th>${esc(c[0])}</th>`).join('')}<th>TOPLAM</th></tr><tr>${cols.map(c => `<td>${c[1]}</td>`).join('')}<td><b>${cols.reduce((a, c) => a + c[1], 0)}</b></td></tr></table>`;
  }
  const TEST_PRINT_CSS = '.ttbl{border-collapse:collapse;width:100%;margin:6px 0;font-size:12px}.ttbl th,.ttbl td{border:1px solid #888;padding:5px 6px;text-align:left;vertical-align:top}.ttbl th{background:#eee}.ttbl td.blank{min-width:70px;height:26px}.ttbl.pt th,.ttbl.pt td{text-align:center}.tpart{margin:6px 0 6px 14px}.tcrit{margin:2px 0 6px 18px;font-size:12px}.tlines.long{height:220px}.ttl{font-size:13px;margin:18px 0 4px}.tkey p{margin:3px 0}body{font:13px/1.5 Georgia,serif;margin:28px;color:#111}h1{font-size:18px;margin:0}.note{color:#555;font-size:11px}.tpass{border:1px solid #999;padding:10px 12px;margin:14px 0;break-inside:avoid}.ttext{white-space:pre-line;margin-top:6px}.tq{margin:12px 0;break-inside:avoid}.topts{margin:4px 0 0 18px}.topts li.ok{font-weight:bold;text-decoration:underline}.tlines{height:90px;border-bottom:1px dotted #999;background:repeating-linear-gradient(transparent 0 28px,#ccc 28px 29px)}.tkey{background:#f3f3f3;padding:6px 8px;margin:4px 0}.hd{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}';
  async function viewOrtakTest(id) {
    let d; try { d = await api('/api/ortak/tests/' + id); } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const t = d.test; setSub('Kazanım testi');
    const back = `<p><a href="javascript:history.back()">← Geri</a></p>`;
    if (t.status === 'generating') { app.innerHTML = back + `<h1>${esc(t.title)}</h1><div class="card"><p>⏳ Test hazırlanıyor. Kazanım ve senaryo sayısına göre birkaç dakika sürebilir; bu sayfa kendiliğinden yenilenir.</p></div>`; pollTimer = setTimeout(() => route(), 8000); return; }
    if (t.status === 'failed') { app.innerHTML = back + `<h1>${esc(t.title)}</h1><div class="card err">Test hazırlanamadı: ${esc(t.error || '')}</div><div class="btns"><button class="primary" id="tre">Yeniden dene</button><button id="tdl">Sil</button></div>`; document.getElementById('tre').onclick = async () => { await api(`/api/ortak/tests/${id}/retry`, { method: 'POST' }); route(); }; document.getElementById('tdl').onclick = async () => { if (confirm('Test silinsin mi?')) { await api('/api/ortak/tests/' + id, { method: 'DELETE' }); location.hash = '#/ortak-sinav'; } }; return; }
    const T = t.data, S = t.spec, at = d.attempts;
    const mc = T.questions.filter(q => q.type === 'mc').length, op = T.questions.length - mc;
    // kazanım bazında başarı
    const perK = {}; at.forEach(a => (a.per_kazanim || []).forEach(k => { const x = perK[k.code || k.text] = perK[k.code || k.text] || { code: k.code, text: k.text, mc: 0, ok: 0 }; x.mc += k.mc; x.ok += k.ok; }));
    app.innerHTML = back + `<h1>${esc(T.title || t.title)}</h1><p class="muted">${S.grade}. sınıf · ${esc(S.exam)} · ${S.scenarios.map(n => 'Senaryo ' + n).join(', ')} · ${T.questions.length} soru (${mc} çoktan seçmeli, ${op} açık uçlu) · ${esc(QT_L[(t.opts || {}).qtype] || '')}</p>
      <div class="card"><div class="btns" style="margin-top:0"><button class="primary" id="tpub">${t.published ? 'Öğrencilere kapat' : 'Öğrencilere aç (bağlantı + QR)'}</button><button id="tpr">Sınav kâğıdını yazdır</button><button id="tkey">Cevap anahtarını yazdır</button><button id="tdl" class="linkbtn">Sil</button></div>
        ${t.published && d.url ? `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:10px"><div id="tqr" style="background:#fff;padding:10px;border-radius:10px"></div><div><p style="margin:0">Test kodu <b style="font-size:20px">${esc(t.code)}</b></p><p class="note"><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url)}</a></p><button id="tcp">Bağlantıyı kopyala</button></div></div>` : ''}
        <label for="tfb" style="margin-top:12px">Düzeltme isteği</label><div class="cp"><input id="tfb" maxlength="1500" placeholder="Örn. 3. soruyu daha kolay yap; şiir yerine hikâye kullan"><button id="trv">Düzelt</button></div><p class="note err-t" id="tm"></p></div>
      <h2>Sonuçlar <span class="muted" style="font-size:14px">· ${at.length} öğrenci</span></h2>
      ${at.length ? `<div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Öğrenci</th><th>Sınıf</th><th class="c">Doğru</th><th class="c">Puan (ÇS)</th><th>Tarih</th></tr></thead><tbody>${at.map(a => `<tr><td>${esc(a.student_name)}</td><td>${esc(a.student_class || '')}</td><td class="c">${a.mc_correct}/${a.mc_total}</td><td class="c"><b>${a.score ?? '—'}</b></td><td class="note">${new Date(a.created_at).toLocaleString('tr-TR')}</td></tr>`).join('')}</tbody></table>
        <h3>Kazanım bazında başarı (çoktan seçmeli)</h3><table class="tbl"><tbody>${Object.values(perK).filter(k => k.mc).map(k => { const p = Math.round(k.ok / k.mc * 100); return `<tr><td style="white-space:normal"><b>${esc(k.code || '')}</b> ${esc((k.text || '').slice(0, 120))}</td><td style="min-width:140px"><div class="kbar"><i style="width:${p}%;background:${p >= 70 ? 'var(--green)' : p >= 45 ? 'var(--yel)' : 'var(--red, #e5484d)'}"></i></div></td><td class="c"><b>%${p}</b></td></tr>`; }).join('')}</tbody></table><p class="note">Açık uçlu cevapları öğrenci örnek cevapla karşılaştırır; puanlamayı sınav kâğıdında siz yaparsınız.</p></div>` : '<div class="empty">Henüz çözen yok. Testi öğrencilere açın.</div>'}
      <h2>Sorular ve cevap anahtarı</h2>${T.instructions ? `<p class="note">${esc(T.instructions)}</p>` : ''}<div class="card tview">${testHtml(T, true)}${testTables(T)}</div>`;
    document.getElementById('tpub').onclick = async e => { e.target.disabled = true; try { await api(`/api/ortak/tests/${id}/publish`, { method: 'POST', body: { on: !t.published } }); route(); } catch (err) { document.getElementById('tm').textContent = err.message; e.target.disabled = false; } };
    document.getElementById('tdl').onclick = async () => { if (confirm('Test ve sonuçları silinsin mi?')) { await api('/api/ortak/tests/' + id, { method: 'DELETE' }); location.hash = '#/ortak-sinav'; } };
    document.getElementById('trv').onclick = async e => { const v = document.getElementById('tfb').value.trim(); if (!v) return; e.target.disabled = true; try { await api(`/api/ortak/tests/${id}/revise`, { method: 'POST', body: { feedback: v } }); route(); } catch (err) { document.getElementById('tm').textContent = err.message; e.target.disabled = false; } };
    const prt = key => { const w = window.open('', '_blank'); if (!w) return; w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(T.title)}${key ? ' · Cevap anahtarı' : ''}</title><style>${TEST_PRINT_CSS}</style></head><body><div class="hd"><div><h1>${esc(T.title)}${key ? ' · CEVAP ANAHTARI' : ''}</h1><div class="note">${S.grade}. sınıf · ${esc(S.exam)}</div></div>${key ? '' : '<div>Adı Soyadı: ……………………<br>Sınıfı / No: ……………</div>'}</div>${T.instructions && !key ? `<p>${esc(T.instructions)}</p>` : ''}${testHtml(T, key)}${testTables(T)}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); };
    document.getElementById('tpr').onclick = () => prt(false); document.getElementById('tkey').onclick = () => prt(true);
    if (t.published && d.url) {
      document.getElementById('tcp').onclick = () => navigator.clipboard && navigator.clipboard.writeText(d.url);
      loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { const el = document.getElementById('tqr'); if (el && window.QRCode) new window.QRCode(el, { text: d.url, width: 140, height: 140, correctLevel: window.QRCode.CorrectLevel.M }); }).catch(() => {});
    }
  }

  /* ---------- telefon uygulaması ---------- */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; nav(); });
  window.addEventListener('appinstalled', () => { installEvt = null; nav(); });
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || document.referrer.startsWith('android-app://');
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /android/i.test(navigator.userAgent);
  async function viewApp() {
    setSub('Telefon uygulaması');
    let info = {}; try { info = await api('/api/app-info'); } catch { }
    const inApp = isStandalone();
    app.innerHTML = `<section class="appdl"><img src="/icons/icon-512.png" alt="" class="appicon"><h1>Eğitim Stüdyosu uygulaması</h1>
      <p class="muted">Derslerini telefonunun ana ekranından tek dokunuşla aç. Uygulama tam ekran açılır, giriş bilgilerin hatırlanır.</p>
      ${inApp ? '<div class="card" style="border-color:rgba(62,224,161,.5)"><b style="color:var(--green)">✓ Uygulamayı zaten kullanıyorsun.</b></div>' : ''}
      <div class="grid two" style="margin-top:14px">
        <div class="card"><h2 style="margin-top:0">Android</h2>
          ${installEvt ? '<p>Tek dokunuşla telefonuna yükle:</p><div class="btns"><button class="primary" id="inst">Uygulamayı yükle</button></div>' : `<ol class="steps-l"><li>Bu sayfayı <b>Chrome</b> ile aç.</li><li>Sağ üstteki <b>⋮</b> menüsüne dokun.</li><li><b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>'yi seç.</li></ol>`}
          ${info.play ? `<div class="btns"><a class="btn" href="${esc(info.play)}" target="_blank" rel="noopener">Google Play'den indir</a></div>` : ''}
          ${info.apk ? `<p class="note">Ya da uygulama dosyasını doğrudan indir (APK):</p><div class="btns"><a class="btn" href="${esc(info.apk)}">APK indir</a></div><p class="note">İlk kurulumda telefon "bilinmeyen kaynak" izni isteyebilir.</p>` : ''}</div>
        <div class="card"><h2 style="margin-top:0">iPhone ve iPad</h2>
          ${info.ios ? `<div class="btns"><a class="btn" href="${esc(info.ios)}" target="_blank" rel="noopener">App Store'dan indir</a></div>` : ''}
          <ol class="steps-l"><li>Bu sayfayı <b>Safari</b> ile aç.</li><li>Alttaki <b>Paylaş</b> düğmesine (kare ve yukarı ok) dokun.</li><li><b>Ana Ekrana Ekle</b>'yi seç, sonra <b>Ekle</b>'ye dokun.</li></ol></div>
      </div>
      <div class="card" style="margin-top:14px"><h2 style="margin-top:0">Bilgisayar</h2><p class="note" style="margin:0">Chrome ya da Edge'de adres çubuğunun sağındaki <b>yükle</b> simgesine tıkla.</p></div>
      <div class="card" style="margin-top:14px;text-align:center"><p class="note" style="margin-top:0">Telefonunla okut, uygulama sayfası açılsın:</p><div id="qrapp" style="background:#fff;padding:10px;border-radius:12px;width:max-content;margin:0 auto"></div></div></section>`;
    const b = document.getElementById('inst'); if (b) b.onclick = async () => { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r && r.outcome === 'accepted') { installEvt = null; viewApp(); } };
    loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js').then(() => { const el = document.getElementById('qrapp'); if (el && window.QRCode) new window.QRCode(el, { text: location.origin + '/#/uygulama', width: 150, height: 150 }); }).catch(() => {});
  }

  /* ---------- bildirimler ---------- */
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function pushState() {
    if (!pushSupported()) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  }
  async function enablePush(test) {
    const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error('Bildirim izni verilmedi');
    const { key } = await api('/api/push/key');
    const reg = await navigator.serviceWorker.ready;
    const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), test: !!test } });
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
  }
  // Profil sayfasındaki bildirim kartı
  async function pushCard(el) {
    const st = await pushState().catch(() => 'unsupported');
    const T = { on: '<b style="color:var(--green)">✓ Bu cihazda bildirimler açık.</b>', off: 'Bu cihazda bildirimler kapalı.', denied: 'Bildirimlere tarayıcı ayarlarından izin verilmemiş. Telefonun ayarlarından bu site/uygulama için bildirimlere izin verin.', unsupported: 'Bu tarayıcı bildirim desteklemiyor.', 'ios-install': 'iPhone\'da bildirim almak için önce uygulamayı ana ekrana ekleyin (Paylaş → Ana Ekrana Ekle), sonra uygulamadan açıp buradan bildirimleri açın.' };
    const isT = ME.user && ME.user.role !== 'student';
    el.innerHTML = `<p style="margin-top:0">${isT ? 'İçerik ve görseller onayınıza geldiğinde, video bittiğinde ve yeni katılım talebi olduğunda telefonunuza bildirim gelsin.' : 'Eğitime kabul edildiğinde ve yeni dersler açıldığında telefonuna bildirim gelsin.'}</p><p class="note">${T[st]}</p>
      <div class="btns">${st === 'off' ? '<button class="primary" id="pon">Bildirimleri aç</button>' : st === 'on' ? '<button id="ptest">Deneme bildirimi gönder</button><button class="danger" id="poff">Kapat</button>' : ''}</div><p class="note err-t" id="pmsg"></p>`;
    const m = el.querySelector('#pmsg'), run = async (f, b) => { b.disabled = true; try { await f(); pushCard(el); } catch (e) { m.textContent = e.message; b.disabled = false; } };
    const on = el.querySelector('#pon'); if (on) on.onclick = () => run(() => enablePush(true), on);
    const off = el.querySelector('#poff'); if (off) off.onclick = () => run(disablePush, off);
    const tst = el.querySelector('#ptest'); if (tst) tst.onclick = () => run(() => enablePush(true), tst);
  }
  // Bağlamsal öneri: bir kez sorulur (öğretmen video başlatınca, öğrenci derslerim'de)
  async function pushNudge(where) {
    try {
      if (!ME.user || lsGet('push_sordu_' + where, '') === '1' || document.querySelector('.pushnudge')) return;
      if (await pushState() !== 'off') return;
      const box = document.createElement('div'); box.className = 'card pushnudge';
      box.innerHTML = `<b>🔔 Bildirim alın</b><p class="note" style="margin:4px 0 0">${where === 'proje' ? 'İçerik hazır olunca beklemenize gerek kalmasın; telefonunuza haber verelim.' : 'Eğitime kabul edildiğinde ve yeni dersler açıldığında haber verelim.'}</p><div class="btns"><button class="primary" id="nyes">Bildirimleri aç</button><button id="nno">Şimdi değil</button></div>`;
      document.body.appendChild(box);
      box.querySelector('#nno').onclick = () => { lsSet('push_sordu_' + where, '1'); box.remove(); };
      box.querySelector('#nyes').onclick = async () => { lsSet('push_sordu_' + where, '1'); try { await enablePush(true); box.innerHTML = '<b style="color:var(--green)">✓ Bildirimler açıldı</b>'; setTimeout(() => box.remove(), 2500); } catch (e) { box.querySelector('.note').textContent = e.message; } };
    } catch { }
  }
  function alertBox(m) { const el = document.createElement('div'); el.className = 'card err'; el.style.marginTop = '12px'; el.textContent = m; app.appendChild(el); }

  async function route() {
    stop();
    const full = location.hash || '#/', h = full.split('?')[0];
    const me = await api('/api/me').catch(() => ({ user: null }));
    ME = me.user ? me : { user: null };
    nav();
    const u = ME.user;
    // herkese açık sayfalar
    if (h === '#/' || h === '#') { if (u && isTeacher() && u.role !== 'admin') { location.hash = '#/projeler'; return; } return viewStore(); }
    if (h === '#/vitrin') return viewStore();
    if (h === '#/uygulama') return viewApp();
    if (h === '#/giris' || h === '#/ogretmen' || h === '#/login') { if (u) { location.hash = homeOf(u); return; } return viewLogin(); }
    if (h === '#/kayit') { if (u) { location.hash = homeOf(u); return; } return viewRegister(); }
    let m = h.match(/^#\/o\/([\w-]+)$/); if (m) return viewTeacher(m[1]);
    m = h.match(/^#\/e\/([0-9a-f-]{36})$/); if (m) return viewCourse(m[1]);
    if (!u) { location.hash = '#/giris?r=' + encodeURIComponent(full); return; }
    if (h === '#/profil') return viewProfile();
    if (u.role === 'student') { if (h === '#/derslerim') return viewMyLearning(); location.hash = '#/derslerim'; return; }
    if (!isTeacher()) return viewPendingTeacher();
    if (h === '#/yonetim' && u.role === 'admin') return viewAdmin();
    if (h === '#/sonuclar') return viewLessons();
    if (h === '#/egitimler') return viewMyCourses();
    if (h === '#/ortak-sinav') return viewOrtak();
    m = h.match(/^#\/ortak-sinav\/c\/([0-9a-f-]{36})(?:\/([1-5]))?$/); if (m) return viewStudy(m[1], m[2] ? +m[2] : 0);
    m = h.match(/^#\/ortak-sinav\/yeni\/([1-4])$/); if (m) return viewWizard(+m[1]);
    m = h.match(/^#\/ortak-sinav\/t\/([0-9a-f-]{36})$/); if (m) return viewOrtakTest(m[1]);
    m = h.match(/^#\/egitimler\/([0-9a-f-]{36})$/); if (m) return viewEditCourse(m[1]);
    if (h === '#/talepler') return viewRequests();
    if (h === '#/paketim') return viewPlan();
    if (h === '#/basvuru') { location.hash = '#/projeler'; return; }
    m = h.match(/^#\/p\/([\w-]+)(\/ders|\/yayin)?/);
    if (m) { setSub('Konu yaz · onayla · video al'); return m[2] === '/ders' ? viewLesson(m[1]) : m[2] === '/yayin' ? viewPublish(m[1]) : viewProject(m[1]); }
    return viewList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
