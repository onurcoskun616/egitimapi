// Sinematik stil için görsel üretimi (fal.ai). FAL_KEY Render ortam değişkeninde durur.
// Ana görsel: FLUX [dev] (metinden görsel). Sahne içi değişim: FLUX Kontext (görseli düzenleme).
const SIZES = { dikey: { width: 768, height: 1344 }, yatay: { width: 1344, height: 768 }, kare: { width: 1024, height: 1024 }, dikey45: { width: 896, height: 1120 } };
const RATIO = { dikey: '9:16', yatay: '16:9', kare: '1:1', dikey45: '4:5' };
const BASE = () => (process.env.FAL_BASE || 'https://fal.run').replace(/\/$/, '');
const MODEL = () => process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/dev';
const EDIT_MODEL = () => process.env.FAL_EDIT_MODEL || 'fal-ai/flux-pro/kontext';
// Tahmini birim fiyatlar (dolar); maliyet raporu için. Ortam değişkeniyle güncellenebilir.
const PRICE_MP = () => +(process.env.FAL_PRICE_MP || 0.025);
const PRICE_EDIT = () => +(process.env.FAL_PRICE_EDIT || 0.04);
const NEG = 'no text, no letters, no watermark, no logo';

const enabled = () => !!process.env.FAL_KEY;

async function run(model, input) {
  const r = await fetch(`${BASE()}/${model}`, { method: 'POST', headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = j && (j.detail || j.error || j.message);
    const msg = typeof d === 'string' ? d : d ? JSON.stringify(d).slice(0, 240) : 'HTTP ' + r.status;
    if (r.status === 401 || r.status === 403) throw new Error('Görsel servisi anahtarı geçersiz (FAL_KEY). ' + msg);
    if (r.status === 402 || /balance|credit|exhausted|locked/i.test(msg)) throw new Error('Görsel servisinde bakiye yetersiz; fal.ai hesabına kredi yükleyin. ' + msg);
    throw new Error('Görsel servisi: ' + msg);
  }
  const img = j.images && j.images[0];
  if (!img || !img.url) throw new Error('Görsel servisi görsel döndürmedi');
  if (j.has_nsfw_concepts && j.has_nsfw_concepts[0]) throw new Error('Görsel güvenlik filtresine takıldı; tarifi değiştirin');
  return img;
}

async function download(url) {
  if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const r = await fetch(url); if (!r.ok) throw new Error('Görsel indirilemedi: ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Bir sahnenin görselleri: { main:{buf,url}, after:{buf}|null, usd }
async function sceneImages(scene, look, format, seed) {
  const size = SIZES[format] || SIZES.dikey;
  const prompt = `${scene.img}. ${look || ''}. ${NEG}`.replace(/\s+/g, ' ').slice(0, 1800);
  const main = await run(MODEL(), { prompt, image_size: size, num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, enable_safety_checker: true, output_format: 'jpeg', seed });
  let usd = PRICE_MP() * Math.max(1, size.width * size.height / 1048576);
  const out = { main: { buf: await download(main.url), url: main.url }, after: null };
  if (scene.img2) {
    try {
      const ed = await run(EDIT_MODEL(), { prompt: `${scene.img2}. Keep the same scene, camera angle, composition and style. ${NEG}`, image_url: main.url, aspect_ratio: RATIO[format] || '9:16', output_format: 'jpeg', num_images: 1, seed });
      out.after = { buf: await download(ed.url) }; usd += PRICE_EDIT();
    } catch (e) { out.afterError = e.message; }
  }
  out.usd = usd;
  return out;
}

module.exports = { enabled, sceneImages, SIZES };
