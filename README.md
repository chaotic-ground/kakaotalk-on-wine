# kakaotalk-on-wine

KakaoTalk, in Korean, on a GNOME Wayland desktop, set up in one command and
written down so the next person does not have to find it all again.

```sh
git clone https://github.com/chaotic-ground/kakaotalk-on-wine
kakaotalk-on-wine/bin/kakaotalk-bottle
```

Or install the flatpak, which carries its own Wine -- patched, so emoji draw
-- and needs nothing on the host besides flatpak itself:

```sh
curl -fLO https://github.com/chaotic-ground/kakaotalk-on-wine/releases/latest/download/kakaotalk.flatpak
flatpak install --user kakaotalk.flatpak
```

The shell extension is worth having either way, and is the part that has to
be installed by hand, since a sandboxed app cannot put anything in
`~/.local/share/gnome-shell/extensions`. So it is the landing point: install
it, and its panel indicator offers to fetch the rest.

Idempotent: re-running fills in only what is missing. Close KakaoTalk first,
or the registry steps crawl while it holds the prefix.

Tested on Fedora 43, GNOME 49 Wayland, Bottles 67, Wine 11.0 and a patched
11.18, KakaoTalk 26.8 (64-bit).

## What it does

Installs [Bottles](https://usebottles.com) from Flathub, builds a bottle for
KakaoTalk, and configures it. Wine comes from inside the flatpak, so nothing
is installed on the host.

The 64-bit client, so no part of the prefix is 32-bit and WoW64 never comes
into it. Kakao publishes three Windows builds and links all of them from the
download page; the one every search result hands you is the 32-bit one at
`app-pc.kakaocdn.net/talk/win32/`, which is not this.

## What works, and what does not

| | |
|---|---|
| Korean UI, Hangul everywhere | works |
| Tray icon, click to restore the window | works |
| Panel indicator: raise, restore or start | works, via the extension |
| Restart and quit, on the indicator's right click | works, via the extension |
| Popup on top, and out of the window list | works, via the extension |
| Popup never taking the focus | works, via the extension |
| Recovery if the tray window is closed | works, via the extension |
| New-message popups, bottom right | works, via a shell extension |
| The leftover window a notification strands | hidden, via the extension |
| Menus, tooltips, dialogs in Korean | works |
| Emoji | works, **with a patched Wine** (`patches/`); monochrome |
| The window coming back to the front by itself | **it does not** |
| Two-finger scroll | works, **with a patched Wine** (`patches/`) |
| Tray icon right-click menu | **nothing happens** |
| Alt-tab label | says "Bottles" |

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

  A leftover makes this worse than it needs to be: every notification strands
  a 107x29 window titled 카카오톡, the same title the real one carries, and
  anything matching on title alone finds that instead. The extension did, and
  spent its click activating it -- see `_findMainWindow`, which now requires
  some height as well. The leftover is also hidden outright now, along with
  the popup's shadow, which Wine draws as a plain white rectangle around the
  message rather than a shadow under it. See `_hideChrome`.

- **Two-finger scroll** needed a patch, in `patches/`. Wine acts on
  `wl_pointer.axis_value120`, which is a wheel's event, and left
  `wl_pointer.axis` an empty function -- and a touchpad has no notches, so a
  distance is all it sends. Upstream knows:
  [56043](https://bugs.winehq.org/show_bug.cgi?id=56043) and
  [57709](https://bugs.winehq.org/show_bug.cgi?id=57709), both open.
- **The tray menu** produces no window at all when right-clicked, so there is
  nothing misplaced to correct. Left-click, which restores the window, works.
  Also the Wayland driver's doing -- under X11 the tray is a real XEmbed icon
  with a working menu, which is what the AppIndicator extension picks up.
- **Alt-tab** says "Bottles" because GNOME trusts a window's sandbox identity
  over the WM_CLASS it claims, deliberately, so a sandboxed app cannot pose
  as another. `flatpak run` puts every process in
  `app-flatpak-com.usebottles.bottles-*.scope`, and the desktop entry's
  correct StartupWMClass loses to it.

Quit and restart live on the panel indicator's right-click menu and on the
app icon's, rather than the tray, since the tray's menu does not open. The
indicator is the one to reach for -- it is already in the panel, beside the
thing it acts on. Clicking the app icon while it is
already running does nothing on purpose: passing that through starts a second
client in the same prefix and single-instance KakaoTalk loses both. That also matters after a display
change: Wine keeps a stale record of the monitors, which the restart clears.

## The things that were not obvious

**KakaoTalk reads the UI language once, while installing.** A client installed
against an English prefix stays English afterwards no matter what the prefix
says later, window title included. Everything else has to be Korean first,
which is what the ordering in `bin/kakaotalk-bottle` is for, and `--reinstall`
is the way out of a bottle built wrong.

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
finally gave it away -- that is not how a bad download fails. The runner
Bottles ships survives because it lives in the flatpak runtime's read-only
`/usr`, where nothing can reach it. `ensure_runner` checks for `gdi32.dll`
right after extracting and says this instead of letting Wine say the other
thing.

**GNOME will not notice a new desktop file id's actions,** or a new extension
directory, until the next login, and a Wayland session cannot restart the
shell. Hence `kakaotalk-bottle.desktop` rather than `kakaotalk.desktop`, and
hence the extension being split into a loader plus `impl.js` that the loader
re-imports with a cache-busting query, so editing it afterwards costs a
disable/enable instead of a logout.

## Layout

- `bin/kakaotalk-bottle` — the whole setup, idempotent.
  `KAKAOTALK_DPI` and `WINE_GRAPHICS` override the two choices most likely to
  differ on another machine. `KAKAOTALK_WINE` takes a
  [kron4ek](https://github.com/Kron4ek/Wine-Builds) release and pins plain
  upstream Wine instead of the one Bottles ships, which is what you want
  before reporting anything upstream.
- `bin/kakaotalk-restart` — behind the app icon's quit and restart actions,
  and the extension's. Uses whichever of the two installs is present, flatpak
  first. Drops Wine's stale monitor record on the way past.
- `bin/kakaotalk-install` — fetches the current bundle and installs it for a
  user, no root. What the indicator calls when nothing is installed yet.
- `flatpak/` — the manifest and the launcher inside it. Built from the
  release assets, so it stands on its own rather than needing this checkout.
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
  applied as a Bottles registry rule so a runner swap cannot undo it.
- `config/kakaotalk-popup.json` — rules for the extension below.
- `gnome/kakaotalk-popup@lens0021/` — places the new-message popup, all of
  it: a notification is several windows and only one has a name to write a
  rule for, so the rest move by the same offset rather than being left in
  the middle of the screen. Does not raise it over a fullscreen window, the
  way GNOME holds its own banners back. Adds a panel indicator that raises
  KakaoTalk's window on a left click, or reaches it through the tray when it
  is hidden, or starts the app when it is not running, and offers restart and
  quit on a right click. Also restarts KakaoTalk if the tray window is
  closed, which otherwise strands it with no way to ask it back.

## License

GPL-3.0-or-later. The repository carries a GNOME Shell extension, and GNOME
Shell is GPL-2.0-or-later, so anything that runs inside it has to be GPL
compatible.
