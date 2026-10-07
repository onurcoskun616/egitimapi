// Kalite kontrol: her sahneden 3 kare alıp sahne başına bir şerit görüntü üretir (qa/out/*.jpg)
import { chromium } from 'playwright';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const req = JSON.parse(await readFile(path.join(here, '..', 'qa', 'req.json'), 'utf8'));
const r = await fetch(`${req.api}/api/render/${req.job_id}/bundle?token=${req.token}`);
if (!r.ok) throw new Error('bundle ' + r.status + ' ' + await r.text());
const bundle = await r.json(); delete bundle.audioUrl;
const out = path.join(here, '..', 'qa', 'out'); await mkdir(out, { recursive: true });
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 560, height: 980 } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'warning') errs.push(m.text()); });
await page.goto(pathToFileURL(path.join(here, 'player.html')).href);
await page.evaluate(b => window.setup(b), bundle);
const scenes = await page.evaluate(() => window.P.scenes.map(s => ({ k: s.k, s: s.s, dur: s.dur })));
for (const sc of scenes) {
  const files = [];
  for (const [j, f] of [0.35, 0.7, 0.97].entries()) {
    const data = await page.evaluate(t => window.frameAt(t), sc.s + sc.dur * f);
    const fn = path.join(out, `s${sc.k}_${j}.jpg`); await writeFile(fn, Buffer.from(data.split(',')[1], 'base64')); files.push(fn);
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex', '[0][1][2]hstack=3,scale=1350:-1', '-q:v', '4', path.join(out, `scene_${String(sc.k).padStart(2, '0')}.jpg`)]);
  files.forEach(f => execFileSync('rm', [f]));
}
await writeFile(path.join(out, 'errors.txt'), errs.join('\n') || 'hata yok');
await browser.close();
