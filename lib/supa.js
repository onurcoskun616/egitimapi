// Supabase REST (PostgREST + Storage) — bağımlılıksız istemci
const URL_ = () => process.env.SUPABASE_URL.replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
function headers(extra = {}) {
  const h = { apikey: KEY(), ...extra };
  if (KEY().startsWith('eyJ')) h.Authorization = 'Bearer ' + KEY();
  return h;
}
async function req(path, opts = {}) {
  const r = await fetch(URL_() + path, { ...opts, headers: headers(opts.headers) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const q = encodeURIComponent;
const db = {
  select: (table, query = '') => req(`/rest/v1/${table}?${query}`),
  one: async (table, query) => (await req(`/rest/v1/${table}?${query}&limit=1`))[0] || null,
  insert: async (table, row) => (await req(`/rest/v1/${table}`, { method: 'POST', body: JSON.stringify(row), headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' } }))[0],
  rpc: (fn, args) => req(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args), headers: { 'Content-Type': 'application/json' } }),
  remove: (table, query) => req(`/rest/v1/${table}?${query}`, { method: 'DELETE' }),
  count: async (table, query) => { const r = await fetch(URL_() + `/rest/v1/${table}?${query}&limit=1`, { headers: headers({ Prefer: 'count=exact' }) }); if (!r.ok) throw new Error('Supabase ' + r.status); return +(r.headers.get('content-range') || '/0').split('/')[1] || 0; },
  update: async (table, query, patch) => (await req(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' } }))[0],
};
// Cloudflare R2 (S3 uyumlu): videolar ve sesler burada tutulur (indirme trafiği ücretsiz). Yollar "r2:" önekiyle saklanır.
const crypto = require('crypto');
const R2 = {
  enabled: () => !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET),
  host: () => `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  // SigV4 ön imzalı adres (GET ya da PUT)
  presign(method, key, expires = 3600, T = {}) {
    const enc = x => encodeURIComponent(x).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
    const now = T.now || new Date(), amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), day = amz.slice(0, 8);
    const region = T.region || 'auto', scope = `${day}/${region}/s3/aws4_request`, host = T.host || R2.host(), ak = T.ak || process.env.R2_ACCESS_KEY_ID, sk = T.sk || process.env.R2_SECRET_ACCESS_KEY;
    const uri = (T.noBucket ? '' : '/' + enc(process.env.R2_BUCKET)) + '/' + key.split('/').map(enc).join('/');
    const params = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${ak}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(Math.min(604800, Math.max(60, Math.round(expires)))), 'X-Amz-SignedHeaders': 'host' };
    const qs = Object.keys(params).sort().map(k => enc(k) + '=' + enc(params[k])).join('&');
    const canon = [method, uri, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const sts = ['AWS4-HMAC-SHA256', amz, scope, crypto.createHash('sha256').update(canon).digest('hex')].join('\n');
    const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
    const kSig = h(h(h(h('AWS4' + sk, day), region), 's3'), 'aws4_request');
    return `https://${host}${uri}?${qs}&X-Amz-Signature=${crypto.createHmac('sha256', kSig).update(sts).digest('hex')}`;
  },
  async put(key, buf, type) { const r = await fetch(R2.presign('PUT', key, 900), { method: 'PUT', body: buf, headers: { 'Content-Type': type || 'application/octet-stream' } }); if (!r.ok) throw new Error(`R2 ${r.status}: ${(await r.text()).slice(0, 200)}`); return 'r2:' + key; },
};
const toR2 = path => R2.enabled() && /^(videos|audio)\//.test(path);
const storage = {
  // Yüklenen dosyanın saklama yolunu döndürür (R2'deyse "r2:" önekli)
  async upload(path, buf, type) {
    if (toR2(path)) return R2.put(path, buf, type);
    await req(`/storage/v1/object/media/${path}`, { method: 'POST', body: buf, headers: { 'Content-Type': type, 'x-upsert': 'true' } }); return path;
  },
  async signedUrl(path, expiresIn = 3600) {
    if (String(path).startsWith('r2:')) return R2.presign('GET', path.slice(3), expiresIn);
    const r = await req(`/storage/v1/object/sign/media/${path}`, { method: 'POST', body: JSON.stringify({ expiresIn }), headers: { 'Content-Type': 'application/json' } });
    return URL_() + '/storage/v1' + r.signedURL;
  },
  // { url, path }: render işinin doğrudan yükleyeceği adres ve saklanacak yol
  async uploadTarget(path) { if (toR2(path)) return { url: R2.presign('PUT', path, 3 * 3600), path: 'r2:' + path }; return { url: await storage.signedUploadUrl(path), path }; },
  async signedUploadUrl(path) {
    const r = await req(`/storage/v1/object/upload/sign/media/${path}`, { method: 'POST', headers: { 'x-upsert': 'true' } });
    return URL_() + '/storage/v1' + r.url;
  },
};
module.exports = { db, storage, q, R2 };
