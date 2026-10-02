// 창을 무엇으로 볼지 정하는 곳. 이 파일에만 있다.
//
// gi를 import하지 않는다. 그래야 셸 밖에서, 즉 시험에서 부를 수 있다.
// 이 파일이 따로 있는 이유가 그것이다. 나머지는 셸을 만지는 코드이고
// 여기는 순수한 정책이다. 이번에 세 번 넘어진 것이 전부 이 정책을 여러
// 곳에서 다르게 답한 탓이었고, 린터도 타입도 그런 것은 잡지 않는다.
// 잡는 것은 시험이다. test/classify.test.js를 보라.
//
// window는 Meta.Window처럼 get_wm_class(), get_pid(), get_title(),
// get_frame_rect()에 답하는 것이면 무엇이든 된다. 시험은 평범한 객체를
// 건넨다.

export const POPUP_TITLE = 'KakaoTalkShadowWnd';

// 이보다 작으면서 자기를 카카오톡이라고 하는 창은 진짜가 아니라 남은
// 것이다. _findMainWindow를 보라.
export const MAIN_MIN_HEIGHT = 240;

// 제목 없는 소유 창이 "앱이 자기 창 위에 그리는 것"으로 인정받으려면 들어야
// 하는 크기 범위. 대화를 스크롤할 때 뜨는 날짜 같은 것이다. 재봤다. 그
// 날짜는 82x33이고, 알림의 그림자는 폭 318, 메시지도 그보다 별로 작지
// 않다.
//
// 하한은 장식이 아니다. 없을 때 16x16짜리 창을 집어다가 대화창 위로 옮기고
// 영구히 맨 앞에 올렸다. 그런 창이 여럿 있는데 무엇을 위한 것인지 여기서는
// 모른다. 무엇이든 간에 위치를 정해줄 대상은 아니다. _placeOverlay를
// 보라.
export const OVERLAY_MAX_WIDTH = 200;
export const OVERLAY_MIN_WIDTH = 40;
export const OVERLAY_MIN_HEIGHT = 20;

/**
 * 이 창이 무엇인가.
 *
 * 돌려주는 값:
 *   tray     Wine이 띄우는 트레이 창. explorer.exe의 것
 *   shadow   알림의 그림자. 미끄러지는 프레임마다 다시 만들어진다
 *   band     알림이 남기는 빈 띠. 제목이 목록 창과 똑같다
 *   overlay  앱이 자기 창 위에 그리는 것. 스크롤할 때 뜨는 날짜 같은
 *   piece    알림의 나머지 조각. 메시지와 답장 입력칸이 여기 있다
 *   list     목록 창
 *   chat     대화방 창
 *   unknown  우리 것인데 위 어디에도 안 맞음
 *   foreign  우리 것이 아님
 *
 * @param {object} window 창. Meta.Window이거나 같은 질문에 답하는 것
 * @param {Set<number>|null} pids 앱이 쓰는 pid들
 * @returns {string}
 */
export function classify(window, pids) {
    // pid를 묻지 않는다. 이 검사는 창이 만들어지는 시점에도 돌고, 그때는
    // 아직 pid를 배우기 전일 수 있다. 클래스만으로 충분하다. Wine의
    // explorer는 이 프리픽스에 하나뿐이다.
    if (window.get_wm_class() === 'explorer.exe')
        return 'tray';
    if (window.get_wm_class() !== 'kakaotalk.exe')
        return 'foreign';
    if (!pids?.has(window.get_pid()))
        return 'foreign';

    const title = window.get_title();
    const rect = window.get_frame_rect();
    const small = rect.height < MAIN_MIN_HEIGHT;

    if (title === POPUP_TITLE)
        return 'shadow';
    if (title === '카카오톡')
        return small ? 'band' : 'list';
    if (title === '') {
        if (rect.width >= OVERLAY_MIN_WIDTH && rect.width < OVERLAY_MAX_WIDTH &&
            rect.height >= OVERLAY_MIN_HEIGHT && small)
            return 'overlay';
        return small ? 'piece' : 'unknown';
    }
    return small ? 'piece' : 'chat';
}
