"""Build local PWA icons without fonts or a design service."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent / "static" / "icons"


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    for name, size, safe in [("icon-192.png", 192, False), ("icon-512.png", 512, False), ("maskable-512.png", 512, True)]:
        scale = 3
        image = Image.new("RGB", (size * scale, size * scale), "#eaf0e8")
        draw = ImageDraw.Draw(image)
        s = size * scale
        margin = int(s * (0.20 if safe else 0.12))
        draw.rounded_rectangle((margin, margin, s - margin, s - margin), radius=s * .16, fill="#234b3b")
        # Abstract k: two honest strokes, no external logo dependency.
        x, top, bottom = s * .39, s * .32, s * .68
        width = max(2, int(s * .075))
        draw.line([(x, top), (x, bottom)], fill="#f6f6f0", width=width)
        draw.line([(x, s * .52), (s * .62, top)], fill="#f6f6f0", width=width)
        draw.line([(s * .47, s * .46), (s * .63, bottom)], fill="#c6d4b4", width=width)
        image.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / name)
    print("Built three local PWA icons.")


if __name__ == "__main__":
    main()
