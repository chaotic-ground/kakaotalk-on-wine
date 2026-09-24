#!/usr/bin/env python3
"""Take the largest icon out of a PE and write it as a PNG.

GNOME draws the generic placeholder in alt-tab and the overview because it
has a window it cannot tie to an application. The desktop file this flatpak
ships fixes the tie; this fixes the picture.

The picture is Kakao's, so it is not in this repository and not in the build.
It comes out of the client the user installed, on their own machine, and goes
where the icon theme looks. Wine cannot supply it either: winewayland can set
a window icon over xdg-toplevel-icon-v1, and mutter does not implement that
protocol -- it says so itself, "window icons will not be supported".

python3 rather than icoutils, which the runtime does not carry. zlib is in
the standard library, so writing the PNG by hand costs less than a
dependency.

    extract-icon.py <exe> <dest.png>
"""

import pathlib
import struct
import sys
import zlib


def resource_section(data):
    """Where .rsrc starts in the file, and what it thinks its address is."""
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("not a PE")

    sections = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    opt = pe + 24
    # PE32+ puts the data directories sixteen bytes further along than PE32.
    magic = struct.unpack_from("<H", data, opt)[0]
    directories = opt + (112 if magic == 0x20B else 96)
    rsrc_rva = struct.unpack_from("<I", data, directories + 16)[0]

    for i in range(sections):
        header = pe + 24 + opt_size + i * 40
        va, size, raw = struct.unpack_from("<III", data, header + 12)[:3]
        if va <= rsrc_rva < va + size:
            return raw + (rsrc_rva - va), va, raw

    raise ValueError("no resource section")


def entries(data, base, directory):
    named, ids = struct.unpack_from("<HH", data, base + directory + 12)
    return [struct.unpack_from("<II", data, base + directory + 16 + i * 8)
            for i in range(named + ids)]


def largest_icon(data):
    base, section_va, section_raw = resource_section(data)

    icons = None
    for name, sub in entries(data, base, 0):
        if not name & 0x80000000 and name == 3:  # RT_ICON
            icons = sub & 0x7FFFFFFF
    if icons is None:
        raise ValueError("no icons")

    best = b""
    for _name, sub in entries(data, base, icons):
        leaf = entries(data, base, sub & 0x7FFFFFFF)[0][1]
        rva, size = struct.unpack_from("<II", data, base + leaf)
        if size > len(best):
            start = section_raw + (rva - section_va)
            best = data[start:start + size]
    return best


def png(width, height, rgba_rows):
    def chunk(tag, body):
        block = tag + body
        return struct.pack(">I", len(body)) + block + struct.pack(">I", zlib.crc32(block))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rgba_rows), 9))
            + chunk(b"IEND", b""))


def main():
    exe, dest = sys.argv[1], sys.argv[2]
    icon = largest_icon(pathlib.Path(exe).read_bytes())

    # Already a PNG, as newer icons often are. Then there is nothing to do.
    if icon[:8] == b"\x89PNG\r\n\x1a\n":
        pathlib.Path(dest).write_bytes(icon)
        return

    # Otherwise a DIB: header, then BGRA bottom-up, then a 1bpp AND mask --
    # which is why the stored height is twice the real one.
    width, height, _planes, bpp = struct.unpack_from("<iihh", icon, 4)
    height //= 2
    if bpp != 32:
        raise ValueError("icon is %d bpp, not 32" % bpp)

    pixels = icon[40:40 + width * height * 4]
    rows = []
    for y in range(height - 1, -1, -1):
        line = pixels[y * width * 4:(y + 1) * width * 4]
        row = bytearray(b"\x00")  # filter byte: none
        for x in range(0, width * 4, 4):
            b, g, r, a = line[x:x + 4]
            row += bytes((r, g, b, a))
        rows.append(bytes(row))

    pathlib.Path(dest).write_bytes(png(width, height, rows))


if __name__ == "__main__":
    main()
