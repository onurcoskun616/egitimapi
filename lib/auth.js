// Hesaplar ve oturumlar: scrypt şifre, rastgele oturum jetonu (veritabanında yalnızca özeti tutulur)
const crypto = require('crypto');
const { db, q } = require('./supa');

const SESSION_DAYS = 30;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, salt, key] = String(stored).split('$'); if (alg !== 'scrypt') return false;
    const k = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(k, Buffer.from(key, 'hex'));
  } catch { return false; }
}

const cache = new Map(); // token özeti → {user, at}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.insert('sessions', { token_hash: sha(token), user_id: userId, expires_at: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() });
  return token;
}
async function destroySession(token) { if (!token) return; cache.delete(sha(token)); await db.update('sessions', `token_hash=eq.${sha(token)}`, { expires_at: new Date(0).toISOString() }).catch(() => {}); }
const PUBLIC_FIELDS = 'id,email,name,role,status,slug,school,subject,bio';
async function userFromToken(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const h = sha(token), c = cache.get(h);
  if (c && Date.now() - c.at < 30000) return c.user;
  const s = await db.one('sessions', `token_hash=eq.${h}&expires_at=gt.${new Date().toISOString()}&select=user_id`);
  const user = s ? await db.one('users', `id=eq.${q(s.user_id)}&select=${PUBLIC_FIELDS}`) : null;
  const ok = user && user.status !== 'rejected' && user.status !== 'suspended' ? user : null;
  cache.set(h, { user: ok, at: Date.now() });
  return ok;
}
function forgetUser(userId) { for (const [k, v] of cache) if (v.user && v.user.id === userId) cache.delete(k); }
function tokenOf(req) { const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/); return m ? m[1] : null; }

const TR = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
const slugify = s => String(s || '').toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, ch => TR[ch] || ch).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ogretmen';
async function uniqueSlug(name, selfId) {
  const base = slugify(name); let s = base, n = 1;
  for (;;) { const u = await db.one('users', `slug=eq.${q(s)}&select=id`); if (!u || u.id === selfId) return s; s = `${base}-${++n}`; }
}

// Basit deneme sınırı: IP başına 10 dakikada 20 başarısız giriş
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 20 && Date.now() - f.t < 600000; }
function failed(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 600000) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }

const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e === 'yonetici';

module.exports = { hashPassword, verifyPassword, createSession, destroySession, userFromToken, forgetUser, tokenOf, uniqueSlug, slugify, tooMany, failed, validEmail, PUBLIC_FIELDS, SESSION_DAYS };
