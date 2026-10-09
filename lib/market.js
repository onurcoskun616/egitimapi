// Vitrin, eğitimler (kurslar), katılım talepleri, paketler ve yönetici uçları.
// Ödeme altyapısı: her ücretli işlem bir "order" kaydıdır. Şimdilik yönetici "ödendi" işaretler;
// ileride ödeme sağlayıcısı (iyzico/Stripe) aynı markPaid() fonksiyonunu çağıracak.
const crypto = require('crypto');

module.exports = function market(ctx) {
  const { on, db, q, send, readBody, isAdmin, activeLimits, auth, shortId, now } = ctx;
  const inList = ids => `(${[...new Set(ids)].map(q).join(',') || '00000000-0000-0000-0000-000000000000'})`;
  const TEACHER_PUB = 'id,name,slug,school,subject,bio';
  const COURSE_PUB = 'id,title,description,subject,level,access,price_cents,currency,teacher_id,visibility,status,updated_at';
  const money = c => (c / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  async function itemCounts(courseIds) {
    const rows = courseIds.length ? await db.select('course_items', `course_id=in.${inList(courseIds)}&select=course_id`) : [];
    const m = {}; rows.forEach(r => { m[r.course_id] = (m[r.course_id] || 0) + 1; }); return m;
  }
  async function decorate(courses) {
    const cnt = await itemCounts(courses.map(c => c.id));
    const ts = courses.length ? await db.select('users', `id=in.${inList(courses.map(c => c.teacher_id))}&select=${TEACHER_PUB}`) : [];
    const tm = Object.fromEntries(ts.map(t => [t.id, t]));
    return courses.map(c => ({ ...c, lessons: cnt[c.id] || 0, teacher: tm[c.teacher_id] || null }));
  }
  async function courseItems(courseId) {
    const items = await db.select('course_items', `course_id=eq.${q(courseId)}&select=project_id,position&order=position.asc`);
    if (!items.length) return [];
    const ps = await db.select('projects', `id=in.${inList(items.map(i => i.project_id))}&select=id,title,status,share_id,target_seconds,quiz_status,format`);
    const pm = Object.fromEntries(ps.map(p => [p.id, p]));
    return items.map(i => pm[i.project_id]).filter(Boolean);
  }
  // Öğretmenin onaylı öğrenci sayısı (paket sınırı için)
  async function studentCount(teacherId) {
    const cs = await db.select('courses', `teacher_id=eq.${q(teacherId)}&select=id`); if (!cs.length) return 0;
    const es = await db.select('enrollments', `course_id=in.${inList(cs.map(c => c.id))}&status=eq.approved&select=student_id`);
    return new Set(es.map(e => e.student_id)).size;
  }
  async function canAddStudent(teacher, studentId) {
    const lim = await activeLimits(teacher); if (!lim) return 'Öğretmenin etkin paketi yok';
    const cs = await db.select('courses', `teacher_id=eq.${q(teacher.id)}&select=id`);
    if (cs.length && await db.one('enrollments', `course_id=in.${inList(cs.map(c => c.id))}&student_id=eq.${q(studentId)}&status=eq.approved&select=id`)) return null; // zaten öğrencisi
    if (await studentCount(teacher.id) >= (lim.limits.students || 0)) return `Öğretmenin paketindeki öğrenci sınırı (${lim.limits.students}) doldu`;
    return null;
  }
  async function setEnrollment(courseId, studentId, status, source, extra = {}) {
    const ex = await db.one('enrollments', `course_id=eq.${q(courseId)}&student_id=eq.${q(studentId)}`);
    const row = { status, source, decided_at: status === 'pending' ? null : now(), ...extra };
    return ex ? db.update('enrollments', `id=eq.${q(ex.id)}`, row) : db.insert('enrollments', { course_id: courseId, student_id: studentId, ...row });
  }
  async function ownCourse(req, cid) {
    const c = await db.one('courses', `id=eq.${q(cid)}`);
    if (!c || (!isAdmin(req.user) && c.teacher_id !== req.user.id)) return null; return c;
  }
  async function teacherOf(c) { return db.one('users', `id=eq.${q(c.teacher_id)}&select=id,name,role,status`); }

  /* ---------- herkese açık vitrin ---------- */
  on('GET', '/api/catalog', async (req, res) => {
    const courses = await decorate(await db.select('courses', `status=eq.published&visibility=eq.public&select=${COURSE_PUB}&order=updated_at.desc&limit=200`));
    const live = courses.filter(c => c.teacher && c.lessons);
    const tids = [...new Set(live.map(c => c.teacher_id))];
    const teachers = tids.map(id => ({ ...live.find(c => c.teacher_id === id).teacher, courses: live.filter(c => c.teacher_id === id).length }));
    send(res, 200, { teachers, courses: live.map(c => ({ ...c, teacher: { name: c.teacher.name, slug: c.teacher.slug } })) });
  }, 'public');
  on('GET', '/api/t/:slug', async (req, res, { slug }) => {
    const t = await db.one('users', `slug=eq.${q(slug)}&role=eq.teacher&status=eq.active&select=${TEACHER_PUB}`);
    if (!t) return send(res, 404, { error: 'Öğretmen bulunamadı' });
    const courses = await decorate(await db.select('courses', `teacher_id=eq.${q(t.id)}&status=eq.published&visibility=eq.public&select=${COURSE_PUB}&order=updated_at.desc`));
    send(res, 200, { teacher: t, courses: courses.filter(c => c.lessons).map(c => ({ ...c, teacher: undefined })) });
  }, 'public');
  on('GET', '/api/courses/:id', async (req, res, { id }) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return send(res, 404, { error: 'Eğitim bulunamadı' });
    const c = await db.one('courses', `id=eq.${q(id)}&select=${COURSE_PUB}`);
    const mine = c && req.user && (isAdmin(req.user) || c.teacher_id === req.user.id);
    if (!c || (c.status !== 'published' && !mine)) return send(res, 404, { error: 'Eğitim bulunamadı' });
    const [full] = await decorate([c]);
    const items = await courseItems(id);
    let enrollment = null;
    if (req.user) enrollment = await db.one('enrollments', `course_id=eq.${q(id)}&student_id=eq.${q(req.user.id)}&select=id,status,source,created_at,expires_at`);
    const open = mine || (enrollment && enrollment.status === 'approved' && (!enrollment.expires_at || new Date(enrollment.expires_at) > new Date()));
    send(res, 200, {
      course: full, mine: !!mine, enrollment,
      lessons: items.map((p, i) => ({ n: i + 1, title: p.title, seconds: p.target_seconds, quiz: p.quiz_status === 'ready', ready: p.status === 'delivered', code: open && p.status === 'delivered' ? p.share_id : null })),
    });
  }, 'public');
  on('GET', '/api/plans', async (req, res) => send(res, 200, await db.select('plans', 'active=is.true&order=sort.asc&select=id,code,name,price_cents,currency,interval,limits,audience')), 'public');

  /* ---------- öğrenci ---------- */
  on('POST', '/api/courses/:id/request', async (req, res, { id }) => {
    const b = await readBody(req, 4000);
    const c = await db.one('courses', `id=eq.${q(id)}&status=eq.published`); if (!c) return send(res, 404, { error: 'Eğitim bulunamadı' });
    const ex = await db.one('enrollments', `course_id=eq.${q(id)}&student_id=eq.${q(req.user.id)}`);
    if (ex && ex.status === 'approved') return send(res, 200, { enrollment: ex, message: 'Bu eğitime zaten kayıtlısınız' });
    if (ex && ex.status === 'pending') return send(res, 200, { enrollment: ex, message: 'Talebiniz öğretmenin onayını bekliyor' });
    if (ex && ex.status === 'revoked') return send(res, 403, { error: 'Öğretmen bu eğitime erişiminizi kapattı. Öğretmeninizle görüşün.' });
    const t = await teacherOf(c); if (!t || t.status !== 'active') return send(res, 409, { error: 'Bu eğitim şu an kayda kapalı' });
    const message = String(b.message || '').trim().slice(0, 500) || null;
    if (c.access === 'open') {
      const why = await canAddStudent(t, req.user.id); if (why) return send(res, 409, { error: 'Kayıt şu an alınamıyor: ' + why });
      const e = await setEnrollment(id, req.user.id, 'approved', 'open', { message });
      return send(res, 200, { enrollment: e, message: 'Kaydınız tamamlandı, derslere başlayabilirsiniz' });
    }
    if (c.access === 'paid') {
      let o = await db.one('orders', `user_id=eq.${q(req.user.id)}&kind=eq.course&ref_id=eq.${q(id)}&status=eq.pending`);
      if (!o) o = await db.insert('orders', { user_id: req.user.id, kind: 'course', ref_id: id, amount_cents: c.price_cents || 0, currency: c.currency || 'TRY', provider: 'manual' });
      const e = await setEnrollment(id, req.user.id, 'pending', 'purchase', { message });
      return send(res, 200, { enrollment: e, order: { id: o.id, amount: money(o.amount_cents), currency: o.currency }, message: 'Çevrim içi ödeme yakında açılacak. Talebiniz kaydedildi; ödeme onaylanınca eğitim açılır.' });
    }
    const e = await setEnrollment(id, req.user.id, 'pending', 'request', { message });
    send(res, 200, { enrollment: e, message: 'Talebiniz öğretmene iletildi. Onaylayınca dersler açılacak.' });
  }, 'student');
  on('POST', '/api/courses/:id/cancel', async (req, res, { id }) => {
    const ex = await db.one('enrollments', `course_id=eq.${q(id)}&student_id=eq.${q(req.user.id)}&status=eq.pending`);
    if (!ex) return send(res, 404, { error: 'Bekleyen talep yok' });
    await db.remove('enrollments', `id=eq.${q(ex.id)}`);
    await db.update('orders', `user_id=eq.${q(req.user.id)}&kind=eq.course&ref_id=eq.${q(id)}&status=eq.pending`, { status: 'canceled' }).catch(() => {});
    send(res, 200, { ok: true });
  }, 'student');
  on('GET', '/api/me/courses', async (req, res) => {
    const es = await db.select('enrollments', `student_id=eq.${q(req.user.id)}&select=id,course_id,status,source,created_at,decided_at,expires_at&order=created_at.desc`);
    const cs = es.length ? await decorate(await db.select('courses', `id=in.${inList(es.map(e => e.course_id))}&select=${COURSE_PUB}`)) : [];
    const cm = Object.fromEntries(cs.map(c => [c.id, c]));
    const out = [];
    for (const e of es) {
      const c = cm[e.course_id]; if (!c) continue;
      const row = { enrollment: e, course: { id: c.id, title: c.title, subject: c.subject, access: c.access, status: c.status, lessons: c.lessons, teacher: c.teacher && { name: c.teacher.name, slug: c.teacher.slug } } };
      if (e.status === 'approved' && c.status === 'published') row.lessons = (await courseItems(c.id)).filter(p => p.status === 'delivered').map(p => ({ title: p.title, code: p.share_id, quiz: p.quiz_status === 'ready' }));
      out.push(row);
    }
    const at = await db.select('lesson_attempts', `student_id=eq.${q(req.user.id)}&select=project_id,summary,finished_at,started_at&order=started_at.desc&limit=200`);
    const ps = at.length ? await db.select('projects', `id=in.${inList(at.map(a => a.project_id))}&select=id,title,share_id`) : [];
    const pm = Object.fromEntries(ps.map(p => [p.id, p]));
    send(res, 200, { courses: out, results: at.map(a => ({ title: (pm[a.project_id] || {}).title, code: (pm[a.project_id] || {}).share_id, summary: a.summary ? { pct: a.summary.pct, correct: a.summary.correct, total: a.summary.total, learned: (a.summary.kazanimlar || []).filter(k => k.learned).length, kazanim: (a.summary.kazanimlar || []).length } : null, finished_at: a.finished_at, started_at: a.started_at })) });
  }, 'user');

  /* ---------- öğretmen: eğitimlerim ---------- */
  on('GET', '/api/my/courses', async (req, res) => {
    const cs = await db.select('courses', `teacher_id=eq.${q(req.user.id)}&status=neq.archived&select=*&order=updated_at.desc`);
    const cnt = await itemCounts(cs.map(c => c.id));
    const es = cs.length ? await db.select('enrollments', `course_id=in.${inList(cs.map(c => c.id))}&select=course_id,status`) : [];
    send(res, 200, cs.map(c => ({ ...c, lessons: cnt[c.id] || 0, students: es.filter(e => e.course_id === c.id && e.status === 'approved').length, pending: es.filter(e => e.course_id === c.id && e.status === 'pending').length })));
  });
  async function saveCourse(req, res, c) {
    const b = await readBody(req, 20000); const patch = {};
    if ('title' in b) { const t = String(b.title || '').trim(); if (t.length < 3) return send(res, 400, { error: 'Eğitim adı en az 3 karakter olmalı' }); patch.title = t.slice(0, 140); }
    for (const k of ['description', 'subject', 'level']) if (k in b) patch[k] = String(b[k] || '').trim().slice(0, k === 'description' ? 3000 : 80) || null;
    if ('visibility' in b) patch.visibility = b.visibility === 'unlisted' ? 'unlisted' : 'public';
    if ('access' in b) {
      patch.access = ['open', 'request', 'paid'].includes(b.access) ? b.access : 'request';
      if (patch.access === 'paid') {
        const lim = await activeLimits(req.user);
        if (!lim || !lim.limits.sell_courses) return send(res, 402, { error: 'Ücretli eğitim satmak için paketinizin buna izin vermesi gerekir (Öğretmen ya da Kurum paketi).' });
        const price = Math.round(+String(b.price ?? '').replace(',', '.') * 100);
        if (!(price >= 100)) return send(res, 400, { error: 'Ücretli eğitim için fiyat yazın (en az 1 TL)' });
        patch.price_cents = price;
      } else patch.price_cents = null;
    }
    if ('status' in b) patch.status = b.status === 'published' ? 'published' : 'draft';
    let items = null;
    if (Array.isArray(b.items)) {
      items = [...new Set(b.items.map(String))].slice(0, 100);
      if (items.length) {
        const own = await db.select('projects', `id=in.${inList(items)}&select=id,owner_id,share_id`);
        if (own.length !== items.length || (!isAdmin(req.user) && own.some(p => p.owner_id !== req.user.id))) return send(res, 400, { error: 'Yalnızca kendi videolarınızı ekleyebilirsiniz' });
        for (const p of own) if (!p.share_id) await db.update('projects', `id=eq.${q(p.id)}`, { share_id: shortId() });
      }
    }
    patch.updated_at = now();
    let row;
    if (c) row = await db.update('courses', `id=eq.${q(c.id)}`, patch);
    else { if (!patch.title) return send(res, 400, { error: 'Eğitim adı yazın' }); row = await db.insert('courses', { teacher_id: req.user.id, ...patch }); }
    if (items) {
      await db.remove('course_items', `course_id=eq.${q(row.id)}`);
      for (let i = 0; i < items.length; i++) await db.insert('course_items', { course_id: row.id, project_id: items[i], position: i });
    }
    if (row.status === 'published' && !(await itemCounts([row.id]))[row.id]) row = await db.update('courses', `id=eq.${q(row.id)}`, { status: 'draft' }), row.warning = 'Ders eklenmeden yayınlanamaz; taslak olarak kaydedildi';
    send(res, c ? 200 : 201, row);
  }
  on('POST', '/api/my/courses', (req, res) => saveCourse(req, res, null));
  on('GET', '/api/my/courses/:cid', async (req, res, { cid }) => {
    const c = await ownCourse(req, cid); if (!c) return send(res, 404, { error: 'Eğitim bulunamadı' });
    send(res, 200, { course: c, items: (await courseItems(cid)).map(p => ({ id: p.id, title: p.title, status: p.status, quiz: p.quiz_status })) });
  });
  on('POST', '/api/my/courses/:cid', async (req, res, { cid }) => {
    const c = await ownCourse(req, cid); if (!c) return send(res, 404, { error: 'Eğitim bulunamadı' }); return saveCourse(req, res, c);
  });
  on('DELETE', '/api/my/courses/:cid', async (req, res, { cid }) => {
    const c = await ownCourse(req, cid); if (!c) return send(res, 404, { error: 'Eğitim bulunamadı' });
    await db.update('courses', `id=eq.${q(cid)}`, { status: 'archived', updated_at: now() }); send(res, 200, { ok: true });
  });
  on('POST', '/api/my/courses/:cid/grant', async (req, res, { cid }) => {
    const c = await ownCourse(req, cid); if (!c) return send(res, 404, { error: 'Eğitim bulunamadı' });
    const b = await readBody(req, 2000); const email = String(b.email || '').trim().toLocaleLowerCase('tr');
    const s = await db.one('users', `email=eq.${q(email)}&role=eq.student&select=id,name`);
    if (!s) return send(res, 404, { error: 'Bu e-postayla kayıtlı öğrenci yok. Öğrencinin önce siteye kaydolması gerekir.' });
    const why = await canAddStudent(isAdmin(req.user) ? await teacherOf(c) : req.user, s.id); if (why) return send(res, 409, { error: why });
    await setEnrollment(cid, s.id, 'approved', 'teacher'); send(res, 200, { ok: true, name: s.name });
  });
  on('GET', '/api/my/requests', async (req, res) => {
    const cs = await db.select('courses', `teacher_id=eq.${q(req.user.id)}&select=id,title`);
    if (!cs.length) return send(res, 200, []);
    const es = await db.select('enrollments', `course_id=in.${inList(cs.map(c => c.id))}&select=*&order=created_at.desc&limit=1000`);
    const us = es.length ? await db.select('users', `id=in.${inList(es.map(e => e.student_id))}&select=id,name,email,school`) : [];
    const um = Object.fromEntries(us.map(u => [u.id, u])), cm = Object.fromEntries(cs.map(c => [c.id, c.title]));
    send(res, 200, es.map(e => ({ id: e.id, status: e.status, source: e.source, message: e.message, created_at: e.created_at, decided_at: e.decided_at, course: { id: e.course_id, title: cm[e.course_id] }, student: um[e.student_id] || null })));
  });
  on('POST', '/api/my/enrollments/:eid', async (req, res, { eid }) => {
    const b = await readBody(req, 2000);
    const e = await db.one('enrollments', `id=eq.${q(eid)}`); if (!e) return send(res, 404, { error: 'Talep bulunamadı' });
    const c = await ownCourse(req, e.course_id); if (!c) return send(res, 404, { error: 'Talep bulunamadı' });
    const act = b.action;
    if (act === 'approve') {
      if (e.source === 'purchase' && !isAdmin(req.user)) return send(res, 409, { error: 'Ücretli kayıtlar ödeme onaylanınca açılır' });
      const why = await canAddStudent(await teacherOf(c), e.student_id); if (why) return send(res, 409, { error: why });
      return send(res, 200, await db.update('enrollments', `id=eq.${q(eid)}`, { status: 'approved', decided_at: now() }));
    }
    if (act === 'reject') return send(res, 200, await db.update('enrollments', `id=eq.${q(eid)}`, { status: 'rejected', decided_at: now() }));
    if (act === 'revoke') return send(res, 200, await db.update('enrollments', `id=eq.${q(eid)}`, { status: 'revoked', decided_at: now() }));
    if (act === 'restore') return send(res, 200, await db.update('enrollments', `id=eq.${q(eid)}`, { status: 'approved', decided_at: now() }));
    send(res, 400, { error: 'Geçersiz işlem' });
  });
  // Paket değiştirme talebi → sipariş (ödeme gelince ya da yönetici onaylayınca etkinleşir)
  on('POST', '/api/my/plan', async (req, res) => {
    const b = await readBody(req, 2000);
    const plan = await db.one('plans', `code=eq.${q(b.code)}&active=is.true`); if (!plan) return send(res, 404, { error: 'Paket bulunamadı' });
    await db.update('orders', `user_id=eq.${q(req.user.id)}&kind=eq.plan&status=eq.pending`, { status: 'canceled' }).catch(() => {});
    const o = await db.insert('orders', { user_id: req.user.id, kind: 'plan', ref_id: plan.id, amount_cents: plan.price_cents || 0, currency: plan.currency, provider: 'manual' });
    send(res, 200, { order: o, message: 'Paket talebiniz alındı. Çevrim içi ödeme yakında; şimdilik yönetici onayıyla etkinleşir.' });
  });
  on('GET', '/api/my/orders', async (req, res) => send(res, 200, await db.select('orders', `user_id=eq.${q(req.user.id)}&order=created_at.desc&limit=50`)), 'user');

  /* ---------- yönetici ---------- */
  async function giveSubscription(userId, planId, days = 30) {
    await db.update('subscriptions', `user_id=eq.${q(userId)}&status=in.(active,trialing)`, { status: 'canceled' }).catch(() => {});
    return db.insert('subscriptions', { user_id: userId, plan_id: planId, status: 'active', provider: 'manual', current_period_end: days ? new Date(Date.now() + days * 864e5).toISOString() : null });
  }
  async function markPaid(o, provider = 'manual', ref = null) {
    await db.update('orders', `id=eq.${q(o.id)}`, { status: 'paid', paid_at: now(), provider, provider_ref: ref });
    if (o.kind === 'plan') await giveSubscription(o.user_id, o.ref_id, 30);
    if (o.kind === 'course') await setEnrollment(o.ref_id, o.user_id, 'approved', 'purchase');
  }
  ctx.markPaid = markPaid;
  on('GET', '/api/admin/users', async (req, res) => {
    const u = new URL(req.url, 'http://x'); const role = u.searchParams.get('role'), status = u.searchParams.get('status');
    let qs = `select=id,email,name,role,status,slug,school,subject,created_at,last_login&order=created_at.desc&limit=500`;
    if (role) qs += `&role=eq.${q(role)}`; if (status) qs += `&status=eq.${q(status)}`;
    const us = await db.select('users', qs);
    const subs = us.length ? await db.select('subscriptions', `user_id=in.${inList(us.map(x => x.id))}&status=in.(active,trialing)&select=user_id,plan_id,current_period_end`) : [];
    const plans = await db.select('plans', 'select=id,name,code'); const pm = Object.fromEntries(plans.map(p => [p.id, p]));
    const pc = {}; (await db.select('projects', 'select=owner_id&status=neq.archived')).forEach(p => { if (p.owner_id) pc[p.owner_id] = (pc[p.owner_id] || 0) + 1; });
    send(res, 200, us.map(x => { const s = subs.find(y => y.user_id === x.id); return { ...x, projects: pc[x.id] || 0, plan: s ? { ...pm[s.plan_id], until: s.current_period_end } : null }; }));
  }, 'admin');
  on('POST', '/api/admin/users/:uid', async (req, res, { uid }) => {
    const b = await readBody(req, 2000); const u = await db.one('users', `id=eq.${q(uid)}`); if (!u) return send(res, 404, { error: 'Kullanıcı yok' });
    if (u.id === req.user.id && ['suspend', 'reject'].includes(b.action)) return send(res, 400, { error: 'Kendi hesabınızı kapatamazsınız' });
    let out = { ok: true };
    switch (b.action) {
      case 'approve': {
        await db.update('users', `id=eq.${q(uid)}`, { status: 'active' });
        if (u.role === 'teacher' && !(await db.one('subscriptions', `user_id=eq.${q(uid)}&status=in.(active,trialing)&select=id`))) {
          const pilot = await db.one('plans', 'code=eq.pilot'); if (pilot) await giveSubscription(uid, pilot.id, 30);
        }
        break;
      }
      case 'reject': await db.update('users', `id=eq.${q(uid)}`, { status: 'rejected' }); await db.remove('sessions', `user_id=eq.${q(uid)}`); break;
      case 'suspend': await db.update('users', `id=eq.${q(uid)}`, { status: 'suspended' }); await db.remove('sessions', `user_id=eq.${q(uid)}`); break;
      case 'activate': await db.update('users', `id=eq.${q(uid)}`, { status: 'active' }); break;
      case 'reset_password': {
        const pw = Array.from(crypto.randomBytes(10), x => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');
        await db.update('users', `id=eq.${q(uid)}`, { pass_hash: auth.hashPassword(pw) }); await db.remove('sessions', `user_id=eq.${q(uid)}`);
        out.password = pw; break;
      }
      case 'set_plan': {
        const plan = await db.one('plans', `code=eq.${q(b.plan)}`); if (!plan) return send(res, 400, { error: 'Paket yok' });
        await giveSubscription(uid, plan.id, b.days === 0 ? 0 : (+b.days || 30)); break;
      }
      case 'make_teacher': await db.update('users', `id=eq.${q(uid)}`, { role: 'teacher', slug: u.slug || await auth.uniqueSlug(u.name) }); break;
      default: return send(res, 400, { error: 'Geçersiz işlem' });
    }
    auth.forgetUser(uid); send(res, 200, out);
  }, 'admin');
  on('GET', '/api/admin/projects', async (req, res) => {
    const ps = await db.select('projects', 'select=id,title,status,owner_id,share_id,updated_at&status=neq.archived&order=updated_at.desc&limit=500');
    const ts = await db.select('users', 'role=in.(teacher,admin)&select=id,name,email,status');
    send(res, 200, { projects: ps, owners: ts });
  }, 'admin');
  on('POST', '/api/admin/projects/:pid/owner', async (req, res, { pid }) => {
    const b = await readBody(req, 1000);
    const t = b.owner_id ? await db.one('users', `id=eq.${q(b.owner_id)}&role=in.(teacher,admin)&select=id`) : null;
    if (b.owner_id && !t) return send(res, 400, { error: 'Öğretmen bulunamadı' });
    await db.update('projects', `id=eq.${q(pid)}`, { owner_id: t ? t.id : null }); send(res, 200, { ok: true });
  }, 'admin');
  on('GET', '/api/admin/orders', async (req, res) => {
    const os = await db.select('orders', 'select=*&order=created_at.desc&limit=300');
    const us = os.length ? await db.select('users', `id=in.${inList(os.map(o => o.user_id))}&select=id,name,email`) : [];
    const plans = await db.select('plans', 'select=id,name'); const cs = os.some(o => o.kind === 'course') ? await db.select('courses', `id=in.${inList(os.filter(o => o.kind === 'course').map(o => o.ref_id))}&select=id,title`) : [];
    const name = Object.fromEntries([...plans.map(p => [p.id, p.name]), ...cs.map(c => [c.id, c.title])]); const um = Object.fromEntries(us.map(u => [u.id, u]));
    send(res, 200, os.map(o => ({ ...o, user: um[o.user_id] || null, item: name[o.ref_id] || '' })));
  }, 'admin');
  on('POST', '/api/admin/orders/:oid', async (req, res, { oid }) => {
    const b = await readBody(req, 1000); const o = await db.one('orders', `id=eq.${q(oid)}`); if (!o) return send(res, 404, { error: 'Sipariş yok' });
    if (b.action === 'paid') { if (o.status === 'paid') return send(res, 200, { ok: true }); await markPaid(o); return send(res, 200, { ok: true }); }
    if (b.action === 'cancel') {
      await db.update('orders', `id=eq.${q(oid)}`, { status: 'canceled' });
      if (o.kind === 'course') await db.update('enrollments', `course_id=eq.${q(o.ref_id)}&student_id=eq.${q(o.user_id)}&status=eq.pending`, { status: 'rejected', decided_at: now() }).catch(() => {});
      return send(res, 200, { ok: true });
    }
    send(res, 400, { error: 'Geçersiz işlem' });
  }, 'admin');
  on('POST', '/api/admin/plans/:pid', async (req, res, { pid }) => {
    const b = await readBody(req, 4000); const patch = {};
    if (b.name) patch.name = String(b.name).slice(0, 60);
    if ('price' in b) patch.price_cents = Math.max(0, Math.round(+String(b.price).replace(',', '.') * 100) || 0);
    if (b.limits && typeof b.limits === 'object') { const L = {}; for (const k of ['videos_per_month', 'max_seconds', 'students']) if (k in b.limits) L[k] = Math.max(0, +b.limits[k] | 0); if ('sell_courses' in b.limits) L.sell_courses = !!b.limits.sell_courses; const cur = await db.one('plans', `id=eq.${q(pid)}&select=limits`); patch.limits = { ...(cur && cur.limits), ...L }; }
    if ('active' in b) patch.active = !!b.active;
    send(res, 200, await db.update('plans', `id=eq.${q(pid)}`, patch));
  }, 'admin');
  on('GET', '/api/admin/summary', async (req, res) => {
    const [teachers, pendingT, students, courses, pendingO] = await Promise.all([
      db.count('users', 'role=eq.teacher&status=eq.active'), db.count('users', 'role=eq.teacher&status=eq.pending'), db.count('users', 'role=eq.student'),
      db.count('courses', 'status=eq.published'), db.count('orders', 'status=eq.pending')]);
    send(res, 200, { teachers, pendingTeachers: pendingT, students, courses, pendingOrders: pendingO, unowned: await db.count('projects', 'owner_id=is.null&status=neq.archived') });
  }, 'admin');
};
