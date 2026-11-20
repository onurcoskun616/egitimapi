# Shorts Stüdyosu — kodla ses sentezi (müzik yatağı + efektler). Dış ses dosyası gerekmez.
# Referans: audio.py, engine_audio.py, space_audio.py
import wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100

def midi(m): return 440 * 2 ** ((m - 69) / 12)
def tt(d): return np.arange(int(d * SR)) / SR

class Mixer:
    def __init__(self, total, seed=7):
        self.N = int(SR * total); self.total = total
        self.L = np.zeros(self.N); self.R = np.zeros(self.N)
        self.rng = np.random.default_rng(seed)
        self.duck = np.ones(self.N)

    def add(self, sig, t0, gain=1.0, pan=0.0):
        i = int(max(0, t0) * SR)
        if i >= self.N: return
        j = min(self.N, i + len(sig)); s = sig[:j - i] * gain
        self.L[i:j] += s * (1 - max(pan, 0)); self.R[i:j] += s * (1 + min(pan, 0))

    def filt(self, x, kind, f, o=2): return sosfilt(butter(o, f, kind, fs=SR, output='sos'), x)
    def noise(self, n): return self.rng.uniform(-1, 1, n)

    # ---- müzik ----
    def pad_bass(self, chords, starts, durs, gain=0.22, bass=0.2, cutoff=1400, saw=True):
        for k, (a, d) in enumerate(zip(starts, durs)):
            ch = chords[k % len(chords)]; t = tt(d + 0.3)
            env = np.minimum(1, t / 0.6) * np.minimum(1, (d + 0.3 - t) / 0.4 + 0.3)
            pad = np.zeros_like(t)
            for m in ch:
                for det in (-0.12, 0.0, 0.12):
                    f = midi(m + 12) * 2 ** (det / 12)
                    pad += (2 * ((f * t + self.rng.random()) % 1) - 1) if saw else np.sin(2 * np.pi * f * t)
            pad = self.filt(pad, 'low', cutoff) * env / (3 * len(ch))
            self.add(pad, a, gain, -0.2); self.add(pad, a, gain, 0.2)
            self.add(np.sin(2 * np.pi * midi(ch[0] - 12) * t) * env, a, bass)

    def drone(self, chords, starts, durs, gain=0.5):
        for k, (a, d) in enumerate(zip(starts, durs)):
            ch = chords[k % len(chords)]; L = d + 0.6; t = tt(L)
            env = np.minimum(1, t / 1.2) * np.minimum(1, (L - t) / 1.2)
            pad = sum(np.sin(2 * np.pi * midi(m) * t * (1 + dd)) + 0.3 * np.sin(4 * np.pi * midi(m) * t * (1 + dd)) for m in ch for dd in (-0.002, 0.002))
            self.add(pad * env / 10, max(0, a - 0.3), gain, -0.25 if k % 2 else 0.25)
            self.add(np.sin(2 * np.pi * midi(ch[0] - 12) * t) * env, max(0, a - 0.3), gain * 0.3)

    def kick(self):
        t = tt(0.35); f = 45 + 120 * np.exp(-t * 30)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    def hat(self):
        t = tt(0.06); return self.filt(self.noise(len(t)), 'high', 7000) * np.exp(-t * 70)

    def beat(self, t0, t1, bpm=120, skip=None, hats_from=None):
        K, Hh = self.kick(), self.hat(); step = 60 / bpm
        for b in np.arange(t0, t1, step):
            if skip and skip[0] <= b < skip[1]: continue
            self.add(K, b, 0.55)
            i = int(b * SR); n = int(0.25 * SR)
            if i < self.N: self.duck[i:i + n] = np.minimum(self.duck[i:i + n], 0.55 + 0.45 * np.linspace(0, 1, len(self.duck[i:i + n])))
            if hats_from is None or b >= hats_from: self.add(Hh, b + step / 2, 0.12, 0.3)

    def arp(self, t0, t1, chords, chord_len=4.0, step=0.25, gain=0.05):
        for j, b in enumerate(np.arange(t0, t1, step)):
            ch = chords[int(b // chord_len) % len(chords)]; m = ch[j % len(ch)] + 24
            t = tt(0.2); s = np.sin(2 * np.pi * midi(m) * t) * np.exp(-t * 25)
            self.add(s, b, gain, 0.4 if j % 2 else -0.4)

    def bells(self, t0, t1, every=0.75, gain=0.035):
        for b in np.arange(t0, t1, every):
            m = [74, 76, 79, 81, 84, 86][self.rng.integers(0, 6)]; t = tt(1.6)
            s = (np.sin(2 * np.pi * midi(m) * t) + 0.3 * np.sin(2 * np.pi * midi(m) * 2.01 * t)) * np.exp(-t * 3)
            self.add(s, b, gain, self.rng.uniform(-0.7, 0.7))

    # ---- efektler ----
    def whoosh(self, d=0.7):
        t = tt(d); n = self.noise(len(t))
        env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2; m = np.clip(t / d, 0, 1)
        return (self.filt(n, 'band', [300, 1200]) * (1 - m) + self.filt(n, 'band', [1500, 6000]) * m) * env * 1.6
    def impact(self, big=False):
        t = tt(1.6 if big else 0.9); f = 70 * np.exp(-t * 2) + 30
        boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (2.5 if big else 5))
        return boom + self.filt(self.noise(len(t)), 'low', 2500) * np.exp(-t * 18) * 0.5
    def boom(self, d=2.5):
        t = tt(d); f = 55 * np.exp(-t * 1.5) + 28
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2) + self.filt(self.noise(len(t)), 'low', 300) * np.exp(-t * 4) * 0.4
    def tick(self, f):
        t = tt(0.03); return np.sin(2 * np.pi * f * t) * np.exp(-t * 160)
    def ding(self, f):
        t = tt(1.4); return (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t)) * np.exp(-t * 3.5)
    def click(self, f):
        t = tt(0.04); return np.sin(2 * np.pi * f * t) * np.exp(-t * 120)
    def riser(self, d=3.0):
        t = tt(d); n = self.noise(len(t)); out = np.zeros_like(t); seg = int(0.05 * SR)
        for a in range(0, len(t), seg):
            c = 300 + 6000 * (a / len(t)) ** 2
            out[a:a + seg] = self.filt(n[a:a + seg], 'band', [max(100, c * 0.6), min(18000, c * 1.4)])[:len(out[a:a + seg])]
        tone = np.sin(2 * np.pi * np.cumsum(200 + 600 * (t / d) ** 2) / SR) * 0.3
        return (out * 1.4 + tone) * (t / d) ** 2
    def counter(self, t0, t1, gain=0.12, ding_note=81):
        for j, tk in enumerate(np.arange(t0, t1, 0.065)): self.add(self.tick(1800 + j * 40), tk, gain, 0.15)
        self.add(self.ding(midi(ding_note)), t1 + 0.03, 0.22)

    def wind(self, gain=0.35):
        n = np.arange(self.N) / SR
        self.L += self.filt(self.noise(self.N), 'low', 500) * (0.6 + 0.4 * np.sin(2 * np.pi * n / 7)) * gain
        self.R += self.filt(self.noise(self.N), 'low', 500) * (0.6 + 0.4 * np.cos(2 * np.pi * n / 9)) * gain

    def write(self, path, drive=1.6):
        L = self.L * self.duck ** 0.5; R = self.R * self.duck ** 0.5
        fade = np.ones(self.N); fo = min(self.N, int(1.2 * SR)); fade[-fo:] = np.linspace(1, 0, fo)
        fi = int(0.05 * SR); fade[:fi] = np.linspace(0, 1, fi)
        st = np.stack([L, R], 1) * fade[:, None]
        mx = np.abs(st).max() or 1
        st = np.tanh(st / mx * drive) * 0.89
        with wave.open(path, 'wb') as f:
            f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
            f.writeframes((st * 32767).astype(np.int16).tobytes())
