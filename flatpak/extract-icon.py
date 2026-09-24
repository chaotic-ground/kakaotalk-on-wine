#!/usr/bin/env python3
"""PE에서 가장 큰 아이콘을 꺼내 PNG로 쓴다.

GNOME이 alt-tab과 오버뷰에 일반 자리표시자를 그리는 이유는 앱과 묶을 수
없는 창을 들고 있기 때문이다. 이 flatpak이 배포하는 desktop 파일이 그
묶음을 고치고, 이 스크립트가 그림을 고친다.

그림은 카카오의 것이라 이 저장소에도 빌드에도 없다. 사용자가 설치한
클라이언트에서, 그 사람의 기계에서 꺼내 아이콘 테마가 보는 자리에 둔다.
Wine도 이걸 줄 수 없다. winewayland는 xdg-toplevel-icon-v1로 창 아이콘을
설정할 수 있는데 mutter가 그 프로토콜을 구현하지 않았다. 실행할 때마다
"window icons will not be supported"라고 스스로 말한다.

icoutils가 아니라 python3인 이유는 런타임에 icoutils가 없기 때문이다.
zlib은 표준 라이브러리에 있으니 PNG를 손으로 쓰는 편이 의존성보다 싸다.

    extract-icon.py <exe> <dest.png>
"""

import pathlib
import struct
import sys
import zlib


def resource_section(data):
    """파일에서 .rsrc가 시작하는 자리와, 그것이 생각하는 자기 주소."""
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("not a PE")

    sections = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    opt = pe + 24
    # PE32+는 데이터 디렉터리를 PE32보다 16바이트 뒤에 둔다.
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

    # 요즘 아이콘이 흔히 그렇듯 이미 PNG면 할 일이 없다.
    if icon[:8] == b"\x89PNG\r\n\x1a\n":
        pathlib.Path(dest).write_bytes(icon)
        return

    # 아니면 DIB다. 헤더, 아래에서 위로 가는 BGRA, 그리고 1bpp AND 마스크.
    # 저장된 높이가 실제의 두 배인 이유가 그 마스크다.
    width, height, _planes, bpp = struct.unpack_from("<iihh", icon, 4)
    height //= 2
    if bpp != 32:
        raise ValueError("icon is %d bpp, not 32" % bpp)

    pixels = icon[40:40 + width * height * 4]
    rows = []
    for y in range(height - 1, -1, -1):
        line = pixels[y * width * 4:(y + 1) * width * 4]
        row = bytearray(b"\x00")  # 필터 바이트: 없음
        for x in range(0, width * 4, 4):
            b, g, r, a = line[x:x + 4]
            row += bytes((r, g, b, a))
        rows.append(bytes(row))

    pathlib.Path(dest).write_bytes(png(width, height, rows))


if __name__ == "__main__":
    main()
