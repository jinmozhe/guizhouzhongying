"""Render a fixed 5:4 share cover that contains no account data or reward claims."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
palette = json.loads((ROOT / "apps/miniapp/src/styles/palette.json").read_text(encoding="utf-8"))
image = Image.new("RGB", (750, 600), palette["background"])
draw = ImageDraw.Draw(image)
font_path = Path("C:/Windows/Fonts/msyh.ttc")
title = ImageFont.truetype(str(font_path), 64)
body = ImageFont.truetype(str(font_path), 32)
draw.rounded_rectangle((48, 48, 702, 552), radius=20, fill=palette["surface"])
draw.rectangle((96, 112, 156, 120), fill=palette["primary"])
draw.text((96, 160), "贵州众赢", font=title, fill=palette["text"])
draw.text((96, 276), "邀你一起逛商城", font=body, fill=palette["secondary"])
draw.rounded_rectangle((96, 382, 654, 470), radius=12, fill=palette["primary"])
draw.text((280, 402), "浏览商品", font=body, fill=palette["surface"])
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path, required=True, help="New PNG output path")
target = parser.parse_args().out
with target.open("xb") as output:
    image.save(output, format="PNG", optimize=True)
print(f"SHARE_COVER_OK {image.size[0]}x{image.size[1]}")
