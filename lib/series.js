// Yıllık plan ve video serisi: bir eğitimin (course) haftalık planı, seçilen haftalar için
// projelerin sıraya alınması ve sıradaki içeriklerin birkaç tane aynı anda üretilmesi.
const PARALLEL = +(process.env.SERIES_PARALLEL || 2);

function briefFor(plan, w) {
  const unit = (plan.units || []).find(u => u.n === w.unit) || {};
  const total = (plan.weeks || []).length;
  let b = `Ders: ${plan.title}${plan.subject ? ` (${plan.subject})` : ''}. ${unit.n ? `${unit.n}. öğrenme birimi: ${unit.title}. ` : ''}Hafta ${w.week}/${total}.\n`;
  b += `Konu: ${w.title}\n\nİşlenecek içerik: ${w.content}\n`;
  if (w.kazanimlar && w.kazanimlar.length) b += `\nBu videonun kazanımları (ders programından):\n${w.kazanimlar.map(k => '- ' + k).join('\n')}\n`;
  if (w.uygulama) b += `\nBu haftanın atölye uygulaması: ${w.uygulama} Videoda uygulamanın nasıl yapılacağını kısaca göster; son sahnede öğrencinin bu hafta ne çizeceğini söyle.\n`;
  if (w.unit_end) b += `\nBu hafta öğrenme biriminin son haftası: konuyu anlatırken birimin kısa bir tekrarını da yap.\n`;
  b += `\nKaynak: MEB ders bilgi formu. Kavramları ve terimleri ders programındaki gibi kullan.`;
  return b.slice(0, 4000);
}

module.exports = function series(ctx) {
  const { on, db, q, send, readBody, isAdmin, activeLimits, monthUsage, background, FORMATS, TONES, now } = ctx;

  async function ownCourse(req, cid) {
    const c = await db.one('courses', `id=eq.${q(cid)}`);
    return c && (isAdmin(req.user) || c.teacher_id === req.user.id) ? c : null;
  }

  // Seçilen haftalar için videoları sıraya al
  on('POST', '/api/my/courses/:cid/produce', async (req, res, { cid }) => {
    const c = await ownCourse(req, cid); if (!c) return send(res, 404, { error: 'Eğitim bulunamadı' });
    const plan = c.plan; if (!plan || !Array.isArray(plan.weeks)) return send(res, 400, { error: 'Bu eğitimin yıllık planı yok' });
    const b = await readBody(req, 8000);
    const want = new Set((Array.isArray(b.weeks) ? b.weeks : []).map(Number));
    const weeks = plan.weeks.filter(w => want.has(w.week) && !w.project_id);
    if (!weeks.length) return send(res, 400, { error: 'Üretilecek yeni hafta seçilmedi' });
    const d = { ...(plan.defaults || {}), ...(b.defaults || {}) };
    const tone = TONES[d.tone] ? d.tone : 'akademik', format = FORMATS[d.format] ? d.format : 'yatay';
    const seconds = Math.min(300, Math.max(60, +d.target_seconds || 180));
    if (!isAdmin(req.user)) {
      const lim = await activeLimits(req.user);
      if (!lim) return send(res, 402, { error: 'Video üretmek için etkin bir paketiniz yok.' });
      const left = (lim.limits.videos_per_month || 0) - await monthUsage(req.user.id);
      if (weeks.length > left) return send(res, 402, { error: `Bu ay ${Math.max(0, left)} video hakkınız kaldı; ${weeks.length} hafta seçtiniz.` });
      if (seconds > (lim.limits.max_seconds || 0)) return send(res, 402, { error: `Paketiniz en fazla ${lim.limits.max_seconds} saniyelik videoya izin veriyor.` });
    }
    const sources = await db.select('project_sources', `course_id=eq.${q(cid)}&select=name,pages,chars`);
    const created = [];
    for (const w of weeks.sort((a, b) => a.week - b.week)) {
      const p = await db.insert('projects', { owner_id: c.teacher_id, title: `Hafta ${w.week} · ${w.title}`.slice(0, 120), brief: briefFor(plan, w), audience: plan.audience || null, target_seconds: seconds, tone, format, status: 'queued' });
      for (const s of sources) await db.insert('project_sources', { project_id: p.id, name: s.name, pages: s.pages, chars: s.chars });
      await db.insert('course_items', { course_id: cid, project_id: p.id, position: w.week });
      w.project_id = p.id; created.push({ week: w.week, id: p.id });
    }
    plan.defaults = { tone, format, target_seconds: seconds };
    await db.update('courses', `id=eq.${q(cid)}`, { plan, updated_at: now() });
    tick();
    send(res, 200, { created, message: `${created.length} hafta sıraya alındı. İçerikler sırayla (aynı anda ${PARALLEL} tane) hazırlanacak; her biri hazır olunca onayınıza sunulur.` });
  });

  // Sıradaki projeler: aynı anda en fazla PARALLEL içerik üretimi
  let busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const running = await db.select('projects', 'status=eq.content_generating&select=id');
      let free = PARALLEL - running.length;
      if (free > 0) {
        const next = await db.select('projects', `status=eq.queued&select=id&order=created_at.asc&limit=${free}`);
        for (const p of next) {
          const r = await db.update('projects', `id=eq.${q(p.id)}&status=eq.queued`, { status: 'content_generating', updated_at: now() });
          if (r) background(p.id, 'content', []);
        }
      }
    } catch (e) { console.error('seri sırası', e.message); }
    busy = false;
  }
  setInterval(tick, 20000); setTimeout(tick, 5000);
  return { briefFor, tick };
};
module.exports.briefFor = briefFor;
