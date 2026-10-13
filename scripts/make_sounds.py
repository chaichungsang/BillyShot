"""合成 BillyShot 音效（WAV, 44.1kHz, 16bit, 单声道）"""
import numpy as np, wave, os
SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

def t(sec): return np.arange(int(SR * sec)) / SR
def env(n, a=0.002, d=0.1):
    x = np.arange(n) / SR
    e = np.minimum(1, x / a) * np.exp(-x / d)
    return e
def tone(f, sec, d, a=0.003, harm=((1, 1.0),)):
    x = t(sec); s = sum(g * np.sin(2 * np.pi * f * h * x) for h, g in harm)
    return s * env(len(x), a, d)
def bandnoise(sec, lo, hi, d):
    n = int(SR * sec); w = rng.standard_normal(n)
    F = np.fft.rfft(w); fr = np.fft.rfftfreq(n, 1 / SR)
    F[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(F, n) * env(n, 0.0005, d)
def mix(*parts):
    n = max(len(p[1]) + int(p[0] * SR) for p in parts); out = np.zeros(n)
    for off, s in parts: i = int(off * SR); out[i:i + len(s)] += s
    return out
def save(name, s, peak=0.8):
    s = s / (np.abs(s).max() + 1e-9) * peak
    fade = min(len(s), 400); s[-fade:] *= np.linspace(1, 0, fade)
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((s * 32767).astype(np.int16).tobytes())

# 相机快门：两段机械咔嚓声
shutter = mix(
    (0.000, bandnoise(0.05, 1800, 9000, 0.008) * 1.0 + tone(1400, 0.05, 0.006) * 0.25),
    (0.055, bandnoise(0.07, 1200, 7000, 0.012) * 0.8), (0.055, tone(900, 0.07, 0.01) * 0.3),
)
save('shutter', shutter, 0.75)

# 轻柔：玻璃“叮”
soft = mix((0, tone(2093, 0.45, 0.11, harm=((1, 1.0), (2.76, 0.25), (5.4, 0.08)))), (0, tone(3136, 0.35, 0.07) * 0.25))
save('soft', soft, 0.55)

# 录屏开始：上行两音
start = mix((0, tone(659.25, 0.22, 0.09, harm=((1, 1), (2, .18)))), (0.11, tone(987.77, 0.32, 0.12, harm=((1, 1), (2, .18)))))
save('rec_start', start, 0.6)

# 录屏结束：下行两音
stop = mix((0, tone(987.77, 0.2, 0.08, harm=((1, 1), (2, .18)))), (0.11, tone(659.25, 0.34, 0.13, harm=((1, 1), (2, .18)))))
save('rec_stop', stop, 0.6)

# 倒计时滴答
save('tick', tone(1320, 0.08, 0.018, harm=((1, 1), (2, .2))), 0.5)

# 完成提示（保存/录制完成）
done = mix((0, tone(1046.5, 0.3, 0.1)), (0.07, tone(1318.5, 0.4, 0.14)), (0.14, tone(1568, 0.5, 0.18) * 0.8))
save('done', done, 0.5)
print('ok', sorted(os.listdir(OUT)))
