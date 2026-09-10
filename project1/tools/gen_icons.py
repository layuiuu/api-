# -*- coding: utf-8 -*-
"""
gen_icons.py —— 生成 PWA 图标（纯 Python，无第三方依赖）
设计：蓝绿渐变圆角底 + 白色仪表盘（弧线 + 指针 + 中心点）
输出：
  icons/icon-192.png / icon-512.png            （常规，圆角）
  icons/icon-maskable-192.png / -512.png       （maskable，全出血方形）
  icons/apple-touch-icon.png                   （180x180）
用法：python tools/gen_icons.py
"""
import zlib, struct, math, os

def crc32(data: bytes) -> int:
    table = []
    for n in range(256):
        c = n
        for _ in range(8):
            c = (c >> 1) ^ 0xEDB88320 if c & 1 else c >> 1
        table.append(c)
    crc = 0xFFFFFFFF
    for b in data:
        crc = table[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return crc ^ 0xFFFFFFFF

def chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', crc32(tag + data)))

def write_png(path, size, rgba: bytes):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter: none
        raw += rgba[y * stride:(y + 1) * stride]
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png)
    print('written:', path, f'({os.path.getsize(path)} bytes)')

def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))

def smooth(edge, d):
    """1px 软边缘覆盖度：d<=edge-1 -> 1, d>=edge -> 0"""
    return clamp(edge - d)

def render(size: int, maskable: bool) -> bytes:
    """以 2x 超采样渲染后 box 下采样，返回 RGBA bytes"""
    S = size * 2
    # maskable：图形内容缩进到安全区（约 66%）
    k = 0.68 if maskable else 1.0

    c1 = (79, 140, 255)    # 顶部蓝
    c2 = (33, 200, 168)    # 底部青绿

    cx, cy = 0.5 * S, 0.55 * S
    R = 0.27 * S * k
    W = 0.085 * S * k
    A0, A1 = 135.0, 405.0          # 仪表弧度范围（y 向下坐标系，135°=左下 405°=右下）
    progress = 0.72                 # 已用进度
    needle_w = 0.035 * S * k
    dot_r = 0.05 * S * k
    needle_len = R * 0.85

    rgba = bytearray(S * S * 4)

    for y in range(S):
        for x in range(S):
            # ---- 背景覆盖（圆角矩形，maskable 时全出血） ----
            r = 0.0 if maskable else 0.22 * S
            half = S / 2
            qx = abs(x + 0.5 - half) - (half - r)
            qy = abs(y + 0.5 - half) - (half - r)
            qx = max(qx, 0.0); qy = max(qy, 0.0)
            if r > 0:
                d_rect = math.hypot(qx, qy) - r
            else:
                d_rect = -1.0
            bg = smooth(0.5, d_rect) if r > 0 else 1.0
            if bg <= 0:
                continue

            # ---- 渐变底色 ----
            t = clamp((y + 0.5) / S)
            br = c1[0] + (c2[0] - c1[0]) * t
            bgc = c1[1] + (c2[1] - c1[1]) * t
            bb = c1[2] + (c2[2] - c1[2]) * t

            # ---- 仪表盘（白色形状叠加） ----
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            dist = math.hypot(dx, dy)
            ang = math.degrees(math.atan2(dy, dx))
            if ang < 0:
                ang += 360.0
            tt = (ang - A0) / (A1 - A0)     # 0~1 沿弧位置
            in_arc = 0.0 <= tt <= 1.0

            wa = 0.0  # 白色叠加 alpha
            if in_arc and R > 0:
                # 轨道
                wa = max(wa, 0.38 * smooth(W / 2, abs(dist - R)))
                # 进度（实心）
                if tt <= progress:
                    wa = max(wa, smooth(W / 2, abs(dist - R)))
            # 指针
            na = math.radians(A0 + (A1 - A0) * progress)
            ux, uy = math.cos(na), math.sin(na)
            proj = dx * ux + dy * uy
            perp = abs(-dx * uy + dy * ux)
            if 0 <= proj <= needle_len:
                wa = max(wa, smooth(needle_w, perp))
            # 中心圆点
            wa = max(wa, smooth(dot_r, dist - dot_r) if dist > dot_r else 1.0)

            # ---- 合成 ----
            cr = br + (255 - br) * wa
            cg = bgc + (255 - bgc) * wa
            cb = bb + (255 - bb) * wa

            i = (y * S + x) * 4
            rgba[i] = int(clamp(cr, 0, 255))
            rgba[i + 1] = int(clamp(cg, 0, 255))
            rgba[i + 2] = int(clamp(cb, 0, 255))
            rgba[i + 3] = int(bg * 255)

    # ---- 2x box 下采样 ----
    out = bytearray(size * size * 4)
    for oy in range(size):
        for ox in range(size):
            r = g = b = a = 0
            for sy in range(2):
                for sx in range(2):
                    i = ((oy * 2 + sy) * S + (ox * 2 + sx)) * 4
                    a += rgba[i + 3]
                    # 白底（无 alpha 区域）不做预乘，直接平均即可（背景外都是 alpha=0）
                    r += rgba[i] * rgba[i + 3]
                    g += rgba[i + 1] * rgba[i + 3]
                    b += rgba[i + 2] * rgba[i + 3]
            j = (oy * size + ox) * 4
            av = a / 4
            if av > 0:
                out[j] = int(r / a) if a else 0
                out[j + 1] = int(g / a) if a else 0
                out[j + 2] = int(b / a) if a else 0
            out[j + 3] = int(av)
    return bytes(out)

SPECS = [
    ('icons/icon-192.png', 192, False),
    ('icons/icon-512.png', 512, False),
    ('icons/icon-maskable-192.png', 192, True),
    ('icons/icon-maskable-512.png', 512, True),
    ('icons/apple-touch-icon.png', 180, False),
]

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for rel, size, maskable in SPECS:
        write_png(os.path.join(root, rel), size, render(size, maskable))
    print('done.')
