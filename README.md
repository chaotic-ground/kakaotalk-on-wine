# kakaotalk-on-wine

KakaoTalk, in Korean, on a GNOME Wayland desktop, in one file and written
down so the next person does not have to find it all again.

```sh
curl -fLO https://github.com/chaotic-ground/kakaotalk-on-wine/releases/latest/download/kakaotalk.flatpak
flatpak install --user kakaotalk.flatpak
```

It carries its own Wine, patched, and needs nothing on the host besides
flatpak. KakaoTalk itself is not in it and cannot be, since it is Kakao's to
distribute; the launcher fetches the installer on first run.

The shell extension is the other half, and the part that has to be installed
by hand: a sandboxed app cannot put anything in
`~/.local/share/gnome-shell/extensions`. So it is also the landing point.
Install it, and its panel indicator offers to fetch the rest.

```sh
git clone https://github.com/chaotic-ground/kakaotalk-on-wine
cp -r kakaotalk-on-wine/gnome/kakaotalk-popup@lens0021 \
  ~/.local/share/gnome-shell/extensions/
gnome-extensions enable kakaotalk-popup@lens0021
```

Tested on Fedora 43, GNOME 49 Wayland, Wine 11.18 patched, KakaoTalk 26.8
(64-bit).

## What it does

Sets up a Wine prefix in Korean and installs the client into it, on first
run and never again. Four things have to be Korean before the installer
runs, each failing quietly and differently when it is missing, and KakaoTalk
reads its UI language once -- so the ordering is the whole of it. See
`flatpak/kakaotalk`.

The 64-bit client, so no part of the prefix is 32-bit and WoW64 never comes
into it. Kakao publishes three Windows builds and links all of them from the
download page; the one every search result hands you is the 32-bit one at
`app-pc.kakaocdn.net/talk/win32/`, which is not this.

## What works, and what does not

| | |
|---|---|
| Korean UI, Hangul everywhere | works |
| Menus, tooltips, dialogs in Korean | works |
| Panel indicator: raise the window, or restore it | works, via the extension |
| KakaoTalk's own tray menu, on the indicator's right click | works, **with a patched Wine** (0005) |
| Restart and quit, on the app icon's right click | works |
| Alt-tab icon and name | works |
| New-message popups, bottom right and on top | works, via the extension |
| Popup never taking the focus | works, via the extension |
| The leftover window a notification strands | hidden, via the extension |
| The date while a conversation is scrolled | placed, via the extension |
| Two-finger scroll | works, **with a patched Wine** (0002) |
| Emoji | works, **with a patched Wine** (0001); monochrome |
| Pasting an image, or a screenshot | works, **with a patched Wine** (0003, 0006) |
| Shortcuts on a non-QWERTY keyboard | works, **with a patched Wine** (0004) |
| The window coming back to the front by itself | **it does not** |

The rest are Wine's or Wayland's, not settings. Each is
written up where the code deals with it, along with what was ruled out, so
nobody repeats the search:

- **Emoji** need a patched Wine, and there is one in `patches/`. Three things
  were wrong at once, which is why no arrangement of fonts, substitutions or
  link keys ever moved it: Wine looks a glyph up one UTF-16 code unit at a
  time, so an astral character is looked up as each of its surrogate halves;
  `NtGdiGetGlyphOutline` masks the character to 16 bits, so composing the
  pair is not enough on its own; and the glyph cache is sized for the BMP, so
  an astral codepoint indexes past the end of it. Upstream knows about the
  first -- [bug 53929](https://bugs.winehq.org/show_bug.cgi?id=53929), open
  since 2022 -- and not the second.

  One finding survives without the patch and was worth the day it took: a
  font link is keyed on the family name Wine actually uses, and for
  NanumGothic.ttf that is the Korean 나눔고딕. The file carries both names,
  `create_family` turns whichever comes second into a substitution for the
  first with nothing in the registry to show for it, and a link keyed on a
  substituted name is discarded with `SystemLink entry for substituted font,
  ignoring`. `link_emoji_font` keys on 나눔고딕, and without that the patch
  would draw a notdef from a font that was never asked.

  Colour emoji stay monochrome either way. See `patches/README.md`.
- **The window does not come back by itself.** Close the chat list with its
  X, then wait for a message: clicking the tray restores the window and
  nothing appears. It is not hiding a failure. Traced, the app takes the
  click, posts itself a `WM_COMMAND`, calls `ShowWindow`, and Wine's
  `set_foreground_window` succeeds. None of that reaches the screen, because
  on a Wayland session a client cannot raise itself and winewayland has no
  xdg-activation -- so the window is restored behind everything, foreground
  in Wine's bookkeeping and invisible in the compositor's.

  Only the compositor can raise it, which is what the panel indicator asks it
  to do. Left-click it and the window comes forward, correctly drawn.

  With the flatpak the tray is out of it entirely. `flatpak/kakaoshow.c`
  posts the app the same `WM_COMMAND` a tray click makes it post itself, so
  the indicator asks the app directly -- no floating tray window, no pointer
  warped across the screen, no second click from a hand. The tray window is
  hidden outright, since nothing needs to click it any more.

  A leftover makes this worse than it needs to be: every notification strands
  a 107x29 window titled 카카오톡, the same title the real one carries, and
  anything matching on title alone finds that instead. The extension did, and
  spent its click activating it -- see `_findMainWindow`, which now requires
  some height as well. The leftover is also hidden outright now, along with
  the popup's shadow, which Wine draws as a plain white rectangle around the
  message rather than a shadow under it. See `_hideChrome`.

- **Pasting a picture** needed two patches, in `patches/`. Wine's Wayland
  driver had no `CF_DIB` in its clipboard table at all, so an image copied
  anywhere reached a Windows app under a name no Windows app looks for. 0003
  adds the `image/bmp` mapping the X11 driver has had for years, which covers
  Firefox and GTK; 0006 decodes `image/png`, which is all GNOME's own
  screenshot offers.
- **Two-finger scroll** needed a patch, in `patches/`. Wine acts on
  `wl_pointer.axis_value120`, which is a wheel's event, and left
  `wl_pointer.axis` an empty function -- and a touchpad has no notches, so a
  distance is all it sends. Upstream knows:
  [56043](https://bugs.winehq.org/show_bug.cgi?id=56043) and
  [57709](https://bugs.winehq.org/show_bug.cgi?id=57709), both open.
- **The tray menu** produced no window at all when right-clicked. That was a
  Wine bug and is patched now -- see `patches/`, 0005. The menu is what the
  panel indicator's right-click opens: KakaoTalk's own, put up by the app,
  rather than an imitation that would have to be kept in step with it. It
  arrives wherever the compositor felt like putting it, because a Wayland
  client cannot place its own toplevel, so the extension moves it under the
  click and closes it when the focus leaves -- a click elsewhere lands on
  another Wayland client and never reaches Wine, so nothing would dismiss it
  otherwise.

Quit and restart live on the app icon's right-click, as desktop actions. The
panel indicator's right-click is KakaoTalk's own menu, which has its own
quit; a restart is not something the app offers, and it is what clears Wine's
stale record of the monitors. Clicking the app icon while it is
already running does nothing on purpose: passing that through starts a second
client in the same prefix and single-instance KakaoTalk loses both. That also matters after a display
change: Wine keeps a stale record of the monitors, which the restart clears.

## The things that were not obvious

**KakaoTalk reads the UI language once, while installing.** A client installed
against an English prefix stays English afterwards no matter what the prefix
says later, window title included. Everything else has to be Korean first,
which is what the ordering in `flatpak/kakaotalk` is for, and `--reinstall`
is the way out of a prefix set up wrong.

**The flatpak starts with no Korean font at all.** Inside it,
`/usr/share/fonts` is the GNOME runtime's own set, Latin only, and the host's
fonts hang off `/run/host/fonts` where Wine never looks.

**Substituting Tahoma does nothing.** Wine ships its own, substitution only
steps in for a face that is missing, and the LOGFONTs under `Control Panel\
Desktop\WindowMetrics` name Tahoma outright. The face inside those blobs gets
renamed instead. `StatusFont` has to be created rather than edited, which is
why tooltips stayed broken after menus were fixed.

**A SystemLink keyed on a substituted font is discarded.** Wine says so:
`SystemLink entry for substituted font, ignoring`.

**A face Wine has is never substituted, and several of Wine's own faces have
no Hangul.** That does not look like a row of boxes. Their `.notdef` is
blank, so the text is drawn as the right amount of empty space: the date that
appears while a conversation is scrolled read "9. 24." with a gap where the
day of the week should be. So the font link carries NanumGothic as well as
the emoji face, for every face an application is likely to ask for by name.

**Endpoint antimalware eats Wine.** On a managed machine, Bitdefender
quarantined 92 of a kron4ek build's PE modules seconds after they were
written -- `gdi32.dll`, `svchost.exe`, `ping.exe` and friends, as
`Gen:Variant.Babar` and other generic heuristics -- and left the rest. What
that looks like is not a missing file. It is

```
wine: Call from ... to unimplemented function user32.dll.CreateDialogParamW
```

which is a lie, and it survives a fresh prefix, so it reads as a Wine bug. The
truth is one line above it under `WINEDEBUG=+loaddll`:

```
err:module:import_dll Library gdi32.dll (which is needed by
  L"C:\windows\system32\user32.dll") not found
```

Two different upstream archives lost the *same 92 filenames*, which is what
finally gave it away -- that is not how a bad download fails. Wine inside the
flatpak is safe, because a deployed app is read-only; what the scanner can
reach is a build sitting under `$HOME` on its way in, and the prefix, which
lives in `~/.var/app` and cannot be moved out of reach.

**GNOME draws the generic placeholder because it has a window it cannot tie
to an application.** Wine names a window after the process that owns it, so
every KakaoTalk window calls itself `kakaotalk.exe`, and nothing connects
that to anything installed. A desktop file with `StartupWMClass=kakaotalk.exe`
is the tie. The picture is a second problem: winewayland can set a window
icon over `xdg-toplevel-icon-v1` and mutter does not implement it -- it says
so on every launch, "window icons will not be supported" -- so the icon has
to come through the icon theme, which means a file on disk at build time.
Kakao's artwork is not this repository's to ship, so the launcher takes it
out of the client the user installed and writes it to `~/.local/share/icons`.
That, and only that, is what `--filesystem=xdg-data/icons` is for.

**A second `flatpak run` of a running app kills it.** Not a second client --
that failure is known and guarded. This is any wine process at all in a
second instance, as soon as it looks at another process: `wine tasklist` is
enough, and so is a bare `EnumWindows` walk that calls `OpenProcess`. The
client and its `explorer.exe` are gone within five seconds and the login has
to be typed again. Each flatpak instance gets its own PID namespace, and the
processes that wine reads across that boundary are not the ones it thinks
they are. `wine cmd /c ver` in a second instance is harmless, and the same
enumeration run inside the *first* instance, through `flatpak enter`, is
harmless too, which is what pins it on the namespace rather than on the app.

So nothing reaches a running client by starting an instance. `--show` and
`--quit` write a word into a file under `~/.var/app`, which is the host's own
filesystem, and the instance that owns the client picks it up -- see
`serve_control` in `flatpak/kakaotalk`. It is a plain file and not a fifo
because one of the writers is a GNOME Shell extension, and opening a fifo for
writing blocks until a reader arrives.

**GNOME will not notice a new desktop file id's actions,** or a new extension
directory, until the next login, and a Wayland session cannot restart the
shell. That is why the extension keeps its old directory name however much
it grows, and why it is split into a loader plus `impl.js` that the loader
re-imports with a cache-busting query -- editing it afterwards costs a
disable/enable instead of a logout. The metadata is read at load time and is
not covered by that, so a rename shows up only after a logout.

## Layout

- `bin/kakaotalk-restart` — start, quit and restart from outside the sandbox.
  The launcher does most of this from the inside and is the better place for
  it; what cannot happen in there is insisting, since each flatpak instance
  has its own PID namespace. The extension calls it to recover a stranded
  app.
- `bin/kakaotalk-install` — fetches the current bundle and installs it for a
  user, no root. What the indicator calls when nothing is installed yet.
- `flatpak/` — the manifest and the launcher inside it.
  `io.github.chaotic_ground.KakaoTalk.yml` takes everything by URL and
  checksum, so it stands on its own rather than needing this checkout, and
  that is what CI builds from. `local-manifest.yml` is the same thing with
  local paths, for iterating against files on a workstation.
  `kakaoshow.c` is the one Windows program here: it asks a running KakaoTalk
  to show its window, which is what makes the tray dispensable.
  `extract-icon.py` takes the app's icon out of the installed client, since
  the picture is Kakao's and cannot ship here.
- `bin/wayland-screenshot` — capture through the desktop portal, for when the
  app's windows are no longer XWayland and nothing else can see them.
- `bin/kakaotalk-hang-report` — thread states, and backtraces resolved to
  module plus offset off the process's own memory map, since nothing here
  carries symbols and bare addresses say nothing. `eu-stack`, not `winedbg`:
  it attaches, walks and detaches, where winedbg killed the process it was
  asked about. Written to diagnose a window believed to be hung; nothing was
  hung, and the report is what established that.
- `bin/kakaotalk-trace` — runs the app under `WINEDEBUG=+msg`, keeping the
  last of the firehose in a ring. It is what turned guesses about the window
  into the `ShowWindow`/`set_foreground_window` sequence above.
- `patches/` — Wine changes upstream does not have, with what they fix and
  how to build them. Not part of the setup: without them the app works, minus
  emoji.
- `config/kakaotalk-korean.reg` — UI language and Latin font substitutions,
  imported into the prefix before the client is installed. KakaoTalk reads
  its UI language once, so this has to be in place first.
- `config/kakaotalk-popup.json` — rules for the extension below.
- `gnome/kakaotalk-popup@lens0021/` — "KakaoTalk on Wayland", which is most
  of what the driver leaves short. The directory keeps its old name: GNOME
  will not notice a new extension id until the next login, and a Wayland
  session cannot restart the shell.

  It places the new-message popup, all of it: a notification is several
  windows and only one has a name to write a rule for, so the rest move to
  the same corner rather than being left in the middle of the screen. It
  stops that popup taking the keyboard, by re-typing it to NOTIFICATION,
  which mutter never gives the focus to. That matters because the popup
  carries a reply box, so keystrokes that land in it while the focus is away
  are not lost but typed into a chat room. It does not raise a popup over a fullscreen window, the
  way GNOME holds its own banners back.

  It also stands in for the tray, which Wayland has no protocol for and Wine
  therefore draws as a floating window. A left click on the panel indicator
  brings the app's window back; a right click opens the app's own menu, moved
  under the click and dismissed when the focus leaves it. The tray window
  itself is hidden, since nothing needs to click it any more. And with
  nothing installed the indicator offers to install it, since a shell
  extension lives where a sandboxed app cannot put itself.

## License

GPL-3.0-or-later. The repository carries a GNOME Shell extension, and GNOME
Shell is GPL-2.0-or-later, so anything that runs inside it has to be GPL
compatible.
