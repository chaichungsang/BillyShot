# 生成安装 / 卸载向导左侧的品牌图（build/sidebar/side-<缩放>.bmp）
# 安装程序是「高分辨率感知」的（build/installer.nsh 里 ManifestDPIAware true），
# 运行时按窗口实际像素挑最接近的一张，所以每种常见系统缩放都准备一张，4K 屏上也是 1:1 清晰。
# 用法：python3 scripts/make_installer_sidebar.py
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'build', 'sidebar')
ICON = os.path.join(ROOT, 'assets', 'logos', 'portrait', 'icon.png')
BASE_W, BASE_H = 164, 314          # MUI2 欢迎 / 完成页图片在 100% 缩放下的尺寸
SCALES = [100, 125, 150, 175, 200, 225, 250, 300]
SS = 4                             # 先按 4 倍画，再高质量缩小
FONT = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
FONT_SUB = '/usr/share/fonts/opentype/inter/Inter-Medium.otf'

def render(w, h):
    W, H = w * SS, h * SS
    # 背景：上浅下深的黑金
    bg = Image.new('RGB', (W, H))
    top, bot = (27, 26, 23), (10, 9, 8)
    px = bg.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    img = bg.convert('RGBA')
    # 图标后面一圈暖金色光晕
    icon_size = round(W * 0.62)
    cx, cy = W // 2, round(H * 0.36)
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = round(icon_size * 0.78)
    gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(201, 154, 82, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=icon_size * 0.32))
    img = Image.alpha_composite(img, glow)
    # 图标
    icon = Image.open(ICON).convert('RGBA').resize((icon_size, icon_size), Image.LANCZOS)
    img.alpha_composite(icon, (cx - icon_size // 2, cy - icon_size // 2))
    d = ImageDraw.Draw(img)
    # 产品名
    f = ImageFont.truetype(FONT, round(W * 0.135))
    name = 'Hopsnap'
    tw = d.textlength(name, font=f)
    ty = cy + icon_size // 2 + round(H * 0.07)
    d.text(((W - tw) / 2, ty), name, font=f, fill=(233, 207, 156))
    # 细金线 + 小字
    ly = ty + round(W * 0.135 * 1.55)
    lw = round(W * 0.18)
    d.rectangle((cx - lw // 2, ly, cx + lw // 2, ly + max(SS, round(SS * w / BASE_W))), fill=(201, 154, 82))
    fs = ImageFont.truetype(FONT_SUB, round(W * 0.062))
    for i, line in enumerate(['Screenshot · Record', 'Present']):
        sw = d.textlength(line, font=fs)
        d.text(((W - sw) / 2, ly + round(W * 0.07) + i * round(W * 0.085)), line, font=fs, fill=(168, 161, 150))
    return img.convert('RGB').resize((w, h), Image.LANCZOS)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for s in SCALES:
        w, h = round(BASE_W * s / 100), round(BASE_H * s / 100)
        p = os.path.join(OUT, f'side-{s}.bmp')
        render(w, h).save(p, 'BMP')
        print(p, w, h)
