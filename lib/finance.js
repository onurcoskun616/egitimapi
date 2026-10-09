// Maliyet ve kâr raporu (yönetici). Değişken maliyetler: Claude (token), ElevenLabs (karakter),
// GitHub Actions (dakika). Gelir: ödenmiş siparişler (paket tutarı + eğitim satışlarından komisyon).
// Fiyatlar "settings" tablosunda (key = 'costs'), yönetim panelinden değiştirilebilir.
const DEFAULTS = {
  usd_try: 49.2,                 // 7 Ekim 2026 piyasa kuru civarı
  claude_billing: 'api',         // 'api' → token başına ücret; 'subscription' → sabit abonelik (değişken maliyete eklenmez)
  claude_in: 4, claude_out: 20, claude_cw: 5, claude_cr: 0.2, // $ / milyon token (Claude Opus 5.5)
  claude_out_share: 0.35,        // eski kayıtlarda girdi/çıktı ayrımı yok: toplamın bu kadarı çıktı sayılır
  eleven_per_1k: 0.18,           // $ / 1000 karakter (Creator: 22 $ / 121 bin karakter)
  actions_per_min: 0,            // herkese açık depoda GitHub Actions ücretsiz
  commission_pct: 20,            // ücretli eğitim satışlarından platform payı (%)
  fixed: [                       // aylık sabit giderler (TL)
    { name: 'Render sunucu', try: 0 },
    { name: 'Supabase', try: 0 },
    { name: 'ElevenLabs abonelik', try: 0 },
    { name: 'Claude abonelik', try: 0 },
  ],
};

module.exports = function finance({ on, db, q, send, readBody }) {
  async function getCosts() {
    const r = await db.one('settings', 'key=eq.costs').catch(() => null);
    return { ...DEFAULTS, ...((r && r.value) || {}) };
  }
  const inList = ids => `(${[...new Set(ids)].filter(Boolean).map(q).join(',') || '00000000-0000-0000-0000-000000000000'})`;
  const mins = (a, b) => (a && b ? Math.max(0, (new Date(b) - new Date(a)) / 60000) : 0);

  // Bir kullanım satırının dolar maliyeti
  function usdOf(u, C) {
    if (u.provider === 'elevenlabs') return (+u.units || 0) / 1000 * C.eleven_per_1k;
    if (u.provider === 'claude') {
      if (C.claude_billing === 'subscription') return 0;
      const d = u.detail;
      if (d && (d.in || d.out || d.cw || d.cr)) return (d.in * C.claude_in + d.out * C.claude_out + (d.cw || 0) * C.claude_cw + (d.cr || 0) * C.claude_cr) / 1e6;
      const n = +u.units || 0; return (n * (1 - C.claude_out_share) * C.claude_in + n * C.claude_out_share * C.claude_out) / 1e6;
    }
    return 0;
  }
  const claudeApiUsd = (u, C) => usdOf(u, { ...C, claude_billing: 'api' });

  function range(qs) {
    const p = qs.get('p') || 'month', now = new Date();
    let from, to = now;
    if (p === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (p === 'last') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 1); }
    else if (p === '30') from = new Date(now - 30 * 864e5);
    else if (p === '90') from = new Date(now - 90 * 864e5);
    else from = null; // ilk kayıttan itibaren
    return { p, from, to, days: Math.max(1, (to - from) / 864e5) };
  }

  on('GET', '/api/admin/finance', async (req, res) => {
    const C = await getCosts(), R = range(new URL(req.url, 'http://x').searchParams);
    if (!R.from) { const f = await db.one('usage', 'select=created_at&order=created_at.asc'); R.from = f ? new Date(f.created_at) : new Date(); R.days = Math.max(1, (R.to - R.from) / 864e5); }
    const F = R.from.toISOString(), T = R.to.toISOString();
    const [usage, renders, tasks, orders] = await Promise.all([
      db.select('usage', `created_at=gte.${F}&created_at=lt.${T}&select=project_id,provider,units,note,detail,created_at&limit=20000`),
      db.select('render_jobs', `created_at=gte.${F}&created_at=lt.${T}&select=project_id,status,started_at,finished_at,created_at&limit=5000`),
      db.select('gen_tasks', `created_at=gte.${F}&created_at=lt.${T}&select=project_id,kind,status,created_at,finished_at&limit=5000`),
      db.select('orders', `status=eq.paid&paid_at=gte.${F}&paid_at=lt.${T}&select=user_id,kind,ref_id,amount_cents&limit=5000`),
    ]);
    const pids = [...new Set([...usage, ...renders, ...tasks].map(x => x.project_id).filter(Boolean))];
    const projects = pids.length ? await db.select('projects', `id=in.${inList(pids)}&select=id,title,status,owner_id,created_at,target_seconds`) : [];
    const audio = pids.length ? await db.select('audio_tracks', `project_id=in.${inList(pids)}&select=project_id,duration_s,created_at&order=created_at.desc`) : [];
    const done = pids.length ? await db.select('render_jobs', `project_id=in.${inList(pids)}&status=eq.done&select=project_id`) : [];
    const users = await db.select('users', 'role=in.(teacher,admin)&select=id,name,email');
    const plans = await db.select('plans', 'select=id,code,name,price_cents,limits,active,sort&order=sort.asc');

    // proje bazında maliyet
    const P = {};
    const row = id => P[id] || (P[id] = { id, claude: 0, claude_api: 0, eleven: 0, actions: 0, tokens: 0, chars: 0, minutes: 0, renders: 0, failed: 0, revisions: 0 });
    for (const u of usage) {
      if (!u.project_id) continue; const r = row(u.project_id);
      if (u.provider === 'claude') { r.claude += usdOf(u, C); r.claude_api += claudeApiUsd(u, C); r.tokens += +u.units || 0; if (/^scene /.test(u.note || '') || u.note === 'denetim düzeltmesi') r.revisions++; }
      if (u.provider === 'elevenlabs') { r.eleven += usdOf(u, C); r.chars += +u.units || 0; }
    }
    for (const j of renders) { const r = row(j.project_id); const m = mins(j.started_at || j.created_at, j.finished_at); r.minutes += m; r.renders++; if (j.status === 'failed') r.failed++; }
    for (const t of tasks) { const m = mins(t.created_at, t.finished_at); row(t.project_id).minutes += Math.min(m, 60); }
    for (const r of Object.values(P)) r.actions = r.minutes * C.actions_per_min;

    const pm = Object.fromEntries(projects.map(p => [p.id, p]));
    const dur = {}; for (const a of audio) if (!(a.project_id in dur)) dur[a.project_id] = +a.duration_s || 0;
    const delivered = new Set(done.map(d => d.project_id));
    const usd = r => r.claude + r.eleven + r.actions;
    const list = Object.values(P).filter(r => pm[r.id]).map(r => {
      const p = pm[r.id], total = usd(r), sec = dur[r.id] || 0;
      return { id: r.id, title: p.title, status: p.status, owner_id: p.owner_id, created_at: p.created_at, delivered: delivered.has(r.id), seconds: Math.round(sec),
        usd: { claude: r.claude, claude_api: r.claude_api, eleven: r.eleven, actions: r.actions, total },
        tokens: r.tokens, chars: r.chars, minutes: Math.round(r.minutes), renders: r.renders, failed: r.failed, revisions: r.revisions,
        try_total: total * C.usd_try, try_per_min: sec ? total * C.usd_try / (sec / 60) : null };
    }).sort((a, b) => b.usd.total - a.usd.total);

    // gelir
    const courseIds = orders.filter(o => o.kind === 'course').map(o => o.ref_id);
    const courses = courseIds.length ? await db.select('courses', `id=in.${inList(courseIds)}&select=id,teacher_id`) : [];
    const cm = Object.fromEntries(courses.map(c => [c.id, c.teacher_id]));
    let revPlan = 0, revComm = 0, gross = 0; const revBy = {};
    for (const o of orders) {
      const tl = (o.amount_cents || 0) / 100;
      if (o.kind === 'plan') { revPlan += tl; revBy[o.user_id] = (revBy[o.user_id] || 0) + tl; }
      else { const c = tl * C.commission_pct / 100; revComm += c; gross += tl; const t = cm[o.ref_id]; if (t) revBy[t] = (revBy[t] || 0) + c; }
    }
    const variable = list.reduce((n, x) => n + x.try_total, 0);
    const fixedMonthly = (C.fixed || []).reduce((n, f) => n + (+f.try || 0), 0);
    const fixed = fixedMonthly * Math.min(R.days, 3650) / 30;
    const revenue = revPlan + revComm;

    // teslim edilen video başına ortalama (tüm denemeler ve düzeltmeler dahil)
    const dl = list.filter(x => x.delivered && x.seconds > 0);
    const avgVideo = dl.length ? dl.reduce((n, x) => n + x.try_total, 0) / dl.length : null;
    const avgMin = dl.length ? dl.reduce((n, x) => n + x.try_total, 0) / dl.reduce((n, x) => n + x.seconds / 60, 0) : null;
    // paket kontrolü her zaman API fiyatıyla (başka öğretmenlere satışta Claude API ile çalışılır)
    const avgMinApi = dl.length ? dl.reduce((n, x) => n + (x.usd.total - x.usd.claude + x.usd.claude_api) * C.usd_try, 0) / dl.reduce((n, x) => n + x.seconds / 60, 0) : null;
    const avgClaudeShare = dl.length ? dl.reduce((n, x) => n + x.usd.claude, 0) / Math.max(1e-9, dl.reduce((n, x) => n + x.usd.total, 0)) : null;

    // öğretmen bazında
    const un = Object.fromEntries(users.map(u => [u.id, u]));
    const T2 = {};
    for (const x of list) { const k = x.owner_id || '-'; const t = T2[k] || (T2[k] = { id: k, name: k === '-' ? 'Sahipsiz' : (un[k] || {}).name || '?', videos: 0, delivered: 0, cost: 0, revenue: 0 }); t.videos++; if (x.delivered) t.delivered++; t.cost += x.try_total; }
    for (const [k, v] of Object.entries(revBy)) { const t = T2[k] || (T2[k] = { id: k, name: (un[k] || {}).name || '?', videos: 0, delivered: 0, cost: 0, revenue: 0 }); t.revenue += v; }
    const teachers = Object.values(T2).map(t => ({ ...t, profit: t.revenue - t.cost })).sort((a, b) => b.cost - a.cost);

    // paket kontrolü: paket tam kullanılırsa (her video en uzun süre) değişken maliyet
    const perMin = avgMinApi;
    const planCheck = plans.map(p => {
      const L = p.limits || {}, price = (p.price_cents || 0) / 100;
      const worst = perMin != null ? (L.videos_per_month || 0) * (L.max_seconds || 0) / 60 * perMin : null;
      const typical = perMin != null ? (L.videos_per_month || 0) * Math.min(L.max_seconds || 0, 180) / 60 * perMin * 0.6 : null;
      return { code: p.code, name: p.name, active: p.active, price, videos: L.videos_per_month, max_seconds: L.max_seconds, worst, typical,
        margin_worst: worst != null ? price - worst : null, min_price: worst != null ? Math.ceil(worst * 3 / 50) * 50 : null };
    });

    send(res, 200, {
      period: { p: R.p, from: F, to: T, days: Math.round(R.days) }, costs: C,
      summary: { videos: list.length, delivered: dl.length, variable, fixed, revenue, revPlan, revComm, courseGross: gross, profit: revenue - variable - fixed,
        avgVideo, avgMin, avgMinApi, avgClaudeShare, claudeApiTry: list.reduce((n, x) => n + x.usd.claude_api, 0) * C.usd_try,
        byProvider: { claude: list.reduce((n, x) => n + x.usd.claude, 0) * C.usd_try, eleven: list.reduce((n, x) => n + x.usd.eleven, 0) * C.usd_try, actions: list.reduce((n, x) => n + x.usd.actions, 0) * C.usd_try },
        estimated: usage.some(u => u.provider === 'claude' && !u.detail) },
      planCheck, teachers, projects: list,
    });
  }, 'admin');

  on('POST', '/api/admin/finance/costs', async (req, res) => {
    const b = await readBody(req, 8000), cur = await getCosts(), out = { ...cur };
    for (const k of ['usd_try', 'claude_in', 'claude_out', 'claude_cw', 'claude_cr', 'claude_out_share', 'eleven_per_1k', 'actions_per_min', 'commission_pct'])
      if (k in b) { const v = +String(b[k]).replace(',', '.'); if (Number.isFinite(v) && v >= 0) out[k] = v; }
    if (b.claude_billing === 'api' || b.claude_billing === 'subscription') out.claude_billing = b.claude_billing;
    if (Array.isArray(b.fixed)) out.fixed = b.fixed.slice(0, 20).map(f => ({ name: String(f.name || '').slice(0, 60), try: Math.max(0, +String(f.try).replace(',', '.') || 0) })).filter(f => f.name);
    const ex = await db.one('settings', 'key=eq.costs');
    if (ex) await db.update('settings', 'key=eq.costs', { value: out, updated_at: new Date().toISOString() });
    else await db.insert('settings', { key: 'costs', value: out });
    send(res, 200, out);
  }, 'admin');
};
