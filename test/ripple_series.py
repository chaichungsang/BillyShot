# 一段录下来的帧（每秒 FPS 张）里，波纹从出现到消失的过程：python3 ripple_series.py 目录 cx cy fps
# 输出每帧：时间（从波纹出现算起） 变化像素数 变化像素的平均半径
import sys, glob, math
from PIL import Image
d, cx, cy, fps = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4])
lum = lambda p: (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000
rows = []
for i, f in enumerate(sorted(glob.glob(d + '/*.png'))):
    im = Image.open(f).convert('RGB'); px = im.load(); n = 0; sr = 0.0
    for y in range(cy - 340, cy + 341, 2):
        for x in range(cx - 340, cx + 341, 2):
            r = math.hypot(x - cx, y - cy)
            if 22 < r <= 340 and abs(lum(px[x, y]) - 128) > 14: n += 1; sr += r
    rows.append((i / fps, n, sr / n if n else 0))
t0 = next((t for t, n, _ in rows if n > 100), None)
for t, n, r in rows:
    if t0 is not None and t >= t0 - 0.1: print(f"{t - t0:.2f} {n} {r:.0f}")
