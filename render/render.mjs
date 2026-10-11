// GitHub Actions render işçisi: kareleri çizer, sesi ekler, MP4'ü Supabase'e yükler.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { JOB_ID, API_BASE, JOB_TOKEN } = process.env;
const FPS = +(process.env.FPS || 60);
const here = path.dirname(fileURLToPath(import.meta.url));
const api = (p) => `${API_BASE.replace(/\/$/, '')}/api/render/${JOB_ID}/${p}?token=${JOB_TOKEN}`;
async function post(p, body) { const r = await fetch(api(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); }

async function main() {
  const r = await fetch(api('bundle'));
  if (!r.ok) throw new Error('Paket alınamadı: ' + r.status + ' ' + await r.text());
  const bundle = await r.json();
  const audioFile = path.join(here, 'audio.mp3');
  let audioIn = audioFile;
  if (bundle.audioUrl) {
    const a = await fetch(bundle.audioUrl); if (!a.ok) throw new Error('Ses indirilemedi: ' + a.status); await writeFile(audioFile, Buffer.from(await a.arrayBuffer()));
    if (Array.isArray(bundle.audioCuts) && bundle.audioCuts.length) { audioIn = path.join(here, 'audio_paced.wav'); await pace(audioFile, bundle.audioCuts, audioIn); }
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 980 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here, 'player.html')).href);
  const total = await page.evaluate(b => window.setup(b), bundle);
  const n = Math.ceil(total * FPS);
  console.log(`Sahne: ${bundle.scenes.length}, süre: ${total.toFixed(2)} sn, kare: ${n}`);

  const out = path.join(here, 'out.mp4');
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (bundle.audioUrl) args.push('-i', audioIn, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-af', 'apad');
  // Supabase ücretsiz planında dosya sınırı 50 MB: uzun videolarda bit hızını süreye göre sınırla
  const vKbps = videoKbps(n / FPS);
  console.log(`Video bit hızı tavanı: ${vKbps} kbps`);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', vKbps + 'k', '-bufsize', vKbps * 2 + 'k', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-t', (n / FPS).toFixed(3), '-movflags', '+faststart', out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((ok, no) => ff.on('close', code => code === 0 ? ok() : no(new Error('ffmpeg çıkış kodu ' + code))));

  let lastPct = -1;
  for (let f = 0; f < n; f++) {
    const data = await page.evaluate(t => window.frameAt(t), f / FPS);
    const buf = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    if (!ff.stdin.write(buf)) await new Promise(ok => ff.stdin.once('drain', ok));
    const pct = Math.floor(f / n * 95);
    if (pct >= lastPct + 5) { lastPct = pct; post('status', { progress: pct }).catch(() => {}); console.log(`%${pct}`); }
  }
  ff.stdin.end(); await ffDone; await browser.close();
  if (errors.length) console.log('Sayfa uyarıları:', errors.slice(0, 5));

  let file = out, size = (await stat(out)).size;
  console.log(`Dosya: ${(size / 1048576).toFixed(1)} MB`);
  if (size > MAX_BYTES) {
    // Güvenlik ağı: hâlâ büyükse sabit bit hızıyla yeniden sıkıştır
    const kb = Math.floor(videoKbps(n / FPS) * MAX_BYTES / size * 0.92);
    file = path.join(here, 'out_small.mp4');
    console.log(`Yeniden sıkıştırılıyor: ${kb} kbps`);
    await new Promise((ok, no) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-c:v', 'libx264', '-preset', 'medium', '-b:v', kb + 'k', '-maxrate', kb + 'k', '-bufsize', kb * 2 + 'k', '-c:a', 'copy', '-movflags', '+faststart', file], { stdio: 'inherit' }).on('close', c => c === 0 ? ok() : no(new Error('ffmpeg yeniden sıkıştırma ' + c))));
    size = (await stat(file)).size; console.log(`Yeni boyut: ${(size / 1048576).toFixed(1)} MB`);
  }
  const { url, path: storePath } = await post('upload-url');
  const up = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: await readFile(file) });
  if (!up.ok) throw new Error('Yükleme başarısız: ' + up.status + ' ' + await up.text());
  await post('status', { status: 'done', path: storePath });
  console.log('Tamamlandı:', storePath);
}

// Cümle/sahne aralarına sessizlik ekler (anlatım temposu). Ses hızına dokunulmaz, kalite bozulmaz.
async function pace(input, cuts, output) {
  const fmt = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono';
  const parts = []; let prev = 0, f = '';
  cuts.forEach((c, i) => {
    f += `[0:a]atrim=start=${prev}:end=${c.at},asetpts=PTS-STARTPTS,${fmt}[s${i}];anullsrc=r=44100:cl=mono,atrim=duration=${c.gap},${fmt}[z${i}];`;
    parts.push(`[s${i}]`, `[z${i}]`); prev = c.at;
  });
  f += `[0:a]atrim=start=${prev},asetpts=PTS-STARTPTS,${fmt}[s${cuts.length}];`; parts.push(`[s${cuts.length}]`);
  f += `${parts.join('')}concat=n=${parts.length}:v=0:a=1[out]`;
  await new Promise((ok, no) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-filter_complex', f, '-map', '[out]', '-ar', '44100', output], { stdio: 'inherit' }).on('close', c => c === 0 ? ok() : no(new Error('ses temposu ffmpeg ' + c))));
  console.log(`Anlatım temposu: ${cuts.length} durak, +${cuts.reduce((s, c) => s + c.gap, 0).toFixed(1)} sn`);
}

const MAX_BYTES = 46 * 1048576;
function videoKbps(sec) { return Math.max(600, Math.min(8000, Math.floor(MAX_BYTES * 8 / 1000 / Math.max(sec, 1) - 140))); }

main().catch(async e => { console.error(e); try { await post('status', { status: 'failed', error: e.message }); } catch { } process.exit(1); });
