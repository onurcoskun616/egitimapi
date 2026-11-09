// Sinematik film kurgu işçisi (GitHub Actions, sinema.yml): klipleri indirir, ekran yazılarını ekler, geçişlerle birleştirir,
// anlatım ve müziği (anlatım sırasında müzik kısılarak) karıştırır, MP4'ü imzalı adrese yükler.
// İş, gen_tasks tablosunda kind='sinema_edit' görevidir; manifest görevin ilk öğesidir.
// Yerel deneme: LOCAL_MANIFEST=manifest.json OUT=cikti.mp4 node render/sinema.mjs
import { spawnSync } from 'node:child_process';
import { writeFile, readFile, mkdtemp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { TASK_ID, API_BASE, TASK_TOKEN, LOCAL_MANIFEST, OUT } = process.env;
const api = p => `${(API_BASE || '').replace(/\/$/, '')}/api/task/${TASK_ID}${p}?token=${TASK_TOKEN}`;
const SIZES = { '1:1': [1080, 1080], '16:9': [1920, 1080], '9:16': [1080, 1920] };
const FONTS = {
  serif: ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'],
  sans: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
  mono: ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf'],
};

function log(text) { console.log(text); }
function step(done, total) { if (!LOCAL_MANIFEST) fetch(api('/progress'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done, total }) }).catch(() => {}); }
function ff(args, what) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${what}: ${(r.stderr || '').slice(-800)}`);
}
function probeSec(f) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8' });
  return +r.stdout.trim() || 0;
}
async function fetchTo(src, dest) {
  if (!/^https?:/.test(src)) return src; // yerel dosya
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(src);
      if (r.ok) { await writeFile(dest, Buffer.from(await r.arrayBuffer())); return dest; }
    } catch (e) { console.log('İndirme tekrar denenecek:', e.message); }
    await new Promise(ok => setTimeout(ok, 1500 * (i + 1)));
  }
  throw new Error('İndirilemedi: ' + src);
}
const esc = s => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%').replace(/,/g, '\\,');

async function main() {
  const m = LOCAL_MANIFEST ? JSON.parse(await readFile(LOCAL_MANIFEST, 'utf8')) : await (async () => {
    const r = await fetch(api('')); if (!r.ok) throw new Error('Görev alınamadı: ' + r.status); const j = await r.json(); return j.items[0];
  })();
  const [W, H] = SIZES[m.aspect] || SIZES['1:1'];
  const fps = m.fps || 24, xf = Math.max(0, +m.crossfade || 0);
  const font = (FONTS[m.font] || FONTS.serif).find(f => existsSync(f)) || '';
  const dir = await mkdtemp(path.join(tmpdir(), 'kurgu-'));
  const n = m.scenes.length;
  log(`${n} sahne, ${W}x${H}, geçiş ${xf} sn`);

  // 1) Her sahneyi normalleştir: boyut, fps, süre (anlatım klipten uzunsa son kareyi beklet), ekran yazısı
  const parts = [];
  for (let i = 0; i < n; i++) {
    const s = m.scenes[i];
    const src = await fetchTo(s.video, path.join(dir, `in${i}.mp4`));
    const clip = probeSec(src) || s.video_sec || 5;
    const want = Math.max(Math.min(clip, s.video_sec || clip), (s.voice_sec || 0) + 0.6) + (i < n - 1 ? 0 : 0.5);
    const D = +Math.max(1.5, want).toFixed(3);
    const extra = Math.max(0, D - clip);
    let vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1`;
    if (extra > 0.02) vf += `,tpad=stop_mode=clone:stop_duration=${extra.toFixed(3)}`;
    vf += `,trim=duration=${D},setpts=PTS-STARTPTS`;
    if (s.overlay && s.overlay.trim() && font) {
      const lines = s.overlay.replace(/\\n/g, '\n').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 4);
      const fs1 = Math.round(H / (i === 0 ? 17 : 22)), fsN = Math.round(H / 30);
      // Uzun satırlar ekrana sığsın: yaklaşık karakter genişliği ≈ 0,56 × yazı boyu
      const sizes = lines.map((ln, k) => Math.min(k === 0 ? fs1 : fsN, Math.floor(W * 0.9 / (Math.max(1, ln.length) * 0.56))));
      const gap = Math.round(H / 90);
      const block = sizes.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
      const y0 = i === 0 || i === n - 1 ? Math.round(H / 2 - block / 2) : Math.round(H * 0.80 - block);
      const t1 = 0.4, t2 = Math.max(t1 + 1.2, D - 0.5);
      const alpha = `if(lt(t\\,${t1})\\,0\\,if(lt(t\\,${t1 + 0.6})\\,(t-${t1})/0.6\\,if(lt(t\\,${t2 - 0.6})\\,1\\,if(lt(t\\,${t2})\\,(${t2}-t)/0.6\\,0))))`;
      let y = y0;
      for (let k = 0; k < lines.length; k++) {
        const tf = path.join(dir, `t${i}_${k}.txt`);
        await writeFile(tf, lines[k]);
        vf += `,drawtext=fontfile='${font}':textfile='${tf}':fontsize=${sizes[k]}:expansion=none:fontcolor=white:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.7:shadowx=2:shadowy=2:alpha='${alpha}'`;
        y += sizes[k] + gap;
      }
    }
    const out = path.join(dir, `p${i}.mp4`);
    ff(['-i', src, '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', out], `Sahne ${s.n}`);
    parts.push({ file: out, D: probeSec(out) || D, voice: s.voice, voice_sec: s.voice_sec });
    log(`Sahne ${i + 1}/${n} hazır (${D.toFixed(1)} sn)`); step(i + 1, n);
  }

  // 2) Başlangıç zamanları ve toplam süre
  let t = 0; const starts = [];
  parts.forEach((p, i) => { starts.push(t); t += p.D - (i < n - 1 ? xf : 0); });
  const total = +t.toFixed(3);

  // 3) Görüntü: geçişlerle birleştir
  const vidOnly = path.join(dir, 'video.mp4');
  if (xf > 0 && n > 1) {
    const inputs = parts.flatMap(p => ['-i', p.file]);
    let fc = '', last = '[0:v]', acc = parts[0].D;
    for (let i = 1; i < n; i++) {
      const off = (acc - xf).toFixed(3); const lab = i === n - 1 ? '[v]' : `[x${i}]`;
      fc += `${last}[${i}:v]xfade=transition=fade:duration=${xf}:offset=${off}${lab};`;
      last = lab; acc = acc - xf + parts[i].D;
    }
    if (n === 1) fc = '[0:v]null[v];';
    ff([...inputs, '-filter_complex', fc.replace(/;$/, ''), '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', vidOnly], 'Geçişler');
  } else {
    const list = path.join(dir, 'list.txt');
    await writeFile(list, parts.map(p => `file '${p.file}'`).join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', vidOnly], 'Birleştirme');
  }
  log('Görüntü birleştirildi, ses karıştırılıyor…');

  // 4) Ses: anlatımlar (sahne başlangıcına göre) + müzik (anlatımda kısılır)
  const ain = [], fl = []; let k = 1;
  const voices = [];
  for (let i = 0; i < n; i++) if (parts[i].voice) {
    const f = await fetchTo(parts[i].voice, path.join(dir, `v${i}.mp3`));
    ain.push('-i', f); const d = Math.round((starts[i] + 0.25) * 1000);
    fl.push(`[${k}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${d}|${d}[va${k}]`); voices.push(`[va${k}]`); k++;
  }
  let musicLab = null;
  if (m.music) {
    const f = await fetchTo(m.music, path.join(dir, 'music' + (path.extname(new URL(m.music, 'file:///').pathname) || '.mp3')));
    ain.push('-stream_loop', '-1', '-i', f);
    const fo = Math.max(0, total - 3).toFixed(2);
    fl.push(`[${k}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total},asetpts=PTS-STARTPTS,volume=${m.music_volume || 0.8},afade=t=in:d=1.2,afade=t=out:st=${fo}:d=3[mus]`);
    musicLab = '[mus]'; k++;
  }
  const final = OUT || path.join(dir, 'final.mp4');
  const kbps = Math.round(Math.max(1500, Math.min(6000, (180 * 8 * 1024) / total * 0.92 - 192))); // ≤ ~180 MB
  const vargs = ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.4) + 'k', '-bufsize', kbps * 2 + 'k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  if (!voices.length && !musicLab) {
    ff(['-i', vidOnly, ...vargs, '-an', final], 'Son kodlama');
  } else {
    let mix;
    if (voices.length) {
      fl.push(`${voices.join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total}[vo]`);
      if (musicLab) {
        fl.push(`[vo]asplit=2[vo1][vo2]`);
        fl.push(`${musicLab}[vo1]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[duck]`);
        fl.push(`[duck][vo2]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]`);
      } else fl.push(`[vo]alimiter=limit=0.95[a]`);
      mix = '[a]';
    } else { fl.push(`${musicLab}anull[a]`); mix = '[a]'; }
    ff(['-i', vidOnly, ...ain, '-filter_complex', fl.join(';'), '-map', '0:v', '-map', mix, ...vargs, '-c:a', 'aac', '-b:a', '160k', '-t', String(total), final], 'Ses karışımı');
  }
  const size = (await stat(final)).size;
  log(`Video hazır: ${total.toFixed(1)} sn, ${(size / 1048576).toFixed(1)} MB. Yükleniyor…`);
  if (LOCAL_MANIFEST) return console.log('Yerel çıktı:', final);
  const up = await fetch(m.upload.url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: await readFile(final) });
  if (!up.ok) throw new Error('Yükleme başarısız: ' + up.status + ' ' + (await up.text()).slice(0, 200));
  const done = await fetch(api('/result'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [{ path: m.upload.path, sec: +total.toFixed(1), mb: +(size / 1048576).toFixed(1) }] }) });
  if (!done.ok) throw new Error('Sonuç bildirilemedi: ' + done.status);
  console.log('Yüklendi.');
}

main().catch(async e => {
  console.error(e);
  if (!LOCAL_MANIFEST) { try { await fetch(api('/result'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message.slice(0, 1500) }) }); } catch { } }
  process.exit(1);
});
