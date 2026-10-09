// Yayına hazırlık: altyazı dosyaları, YouTube bölüm zamanları ve yayın metni istemi.

// Ses zamanlamasından sahne/cümle zaman çizelgesi (videodaki ile aynı)
function timeline(scenes, timings) {
  let acc = 0; const out = [];
  scenes.forEach((s, i) => {
    const t = (timings && timings[i]) || {};
    const dur = t.dur || Math.max(6, (s.cap || []).join(' ').length / 15 + 1.5);
    const capT = t.capT || (s.cap || []).map((_, j, a) => j * dur / a.length);
    const cues = (s.cap || []).map((text, j) => {
      const st = acc + capT[j];
      const next = j + 1 < capT.length ? acc + capT[j + 1] : acc + dur;
      const rate = t.capR && t.capR[j];
      const end = Math.min(next - 0.05, rate ? st + text.length / rate + 0.35 : next - 0.05);
      return { start: st, end: Math.max(st + 0.8, end), text };
    });
    out.push({ k: s.k, ch: s.ch, title: s.title, start: acc, dur, cues });
    acc += dur;
  });
  return { scenes: out, total: acc };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const stamp = (t, sep) => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000) % 1000; return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`; };

// Uzun cümleyi 42 karakterlik en fazla 2 satırlık parçalara böl, süreyi karakter oranında paylaştır
function wrapLines(text, max = 42) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur); return lines;
}
function cuesOf(tl) {
  const out = [];
  for (const s of tl.scenes) for (const c of s.cues) {
    const lines = wrapLines(c.text); const groups = [];
    for (let i = 0; i < lines.length; i += 2) groups.push(lines.slice(i, i + 2));
    const total = c.text.length || 1; let t = c.start;
    groups.forEach((g, gi) => { const len = g.join(' ').length; const d = (c.end - c.start) * len / total; out.push({ start: t, end: gi === groups.length - 1 ? c.end : t + d, lines: g }); t += d; });
  }
  return out;
}
function srt(tl) { return cuesOf(tl).map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.lines.join('\n')}\n`).join('\n'); }
function vtt(tl) { return 'WEBVTT\n\n' + cuesOf(tl).map(c => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.lines.join('\n')}\n`).join('\n'); }

// YouTube bölümleri: ilki 00:00, her biri en az 10 sn; ardışık aynı "ch" birleşir
function chapters(tl) {
  const list = [];
  for (const s of tl.scenes) { const l = list[list.length - 1]; if (l && l.ch === s.ch) continue; list.push({ ch: s.ch, title: s.title, start: s.start }); }
  const ok = []; for (const c of list) { const l = ok[ok.length - 1]; if (l && c.start - l.start < 10) continue; ok.push(c); }
  if (ok.length) ok[0].start = 0;
  const label = c => { const t = Math.round(c.start); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };
  return ok.map(c => ({ ...c, label: label(c), name: c.ch ? c.ch.charAt(0) + c.ch.slice(1).toLocaleLowerCase('tr') : c.title }));
}

const PUBLISH_SYSTEM = `Sen bir okulun eğitim videoları için sosyal medya ve YouTube editörüsün. Videonun içeriğinden yayın metinleri yazarsın. Çıktın SADECE geçerli JSON olur.
Kurallar:
- Dil: doğru, sade Türkçe; abartılı reklam dili, tık tuzağı ve emoji yağmuru yok (en fazla 2 emoji, yalnızca Instagram metninde).
- "youtube_title": en fazla 70 karakter, konuyu ve faydayı açıkça söylesin.
- "youtube_description": 2–4 kısa paragraf: ne öğrenileceği, kimler için olduğu, güvenlik uyarısı gerekiyorsa o. Bölüm listesi, etiket ve bağlantı YAZMA (sistem ekler).
- "tags": YouTube anahtar kelimeleri, 8–15 adet, Türkçe, küçük harf.
- "hashtags": 5–8 adet, # ile, Türkçe karakter içermeyen yazımla da olabilir (#mesleklisesi gibi).
- "social_caption": Instagram Reels / TikTok / YouTube Shorts için 2–4 satır, ilk satır merak uyandırsın, sonda soru ya da çağrı.
- "cover_title": kapak görseli için en fazla 32 karakter, büyük harfe uygun, çarpıcı.
- "cover_sub": kapakta küçük yazı, en fazla 40 karakter (ör. "Meslek lisesi · 4 dakikada").
JSON: {"youtube_title":"","youtube_description":"","tags":[],"hashtags":[],"social_caption":"","cover_title":"","cover_sub":""}`;

function publishPrompt(p, scenes, kaz, chs) {
  let u = `Video konusu: ${p.title}\nHedef kitle: ${p.audience || 'meslek lisesi öğrencileri'}\n`;
  if (kaz && kaz.length) u += `Kazanımlar:\n${kaz.map(k => `- ${k.text}`).join('\n')}\n`;
  u += `Bölümler: ${chs.map(c => c.name).join(', ')}\n\nSahneler:\n`;
  for (const s of scenes) u += `- ${s.title}: ${(s.cap || []).join(' ')}\n`;
  return u;
}

module.exports = { timeline, srt, vtt, chapters, PUBLISH_SYSTEM, publishPrompt };
