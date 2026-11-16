#!/usr/bin/env python3
"""Draw the PrintForge app icon and write AppIcon.icns (+ a 1024 px PNG).

The .icns container is written directly (PNG-encoded entries), so no macOS
tools are needed:  python3 packaging/make_icon.py <out-dir>
"""
import io
import struct
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 2048  # draw at 2x and downsample for smooth edges


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def icon():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # macOS icon grid: 824/1024 body with a soft shadow
    m = int(S * 100 / 1024)
    body = (m, m, S - m, S - m)
    r = int((S - 2 * m) * 0.225)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((body[0], body[1] + 24, body[2], body[3] + 24), r, fill=(10, 20, 50, 110))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(36)))
    # vertical gradient body
    grad = Image.new("RGBA", (S, S))
    top, bot = (76, 141, 255), (29, 64, 196)
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        gd.line([(0, y), (S, y)], fill=lerp(top, bot, y / S) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(body, r, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # build plate
    cx, cy = S // 2, int(S * 0.60)
    w = int(S * 0.30)
    plate = [(cx - w, cy + int(w * 0.20)), (cx, cy - int(w * 0.38)), (cx + w, cy + int(w * 0.20)), (cx, cy + int(w * 0.78))]
    ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(ov).polygon(plate, fill=(255, 255, 255, 70))
    img = Image.alpha_composite(img, ov)
    d = ImageDraw.Draw(img)
    # isometric block being printed (white) with layer lines
    a = int(S * 0.17)
    h = int(S * 0.20)
    top_y = cy - h - int(a * 0.15)
    t = [(cx, top_y - int(a * 0.5)), (cx + a, top_y), (cx, top_y + int(a * 0.5)), (cx - a, top_y)]
    left = [t[3], t[2], (t[2][0], t[2][1] + h), (t[3][0], t[3][1] + h)]
    right = [t[2], t[1], (t[1][0], t[1][1] + h), (t[2][0], t[2][1] + h)]
    d.polygon(left, fill=(226, 234, 255, 255))
    d.polygon(right, fill=(190, 207, 255, 255))
    d.polygon(t, fill=(255, 255, 255, 255))
    for i in range(1, 6):
        yy = int(h * i / 6)
        d.line([(t[3][0], t[3][1] + yy), (t[2][0], t[2][1] + yy)], fill=(150, 175, 245, 255), width=10)
        d.line([(t[2][0], t[2][1] + yy), (t[1][0], t[1][1] + yy)], fill=(120, 150, 235, 255), width=10)
    # nozzle above the block
    ty = top_y - int(a * 0.5)
    nz = [(cx - 60, ty - 250), (cx + 60, ty - 250), (cx + 60, ty - 150), (cx + 20, ty - 95), (cx - 20, ty - 95), (cx - 60, ty - 150)]
    d.polygon(nz, fill=(255, 196, 61, 255))
    d.rounded_rectangle((cx - 170, ty - 330, cx + 170, ty - 250), 18, fill=(255, 255, 255, 240))
    return img.resize((1024, 1024), Image.LANCZOS)


def icns(img):
    entries = [(b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024), (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512)]
    chunks = b""
    for tag, size in entries:
        buf = io.BytesIO()
        img.resize((size, size), Image.LANCZOS).save(buf, "PNG")
        data = buf.getvalue()
        chunks += tag + struct.pack(">I", len(data) + 8) + data
    return b"icns" + struct.pack(">I", len(chunks) + 8) + chunks


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    im = icon()
    im.save(f"{out}/AppIcon.png")
    with open(f"{out}/AppIcon.icns", "wb") as f:
        f.write(icns(im))
    print("icon written to", out)
