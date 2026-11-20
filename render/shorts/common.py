# Shorts Stüdyosu — ortak çizim yardımcıları (Pillow + NumPy).
# Referans: kullanıcının render.py / engine.py / space.py dosyaları. Buradaki her şey şablonlarca paylaşılır.
import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1080, 1920, 30
ACCENT = (255, 200, 61)            # #FFC83D — aktif kelime ve vurgu rengi
CAP_Y = 1550                        # altyazı bandı (≈1420–1680); alt %15 ve sağ kenar Reels arayüzü
SAFE_X0, SAFE_X1 = 40, W - 120      # sağdaki beğen/yorum düğmeleri için 120 px boşluk

_HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIRS = [os.path.join(_HERE, 'fonts'), '/usr/share/fonts/truetype/google-fonts', '/usr/share/fonts/truetype/poppins']
FALLBACK = {'Poppins-Bold.ttf': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            'Poppins-Medium.ttf': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'}
BOLD, MED = 'Poppins-Bold.ttf', 'Poppins-Medium.ttf'
_fonts = {}
def F(name, size):
    k = (name, int(size))
    if k not in _fonts:
        for d in FONT_DIRS:
            p = os.path.join(d, name)
            if os.path.exists(p): _fonts[k] = ImageFont.truetype(p, int(size)); break
        else: _fonts[k] = ImageFont.truetype(FALLBACK[name], int(size))
    return _fonts[k]

def check_fonts():
    """Türkçe karakterlerin yazı tipinde bulunduğunu doğrular (ilk çalıştırmada)."""
    try:
        from fontTools.ttLib import TTFont
        for d in FONT_DIRS:
            p = os.path.join(d, BOLD)
            if os.path.exists(p):
                cm = TTFont(p).getBestCmap()
                miss = [c for c in 'çğıİöşüÇĞÖŞÜâî' if ord(c) not in cm]
                return 'Poppins' + (f' (eksik: {"".join(miss)})' if miss else ' — Türkçe tam')
    except Exception: pass
    return 'yedek yazı tipi (DejaVu)'

# ---------- uyarılar (taşan metin vb.) ----------
WARN = []
def warn(msg):
    if msg not in WARN: WARN.append(msg)

# ---------- yumuşatma ----------
def clamp(x, a=0.0, b=1.0): return min(max(x, a), b)
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_back(x):
    x = clamp(x); c1 = 1.70158; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
def sstep(x): x = clamp(x); return x * x * (3 - 2 * x)
def lerp(a, b, t): return np.asarray(a, np.float32) * (1 - t) + np.asarray(b, np.float32) * t
def fmt(n):
    if isinstance(n, float) and not n.is_integer(): return f"{n:,.1f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    return f"{int(round(n)):,}".replace(',', '.')

# ---------- metin ----------
_timg = {}
def text_img(txt, font, fill, stroke=5, sfill=(0, 0, 0), cache=True):
    key = (txt, id(font), fill, stroke, sfill)
    if cache and key in _timg: return _timg[key]
    l, t, r, b = font.getbbox(txt, stroke_width=stroke)
    im = Image.new('RGBA', (max(1, r - l + 30), max(1, b - t + 30)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((15 - l, 15 - t), txt, font=font, fill=fill, stroke_width=stroke, stroke_fill=sfill + (200,))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0))
    sh.putalpha(im.getchannel('A').point(lambda a: a * 0.55).filter(ImageFilter.GaussianBlur(9)))
    out = Image.new('RGBA', (im.width + 16, im.height + 16), (0, 0, 0, 0))
    out.alpha_composite(sh, (12, 14)); out.alpha_composite(im, (4, 4))
    if cache:
        if len(_timg) > 4000: _timg.clear()
        _timg[key] = out
    return out

def fit_font(txt, name, size, maxw, minsize=34):
    """Metin genişliği maxw'yi aşıyorsa yazı boyutunu küçültür (taşmayı önler)."""
    s = size
    while s > minsize and F(name, s).getlength(txt) > maxw: s -= 4
    if F(name, s).getlength(txt) > maxw: warn(f'Metin sığmıyor: “{txt[:40]}”')
    return F(name, s)

def put(canvas, im, cx, cy, alpha=1.0, scale=1.0, dy=0, label=None):
    if alpha <= 0.01 or scale <= 0.01: return
    if abs(scale - 1) > 1e-3:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BILINEAR)
    if alpha < 0.999:
        im = im.copy(); im.putalpha(im.getchannel('A').point(lambda a: int(a * alpha)))
    x0 = int(cx - im.width / 2); y0 = int(cy - im.height / 2 + dy)
    if label and alpha > 0.9 and abs(scale - 1) < 0.05 and (x0 < SAFE_X0 - 20 or x0 + im.width > W + 10):
        warn(f'Ekran dışına taşıyor: “{label[:40]}”')
    canvas.alpha_composite(im, (x0, y0))

def pill(w, h, fill, r=None):
    im = Image.new('RGBA', (max(1, int(w)), max(1, int(h))), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, int(w) - 1, int(h) - 1], radius=r if r else int(h) // 2, fill=fill)
    return im

def flash(canvas, u, dur=0.25, strength=0.85):
    """Sahne geçişinde beyaz flaş."""
    if 0 <= u < dur:
        canvas.alpha_composite(Image.new('RGBA', (W, H), (255, 255, 255, int(255 * (1 - u / dur) ** 2 * strength))))

def fade_black(canvas, u, start, length):
    if u > start:
        canvas.alpha_composite(Image.new('RGBA', (W, H), (0, 0, 0, int(255 * clamp((u - start) / length)))))

def follow_button(canvas, u, y=1500, text='TAKİP ET'):
    p = ease_back(u / 0.45) * (1 + 0.04 * math.sin(u * 8))
    put(canvas, pill(440, 116, (255, 60, 80, 255)), W / 2, y, scale=p)
    put(canvas, text_img(text, F(BOLD, 58), (255, 255, 255, 255), stroke=0), W / 2, y + 2, scale=p)

def top_shade(h=0.42, a=150):
    y = np.linspace(0, 1, H, dtype=np.float32)
    al = np.clip(1 - y / h, 0, 1) ** 1.6 * a
    arr = np.zeros((H, W, 4), np.uint8); arr[..., 3] = al[:, None].astype(np.uint8)
    return Image.fromarray(arr, 'RGBA')

def bottom_shade(a=150):
    y = np.linspace(0, 1, H, dtype=np.float32)
    al = np.clip((y - 0.62) / 0.38, 0, 1) ** 1.4 * a
    arr = np.zeros((H, W, 4), np.uint8); arr[..., 3] = al[:, None].astype(np.uint8)
    return Image.fromarray(arr, 'RGBA')

# ---------- karaoke altyazı ----------
class Caption:
    """Kelime kelime beliren altyazı. words: [(saniye, kelime)] (ElevenLabs zaman damgası) verilirse onu kullanır,
    yoksa kelimeleri t0–t1 arasına harf sayısına göre yayar."""
    def __init__(self, text, t0=0.8, t1=4.2, words=None, size=62):
        self.font = F(BOLD, size)
        if words:
            self.words = [w for _, w in words]
            ts = [float(t) for t, _ in words]
            self.times = np.array(ts + [ts[-1] + 0.6])
        else:
            self.words = (text or '').split()
            lens = np.array([len(w) + 2 for w in self.words] or [1], float)
            cum = np.concatenate([[0], np.cumsum(lens)]) / lens.sum()
            self.times = t0 + cum * max(0.5, t1 - t0)
        maxw = 880; lines = [[]]
        for i, wd in enumerate(self.words):
            test = ' '.join(self.words[j] for j in lines[-1] + [i])
            if lines[-1] and self.font.getlength(test) > maxw: lines.append([i])
            else: lines[-1].append(i)
        if len(lines) > 3:
            warn(f'Altyazı 3 satırı aşıyor: “{(text or " ".join(self.words))[:50]}…”')
        self.lines = [l for l in lines if l]
        self.lh = 84
        self.boxw = int(max([self.font.getlength(' '.join(self.words[i] for i in l)) for l in self.lines] or [10]) + 80)
        self.boxh = self.lh * max(1, len(self.lines)) + 46
        self.box = pill(self.boxw, self.boxh, (8, 10, 20, 165), r=34)
        self.end = float(self.times[-1])

    def cues(self, offset=0.0, per=6):
        """SRT için (başlangıç, bitiş, metin) parçaları."""
        out = []
        for a in range(0, len(self.words), per):
            b = min(len(self.words), a + per)
            out.append((offset + float(self.times[a]), offset + float(self.times[b] if b < len(self.times) else self.times[-1]), ' '.join(self.words[a:b])))
        return out

    def draw(self, canvas, t, cy=CAP_Y, fade=1.0):
        if not self.words or t < self.times[0] - 0.15: return
        a = ease_out((t - self.times[0] + 0.15) / 0.25) * fade
        put(canvas, self.box, W / 2, cy, alpha=a)
        y0 = cy - self.boxh / 2 + 23
        for li, line in enumerate(self.lines):
            full = ' '.join(self.words[i] for i in line); x = W / 2 - self.font.getlength(full) / 2
            for i in line:
                wd = self.words[i]; ts = self.times[i]; te = self.times[i + 1]
                if t >= ts:
                    cur = ts <= t < te + 0.05
                    col = ACCENT if cur else (255, 255, 255)
                    pop = ease_back((t - ts) / 0.18)
                    im = text_img(wd, self.font, col + (255,), stroke=4)
                    put(canvas, im, x + self.font.getlength(wd) / 2, y0 + li * self.lh + 40, alpha=min(1, (t - ts) / 0.08) * fade, scale=0.75 + 0.25 * pop)
                x += self.font.getlength(wd + ' ')

def srt_time(s):
    s = max(0, s); h = int(s // 3600); m = int(s % 3600 // 60); sec = s % 60
    return f"{h:02d}:{m:02d}:{int(sec):02d},{int(round((sec - int(sec)) * 1000)) % 1000:03d}"

def write_srt(cues, path):
    with open(path, 'w', encoding='utf-8') as f:
        for i, (a, b, txt) in enumerate(cues, 1):
            f.write(f"{i}\n{srt_time(a)} --> {srt_time(max(b, a + 0.3))}\n{txt}\n\n")

# ---------- zaman çizelgesi ----------
class Timeline:
    """Sahnelerin [başlangıç, bitiş) aralıkları."""
    def __init__(self, durs):
        self.durs = [float(d) for d in durs]
        self.starts = list(np.concatenate([[0], np.cumsum(self.durs)[:-1]]))
        self.total = float(sum(self.durs))
    def at(self, t):
        for j, (a, d) in enumerate(zip(self.starts, self.durs)):
            if t < a + d: return j, t - a
        j = len(self.durs) - 1; return j, t - self.starts[j]
