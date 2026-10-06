// GitHub Actions Claude işçisi: görevdeki istemleri Claude Code (abonelik jetonu) ile çalıştırır,
// yanıtları uygulamaya geri gönderir. Araç kullanımı kapalıdır; yalnızca metin üretir.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { TASK_ID, API_BASE, TASK_TOKEN } = process.env;
const api = p => `${API_BASE.replace(/\/$/, '')}/api/task/${TASK_ID}${p}?token=${TASK_TOKEN}`;
const CONCURRENCY = 3;

function runClaude(system, user, model, dir, i) {
  return new Promise(async (ok) => {
    const sysFile = path.join(dir, `sys-${i}.txt`);
    await writeFile(sysFile, system);
    const args = ['-p', '--output-format', 'json', '--system-prompt-file', sysFile, '--tools', '', '--max-turns', '1', '--no-session-persistence'];
    if (model) args.push('--model', model);
    const p = spawn('claude', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => {
      try {
        const j = JSON.parse(out);
        if (j.is_error || code !== 0) return ok({ error: (j.result || err || 'claude hata kodu ' + code).toString().slice(0, 500) });
        ok({ text: j.result, usage: j.usage || null });
      } catch { ok({ error: ('çıktı okunamadı: ' + (err || out)).slice(0, 500) }); }
    });
    p.stdin.end(user);
  });
}

async function main() {
  const r = await fetch(api(''));
  if (!r.ok) throw new Error('Görev alınamadı: ' + r.status + ' ' + await r.text());
  const { items, model } = await r.json();
  console.log(`İstem sayısı: ${items.length}, model: ${model || 'varsayılan'}`);
  const dir = await mkdtemp(path.join(tmpdir(), 'gen-'));
  const results = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const k = next++; const t0 = Date.now();
      results[k] = await runClaude(items[k].system, items[k].user, model, dir, k);
      console.log(`#${k + 1}: ${results[k].error ? 'HATA ' + results[k].error : 'tamam'} (${Math.round((Date.now() - t0) / 1000)} sn)`);
    }
  }));
  if (results.every(x => x.error)) throw new Error('Tüm istemler başarısız: ' + results[0].error);
  const s = await fetch(api('/result'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) });
  if (!s.ok) throw new Error('Sonuç gönderilemedi: ' + s.status);
  console.log('Gönderildi.');
}

main().catch(async e => {
  console.error(e);
  try { await fetch(api('/result'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) }); } catch { }
  process.exit(1);
});
