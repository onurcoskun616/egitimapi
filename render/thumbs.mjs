// Kapak görselleri: mevcut videolardan birer kare çıkarır (ilk sahne bitmeden hemen önce, başlık görünürken)
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const { TASK_ID, API_BASE, TASK_TOKEN } = process.env;
const api = p => `${API_BASE.replace(/\/$/, '')}/api/task/${TASK_ID}${p}?token=${TASK_TOKEN}`;
const post = async (p, body) => { const r = await fetch(api(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
const run = args => new Promise((ok, no) => spawn('ffmpeg', args, { stdio: 'inherit' }).on('close', c => c === 0 ? ok() : no(new Error('ffmpeg ' + c))));
async function main() {
  const r = await fetch(api('')); if (!r.ok) throw new Error('Görev alınamadı ' + r.status);
  const { items } = await r.json(); const dir = path.join(process.cwd(), 'thumbs'); await mkdir(dir, { recursive: true });
  const results = [];
  for (const it of items) {
    try {
      const v = path.join(dir, 'v.mp4'), o = path.join(dir, it.project_id + '.jpg');
      const vr = await fetch(it.video_url); if (!vr.ok) throw new Error('video ' + vr.status); await writeFile(v, Buffer.from(await vr.arrayBuffer()));
      await run(['-y', '-loglevel', 'error', '-ss', String(it.at || 3), '-i', v, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', o]);
      const { url, path: p } = await post('/upload-url', { name: it.project_id + '.jpg' });
      const up = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: await readFile(o) });
      if (!up.ok) throw new Error('yükleme ' + up.status);
      results.push({ project_id: it.project_id, path: p }); console.log('tamam', it.project_id);
    } catch (e) { console.log('hata', it.project_id, e.message); results.push({ project_id: it.project_id, error: e.message }); }
  }
  await post('/result', { results });
}
main().catch(async e => { console.error(e); try { await post('/result', { error: e.message }); } catch { } process.exit(1); });
