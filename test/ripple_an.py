# 水波纹像素分析（灰色 #808080 桌面上）：python3 ripple_an.py 图片 cx cy [内半径 外半径]
# 输出 changed=<环内和灰底明显不同的像素数> bright=<变亮像素> dark=<变暗像素> runs=<向右一条线上的亮段数> tint=<亮像素平均 R-B>
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); cx, cy = int(sys.argv[2]), int(sys.argv[3])
r0 = float(sys.argv[4]) if len(sys.argv) > 4 else 40; r1 = float(sys.argv[5]) if len(sys.argv) > 5 else 120
px = im.load(); W, H = im.size; BG = 128
lum = lambda p: (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000
ch = br = dk = 0; tint = 0.0
R = int(r1) + 1
for y in range(max(0, cy - R), min(H, cy + R + 1)):
    for x in range(max(0, cx - R), min(W, cx + R + 1)):
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** .5
        if r0 <= d <= r1:
            p = px[x, y]; l = lum(p)
            if abs(l - BG) > 14: ch += 1
            if l > BG + 14: br += 1; tint += p[0] - p[2]
            if l < BG - 10: dk += 1
runs = 0; prev = False
for ang in (225,):   # 迎光一侧（左上）亮带最明显
    pass
import math
for i in range(0, int(r1)):
    x = int(cx - i * math.cos(math.pi / 4)); y = int(cy - i * math.sin(math.pi / 4))
    if not (0 <= x < W and 0 <= y < H): break
    b = lum(px[x, y]) > BG + 14
    if b and not prev: runs += 1
    prev = b
print(f"changed={ch} bright={br} dark={dk} runs={runs} tint={tint / br if br else 0:.0f}")
