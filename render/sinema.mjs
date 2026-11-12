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
// Renk tonları ve film dokusu (ayarlar: Sinema → Ayarlar → Kurgu)
const GRADES = {
  sepya: ',hue=s=0.32,colorbalance=rs=.10:gs=.04:bs=-.10:rm=.07:gm=.02:bm=-.07,eq=contrast=1.05:gamma=0.97',
  soluk: ',eq=saturation=0.55:contrast=1.04',
  'siyah-beyaz': ',hue=s=0,eq=contrast=1.08',
};
const BOLD = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'];
const GRAINS = { hafif: ',noise=alls=7:allf=t,vignette=PI/5', belirgin: ',noise=alls=15:allf=t,vignette=PI/4' };
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
    // Siyah kart (görüntüsüz, yalnızca yazı): klip yerine siyah görüntü üretilir
    // Durağan kare (video klip yok): görsel, sahne boyunca yavaş kamera kaydırmasıyla gösterilir
    const src = s.card ? null : s.still ? await fetchTo(s.still, path.join(dir, `in${i}.jpg`)) : await fetchTo(s.video, path.join(dir, `in${i}.mp4`));
    const clip = s.card || s.still ? Math.max(1.5, s.video_sec || 4) : (probeSec(src) || s.video_sec || 5);
    const want = s.still ? Math.max(2, (s.voice_sec || 0) + 0.5, s.voice ? 0 : clip) + (i < n - 1 ? 0 : 0.5) : Math.max(Math.min(clip, s.video_sec || clip), (s.voice_sec || 0) + 0.6) + (i < n - 1 ? 0 : 0.5);
    // Ses kaydı modu: sahne süresi kayıttaki zamandan gelir (görüntü sese kilitlenir)
    const D = s.dur ? +(+s.dur).toFixed(3) : +Math.max(1.5, want).toFixed(3);
    const extra = s.still ? 0 : Math.max(0, D - clip);
    let vf;
    if (s.still) {
      // 1.18 kat büyütüp sahne boyunca kaydır; yön sahneden sahneye değişir (sola, sağa, yukarı, yakınlaşma)
      const k = 1.18, BW = Math.round(W * k / 2) * 2, BH = Math.round(H * k / 2) * 2, dx = BW - W, dy = BH - H, T = D.toFixed(3);
      const mv = [[`${dx}*t/${T}`, `${dy}/2`], [`${dx}*(1-t/${T})`, `${dy}/2`], [`${dx}/2`, `${dy}*(1-t/${T})`], [`${dx}/2`, `${dy}*t/${T}`]][i % 4];
      vf = `scale=${BW}:${BH}:force_original_aspect_ratio=increase,crop=${BW}:${BH},fps=${fps},setsar=1,crop=${W}:${H}:x='${mv[0]}':y='${mv[1]}'`;
    } else {
      vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1`;
      if (extra > 0.02) vf += `,tpad=stop_mode=clone:stop_duration=${extra.toFixed(3)}`;
    }
    vf += `,trim=duration=${D},setpts=PTS-STARTPTS`;
    // Renk tonu ve film dokusu (yazılardan önce; yazılar temiz kalsın)
    vf += GRADES[m.grade] || '';
    vf += GRAINS[m.grain] || '';
    if (s.overlay && s.overlay.trim() && font) {
      // Çizgi film / kelime altyazılı filmlerde başlıklar kalın yazıyla; ince serif zemin üstünde kayboluyordu
      const ovFont = (m.look || ['words', 'karaoke', 'chunks'].includes(m.sub_mode)) ? (BOLD.find(f => existsSync(f)) || font) : font;
      const lines = s.overlay.replace(/\\n/g, '\n').replace(/\s*\|\s*/g, '\n').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 4);
      const fs1 = Math.round(H / (i === 0 ? 17 : 22)), fsN = Math.round(H / 30);
      // Uzun satırlar ekrana sığsın: yaklaşık karakter genişliği ≈ 0,56 × yazı boyu
      const sizes = lines.map((ln, k) => Math.min(k === 0 ? fs1 : fsN, Math.floor(W * 0.9 / (Math.max(1, ln.length) * 0.56))));
      const gap = Math.round(H / 90);
      const block = sizes.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
      const y0 = i === 0 || i === n - 1 || s.card ? Math.round(H / 2 - block / 2) : Math.round(H * 0.80 - block);
      const t1 = 0.4, t2 = Math.max(t1 + 1.2, D - 0.5);
      const alpha = `if(lt(t\\,${t1})\\,0\\,if(lt(t\\,${t1 + 0.6})\\,(t-${t1})/0.6\\,if(lt(t\\,${t2 - 0.6})\\,1\\,if(lt(t\\,${t2})\\,(${t2}-t)/0.6\\,0))))`;
      let y = y0;
      for (let k = 0; k < lines.length; k++) {
        const tf = path.join(dir, `t${i}_${k}.txt`);
        await writeFile(tf, lines[k]);
        vf += `,drawtext=fontfile='${ovFont}':textfile='${tf}':fontsize=${sizes[k]}:expansion=none:fontcolor=white:x=(w-text_w)/2:y=${y}:borderw=${Math.max(2, Math.round(sizes[k] / 14))}:bordercolor=black@0.85:shadowcolor=black@0.6:shadowx=3:shadowy=3:alpha='${alpha}'`;
        y += sizes[k] + gap;
      }
    }
    // Karaoke altyazı: 3 kelimelik büyük harf gruplar, o an okunan kelime kırmızı (libass ile)
    let assFile = null;
    const spoken = s.voice || s.cap, off0 = s.cap ? 0 : 0.25, capEnd = x => s.cap ? Math.min(D - 0.05, s.cap_end || D) : Math.min(D - 0.05, x);
    if (m.subtitles && m.sub_mode === 'karaoke' && spoken && (s.chunks || []).length) {
      const ws = s.chunks, off = off0, groups = []; let g = [];
      ws.forEach((w, k) => { g.push(k); if (g.length >= 3 || /[.,;:!?…]$/.test(w.txt) || k === ws.length - 1) { groups.push(g); g = []; } });
      const tc = x => { const h = Math.floor(x / 3600), mm = Math.floor(x / 60) % 60, ss = (x % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(mm).padStart(2, '0')}:${ss}`; };
      const up = t => t.toLocaleUpperCase('tr').replace(/[{}\\]/g, '');
      const fs = Math.round(Math.min(W, H) / 14);
      let ev = '';
      groups.forEach((gr, gi) => gr.forEach((k, j) => {
        const a = off + ws[k].t, b = j + 1 < gr.length ? off + ws[gr[j + 1]].t : gi + 1 < groups.length ? off + ws[groups[gi + 1][0]].t : capEnd(off + (s.voice_sec || 2) + 0.4);
        const line = gr.map(x => x === k ? `{\\c&H2A2AE8&}${up(ws[x].txt)}{\\c&HFFFFFF&}` : up(ws[x].txt)).join(' ');
        ev += `Dialogue: 0,${tc(a)},${tc(Math.max(a + 0.05, b))},K,,0,0,0,,${line}\n`;
      }));
      assFile = path.join(dir, `k${i}.ass`);
      await writeFile(assFile, `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: K,DejaVu Sans Condensed,${fs},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(fs / 11))},2,2,${Math.round(W * 0.06)},${Math.round(W * 0.06)},${Math.round(H * 0.30)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ev}`);
      vf += `,ass='${assFile}'`;
    }
    // Kelime grubu altyazısı (Reels tarzı): sesle eş zamanlı 2–4 kelimelik parçalar, ortanın biraz altında, kalın ve konturlu
    const bold = BOLD.find(f => existsSync(f)) || font;
    if (assFile) {}
    else if (m.subtitles && (m.sub_mode === 'chunks' || m.sub_mode === 'words') && spoken && bold && (s.chunks || []).length) {
      const one = m.sub_mode === 'words', fsz = Math.round(Math.min(W, H) / (one ? 12 : 15)), off = off0, col = one ? '0xFFE14D' : 'white';
      for (let k = 0; k < s.chunks.length; k++) {
        const a = off + s.chunks[k].t, b = k + 1 < s.chunks.length ? off + s.chunks[k + 1].t : capEnd(off + (s.voice_sec || 2) + 0.4);
        const tf = path.join(dir, `c${i}_${k}.txt`); await writeFile(tf, s.chunks[k].txt);
        vf += `,drawtext=fontfile='${bold}':textfile='${tf}':fontsize=${fsz}:expansion=none:fontcolor=${col}:borderw=${Math.max(3, Math.round(fsz / 10))}:bordercolor=black@0.9:x=(w-text_w)/2:y=h*0.64:enable='between(t\\,${a.toFixed(2)}\\,${b.toFixed(2)})'`;
      }
    }
    // Konuşma altyazısı: sesin süresince alt kısımda, küçük ve sade
    else if (m.subtitles && s.text && s.text.trim() && spoken && font) {
      const fsz = Math.round(Math.min(W, H) / 26), maxc = Math.max(14, Math.floor(W * 0.84 / (fsz * 0.52)));
      const words = s.text.trim().split(/\s+/), lines = [''];
      for (const w of words) { const cur = lines[lines.length - 1]; if ((cur + ' ' + w).trim().length > maxc && cur) lines.push(w); else lines[lines.length - 1] = (cur + ' ' + w).trim(); }
      const ls = lines.slice(0, 3), gap = Math.round(fsz * 0.3), block = ls.length * fsz + (ls.length - 1) * gap;
      const a = off0, b = s.cap ? Math.min(D - 0.05, s.cap_end || D) : Math.min(D - 0.1, a + (s.voice_sec || 2) + 0.35);
      let y = Math.round(H * 0.93 - block);
      for (let k = 0; k < ls.length; k++) {
        const tf = path.join(dir, `s${i}_${k}.txt`); await writeFile(tf, ls[k]);
        vf += `,drawtext=fontfile='${font}':textfile='${tf}':fontsize=${fsz}:expansion=none:fontcolor=white@0.95:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.85:shadowx=2:shadowy=2:enable='between(t\\,${a}\\,${b.toFixed(2)})'`;
        y += fsz + gap;
      }
    }
    const out = path.join(dir, `p${i}.mp4`);
    if (s.card) vf = vf.replace(GRADES[m.grade] || '\u0000', '').replace(GRAINS[m.grain] || '\u0000', '');
    ff([...(s.card ? ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${D}`] : s.still ? ['-loop', '1', '-framerate', String(fps), '-t', String(D), '-i', src] : ['-i', src]), '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', out], `Sahne ${s.n}`);
    parts.push({ file: out, D: probeSec(out) || D, voice: s.voice, voice_sec: s.voice_sec, radio: !!s.radio, sfx: s.sfx });
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
    const radio = parts[i].radio ? 'highpass=f=350,lowpass=f=3000,acompressor=threshold=0.125:ratio=3,volume=1.6,' : '';
    fl.push(`[${k}:a]${radio}aresample=44100,aformat=channel_layouts=stereo,adelay=${d}|${d}[va${k}]`); voices.push(`[va${k}]`); k++;
  }
  // Ses efektleri: her sahnenin başında, sahne süresince, yumuşak giriş/çıkışla
  // Ses kaydı modu: kullanıcının kaydı filmin baştan sona sesidir
  if (m.master_audio) {
    const f = await fetchTo(m.master_audio, path.join(dir, 'kayit' + (path.extname(new URL(m.master_audio, 'file:///').pathname) || '.mp3')));
    ain.push('-i', f);
    fl.push(`[${k}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total},asetpts=PTS-STARTPTS[va${k}]`); voices.push(`[va${k}]`); k++;
  }
  const sfxs = [];
  for (let i = 0; i < n; i++) if (parts[i].sfx) {
    try {
      const f = await fetchTo(parts[i].sfx, path.join(dir, `fx${i}.mp3`));
      const D = parts[i].D, d = Math.round(starts[i] * 1000), fo = Math.max(0.2, D - 0.6).toFixed(2);
      ain.push('-i', f);
      fl.push(`[${k}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${D.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=${fo}:d=0.6,volume=${m.sfx_volume || 0.5},adelay=${d}|${d}[fx${k}]`);
      sfxs.push(`[fx${k}]`); k++;
    } catch (e) { log('Ses efekti atlandı: ' + e.message); }
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
  if (!voices.length && !musicLab && !sfxs.length) {
    ff(['-i', vidOnly, ...vargs, '-an', final], 'Son kodlama');
  } else {
    let mix;
    if (voices.length) {
      fl.push(`${voices.join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total}[vo]`);
      if (musicLab) {
        fl.push(`[vo]asplit=2[vo1][vo2]`);
        fl.push(`${musicLab}[vo1]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[duck]`);
        fl.push(`[duck][vo2]amix=inputs=2:normalize=0[a0]`);
      } else fl.push(`[vo]anull[a0]`);
    } else fl.push(`${musicLab || ''}${musicLab ? 'anull' : 'anullsrc=r=44100:cl=stereo,atrim=0:' + total}[a0]`);
    if (sfxs.length) fl.push(`[a0]${sfxs.join('')}amix=inputs=${sfxs.length + 1}:normalize=0:dropout_transition=0,alimiter=limit=0.95[a]`);
    else fl.push(`[a0]alimiter=limit=0.95[a]`);
    mix = '[a]';
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
