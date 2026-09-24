// Wine의 Wayland 드라이버가 부족한 부분을 컴포지터 쪽에서 메운다.
//
// Wayland는 클라이언트가 자기 창 위치를 정하게 두지 않는다. 카카오톡의
// 팝업은 오른쪽 아래를 요청하지만 화면 가운데에 도착하고, Wine 안에서
// 무엇을 해도 그건 바뀌지 않는다. 컴포지터는 할 수 있으니 여기서 놓는다.
//
// 하는 일은 넷이다.
//
//   새 메시지 팝업을 제자리에 놓고, 포커스를 뺏지 못하게 한다. 팝업에
//   답장 입력칸이 있어서, 포커스가 넘어간 동안 친 글자는 사라지는 게
//   아니라 대화방에 입력된다.
//
//   Wayland에 프로토콜이 없어서 Wine이 떠 있는 창으로 그리는 트레이를
//   대신한다. 패널 인디케이터를 좌클릭하면 창이 돌아오고, 우클릭하면
//   카카오톡 자신의 메뉴가 열린다.
//
//   앱이 자기 창 위에 그리는 것들을 그 위로 돌려놓는다. 대화를 스크롤할
//   때 뜨는 날짜 같은 것.
//
//   아무것도 설치되어 있지 않으면 설치를 권한다. 확장은 샌드박스 안의 앱이
//   자기를 놓을 수 없는 자리에 살기 때문에, 랜딩 포인트가 된다.
//
// 규칙은 여기가 아니라 JSON 파일에 있고, 바뀌면 다시 읽는다. 단정함
// 때문이 아니다. Wayland 세션에는 셸이 확장의 코드를 다시 읽게 할 방법이
// 없어서, 이 파일을 고치면 로그아웃이 필요하고 설정을 고치면 공짜다.
//
//   ~/.config/kakaotalk-popup.json
//   {
//     "log": false,
//     "rules": [
//       {"type": [0, 12], "title": "KakaoTalkShadowWnd", "action": "bottom-right"}
//     ]
//   }
//
// 12가 NOTIFICATION이고 그 목록에 들어있는 이유는, 이 확장이 팝업의 창을
// 그 타입으로 바꾸기 때문이다. _markNotification을 보라. NORMAL만 적은
// 규칙은 그 순간부터 매칭을 멈추고 위치 조정도 같이 멈춘다.
//
// 규칙을 쓰기 전에 창이 어떻게 생겼는지 보려면 "log"를 켜라.
// KakaoTalkShadowWnd라는 이름도 그렇게 알아냈다. 로그를 켜둔 채 메시지가
// 왔고 팝업이 자기 이름을 밝혔다. 폭 315에 미끄러지면서 높이가 늘었다
// 줄었다 했다. 크기만 보고 판단하지 마라. Firefox의 메뉴가 카카오톡 것과
// 같은 폭으로, 클래스도 제목도 없이 온다. 소유를 pid로 가리는 이유다.
//
// 규칙은 카카오톡 프로세스가 가진 창에 대해, 적어둔 모든 항목이 맞을 때
// 매칭된다. "type"은 Meta.WindowType, "title"은 정확히 일치,
// "max_width"/"max_height"는 프레임의 상한이다. 동작은 "pointer"(왼쪽 위
// 모서리를 커서에), "bottom-right"(작업 영역의 모서리에), "none"(매칭하고
// 그대로 둔다. 아래의 더 넓은 규칙이 가져가지 못하게). "above": true면
// 창을 위에 유지하는데, 전체화면 창 위에서는 아니다.
// "respect_fullscreen"과 _overFullscreen을 보라.
//
// 규칙 하나는 창 하나를 놓지만 알림은 여러 창이고 그중 하나만 매칭할 만한
// 이름을 갖고 있다. 나머지는 화면 가운데 남기지 않고 같은 규칙으로
// 놓는다. _joinGroup을 보라.
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
// extension.js가 읽어온다. 로그아웃 없이 고칠 수 있도록 enable()마다 이
// 파일을 다시 import한다. Extension의 하위 클래스가 아니라 그냥 클래스인
// 이유는, 셸이 보는 것은 언제나 로더뿐이기 때문이다.

const TAG = '[kakaotalk-popup]';
// 이 확장이 대신하는 flatpak. flatpak info를 돌리는 대신 디렉터리가 있는지
// 본다. 메뉴가 열릴 때마다 묻는 질문이고, 답은 있거나 없는 파일 하나다.
const APP_ID = 'io.github.chaotic_ground.KakaoTalk';
const MARGIN = 16;
// Wine이 자기 창에 붙이는 클래스. 다만 메뉴는 클래스 없이 오므로, 소유는
// 이 창들이 나온 pid로 추적한다.
const OWNER_CLASSES = ['kakaotalk.exe', 'explorer.exe'];

const DEFAULT_CONFIG = {
    log: true,
    rules: [],
    tray_indicator: true,
    // 트레이 창 안에서 아이콘이 있는 자리. 클릭이 창 안 아무 데가 아니라
    // 아이콘에 떨어져야 한다. 왼쪽 끝과 아래쪽 끝에서 잰다. Wine이 그리는
    // 제목 표시줄 때문에 위에서 재는 것은 좋지 않다. 코드를 건드리지 않고
    // 조절할 수 있게 뒀다. 틀려도 조용해서, 클릭이 그냥 아무 일도 안
    // 한다.
    tray_click: {from_left: 20, from_bottom: 15},
    // 트레이 창이 닫히면 카카오톡을 다시 시작한다. _watchTray를 보라.
    recover_tray: true,
    // 새 메시지 팝업이 애초에 포커스를 가져가지 못하게 한다.
    // _disarmPopup을 보라. keep_focus는 제목을 알기 전에 빠져나간 것들을
    // 위한 대비책이다.
    keep_focus: true,
    // 트레이 창을 alt-tab과 오버뷰에서 뺀다. 이제 가는 길은 인디케이터라,
    // 창 목록의 그 자리는 잡동사니일 뿐이다.
    hide_tray: true,
    // 그리고 화면 밖으로. 앱에 직접 물어볼 수 있으니. _retype을 보라.
    hide_tray_window: true,
    // 전체화면 창 위로 팝업을 올리지 않는다. GNOME이 자기 배너를 참는 것과
    // 같다. _overFullscreen을 보라.
    respect_fullscreen: true,
    // 포인터를 옮긴 뒤 합성 클릭을 보낸다. 지금 Wine은 반응하지 않는다.
    // 언젠가 반응할 날을 위해 있다. pokeTray를 보라.
    tray_virtual_click: true,
    // 알림의 창들을 NOTIFICATION으로 바꿔서 mutter가 애초에 포커스를 주지
    // 않게 한다. _markNotification을 보라.
    popup_notification_type: true,
    // 팝업의 장식을 숨긴다. 그림자와, 알림이 남기는 띠. 둘 다 메시지를
    // 담고 있지 않다. _hideChrome을 보라.
    hide_popup_chrome: true,
    // 앱이 자기 창 위에 그리는 것을 그 위로 돌려놓는다. 대화를 스크롤할 때
    // 뜨는 날짜 같은 것. _placeOverlay를 보라.
    place_overlays: true,
};

// 합성 클릭이 버튼을 누르고 있는 시간.
const CLICK_HOLD_MS = 40;

// 알림의 마지막 창 뒤로 얼마 동안 다른 창을 같은 알림의 일부로 볼지.
// 재봤다. 한 조각이 자기 그림자보다 2.54초 먼저 왔고, 3초 창으로는 0.5초
// 차이로 잡혔다. 그래서 5초다. 너무 짧으면 조각 하나가 화면 가운데
// 남는다. 너무 넉넉하면 엉뚱한 대화상자가 구석으로 끌려가는데,
// _isPopupWindow의 높이 하한이 그걸 작은 것들로 제한한다.
const GROUP_GAP_US = 5 * 1000 * 1000;

// 카카오톡이 새 메시지를 담는 창. 미끄러지는 동안 프레임마다 새 창으로
// 다시 그려져서 이 이름이 자주 나온다.
const POPUP_TITLE = 'KakaoTalkShadowWnd';

// 이보다 작으면서 자기를 카카오톡이라고 하는 창은 진짜가 아니라 남은
// 것이다. _findMainWindow를 보라.
const MAIN_MIN_HEIGHT = 240;

// 제목 없는 소유 창이 "앱이 자기 창 위에 그리는 것"으로 인정받으려면 들어야
// 하는 크기 범위. 대화를 스크롤할 때 뜨는 날짜 같은 것이다. 재봤다. 그
// 날짜는 82x33이고, 알림의 그림자는 폭 318, 메시지도 그보다 별로 작지
// 않다.
//
// 하한은 장식이 아니다. 없을 때 16x16짜리 창을 집어다가 대화창 위로 옮기고
// 영구히 맨 앞에 올렸다. 그런 창이 여럿 있는데 무엇을 위한 것인지 여기서는
// 모른다. 무엇이든 간에 위치를 정해줄 대상은 아니다. _placeOverlay를
// 보라.
const OVERLAY_MAX_WIDTH = 200;
const OVERLAY_MIN_WIDTH = 40;
const OVERLAY_MIN_HEIGHT = 20;

// 올라갈 창 안에서의 자리. 가운데, 그리고 방 머리글을 지날 만큼 아래로.
// 이 크기들에서는 높이의 12분의 1쯤이 그 자리다. 진짜 답은 앱이 알고
// 컴포지터는 물어볼 수 없다. 맞다기보다 가까운 값이다.
const OVERLAY_TOP_FRACTION = 0.12;

// 앱의 메뉴를 요청한 뒤 얼마 동안 새 창을 그 메뉴로 볼지. 메뉴는 1초쯤
// 뒤에 오고 나머지는 여유다. 짧게 잡는 이유는 그동안 메시지 팝업이 메뉴로
// 오인되어 포인터 자리로 끌려가기 때문이다. 실제로 알림이 패널 인디케이터
// 아래 떨어졌다. 기대는 그걸 가져가는 첫 번째 창에서 소진되고, 알림이
// 조립되는 중에는 적용되지 않는다. 그래서 이것은 유일한 방어선이 아니라
// 마지막 방어선이다.
const MENU_GRACE_US = 3 * 1000 * 1000;

// 재시작은 가는 길에 트레이 창을 없애는데, 그건 복구 대상과 똑같아 보인다.
// 재시작을 덮을 만큼 길고, 1분 뒤의 두 번째 사고는 여전히 잡을 만큼
// 짧게.
const RECOVER_COOLDOWN_US = 90 * 1000 * 1000;


// Wine이 떠 있는 창으로 그리는 트레이를 대신하는 패널 버튼.
//
// Wayland에는 시스템 트레이 프로토콜이 없어서 Wine은 트레이를 평범한 창으로
// 그린다. 좌클릭하면 카카오톡 창이 돌아오니 동작은 한다. 다만 alt-tab에
// 안 나와서 거기 가려면 오버뷰를 거쳐야 하는데, 클릭 한 번 치고는 격식이
// 과하다.
//
// 버튼이 창을 직접 복원할 수는 없다. 카카오톡은 최소화가 아니라 숨기기를
// 한다. 트레이로 들어가면 컴포지터가 보기에 그 창은 존재하기를 멈추므로
// 활성화할 대상이 없다. 되돌릴 수 있는 것은 앱뿐이고, 앱이 듣는 것은 그
// 트레이 창에 온 클릭뿐이다.
//
// 그래서 버튼은 트레이 창을 올리고 포인터를 그 아이콘 위로 옮기고, 클릭은
// 손이 한다. 합성 클릭도 같이 보내는데 Wine은 무시한다. 자세한 것과 그래도
// 보내는 이유는 pokeTray에 있다. 커서가 눈에 띄게 튀어서 그 자리에 남는
// 것이 그 값이다.
//
// GTypeName을 읽을 때마다 다르게 만드는 것은 일부러다. GObject는 타입
// 이름을 전역으로 등록하고 계속 들고 있어서, 이 파일을 다시 import하면
// 로더의 존재 이유가 바로 그것인데, "already registered"로 실패하면서
// 확장을 같이 데리고 내려간다.
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

        // 열릴 때마다 다시 만든다. 무엇이 들어갈지가 앱의 설치 여부에
        // 달렸고, 그건 셸이 도는 중에 바뀔 수 있다. 다른 무엇보다 이 메뉴
        // 때문에.
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._rebuild();
        });
        this._rebuild();
    }

    // 이 확장이 랜딩 포인트다. 샌드박스 안의 어떤 앱도 놓을 수 없는 자리에
    // 살기 때문에 손으로 깔아야 하는 쪽이고, 일단 여기 있으면 나머지를
    // 권할 수 있다. 사람을 릴리스 페이지 찾으러 보내지 않아도 된다.
    //
    // 지금은 그것뿐이다. 예전에 여기 카카오톡 트레이 메뉴를 흉내 낸 것이
    // 있었는데, 이제 우클릭은 앱에 진짜를 요청한다. vfunc_event를 보라.
    // 진짜는 앱이 실제로 갖고 있는 것이고 말한 대로 동작한다. 다시 시작과
    // 종료는 앱 아이콘의 우클릭으로 옮겼다. desktop 파일이 거기 둔다.
    _rebuild() {
        this.menu.removeAll();
        if (!this._owner.appInstalled())
            this.menu.addAction('카카오톡 설치', () => this._owner.install());
    }

    // 메뉴가 생기기 전에는 button-press-event 핸들러였다. PanelMenu.Button은
    // vfunc_event에서 자기 메뉴를 토글하는데, 그건 일반 'event' 발신 중에
    // 돌아서 어떤 button-press-event 핸들러보다 먼저다. 그래서 좌클릭이
    // 메뉴를 먼저 열어버리고 바깥에서는 막을 수가 없었다. 결정을 실제로
    // 내릴 수 있는 자리가 vfunc를 덮어쓰는 여기다.
    vfunc_event(event) {
        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS &&
            type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        if (type === Clutter.EventType.BUTTON_PRESS &&
            event.get_button() === Clutter.BUTTON_SECONDARY) {
            // 우리 것이 아니라 앱 자신의 메뉴다. 카카오톡이 띄우고, 앱이
            // 오늘 갖고 있는 그대로를 담는다. 복사본이었다면 시간이 지나며
            // 어긋났을 것이다.
            //
            // 아무것도 설치되어 있지 않으면 물어볼 앱이 없고, 그때 쓸모
            // 있는 것은 설치 권유뿐이다. 이 메뉴에 남은 것이 그것이다.
            if (this._owner.appInstalled()) {
                this.menu.close();
                this._owner.askMenu();
            } else {
                this.menu.toggle();
            }
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
        // display가 아니라 창이나 액터에 건 것들을 모아둔다. disable()이
        // 놓아줄 수 있도록. 남겨둔 핸들러는 그걸 만든 확장보다 오래 산다.
        // 이 파일을 두 번 켜면 트레이 하나가 닫힐 때 복구가 두 번 돌곤
        // 했다.
        this._tray = [];
        this._hidden = new Set();
        this._menuUntil = 0;
        this._menuAt = null;
        this._menuPlaced = false;
        this._syncId = 0;
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
        for (const {obj, id, show, dead} of this._tray ?? []) {
            if (dead)
                continue;
            try {
                obj.disconnect(id);
                // 그리고 트레이 창을 화면에 돌려놓는다. 숨긴 채로 두면 이
                // 확장 말고는 앱에 닿을 방법이 없게 되는데, 세션에
                // 넘겨주기에 좋은 상태가 아니다.
                if (show)
                    obj.show();
            } catch (e) {
                // 창이 우리보다 먼저 갔다. 놓아줄 것이 없다.
            }
        }
        this._tray = null;
        this._hidden = null;
        if (this._syncId) {
            GLib.source_remove(this._syncId);
            this._syncId = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._virtual = null;
    }

    // 앞으로 생길 것이 아니라 지금 있는 것. window-created 훅이 답할 수
    // 없는 질문에 답한다. 앱이 자기를 치운 뒤에도 그 창이 아직 있는가.
    _dumpWindows() {
        for (const window of global.display.list_all_windows()) {
            const wmClass = window.get_wm_class();
            if (wmClass !== 'kakaotalk.exe' && wmClass !== 'explorer.exe')
                continue;
            // 이미 열려 있는 것에서 pid를 배운다. 없으면 어떤 창이 새로
            // 생길 때까지 집합이 비어 있고, 그동안 트레이를 찾을 수 없다.
            const pid = window.get_pid();
            if (pid > 0)
                this._pids.add(pid);
            // 이 코드가 읽힐 때 이미 떠 있던 장식들. 없으면 다시 읽어도
            // 화면에 있는 것은 그대로인데, 바꾼 것이 먹히는지 알아보는
            // 방법으로는 나쁘다.
            this._hideChrome(window);
            // 이미 떠 있던 창은 _handle을 거치지 않았으므로, 사라질 때
            // 인디케이터에게 말해줄 방법이 없었다.
            window.connect('unmanaged', () => this._syncIndicatorSoon());
            if (owned_tray_check(wmClass)) {
                this._watchTray(window);
                // 이 코드가 읽힐 때 이미 떠 있던 창은 _onWindowCreated를
                // 거치지 않았으므로, 타입 변경도 여기서 해준다.
                this._retype(window);
            }
            if (this._config.log)
                console.log(`${TAG} present: ${this._describe(window)}`);
        }
    }


    // 새 메시지가 오면 팝업이 키보드를 같이 가져간다. 다른 데서 타자를
    // 치던 중이라면 메시지를 놓치는 것보다 나쁘고, 처음 보이는 것보다 더
    // 나쁘다. 팝업에 답장 입력칸이 있기 때문이다. 포커스가 넘어간 동안
    // 거기 떨어진 키는 사라지는 게 아니라 대화방에 입력된다. 포커스를
    // 돌려주면 그 틈이 좁아지지만 없어지지는 않는다. 이것은 완화책이지
    // 해결이 아니다. 해결은 애초에 포커스를 가져가지 않는 것이다.
    //
    // 포커스를 돌려주면 이 핸들러가 다시 불리는데, 이번 대상은 팝업이 아닌
    // 옛 창이다. 그래서 기록하고 멈출 뿐 되튀지 않는다.
    _watchFocus() {
        this._focusId = global.display.connect('notify::focus-window', () => {
            const focused = global.display.focus_window;
            if (!focused)
                return;
            // 누구든 기록한다. 어느 창이 포커스를 가져가는가가 질문이었고,
            // 답은 보지 않고 짐작한 것이었다. 아래 규칙은 그림자만
            // 알아봤다.
            if (this._config.log && this._pids?.has(focused.get_pid()))
                console.log(`${TAG} focus -> ${this._describe(focused)}`);
            if (!this._config.keep_focus)
                return;
            if (!this._isPopupWindow(focused)) {
                this._lastFocused = focused;
                return;
            }
            // 방금 우리가 요청한 메뉴다. 포커스를 가져야 맞다. 그게 메뉴를
            // 열어두는 것이다. 그대로 둔다.
            if (this._expectingMenu())
                return;
            const previous = this._lastFocused;
            if (!previous || previous.get_compositor_private() === null)
                return;
            previous.activate(global.get_current_time());
        });
    }

    // POPUP_TITLE만으로 매칭하는 것은 부족했고 그 대가가 실제로 있었다.
    // 알림은 하나가 아니라 두 창으로 포커스를 가져간다. 이름을 들고 있는
    // 그림자와, 그 옆의 제목 없는 창. 메시지와 답장 입력칸이 그려지는 쪽이
    // 후자다. 로그에는 둘 다 포커스를 가져가는 것으로 찍혔고, 미끄러지는
    // 프레임마다 번갈아 나왔다. 그런데 돌려준 것은 그림자뿐이었으니, 결국
    // 포커스를 들고 있는 쪽은 아무도 안 보던 창이다. 키가 들어가는 창이
    // 그것이고, 거기서 대화방으로 간다.
    //
    // 그래서 조건은 이렇다. 소유한 창이고, 메인 창이 아니고, 작다.
    // _findMainWindow가 쓰는 것과 같은 높이 기준이고 이유도 같다. 여기서
    // 잰 알림 조각은 전부 높이 135 이하이고 메인 창은 431 이상이었다.
    _isPopupWindow(window) {
        if (window.get_wm_class() !== 'kakaotalk.exe')
            return false;
        if (!this._pids?.has(window.get_pid()))
            return false;
        return window.get_frame_rect().height < MAIN_MIN_HEIGHT;
    }

    // 알림의 조각이 아니라 앱이 자기 창 위에 그리는 것. 폭으로 가른다.
    // 둘을 깨끗이 나누는 유일한 기준이다. 양쪽 다 앱이 소유하고 있고 둘 다
    // 제목이 없어서 기댈 것이 없다.
    _isOverlay(window) {
        if (!this._config.place_overlays)
            return false;
        if (window.get_title() !== '')
            return false;
        const rect = window.get_frame_rect();
        return rect.width >= OVERLAY_MIN_WIDTH && rect.width < OVERLAY_MAX_WIDTH &&
               rect.height >= OVERLAY_MIN_HEIGHT && rect.height < MAIN_MIN_HEIGHT;
    }

    // 속한 창 위로 옮긴다. 컴포지터가 알아서 해주지 않는다. Wayland
    // 클라이언트는 자기 toplevel 위치를 정할 수 없고 이것이 toplevel이다.
    // 컴포지터가 놓고 싶은 자리에 도착하는데, 스크롤할 때 뜨는 날짜의
    // 경우 그것이 설명하는 대화창에서 수백 픽셀 떨어진 곳이었다.
    //
    // 속한 창은 이것이 포커스를 가져가기 직전까지 포커스를 갖고 있던
    // 창이다. 대화를 스크롤하는 중이라면 그 대화창이다. 아무것도 포커스를
    // 갖고 있지 않았던 경우는 메인 창으로 넘어간다.
    _placeOverlay(window) {
        const over = this._overlayParent();
        if (!over)
            return;

        const parent = over.get_frame_rect();
        const rect = window.get_frame_rect();
        const work = window.get_work_area_current_monitor();
        const x = parent.x + Math.round((parent.width - rect.width) / 2);
        const y = parent.y + Math.round(parent.height * OVERLAY_TOP_FRACTION);

        window.move_frame(false,
            Math.max(work.x, Math.min(x, work.x + work.width - rect.width)),
            Math.max(work.y, Math.min(y, work.y + work.height - rect.height)));

        // 그리고 위에 유지한다. 창 위로 옮긴 것이 이걸 필요하게 만들었다.
        // 옆에 떨어져 있을 때는 가릴 것이 없었지만, 대화창 위에 놓이면
        // 포커스를 돌려주는 순간 그 뒤로 간다. 포커스를 돌려주는 것은 이
        // 확장이 일부러 하는 일이고 1초 안에 일어난다.
        window.make_above();

        if (this._config.log)
            console.log(`${TAG} overlay -> ${x},${y} over ${JSON.stringify(over.get_title())}`);
    }

    _overlayParent() {
        const last = this._lastFocused;
        if (last && last.get_compositor_private() &&
            last.get_wm_class() === 'kakaotalk.exe' &&
            last.get_frame_rect().height >= MAIN_MIN_HEIGHT)
            return last;
        return this._findMainWindow();
    }

    _addIndicator() {
        if (!this._config.tray_indicator)
            return;
        this._indicator = new TrayIndicator(this);
        Main.panel.addToStatusArea('kakaotalk-popup', this._indicator);
        this._syncIndicator();
    }

    // It stands in for the tray, and a tray icon exists only while the app
    // does. With the app closed it was a button in the panel for something
    // that is not there.
    //
    // Except when nothing is installed, and then it is the only thing
    // offering to install it -- this extension is the landing point, so it
    // has to be visible before there is anything to stand in for.
    //
    // Starting the app is what this gives up. That moved to the app icon,
    // which now exists: the flatpak ships a desktop file.
    _syncIndicator() {
        if (!this._indicator)
            return;
        const wanted = !this.appInstalled() || this._appIsUp();
        if (this._indicator.visible === wanted)
            return;
        this._indicator.visible = wanted;
        if (this._config.log)
            console.log(`${TAG} indicator ${wanted ? 'shown' : 'hidden'}`);
    }

    // On a beat, because at 'unmanaged' the window is still in the list the
    // answer is read from. Coalesced, because the app's last few windows go
    // together and one look after them is enough.
    _syncIndicatorSoon() {
        if (this._syncId)
            return;
        this._syncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._syncId = 0;
            this._syncIndicator();
            return GLib.SOURCE_REMOVE;
        });
    }

    _appIsUp() {
        for (const window of global.display.list_all_windows()) {
            if (OWNER_CLASSES.includes(window.get_wm_class()))
                return true;
        }
        return false;
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
        // Guarded on the app being installed, because kakaoshow comes with
        // it. With nothing installed there is nothing to ask, and the
        // fallback below is all that is left.
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
            // Only where --show exists, which is to say only where the app
            // is installed: without it a hand clicking that window is the
            // one way back, and hiding it would take that away.
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
        // The first frame can arrive after disable(): the handler that calls
        // this is connected to an actor, which outlives us, and there is a
        // window's worth of time between creating it and drawing it. Then
        // every field here is null and the shell logs a TypeError for a
        // window nobody is watching any more.
        if (!this._pids) return;

        const wmClass = window.get_wm_class();
        const pid = window.get_pid();
        if (OWNER_CLASSES.includes(wmClass) && pid > 0)
            this._pids.add(pid);

        this._syncIndicator();
        if (OWNER_CLASSES.includes(wmClass))
            window.connect('unmanaged', () => this._syncIndicatorSoon());

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

        // The menu we just asked for is not part of any notification, and
        // putting it in the corner with one would be a poor way to answer a
        // right-click. It goes under the click instead.
        if (this._expectingMenu() && this._isPopupWindow(window) &&
            !this._menuPlaced) {
            this._placeMenu(window);
            return;
        }

        // Not everything small and owned is part of a notification. The date
        // that appears while a conversation is scrolled is a window of its
        // own, and joining it to a notification group means it lands in the
        // corner with one.
        if (this._isOverlay(window)) {
            this._placeOverlay(window);
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
        const entry = {obj: actor, id, show: true};
        this._tray.push(entry);
        // An actor goes with its window, and reaching a disposed one from
        // disable() is a warning and a stack trace in the shell's log. There
        // is no asking a GObject whether it is still there, so note it while
        // it still is. Only actors need this; the display outlives everything.
        window.connect('unmanaged', () => (entry.dead = true));
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
    // KakaoTalk's own tray menu, asked for rather than imitated. See
    // serve_control in flatpak/kakaotalk and flatpak/kakaoshow.c.
    askMenu() {
        if (this._config.log)
            console.log(`${TAG} asking the app for its menu`);
        // A Win32 menu closes the moment it loses activation, and the window
        // it arrives in is the same shape as a message popup: owned by the
        // app, untitled, and short. So the popup handling would take the
        // focus straight back off it and the menu would be gone before it
        // was seen. Nothing about the window says which it is -- but we
        // asked for this one, so remember that we did.
        this._menuUntil = GLib.get_monotonic_time() + MENU_GRACE_US;
        // Where the click was, not where the pointer is when the menu
        // finally arrives about a second later. A menu belongs under the
        // thing that opened it, and by then the pointer has often moved on.
        const [x, y] = global.get_pointer();
        this._menuAt = [x, y];
        this._menuPlaced = false;
        this._askApp('menu');
    }

    // A window is the menu if we asked for one just now, and a notification
    // is not already being assembled around it.
    //
    // "Being assembled" means a shadow has been seen and matched a rule, not
    // merely that a group object exists. The weaker test was worse than no
    // test: a group is kept alive by anything joining it, so a menu that
    // failed this went on to join the group, which extended it, which made
    // the next menu fail too -- and each one was then placed by the
    // notification rule, in the corner. Three right-clicks, one menu in the
    // right place and two in the bottom corner.
    _expectingMenu() {
        if (GLib.get_monotonic_time() >= this._menuUntil)
            return false;
        if (!this._burst || GLib.get_monotonic_time() > this._burst.until)
            return true;
        return !this._burst.rule;
    }

    // A Wayland client cannot place its own toplevel, and this menu is one --
    // winewayland has no xdg_popup, and could not use it here anyway, since
    // a popup needs a mapped parent surface and the window that owns this
    // menu is hidden. So the compositor puts it wherever it likes, which is
    // the middle of the screen, cascading a little further down on each
    // opening. Out here is the one place that can say otherwise.
    _placeMenu(window) {
        // One ask, one menu. A second window inside the same grace window is
        // not the menu -- the menu is already up -- and a message popup is
        // the likeliest thing for it to be, so it must not be dragged to
        // where the click was. Only the placing is spent this way: the focus
        // handling keeps its hands off for the whole grace window, since the
        // two arrive in an order this cannot count on.
        if (this._menuPlaced) return;
        this._menuPlaced = true;

        const work = window.get_work_area_current_monitor();
        const rect = window.get_frame_rect();
        const [x, y] = this._menuAt ?? global.get_pointer();

        window.move_frame(false,
            Math.max(work.x, Math.min(x, work.x + work.width - rect.width)),
            Math.max(work.y, Math.min(y, work.y + work.height - rect.height)));
        if (this._config.log)
            console.log(`${TAG} menu -> ${x},${y}`);

        this._watchMenu(window);
    }

    // Nothing dismisses that menu by itself. A click elsewhere is how a menu
    // normally goes, and a click that lands on another Wayland client never
    // reaches wine, so the menu sits there until something says otherwise --
    // and the next right-click would stack another on top of it.
    //
    // So this is the click landing elsewhere, reported from the one place
    // that can see it happen.
    _watchMenu(window) {
        let done = false;
        const stop = () => {
            if (done) return;
            done = true;
            global.display.disconnect(id);
        };

        const id = global.display.connect('notify::focus-window', () => {
            if (global.display.focus_window === window)
                return;
            stop();
            this._askApp('menu-close');
        });
        // Tracked so disable() lets go of it: this hangs off the display,
        // which outlives us, and the menu it watches may never close.
        this._tray.push({obj: global.display, id});

        // Or the menu goes on its own, by something being chosen in it.
        window.connect('unmanaged', stop);
    }

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
    // session started with, and ~/.local/bin is not reliably on it. Symlink
    // bin/kakaotalk-restart there.
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
