// Etkileşimli ders oynatıcısı: video bölüm sonlarında durur, sorular sorulur,
// cevaplar sunucuda değerlendirilir; sonunda kazanım özeti gösterilir.
(() => {
  const app = document.getElementById('app');
  const sid = (location.pathname.match(/\/izle\/([\w-]+)/) || [])[1];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const brand = '<div class="brand"><i></i>EĞİTİM STÜDYOSU</div>';
  const KEY = 'ders-' + sid;
  let L, S = null, video, cps = [], stage, P = null;

  async function api(path, body) {
    const r = await fetch('/api/l/' + sid + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Bağlantı sorunu, tekrar deneyin'); return j;
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ attempt: S.attempt, token: S.token, name: S.name, cps: cps.map(c => ({ done: c.done, result: c.result })), t: video ? video.currentTime : 0 })); } catch { } };

  /* ---------- açılış ---------- */
  async function init() {
    if (!sid) { app.innerHTML = brand + '<p class="err">Bağlantı hatalı.</p>'; return; }
    try { L = await api(''); } catch (e) { app.innerHTML = brand + `<div class="card"><p class="err">${esc(e.message)}</p></div>`; return; }
    document.title = L.title + ' · Etkileşimli Ders';
    // kontrol noktası zamanları videodaki sahne sınırlarından
    const lay = window.EVEngine.layout(L.bundle);
    const end = k => { const s = lay.scenes.find(x => x.k === k); return s ? s.e : lay.total; };
    const startOf = k => { const s = lay.scenes.find(x => x.k === k); return s ? s.s : 0; };
    let prevEnd = 0;
    cps = L.quiz.checkpoints.map((c, i) => { const t = end(c.after_k); const o = { i, ...c, t, from: prevEnd, done: false, result: null, pass: 1 }; prevEnd = t; return o; });
    cps.forEach((c, i) => { if (i === 0) c.from = 0; else c.from = cps[i - 1].t; });
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { }
    if (saved && saved.attempt && saved.cps && saved.cps.length === cps.length) {
      S = { attempt: saved.attempt, token: saved.token, name: saved.name };
      saved.cps.forEach((x, i) => { cps[i].done = x.done; cps[i].result = x.result; });
      return player(saved.t || 0, true);
    }
    welcome();
  }

  function welcome() {
    app.innerHTML = `${brand}<h1>${esc(L.title)}</h1>
      <div class="card"><b>Bu derste öğreneceklerin</b><ul class="kaz">${L.quiz.kazanimlar.map(k => `<li><b>${esc(k.id)}</b><span>${esc(k.text)}</span></li>`).join('')}</ul>
      <p class="note">Video ${cps.length} yerde duracak ve o bölümle ilgili kısa sorular soracak. Soruları cevaplamadan ileri saramazsın; yanlış yaparsan bölümü tekrar izleyebilirsin.</p></div>
      <form class="card" id="f" style="margin-top:14px"><label for="n">Adın soyadın</label><input id="n" required minlength="2" maxlength="80" autocomplete="name">
      <label for="c">Sınıf / numara <span style="text-transform:none;letter-spacing:0">(isteğe bağlı)</span></label><input id="c" maxlength="40" placeholder="11-B / 245">
      <div class="row"><button class="primary" type="submit" id="go">Derse başla</button></div>
      <p class="note">Adın ve cevapların yalnızca öğretmeninin sonuçları görebilmesi için kaydedilir.</p><p class="err" id="m"></p></form>`;
    document.getElementById('f').onsubmit = async e => {
      e.preventDefault(); const b = document.getElementById('go'); b.disabled = true;
      try { const name = document.getElementById('n').value.trim(); const r = await api('/start', { name, cls: document.getElementById('c').value }); S = { attempt: r.attempt, token: r.token, name }; save(); player(0); }
      catch (err) { document.getElementById('m').textContent = err.message; b.disabled = false; }
    };
  }

  /* ---------- oynatıcı ---------- */
  function pickVideo() {
    const v = L.videos, land = window.innerWidth > window.innerHeight * 1.1;
    if (land && v.yatay) return { url: v.yatay, f: 'yatay' };
    if (!land && v.dikey) return { url: v.dikey, f: 'dikey' };
    const f = v[L.format] ? L.format : Object.keys(v)[0]; return { url: v[f], f };
  }
  const AR = { dikey: '9/16', yatay: '16/9', kare: '1/1', dikey45: '4/5' };
  let guard = 0;
  function player(t0, resumed) {
    const pv = pickVideo();
    app.innerHTML = `${brand}<h1 style="font-size:clamp(22px,4.5vw,32px)">${esc(L.title)}</h1>
      <div class="stage" id="st" style="aspect-ratio:${AR[pv.f] || '9/16'}"><video id="v" playsinline preload="auto" controls controlslist="nofullscreen nodownload noplaybackrate" disablepictureinpicture src="${esc(pv.url)}"></video><button class="fsbtn" id="fs" type="button">Tam ekran</button></div>
      <div class="cps" id="cps" aria-label="Bölüm kontrolleri"></div><p class="note" id="hint">${resumed ? 'Kaldığın yerden devam ediyorsun.' : 'Oynat düğmesine bas. Video bölüm sonlarında soru sormak için duracak.'}</p>`;
    video = document.getElementById('v'); stage = document.getElementById('st');
    document.getElementById('fs').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => { }); };
    video.addEventListener('loadedmetadata', () => { const d = video.duration; cps.forEach(c => { c.tv = Math.min(c.t - 0.12, d - 0.2); }); if (t0) video.currentTime = Math.min(t0, nextLimit()); });
    // ileri sarma kilidi: cevaplanmamış kontrol noktasını geçemez
    let lastOk = 0;
    video.addEventListener('timeupdate', () => { if (video.currentTime <= nextLimit() + 0.05) lastOk = video.currentTime; });
    video.addEventListener('seeking', () => { if (video.currentTime > nextLimit() + 0.3) { video.currentTime = Math.min(lastOk, nextLimit()); flash('Önce bu bölümün sorularını cevaplamalısın.'); } });
    video.addEventListener('ended', () => { const c = cps.find(x => !x.done); if (c) ask(c); else finish(); });
    drawCps();
    const loop = () => { if (!document.body.contains(video)) return; const c = cps.find(x => !x.done); if (c && c.tv != null && video.currentTime >= c.tv && !document.getElementById('ov')) { video.pause(); ask(c); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    clearInterval(guard); guard = setInterval(save, 5000);
  }
  const nextLimit = () => { const c = cps.find(x => !x.done); return c ? (c.tv ?? c.t) : 1e9; };
  function flash(m) { const h = document.getElementById('hint'); if (h) { h.textContent = m; h.style.color = 'var(--yel)'; setTimeout(() => { h.style.color = ''; }, 2500); } }
  function drawCps() { const el = document.getElementById('cps'); if (!el) return; const cur = cps.find(x => !x.done); el.innerHTML = cps.map(c => `<span class="${c.done ? (c.result === 'ok' ? 'ok' : 'bad') : c === cur ? 'now' : ''}" title="${esc(c.title)}"></span>`).join(''); }

  /* ---------- soru katmanı ---------- */
  const TYPE = { mcq: 'Çoktan seçmeli', image: 'Görsel seç', blank: 'Boşluk doldur', tf: 'Doğru mu, yanlış mı?', order: 'Sırala' };
  function ask(c) {
    if (document.fullscreenElement && document.fullscreenElement !== stage) document.exitFullscreen().catch(() => { });
    const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'ov'; stage.appendChild(ov);
    if (!stage.matches(':fullscreen')) { stage.style.aspectRatio = ''; stage.style.minHeight = '560px'; }
    let qi = 0, okCount = 0;
    const next = () => {
      if (qi >= c.questions.length) return result();
      const x = c.questions[qi], n = c.questions.length, idx = qi;
      ov.innerHTML = `<div class="q"><div class="qh"><span>Bölüm kontrolü · ${esc(c.title || '')}</span><span>Soru ${idx + 1}/${n}</span></div><div class="note" style="margin-bottom:6px">${TYPE[x.type] || ''}</div><div id="body"></div><div id="fb"></div></div>`;
      const body = ov.querySelector('#body');
      const submit = async (resp, mark) => {
        body.querySelectorAll('button').forEach(b => b.disabled = true);
        let r; try { r = await api('/answer', { attempt: S.attempt, token: S.token, cp: c.i, qi: idx, response: resp, pass: c.pass }); }
        catch (e) { ov.querySelector('#fb').innerHTML = `<p class="err">${esc(e.message)}</p>`; body.querySelectorAll('button').forEach(b => b.disabled = false); return; }
        if (r.correct) okCount++; if (mark) mark(r);
        ov.querySelector('#fb').innerHTML = `<div class="fb ${r.correct ? 'ok' : 'no'}"><strong>${r.correct ? '✓ Doğru!' : '✗ Yanlış'}</strong>${!r.correct && r.correct_text ? `<div style="margin-top:6px">Doğru cevap: <b>${esc(r.correct_text)}</b></div>` : ''}${r.explain ? `<div class="note" style="margin-top:6px;color:var(--fg)">${esc(r.explain)}</div>` : ''}</div><div class="row"><button class="primary" id="nx">${idx + 1 < n ? 'Sonraki soru' : 'Bölüm sonucunu gör'}</button></div>`;
        ov.querySelector('#nx').onclick = () => { qi++; next(); }; ov.querySelector('#nx').focus();
      };
      render[x.type](x, body, submit);
    };
    const result = () => {
      const n = c.questions.length, pass = okCount / n >= 0.66;
      c.result = pass ? 'ok' : 'bad';
      ov.innerHTML = `<div class="q"><div class="qh"><span>Bölüm kontrolü · ${esc(c.title || '')}</span></div><div class="big">${okCount}/${n}</div>
        <p class="qt">${pass ? 'Harika, bu bölümü anlamışsın!' : 'Bu bölümü bir kez daha izlemeni öneririm.'}</p>
        <div class="row">${pass ? '<button class="primary" id="go">Devam et</button>' : '<button class="primary" id="re">Bölümü tekrar izle</button><button id="go">Yine de devam et</button>'}</div></div>`;
      const close = () => { ov.remove(); stage.style.minHeight = ''; stage.style.aspectRatio = AR[pickVideo().f] || ''; drawCps(); save(); };
      ov.querySelector('#go').onclick = () => { c.done = true; close(); if (cps.every(x => x.done) && (video.ended || video.currentTime >= video.duration - 0.5)) finish(); else video.play().catch(() => { }); };
      const re = ov.querySelector('#re'); if (re) re.onclick = () => { c.pass++; close(); video.currentTime = Math.max(0, c.from); video.play().catch(() => { }); };
    };
    next();
  }

  const shuffled = n => { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const render = {
    mcq(x, el, submit) {
      el.innerHTML = `<p class="qt">${esc(x.q)}</p><div class="opts">${shuffled(x.options.length).map(i => `<button data-i="${i}">${esc(x.options[i])}</button>`).join('')}</div>`;
      el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => submit(+b.dataset.i, r => { b.classList.add(r.correct ? 'ok' : 'no'); if (!r.correct && r.answer != null) { const k = el.querySelector(`[data-i="${r.answer}"]`); if (k) k.classList.add('ok'); } }));
    },
    tf(x, el, submit) {
      el.innerHTML = `<p class="qt">${esc(x.q)}</p><div class="opts" style="grid-template-columns:1fr 1fr"><button data-v="true">Doğru</button><button data-v="false">Yanlış</button></div>`;
      el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => submit(b.dataset.v === 'true', r => b.classList.add(r.correct ? 'ok' : 'no')));
    },
    image(x, el, submit) {
      const ord = shuffled(x.options.length);
      el.innerHTML = `<p class="qt">${esc(x.q)}</p><div class="imgs">${ord.map((i, n) => `<button data-i="${i}" aria-label="${n + 1}. görsel"><canvas width="410" height="345"></canvas><em>${n + 1}</em></button>`).join('')}</div>`;
      if (!P) { const off = document.createElement('canvas'); P = window.EVEngine.createPlayer(off, L.bundle); P.canvas = off; }
      el.querySelectorAll('[data-i]').forEach(b => {
        const o = x.options[+b.dataset.i], cv = b.querySelector('canvas');
        try { const r = P.still(o.k, o.at); if (r) cv.getContext('2d').drawImage(P.canvas, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height); } catch (e) { console.warn(e); }
        b.onclick = () => submit(+b.dataset.i, r => { b.classList.add(r.correct ? 'ok' : 'no'); if (!r.correct && r.answer != null) { const k = el.querySelector(`[data-i="${r.answer}"]`); if (k) k.classList.add('ok'); } });
      });
    },
    blank(x, el, submit) {
      const parts = x.text.split('___'), fill = Array(x.slots).fill(null);
      const draw = () => {
        el.innerHTML = `<p class="note">Kelimelere dokunarak boşlukları doldur. Değiştirmek için boşluğa dokun.</p><div class="sent">${parts.map((p, i) => esc(p) + (i < x.slots ? `<span class="slot" role="button" tabindex="0" data-s="${i}">${fill[i] != null ? esc(x.bank[fill[i]]) : '&nbsp;'}</span>` : '')).join('')}</div>
          <div class="bank">${x.bank.map((w, i) => `<button data-b="${i}" class="${fill.includes(i) ? 'used' : ''}" ${fill.includes(i) ? 'disabled' : ''}>${esc(w)}</button>`).join('')}</div>
          <div class="row"><button class="primary" id="ck" ${fill.includes(null) ? 'disabled' : ''}>Kontrol et</button></div>`;
        el.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { const s = fill.indexOf(null); if (s >= 0) { fill[s] = +b.dataset.b; draw(); } });
        el.querySelectorAll('[data-s]').forEach(s => s.onclick = () => { fill[+s.dataset.s] = null; draw(); });
        el.querySelector('#ck').onclick = () => { el.querySelectorAll('.slot').forEach(s => s.onclick = null); submit(fill.map(i => x.bank[i])); };
      };
      draw();
    },
    order(x, el, submit) {
      const seq = [];
      const draw = () => {
        el.innerHTML = `<p class="qt">${esc(x.q)}</p><p class="note">Maddelere doğru sırayla dokun. Geri almak için numaralı maddeye dokun.</p><div class="ord">${x.items.map(it => { const n = seq.indexOf(it.id); return `<button data-o="${it.id}" class="${n >= 0 ? 'sel' : ''}"><b>${n >= 0 ? n + 1 : ''}</b><span>${esc(it.t)}</span></button>`; }).join('')}</div>
          <div class="row"><button class="primary" id="ck" ${seq.length < x.items.length ? 'disabled' : ''}>Kontrol et</button></div>`;
        el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { const id = +b.dataset.o, n = seq.indexOf(id); if (n >= 0) seq.splice(n); else seq.push(id); draw(); });
        el.querySelector('#ck').onclick = () => submit(seq.slice());
      };
      draw();
    },
  };

  /* ---------- bitiş ---------- */
  async function finish() {
    clearInterval(guard);
    let r; try { r = await api('/finish', { attempt: S.attempt, token: S.token }); } catch (e) { app.insertAdjacentHTML('beforeend', `<p class="err">${esc(e.message)}</p>`); return; }
    try { localStorage.removeItem(KEY); } catch { }
    app.innerHTML = `${brand}<h1>Ders tamamlandı</h1><div class="card"><div class="big">%${r.pct}</div><p>${esc(S.name)}, ${r.total} sorudan ${r.correct} tanesini doğru cevapladın.</p>
      <ul class="res">${r.kazanimlar.map(k => `<li><span><b style="color:var(--yel)">${esc(k.id)}</b> ${esc(k.text)}</span><span class="chip" style="color:${k.learned ? 'var(--green)' : 'var(--yel)'}">${k.learned ? '✓ Öğrenildi' : '↻ Tekrar et'}</span></li>`).join('')}</ul>
      <p class="note">Sonuçların öğretmenine iletildi.</p><div class="row"><button id="again">Dersi baştan izle</button></div></div>`;
    document.getElementById('again').onclick = () => { cps.forEach(c => { c.done = false; c.result = null; c.pass++; }); player(0); };
  }

  init();
})();
