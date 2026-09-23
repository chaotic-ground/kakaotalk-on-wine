# kakaotalk-on-wine

KakaoTalk, in Korean, on a GNOME Wayland desktop, set up in one command and
written down so the next person does not have to find it all again.

```sh
git clone https://github.com/chaotic-ground/kakaotalk-on-wine
kakaotalk-on-wine/bin/kakaotalk-bottle
```

Idempotent: re-running fills in only what is missing. Close KakaoTalk first,
or the registry steps crawl while it holds the prefix.

Tested on Fedora 43, GNOME 49 Wayland, Bottles 67, Wine 11.0,
KakaoTalk 26.8 (64-bit).

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
| Recovery if the tray window is closed | works, via the extension |
| New-message popups, bottom right | works, via a shell extension |
| Menus, tooltips, dialogs in Korean | works |
| Emoji | **boxes** |
| The window, when a message arrives with the chat list open | **hangs** |
| Two-finger scroll | **does not reach the app** |
| Tray icon right-click menu | **nothing happens** |
| Alt-tab label | says "Bottles" |

The five that do not work are Wine's or Wayland's, not settings. Each is
written up where the code deals with it, along with what was ruled out, so
nobody repeats the search:

- **Emoji** are not a composition problem -- one box per emoji, not two, so
  surrogate pairs are being put together. The fallback never happens: the
  emoji face is installed, Wine loads it, the SystemLink entries are read at
  startup, and missing glyphs still never reach it. Unchanged across the
  flatpak's Wine 11.0 and the soda runner, and unchanged by moving from the
  32-bit client to the 64-bit one, so it is neither the runner's build nor
  the architecture. Nothing newer than 11.0 has been tried, for the reason
  under "Endpoint antimalware eats Wine" below. See `link_emoji_font`.
- **The hang** was called a rendering bug for a long time, because that is
  what it looks like: with the chat list open a message arrives and from then
  on only freshly painted fragments appear. It is not. In the GNOME overview
  the window's thumbnail shows the desktop wallpaper straight through, which
  is an X11 window with a ParentRelative background that has been painted
  *nothing*, rather than one whose drawing was lost. Resizing it from outside
  with `xdotool` produces no repaint, and a resize is a WM_PAINT: a message
  loop that was running would have drawn. Clicks do not land either. So the
  UI thread is stuck, and the app has to be restarted -- clicking the real
  tray icon also brings it back, since that makes KakaoTalk re-show the
  window itself.

  It reproduces identically under the X11 driver, so it is not winewayland,
  and whatever it is sits below the display driver. `bin/kakaotalk-hang-report`
  exists to catch it in the act; there is no diagnosis yet beyond the above.
  Do not attach winedbg to it -- that was tried on a live instance and the
  app was gone a moment later, taking the reproduction with it.
- **Two-finger scroll** is not picked up by Wine's Wayland driver. Confirmed
  by switching that one registry key: the same prefix under the X11 driver
  scrolls.
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
- `bin/kakaotalk-restart` — behind the app icon's quit and restart actions.
  Drops Wine's stale monitor record on the way past.
- `bin/wayland-screenshot` — capture through the desktop portal, for when the
  app's windows are no longer XWayland and nothing else can see them.
- `bin/kakaotalk-hang-report` — run it while the window is stuck. Thread
  states, and backtraces resolved to module plus offset off the process's own
  memory map, since nothing here carries symbols and bare addresses say
  nothing. `eu-stack`, not `winedbg`: it attaches, walks and detaches.
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
