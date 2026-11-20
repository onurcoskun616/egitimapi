# Şablon: TANITIM (terminal / "ajan" estetiği) — zaman çizelgesi, terminal pencereleri, oyun tarzı karakter seçimi,
# güç çubukları, büyük vurgulu cümle ve tarih/saat kapanış kartı. Yeşil-kehribar palet, matris yağmuru arka plan.
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageOps, ImageFilter
from common import (W, H, F, BOLD, text_img, fit_font, put, pill, Caption, ease_out, ease_back, sstep, clamp,
                    flash, fade_black, Timeline, warn, _HERE)

GREEN = (110, 231, 160); GREEN_D = (40, 120, 80); AMBER = (255, 200, 61); WHITE = (235, 240, 236); RED = (230, 70, 70)
BG = (7, 13, 11)
MONO = 'DejaVuSansMono.ttf'; MONOB = 'DejaVuSansMono-Bold.ttf'
_mf = {}
def M(size, bold=True):
    from PIL import ImageFont
    k = (bold, int(size))
    if k not in _mf:
        name = MONOB if bold else MONO
        for d in (os.path.join(_HERE, 'fonts'), '/usr/share/fonts/truetype/dejavu'):
            p = os.path.join(d, name)
            if os.path.exists(p): _mf[k] = ImageFont.truetype(p, int(size)); break
        else: _mf[k] = F(BOLD, size)
    return _mf[k]

def mtext(txt, size, col, bold=True, stroke=0):
    return text_img(txt, M(size, bold), col + (255,) if len(col) == 3 else col, stroke=stroke)

def fit_mono(txt, size, maxw, minsize=22, bold=True):
    s = size
    while s > minsize and M(s, bold).getlength(txt) > maxw: s -= 2
    if M(s, bold).getlength(txt) > maxw: warn(f'Metin sığmıyor: “{txt[:40]}”')
    return s

TINTS = [(70, 200, 190), (60, 120, 255), (255, 150, 90), (120, 220, 90), (225, 170, 80), (70, 190, 210), (240, 80, 120), (220, 80, 200), (150, 120, 255), (255, 220, 90)]

class Rain:
    """Matris yağmuru: yavaş akan soluk yeşil karakter sütunları."""
    CH = 'ABCDEFGHİJKLMNOPRSTUVYZ0123456789ÇĞÖŞÜ'
    def __init__(self, seed=3):
        rng = np.random.default_rng(seed); self.cols = []
        for x in range(10, W, 46):
            self.cols.append((x, rng.uniform(0, H), rng.uniform(40, 140), rng.integers(8, 22), ''.join(rng.choice(list(self.CH), 40)), rng.uniform(0.25, 1)))
        self.font = M(22, False)
        y = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
        base = np.array(BG, np.float32) * (1 - 0.35 * y) + np.array([4, 10, 8], np.float32) * y
        self.bg = Image.fromarray(np.clip(base * np.ones((1, W, 1)), 0, 255).astype(np.uint8)).convert('RGBA')
    def frame(self, t, strength=1.0):
        c = self.bg.copy()
        if strength <= 0: return c
        lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
        for x, y0, sp, n, chars, a in self.cols:
            head = (y0 + t * sp) % (H + 600) - 300
            for k in range(n):
                yy = head - k * 30
                if -30 < yy < H:
                    al = int(255 * a * strength * (0.5 if k == 0 else 0.22 * (1 - k / n)))
                    d.text((x, yy), chars[(k + int(t * 3)) % len(chars)], font=self.font, fill=(GREEN if k else (200, 255, 220)) + (al,))
        c.alpha_composite(lay); return c

def window(w, h, title, border=GREEN_D):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w - 1, h - 1], fill=(8, 22, 16, 235), outline=border + (255,), width=3)
    d.rectangle([0, 0, w - 1, 40], fill=(18, 52, 36, 255))
    d.text((14, 8), title, font=M(22, False), fill=(190, 240, 210, 255))
    for k, col in enumerate([(240, 90, 90), (240, 200, 70), (110, 220, 120)]):
        d.ellipse([w - 90 + k * 26, 13, w - 74 + k * 26, 29], fill=col + (255,))
    return im

def load_photo(url_or_path, cache_dir='/tmp/shorts-photos'):
    if not url_or_path: return None
    try:
        if url_or_path.startswith('http'):
            import urllib.request, hashlib
            os.makedirs(cache_dir, exist_ok=True)
            p = os.path.join(cache_dir, hashlib.md5(url_or_path.split('?')[0].encode()).hexdigest() + '.img')
            if not os.path.exists(p): urllib.request.urlretrieve(url_or_path, p)
            url_or_path = p
        return Image.open(url_or_path).convert('RGB')
    except Exception as e:
        warn(f'Fotoğraf açılamadı: {str(e)[:60]}'); return None

def duotone(img, tint, size):
    img = ImageOps.fit(img, (size, size), Image.LANCZOS, centering=(0.5, 0.35))
    g = ImageOps.autocontrast(ImageOps.grayscale(img), cutoff=1)
    dark = tuple(int(c * 0.12) for c in tint); light = tuple(min(255, int(c * 0.6 + 110)) for c in tint)
    out = ImageOps.colorize(g, dark, light, mid=tint).convert('RGBA')
    sl = Image.new('RGBA', out.size, (0, 0, 0, 0)); d = ImageDraw.Draw(sl)
    for y in range(0, size, 4): d.line([(0, y), (size, y)], fill=(0, 0, 0, 40))
    out.alpha_composite(sl); return out

def placeholder(name, tint, size):
    im = Image.new('RGBA', (size, size), tuple(int(c * 0.2) for c in tint) + (255,)); d = ImageDraw.Draw(im)
    d.ellipse([size * .3, size * .14, size * .7, size * .54], fill=tint + (255,)); d.ellipse([size * .14, size * .6, size * .86, size * 1.25], fill=tint + (255,))
    ini = ''.join(w[0] for w in (name or '?').split()[:2]).upper()
    put(im, mtext(ini, size * 0.18, (10, 20, 16)), size / 2, size * 0.34)
    return im

def glitch(img, t, amount):
    if amount <= 0: return img
    rng = np.random.default_rng(int(t * 60)); out = img.copy(); w, h = img.size
    for _ in range(int(6 + 18 * amount)):
        y = int(rng.uniform(0, h - 20)); hh = int(rng.uniform(4, 22)); dx = int(rng.uniform(-40, 40) * amount)
        band = img.crop((0, y, w, y + hh)); out.paste(band, (dx, y))
    d = ImageDraw.Draw(out)
    for _ in range(int(10 * amount)):
        x, y = rng.uniform(w * .25, w * .75), rng.uniform(h * .3, h * .7); s = rng.uniform(8, 22)
        d.rectangle([x, y, x + s, y + s], fill=tuple(int(v) for v in rng.uniform(80, 255, 3)) + (255,))
    return out

def hl_words(text):
    """*yıldızlı* kelimeler vurgulanır: [(kelime, vurgu mu)]"""
    out = []
    for w in (text or '').split():
        on = w.startswith('*') or w.endswith('*') or '*' in w
        out.append((w.replace('*', ''), on))
    return out

class Promo:
    name = 'tanitim'
    def __init__(self, plan):
        self.plan = plan; sc = plan['scenes']
        self.tl = Timeline([s.get('dur', 5) for s in sc])
        self.rain = Rain()
        self.caps = [Caption(s.get('caption', '') if s.get('type') != 'statement' else '', 0.4, s.get('dur', 5) - 0.6, s.get('words') if s.get('type') != 'statement' else None, size=50) for s in sc]
        self.stmt = {j: Caption(s.get('caption', ''), 0.3, s.get('dur', 5) - 0.6, s.get('words')) for j, s in enumerate(sc) if s.get('type') == 'statement'}
        self.cards = []
        for s in sc:
            if s.get('type') in ('roster',): self.cards += s.get('cards', [])
        self._ph = {}; self.channel = plan.get('channel', '')

    def photo(self, card, k, size):
        key = (k, size)
        if key not in self._ph:
            tint = TINTS[k % len(TINTS)]
            img = load_photo(card.get('photo_url') or card.get('photo'))
            self._ph[key] = duotone(img, tint, size) if img else placeholder(card.get('name', ''), tint, size)
        return self._ph[key]

    def draw(self, t):
        j, u = self.tl.at(t); s = self.plan['scenes'][j]; dur = self.tl.durs[j]; typ = s.get('type')
        c = self.rain.frame(t, 0.0 if typ == 'years' else 0.55 if typ in ('statement', 'finale') else 1.0)
        getattr(self, 'd_' + typ, self.d_statement)(c, u, s, dur, j)
        if typ != 'statement': self.caps[j].draw(c, u, cy=1560)
        if j > 0: flash(c, u, 0.15, 0.35)
        if j == len(self.tl.durs) - 1: fade_black(c, u, dur - 0.5, 0.5)
        return c

    # ---- sahne türleri ----
    def d_years(self, c, u, s, dur, j):
        items = s.get('items', []); n = max(1, len(items)); step = max(0.6, (dur - 1.2) / n)
        k = min(n - 1, int(u / step)); it = items[k] if items else {}; v = u - k * step
        last = k == n - 1
        col = GREEN if last else ((214, 196, 150) if k == 0 else (170, 200, 180))
        year = str(it.get('year', '')); a = ease_out(v / 0.35)
        put(c, mtext(year, fit_mono(year, 130 if not last else 110, 960), col), W / 2, 620, alpha=a, scale=0.9 + 0.1 * a)
        if it.get('label'): put(c, mtext(it['label'].upper(), 26, tuple(int(x * .8) for x in col), bold=False), W / 2, 720, alpha=a)
        if last and s.get('tag'): put(c, mtext('▮ ' + s['tag'].upper(), 26, AMBER), W / 2, 770, alpha=ease_out((v - 0.3) / 0.3))
        if last and s.get('statement'):
            st = s['statement'].upper(); p = ease_back((v - 0.6) / 0.4)
            put(c, mtext(st, fit_mono(st, 70, 960), GREEN), W / 2, 960, alpha=clamp((v - 0.6) / 0.15), scale=p)

    def d_terminal(self, c, u, s, dur, j):
        ch = s.get('channel') or self.channel
        if ch:
            chip = Image.new('RGBA', (520, 54), (0, 0, 0, 0)); d = ImageDraw.Draw(chip)
            d.rounded_rectangle([0, 0, 519, 53], radius=8, outline=GREEN + (255,), width=2, fill=(6, 20, 14, 220))
            d.ellipse([18, 20, 32, 34], fill=GREEN + (255,)); d.text((44, 12), ch.upper()[:26], font=M(26), fill=GREEN + (255,))
            c.alpha_composite(chip, (40, 60))
            if int(u * 2) % 2 == 0: put(c, mtext('● REC', 26, RED), W - 170, 87)
        wins = s.get('windows', []); y = 170; n = max(1, len(wins)); per = (dur - 0.4) / n
        for k, wd in enumerate(wins):
            t0 = 0.2 + k * per * 0.75
            if u < t0: break
            v = u - t0; kind = wd.get('kind', 'lines')
            h = 230 if kind in ('wave', 'approve') else min(520, 70 + 34 * max(3, len(wd.get('lines', []))) + (40 if wd.get('progress') else 0))
            win = window(880, h, wd.get('title', 'terminal'))
            d = ImageDraw.Draw(win); fn = M(25, False)
            if kind == 'lines':
                lines = wd.get('lines', []); cps = 55; shown = int(v * cps); used = 0
                for li, line in enumerate(lines):
                    if used >= shown: break
                    seg = line[:max(0, shown - used)]; used += len(line) + 6
                    done = used <= shown
                    yy = 56 + li * 34
                    col = GREEN if li == 0 and line.startswith('>') else (190, 240, 210)
                    d.text((20, yy), seg, font=fn, fill=col + (255,))
                    if done and wd.get('check', True) and not line.startswith('>'): d.text((830, yy), '✓', font=fn, fill=GREEN + (255,))
                if wd.get('progress'):
                    pr = clamp(v / max(0.5, per * 0.9)); d.rectangle([20, h - 34, 860, h - 18], outline=GREEN_D + (255,), width=2)
                    d.rectangle([22, h - 32, 22 + int(836 * pr), h - 20], fill=GREEN + (255,))
            elif kind == 'wave':
                d.text((20, 56), wd.get('label', ''), font=M(24), fill=AMBER + (255,))
                pts = [(20 + x, 150 + 46 * math.sin(x / 26 + v * 6) * (0.4 + 0.6 * abs(math.sin(x / 140 + v)))) for x in range(0, 840, 6)]
                d.line(pts, fill=GREEN + (255,), width=3)
            elif kind == 'approve':
                d.text((20, 60), wd.get('label', ''), font=M(24), fill=(190, 240, 210, 255))
                if v > 0.5: d.text((20, 110), '✓ ' + wd.get('status', 'ONAYLANDI'), font=M(48), fill=AMBER + (255,))
            put(c, win, W / 2, y + h / 2, alpha=ease_out(v / 0.25), scale=0.96 + 0.04 * ease_out(v / 0.25))
            y += h + 34
            if y > 1380: warn('Terminal pencereleri ekrana sığmıyor; satır sayısını azaltın'); break

    def d_roster(self, c, u, s, dur, j):
        cards = s.get('cards', []); n = max(1, len(cards))
        grid_t = 1.8 if s.get('grid_title') else 0
        per = max(0.8, (dur - grid_t - 0.2) / n)
        title = s.get('title', 'PLAYER SELECT')
        put(c, mtext(title, fit_mono(title, 64, 960), AMBER), W / 2, 220, alpha=ease_out(u / 0.3))
        base = self.cards.index(cards[0]) if cards and cards[0] in self.cards else 0
        if u < n * per or not grid_t:
            k = min(n - 1, int(u / per)); cd = cards[k] if cards else {}; v = u - k * per
            ph = self.photo(cd, base + k, 420)
            frame = Image.new('RGBA', (450, 450), (0, 0, 0, 0)); fd = ImageDraw.Draw(frame)
            fd.rectangle([0, 0, 449, 449], outline=GREEN + (255,), width=4); frame.alpha_composite(glitch(ph, u, max(0, 1 - v / 0.45)), (15, 15))
            for (x, yv, dx, dy) in [(40, 40, 1, 1), (410, 40, -1, 1), (40, 410, 1, -1), (410, 410, -1, -1)]:
                fd.line([(x, yv), (x + 30 * dx, yv)], fill=WHITE + (200,), width=3); fd.line([(x, yv), (x, yv + 30 * dy)], fill=WHITE + (200,), width=3)
            put(c, frame, W / 2, 560, alpha=ease_out(v / 0.15))
            nm = str(cd.get('name', '')).upper(); put(c, mtext(nm, fit_mono(nm, 76, 940), GREEN), W / 2, 860, alpha=ease_out((v - 0.1) / 0.25), label=nm)
            rl = str(cd.get('role', '')).upper()
            if rl: put(c, mtext(rl, fit_mono(rl, 40, 940), WHITE), W / 2, 935, alpha=ease_out((v - 0.2) / 0.25))
            stats = cd.get('stats') or {}
            for si, (lab, val) in enumerate(list(stats.items())[:4]):
                yy = 1010 + si * 52; put(c, mtext(str(lab).upper()[:10], 26, (190, 240, 210)), 170, yy)
                fill = clamp(float(val) / 100 if float(val) > 1 else float(val)) * ease_out((v - 0.25 - si * 0.08) / 0.4)
                dd = ImageDraw.Draw(c); dd.rectangle([300, yy - 12, 900, yy + 12], outline=GREEN_D + (255,), width=2)
                dd.rectangle([303, yy - 9, 303 + int(594 * fill), yy + 9], fill=GREEN + (255,))
            # alt şerit: bütün kartların küçükleri
            tw = min(100, 960 // max(1, len(self.cards)))
            for q, cq in enumerate(self.cards):
                x = W / 2 + (q - (len(self.cards) - 1) / 2) * (tw + 8)
                if q <= base + k:
                    put(c, self.photo(cq, q, tw).convert('RGBA'), x, 1290)
                dd = ImageDraw.Draw(c); on = q == base + k
                dd.rectangle([x - tw / 2 - 3, 1290 - tw / 2 - 3, x + tw / 2 + 3, 1290 + tw / 2 + 3], outline=(AMBER if on else (40, 70, 55)) + (255,), width=4 if on else 2)
        else:
            v = u - n * per; cols = 4; sz = 210
            for q, cq in enumerate(self.cards):
                r, col = divmod(q, cols); x = W / 2 + (col - (cols - 1) / 2) * (sz + 24); y = 520 + r * (sz + 70)
                a = ease_out((v - q * 0.05) / 0.25)
                put(c, self.photo(cq, q, sz), x, y, alpha=a); ImageDraw.Draw(c).rectangle([x - sz / 2 - 3, y - sz / 2 - 3, x + sz / 2 + 3, y + sz / 2 + 3], outline=GREEN + (int(255 * a),), width=3)
                put(c, mtext(str(cq.get('name', '')).upper()[:14], 22, (190, 240, 210)), x, y + sz / 2 + 24, alpha=a)
            gt = s['grid_title'].upper(); rows = (len(self.cards) + cols - 1) // cols
            put(c, mtext(gt, fit_mono(gt, 66, 960), AMBER), W / 2, 520 + rows * (sz + 70) + 40, scale=ease_back((v - 0.4) / 0.4), alpha=clamp((v - 0.4) / 0.1))

    def d_powerup(self, c, u, s, dur, j):
        title = s.get('title', 'POWER-UP!')
        put(c, mtext(title, fit_mono(title, 72, 960), AMBER), W / 2, 330, scale=ease_back(u / 0.4), alpha=clamp(u / 0.1))
        for k, b in enumerate(s.get('bars', [])[:5]):
            y = 520 + k * 150; v = u - 0.3 - k * 0.25; a = ease_out(v / 0.3)
            if a <= 0: continue
            put(c, mtext(str(b.get('label', '')).upper(), 34, (210, 245, 225)), 120 + M(34).getlength(str(b.get('label', '')).upper()) / 2 + 15, y - 34, alpha=a)
            vt = str(b.get('value', '∞')); put(c, mtext(vt, 40, AMBER), W - 150, y - 34, alpha=a)
            d = ImageDraw.Draw(c); d.rectangle([110, y, W - 120, y + 46], outline=AMBER + (int(255 * a),), width=3)
            d.rectangle([115, y + 5, 115 + int((W - 240) * ease_out(v / 0.8)), y + 41], fill=AMBER + (int(255 * a),))

    def d_statement(self, c, u, s, dur, j):
        cap = self.stmt.get(j)
        if not cap or not cap.words: return
        marks = {w: on for w, on in hl_words(s.get('caption', ''))}
        fn = M(56); x0, y = 80, 760; lh = 84; x = x0; maxw = W - 200
        for i, wd in enumerate(cap.words):
            clean = wd.replace('*', ''); ww = fn.getlength(clean + ' ')
            if x + fn.getlength(clean) > x0 + maxw: x = x0; y += lh
            if u >= cap.times[i] - 0.02:
                col = AMBER if (marks.get(clean) or '*' in wd) else WHITE
                put(c, mtext(clean, 56, col), x + fn.getlength(clean) / 2 + 15, y, alpha=min(1, (u - cap.times[i] + 0.05) / 0.12))
            x += ww
        if y > 1500: warn('Vurgulu cümle çok uzun; kısaltın')

    def d_finale(self, c, u, s, dur, j):
        title = s.get('title', '').upper()
        if title: put(c, mtext(title, fit_mono(title, 66, 960), GREEN), W / 2, 260, alpha=ease_out(u / 0.3))
        cols = 4; sz = 190; y0 = 470
        for q, cq in enumerate(self.cards):
            r, col = divmod(q, cols); x = W / 2 + (col - (cols - 1) / 2) * (sz + 26); y = y0 + r * (sz + 30)
            a = ease_out((u - 0.2 - q * 0.05) / 0.3); put(c, self.photo(cq, q, sz), x, y, alpha=a)
            ImageDraw.Draw(c).rectangle([x - sz / 2 - 3, y - sz / 2 - 3, x + sz / 2 + 3, y + sz / 2 + 3], outline=GREEN + (int(255 * a),), width=3)
        rows = (len(self.cards) + cols - 1) // cols if self.cards else 0; y = y0 + rows * (sz + 30) + 60
        if s.get('date'):
            dt = s['date'].upper(); put(c, mtext(dt, fit_mono(dt, 70, 960), GREEN), W / 2, y, alpha=ease_out((u - 0.6) / 0.3)); y += 110
        if s.get('time'):
            put(c, mtext(s['time'], fit_mono(s['time'], 120, 960), AMBER), W / 2, y, scale=ease_back((u - 0.9) / 0.4), alpha=clamp((u - 0.9) / 0.1)); y += 130
        if s.get('button') and u > 1.4 and int(u * 2) % 3 != 0: put(c, mtext('▶ ' + s['button'].upper(), 48, WHITE), W / 2, y)
        y += 110
        for li, line in enumerate(s.get('footer', [])[:3]):
            put(c, mtext(str(line), 30 if li == 0 else 24, GREEN if li == 0 else (170, 210, 190)), W / 2, y + li * 44, alpha=ease_out((u - 1.6) / 0.4))

    # ---- önizleme ve ses ----
    def preview_times(self):
        st, du = self.tl.starts, self.tl.durs; types = [s.get('type') for s in self.plan['scenes']]
        out = []
        for want, f in (('years', 0.92), ('terminal', 0.8), ('roster', 0.4), ('finale', 0.8)):
            if want not in types: continue
            k = types.index(want)
            if want == 'roster':   # bir kartın tam göründüğü an (geçiş anına denk gelmesin)
                sc = self.plan['scenes'][k]; n = max(1, len(sc.get('cards', [])))
                per = max(0.8, (du[k] - (1.8 if sc.get('grid_title') else 0) - 0.2) / n)
                out.append(st[k] + per * (min(1, n - 1) + 0.75))
            else: out.append(st[k] + du[k] * f)
        while len(out) < 4: out.append(self.tl.total * (len(out) + 1) / 5)
        return out[:4]

    def sound(self, mx):
        from sound import tt
        st, du = self.tl.starts, self.tl.durs
        n4 = max(1, int(self.tl.total // 4) + 1)
        mx.pad_bass([[45, 52, 57], [41, 48, 53], [43, 50, 55], [40, 47, 52]], [k * 4.0 for k in range(n4)], [4.0] * n4, gain=0.18, bass=0.18, cutoff=900)
        for j, s in enumerate(self.plan['scenes']):
            a, d = st[j], du[j]; typ = s.get('type')
            if j: mx.add(mx.whoosh(0.5), a - 0.3, 0.35)
            if typ == 'years':
                n = max(1, len(s.get('items', []))); step = max(0.6, (d - 1.2) / n)
                for k in range(n): mx.add(mx.impact(k == n - 1), a + k * step, 0.5 if k == n - 1 else 0.3)
            elif typ == 'terminal':
                for tk in np.arange(a + 0.3, a + d - 0.3, 0.07): mx.add(mx.click(1800 + 400 * mx.rng.random()), tk, 0.05, mx.rng.uniform(-.4, .4))
            elif typ == 'roster':
                n = max(1, len(s.get('cards', []))); per = max(0.8, (d - (1.8 if s.get('grid_title') else 0) - 0.2) / n)
                for k in range(n):
                    tg = tt(0.25); mx.add(mx.filt(mx.noise(len(tg)), 'band', [1500, 6000]) * np.exp(-tg * 14), a + k * per, 0.35)
                    mx.add(mx.ding(880 * 2 ** ((k % 5) / 12)), a + k * per + 0.3, 0.08)
                if s.get('grid_title'): mx.add(mx.impact(True), a + n * per + 0.4, 0.5)
            elif typ == 'powerup':
                mx.add(mx.riser(min(2.5, d)), a, 0.4)
                for k in range(len(s.get('bars', []))): mx.add(mx.ding(1318 * 2 ** (k * 4 / 12)), a + 0.3 + k * 0.25 + 0.8, 0.12)
            elif typ == 'finale':
                mx.add(mx.impact(True), a + 0.9, 0.6); mx.arp(a + 1.0, a + d - 0.3, [[57, 60, 64], [53, 57, 60]], 2.0, 0.125, 0.04)
