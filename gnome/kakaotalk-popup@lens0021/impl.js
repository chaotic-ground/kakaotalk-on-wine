// Put KakaoTalk's new-message popup where the app asks for it.
//
// Wayland does not let a client position its own windows. KakaoTalk's popup
// asks for the bottom right corner and arrives mid-screen instead, and no
// amount of work inside Wine can change that. The compositor can, so it
// does the placing.
//
// The tray menu is not in scope, though it looks like the same problem.
// Right-clicking the floating tray window produces no window at all -- not a
// misplaced one -- so there is nothing here to move. Wine's Wayland driver
// appears not to realise those menus as windows. Left-clicking the same
// window does work and restores the main window, which is worth knowing
// before anyone decides the tray is useless and hides it.
//
// The pointer action is kept because it is correct and cost nothing to
// leave: a client cannot ask where the cursor is either, and the compositor
// can, so any menu that does turn up as a window can be put under it.
//
// The rules live in a JSON file, not in here, and are re-read when it
// changes. That is not tidiness: a Wayland session offers no way to make the
// shell reload an extension's code, so every edit to this file costs a
// logout, while an edit to the config costs nothing.
//
//   ~/.config/kakaotalk-popup.json
//   {
//     "log": false,
//     "rules": [
//       {"type": [0], "title": "KakaoTalkShadowWnd", "action": "bottom-right"}
//     ]
//   }
//
// Turn "log" on to find out what a window looks like before writing a rule
// for it. That is how KakaoTalkShadowWnd was named: a message arrived while
// the log was running and the popup announced itself, 315 wide, its height
// growing and shrinking as it slid. Do not go by size alone -- Firefox's
// menus come through the same width as KakaoTalk's, with no class and no
// title, which is why ownership is settled by pid.
//
// A rule matches a window owned by one of KakaoTalk's processes when every
// field it names matches: "type" against Meta.WindowType, "title" exactly,
// "max_width"/"max_height" as bounds on the frame. Actions are "pointer"
// (top left corner to the cursor), "bottom-right" (against the work area's
// corner), and "none" (match and leave alone, to keep a broader rule below
// from taking it). "above": true also keeps the window on top.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
// Loaded by extension.js, which re-imports this file on every enable so it
// can be edited without logging out. Plain class, not an Extension subclass:
// the shell only ever sees the loader.

const TAG = '[kakaotalk-popup]';
const MARGIN = 16;
// Wine gives its own windows these, but a menu arrives with no class at all,
// so ownership is tracked by the pids these windows come from.
const OWNER_CLASSES = ['kakaotalk.exe', 'explorer.exe'];

const DEFAULT_CONFIG = {
    log: true,
    rules: [],
    tray_indicator: true,
    // Where in the tray window the icon sits, since the click has to land on
    // the icon and not merely inside the window. From the left edge, and from
    // the bottom edge, because the title bar Wine draws makes the top a poor
    // thing to measure from. Tunable without touching code: getting this
    // wrong is silent, the click simply does nothing.
    tray_click: {from_left: 20, from_bottom: 15},
    // Restart KakaoTalk when its tray window is closed. See _watchTray.
    recover_tray: true,
    // Stop a new-message popup taking focus in the first place. See
    // _disarmPopup. keep_focus is the fallback for anything that slips
    // through before the title is known.
    keep_focus: true,
    // Keep the tray window out of alt-tab and the overview. The indicator is
    // the way to it now, so its place in the window list is only clutter.
    hide_tray: true,
};

// The window KakaoTalk puts a new message in. It is redrawn as it slides, a
// fresh window per frame, so this name turns up a lot.
const POPUP_TITLE = 'KakaoTalkShadowWnd';

// A restart destroys the tray window on its way, which would look exactly
// like the thing being recovered from. Long enough to cover a restart, short
// enough that a second accident a minute later is still caught.
const RECOVER_COOLDOWN_US = 90 * 1000 * 1000;


// A panel button that stands in for Wine's floating tray window.
//
// Under Wayland there is no system tray protocol, so Wine draws the tray as
// an ordinary window. It works -- a left click on it brings KakaoTalk's
// window back -- but it does not appear in alt-tab, so reaching it means a
// trip through the overview, which is a lot of ceremony for one click.
//
// The button cannot simply restore the window itself. KakaoTalk does not
// minimise, it hides: once it goes to the tray its window stops existing as
// far as the compositor is concerned, so there is nothing to activate. Only
// the app can bring it back, and the only thing it listens to is a click on
// that tray window.
//
// So the click is delivered for real, with a virtual pointer: raise the tray
// window, warp to it, press and release, warp back. The cursor visibly jumps
// and returns. That is the cost, and it is why this is a setting.
//
// GTypeName is made unique per load on purpose. GObject registers a type name
// globally and keeps it, so re-importing this file -- which is the whole
// point of the loader -- would otherwise fail with "already registered" and
// take the extension down with it.
const TrayIndicator = GObject.registerClass({
    GTypeName: `KakaoTalkTrayIndicator_${Date.now()}`,
},
class TrayIndicator extends PanelMenu.Button {
    _init(owner) {
        // The third argument says not to build a menu. With one, the button
        // treats a click as "open my menu" and the handler below never runs.
        super._init(0.5, 'KakaoTalk', true);
        this._owner = owner;
        this.add_child(new St.Icon({
            icon_name: 'kakaotalk',
            style_class: 'system-status-icon',
        }));
        this.connect('button-press-event', () => {
            this._owner.pokeTray();
            return Clutter.EVENT_STOP;
        });
    }
});

// The tray is the explorer.exe window; the app's own windows are not it.
function owned_tray_check(wmClass) {
    return wmClass === 'explorer.exe';
}

export default class KakaoTalkPopup {
    constructor(extension) {
        this._extension = extension;
    }

    enable() {
        this._pids = new Set();
        this._config = DEFAULT_CONFIG;
        this._configPath = GLib.build_filenamev(
            [GLib.get_user_config_dir(), 'kakaotalk-popup.json']);
        this._loadConfig();
        this._watchConfig();
        this._dumpWindows();

        this._createdId = global.display.connect('window-created',
            (_display, window) => this._onWindowCreated(window));
        this._watchFocus();
        this._addIndicator();
        console.log(`${TAG} enabled, config=${this._configPath}`);
    }

    disable() {
        if (this._createdId) {
            global.display.disconnect(this._createdId);
            this._createdId = null;
        }
        this._monitor?.cancel();
        this._monitor = null;
        this._pids = null;
        if (this._focusId) {
            global.display.disconnect(this._focusId);
            this._focusId = null;
        }
        this._lastFocused = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._virtual = null;
    }

    // What exists right now, as opposed to what gets created later. Answers
    // the question a window-created hook cannot: whether a window is still
    // there after the app has put itself away.
    _dumpWindows() {
        for (const window of global.display.list_all_windows()) {
            const wmClass = window.get_wm_class();
            if (wmClass !== 'kakaotalk.exe' && wmClass !== 'explorer.exe')
                continue;
            // Learn the pids from what is already open. Without this the
            // set stays empty until some window happens to be created, and
            // the tray cannot be found in the meantime.
            const pid = window.get_pid();
            if (pid > 0)
                this._pids.add(pid);
            if (owned_tray_check(wmClass)) {
                this._watchTray(window);
                // Windows that were already up when this loaded never went
                // through _onWindowCreated, so re-type them here too.
                this._retype(window);
            }
            if (this._config.log)
                console.log(`${TAG} present: ${this._describe(window)}`);
        }
    }


    // A new message arrives and its popup takes the keyboard with it, which
    // in the middle of typing somewhere else is worse than missing the
    // message. The popup is not something anyone types into, so hand the
    // focus straight back to whatever had it.
    //
    // Restoring focus raises this again with the old window as the subject,
    // which is not a popup, so it records and stops there rather than
    // bouncing.
    _watchFocus() {
        this._focusId = global.display.connect('notify::focus-window', () => {
            if (!this._config.keep_focus)
                return;
            const focused = global.display.focus_window;
            if (!focused)
                return;
            if (focused.get_title() !== POPUP_TITLE) {
                this._lastFocused = focused;
                return;
            }
            const previous = this._lastFocused;
            if (!previous || previous.get_compositor_private() === null)
                return;
            previous.activate(global.get_current_time());
        });
    }

    _addIndicator() {
        if (!this._config.tray_indicator)
            return;
        this._indicator = new TrayIndicator(this);
        Main.panel.addToStatusArea('kakaotalk-popup', this._indicator);
    }

    // Wine's tray is a window like any other: same pid as the app, drawn by
    // its explorer.exe, and the only one of those that is not the main
    // window.
    _findTrayWindow() {
        for (const window of global.display.list_all_windows()) {
            if (window.get_wm_class() !== 'explorer.exe')
                continue;
            if (!this._pids.has(window.get_pid()))
                continue;
            return window;
        }
        return null;
    }

    // The app's own window, if it is up. Not the popup, which is also
    // kakaotalk.exe and comes and goes on its own; and the main window is
    // preferred over a chat room, which is what is wanted when several are
    // open.
    _findMainWindow() {
        let fallback = null;
        for (const window of global.display.list_all_windows()) {
            if (window.get_wm_class() !== 'kakaotalk.exe')
                continue;
            if (!this._pids.has(window.get_pid()))
                continue;
            const title = window.get_title();
            if (title === POPUP_TITLE || title === '')
                continue;
            if (title === '카카오톡')
                return window;
            fallback ??= window;
        }
        return fallback;
    }

    pokeTray() {
        // Going through the tray is a detour for a window that is not there.
        // When it is, raise it and be done -- no pointer warping, no second
        // click.
        const main = this._findMainWindow();
        if (main) {
            main.activate(global.get_current_time());
            return;
        }

        const tray = this._findTrayWindow();
        if (!tray) {
            // No tray means the app is not running -- it is the one window
            // KakaoTalk keeps up the whole time. An indicator that sits there
            // doing nothing is worse than one that starts what it stands for,
            // and --start is a no-op if something is running after all.
            console.log(`${TAG} no tray window, starting KakaoTalk`);
            this._runHelper('--start');
            return;
        }

        if (!this._virtual) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._virtual = seat.create_virtual_device(
                Clutter.InputDeviceType.POINTER_DEVICE);
        }

        const rect = tray.get_frame_rect();
        const spot = {...DEFAULT_CONFIG.tray_click, ...(this._config.tray_click ?? {})};
        const target = [
            rect.x + spot.from_left,
            rect.y + rect.height - spot.from_bottom,
        ];

        // The click goes wherever the pointer is, to whatever is on top, so
        // the window has to be up front before the pointer arrives.
        tray.raise();
        tray.activate(global.get_current_time());
        if (this._config.log) {
            console.log(`${TAG} tray at ${rect.x},${rect.y} ${rect.width}x` +
                `${rect.height}, pointer to ${target[0]},${target[1]}`);
        }

        this._virtual.notify_absolute_motion(
            GLib.get_monotonic_time(), target[0], target[1]);

        // No synthetic click follows, because one does not work. Tried:
        // Clutter's virtual pointer device, which reports a real
        // MetaVirtualInputDeviceNative and whose button constants are sound,
        // firing press and release at the icon with the pointer measurably
        // on it and monotonic timestamps. The pointer moves, no exception is
        // raised, and Wine does not react. With the app's own window as the
        // test, a poke on its own never brought it back; the times it seemed
        // to were a real click landing on the icon the pointer had been
        // parked on.
        //
        // Which is what this does instead: put the pointer on the icon, and
        // leave the click to a hand. Two clicks rather than one, but the
        // hunting is gone -- the tray window does not appear in alt-tab, so
        // reaching it otherwise means a trip through the overview.
    }

    _loadConfig() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._configPath);
            if (!ok)
                throw new Error('unreadable');
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            this._config = {...DEFAULT_CONFIG, ...parsed};
            console.log(`${TAG} config loaded, ${this._config.rules.length} rules`);
        } catch (e) {
            // No config is a normal state: it means survey only.
            this._config = DEFAULT_CONFIG;
            console.log(`${TAG} config not usable (${e.message}), logging only`);
        }
    }

    _watchConfig() {
        const file = Gio.File.new_for_path(this._configPath);
        this._monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._loadConfig());
    }

    // Take the focus grab away before it happens, rather than undoing it.
    //
    // Mutter decides focus-on-map in window_state_on_map, from the window
    // type alone: NORMAL, DIALOG and MODAL_DIALOG take focus, everything
    // else -- NOTIFICATION among them -- does not. KakaoTalk's popup arrives
    // as NORMAL. Re-typing it as what it actually is settles the question
    // before it is asked.
    //
    // There is room to do it because a Wayland window cannot be shown until a
    // buffer is attached, and Wine sends get_toplevel, app_id and title in
    // one flush before that first buffer. So the title is known while the
    // window is still unshowable, and therefore still unfocusable.
    //
    // It also drops the popup out of alt-tab and the overview, which is what
    // one wants from a notification anyway.
    // Returns true once the window has been dealt with and needs no further
    // watching.
    _retype(window) {
        // The popup is deliberately left alone. Re-typing it to NOTIFICATION
        // does stop the focus grab -- mutter only gives focus on map to
        // NORMAL, DIALOG and MODAL_DIALOG -- but it also takes the placement
        // away from the app: mutter then puts the window at 0,32 instead of
        // where KakaoTalk asked, and the popup is two windows, a shadow and
        // an untitled one holding the message. Moving the shadow to the
        // corner leaves the message behind in the top left. A fix that
        // scatters the notification is worse than the focus it saves, so
        // focus is handed back afterwards instead. See _watchFocus.

        // The tray is a window Wine keeps up for as long as the app runs, and
        // UTILITY is what it is: not something to tab to, but not a
        // notification either. Mutter's recalc makes both skip the taskbar,
        // which is what takes it out of alt-tab and the overview.
        if (this._config.hide_tray && window.get_wm_class() === 'explorer.exe') {
            if (window.get_window_type() !== Meta.WindowType.UTILITY)
                window.set_type(Meta.WindowType.UTILITY);
            return true;
        }
        return false;
    }

    _onWindowCreated(window) {
        // The title is usually not set yet at creation, so watch for it. One
        // of these fires before the window can be shown.
        if (!this._retype(window)) {
            // Neither name is set yet at creation. Whichever arrives first
            // still beats the window becoming showable, since Wine sends both
            // before the buffer that would allow it.
            const ids = [];
            const check = () => {
                if (!this._retype(window))
                    return;
                for (const id of ids)
                    window.disconnect(id);
            };
            ids.push(window.connect('notify::title', check));
            ids.push(window.connect('notify::wm-class', check));
        }

        // Nothing is settled at creation -- no title, no final size -- so
        // wait for the first frame before looking or moving.
        const actor = window.get_compositor_private();
        if (!actor) {
            this._handle(window);
            return;
        }
        const id = actor.connect('first-frame', () => {
            actor.disconnect(id);
            this._handle(window);
        });
    }

    _handle(window) {
        const wmClass = window.get_wm_class();
        const pid = window.get_pid();
        if (OWNER_CLASSES.includes(wmClass) && pid > 0)
            this._pids.add(pid);

        if (owned_tray_check(wmClass))
            this._watchTray(window);

        const owned = this._pids.has(pid);
        if (this._config.log)
            console.log(`${TAG} ${this._describe(window)} owned=${owned}`);
        if (!owned)
            return;

        for (const rule of this._config.rules) {
            if (!this._matches(rule, window))
                continue;
            this._apply(rule, window);
            return;
        }
    }

    // Closing Wine's tray window strands the app. KakaoTalk hides rather than
    // minimises, so once the tray is gone nothing can ask it to show itself
    // again -- the indicator has nothing to poke, and the only way back is a
    // restart. Since the only way to find that out is to be stuck, do it for
    // them.
    //
    // The X that does this is drawn by Wine as an ordinary Win32 caption
    // button, so it cannot be taken away from out here; only its consequence
    // can be undone.
    _watchTray(window) {
        window.connect('unmanaged', () => {
            if (!this._config.recover_tray)
                return;
            const now = GLib.get_monotonic_time();
            if (this._lastRecover && now - this._lastRecover < RECOVER_COOLDOWN_US)
                return;
            this._lastRecover = now;
            console.log(`${TAG} tray window closed, recovering`);
            this._runHelper('--recover');
        });
    }

    // Full path rather than a name on PATH: the shell's PATH is whatever the
    // session started with, and ~/.local/bin is not reliably on it.
    // kakaotalk-bottle puts the symlink there.
    _runHelper(mode) {
        const helper = GLib.build_filenamev(
            [GLib.get_home_dir(), '.local', 'bin', 'kakaotalk-restart']);
        try {
            Gio.Subprocess.new([helper, mode], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.log(`${TAG} ${helper} ${mode} failed: ${e.message}`);
        }
    }

    _matches(rule, window) {
        const rect = window.get_frame_rect();
        if (rule.type && !rule.type.includes(window.get_window_type()))
            return false;
        if (rule.title !== undefined && window.get_title() !== rule.title)
            return false;
        if (rule.max_width && rect.width > rule.max_width)
            return false;
        if (rule.max_height && rect.height > rule.max_height)
            return false;
        return true;
    }

    _apply(rule, window) {
        // A notification that opens behind the window being worked in is not
        // a notification. make_above puts it in mutter's "always on top"
        // layer, which is a stacking change and nothing else -- unlike
        // set_type, which would also hand mutter the placement and scatter
        // the thing across the screen.
        if (rule.above)
            window.make_above();

        const work = window.get_work_area_current_monitor();
        const rect = window.get_frame_rect();
        let x, y;

        if (rule.action === 'none') {
            return;
        } else if (rule.action === 'pointer') {
            [x, y] = global.get_pointer();
        } else if (rule.action === 'bottom-right') {
            x = work.x + work.width - rect.width - MARGIN;
            y = work.y + work.height - rect.height - MARGIN;
        } else {
            console.log(`${TAG} unknown action ${rule.action}`);
            return;
        }

        // Keep it on the monitor whatever the rule asked for.
        x = Math.max(work.x, Math.min(x, work.x + work.width - rect.width));
        y = Math.max(work.y, Math.min(y, work.y + work.height - rect.height));

        window.move_frame(false, x, y);
        console.log(`${TAG} ${rule.action} -> ${x},${y}`);
    }

    _describe(window) {
        const rect = window.get_frame_rect();
        return [
            `wm_class=${window.get_wm_class()}`,
            `pid=${window.get_pid()}`,
            `title=${JSON.stringify(window.get_title())}`,
            `type=${window.get_window_type()}`,
            `rect=${rect.x},${rect.y} ${rect.width}x${rect.height}`,
            `skip_taskbar=${window.is_skip_taskbar()}`,
            `override=${window.is_override_redirect()}`,
        ].join(' ');
    }
}
