"""Placeholder PWA icons (CLAUDE.md §13): a coral serif "S" on cream in a thin black ring.

Uses Pillow from the backend's tooling and the self-hosted Playfair Display 500:

    cd backend && uv run python ../frontend/scripts/gen_icons.py

Writes to frontend/public/icons/:
- icon-192.png, icon-512.png  purpose "any": the ringed cream disc on transparency
- icon-maskable-512.png       purpose "maskable": full-bleed cream; the ring sits inside
                              the 80% safe zone so any mask shape keeps it whole
- apple-touch-icon.png        180px, opaque (iOS adds its own rounded corners)
- badge-96.png                Android's status-bar badge: only the alpha channel is used,
                              so it's the bare "S" silhouette
Replace them all when the real logo exists.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FRONTEND = Path(__file__).resolve().parents[1]
OUT = FRONTEND / "public" / "icons"
FONT = FRONTEND / "public" / "fonts" / "playfair-display-latin-500-normal.woff2"

# DESIGN.md tokens: cream-linen, coral-pop, ink-black.
CREAM = (0xFF, 0xF5, 0xE6, 255)
CORAL = (0xFA, 0x78, 0x64, 255)
BLACK = (0x00, 0x00, 0x00, 255)
CLEAR = (0, 0, 0, 0)

SUPERSAMPLE = 4  # draw big, then downscale: smooth edges on the ring and the letter


def icon(size: int, *, disc: float, opaque: bool) -> Image.Image:
    """``disc`` is the ring's diameter as a fraction of the icon."""
    big = size * SUPERSAMPLE
    image = Image.new("RGBA", (big, big), CREAM if opaque else CLEAR)
    draw = ImageDraw.Draw(image)

    diameter = big * disc
    inset = (big - diameter) / 2
    # "1px" at 192px, scaled with the icon so it stays visible at 512px.
    ring = max(1, round(size / 192)) * SUPERSAMPLE
    draw.ellipse(
        (inset, inset, big - inset - 1, big - inset - 1), fill=CREAM, outline=BLACK, width=ring
    )

    font = ImageFont.truetype(str(FONT), round(diameter * 0.62))
    left, top, right, bottom = draw.textbbox((0, 0), "S", font=font)
    x = (big - (right - left)) / 2 - left
    y = (big - (bottom - top)) / 2 - top
    draw.text((x, y), "S", font=font, fill=CORAL)

    return image.resize((size, size), Image.Resampling.LANCZOS)


def badge(size: int) -> Image.Image:
    big = size * SUPERSAMPLE
    image = Image.new("RGBA", (big, big), CLEAR)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), round(big * 0.8))
    left, top, right, bottom = draw.textbbox((0, 0), "S", font=font)
    x = (big - (right - left)) / 2 - left
    y = (big - (bottom - top)) / 2 - top
    draw.text((x, y), "S", font=font, fill=BLACK)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = {
        "icon-192.png": icon(192, disc=0.94, opaque=False),
        "icon-512.png": icon(512, disc=0.94, opaque=False),
        "icon-maskable-512.png": icon(512, disc=0.72, opaque=True),
        "apple-touch-icon.png": icon(180, disc=0.82, opaque=True).convert("RGB"),
        "badge-96.png": badge(96),
    }
    for name, image in outputs.items():
        image.save(OUT / name, optimize=True)
        print(f"wrote {OUT / name}")  # noqa: T201


if __name__ == "__main__":
    main()
