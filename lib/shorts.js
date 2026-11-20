// Shorts Stüdyosu: konu → Claude sahne planı (web doğrulamalı) → kullanıcı onayı → 4 önizleme karesi → onay
// → (isteğe bağlı) ElevenLabs seslendirme → GitHub Actions'ta Python (Pillow + NumPy) render → MP4 + SRT + kapak.
// Görüntü yapay zekâ servisiyle değil, render/shorts/ altındaki şablon kodlarıyla çizilir.
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./shorts-prompts');
const eleven = require('./eleven');
const TR = require('./tr-sayi');

module.exports = function shorts({ on, db, q, send, readBody, storage, ctxFor, logClaude, dispatch, now }) {
  const T = 'shorts_projects';
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const stamp = () => Date.now().toString(36);
  const STAGES = { plan: 'Sahne planı', review: 'Plan onayı', preview: 'Önizleme', approve: 'Önizleme onayı', voice: 'Ses ve efekt', render: 'Render', done: 'Tamamlandı' };

  (function migrate() {
    if (!process.env.DB_REST_URL) return;
    const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE || 'egitim', '-f', path.join(__dirname, '..', 'deploy', 'shorts.sql')], { encoding: 'utf8', timeout: 30000 });
    if (r.status === 0) console.log('Shorts: tablo hazır'); else console.error('Shorts: tablo oluşturulamadı —', (r.stderr || (r.error && r.error.message) || '').slice(0, 300));
  })();

  const one = id => db.one(T, `id=eq.${q(id)}`);
  const set = (id, patch) => db.update(T, `id=eq.${q(id)}`, { ...patch, updated_at: now() });
  const progress = (id, text) => set(id, { progress: text });
  const URLS = new Map();
  async function urlOf(p, hours = 6) {
    if (!p) return null;
    const c = URLS.get(p); if (c && c.exp > Date.now() + 3600e3) return c.url;
    const url = await storage.signedUrl(p, hours * 3600); URLS.set(p, { url, exp: Date.now() + hours * 3600e3 }); return url;
  }
  const fp = (id, ...a) => ['shorts', id, ...a].join('/');

  /* ---------- Claude: sahne planı (web aramasıyla doğrulama) ---------- */
  async function claudePlan(id, prev, feedback) {
    const p = await one(id);
    const user = P.userPrompt(p, prev, feedback);
    await progress(id, 'Claude sahne planını yazıyor ve bilgileri web aramasıyla doğruluyor (GitHub Actions, 2–6 dk)…');
    let res, verified = true;
    try { [res] = await ctxFor(null, 'shorts').viaActions([{ system: P.SYSTEM, user, web: true }], process.env.CLAUDE_MODEL || undefined); if (!res || res.error) throw new Error((res && res.error) || 'yanıt yok'); }
    catch (e) {
      console.error('Shorts web doğrulamalı plan başarısız, araçsız deneniyor:', e.message); verified = false;
      await progress(id, 'Web araması kullanılamadı; plan araçsız yazılıyor…');
      [res] = await ctxFor(null, 'shorts').viaActions([{ system: P.SYSTEM, user: user + '\n\n(Web araması kullanılamıyor; yalnızca emin olduğun bilgileri yaz ve doğrulanması gerekenleri "check" listesine ekle.)' }]);
      if (!res || res.error) throw new Error('Claude: ' + ((res && res.error) || 'yanıt yok'));
    }
    if (res.usage) logClaude(null, [res.usage], 'shorts').catch(() => {});
    let j; const t = res.text; const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); const s = m ? m[1] : t;
    try { j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch (e) { throw new Error('Claude yanıtı okunamadı: ' + e.message); }
    const plan = P.normalize(j);
    await set(id, { plan, title: plan.title || p.topic, sources: { list: (j.sources || []).slice(0, 20), check: (j.check || []).slice(0, 20), verified }, stage: 'review', previews: null, voice: null });
  }

  /* ---------- GitHub Actions render görevi ---------- */
  async function runTask(id, manifest, label) {
    const token = crypto.randomBytes(24).toString('hex');
    const task = await db.insert('gen_tasks', { project_id: null, kind: 'shorts', items: [manifest], token, meta: { shorts_id: id } });
    try { await dispatch('shorts.yml', { task_id: task.id, token }); }
    catch (e) { await db.update('gen_tasks', `id=eq.${task.id}`, { status: 'failed', error: e.message.slice(0, 500), consumed: true }).catch(() => {}); throw e; }
    await progress(id, `${label}: GitHub Actions'ta sıraya alındı…`);
    const t0 = Date.now();
    while (Date.now() - t0 < 60 * 60 * 1000) {
      await sleep(5000);
      const t = await db.one('gen_tasks', `id=eq.${task.id}&select=status,results,error,progress`);
      if (t.status === 'running') await progress(id, `${label}…` + (t.progress && t.progress.total ? ` %${Math.round(100 * t.progress.done / t.progress.total)}` : ' (kurulum)'));
      if (t.status === 'done') { await db.update('gen_tasks', `id=eq.${task.id}`, { consumed: true }); return (t.results && t.results[0]) || {}; }
      if (t.status === 'failed') { await db.update('gen_tasks', `id=eq.${task.id}`, { consumed: true }); throw new Error(label + ' başarısız: ' + (t.error || '')); }
      if (t.status === 'queued' && Date.now() - t0 > 12 * 60 * 1000) throw new Error('İş 12 dakikada başlamadı (GitHub Actions kuyruğu ya da kurulum takıldı). “Tekrar dene”ye basın.');
    }
    throw new Error(label + ' 60 dakikada bitmedi');
  }

  async function previewStage(id) {
    const p = await one(id);
    const targets = await Promise.all([1, 2, 3, 4].map(k => storage.uploadTarget(fp(id, 'onizleme', `${stamp()}-${k}.jpg`))));
    const r = await runTask(id, { mode: 'preview', plan: p.plan, uploads: { previews: targets } }, 'Önizleme kareleri çiziliyor');
    await set(id, { previews: { paths: r.previews || [], warnings: r.warnings || [], total: r.total, font: r.font, at: now() }, stage: 'approve' });
  }

  // Seslendirme: her sahnenin cümlesi ayrı okunur; sahne süresi = max(plan süresi, ses + 0.7 sn); kelime zamanları altyazıya gider
  // Yapay zekâ ortam sesleri (ElevenLabs ses efekti): her sahnenin sfx_en tarifinden, sahne süresi kadar
  async function sfxStage(id) {
    const p = await one(id);
    if (!p.opts.ai_sfx) return null;
    if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY tanımlı değil');
    const out = []; let k = 0;
    for (const s of p.plan.scenes) {
      k++; const text = (s.sfx_en || '').trim();
      if (!text) { out.push(null); continue; }
      await progress(id, `Yapay zekâ ses efektleri (ElevenLabs) ${k}/${p.plan.scenes.length}`);
      const sec = Math.max(1, Math.min(22, (+s.dur || 5) + 0.5));
      const r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, duration_seconds: sec, prompt_influence: 0.45 }) });
      if (!r.ok) { const t = await r.text(); throw new Error(`Ses efekti (sahne ${k}) üretilemedi: HTTP ${r.status} ${t.slice(0, 200)}`); }
      const path = fp(id, 'efekt', `${stamp()}-${k}.mp3`);
      await storage.upload(path, Buffer.from(await r.arrayBuffer()), 'audio/mpeg');
      out.push({ path, text });
    }
    return out;
  }

  async function voiceStage(id) {
    let p = await one(id);
    const sfx = await sfxStage(id);
    await set(id, { voice: sfx ? { ...(p.voice || {}), sfx } : null });
    p = await one(id);
    if (!p.opts.voice) { await set(id, { stage: 'render' }); return renderStage(id); }
    const voiceId = p.opts.voice_id || process.env.ELEVENLABS_VOICE_ID;
    if (!voiceId) throw new Error('Seslendirme sesi seçilmedi (ELEVENLABS_VOICE_ID ya da projede ses)');
    // Akıcı anlatım: bütün sahnelerin cümleleri TEK seferde seslendirilir (tonlama sahneden sahneye kopmaz),
    // sonra kelime zamanlarına göre sahnelere bölünür. Sayılar yazıyla okunur, altyazıda rakamlar korunur.
    await progress(id, 'Seslendirme (ElevenLabs) — tüm metin tek parça okunuyor…');
    let full = ''; const parts = [];
    p.plan.scenes.forEach((s, i) => {
      const text = (s.caption || '').trim();
      if (!text) { parts.push(null); return; }
      const sp = TR.speakable(text);
      if (full) full += ' ';
      parts.push({ i, start: full.length, len: sp.text.length, map: sp.map.map(m => ({ ...m, start: m.start + full.length })) });
      full += sp.text;
    });
    if (!full) throw new Error('Seslendirilecek cümle yok');
    const { audio, alignment } = await eleven.tts(full, voiceId);
    const path = fp(id, 'ses', `${stamp()}-anlatim.mp3`);
    await storage.upload(path, audio, 'audio/mpeg');
    const st = alignment.character_start_times_seconds, en = alignment.character_end_times_seconds, n = st.length;
    const ok = alignment.characters.length === full.length;
    const at = i => st[Math.min(n - 1, Math.max(0, i))], endAt = i => en[Math.min(n - 1, Math.max(0, i))];
    const segs = parts.map(pt => pt && { i: pt.i, t0: at(pt.start), t1: endAt(pt.start + pt.len - 1), words: pt.map.map(m => [ok ? at(m.start) : null, m.word]) });
    // sahne sınırı: önceki cümlenin bitişi ile sonrakinin başlangıcının ortası (doğal nefes payı korunur)
    const live = segs.filter(Boolean);
    live.forEach((g, k) => {
      g.a = k === 0 ? Math.max(0, g.t0 - 0.15) : (live[k - 1].t1 + g.t0) / 2;
      g.b = k === live.length - 1 ? endAt(n - 1) + 0.35 : (g.t1 + live[k + 1].t0) / 2;
      if (!ok) { const L = g.words.length; g.words = g.words.map(([, w], j) => [g.t0 + (g.t1 - g.t0) * j / Math.max(1, L), w]); }
      g.words = g.words.map(([t, w]) => [+Math.max(0, t - g.a).toFixed(2), w]);
      g.a = +g.a.toFixed(3); g.b = +g.b.toFixed(3);
    });
    await set(id, { voice: { ...(p.voice || {}), path, segs, sec: +endAt(n - 1).toFixed(2), voice_id: voiceId, chars: full.length, at: now() }, stage: 'render' });
    return renderStage(id);
  }

  async function renderStage(id) {
    const p = await one(id);
    const plan = JSON.parse(JSON.stringify(p.plan)); const voices = [];
    // Tek parça anlatım sahnelere bölünür; her sahne en az MIN sn sürer (animasyonlar sığsın), fazlası olmaz → boşluksuz akış
    const MIN = { intro: 3.2, outro: 4.2 };
    if (p.voice && p.voice.segs) {
      const url = await urlOf(p.voice.path, 8);
      let t = 0;
      for (let i = 0; i < plan.scenes.length; i++) {
        const s = plan.scenes[i], g = p.voice.segs[i];
        if (g) {
          const len = g.b - g.a;
          const kind = s.type || s.key;
          const minD = MIN[kind] || (plan.template === 'mekanizma' ? Math.min(s.dur, 6) : 3.4);
          s.dur = +Math.max(len, minD).toFixed(3);
          s.words = g.words;
          voices.push({ url, at: +t.toFixed(3), from: g.a, to: g.b });
        }
        t += s.dur;
      }
    } else if (p.voice && p.voice.clips) {   // eski projeler: sahne sahne seslendirme
      const lead = 0.5; let t = 0;
      for (let i = 0; i < plan.scenes.length; i++) {
        const s = plan.scenes[i], c = p.voice.clips[i];
        if (c) { s.dur = Math.max(s.dur, +(c.sec + lead + 0.7).toFixed(2)); s.words = c.words.map(([tt, w]) => [+(tt + lead).toFixed(2), w]); voices.push({ url: await urlOf(c.path, 8), at: +(t + lead).toFixed(2) }); }
        t += s.dur;
      }
    }
    const sfx = [];
    if (p.voice && p.voice.sfx) {
      let t = 0;
      for (let i = 0; i < plan.scenes.length; i++) { const c = p.voice.sfx[i]; if (c) sfx.push({ url: await urlOf(c.path, 8), at: +t.toFixed(2), dur: plan.scenes[i].dur }); t += plan.scenes[i].dur; }
    }
    const u = { video: await storage.uploadTarget(fp(id, 'final', `shorts-${stamp()}.mp4`)), srt: await storage.uploadTarget(fp(id, 'final', `altyazi-${stamp()}.srt`)), cover: await storage.uploadTarget(fp(id, 'final', `kapak-${stamp()}.jpg`)) };
    const r = await runTask(id, { mode: 'render', plan, voices, sfx, sfx_level: 0.55, music_level: voices.length ? Math.max(0.2, Math.min(1.5, +p.opts.music_level || 0.7)) : Math.max(0.2, Math.min(1.5, +p.opts.music_level || 1)), uploads: u }, 'Video çiziliyor ve kodlanıyor');
    await set(id, { final: { video: r.video, srt: r.srt, cover: r.cover, sec: r.sec, mb: r.mb, at: now() }, stage: 'done' });
  }

  /* ---------- aşama yürütücüsü (kuyruk: aynı anda tek render) ---------- */
  let chain = Promise.resolve();
  function start(id, fn, label) {
    set(id, { status: 'working', error: null, progress: label }).catch(() => {});
    chain = chain.then(async () => {
      try { await fn(id); await set(id, { status: 'idle', progress: null }); }
      catch (e) { console.error('Shorts', id, e); await set(id, { status: 'error', error: String(e.message || e).slice(0, 900), progress: null }).catch(() => {}); }
    });
  }
  setTimeout(async () => {
    try {
      for (const r of await db.select(T, 'select=id,stage&status=eq.working')) {
        const fn = { plan: x => claudePlan(x), preview: previewStage, voice: voiceStage, render: renderStage }[r.stage];
        if (fn) start(r.id, fn, 'Sunucu yeniden başladı, kaldığı yerden sürüyor…'); else await set(r.id, { status: 'idle' });
      }
    } catch (e) { console.error('Shorts resume:', e.message); }
  }, 4000);

  async function view(p) {
    return {
      ...p, stage_name: STAGES[p.stage],
      previews: p.previews ? { ...p.previews, urls: await Promise.all((p.previews.paths || []).map(x => urlOf(x))) } : null,
      final: p.final ? { ...p.final, video_url: await urlOf(p.final.video), srt_url: await urlOf(p.final.srt), cover_url: await urlOf(p.final.cover) } : null,
      voice: p.voice ? { chars: p.voice.chars, voice_id: p.voice.voice_id, sec: p.voice.sec || (p.voice.clips || []).reduce((a, c) => a + (c ? c.sec : 0), 0), sfx: (p.voice.sfx || []).filter(Boolean).length } : null,
    };
  }

  /* ---------- API ---------- */
  on('GET', '/api/shorts/meta', async (req, res) => send(res, 200, { templates: P.TEMPLATES, kinds: P.KINDS, palettes: P.PALETTES, sections: P.MECH_SECTIONS, voice_default: process.env.ELEVENLABS_VOICE_ID || '' }), 'admin');
  on('GET', '/api/shorts/projects', async (req, res) => {
    const rows = await db.select(T, 'select=id,title,topic,stage,status,final,created_at&order=created_at.desc&limit=100');
    send(res, 200, await Promise.all(rows.map(async r => ({ ...r, final: undefined, cover: r.final ? await urlOf(r.final.cover) : null, stage_name: STAGES[r.stage] }))));
  }, 'admin');
  on('POST', '/api/shorts/projects', async (req, res) => {
    const b = await readBody(req);
    if (!b.topic || String(b.topic).trim().length < 5) return send(res, 400, { error: 'Konu en az birkaç kelime olmalı' });
    const opts = { template: ['otomatik', ...Object.keys(P.TEMPLATES)].includes(b.template) ? b.template : 'otomatik', ai_sfx: !!b.ai_sfx, voice: !!b.voice, voice_id: String(b.voice_id || '').slice(0, 60), music_level: Math.max(0.2, Math.min(1.5, +b.music_level || 1)), notes: String(b.notes || '').slice(0, 1500) };
    const row = await db.insert(T, { topic: String(b.topic).trim().slice(0, 500), title: String(b.topic).trim().slice(0, 80), opts, stage: 'plan' });
    start(row.id, x => claudePlan(x), 'Claude sahne planını hazırlıyor…');
    send(res, 200, { id: row.id });
  }, 'admin');
  on('GET', '/api/shorts/projects/:id', async (req, res, { id }) => { const p = await one(id); if (!p) return send(res, 404, { error: 'Bulunamadı' }); send(res, 200, await view(p)); }, 'admin');
  on('POST', '/api/shorts/projects/:id/action', async (req, res, { id }) => {
    const b = await readBody(req); const p = await one(id);
    if (!p) return send(res, 404, { error: 'Bulunamadı' });
    if (p.status === 'working') return send(res, 409, { error: 'Şu an çalışıyor, bitmesini bekleyin' });
    switch (b.action) {
      case 'save': {   // kullanıcı planı düzenledi
        let plan; try { plan = P.normalize(b.plan); } catch (e) { return send(res, 400, { error: e.message }); }
        await set(id, { plan, stage: 'review', previews: null, voice: null, error: null, status: 'idle' });
        break;
      }
      case 'opts': await set(id, { opts: { ...p.opts, ai_sfx: b.ai_sfx === undefined ? !!p.opts.ai_sfx : !!b.ai_sfx, voice: !!b.voice, voice_id: String(b.voice_id || '').slice(0, 60), music_level: Math.max(0.2, Math.min(1.5, +b.music_level || 1)) } }); break;
      case 'replan': if (!String(b.feedback || '').trim()) return send(res, 400, { error: 'Ne değişsin, yazın' }); await set(id, { stage: 'plan' }); start(id, x => claudePlan(x, p.plan, String(b.feedback).slice(0, 1500)), 'Claude planı düzeltiyor…'); break;
      case 'preview': if (!p.plan) return send(res, 400, { error: 'Plan yok' }); await set(id, { stage: 'preview' }); start(id, previewStage, 'Önizleme kareleri çiziliyor…'); break;
      case 'approve': if (!p.previews) return send(res, 400, { error: 'Önce önizleme' }); await set(id, { stage: 'voice' }); start(id, voiceStage, p.opts.voice ? 'Seslendirme hazırlanıyor…' : 'Render başlıyor…'); break;
      case 'retry': {
        const fn = { plan: x => claudePlan(x), review: null, preview: previewStage, approve: null, voice: voiceStage, render: renderStage, done: renderStage }[p.stage];
        if (!fn) return send(res, 400, { error: 'Bu aşamada tekrar denenecek iş yok' });
        start(id, fn, 'Yeniden deneniyor…'); break;
      }
      case 'delete': {
        const paths = [...((p.previews && p.previews.paths) || []), ...((p.voice && p.voice.clips) || []).filter(Boolean).map(c => c.path), ...(p.voice && p.voice.path ? [p.voice.path] : []), ...((p.voice && p.voice.sfx) || []).filter(Boolean).map(c => c.path), ...(p.final ? [p.final.video, p.final.srt, p.final.cover] : [])].filter(Boolean);
        if (paths.length) await storage.remove(paths).catch(() => {});
        await db.remove(T, `id=eq.${q(id)}`);
        return send(res, 200, { ok: true });
      }
      default: return send(res, 400, { error: 'Bilinmeyen işlem' });
    }
    send(res, 200, { ok: true });
  }, 'admin');
};
