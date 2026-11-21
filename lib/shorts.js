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
  // Tanıtım: kullanıcının yüklediği kart fotoğrafları (depolama yolu) → render için imzalı adres
  async function withPhotos(plan, hours = 8) {
    if (!plan || !['tanitim', 'konusan'].includes(plan.template)) return plan;
    const out = JSON.parse(JSON.stringify(plan));
    for (const s of out.scenes) for (const c of s.cards || []) if (c.photo) c.photo_url = await urlOf(c.photo, hours);
    if (out.character) { const c = out.character; if (c.photo) c.photo_url = await urlOf(c.photo, hours); if (c.portrait) c.portrait_url = await urlOf(c.portrait, hours); }
    return out;
  }

  /* ---------- fal.ai: konuşan karakter (çizim + dudak senkronlu konuşma videosu) ---------- */
  const AVATAR_MODEL = 'fal-ai/kling-video/ai-avatar/v2/standard';   // görsel + ses → konuşan video, ≈ 0,056 $/sn
  function falErr(status, body) {
    const d = body && (body.detail || body.error || body.message);
    const msg = typeof d === 'string' ? d : d ? JSON.stringify(d).slice(0, 400) : 'HTTP ' + status;
    if (status === 402 || /balance|credit|exhausted/i.test(msg)) return 'fal.ai bakiyesi bitti; fal.ai/dashboard/billing adresinden kredi yükleyin, sonra tekrar deneyin. ' + msg;
    if (status === 401 || status === 403) return 'fal.ai anahtarı geçersiz (FAL_KEY). ' + msg;
    if (/content|safety|policy|nsfw|flagged/i.test(msg)) return 'İçerik filtresine takıldı. ' + msg;
    return 'fal.ai: ' + msg;
  }
  async function falRun(model, input, timeoutMs = 25 * 60 * 1000) {
    if (!process.env.FAL_KEY) throw new Error('fal.ai anahtarı girilmemiş (Sinema → Ayarlar → fal.ai anahtarı)');
    const H = { Authorization: 'Key ' + process.env.FAL_KEY, 'Content-Type': 'application/json' };
    const r = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: H, body: JSON.stringify(input) });
    const h = await r.json().catch(() => ({})); if (!r.ok) throw new Error(falErr(r.status, h));
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(5000);
      const s = await fetch(h.status_url, { headers: H }); const j = await s.json().catch(() => ({}));
      if (!s.ok && s.status !== 202) throw new Error(falErr(s.status, j));
      if (j.status === 'COMPLETED') {
        const rr = await fetch(h.response_url, { headers: H }); const out = await rr.json().catch(() => ({}));
        if (!rr.ok || (out.detail && !out.images && !out.video)) throw new Error(falErr(rr.status || 422, out));
        return out;
      }
    }
    throw new Error('fal.ai yanıtı zaman aşımına uğradı');
  }
  async function saveRemote(url, dest, type) {
    const r = await fetch(url); if (!r.ok) throw new Error('Üretilen dosya indirilemedi: HTTP ' + r.status);
    return storage.upload(dest, Buffer.from(await r.arrayBuffer()), type);
  }
  async function editModel() {
    const row = await db.one('settings', 'key=eq.sinema').catch(() => null);
    return (row && row.value && row.value.edit_model) || 'fal-ai/nano-banana-2/edit';
  }
  // Fotoğraftaki kişiyi seçilen tarzda, kameraya bakan dikey (9:16) karakter portresine çevirir; "fix" verilirse mevcut portreyi düzeltir
  async function drawCharacter(id, ch, fix) {
    const model = await editModel(); const st = P.CHAR_STYLES[ch.style] || P.CHAR_STYLES.animasyon;
    let prompt, refs;
    if (fix && ch.portrait) {
      prompt = `Edit the FIRST image according to this instruction, written in Turkish: "${fix}". Change only what the instruction asks for; keep the same person, identity, framing, camera angle, art style and colors. The person must still look straight into the camera with the mouth gently closed.`;
      refs = [await urlOf(ch.portrait, 2), ...(ch.photo ? [await urlOf(ch.photo, 2)] : [])];
    } else {
      prompt = `Create a vertical 9:16 character portrait of the person in the reference image for a talking-head video. Chest-up, centered, head in the upper-middle third with some headroom, body facing the camera, looking straight into the lens, mouth gently closed, calm friendly expression, shoulders visible, hands not visible. Keep the identity clearly recognizable: face shape, eyes, eyebrows, nose, hair, facial hair, glasses, skin tone and distinctive features. ${ch.setting ? 'Background / setting: ' + ch.setting + ', softly blurred.' : 'Simple, softly blurred, uncluttered background that suits the style.'}${fix ? ' Extra request (in Turkish): ' + fix + '.' : ''} STYLE: ${st.en}`;
      refs = [await urlOf(ch.photo, 2)];
    }
    const out = await falRun(model, { prompt: prompt + ' No text, no letters, no watermark, no logo.', image_urls: refs, aspect_ratio: '9:16', num_images: 1, output_format: 'jpeg', resolution: '1K' });
    const img = out.images && out.images[0]; if (!img || !img.url) throw new Error('fal.ai görsel döndürmedi' + (out.description ? ': ' + String(out.description).slice(0, 200) : ''));
    return saveRemote(img.url, fp(id, 'karakter', `${stamp()}.jpg`), 'image/jpeg');
  }
  async function ensurePortrait(id, fix) {
    const p = await one(id); const ch = p.plan.character || {};
    if (!ch.photo) throw new Error('Karakter fotoğrafı yüklenmedi: "Karakter" kartından fotoğraf yükleyin.');
    if (ch.ready && !fix) {   // kullanıcı hazır çizimini yükledi: ücretli çizim yok, görsel olduğu gibi kullanılır
      if (ch.portrait !== ch.photo) await set(id, { plan: { ...p.plan, character: { ...ch, portrait: ch.photo, portrait_of: 'hazir' } }, voice: p.voice ? { ...p.voice, avatars: null } : p.voice });
      return;
    }
    const sig = `${ch.photo}|${ch.style}|${ch.setting || ''}`;
    if (ch.portrait && ch.portrait_of === sig && !fix) return;
    await progress(id, fix ? 'Karakter düzeltiliyor (fal.ai)…' : 'Karakter çiziliyor (fal.ai)…');
    const portrait = await drawCharacter(id, ch, fix);
    const plan = { ...p.plan, character: { ...ch, portrait, portrait_of: sig } };
    await set(id, { plan, voice: p.voice ? { ...p.voice, avatars: null } : p.voice });
  }
  // Her sahnenin seslendirmesi + karakter portresi → dudak senkronlu konuşma videosu (aynı anda 3 iş)
  async function avatarStage(id) {
    const p = await one(id); const ch = p.plan.character || {};
    const clips = (p.voice && p.voice.clips) || [];
    if (!ch.portrait) throw new Error('Karakter portresi yok; önizlemeyi yenileyin.');
    const prev = (p.voice && p.voice.avatars) || [];
    const avatars = clips.map((c, i) => (c && prev[i] && prev[i].clip === c.path && prev[i].img === ch.portrait) ? prev[i] : null);
    const todo = clips.map((c, i) => c && !avatars[i] ? i : -1).filter(i => i >= 0);
    let done = 0; const errs = [];
    const img = await urlOf(ch.portrait, 24);
    await progress(id, `Konuşan karakter videoları (fal.ai Kling Avatar) 0/${todo.length} — her biri 2–6 dk`);
    const work = async i => {
      try {
        const out = await falRun(AVATAR_MODEL, { image_url: img, audio_url: await urlOf(clips[i].path, 24), prompt: 'The character talks naturally and warmly to the camera, subtle natural head movement, natural blinking, mouth movements match the speech.' });
        const v = out.video && out.video.url; if (!v) throw new Error('fal.ai video döndürmedi');
        avatars[i] = { path: await saveRemote(v, fp(id, 'konusma', `${stamp()}-${i + 1}.mp4`), 'video/mp4'), sec: +(out.duration || clips[i].sec), clip: clips[i].path, img: ch.portrait };
        const cur = await one(id); await set(id, { voice: { ...cur.voice, avatars } });
      } catch (e) { errs.push(`Sahne ${i + 1}: ${e.message}`); }
      await progress(id, `Konuşan karakter videoları (fal.ai Kling Avatar) ${++done}/${todo.length}`);
    };
    const q2 = [...todo]; await Promise.all([0, 1, 2].map(async () => { while (q2.length) await work(q2.shift()); }));
    if (errs.length) throw new Error(errs[0] + (errs.length > 1 ? ` (+${errs.length - 1} sahne daha)` : ''));
    return avatars;
  }

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
    if (j.template === 'konusan' && prev && prev.character) j.character = prev.character;
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
    if ((await one(id)).plan.template === 'konusan') await ensurePortrait(id);
    const p = await one(id);
    const targets = await Promise.all([1, 2, 3, 4].map(k => storage.uploadTarget(fp(id, 'onizleme', `${stamp()}-${k}.jpg`))));
    const r = await runTask(id, { mode: 'preview', plan: await withPhotos(p.plan), uploads: { previews: targets } }, 'Önizleme kareleri çiziliyor');
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

  // Shorts anlatımı için ElevenLabs çağrısı: tutarlı tonlama ayarları + önceki/sonraki metinle birleştirme
  async function ttsStitched(text, voiceId, previous_text, next_text, previous_request_ids) {
    const body = { text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true, speed: 1.0 } };
    if (previous_text) body.previous_text = previous_text;
    if (next_text) body.next_text = next_text;
    if (previous_request_ids && previous_request_ids.length) body.previous_request_ids = previous_request_ids;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const d = j.detail || j; throw new Error('ElevenLabs: ' + (typeof d === 'string' ? d : (d.message || JSON.stringify(d))).slice(0, 300)); }
    return { audio: Buffer.from(j.audio_base64, 'base64'), alignment: j.alignment, requestId: r.headers.get('request-id') };
  }

  async function voiceStage(id) {
    let p = await one(id);
    const sfx = await sfxStage(id);
    await set(id, { voice: sfx ? { ...(p.voice || {}), sfx } : null });
    p = await one(id);
    if (!p.opts.voice) { await set(id, { stage: 'render' }); return renderStage(id); }
    const voiceId = p.opts.voice_id || process.env.ELEVENLABS_VOICE_ID;
    if (!voiceId) throw new Error('Seslendirme sesi seçilmedi (ELEVENLABS_VOICE_ID ya da projede ses)');
    // Akıcı anlatım: her sahne ayrı okunur ama ElevenLabs'e önceki ve sonraki cümle ile önceki isteklerin kimliği
    // verilir (request stitching) → tonlama sahneden sahneye kopmadan devam eder; sahne aralarındaki duraklamayı biz belirleriz.
    const scenes = p.plan.scenes; const texts = scenes.map(sc => (sc.caption || '').trim());
    const clips = []; const prevIds = [];
    for (let k = 0; k < scenes.length; k++) {
      const text = texts[k];
      if (!text) { clips.push(null); continue; }
      await progress(id, `Seslendirme (ElevenLabs) ${k + 1}/${scenes.length}`);
      const sp = TR.speakable(text);
      const prev = texts.slice(0, k).filter(Boolean).slice(-2).map(t => TR.speakable(t).text).join(' ');
      const next = texts.slice(k + 1).find(Boolean); 
      const r = await ttsStitched(sp.text, voiceId, prev, next ? TR.speakable(next).text : '', prevIds.slice(-3));
      if (r.requestId) prevIds.push(r.requestId);
      const path = fp(id, 'ses', `${stamp()}-${k + 1}.mp3`);
      await storage.upload(path, r.audio, 'audio/mpeg');
      const al = r.alignment, st = al.character_start_times_seconds, en = al.character_end_times_seconds;
      let words;
      if (al.characters.length === sp.text.length) words = sp.map.map(m => [+(+st[Math.min(st.length - 1, m.start)]).toFixed(2), m.word]);
      else { const L = sp.map.length, T0 = st[0] || 0, T1 = en[en.length - 1] || 1; words = sp.map.map((m, j) => [+(T0 + (T1 - T0) * j / Math.max(1, L)).toFixed(2), m.word]); }
      // sesin başındaki/sonundaki sessizliği atla: konuşmanın gerçek başlangıç ve bitişi
      clips.push({ path, sec: +(en[en.length - 1] || 0).toFixed(2), start: +(st[0] || 0).toFixed(2), words });
    }
    await set(id, { voice: { ...(p.voice || {}), segs: undefined, path: undefined, clips, voice_id: voiceId, chars: texts.join(' ').length, at: now() }, stage: 'render' });
    return renderStage(id);
  }

  async function renderStage(id) {
    if ((await one(id)).plan.template === 'konusan') await avatarStage(id);
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
      // sahne = konuşma + doğal nefes payı; giriş ve kapanışa animasyon için biraz daha yer
      let t = 0;
      for (let i = 0; i < plan.scenes.length; i++) {
        const s = plan.scenes[i], c = p.voice.clips[i];
        if (c && plan.template === 'konusan') {   // video sesin kendisiyle üretildi: kırpma yok, ses ve görüntü aynı anda başlar
          const a = (p.voice.avatars || [])[i];
          s.dur = +Math.max(2, Math.max(c.sec, a ? a.sec : 0) + 0.45).toFixed(3);
          s.words = c.words; s.video_url = a ? await urlOf(a.path, 8) : null;
          voices.push({ url: await urlOf(c.path, 8), at: +t.toFixed(3), from: 0, to: c.sec + 0.05 });
        } else if (c) {
          const kind = s.type || s.key; const first = i === 0;
          const lead = first ? 0.35 : 0.12, tail = kind === 'outro' ? 1.6 : 0.38;
          const st0 = c.start || 0;   // ElevenLabs çıktısının başındaki sessizlik kırpılır
          const minD = kind === 'intro' ? 3.0 : kind === 'outro' ? 4.0 : plan.template === 'mekanizma' ? 4.0 : 2.8;
          s.dur = +Math.max(minD, c.sec - st0 + lead + tail).toFixed(3);
          s.words = c.words.map(([tt, w]) => [+(tt - st0 + lead).toFixed(2), w]);
          voices.push({ url: await urlOf(c.path, 8), at: +(t + lead).toFixed(3), from: st0, to: c.sec + 0.05 });
        }
        t += s.dur;
      }
    }
    const sfx = [];
    if (p.voice && p.voice.sfx) {
      let t = 0;
      for (let i = 0; i < plan.scenes.length; i++) { const c = p.voice.sfx[i]; if (c) sfx.push({ url: await urlOf(c.path, 8), at: +t.toFixed(2), dur: plan.scenes[i].dur }); t += plan.scenes[i].dur; }
    }
    const u = { video: await storage.uploadTarget(fp(id, 'final', `shorts-${stamp()}.mp4`)), srt: await storage.uploadTarget(fp(id, 'final', `altyazi-${stamp()}.srt`)), cover: await storage.uploadTarget(fp(id, 'final', `kapak-${stamp()}.jpg`)) };
    const r = await runTask(id, { mode: 'render', plan: await withPhotos(plan), voices, sfx, sfx_level: 0.55, music_level: voices.length ? Math.max(0.2, Math.min(1.5, +p.opts.music_level || 0.7)) : Math.max(0.2, Math.min(1.5, +p.opts.music_level || 1)), uploads: u }, 'Video çiziliyor ve kodlanıyor');
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
      ...p, plan: await withPhotos(p.plan, 6), stage_name: STAGES[p.stage],
      previews: p.previews ? { ...p.previews, urls: await Promise.all((p.previews.paths || []).map(x => urlOf(x))) } : null,
      final: p.final ? { ...p.final, video_url: await urlOf(p.final.video), srt_url: await urlOf(p.final.srt), cover_url: await urlOf(p.final.cover) } : null,
      voice: p.voice ? { chars: p.voice.chars, voice_id: p.voice.voice_id, sec: p.voice.sec || (p.voice.clips || []).reduce((a, c) => a + (c ? c.sec : 0), 0), sfx: (p.voice.sfx || []).filter(Boolean).length } : null,
    };
  }

  /* ---------- API ---------- */
  on('GET', '/api/shorts/meta', async (req, res) => send(res, 200, { templates: P.TEMPLATES, kinds: P.KINDS, palettes: P.PALETTES, sections: P.MECH_SECTIONS, char_styles: Object.fromEntries(Object.entries(P.CHAR_STYLES).map(([k, v]) => [k, v.tr])), voice_default: process.env.ELEVENLABS_VOICE_ID || '' }), 'admin');
  on('GET', '/api/shorts/projects', async (req, res) => {
    const rows = await db.select(T, 'select=id,title,topic,stage,status,final,created_at&order=created_at.desc&limit=100');
    send(res, 200, await Promise.all(rows.map(async r => ({ ...r, final: undefined, cover: r.final ? await urlOf(r.final.cover) : null, stage_name: STAGES[r.stage] }))));
  }, 'admin');
  on('POST', '/api/shorts/projects', async (req, res) => {
    const b = await readBody(req);
    if (!b.topic || String(b.topic).trim().length < 5) return send(res, 400, { error: 'Konu en az birkaç kelime olmalı' });
    const opts = { template: ['otomatik', ...Object.keys(P.TEMPLATES)].includes(b.template) ? b.template : 'otomatik', ai_sfx: !!b.ai_sfx, voice: !!b.voice || b.template === 'konusan', voice_id: String(b.voice_id || '').slice(0, 60), music_level: Math.max(0.2, Math.min(1.5, +b.music_level || 1)), notes: String(b.notes || '').slice(0, 1500) };
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
      case 'redraw': {   // konuşan karakter: yeniden çiz ya da Türkçe tarifle düzelt
        if (!p.plan || p.plan.template !== 'konusan') return send(res, 400, { error: 'Yalnızca konuşan karakter şablonunda' });
        const fix = String(b.fix || '').trim().slice(0, 300);
        if (!fix) await set(id, { plan: { ...p.plan, character: { ...p.plan.character, portrait_of: null } } });
        await set(id, { stage: 'preview' }); start(id, async x => { await ensurePortrait(x, fix || null); await previewStage(x); }, fix ? 'Karakter düzeltiliyor…' : 'Karakter yeniden çiziliyor…'); break;
      }
      case 'approve': if (!p.previews) return send(res, 400, { error: 'Önce önizleme' });
        if (p.plan.template === 'konusan' && !(p.opts.voice && p.opts.voice_id)) return send(res, 400, { error: 'Konuşan karakter için "ElevenLabs seslendirmesi"ni açıp bir ses seçin' });
        if (!p.previews) return send(res, 400, { error: 'Önce önizleme' }); await set(id, { stage: 'voice' }); start(id, voiceStage, p.opts.voice ? 'Seslendirme hazırlanıyor…' : 'Render başlıyor…'); break;
      case 'retry': {
        const fn = { plan: x => claudePlan(x), review: null, preview: previewStage, approve: null, voice: voiceStage, render: renderStage, done: renderStage }[p.stage];
        if (!fn) return send(res, 400, { error: 'Bu aşamada tekrar denenecek iş yok' });
        start(id, fn, 'Yeniden deneniyor…'); break;
      }
      case 'delete': {
        const paths = [...((p.previews && p.previews.paths) || []), ...((p.voice && p.voice.clips) || []).filter(Boolean).map(c => c.path), ...(p.voice && p.voice.path ? [p.voice.path] : []), ...((p.voice && p.voice.sfx) || []).filter(Boolean).map(c => c.path), ...((p.voice && p.voice.avatars) || []).filter(Boolean).map(c => c.path), ...(p.plan && p.plan.character && p.plan.character.portrait && p.plan.character.portrait !== p.plan.character.photo ? [p.plan.character.portrait] : []), ...(p.final ? [p.final.video, p.final.srt, p.final.cover] : [])].filter(Boolean);
        if (paths.length) await storage.remove(paths).catch(() => {});
        await db.remove(T, `id=eq.${q(id)}`);
        return send(res, 200, { ok: true });
      }
      default: return send(res, 400, { error: 'Bilinmeyen işlem' });
    }
    send(res, 200, { ok: true });
  }, 'admin');
};
