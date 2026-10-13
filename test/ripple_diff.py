# 折射检查：python3 ripple_diff.py 底图 帧目录 cx cy r0 r1
# 在每一帧里找和底图不同的像素（环内），取变化最多的一帧，输出
# changed=<变化像素数> darker=<明显变暗（亮度降 >60）的像素数：反光只会变亮、影子最多暗 6%，所以只有「把附近深色条纹挪过来」的折射会让浅色处大幅变暗>
import sys, glob, math
from PIL import Image
base = Image.open(sys.argv[1]).convert('RGB'); B = base.load()
d, cx, cy, r0, r1 = sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
lum = lambda p: (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000
dist = lambda a, b: abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
best = (0, 0, '')
for f in sorted(glob.glob(d + '/*.png')):
    P = Image.open(f).convert('RGB').load(); ch = []
    for y in range(cy - int(r1), cy + int(r1) + 1, 2):
        for x in range(cx - int(r1), cx + int(r1) + 1, 2):
            r = math.hypot(x - cx, y - cy)
            if r0 <= r <= r1 and dist(P[x, y], B[x, y]) > 60: ch.append((x, y))
    dk = sum(1 for x, y in ch if lum(B[x, y]) - lum(P[x, y]) > 60)
    if dk > best[1] or (dk == best[1] and len(ch) > best[0]): best = (len(ch), dk, f, ch)
print(f"changed={best[0]} darker={best[1]} frame={best[2].split('/')[-1] if best[2] else 'none'}")
