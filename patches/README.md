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

## 0002 — a touchpad scrolls

Two-finger scrolling did nothing while a wheel mouse worked, which is the
shape of it: wine acts on the wheel's event and left the touchpad's an empty
function. Upstream: [56043](https://bugs.winehq.org/show_bug.cgi?id=56043)
and [57709](https://bugs.winehq.org/show_bug.cgi?id=57709), both open, both
UNCONFIRMED.

## Building it

In a container, so the host keeps no build dependencies. About forty minutes
on fourteen threads.

Both architectures, although the client is 64-bit: Kakao ships it inside a
32-bit NSIS installer, and a Wine with no 32-bit half stops at "failed to
load syswow64\ntdll.dll". New WoW64 needs a 32-bit PE compiler and no 32-bit
host libraries, which is why mingw32 is here and nothing else is.

```sh
toolbox create -y --container wine-build
toolbox run -c wine-build sudo dnf builddep -y wine
toolbox run -c wine-build sudo dnf install -y mingw32-gcc mingw64-gcc

curl -fsSLO https://dl.winehq.org/wine/source/11.x/wine-11.18.tar.xz
tar -xf wine-11.18.tar.xz
( cd wine-11.18 && git init -q . && git apply /path/to/patches/000*.patch )

toolbox run -c wine-build sh -c '
  cd wine-11.18 && mkdir -p build && cd build &&
  ../configure --enable-archs=i386,x86_64 --prefix=$HOME/wine-emoji &&
  make -j$(nproc) && make install'
```

Strip it before packaging. Unstripped it is 1.7GB against 379MB, and the
debug information is of no use in a binary nobody has the symbols for
anyway; `x86_64-w64-mingw32-strip` and `i686-w64-mingw32-strip` for the PE
modules, plain `strip` for the rest.

The flatpak takes it from there -- see `flatpak/` -- or put it where Bottles
looks for runners and point the bottle at it:

```sh
cp -a ~/wine-emoji \
  ~/.var/app/com.usebottles.bottles/data/bottles/runners/wine-11.18-emoji
flatpak run --command=bottles-cli com.usebottles.bottles \
  edit -b KakaoTalk --runner wine-11.18-emoji
```

Close the app first. Replacing a runner directory underneath a running
prefix leaves a zombie and takes the app with it.

**Check that what you built is what is running.** flatpak-builder caches a
module and will reuse it silently -- a manifest moved to another directory
makes its relative `path:` sources unresolvable, and the build says nothing
and succeeds with the old contents. That cost an afternoon of reading traces
of a patch that had never reached the app. Compare the file:

```sh
sha256sum ~/wine-emoji/lib/wine/x86_64-unix/winewayland.so
sha256sum "$(find ~/.local/share/flatpak/app/io.github.chaotic_ground.KakaoTalk \
  -name winewayland.so)"
```

`--disable-cache` avoids the problem at the cost of a full rebuild.

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
