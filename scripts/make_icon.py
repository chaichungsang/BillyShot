"""Hopsnap 玻璃图标渲染器：高度场 → 法线 → 折射(含色散) + 菲涅尔 + 高光。
用法: python3 scripts/make_icon.py [variant] [out.png]
variant: vivid（彩色底 + 清透玻璃图形） | clear（整块透明玻璃）
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

N = 2048
VARIANT = sys.argv[1] if len(sys.argv) > 1 else 'vivid'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/icon_glass.png'

yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
U = (xx / (N - 1)) * 2 - 1
V = (yy / (N - 1)) * 2 - 1


def superellipse(a=0.86, n=4.3):
    return ((np.abs(U / a) ** n + np.abs(V / a) ** n) <= 1.0)


def height_from_mask(mask, bevel_px, dome=False):
    d = ndi.distance_transform_edt(mask).astype(np.float32)
    t = np.clip(d / bevel_px, 0, 1)
    h = np.sqrt(1 - (1 - t) ** 2) * bevel_px
    h = ndi.gaussian_filter(h, 1.6)
    return h * mask


def normals(h):
    gy, gx = np.gradient(h)
    nz = np.ones_like(h)
    l = np.sqrt(gx * gx + gy * gy + nz * nz)
    return -gx / l, -gy / l, nz / l


def sample(img, dx, dy):
    """双线性采样 img(H,W,C) 于 (x+dx, y+dy)"""
    out = np.empty_like(img)
    coords = [np.clip(yy + dy, 0, N - 1), np.clip(xx + dx, 0, N - 1)]
    for c in range(img.shape[2]):
        out[..., c] = ndi.map_coordinates(img[..., c], coords, order=1, mode='nearest')
    return out


def refract(img, nx, ny, strength, disp=0.06):
    """带色散的折射：RGB 三通道位移不同"""
    out = np.empty_like(img)
    for c, k in enumerate([1 - disp, 1.0, 1 + disp]):
        s = sample(img[..., c:c + 1], -nx * strength * k, -ny * strength * k)
        out[..., c] = s[..., 0]
    if img.shape[2] == 4:
        out[..., 3] = sample(img[..., 3:4], -nx * strength, -ny * strength)[..., 0]
    return out


def lighting(nx, ny, nz, mask, spec_pow=60, spec_amt=1.0, fres_amt=0.55):
    L = np.array([-0.45, -0.65, 0.62]); L /= np.linalg.norm(L)
    H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)
    ndh = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1)
    spec = (ndh ** spec_pow) * spec_amt
    # 柔和的大面积高光
    soft = (ndh ** 8) * 0.18
    fres = (1 - nz) ** 2.2 * fres_amt
    # 背光侧边缘的暗部（增加厚度感）
    back = np.clip(nx * 0.45 + ny * 0.65, 0, 1) * (1 - nz) * 0.9
    return (spec + soft) * mask, fres * mask, back * mask


def blob(cx, cy, r, color, amt=1.0):
    g = np.exp(-(((U - cx) ** 2 + (V - cy) ** 2) / (2 * r * r)))[..., None]
    return g * np.array(color, np.float32)[None, None, :] / 255.0 * amt


def draw_glyph():
    im = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(im)
    w = int(N * 0.072); rr = w // 2
    a = int(N * 0.27); b = N - a; L = int(N * 0.15)
    for (x, y, sx, sy) in [(a, a, 1, 1), (b, b, -1, -1), (b, a, -1, 1), (a, b, 1, -1)]:
        d.rounded_rectangle([min(x, x + sx * L) - rr, y - rr, max(x, x + sx * L) + rr, y + rr], radius=rr, fill=255)
        d.rounded_rectangle([x - rr, min(y, y + sy * L) - rr, x + rr, max(y, y + sy * L) + rr], radius=rr, fill=255)
    brackets = np.array(im) > 127
    dot = ((U) ** 2 + (V) ** 2) <= (0.155 ** 2)
    return brackets, dot


def comp(dst_rgb, dst_a, src_rgb, src_a):
    """premultiplied-free over"""
    out_a = src_a + dst_a * (1 - src_a)
    safe = np.maximum(out_a, 1e-6)[..., None]
    out_rgb = (src_rgb * src_a[..., None] + dst_rgb * dst_a[..., None] * (1 - src_a[..., None])) / safe
    return out_rgb, out_a


def render():
    slab = superellipse()
    slab_f = slab.astype(np.float32)
    brackets, dot = draw_glyph()

    # ---------- 背景（玻璃板内部的光）
    if VARIANT == 'vivid':
        base = np.zeros((N, N, 3), np.float32) + np.array([14, 14, 34], np.float32) / 255
        base += blob(-0.55, -0.6, 0.55, (92, 96, 255), 1.0)
        base += blob(0.65, -0.35, 0.45, (170, 92, 255), 0.9)
        base += blob(0.35, 0.75, 0.5, (255, 92, 140), 0.75)
        base += blob(-0.6, 0.6, 0.4, (40, 200, 255), 0.55)
        base += blob(0.0, 0.0, 0.25, (255, 255, 255), 0.10)
        bg = np.clip(base, 0, 1)
        bg_a = slab_f.copy()
    else:  # clear
        tint = np.zeros((N, N, 3), np.float32) + 1.0
        glow = blob(-0.3, -0.35, 0.5, (120, 120, 255), 1.0) + blob(0.4, 0.4, 0.45, (255, 110, 170), 0.9) + blob(0.45, -0.4, 0.35, (80, 210, 255), 0.6)
        bg = np.clip(tint * 0.92 + glow * 0.0, 0, 1)
        bg = np.clip(0.7 * tint + glow * 0.8, 0, 1)
        g_a = np.clip(glow.max(axis=2), 0, 1)
        bg_a = slab_f * np.clip(0.07 + g_a * 0.42, 0, 1)

    # ---------- 玻璃板（边缘折射 + 高光）
    hs = height_from_mask(slab, N * 0.032)
    nx, ny, nz = normals(hs)
    nx *= slab_f; ny *= slab_f; nz = np.where(slab, nz, 1)
    rgba = np.dstack([bg, bg_a])
    slab_img = refract(rgba, nx, ny, strength=N * 0.07, disp=0.22)
    spec, fres, back = lighting(nx, ny, nz, slab_f, spec_pow=55, spec_amt=1.0, fres_amt=0.42)
    srgb = slab_img[..., :3]
    sa = slab_img[..., 3] * slab_f
    srgb = srgb * (1 - back[..., None] * 0.35)
    srgb = srgb + (fres[..., None] * 0.7 + spec[..., None]) * (1 - srgb)
    sa = np.clip(sa + fres * 0.8 + spec * 0.9, 0, 1) * slab_f
    # 顶部一道清晰的反光弧（玻璃感关键）
    arc = np.exp(-((V + 0.62 - 0.10 * U ** 2) ** 2) / (2 * 0.018 ** 2)) * np.clip(1 - np.abs(U) / 0.62, 0, 1) ** 1.5
    arc *= slab_f * 0.22
    srgb = srgb + arc[..., None] * (1 - srgb)
    sa = np.clip(sa + arc * 0.6, 0, 1)
    # 细描边（浅色背景上也有轮廓）
    edge = slab ^ ndi.binary_erosion(slab, iterations=3)
    srgb = np.where(edge[..., None], srgb * 0.85 + 0.15, srgb)
    sa = np.where(edge, np.maximum(sa, 0.55), sa)

    # ---------- 图形阴影（落在玻璃板上）
    glyph = brackets | dot
    sh = ndi.gaussian_filter(glyph.astype(np.float32), N * 0.012)
    sh = ndi.shift(sh, (N * 0.012, N * 0.006), order=1)
    srgb = srgb * (1 - sh[..., None] * 0.18 * slab_f[..., None])
    sa = np.clip(sa + sh * 0.12 * slab_f, 0, 1)

    caus = ndi.gaussian_filter(glyph.astype(np.float32), N * 0.02)
    caus = ndi.shift(caus, (N * 0.03, N * 0.02), order=1) * (1 - glyph) * slab_f
    srgb = srgb + caus[..., None] * 0.22 * (1 - srgb)
    plate = np.dstack([srgb, sa])

    # ---------- 括号：清透玻璃
    hb = height_from_mask(brackets, N * 0.036)
    bnx, bny, bnz = normals(hb)
    bm = brackets.astype(np.float32)
    bnz = np.where(brackets, bnz, 1)
    br = refract(plate, bnx * bm, bny * bm, strength=N * 0.07, disp=0.3)
    bspec, bfres, bback = lighting(bnx, bny, bnz, bm, spec_pow=70, spec_amt=1.2, fres_amt=0.9)
    b_rgb = br[..., :3]
    b_rgb = b_rgb * 0.62 + 0.38  # 清透玻璃：透出底色并提亮
    b_rgb = b_rgb * (1 - bback[..., None] * 0.3)
    b_rgb = b_rgb + (bfres[..., None] * 0.8 + bspec[..., None]) * (1 - b_rgb)
    b_a = np.clip(0.78 + bfres * 0.3 + bspec, 0, 1) * bm
    b_a = ndi.gaussian_filter(b_a, 0.8)

    # ---------- 中心红点：彩色玻璃球（解析球面法线）
    R = 0.155
    rr2 = (U ** 2 + V ** 2) / (R * R)
    dm = (rr2 <= 1).astype(np.float32)
    dnz = np.sqrt(np.clip(1 - rr2, 0, 1))
    dnx, dny = U / R * dm, V / R * dm
    dr = refract(plate, dnx, dny, strength=N * 0.05, disp=0.15)
    coral = np.array([255, 92, 112], np.float32) / 255
    Ld = np.array([-0.45, -0.65, 0.62]); Ld /= np.linalg.norm(Ld)
    diff = np.clip(dnx * Ld[0] + dny * Ld[1] + dnz * Ld[2], 0, 1)
    d_rgb = np.clip(coral[None, None, :] * (0.78 + 0.32 * diff[..., None]), 0, 1)
    d_rgb = d_rgb * 0.86 + dr[..., :3] * 0.14
    # 底部透射的暖光（玻璃球聚光）
    trans = np.exp(-(((U - 0.03) ** 2) / (2 * (R * 0.5) ** 2) + ((V - R * 0.55) ** 2) / (2 * (R * 0.32) ** 2))) * dm
    d_rgb = d_rgb + trans[..., None] * np.array([1.0, 0.85, 0.7]) * 0.6 * (1 - d_rgb)
    # 主高光（左上，柔边）+ 小锐高光
    hl = np.exp(-(((U + R * 0.38) ** 2) / (2 * (R * 0.26) ** 2) + ((V + R * 0.42) ** 2) / (2 * (R * 0.17) ** 2))) * dm
    hl2 = np.exp(-(((U + R * 0.33) ** 2 + (V + R * 0.45) ** 2) / (2 * (R * 0.06) ** 2))) * dm
    rim = (1 - dnz) ** 3 * dm
    d_rgb = d_rgb + (hl[..., None] * 0.75 + hl2[..., None] * 0.9) * (1 - d_rgb)
    d_rgb = d_rgb * (1 - rim[..., None] * 0.18) + rim[..., None] * 0.06
    d_a = ndi.gaussian_filter(dm, 1.0)

    # 彩色发光（点的光晕洒在玻璃板上）
    halo = ndi.gaussian_filter(dm, N * 0.05) * slab_f * 0.55
    p_rgb = plate[..., :3] + halo[..., None] * (coral - plate[..., :3]) * 0.6
    p_a = np.clip(plate[..., 3] + halo * 0.4, 0, 1)

    out_rgb, out_a = comp(p_rgb, p_a, b_rgb, b_a)
    out_rgb, out_a = comp(out_rgb, out_a, d_rgb, d_a)
    img = np.dstack([np.clip(out_rgb, 0, 1), np.clip(out_a, 0, 1)])
    im = Image.fromarray((img * 255).astype(np.uint8), 'RGBA')
    # 外部投影
    shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    sm = Image.fromarray((slab_f * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(N * 0.02))
    sm = sm.point(lambda v: int(v * (0.32 if VARIANT == 'vivid' else 0.18)))
    shadow.putalpha(sm)
    shadow = Image.fromarray(np.roll(np.array(shadow), int(N * 0.014), axis=0))
    final = Image.alpha_composite(shadow, im)
    return final.resize((1024, 1024), Image.LANCZOS)


if __name__ == '__main__':
    img = render()
    img.save(OUT)
    print('saved', OUT)
