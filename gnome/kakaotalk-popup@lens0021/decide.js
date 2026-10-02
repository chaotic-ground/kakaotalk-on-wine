// 인디케이터를 눌렀을 때 무엇을 할지 정하는 곳.
//
// classify.js와 같은 이유로 따로 있다. gi를 import하지 않으므로 셸 밖에서
// 부를 수 있고, 그래서 시험할 수 있다. 전에는 판단과 실행이 pokeTray 안에
// 섞여 있어서, 부르면 창이 뜨고 프로세스가 돌고 알림이 떴다. 시험할 수
// 있는 모양이 아니었다.
//
// 판단이 값으로 나오면 두 가지가 따라온다. 시험할 수 있고, 로그에 찍을 수
// 있다. 인디케이터가 아무 일도 안 한 것처럼 보일 때 왜 그랬는지 말해주지
// 못한 것이 이 저장소에서 같은 조사를 네 번 하게 만든 이유다.
import { classify } from './classify.js';

/**
 * 인디케이터 좌클릭이 무엇을 할지.
 *
 * @param {object} state
 * @param {object[]} state.windows 셸이 아는 모든 창
 * @param {Set<number>|null} state.pids 앱이 쓰는 pid들
 * @param {boolean} state.installed 앱이 설치되어 있는가
 * @returns {{do: string, window?: object}}
 *   raise    그 창을 올린다
 *   ask      앱에게 창을 보여달라고 한다
 *   install  설치를 권한다
 *   start    앱을 시작한다
 *   poke     트레이 창을 찌른다
 */
export function decideTrayClick({ windows, pids, installed }) {
    // 창이 있으면 올리고 끝낸다. 트레이를 거치는 것은 거기 없는 창을 위한
    // 우회로다.
    let fallback = null;
    let tray = null;
    for (const window of windows) {
        const kind = classify(window, pids);
        if (kind === 'list')
            return { do: 'raise', window };
        if (kind === 'chat')
            fallback ??= window;
        else if (kind === 'tray')
            tray ??= window;
    }
    if (fallback)
        return { do: 'raise', window: fallback };

    // 앱에 그냥 물어볼 수 있으면 트레이는 필요 없다. kakaoshow가 트레이
    // 클릭이 앱으로 하여금 자기에게 보내게 만드는 그 메시지를 대신 보낸다.
    //
    // 설치되어 있는지로 막는 이유는 kakaoshow가 앱과 함께 오기 때문이다.
    // 아무것도 없으면 물어볼 곳이 없다.
    if (installed)
        return { do: 'ask' };

    // 여기부터는 설치되지 않은 사람의 몫이다. 위에서 설치된 경우는 이미
    // 돌아갔다.
    if (!tray)
        return { do: 'install' };

    // 그리고 아래 둘은 실제로 닿지 않는다. 트레이 창은 앱이 띄우는
    // 것이므로 설치되지 않은 사람에게 있을 수 없고, 설치된 사람은 위에서
    // 돌아갔다. 시험이 그것을 적어두고 있다.
    //
    // 지우지 않은 이유는 appInstalled가 디렉터리 하나를 보는 것이라, 앱이
    // 돌고 있는데 그 검사가 거짓이 되는 경우를 아직 배제하지 못해서다.
    // 그때는 이 둘이 유일한 귀환로다.
    return { do: 'poke', window: tray };
}
