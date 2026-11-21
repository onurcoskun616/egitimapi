# Shorts Stüdyosu işçisi: sahne planı (JSON) → 1080x1920 30 fps MP4 + SRT + kapak.
# GitHub Actions'ta (shorts.yml) gen_tasks görevini alır; yerelde de denenebilir:
#   python3 main.py plan.json still  CIKTI_KLASORU      → 4 önizleme karesi + uyarılar
#   python3 main.py plan.json render CIKTI_KLASORU      → video.mp4, altyazi.srt, kapak.jpg
import os, sys, json, math, time, shutil, subprocess, tempfile, urllib.request
from multiprocessing import get_context
import common
from common import W, H, FPS, write_srt, check_fonts
from sound import Mixer

def _ffmpeg():
    # Sistemde ffmpeg yoksa pip'le gelen hazır (libx264 içeren) ffmpeg kullanılır
    p = shutil.which('ffmpeg')
    if p: return p
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()
FFMPEG = _ffmpeg()

def build(plan):
    t = plan.get('template')
    if t == 'siralama': from t_ranking import Ranking; return Ranking(plan)
    if t == 'mekanizma': from t_mechanism import MechanismTemplate; return MechanismTemplate(plan)
    if t == 'karsilastirma': from t_scale import Scale; return Scale(plan)
    if t == 'tanitim': from t_promo import Promo; return Promo(plan)
    if t == 'konusan': from t_talk import Talk; return Talk(plan)
    raise ValueError('Bilinmeyen şablon: ' + str(t))

TPL = None; OUTDIR = None
CHUNK = 150   # 5 sn'lik parçalar

def ff(args, what):
    r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y'] + args, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(f'{what}: {r.stderr[-800:]}')

def render_chunk(n):
    """Ham RGB kareler ffmpeg'e borulanır; geçici .tmp.mp4 yalnızca ffmpeg 0 ile biterse yeniden adlandırılır."""
    total_f = int(math.ceil(TPL.tl.total * FPS))
    f0, f1 = n * CHUNK, min(total_f, (n + 1) * CHUNK)
    tmp = os.path.join(OUTDIR, f'c{n:03d}.tmp.mp4'); out = os.path.join(OUTDIR, f'c{n:03d}.mp4')
    p = subprocess.Popen([FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', str(FPS), tmp], stdin=subprocess.PIPE)
    for f in range(f0, f1):
        p.stdin.write(TPL.draw(f / FPS).convert('RGB').tobytes())
    p.stdin.close()
    if p.wait() != 0: raise RuntimeError(f'Parça {n} kodlanamadı')
    os.replace(tmp, out)
    return n

def stills(plan, outdir):
    global TPL
    TPL = build(plan); common.WARN.clear()
    if hasattr(TPL, 'load'): TPL.load()
    paths = []
    for k, t in enumerate(TPL.preview_times()):
        t = max(0, min(TPL.tl.total - 0.05, t))
        p = os.path.join(outdir, f'onizleme-{k + 1}.jpg')
        TPL.draw(t).convert('RGB').save(p, quality=86); paths.append(p)
    return paths, list(common.WARN), round(TPL.tl.total, 1)

def render(plan, outdir, voices=None, music_level=1.0, progress=None, sfx=None, sfx_level=0.55):
    """voices: [(yerel_dosya, başlangıç_sn)] — ElevenLabs seslendirme parçaları (isteğe bağlı).
    sfx: [(yerel_dosya, başlangıç_sn, süre)] — yapay zekâ ortam sesleri (isteğe bağlı), kodla üretilen müzik/efektin üstüne karışır."""
    global TPL, OUTDIR
    OUTDIR = os.path.join(outdir, 'parcalar'); os.makedirs(OUTDIR, exist_ok=True)
    TPL = build(plan)
    if hasattr(TPL, 'set_voices'): TPL.set_voices(voices)
    if hasattr(TPL, 'load'): TPL.load()       # ağır ön hesap: bir kez, işçilerden önce
    total = TPL.tl.total; nchunks = int(math.ceil(total * FPS / CHUNK))
    workers = max(1, os.cpu_count() or 1)
    print(f'Şablon: {TPL.name}, süre {total:.1f} sn, {nchunks} parça, {workers} çekirdek, yazı tipi: {check_fonts()}', flush=True)
    t0 = time.time(); done = 0
    with get_context('fork').Pool(workers) as pool:
        for _ in pool.imap_unordered(render_chunk, range(nchunks)):
            done += 1
            if progress: progress(done, nchunks + 2)
            print(f'  parça {done}/{nchunks} ({time.time() - t0:.0f} sn)', flush=True)
    lst = os.path.join(OUTDIR, 'liste.txt')
    with open(lst, 'w') as f:
        for n in range(nchunks): f.write(f"file '{os.path.join(OUTDIR, f'c{n:03d}.mp4')}'\n")
    vid = os.path.join(outdir, 'goruntu.mp4')
    ff(['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', vid], 'Birleştirme')
    # ---- ses: kodla sentezlenen müzik + efektler ----
    mx = Mixer(total + 0.05); mx.voice_mode = bool(voices); TPL.sound(mx)
    if voices:   # anlatım aralıkları: konuşma başlangıcı → bitişi
        mx.under_voice([(v[1], v[1] + ((v[3] - v[2]) if len(v) > 3 and v[3] else 3.0)) for v in voices])
    music = os.path.join(outdir, 'muzik.wav'); mx.write(music)
    if progress: progress(nchunks + 1, nchunks + 2)
    final = os.path.join(outdir, 'video.mp4')
    ins = ['-i', vid, '-i', music]; fl = [f'[1:a]volume={music_level:.2f}[mu0]']; n = 2; bed = '[mu0]'
    if sfx:   # yapay zekâ ortam sesleri: sahne başında yumuşak girer, sahne sonunda söner
        labs = []
        for k, (sf, at, d) in enumerate(sfx):
            ins += ['-i', sf]; ms = int(max(0, at) * 1000); d = max(0.8, float(d))
            fl.append(f'[{n}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:{d:.2f},asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st={max(0, d - 0.6):.2f}:d=0.6,volume={sfx_level * (0.45 if voices else 1):.2f},adelay={ms}|{ms}[s{k}]')
            labs.append(f'[s{k}]'); n += 1
        fl.append(f"[mu0]{''.join(labs)}amix=inputs={len(labs) + 1}:normalize=0:dropout_transition=0[mu1]"); bed = '[mu1]'
    if voices:
        labs = []
        idx = {}
        for v in voices:
            if v[0] not in idx: ins += ['-i', v[0]]; idx[v[0]] = n; n += 1
        uses = {}
        for k, v in enumerate(voices): uses.setdefault(v[0], []).append(k)
        srcs = {}
        for vf, ks in uses.items():   # aynı dosya birden çok sahnede kullanılıyorsa girişi çoğalt
            if len(ks) == 1: srcs[ks[0]] = f'[{idx[vf]}:a]'
            else:
                fl.append(f'[{idx[vf]}:a]asplit={len(ks)}' + ''.join(f'[vs{k}]' for k in ks))
                for k in ks: srcs[k] = f'[vs{k}]'
        for k, v in enumerate(voices):
            at = v[1]; a, b = (v[2], v[3]) if len(v) > 3 and v[3] else (None, None)
            ms = int(max(0, at) * 1000)
            # yalnızca baştaki sessizlik atlanır; cümle sonu KESİLMEZ (son hecenin doğal sönümü korunur)
            cut = f'atrim=start={max(0, a - 0.03):.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,' if a is not None else ''
            fl.append(f'{srcs[k]}aresample=44100,aformat=channel_layouts=stereo,{cut}adelay={ms}|{ms}[v{k}]'); labs.append(f'[v{k}]')
        fl.append(f"{''.join(labs)}amix=inputs={len(labs)}:normalize=0:dropout_transition=0,apad=whole_dur={total:.2f}[vo]")
        # müzik zaten anlatım boyunca yumuşakça kısıldı (Mixer.under_voice); burada pompalayan kompresör yok
        fl.append(f'{bed}volume=0.85[bd];[bd][vo]amix=inputs=2:normalize=0,alimiter=limit=0.97:attack=10:release=200[a]')
    else:
        fl.append(f'{bed}alimiter=limit=0.95[a]')
    ff(ins + ['-filter_complex', ';'.join(fl), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', f'{total:.2f}', '-movflags', '+faststart', final], 'Ses karışımı')
    # ---- altyazı dosyası ve kapak ----
    cues = []
    for j, cap in enumerate(TPL.caps): cues += cap.cues(TPL.tl.starts[j])
    srt = os.path.join(outdir, 'altyazi.srt'); write_srt(cues, srt)
    cover = os.path.join(outdir, 'kapak.jpg'); TPL.draw(min(TPL.tl.durs[0] * 0.8, TPL.tl.total - 0.1)).convert('RGB').save(cover, quality=88)
    if common.WARN: print('Uyarılar:', *common.WARN, sep='\n  ', flush=True)
    if progress: progress(nchunks + 2, nchunks + 2)
    print(f'Bitti: {time.time() - t0:.0f} sn', flush=True)
    return final, srt, cover, total

# ---------------- GitHub Actions görevi ----------------
def http(url, data=None, method=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method or ('POST' if data is not None else 'GET'), headers=headers or {})
    for i in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r: return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 or i == 3: raise RuntimeError(f'HTTP {e.code}: {e.read()[:300]!r}')
        except Exception as e:
            if i == 3: raise
        time.sleep(2 * (i + 1))

def task_main():
    base = os.environ['API_BASE'].rstrip('/'); tid = os.environ['TASK_ID']; tok = os.environ['TASK_TOKEN']
    api = lambda p: f'{base}/api/task/{tid}{p}?token={tok}'
    def post(p, obj): http(api(p), json.dumps(obj).encode(), headers={'Content-Type': 'application/json'})
    def prog(d, n):
        try: post('/progress', {'done': d, 'total': n})
        except Exception: pass
    try:
        _, body = http(api('')); m = json.loads(body)['items'][0]
        work = tempfile.mkdtemp(prefix='shorts-')
        def upload(path, target, ctype):
            with open(path, 'rb') as f: http(target['url'], f.read(), 'PUT', {'Content-Type': ctype})
            return target['path']
        if m['mode'] == 'preview':
            paths, warns, total = stills(m['plan'], work)
            up = [upload(p, t, 'image/jpeg') for p, t in zip(paths, m['uploads']['previews'])]
            post('/result', {'results': [{'previews': up, 'warnings': warns, 'total': total, 'font': check_fonts()}]})
        else:
            voices = []; got = {}
            for k, v in enumerate(m.get('voices') or []):
                if v['url'] not in got:
                    fp = os.path.join(work, f'ses{len(got)}.mp3'); _, b = http(v['url']); open(fp, 'wb').write(b); got[v['url']] = fp
                voices.append((got[v['url']], float(v['at']), v.get('from'), v.get('to')))
            sfx = []
            for k, v in enumerate(m.get('sfx') or []):
                fp = os.path.join(work, f'efekt{k}.mp3'); _, b = http(v['url']); open(fp, 'wb').write(b); sfx.append((fp, float(v['at']), float(v.get('dur', 5))))
            final, srt, cover, total = render(m['plan'], work, voices, float(m.get('music_level', 1.0)), prog, sfx, float(m.get('sfx_level', 0.55)))
            u = m['uploads']
            res = {'video': upload(final, u['video'], 'video/mp4'), 'srt': upload(srt, u['srt'], 'application/x-subrip'),
                   'cover': upload(cover, u['cover'], 'image/jpeg'), 'sec': round(total, 1), 'mb': round(os.path.getsize(final) / 1048576, 1)}
            post('/result', {'results': [res]})
        print('Gönderildi.')
    except Exception as e:
        import traceback; traceback.print_exc()
        try: post('/result', {'error': str(e)[:1500]})
        except Exception: pass
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) >= 4:
        plan = json.load(open(sys.argv[1], encoding='utf-8')); mode = sys.argv[2]; out = sys.argv[3]; os.makedirs(out, exist_ok=True)
        if mode == 'still':
            paths, warns, total = stills(plan, out); print(json.dumps({'previews': paths, 'warnings': warns, 'total': total}, ensure_ascii=False))
        else:
            print(render(plan, out))
    else:
        task_main()
