// Shorts Stüdyosu: konu → Claude sahne planı (web doğrulamalı) → kullanıcı onayı → 4 önizleme karesi → onay
// → (isteğe bağlı) ElevenLabs seslendirme → GitHub Actions'ta Python (Pillow + NumPy) render → MP4 + SRT + kapak.
// Görüntü yapay zekâ servisiyle değil, render/shorts/ altındaki şablon kodlarıyla çizilir.
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./shorts-prompts');
const eleven = require('./eleven');

module.exports = function shorts({ on, db, q, send, readBody, storage, ctxFor, logClaude, dispatch, now }) {
  const T = 'shorts_projects';
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const stamp = () => Date.now().toString(36);
  const STAGES = { plan: 'Sahne planı', review: 'Plan onayı', preview: 'Önizleme', approve: 'Önizleme onayı', voice: 'Seslendirme', render: 'Render', done: 'Tamamlandı' };

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
      if (t.status === 'queued' && Date.now() - t0 > 8 * 60 * 1000) throw new Error('İş 8 dakikada başlamadı. Depoda shorts.yml var mı, Actions açık mı kontrol edin.');
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
  async function voiceStage(id) {
    const p = await one(id);
    if (!p.opts.voice) { await set(id, { voice: null, stage: 'render' }); return renderStage(id); }
    const voiceId = p.opts.voice_id || process.env.ELEVENLABS_VOICE_ID;
    if (!voiceId) throw new Error('Seslendirme sesi seçilmedi (ELEVENLABS_VOICE_ID ya da projede ses)');
    const clips = []; let k = 0;
    for (const s of p.plan.scenes) {
      k++; const text = (s.caption || '').trim();
      if (!text) { clips.push(null); continue; }
      await progress(id, `Seslendirme (ElevenLabs) ${k}/${p.plan.scenes.length}`);
      const { audio, alignment } = await eleven.tts(text, voiceId);
      const path = fp(id, 'ses', `${stamp()}-${k}.mp3`);
      await storage.upload(path, audio, 'audio/mpeg');
      const ch = alignment.characters, st = alignment.character_start_times_seconds, en = alignment.character_end_times_seconds;
      const words = []; let cur = '', t0 = null;
      ch.forEach((c, i) => { if (/\s/.test(c)) { if (cur) words.push([+t0.toFixed(2), cur]); cur = ''; t0 = null; } else { if (t0 == null) t0 = st[i]; cur += c; } });
      if (cur) words.push([+t0.toFixed(2), cur]);
      clips.push({ path, sec: +(en[en.length - 1] || 0).toFixed(2), words });
    }
    await set(id, { voice: { clips, voice_id: voiceId, chars: p.plan.scenes.reduce((a, s) => a + (s.caption || '').length, 0), at: now() }, stage: 'render' });
    return renderStage(id);
  }

  async function renderStage(id) {
    const p = await one(id);
    const plan = JSON.parse(JSON.stringify(p.plan)); const voices = [];
    const lead = 0.5;   // ses sahne başından yarım saniye sonra başlar
    if (p.voice && p.voice.clips) {
      let t = 0;
      for (let i = 0; i < plan.scenes.length; i++) {
        const s = plan.scenes[i], c = p.voice.clips[i];
        if (c) {
          s.dur = Math.max(s.dur, +(c.sec + lead + 0.7).toFixed(2));
          s.words = c.words.map(([tt, w]) => [+(tt + lead).toFixed(2), w]);
          voices.push({ url: await urlOf(c.path, 8), at: +(t + lead).toFixed(2) });
        }
        t += s.dur;
      }
    }
    const u = { video: await storage.uploadTarget(fp(id, 'final', `shorts-${stamp()}.mp4`)), srt: await storage.uploadTarget(fp(id, 'final', `altyazi-${stamp()}.srt`)), cover: await storage.uploadTarget(fp(id, 'final', `kapak-${stamp()}.jpg`)) };
    const r = await runTask(id, { mode: 'render', plan, voices, music_level: voices.length ? Math.max(0.2, Math.min(1.5, +p.opts.music_level || 0.7)) : Math.max(0.2, Math.min(1.5, +p.opts.music_level || 1)), uploads: u }, 'Video çiziliyor ve kodlanıyor');
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
      voice: p.voice ? { chars: p.voice.chars, voice_id: p.voice.voice_id, sec: (p.voice.clips || []).reduce((a, c) => a + (c ? c.sec : 0), 0) } : null,
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
    const opts = { template: ['otomatik', ...Object.keys(P.TEMPLATES)].includes(b.template) ? b.template : 'otomatik', voice: !!b.voice, voice_id: String(b.voice_id || '').slice(0, 60), music_level: Math.max(0.2, Math.min(1.5, +b.music_level || 1)), notes: String(b.notes || '').slice(0, 1500) };
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
      case 'opts': await set(id, { opts: { ...p.opts, voice: !!b.voice, voice_id: String(b.voice_id || '').slice(0, 60), music_level: Math.max(0.2, Math.min(1.5, +b.music_level || 1)) } }); break;
      case 'replan': if (!String(b.feedback || '').trim()) return send(res, 400, { error: 'Ne değişsin, yazın' }); await set(id, { stage: 'plan' }); start(id, x => claudePlan(x, p.plan, String(b.feedback).slice(0, 1500)), 'Claude planı düzeltiyor…'); break;
      case 'preview': if (!p.plan) return send(res, 400, { error: 'Plan yok' }); await set(id, { stage: 'preview' }); start(id, previewStage, 'Önizleme kareleri çiziliyor…'); break;
      case 'approve': if (!p.previews) return send(res, 400, { error: 'Önce önizleme' }); await set(id, { stage: 'voice' }); start(id, voiceStage, p.opts.voice ? 'Seslendirme hazırlanıyor…' : 'Render başlıyor…'); break;
      case 'retry': {
        const fn = { plan: x => claudePlan(x), review: null, preview: previewStage, approve: null, voice: voiceStage, render: renderStage, done: renderStage }[p.stage];
        if (!fn) return send(res, 400, { error: 'Bu aşamada tekrar denenecek iş yok' });
        start(id, fn, 'Yeniden deneniyor…'); break;
      }
      case 'delete': {
        const paths = [...((p.previews && p.previews.paths) || []), ...((p.voice && p.voice.clips) || []).filter(Boolean).map(c => c.path), ...(p.final ? [p.final.video, p.final.srt, p.final.cover] : [])].filter(Boolean);
        if (paths.length) await storage.remove(paths).catch(() => {});
        await db.remove(T, `id=eq.${q(id)}`);
        return send(res, 200, { ok: true });
      }
      default: return send(res, 400, { error: 'Bilinmeyen işlem' });
    }
    send(res, 200, { ok: true });
  }, 'admin');
};
