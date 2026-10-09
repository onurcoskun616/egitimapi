// Eğitim videosu üretim platformu — bağımlılıksız Node sunucusu
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, storage, q } = require('./lib/supa');
const claude = require('./lib/claude');
const { TONES, voiceForTone } = require('./lib/tones');
const eleven = require('./lib/eleven');
const auth = require('./lib/auth');
const { pagesFor, sourcesBlock } = require('./lib/sources');
const quiz = require('./lib/quiz');
const pub = require('./lib/publish');
const audit = require('./lib/audit');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
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
// İlk yönetici: kullanıcı adı "yonetici", şifre APP_PASSWORD (girişten sonra değiştirilmeli)
async function seedAdmin() {
  if (await db.one('users', 'role=eq.admin&select=id')) return;
  if (!process.env.APP_PASSWORD) return console.log('Yönetici oluşturulamadı: APP_PASSWORD yok');
  await db.insert('users', { email: 'yonetici', name: 'Yönetici', role: 'admin', status: 'active', slug: 'yonetici', pass_hash: auth.hashPassword(process.env.APP_PASSWORD) });
  console.log('Yönetici hesabı oluşturuldu: yonetici');
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
/* ---------- yayına hazırlık ---------- */
async function timelineFor(id) {
  const vis = await latest(id, 'visuals'); if (!vis) return null;
  const a = await db.one('audio_tracks', `project_id=eq.${q(id)}&order=created_at.desc&select=alignment`);
  return pub.timeline(vis.data.scenes, a && a.alignment && a.alignment.timings);
}
const PUB_RUNNING = new Set();
function runPublishBg(id, feedback) {
  if (PUB_RUNNING.has(id)) return; PUB_RUNNING.add(id);
  (async () => {
    const p = await db.one('projects', `id=eq.${q(id)}`);
    await db.update('projects', `id=eq.${q(id)}`, { publish_status: 'generating', publish_error: null });
    const vis = await latest(id, 'visuals'); const tl = await timelineFor(id); const qv = await latest(id, 'quiz');
    let user = pub.publishPrompt(p, vis.data.scenes, qv && qv.data.kazanimlar, pub.chapters(tl));
    if (feedback && p.publish_meta) user += `\nÖnceki metinler:\n${JSON.stringify(p.publish_meta)}\nDüzeltme isteği: ${feedback}\nİsteği uygula, tam JSON'u yeniden ver.`;
    const [r] = await claude.complete([{ system: pub.PUBLISH_SYSTEM, user, max: 4000 }], ctxFor(id, 'publish'));
    if (!r || r.error) throw new Error((r && r.error) || 'yanıt yok');
    const m = claude.extractJson(r.text); const arr = v => (Array.isArray(v) ? v : []).map(x => String(x).slice(0, 60)).slice(0, 20);
    const meta = { youtube_title: String(m.youtube_title || p.title).slice(0, 100), youtube_description: String(m.youtube_description || '').slice(0, 3000), tags: arr(m.tags), hashtags: arr(m.hashtags).map(h => h.startsWith('#') ? h : '#' + h), social_caption: String(m.social_caption || '').slice(0, 1500), cover_title: String(m.cover_title || p.title).slice(0, 40), cover_sub: String(m.cover_sub || '').slice(0, 50) };
    await db.update('projects', `id=eq.${q(id)}`, { publish_status: 'ready', publish_meta: meta });
  })().catch(async e => { console.error('publish', e); await db.update('projects', `id=eq.${q(id)}`, { publish_status: 'failed', publish_error: e.message.slice(0, 600) }).catch(() => {}); }).finally(() => PUB_RUNNING.delete(id));
}

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
// erişim: 'public' | 'user' | 'student' | 'teacher' (öğretmen ya da yönetici) | 'admin'; true → public, varsayılan teacher
const on = (method, pattern, handler, access = 'teacher') => routes.push({ method, re: new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, access: access === true ? 'public' : access });
const cookie = (token, maxAge) => `sid=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${publicBase().startsWith('https') ? '; Secure' : ''}`;
const isAdmin = u => u && u.role === 'admin';
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
async function activeLimits(user) {
  if (isAdmin(user)) return { plan: 'yönetici', limits: { videos_per_month: 1e6, max_seconds: 300, students: 1e6, sell_courses: true } };
  const sub = await db.one('subscriptions', `user_id=eq.${q(user.id)}&status=in.(active,trialing)&order=created_at.desc&select=id,status,current_period_end,plan_id`);
  if (!sub || (sub.current_period_end && new Date(sub.current_period_end) < new Date())) return null;
  const plan = await db.one('plans', `id=eq.${q(sub.plan_id)}`); return plan ? { plan: plan.name, code: plan.code, limits: plan.limits, until: sub.current_period_end } : null;
}
async function monthUsage(userId) {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const rows = await db.select('projects', `owner_id=eq.${q(userId)}&created_at=gte.${start.toISOString()}&select=id`); return rows.length;
}

require('./lib/market')({ on, db, q, send, readBody, isAdmin, activeLimits, auth, shortId: () => shortId(), now });
/* ---------- hesaplar ---------- */
on('POST', '/api/auth/register', async (req, res) => {
  const b = await readBody(req, 8000); const ip = ipOf(req); if (auth.tooMany(ip)) return send(res, 429, { error: 'Çok fazla deneme, biraz sonra tekrar deneyin' });
  const role = b.role === 'teacher' ? 'teacher' : 'student';
  const email = String(b.email || '').trim().toLocaleLowerCase('tr'), name = String(b.name || '').trim().slice(0, 80), pw = String(b.password || '');
  if (!auth.validEmail(email) || email === 'yonetici') return send(res, 400, { error: 'Geçerli bir e-posta adresi yazın' });
  if (name.length < 3) return send(res, 400, { error: 'Adınızı ve soyadınızı yazın' });
  if (pw.length < 8) return send(res, 400, { error: 'Şifre en az 8 karakter olmalı' });
  if (await db.one('users', `email=eq.${q(email)}&select=id`)) { auth.failed(ip); return send(res, 409, { error: 'Bu e-posta ile zaten bir hesap var. Giriş yapın.' }); }
  const row = { email, name, role, pass_hash: auth.hashPassword(pw), status: role === 'teacher' ? 'pending' : 'active', school: String(b.school || '').slice(0, 120) || null, subject: String(b.subject || '').slice(0, 80) || null };
  if (role === 'teacher') { row.slug = await auth.uniqueSlug(name); row.bio = String(b.bio || '').slice(0, 1000) || null; }
  const u = await db.insert('users', row);
  const token = await auth.createSession(u.id);
  send(res, 201, { user: { id: u.id, name: u.name, role: u.role, status: u.status } }, { 'Set-Cookie': cookie(token, auth.SESSION_DAYS * 86400) });
}, 'public');
on('POST', '/api/auth/login', async (req, res) => {
  const b = await readBody(req, 4000); const ip = ipOf(req); if (auth.tooMany(ip)) return send(res, 429, { error: 'Çok fazla deneme, 10 dakika sonra tekrar deneyin' });
  const email = String(b.email || '').trim().toLocaleLowerCase('tr');
  const u = await db.one('users', `email=eq.${q(email)}&select=id,pass_hash,status,role,name`);
  if (!u || !auth.verifyPassword(b.password || '', u.pass_hash)) { auth.failed(ip); return send(res, 401, { error: 'E-posta ya da şifre hatalı' }); }
  if (u.status === 'rejected') return send(res, 403, { error: 'Öğretmen başvurunuz onaylanmadı' });
  if (u.status === 'suspended') return send(res, 403, { error: 'Hesabınız askıya alınmış' });
  const token = await auth.createSession(u.id); db.update('users', `id=eq.${q(u.id)}`, { last_login: now() }).catch(() => {});
  send(res, 200, { user: { id: u.id, name: u.name, role: u.role, status: u.status } }, { 'Set-Cookie': cookie(token, auth.SESSION_DAYS * 86400) });
}, 'public');
on('POST', '/api/auth/logout', async (req, res) => { await auth.destroySession(auth.tokenOf(req)); send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); }, 'public');
on('GET', '/api/me', async (req, res) => {
  const u = req.user; if (!u) return send(res, 200, { user: null, ok: false });
  const out = { user: u, ok: (u.role === 'teacher' && u.status === 'active') || isAdmin(u) };
  if (out.ok) {
    out.plan = await activeLimits(u); out.used = await monthUsage(u.id);
    const cs = await db.select('courses', `teacher_id=eq.${q(u.id)}&select=id`);
    out.pending = cs.length ? await db.count('enrollments', `course_id=in.(${cs.map(c => c.id).join(',')})&status=eq.pending&source=neq.purchase`) : 0;
  }
  send(res, 200, out);
}, 'public');
on('POST', '/api/me/profile', async (req, res) => {
  const b = await readBody(req, 8000); const u = req.user; const patch = {};
  if (b.name && String(b.name).trim().length >= 3) patch.name = String(b.name).trim().slice(0, 80);
  for (const k of ['school', 'subject', 'bio']) if (k in b) patch[k] = String(b[k] || '').slice(0, k === 'bio' ? 1000 : 120) || null;
  if (u.role !== 'student' && b.slug) patch.slug = await auth.uniqueSlug(b.slug, u.id);
  if (b.new_password) { if (String(b.new_password).length < 8) return send(res, 400, { error: 'Yeni şifre en az 8 karakter olmalı' }); const full = await db.one('users', `id=eq.${q(u.id)}&select=pass_hash`); if (!auth.verifyPassword(b.password || '', full.pass_hash)) return send(res, 400, { error: 'Mevcut şifre hatalı' }); patch.pass_hash = auth.hashPassword(b.new_password); }
  if (!Object.keys(patch).length) return send(res, 400, { error: 'Değişiklik yok' });
  const r = await db.update('users', `id=eq.${q(u.id)}`, patch); auth.forgetUser(u.id);
  send(res, 200, { user: { id: r.id, name: r.name, slug: r.slug } });
}, 'user');
on('GET', '/api/tones', async (req, res) => send(res, 200, Object.entries(TONES).map(([k, [label, desc]]) => ({ k, label, desc }))));

on('GET', '/api/projects', async (req, res) => {
  const own = isAdmin(req.user) ? '' : `&owner_id=eq.${q(req.user.id)}`;
  send(res, 200, await db.select('projects', `select=id,title,status,updated_at,target_seconds,owner_id&status=neq.archived${own}&order=updated_at.desc`));
});
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
  const lim = await activeLimits(req.user);
  if (!lim) return send(res, 402, { error: 'Video üretmek için etkin bir paketiniz yok. Paketim sayfasından paket seçin.' });
  if (await monthUsage(req.user.id) >= (lim.limits.videos_per_month || 0)) return send(res, 402, { error: `Bu ayki video hakkınız doldu (${lim.limits.videos_per_month} video). Paketinizi yükseltebilirsiniz.` });
  if ((+b.target_seconds || 90) > (lim.limits.max_seconds || 300)) return send(res, 402, { error: `Paketiniz en fazla ${lim.limits.max_seconds} saniyelik videoya izin veriyor.` });
  const p = await db.insert('projects', { owner_id: req.user.id, title: String(b.title).slice(0, 120), brief: String(b.brief).slice(0, 4000), audience: b.audience || null, target_seconds: Math.min(300, Math.max(30, +b.target_seconds || 90)), voice_id: b.voice_id || null, tone, format: FORMATS[b.format] ? b.format : 'dikey', status: 'content_generating' });
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
// Ders erişimi: (1) kodla açık yayın, (2) sahibi/yönetici, (3) onaylı kaydı olan öğrenci
async function enrolledCourse(userId, projectId) {
  const items = await db.select('course_items', `project_id=eq.${q(projectId)}&select=course_id`); if (!items.length) return null;
  const ids = items.map(i => i.course_id).join(',');
  const e = await db.select('enrollments', `student_id=eq.${q(userId)}&course_id=in.(${ids})&status=eq.approved&select=course_id,expires_at`);
  const ok = e.find(x => !x.expires_at || new Date(x.expires_at) > new Date()); if (!ok) return null;
  return db.one('courses', `id=eq.${q(ok.course_id)}&status=eq.published&select=id,title`);
}
async function lessonBy(sid, user) {
  sid = String(sid || '').trim(); if (!sid || sid.length > 20) return null;
  const sel = 'select=id,title,format,status,share_id,quiz_published,owner_id';
  let p = await db.one('projects', `share_id=eq.${q(sid)}&${sel}`);
  if (!p && sid !== sid.toUpperCase()) p = await db.one('projects', `share_id=eq.${q(sid.toUpperCase())}&${sel}`);
  if (!p) return null;
  let via = null;
  if (user && (isAdmin(user) || p.owner_id === user.id)) via = 'owner';
  else if (user && await enrolledCourse(user.id, p.id)) via = 'course';
  else if (p.quiz_published) via = 'code';
  if (!via) return { denied: true, p };
  const v = await latest(p.id, 'quiz');
  if (via === 'code' && !v) return { denied: true, p };
  return { p, v, via };
}
async function deniedInfo(p) {
  const items = await db.select('course_items', `project_id=eq.${q(p.id)}&select=course_id`);
  const courses = items.length ? await db.select('courses', `id=in.(${items.map(i => i.course_id).join(',')})&status=eq.published&select=id,title`) : [];
  return { error: 'Bu derse erişim izniniz yok. Eğitime katılım talebi gönderin.', courses, title: p.title };
}
on('GET', '/api/l/:sid/check', async (req, res, { sid }) => {
  const L = await lessonBy(sid, req.user); if (!L) return send(res, 404, { error: 'Ders bulunamadı ya da yayında değil' });
  if (L.denied) return send(res, req.user ? 403 : 401, await deniedInfo(L.p));
  send(res, 200, { code: L.p.share_id, title: L.p.title });
}, true);
on('GET', '/api/l/:sid', async (req, res, { sid }) => {
  const L = await lessonBy(sid, req.user); if (!L) return send(res, 404, { error: 'Ders bulunamadı ya da yayında değil' });
  if (L.denied) return send(res, req.user ? 403 : 401, await deniedInfo(L.p));
  const { p, v } = L;
  const at = await db.one('audio_tracks', `project_id=eq.${q(p.id)}&order=created_at.desc&select=created_at`);
  const done = await db.select('render_jobs', `project_id=eq.${q(p.id)}&status=eq.done&order=created_at.desc&select=format,output_path,created_at`);
  const videos = {}; for (const j of done) { const f = j.format || 'dikey'; if (videos[f] || !j.output_path || (at && new Date(j.created_at) < new Date(at.created_at))) continue; videos[f] = await storage.signedUrl(j.output_path, 6 * 3600); }
  if (!Object.keys(videos).length) return send(res, 404, { error: 'Dersin videosu henüz hazır değil' });
  const bundle = await bundleFor(p.id, true, p.format || 'dikey'); delete bundle.audioUrl;
  send(res, 200, { title: p.title, format: p.format || 'dikey', videos, bundle, quiz: v ? quiz.publicQuiz(v.data, v.version * 7919 + 13) : null, version: v ? v.version : null, me: req.user ? { name: req.user.name, role: req.user.role } : null });
}, true);
async function attemptAuth(sid, b, user) {
  const L = await lessonBy(sid, user); if (!L || L.denied || !L.v) return null;
  const a = await db.one('lesson_attempts', `id=eq.${q(b.attempt)}&project_id=eq.${q(L.p.id)}`);
  if (!a || !b.token || !safeEq(b.token, a.token)) return null;
  const v = a.quiz_version === L.v.version ? L.v : await db.one('versions', `project_id=eq.${q(L.p.id)}&stage=eq.quiz&version=eq.${a.quiz_version}`);
  return { ...L, a, v };
}
on('POST', '/api/l/:sid/start', async (req, res, { sid }) => {
  const b = await readBody(req, 4000); const L = await lessonBy(sid, req.user); if (!L || L.denied) return send(res, 404, { error: 'Ders bulunamadı' });
  if (!L.v) return send(res, 400, { error: 'Bu derste soru yok' });
  const name = req.user ? req.user.name : String(b.name || '').trim().slice(0, 80); if (name.length < 2) return send(res, 400, { error: 'Adınızı yazın' });
  const token = crypto.randomBytes(16).toString('hex');
  const a = await db.insert('lesson_attempts', { project_id: L.p.id, quiz_version: L.v.version, token, student_id: req.user ? req.user.id : null, student_name: name, student_class: String(b.cls || '').trim().slice(0, 40) || (req.user && req.user.school) || null });
  send(res, 200, { attempt: a.id, token });
}, true);
on('POST', '/api/l/:sid/answer', async (req, res, { sid }) => {
  const b = await readBody(req, 8000); const A = await attemptAuth(sid, b, req.user); if (!A) return send(res, 403, { error: 'Oturum geçersiz' });
  const x = A.v.data.checkpoints[+b.cp] && A.v.data.checkpoints[+b.cp].questions[+b.qi]; if (!x) return send(res, 400, { error: 'Soru yok' });
  const correct = quiz.check(x, b.response);
  if ((A.a.answers || []).length >= 400) return send(res, 429, { error: 'Çok fazla deneme' });
  await db.rpc('append_answer', { p_id: A.a.id, p_answer: { cp: +b.cp, qi: +b.qi, pass: +b.pass || 1, response: JSON.parse(JSON.stringify(b.response ?? null)), correct, at: now() } });
  send(res, 200, { correct, explain: x.explain, correct_text: quiz.correctText(x), answer: (x.type === 'mcq' || x.type === 'image') ? x.answer : undefined });
}, true);
on('POST', '/api/l/:sid/finish', async (req, res, { sid }) => {
  const b = await readBody(req, 4000); const A = await attemptAuth(sid, b, req.user); if (!A) return send(res, 403, { error: 'Oturum geçersiz' });
  const summary = quiz.summarize(A.v.data, A.a.answers);
  await db.update('lesson_attempts', `id=eq.${q(A.a.id)}`, { summary, finished_at: now() });
  send(res, 200, summary);
}, true);

on('GET', '/api/lessons', async (req, res) => {
  const ps = await db.select('projects', `select=id,title,share_id,quiz_status,quiz_published,updated_at&quiz_status=not.is.null&status=neq.archived${isAdmin(req.user) ? '' : `&owner_id=eq.${q(req.user.id)}`}&order=updated_at.desc`);
  const at = ps.length ? await db.select('lesson_attempts', `project_id=in.(${ps.map(p => p.id).join(',')})&select=project_id,finished_at,summary&limit=5000`) : [];
  send(res, 200, ps.map(p => { const mine = at.filter(a => a.project_id === p.id), fin = mine.filter(a => a.summary); return { ...p, started: mine.length, finished: fin.length, avg: fin.length ? Math.round(fin.reduce((n, a) => n + (a.summary.pct || 0), 0) / fin.length) : null }; }));
});
on('GET', '/api/projects/:id/subtitles.:ext', async (req, res, { id, ext }) => {
  if (!['srt', 'vtt'].includes(ext)) return send(res, 404, { error: 'Yok' });
  const tl = await timelineFor(id); if (!tl) return send(res, 404, { error: 'Görsel yok' });
  const p = await db.one('projects', `id=eq.${q(id)}&select=title`);
  const name = (p.title || 'altyazi').toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'altyazi';
  res.writeHead(200, { 'Content-Type': (ext === 'vtt' ? 'text/vtt' : 'application/x-subrip') + '; charset=utf-8', 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}.${ext}` });
  res.end((ext === 'srt' ? '\ufeff' : '') + (ext === 'vtt' ? pub.vtt(tl) : pub.srt(tl)));
});
on('GET', '/api/projects/:id/publish', async (req, res, { id }) => {
  const p = await db.one('projects', `id=eq.${q(id)}&select=id,title,status,share_id,quiz_published,publish_status,publish_meta,publish_error,format`); if (!p) return send(res, 404, { error: 'Bulunamadı' });
  const tl = await timelineFor(id); const chs = tl ? pub.chapters(tl) : [];
  const m = p.publish_meta; let full = null;
  if (m) {
    full = m.youtube_description.trim();
    if (chs.length >= 3) full += '\n\nBölümler:\n' + chs.map(c => `${c.label} ${c.name}`).join('\n');
    if (p.quiz_published && p.share_id) full += `\n\nEtkileşimli ders: ${publicBase()}/izle/${p.share_id} (ders kodu ${p.share_id})`;
    if (m.hashtags.length) full += '\n\n' + m.hashtags.join(' ');
  }
  send(res, 200, { project: p, chapters: chs, total: tl && tl.total, scenes: tl ? tl.scenes.map(s => ({ k: s.k, title: s.title, ch: s.ch })) : [], full_description: full, lessonUrl: p.quiz_published && p.share_id ? `${publicBase()}/izle/${p.share_id}` : null });
});
on('POST', '/api/projects/:id/publish/generate', async (req, res, { id }) => {
  const { feedback } = await readBody(req); if (PUB_RUNNING.has(id)) return send(res, 409, { error: 'Metinler zaten hazırlanıyor' });
  runPublishBg(id, feedback ? String(feedback).slice(0, 1000) : null); send(res, 202, { ok: true });
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
    db.one('projects', `id=eq.${q(job.project_id)}&select=publish_status`).then(pp => { if (pp && !pp.publish_status) runPublishBg(job.project_id, null); }).catch(() => {});
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
        req.user = await auth.userFromToken(auth.tokenOf(req));
        const u = req.user, A = r.access;
        if (A !== 'public') {
          if (!u) return send(res, 401, { error: 'Giriş gerekli' });
          if (A === 'admin' && !isAdmin(u)) return send(res, 403, { error: 'Yalnızca yönetici' });
          if (A === 'student' && u.role !== 'student') return send(res, 403, { error: 'Bu sayfa öğrenciler içindir' });
          if (A === 'teacher') {
            if (u.role === 'student') return send(res, 403, { error: 'Bu sayfa öğretmenler içindir' });
            if (u.role === 'teacher' && u.status !== 'active') return send(res, 403, { error: 'Öğretmen başvurunuz henüz onaylanmadı' });
            const pm = url.pathname.match(/^\/api\/projects\/([0-9a-f-]{36})(\/|$)/);
            if (pm && !isAdmin(u)) { const own = await db.one('projects', `id=eq.${q(pm[1])}&select=owner_id`); if (!own || own.owner_id !== u.id) return send(res, 404, { error: 'Bulunamadı' }); }
          }
        }
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
}).listen(PORT, () => { console.log('Sunucu hazır: ' + PORT); seedAdmin().catch(e => console.error('seedAdmin', e)); resumePending().catch(e => console.error('resume', e)); resumeQuiz().catch(e => console.error('resumeQuiz', e)); });
