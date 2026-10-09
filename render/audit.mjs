// Teknik denetim işçisi: sahneleri çizer, şerit görüntüleri depoya yükler,
// her sahneyi Claude'a (görüntüyü Read aracıyla açarak) denetletir, raporu uygulamaya gönderir.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { TASK_ID, API_BASE, TASK_TOKEN } = process.env;
const api = p => `${API_BASE.replace(/\/$/, '')}/api/task/${TASK_ID}${p}?token=${TASK_TOKEN}`;
const post = async (p, body) => { const r = await fetch(api(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + await r.text()); return r.json(); };
const work = path.join(process.cwd(), 'audit_work');

function runClaude(system, user, model, i) {
  return new Promise(async ok => {
    const sysFile = path.join(work, `sys-${i}.txt`); await writeFile(sysFile, system);
    const args = ['-p', '--output-format', 'json', '--system-prompt-file', sysFile, '--tools', 'Read', '--allowedTools', 'Read', '--max-turns', '4', '--no-session-persistence'];
    if (model) args.push('--model', model);
    const p = spawn('claude', args, { env: process.env, cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => {
      try { const j = JSON.parse(out); if (j.is_error || code !== 0) return ok({ error: String(j.result || err || 'kod ' + code).slice(0, 400) }); ok({ text: j.result, usage: j.usage ? { ...j.usage, cost_usd: j.total_cost_usd || 0 } : null }); }
      catch { ok({ error: ('çıktı okunamadı: ' + (err || out)).slice(0, 400) }); }
    });
    p.stdin.end(user);
  });
}

async function main() {
  await mkdir(work, { recursive: true });
  const r = await fetch(api('')); if (!r.ok) throw new Error('Görev alınamadı: ' + r.status + ' ' + await r.text());
  const { items, model, system, bundle } = await r.json();
  if (!bundle) throw new Error('Sahne verisi yok');
  delete bundle.audioUrl;
  console.log(`Denetlenecek sahne: ${items.length}`);

  // 1) Kareleri çiz → sahne başına şerit
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 560, height: 980 } });
  await page.goto(pathToFileURL(path.join(here, 'player.html')).href);
  await page.evaluate(b => window.setup(b), bundle);
  const scenes = await page.evaluate(() => window.P.scenes.map(s => ({ k: s.k, s: s.s, dur: s.dur })));
  const strips = {};
  for (const it of items) {
    const sc = scenes.find(x => x.k === it.k); if (!sc) continue;
    const files = [];
    for (const [j, f] of [0.35, 0.7, 0.97].entries()) {
      const data = await page.evaluate(t => window.frameAt(t), sc.s + sc.dur * f);
      const fn = path.join(work, `f${it.k}_${j}.jpg`); await writeFile(fn, Buffer.from(data.split(',')[1], 'base64')); files.push(fn);
    }
    const strip = path.join(work, `sahne_${it.k}.jpg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex', '[0][1][2]hstack=3,scale=1620:-1', '-q:v', '3', strip]);
    strips[it.k] = strip;
  }
  await browser.close();

  // 2) Şeritleri depoya yükle
  const sheet = {};
  for (const [k, f] of Object.entries(strips)) {
    try {
      const { url, path: p } = await post('/upload-url', { name: `sahne_${k}.jpg` });
      const up = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: await readFile(f) });
      if (up.ok) sheet[k] = p; else console.log('yükleme', k, up.status);
    } catch (e) { console.log('yükleme hatası', k, e.message); }
  }

  // 3) Claude ile denetim (4 paralel)
  const results = []; let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const i = next++, it = items[i];
      if (!strips[it.k]) { results[i] = { k: it.k, error: 'görüntü yok' }; continue; }
      const rel = path.relative(process.cwd(), strips[it.k]);
      const t0 = Date.now();
      const r = await runClaude(system, it.user.replace('{{IMAGE}}', rel), model, i);
      results[i] = { k: it.k, sheet: sheet[it.k] || null, ...r };
      console.log(`Sahne ${it.k}: ${r.error ? 'HATA ' + r.error : 'tamam'} (${Math.round((Date.now() - t0) / 1000)} sn)`);
      done++; post('/progress', { done, total: items.length }).catch(() => {});
    }
  }));
  await post('/result', { results });
  await rm(work, { recursive: true, force: true });
  console.log('Gönderildi.');
}

main().catch(async e => { console.error(e); try { await post('/result', { error: e.message }); } catch { } process.exit(1); });
