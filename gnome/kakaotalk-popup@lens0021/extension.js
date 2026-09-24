// impl.js를 로그아웃 없이 다시 읽기 위한 로더.
//
// GNOME Shell은 확장의 모듈을 한 번 import하고 계속 들고 있다. 껐다 켜는
// 것은 이미 갖고 있는 객체의 disable()과 enable()을 부를 뿐이고, D-Bus
// 인터페이스에도 다시 읽는 방법은 없다. 그래서 셸 자체를 다시 시작할 수
// 없는 Wayland 세션에서는 extension.js를 고쳐도 다음 로그인까지 반영되지
// 않는다. 그러면 고쳐가며 만드는 일이 비싸진다.
//
// 질의 문자열을 바꿔가며 하는 동적 import는 그 캐시를 비껴간다. 그래서
// 절대 바뀌지 않는 이 파일이 enable()마다 impl.js를 새로 읽어온다.
//
//   gnome-extensions disable kakaotalk-popup@lens0021
//   gnome-extensions enable kakaotalk-popup@lens0021
//
// 이것으로 지금의 impl.js가 반영된다.
//
// enable()은 import를 기다릴 수 없어서 진짜 객체가 늦게 온다. disable()은
// 그 전에 불릴 수 있다는 것을 감당해야 한다.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const TAG = '[kakaotalk-popup]';

export default class KakaoTalkPopupLoader extends Extension {
    enable() {
        this._enabled = true;
        this._impl = null;

        const url = `${this.dir.get_child('impl.js').get_uri()}?v=${Date.now()}`;
        import(url).then(module => {
            if (!this._enabled)
                return;
            this._impl = new module.default(this);
            this._impl.enable();
        }).catch(e => {
            console.log(`${TAG} impl.js를 읽지 못했습니다: ${e}`);
        });
    }

    disable() {
        this._enabled = false;
        this._impl?.disable();
        this._impl = null;
    }
}
