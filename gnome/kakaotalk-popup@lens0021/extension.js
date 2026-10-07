// impl.js를 로그아웃 없이 다시 읽기 위한 로더. 왜 이렇게 나뉘어 있는지는
// gnome/README.md의 "로더가 따로 있는 이유"를 보세요.
//
// **질의 문자열은 impl.js의 수정 시각이어야 합니다.** Date.now()를 쓰면
// enable()마다 URL이 달라지고, 모듈 캐시는 한 번 읽은 모듈을 셸이 끝날
// 때까지 놓지 않으므로 사본이 하나씩 영영 쌓입니다. 화면을 잠갔다 풀
// 때마다 셸이 확장을 disable/enable하니 하루에 수십 번입니다. 그렇게
// 열흘 돌린 셸의 JS 힙에 impl.js 사본이 170벌 있었고, 아래 registerClass가
// 그때마다 다시 돌아 해제되지 않는 GType도 170개 만들어 두었습니다.
// gnome-shell이 RSS 2.6GB까지 갔습니다.
//
// enable()은 import를 기다릴 수 없어서 진짜 객체가 늦게 옵니다. disable()은
// 그 전에 불릴 수 있다는 것을 감당해야 합니다.

import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const TAG = '[kakaotalk-popup]';

export default class KakaoTalkPopupLoader extends Extension {
    enable() {
        this._enabled = true;
        this._impl = null;

        const file = this.dir.get_child('impl.js');
        const url = `${file.get_uri()}?v=${this._version(file)}`;
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

    // 캐시를 가를 값. 읽지 못하면 고정된 값으로 돌아갑니다. 그러면 고친
    // impl.js가 다음 로그인까지 반영되지 않지만, 여기서 시각을 지어내면
    // 누수가 돌아옵니다. 둘 중에는 이쪽이 낫습니다.
    _version(file) {
        try {
            return file
                .query_info('time::modified,time::modified-usec',
                            Gio.FileQueryInfoFlags.NONE, null)
                .get_modification_date_time()
                .to_unix_usec();
        } catch (e) {
            console.log(`${TAG} impl.js의 수정 시각을 읽지 못했습니다: ${e}`);
            return 'unknown';
        }
    }
}
