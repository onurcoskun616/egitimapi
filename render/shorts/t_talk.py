# Şablon: KONUŞAN KARAKTER — fotoğraftan çizilmiş karakter kameraya bakarak konuşur.
# Konuşma videoları (dudak senkronlu, fal.ai Kling Avatar) sunucuda üretilir; burada tam ekran arka plan olur,
# üstüne başlık, ad etiketi ve 2–4 kelimelik grup altyazı (Reels tarzı) çizilir.
# Önizlemede video henüz yoktur: karakter portresi hafif yakınlaşmayla gösterilir.
import os, math, shutil, subprocess, hashlib, urllib.request
import numpy as np
from PIL import Image, ImageDraw
from common import (W, H, F, BOLD, MED, ACCENT, text_img, put, pill, ease_out, ease_back, clamp,
                    fade_black, top_shade, bottom_shade, Timeline, warn, fit_font)

FPS = 30
VW, VH = 720, 1280          # videolar diske bu boyutta açılır (bellek/disk dostu), çizerken 1080x1920'ye büyütülür
CACHE = '/tmp/shorts-talk'

def _ffmpeg():
    p = shutil.which('ffmpeg')
    if p: return p
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def _fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    if not url.startswith('http'): return url
    p = os.path.join(CACHE, hashlib.md5(url.split('?')[0].encode()).hexdigest())
    if not os.path.exists(p):
        urllib.request.urlretrieve(url, p + '.part'); os.replace(p + '.part', p)
    return p

def cover(img, w, h, info=None):
    s = max(w / img.width, h / img.height)
    im = img.resize((max(w, int(img.width * s + 0.5)), max(h, int(img.height * s + 0.5))), Image.LANCZOS)
    x = (im.width - w) // 2; y = int((im.height - h) * 0.35)
    if info is not None: info.update(s=s, x=x, y=y, ow=img.width, oh=img.height)
    return im.crop((x, y, x + w, y + h))

def envelope(path, frm, to, fps=FPS):
    """Ses dosyasının kare başına (1/30 sn) ses yüksekliği."""
    r = subprocess.run([_ffmpeg(), '-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True)
    x = np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768
    a = int(max(0, frm or 0) * 16000); b = int(to * 16000) if to else len(x); x = x[a:b]
    hop = 16000 // fps; n = len(x) // hop
    if n < 1: return np.zeros(1, np.float32)
    return np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1))

class Groups:
    """Kelime zamanlarından 2–4 kelimelik, tek satırlık altyazı grupları (noktalamada grup biter)."""
    def __init__(self, text, words, dur, size=70):
        self.font = F(BOLD, size)
        if words: ws = [(float(t), w) for t, w in words]
        else:
            toks = (text or '').split(); n = max(1, len(toks))
            ws = [(0.2 + (dur - 0.6) * k / n, w) for k, w in enumerate(toks)]
        self.ws = ws; self.groups = []; cur = []
        for i, (t, w) in enumerate(ws):
            test = ' '.join(x[1] for x in cur + [(t, w)])
            if cur and (len(cur) >= 3 or self.font.getlength(test.upper()) > 860): self.groups.append(cur); cur = []
            cur.append((t, w))
            if w[-1:] in '.,!?;:…' and len(cur) >= 2: self.groups.append(cur); cur = []
        if cur: self.groups.append(cur)
        self.end = (ws[-1][0] + 0.7) if ws else 0

    def cues(self, offset=0.0, per=6):
        out = []
        for gi, g in enumerate(self.groups):
            a = g[0][0]; b = self.groups[gi + 1][0][0] if gi + 1 < len(self.groups) else self.end
            out.append((offset + a, offset + b, ' '.join(w for _, w in g)))
        return out

    def draw(self, c, u, cy):
        if not self.groups or u < self.groups[0][0][0] - 0.05: return
        gi = 0
        for k, g in enumerate(self.groups):
            if u >= g[0][0] - 0.05: gi = k
        g = self.groups[gi]; nxt = self.groups[gi + 1][0][0] if gi + 1 < len(self.groups) else self.end + 0.4
        if u > nxt + 0.2: return
        words = [w.upper() for _, w in g]; full = ' '.join(words)
        x = W / 2 - (self.font.getlength(full) + self.font.getlength(' ') * 0.6 * (len(words) - 1)) / 2; pop = ease_back((u - g[0][0] + 0.05) / 0.2)
        for k, (t, w) in enumerate(g):
            ww = words[k]; on = t <= u < (g[k + 1][0] if k + 1 < len(g) else nxt)
            im = text_img(ww, self.font, (ACCENT if on else (255, 255, 255)) + (255,), stroke=7)
            put(c, im, x + self.font.getlength(ww) / 2, cy, alpha=1 if u >= t else 0.0, scale=(0.85 + 0.15 * pop) * (1.06 if on else 1))
            x += self.font.getlength(ww) + self.font.getlength(' ') * 1.6

class Talk:
    name = 'konusan'
    def __init__(self, plan):
        self.plan = plan; sc = plan['scenes']
        self.tl = Timeline([s.get('dur', 6) for s in sc])
        self.caps = [Groups(s.get('caption', ''), s.get('words'), s.get('dur', 6)) for s in sc]
        self.ch = plan.get('character') or {}
        self.portrait = None; self.clips = [None] * len(sc)
        self.shade_t = top_shade(0.3, 170); self.shade_b = bottom_shade(190)
        self._title = {}
        self.voices = []; self.puppet = None; self.env = None

    def set_voices(self, voices):
        self.voices = list(voices or [])

    def build_env(self):
        """Ağız açıklığı (0–1), kare kare. Ses varsa sesten; yoksa (önizleme) kelime zamanlarından."""
        n = int(self.tl.total * FPS) + 2; env = np.zeros(n, np.float32)
        if self.voices:
            for v in self.voices:
                try:
                    e = envelope(v[0], v[2] if len(v) > 2 else 0, v[3] if len(v) > 3 else None)
                    i = int(round(float(v[1]) * FPS)); e = e[:max(0, n - i)]; env[i:i + len(e)] = np.maximum(env[i:i + len(e)], e)
                except Exception as ex: warn(f'Ses okunamadı (ağız animasyonu): {str(ex)[:60]}')
            ref = np.percentile(env[env > 1e-4], 92) if (env > 1e-4).any() else 1
            env = np.clip((env / max(ref, 1e-4) - 0.12) / 0.75, 0, 1) ** 0.8
        else:
            for j, cap in enumerate(self.caps):
                st = self.tl.starts[j]
                for k, (t, w) in enumerate(cap.ws):
                    t1 = cap.ws[k + 1][0] if k + 1 < len(cap.ws) else t + 0.5
                    a, b = int((st + t) * FPS), int((st + min(t1, t + 0.15 * len(w) + 0.2)) * FPS)
                    for f in range(a, min(n, b)): env[f] = max(env[f], 0.55 + 0.4 * abs(math.sin((f - a) * 1.7)))
        # yumuşatma: hızlı açılır, biraz daha yavaş kapanır
        out = np.zeros_like(env); v = 0.0
        for i, x in enumerate(env):
            v = v + (x - v) * (0.65 if x > v else 0.4); out[i] = v
        self.env = out
        # konuşma var mı (baş hareketi için daha yavaş zarf)
        k = np.ones(15) / 15; self.talk = np.convolve((out > 0.08).astype(np.float32), k, 'same')
        rng = np.random.default_rng(11); bl = []; t = 1.2
        while t < self.tl.total: bl.append(t); t += rng.uniform(2.4, 4.8)
        self.blinks = bl

    def load(self):
        src = self.ch.get('portrait_url') or self.ch.get('portrait') or self.ch.get('photo_url')
        if src:
            try: info = {}; self.portrait = cover(Image.open(_fetch(src)).convert('RGB'), W, H, info)
            except Exception as e: warn(f'Karakter portresi açılamadı: {str(e)[:60]}')
        if not self.portrait: warn('Karakter portresi yok (önizlemeyi yenileyin)')
        need = self.portrait is not None and any(not s.get('video_url') for s in self.plan['scenes'])
        if need:   # ücretsiz mod: portreden kodla konuşan kukla
            from puppet import Puppet, detect_face, guess_face
            mo = self.ch.get('mouth')
            manual = (mo[0] * info['ow'] * info['s'] - info['x'], mo[1] * info['oh'] * info['s'] - info['y']) if mo else None
            face, err = detect_face(self.portrait)
            if face and manual and (abs(face['mc'][0] - manual[0]) > face['mw'] or abs(face['mc'][1] - manual[1]) > face['mw']):
                face = None   # kullanıcının işareti otomatiğe baskın
            if not face:
                face = guess_face(self.portrait, manual)
                if not manual: warn(f'Ağız otomatik bulunamadı ({err}); karakter kartında portrede ağzın ortasına tıklayın')
            self.face = face; self.puppet = Puppet(self.portrait, face)
            self.build_env()
        for j, s in enumerate(self.plan['scenes']):
            u = s.get('video_url')
            if not u: continue
            try:
                src = _fetch(u); raw = src + f'.{VW}x{VH}.rgb'
                if not os.path.exists(raw):
                    r = subprocess.run([_ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-an', '-vf',
                                        f'scale={VW}:{VH}:force_original_aspect_ratio=increase,crop={VW}:{VH},fps={FPS}',
                                        '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw + '.part'], capture_output=True, text=True)
                    if r.returncode != 0: raise RuntimeError(r.stderr[-300:])
                    os.replace(raw + '.part', raw)
                n = os.path.getsize(raw) // (VW * VH * 3)
                if n < 1: raise RuntimeError('boş video')
                self.clips[j] = (raw, n)
            except Exception as e:
                warn(f'Sahne {j + 1} konuşma videosu açılamadı: {str(e)[:80]}')

    def frame(self, j, u):
        cl = self.clips[j]
        if cl:
            raw, n = cl
            mm = np.memmap(raw, dtype=np.uint8, mode='r', shape=(n, VH, VW, 3))
            k = min(n - 1, max(0, int(u * FPS)))
            return Image.fromarray(np.array(mm[k])).resize((W, H), Image.BICUBIC).convert('RGBA')
        if self.puppet:
            t_abs = self.tl.starts[j] + u; f = min(len(self.env) - 1, int(t_abs * FPS))
            bl = 0.0
            for b in self.blinks:
                if b <= t_abs < b + 0.18: bl = math.sin(math.pi * (t_abs - b) / 0.18)
            return self.puppet.render(float(self.env[f]), bl, t_abs, float(self.talk[f])).convert('RGBA')
        if self.portrait:   # önizleme / yedek: portre, çok hafif yakınlaşma
            z = 1 + 0.035 * clamp(u / max(1, self.tl.durs[j]))
            w, h = int(W * z), int(H * z); im = self.portrait.resize((w, h), Image.BILINEAR)
            x, y = (w - W) // 2, int((h - H) * 0.3)
            return im.crop((x, y, x + W, y + H)).convert('RGBA')
        c = Image.new('RGBA', (W, H), (24, 28, 40, 255)); d = ImageDraw.Draw(c)
        d.ellipse([W * .3, H * .22, W * .7, H * .45], fill=(70, 80, 110, 255)); d.ellipse([W * .15, H * .48, W * .85, H * .9], fill=(70, 80, 110, 255))
        return c

    def title_img(self, txt):
        if txt not in self._title:
            f = fit_font(txt, BOLD, 60, 900, 36)
            im = text_img(txt, f, (255, 255, 255, 255), stroke=0)
            box = pill(im.width + 70, im.height + 40, (0, 0, 0, 150), r=28); box.alpha_composite(im, (35, 20))
            self._title[txt] = box
        return self._title[txt]

    def draw(self, t):
        j, u = self.tl.at(t); s = self.plan['scenes'][j]; dur = self.tl.durs[j]
        c = self.frame(j, u)
        c.alpha_composite(self.shade_b)
        title = (s.get('title') or '').strip()
        if title:
            c.alpha_composite(self.shade_t)
            put(c, self.title_img(title), W / 2, 250, alpha=ease_out(u / 0.35), dy=(1 - ease_out(u / 0.35)) * -30, label=title)
        name = (self.ch.get('name') or '').strip()
        if name and j == 0 and u < 4.5:
            a = ease_out(u / 0.4) * clamp((4.5 - u) / 0.4)
            im = text_img(name, F(BOLD, 44), (20, 20, 24, 255), stroke=0)
            box = pill(im.width + 60, im.height + 30, ACCENT + (255,), r=16); box.alpha_composite(im, (30, 15))
            put(c, box, 90 + box.width / 2, 1290, alpha=a)
        self.caps[j].draw(c, u, 1500)
        if j == 0 and u < 0.3: c.alpha_composite(Image.new('RGBA', (W, H), (0, 0, 0, int(255 * (1 - u / 0.3)))))
        if j == len(self.tl.durs) - 1: fade_black(c, u, dur - 0.45, 0.45)
        return c

    def preview_times(self):
        st, du = self.tl.starts, self.tl.durs; n = len(du)
        idx = [0, n // 3, (2 * n) // 3, n - 1] if n >= 4 else list(range(n)) + [n - 1] * (4 - n)
        out = []
        for k, j in enumerate(idx):
            cap = self.caps[j]; g = cap.groups[min(len(cap.groups) - 1, 1)] if cap.groups else None
            out.append(st[j] + (min(du[j] - 0.2, g[-1][0] + 0.1) if g else du[j] * 0.5) + (0.001 * k))
        return out

    def sound(self, mx):
        n4 = max(1, int(self.tl.total // 4) + 1)
        mx.pad_bass([[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]], [k * 4.0 for k in range(n4)], [4.0] * n4, gain=0.12, bass=0.1, cutoff=1100, saw=False)
        mx.bells(0.5, self.tl.total - 1, every=2.0, gain=0.018)
