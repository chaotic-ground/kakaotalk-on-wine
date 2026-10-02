// 인디케이터를 눌렀을 때 무엇을 하는지.
//
// 이 시험이 있는 이유는 "인디케이터 먹통"이 네 번 올라왔기 때문이다. 넷
// 중 둘은 순수한 판단 문제였고, 이 시험이 있었다면 사용자가 말하기 전에
// 잡혔다. 나머지 둘(좀비 클라이언트, Win32와 컴포지터의 불일치)은 여기서
// 잡히지 않는다. 확장 입장에서는 입력이 "창 없음"이고 동작은 맞다.
import { decideTrayClick } from '../decide.js';
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

const list = win({ title: '카카오톡', w: 392, h: 562 });
const chat = win({ title: '가자 엠티', w: 380, h: 640 });
const band = win({ title: '카카오톡', w: 107, h: 29 });
const tray = win({ cls: 'explorer.exe', w: 153, h: 49 });

const pick = (windows, installed = true) =>
    decideTrayClick({ windows, pids: OURS, installed });

// 창이 있으면 올린다.
is(pick([list]).do, 'raise', '목록 창이 있으면 올린다');
is(pick([list]).window, list, '올리는 것은 그 목록 창');
is(pick([tray, list]).do, 'raise', '트레이가 있어도 목록 창이 이긴다');

// 띠를 올리면 안 된다. 제목이 목록 창과 같고, 올려봐야 아무것도 안 보인다.
// 인디케이터가 유령을 활성화하는 데 클릭을 쓰던 때가 있었다.
is(pick([band]).do, 'ask', '띠뿐이면 올리지 않고 앱에게 묻는다');
is(pick([band, list]).window, list, '띠와 목록 창이 같이 있으면 목록 창');

// 대화방만 열려 있는 경우. 목록을 닫고 쓰는 사람이 있다.
is(pick([chat]).do, 'raise', '대화방만 있으면 그것을 올린다');
is(pick([chat]).window, chat, '올리는 것은 그 대화방');
is(pick([chat, list]).window, list, '둘 다면 목록 창이 먼저');

// 올릴 창이 없을 때.
is(pick([]).do, 'ask', '창이 없고 설치돼 있으면 앱에게 묻는다');
is(pick([tray]).do, 'ask', '트레이만 있어도 설치돼 있으면 묻는다');
is(pick([], false).do, 'install', '설치돼 있지 않으면 설치를 권한다');

// 남의 창은 세지 않는다.
is(pick([win({ cls: 'firefox', title: '무엇이든', w: 800, h: 600 })]).do, 'ask',
   '남의 창은 올릴 대상이 아니다');
is(pick([win({ pid: 99, title: '카카오톡', w: 392, h: 562 })]).do, 'ask',
   '모르는 pid의 창도 아니다');

// 설치돼 있지 않은데 트레이가 있는 경우. 실제로는 닿지 않는다. 트레이는
// 앱이 띄우는 것이고 설치된 사람은 위에서 돌아간다. 이 줄은 그 갈래가
// 살아 있다는 기록이지 쓰인다는 뜻이 아니다.
is(pick([tray], false).do, 'poke', '닿지 않는 갈래: 설치 안 됨 + 트레이 있음');

done('decide');
