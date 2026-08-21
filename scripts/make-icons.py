#!/usr/bin/env python3
"""Rasterise assets/logo/mark.svg into every size packaging needs and write a
genuine multi-resolution Windows .ico.

Uses PyMuPDF (fitz/pymupdf) to rasterise the SVG to PNG at each required
pixel size, then hand-assembles a real ICO container (6-byte header, one
16-byte directory entry per image, PNG payloads) rather than renaming a PNG.
PNG-compressed ICO entries are accepted by Windows Vista and later, which is
this project's supported floor.

No PIL is installed on this host, so the ICO bytes are built directly with
struct rather than via Pillow's Image.save(..., format="ICO").
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

try:
    import pymupdf  # type: ignore
except ImportError as exc:  # pragma: no cover
    print(f"ERROR: pymupdf is required but not importable: {exc}", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SVG_PATH = ROOT / "assets" / "logo" / "mark.svg"
BUILD_DIR = ROOT / "app" / "build"

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def render_png(svg_path: Path, size: int) -> bytes:
    """Rasterise the SVG to a square PNG of `size` pixels via PyMuPDF."""
    doc = pymupdf.open(svg_path)
    page = doc[0]
    rect = page.rect
    # mark.svg's viewBox is 256x256, so this is normally 1.0, but compute the
    # zoom from the actual page size so the script stays correct if the
    # source SVG's dimensions ever change.
    src = max(rect.width, rect.height) or 256.0
    zoom = size / src
    matrix = pymupdf.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, alpha=True)
    if pix.width != size or pix.height != size:
        # get_pixmap can round to the nearest pixel; force an exact square by
        # re-rendering with a matrix nudged to hit the exact target size.
        zx = size / pix.width * zoom
        zy = size / pix.height * zoom
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zx, zy), alpha=True)
    doc.close()
    return pix.tobytes("png")


def build_ico(png_by_size: dict[int, bytes]) -> bytes:
    """Assemble a real multi-resolution ICO container from PNG payloads."""
    sizes = sorted(png_by_size)
    count = len(sizes)

    # ICONDIR: reserved(2)=0, type(2)=1 (icon), count(2)
    header = struct.pack("<HHH", 0, 1, count)

    dir_entries = b""
    image_data = b""
    offset = 6 + 16 * count  # header + one 16-byte entry per image

    for size in sizes:
        png = png_by_size[size]
        width_byte = size if size < 256 else 0
        height_byte = size if size < 256 else 0
        # ICONDIRENTRY: width(1) height(1) colorcount(1)=0 reserved(1)=0
        # planes(2)=1 bitcount(2)=32 bytesInRes(4) imageOffset(4)
        entry = struct.pack(
            "<BBBBHHII",
            width_byte,
            height_byte,
            0,
            0,
            1,
            32,
            len(png),
            offset,
        )
        dir_entries += entry
        image_data += png
        offset += len(png)

    return header + dir_entries + image_data


def read_ico_directory(ico_bytes: bytes) -> list[dict]:
    """Parse an ICO's own header/directory back out, for self-verification."""
    reserved, ico_type, count = struct.unpack_from("<HHH", ico_bytes, 0)
    assert reserved == 0 and ico_type == 1, "not a valid ICO container"
    entries = []
    for i in range(count):
        off = 6 + 16 * i
        w, h, colors, res, planes, bitcount, bytes_in_res, image_offset = (
            struct.unpack_from("<BBBBHHII", ico_bytes, off)
        )
        entries.append(
            {
                "width": w or 256,
                "height": h or 256,
                "bitcount": bitcount,
                "bytes": bytes_in_res,
                "offset": image_offset,
            }
        )
    return entries


def main() -> None:
    if not SVG_PATH.exists():
        print(f"ERROR: master SVG not found at {SVG_PATH}", file=sys.stderr)
        sys.exit(1)

    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    png_by_size: dict[int, bytes] = {}
    for size in ICO_SIZES:
        png_by_size[size] = render_png(SVG_PATH, size)
        print(f"rendered {size}x{size} -> {len(png_by_size[size])} bytes")

    # Standalone PNG outputs packaging/docs need directly.
    icon_png = png_by_size[256]
    icon_png_path = BUILD_DIR / "icon.png"
    icon_png_path.write_bytes(icon_png)
    print(f"wrote {icon_png_path} ({len(icon_png)} bytes)")

    png512 = render_png(SVG_PATH, 512)
    icon512_path = BUILD_DIR / "icon@512.png"
    icon512_path.write_bytes(png512)
    print(f"wrote {icon512_path} ({len(png512)} bytes)")

    ico_bytes = build_ico(png_by_size)
    ico_path = BUILD_DIR / "icon.ico"
    ico_path.write_bytes(ico_bytes)
    print(f"wrote {ico_path} ({len(ico_bytes)} bytes)")

    # Self-verify: read the ICO's own directory back and print it.
    entries = read_ico_directory(ico_path.read_bytes())
    print(f"verified ICO directory: {len(entries)} image(s)")
    for e in entries:
        print(
            f"  {e['width']}x{e['height']} bitcount={e['bitcount']} "
            f"bytes={e['bytes']} offset={e['offset']}"
        )
    expected = sorted(ICO_SIZES)
    actual = sorted(e["width"] for e in entries)
    assert actual == expected, f"ICO size mismatch: expected {expected}, got {actual}"
    print("OK: icon.ico contains exactly the expected sizes")


if __name__ == "__main__":
    main()
