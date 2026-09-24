# Patches

Wine changes this needs and upstream does not have. Building Wine is not part
of `bin/kakaotalk-bottle` and is not expected of anyone: without this the app
works, minus emoji.

## 0001 — an astral character is drawn as one character

Emoji, which are the only thing here that lives above U+FFFF. See the patch's
own message for what was wrong, which was three separate things at once.

Upstream: [bug 53929](https://bugs.winehq.org/show_bug.cgi?id=53929), open
since 2022. It describes the first of the three.

Colour emoji stay monochrome. `win32u`'s text path has no colour glyph
support at all -- no `FT_LOAD_COLOR`, no CBDT, no COLR -- and a glyph reaches
the DIB driver as a coverage mask that gets painted in the current text
colour. There is no channel for a glyph that carries its own colours, and
adding one is a different and much larger job.

## Building it

In a container, so the host keeps no build dependencies. A 64-bit-only build
takes about twenty minutes on fourteen threads; there is no 32-bit half to
build because the client is 64-bit.

```sh
toolbox create -y --container wine-build
toolbox run -c wine-build sudo dnf builddep -y wine

curl -fsSLO https://dl.winehq.org/wine/source/11.x/wine-11.18.tar.xz
tar -xf wine-11.18.tar.xz
( cd wine-11.18 && git init -q . && git apply /path/to/patches/0001-*.patch )

toolbox run -c wine-build sh -c '
  cd wine-11.18 && mkdir -p build && cd build &&
  ../configure --enable-archs=x86_64 --prefix=$HOME/wine-emoji &&
  make -j$(nproc) && make install'
```

Then put it where Bottles looks for runners and point the bottle at it:

```sh
cp -a ~/wine-emoji \
  ~/.var/app/com.usebottles.bottles/data/bottles/runners/wine-11.18-emoji
flatpak run --command=bottles-cli com.usebottles.bottles \
  edit -b KakaoTalk --runner wine-11.18-emoji
```

Close the app first. Replacing a runner directory underneath a running
prefix leaves a zombie and takes the app with it.

The prefix was made by an older Wine, so the first run updates it. That is
`wineboot -u` and it happens by itself.

**A self-built runner lives under `$HOME`, where endpoint antimalware can
reach it** -- see "Endpoint antimalware eats Wine" in the top-level README.
The one Bottles ships survives because it sits in the flatpak runtime's
read-only `/usr`. If 92 files go missing from the runner shortly after it is
installed, that is what happened.

## Testing it

`emojitest.c` asks the font for a character and prints the size of the
outline that comes back, so the answer is a number rather than a look at a
window. A missing glyph is the notdef box and is small; a real glyph is not.

```sh
x86_64-w64-mingw32-gcc -o emojitest.exe emojitest.c -lgdi32
cp emojitest.exe <prefix>/drive_c/
wine C:\\emojitest.exe
```

Unpatched, and patched:

```
malgun astral  U+1F33E  outline=188 bytes   box=22x26
malgun astral  U+1F33E  outline=3144 bytes  box=37x33
```

The same 3144 whether the emoji font is selected directly or reached through
a font link, which is how you tell the link is working rather than the glyph
merely existing.
