# Şablon: MEKANİZMA / KESİT ANİMASYONU (referans: engine.py + engine_audio.py, "Motor nasıl çalışır?")
# Yeni mekanizma eklemek için: Mechanism sınıfından türetin (SECTIONS, angle, draw_machine, sound_events) ve MECHANISMS'e kaydedin.
import math
import numpy as np
from PIL import Image, ImageDraw
from common import (W, H, ACCENT, F, BOLD, MED, text_img, fit_font, put, pill, Caption, ease_out, ease_back, sstep,
                    flash, fade_black, follow_button, Timeline)

class Mechanism:
    key = ''; title = ''
    SECTIONS = {}           # anahtar → (varsayılan süre, açıklama)
    def __init__(self, plan, tl): self.plan = plan; self.tl = tl
    def angle(self, t): return 0.0
    def draw_machine(self, c, t, key, u): pass
    def overlay(self, c, t, key, u, s): pass
    def sound_events(self, mx): pass
    def preview_keys(self): return []

# =============== 4 ZAMANLI MOTOR ===============
CX = 540; YD = 700; R = 130; LROD = 360; BORE_L, BORE_R = 350, 730; YC = 1315
BLUE = (80, 170, 255); PURP = (150, 120, 255); FIRE = (255, 150, 40); SMOKE = (150, 150, 160)
NAMES = ['EMME', 'SIKIŞTIRMA', 'İŞ', 'EGZOZ']; COLS = [BLUE, PURP, FIRE, SMOKE]
IN_PORT = [(240, 560), (330, 566), (400, 610), (492, 700), (378, 700), (350, 668), (300, 648), (240, 646)]
EX_PORT = [(W - x, y) for x, y in IN_PORT]
IN_PATH = [(230, 605), (330, 610), (400, 650), (435, 705), (470, 780)]
EX_PATH = [(610, 780), (645, 705), (680, 650), (750, 610), (850, 605)]

def metal_grad(w, h, base, hi=1.35, lo=0.5):
    x = np.linspace(-1, 1, w, dtype=np.float32)
    prof = lo + (hi - lo) * np.clip(1 - np.abs(x + 0.25) ** 1.6, 0, 1)
    arr = np.asarray(base, np.float32)[None, None, :] * prof[None, :, None] * np.ones((h, 1, 1))
    a = np.full((h, w, 1), 255, np.float32)
    return Image.fromarray(np.clip(np.concatenate([arr, a], 2), 0, 255).astype(np.uint8), 'RGBA')

def make_bg():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    t = (y / H)[..., None]
    img = np.array([10, 16, 34], np.float32) * (1 - t) + np.array([4, 6, 14], np.float32) * t
    d = np.sqrt(((x - CX) / W) ** 2 + ((y - 950) / H) ** 2)
    img = img + np.array([30, 60, 110], np.float32) * np.exp(-d * 4.5)[..., None] * 0.6
    img[((x % 60) < 1.5) | ((y % 60) < 1.5)] += np.array([18, 30, 50], np.float32)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert('RGBA')

def hatch(im, poly, base):
    mask = Image.new('L', (W, H), 0); ImageDraw.Draw(mask).polygon(poly, fill=255)
    layer = Image.new('RGBA', (W, H), base + (255,)); d = ImageDraw.Draw(layer)
    for k in range(-H, W + H, 18): d.line([(k, 0), (k + H, H)], fill=tuple(int(c * 0.78) for c in base) + (255,), width=3)
    im.paste(layer, (0, 0), mask); ImageDraw.Draw(im).polygon(poly, outline=(190, 205, 225, 255))

def make_block():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); metal = (78, 90, 110)
    hatch(im, [(290, 700), (BORE_L, 700), (BORE_L, 1110), (290, 1110)], metal)
    hatch(im, [(BORE_R, 700), (790, 700), (790, 1110), (BORE_R, 1110)], metal)
    hatch(im, [(240, 520), (840, 520), (840, 700), (240, 700)], (88, 98, 122))
    d = ImageDraw.Draw(im)
    for port in (IN_PORT, EX_PORT): d.polygon(port, fill=(14, 18, 30, 255), outline=(190, 205, 225, 255))
    d.rectangle([BORE_L, 700, BORE_R, 1110], fill=(16, 22, 38, 255))
    d.line([(BORE_L + 2, 700), (BORE_L + 2, 1110)], fill=(170, 190, 220, 255), width=3)
    d.line([(BORE_R - 2, 700), (BORE_R - 2, 1110)], fill=(170, 190, 220, 255), width=3)
    for x0 in (430, 650): d.rectangle([x0 - 10, 520, x0 + 10, 600], fill=(14, 18, 30, 255))
    d.rectangle([524, 520, 556, 700], fill=(14, 18, 30, 255))
    cc = [(290, 1110), (790, 1110), (850, 1300), (820, 1540), (260, 1540), (230, 1300)]
    d.polygon(cc, fill=(12, 16, 28, 255)); d.line(cc + [cc[0]], fill=(110, 130, 160, 255), width=6)
    return im

def make_piston():
    w, h = 372, 150; p = metal_grad(w, h, (150, 160, 178)); d = ImageDraw.Draw(p)
    p.paste(metal_grad(w, 16, (200, 210, 225)), (0, 0))
    for y0 in (24, 40, 56): d.rectangle([0, y0, w, y0 + 6], fill=(40, 46, 60, 255))
    d.ellipse([w / 2 - 34, 46, w / 2 + 34, 114], fill=(70, 78, 96, 255), outline=(30, 34, 44, 255), width=4)
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=10, fill=255); p.putalpha(m)
    return p

def make_crank():
    s = 460; c = s // 2; im = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im); col = (96, 106, 126, 255)
    d.pieslice([c - 190, c - 190, c + 190, c + 190], 30, 150, fill=col)
    d.polygon([(c - 70, c), (c + 70, c), (c + 46, c - R), (c - 46, c - R)], fill=col)
    d.ellipse([c - 70, c - 70, c + 70, c + 70], fill=col); d.ellipse([c - 52, c - R - 52, c + 52, c - R + 52], fill=col)
    arr = np.asarray(im, np.float32); g = np.asarray(metal_grad(s, s, (1, 1, 1), hi=1.4, lo=0.7), np.float32)[..., :1]
    arr[..., :3] *= g; im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA')
    ImageDraw.Draw(im).ellipse([c - 44, c - 44, c + 44, c + 44], fill=(175, 185, 205, 255), outline=(40, 46, 60, 255), width=4)
    return im

def glow_img(rgb):
    g = np.zeros((420, 420, 4), np.float32); yy, xx = np.mgrid[0:420, 0:420]
    dd = np.sqrt((xx - 210) ** 2 + (yy - 210) ** 2) / 210
    g[..., 0], g[..., 1], g[..., 2] = rgb; g[..., 3] = np.clip(1 - dd, 0, 1) ** 2 * 255
    return Image.fromarray(g.astype(np.uint8), 'RGBA')

def path_pts(pts, s):
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]; d = s * sum(seg)
    for i, L in enumerate(seg):
        if d <= L: f = d / L; return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)
        d -= L
    return pts[-1]

RNG = np.random.default_rng(3); GAS = RNG.uniform(0, 1, (160, 2)); GPH = RNG.uniform(0, 6.28, 160)

class Engine4(Mechanism):
    key = '4zamanli'; title = '4 zamanlı benzinli motor (dizel bonus bölümüyle)'
    SECTIONS = {'intro': (5, 'Giriş: dönen motor, başlık'), 'parts': (5, 'Parçalar: piston, biyel, krank, supaplar, buji etiketleri'),
                'emme': (8, '1. zaman: emme'), 'sik': (8, '2. zaman: sıkıştırma'), 'is': (8, '3. zaman: iş (ateşleme)'),
                'egz': (8, '4. zaman: egzoz'), 'fast': (8, 'Hızlanan tam çevrim: 2 krank turu = 1 iş'),
                'dizel': (5, 'Bonus: dizelde buji yok, püskürtme'), 'outro': (5, 'Kapanış: 4 zaman özeti + Takip Et')}
    def __init__(self, plan, tl):
        super().__init__(plan, tl)
        self.BG = make_bg(); self.BLOCK = make_block(); self.PISTON = make_piston(); self.CRANK = make_crank()
        self.GLOW = glow_img((255, 190, 90)); self.GLOWB = glow_img((140, 200, 255))
        self.keys = [s['key'] for s in plan['scenes']]

    def angle(self, t):
        j, u = self.tl.at(t); k = self.keys[j]; d = self.tl.durs[j]
        if k == 'intro': return (u * 144 + 200) % 720
        if k == 'parts': return 100.0
        if k == 'emme': return 180 * sstep((u - 0.6) / max(1, d - 1.8))
        if k == 'sik': return 180 + 178 * sstep((u - 0.6) / max(1, d - 2.0))
        if k == 'is':
            if u < 0.8: return 358.0
            if u < 1.4: return 360.0
            return 360 + 180 * sstep((u - 1.4) / max(1, d - 4.8))
        if k == 'egz': return 540 + 180 * sstep((u - 0.6) / max(1, d - 1.8))
        if k == 'fast': return (360 * u + 67.5 * u * u) % 720
        if k == 'dizel': return 180 + 380 * sstep((u - 0.3) / max(1, d - 0.6))
        return (u * 144) % 720

    @staticmethod
    def kin(A):
        ph = math.radians(A % 360)
        pin = (CX + R * math.sin(ph), YC - R * math.cos(ph))
        py = YC - (R * math.cos(ph) + math.sqrt(LROD ** 2 - (R * math.sin(ph)) ** 2))
        return pin, py, py - 80
    @staticmethod
    def lifts(A):
        A %= 720
        li = math.sin(math.pi * A / 180) if A < 180 else 0
        le = math.sin(math.pi * (A - 540) / 180) if A >= 540 else 0
        return 45 * max(li, 0) ** 0.8, 45 * max(le, 0) ** 0.8
    @staticmethod
    def stroke_of(A):
        A %= 720; return 0 if A < 180 else 1 if A < 360 else 2 if A < 540 else 3
    @staticmethod
    def gas_state(A, diesel):
        A %= 720
        if A < 180: return BLUE, 0.15 + 0.45 * A / 180, A / 180
        if A < 360:
            col = tuple(int(BLUE[i] + (PURP[i] - BLUE[i]) * (A - 180) / 180) for i in range(3))
            if diesel: col = tuple(int(BLUE[i] + ((255, 120, 90)[i] - BLUE[i]) * ((A - 180) / 180) ** 3) for i in range(3))
            return col, 0.6 + 0.3 * (A - 180) / 180, 1.0
        if A < 540:
            k = (A - 360) / 180
            return tuple(int(FIRE[i] * (1 - k) + (200, 80, 50)[i] * k) for i in range(3)), 0.95 - 0.35 * k, 1.0
        k = (A - 540) / 180
        return SMOKE, 0.55 - 0.4 * k, 1 - k

    def draw_engine(self, c, t, A, diesel=False, dim=0.0):
        pin, ppin, ptop = self.kin(A); li, le = self.lifts(A); Am = A % 720
        c.alpha_composite(self.BLOCK)
        ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
        col, alpha, fill = self.gas_state(Am, diesel)
        d.rectangle([BORE_L + 4, YD, BORE_R - 4, ptop + 4], fill=col + (int(110 * alpha),))
        hgt = ptop - YD
        for k in range(int(160 * fill)):
            u, v = GAS[k]; ph = GPH[k]
            x = BORE_L + 12 + u * (BORE_R - BORE_L - 24) + 6 * math.sin(t * 7 + ph); y = YD + 6 + v * (hgt - 12) + 4 * math.cos(t * 6 + ph)
            r = 4 if Am < 360 else 5; d.ellipse([x - r, y - r, x + r, y + r], fill=col + (230,))
        if li > 4:
            for k in range(26):
                x, y = path_pts(IN_PATH, (k / 26 + t * 1.6) % 1); d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=BLUE + (240,))
            d.polygon(IN_PORT, fill=BLUE + (60,))
        if le > 4:
            for k in range(26):
                s = (k / 26 + t * 1.6) % 1; x, y = path_pts(EX_PATH, s); r = 5 + 4 * s
                d.ellipse([x - r, y - r, x + r, y + r], fill=SMOKE + (int(230 * (1 - 0.5 * s)),))
            d.polygon(EX_PORT, fill=SMOKE + (60,))
        c.alpha_composite(ov)
        if 359.5 <= Am < 470:
            k = (Am - 359.5) / 110.5
            put(c, self.GLOW.resize((int(300 + 400 * min(1, k * 3)),) * 2), CX, YD + 40, alpha=(1 - k) ** 1.5)
        vd = ImageDraw.Draw(c)
        for x0, L in ((435, li), (645, le)):
            yh = YD + L
            vd.rectangle([x0 - 8, 430 + L, x0 + 8, yh - 18], fill=(200, 208, 222, 255))
            vd.polygon([(x0 - 55, yh), (x0 + 55, yh), (x0 + 10, yh - 22), (x0 - 10, yh - 22)], fill=(200, 208, 222, 255), outline=(60, 66, 80, 255))
            top = 440 + L; pts = [(x0 + (26 if j % 2 else -26), top + (520 - top) * j / 8) for j in range(9)]
            vd.line(pts, fill=(255, 200, 61, 255), width=5); vd.rectangle([x0 - 32, top - 10, x0 + 32, top], fill=(170, 180, 198, 255))
        if not diesel:
            vd.rectangle([526, 450, 554, 520], fill=(235, 235, 240, 255)); vd.rectangle([530, 520, 550, 696], fill=(150, 156, 170, 255))
            vd.rectangle([534, 696, 546, 706], fill=(210, 210, 215, 255))
            if 359.5 <= Am < 372:
                put(c, self.GLOWB, CX, 712, alpha=1 - abs(Am - 362) / 11)
                rr = np.random.default_rng(int(t * 100)); pts = [(540, 706)] + [(540 + rr.uniform(-22, 22), 712 + j * 10) for j in range(5)]
                ImageDraw.Draw(c).line(pts, fill=(255, 255, 255, 255), width=4)
        else:
            vd.rectangle([528, 440, 552, 690], fill=(90, 150, 120, 255)); vd.polygon([(532, 690), (548, 690), (540, 704)], fill=(200, 220, 210, 255))
            if 345 <= Am < 380:
                k = (Am - 345) / 35; spray = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(spray)
                for side in (-1, 1): sd.polygon([(540, 704), (540 + side * 160 * k, 704 + 70 * k), (540 + side * 120 * k, 704 + 100 * k)], fill=(230, 240, 255, int(200 * (1 - k * 0.5))))
                c.alpha_composite(spray)
        cw = self.CRANK.rotate(-(A % 360), resample=Image.BICUBIC); c.alpha_composite(cw, (CX - cw.width // 2, YC - cw.height // 2))
        dx, dy = CX - pin[0], ppin - pin[1]; Ln = math.hypot(dx, dy); nx, ny = -dy / Ln, dx / Ln
        rod = [(pin[0] + nx * 30, pin[1] + ny * 30), (CX + nx * 20, ppin + ny * 20), (CX - nx * 20, ppin - ny * 20), (pin[0] - nx * 30, pin[1] - ny * 30)]
        vd = ImageDraw.Draw(c)
        vd.polygon(rod, fill=(138, 150, 172, 255), outline=(50, 56, 72, 255)); vd.line([rod[0], rod[1]], fill=(210, 220, 236, 255), width=4)
        vd.ellipse([pin[0] - 40, pin[1] - 40, pin[0] + 40, pin[1] + 40], fill=(150, 162, 184, 255), outline=(50, 56, 72, 255), width=4)
        vd.ellipse([pin[0] - 18, pin[1] - 18, pin[0] + 18, pin[1] + 18], fill=(80, 88, 106, 255))
        c.alpha_composite(self.PISTON, (CX - self.PISTON.width // 2, int(ptop)))
        ImageDraw.Draw(c).ellipse([CX - 20, ppin - 20, CX + 20, ppin + 20], fill=(210, 216, 228, 255), outline=(40, 44, 56, 255), width=3)
        if dim > 0: c.alpha_composite(Image.new('RGBA', (W, H), (4, 6, 16, int(255 * dim))))
        return pin, ppin, ptop

    def stroke_bar(self, c, A, a=1.0):
        s = self.stroke_of(A); f = F(BOLD, 30)
        for k in range(4):
            x0 = 70 + k * 240; on = k == s
            put(c, pill(220, 58, (COLS[k] + (255,)) if on else (255, 255, 255, 40), r=18), x0 + 110, 110, alpha=a)
            put(c, text_img(NAMES[k], f, ((15, 18, 28, 255) if on else (220, 226, 240, 255)), stroke=0), x0 + 110, 112, alpha=a)

    def title_block(self, c, u, chip, word, col, chip_col=None):
        a = ease_out((u - 0.05) / 0.35)
        if chip:
            sc = ease_back((u - 0.05) / 0.4); cf = fit_font(chip, BOLD, 40, 420)
            put(c, pill(max(260, cf.getlength(chip) + 60), 70, (chip_col or col) + (255,), r=22), W / 2, 225, alpha=a, scale=sc)
            put(c, text_img(chip, cf, (15, 18, 28, 255), stroke=0), W / 2, 227, alpha=a, scale=sc)
        put(c, text_img(word, fit_font(word, BOLD, 120 if len(word) < 9 else 100, 960), col + (255,), stroke=7), W / 2, 345,
            alpha=min(1, max(0, (u - 0.2) / 0.12)), scale=ease_back((u - 0.2) / 0.45), label=word)

    def callout(self, c, txt, pt, lab, a):
        if a <= 0: return
        d = ImageDraw.Draw(c)
        d.line([lab, pt], fill=ACCENT + (int(255 * a),), width=4); d.ellipse([pt[0] - 9, pt[1] - 9, pt[0] + 9, pt[1] + 9], fill=ACCENT + (int(255 * a),))
        im = text_img(txt, F(BOLD, 38), (255, 255, 255, 255), stroke=0); bx = pill(im.width + 30, 66, (12, 16, 30, 230), r=20)
        sc = 0.7 + 0.3 * ease_back(a)
        put(c, bx, lab[0], lab[1], alpha=a, scale=sc, label=txt); put(c, im, lab[0], lab[1] + 2, alpha=a, scale=sc)

    def draw_frame(self, c, t, j, u, s):
        k = s['key']; A = self.angle(t); diesel = k == 'dizel'
        dim = 0.45 if k in ('intro', 'outro') else 0.0
        pin, ppin, ptop = self.draw_engine(c, t, A, diesel, dim)
        if k == 'intro':
            t1, t2, t3 = s.get('title1', 'MOTOR NASIL'), s.get('title2', 'ÇALIŞIR?'), s.get('subtitle', '4 zamanlı benzinli motor')
            a = ease_out((u - 0.1) / 0.5); put(c, text_img(t1, fit_font(t1, BOLD, 128, 960), (255, 255, 255, 255), stroke=7), W / 2, 330, alpha=a, dy=-40 * (1 - a), label=t1)
            put(c, text_img(t2, fit_font(t2, BOLD, 190, 980), ACCENT + (255,), stroke=8), W / 2, 500, alpha=min(1, max(0, (u - 0.5) / 0.12)), scale=ease_back((u - 0.5) / 0.5), label=t2)
            if t3: put(c, text_img(t3, fit_font(t3, MED, 46, 940), (220, 230, 255, 255), stroke=3), W / 2, 650, alpha=ease_out((u - 0.9) / 0.4))
        elif k == 'parts':
            self.title_block(c, u, None, s.get('title', 'PARÇALAR'), ACCENT)
            lab = s.get('labels') or {}
            items = [(lab.get('emme_supabi', 'Emme supabı'), (420, 745), (200, 470)), (lab.get('egzoz_supabi', 'Egzoz supabı'), (660, 745), (885, 470)),
                     (lab.get('buji', 'Buji'), (540, 600), (540, 470)), (lab.get('silindir', 'Silindir'), (760, 900), (900, 830)),
                     (lab.get('piston', 'Piston'), (400, ptop + 70), (160, 920)), (lab.get('biyel', 'Biyel kolu'), ((CX + pin[0]) / 2 - 10, (ppin + pin[1]) / 2), (170, 1200)),
                     (lab.get('krank', 'Krank mili'), (CX + 20, YC + 40), (880, 1440))]
            gap = max(0.2, min(0.32, (self.tl.durs[j] - 1.5) / 7))
            for jj, (txt, pt, lb) in enumerate(items): self.callout(c, txt, pt, lb, ease_out((u - 0.3 - jj * gap) / 0.3))
        elif k in ('emme', 'sik', 'is', 'egz'):
            idx = ['emme', 'sik', 'is', 'egz'].index(k)
            self.stroke_bar(c, A if k != 'is' or u >= 1.4 else 360.5)
            self.title_block(c, u, f'{idx + 1}. ZAMAN', s.get('title') or (NAMES[idx] if idx != 2 else 'İŞ (ATEŞLEME)'), COLS[idx] if idx != 3 else (200, 205, 215))
        elif k == 'fast':
            self.stroke_bar(c, A); self.title_block(c, u, s.get('chip', 'TAM ÇEVRİM'), s.get('title', '2 TUR = 1 İŞ'), ACCENT, chip_col=(255, 255, 255))
            put(c, text_img(f'Krank turu: {int((360 * u + 67.5 * u * u) // 360)}', F(BOLD, 46), (255, 255, 255, 255), stroke=4), W / 2, 455)
        elif k == 'dizel':
            self.stroke_bar(c, A); self.title_block(c, u, 'BONUS', s.get('title', 'DİZEL MOTOR'), (120, 220, 170), chip_col=(120, 220, 170))
        elif k == 'outro':
            o1 = s.get('title', '4 ZAMAN')
            put(c, text_img(o1, fit_font(o1, BOLD, 150, 960), ACCENT + (255,), stroke=8), W / 2, 300, scale=ease_back(u / 0.45), alpha=min(1, u / 0.12))
            for jj in range(4):
                a = ease_out((u - 0.5 - jj * 0.15) / 0.3); x = 150 + jj * 260; sc = 0.6 + 0.4 * ease_back(a)
                put(c, pill(230, 70, COLS[jj] + (255,), r=22), x, 470, alpha=a, scale=sc)
                put(c, text_img(NAMES[jj], F(BOLD, 34), (15, 18, 28, 255), stroke=0), x, 472, alpha=a, scale=sc)
        if k == 'is' and 0.9 < u < 1.35:
            c.alpha_composite(Image.new('RGBA', (W, H), (255, 200, 120, int(120 * (1 - (u - 0.9) / 0.45)))))

    def preview_keys(self): return [('parts', 0.85), ('is', 0.2), ('fast', 0.6), ('outro', 0.7)]

    def sound_events(self, mx):
        from sound import SR, tt, midi
        N = mx.N; ts = np.arange(0, self.tl.total, 0.001)
        Araw = np.array([self.angle(t) for t in ts]); sect = [self.keys[self.tl.at(t)[0]] for t in ts]
        Am = np.interp(np.arange(N) / SR, ts, Araw) % 720
        li = np.where(Am < 180, np.sin(np.pi * Am / 180), 0).clip(0); le = np.where(Am >= 540, np.sin(np.pi * (Am - 540) / 180), 0).clip(0)
        moving = np.abs(np.gradient(np.interp(np.arange(N) / SR, ts, np.unwrap(Araw, period=720)))) * SR
        mov = np.clip(moving / 400, 0, 1); noise = mx.noise(N)
        mx.L += mx.filt(noise, 'band', [400, 2500]) * li * mov * 0.35; mx.R += mx.filt(noise, 'band', [400, 2500]) * li * mov * 0.25
        ex = mx.filt(mx.noise(N), 'low', 400) * le * mov; mx.L += ex * 0.6; mx.R += ex * 0.7
        ph = np.cumsum(np.clip(moving, 0, None) / 360 * 2) / SR
        hum = mx.filt(np.sin(2 * np.pi * ph * 4) * 0.6 + np.sin(2 * np.pi * ph * 8) * 0.3, 'low', 600) * np.clip(moving / 1500, 0, 1)
        mx.L += hum * 0.25; mx.R += hum * 0.25
        def thump(big):
            t = tt(0.6 if big else 0.25); f = 40 + 140 * np.exp(-t * 35)
            return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (6 if big else 18)) + mx.filt(mx.noise(len(t)), 'band', [800, 6000]) * np.exp(-t * 60) * 0.5
        def spark():
            t = tt(0.08); return mx.filt(mx.noise(len(t)), 'high', 4000) * np.exp(-t * 80)
        for i in range(1, len(ts)):   # her ateşlemede patlama (krank açısı 360° geçişi)
            a0, a1 = Araw[i - 1], Araw[i]
            if a1 >= a0: cross = a0 < 360 <= a1
            elif a0 - a1 > 400 and sect[i] == sect[i - 1]: cross = a0 < 360 or a1 >= 360
            else: cross = False
            if not cross: continue
            big = sect[i] not in ('intro', 'fast', 'outro')
            if sect[i] != 'dizel': mx.add(spark(), ts[i] - 0.01, 0.6 if big else 0.25)
            mx.add(thump(big), ts[i], 0.9 if big else 0.45)
        for i in range(1, len(ts)):   # supap tıkırtıları
            for edge in (0, 180, 540):
                a0, a1 = Araw[i - 1], Araw[i]
                if a0 < edge <= a1 and sect[i] == sect[i - 1] and moving[min(N - 1, int(ts[i] * SR))] < 3000:
                    mx.add(mx.click(2400 if edge != 540 else 1900), ts[i], 0.12)
        if 'fast' in self.keys:
            j = self.keys.index('fast'); a = self.tl.starts[j]
            t = tt(1.5); mx.add(mx.filt(mx.noise(len(t)), 'band', [800, 5000]) * (t / 1.5) ** 2, a - 1.5, 0.3)

MECHANISMS = {Engine4.key: Engine4}

class MechanismTemplate:
    name = 'mekanizma'
    def __init__(self, plan):
        self.plan = plan
        key = plan.get('mechanism', '4zamanli')
        if key not in MECHANISMS: raise ValueError(f'Bilinmeyen mekanizma: {key}. Hazır olanlar: {", ".join(MECHANISMS)}')
        self.tl = Timeline([s.get('dur', MECHANISMS[key].SECTIONS.get(s.get('key'), (5,))[0]) for s in plan['scenes']])
        self.mech = MECHANISMS[key](plan, self.tl)
        self.caps = [Caption(s.get('caption', ''), 0.6, s.get('dur', 5) - 0.8, s.get('words')) for s in plan['scenes']]

    def draw(self, t):
        j, u = self.tl.at(t); s = self.plan['scenes'][j]
        c = self.mech.BG.copy()
        self.mech.draw_frame(c, t, j, u, s)
        if s['key'] == 'outro':
            if u > 2.0: follow_button(c, u - 2.0, y=1330)
            fade_black(c, u, self.tl.durs[j] - 0.5, 0.5)
        self.caps[j].draw(c, u, cy=1600)
        if j > 0: flash(c, u, 0.22, 0.82)
        return c

    def preview_times(self):
        out = []; keys = [s['key'] for s in self.plan['scenes']]
        for k, f in self.mech.preview_keys():
            if k in keys: j = keys.index(k); out.append(self.tl.starts[j] + self.tl.durs[j] * f)
        while len(out) < 4: out.append(self.tl.total * (len(out) + 1) / 5)
        return out[:4]

    def sound(self, mx):
        st, du = self.tl.starts, self.tl.durs
        self.mech.sound_events(mx)
        n4 = max(1, int(self.tl.total // 4) + 1)
        mx.pad_bass([[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]], [k * 4.0 for k in range(n4)], [4.0] * n4, gain=0.16, bass=0.14, cutoff=1100)
        if len(st) > 2: mx.arp(st[2], st[-1], [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]])
        for a in st[1:]: mx.add(mx.whoosh(), a - 0.4, 0.45)
        mx.add(mx.ding(1318), st[-1] + 2.0, 0.18)
