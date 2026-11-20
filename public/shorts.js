// Shorts Stüdyosu arayüzü (yalnızca yönetici, bağımlılıksız)
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let pollTimer = null, META = null, ME_OK = false;

async function api(path, opts = {}) {
  const r = await fetch('/api/shorts' + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) { location.href = '/#/giris'; throw new Error('Yönetici girişi gerekli'); }
  if (!r.ok) throw new Error(j.error || 'Hata ' + r.status);
  return j;
}
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, bad ? 6000 : 2800); }
window.addEventListener('hashchange', render);

const TPL_TR = { otomatik: 'Otomatik (Claude seçsin)', siralama: 'Sıralama / geri sayım', mekanizma: 'Mekanizma / kesit', karsilastirma: 'Boyut karşılaştırma' };
const STEPS = [['plan', 'Sahne planı'], ['review', 'Plan onayı'], ['preview', 'Önizleme'], ['approve', 'Önizleme onayı'], ['voice', 'Seslendirme'], ['render', 'Render'], ['done', 'Tamamlandı']];

async function render() {
  clearTimeout(pollTimer);
  const h = location.hash || '#/';
  if (!ME_OK) { const me = await fetch('/api/me').then(r => r.ok ? r.json() : {}).catch(() => ({})); if (!me.user || me.user.role !== 'admin') { location.href = '/#/giris'; return; } ME_OK = true; $('#top').hidden = false; }
  if (!META) META = await api('/meta');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', (a.dataset.nav === 'list' && h === '#/') || (a.dataset.nav === 'new' && h === '#/yeni')));
  try {
    if (h === '#/yeni') return newView();
    if (h.startsWith('#/p/')) return await projectView(h.slice(4));
    return await listView();
  } catch (e) { app.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}

/* ---------- liste ---------- */
async function listView() {
  const rows = await api('/projects');
  app.innerHTML = `<h1>Shorts Stüdyosu</h1><p class="mute">60 saniyelik dikey bilgi videoları. Görüntüler yapay zekâ servisiyle değil, kodla çizilir (sıralama, mekanizma kesiti, boyut karşılaştırma); müzik ve efektler de kodla üretilir.</p>
  ${rows.length ? `<div class="grid">${rows.map(p => `<a class="card" href="#/p/${p.id}" style="text-decoration:none;color:inherit">
    ${p.cover ? `<img src="${esc(p.cover)}" style="width:100%;border-radius:10px;margin-bottom:8px;aspect-ratio:9/16;object-fit:cover">` : ''}
    <b>${esc(p.title || p.topic)}</b><div class="small dim">${esc(p.stage_name || p.stage)}${p.status === 'working' ? ' · çalışıyor' : p.status === 'error' ? ' · hata' : ''}</div></a>`).join('')}</div>` : '<div class="card">Henüz video yok. <a href="#/yeni">İlk Shorts\'u oluşturun.</a></div>'}`;
}

/* ---------- yeni ---------- */
async function voiceOptions(sel) {
  try { const vs = await fetch('/api/sinema/voices').then(r => r.ok ? r.json() : []); return `<option value="">Varsayılan anlatıcı sesi</option>` + vs.map(v => `<option value="${esc(v.voice_id || v.id)}" ${sel === (v.voice_id || v.id) ? 'selected' : ''}>${esc(v.name)}</option>`).join(''); }
  catch { return '<option value="">Varsayılan anlatıcı sesi</option>'; }
}
async function newView() {
  app.innerHTML = `<h1>Yeni Shorts</h1><div class="card">
    <label>Konu</label><textarea id="topic" rows="3" placeholder="Örn: Türkiye'nin en uzun 10 köprüsü · Motor nasıl çalışır? · Güneş sistemi gezegenlerinin boyutları"></textarea>
    <label style="margin-top:12px">Şablon</label>
    <div class="chips" id="tpl">${Object.entries(TPL_TR).map(([k, v], i) => `<span class="chip ${i ? '' : 'on'}" data-v="${k}">${v}</span>`).join('')}</div>
    <div class="small dim" style="margin-top:6px">${Object.entries(META.templates).map(([k, v]) => `<div>• <b>${esc(TPL_TR[k])}</b>: ${esc(v.split('—')[1] || v)}</div>`).join('')}</div>
    <label style="margin-top:12px">Ek istekler (isteğe bağlı)</label><textarea id="notes" rows="2" placeholder="Örn: öğrencilere yönelik sade anlatım; son sahnede soru sor"></textarea>
    <label class="switch"><input type="checkbox" id="voice"> ElevenLabs seslendirmesi ekle (kapalıyken yalnızca müzik, efekt ve altyazı)</label>
    <div id="voiceBox" hidden><label>Ses</label><select id="voiceId">${await voiceOptions('')}</select></div>
    <label>Müzik seviyesi</label><input type="range" id="music" min="0.2" max="1.5" step="0.1" value="1">
    <div style="margin-top:14px"><button class="gold" id="go">Planı hazırla →</button></div></div>`;
  let tpl = 'otomatik';
  $('#tpl').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; $('#tpl').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); tpl = c.dataset.v; };
  $('#voice').onchange = () => $('#voiceBox').hidden = !$('#voice').checked;
  $('#go').onclick = async () => {
    try { const r = await api('/projects', { method: 'POST', body: { topic: $('#topic').value, template: tpl, notes: $('#notes').value, voice: $('#voice').checked, voice_id: $('#voiceId').value, music_level: +$('#music').value } }); location.hash = '#/p/' + r.id; }
    catch (e) { toast(e.message, true); }
  };
}

/* ---------- proje ---------- */
const act = async (id, body, msg) => { try { await api(`/projects/${id}/action`, { method: 'POST', body }); if (msg) toast(msg); render(); } catch (e) { toast(e.message, true); } };
function stepsBar(p) {
  const i = STEPS.findIndex(s => s[0] === p.stage);
  return `<div class="steps">${STEPS.map(([k, n], j) => `<div class="step ${j < i ? 'done' : j === i ? 'cur' : ''}"><b>${j + 1}</b>${n}</div>`).join('')}</div>`;
}
const field = (lab, key, val, type = 'text', extra = '') => type === 'area'
  ? `<div><label>${lab}</label><textarea data-k="${key}" rows="2" ${extra}>${esc(val)}</textarea></div>`
  : `<div><label>${lab}</label><input data-k="${key}" type="${type}" value="${esc(val == null ? '' : val)}" ${extra}></div>`;

function sceneFields(t, s) {
  const f = [];
  f.push(field('Süre (sn)', 'dur', s.dur, 'number', 'step="0.5" min="2" max="15"'));
  if (t === 'siralama') {
    if (s.type === 'intro') f.push(field('Üst satır', 'title_top', s.title_top), field('Orta satır', 'title_main', s.title_main), field('Büyük satır', 'title_big', s.title_big));
    if (s.type === 'item') f.push(field('Sıra', 'rank', s.rank, 'number'), field('Ad', 'name', s.name), field('Alt ad', 'sub', s.sub), field('Konum', 'place', s.place), field('Değer (sayı)', 'value', s.value, 'number', 'step="any"'), field('Gösterilecek değer (isteğe bağlı)', 'value_text', s.value_text), field('Dipnot', 'note', s.note));
    if (s.type === 'outro') f.push(field('Başlık', 'title', s.title));
  } else if (t === 'mekanizma') {
    if (s.key === 'intro') f.push(field('Başlık 1', 'title1', s.title1), field('Başlık 2', 'title2', s.title2), field('Alt başlık', 'subtitle', s.subtitle));
  } else {
    if (s.type !== 'focus') f.push(field('Başlık 1', 'title1', s.title1), field('Başlık 2', 'title2', s.title2));
  }
  f.push(`<div style="grid-column:1/-1">${field('Altyazı / seslendirme cümlesi', 'caption', s.caption, 'area')}</div>`);
  return `<div class="row" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">${f.join('')}</div>`;
}
function sceneLabel(t, s) {
  if (t === 'siralama') return s.type === 'intro' ? 'Giriş' : s.type === 'outro' ? 'Kapanış' : `#${s.rank} ${esc(s.name)}`;
  if (t === 'mekanizma') return { intro: 'Giriş', parts: 'Parçalar', emme: '1. zaman: Emme', sik: '2. zaman: Sıkıştırma', is: '3. zaman: İş', egz: '4. zaman: Egzoz', fast: 'Tam çevrim (hızlanan)', dizel: 'Bonus: Dizel', outro: 'Kapanış' }[s.key] || s.key;
  return s.type === 'group' ? 'Giriş (yan yana)' : s.type === 'outro' ? 'Kapanış' : 'Odak: ' + esc((planCache.objects[s.obj] || {}).name || '');
}
let planCache = null;

async function projectView(id) {
  const p = await api('/projects/' + id); planCache = p.plan;
  const working = p.status === 'working';
  let body = '';
  if (p.status === 'error') body += `<div class="card err" style="margin-bottom:12px">Hata: ${esc(p.error)} <button class="small" id="retry">Tekrar dene</button></div>`;
  if (working) body += `<div class="card" style="margin-bottom:12px"><div class="spin" style="display:inline-block;width:16px;height:16px;vertical-align:middle;margin-right:8px"></div>${esc(p.progress || 'Çalışıyor…')}</div>`;
  if (p.plan && ['review', 'preview', 'approve'].includes(p.stage)) {
    const pl = p.plan; const total = pl.scenes.reduce((a, s) => a + (+s.dur || 0), 0);
    const src = p.sources || {};
    body += `<div class="card" style="margin-bottom:12px"><b>Şablon:</b> ${esc(TPL_TR[pl.template])} · <b>Toplam:</b> ${total.toFixed(1)} sn · ${pl.scenes.length} sahne
      ${src.verified === false ? '<div class="warnbox">Bilgiler web aramasıyla doğrulanamadı; sayıları yayınlamadan önce kontrol edin.</div>' : ''}
      ${(src.check || []).length ? `<div class="small" style="margin-top:8px"><b>Kontrol edilmesi önerilenler:</b><ul>${src.check.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
      ${(src.list || []).length ? `<details class="small src" style="margin-top:6px"><summary>Kaynaklar (${src.list.length})</summary><ul>${src.list.map(s => `<li>${esc(s.title || '')} ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''}</li>`).join('')}</ul></details>` : ''}</div>`;
    if (pl.template === 'karsilastirma') body += `<div class="card" style="margin-bottom:12px"><b>Nesneler</b> (küçükten büyüğe, boyut: ${esc(pl.unit)})
      ${pl.objects.map((o, i) => `<div class="row" data-obj="${i}" style="display:grid;grid-template-columns:30px repeat(5,1fr);gap:6px;margin-top:6px"><span class="dim">${i}</span>
        <input data-o="name" value="${esc(o.name)}"><input data-o="size" type="number" step="any" value="${o.size}"><input data-o="size_text" placeholder="gösterim" value="${esc(o.size_text || '')}">
        <input data-o="compare" placeholder="karşılaştırma" value="${esc(o.compare || '')}"><select data-o="kind">${META.kinds.map(k => `<option ${k === o.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`).join('')}</div>`;
    body += pl.scenes.map((s, i) => `<div class="scn" data-i="${i}"><div class="no">${i + 1}</div><div><b>${sceneLabel(pl.template, s)}</b>${sceneFields(pl.template, s)}</div></div>`).join('');
    body += `<div class="card" style="margin:12px 0"><div class="row tight"><button id="save" ${working ? 'disabled' : ''}>Değişiklikleri kaydet</button></div>
      <label style="margin-top:12px">Claude'a düzelttir</label><textarea id="fb" rows="2" placeholder="Örn: 8 öğe olsun; giriş cümlesini daha merak uyandırıcı yap"></textarea>
      <button class="small" id="replan" style="margin-top:6px" ${working ? 'disabled' : ''}>Düzeltmeyle yeniden yaz</button>
      <details style="margin-top:12px"><summary class="small dim">Gelişmiş: planı JSON olarak düzenle</summary><textarea id="json" rows="12" style="font-family:monospace;font-size:12px">${esc(JSON.stringify(pl, null, 1))}</textarea><button class="small" id="savejson">JSON'u kaydet</button></details></div>`;
  }
  if (p.previews && ['approve', 'voice', 'render', 'done', 'preview'].includes(p.stage)) {
    const w = p.previews.warnings || [];
    body += `<div class="card" style="margin-bottom:12px"><b>Önizleme kareleri</b> <span class="small dim">(en kalabalık anlar · ${esc(p.previews.font || '')})</span>
      ${w.length ? `<div class="warnbox"><b>Metin kontrolü:</b><ul>${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>Planı düzenleyip önizlemeyi yenileyin.</div>` : '<div class="small" style="color:#7c7;margin:6px 0">Metin kontrolü: taşan ya da üst üste binen metin bulunmadı.</div>'}
      <div class="pv">${(p.previews.urls || []).map(u => `<a href="${esc(u)}" target="_blank"><img src="${esc(u)}"></a>`).join('')}</div></div>`;
  }
  if (p.stage === 'approve' || p.stage === 'review') {
    body += `<div class="card" style="margin-bottom:12px"><label class="switch"><input type="checkbox" id="voice" ${p.opts.voice ? 'checked' : ''}> ElevenLabs seslendirmesi</label>
      <div id="voiceBox" ${p.opts.voice ? '' : 'hidden'}><label>Ses</label><select id="voiceId">${await voiceOptions(p.opts.voice_id)}</select><div class="small dim">Seslendirme önce üretilir, sahne süreleri sese göre uzar; altyazı kelime zamanlarına oturur, müzik konuşma altında kısılır.</div></div>
      <label>Müzik seviyesi</label><input type="range" id="music" min="0.2" max="1.5" step="0.1" value="${p.opts.music_level || 1}"></div>`;
  }
  if (p.final) {
    body += `<div class="card" style="margin-bottom:12px"><b>Sonuç</b> · ${p.final.sec} sn · ${p.final.mb} MB
      <video class="final" src="${esc(p.final.video_url)}" controls playsinline poster="${esc(p.final.cover_url)}" style="margin:10px 0"></video>
      <div class="row tight"><a class="btn gold" href="${esc(p.final.video_url)}" download>MP4 indir</a><a class="btn" href="${esc(p.final.srt_url)}" download>SRT indir</a><a class="btn" href="${esc(p.final.cover_url)}" download>Kapak görseli</a></div></div>`;
  }
  const nextBtn = working ? '' : p.stage === 'review' ? '<button class="gold" id="next">Önizleme karelerini çiz →</button>'
    : p.stage === 'approve' ? '<button class="small" id="repv">Önizlemeyi yenile</button> <button class="gold" id="next">Onayla ve videoyu üret →</button>' : '';
  app.innerHTML = `<a href="#/" class="small dim">← Videolar</a><h1>${esc(p.title || p.topic)}</h1>${stepsBar(p)}${body}
    <div class="row tight" style="justify-content:space-between">${nextBtn}<button class="small" id="del" style="color:var(--red)">Sil</button></div>`;

  const collect = () => {
    const pl = JSON.parse(JSON.stringify(p.plan));
    app.querySelectorAll('.scn').forEach(el => { const s = pl.scenes[+el.dataset.i]; el.querySelectorAll('[data-k]').forEach(inp => { const k = inp.dataset.k; let v = inp.value; if (inp.type === 'number') v = v === '' ? null : +v; else if (v === '' && k !== 'caption') v = null; s[k] = v; }); });
    app.querySelectorAll('[data-obj]').forEach(el => { const o = pl.objects[+el.dataset.obj]; el.querySelectorAll('[data-o]').forEach(inp => { const k = inp.dataset.o; o[k] = k === 'size' ? +inp.value : (inp.value || null); }); });
    return pl;
  };
  const saveOpts = async () => { if ($('#voice')) await api(`/projects/${id}/action`, { method: 'POST', body: { action: 'opts', voice: $('#voice').checked, voice_id: $('#voiceId') ? $('#voiceId').value : '', music_level: +$('#music').value } }); };
  if ($('#voice')) $('#voice').onchange = () => { $('#voiceBox').hidden = !$('#voice').checked; saveOpts(); };
  if ($('#voiceId')) $('#voiceId').onchange = saveOpts;
  if ($('#music')) $('#music').onchange = saveOpts;
  if ($('#retry')) $('#retry').onclick = () => act(id, { action: 'retry' });
  if ($('#save')) $('#save').onclick = () => act(id, { action: 'save', plan: collect() }, 'Kaydedildi');
  if ($('#savejson')) $('#savejson').onclick = () => { let pl; try { pl = JSON.parse($('#json').value); } catch (e) { return toast('JSON hatalı: ' + e.message, true); } act(id, { action: 'save', plan: pl }, 'Kaydedildi'); };
  if ($('#replan')) $('#replan').onclick = () => act(id, { action: 'replan', feedback: $('#fb').value }, 'Claude planı yeniden yazıyor');
  if ($('#next')) $('#next').onclick = async () => {
    if (p.stage === 'review') { await api(`/projects/${id}/action`, { method: 'POST', body: { action: 'save', plan: collect() } }).catch(e => toast(e.message, true)); return act(id, { action: 'preview' }, 'Önizleme kareleri çiziliyor'); }
    await saveOpts(); act(id, { action: 'approve' }, 'Video üretimi başladı');
  };
  if ($('#repv')) $('#repv').onclick = async () => { await api(`/projects/${id}/action`, { method: 'POST', body: { action: 'save', plan: collect() } }).catch(e => toast(e.message, true)); act(id, { action: 'preview' }, 'Önizleme yenileniyor'); };
  $('#del').onclick = () => { if (confirm('Bu Shorts projesi ve dosyaları silinsin mi?')) act(id, { action: 'delete' }).then(() => location.hash = '#/'); };
  if (working) pollTimer = setTimeout(render, 4000);
}

render();
