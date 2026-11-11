// Sinematik film modülü (yalnızca yönetici): konu yazılır, gerisi sırayla yapılır ve her aşamada onay istenir.
// senaryo + karakterler (Claude) → karakter görselleri (fal) → sahne planı (Claude) → sahne kareleri (fal, karakter referanslı)
// → anlatım + müzik (ElevenLabs) → video klipler (fal görselden video) → kurgu (GitHub Actions sinema.yml + ffmpeg) → MP4
// Anahtarlar platformun ortak ortam değişkenlerinden gelir: FAL_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, GITHUB_TOKEN.
// Model seçimleri ve kurgu ayarları settings tablosunda key='sinema' satırında durur.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const P = require('./sinema-prompts');

module.exports = function sinema({ on, db, q, send, readBody, storage, ctxFor, logClaude, logUsage, dispatch, publicBase, now }) {
  const T = 'sinema_projects';
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const stamp = () => Date.now().toString(36);
  const STAGES = ['script', 'chars', 'board', 'frames', 'audio', 'videos', 'edit', 'done'];
  const STAGE_NAMES = { script: 'Senaryo ve karakterler', chars: 'Karakter görselleri', board: 'Sahne planı', frames: 'Sahne kareleri', audio: 'Anlatım ve müzik', videos: 'Video klipler', edit: 'Kurgu', done: 'Tamamlandı' };

  /* ---------- tablo: kendi sunucuda açılışta otomatik oluşturulur ---------- */
  function migrate() {
    if (!process.env.DB_REST_URL) return;
    const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', process.env.PGDATABASE || 'egitim', '-f', path.join(__dirname, '..', 'deploy', 'sinema.sql')], { encoding: 'utf8', timeout: 30000 });
    if (r.status === 0) console.log('Sinema: tablo hazır');
    else console.error('Sinema: tablo oluşturulamadı —', (r.stderr || (r.error && r.error.message) || '').slice(0, 300));
  }
  migrate();

  /* ---------- panelden girilen API anahtarları (settings key='anahtarlar') ----------
     Sunucudaki .env'e elle yazmaya gerek kalmasın diye: kayıtlı anahtar process.env'e konur,
     böylece platformun tamamı (eğitim videolarının sinematik stili dahil) aynı anahtarı kullanır. */
  const KEY_NAMES = { fal_key: 'FAL_KEY' };
  async function loadKeys() {
    try {
      const row = await db.one('settings', 'key=eq.anahtarlar');
      const v = (row && row.value) || {};
      for (const [k, env] of Object.entries(KEY_NAMES)) if (v[k]) process.env[env] = v[k];
    } catch (e) { console.error('Anahtarlar okunamadı:', e.message); }
  }
  setTimeout(loadKeys, 1000);

  /* ---------- ayarlar ---------- */
  const FIELDS = [
    { k: 'claude_model', label: 'Claude modeli', group: 'claude', def: () => process.env.CLAUDE_MODEL || 'claude-opus-5-5', options: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], help: 'Senaryo, karakter ve sahne planını yazar (aboneliğinizle, GitHub Actions).' },
    { k: 'image_model', label: 'Görsel modeli (metinden)', group: 'fal', def: 'fal-ai/nano-banana-2', options: ['fal-ai/nano-banana-2', 'fal-ai/nano-banana', 'fal-ai/flux/dev', 'fal-ai/flux-pro/v1.1-ultra'] },
    { k: 'edit_model', label: 'Görsel modeli (karakter referanslı)', group: 'fal', def: 'fal-ai/nano-banana-2/edit', options: ['fal-ai/nano-banana-2/edit', 'fal-ai/nano-banana/edit', 'fal-ai/nano-banana-pro/edit'], help: 'Karakterlerin her sahnede aynı görünmesi için referans görselleri kullanır.' },
    { k: 'image_resolution', label: 'Görsel çözünürlüğü', group: 'fal', def: '1K', options: ['1K', '2K'] },
    { k: 'video_model', label: 'Video modeli', group: 'fal', def: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      options: ['fal-ai/kling-video/v2.5-turbo/pro/image-to-video', 'fal-ai/kling-video/v3/pro/image-to-video', 'fal-ai/veo3.1/fast/image-to-video', 'fal-ai/veo3.1/image-to-video', 'fal-ai/minimax/hailuo-2.3/standard/image-to-video', 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video'],
      help: 'Kling 2.5 Turbo ≈ 0,07 $/sn (ekonomik) · Kling 3 ≈ 0,11 $/sn · Veo 3.1 Fast ≈ 0,10 $/sn · Veo 3.1 ≈ 0,20 $/sn.' },
    { k: 'video_price', label: 'Video saniye fiyatı ($, tahmin için)', group: 'fal', def: '0.07' },
    { k: 'parallel', label: 'Aynı anda üretilecek sahne', group: 'fal', def: '3', options: ['1', '2', '3', '4', '6'] },
    { k: 'eleven_voice', label: 'Anlatıcı sesi', group: 'eleven', def: () => process.env.ELEVENLABS_VOICE_ID || '', help: '“Sesleri getir” ile listeden seçin. Boşsa platformun varsayılan sesi kullanılır.' },
    { k: 'eleven_voice_radio', label: 'Radyo spikeri sesi', group: 'eleven', def: '', help: 'Radyo/anons sahneleri. Boşsa anlatıcı sesi, eski radyo filtresiyle.' },
    { k: 'eleven_voice_erkek', label: 'Karakter sesi: erkek', group: 'eleven', def: '' },
    { k: 'eleven_voice_yasli_erkek', label: 'Karakter sesi: yaşlı erkek', group: 'eleven', def: '' },
    { k: 'eleven_voice_kadin', label: 'Karakter sesi: kadın', group: 'eleven', def: '' },
    { k: 'eleven_voice_yasli_kadin', label: 'Karakter sesi: yaşlı kadın', group: 'eleven', def: '' },
    { k: 'eleven_voice_cocuk', label: 'Karakter sesi: çocuk', group: 'eleven', def: '', help: 'Boş bırakılan karakter sesleri için anlatıcı sesi kullanılır.' },
    { k: 'eleven_tts_model', label: 'Seslendirme modeli', group: 'eleven', def: () => process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2', options: ['eleven_multilingual_v2', 'eleven_v3', 'eleven_turbo_v2_5'] },
    { k: 'eleven_music_model', label: 'Müzik modeli', group: 'eleven', def: 'music_v1', options: ['music_v1', 'music_v2', 'music_v2_5'] },
    { k: 'title_font', label: 'Ekran yazısı yazı tipi', group: 'kurgu', def: 'serif', options: ['serif', 'sans', 'mono'] },
    { k: 'crossfade', label: 'Sahne geçişi (saniye)', group: 'kurgu', def: '0.4', options: ['0', '0.25', '0.4', '0.6', '1'] },
    { k: 'grade', label: 'Renk tonu', group: 'kurgu', def: 'yok', options: ['yok', 'sepya', 'soluk', 'siyah-beyaz'], help: 'Sepya: eski fotoğraf tonu (tarih dramaları için).' },
    { k: 'grain', label: 'Film greni ve kenar kararması', group: 'kurgu', def: 'yok', options: ['yok', 'hafif', 'belirgin'] },
    { k: 'subtitles', label: 'Konuşma altyazısı', group: 'kurgu', def: 'açık', options: ['açık', 'kelime grupları', 'renkli kelime (karaoke)', 'tek kelime (sarı)', 'kapalı'], help: 'Kelime grupları: konuşma 2–4 kelimelik parçalar hâlinde, sesle eş zamanlı, ortada büyük harflerle (Reels tarzı).' },
    { k: 'sfx', label: 'Ses efektleri (ElevenLabs)', group: 'kurgu', def: 'açık', options: ['açık', 'kapalı'], help: 'Saat tıkırtısı, radyo cızırtısı, kalabalık uğultusu gibi sahne sesleri.' },
    { k: 'sfx_volume', label: 'Ses efekti seviyesi', group: 'kurgu', def: '0.5', options: ['0.25', '0.4', '0.5', '0.7', '1'] },
    { k: 'music_volume', label: 'Müzik seviyesi', group: 'kurgu', def: '0.8', options: ['0.3', '0.5', '0.8', '1'], help: 'Anlatım varsa müzik konuşma sırasında otomatik kısılır.' },
  ];
  let SCACHE = null, SAT = 0;
  async function S() {
    if (SCACHE && Date.now() - SAT < 10000) return SCACHE;
    const row = await db.one('settings', 'key=eq.sinema').catch(() => null);
    const v = (row && row.value) || {};
    const out = {}; for (const f of FIELDS) out[f.k] = v[f.k] != null && v[f.k] !== '' ? String(v[f.k]) : (typeof f.def === 'function' ? f.def() : f.def);
    SCACHE = out; SAT = Date.now(); return out;
  }
  async function saveSettings(patch) {
    const row = await db.one('settings', 'key=eq.sinema').catch(() => null);
    const v = { ...((row && row.value) || {}) };
    for (const f of FIELDS) if (patch[f.k] !== undefined) v[f.k] = String(patch[f.k]).trim();
    if (row) await db.update('settings', 'key=eq.sinema', { value: v, updated_at: now() }); else await db.insert('settings', { key: 'sinema', value: v });
    SCACHE = null;
  }

  /* ---------- fal.ai (kuyruk API) ---------- */
  function falErr(status, body) {
    const d = body && (body.detail || body.error || body.message);
    const msg = typeof d === 'string' ? d : d ? JSON.stringify(d).slice(0, 400) : 'HTTP ' + status;
    if (status === 401 || status === 403) return 'fal.ai anahtarı geçersiz (FAL_KEY). ' + msg;
    if (status === 402 || /balance|credit|exhausted|locked/i.test(msg)) return 'fal.ai bakiyesi yetersiz; fal.ai hesabına kredi yükleyin. ' + msg;
    if (status === 404) return 'fal.ai modeli bulunamadı (model adını Sinema ayarlarından kontrol edin). ' + msg;
    if (/content|safety|policy|nsfw|flagged/i.test(msg)) return 'İçerik filtresine takıldı; sahne tarifini değiştirip tekrar deneyin. ' + msg;
    return 'fal.ai: ' + msg;
  }
  const falKey = () => { if (!process.env.FAL_KEY) throw new Error('fal.ai anahtarı girilmemiş (Sinema → Ayarlar → fal.ai anahtarı)'); return process.env.FAL_KEY; };
  async function falSubmit(model, input) {
    const r = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: 'Key ' + falKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(falErr(r.status, j));
    return { status_url: j.status_url, response_url: j.response_url, request_id: j.request_id, model };
  }
  async function falWait(h, timeoutMs = 20 * 60 * 1000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await fetch(h.status_url, { headers: { Authorization: 'Key ' + falKey() } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 202) throw new Error(falErr(r.status, j));
      if (j.status === 'COMPLETED') {
        const rr = await fetch(h.response_url, { headers: { Authorization: 'Key ' + falKey() } });
        const out = await rr.json().catch(() => ({}));
        if (!rr.ok) throw new Error(falErr(rr.status, out));
        if (out.detail && !out.images && !out.video) throw new Error(falErr(422, out));
        return out;
      }
      await sleep(j.status === 'IN_QUEUE' ? 5000 : 4000);
    }
    throw new Error('fal.ai yanıtı zaman aşımına uğradı');
  }
  const falRun = async (m, i) => falWait(await falSubmit(m, i));
  const NEG = 'no text, no captions, no letters, no watermark, no logo, no subtitles';
  const FLUX_SIZE = { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd' };
  const imageInput = (model, prompt, aspect, res) => /flux/.test(model)
    ? { prompt: `${prompt}. ${NEG}`, image_size: FLUX_SIZE[aspect] || 'square_hd', num_images: 1, output_format: 'jpeg', enable_safety_checker: true, ...(/ultra/.test(model) ? { aspect_ratio: aspect } : {}) }
    : { prompt: `${prompt}. ${NEG}`, aspect_ratio: aspect, num_images: 1, output_format: 'jpeg', resolution: res || '1K' };
  const pickImage = out => { const i = out.images && out.images[0]; if (!i || !i.url) throw new Error('fal.ai görsel döndürmedi' + (out.description ? ': ' + String(out.description).slice(0, 200) : '')); return i.url; };
  // Görsel dil: gerçekçi fotoğraf ya da çizim tarzları (karakter, sahne ve mekân görsellerine aynı biçimde uygulanır)
  const LOOKS = {
    cizgi_roman: 'Graphic novel illustration like a modern European comic book: bold clean black ink outlines, cel shading with painterly texture, rich saturated warm colors, dramatic cinematic lighting, highly detailed backgrounds, expressive faces. A drawn illustration, NOT a photograph.',
    sulu_boya: 'Soft watercolor illustration with visible paper texture, loose ink linework, gentle washes of color, delicate light. A painting, NOT a photograph.',
    animasyon: 'Stylized 3D animated feature film look: appealing stylized characters, soft global illumination, rich colors, clean shapes. A 3D animation frame, NOT a photograph.',
    anime: 'Classic hand-drawn 2D animated feature film look: clean expressive character linework, cel-shaded characters, lush hand-painted watercolor-like backgrounds, warm nostalgic cinematic lighting, rich saturated colors, detailed period settings. A 2D animation frame, NOT a photograph, NOT 3D.',
    gravur: 'Vintage engraving / woodcut style black-and-white illustration with fine hatching and cross-hatching, old book plate look. NOT a photograph.',
  };
  const lookOf = p => LOOKS[(p.opts && p.opts.look) || ''] || '';
  async function textToImage(prompt, aspect) {
    const s = await S();
    try { return { url: pickImage(await falRun(s.image_model, imageInput(s.image_model, prompt, aspect, s.image_resolution))), usd: 0.08 }; }
    catch (e) {
      if (!/bulunamadı|422|Unprocessable/i.test(e.message) || s.image_model === 'fal-ai/flux/dev') throw e;
      return { url: pickImage(await falRun('fal-ai/flux/dev', imageInput('fal-ai/flux/dev', prompt, aspect))), usd: 0.03, note: 'yedek model: flux/dev' };
    }
  }
  async function imageWithRefs(prompt, refUrls, aspect, look) {
    if (!refUrls.length) return textToImage(look ? `${prompt}. STYLE: ${look}` : prompt, aspect);
    const s = await S();
    const p = look ? `${prompt}. Use the reference image(s) only for the identity, face, hair and costume of the character(s); create a completely new image with new composition, pose and setting as described. STYLE: ${look}`
      : `${prompt}. Use the reference image(s) only for the identity, face, hair and costume of the character(s); create a completely new cinematic photograph with new composition, pose and setting as described. Photorealistic film still.`;
    return { url: pickImage(await falRun(s.edit_model, { ...imageInput(s.edit_model, p, aspect, s.image_resolution), image_urls: refUrls.slice(0, 6) })), usd: 0.08 };
  }
  // Kullanıcının yüklediği karakter referansı (fotoğraf ya da çizim): kimliği koruyarak filmin görsel diline göre yeniden çizilir
  async function restyleChar(srcUrl, c, p) {
    const s = await S(); const lk = lookOf(p);
    const prompt = `Create a character reference portrait, waist-up, facing the viewer at a slight three-quarter angle, of the person in the reference image. Keep their identity recognizable: face shape, eyes, hair, facial hair, glasses, skin tone and distinctive features. ${c.look_en ? 'Costume and details: ' + c.look_en + '.' : ''} Plain simple background. ${lk ? 'STYLE: ' + lk : 'Cinematic photorealistic portrait, soft natural light, ' + ((p.script && p.script.look) || '')}`;
    return { url: pickImage(await falRun(s.edit_model, { ...imageInput(s.edit_model, prompt, '1:1', s.image_resolution), image_urls: [srcUrl] })), usd: 0.08 };
  }
  // Kullanıcının gerçek mekân görseli: mekân aynen korunur, ölçü/etiket işaretleri silinir, içine kişiler yerleştirilir
  async function imageInPlace(prompt, placeUrl, refUrls, aspect, look) {
    const s = await S();
    const p = `${prompt}. The FIRST image is the exact real location: keep its architecture, layout, materials, colors, furniture, lighting, signage and logos exactly as they are, from a similar camera viewpoint. Completely remove any dimension lines, arrows, measurement numbers, annotation labels and info boxes drawn on top of the image. Place the described people naturally inside this space with correct scale, perspective, shadows and lighting. ${refUrls.length ? 'The other images are character references for faces and clothing only. ' : ''}${look ? 'Render the whole image (place and people) in this style: ' + look : 'Photorealistic photograph, natural candid moment.'}`;
    return { url: pickImage(await falRun(s.edit_model, { ...imageInput(s.edit_model, p, aspect, s.image_resolution), image_urls: [placeUrl, ...refUrls].slice(0, 6) })), usd: 0.08 };
  }
  function videoInput(model, prompt, imageUrl, sec, aspect) {
    const p = `${prompt}. Cinematic, realistic motion, stable faces, no text.`;
    if (/veo/.test(model)) return { prompt: p, image_url: imageUrl, duration: sec <= 4 ? '4s' : sec <= 6 ? '6s' : '8s', aspect_ratio: aspect === '9:16' || aspect === '16:9' ? aspect : 'auto', resolution: '720p', generate_audio: false };
    if (/kling-video\/v3|kling\/v4/.test(model)) return { prompt: p, image_url: imageUrl, duration: String(Math.max(3, Math.min(15, Math.round(sec)))), generate_audio: false, negative_prompt: 'blur, distort, low quality, text, watermark' };
    if (/kling/.test(model)) return { prompt: p, image_url: imageUrl, duration: sec > 7 ? '10' : '5', negative_prompt: 'blur, distort, low quality, text, watermark', cfg_scale: 0.5 };
    if (/hailuo|minimax/.test(model)) return { prompt: p, image_url: imageUrl, duration: sec > 8 ? '10' : '6', prompt_optimizer: false };
    if (/seedance/.test(model)) return { prompt: p, image_url: imageUrl, duration: String(Math.max(4, Math.min(12, Math.round(sec)))), resolution: '720p', generate_audio: false };
    return { prompt: p, image_url: imageUrl, duration: String(Math.round(sec)) };
  }
  function videoSeconds(model, sec) {
    if (/veo/.test(model)) return sec <= 4 ? 4 : sec <= 6 ? 6 : 8;
    if (/kling-video\/v3|kling\/v4/.test(model)) return Math.max(3, Math.min(15, Math.round(sec)));
    if (/kling/.test(model)) return sec > 7 ? 10 : 5;
    if (/hailuo|minimax/.test(model)) return sec > 8 ? 10 : 6;
    if (/seedance/.test(model)) return Math.max(4, Math.min(12, Math.round(sec)));
    return Math.round(sec);
  }
  const pickVideo = out => { const v = out.video || (out.videos && out.videos[0]); if (!v || !v.url) throw new Error('fal.ai video döndürmedi'); return v.url; };

  /* ---------- ElevenLabs ---------- */
  const elKey = () => { if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY tanımlı değil (sunucudaki .env dosyası)'); return process.env.ELEVENLABS_API_KEY; };
  async function elFail(r, what) {
    const t = await r.text().catch(() => ''); let m = t;
    try { const j = JSON.parse(t); m = (j.detail && (j.detail.message || j.detail.status || JSON.stringify(j.detail))) || t; } catch { }
    if (/quota|credits/i.test(m)) m = 'ElevenLabs kredisi yetersiz. ' + m;
    return new Error(`ElevenLabs ${what}: ${String(m).slice(0, 300)}`);
  }
  async function speak(text, voiceId) {
    const s = await S(); const voice = voiceId || s.eleven_voice || process.env.ELEVENLABS_VOICE_ID;
    if (!voice) throw new Error('Anlatıcı sesi seçilmemiş (Sinema → Ayarlar → Sesleri getir)');
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': elKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: s.eleven_tts_model, voice_settings: { stability: 0.45, similarity_boost: 0.6, style: 0.3, use_speaker_boost: false } }) });
    if (!r.ok) throw await elFail(r, 'seslendirme');
    const j = await r.json(); const al = j.alignment || {}; const ends = al.character_end_times_seconds || [];
    return { buf: Buffer.from(j.audio_base64, 'base64'), seconds: ends.length ? ends[ends.length - 1] : text.length / 14, chunks: chunksOf(al), words: chunksOf(al, 1) };
  }
  // Kelime grubu altyazısı: konuşmayı 2–4 kelimelik parçalara böler, her parçanın sesteki başlangıç zamanıyla
  function chunksOf(al, maxWords = 4) {
    const ch = al.characters || [], st = al.character_start_times_seconds || []; if (!ch.length) return [];
    const words = []; let cur = '', t0 = null;
    ch.forEach((c, i) => { if (/\s/.test(c)) { if (cur) words.push([t0, cur]); cur = ''; t0 = null; } else { if (t0 == null) t0 = st[i] || 0; cur += c; } });
    if (cur) words.push([t0, cur]);
    const out = []; let g = [];
    words.forEach(([t, w], i) => { g.push([t, w]); const len = g.map(x => x[1]).join(' ').length; if (g.length >= maxWords || len > 22 || /[.,;:!?…]$/.test(w) || i === words.length - 1) { out.push({ t: +g[0][0].toFixed(2), txt: g.map(x => x[1]).join(' ') }); g = []; } });
    return out;
  }
  // Sahne konuşmasının sesi: radyo spikeri, karakterin türüne göre ses ya da anlatıcı
  function voiceFor(p, sc, s) {
    if (sc.speaker === 'radyo') return s.eleven_voice_radio || null;
    const c = (p.characters || []).find(c => c.id === sc.speaker);
    return c && c.voice && s['eleven_voice_' + c.voice] ? s['eleven_voice_' + c.voice] : null;
  }
  async function sfxSound(text, seconds) {
    const r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': elKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text, duration_seconds: Math.max(1, Math.min(22, seconds)), prompt_influence: 0.45 }) });
    if (!r.ok) throw await elFail(r, 'ses efekti');
    return Buffer.from(await r.arrayBuffer());
  }
  async function music(prompt, seconds) {
    const s = await S();
    const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': elKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, music_length_ms: Math.max(10000, Math.min(300000, Math.round(seconds * 1000))), force_instrumental: true, model_id: s.eleven_music_model }) });
    if (!r.ok) throw await elFail(r, 'müzik');
    return Buffer.from(await r.arrayBuffer());
  }
  async function voices() {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': elKey() } });
    if (!r.ok) throw await elFail(r, 'ses listesi');
    return ((await r.json()).voices || []).map(v => ({ id: v.voice_id, name: v.name, labels: v.labels || {} }));
  }

  /* ---------- depolama: yollar saklanır, arayüze ve fal'a süreli imzalı adres verilir ---------- */
  const URLS = new Map();
  async function urlOf(p, hours = 6) {
    if (!p) return null;
    const c = URLS.get(p); if (c && c.exp > Date.now() + 3600e3) return c.url;
    const url = await storage.signedUrl(p, hours * 3600); URLS.set(p, { url, exp: Date.now() + hours * 3600e3 }); return url;
  }
  async function saveRemote(url, p, type) {
    let buf, last;
    for (let i = 0; i < 4 && !buf; i++) {
      try { const r = await fetch(url); if (!r.ok) throw new Error('Dosya indirilemedi: ' + r.status); buf = Buffer.from(await r.arrayBuffer()); }
      catch (e) { last = e; await sleep(1500 * (i + 1)); }
    }
    if (!buf) throw last;
    return storage.upload(p, buf, type);
  }
  const fp = (id, sub, name) => `sinema/${id}/${sub}/${name}`;

  /* ---------- proje güncelleme kilidi ---------- */
  const locks = new Map();
  async function mutate(id, fn) {
    const prev = locks.get(id) || Promise.resolve();
    let release; const mine = new Promise(r => release = r);
    locks.set(id, prev.then(() => mine));
    await prev;
    try {
      const p = await db.one(T, `id=eq.${q(id)}`);
      if (!p) throw new Error('Proje bulunamadı');
      const before = JSON.stringify(p);
      await fn(p);
      if (JSON.stringify(p) !== before) {
        const patch = {}; for (const k of ['title', 'opts', 'stage', 'status', 'progress', 'error', 'auto', 'script', 'characters', 'scenes', 'audio', 'final']) patch[k] = p[k];
        patch.updated_at = now();
        await db.update(T, `id=eq.${q(id)}`, patch);
      }
      return p;
    } finally { release(); if (locks.get(id) === mine) locks.delete(id); }
  }
  const setState = (id, patch) => mutate(id, p => { Object.assign(p, patch); });
  const progress = (id, text) => setState(id, { progress: { text } }).catch(() => {});
  const usage = (id, provider, what, usd, detail) => logUsage(null, provider, Math.round((+usd || 0) * 1000), 'sinema: ' + what, { sinema_id: id, usd: +(+usd || 0).toFixed(3), ...(detail || {}) });
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

  async function askClaude(id, system, user, label) {
    await progress(id, `Claude ${label} (GitHub Actions'ta, 1–3 dk)…`);
    const s = await S();
    const [res] = await ctxFor(null, 'sinema').viaActions([{ system, user }], s.claude_model);
    if (!res || res.error) throw new Error('Claude: ' + ((res && res.error) || 'yanıt yok'));
    if (res.usage) logClaude(null, [res.usage], 'sinema').catch(() => {});
    try { return P.extractJson(res.text); } catch (e) { throw new Error('Claude yanıtı okunamadı: ' + e.message); }
  }

  /* ---------- aşamalar ---------- */
  const running = new Set();
  function start(id, stage, args) {
    const key = id + ':' + stage;
    if (running.has(key)) return;
    running.add(key);
    (async () => {
      try {
        await setState(id, { stage, status: 'working', error: null, progress: { text: 'Başlıyor…' } });
        await RUN[stage](id, args || {});
        const p = await mutate(id, p => { p.status = 'review'; p.progress = null; });
        if (p.auto && stage !== 'done' && !hasErrors(p, stage)) await advance(id);
      } catch (e) {
        console.error(`[sinema ${id}] ${stage}:`, e.message);
        await setState(id, { status: 'error', error: e.message, progress: null }).catch(() => {});
      } finally { running.delete(key); }
    })();
  }
  function hasErrors(p, stage) {
    if (stage === 'audio' && p.audio && p.audio.error) return true;
    const list = stage === 'chars' ? p.characters : ['frames', 'audio', 'videos'].includes(stage) ? p.scenes : null;
    return !!(list && list.some(x => x.error));
  }
  async function advance(id) {
    const p = await db.one(T, `id=eq.${q(id)}&select=stage`);
    let next = STAGES[STAGES.indexOf(p.stage) + 1];
    if (!next) return;
    if (next === 'videos') { const f = await db.one(T, `id=eq.${q(id)}&select=opts`); if (f && f.opts && f.opts.motion === 'kamera') next = 'edit'; }
    if (next === 'done') return setState(id, { stage: 'done', status: 'review' });
    start(id, next);
  }
  const one = id => db.one(T, `id=eq.${q(id)}`);

  const RUN = {
    async script(id, { feedback }) {
      const p = await one(id);
      if (!feedback && p.script) return;
      const prev = feedback && p.script ? { ...p.script, characters: p.characters } : null;
      const j = await askClaude(id, P.SCRIPT_SYSTEM, P.scriptUser(p, prev, feedback), 'senaryoyu yazıyor');
      if (!j.title || !Array.isArray(j.characters)) throw new Error('Claude eksik senaryo döndürdü; tekrar deneyin');
      const chars = j.characters.map((c, i) => ({ id: c.id || 'c' + (i + 1), name: c.name, role: c.role, about: c.about, look_en: c.look_en, ref: c.ref !== false, voice: ['erkek', 'yasli_erkek', 'kadin', 'yasli_kadin', 'cocuk', 'spiker'].includes(c.voice) ? c.voice : 'erkek' }));
      // Kullanıcının kendi karakterleri (referans görselli): kimlikle eşleştir, referansı bağla; eskiden bağlanmış referansları koru
      for (const k of (p.opts.cast || [])) { const ch = chars.find(c => c.id === k.id); if (ch) { ch.src_ref = k.path || null; ch.ref = true; if (k.image) { ch.image = k.image; ch.status = 'done'; if (k.look_en) ch.look_en = k.look_en; if (k.voice) ch.voice = k.voice; } } }
      for (const ch of chars) { const old = (p.characters || []).find(o => o.id === ch.id && o.src_ref); if (old && !ch.src_ref) ch.src_ref = old.src_ref; }
      delete j.characters;
      await mutate(id, p => {
        const old = Object.fromEntries((p.characters || []).map(c => [c.id, c]));
        p.characters = chars.map(c => old[c.id] && old[c.id].look_en === c.look_en && old[c.id].image ? { ...c, image: old[c.id].image } : c);
        p.script = j; p.title = j.title;
      });
    },
    async chars(id, { only }) {
      const p = await one(id);
      const list = (p.characters || []).filter(c => c.ref && (only ? c.id === only : !c.image));
      const par = +(await S()).parallel || 3; let done = 0;
      await progress(id, `Karakter görselleri üretiliyor (0/${list.length})`);
      await pool(list, par, async c => {
        await mutate(id, p => { const x = p.characters.find(x => x.id === c.id); x.status = 'working'; x.error = null; });
        try {
          const lk = lookOf(p);
          const prompt = lk ? `Character reference sheet portrait, waist-up, facing the viewer at a slight three-quarter angle, ${c.look_en}. Period setting: ${(p.script && p.script.era) || ''}. Plain simple background. STYLE: ${lk}` : `Cinematic character reference photo, waist-up, facing camera at a slight three-quarter angle, ${c.look_en}. Period setting: ${(p.script && p.script.era) || ''}. Plain softly blurred period background, soft natural daylight, sharp focus on face, photorealistic, ${(p.script && p.script.look) || ''}`;
          const img = c.src_ref ? await restyleChar(await urlOf(c.src_ref, 24), c, p) : await textToImage(prompt, '1:1');
          const saved = await saveRemote(img.url, fp(id, 'chars', `${c.id}-${stamp()}.jpg`), 'image/jpeg');
          usage(id, 'fal', 'karakter', img.usd);
          await mutate(id, p => { const x = p.characters.find(x => x.id === c.id); x.image = saved; x.status = 'done'; x.note = img.note || null; });
        } catch (e) { await mutate(id, p => { const x = p.characters.find(x => x.id === c.id); x.status = 'error'; x.error = e.message; }); }
        await progress(id, `Karakter görselleri üretiliyor (${++done}/${list.length})`);
      });
    },
    async board(id, { feedback }) {
      const p = await one(id);
      if (!feedback && p.scenes && p.scenes.length) return;
      const prev = feedback && p.scenes ? { scenes: p.scenes.map(s => ({ n: s.n, beat: s.beat, what: s.what, shot: s.shot, image_en: s.image_en, motion_en: s.motion_en, chars: s.chars, sec: s.sec, card: !!s.card, still: !!s.still, place: s.place, narration: s.narration, speaker: s.speaker, sfx_en: s.sfx_en, overlay: s.overlay })) } : null;
      const st = await S(); const maxSec = videoSeconds(st.video_model, 15);
      const j = await askClaude(id, P.BOARD_SYSTEM, P.boardUser({ ...p, maxSec }, prev, feedback), 'sahne planını hazırlıyor');
      if (!Array.isArray(j.scenes) || !j.scenes.length) throw new Error('Claude sahne listesi döndürmedi; tekrar deneyin');
      const ids = new Set((p.characters || []).map(c => c.id));
      await mutate(id, p => {
        p.scenes = j.scenes.map((s, i) => ({ n: i + 1, beat: s.beat || '', what: s.what || '', shot: s.shot || '', image_en: s.image_en || '', motion_en: s.motion_en || '', chars: (s.chars || []).filter(c => ids.has(c)), sec: Math.max(3, Math.min(maxSec, Math.round(+s.sec || 5))), card: !!s.card, still: p.opts.motion === 'karma' ? !!s.still : false, place: (p.opts.places || []).some(m => m.id === s.place) ? s.place : '', narration: p.opts.narration ? (s.narration || '') : '', speaker: s.speaker === 'radyo' || ids.has(s.speaker) ? s.speaker : 'anlatici', sfx_en: String(s.sfx_en || '').slice(0, 300), overlay: s.overlay || '' }));
      });
    },
    async frames(id, { only }) {
      const p = await one(id);
      const list = p.scenes.filter(s => !s.card && (only ? s.n === only : !s.image));
      const charPath = Object.fromEntries((p.characters || []).filter(c => c.image).map(c => [c.id, c.image]));
      const par = +(await S()).parallel || 3; let done = 0;
      await progress(id, `Sahne kareleri üretiliyor (0/${list.length})`);
      await pool(list, par, async s => {
        await mutate(id, p => { const x = p.scenes.find(x => x.n === s.n); x.status = 'working'; x.error = null; });
        try {
          const refs = []; for (const c of s.chars || []) if (charPath[c]) refs.push(await urlOf(charPath[c], 24));
          const place = s.place && (p.opts.places || []).find(m => m.id === s.place);
          const desc = `${s.shot ? s.shot + '. ' : ''}${s.image_en} ${(p.script && p.script.look) || ''}`;
          const img = place ? await imageInPlace(desc, await urlOf(place.path, 24), refs, p.opts.aspect || '1:1', lookOf(p)) : await imageWithRefs(desc, refs, p.opts.aspect || '1:1', lookOf(p));
          const saved = await saveRemote(img.url, fp(id, 'frames', `s${s.n}-${stamp()}.jpg`), 'image/jpeg');
          usage(id, 'fal', 'sahne karesi', img.usd);
          await mutate(id, p => { const x = p.scenes.find(x => x.n === s.n); x.image = saved; x.status = 'done'; x.video = null; x.vreq = null; });
        } catch (e) { await mutate(id, p => { const x = p.scenes.find(x => x.n === s.n); x.status = 'error'; x.error = e.message; }); }
        await progress(id, `Sahne kareleri üretiliyor (${++done}/${list.length})`);
      });
    },
    async audio(id, { only, musicOnly, sfxOnly }) {
      const p = await one(id); const s = await S();
      if (p.opts.narration && !musicOnly && !sfxOnly) {
        const list = p.scenes.filter(x => x.narration && (only ? x.n === only : !x.voice)); let done = 0;
        await progress(id, `Anlatım seslendiriliyor (0/${list.length})`);
        await pool(list, 3, async sc => {
          await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.status = 'working'; x.error = null; });
          try {
            const v = await speak(sc.narration, voiceFor(p, sc, s));
            const saved = await storage.upload(fp(id, 'voice', `s${sc.n}-${stamp()}.mp3`), v.buf, 'audio/mpeg');
            usage(id, 'elevenlabs', 'anlatım', 0, { chars: sc.narration.length });
            await mutate(id, p => {
              const x = p.scenes.find(x => x.n === sc.n); x.voice = saved; x.voice_sec = +v.seconds.toFixed(2); x.chunks = v.chunks; x.words = v.words; x.status = 'done';
              if (x.voice_sec > x.sec - 0.4 && x.sec < 10) { x.sec = 10; x.video = null; x.vreq = null; } // ses sığmıyorsa sahne 10 sn
            });
          } catch (e) { await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.status = 'error'; x.error = e.message; }); }
          await progress(id, `Anlatım seslendiriliyor (${++done}/${list.length})`);
        });
      }
      if (s.sfx !== 'kapalı' && !musicOnly) {
        const cur = await one(id);
        const fx = cur.scenes.filter(x => x.sfx_en && (only ? x.n === only && (sfxOnly || !x.sfx) : !x.sfx)); let done = 0;
        if (fx.length) await progress(id, `Ses efektleri üretiliyor (0/${fx.length})`);
        await pool(fx, 3, async sc => {
          try {
            const buf = await sfxSound(sc.sfx_en, Math.max(sc.sec, (sc.voice_sec || 0) + 1));
            const saved = await storage.upload(fp(id, 'sfx', `s${sc.n}-${stamp()}.mp3`), buf, 'audio/mpeg');
            usage(id, 'elevenlabs', 'ses efekti', 0, { sec: sc.sec });
            await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.sfx = saved; x.sfx_error = null; });
          } catch (e) { await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.sfx_error = e.message; }); }
          await progress(id, `Ses efektleri üretiliyor (${++done}/${fx.length})`);
        });
      }
      if (only) return;
      const f = await one(id);
      if (f.audio && (f.audio.music || f.audio.skipped) && !musicOnly) return;
      if (f.audio && f.audio.uploaded && musicOnly !== 'force') return;
      const xf = +s.crossfade || 0;
      const total = f.scenes.reduce((a, x) => a + videoSeconds(s.video_model, x.sec), 0) - xf * (f.scenes.length - 1);
      await progress(id, 'Müzik besteleniyor (ElevenLabs)…');
      try {
        const buf = await music(f.script.music || 'cinematic emotional orchestral score, instrumental', total + 2);
        const saved = await storage.upload(fp(id, 'music', `music-${stamp()}.mp3`), buf, 'audio/mpeg');
        usage(id, 'elevenlabs', 'müzik', 0, { sec: total });
        await mutate(id, p => { p.audio = { music: saved, music_sec: Math.round(total + 2), prompt: p.script.music }; });
      } catch (e) { await mutate(id, p => { p.audio = { ...(p.audio || {}), error: e.message }; }); }
    },
    async videos(id, { only }) {
      const p = await one(id); const s = await S();
      const list = p.scenes.filter(x => x.image && !x.card && (only ? x.n === only : !x.video && !x.still));
      let done = 0;
      await progress(id, `Video klipler üretiliyor (0/${list.length}) — her biri birkaç dakika sürebilir`);
      await pool(list, +s.parallel || 3, async sc => {
        try {
          let h = !only && sc.vreq;
          if (!h) {
            h = await falSubmit(s.video_model, videoInput(s.video_model, sc.motion_en || 'slow cinematic camera push-in, subtle natural movement', await urlOf(sc.image, 24), sc.sec, p.opts.aspect || '1:1'));
            await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.vreq = h; x.status = 'working'; x.error = null; });
          } else await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.status = 'working'; x.error = null; });
          const out = await falWait(h);
          const saved = await saveRemote(pickVideo(out), fp(id, 'clips', `s${sc.n}-${stamp()}.mp4`), 'video/mp4');
          const sec = videoSeconds(h.model || s.video_model, sc.sec);
          usage(id, 'fal', 'video', sec * (+s.video_price || 0.07), { model: h.model, sec });
          await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.video = saved; x.video_sec = sec; x.vreq = null; x.status = 'done'; });
        } catch (e) { await mutate(id, p => { const x = p.scenes.find(x => x.n === sc.n); x.status = 'error'; x.error = e.message; x.vreq = null; }); }
        await progress(id, `Video klipler üretiliyor (${++done}/${list.length})`);
      });
    },
    async edit(id) {
      const p = await one(id); const s = await S();
      const allStill = p.opts.motion === 'kamera';
      const isStill = x => allStill || (x.still && !x.video);
      const scenes = p.scenes.filter(x => x.card || (isStill(x) ? x.image : x.video));
      if (!scenes.length) throw new Error('Kurgu için hiç video klip yok');
      const outPath = fp(id, 'final', `film-${stamp()}.mp4`);
      const target = await storage.uploadTarget(outPath);
      const manifest = {
        title: p.title, aspect: p.opts.aspect || '1:1', fps: 24, crossfade: +s.crossfade || 0, font: s.title_font || 'serif', music_volume: +s.music_volume || 0.8, grade: s.grade || 'yok', grain: s.grain || 'yok', subtitles: s.subtitles !== 'kapalı', sub_mode: s.subtitles === 'kelime grupları' ? 'chunks' : s.subtitles === 'tek kelime (sarı)' ? 'words' : s.subtitles === 'renkli kelime (karaoke)' ? 'karaoke' : 'line', sfx_volume: +s.sfx_volume || 0.5,
        music: p.audio && p.audio.music ? await urlOf(p.audio.music, 8) : null, upload: target,
        scenes: await Promise.all(scenes.map(async x => ({ n: x.n, card: !!x.card, still: isStill(x) && !x.card ? await urlOf(x.image, 8) : null, video: x.card || isStill(x) ? null : await urlOf(x.video, 8), video_sec: x.card || isStill(x) ? x.sec : (x.video_sec || x.sec), voice: x.voice ? await urlOf(x.voice, 8) : null, voice_sec: x.voice_sec || 0, radio: x.speaker === 'radyo', text: x.voice ? (x.narration || '') : '', chunks: x.voice ? (['tek kelime (sarı)', 'renkli kelime (karaoke)'].includes(s.subtitles) ? (x.words || x.chunks || []) : (x.chunks || [])) : [], sfx: x.sfx && s.sfx !== 'kapalı' ? await urlOf(x.sfx, 8) : null, overlay: x.overlay || '' }))),
      };
      const token = crypto.randomBytes(24).toString('hex');
      const task = await db.insert('gen_tasks', { project_id: null, kind: 'sinema_edit', items: [manifest], token, meta: { sinema_id: id } });
      try { await dispatch('sinema.yml', { task_id: task.id, token }); }
      catch (e) { await db.update('gen_tasks', `id=eq.${task.id}`, { status: 'failed', error: e.message.slice(0, 500), consumed: true }).catch(() => {}); throw e; }
      await progress(id, 'Kurgu GitHub Actions\'ta sıraya alındı…');
      const t0 = Date.now();
      while (Date.now() - t0 < 55 * 60 * 1000) {
        await sleep(5000);
        const t = await db.one('gen_tasks', `id=eq.${task.id}&select=status,results,error,progress`);
        if (t.status === 'running') await progress(id, 'Video kurgulanıyor (ffmpeg)…' + (t.progress && t.progress.total ? ` ${t.progress.done}/${t.progress.total} sahne` : ''));
        if (t.status === 'done') {
          await db.update('gen_tasks', `id=eq.${task.id}`, { consumed: true });
          const r = (t.results && t.results[0]) || {};
          await mutate(id, p => { p.final = { path: target.path, sec: r.sec || null, mb: r.mb || null, at: now() }; p.stage = 'done'; });
          return;
        }
        if (t.status === 'failed') { await db.update('gen_tasks', `id=eq.${task.id}`, { consumed: true }); throw new Error('Kurgu başarısız: ' + (t.error || '')); }
        if (t.status === 'queued' && Date.now() - t0 > 8 * 60 * 1000) throw new Error('Kurgu işi 8 dakikada başlamadı. Depoda sinema.yml var mı, Actions açık mı kontrol edin.');
      }
      throw new Error('Kurgu 55 dakikada bitmedi');
    },
    async done() { },
  };

  async function resume() {
    try { for (const r of await db.select(T, 'select=id,stage&status=eq.working')) { console.log('Sinema sürdürülüyor:', r.id, r.stage); start(r.id, r.stage); } }
    catch (e) { console.error('Sinema resume:', e.message); }
  }
  setTimeout(resume, 3000);

  /* ---------- arayüze gönderilen proje (dosya yolları → imzalı adres) ---------- */
  async function view(p) {
    const s = await S();
    const chars = await Promise.all((p.characters || []).map(async c => ({ ...c, image: await urlOf(c.image), src_ref_url: c.src_ref ? await urlOf(c.src_ref) : null })));
    const scenes = await Promise.all((p.scenes || []).map(async x => ({ ...x, vreq: undefined, image: await urlOf(x.image), video: await urlOf(x.video), voice: await urlOf(x.voice), sfx: await urlOf(x.sfx) })));
    const audio = p.audio ? { ...p.audio, music: await urlOf(p.audio.music) } : null;
    const final = p.final ? { ...p.final, url: await urlOf(p.final.path) } : null;
    const rows = await db.select('usage', `select=detail&note=like.sinema*&detail->>sinema_id=eq.${q(p.id)}`).catch(() => []);
    const cost = rows.reduce((a, r) => a + (+(r.detail && r.detail.usd) || 0), 0);
    const videoEst = (p.opts && p.opts.motion === 'kamera' ? [] : (p.scenes || []).filter(x => !x.video && !x.card && !x.still)).reduce((a, x) => a + videoSeconds(s.video_model, x.sec), 0) * (+s.video_price || 0.07);
    const places = await Promise.all(((p.opts && p.opts.places) || []).map(async m => ({ ...m, url: await urlOf(m.path) })));
    const cast = await Promise.all(((p.opts && p.opts.cast) || []).map(async m => ({ ...m, url: await urlOf(m.path) })));
    return { ...p, opts: { ...p.opts, places, cast }, characters: chars, scenes, audio, final, stages: STAGES.map(k => ({ k, name: STAGE_NAMES[k] })), cost: +cost.toFixed(2), video_estimate: +videoEst.toFixed(2), video_model: s.video_model, running: [...running].some(k => k.startsWith(p.id)) };
  }
  const readRaw = (req, limit) => new Promise((ok, no) => { const ch = []; let n = 0; req.on('data', c => { n += c.length; if (n > limit) { no(new Error('Dosya çok büyük')); req.destroy(); } else ch.push(c); }); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', no); });
  const pathsOf = p => [...(p.characters || []).map(c => c.image), ...(p.scenes || []).flatMap(s => [s.image, s.video, s.voice, s.sfx]), p.audio && p.audio.music, p.final && p.final.path].filter(x => x && !String(x).startsWith('r2:'));

  /* ---------- API (yalnızca yönetici) ---------- */
  on('GET', '/api/sinema/settings', async (req, res) => {
    const s = await S();
    send(res, 200, {
      fields: FIELDS.map(f => ({ k: f.k, label: f.label, group: f.group, options: f.options, help: f.help, value: s[f.k] })),
      keys: { fal: !!process.env.FAL_KEY, fal_tail: process.env.FAL_KEY ? process.env.FAL_KEY.slice(-4) : '', eleven: !!process.env.ELEVENLABS_API_KEY, github: !!process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO || 'onurcoskun616/egitimapi' },
    });
  }, 'admin');
  on('POST', '/api/sinema/settings', async (req, res) => { await saveSettings(await readBody(req)); send(res, 200, { ok: true }); }, 'admin');
  on('POST', '/api/sinema/keys', async (req, res) => {
    const b = await readBody(req);
    const row = await db.one('settings', 'key=eq.anahtarlar').catch(() => null);
    const v = { ...((row && row.value) || {}) };
    for (const [k, env] of Object.entries(KEY_NAMES)) {
      const val = String(b[k] || '').trim(); if (!val) continue;
      if (val.length < 20 || /\s/.test(val)) return send(res, 400, { error: 'Anahtar biçimi hatalı görünüyor; tamamını kopyalayıp yapıştırın' });
      v[k] = val; process.env[env] = val;
    }
    if (row) await db.update('settings', 'key=eq.anahtarlar', { value: v, updated_at: now() }); else await db.insert('settings', { key: 'anahtarlar', value: v });
    send(res, 200, { ok: true });
  }, 'admin');
  on('GET', '/api/sinema/voices', async (req, res) => { try { send(res, 200, await voices()); } catch (e) { send(res, 400, { error: e.message }); } }, 'admin');
  on('POST', '/api/sinema/test/:what', async (req, res, { what }) => {
    try {
      if (what === 'fal') {
        const r = await fetch('https://queue.fal.run/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status', { headers: { Authorization: 'Key ' + falKey() } });
        if (r.status === 401 || r.status === 403) throw new Error('FAL_KEY geçersiz (HTTP ' + r.status + ')');
        return send(res, 200, { ok: true, msg: 'fal.ai anahtarı kabul edildi' });
      }
      if (what === 'eleven') return send(res, 200, { ok: true, msg: `Bağlandı, ${(await voices()).length} ses bulundu` });
      if (what === 'github') {
        const repo = process.env.GITHUB_REPO || 'onurcoskun616/egitimapi';
        if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN tanımlı değil');
        const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows`, { headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'egitimapi' } });
        if (!r.ok) throw new Error('GitHub ' + r.status);
        const names = ((await r.json()).workflows || []).map(w => path.basename(w.path));
        const miss = ['generate.yml', 'sinema.yml'].filter(n => !names.includes(n));
        if (miss.length) throw new Error('Depoda eksik iş akışı: ' + miss.join(', '));
        return send(res, 200, { ok: true, msg: 'Depo ve iş akışları hazır' });
      }
      send(res, 404, { error: 'Bilinmeyen test' });
    } catch (e) { send(res, 200, { ok: false, msg: e.message }); }
  }, 'admin');

  // Görsel dil örnekleri: her tarz için aynı sahneyi bir kez üretir, saklar; yeni film formunda küçük önizleme olarak gösterilir
  const SAMPLE_SUBJECT = 'A cheerful teenage student with a backpack and a kind old man with a white mustache and a fur hat, talking and walking together on a cobblestone street of an old Istanbul neighborhood with small shops, warm late-afternoon light';
  let sampling = false;
  async function makeSamples() {
    if (sampling) return; sampling = true;
    try {
      for (const lk of ['', ...Object.keys(LOOKS)]) {
        const row = await db.one('settings', 'key=eq.sinema_ornek').catch(() => null); const cur = (row && row.value) || {};
        if (cur[lk || 'gercekci']) continue;
        try {
          const img = await textToImage(lk ? `${SAMPLE_SUBJECT}. STYLE: ${LOOKS[lk]}` : `Cinematic photorealistic film still, ${SAMPLE_SUBJECT}, shallow depth of field`, '1:1');
          const saved = await saveRemote(img.url, `sinema/ornek/${lk || 'gercekci'}-${stamp()}.jpg`, 'image/jpeg');
          usage(null, 'fal', 'görsel dil örneği', img.usd);
          const r2 = await db.one('settings', 'key=eq.sinema_ornek').catch(() => null); const v = { ...((r2 && r2.value) || {}), [lk || 'gercekci']: saved };
          if (r2) await db.update('settings', 'key=eq.sinema_ornek', { value: v, updated_at: now() }); else await db.insert('settings', { key: 'sinema_ornek', value: v });
        } catch (e) { console.error('Sinema örnek görsel', lk, e.message); }
      }
    } finally { sampling = false; }
  }
  on('GET', '/api/sinema/look-samples', async (req, res) => {
    const row = await db.one('settings', 'key=eq.sinema_ornek').catch(() => null); const cur = (row && row.value) || {};
    const out = {}; for (const k of ['gercekci', ...Object.keys(LOOKS)]) out[k] = cur[k] ? await urlOf(cur[k], 24) : null;
    const missing = Object.values(out).some(v => !v);
    if (missing) makeSamples().catch(() => {});
    send(res, 200, { samples: out, generating: missing });
  }, 'admin');
  on('POST', '/api/sinema/look-samples/reset', async (req, res) => {
    await db.update('settings', 'key=eq.sinema_ornek', { value: {}, updated_at: now() }).catch(() => {}); makeSamples().catch(() => {}); send(res, 200, { ok: true });
  }, 'admin');
  on('GET', '/api/sinema/projects', async (req, res) => {
    const rows = await db.select(T, 'select=id,title,topic,stage,status,created_at,updated_at,scenes,characters&order=created_at.desc&limit=100');
    send(res, 200, await Promise.all(rows.map(async p => { const f = (p.scenes || []).find(s => s.image); return { ...p, scenes: undefined, thumb: f ? await urlOf(f.image) : null, characters: await Promise.all((p.characters || []).filter(c => c.image).map(async c => ({ id: c.id, name: c.name, image: await urlOf(c.image) }))) }; })));
  }, 'admin');
  on('POST', '/api/sinema/projects', async (req, res) => {
    const b = await readBody(req);
    if (!b.topic || String(b.topic).trim().length < 5) return send(res, 400, { error: 'Konu en az birkaç kelime olmalı' });
    const opts = { duration: Math.max(20, Math.min(300, +b.duration || 90)), aspect: ['1:1', '16:9', '9:16'].includes(b.aspect) ? b.aspect : '1:1', tone: String(b.tone || '').slice(0, 200), narration: !!b.narration, bridge: !!b.bridge, tempo: ['hizli', 'dengeli', 'uzun'].includes(b.tempo) ? b.tempo : 'dengeli', look: Object.keys(LOOKS).includes(b.look) ? b.look : '', motion: ['kamera', 'karma'].includes(b.motion) ? b.motion : 'video', notes: String(b.notes || '').slice(0, 2000) };
    opts.cast = (Array.isArray(b.cast) ? b.cast : []).filter(m => m && /^sinema\/yuklenen\/[0-9a-f-]+\.(jpg|png|webp)$/.test(m.path)).slice(0, 6)
      .map((m, i) => ({ id: 'k' + (i + 1), name: String(m.name || `Karakter ${i + 1}`).slice(0, 60), desc: String(m.desc || '').slice(0, 300), path: m.path }));
    // Seri: önceki bir filmin karakterleri (çizilmiş görselleriyle) aynen alınır; yeniden üretilmez, böylece bölümler arasında aynı görünürler
    if (b.from_id && Array.isArray(b.from_chars) && b.from_chars.length) {
      const src = await one(String(b.from_id));
      for (const c of (src && src.characters || []).filter(c => b.from_chars.includes(c.id) && c.image)) {
        if (opts.cast.length >= 6) break;
        opts.cast.push({ id: 'k' + (opts.cast.length + 1), name: c.name, desc: [c.role, c.about].filter(Boolean).join(' — ').slice(0, 300), look_en: c.look_en, path: c.src_ref || null, image: c.image, voice: c.voice });
      }
    }
    opts.places = (Array.isArray(b.places) ? b.places : []).filter(m => m && /^sinema\/yuklenen\/[0-9a-f-]+\.(jpg|png|webp)$/.test(m.path)).slice(0, 8)
      .map((m, i) => ({ id: 'm' + (i + 1), name: String(m.name || `Mekân ${i + 1}`).slice(0, 60), desc: String(m.desc || '').slice(0, 300), path: m.path }));
    const topic = String(b.topic).trim().slice(0, 2000);
    const p = await db.insert(T, { owner_id: req.user.id, topic, title: topic.slice(0, 60), opts, auto: !!b.auto, stage: 'script', status: 'working' });
    start(p.id, 'script');
    send(res, 200, p);
  }, 'admin');
  on('GET', '/api/sinema/projects/:id', async (req, res, { id }) => {
    const p = await one(id); if (!p) return send(res, 404, { error: 'Proje bulunamadı' });
    send(res, 200, await view(p));
  }, 'admin');
  on('DELETE', '/api/sinema/projects/:id', async (req, res, { id }) => {
    const p = await one(id); if (!p) return send(res, 404, { error: 'Proje bulunamadı' });
    await storage.remove(pathsOf(p)).catch(() => {});
    await db.remove(T, `id=eq.${q(id)}`); send(res, 200, { ok: true });
  }, 'admin');
  // Mekân görseli yükleme (film oluşturulmadan önce); dönen yol yeni film isteğinde "places" içinde gönderilir
  on('POST', '/api/sinema/upload', async (req, res) => {
    const type = String(req.headers['content-type'] || '');
    const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : null;
    if (!ext) return send(res, 400, { error: 'Yalnızca JPG, PNG ya da WEBP görsel yüklenebilir' });
    const buf = await readRaw(req, 15e6);
    const saved = await storage.upload(`sinema/yuklenen/${crypto.randomUUID()}.${ext}`, buf, type);
    send(res, 200, { path: saved, url: await urlOf(saved) });
  }, 'admin');
  on('POST', '/api/sinema/projects/:id/music', async (req, res, { id }) => {
    const buf = await readRaw(req, 30e6); const type = String(req.headers['content-type'] || 'audio/mpeg');
    const ext = /wav/.test(type) ? 'wav' : /ogg/.test(type) ? 'ogg' : /mp4|m4a|aac/.test(type) ? 'm4a' : 'mp3';
    const saved = await storage.upload(fp(id, 'music', `yuklenen-${stamp()}.${ext}`), buf, type);
    await mutate(id, p => { p.audio = { music: saved, uploaded: true }; });
    send(res, 200, { ok: true });
  }, 'admin');
  on('POST', '/api/sinema/projects/:id/action', async (req, res, { id }) => {
    const b = await readBody(req); const p = await one(id);
    if (!p) return send(res, 404, { error: 'Proje bulunamadı' });
    const a = b.action;
    if (a === 'auto') { await setState(id, { auto: !!b.value }); return send(res, 200, { ok: true }); }
    if (p.status === 'working') return send(res, 409, { error: 'Bu aşama hâlâ çalışıyor, bitmesini bekleyin' });
    switch (a) {
      case 'approve': await advance(id); break;
      case 'retry': start(id, p.stage); break;
      case 'regenerate':
        if (!['script', 'board'].includes(p.stage)) return send(res, 400, { error: 'Bu aşamada kullanılamaz' });
        start(id, p.stage, { feedback: String(b.feedback || 'Daha iyi bir versiyon yaz.').slice(0, 3000) }); break;
      case 'goto':
        if (!STAGES.includes(b.stage) || STAGES.indexOf(b.stage) > STAGES.indexOf(p.stage)) return send(res, 400, { error: 'Geçersiz aşama' });
        await setState(id, { stage: b.stage, status: 'review', error: null }); break;
      case 'save': await mutate(id, x => {
        if (b.script) x.script = { ...x.script, ...b.script };
        if (b.title) x.title = String(b.title).slice(0, 120);
        if (Array.isArray(b.characters)) x.characters = b.characters.map(c => { const o = (x.characters || []).find(y => y.id === c.id) || {}; const m = { ...o, ...c, image: o.image, src_ref: o.src_ref }; delete m.src_ref_url; if (c.look_en !== undefined && c.look_en !== o.look_en) m.image = null; return m; });
        if (Array.isArray(b.scenes)) x.scenes = b.scenes.map((s, i) => { const o = (x.scenes || []).find(y => y.n === s.n) || {}; const m = { ...o, ...s, n: i + 1, image: o.image, video: o.video, voice: o.voice }; if ((s.image_en !== undefined && s.image_en !== o.image_en) || (s.place !== undefined && (s.place || '') !== (o.place || ''))) { m.image = null; m.video = null; } if (s.motion_en !== undefined && s.motion_en !== o.motion_en) m.video = null; if ((s.narration !== undefined && s.narration !== o.narration) || (s.speaker !== undefined && s.speaker !== o.speaker)) { m.voice = null; m.voice_sec = 0; } if (s.sfx_en !== undefined && s.sfx_en !== o.sfx_en) m.sfx = null; if (+s.sec && +s.sec !== +o.sec) m.video = null; return m; });
      }); break;
      case 'charref': {
        if (b.path && !/^sinema\/yuklenen\/[0-9a-f-]+\.(jpg|png|webp)$/.test(b.path)) return send(res, 400, { error: 'Geçersiz görsel' });
        await mutate(id, x => { const c = (x.characters || []).find(c => c.id === b.id); if (!c) return; c.src_ref = b.path || null; c.image = null; c.ref = true; c.status = null; });
        return send(res, 200, await view(await one(id)));
      }
      case 'redo': {
        const map = { char: 'chars', frame: 'frames', voice: 'audio', video: 'videos', sfx: 'audio' }; const stage = map[b.kind];
        if (!stage) return send(res, 400, { error: 'Geçersiz tür' });
        if (b.kind === 'char') await mutate(id, x => { const c = x.characters.find(c => c.id === b.id); if (b.look_en) c.look_en = b.look_en; c.image = null; });
        if (b.kind === 'frame') await mutate(id, x => { const s = x.scenes.find(s => s.n === +b.id); if (b.prompt) s.image_en = b.prompt; s.image = null; s.video = null; });
        if (b.kind === 'video') await mutate(id, x => { const s = x.scenes.find(s => s.n === +b.id); if (b.prompt) s.motion_en = b.prompt; s.video = null; s.vreq = null; });
        if (b.kind === 'voice') await mutate(id, x => { const s = x.scenes.find(s => s.n === +b.id); if (b.prompt !== undefined) s.narration = b.prompt; if (b.speaker) s.speaker = b.speaker; s.voice = null; });
        if (b.kind === 'sfx') await mutate(id, x => { const s = x.scenes.find(s => s.n === +b.id); if (b.prompt !== undefined) s.sfx_en = String(b.prompt).slice(0, 300); s.sfx = null; });
        start(id, stage, { only: b.kind === 'char' ? b.id : +b.id, sfxOnly: b.kind === 'sfx' }); break;
      }
      case 'music': await mutate(id, x => { if (b.prompt) x.script = { ...x.script, music: b.prompt }; x.audio = null; }); start(id, 'audio', { musicOnly: 'force' }); break;
      case 'nomusic': await mutate(id, x => { x.audio = { music: null, skipped: true }; }); break;
      case 'cleanup': {
        const keep = new Set([p.final && p.final.path, ...(p.scenes || []).map(s => s.image), ...(p.characters || []).map(c => c.image)]);
        const del = pathsOf(p).filter(x => !keep.has(x));
        try { await storage.remove(del); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
        await mutate(id, x => { x.scenes = x.scenes.map(s => ({ ...s, video: null, voice: null })); x.audio = x.audio ? { ...x.audio, music: null } : x.audio; x.final = { ...x.final, cleaned: true }; });
        return send(res, 200, { ok: true, removed: del.length });
      }
      default: return send(res, 400, { error: 'Bilinmeyen işlem' });
    }
    send(res, 200, { ok: true });
  }, 'admin');
};
