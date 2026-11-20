# Şablon: BOYUT / ÖLÇEK KARŞILAŞTIRMA (referans: space.py + space_audio.py, "Dünya çok mu büyük?")
import os, math, pickle, hashlib
import numpy as np
from PIL import Image, ImageDraw
from common import (W, H, ACCENT, F, BOLD, MED, text_img, fit_font, put, pill, Caption, ease_out, ease_back, sstep,
                    fmt, fade_black, follow_button, Timeline)

KINDS = ['moon', 'mercury', 'mars', 'venus', 'earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun', 'sirius', 'arcturus', 'betel',
         'rock', 'ice', 'gas', 'star_white', 'star_yellow', 'star_orange', 'star_red', 'star_blue']
ALIAS = {'rock': 'moon', 'ice': 'uranus', 'gas': 'jupiter', 'star_white': 'sirius', 'star_blue': 'sirius', 'star_yellow': 'sun',
         'star_orange': 'arcturus', 'star_red': 'betel', 'pluto': 'mercury', 'ceres': 'moon'}
STARS = ('sun', 'sirius', 'arcturus', 'betel')

LAT = np.random.default_rng(5).uniform(-1, 1, (40, 40, 40)).astype(np.float32)
def n3(p):
    q = (p + 50) % 39; i = np.floor(q).astype(int); f = q - i; f = f * f * (3 - 2 * f); i1 = (i + 1) % 40
    def g(a, b, c): return LAT[(i1 if a else i)[..., 0], (i1 if b else i)[..., 1], (i1 if c else i)[..., 2]]
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    x00 = g(0,0,0) * (1 - fx) + g(1,0,0) * fx; x10 = g(0,1,0) * (1 - fx) + g(1,1,0) * fx
    x01 = g(0,0,1) * (1 - fx) + g(1,0,1) * fx; x11 = g(0,1,1) * (1 - fx) + g(1,1,1) * fx
    y0 = x00 * (1 - fy) + x10 * fy; y1 = x01 * (1 - fy) + x11 * fy
    return y0 * (1 - fz) + y1 * fz
def fbm3(p, o=5):
    s = 0; a = 1; t = 0
    for k in range(o): s = s + a * n3(p * (2 ** k) + k * 7.3); t += a; a *= 0.5
    return s / t
def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None]; return np.asarray(a, np.float32) * (1 - t) + np.asarray(b, np.float32) * t

def body(kind, S=640):
    """3B gölgeli küre dokusu (ışık sol üstten). Yıldızlar kendi ışığıyla parlar, Satürn halkalıdır."""
    kind = ALIAS.get(kind, kind)
    margin = 1.25 if kind == 'saturn' else 0.9 if kind in STARS else 0.08
    CW = int(S * (1 + 2 * margin)); c = CW / 2
    yy, xx = np.mgrid[0:CW, 0:CW].astype(np.float32)
    x = (xx - c) / (S / 2); y = (yy - c) / (S / 2); r2 = x * x + y * y
    inside = r2 <= 1; z = np.sqrt(np.clip(1 - r2, 0, 1)); P = np.stack([x, y, z], -1)
    Ld = np.array([-0.6, -0.35, 0.72]); Ld /= np.linalg.norm(Ld)
    diff = np.clip(P @ Ld, 0, 1); shade = (0.04 + 0.96 * diff ** 0.85)[..., None]
    emissive = False; atm = None; glow = None
    if kind in ('moon', 'mercury'):
        n = fbm3(P * 4); cr = fbm3(P * 11 + 3)
        col = mix((150, 150, 152) if kind == 'moon' else (150, 132, 118), (90, 88, 90), np.clip(n * 1.6 + 0.3, 0, 1)) * (0.8 + 0.4 * np.clip(cr + 0.4, 0, 1))[..., None]
    elif kind == 'mars':
        col = mix((200, 96, 52), (112, 52, 32), np.clip(fbm3(P * 3) * 2 + 0.4, 0, 1)); col = mix(col, (240, 236, 232), (np.abs(y) > 0.86) * 1.0)
    elif kind == 'venus':
        col = mix((236, 210, 150), (196, 160, 100), 0.5 + 0.5 * np.sin(y * 7 + fbm3(P * 2.5) * 4))
    elif kind == 'earth':
        n = fbm3(P * 2.2); n2 = fbm3(P * 5 + 9)
        col = mix((18, 62, 150), (30, 100, 190), z)
        col = np.where((n > 0.06)[..., None], mix((48, 118, 58), (150, 128, 76), np.clip(n2 * 2 + 0.5, 0, 1)), col)
        col = mix(col, (238, 242, 248), (np.abs(y) > 0.86) * 1.0)
        col = mix(col, (250, 250, 255), np.clip((fbm3(P * 4 + 20) - 0.02) * 3, 0, 0.9)); atm = (90, 160, 255)
    elif kind in ('jupiter', 'saturn', 'uranus', 'neptune'):
        n = fbm3(P * 3 + 5)
        if kind == 'jupiter':
            col = mix((236, 222, 200), (176, 122, 86), 0.5 + 0.5 * np.sin(y * 16 + n * 2.2)); col = mix(col, (222, 196, 160), 0.5 + 0.5 * np.sin(y * 5 + 1))
            col = mix(col, (200, 90, 60), np.clip(1.4 - (((x - 0.25) / 0.2) ** 2 + ((y - 0.38) / 0.11) ** 2), 0, 1))
        elif kind == 'saturn': col = mix((236, 214, 160), (196, 162, 108), 0.5 + 0.5 * np.sin(y * 12 + n * 1.2))
        elif kind == 'uranus': col = mix((170, 222, 230), (130, 200, 215), 0.5 + 0.5 * np.sin(y * 6 + n)); atm = (160, 230, 240)
        else:
            col = mix((70, 110, 220), (40, 70, 170), 0.5 + 0.5 * np.sin(y * 7 + n * 2))
            col = mix(col, (20, 30, 90), np.clip(1.3 - (((x + 0.2) / 0.14) ** 2 + ((y - 0.2) / 0.08) ** 2), 0, 1)); atm = (110, 150, 255)
    else:
        emissive = True
        pal = {'sun': ((255, 236, 140), (255, 140, 30), (255, 190, 80)), 'sirius': ((245, 250, 255), (170, 200, 255), (190, 215, 255)),
               'arcturus': ((255, 210, 140), (230, 110, 40), (255, 160, 80)), 'betel': ((255, 170, 110), (190, 50, 30), (255, 90, 50))}.get(kind, ((255, 236, 140), (255, 140, 30), (255, 190, 80)))
        g = fbm3(P * (14 if kind != 'betel' else 4)) + (0.6 * fbm3(P * 2) if kind == 'betel' else 0)
        col = mix(pal[1], pal[0], z ** 0.55 * (0.85 + 0.35 * g)); glow = pal[2]
    if not emissive: col = col * shade
    alpha = np.clip((1 - np.sqrt(r2)) * S / 2 + 0.5, 0, 1)
    out = np.concatenate([col, alpha[..., None] * 255], -1); out[~inside & (alpha <= 0)] = 0
    d = np.sqrt(r2)
    if atm is not None:
        rim = np.clip(1 - np.abs(d - 1) / 0.06, 0, 1) * np.clip(diff * 1.5 + 0.2, 0, 1); a = rim * 200
        o = out.copy(); o[..., :3] = np.where((a > 0)[..., None], mix(out[..., :3], atm, rim * 0.8), out[..., :3]); o[..., 3] = np.maximum(out[..., 3], a); out = o
    if glow is not None:
        ga = np.clip(np.exp(-(d - 1) * 3.2) * (d >= 1), 0, 1) * 230
        gl = np.zeros_like(out); gl[..., :3] = glow; gl[..., 3] = ga; a1 = out[..., 3:4] / 255
        out = np.concatenate([out[..., :3] * a1 + gl[..., :3] * (1 - a1), np.maximum(out[..., 3:4], gl[..., 3:4])], -1)
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')
    if kind == 'saturn':
        ring = Image.new('RGBA', (CW, CW), (0, 0, 0, 0)); rd = ImageDraw.Draw(ring)
        for r0, cc, a in [(2.25, (200, 180, 140), 150), (2.05, (226, 206, 160), 220), (1.75, (190, 170, 130), 200), (1.5, (160, 140, 110), 120)]:
            R0 = r0 * S / 2; rd.ellipse([c - R0, c - R0 * 0.28, c + R0, c + R0 * 0.28], fill=cc + (a,))
            Ri = (r0 - 0.18) * S / 2; rd.ellipse([c - Ri, c - Ri * 0.28, c + Ri, c + Ri * 0.28], fill=(0, 0, 0, 0))
        Ri = 1.25 * S / 2; rd.ellipse([c - Ri, c - Ri * 0.28, c + Ri, c + Ri * 0.28], fill=(0, 0, 0, 0))
        bm = Image.new('L', (CW, CW), 0); ImageDraw.Draw(bm).rectangle([0, 0, CW, c], fill=255)
        fm = Image.new('L', (CW, CW), 0); ImageDraw.Draw(fm).rectangle([0, c, CW, CW], fill=255)
        bk = Image.new('RGBA', (CW, CW), (0, 0, 0, 0)); bk.paste(ring, (0, 0), bm)
        fr = Image.new('RGBA', (CW, CW), (0, 0, 0, 0)); fr.paste(ring, (0, 0), fm)
        res = Image.new('RGBA', (CW, CW), (0, 0, 0, 0)); res.alpha_composite(bk); res.alpha_composite(img); res.alpha_composite(fr); img = res
    return img, CW / S

def make_stars():
    rng = np.random.default_rng(2); a = np.zeros((H, W, 3), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    band = np.exp(-((xx * 0.6 + yy * 0.5 - 1300) / 380) ** 2)
    a += np.array([30, 20, 60], np.float32) * band[..., None] * 0.7 + np.array([4, 6, 16], np.float32)
    for _ in range(1400):
        x, y = rng.integers(0, W), rng.integers(0, H); a[y, x] += rng.uniform(60, 255) * (rng.random() ** 2 * 0.8 + 0.2)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGBA'); d = ImageDraw.Draw(img)
    for _ in range(40):
        x, y = rng.integers(0, W), rng.integers(0, H); d.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], fill=(255, 255, 255, 255))
    return img

FOCUS_Y = 1010
CACHE_DIR = os.environ.get('SHORTS_CACHE', os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache'))

class Scale:
    name = 'karsilastirma'
    def __init__(self, plan):
        self.plan = plan; self.objs = plan['objects']; sc = plan['scenes']
        self.tl = Timeline([s.get('dur', 5) for s in sc])
        self.unit = plan.get('unit', 'km')
        self.X = []; cur = 0.0; g0 = int(plan.get('group', 5))
        for i, o in enumerate(self.objs):
            D = float(o['size']); span = D * (2.25 if o.get('kind') == 'saturn' else 1.0)
            gap = 0 if i == 0 else (0.35 * D if i < g0 else 0.12 * span)
            cx = cur + gap + span / 2; self.X.append(cx); cur = cx + span / 2
        self.focus = []
        for j, s in enumerate(sc):
            if s.get('type') == 'group': self.focus.append(('group', min(g0, len(self.objs)) - 1))
            else: self.focus.append((s.get('type', 'focus'), int(s.get('obj', len(self.objs) - 1))))
        self.caps = [Caption(s.get('caption', ''), 0.6, s.get('dur', 5) - 1.0, s.get('words')) for s in sc]
        self.imgs = None; self.stars = make_stars()

    def load(self):
        """Ağır küre dokuları bir kez hesaplanır ve diskte önbelleğe alınır (paralel işçiler aynı dosyayı okur)."""
        if self.imgs is not None: return
        os.makedirs(CACHE_DIR, exist_ok=True)
        key = hashlib.md5(','.join(o.get('kind', 'moon') for o in self.objs).encode()).hexdigest()[:10]
        p = os.path.join(CACHE_DIR, f'bodies-{key}.pkl')
        if os.path.exists(p):
            with open(p, 'rb') as f: self.imgs = pickle.load(f)
        else:
            self.imgs = [body(o.get('kind', 'moon')) for o in self.objs]
            with open(p + '.tmp', 'wb') as f: pickle.dump(self.imgs, f)
            os.replace(p + '.tmp', p)

    def cam_key(self, j):
        typ, i = self.focus[j]
        if typ == 'group':
            left = self.X[0] - self.objs[0]['size'] / 2; right = self.X[i] + self.objs[i]['size'] / 2
            return 940 / (right - left), (left + right) / 2, -self.objs[i]['size'] / 2
        D = float(self.objs[i]['size']); span = D * (2.25 if self.objs[i].get('kind') == 'saturn' else 1)
        s = min(0.62 * W / D, 0.94 * W / span)
        if typ == 'outro': s *= 0.55
        return s, self.X[i], -D / 2

    def camera(self, t):
        j, u = self.tl.at(t)
        s1, x1, y1 = self.cam_key(j)
        s0, x0, y0 = (s1, x1, y1) if j == 0 else self.cam_key(j - 1)
        e = sstep(u / min(self.tl.durs[j] * 0.6, 2.4 if self.focus[j][0] != 'outro' else 3.0))
        s = math.exp(math.log(s0) + (math.log(s1) - math.log(s0)) * e)   # logaritmik uzaklaşma
        w = (1 / s - 1 / s0) / (1 / s1 - 1 / s0) if abs(s1 - s0) > 1e-12 * max(s0, s1) else e
        return s, x0 + (x1 - x0) * w, y0 + (y1 - y0) * w, j, u

    def size_text(self, o):
        if o.get('size_text'): return o['size_text']
        return fmt(float(o['size'])) + ' ' + self.unit

    def draw(self, t):
        self.load()
        s, cx, cy, j, u = self.camera(t); typ, fi = self.focus[j]; sc = self.plan['scenes'][j]
        c = self.stars.copy(); d = ImageDraw.Draw(c); fl = F(MED, 32)
        for i, o in enumerate(self.objs):
            if i > fi: continue
            D = float(o['size']); appear = 1.0
            if typ == 'group': appear = ease_back((u - 0.3 - i * 0.35) / 0.45)
            elif i == fi and typ == 'focus': appear = ease_back((u - 0.15) / 0.6)
            if appear <= 0: continue
            sx = W / 2 + (self.X[i] - cx) * s; sy = FOCUS_Y + (-D / 2 - cy) * s
            dpx = D * s * appear; img, fac = self.imgs[i]; size = dpx * fac
            if sx + size / 2 < -50 or sx - size / 2 > W + 50: continue
            if dpx < 2.5:
                col = img.getpixel((img.width // 2, img.height // 2))[:3]; d.ellipse([sx - 1.6, sy - 1.6, sx + 1.6, sy + 1.6], fill=col + (255,))
            else:
                # Ekran dışına taşan dev nesnede yalnızca görünen bölge yeniden boyutlanır (bellek patlamaz)
                x0 = sx - size / 2; y0 = sy - size / 2; k = img.width / size
                vx0, vy0 = max(0, x0), max(0, y0); vx1, vy1 = min(W, x0 + size), min(H, y0 + size)
                if vx1 - vx0 >= 1 and vy1 - vy0 >= 1:
                    ix0, iy0 = int(math.ceil(vx0)), int(math.ceil(vy0)); ix1, iy1 = int(vx1), int(vy1)
                    if ix1 - ix0 >= 1 and iy1 - iy0 >= 1:
                        box = tuple(min(max(v, 0), img.width) for v in ((ix0 - x0) * k, (iy0 - y0) * k, (ix1 - x0) * k, (iy1 - y0) * k))
                        c.alpha_composite(img.resize((ix1 - ix0, iy1 - iy0), Image.LANCZOS if size < img.width else Image.BILINEAR, box=box), (ix0, iy0))
            if dpx > 70 or typ == 'group':
                ly = sy + dpx / 2 + 40
                if ly < 1400: put(c, text_img(o['name'], fl, (230, 236, 255, 255), stroke=3), sx, ly, alpha=min(1, max(0, appear)))
        if typ == 'group':
            t1, t2 = sc.get('title1', ''), sc.get('title2', '')
            a = ease_out((u - 0.1) / 0.5)
            if t1: put(c, text_img(t1, fit_font(t1, BOLD, 112, 960), (255, 255, 255, 255), stroke=7), W / 2, 270, alpha=a, dy=-30 * (1 - a), label=t1)
            if t2: put(c, text_img(t2, fit_font(t2, BOLD, 200, 980), ACCENT + (255,), stroke=8), W / 2, 440, alpha=min(1, max(0, (u - 0.45) / 0.12)), scale=ease_back((u - 0.45) / 0.5), label=t2)
        elif typ == 'focus':
            o = self.objs[fi]; a = ease_out((u - 0.3) / 0.4); nm = o['name'].upper()
            put(c, text_img(nm, fit_font(nm, BOLD, 116, 960), (255, 255, 255, 255), stroke=7), W / 2, 240, alpha=a, dy=30 * (1 - a), label=nm)
            lab = (sc.get('size_label') or self.plan.get('size_label') or 'Çap') + ': ' + self.size_text(o)
            put(c, text_img(lab, fit_font(lab, MED, 48, 940), (215, 225, 250, 255), stroke=3), W / 2, 350, alpha=ease_out((u - 0.5) / 0.4))
            if o.get('compare'):
                a3 = ease_back((u - 0.75) / 0.45); im = text_img(o['compare'], fit_font(o['compare'], BOLD, 46, 860), (20, 22, 30, 255), stroke=0)
                al = min(1, max(0, (u - 0.75) / 0.1))
                put(c, pill(im.width + 50, 80, ACCENT + (255,), r=26), W / 2, 450, alpha=al, scale=a3); put(c, im, W / 2, 452, alpha=al, scale=a3)
            if o.get('note'):
                from common import wrap_lines
                for li, line in enumerate(wrap_lines(o['note'], F(MED, 30), 880)): put(c, text_img(line, F(MED, 30), (190, 200, 225, 255), stroke=2), W / 2, 1400 + li * 40, alpha=ease_out((u - 1.2) / 0.4))
        else:
            o1, o2 = sc.get('title1', ''), sc.get('title2', '')
            a = ease_out((u - 0.2) / 0.5)
            if o1: put(c, text_img(o1, fit_font(o1, BOLD, 110, 960), (255, 255, 255, 255), stroke=7), W / 2, 250, alpha=a, label=o1)
            if o2: put(c, text_img(o2, fit_font(o2, BOLD, 74, 960), ACCENT + (255,), stroke=6), W / 2, 370, alpha=ease_out((u - 0.5) / 0.5), label=o2)
            if u > 3.0: follow_button(c, u - 3.0, y=1340)
            fade_black(c, u, self.tl.durs[j] - 0.6, 0.6)
        self.caps[j].draw(c, u, cy=1640)
        if j > 0 and u < 0.2: c.alpha_composite(Image.new('RGBA', (W, H), (255, 255, 255, int(150 * (1 - u / 0.2) ** 2))))
        return c

    def preview_times(self):
        st, du = self.tl.starts, self.tl.durs; n = len(du)
        idx = [0, max(1, n // 3), max(1, (2 * n) // 3), n - 1]
        return [st[k] + du[k] * (0.85 if k == 0 else 0.7) for k in idx]

    def sound(self, mx):
        st, du = self.tl.starts, self.tl.durs
        n5 = max(1, int(self.tl.total // 5) + 1)
        mx.drone([[50, 57, 62, 64], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64]], [k * 5.0 for k in range(n5)], [5.6] * n5)
        mx.bells(0.5, self.tl.total - 2)
        big = {j for j, (typ, i) in enumerate(self.focus) if typ == 'focus' and self.objs[i].get('kind') in STARS + ('star_yellow', 'star_red', 'star_orange', 'star_white', 'star_blue')}
        for j in range(1, len(du)):
            mx.add(mx.whoosh(min(2.4, du[j] * 0.5)), st[j] - 0.2, 0.35)
            mx.add(mx.boom(3.5 if j in big else 2.0), st[j] + 0.4, 0.55 if j in big else 0.35)
        if self.focus and self.focus[0][0] == 'group':
            for i in range(self.focus[0][1] + 1):
                mx.add(np.sin(2 * np.pi * 440 * 2 ** ((72 + [0, 2, 4, 7, 12, 14, 16][i % 7] - 69) / 12) * np.arange(int(0.5 * 44100)) / 44100) * np.exp(-np.arange(int(0.5 * 44100)) / 44100 * 8), 0.45 + i * 0.35, 0.15)
