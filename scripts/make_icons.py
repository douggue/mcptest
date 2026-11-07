"""Write placeholder app icons (PNG + ICO) with only the standard library.

Tauri refuses to build without icons. Replace them with real artwork via
``npm run tauri icon my-icon.png``; this script just unblocks a first build.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "desktop" / "src-tauri" / "icons"


def png(size: int) -> bytes:
    """A blue rounded square with a lighter inner square. RGBA."""
    rows = []
    r = size // 5
    for y in range(size):
        row = bytearray([0])  # filter type 0
        for x in range(size):
            # rounded corners
            dx = max(r - x, x - (size - 1 - r), 0)
            dy = max(r - y, y - (size - 1 - r), 0)
            if dx * dx + dy * dy > r * r:
                row += b"\x00\x00\x00\x00"
                continue
            inner = size * 0.3 < x < size * 0.7 and size * 0.3 < y < size * 0.7
            row += bytes([120, 170, 255, 255]) if inner else bytes([37, 99, 235, 255])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def ico(images: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    data = b""
    offset = 6 + 16 * len(images)
    for size, blob in images:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(blob), offset)
        data += blob
        offset += len(blob)
    return header + entries + data


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sizes = {32: "32x32.png", 128: "128x128.png", 256: "128x128@2x.png", 512: "icon.png"}
    blobs = {}
    for size, name in sizes.items():
        blobs[size] = png(size)
        (OUT / name).write_bytes(blobs[size])
    (OUT / "icon.ico").write_bytes(ico([(32, blobs[32]), (128, blobs[128]), (256, blobs[256])]))
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
