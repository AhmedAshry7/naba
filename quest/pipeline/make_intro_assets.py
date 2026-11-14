"""Render the intro-screen images for the Unity app.

Inputs : pipeline/assets/naba_logo.png (transparent logo)
Outputs: <unity project>/Assets/Globe/Resources/Intro/
           logo.png, logo_glow.png       wave + NABA without the satellite (same canvas, so the quads line up)
           satellite.png, satellite_glow.png  the satellite on its own (animated in Unity)
           layout.json                   where the satellite sits on that canvas
           tagline.png, subtitle.png, button.png
Usage  : python make_intro_assets.py
"""
from pathlib import Path

import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

from paths import RESOURCES

HERE = Path(__file__).resolve().parent
OUT = RESOURCES / "Intro"
FONTS = Path("C:/Windows/Fonts")

TAGLINE = "EARTH'S NEWS, BEFORE IT BREAKS"
SUBTITLE = ("Radar from the NASA\u2013ISRO NISAR satellite, turned into clear",
            "stories about how the ground beneath us is changing.")
BUTTON = "Let's start  \u2192"

GOLD = (232, 184, 74)
GOLD_LIGHT = (250, 214, 120)
TEXT_LIGHT = (226, 229, 238)
TEXT_DIM = (165, 174, 200)
GLOW = (40, 110, 255)
SS = 2  # supersampling for smooth edges


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def glow_of(img, blur, strength):
    a = np.asarray(img.getchannel("A").filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32) * strength
    out = Image.new("RGBA", img.size, GLOW + (0,))
    out.putalpha(Image.fromarray(a.clip(0, 255).astype(np.uint8)))
    return out


def logo():
    src = Image.open(HERE / "assets" / "naba_logo.png").convert("RGBA")
    src = src.crop(src.getbbox())
    pad = 90
    canvas = Image.new("RGBA", (src.width + 2 * pad, src.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(src, (pad, pad), src)

    # The satellite is the group of shapes in the logo's upper-right corner.
    rgba = np.array(canvas)
    lab, _ = ndimage.label(rgba[..., 3] > 20)
    sat_mask = np.zeros(lab.shape, bool)
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        cy = ((sl[0].start + sl[0].stop) / 2 - pad) / src.height
        cx = ((sl[1].start + sl[1].stop) / 2 - pad) / src.width
        if cx > 0.72 and cy < 0.48:
            sat_mask |= lab == i
    sat_mask = ndimage.binary_dilation(sat_mask, iterations=3) & (rgba[..., 3] > 0)

    word = rgba.copy()
    word[sat_mask, 3] = 0
    word = Image.fromarray(word)
    word.save(OUT / "logo.png")
    glow_of(word, 28, 0.75).save(OUT / "logo_glow.png")

    ys, xs = np.nonzero(sat_mask)
    x0, x1, y0, y1 = xs.min() - 30, xs.max() + 31, ys.min() - 30, ys.max() + 31
    sat = rgba.copy()
    sat[~sat_mask, 3] = 0
    sat = Image.fromarray(sat).crop((x0, y0, x1, y1))
    sat.save(OUT / "satellite.png")
    glow_of(sat, 12, 0.85).save(OUT / "satellite_glow.png")

    layout = {  # fractions of the logo canvas, measured from its top-left corner
        "satCenterX": (x0 + x1) / 2 / canvas.width,
        "satCenterY": (y0 + y1) / 2 / canvas.height,
        "satWidth": (x1 - x0) / canvas.width,
    }
    (OUT / "layout.json").write_text(json.dumps(layout, indent=2))
    print("logo", canvas.size, "satellite", sat.size, layout)


def spaced_text(text, fnt, color, spacing, pad=20):
    widths = [fnt.getlength(c) for c in text]
    w = int(sum(widths) + spacing * (len(text) - 1)) + 2 * pad
    asc, desc = fnt.getmetrics()
    img = Image.new("RGBA", (w, asc + desc + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = pad
    for c, cw in zip(text, widths):
        d.text((x, pad), c, font=fnt, fill=color)
        x += cw + spacing
    return img


def tagline():
    fnt = font("Oswald-SemiBold.ttf", 110 * SS)
    img = spaced_text(TAGLINE, fnt, TEXT_LIGHT, spacing=14 * SS)
    img = img.resize((img.width // SS, img.height // SS), Image.LANCZOS)
    img.crop(img.getbbox()).save(OUT / "tagline.png")
    print("tagline", img.size)


def subtitle():
    fnt = font("segoeui.ttf", 54 * SS)
    line_h = int(78 * SS)
    w = int(max(fnt.getlength(l) for l in SUBTITLE)) + 40 * SS
    img = Image.new("RGBA", (w, line_h * len(SUBTITLE) + 40 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, l in enumerate(SUBTITLE):
        d.text((20 * SS, 20 * SS + i * line_h), l, font=fnt, fill=TEXT_DIM)
    img = img.resize((img.width // SS, img.height // SS), Image.LANCZOS)
    img.crop(img.getbbox()).save(OUT / "subtitle.png")
    print("subtitle", img.size)


def button():
    w, h, r = 620 * SS, 190 * SS, 30 * SS
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=r, fill=GOLD_LIGHT)
    inset = 7 * SS
    d.rounded_rectangle((inset, inset, w - 1 - inset, h - 1 - inset), radius=r - inset, fill=(30, 26, 18))
    inset2 = inset + 3 * SS
    d.rounded_rectangle((inset2, inset2, w - 1 - inset2, h - 1 - inset2), radius=r - inset2, fill=GOLD)
    fnt = font("seguisb.ttf", 88 * SS)
    tw = fnt.getlength(BUTTON)
    asc, desc = fnt.getmetrics()
    d.text(((w - tw) / 2, (h - asc - desc) / 2 + 4 * SS), BUTTON, font=fnt, fill=(22, 20, 18))
    img = img.resize((w // SS, h // SS), Image.LANCZOS)
    img.save(OUT / "button.png")
    print("button", img.size)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    logo()
    tagline()
    subtitle()
    button()
