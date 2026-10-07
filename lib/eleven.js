// ElevenLabs: zaman damgalı seslendirme ve sahne zamanlaması
async function tts(text, voiceId) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
      // Kullanıcının ElevenLabs'te beğendiği ayarlar (Stability 39, Similarity 36, Style 47, Speaker boost kapalı)
      voice_settings: { stability: 0.39, similarity_boost: 0.36, style: 0.47, use_speaker_boost: false, speed: 1 },
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const d = j.detail || j, msg = typeof d === 'string' ? d : (d.message || JSON.stringify(d));
    const code = (typeof d === 'object' && (d.status || d.code)) || '';
    if (/quota|credit/i.test(code + ' ' + msg)) throw new Error('ElevenLabs kredisi yetmiyor: bu seslendirme ' + text.length + ' karakter istiyor. ' + msg.slice(0, 200));
    if (r.status === 402 || /library voices/i.test(msg)) throw new Error('ElevenLabs ücretsiz planı kütüphane seslerinin API ile kullanılmasına izin vermiyor. Ya ElevenLabs planını yükseltin ya da ELEVENLABS_VOICE_ID olarak hazır (premade) bir ses ya da kendi klonladığınız sesi girin.');
    if (r.status === 401) throw new Error('ElevenLabs isteği reddetti (401): ' + msg.slice(0, 250));
    throw new Error('ElevenLabs: ' + msg.slice(0, 300));
  }
  return { audio: Buffer.from(j.audio_base64, 'base64'), alignment: j.alignment };
}

// Sahnelerin cümlelerini tek metne dizer, her cümlenin karakter başlangıcını tutar
function buildScript(scenes) {
  let text = ''; const marks = [];
  scenes.forEach((s, si) => {
    if (si > 0) text += '\n\n';
    s.cap.forEach((cap, ci) => { if (ci > 0) text += ' '; marks.push({ si, ci, start: text.length, len: cap.length }); text += cap; });
  });
  return { text, marks };
}

// Hizalamadan sahne süreleri, cümle başlangıçları (capT) ve okuma hızları (capR)
function timings(scenes, marks, al) {
  const st = al.character_start_times_seconds, en = al.character_end_times_seconds;
  const n = st.length;
  const at = i => st[Math.min(n - 1, Math.max(0, i))];
  const endAt = i => en[Math.min(n - 1, Math.max(0, i))];
  marks.forEach(m => { m.t0 = at(m.start); m.t1 = endAt(m.start + m.len - 1); });
  const audioEnd = en[n - 1];
  const bounds = scenes.map((s, si) => {
    const first = marks.find(m => m.si === si);
    if (si === 0) return 0;
    const prev = marks.filter(m => m.si === si - 1).pop();
    return (prev.t1 + first.t0) / 2;
  });
  bounds.push(audioEnd + 0.9);
  return scenes.map((s, si) => {
    const ms = marks.filter(m => m.si === si), b0 = bounds[si], b1 = bounds[si + 1];
    return {
      dur: +(b1 - b0).toFixed(3),
      capT: ms.map(m => +(m.t0 - b0).toFixed(3)),
      capR: ms.map(m => +(m.len / Math.max(0.8, m.t1 - m.t0)).toFixed(2)),
    };
  });
}

module.exports = { tts, buildScript, timings };
