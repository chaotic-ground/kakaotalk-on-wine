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

// 트레이는 explorer.exe 창이다. 앱 자신의 창들은 아니다.
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
        this._attentionIds = [
            global.display.connect('window-demands-attention',
                (_display, window) => this._onDemandsAttention(window)),
            global.display.connect('window-marked-urgent',
                (_display, window) => this._onDemandsAttention(window)),
        ];
        this._watchFocus();
        this._addIndicator();
        console.log(`${TAG} enabled, config=${this._configPath}`);
    }

    disable() {
        if (this._createdId) {
            global.display.disconnect(this._createdId);
            this._createdId = null;
        }
        for (const id of this._attentionIds ?? [])
            global.display.disconnect(id);
        this._attentionIds = null;
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


    // 여기서 창을 올리지 않는다. 찍기만 한다.
    //
    // 알림이 올 때마다 앱은 목록 창을 앞으로 내달라고 한다. mutter는
    // 거절하고 창에 "주의를 요함" 표시를 남기며, 그것이 이 신호다.
    // 윈도우도 같다. 배경 프로세스의 SetForegroundWindow를 OS가 거절하고
    // 대신 작업 표시줄 단추를 깜빡인다. 그러니 사슬 전체가 이미 윈도우와
    // 같은 모양이고, 여기서 activate()를 부르면 그걸 깨뜨린다.
    //
    // 한동안 불렀었다. 알림이 올 때마다 목록이 튀어나왔다.
    //
    // 알림을 눌렀을 때 대화창이 나오는 것은 다른 길로 간다. 그 클릭에는
    // 입력 시리얼이 붙고, Wine 패치 0007이 그것을 활성화 토큰에 실어
    // 보내면 mutter가 허락한다. 확장이 할 일이 없다.
    _onDemandsAttention(window) {
        if (this._config.log)
            console.log(`${TAG} attention: ${this._describe(window)}`);
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

    // 이것은 트레이를 대신하고, 트레이 아이콘은 앱이 있는 동안만 있다.
    // 앱이 꺼져 있으면 없는 것을 위한 버튼이 패널에 있는 셈이었다.
    //
    // 아무것도 설치되어 있지 않을 때는 예외다. 그때는 설치를 권하는 유일한
    // 것이다. 이 확장이 랜딩 포인트라, 대신할 대상이 생기기 전에 보여야
    // 한다.
    //
    // 이것으로 포기하는 것은 앱 시작이다. 그건 앱 아이콘으로 옮겼고, 이제
    // 앱 아이콘이 있다. flatpak이 desktop 파일을 배포한다.
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

    // 한 박자 뒤에 본다. 'unmanaged' 시점에는 답을 읽어오는 목록에 그 창이
    // 아직 남아 있다. 여러 번 불려도 한 번으로 합친다. 앱의 마지막 창
    // 몇 개는 같이 가고, 그것들 뒤에 한 번 보면 충분하다.
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

    // Wine의 트레이도 다른 창과 같은 창이다. 앱과 같은 pid이고 그 앱의
    // explorer.exe가 그리며, 그중 메인 창이 아닌 유일한 것이다.
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

    // 앱 자신의 창. 떠 있다면. 팝업은 아니다. 팝업도 kakaotalk.exe이고
    // 제멋대로 왔다 간다. 여러 개가 열려 있으면 대화방보다 메인 창을
    // 고른다. 그게 원하는 쪽이다.
    //
    // 제목만으로는 부족하다. 알림은 107x29짜리 창을 진짜와 똑같이 카카오톡
    // 이라는 제목으로 남겨두고, 그 창은 아무 입력도 받지 않은 채 거기
    // 있는다. 제목만으로 매칭하면 그걸 찾아서, 인디케이터가 유령을
    // 활성화하는 데 클릭을 쓴다. 조용히, 하필 메인 창을 되찾는 것이 전부인
    // 그 상황에서.
    //
    // 가르는 것은 높이뿐이다. 여기서 잰 알림 조각은 전부 높이 135 이하,
    // 메인 창은 전부 431 이상인데, 폭은 겹친다(315 대 293).
    // MAIN_MIN_HEIGHT가 그 사이에 양쪽으로 여유를 두고 있다.
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
        // 트레이를 거치는 것은 거기 없는 창을 위한 우회로다. 창이 있으면
        // 올리고 끝낸다. 포인터를 옮길 것도, 두 번째 클릭도 없다.
        const main = this._findMainWindow();
        if (main) {
            // 기록한다. 이 갈래가 조용한 쪽이었고 그래서 숨어 있었다.
            // 인디케이터는 눈에 보이는 일을 아무것도 안 했고, 무엇을
            // 결정했는지 말해주는 줄도 없었다.
            if (this._config.log)
                console.log(`${TAG} raising ${this._describe(main)}`);
            main.activate(global.get_current_time());
            return;
        }

        // 앱에 그냥 물어볼 수 있으면 트레이는 필요 없다. kakaoshow는 트레이
        // 클릭이 앱으로 하여금 자기에게 보내게 만드는 그 메시지를 대신
        // 보낸다. 떠 있는 트레이 창도, 화면을 가로지르는 포인터도, 손이
        // 하는 두 번째 클릭도 없이 창이 돌아온다. flatpak/kakaoshow.c를
        // 보라.
        //
        // 앱이 설치되어 있는지로 막는 이유는 kakaoshow가 앱과 함께 오기
        // 때문이다. 아무것도 없으면 물어볼 곳이 없고, 아래의 대비책만
        // 남는다.
        if (this.appInstalled()) {
            if (this._config.log)
                console.log(`${TAG} asking the app to show itself`);
            this._askApp('show');
            return;
        }

        const tray = this._findTrayWindow();
        if (!tray) {
            // 설치된 것이 없으니 시작할 것도 없다. 여기서 좌클릭이 할 수
            // 있는 쓸모 있는 일은 설치를 권하는 것뿐이다.
            if (!this.appInstalled()) {
                this.install();
                return;
            }
            // 트레이가 없다는 것은 앱이 안 돌고 있다는 뜻이다. 카카오톡이
            // 내내 띄워두는 유일한 창이 그것이다. 아무것도 안 하고 있는
            // 인디케이터는 자기가 대신하는 것을 시작해주는 인디케이터보다
            // 나쁘고, 혹시 뭔가 돌고 있었다면 --start는 아무 일도 안
            // 한다.
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

        // 클릭은 포인터가 있는 자리에서 맨 위에 있는 것에게 간다. 그래서
        // 포인터가 도착하기 전에 창이 앞에 있어야 한다. activate가 아니라
        // raise다. 포인터 아래에 놓아주는 것은 raise이고, activate는 거기에
        // 포커스까지 주는데 그 대가가 두 겹이다.
        //
        // 하나는 타자를 치고 있던 곳에서 포커스를 뺏는 것인데, 이 확장이
        // 다른 데서 가장 많은 노력을 들여 막는 일이다. 다른 하나는 mutter가
        // 창에 포커스를 줄 때 살아있는지 보려고 핑을 보낸다는 것이다.
        // Wine의 트레이 창은 답하지 않으므로, 멀쩡히 동작하는 창 위에
        // "“explorer.exe”이(가) 응답하지 않습니다" 대화상자가 뜬다.
        tray.raise();
        if (this._config.log) {
            console.log(`${TAG} tray at ${rect.x},${rect.y} ${rect.width}x` +
                `${rect.height}, pointer to ${target[0]},${target[1]}`);
        }

        this._virtual.notify_absolute_motion(
            GLib.get_monotonic_time(), target[0], target[1]);

        // 클릭. 오늘은 아무 일도 하지 않는다.
        //
        // 해봤는데 안 된 것들: 바로 이 가상 포인터 장치로, 진짜
        // MetaVirtualInputDeviceNative에 멀쩡한 버튼 상수로, 포인터가
        // 아이콘 위에 있는 것을 재어 확인하고 monotonic 타임스탬프로
        // press와 release를 쐈다. 포인터는 움직이고 예외도 안 나는데 Wine이
        // 반응하지 않는다. 앱 자신의 창을 대상으로도 시험했고, 이 찌르기
        // 하나만으로 창이 돌아온 적은 없다. 돌아온 것처럼 보인 때는 포인터가
        // 세워둔 아이콘 위에 진짜 클릭이 떨어진 것이었다. 그게 두 번이나
        // 성공처럼 보였기 때문에 분명히 적어둔다.
        //
        // 그래도 남겨둔다. Wine의 Wayland 드라이버는 아직 어리고, 아무 일도
        // 안 하는 동안은 비용도 없다. 클릭이 닿는 날이 오면 이게 빠져 있던
        // 것을 누가 기억해낼 필요 없이 인디케이터가 두 번이 아니라 한 번
        // 클릭이 된다. 빼려면 tray_virtual_click을 false로.
        //
        // 어느 쪽이든 포인터는 아이콘 위에 남는다. 그게 실제로 동작하는
        // 부분이다. 뒤따르는 손에게 누를 것이 생긴다. 트레이 창은
        // alt-tab에 없어서, 안 그러면 거기 가는 데 오버뷰를 거쳐야 한다.
        if (this._config.tray_virtual_click)
            this._clickHere(target);
    }

    // 손이 그러듯 press와 release를 시간으로 떨어뜨린다. 타임스탬프가 같은
    // press/release는 입력 스택이 버려도 되는 종류다. 이것의 목적이 언젠가
    // 듣기 시작할 Wine을 대비하는 것이니, 그때 클릭처럼 보여야 한다.
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
            // 설정이 없는 것은 정상이다. 관찰만 한다는 뜻이다.
            this._config = DEFAULT_CONFIG;
            console.log(`${TAG} config not usable (${e.message}), logging only`);
        }
    }

    _watchConfig() {
        const file = Gio.File.new_for_path(this._configPath);
        this._monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._loadConfig());
    }

    // 포커스를 뺏긴 것을 되돌리는 게 아니라, 뺏기기 전에 없앤다.
    //
    // mutter는 window_state_on_map에서 창 타입만 보고 map할 때 포커스를 줄지
    // 정한다. NORMAL, DIALOG, MODAL_DIALOG는 가져가고 나머지는 안 가져간다.
    // NOTIFICATION도 나머지에 속한다. 카카오톡의 팝업은 NORMAL로 온다.
    // 실제 정체대로 타입을 바꿔주면 질문이 던져지기 전에 답이 난다.
    //
    // 그럴 틈이 있는 이유는, Wayland 창은 버퍼가 붙기 전에는 보여질 수 없고
    // Wine이 get_toplevel과 app_id와 제목을 첫 버퍼 전에 한 번에 보내기
    // 때문이다. 그래서 창이 아직 보여질 수 없는, 따라서 포커스를 받을 수도
    // 없는 동안에 제목을 알게 된다.
    //
    // 이것은 팝업을 alt-tab과 오버뷰에서도 빼는데, 어차피 알림에게 바라는
    // 바다.
    //
    // 창이 처리되어 더 볼 필요가 없어지면 true를 돌려준다.
    // watching.
    _retype(window) {
        // 팝업은 일부러 그대로 둔다. NOTIFICATION으로 바꾸면 포커스 뺏김은
        // 막힌다. mutter는 map할 때 NORMAL, DIALOG, MODAL_DIALOG에만
        // 포커스를 주기 때문이다. 다만 그러면 배치도 앱에서 빼앗아간다.
        // mutter가 카카오톡이 요청한 자리 대신 0,32에 창을 놓고, 팝업은
        // 그림자와 메시지를 담은 제목 없는 창, 이렇게 두 개다. 그림자만
        // 구석으로 옮기면 메시지는 왼쪽 위에 남는다. 알림을 흩어놓는 수정은
        // 그것이 막아주는 포커스보다 나쁘다. 그래서 대신 나중에 포커스를
        // 돌려준다. _watchFocus를 보라.

        // 트레이는 앱이 도는 동안 Wine이 계속 띄워두는 창이고, 그 정체가
        // UTILITY다. 탭으로 옮겨갈 대상은 아니지만 알림도 아니다. mutter의
        // 재계산은 둘 다 작업 표시줄에서 빼는데, 그게 alt-tab과 오버뷰에서
        // 사라지게 하는 것이다.
        if (this._config.hide_tray && window.get_wm_class() === 'explorer.exe') {
            if (window.get_window_type() !== Meta.WindowType.UTILITY)
                window.set_type(Meta.WindowType.UTILITY);
            // 그리고 다른 들어가는 길이 생기면 화면에서 아예 뺀다. 트레이는
            // 클릭당하는 것 말고는 존재 이유가 없다. --show가 있으면
            // 인디케이터가 앱에 직접 물어보고, 그 창은 구석에 남은 작은
            // 네모일 뿐이다.
            //
            // --show가 있는 곳, 즉 앱이 설치된 곳에서만 그렇게 한다. 없으면
            // 그 창을 손으로 클릭하는 것이 유일한 귀환로이고, 숨기면 그걸
            // 빼앗는 것이 된다.
            if (this._config.hide_tray_window && this.appInstalled())
                this._hideTrayWindow(window);
            return true;
        }

        // 그림자를, 보여지기 전에, 이름으로 잡는다. 알림의 조각 중 여기서
        // 잡을 수 있을 만큼 일찍 자기 이름을 밝히는 것은 이것뿐이고,
        // 미끄러지는 프레임마다 다시 만들어지는 것도 이것이다. 그래서
        // 포커스 뺏김의 대부분이 여기서 막힌다.
        if (window.get_title() === POPUP_TITLE) {
            this._markNotification(window);
            return true;
        }
        return false;
    }

    // mutter는 map할 때 NORMAL, DIALOG, MODAL_DIALOG에만 포커스를 준다.
    // 그래서 이것은 나중에 답하는 게 아니라 질문 자체를 정리한다.
    // _watchFocus는 그 아래 그물로 남는다. 메시지와 답장 입력칸을 담은
    // 제목 없는 창은 map되기 전에 알아볼 수가 없어서, 제목도 크기도 아직
    // 없어서, 첫 번째 뺏기는 여전히 통과하고 여전히 돌려줘야 한다.
    //
    // 규칙의 "type" 목록에 NOTIFICATION이 들어있는 이유가 이것이다. NORMAL만
    // 적은 규칙은 이 코드가 도는 순간부터 매칭을 멈추고, 위치 조정도 같이
    // 멈춘다.
    _markNotification(window) {
        if (!this._config.popup_notification_type)
            return;
        if (window.get_window_type() === Meta.WindowType.NOTIFICATION)
            return;
        window.set_type(Meta.WindowType.NOTIFICATION);
    }

    // UTILITY가 아니다. 먼저 손이 가는 쪽이지만 이 일을 하지 못한다.
    // UTILITY는 창을 alt-tab과 오버뷰에서 뺄 뿐 화면의 있던 자리에 그대로
    // 둔다. 화면에서 빼려면 mutter가 그걸 그리는 액터를 숨겨야 한다.
    //
    // 숨길 만한 창은 둘이고 메시지는 그중이 아니다. 그림자는 그림자를 그리지
    // 않는다. Wine이 그걸 흰 사각형으로 그려서, 팝업 아래가 아니라 둘레에
    // 놓인 테두리가 된다. 그리고 107x29짜리 띠는 아무것도 담지 않은 채
    // 알림보다 오래 남는 찌꺼기다.
    //
    // 메시지 창이 제목 없는 쪽이므로, 빈 제목이 건드리지 말아야 할
    // 표식이다.
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

    // 창이 처음 그려질 때는 아직 제목이 없고, 띠와 메시지를 가를 다른
    // 기준도 없다. 둘 다 소유한 창이고 둘 다 작고 그 순간엔 둘 다 제목이
    // 없다. 그래서 첫 눈에는 "메시지"라고 보고 구석에 놓고 화면에 남겼는데,
    // 이름은 그 뒤에 왔다. 그때는 이미 오버뷰에서 빠져 있어서 처리된 것처럼
    // 보였다. 그건 NOTIFICATION이 skip_taskbar를 세운 것이지 여기서 한 일이
    // 아니다.
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
        // 만들어지는 시점에는 보통 제목이 아직 없어서 지켜본다. 둘 중
        // 하나는 창이 보여질 수 있게 되기 전에 발생한다.
        if (!this._retype(window)) {
            // 만들어지는 시점에는 두 이름이 다 없다. 어느 쪽이 먼저 오든
            // 창이 보여질 수 있게 되는 것보다는 빠르다. Wine이 둘 다 그걸
            // 허락할 버퍼보다 먼저 보내기 때문이다.
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

        // 만들어지는 시점에는 아무것도 정해지지 않았다. 제목도 최종 크기도
        // 없다. 그래서 보거나 옮기기 전에 첫 프레임을 기다린다.
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
        // 첫 프레임이 disable() 뒤에 올 수 있다. 이걸 부르는 핸들러가 우리
        // 보다 오래 사는 액터에 걸려 있고, 창을 만드는 것과 그리는 것
        // 사이에는 창 하나만큼의 시간이 있다. 그러면 여기 모든 필드가
        // null이고, 셸은 이제 아무도 안 보는 창 때문에 TypeError를
        // 기록한다.
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
            // _retype뿐 아니라 여기서도 한다. 만들어지는 시점에는 액터가
            // 아직 없고, 생기기 전에는 숨길 것도 없다. 이 코드는 첫
            // 프레임에 도니 그때는 있다.
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

        // 방금 요청한 메뉴는 어떤 알림의 일부도 아니다. 알림과 함께
        // 구석으로 보내는 것은 우클릭에 대한 답으로 좋지 않다. 대신 클릭한
        // 자리 아래로 간다.
        if (this._expectingMenu() && this._isPopupWindow(window) &&
            !this._menuPlaced) {
            this._placeMenu(window);
            return;
        }

        // 작고 소유한 창이라고 다 알림의 일부는 아니다. 대화를 스크롤할 때
        // 뜨는 날짜는 자기 창이고, 알림 묶음에 넣으면 알림과 함께 구석에
        // 떨어진다.
        if (this._isOverlay(window)) {
            this._placeOverlay(window);
            return;
        }

        // 자기 규칙이 없다는 것이 그대로 두라는 뜻은 아니다. _joinGroup을
        // 보라.
        this._joinGroup(window);
    }

    // 알림 하나는 창 하나가 아니다. 여러 개로 온다. 여기서 잰 것으로는
    // 메시지를 담은 폭 315짜리 그림자, 107x29짜리 띠, 465x1짜리 실선이다.
    // 그중 규칙을 쓸 이름을 가진 것은 그림자뿐이다. 그것만 놓았더니 팝업이
    // 조각난 채로 남았다. 그림자는 구석으로 가고 나머지는 Wine이 놓은
    // 화면 가운데에 남았다.
    //
    // 그래서 그림자가 움직인 만큼을 기억해두고, 그 옆에 나타나는 모든 것을
    // 같은 만큼 옮긴다. 앱이 그린 배치가 유지된다.
    //
    // 조각들이 그림자보다 먼저 오므로 기다린다. 그림자가 놓이기 전에는 옮길
    // 기준이 없고, 짐작으로 옮기면 다르게 흩어질 뿐이다.
    //
    // 일부러 근사값이다. 그림자는 애니메이션 프레임마다 다른 높이로 다시
    // 만들어지고 Wine이 잡는 원점도 가만있지 않는다. 첫 프레임에서 잰
    // 오프셋은 마지막 프레임쯤에는 50픽셀까지 어긋난다. 1100에 대해 50의
    // 오차가 그 거래다. 대안인 프레임마다 다시 계산하는 쪽은 미끄러지는
    // 내내 가만있는 조각들을 끌고 다니게 된다.
    _group() {
        const now = GLib.get_monotonic_time();
        if (!this._burst || now > this._burst.until)
            this._burst = {rule: null, waiting: [], members: []};
        this._burst.until = now + GROUP_GAP_US;
        return this._burst;
    }

    _joinGroup(window) {
        const group = this._group();
        // 조각들이 그림자보다 먼저 오고, 규칙이 매칭되기 전에는 놓을 기준이
        // 없다. 그래서 기다린다.
        if (!group.rule) {
            group.waiting.push(window);
            return;
        }
        this._placeMember(window, group);
    }

    // 묶음을 오프셋 하나로 옮기는 게 아니라 조각마다 따로 놓는다. mutter가
    // 배치를 가져가기 전까지는 전자가 설계였다. 팝업을 NOTIFICATION으로
    // 바꾸면, 그게 포커스 뺏기를 막는 방법이고 단정한 배치보다 값어치가
    // 크다, mutter가 창을 자기 마음에 드는 자리에 놓는다. mutter는 0,32를
    // 좋아한다. 로그로 쟀다. 그림자가 0,32에 있는 동안 조각들은 여전히
    // 1048,736에 있었다. 그 기준점에서 잰 오프셋은 아무 데서도 잰 것이
    // 아니고, 그러면 모든 조각이 이웃 검사에 실패해서 화면 가운데
    // 남는다.
    //
    // 그래서 상대적 배치는 더 이상 지킬 수 있는 것이 아니고, 조각마다 같은
    // 모서리에 붙이는 것이 남아있는 것 중 가장 가깝다. 어차피 얼추 맞는다.
    // 그림자는 315x135, 메시지 창은 310x129라서 둘 다 아래를 맞추면 메시지가
    // 자기 그림자 안에 들어간다. 원래 그리려던 자리다.
    //
    // 이제 소속은 묶음뿐이다. 예전의 위치 검사는 위치를 mutter가 정하는
    // 상황에서는 동작할 수 없다. 남은 것은 소유했고, 작고, 팝업으로부터
    // GROUP_GAP_US 안이라는 것이고, 메인 창을 거기서 빼는 것이 높이
    // 하한이다.
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

    // 그림자는 배경이고 메시지는 그 옆의 창에 그려지므로, 메시지가 위로
    // 와야 한다. 예전에는 포커스를 가져가면서 올라갔다. 팝업을
    // NOTIFICATION으로 바꾸면서 그 길이 없어졌고, 미끄러지는 프레임마다
    // 다시 만들어지고 다시 올라가는 그림자가 메시지 위에 앉게 되었다.
    // 그래서 그림자가 돌아올 때마다 묶음의 나머지를 그 뒤에 올린다.
    _raiseGroupMembers(group) {
        group.members = group.members.filter(w => w.get_compositor_private());
        for (const member of group.members) {
            member.make_above();
            member.raise();
        }
    }

    // 트레이 창을 화면에서 뺀다. 창 목록에서 빼는 것과는 다르다. 위의
    // UTILITY가 그 일을 하는데, 구석에 작은 네모를 그린 채로 남긴다. Wine
    // 에게 map하지 말라고 할 wayland 쪽 방법은 없으므로, 숨기는 대상은
    // 액터다.
    //
    // 그리고 그 뒤로도 계속 숨긴다. mutter는 창을 map할 때 액터를 보이게
    // 하고, 작업 공간과 오버뷰 전환 때마다 또 그런다. 만들 때 hide() 한
    // 번으로는 1초 안에 되돌려진다. 반복해도 싸다. 창은 실행마다 하나뿐이고
    // 정당하게 보여질 일이 없다.
    _hideTrayWindow(window) {
        const actor = window.get_compositor_private();
        // 이 집합은 이번 enable의 것이지 그보다 오래 사는 액터의 것이
        // 아니다. 액터에 저장한 플래그는 disable을 넘겨 살아남고, 다음
        // enable이 그걸 이미 세워진 채로 발견해서 아무것도 안 한다. 창은
        // 이 파일의 이전 판이 남긴 상태 그대로인데, 바꾼 것이 먹히는지
        // 알아보는 방법으로는 나쁘다.
        if (!actor || this._hidden.has(actor))
            return;
        this._hidden.add(actor);
        const id = actor.connect('notify::visible', () => {
            if (actor.visible)
                actor.hide();
        });
        const entry = {obj: actor, id, show: true};
        this._tray.push(entry);
        // 액터는 자기 창과 함께 간다. 이미 없어진 것을 disable()에서
        // 건드리면 셸 로그에 경고와 스택 트레이스가 남는다. GObject에게
        // 아직 있느냐고 물어볼 방법이 없으니, 아직 있을 때 표시해둔다.
        // 이게 필요한 것은 액터뿐이다. display는 모든 것보다 오래 산다.
        window.connect('unmanaged', () => (entry.dead = true));
        actor.hide();
        console.log(`${TAG} tray window hidden`);
    }

    // Wine의 트레이 창을 닫으면 앱이 고립된다. 카카오톡은 최소화가 아니라
    // 숨기기를 하므로, 트레이가 사라지면 다시 보이라고 할 수 있는 것이
    // 없다. 인디케이터가 찌를 대상이 없고, 유일한 귀환로는 재시작이다.
    // 그걸 알아내는 유일한 방법이 갇혀보는 것이니, 대신 해준다.
    //
    // 그 일을 하는 X 버튼은 Wine이 평범한 Win32 캡션 버튼으로 그리는
    // 것이라 바깥에서 없앨 수 없다. 결과만 되돌릴 수 있다.
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

    // flatpak이 설치되어 있는지. 메뉴를 만드는 근거가 되는 사실이다.
    // 캐시한다. 메뉴가 열릴 때마다 묻는 질문이라 그때마다 프로세스를 띄우는
    // 것은 우습고, 우리 몰래 이 답을 바꾸는 유일한 것은 아래의 install()
    // 인데 그쪽이 캐시를 지운다.
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

    // 네트워크로 70메가라서, 시작할 때 말하고 끝날 때 또 말한다. 2분 동안
    // 아무 일도 안 하는 것처럼 보이는 메뉴 항목은 사람들이 두 번 누르는
    // 메뉴 항목이다.
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

    // 카카오톡 자신의 트레이 메뉴를, 흉내 내는 게 아니라 요청한다.
    // flatpak/kakaotalk의 serve_control과 flatpak/kakaoshow.c를 보라.
    askMenu() {
        if (this._config.log)
            console.log(`${TAG} asking the app for its menu`);
        // Win32 메뉴는 활성화를 잃는 순간 닫히는데, 그 메뉴가 도착하는
        // 창은 메시지 팝업과 모양이 같다. 앱이 소유하고, 제목이 없고,
        // 낮다. 그래서 팝업 처리가 포커스를 곧바로 도로 가져가고 메뉴는
        // 보이기도 전에 사라진다. 창 자체에는 어느 쪽인지 알려주는 것이
        // 없다. 다만 이건 우리가 요청한 것이니 요청했다는 사실을
        // 기억해둔다.
        this._menuUntil = GLib.get_monotonic_time() + MENU_GRACE_US;
        // 메뉴가 1초쯤 뒤에 도착했을 때의 포인터가 아니라, 클릭이 있었던
        // 자리. 메뉴는 그것을 연 것 아래 있어야 하고, 그때쯤이면 포인터는
        // 이미 다른 데로 가 있는 경우가 많다.
        const [x, y] = global.get_pointer();
        this._menuAt = [x, y];
        this._menuPlaced = false;
        this._askApp('menu');
    }

    // 창이 메뉴인 조건은, 방금 우리가 메뉴를 요청했고 그 주위에서 알림이
    // 조립되고 있지 않다는 것이다.
    //
    // "조립되고 있다"는 것은 그림자가 보였고 규칙에 걸렸다는 뜻이지, 단지
    // 묶음 객체가 존재한다는 뜻이 아니다. 약한 쪽 검사는 검사가 없는
    // 것보다 나빴다. 묶음은 거기 들어오는 무엇이든에 의해 살아있으므로,
    // 이 검사에 떨어진 메뉴가 묶음에 들어가고, 그게 묶음을 연장하고, 그래서
    // 다음 메뉴도 떨어졌다. 그리고 각각은 알림 규칙에 따라 구석으로
    // 놓였다. 우클릭 세 번에 제자리 하나, 오른쪽 아래 구석 둘이었다.
    _expectingMenu() {
        if (GLib.get_monotonic_time() >= this._menuUntil)
            return false;
        if (!this._burst || GLib.get_monotonic_time() > this._burst.until)
            return true;
        return !this._burst.rule;
    }

    // Wayland 클라이언트는 자기 toplevel 위치를 정할 수 없고 이 메뉴가
    // toplevel이다. winewayland에는 xdg_popup이 아예 없고, 있어도 여기서는
    // 못 쓴다. 팝업은 map된 부모 표면이 필요한데 이 메뉴의 주인 창은
    // 숨겨져 있다. 그래서 컴포지터가 자기 마음에 드는 자리에 놓는다. 화면
    // 가운데이고, 열 때마다 조금씩 아래로 계단처럼 내려간다. 다르게 말할
    // 수 있는 유일한 자리가 여기 바깥이다.
    _placeMenu(window) {
        // 요청 하나에 메뉴 하나. 같은 유예 시간 안의 두 번째 창은 메뉴가
        // 아니다. 메뉴는 이미 떠 있다. 그 창은 메시지 팝업일 가능성이 가장
        // 높으니 클릭했던 자리로 끌고 가면 안 된다. 이렇게 소진되는 것은
        // 배치뿐이다. 포커스 쪽은 유예 시간 내내 손을 떼고 있는다. 둘이
        // 어느 순서로 오는지를 여기서는 믿을 수 없기 때문이다.
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

    // 그 메뉴는 스스로 닫히지 않는다. 메뉴가 보통 사라지는 방법은 다른
    // 데를 클릭하는 것인데, 그 클릭이 다른 Wayland 클라이언트에 떨어지면
    // wine에는 닿지 않는다. 누가 말해주기 전까지 메뉴는 그 자리에 있고,
    // 다음 우클릭은 그 위에 하나를 더 쌓는다.
    //
    // 그래서 이것이 "다른 데 떨어진 클릭"이다. 그 일이 일어나는 것을 볼 수
    // 있는 유일한 자리에서 알려준다.
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
        // disable()이 놓아줄 수 있게 기록해둔다. 이건 우리보다 오래 사는
        // display에 걸려 있고, 지켜보는 메뉴는 영영 안 닫힐 수도 있다.
        this._tray.push({obj: global.display, id});

        // 또는 메뉴 안에서 뭔가가 선택되어 메뉴가 스스로 사라진다.
        window.connect('unmanaged', stop);
    }

    // flatpak 런처가 지켜보는 파일에 단어 하나를 쓰면, 이미 클라이언트를
    // 돌리고 있는 인스턴스가 나머지를 한다.
    //
    // `flatpak run <app> --show`가 아니다. 그게 뻔한 방법이고 앱을 죽인다.
    // 두 번째 인스턴스는 자기 PID 네임스페이스를 갖고, 그 경계를 넘어 다른
    // 프로세스를 들여다보는 wine 프로세스는 세션 전체를 데리고 내려간다.
    // 클라이언트와 explorer가 5초 안에 사라지고 로그인을 다시 쳐야 한다.
    // flatpak/kakaotalk의 serve_control을 보라.
    //
    // 평범한 파일이라 여기서 막히는 일이 없다. fifo가 더 단정했겠지만,
    // 듣는 쪽이 없는 첫 순간에 셸 전체를 세웠을 것이다.
    _askApp(word) {
        const path = GLib.build_filenamev(
            [GLib.get_home_dir(), '.var', 'app', APP_ID, 'data', 'control']);
        try {
            GLib.file_set_contents(path, `${word}\n`);
        } catch (e) {
            console.log(`${TAG} could not ask for ${word}: ${e.message}`);
        }
    }

    // PATH의 이름이 아니라 전체 경로를 쓴다. 셸의 PATH는 세션이 시작할 때
    // 갖고 있던 그대로이고 ~/.local/bin이 거기 있다고 믿을 수 없다.
    // bin/kakaotalk-restart를 거기에 심볼릭 링크로 걸어두면 된다.
    //
    // 가변 인자인 이유는, 그냥 재시작이 인자 없이 부르는 것이고
    // [helper, undefined]는 그것이 아니기 때문이다.
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
        // 지금 작업 중인 창 뒤에서 열리는 알림은 알림이 아니다.
        // make_above는 mutter의 "항상 위" 층에 넣고, raise는 그 층 안에서
        // 위로 올린다. 팝업이 포커스를 안 가져가도록 타입을 바꾸기 전에는
        // 포커스가 하던 일이다.
        //
        // 전체화면 창 위는 예외다. 거기서는 GNOME 자신의 배너도 내려가
        // 있고, 이것만 예외일 이유가 없다. 카카오톡이 팝업을 그리는 것을
        // 여기서 막을 수는 없다. 앱의 결정이고 묻지도 않는다. 다만 올려주지
        // 않으면 전체화면 창이 위에 남고, 보이는 결과는 같다.
        if (rule.above && !this._overFullscreen(window)) {
            window.make_above();
            window.raise();
        }

        if (this._hideChrome(window)) {
            // 숨기더라도 묶음에는 규칙이 필요하다. 메시지 창이 그 규칙으로
            // 놓이고, 이것보다 먼저 온다.
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

    // 창이 최종적으로 있어야 할 자리. 규칙이 뭘 요청했든 모니터 안으로
    // 자른다. null은 규칙이 그대로 두라고 했거나, 여기서 이해할 수 없는
    // 말을 했다는 뜻이다.
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
