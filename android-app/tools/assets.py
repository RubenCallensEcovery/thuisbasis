# Maakt app-iconen (live + test) uit de icoontjes van de webapp en de eigen beltoon.
import math, os, struct, wave
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '..', 'icons', 'v3')
RES = os.path.join(ROOT, 'android', 'app', 'src')
SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FG = {k: int(v * 108 / 48) for k, v in SIZES.items()}
SCALE = 0.74          # grootte van de hond in het app-icoon (1 = zoals het web-icoon)
BG = (244, 240, 230, 255)  # #F4F0E6

def band(img):
    w, h = img.size; d = ImageDraw.Draw(img)
    bh = int(h * .2); y = h - bh - int(h * .12)
    d.rectangle([0, y, w, y + bh], fill='#D7301F')
    try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int(bh * .7))
    except Exception: f = ImageFont.load_default()
    tw = d.textlength('TEST', font=f); d.text(((w - tw) / 2, y + bh * .1), 'TEST', fill='white', font=f)
    return img

def write(flavor, test):
    base = Image.open(os.path.join(SRC, 'icon-512.png')).convert('RGBA')
    mask = Image.open(os.path.join(SRC, 'icon-maskable-512.png')).convert('RGBA')
    for dpi, s in SIZES.items():
        out = os.path.join(RES, flavor, 'res', 'mipmap-' + dpi); os.makedirs(out, exist_ok=True)
        ic = base.resize((s, s), Image.LANCZOS)
        if test: ic = band(ic)
        ic.save(os.path.join(out, 'ic_launcher.png'))
        r = Image.new('RGBA', (s, s), (0, 0, 0, 0)); m = Image.new('L', (s, s), 0)
        ImageDraw.Draw(m).ellipse([0, 0, s - 1, s - 1], fill=255); r.paste(ic, (0, 0), m)
        r.save(os.path.join(out, 'ic_launcher_round.png'))
        # Android toont enkel het midden van het voorgrondbeeld (72 van 108 dp) en maakt het rond:
        # de hond daarom kleiner in het midden zetten, anders vult hij het hele icoon
        fs = FG[dpi]; k = int(fs * SCALE)
        fg = Image.new('RGBA', (fs, fs), BG); fg.paste(mask.resize((k, k), Image.LANCZOS), ((fs - k) // 2, (fs - k) // 2))
        if test: fg = band(fg)
        fg.save(os.path.join(out, 'ic_launcher_foreground.png'))

def tone():
    sr = 44100; notes = [(784, 0), (988, .18), (1175, .36), (988, .9), (1175, 1.08), (1568, 1.26)]
    n = int(sr * 2.4); buf = [0.0] * n
    for f, t0 in notes:
        s0 = int(t0 * sr)
        for i in range(int(.7 * sr)):
            if s0 + i >= n: break
            t = i / sr; env = math.exp(-t * 6) * min(1, t * 200)
            buf[s0 + i] += env * (math.sin(2 * math.pi * f * t) + .35 * math.sin(4 * math.pi * f * t) + .12 * math.sin(6 * math.pi * f * t))
    peak = max(abs(x) for x in buf)
    out = os.path.join(RES, 'main', 'res', 'raw'); os.makedirs(out, exist_ok=True)
    with wave.open(os.path.join(out, 'thuis_alarm.wav'), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b''.join(struct.pack('<h', int(x / peak * 26000)) for x in buf))

def shortcut():
    # icoon voor de snelkoppeling "Praat met Jonah" (Jonah uit de webapp, met ruimte rond zoals het app-icoon)
    src = Image.open(os.path.join(SRC, '..', 'jonah', 'icon-maskable-512.png')).convert('RGBA')
    s = 192; k = s; im = Image.new('RGBA', (s, s), BG)
    im.paste(src.resize((k, k), Image.LANCZOS), ((s - k) // 2, (s - k) // 2))
    m = Image.new('L', (s, s), 0); ImageDraw.Draw(m).ellipse([0, 0, s - 1, s - 1], fill=255)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0)); out.paste(im, (0, 0), m)
    d = os.path.join(RES, 'main', 'res', 'drawable-nodpi'); os.makedirs(d, exist_ok=True)
    out.save(os.path.join(d, 'ic_shortcut_jonah.png'))

write('live', False); write('proef', True); tone(); shortcut(); print('ok')
