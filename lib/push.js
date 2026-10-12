// Web Push (bağımlılıksız): VAPID (RFC 8292) + aes128gcm şifreleme (RFC 8291 / RFC 8188).
// Anahtarlar ilk açılışta üretilir ve settings tablosunda (key = 'vapid') saklanır.
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 8291: istemcinin p256dh/auth anahtarlarıyla yükü şifreler
function encrypt(payload, p256dh, authSecret, opts = {}) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivate) ecdh.setPrivateKey(opts.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(auth, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const salt = opts.salt || crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPublic.length;
  return Buffer.concat([head, asPublic, ct]);
}

// VAPID JWT (ES256)
function vapidAuth(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const p = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${keys.publicKey}`;
}

function newKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
  return { jwk, publicKey: b64u(pub) };
}

module.exports = function push({ on, db, q, send, readBody, publicBase }) {
  let KEYS = null;
  async function keys() {
    if (KEYS) return KEYS;
    const r = await db.one('settings', 'key=eq.vapid').catch(() => null);
    if (r && r.value && r.value.jwk) return (KEYS = r.value);
    const k = newKeys();
    try { await db.insert('settings', { key: 'vapid', value: k }); KEYS = k; }
    catch { const again = await db.one('settings', 'key=eq.vapid'); KEYS = again.value; } // eşzamanlı oluşturma
    return KEYS;
  }

  async function sendOne(sub, payload, K) {
    const body = encrypt(JSON.stringify(payload), sub.p256dh, sub.auth);
    const r = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuth(sub.endpoint, K, publicBase()) }, body });
    if (r.status === 404 || r.status === 410) { await db.remove('push_subs', `endpoint=eq.${q(sub.endpoint)}`).catch(() => {}); return false; }
    if (!r.ok) { console.error('push', r.status, (await r.text()).slice(0, 200)); return false; }
    db.update('push_subs', `endpoint=eq.${q(sub.endpoint)}`, { last_ok: new Date().toISOString() }).catch(() => {});
    return true;
  }
  // Kullanıcının tüm cihazlarına bildirim (hata uygulamayı durdurmaz)
  async function notify(userId, payload) {
    try {
      if (!userId) return 0;
      const subs = await db.select('push_subs', `user_id=eq.${q(userId)}&select=endpoint,p256dh,auth`);
      if (!subs.length) return 0;
      const K = await keys(); let n = 0;
      for (const s of subs) if (await sendOne(s, { icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png', ...payload }, K).catch(e => { console.error('push', e.message); return false; })) n++;
      return n;
    } catch (e) { console.error('notify', e.message); return 0; }
  }

  on('GET', '/api/push/key', async (req, res) => send(res, 200, { key: (await keys()).publicKey }), 'public');
  on('POST', '/api/push/subscribe', async (req, res) => {
    const b = await readBody(req, 4000), s = b.subscription || {};
    if (!(/^https:\/\//.test(s.endpoint || '') || (process.env.PUSH_ALLOW_HTTP && /^http:\/\/127/.test(s.endpoint || ''))) || !s.keys || !s.keys.p256dh || !s.keys.auth) return send(res, 400, { error: 'Geçersiz abonelik' });
    const row = { user_id: req.user.id, p256dh: s.keys.p256dh, auth: s.keys.auth, ua: String(req.headers['user-agent'] || '').slice(0, 200) };
    const ex = await db.one('push_subs', `endpoint=eq.${q(s.endpoint)}&select=endpoint`);
    if (ex) await db.update('push_subs', `endpoint=eq.${q(s.endpoint)}`, row); else await db.insert('push_subs', { endpoint: s.endpoint, ...row });
    if (b.test) await notify(req.user.id, { title: 'Bildirimler açık', body: 'Videolarınız ve dersleriniz hakkında buradan haber vereceğiz.', url: '/#/profil' });
    send(res, 200, { ok: true });
  }, 'user');
  on('POST', '/api/push/unsubscribe', async (req, res) => {
    const b = await readBody(req, 4000);
    if (b.endpoint) await db.remove('push_subs', `endpoint=eq.${q(b.endpoint)}&user_id=eq.${q(req.user.id)}`).catch(() => {});
    send(res, 200, { ok: true });
  }, 'user');
  on('GET', '/api/push/status', async (req, res) => send(res, 200, { devices: (await db.select('push_subs', `user_id=eq.${q(req.user.id)}&select=endpoint`)).length }), 'user');

  return { notify, keys };
};
module.exports.encrypt = encrypt;
module.exports.vapidAuth = vapidAuth;
module.exports.newKeys = newKeys;
