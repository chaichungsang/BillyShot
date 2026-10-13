"""生成两套应用图标资源：assets/logos/portrait（头像版，默认）与 assets/logos/purple（紫色玻璃版）。
用法: python3 scripts/make_logo_assets.py scripts/logo-src/portrait-1024.png
每套包含：
  icon.png      1024，窗口 / 通知 / Windows 用（头像版为原图直角）
  icon256.png   设置页里显示
  icon.ico      Windows 快捷方式 / exe（16–256 多尺寸）
  mac.png       1024，macOS 程序坞 / 访达用（按 Apple 规范留边 + 圆角 + 投影）
  tray*.png     Windows 托盘（16 及 1.25x–3x）
  trayMac*.png  macOS 菜单栏（紫色版为黑白模板图标）
"""
import sys, os, shutil
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
A = os.path.join(ROOT, 'assets')
SRC = sys.argv[1]
TRAY = {'': 16, '@1.25x': 20, '@1.5x': 24, '@2x': 32, '@2.5x': 40, '@3x': 48}
ICO = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def rounded_mask(size, radius, ss=4):
    m = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius * ss, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def circle_mask(size, ss=4):
    m = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size * ss - 1, size * ss - 1], fill=255)
    return m.resize((size, size), Image.LANCZOS)


def down(img, s):
    # 逐级缩小，小尺寸更清晰
    im = img
    while im.width > s * 2:
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    return im.resize((s, s), Image.LANCZOS)


def portrait():
    out = os.path.join(A, 'logos', 'portrait'); os.makedirs(out, exist_ok=True)
    src = Image.open(SRC).convert('RGBA').resize((1024, 1024), Image.LANCZOS)
    # Windows / 窗口：轻微圆角（Win11 风格），保留取景框角标
    win = src.copy(); win.putalpha(rounded_mask(1024, 120))
    win.save(os.path.join(out, 'icon.png'))
    down(win, 256).save(os.path.join(out, 'icon256.png'))
    # 小尺寸（≤32）只看得清脸：取景框内裁切，保持同样圆角
    inner = src.crop((112, 40, 912, 840)); inner.putalpha(rounded_mask(800, 110))
    frames = [down(inner if s <= 32 else win, s) for s in ICO]
    frames[-1].save(os.path.join(out, 'icon.ico'), sizes=[(s, s) for s in ICO], append_images=frames[:-1])
    # macOS：824 内容区 + 185 圆角 + 投影（Big Sur 以后的系统图标规格）
    c = 824; body = src.resize((c, c), Image.LANCZOS); body.putalpha(rounded_mask(c, 185))
    mac = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    sh = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0)); sm = Image.new('L', (1024, 1024), 0)
    sm.paste(rounded_mask(c, 185), (100, 112)); sh.putalpha(sm.point(lambda v: int(v * 0.35)))
    mac.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))
    mac.alpha_composite(body, (100, 100))
    mac.save(os.path.join(out, 'mac.png'))
    # 托盘：圆形头像（脸部裁切）+ 细浅色描边，深浅任务栏都看得见
    face = src.crop((190, 110, 830, 750))
    for suf, s in list(TRAY.items()) + [('Mac', 18), ('Mac@2x', 36)]:
        name = 'tray' + (suf if not suf.startswith('Mac') else '') if not suf.startswith('Mac') else 'trayMac' + suf[3:]
        big = 256; im = face.resize((big, big), Image.LANCZOS); im.putalpha(circle_mask(big))
        ring = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse([3, 3, big - 4, big - 4], outline=(232, 214, 186, 200), width=10)
        im.alpha_composite(ring)
        down(im, s).save(os.path.join(out, name + '.png'))


def purple():
    out = os.path.join(A, 'logos', 'purple'); os.makedirs(out, exist_ok=True)
    keep = os.path.join(ROOT, 'scripts', 'logo-src', 'purple')  # 1.2.3 的原始文件
    for f in ['icon.png', 'icon256.png', 'icon.ico'] + ['tray%s.png' % k for k in TRAY]:
        shutil.copy(os.path.join(keep, f), os.path.join(out, f))
    shutil.copy(os.path.join(keep, 'icon.png'), os.path.join(out, 'mac.png'))  # 玻璃图标本身已留边
    shutil.copy(os.path.join(keep, 'trayTemplate.png'), os.path.join(out, 'trayMac.png'))
    shutil.copy(os.path.join(keep, 'trayTemplate@2x.png'), os.path.join(out, 'trayMac@2x.png'))


portrait(); purple()
# 打包默认 = 头像版
P = os.path.join(A, 'logos', 'portrait')
for f in ['icon.png', 'icon256.png', 'icon.ico', 'mac.png']:
    shutil.copy(os.path.join(P, f), os.path.join(A, 'icon-mac.png' if f == 'mac.png' else f))
print('ok')
