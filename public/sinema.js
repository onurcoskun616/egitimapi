// Eğitim Stüdyosu — Sinematik film modülü arayüzü (yalnızca yönetici, bağımlılıksız)
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let pollTimer = null;

async function api(path, opts = {}) {
  const r = await fetch('/api/sinema' + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) { toLogin(); throw new Error('Yönetici girişi gerekli'); }
  if (!r.ok) throw new Error(j.error || 'Hata ' + r.status);
  return j;
}
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, bad ? 6000 : 2800); }
function route(h) { if (location.hash !== h) location.hash = h; else render(); }
window.addEventListener('hashchange', render);
function toLogin() { location.href = '/#/giris?r=' + encodeURIComponent('#/yonetim'); }
let ME_OK = false;

async function render() {
  clearTimeout(pollTimer);
  const h = location.hash || '#/';
  if (!ME_OK) { const me = await fetch('/api/me').then(r => r.ok ? r.json() : {}).catch(() => ({})); if (!me.user || me.user.role !== 'admin') return toLogin(); ME_OK = true; $('#top').hidden = false; }
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', (a.dataset.nav === 'list' && h === '#/') || (a.dataset.nav === 'panel' && h === '#/ayarlar') || (a.dataset.nav === 'new' && h === '#/yeni')));
  try {
    if (h === '#/yeni') return await newView();
    if (h === '#/ayarlar') return await panelView();
    if (h.startsWith('#/p/')) return await projectView(h.slice(4));
    return await listView();
  } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}


/* ---------- proje listesi ---------- */
const STAGE_TR = { script: 'Senaryo', chars: 'Karakterler', board: 'Sahne planı', frames: 'Sahne kareleri', audio: 'Ses ve müzik', videos: 'Video klipler', edit: 'Kurgu', done: 'Tamamlandı' };
function badge(p) {
  if (p.stage === 'done') return '<span class="badge done">Tamamlandı</span>';
  if (p.status === 'working') return `<span class="badge working">${STAGE_TR[p.stage]} · hazırlanıyor</span>`;
  if (p.status === 'error') return `<span class="badge error">${STAGE_TR[p.stage]} · hata</span>`;
  return `<span class="badge">${STAGE_TR[p.stage]} · onay bekliyor</span>`;
}
async function listView() {
  app.innerHTML = '<div class="spin"></div>';
  const list = await api('/projects');
  app.innerHTML = `<div class="row" style="margin-bottom:18px"><div><h1>Sinematik filmler</h1><p class="mute">Her proje bir video. Kartlara tıklayıp kaldığınız aşamadan devam edin.</p></div><div style="flex:0"><a class="btn gold" href="#/yeni">+ Yeni film</a></div></div>
  ${list.length ? `<div class="grid">${list.map(p => `<a class="card proj" href="#/p/${p.id}"><div class="th" style="${p.thumb ? `background-image:url('${esc(p.thumb)}')` : ''}">${p.thumb ? '' : '🎬'}</div><div class="bd"><h3>${esc(p.title || p.topic)}</h3>${badge(p)} <span class="dim small">${new Date(p.created_at).toLocaleDateString('tr-TR')}</span></div></a>`).join('')}</div>`
    : `<div class="card empty"><h2>Henüz film yok</h2><p class="mute">Bağlantılar (fal.ai, ElevenLabs, GitHub, Claude) eğitim platformuyla ortaktır. Model seçimleri için <a href="#/ayarlar">Ayarlar</a>.</p><a class="btn gold" href="#/yeni">İlk filmi başlat</a></div>`}`;
}

/* ---------- yeni video ---------- */
function chipGroup(name, items, val) { return `<div class="chips" data-chips="${name}">${items.map(([v, t]) => `<span class="chip ${v == val ? 'on' : ''}" data-v="${v}">${t}</span>`).join('')}</div>`; }
function bindChips() { document.querySelectorAll('[data-chips]').forEach(g => g.onclick = e => { const c = e.target.closest('.chip'); if (!c) return; g.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }); }
const chipVal = n => document.querySelector(`[data-chips="${n}"] .chip.on`)?.dataset.v;
function newView() {
  app.innerHTML = `<h1>Yeni film</h1><p class="mute">Sadece konuyu yazın. Senaryo, karakterler, sahne planı, görseller, videolar, müzik ve kurgu sırayla hazırlanır; her aşamada onayınız istenir (isterseniz tam otomatik).</p>
  <form class="card" id="f" style="max-width:760px">
    <label>Konu / anlatılacak olay</label>
    <textarea id="topic" rows="4" placeholder="Örnek: 27 Aralık 1919'da Mustafa Kemal'in Heyet-i Temsiliye ile Ankara'ya gelişi; Dikmen sırtlarında halkın karşılaması, zeybek gösterisi, Hacı Bayram Camii önünde çocuklarla karşılaşma."></textarea>
    <label>Süre</label>${chipGroup('duration', [[30, '30 sn'], [60, '1 dk'], [90, '1,5 dk'], [120, '2 dk'], [180, '3 dk']], 90)}
    <label>Format</label>${chipGroup('aspect', [['1:1', 'Kare 1:1 (Instagram)'], ['16:9', 'Yatay 16:9 (YouTube)'], ['9:16', 'Dikey 9:16 (Reels / Shorts)']], '1:1')}
    <label>Ton</label>${chipGroup('tone', [['duygusal, epik tarih draması', 'Duygusal tarih draması'], ['belgesel, sakin ve bilgilendirici', 'Belgesel'], ['destansı, coşkulu', 'Destansı'], ['merak uyandıran, gizemli', 'Merak uyandıran']], 'duygusal, epik tarih draması')}
    <label class="switch"><input type="checkbox" id="narration"> Dış ses anlatımı ekle (ElevenLabs)</label>
    <label>Ek istekler (isteğe bağlı)</label><textarea id="notes" rows="2" placeholder="Örnek: kış mevsimi, gün batımı ışığı; sonunda bayraklı çocuklar olsun; ekranda tarih yazsın."></textarea>
    <label class="switch"><input type="checkbox" id="auto"> Tam otomatik: onay beklemeden sonuna kadar ilerle</label>
    <div class="row tight" style="margin-top:16px"><button class="gold" id="go">Başlat →</button><span class="dim small">İlk adımda Claude senaryoyu yazar (1–3 dk).</span></div>
  </form>`;
  bindChips();
  $('#f').onsubmit = async e => {
    e.preventDefault(); $('#go').disabled = true;
    try {
      const p = await api('/projects', { method: 'POST', body: { topic: $('#topic').value, duration: +chipVal('duration'), aspect: chipVal('aspect'), tone: chipVal('tone'), narration: $('#narration').checked, notes: $('#notes').value, auto: $('#auto').checked } });
      route('#/p/' + p.id);
    } catch (er) { toast(er.message, true); $('#go').disabled = false; }
  };
}

/* ---------- proje ---------- */
let P = null; // açık proje
async function act(body, okMsg) {
  try { await api(`/projects/${P.id}/action`, { method: 'POST', body }); if (okMsg) toast(okMsg); projectView(P.id, true); }
  catch (e) { toast(e.message, true); }
}
async function projectView(id, quiet) {
  clearTimeout(pollTimer);
  if (!quiet) app.innerHTML = '<div class="spin"></div>';
  const keepScroll = window.scrollY;
  // Düzenleme yapılıyorsa (odak bir alandaysa) yeniden çizme
  const focused = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && app.contains(document.activeElement);
  const p = await api('/projects/' + id);
  const changed = !P || P.id !== p.id || JSON.stringify(P) !== JSON.stringify(p);
  P = p;
  if (changed && !(focused && p.status !== 'working')) {
    app.innerHTML = header(p) + statusBox(p) + `<div id="stage"></div>`;
    STAGE_VIEW[p.stage](p, $('#stage'));
    bindHeader(p);
    if (quiet) window.scrollTo(0, keepScroll);
  }
  if (p.status === 'working' || p.running) pollTimer = setTimeout(() => location.hash === '#/p/' + id && projectView(id, true), 3000);
}
function header(p) {
  const cur = p.stages.findIndex(s => s.k === p.stage);
  return `<div class="row"><div><a class="small" href="#/">← Filmler</a><h1 style="margin-top:6px">${esc(p.title || p.topic)}</h1>
    <div class="dim small">${esc(p.opts.duration)} sn · ${esc(p.opts.aspect)} · ${p.opts.narration ? 'anlatımlı' : 'anlatımsız'} · harcanan ≈ $${p.cost.toFixed(2)}</div></div>
    <div style="flex:0 0 auto;min-width:auto;flex-wrap:nowrap" class="row tight"><label class="switch" style="margin:0" title="Açıksa aşamalar onay beklemeden ilerler"><input type="checkbox" id="auto" ${p.auto ? 'checked' : ''}> Otomatik</label><button class="small danger" id="del">Sil</button></div></div>
  <div class="steps">${p.stages.map((s, i) => `<div class="step ${i < cur ? 'done' : i === cur ? 'cur' : ''}" data-goto="${i < cur && p.status !== 'working' ? s.k : ''}"><b>${i + 1}</b>${esc(s.name)}</div>`).join('')}</div>`;
}
function bindHeader(p) {
  $('#auto').onchange = e => act({ action: 'auto', value: e.target.checked }, e.target.checked ? 'Otomatik mod açık' : 'Onaylı mod');
  $('#del').onclick = async () => { if (!confirm('Proje silinsin mi?')) return; await api('/projects/' + p.id, { method: 'DELETE' }); route('#/'); };
  document.querySelectorAll('[data-goto]').forEach(el => el.onclick = () => { const k = el.dataset.goto; if (k && confirm(`"${STAGE_TR[k]}" aşamasına dönülsün mü? Üretilen içerikler korunur; onayladığınızda yalnızca eksikler üretilir.`)) act({ action: 'goto', stage: k }); });
}
function statusBox(p) {
  if (p.status === 'working') return `<div class="status"><div class="spin"></div><div><b>${esc(STAGE_TR[p.stage])}</b> hazırlanıyor… <span class="mute">${esc(p.progress && p.progress.text || '')}</span><div class="dim small">Sayfayı kapatabilirsiniz; iş arka planda sürer.</div></div></div>`;
  if (p.status === 'error') return `<div class="status error"><div><b>Hata:</b> ${esc(p.error)}<div style="margin-top:8px" class="row tight"><button class="small gold" onclick="act({action:'retry'})">Tekrar dene</button><a class="btn small" href="#/ayarlar">Sinema ayarları</a></div></div></div>`;
  if (p.stage === 'done') return '';
  const errs = itemErrors(p);
  return `<div class="status review"><div>✋ <b>Onayınız bekleniyor.</b> <span class="mute">İnceleyin, gerekirse düzeltin, sonra “Onayla ve devam” deyin.</span>${errs ? `<div class="err" style="margin-top:6px">${errs} öğe üretilemedi — kartlardaki hatayı okuyup tek tek yeniden deneyin ya da “Eksikleri tamamla”ya basın.</div>` : ''}</div></div>`;
}
function itemErrors(p) {
  const list = p.stage === 'chars' ? p.characters : ['frames', 'audio', 'videos'].includes(p.stage) ? p.scenes : [];
  return (list || []).filter(x => x.error).length + (p.stage === 'audio' && p.audio && p.audio.error ? 1 : 0);
}
const working = () => P.status === 'working';
function bar(extra = '', next = 'Onayla ve devam →') { return `<div class="bar">${extra}<button class="gold" id="approve" ${working() ? 'disabled' : ''}>${next}</button></div>`; }
function bindApprove(beforeFn) { const b = $('#approve'); if (b) b.onclick = async () => { if (beforeFn && (await beforeFn()) === false) return; act({ action: 'approve' }); }; }

const STAGE_VIEW = {
  script(p, el) {
    const s = p.script;
    if (!s) { el.innerHTML = working() ? '<div class="card mute">Claude senaryoyu ve karakterleri yazıyor… Bu adım GitHub Actions üzerinde 1–3 dakika sürer.</div>' : ''; return; }
    el.innerHTML = `<div class="two">
      <div class="card stack"><h2>Senaryo</h2>
        <div><label>Başlık</label><input data-s="title" value="${esc(s.title)}"></div>
        <div><label>Tek cümlelik özet</label><input data-s="logline" value="${esc(s.logline)}"></div>
        <div><label>Hikâye</label><textarea data-s="synopsis" rows="7">${esc(s.synopsis)}</textarea></div>
        <div><label>Dönem ve yer</label><input data-s="era" value="${esc(s.era)}"></div>
        <div class="row"><div><label>Açılış yazısı</label><input data-o="main" value="${esc(s.opening && s.opening.main)}"></div><div><label>Alt satır</label><input data-o="sub" value="${esc(s.opening && s.opening.sub)}"></div></div>
        <div><label>Bölümler</label>${(s.beats || []).map((b, i) => `<div class="small"><b>${i + 1}. ${esc(b.name)}</b> — <span class="mute">${esc(b.summary)}</span></div>`).join('')}</div>
        <details><summary>Görsel stil ve müzik tarifi (İngilizce, yapay zekâ için)</summary><label>Görsel stil</label><textarea data-s="look" rows="2">${esc(s.look)}</textarea><label>Müzik</label><textarea data-s="music" rows="2">${esc(s.music)}</textarea></details>
        ${(s.check || []).length ? `<div class="warn"><b>Doğrulamanız önerilen bilgiler:</b><ul style="margin:6px 0 0;padding-left:18px">${s.check.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
      </div>
      <div class="stack"><h2>Karakterler</h2>${(p.characters || []).map((c, i) => `<div class="card" data-c="${i}">
        <div class="row"><div><label>Ad</label><input data-k="name" value="${esc(c.name)}"></div><div><label>Rol</label><input data-k="role" value="${esc(c.role)}"></div></div>
        <label>Tanım</label><input data-k="about" value="${esc(c.about)}">
        <label>Görünüş (İngilizce, görsel üretimi için — gerçek ad yazılmaz)</label><textarea data-k="look_en" rows="3">${esc(c.look_en)}</textarea>
        <label class="switch"><input type="checkbox" data-k="ref" ${c.ref ? 'checked' : ''}> Referans görseli üret (birden çok sahnede görünecekse)</label></div>`).join('')}</div></div>
      <div class="card" style="margin-top:14px"><h3>Claude'a düzeltme yaptır</h3><textarea id="fb" rows="2" placeholder="Örnek: Zeybek sahnesini çıkar, karşılamaya Ankara'nın ileri gelenlerini ekle; daha az karakter olsun."></textarea>
      <div class="row tight" style="margin-top:8px"><button id="regen" ${working() ? 'disabled' : ''}>Düzeltmeyle yeniden yaz</button></div></div>
      ${bar(`<button id="save" ${working() ? 'disabled' : ''}>Değişiklikleri kaydet</button>`)}`;
    const collect = () => {
      const script = {}; el.querySelectorAll('[data-s]').forEach(i => script[i.dataset.s] = i.value);
      script.opening = { main: el.querySelector('[data-o=main]').value, sub: el.querySelector('[data-o=sub]').value };
      const characters = p.characters.map((c, i) => { const box = el.querySelector(`[data-c="${i}"]`); const o = { id: c.id }; box.querySelectorAll('[data-k]').forEach(x => o[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value); return o; });
      return { action: 'save', script, title: script.title, characters };
    };
    $('#save').onclick = () => act(collect(), 'Kaydedildi');
    $('#regen').onclick = async () => { const fb = $('#fb').value.trim(); if (!fb) return toast('Ne değişsin, yazın', true); act({ action: 'regenerate', feedback: fb }, 'Claude yeniden yazıyor…'); };
    bindApprove(async () => { await api(`/projects/${p.id}/action`, { method: 'POST', body: collect() }); });
  },

  chars(p, el) {
    const list = (p.characters || []);
    el.innerHTML = `<p class="mute">Bu görseller sahnelerde karakterlerin her seferinde aynı görünmesi için referans olarak kullanılır. Beğenmediğinizi tarifini düzeltip yeniden üretin.</p>
    <div class="grid">${list.map(c => `<div class="card media"><div class="vis">${c.image ? `<img src="${esc(c.image)}" loading="lazy">` : `<div class="ph">${c.status === 'working' ? '<div class="spin" style="margin:auto"></div>' : c.ref ? 'Görsel yok' : 'Referans görseli istenmedi'}</div>`}</div>
      <div class="bd"><h3>${esc(c.name)}</h3><div class="mute small">${esc(c.role)}</div>${c.error ? `<div class="err">${esc(c.error)}</div>` : ''}${c.note ? `<div class="dim small">${esc(c.note)}</div>` : ''}
      ${c.ref ? `<details style="margin-top:8px"><summary>Tarifi düzelt / yeniden üret</summary><textarea rows="4" data-look="${esc(c.id)}">${esc(c.look_en)}</textarea><button class="small" style="margin-top:6px" data-redo="${esc(c.id)}" ${working() ? 'disabled' : ''}>Yeniden üret</button></details>` : ''}</div></div>`).join('')}</div>
    ${bar(itemErrors(p) ? `<button onclick="act({action:'retry'})">Eksikleri tamamla</button>` : '')}`;
    el.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => act({ action: 'redo', kind: 'char', id: b.dataset.redo, look_en: el.querySelector(`[data-look="${b.dataset.redo}"]`).value }, 'Yeniden üretiliyor…'));
    bindApprove();
  },

  board(p, el) {
    const sc = p.scenes || [];
    if (!sc.length) { el.innerHTML = working() ? '<div class="card mute">Claude sahne planını hazırlıyor…</div>' : ''; return; }
    const total = sc.reduce((a, s) => a + s.sec, 0);
    const chars = p.characters || [];
    el.innerHTML = `<p class="mute">${sc.length} sahne · yaklaşık ${total} sn ham görüntü. Her sahnede önce ilk kare fotoğraf olarak, sonra kısa video üretilir. Metinleri doğrudan düzenleyebilirsiniz.</p>
    <div class="stack">${sc.map((s, i) => `<div class="card sc" data-i="${i}"><div class="num">${s.n}</div><div>
      <div class="row"><div style="flex:3"><label>Ne oluyor</label><input data-k="what" value="${esc(s.what)}"></div><div style="flex:1;min-width:110px"><label>Süre</label><select data-k="sec"><option value="5" ${s.sec == 5 ? 'selected' : ''}>5 sn</option><option value="10" ${s.sec == 10 ? 'selected' : ''}>10 sn</option></select></div></div>
      <div class="row"><div><label>Ekran yazısı</label><input data-k="overlay" value="${esc(s.overlay)}" placeholder="(yok)"></div>${p.opts.narration ? `<div style="flex:2"><label>Anlatım</label><input data-k="narration" value="${esc(s.narration)}"></div>` : ''}</div>
      <div class="small mute" style="margin-top:8px">Karakterler: ${chars.map(c => `<label style="display:inline-flex;gap:4px;margin:0 10px 0 0;color:var(--ink)"><input type="checkbox" style="width:auto" data-ch="${esc(c.id)}" ${s.chars.includes(c.id) ? 'checked' : ''}>${esc(c.name)}</label>`).join('') || '—'}</div>
      <details><summary>Görsel ve hareket tarifi (İngilizce)</summary><label>Plan</label><input data-k="shot" value="${esc(s.shot)}"><label>İlk kare</label><textarea data-k="image_en" rows="4">${esc(s.image_en)}</textarea><label>Hareket</label><textarea data-k="motion_en" rows="2">${esc(s.motion_en)}</textarea></details>
    </div></div>`).join('')}</div>
    <div class="card" style="margin-top:14px"><h3>Claude'a düzeltme yaptır</h3><textarea id="fb" rows="2" placeholder="Örnek: Daha fazla yakın plan olsun; 5. sahneyi çıkar; sona bayrak dalgalanan bir kapanış ekle."></textarea><div style="margin-top:8px"><button id="regen" ${working() ? 'disabled' : ''}>Düzeltmeyle yeniden yaz</button></div></div>
    <p class="dim small">Video üretimi tahmini maliyeti: ≈ $${p.video_estimate.toFixed(2)} (${esc(p.video_model.split('/').slice(1, 3).join(' '))}). Görseller sahne başı ≈ $0,08.</p>
    ${bar(`<button id="save" ${working() ? 'disabled' : ''}>Değişiklikleri kaydet</button>`)}`;
    const collect = () => ({ action: 'save', scenes: sc.map((s, i) => { const box = el.querySelector(`[data-i="${i}"]`); const o = { n: s.n }; box.querySelectorAll('[data-k]').forEach(x => o[x.dataset.k] = x.dataset.k === 'sec' ? +x.value : x.value); o.chars = [...box.querySelectorAll('[data-ch]')].filter(x => x.checked).map(x => x.dataset.ch); return o; }) });
    $('#save').onclick = () => act(collect(), 'Kaydedildi');
    $('#regen').onclick = () => { const fb = $('#fb').value.trim(); if (!fb) return toast('Ne değişsin, yazın', true); act({ action: 'regenerate', feedback: fb }, 'Claude planı yeniden yazıyor…'); };
    bindApprove(async () => { await api(`/projects/${p.id}/action`, { method: 'POST', body: collect() }); });
  },

  frames(p, el) {
    el.innerHTML = `<p class="mute">Her sahnenin ilk karesi. Videolar bu karelerden üretilecek; beğenmediğinizi tarifini düzeltip yeniden üretin.</p>
    <div class="grid">${(p.scenes || []).map(s => `<div class="card media"><div class="vis"><span class="n">${s.n}</span>${s.image ? `<img src="${esc(s.image)}" loading="lazy">` : `<div class="ph">${s.status === 'working' ? '<div class="spin" style="margin:auto"></div>' : 'Bekliyor'}</div>`}</div>
      <div class="bd"><div class="small">${esc(s.what)}</div>${s.overlay ? `<div class="dim small">Yazı: ${esc(s.overlay)}</div>` : ''}${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
      <details style="margin-top:6px"><summary>Tarifi düzelt / yeniden üret</summary><textarea rows="5" data-pr="${s.n}">${esc(s.image_en)}</textarea><button class="small" style="margin-top:6px" data-redo="${s.n}" ${working() ? 'disabled' : ''}>Yeniden üret</button></details></div></div>`).join('')}</div>
    ${bar(itemErrors(p) ? `<button onclick="act({action:'retry'})">Eksikleri tamamla</button>` : '')}`;
    el.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => act({ action: 'redo', kind: 'frame', id: +b.dataset.redo, prompt: el.querySelector(`[data-pr="${b.dataset.redo}"]`).value }, 'Yeniden üretiliyor…'));
    bindApprove();
  },

  audio(p, el) {
    const a = p.audio || {};
    el.innerHTML = `<div class="card stack"><h2>Müzik</h2>
      ${a.music ? `<audio controls src="${esc(a.music)}"></audio><div class="dim small">${a.uploaded ? 'Yüklediğiniz müzik' : 'ElevenLabs ile bestelendi'}</div>` : a.skipped ? '<div class="mute">Müziksiz devam edilecek.</div>' : a.error ? `<div class="err">${esc(a.error)}</div>` : '<div class="mute">Müzik henüz yok.</div>'}
      <details><summary>Müzik tarifini değiştir ve yeniden besteleyin</summary><textarea id="mp" rows="3">${esc(p.script && p.script.music)}</textarea><button class="small" id="remusic" style="margin-top:6px" ${working() ? 'disabled' : ''}>Yeniden bestele</button></details>
      <div class="row tight"><label class="btn small" style="margin:0;color:var(--ink)">Kendi müziğimi yükle<input type="file" id="up" accept="audio/*" hidden></label><button class="small" id="nomusic" ${working() ? 'disabled' : ''}>Müziksiz devam</button></div></div>
    ${p.opts.narration ? `<h2 style="margin-top:20px">Anlatım</h2><div class="stack">${(p.scenes || []).filter(s => s.narration).map(s => `<div class="card sc"><div class="num">${s.n}</div><div><div class="small">${esc(s.narration)}</div>${s.voice ? `<audio controls src="${esc(s.voice)}"></audio><div class="dim small">${s.voice_sec} sn${s.sec === 10 ? ' · sahne 10 sn' : ''}</div>` : s.status === 'working' ? '<div class="spin"></div>' : ''}${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
      <details><summary>Metni düzelt / yeniden seslendir</summary><textarea rows="2" data-pr="${s.n}">${esc(s.narration)}</textarea><button class="small" data-redo="${s.n}" style="margin-top:6px" ${working() ? 'disabled' : ''}>Yeniden seslendir</button></details></div></div>`).join('')}</div>` : ''}
    <p class="dim small" style="margin-top:16px">Sıradaki adım video klip üretimi: tahmini ≈ $${p.video_estimate.toFixed(2)} (fal.ai bakiyenizden düşer).</p>
    ${bar(itemErrors(p) ? `<button onclick="act({action:'retry'})">Eksikleri tamamla</button>` : '', 'Onayla ve videoları üret →')}`;
    $('#remusic').onclick = () => act({ action: 'music', prompt: $('#mp').value }, 'Müzik yeniden besteleniyor…');
    $('#nomusic').onclick = () => act({ action: 'nomusic' }, 'Müziksiz devam edilecek');
    $('#up').onchange = async e => { const f = e.target.files[0]; if (!f) return; toast('Yükleniyor…'); const r = await fetch(`/api/sinema/projects/${p.id}/music`, { method: 'POST', headers: { 'Content-Type': f.type || 'audio/mpeg' }, body: f }); if (r.ok) { toast('Müzik yüklendi'); projectView(p.id, true); } else toast('Yüklenemedi', true); };
    el.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => act({ action: 'redo', kind: 'voice', id: +b.dataset.redo, prompt: el.querySelector(`[data-pr="${b.dataset.redo}"]`).value }, 'Yeniden seslendiriliyor…'));
    bindApprove(() => confirm(`Video klipler üretilecek (tahmini ≈ $${p.video_estimate.toFixed(2)}). Devam edilsin mi?`));
  },

  videos(p, el) {
    el.innerHTML = `<p class="mute">Her sahnenin videosu. Bozuk görünen (yüz bozulması, garip hareket) klibi hareket tarifini sadeleştirip yeniden üretin.</p>
    <div class="grid">${(p.scenes || []).map(s => `<div class="card media"><div class="vis"><span class="n">${s.n}</span>${s.video ? `<video src="${esc(s.video)}" controls muted loop playsinline preload="metadata" poster="${esc(s.image || '')}"></video>` : s.image ? `<img src="${esc(s.image)}" style="opacity:.45">${s.status === 'working' ? '<div class="spin" style="position:absolute"></div>' : ''}` : '<div class="ph">Kare yok</div>'}</div>
      <div class="bd"><div class="small">${esc(s.what)}</div>${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
      <details style="margin-top:6px"><summary>Hareketi düzelt / yeniden üret</summary><textarea rows="3" data-pr="${s.n}">${esc(s.motion_en)}</textarea><button class="small" data-redo="${s.n}" style="margin-top:6px" ${working() ? 'disabled' : ''}>Yeniden üret</button></details></div></div>`).join('')}</div>
    ${bar(itemErrors(p) ? `<button onclick="act({action:'retry'})">Eksikleri tamamla</button>` : '', 'Onayla ve kurguya geç →')}`;
    el.querySelectorAll('video').forEach(v => { v.onmouseenter = () => v.play().catch(() => {}); v.onmouseleave = () => v.pause(); });
    el.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => act({ action: 'redo', kind: 'video', id: +b.dataset.redo, prompt: el.querySelector(`[data-pr="${b.dataset.redo}"]`).value }, 'Yeniden üretiliyor…'));
    bindApprove();
  },

  edit(p, el) {
    el.innerHTML = `<div class="card mute">Klipler birleştiriliyor; ekran yazıları, geçişler, anlatım ve müzik ekleniyor. Bu adım GitHub Actions'ta birkaç dakika sürer.</div>`;
  },

  done(p, el) {
    const f = p.final || {};
    el.innerHTML = f.url ? `<div class="final stack"><video src="${esc(f.url)}" controls playsinline></video>
      <div class="row tight"><a class="btn gold" href="${esc(f.url)}" download="${esc((p.title || 'video').replace(/[^\wığüşöçİĞÜŞÖÇ -]/g, ''))}.mp4" target="_blank">⬇ MP4 indir</a>
      <span class="dim small">${f.sec ? f.sec + ' sn · ' : ''}${f.mb ? f.mb + ' MB' : ''}</span>
      <button class="small" id="reedit">Kurguyu yeniden yap</button>
      ${f.cleaned ? '' : '<button class="small" id="clean">Ara dosyaları sil (depolama aç)</button>'}</div>
      <p class="dim small">Bir sahneyi değiştirmek için yukarıdaki aşama çizgisinden ilgili aşamaya dönün; onayladığınızda yalnızca değişen kısımlar yeniden üretilir.</p></div>`
      : '<div class="card mute">Video bulunamadı.</div>';
    const re = $('#reedit'); if (re) re.onclick = async () => { await api(`/projects/${p.id}/action`, { method: 'POST', body: { action: 'goto', stage: 'videos' } }); act({ action: 'approve' }, 'Kurgu yeniden başlatıldı'); };
    const cl = $('#clean'); if (cl) cl.onclick = async () => { if (!confirm('Klipler, sesler ve müzik silinecek (kareler ve son video kalır). Sonradan kurguyu yeniden yapmak için klipleri tekrar üretmek gerekir. Emin misiniz?')) return; const r = await api(`/projects/${p.id}/action`, { method: 'POST', body: { action: 'cleanup' } }); toast(r.ok ? `${r.removed} dosya silindi` : 'Silinemedi: ' + r.error, !r.ok); projectView(p.id, true); };
  },
};

/* ---------- sinema ayarları ---------- */
const GROUPS = [
  ['claude', 'Claude (senaryo, karakter, sahne planı)', 'Eğitim platformundaki gibi Claude aboneliğinizle GitHub Actions üzerinde çalışır.'],
  ['fal', 'fal.ai (görsel ve video)', 'Tek anahtarla Kling, Veo, Hailuo, Seedance ve görsel modelleri.'],
  ['eleven', 'ElevenLabs (anlatım ve müzik)', ''],
  ['kurgu', 'Kurgu', 'Son videonun görünümü.'],
];
const TESTS = { fal: 'fal', eleven: 'eleven', claude: 'github' };
async function panelView() {
  app.innerHTML = '<div class="spin"></div>';
  const { fields, keys } = await api('/settings');
  const by = g => fields.filter(f => f.group === g);
  const fieldHtml = f => `<div><label>${esc(f.label)}</label>${f.k === 'eleven_voice'
      ? `<div class="row tight" style="flex-wrap:nowrap"><select data-f="${f.k}" style="flex:1"><option value="${esc(f.value)}">${esc(f.value || '— platformun varsayılan sesi —')}</option></select><button class="small" id="voices" type="button">Sesleri getir</button></div>`
      : f.options ? `<select data-f="${f.k}">${[...new Set([...f.options, f.value].filter(Boolean))].map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : `<input data-f="${f.k}" value="${esc(f.value)}">`}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`;
  const key = (ok, name) => `<span class="conn"><span class="dot ${ok ? 'ok' : 'bad'}"></span>${ok ? `${name} tanımlı` : `<span class="err">${name} eksik</span>`}</span>`;
  app.innerHTML = `<h1>Sinema ayarları</h1><p class="mute">API anahtarları eğitim platformuyla ortaktır ve sunucudaki <code>.env</code> dosyasında durur; burada yalnızca modeller ve kurgu ayarları seçilir.</p>
  <div class="card row" style="gap:18px">${key(keys.fal, 'FAL_KEY')}${key(keys.eleven, 'ELEVENLABS_API_KEY')}${key(keys.github, 'GITHUB_TOKEN')}<span class="dim small">Depo: ${esc(keys.repo)}</span></div>
  <div class="card" style="margin-top:14px"><h3>fal.ai anahtarı</h3>
    <div class="mute small">${keys.fal ? `Kayıtlı (…${esc(keys.fal_tail)}). Değiştirmek için yenisini yapıştırın.` : '<span class="err">Girilmemiş.</span> <a target="_blank" href="https://fal.ai/dashboard/keys">fal.ai/dashboard/keys</a> sayfasında “Add key” → izin olarak <b>API</b> seçin → oluşan anahtarı buraya yapıştırın.'} Bu anahtar platformun tamamında (eğitim videolarının sinematik stili dahil) kullanılır.</div>
    <div class="row tight" style="margin-top:10px;flex-wrap:nowrap"><input id="falkey" type="password" autocomplete="off" placeholder="fal.ai anahtarı (ör. 1a2b3c…:4d5e6f…)" style="flex:1"><button class="gold small" id="savefal" type="button">Anahtarı kaydet</button></div></div>
  <div class="grid wide" style="margin-top:14px;align-items:start">${GROUPS.map(([g, name, desc]) => `<div class="card"><h2>${esc(name)}</h2>${desc ? `<div class="mute small">${esc(desc)}</div>` : ''}
    ${by(g).map(fieldHtml).join('')}
    ${TESTS[g] ? `<div class="row tight" style="margin-top:14px"><button class="small" data-test="${g}" type="button">Test et</button><span class="conn" id="t-${g}"><span class="dot"></span><span class="dim">Test edilmedi</span></span></div>` : ''}</div>`).join('')}</div>
  <div class="bar"><button class="gold" id="savep">Kaydet</button></div>`;
  const collect = () => { const o = {}; document.querySelectorAll('[data-f]').forEach(i => o[i.dataset.f] = i.value); return o; };
  $('#savefal').onclick = async () => {
    const v = $('#falkey').value.trim(); if (!v) return toast('Anahtarı yapıştırın', true);
    try { await api('/keys', { method: 'POST', body: { fal_key: v } }); const r = await api('/test/fal', { method: 'POST' }); toast(r.ok ? 'fal.ai anahtarı kaydedildi ve doğrulandı' : r.msg, !r.ok); panelView(); }
    catch (e) { toast(e.message, true); }
  };
  $('#savep').onclick = async () => { try { await api('/settings', { method: 'POST', body: collect() }); toast('Kaydedildi'); panelView(); } catch (e) { toast(e.message, true); } };
  $('#voices').onclick = async () => {
    try {
      const v = await api('/voices'); const sel = document.querySelector('[data-f=eleven_voice]'); const cur = sel.value;
      sel.innerHTML = '<option value="">— platformun varsayılan sesi —</option>' + v.map(x => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}${x.labels.gender ? ' · ' + esc(x.labels.gender) : ''}${x.labels.accent ? ' · ' + esc(x.labels.accent) : ''}</option>`).join('');
      toast(v.length + ' ses getirildi; seçip Kaydet’e basın');
    } catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-test]').forEach(b => b.onclick = async () => {
    const g = b.dataset.test, out = $('#t-' + g);
    const show = (ok, msg) => out.innerHTML = `<span class="dot ${ok === null ? '' : ok ? 'ok' : 'bad'}"></span><span class="${ok === false ? 'err' : ok ? '' : 'dim'}">${esc(msg)}</span>`;
    show(null, 'Test ediliyor…'); b.disabled = true;
    try { await api('/settings', { method: 'POST', body: collect() }); const r = await api('/test/' + TESTS[g], { method: 'POST' }); show(r.ok, r.msg); }
    catch (e) { show(false, e.message); }
    b.disabled = false;
  });
}

render();
