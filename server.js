// Eğitim videosu üretim platformu — bağımlılıksız Node sunucusu
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, storage, q } = require('./lib/supa');
const claude = require('./lib/claude');
const { TONES, voiceForTone } = require('./lib/tones');
const eleven = require('./lib/eleven');
const { pagesFor, sourcesBlock } = require('./lib/sources');
const quiz = require('./lib/quiz');
const audit = require('./lib/audit');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const SESSION = () => crypto.createHash('sha256').update('egitim:' + (process.env.APP_PASSWORD || '')).digest('hex');
const publicBase = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

/* ---------- yardımcılar ---------- */
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 2e6) {
  return new Promise((ok, no) => { let b = ''; req.on('data', d => { b += d; if (b.length > limit) { no(new Error('İstek çok büyük')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('Geçersiz JSON')); } }); });
}
function authed(req) { const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/); return !!(process.env.APP_PASSWORD && m && m[1] === SESSION()); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const now = () => new Date().toISOString();
async function setStatus(id, status, extra = {}) { return db.update('projects', `id=eq.${q(id)}`, { status, updated_at: now(), ...extra }); }
async function nextVersion(id, stage) { const v = await latest(id, stage); return (v ? v.version : 0) + 1; }
async function latest(id, stage) { return db.one('versions', `project_id=eq.${q(id)}&stage=eq.${stage}&order=version.desc`); }
async function logUsage(project_id, provider, units, note) { try { await db.insert('usage', { project_id, provider, units, note }); } catch (e) { console.error('usage', e.message); } }

// Arka plan işi: hata olursa proje "failed" olur, hangi adımda kaldığı saklanır
// Adımlar projects.pending'e yazılır; sunucu yeniden başlarsa kaldığı yerden sürdürülür
const STEPS = { content: (id, fb) => runContent(id, fb), visuals: (id, k, fb, fixes) => runVisuals(id, k, fb, fixes), voice: id => runVoiceAndRender(id), render: (id, fmt) => startRender(id, fmt) };
const RUNNING = new Set();
function background(id, stage, args = []) {
  RUNNING.add(id);
  (async () => {
    await db.update('projects', `id=eq.${q(id)}`, { pending: { stage, args } });
    await STEPS[stage](id, ...args);
    await db.update('projects', `id=eq.${q(id)}`, { pending: null });
  })().catch(async e => { console.error(stage, e); await setStatus(id, 'failed', { error: `${stage}|${e.message}`.slice(0, 900), pending: null }).catch(() => {}); })
    .finally(() => RUNNING.delete(id));
}
// Aynı projede ikinci bir adımın başlamasını ve yanlış aşamada onay/düzeltmeyi engeller
async function guard(res, id, allowed, lock = true) {
  const p = await db.one('projects', `id=eq.${q(id)}&select=status`);
  if (!p) { send(res, 404, { error: 'Bulunamadı' }); return false; }
  if (RUNNING.has(id) || !allowed.includes(p.status)) { send(res, 409, { error: 'Bu proje şu an başka bir adımı işliyor. Sayfayı yenileyip bekleyin.' }); return false; }
  if (lock) RUNNING.add(id); // background() başlayana kadar ikinci isteği engelle
  return true;
}
async function resumeQuiz() {
  const rows = await db.select('projects', 'select=id,quiz_feedback&quiz_status=eq.generating');
  rows.forEach(r => { console.log('Sorular sürdürülüyor:', r.id); runQuizBg(r.id, r.quiz_feedback || null); });
}
async function resumePending() {
  const rows = await db.select('projects', 'select=id,status,pending&pending=not.is.null&status=in.(content_generating,visuals_generating,voicing)');
  for (const p of rows) { if (STEPS[p.pending.stage]) { console.log('Sürdürülüyor:', p.id, p.pending.stage); background(p.id, p.pending.stage, p.pending.args || []); } }
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

/* ---------- GitHub Actions ---------- */
async function dispatch(workflow, inputs) {
  const repo = process.env.GITHUB_REPO || 'onurcoskun616/egitimapi';
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN tanımlı değil');
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'egitimapi' },
    body: JSON.stringify({ ref: process.env.GITHUB_REF || 'main', inputs: { ...inputs, api_base: publicBase() } }),
  });
  if (r.status !== 204) throw new Error('GitHub iş başlatılamadı: ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
// Claude isteklerini abonelikle çalışan generate.yml'e gönderir ve sonucu bekler
const ctxFor = (projectId, kind) => ({
  async viaActions(items, model) {
    // Aynı istem için bekleyen ya da biten görev varsa yeniden çalıştırma, onu kullan
    const key = canon(items);
    const open = await db.select('gen_tasks', `select=id,items,status,created_at&project_id=eq.${q(projectId)}&kind=eq.${kind}&consumed=is.false&status=in.(queued,running,done)&order=created_at.desc&limit=5`);
    let task = open.find(t => canon(t.items) === key && Date.now() - new Date(t.created_at) < 45 * 60 * 1000);
    if (!task) {
      const token = crypto.randomBytes(24).toString('hex');
      task = await db.insert('gen_tasks', { project_id: projectId, kind, items, model, token });
      await dispatch('generate.yml', { task_id: task.id, token });
    } else console.log('Var olan Claude görevi kullanılıyor:', task.id);
    const deadline = new Date(task.created_at || Date.now()).getTime() + 45 * 60 * 1000;
    while (Date.now() < deadline) {
      const t = await db.one('gen_tasks', `id=eq.${task.id}&select=status,results,error`);
      if (t.status === 'done') { await db.update('gen_tasks', `id=eq.${task.id}`, { consumed: true }); return t.results; }
      if (t.status === 'failed') { await db.update('gen_tasks', `id=eq.${task.id}`, { consumed: true }); throw new Error('Claude (GitHub Actions): ' + (t.error || 'bilinmeyen hata')); }
      await sleep(4000);
    }
    throw new Error('Claude yanıtı 40 dakikada gelmedi');
  },
});
const tokensOf = u => u ? (u.input_tokens || 0) + (u.output_tokens || 0) : 0;

/* ---------- üretim adımları ---------- */
async function runContent(id, feedback) {
  const p = await db.one('projects', `id=eq.${q(id)}`);
  const prev = feedback ? await latest(id, 'content') : null;
  await setStatus(id, 'content_generating', { error: null });
  const { data, usage } = await claude.generateContent(p, prev && prev.data, feedback, ctxFor(id, 'content'), await loadSources(id));
  await logUsage(id, 'claude', tokensOf(usage), 'content');
  await db.insert('versions', { project_id: id, stage: 'content', version: await nextVersion(id, 'content'), data, feedback: feedback || null });
  await setStatus(id, 'content_review');
}

async function loadSources(id) { return db.select('project_sources', `project_id=eq.${q(id)}&select=name,pages&order=created_at.asc`); }

// fixes: [{k, note}] → yalnızca bu sahneleri notlarıyla yeniden çizer (denetim önerileri)
async function runVisuals(id, onlyK, feedback, fixes) {
  const content = await latest(id, 'content');
  const prevV = await latest(id, 'visuals');
  await setStatus(id, 'visuals_generating', { error: null });
  const topic = content.data.topic;
  const sources = await loadSources(id);
  const srcOf = s => pagesFor(sources, s.src);
  let scenes, changed = null, label = feedback || null;
  const ctx = ctxFor(id, 'visuals');
  const fixList = Array.isArray(fixes) && prevV ? fixes.filter(f => f && f.k && f.note) : [];
  if (fixList.length) {
    scenes = prevV.data.scenes.map(s => ({ ...s }));
    const targets = fixList.map(f => ({ f, s: scenes.find(x => x.k === f.k) })).filter(x => x.s);
    const res = await claude.generateSceneCodes(targets.map(({ f, s }) => ({ scene: strip(s), feedback: f.note, prevCode: s.code, srcText: srcOf(s) })), topic, ctx);
    targets.forEach(({ s }, i) => { s.code = res[i].code; });
    await logUsage(id, 'claude', res.reduce((n, r) => n + tokensOf(r.usage), 0), 'denetim düzeltmesi');
    changed = targets.map(x => x.s.k); label = `[denetim önerisi: ${changed.join(', ')}]`;
  } else if (onlyK && prevV) {
    scenes = prevV.data.scenes.map(s => ({ ...s }));
    const s = scenes.find(x => x.k === onlyK);
    const [r] = await claude.generateSceneCodes([{ scene: strip(s), feedback, prevCode: s.code, srcText: srcOf(s) }], topic, ctx);
    s.code = r.code; await logUsage(id, 'claude', tokensOf(r.usage), 'scene ' + onlyK);
    changed = [onlyK]; label = `[${onlyK}] ${feedback}`;
  } else {
    const jobs = content.data.scenes.map(s => ({ scene: s, feedback, srcText: srcOf(s), prevCode: prevV && feedback ? (prevV.data.scenes.find(x => x.k === s.k) || {}).code : null }));
    const res = await claude.generateSceneCodes(jobs, topic, ctx);
    await logUsage(id, 'claude', res.reduce((n, r) => n + tokensOf(r.usage), 0), 'scenes');
    scenes = content.data.scenes.map((s, i) => ({ ...s, code: res[i].code }));
  }
  const v = await db.insert('versions', { project_id: id, stage: 'visuals', version: await nextVersion(id, 'visuals'), data: { topic, scenes }, feedback: label });
  await setStatus(id, 'visuals_review');
  startAudit(id, v, changed, prevV).catch(e => console.error('denetim', e));
}

/* ---------- teknik denetim ---------- */
async function startAudit(id, v, ks, prevV) {
  if (!v || !v.id) v = await latest(id, 'visuals');
  const sources = await loadSources(id);
  const carried = {};
  if (ks && prevV && prevV.audit && prevV.audit.scenes) for (const [k, r] of Object.entries(prevV.audit.scenes)) if (!ks.includes(k)) carried[k] = r;
  const scenes = v.data.scenes.filter(s => !ks || ks.includes(s.k));
  if (!scenes.length) return;
  const items = scenes.map(s => ({ k: s.k, user: audit.auditPrompt(s, v.data.topic, pagesFor(sources, s.src)) }));
  try {
    const token = crypto.randomBytes(24).toString('hex');
    const task = await db.insert('gen_tasks', { project_id: id, kind: 'audit', items, model: claude.MODEL(), token, meta: { version_id: v.id } });
    await db.update('versions', `id=eq.${v.id}`, { audit: { status: 'running', task_id: task.id, total: scenes.length, scenes: carried, started_at: now() } });
    await dispatch('audit.yml', { task_id: task.id, token });
  } catch (e) {
    await db.update('versions', `id=eq.${v.id}`, { audit: { status: 'failed', error: e.message, scenes: carried } });
  }
}

const strip = s => { const { code, ...rest } = s; return rest; };

async function runVoiceAndRender(id) {
  const p = await db.one('projects', `id=eq.${q(id)}`);
  const vis = await latest(id, 'visuals');
  await setStatus(id, 'voicing', { error: null });
  const { text, marks } = eleven.buildScript(vis.data.scenes);
  const voice = p.voice_id || voiceForTone(p.tone) || process.env.ELEVENLABS_VOICE_ID;
  if (!voice) throw new Error('ElevenLabs ses kimliği (ELEVENLABS_VOICE_ID) tanımlı değil');
  const { audio, alignment } = await eleven.tts(text, voice);
  await logUsage(id, 'elevenlabs', text.length, 'tts');
  const audioPath = `audio/${id}/${Date.now()}.mp3`;
  await storage.upload(audioPath, audio, 'audio/mpeg');
  const tm = eleven.timings(vis.data.scenes, marks, alignment);
  const dur = alignment.character_end_times_seconds.at(-1);
  await db.insert('audio_tracks', { project_id: id, path: audioPath, alignment: { timings: tm, visuals_version: vis.version }, duration_s: dur });
  await startRender(id);
}

const FORMATS = { dikey: 'Dikey 9:16 (1080×1920)', yatay: 'Yatay 16:9 (1920×1080)', kare: 'Kare 1:1 (1080×1080)', dikey45: 'Dikey 4:5 (1080×1350)' };
async function startRender(id, format) {
  const token = crypto.randomBytes(24).toString('hex');
  if (!FORMATS[format]) { const p = await db.one('projects', `id=eq.${q(id)}&select=format`); format = (p && FORMATS[p.format]) ? p.format : 'dikey'; }
  const job = await db.insert('render_jobs', { project_id: id, token, status: 'queued', format });
  await setStatus(id, 'rendering', { error: null });
  await dispatch('render.yml', { job_id: job.id, token });
}

/* ---------- etkileşimli ders soruları ---------- */
const QUIZ_RUNNING = new Set();
function runQuizBg(id, feedback) {
  if (QUIZ_RUNNING.has(id)) return; QUIZ_RUNNING.add(id);
  runQuiz(id, feedback).catch(async e => { console.error('quiz', e); await db.update('projects', `id=eq.${q(id)}`, { quiz_status: 'failed', quiz_error: e.message.slice(0, 600) }).catch(() => {}); }).finally(() => QUIZ_RUNNING.delete(id));
}
async function runQuiz(id, feedback) {
  const p = await db.one('projects', `id=eq.${q(id)}`);
  const content = await latest(id, 'content'); if (!content) throw new Error('İçerik yok');
  const prev = feedback ? await latest(id, 'quiz') : null;
  await db.update('projects', `id=eq.${q(id)}`, { quiz_status: 'generating', quiz_error: null, quiz_feedback: feedback || null });
  const scenes = content.data.scenes;
  const user = quiz.quizPrompt(p, scenes, sourcesBlock(await loadSources(id)).slice(0, 60000), prev && prev.data, feedback);
  const [r] = await claude.complete([{ system: quiz.QUIZ_SYSTEM, user, max: 12000 }], ctxFor(id, 'quiz'));
  if (!r || r.error) throw new Error((r && r.error) || 'yanıt yok');
  const data = quiz.validate(claude.extractJson(r.text), scenes);
  await logUsage(id, 'claude', tokensOf(r.usage), 'quiz');
  await db.insert('versions', { project_id: id, stage: 'quiz', version: await nextVersion(id, 'quiz'), data, feedback: feedback || null });
  await db.update('projects', `id=eq.${q(id)}`, { quiz_status: 'ready', quiz_feedback: null });
}
// Öğrencinin elle yazacağı ders kodu: 6 karakter, karışmayan harf/rakamlar (0/O, 1/I yok)
const CODE_ABC = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
const shortId = () => Array.from(crypto.randomBytes(6), b => CODE_ABC[b % CODE_ABC.length]).join('');

async function bundleFor(id, withAudio, format, versionId) {
  const p = await db.one('projects', `id=eq.${q(id)}`);
  const vis = versionId ? await db.one('versions', `id=eq.${q(versionId)}`) : await latest(id, 'visuals');
  if (!vis) return null;
  const scenes = vis.data.scenes.map(s => ({ k: s.k, ch: s.ch, title: s.title, cap: s.cap, big: s.big, tag: s.tag, warn: s.warn, code: s.code }));
  const b = { topic: vis.data.topic || p.title, brand: 'NASIL ÇALIŞIR', format: format || p.format || 'dikey', scenes };
  if (withAudio) {
    const a = await db.one('audio_tracks', `project_id=eq.${q(id)}&order=created_at.desc`);
    if (a) { a.alignment.timings.forEach((t, i) => Object.assign(scenes[i], t)); b.audioUrl = await storage.signedUrl(a.path, 4 * 3600); b.audioDuration = a.duration_s; }
  }
  return b;
}

/* ---------- yönlendirme ---------- */
const routes = [];
const on = (method, pattern, handler, open = false) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, open });

on('POST', '/api/login', async (req, res) => {
  const { password } = await readBody(req);
  if (!process.env.APP_PASSWORD || !safeEq(password || '', process.env.APP_PASSWORD)) return send(res, 401, { error: 'Şifre hatalı' });
  send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${SESSION()}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${publicBase().startsWith('https') ? '; Secure' : ''}` });
}, true);
on('GET', '/api/me', async (req, res) => send(res, 200, { ok: authed(req) }), true);
on('POST', '/api/logout', async (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': `sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${publicBase().startsWith('https') ? '; Secure' : ''}` }), true);
on('GET', '/api/tones', async (req, res) => send(res, 200, Object.entries(TONES).map(([k, [label, desc]]) => ({ k, label, desc }))));

on('GET', '/api/projects', async (req, res) => send(res, 200, await db.select('projects', 'select=id,title,status,updated_at,target_seconds&status=neq.archived&order=updated_at.desc')));
async function saveSources(id, list) {
  const out = [];
  for (const s of (Array.isArray(list) ? list : []).slice(0, 10)) {
    const pages = (Array.isArray(s.pages) ? s.pages : []).slice(0, 800).map(p => String(p || '').slice(0, 20000));
    const chars = pages.reduce((n, p) => n + p.length, 0);
    if (!chars) continue;
    out.push(await db.insert('project_sources', { project_id: id, name: String(s.name || 'kaynak').slice(0, 120), pages, chars }));
  }
  return out;
}
on('POST', '/api/projects', async (req, res) => {
  const b = await readBody(req, 12e6);
  if (!b.title || !b.brief) return send(res, 400, { error: 'Konu ve açıklama gerekli' });
  let tone = String(b.tone || '');
  if (tone === 'ozel') tone = 'ozel:' + String(b.tone_note || '').trim().slice(0, 300);
  if (!(TONES[tone] || (tone.startsWith('ozel:') && tone.length > 8))) return send(res, 400, { error: 'Anlatım dilini seçin (özelse kısaca tarif edin)' });
  const p = await db.insert('projects', { title: String(b.title).slice(0, 120), brief: String(b.brief).slice(0, 4000), audience: b.audience || null, target_seconds: Math.min(300, Math.max(30, +b.target_seconds || 90)), voice_id: b.voice_id || null, tone, format: FORMATS[b.format] ? b.format : 'dikey', status: 'content_generating' });
  await saveSources(p.id, b.sources);
  background(p.id, 'content', []);
  send(res, 201, p);
});
on('GET', '/api/projects/:id', async (req, res, { id }) => {
  const p = await db.one('projects', `id=eq.${q(id)}`); if (!p) return send(res, 404, { error: 'Bulunamadı' });
  const content = await latest(id, 'content'); const visuals = await latest(id, 'visuals');
  const job = await db.one('render_jobs', `project_id=eq.${q(id)}&order=created_at.desc&select=id,status,progress,output_path,error,created_at,finished_at`);
  // Son seslendirmeden sonra üretilmiş, her biçimin en yeni videosu
  const at = await db.one('audio_tracks', `project_id=eq.${q(id)}&order=created_at.desc&select=created_at`);
  const done = await db.select('render_jobs', `project_id=eq.${q(id)}&status=eq.done&order=created_at.desc&select=format,output_path,created_at`);
  const videos = []; const seen = new Set();
  for (const j of done) { const f = j.format || 'dikey'; if (seen.has(f) || !j.output_path || (at && new Date(j.created_at) < new Date(at.created_at))) continue; seen.add(f); videos.push({ format: f, label: FORMATS[f] || f, url: await storage.signedUrl(j.output_path, 24 * 3600) }); }
  const main = videos.find(v => v.format === (p.format || 'dikey')) || videos[0];
  const videoUrl = main ? main.url : null;
  const sources = await db.select('project_sources', `project_id=eq.${q(id)}&select=name,chars,created_at&order=created_at.asc`);
  let gen = null;
  if (/_generating$/.test(p.status)) { const g = await db.one('gen_tasks', `project_id=eq.${q(id)}&consumed=is.false&kind=neq.audit&order=created_at.desc&select=status,progress,created_at`); if (g) gen = g; }
  send(res, 200, { project: p, gen, content, visuals: visuals && { version: visuals.version, feedback: visuals.feedback, scenes: visuals.data.scenes.map(s => ({ k: s.k, title: s.title })) }, job, videoUrl, videos, mainFormat: main ? main.format : (p.format || 'dikey'), formats: FORMATS, sources, quizStatus: p.quiz_status || null });
});
on('POST', '/api/projects/:id/sources', async (req, res, { id }) => {
  const b = await readBody(req, 12e6); const saved = await saveSources(id, b.sources);
  send(res, 200, { added: saved.map(x => ({ name: x.name, pages: x.pages.length, chars: x.chars })) });
});
on('GET', '/api/projects/:id/audit', async (req, res, { id }) => {
  const v = await latest(id, 'visuals'); if (!v) return send(res, 404, { error: 'Görsel yok' });
  const a = v.audit || null; let progress = null;
  if (a && a.status === 'running' && a.task_id) { const t = await db.one('gen_tasks', `id=eq.${q(a.task_id)}&select=status,progress,created_at`); progress = t && t.progress; if (t && t.status === 'failed') a.status = 'failed'; }
  const scenes = {};
  if (a && a.scenes) for (const [k, r] of Object.entries(a.scenes)) scenes[k] = { ...r, sheetUrl: r.sheet ? await storage.signedUrl(r.sheet, 3600) : null };
  send(res, 200, { version: v.version, status: a ? a.status : 'none', error: a && a.error, total: a && a.total, progress, scenes, titles: v.data.scenes.map(s => ({ k: s.k, title: s.title })) });
});
on('POST', '/api/projects/:id/audit', async (req, res, { id }) => {
  if (!await guard(res, id, ['visuals_review', 'delivered'], false)) return;
  const v = await latest(id, 'visuals'); await startAudit(id, v, null, null); send(res, 202, { ok: true });
});
on('POST', '/api/projects/:id/visuals/fix', async (req, res, { id }) => {
  const { ks } = await readBody(req);
  const v = await latest(id, 'visuals'); const sc = (v && v.audit && v.audit.scenes) || {};
  const fixes = (Array.isArray(ks) ? ks : Object.keys(sc)).map(k => ({ k: String(k), note: sc[k] && (sc[k].fix_note || (sc[k].issues || []).map(i => i.fix).filter(Boolean).join(' ')) })).filter(f => f.note && sc[f.k] && sc[f.k].severity !== 'yok');
  if (!fixes.length) return send(res, 400, { error: 'Düzeltilecek öneri yok' });
  if (!await guard(res, id, ['visuals_review'])) return;
  background(id, 'visuals', [null, null, fixes]); send(res, 202, { ok: true, count: fixes.length });
});
on('GET', '/api/projects/:id/bundle', async (req, res, { id }) => { const b = await bundleFor(id, new URL(req.url, 'http://x').searchParams.get('audio') === '1'); b ? send(res, 200, b) : send(res, 404, { error: 'Görsel yok' }); });

on('POST', '/api/projects/:id/content/revise', async (req, res, { id }) => { const { feedback } = await readBody(req); if (!feedback) return send(res, 400, { error: 'Düzeltme notu gerekli' }); if (!await guard(res, id, ['content_review'])) return; background(id, 'content', [feedback]); send(res, 202, { ok: true }); });
on('POST', '/api/projects/:id/content/approve', async (req, res, { id }) => {
  if (!await guard(res, id, ['content_review'])) return;
  const v = await latest(id, 'content'); await db.update('versions', `id=eq.${v.id}`, { approved_at: now() });
  background(id, 'visuals', []); send(res, 202, { ok: true });
});
on('POST', '/api/projects/:id/visuals/revise', async (req, res, { id }) => { const { feedback, k } = await readBody(req); if (!feedback) return send(res, 400, { error: 'Düzeltme notu gerekli' }); if (!await guard(res, id, ['visuals_review'])) return; background(id, 'visuals', [k || null, feedback]); send(res, 202, { ok: true }); });
on('POST', '/api/projects/:id/visuals/approve', async (req, res, { id }) => {
  if (!await guard(res, id, ['visuals_review', 'delivered'])) return; // teslimden sonra: aynı görsellerle yeni sesle yeniden üret
  const v = await latest(id, 'visuals'); await db.update('versions', `id=eq.${v.id}`, { approved_at: now() });
  background(id, 'voice', []); send(res, 202, { ok: true });
  const pq = await db.one('projects', `id=eq.${q(id)}&select=quiz_status`);
  if (!pq.quiz_status && !(await latest(id, 'quiz'))) runQuizBg(id, null); // sorular seslendirme/videoyla paralel hazırlanır
});
on('POST', '/api/projects/:id/render', async (req, res, { id }) => {
  const { format } = await readBody(req); if (!FORMATS[format]) return send(res, 400, { error: 'Geçersiz biçim' });
  if (!await guard(res, id, ['delivered'])) return;
  background(id, 'render', [format]); send(res, 202, { ok: true });
});
on('GET', '/api/projects/:id/quiz', async (req, res, { id }) => {
  const p = await db.one('projects', `id=eq.${q(id)}&select=id,title,status,share_id,quiz_status,quiz_error,quiz_published`); if (!p) return send(res, 404, { error: 'Bulunamadı' });
  const v = await latest(id, 'quiz');
  const attempts = await db.select('lesson_attempts', `project_id=eq.${q(id)}&select=id,student_name,student_class,started_at,finished_at,summary,quiz_version&order=started_at.desc&limit=500`);
  send(res, 200, { project: p, version: v && v.version, quiz: v && v.data, attempts });
});
on('POST', '/api/projects/:id/quiz/generate', async (req, res, { id }) => {
  const { feedback } = await readBody(req);
  if (QUIZ_RUNNING.has(id)) return send(res, 409, { error: 'Sorular zaten hazırlanıyor' });
  runQuizBg(id, feedback ? String(feedback).slice(0, 2000) : null); send(res, 202, { ok: true });
});
on('POST', '/api/projects/:id/quiz/delete', async (req, res, { id }) => {
  const { cp, qi } = await readBody(req); const v = await latest(id, 'quiz'); if (!v) return send(res, 404, { error: 'Soru yok' });
  const d = v.data; if (!d.checkpoints[cp] || !d.checkpoints[cp].questions[qi]) return send(res, 400, { error: 'Soru bulunamadı' });
  d.checkpoints[cp].questions.splice(qi, 1); d.checkpoints = d.checkpoints.filter(c => c.questions.length);
  await db.update('versions', `id=eq.${v.id}`, { data: d }); send(res, 200, { ok: true });
});
on('POST', '/api/projects/:id/quiz/publish', async (req, res, { id }) => {
  const { on: pub } = await readBody(req); const p = await db.one('projects', `id=eq.${q(id)}&select=share_id`);
  const patch = { quiz_published: !!pub }; if (!p.share_id) patch.share_id = shortId();
  const r = await db.update('projects', `id=eq.${q(id)}`, patch); send(res, 200, { share_id: r.share_id, published: r.quiz_published });
});

/* ---------- öğrenci (herkese açık) ders uç noktaları ---------- */
async function lessonBy(sid) {
  sid = String(sid || '').trim(); if (!sid || sid.length > 20) return null;
  let p = await db.one('projects', `share_id=eq.${q(sid)}&quiz_published=is.true&select=id,title,format,status,share_id`);
  if (!p && sid !== sid.toUpperCase()) p = await db.one('projects', `share_id=eq.${q(sid.toUpperCase())}&quiz_published=is.true&select=id,title,format,status,share_id`);
  if (!p) return null; const v = await latest(p.id, 'quiz'); return v ? { p, v } : null;
}
on('GET', '/api/l/:sid/check', async (req, res, { sid }) => {
  const L = await lessonBy(sid); if (!L) return send(res, 404, { error: 'Ders bulunamadı ya da yayında değil' });
  send(res, 200, { code: L.p.share_id, title: L.p.title });
}, true);
on('GET', '/api/l/:sid', async (req, res, { sid }) => {
  const L = await lessonBy(sid); if (!L) return send(res, 404, { error: 'Ders bulunamadı ya da yayında değil' });
  const { p, v } = L;
  const at = await db.one('audio_tracks', `project_id=eq.${q(p.id)}&order=created_at.desc&select=created_at`);
  const done = await db.select('render_jobs', `project_id=eq.${q(p.id)}&status=eq.done&order=created_at.desc&select=format,output_path,created_at`);
  const videos = {}; for (const j of done) { const f = j.format || 'dikey'; if (videos[f] || !j.output_path || (at && new Date(j.created_at) < new Date(at.created_at))) continue; videos[f] = await storage.signedUrl(j.output_path, 6 * 3600); }
  if (!Object.keys(videos).length) return send(res, 404, { error: 'Dersin videosu henüz hazır değil' });
  const bundle = await bundleFor(p.id, true, p.format || 'dikey'); delete bundle.audioUrl;
  send(res, 200, { title: p.title, format: p.format || 'dikey', videos, bundle, quiz: quiz.publicQuiz(v.data, v.version * 7919 + 13), version: v.version });
}, true);
async function attemptAuth(sid, b) {
  const L = await lessonBy(sid); if (!L) return null;
  const a = await db.one('lesson_attempts', `id=eq.${q(b.attempt)}&project_id=eq.${q(L.p.id)}`);
  if (!a || !b.token || !safeEq(b.token, a.token)) return null;
  const v = a.quiz_version === L.v.version ? L.v : await db.one('versions', `project_id=eq.${q(L.p.id)}&stage=eq.quiz&version=eq.${a.quiz_version}`);
  return { ...L, a, v };
}
on('POST', '/api/l/:sid/start', async (req, res, { sid }) => {
  const b = await readBody(req, 4000); const L = await lessonBy(sid); if (!L) return send(res, 404, { error: 'Ders bulunamadı' });
  const name = String(b.name || '').trim().slice(0, 80); if (name.length < 2) return send(res, 400, { error: 'Adınızı yazın' });
  const token = crypto.randomBytes(16).toString('hex');
  const a = await db.insert('lesson_attempts', { project_id: L.p.id, quiz_version: L.v.version, token, student_name: name, student_class: String(b.cls || '').trim().slice(0, 40) || null });
  send(res, 200, { attempt: a.id, token });
}, true);
on('POST', '/api/l/:sid/answer', async (req, res, { sid }) => {
  const b = await readBody(req, 8000); const A = await attemptAuth(sid, b); if (!A) return send(res, 403, { error: 'Oturum geçersiz' });
  const x = A.v.data.checkpoints[+b.cp] && A.v.data.checkpoints[+b.cp].questions[+b.qi]; if (!x) return send(res, 400, { error: 'Soru yok' });
  const correct = quiz.check(x, b.response);
  if ((A.a.answers || []).length >= 400) return send(res, 429, { error: 'Çok fazla deneme' });
  await db.rpc('append_answer', { p_id: A.a.id, p_answer: { cp: +b.cp, qi: +b.qi, pass: +b.pass || 1, response: JSON.parse(JSON.stringify(b.response ?? null)), correct, at: now() } });
  send(res, 200, { correct, explain: x.explain, correct_text: quiz.correctText(x), answer: (x.type === 'mcq' || x.type === 'image') ? x.answer : undefined });
}, true);
on('POST', '/api/l/:sid/finish', async (req, res, { sid }) => {
  const b = await readBody(req, 4000); const A = await attemptAuth(sid, b); if (!A) return send(res, 403, { error: 'Oturum geçersiz' });
  const summary = quiz.summarize(A.v.data, A.a.answers);
  await db.update('lesson_attempts', `id=eq.${q(A.a.id)}`, { summary, finished_at: now() });
  send(res, 200, summary);
}, true);

on('GET', '/api/lessons', async (req, res) => {
  const ps = await db.select('projects', 'select=id,title,share_id,quiz_status,quiz_published,updated_at&quiz_status=not.is.null&status=neq.archived&order=updated_at.desc');
  const at = ps.length ? await db.select('lesson_attempts', `project_id=in.(${ps.map(p => p.id).join(',')})&select=project_id,finished_at,summary&limit=5000`) : [];
  send(res, 200, ps.map(p => { const mine = at.filter(a => a.project_id === p.id), fin = mine.filter(a => a.summary); return { ...p, started: mine.length, finished: fin.length, avg: fin.length ? Math.round(fin.reduce((n, a) => n + (a.summary.pct || 0), 0) / fin.length) : null }; }));
});
on('GET', '/api/formats', async (req, res) => send(res, 200, FORMATS));
on('POST', '/api/projects/:id/cancel', async (req, res, { id }) => { await setStatus(id, 'archived'); send(res, 200, { ok: true }); });
on('POST', '/api/projects/:id/reopen', async (req, res, { id }) => { if (!await guard(res, id, ['delivered'], false)) return; await setStatus(id, 'visuals_review'); send(res, 200, { ok: true }); });
on('POST', '/api/projects/:id/retry', async (req, res, { id }) => {
  if (!await guard(res, id, ['failed'])) return;
  const p = await db.one('projects', `id=eq.${q(id)}`); const stage = (p.error || '').split('|')[0];
  let args = [];
  if (stage === 'render') { const lj = await db.one('render_jobs', `project_id=eq.${q(id)}&order=created_at.desc&select=format`); if (lj && lj.format) args = [lj.format]; }
  background(id, STEPS[stage] ? stage : 'content', args); send(res, 202, { ok: true });
});

/* Claude üretim işçisi (generate.yml) uç noktaları — görev jetonuyla korunur */
async function taskAuth(req, taskId) {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const t = await db.one('gen_tasks', `id=eq.${q(taskId)}`);
  if (!t || !token || !safeEq(token, t.token) || ['done', 'failed'].includes(t.status)) return null;
  return t;
}
on('GET', '/api/task/:taskId', async (req, res, { taskId }) => {
  const t = await taskAuth(req, taskId); if (!t) return send(res, 403, { error: 'Geçersiz görev' });
  await db.update('gen_tasks', `id=eq.${q(taskId)}`, { status: 'running' });
  if (t.kind === 'audit') return send(res, 200, { items: t.items, model: t.model, system: audit.AUDIT_SYSTEM, bundle: await bundleFor(t.project_id, false, 'dikey', t.meta && t.meta.version_id) });
  send(res, 200, { items: t.items, model: t.model });
}, true);
on('POST', '/api/task/:taskId/progress', async (req, res, { taskId }) => {
  const t = await taskAuth(req, taskId); if (!t) return send(res, 403, { error: 'Geçersiz görev' });
  const b = await readBody(req);
  await db.update('gen_tasks', `id=eq.${q(taskId)}`, { progress: { done: +b.done || 0, total: +b.total || 0 } });
  send(res, 200, { ok: true });
}, true);
on('POST', '/api/task/:taskId/upload-url', async (req, res, { taskId }) => {
  const t = await taskAuth(req, taskId); if (!t) return send(res, 403, { error: 'Geçersiz görev' });
  const { name } = await readBody(req);
  const p = `audit/${t.project_id}/${(t.meta && t.meta.version_id) || 'x'}/${String(name || 'img.jpg').replace(/[^\w.-]/g, '_')}`;
  send(res, 200, { url: await storage.signedUploadUrl(p), path: p });
}, true);
on('POST', '/api/task/:taskId/result', async (req, res, { taskId }) => {
  const t = await taskAuth(req, taskId); if (!t) return send(res, 403, { error: 'Geçersiz görev' });
  const b = await readBody(req, 20e6);
  if (t.kind === 'audit') await saveAudit(t, b);
  if (b.error) await db.update('gen_tasks', `id=eq.${q(taskId)}`, { status: 'failed', error: String(b.error).slice(0, 900), finished_at: now() });
  else await db.update('gen_tasks', `id=eq.${q(taskId)}`, { status: 'done', results: b.results, finished_at: now() });
  send(res, 200, { ok: true });
}, true);

async function saveAudit(t, b) {
  const vid = t.meta && t.meta.version_id; if (!vid) return;
  const v = await db.one('versions', `id=eq.${q(vid)}&select=id,audit`); if (!v) return;
  const a = v.audit || { scenes: {} }; a.scenes = a.scenes || {};
  if (b.error) { a.status = 'failed'; a.error = String(b.error).slice(0, 500); }
  else {
    for (const r of b.results || []) {
      if (!r || !r.k) continue;
      let rep = null; try { rep = audit.normalize(r.text ? claude.extractJson(r.text) : null); } catch { }
      a.scenes[r.k] = rep ? { ...rep, sheet: r.sheet || null } : { severity: 'bilinmiyor', summary: 'Bu sahne denetlenemedi' + (r.error ? ': ' + String(r.error).slice(0, 120) : ''), issues: [], fix_note: '', sheet: r.sheet || null };
    }
    a.status = 'done'; a.finished_at = now();
  }
  await db.update('versions', `id=eq.${v.id}`, { audit: a });
  await db.update('gen_tasks', `id=eq.${q(t.id)}`, { consumed: true });
}

/* render işçisi (GitHub Actions) uç noktaları — iş jetonuyla korunur */
async function jobAuth(req, jobId) {
  const token = new URL(req.url, 'http://x').searchParams.get('token') || req.headers['x-job-token'];
  const job = await db.one('render_jobs', `id=eq.${q(jobId)}`);
  if (!job || !token || !safeEq(token, job.token) || ['done', 'failed'].includes(job.status)) return null;
  return job;
}
on('GET', '/api/render/:jobId/bundle', async (req, res, { jobId }) => {
  const job = await jobAuth(req, jobId); if (!job) return send(res, 403, { error: 'Geçersiz iş' });
  await db.update('render_jobs', `id=eq.${q(jobId)}`, { status: 'running', started_at: now() });
  send(res, 200, await bundleFor(job.project_id, true, job.format));
}, true);
on('POST', '/api/render/:jobId/upload-url', async (req, res, { jobId }) => {
  const job = await jobAuth(req, jobId); if (!job) return send(res, 403, { error: 'Geçersiz iş' });
  const p = `videos/${job.project_id}/${job.id}.mp4`;
  send(res, 200, { url: await storage.signedUploadUrl(p), path: p });
}, true);
on('POST', '/api/render/:jobId/status', async (req, res, { jobId }) => {
  const job = await jobAuth(req, jobId); if (!job) return send(res, 403, { error: 'Geçersiz iş' });
  const b = await readBody(req);
  if (b.status === 'done') {
    await db.update('render_jobs', `id=eq.${q(jobId)}`, { status: 'done', progress: 100, output_path: b.path, finished_at: now() });
    await setStatus(job.project_id, 'delivered');
  } else if (b.status === 'failed') {
    await db.update('render_jobs', `id=eq.${q(jobId)}`, { status: 'failed', error: String(b.error || '').slice(0, 900), finished_at: now() });
    await setStatus(job.project_id, 'failed', { error: 'render|' + String(b.error || 'Render başarısız').slice(0, 800) });
  } else await db.update('render_jobs', `id=eq.${q(jobId)}`, { progress: Math.max(0, Math.min(99, +b.progress || 0)) });
  send(res, 200, { ok: true });
}, true);

/* ---------- sunucu ---------- */
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        if (!r.open && !authed(req)) return send(res, 401, { error: 'Giriş gerekli' });
        return await r.handler(req, res, m.groups || {});
      }
      return send(res, 404, { error: 'Yok' });
    }
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (/^\/izle\/[\w-]+\/?$/.test(url.pathname)) file = path.join(PUBLIC, 'izle.html');
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: e.message }); }
}).listen(PORT, () => { console.log('Sunucu hazır: ' + PORT); resumePending().catch(e => console.error('resume', e)); resumeQuiz().catch(e => console.error('resumeQuiz', e)); });
