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
const storage = {
  async upload(path, buf, type) {
    return req(`/storage/v1/object/media/${path}`, { method: 'POST', body: buf, headers: { 'Content-Type': type, 'x-upsert': 'true' } });
  },
  async signedUrl(path, expiresIn = 3600) {
    const r = await req(`/storage/v1/object/sign/media/${path}`, { method: 'POST', body: JSON.stringify({ expiresIn }), headers: { 'Content-Type': 'application/json' } });
    return URL_() + '/storage/v1' + r.signedURL;
  },
  async signedUploadUrl(path) {
    const r = await req(`/storage/v1/object/upload/sign/media/${path}`, { method: 'POST', headers: { 'x-upsert': 'true' } });
    return URL_() + '/storage/v1' + r.url;
  },
};
module.exports = { db, storage, q };
