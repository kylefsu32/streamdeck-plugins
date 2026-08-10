#!/usr/bin/env python3
"""Generate the plugin's PNG assets with no third-party dependencies.

The look is Apple Watch activity rings: concentric rounded-cap arcs starting at
12 o'clock, each over a dim track of its own hue, with the stroke brightening
towards the leading cap.

Stream Deck wants paired @1x/@2x PNGs and the manifest references them without
the extension. There is no SVG rasterizer on this machine, so shapes are drawn
with supersampled coverage maths and encoded with zlib.

Run: python3 tools/make-icons.py
"""

import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SDPLUGIN = os.path.join(HERE, "..", "com.kylefsu.claude-usage.sdPlugin")

# Session ring runs hot (Claude coral), weekly ring runs cool (teal).
SESSION_DIM = (168, 62, 40)
SESSION_LIT = (255, 138, 106)
WEEKLY_DIM = (22, 122, 114)
WEEKLY_LIT = (94, 234, 212)
MONO_DIM = (150, 150, 150)
MONO_LIT = (255, 255, 255)

SS = 6  # supersample factor per axis


def write_png(path, width, height, pixels):
    """pixels: flat list of (r,g,b,a), row-major."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0
        for x in range(width):
            r, g, b, a = pixels[y * width + x]
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(png)
    print("wrote", os.path.relpath(path, os.path.join(HERE, "..")))


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


class Ring:
    """A rounded-cap arc from 12 o'clock, clockwise, over a dim track."""

    def __init__(self, radius, width, sweep, dim, lit, track_alpha=64):
        self.radius = radius
        self.width = width
        self.sweep = max(0.0, sweep)
        self.dim = dim
        self.lit = lit
        self.track_alpha = track_alpha

    def sample(self, px, py):
        d_centre = math.hypot(px, py)
        half = self.width / 2.0

        # Distance to the full circle decides whether we're on the track at all.
        if abs(d_centre - self.radius) > half:
            on_track = False
        else:
            on_track = True

        # Angle measured clockwise from 12 o'clock.
        ang = (math.degrees(math.atan2(px, -py)) + 360.0) % 360.0
        end = min(self.sweep, 1.0) * 360.0

        if self.sweep >= 1.0:
            dist = abs(d_centre - self.radius)
        elif ang <= end:
            dist = abs(d_centre - self.radius)
        else:
            # Beyond the sweep: fall back to the rounded caps at each end.
            start_pt = (0.0, -self.radius)
            a = math.radians(end)
            end_pt = (self.radius * math.sin(a), -self.radius * math.cos(a))
            dist = min(
                math.hypot(px - start_pt[0], py - start_pt[1]),
                math.hypot(px - end_pt[0], py - end_pt[1]),
            )

        if dist <= half:
            t = 0.0 if end <= 0 else min(1.0, ang / end) if ang <= end else 1.0
            r, g, b = lerp(self.dim, self.lit, t)
            return (r, g, b, 255)

        if on_track:
            r, g, b = self.dim
            return (r, g, b, self.track_alpha)

        return None


def render(size, rings):
    """Composite `rings` outermost-first into a size x size RGBA image."""
    out = []
    n = SS * SS
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = (x + (sx + 0.5) / SS) / size * 2 - 1
                    py = (y + (sy + 0.5) / SS) / size * 2 - 1
                    got = None
                    for ring in rings:
                        hit = ring.sample(px, py)
                        if hit is not None and (got is None or hit[3] >= got[3]):
                            got = hit
                    if got:
                        cr, cg, cb, ca = got
                        af = ca / 255.0
                        r += cr * af
                        g += cg * af
                        b += cb * af
                        a += af
            if a <= 0.0001:
                out.append((0, 0, 0, 0))
            else:
                out.append(
                    (
                        max(0, min(255, int(round(r / a)))),
                        max(0, min(255, int(round(g / a)))),
                        max(0, min(255, int(round(b / a)))),
                        max(0, min(255, int(round(a / n * 255)))),
                    )
                )
    return out


def emit(rel_path, sizes, rings):
    base, retina = sizes
    write_png(os.path.join(SDPLUGIN, rel_path + ".png"), base, base, render(base, rings))
    write_png(os.path.join(SDPLUGIN, rel_path + "@2x.png"), retina, retina, render(retina, rings))


def colour_rings(session=0.68, weekly=0.42):
    return [
        Ring(0.74, 0.26, session, SESSION_DIM, SESSION_LIT),
        Ring(0.40, 0.26, weekly, WEEKLY_DIM, WEEKLY_LIT),
    ]


def mono_rings(session=0.68, weekly=0.42):
    return [
        Ring(0.74, 0.24, session, MONO_DIM, MONO_LIT, track_alpha=50),
        Ring(0.40, 0.24, weekly, MONO_DIM, MONO_LIT, track_alpha=50),
    ]


def main():
    emit(os.path.join("imgs", "plugin", "plugin"), (72, 144), colour_rings())
    emit(os.path.join("imgs", "plugin", "category"), (28, 56), colour_rings())

    # Action-list icons read at 20px and should stay monochrome.
    emit(os.path.join("imgs", "actions", "rings", "icon"), (20, 40), mono_rings())
    emit(os.path.join("imgs", "actions", "rings", "key"), (72, 144), colour_rings())

    # Burn rate: a single outer ring, so it is distinguishable in the list.
    burn_mono = [Ring(0.74, 0.24, 0.55, MONO_DIM, MONO_LIT, track_alpha=50)]
    burn_colour = [Ring(0.74, 0.26, 0.55, SESSION_DIM, SESSION_LIT)]
    emit(os.path.join("imgs", "actions", "burn", "icon"), (20, 40), burn_mono)
    emit(os.path.join("imgs", "actions", "burn", "key"), (72, 144), burn_colour)


if __name__ == "__main__":
    main()
