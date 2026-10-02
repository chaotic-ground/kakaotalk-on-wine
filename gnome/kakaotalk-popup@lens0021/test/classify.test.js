// 창 분류 시험.
//
// 여기 적힌 크기는 지어낸 것이 아니라 실제로 잰 것이다. 띠 107x29,
// 목록 창 392x562, 스크롤할 때 뜨는 날짜 82x33, 알림 조각 310x82.
// 기준을 건드리면 이 시험이 말해준다.
//
// 이것이 있는 이유는 같은 자리에서 세 번 넘어졌기 때문이다. 제목이
// "카카오톡"인 창을 전부 숨겨서 목록 창이 화면에서 사라진 적이 있고,
// 유령이라 부르며 두 번 엉뚱한 곳을 팠다. 린터도 타입도 그런 것은
// 잡지 않는다.
import { classify } from '../classify.js';
import { done, is } from './assert.js';

const OURS = new Set([42]);

function win({ cls = 'kakaotalk.exe', pid = 42, title = '', w = 100, h = 100 }) {
    return {
        get_wm_class: () => cls,
        get_pid: () => pid,
        get_title: () => title,
        get_frame_rect: () => ({ x: 0, y: 0, width: w, height: h }),
    };
}

const kind = (o) => classify(win(o), OURS);

// 제목이 같은 둘. 이 한 쌍이 이 파일이 있는 이유다.
is(kind({ title: '카카오톡', w: 392, h: 562 }), 'list', '목록 창');
is(kind({ title: '카카오톡', w: 107, h: 29 }), 'band', '알림이 남기는 띠');

// 높이 기준의 양쪽. 240이 경계다.
is(kind({ title: '카카오톡', w: 300, h: 239 }), 'band', '경계 바로 아래');
is(kind({ title: '카카오톡', w: 300, h: 240 }), 'list', '경계');

// 알림의 조각들.
is(kind({ title: 'KakaoTalkShadowWnd', w: 318, h: 60 }), 'shadow', '그림자');
is(kind({ title: '', w: 310, h: 82 }), 'piece', '메시지 창');
is(kind({ title: '', w: 310, h: 1 }), 'piece', '납작한 조각');

// 앱이 자기 창 위에 그리는 것.
is(kind({ title: '', w: 82, h: 33 }), 'overlay', '스크롤할 때 뜨는 날짜');
is(kind({ title: '', w: 16, h: 16 }), 'piece', '정체 모를 작은 창은 overlay가 아니다');
is(kind({ title: '', w: 318, h: 33 }), 'piece', '폭이 넘으면 overlay가 아니다');

// 대화방.
is(kind({ title: '가자 엠티', w: 380, h: 640 }), 'chat', '대화방 창');
is(kind({ title: '가자 엠티', w: 380, h: 100 }), 'piece', '제목이 있어도 작으면 조각');

// 우리 것이 아닌 것.
is(kind({ cls: 'explorer.exe', title: '', w: 153, h: 49 }), 'tray', '트레이');
is(kind({ cls: 'firefox', title: '무엇이든', w: 800, h: 600 }), 'foreign', '남의 창');
is(kind({ pid: 99, title: '카카오톡', w: 392, h: 562 }), 'foreign', '모르는 pid');

// 트레이는 pid를 묻지 않는다. 창이 만들어지는 시점에는 아직 모를 수 있다.
is(classify(win({ cls: 'explorer.exe' }), null), 'tray', 'pid를 배우기 전의 트레이');

done('classify');
