"""Draws the SecretSentry toolbar icon (a shield with a keyhole) at every size Chrome needs.
Run: python3 scripts/make-icons.py   (needs Pillow). Output: static/icons/icon-{16,32,48,128}.png"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "static", "icons")
os.makedirs(OUT, exist_ok=True)
BLUE, WHITE = (31, 79, 191, 255), (255, 255, 255, 255)

def draw(size):
    S = 1024  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    shield = [(512, 70), (880, 200), (880, 520), (840, 700), (720, 850), (512, 960),
              (304, 850), (184, 700), (144, 520), (144, 200)]
    d.polygon(shield, fill=BLUE)
    d.ellipse((422, 330, 602, 510), fill=WHITE)           # keyhole top
    d.polygon([(470, 470), (554, 470), (590, 740), (434, 740)], fill=WHITE)  # keyhole stem
    return img.resize((size, size), Image.LANCZOS)

for s in (16, 32, 48, 128):
    draw(s).save(os.path.join(OUT, f"icon-{s}.png"), optimize=True)
print("icons written to", os.path.normpath(OUT))
