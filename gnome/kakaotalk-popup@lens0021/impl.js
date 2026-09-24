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
//       {"type": [0, 12], "title": "KakaoTalkShadowWnd", "action": "bottom-right"}
//     ]
//   }
//
// 12 is NOTIFICATION, and it is in that list because this re-types the
// popup's windows to it -- see _markNotification. A rule naming only NORMAL
// stops matching the moment that happens, and takes the placement with it.
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
// from taking it). "above": true also keeps the window on top, except over a
// fullscreen window -- see "respect_fullscreen" and _overFullscreen.
//
// A rule places one window, but a notification is several of them and only
// one carries a name worth matching. The rest are placed by the same rule,
// rather than left in the middle of the screen. See _joinGroup.

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
// The flatpak this extension stands for. Checked by looking for its
// directory rather than by running flatpak info: the menu asks on every
// open, and the answer is a file that is either there or not.
const APP_ID = 'io.github.chaotic_ground.KakaoTalk';
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
    // And off the screen, where the app can be asked directly instead. See
    // _retype.
    hide_tray_window: true,
    // Do not raise a popup over a fullscreen window, the way GNOME holds its
    // own banners back. See _overFullscreen.
    respect_fullscreen: true,
    // Follow the pointer warp with a synthetic click. Wine does not act on
    // it today; it is here for the day it does. See pokeTray.
    tray_virtual_click: true,
    // Re-type a notification's windows as NOTIFICATION so mutter never gives
    // them the focus to begin with. See _markNotification.
    popup_notification_type: true,
    // Hide the popup's furniture: the shadow, and the strip a notification
    // leaves behind. Neither carries the message. See _hideChrome.
    hide_popup_chrome: true,
};

// How long the virtual click holds the button down.
const CLICK_HOLD_MS = 40;

// How long after the last window of a notification another one still counts
// as part of it. Measured: a piece arrived 2.54s before the shadow it
// belongs to, which a three second window caught by half a second. Five,
// then, since being too slow strands a piece in the middle of the screen.
// Too generous costs a stray dialog dragged to the corner, which the height
// floor in _isPopupWindow keeps to small ones.
const GROUP_GAP_US = 5 * 1000 * 1000;

// The window KakaoTalk puts a new message in. It is redrawn as it slides, a
// fresh window per frame, so this name turns up a lot.
const POPUP_TITLE = 'KakaoTalkShadowWnd';

// Below this, a window claiming to be 카카오톡 is a leftover rather than the
// thing itself. See _findMainWindow.
const MAIN_MIN_HEIGHT = 240;

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
// So the button raises the tray window and warps the pointer onto its icon,
// and a hand does the clicking. A synthetic click is sent as well and Wine
// ignores it -- see pokeTray, which has the details and the reason it is
// still sent. The cursor visibly jumps and stays, which is the cost.
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
        super._init(0.5, 'KakaoTalk');
        this._owner = owner;
        this.add_child(new St.Icon({
            icon_name: 'kakaotalk',
            style_class: 'system-status-icon',
        }));

        // Rebuilt every time it opens, because what belongs in it depends on
        // whether the app is installed and that can change while the shell
        // is running -- not least by this menu.
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._rebuild();
        });
        this._rebuild();
    }

    // This extension is the landing point. It is the part that has to be
    // installed by hand -- a shell extension lives where no sandboxed app can
    // put it -- so once it is here it can offer the rest rather than leaving
    // someone to find a release page.
    _rebuild() {
        this.menu.removeAll();
        if (this._owner.appInstalled()) {
            // The same two actions the app icon's right-click offers, for the
            // same reason: KakaoTalk's own way out is its tray menu, and that
            // menu does not open under Wine's Wayland driver. The app icon is
            // in the grid or the dash; this is already in the panel, next to
            // the thing it acts on.
            this.menu.addAction('다시 시작', () => this._owner.restart());
            this.menu.addAction('종료', () => this._owner.quit());
        } else {
            this.menu.addAction('카카오톡 설치', () => this._owner.install());
        }
    }

    // Not a button-press-event handler, which is what this was before the
    // menu existed. PanelMenu.Button toggles its menu from vfunc_event,
    // which runs during the generic 'event' emission and therefore before
    // any button-press-event handler gets a say -- so a left click would
    // open the menu first and there would be no stopping it from out there.
    // Overriding the vfunc is where the decision can actually be made.
    vfunc_event(event) {
        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS &&
            type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        if (type === Clutter.EventType.BUTTON_PRESS &&
            event.get_button() === Clutter.BUTTON_SECONDARY) {
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }

        this.menu.close();
        this._owner.pokeTray();
        return Clutter.EVENT_STOP;
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
        this._burst = null;
        // Everything connected to a window or an actor rather than to the
        // display, so disable() can let go of it. A handler left behind
        // outlives the extension that made it: two enables of this file used
        // to leave two recoveries firing for one closed tray.
        this._tray = [];
        this._hidden = new Set();
        this._installed = undefined;
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
        this._burst = null;
        if (this._focusId) {
            global.display.disconnect(this._focusId);
            this._focusId = null;
        }
        this._lastFocused = null;
        for (const {obj, id, show} of this._tray ?? []) {
            try {
                obj.disconnect(id);
                // And put the tray window back on screen. Leaving it hidden
                // would leave the app unreachable by anything but this
                // extension, which is not a state to hand back to the
                // session.
                if (show)
                    obj.show();
            } catch (e) {
                // The window went before we did. Nothing to let go of.
            }
        }
        this._tray = null;
        this._hidden = null;
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
            // Furniture that was already up when this loaded. Without this
            // a reload leaves whatever is on screen exactly as it was, which
            // is a poor way to find out whether a change works.
            this._hideChrome(window);
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
    // message -- and worse than it first looked, because the popup carries a
    // reply box. Keystrokes that land there while the focus is away are not
    // lost, they are typed into a chat room. Handing the focus back closes
    // the gap but does not remove it, so this is a mitigation and not a fix;
    // the fix is not taking the focus at all.
    //
    // Restoring focus raises this again with the old window as the subject,
    // which is not a popup, so it records and stops there rather than
    // bouncing.
    _watchFocus() {
        this._focusId = global.display.connect('notify::focus-window', () => {
            const focused = global.display.focus_window;
            if (!focused)
                return;
            // Logged whoever it is, because which window takes the focus is
            // the question and the answer was assumed rather than looked at.
            // The rule below only ever recognised the shadow.
            if (this._config.log && this._pids?.has(focused.get_pid()))
                console.log(`${TAG} focus -> ${this._describe(focused)}`);
            if (!this._config.keep_focus)
                return;
            if (!this._isPopupWindow(focused)) {
                this._lastFocused = focused;
                return;
            }
            const previous = this._lastFocused;
            if (!previous || previous.get_compositor_private() === null)
                return;
            previous.activate(global.get_current_time());
        });
    }

    // Matching on POPUP_TITLE alone was not enough and the cost of that was
    // real. A notification takes the focus with two windows, not one: the
    // shadow, which carries the name, and an untitled one beside it which is
    // what the message and its reply box are drawn in. Both were logged
    // taking the focus, alternating, once per frame of the slide -- and only
    // the shadow was ever handed back, so the one that ends up holding the
    // focus is the one nobody was watching. That is the window keystrokes go
    // into, and they go into a chat room from there.
    //
    // So: owned, not the main window, and small. Height is the same
    // discriminator _findMainWindow uses, for the same reason -- every piece
    // of a notification measured here is 135 tall or less and the main window
    // 431 or more.
    _isPopupWindow(window) {
        if (window.get_wm_class() !== 'kakaotalk.exe')
            return false;
        if (!this._pids?.has(window.get_pid()))
            return false;
        return window.get_frame_rect().height < MAIN_MIN_HEIGHT;
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
    // The title is not enough on its own. A notification leaves a 107x29
    // window behind titled 카카오톡, exactly like the real one, and it sits
    // there taking no input -- so matching on the title alone found that and
    // the indicator spent its click activating a ghost, silently, in the one
    // situation where getting the main window back is the whole point.
    //
    // Height separates them and nothing else does: every piece of a
    // notification measured here is 135 tall or less, every main window 431
    // or more, while the widths overlap (315 against 293). MAIN_MIN_HEIGHT
    // sits between with room on both sides.
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
            if (window.get_frame_rect().height < MAIN_MIN_HEIGHT)
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
            // Logged, because this branch used to be the silent one and that
            // is how it hid: the indicator did nothing visible and there was
            // no line to say what it had decided.
            if (this._config.log)
                console.log(`${TAG} raising ${this._describe(main)}`);
            main.activate(global.get_current_time());
            return;
        }

        // The tray is not needed when the app can simply be asked. kakaoshow
        // posts KakaoTalk the message a tray click makes it post itself, so
        // the window comes back without a floating tray window, without the
        // pointer being warped across the screen, and without a second click
        // from a hand. See flatpak/kakaoshow.c.
        //
        // Only the flatpak carries it. A Bottles install falls through to
        // the tray below, which is what it has always done.
        if (this.appInstalled()) {
            if (this._config.log)
                console.log(`${TAG} asking the app to show itself`);
            this._askApp('show');
            return;
        }

        const tray = this._findTrayWindow();
        if (!tray) {
            // Nothing installed, so there is nothing to start. Offering the
            // install is the only useful thing a left click can do here.
            if (!this.appInstalled()) {
                this.install();
                return;
            }
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
        // the window has to be up front before the pointer arrives. Raised
        // and not activated: raising is what puts it under the pointer, and
        // activating would additionally give it the focus, which costs twice.
        //
        // It takes the focus away from whatever was being typed in, which is
        // the thing this extension spends most of its effort preventing
        // elsewhere. And mutter pings a window when it focuses it, to see
        // whether it is alive; Wine's tray window does not answer, so a
        // "“explorer.exe” is not responding" dialog appears over a window
        // that is working perfectly well.
        tray.raise();
        if (this._config.log) {
            console.log(`${TAG} tray at ${rect.x},${rect.y} ${rect.width}x` +
                `${rect.height}, pointer to ${target[0]},${target[1]}`);
        }

        this._virtual.notify_absolute_motion(
            GLib.get_monotonic_time(), target[0], target[1]);

        // The click, which does nothing today.
        //
        // What was tried and did not work: this same virtual pointer device
        // -- a real MetaVirtualInputDeviceNative, sound button constants --
        // firing press and release at the icon, with the pointer measurably
        // on it and monotonic timestamps. The pointer moves, no exception is
        // raised, and Wine does not react. It was tested against the app's
        // own window too, and a poke on its own never brought it back; the
        // times it appeared to were a real click landing on the icon the
        // pointer had been parked on, which is worth saying plainly because
        // that looked like success twice.
        //
        // It is here anyway. Wine's Wayland driver is young and this costs
        // nothing while it does nothing, so the day the click does land the
        // indicator becomes one click instead of two without anybody having
        // to remember this was ever missing. Set tray_virtual_click false to
        // drop it.
        //
        // The pointer stays on the icon either way. That is the part that
        // works: the hand that follows has something to click, and the tray
        // window is not in alt-tab, so reaching it otherwise means a trip
        // through the overview.
        if (this._config.tray_virtual_click)
            this._clickHere(target);
    }

    // Press and release separated in time, as a hand would. A press and
    // release sharing a timestamp is the kind of thing an input stack is
    // entitled to discard, and since the point of this is to be ready for a
    // Wine that starts listening, it should look like a click when it gets
    // there.
    _clickHere([x, y]) {
        const press = () => {
            if (!this._virtual)
                return;
            this._virtual.notify_button(GLib.get_monotonic_time(),
                Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        };
        const release = () => {
            if (!this._virtual)
                return GLib.SOURCE_REMOVE;
            this._virtual.notify_button(GLib.get_monotonic_time(),
                Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            if (this._config.log)
                console.log(`${TAG} virtual click at ${x},${y}`);
            return GLib.SOURCE_REMOVE;
        };
        press();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLICK_HOLD_MS, release);
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
            // And off the screen entirely, once there is another way in.
            // The tray exists to be clicked and nothing else; with --show
            // the indicator asks the app directly and the window is a small
            // square of leftover in the corner.
            //
            // Only where --show exists. A Bottles install still reaches the
            // app by having a hand click that window, so hiding it there
            // would take away the only way back.
            if (this._config.hide_tray_window && this.appInstalled())
                this._hideTrayWindow(window);
            return true;
        }

        // The shadow, by name, before it can be shown. This is the one piece
        // of a notification that announces itself early enough to be caught
        // here, and it is also the one recreated once per frame of the
        // slide, so this is most of the focus stealing prevented.
        if (window.get_title() === POPUP_TITLE) {
            this._markNotification(window);
            return true;
        }
        return false;
    }

    // Mutter gives focus on map to NORMAL, DIALOG and MODAL_DIALOG and to
    // nothing else, so this settles the question rather than answering it
    // afterwards. _watchFocus stays as the net underneath: the untitled
    // window holding the message and its reply box cannot be recognised
    // before it is mapped -- no title, no size yet -- so its first grab still
    // gets through and still has to be handed back.
    //
    // This is why the rules carry NOTIFICATION in their "type" list. A rule
    // matching only NORMAL stops matching the moment this runs, and the
    // placement goes with it.
    _markNotification(window) {
        if (!this._config.popup_notification_type)
            return;
        if (window.get_window_type() === Meta.WindowType.NOTIFICATION)
            return;
        window.set_type(Meta.WindowType.NOTIFICATION);
    }

    // Not UTILITY, which is what one reaches for first and does not do this:
    // it takes a window out of alt-tab and the overview and leaves it on the
    // screen exactly where it was. Taking it off the screen means hiding the
    // actor mutter draws it with.
    //
    // Two windows are worth hiding and the message is not one of them. The
    // shadow draws no shadow -- Wine renders it as a plain white rectangle,
    // which is the border sitting around the popup rather than under it --
    // and the 107x29 strip is a leftover that outlives the notification
    // without ever holding anything.
    //
    // The message window is the untitled one, so an empty title is the thing
    // to leave alone.
    _hideChrome(window) {
        if (!this._config.hide_popup_chrome)
            return false;
        const title = window.get_title();
        if (title !== POPUP_TITLE && title !== '카카오톡') {
            this._watchChrome(window);
            return false;
        }
        window.get_compositor_private()?.hide();
        return true;
    }

    // The title is not there yet when the window first paints, and the strip
    // is told apart from the message by nothing else -- both are owned, both
    // are small, and at that moment both are untitled. So the first look
    // said "message", placed it in the corner and left it on screen, and the
    // name arrived afterwards. It was out of the overview by then, which
    // made it look handled: that is NOTIFICATION setting skip_taskbar, not
    // anything here.
    _watchChrome(window) {
        if (window._kakaotalkChromeWatch)
            return;
        const id = window.connect('notify::title', () => {
            const title = window.get_title();
            if (title !== POPUP_TITLE && title !== '카카오톡')
                return;
            window.disconnect(id);
            window._kakaotalkChromeWatch = false;
            window.get_compositor_private()?.hide();
        });
        window._kakaotalkChromeWatch = true;
        window.connect('unmanaged', () => {
            if (window._kakaotalkChromeWatch)
                window.disconnect(id);
            window._kakaotalkChromeWatch = false;
        });
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

        if (owned_tray_check(wmClass)) {
            this._watchTray(window);
            // Again here, and not only from _retype: at creation the actor
            // does not exist yet, and there is nothing to hide until it
            // does. This runs on the first frame, so by now it does.
            if (this._config.hide_tray && this._config.hide_tray_window &&
                this.appInstalled())
                this._hideTrayWindow(window);
        }

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

        // No rule of its own, which does not mean it should be left alone.
        // See _joinGroup.
        this._joinGroup(window);
    }

    // One notification is not one window. It arrives as several -- measured
    // here, a 315-wide shadow that carries the message, a 107x29 strip and a
    // hairline 465x1 -- and only the shadow has a name to write a rule for.
    // Placing that one alone is what left the popup in pieces: the shadow
    // went to the corner and the rest stayed in the middle of the screen
    // where Wine put them.
    //
    // So the offset the shadow was moved by is remembered and everything
    // else that turns up alongside it moves by the same amount, which keeps
    // the pieces in the arrangement the app drew them in.
    //
    // The pieces arrive before the shadow does, so they wait: until the
    // shadow has been placed there is no offset to move them by, and moving
    // them on a guess would only scatter them differently.
    //
    // Approximate, deliberately. The shadow is recreated once per animation
    // frame at a different height and Wine's own origin for it does not hold
    // still either, so the offset taken from the first frame is up to about
    // fifty pixels off by the last. Fifty pixels of error against eleven
    // hundred is the trade, and the alternative -- recomputing per frame --
    // would drag the static pieces around for the length of the slide.
    _group() {
        const now = GLib.get_monotonic_time();
        if (!this._burst || now > this._burst.until)
            this._burst = {rule: null, waiting: [], members: []};
        this._burst.until = now + GROUP_GAP_US;
        return this._burst;
    }

    _joinGroup(window) {
        const group = this._group();
        // The pieces arrive before the shadow does, and until a rule has
        // matched there is no action to place them by, so they wait.
        if (!group.rule) {
            group.waiting.push(window);
            return;
        }
        this._placeMember(window, group);
    }

    // Each piece is placed on its own, rather than the group being carried
    // by one offset. That was the design until mutter took the placement
    // away: re-typing the popup to NOTIFICATION -- which is what stops it
    // stealing the focus, and is worth more than tidy placement -- means
    // mutter puts the window where it likes, and it likes 0,32. Measured, in
    // the log, with the shadow sitting at 0,32 while its pieces were still
    // out at 1048,736. An offset taken from that anchor is an offset from
    // nowhere, and every piece then failed the neighbourhood test and was
    // stranded mid-screen.
    //
    // So relative arrangement is not something this can preserve any more,
    // and placing each piece against the same corner is the nearest thing
    // that survives. It lands close to right anyway: the shadow is 315x135
    // and the message window 310x129, so bottom-aligning both puts the
    // message inside its own shadow, which is where it was drawn to be.
    //
    // Membership is the burst and nothing else now -- the position test it
    // used to have cannot work when positions are mutter's to decide. Being
    // owned, small and within GROUP_GAP_US of the popup is what is left, and
    // the height floor is what keeps the main window out of it.
    _placeMember(window, group) {
        if (!window.get_compositor_private())
            return;
        if (!this._isPopupWindow(window)) {
            if (this._config.log)
                console.log(`${TAG} not part of the popup: ${this._describe(window)}`);
            return;
        }
        this._markNotification(window);
        if (this._hideChrome(window))
            return;
        const target = this._targetFor(window, group.rule?.action ?? 'none');
        if (target)
            window.move_frame(false, target[0], target[1]);
        if (!group.members.includes(window))
            group.members.push(window);
    }

    // The shadow is a backdrop and the message is drawn in a window beside
    // it, so the message has to end up on top. It used to get there by
    // taking the focus, which raised it; re-typing the popup to NOTIFICATION
    // took that away and left the shadow -- recreated and re-raised once per
    // frame of the slide -- sitting over the message. Hence raising the rest
    // of the group after the shadow, every time the shadow comes back.
    _raiseGroupMembers(group) {
        group.members = group.members.filter(w => w.get_compositor_private());
        for (const member of group.members) {
            member.make_above();
            member.raise();
        }
    }

    // Taking the tray window off the screen, which is not the same as taking
    // it out of the window list -- UTILITY above does that, and leaves a
    // small square drawn in the corner. There is no wayland-side way to ask
    // Wine not to map it, so the actor is what gets hidden.
    //
    // And hidden again afterwards: mutter shows the actor when it maps the
    // window, and again on every workspace and overview transition, so a
    // single hide() at create time is undone within the second. Cheap to
    // repeat -- the window is one per run and never legitimately shown.
    _hideTrayWindow(window) {
        const actor = window.get_compositor_private();
        // The set belongs to this enable and not to the actor, which outlives
        // it. A flag stored on the actor survives a disable, and then the
        // next enable finds it already set and does nothing -- the window
        // stays as the previous version of this file left it, which is a
        // poor way to find out whether a change works.
        if (!actor || this._hidden.has(actor))
            return;
        this._hidden.add(actor);
        const id = actor.connect('notify::visible', () => {
            if (actor.visible)
                actor.hide();
        });
        this._tray.push({obj: actor, id, show: true});
        actor.hide();
        console.log(`${TAG} tray window hidden`);
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
        const id = window.connect('unmanaged', () => {
            if (!this._config.recover_tray)
                return;
            const now = GLib.get_monotonic_time();
            if (this._lastRecover && now - this._lastRecover < RECOVER_COOLDOWN_US)
                return;
            this._lastRecover = now;
            console.log(`${TAG} tray window closed, recovering`);
            this._runHelper('--recover');
        });
        this._tray.push({obj: window, id});
    }

    // Whether the flatpak is installed, as a fact the menu can be built
    // from. Cached: this is asked on every menu open and a subprocess for
    // each would be silly, and the one thing that changes it from under us
    // is install() below, which clears it.
    appInstalled() {
        if (this._installed === undefined) {
            const file = Gio.File.new_for_path(
                GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share',
                                      'flatpak', 'app', APP_ID]));
            const system = Gio.File.new_for_path(
                GLib.build_filenamev(['/var', 'lib', 'flatpak', 'app', APP_ID]));
            this._installed = file.query_exists(null) || system.query_exists(null);
        }
        return this._installed;
    }

    // Seventy megabytes over a network, so it says when it starts and says
    // again when it is done. A menu item that appears to do nothing for two
    // minutes is a menu item people press twice.
    install() {
        Main.notify('카카오톡', '설치를 시작합니다');
        const helper = GLib.build_filenamev(
            [GLib.get_home_dir(), '.local', 'bin', 'kakaotalk-install']);
        let proc;
        try {
            proc = Gio.Subprocess.new([helper], Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            Main.notify('카카오톡', `설치를 시작하지 못했습니다: ${e.message}`);
            return;
        }
        proc.communicate_utf8_async(null, null, (subprocess, result) => {
            let ok = false, err = '';
            try {
                [ok, , err] = subprocess.communicate_utf8_finish(result);
                ok = subprocess.get_successful();
            } catch (e) {
                err = e.message;
            }
            this._installed = undefined;
            if (ok)
                Main.notify('카카오톡', '설치했습니다');
            else
                Main.notify('카카오톡', `설치에 실패했습니다: ${(err || '').trim().split('\n').pop()}`);
        });
    }

    // Behind the indicator's right-click menu. Both go through the same
    // helper the app icon's actions use, so there is one definition of what
    // restarting means and not two that drift.
    restart() {
        this._suppressRecovery();
        this._runHelper();
    }

    quit() {
        this._suppressRecovery();
        this._runHelper('--quit');
    }

    // Stopping the app destroys the tray window, and a destroyed tray window
    // is exactly what _watchTray exists to undo. Asked for it, though, so
    // there is nothing to undo -- claim the cooldown before the window goes,
    // and the recovery that would otherwise chase it stands down.
    _suppressRecovery() {
        this._lastRecover = GLib.get_monotonic_time();
    }

    // A word into the file the flatpak's launcher watches, and the instance
    // already running the client does the rest.
    //
    // Not `flatpak run <app> --show`, which is the obvious thing and which
    // kills the app: a second instance gets its own PID namespace, and a
    // wine process that looks at another process across that boundary takes
    // the whole session down with it -- the client and its explorer are gone
    // within five seconds and the login has to be typed again. See
    // serve_control in flatpak/kakaotalk.
    //
    // A plain file, so this never blocks. A fifo would be tidier and would
    // stop the whole shell the first time nothing was listening.
    _askApp(word) {
        const path = GLib.build_filenamev(
            [GLib.get_home_dir(), '.var', 'app', APP_ID, 'data', 'control']);
        try {
            GLib.file_set_contents(path, `${word}\n`);
        } catch (e) {
            console.log(`${TAG} could not ask for ${word}: ${e.message}`);
        }
    }

    // Full path rather than a name on PATH: the shell's PATH is whatever the
    // session started with, and ~/.local/bin is not reliably on it.
    // kakaotalk-bottle puts the symlink there.
    //
    // Variadic because a plain restart is the helper with no argument at
    // all, and [helper, undefined] is not that.
    _runHelper(...args) {
        const helper = GLib.build_filenamev(
            [GLib.get_home_dir(), '.local', 'bin', 'kakaotalk-restart']);
        try {
            Gio.Subprocess.new([helper, ...args], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.log(`${TAG} ${helper} ${args.join(' ')} failed: ${e.message}`);
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
        // layer, and raise moves it up within that layer -- which the focus
        // used to do, before the popup was re-typed so as not to take any.
        //
        // Except over a fullscreen window, where GNOME's own banners stay
        // down and this one has no business being the exception. Nothing
        // here can stop KakaoTalk drawing the popup -- that is the app's
        // decision and it is not asking -- but declining to raise it leaves
        // the fullscreen window on top, which is the same thing to look at.
        if (rule.above && !this._overFullscreen(window)) {
            window.make_above();
            window.raise();
        }

        if (this._hideChrome(window)) {
            // Hidden, but the group still needs the rule: the message window
            // is placed by it and arrives before this one does.
            const hidden = this._group();
            hidden.rule = rule;
            for (const waiting of hidden.waiting)
                this._placeMember(waiting, hidden);
            hidden.waiting = [];
            this._raiseGroupMembers(hidden);
            return;
        }

        const target = this._targetFor(window, rule.action);
        if (!target)
            return;

        const group = this._group();
        group.rule = rule;
        for (const waiting of group.waiting)
            this._placeMember(waiting, group);
        group.waiting = [];

        window.move_frame(false, target[0], target[1]);
        console.log(`${TAG} ${rule.action} -> ${target[0]},${target[1]}`);
        this._raiseGroupMembers(group);
    }

    // Where a window should end up, clamped to the monitor whatever the rule
    // asked for. Null means the rule says to leave it alone, or says nothing
    // this understands.
    _targetFor(window, action) {
        const work = window.get_work_area_current_monitor();
        const rect = window.get_frame_rect();
        let x, y;

        if (action === 'none') {
            return null;
        } else if (action === 'pointer') {
            [x, y] = global.get_pointer();
        } else if (action === 'bottom-right') {
            x = work.x + work.width - rect.width - MARGIN;
            y = work.y + work.height - rect.height - MARGIN;
        } else {
            console.log(`${TAG} unknown action ${action}`);
            return null;
        }

        return [
            Math.max(work.x, Math.min(x, work.x + work.width - rect.width)),
            Math.max(work.y, Math.min(y, work.y + work.height - rect.height)),
        ];
    }

    _overFullscreen(window) {
        if (!this._config.respect_fullscreen)
            return false;
        const index = window.get_monitor();
        return index >= 0 && global.display.get_monitor_in_fullscreen(index);
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
