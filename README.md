# kakaotalk-on-wine

KakaoTalk, in Korean, on a GNOME Wayland desktop, set up in one command and
written down so the next person does not have to find it all again.

```sh
git clone https://github.com/chaotic-ground/kakaotalk-on-wine
kakaotalk-on-wine/bin/kakaotalk-bottle
```

Idempotent: re-running fills in only what is missing. Close KakaoTalk first,
or the registry steps crawl while it holds the prefix.

Tested on Fedora 43, GNOME 49 Wayland, Bottles 67, Wine 11.0 and 11.17,
KakaoTalk 26.8.

## What it does

Installs [Bottles](https://usebottles.com) from Flathub, builds a bottle for
KakaoTalk, and configures it. Wine comes from inside the flatpak, so nothing
is installed on the host.

## What works, and what does not

| | |
|---|---|
| Korean UI, Hangul everywhere | works |
| Tray icon, click to restore the window | works |
| Panel indicator: raise, restore or start | works, via the extension |
| Recovery if the tray window is closed | works, via the extension |
| New-message popups, bottom right | works, via a shell extension |
| Menus, tooltips, dialogs in Korean | works |
| Emoji | **boxes** |
| Two-finger scroll | **does not reach the app** |
| Tray icon right-click menu | **nothing happens** |
| Alt-tab label | says "Bottles" |

The four that do not work are Wine's or Wayland's, not settings. Each is
written up where the code deals with it, along with what was ruled out, so
nobody repeats the search:

- **Emoji** are not a composition problem -- one box per emoji, not two, so
  surrogate pairs are being put together. The fallback never happens: the
  emoji face is installed, Wine loads it, the SystemLink entries are read at
  startup, and missing glyphs still never reach it. Reproduces on upstream
  Wine 11.17, not only the flatpak's 11.0. See `link_emoji_font`.
- **Two-finger scroll** is not picked up by Wine's Wayland driver.
- **The tray menu** produces no window at all when right-clicked, so there is
  nothing misplaced to correct. Left-click, which restores the window, works.
- **Alt-tab** says "Bottles" because GNOME trusts a window's sandbox identity
  over the WM_CLASS it claims, deliberately, so a sandboxed app cannot pose
  as another. `flatpak run` puts every process in
  `app-flatpak-com.usebottles.bottles-*.scope`, and the desktop entry's
  correct StartupWMClass loses to it.

Quit and restart live on the app icon's right-click menu rather than the tray,
since the tray's menu does not open. Clicking the app icon while it is
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

**GNOME will not notice a new desktop file id's actions,** or a new extension
directory, until the next login, and a Wayland session cannot restart the
shell. Hence `kakaotalk-bottle.desktop` rather than `kakaotalk.desktop`, and
hence the extension being split into a loader plus `impl.js` that the loader
re-imports with a cache-busting query, so editing it afterwards costs a
disable/enable instead of a logout.

## Layout

- `bin/kakaotalk-bottle` — the whole setup, idempotent.
  `KAKAOTALK_DPI` and `WINE_GRAPHICS` override the two choices most likely to
  differ on another machine.
- `bin/kakaotalk-restart` — behind the app icon's quit and restart actions.
  Drops Wine's stale monitor record on the way past.
- `bin/wayland-screenshot` — capture through the desktop portal, for when the
  app's windows are no longer XWayland and nothing else can see them.
- `config/kakaotalk-korean.reg` — UI language and Latin font substitutions,
  applied as a Bottles registry rule so a runner swap cannot undo it.
- `config/kakaotalk-popup.json` — rules for the extension below.
- `gnome/kakaotalk-popup@lens0021/` — places the new-message popup, and adds
  a panel indicator that raises KakaoTalk's window, or reaches it through the
  tray when it is hidden, or starts the app when it is not running. Also
  restarts KakaoTalk if the tray window is closed, which otherwise strands it
  with no way to ask it back.

## License

GPL-3.0-or-later. The repository carries a GNOME Shell extension, and GNOME
Shell is GPL-2.0-or-later, so anything that runs inside it has to be GPL
compatible.
