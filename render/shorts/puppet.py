# Ücretsiz "konuşan karakter": tek bir portreden kodla ağız açma-kapama, göz kırpma ve hafif baş hareketi.
# Yüz noktaları MediaPipe Face Landmarker ile bulunur (yalnızca gerekince kurulur); bulunamazsa kullanıcının
# portrede işaretlediği ağız noktası ya da tahmini konum kullanılır.
import os, sys, math, subprocess, urllib.request
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
MODEL = os.path.join(HERE, '.cache', 'face_landmarker.task')

def _mediapipe():
    try:
        import mediapipe as mp; return mp
    except Exception:
        pass
    try:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'mediapipe>=0.10.14,<0.11'], check=True, timeout=600,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import importlib; importlib.invalidate_caches()
        import mediapipe as mp; return mp
    except Exception as e:
        print('MediaPipe kurulamadı:', e, flush=True); return None

def detect_face(img):
    """img: PIL RGB (tuval boyutunda). Dönen: ağız/çene/göz bilgisi (piksel) ya da (None, hata)."""
    mp = _mediapipe()
    if mp is None: return None, 'yüz tanıma kütüphanesi kurulamadı'
    try:
        if not os.path.exists(MODEL):
            os.makedirs(os.path.dirname(MODEL), exist_ok=True)
            urllib.request.urlretrieve(MODEL_URL, MODEL + '.part'); os.replace(MODEL + '.part', MODEL)
        from mediapipe.tasks.python import vision, BaseOptions
        det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=MODEL, delegate=BaseOptions.Delegate.CPU), num_faces=1, min_face_detection_confidence=0.3, min_face_presence_confidence=0.3))
        arr = np.ascontiguousarray(np.asarray(img.convert('RGB')))
        res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=arr))
        if not res.face_landmarks: return None, 'yüz bulunamadı'
        L = res.face_landmarks[0]; w, h = img.size
        P = lambda i: (L[i].x * w, L[i].y * h)
        l, r = P(61), P(291); up, lo = P(13), P(14); chin = P(152)
        def eye(a, b, u, d):
            (x0, y0), (x1, y1), (_, yu), (_, yd) = P(a), P(b), P(u), P(d)
            return [(x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0), yu, yd]
        face = {'mc': [(l[0] + r[0]) / 2, (up[1] + lo[1]) / 2], 'mw': math.hypot(r[0] - l[0], r[1] - l[1]), 'gap': max(0.0, lo[1] - up[1]),
                'chin': chin[1], 'eyes': [eye(33, 133, 159, 145), eye(362, 263, 386, 374)], 'auto': True}
        if face['mw'] < 12: return None, 'ağız çok küçük'
        return face, None
    except Exception as e:
        return None, str(e)[:80]

def guess_face(img, mouth=None):
    """Yüz noktası yoksa: kullanıcının işaretlediği ağız (tuval pikseli) ya da dikey portre için tahmin."""
    w, h = img.size
    cx, cy = mouth if mouth else (w * 0.5, h * 0.41)
    mw = w * 0.13
    return {'mc': [cx, cy], 'mw': mw, 'gap': 0.0, 'chin': cy + mw * 1.0, 'eyes': [], 'auto': False}

def clamp01(v): return max(0.0, min(1.0, v))

def _sample(src, X, Y):
    """Çift doğrusal örnekleme: src HxWx3 float32, X/Y aynı biçimli koordinat dizileri."""
    h, w = src.shape[:2]
    X = np.clip(X, 0, w - 1.001); Y = np.clip(Y, 0, h - 1.001)
    x0 = X.astype(np.int32); y0 = Y.astype(np.int32); fx = (X - x0)[..., None]; fy = (Y - y0)[..., None]
    a = src[y0, x0]; b = src[y0, x0 + 1]; c = src[y0 + 1, x0]; d = src[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

class Puppet:
    def __init__(self, img, face):
        self.base = np.asarray(img.convert('RGB')).astype(np.float32)
        self.h, self.w = self.base.shape[:2]; self.f = face
        cx, cy = face['mc']; mw = face['mw']
        # ağız çevresi kutusu (çene dahil)
        self.mx0 = int(max(0, cx - mw * 1.1)); self.mx1 = int(min(self.w, cx + mw * 1.1))
        self.my0 = int(max(0, cy - mw * 0.45)); self.my1 = int(min(self.h, max(face['chin'], cy + mw * 0.9) + mw * 0.35))
        # dudak içi rengi: ağız çizgisinin en koyu pikselleri (karikatürde koyu kahve, gerçekte koyu kırmızı)
        y = int(cy); x0, x1 = int(cx - mw * 0.25), int(cx + mw * 0.25)
        band = self.base[max(0, y - 2):y + 3, max(0, x0):x1].reshape(-1, 3)
        dark = band[np.argsort(band.sum(1))[:max(1, len(band) // 5)]].mean(0) if len(band) else np.array([60, 20, 25.0])
        self.inner = np.clip(dark * 0.35 + np.array([14, 3, 5]), 0, 95).astype(np.float32)

    def mouth(self, arr, op):
        if op <= 0.01: return
        f = self.f; cx, cy = f['mc']; mw = f['mw']; gap = f.get('gap', 0)
        x0, x1, y0, y1 = self.mx0, self.mx1, self.my0, self.my1
        X, Y = np.meshgrid(np.arange(x0, x1, dtype=np.float32), np.arange(y0, y1, dtype=np.float32))
        A = op * mw * 0.32                        # en fazla açıklık (piksel)
        hw = mw * 0.5
        dx = (X - cx) / (hw * 1.12)
        prof = np.clip(1 - dx ** 2, 0, 1) ** 0.6   # ortada tam, köşelerde sıfır
        seam = cy + gap / 2
        chin = max(f['chin'], cy + mw * 0.7)
        # alt dudak + çene aşağı iner (çeneye doğru azalarak), üst dudak çok az kalkar
        g_lo = np.where(Y >= seam, np.clip(1 - (Y - (seam + mw * 0.35)) / max(1, chin + mw * 0.3 - (seam + mw * 0.35)), 0, 1), 0)
        g_up = np.where(Y < seam, np.clip(1 - (seam - Y) / (mw * 0.4), 0, 1), 0)
        dy = A * prof * g_lo - A * 0.18 * prof * g_up
        out = _sample(self.base, X, Y - dy)
        # ağız içi: üst dudak alt kenarı ile alt dudak üst kenarı arası
        top = seam - A * 0.18 * prof; bot = seam + A * prof
        m = np.clip((Y - top) / 1.5, 0, 1) * np.clip((bot - Y) / 1.5, 0, 1) * (prof > 0.02)
        depth = np.clip((Y - top) / np.maximum(1, bot - top), 0, 1)[..., None]
        col = self.inner * (0.75 + 0.35 * depth) + np.array([40, 8, 12], np.float32) * depth ** 2   # alta doğru dil tonu
        # üst dişler: ağız içinin üstünde, kenarlara doğru incelen yumuşak açık şerit (yalnızca ağız yeterince açıkken)
        th = A * 0.2 * np.clip(1 - (dx / 0.7) ** 2, 0, 1)
        teeth = (np.clip((top + 1 + th - Y) / 1.5, 0, 1) * np.clip((Y - top) / 1.0, 0, 1))[..., None] * clamp01((op - 0.3) / 0.3) * 0.75
        col = col * (1 - teeth) + np.array([214, 206, 196], np.float32) * teeth
        out = out * (1 - m[..., None]) + col * m[..., None]
        arr[y0:y1, x0:x1] = out

    def blink(self, arr, c):
        if c <= 0.02: return
        for ex, ey, ew, yu, yd in self.f.get('eyes') or []:
            eh = max(3.0, yd - yu, ew * 0.28)
            yu = min(yu, ey - eh / 2); yd = yu + eh
            x0, x1 = int(max(0, ex - ew * 0.75)), int(min(self.w, ex + ew * 0.75))
            y0, y1 = int(max(0, yu - eh * 1.6)), int(min(self.h, yd + eh * 0.4))
            X, Y = np.meshgrid(np.arange(x0, x1, dtype=np.float32), np.arange(y0, y1, dtype=np.float32))
            prof = np.clip(1 - ((X - ex) / (ew * 0.62)) ** 2, 0, 1) ** 0.5
            top = yu + eh * 0.35 * (1 - prof)                    # göz açıklığının üst kenarı (kemer biçimli)
            L = top + c * prof * (yd + eh * 0.1 - top)           # kapağın indiği çizgi
            # kapak rengi: gözün hemen üstündeki deri (sütun sütun), hafif gölgeli
            # kapak rengi: gözün üstündeki ve altındaki derinin ortalaması (kırışık gölgesi koyulaştırmasın diye en açık yarı)
            rows = np.concatenate([self.base[int(max(0, yu - eh * 0.75)):int(max(1, yu - eh * 0.3)), x0:x1],
                                   self.base[int(min(self.h - 2, yd + eh * 0.5)):int(min(self.h - 1, yd + eh * 1.0)), x0:x1]], 0)
            lum = rows.sum(2); thr = np.median(lum, 0)
            wgt = (lum >= thr)[..., None].astype(np.float32)
            band = (rows * wgt).sum(0) / np.maximum(1, wgt.sum(0))
            k = max(3, int(ew / 5)) | 1; ker = np.ones(k) / k; pad = k // 2
            band = np.stack([np.convolve(np.pad(band[:, ch], pad, mode='edge'), ker, 'valid') for ch in range(3)], 1)
            shade = (0.97 - 0.07 * np.clip((Y - top) / max(1.0, yd - yu), 0, 1))[..., None]
            lid = band[None, :, :] * shade
            lash = np.minimum(self.base[int(max(0, yu - 1)):int(yu + 2), x0:x1].min(0), 90)[None, :, :]
            m = (np.clip((Y - (top - eh * 0.45)) / (eh * 0.5), 0, 1) * np.clip((L - Y) / 1.5, 0, 1) * np.clip(prof / 0.35, 0, 1) * min(1.0, c * 1.6))[..., None]
            ln = (np.clip(1 - np.abs(Y - L) / (1.2 + eh * 0.08), 0, 1) * (prof > 0.15) * (c > 0.3))[..., None]
            reg = arr[y0:y1, x0:x1]
            reg[:] = reg * (1 - m) + lid * m
            reg[:] = reg * (1 - ln * 0.85) + lash * ln * 0.85

    def render(self, op, blink, t, talk):
        arr = self.base.copy()
        self.mouth(arr, op); self.blink(arr, blink)
        im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        # hafif canlılık: nefes ve konuşurken küçük baş hareketi (tüm görüntü; kenar görünmesin diye az büyütülür)
        ang = 0.35 * math.sin(t * 0.9) + 0.25 * math.sin(t * 2.3) * talk
        sc = 1.025 + 0.004 * math.sin(t * 1.3)
        ty = 3 * math.sin(t * 1.1) - 4 * talk * op
        cx, cy = self.f['mc'][0], self.f['mc'][1] - self.f['mw']
        a = math.radians(ang); ca, sa = math.cos(a) / sc, math.sin(a) / sc
        # ters dönüşüm: çıktı (x,y) → kaynak
        m = (ca, sa, cx - ca * cx - sa * (cy + ty), -sa, ca, (cy) + sa * cx - ca * (cy + ty))
        return im.transform(im.size, Image.AFFINE, m, resample=Image.BILINEAR)
