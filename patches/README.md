# Patches

Wine changes this needs and upstream does not have. They are in the published
Wine, so installing the flatpak is enough; building them is for changing
them.

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

## 0003 — a picture pastes

Copy an image in a browser, paste it into a chat room, nothing happens.
What a compositor offers is mime types and what a Windows app asks for is
`CF_DIB`, and the Wayland driver's table had nothing joining the two: it
carries `image/png`, `image/jpeg` and `image/gif` as registered formats named
"PNG", "JFIF" and "GIF", which no ordinary app looks for, and `image/tiff` as
`CF_TIFF`, which few accept. No `CF_DIB` entry at all.

The X11 driver has had `image/bmp` to `CF_DIB` for years, so this is that
moved across. One entry is enough because Firefox and GTK put `image/bmp` on
the clipboard beside `image/png` -- worth checking with
`wl-paste --list-types` before assuming it of another source.

`image/png` needed a decoder and gets one in 0006, since GNOME's own
screenshot offers nothing else.

## 0004 — the keyboard layout is the keyboard's

On a Dvorak keyboard every shortcut was in its QWERTY place: Ctrl+V pasted
from the key labelled V rather than the key that types v. The scancode
arrives correctly and the driver's Dvorak table is right; the table was not
being used.

`WAYLAND_KbdLayerDescriptor` finds a layout by rebuilding its HKL and
comparing, and `get_layout_hkl` puts the layout's own language in the high
word. The thread that asks is the keyboard event thread -- it is the one that
turns scancodes into vkeys -- and it has never had a layout activated,
because the activation is a message posted to the focused window and never
reaches it. So `NtUserGetKeyboardLayout` hands it one invented from the user
locale, `MAKELONG(locale, locale)`. Nothing matches that unless the locale
happens to equal the layout's language, and the miss returns NULL, which
win32u answers with its built-in tables. Those are QWERTY.

Which is why nobody has reported it: on a QWERTY keyboard the wrong fallback
is right. It shows as soon as the two differ, and this package makes them
differ for everyone -- the prefix's locale is Korean, because KakaoTalk reads
its UI language once and has to find Korean there, while the keyboard is
whatever the person owns.

The proof is one line under `WINEDEBUG=+keyboard`:

```
warn:keyboard:WAYLAND_KbdLayerDescriptor Failed to find Xkb layout for HKL 0x4120412
```

`0412` is Korean, twice, and no layout has that in its high word.

## 0005 — a window owned by a hidden one is shown

The tray menu never appeared. Not misplaced, not behind something: nowhere.
An app that hides to the tray owns that menu from a window that is not on
screen, and `wayland_win_data_create_wayland_surface` gives any window with
an owner a **subsurface** of the owner's surface. An owner that is not on
screen has a surface with no role -- the driver keeps one but never maps it,
deliberately, so as not to fill the compositor with empty xdg_toplevels --
and a subsurface of an unmapped surface is drawn nowhere at all.

So take the subsurface only when the owner is actually on screen. Otherwise
give the window its own surface, which is already what a window with no owner
gets.

The evidence, from a program that asked Win32 rather than looking at the
screen: the menu window exists, is `visible=1`, is 124x141 at a sensible
place, and its owner is an `EVA_Window_Dblclk` that is 0x0 and `visible=0`.

## 0006 — a PNG from the clipboard is decoded

0003 covers what Firefox and GTK offer, and not what GNOME's screenshot does:
that puts `image/png` on the clipboard and nothing else. So the PNG has to be
decoded, and the driver is where it happens because there is nowhere tidier
-- the format synthesis that turns a `CF_DIB` into a `CF_BITMAP` lives in the
*server* and knows only the builtin format ids, while "PNG" is registered at
runtime and can never be one of them.

Three decisions worth knowing about:

- **Alpha is composited onto white.** A DIB has no agreed alpha channel: the
  high byte of a 32-bit one is reserved and applications disagree about it. A
  screenshot with a rounded corner pasted onto black looks broken in a way
  nobody would think to blame a clipboard for.
- **`image/png` becomes `CF_DIB`** instead of the registered format named
  "PNG" it used to arrive as. Nothing looks for that name.
- **There is no encoder.** Nothing needs one: a clipboard format goes out
  under a single mime type, the first in the table carrying it, and for
  `CF_DIB` that is `image/bmp`.

`-lpng16` is hardcoded in the driver's `Makefile.in`, which an upstream
version would not do. Wine's configure looks for libpng for the PE side only
-- `PNG_PE_LIBS` -- so a unix-side check would have to come first.

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
# 0006 links the Wayland driver against the system libpng.
toolbox run -c wine-build sudo dnf install -y libpng-devel

curl -fsSLO https://dl.winehq.org/wine/source/11.x/wine-11.18.tar.xz
tar -xf wine-11.18.tar.xz
( cd wine-11.18 && git init -q . && git apply /path/to/patches/000*.patch )
```

If you mean to commit to that throwaway repo to make a patch from, keep the
build directories out of it. `git add -A` after a build takes in three
gigabytes of object files, and `format-patch` then hands back fifty thousand
lines of them.

```sh

toolbox run -c wine-build sh -c '
  cd wine-11.18 && mkdir -p build && cd build &&
  ../configure --enable-archs=i386,x86_64 --prefix=$HOME/wine-emoji &&
  make -j$(nproc) && make install'
```

Strip it before packaging. Unstripped it is 1.7GB against 379MB, and the
debug information is of no use in a binary nobody has the symbols for
anyway; `x86_64-w64-mingw32-strip` and `i686-w64-mingw32-strip` for the PE
modules, plain `strip` for the rest.

Then drop `include/` and every `lib/wine/*/*.a`. Import libraries and headers
are for building against Wine, not for running it, and they are the 120MB
between the 499MB that stripping leaves and the 379MB that ships. Compare the
file list against the tarball already published rather than trusting this
paragraph:

```sh
diff <(tar -tf old.tar.xz | sed 's#/$##' | sort) <(find wine-11.18-emoji | sort)
```

The flatpak takes it from there. Put the tarball at
`flatpak/wine-11.18-emoji-wow64-x86_64.tar.xz` and build with
`local-manifest.yml`, which reads it from disk; the tracked manifest reads
the published one by URL and checksum instead.

Close the app first. Replacing Wine underneath a running prefix leaves a
zombie and takes the app with it.

**Check that what you built is what is running.** flatpak-builder caches a
module and will reuse it silently. Twice over: a manifest moved to another
directory makes its relative `path:` sources unresolvable, and a `path:`
tarball replaced in place does not invalidate anything either -- a rebuilt
Wine with a new checksum still gets `Cache hit for wine, skipping build`,
and `--force-clean` does not help because it cleans the build directory and
not the cache. Both times the build says nothing and succeeds with the old
contents. The first cost an afternoon of reading traces of a patch that had
never reached the app. Compare the file:

```sh
sha256sum ~/wine-emoji/lib/wine/x86_64-unix/winewayland.so
sha256sum "$(find ~/.local/share/flatpak/app/io.github.chaotic_ground.KakaoTalk \
  -name winewayland.so)"
```

`--disable-cache` avoids the problem at the cost of a full rebuild.

The prefix was made by an older Wine, so the first run updates it. That is
`wineboot -u` and it happens by itself.

**A Wine built here lives under `$HOME`, where endpoint antimalware can
reach it** -- see "Endpoint antimalware eats Wine" in the top-level README.
Once it is inside the flatpak it is safe, because a deployed app is
read-only. If 92 files go missing from a build shortly after it is made,
that is what happened.

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
