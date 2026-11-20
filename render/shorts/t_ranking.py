# Şablon: SIRALAMA / GERİ SAYIM (referans: render.py + audio.py, "Türkiye'nin en yüksek 10 dağı")
import math
import numpy as np
from PIL import Image, ImageDraw
from common import (W, H, ACCENT, F, BOLD, MED, text_img, fit_font, put, pill, Caption, ease_out, ease_back,
                    fmt, flash, fade_black, follow_button, top_shade, lerp, Timeline, CAP_Y)

PAL = {
 'day':    dict(top=(38,105,196), hor=(178,214,240), sun=(255,245,220), sunxy=(820,620), rock=(104,96,90), haze=(176,204,230), star=0),
 'sunset': dict(top=(58,30,92), hor=(255,128,70), sun=(255,190,120), sunxy=(260,900), rock=(96,62,70), haze=(214,118,100), star=0),
 'dusk':   dict(top=(14,24,62), hor=(96,116,176), sun=(170,190,255), sunxy=(800,820), rock=(64,68,90), haze=(102,118,166), star=120),
 'dawn':   dict(top=(42,52,112), hor=(255,170,128), sun=(255,215,170), sunxy=(300,820), rock=(112,92,98), haze=(228,156,146), star=30),
 'golden': dict(top=(26,58,122), hor=(255,204,128), sun=(255,236,180), sunxy=(250,760), rock=(122,96,76), haze=(238,190,140), star=0),
 'night':  dict(top=(4,6,22), hor=(34,46,96), sun=(120,140,230), sunxy=(540,900), rock=(36,40,62), haze=(44,56,104), star=260),
}
PAL_CYCLE = ['day', 'sunset', 'dusk', 'dawn', 'day', 'golden', 'dusk', 'sunset', 'dawn', 'golden']

# ---------- gürültü ----------
def vnoise(x, seed):
    vals = np.random.default_rng(seed).uniform(-1, 1, 8192).astype(np.float32)
    xi = np.floor(x).astype(np.int64); f = (x - xi).astype(np.float32); f = f * f * (3 - 2 * f)
    a = vals[xi % 8192]; b = vals[(xi + 1) % 8192]
    return a + (b - a) * f
def fbm(x, seed, octv=4):
    s = 0; amp = 1; tot = 0
    for i in range(octv):
        s = s + amp * vnoise(x * (2 ** i), seed + i * 17); tot += amp; amp *= 0.5
    return s / tot
def noise2d(w, h, seed, scales=(8, 16, 32, 64)):
    rng = np.random.default_rng(seed); acc = np.zeros((h, w), np.float32); tot = 0
    for i, sc in enumerate(scales):
        small = rng.uniform(0, 1, (max(2, h // sc), max(2, w // sc))).astype(np.float32)
        im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        a = 1.0 / (i + 1); acc += a * np.asarray(im, np.float32) / 255; tot += a
    return acc / tot

def make_sky(p, seed):
    y = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    t = np.clip(y / 0.62, 0, 1) ** 1.4
    sky = lerp(p['top'], p['hor'], t) * np.ones((1, W, 1), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32); sx, sy = p['sunxy']
    d = np.sqrt((xx - sx) ** 2 + (yy - sy) ** 2)
    glow = np.exp(-d / 330)[..., None] * 0.55 + np.exp(-d / 60)[..., None] * 0.5
    sky = sky + (np.asarray(p['sun'], np.float32) - sky) * np.clip(glow, 0, 1)
    if p['star']:
        rng = np.random.default_rng(seed); n = p['star']
        xs = rng.integers(1, W - 1, n); ys = rng.integers(1, int(H * 0.5), n); b = rng.uniform(0.4, 1.0, n)
        for x0, y0, bb in zip(xs, ys, b): sky[y0, x0] = sky[y0, x0] * (1 - bb) + 255 * bb
    return Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8)).convert('RGBA')

def ridge_layer(width, base, amp, freq, seed, ctop, cbot, height=H):
    x = np.arange(width, dtype=np.float32)
    yr = base - amp * (0.5 + 0.5 * fbm(x / freq + seed * 13.1, seed, 5))
    yy = np.arange(height, dtype=np.float32)[:, None]
    alpha = np.clip(yy - yr[None, :] + 0.5, 0, 1)
    t = np.clip((yy - yr.min()) / (height - yr.min()), 0, 1)[..., None]
    col = lerp(ctop, cbot, t) * np.ones((1, width, 1), np.float32)
    rgba = np.concatenate([col, alpha[..., None] * 255], axis=2)
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA'), yr

def make_hero(rel, kind, p, snow_h, seed, dark=False):
    """rel: 0–1 arası göreli yükseklik (en büyük değer = 1)."""
    HW = 1500; px = HW / 2; py = 1620 - rel * 820
    x = np.arange(HW, dtype=np.float32); dx = np.abs(x - px); rng = np.random.default_rng(seed)
    if kind == 'vol':
        de = np.maximum(dx - 22, 0)
        yr = py + 900 * (1 - np.exp(-de / 700)) + 5 * fbm(x / 30, seed) + 12 * fbm(x / 90, seed + 3)
    else:
        yr = py + 1.05 * dx ** 0.97
        for k in range(5):
            off = rng.uniform(140, 560) * rng.choice([-1, 1]); hh = rng.uniform(60, 260)
            yr = np.minimum(yr, py + hh + 1.15 * np.abs(x - px - off) ** 0.97)
        yr = yr + 32 * fbm(x / 55, seed + 5) + 10 * fbm(x / 13, seed + 9)
    pyr = yr.min()
    k = 41; yrs = np.convolve(np.pad(yr, k // 2, mode='edge'), np.ones(k) / k, mode='valid')
    lit_col = np.clip(0.5 - np.gradient(yrs) * 0.9, 0.06, 1.0).astype(np.float32)
    Y, X = np.mgrid[0:H, 0:HW].astype(np.float32)
    u = (X - px) / (np.maximum(Y - pyr, 1) + 40)
    stri = fbm(u * 7 + 100, seed + 21, 4); tex = fbm(X / 22 + Y / 70, seed + 31, 3)
    lit = lit_col[None, :] * np.ones((H, 1), np.float32)
    light = np.clip(0.22 + 0.78 * (0.62 * lit + 0.38 * (0.5 + 0.5 * stri)) + 0.07 * tex, 0, 1.15)[..., None]
    warm = (np.asarray(p['sun'], np.float32) - 128) * 0.12 * lit[..., None]
    rock = np.asarray(p['rock'], np.float32) * (0.45 + 0.9 * light) + warm
    sh = snow_h * (0.72 + 0.5 * fbm(u * 9 + 50, seed + 41, 4))
    snowm = np.clip((sh - (Y - pyr)) / 7, 0, 1)[..., None]
    snow = np.array([232, 240, 255], np.float32) * (0.5 + 0.5 * light) + warm * 0.6
    col = rock * (1 - snowm) + snow * snowm
    hz = (np.clip((Y - pyr) / 700, 0, 1) ** 1.5 * 0.55)[..., None]
    col = col * (1 - hz) + np.asarray(p['haze'], np.float32) * hz
    if dark: col = col * 0.55 + np.asarray(p['haze'], np.float32) * 0.1
    alpha = np.clip(Y - yr[None, :] + 0.5, 0, 1)[..., None] * 255
    return Image.fromarray(np.clip(np.concatenate([col, alpha], 2), 0, 255).astype(np.uint8), 'RGBA')

def make_fore(width, seed, base_y, col):
    img, yr = ridge_layer(width, base_y, 70, 260, seed, col, tuple(int(c * 0.5) for c in col))
    d = ImageDraw.Draw(img); rng = np.random.default_rng(seed + 7)
    for _ in range(70):
        xx = int(rng.uniform(0, width)); hgt = rng.uniform(50, 140); wdt = hgt * 0.32; yb = yr[min(xx, width - 1)] + 8
        for lvl in range(3):
            top = yb - hgt * (1 - lvl * 0.28); ww = wdt * (1 - lvl * 0.22)
            d.polygon([(xx, top), (xx - ww, yb - hgt * 0.25 * lvl + 6), (xx + ww, yb - hgt * 0.25 * lvl + 6)], fill=col + (255,))
        d.rectangle([xx - 4, yb - 2, xx + 4, yb + 18], fill=col + (255,))
    return img

def make_mist(width, seed, p):
    n = noise2d(width, 520, seed); yy = np.linspace(0, 1, 520, dtype=np.float32)[:, None]
    a = np.clip((n - 0.38) * 2.2, 0, 1) * np.sin(np.pi * yy) ** 2 * 150
    col = np.asarray(lerp(p['haze'], (255, 255, 255), 0.35), np.float32)
    rgba = np.concatenate([np.ones((520, width, 3), np.float32) * col, a[..., None]], 2)
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')

class MountainScenery:
    """Katmanlı paralaks dağ manzarası (gökyüzü, uzak sırt, ana zirve, sis, orta sırt, ağaçlı ön plan, kar)."""
    def __init__(self, rel, kind, pal, seed, dark=False):
        p = PAL.get(pal, PAL['day']); self.p = p
        self.sky = make_sky(p, seed)
        self.far, _ = ridge_layer(1400, 1230, 260, 230, seed + 1, tuple(int(v) for v in lerp(p['haze'], p['hor'], 0.35)), tuple(int(v) for v in lerp(p['haze'], p['rock'], 0.25)))
        self.hero = make_hero(rel, kind, p, 90 + 250 * rel, seed + 2, dark)
        self.mid, _ = ridge_layer(1400, 1520, 170, 200, seed + 3, tuple(int(v) for v in lerp(p['rock'], p['haze'], 0.45) * 0.8), tuple(int(v) for v in lerp(p['rock'], (10, 12, 18), 0.6)))
        self.fore = make_fore(1400, seed + 4, 1790, tuple(int(v) for v in lerp(p['rock'], (8, 10, 16), 0.82)))
        self.mist = make_mist(1700, seed + 5, p)
        rng = np.random.default_rng(seed + 9)
        self.flakes = np.stack([rng.uniform(0, W, 90), rng.uniform(0, H, 90), rng.uniform(1.5, 5, 90), rng.uniform(0.5, 1.6, 90)], 1)
    def frame(self, t, dur):
        e = 1 - (1 - min(1, t / dur)) ** 2
        c = self.sky.copy()
        c.alpha_composite(self.far, (int(-160 + 30 * e), 0)); c.alpha_composite(self.hero, (int(-210 + 25 * e), 0))
        c.alpha_composite(self.mist, (int(-310 + 150 * e), 1180)); c.alpha_composite(self.mid, (int(-200 + 90 * e), 0))
        c.alpha_composite(self.fore, (int(-260 + 200 * e), 0))
        s = 1.0 + 0.075 * e; cw, ch = W / s, H / s; cx, cy = 540, 1150
        box = (cx - cw * cx / W, cy - ch * cy / H, cx - cw * cx / W + cw, cy - ch * cy / H + ch)
        c = c.resize((W, H), Image.BILINEAR, box=box)
        d = ImageDraw.Draw(c)
        for fx, fy, r, sp in self.flakes:
            yy = (fy + t * 120 * sp) % H; xx = (fx + 30 * math.sin(t * 1.3 + fy)) % W
            d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=(255, 255, 255, 170))
        return c

class AbstractScenery:
    """Konu dağ değilse: paleti izleyen degrade, paralaks ışık parçacıkları, büyük soluk sıra numarası ve değer çubuğu."""
    def __init__(self, rel, rank, pal, seed, dark=False):
        p = PAL.get(pal, PAL['day']); self.p = p; self.rel = rel
        y = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
        top = lerp(p['top'], (6, 8, 18), 0.35 if not dark else 0.7); bot = lerp(p['hor'], p['top'], 0.55)
        bg = lerp(top, bot, y ** 1.2) * np.ones((1, W, 1), np.float32)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt((xx - 540) ** 2 + (yy - 1050) ** 2)
        bg = bg + np.asarray(p['sun'], np.float32) * np.exp(-d / 520)[..., None] * 0.28
        self.bg = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)).convert('RGBA')
        self.num = text_img(str(rank) if rank else '', F(BOLD, 900), (255, 255, 255, 34), stroke=0, cache=False) if rank else None
        rng = np.random.default_rng(seed)
        self.parts = [np.stack([rng.uniform(0, W, 50), rng.uniform(0, H, 50), rng.uniform(2, 7, 50) * k, rng.uniform(0.2, 1, 50)], 1) for k in (0.6, 1.0, 1.6)]
    def frame(self, t, dur):
        e = 1 - (1 - min(1, t / dur)) ** 2
        c = self.bg.copy(); d = ImageDraw.Draw(c)
        for li, layer in enumerate(self.parts):
            sp = (li + 1) * 18
            for x0, y0, r, a in layer:
                yy = (y0 - t * sp) % H; xx = x0 + 20 * math.sin(t * 0.6 + y0)
                d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=(255, 255, 255, int(40 + 90 * a)))
        if self.num is not None: put(c, self.num, W / 2 + 40 * e, 1080, alpha=0.9)
        return c

class Ranking:
    name = 'siralama'
    def __init__(self, plan):
        self.plan = plan; sc = plan['scenes']
        self.tl = Timeline([s.get('dur', 5) for s in sc])
        items = [s for s in sc if s.get('type') == 'item']
        self.vmax = max([abs(float(s.get('value') or 0)) for s in items] or [1]) or 1
        self.items = items; self.n = len(items)
        self.unit = plan.get('unit', '')
        self.bg = plan.get('bg', 'soyut')
        self.caps = [Caption(s.get('caption', ''), 0.9 if s.get('type') == 'item' else 1.2, s.get('dur', 5) - 0.8, s.get('words')) for s in sc]
        self.cache = {}; self.shade = top_shade()

    def scenery(self, j):
        if j in self.cache: return self.cache[j]
        if len(self.cache) > 2: self.cache.clear()
        s = self.plan['scenes'][j]; typ = s.get('type')
        if typ == 'item':
            k = self.items.index(s); pal = s.get('palette') or PAL_CYCLE[k % len(PAL_CYCLE)]
            rel = abs(float(s.get('value') or 0)) / self.vmax
        else:
            top = max(self.items, key=lambda x: abs(float(x.get('value') or 0))) if self.items else {}
            pal = 'night' if typ == 'intro' else 'golden'; rel = 1.0; k = 99
        if self.bg == 'dag':
            kind = s.get('kind') or ('vol' if k % 2 else 'jag')
            obj = MountainScenery(rel, kind, pal, 1000 + j * 37, dark=(typ == 'intro'))
        else:
            obj = AbstractScenery(rel, s.get('rank') if typ == 'item' else None, pal, 500 + j * 31, dark=(typ != 'item'))
        self.cache[j] = obj; return obj

    def value_text(self, s, k=1.0):
        if s.get('value_text') and k >= 1: return s['value_text']
        v = float(s.get('value') or 0); val = v * k
        return fmt(round(val, 1) if not float(v).is_integer() else int(round(val)))

    def draw(self, t):
        j, u = self.tl.at(t); s = self.plan['scenes'][j]; dur = self.tl.durs[j]; typ = s.get('type')
        c = self.scenery(j).frame(u, dur)
        if typ == 'intro': self.draw_intro(c, u, s, dur)
        elif typ == 'outro': self.draw_outro(c, u, s, dur)
        else: self.draw_item(c, u, s, dur)
        self.caps[j].draw(c, u)
        if j > 0: flash(c, u)
        if j == len(self.tl.durs) - 1: fade_black(c, u, dur - 0.4, 0.4)
        return c

    def draw_intro(self, c, u, s, dur):
        c.alpha_composite(self.shade)
        l1, l2, l3 = s.get('title_top', ''), s.get('title_main', ''), s.get('title_big', '')
        if l1: a = ease_out((u - 0.1) / 0.5); put(c, text_img(l1, fit_font(l1, BOLD, 84, 960), (255, 255, 255, 255)), W / 2, 360, alpha=a, dy=-40 * (1 - a), label=l1)
        if l2: a = ease_out((u - 0.4) / 0.5); put(c, text_img(l2, fit_font(l2, BOLD, 140, 960), (255, 255, 255, 255), stroke=6), W / 2, 500, alpha=a, scale=0.85 + 0.15 * a)
        if l3: p = ease_back((u - 0.8) / 0.5); put(c, text_img(l3, fit_font(l3, BOLD, 250, 980), ACCENT + (255,), stroke=8), W / 2, 700, alpha=min(1, max(0, (u - 0.8) / 0.15)), scale=p)
        if u > dur - 0.25: c.alpha_composite(Image.new('RGBA', (W, H), (255, 255, 255, int(255 * ((u - dur + 0.25) / 0.25) ** 2 * 0.8))))

    def draw_item(self, c, u, s, dur):
        c.alpha_composite(self.shade)
        idx = self.items.index(s); n = self.n
        d = ImageDraw.Draw(c)
        for k in range(n):
            r = 9 if k == idx else 6; x0 = W / 2 + (k - (n - 1) / 2) * 40
            d.ellipse([x0 - r, 110 - r, x0 + r, 110 + r], fill=(ACCENT + (255,)) if k <= idx else (255, 255, 255, 110))
        rank = s.get('rank', n - idx); name = s.get('name', ''); sub = s.get('sub'); place = s.get('place')
        ylay = dict(badge=230, name=370, sub=462, cnt=575 if sub else 545, place=715 if sub else 690)
        pb = ease_back((u - 0.12) / 0.4); a0 = min(1, max(0, (u - 0.12) / 0.15))
        put(c, pill(230, 140, ACCENT + (255,), r=36), W / 2, ylay['badge'], alpha=a0, scale=pb)
        put(c, text_img(f"#{rank}", F(BOLD, 96), (20, 22, 30, 255), stroke=0), W / 2, ylay['badge'] + 2, alpha=a0, scale=pb)
        a = ease_out((u - 0.35) / 0.4)
        put(c, text_img(name, fit_font(name, BOLD, 96 if len(name) < 14 else 84, 960), (255, 255, 255, 255)), W / 2, ylay['name'], alpha=a, dy=40 * (1 - a), label=name)
        if sub:
            a2 = ease_out((u - 0.5) / 0.4)
            put(c, text_img(sub, fit_font(sub, MED, 44, 940), (230, 236, 255, 255), stroke=3), W / 2, ylay['sub'], alpha=a2, dy=30 * (1 - a2), label=sub)
        if s.get('value') is not None or s.get('value_text'):
            k = ease_out((u - 0.55) / 1.45)
            if u > 0.5:
                ci = text_img(self.value_text(s, k), fit_font(self.value_text(s), BOLD, 140, 760), ACCENT + (255,), stroke=6)
                mimg = text_img(self.unit, F(BOLD, 70), ACCENT + (255,)) if self.unit else None
                total = ci.width + (mimg.width - 20 if mimg else 0)
                sc2 = 1.0 + 0.12 * max(0, 1 - abs(u - 2.05) / 0.18) if u > 1.9 else 1.0
                al = min(1, (u - 0.5) / 0.2)
                put(c, ci, W / 2 - total / 2 + ci.width / 2, ylay['cnt'], alpha=al, scale=sc2)
                if mimg: put(c, mimg, W / 2 + total / 2 - mimg.width / 2, ylay['cnt'] + 24, alpha=al)
        if place:
            a3 = ease_out((u - 0.8) / 0.4)
            if a3 > 0:
                ptxt = text_img(place, fit_font(place, MED, 40, 860), (255, 255, 255, 255), stroke=0); pw = ptxt.width + 70
                blk = Image.new('RGBA', (pw, 76), (0, 0, 0, 0)); blk.alpha_composite(pill(pw, 76, (10, 12, 22, 150)))
                pin = Image.new('RGBA', (40, 52), (0, 0, 0, 0)); pd = ImageDraw.Draw(pin)
                pd.ellipse([4, 2, 36, 34], fill=ACCENT + (255,)); pd.polygon([(8, 26), (32, 26), (20, 50)], fill=ACCENT + (255,)); pd.ellipse([14, 12, 26, 24], fill=(20, 22, 30, 255))
                blk.alpha_composite(pin, (22, 12)); blk.alpha_composite(ptxt, (62, int(38 - ptxt.height / 2)))
                put(c, blk, W / 2, ylay['place'], alpha=a3, dy=20 * (1 - a3), label=place)
        if s.get('note'):
            put(c, text_img(s['note'], fit_font(s['note'], MED, 30, 900), (220, 228, 250, 255), stroke=2), W / 2, 1330, alpha=ease_out((u - 1.2) / 0.4))

    def draw_outro(self, c, u, s, dur):
        c.alpha_composite(Image.new('RGBA', (W, H), (6, 8, 18, 175)))
        title = s.get('title') or 'SIRALAMA'
        put(c, text_img(title, fit_font(title, BOLD, 88, 960), ACCENT + (255,)), W / 2, 250, alpha=ease_out(u / 0.4))
        rows = sorted(self.items, key=lambda x: x.get('rank', 0))
        n = len(rows); rh = min(84, 900 / max(1, n)); fn = F(BOLD, 40 if n <= 10 else 32); fv = F(MED, 36 if n <= 10 else 28)
        for jj, it in enumerate(rows):
            tt = u - 0.25 - jj * 0.09; a = ease_out(tt / 0.35)
            if a <= 0: continue
            y = 380 + jj * rh
            nm = f"{it.get('rank')}. {it.get('name', '')}"
            if fn.getlength(nm) > 440:
                while len(nm) > 4 and fn.getlength(nm + '…') > 440: nm = nm[:-1]
                nm += '…'
            ni = text_img(nm, fn, (255, 255, 255, 255), stroke=0)
            put(c, ni, 70 + ni.width / 2, y, alpha=a)
            vi = text_img((it.get('value_text') or fmt(float(it.get('value') or 0))) + (' ' + self.unit if self.unit and not it.get('value_text') else ''), fv, (230, 236, 255, 255), stroke=0)
            bmax = max(80, min(300, W - 110 - 540 - vi.width - 10))
            bl = int(bmax * (abs(float(it.get('value') or 0)) / self.vmax) * ease_out(tt / 0.6))
            c.alpha_composite(pill(max(bl, 2), 30, (ACCENT + (255,)) if jj == 0 else (255, 255, 255, 200), r=15), (540, int(y - 13)))
            put(c, vi, 540 + bl + 10 + vi.width / 2, y + 2, alpha=a)
        if u > 2.6: follow_button(c, u - 2.6, y=CAP_Y - 160)
        fade_black(c, u, dur - 0.4, 0.4)

    # ---- önizleme: en kalabalık anlar ----
    def preview_times(self):
        st, du = self.tl.starts, self.tl.durs; last = len(du) - 1; mid = 1 + max(0, (len(du) - 2) // 2)
        return [st[0] + du[0] * 0.75, st[1] + du[1] * 0.6, st[mid] + du[mid] * 0.7, st[last] + du[last] * 0.75]

    # ---- ses ----
    def sound(self, mx):
        st, du = self.tl.starts, self.tl.durs; total = self.tl.total
        mx.pad_bass([[57, 60, 64], [53, 57, 60], [48, 55, 60, 64], [55, 59, 62]], st, du)
        last_item = max(1, len(du) - 2)
        riser_at = st[last_item] - 3.0
        mx.beat(du[0], st[-1], skip=(riser_at, st[last_item]), hats_from=du[0] + 5)
        mx.add(mx.whoosh(1.0), 0.0, 0.35)
        for j in range(1, len(du)): mx.add(mx.whoosh(), st[j] - 0.45, 0.5)
        mx.add(mx.impact(True), 0.8, 0.6)
        for j, s in enumerate(self.plan['scenes']):
            if s.get('type') != 'item': continue
            big = j == last_item
            mx.add(mx.impact(big), st[j] + 0.12, 0.75 if big else 0.55)
            mx.counter(st[j] + 0.55, st[j] + 1.95, ding_note=84 if big else 81)
        if riser_at > 1: mx.add(mx.riser(3.0), riser_at, 0.45)
        o = st[-1]
        for jj in range(self.n): mx.add(mx.tick(1200 + jj * 90), o + 0.25 + jj * 0.09, 0.15)
        mx.add(mx.ding(880 * 2 ** (7 / 12)), o + 2.6, 0.2)
        if self.bg == 'dag': mx.wind()
