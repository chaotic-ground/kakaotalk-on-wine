# kakaotalk-popup

Wine의 Wayland 드라이버가 부족한 부분을 컴포지터 쪽에서 메우는 GNOME Shell 확장입니다.

Wayland는 클라이언트가 자기 창 위치를 정하게 두지 않습니다. 카카오톡의 팝업은
오른쪽 아래를 요청하지만 화면 가운데에 도착하고, Wine 안에서 무엇을 해도 그건
바뀌지 않습니다. 컴포지터는 할 수 있으니 여기서 놓습니다.

하는 일은 넷입니다.

- **새 메시지 팝업을 제자리에 놓고, 포커스를 뺏지 못하게 합니다.** 팝업에 답장
  입력칸이 있어서, 포커스가 넘어간 동안 친 글자는 사라지는 게 아니라 대화방에
  입력됩니다.
- **트레이를 대신합니다.** Wayland에 프로토콜이 없어서 Wine은 트레이를 떠 있는
  창으로 그립니다. 패널 인디케이터를 좌클릭하면 창이 돌아오고, 우클릭하면
  카카오톡 자신의 메뉴가 열립니다.
- **앱이 자기 창 위에 그리는 것들을 그 위로 돌려놓습니다.** 대화를 스크롤할 때
  뜨는 날짜 같은 것입니다.
- **아무것도 설치되어 있지 않으면 설치를 권합니다.** 확장은 샌드박스 안의 앱이
  자기를 놓을 수 없는 자리에 살기 때문에, 랜딩 포인트가 됩니다.

## 로더가 따로 있는 이유

GNOME Shell은 확장의 모듈을 한 번 import하고 계속 들고 있습니다. 껐다 켜는 것은
이미 갖고 있는 객체의 `disable()`과 `enable()`을 부를 뿐이고, D-Bus 인터페이스에도
다시 읽는 방법은 없습니다. Wayland 세션은 셸 자체를 다시 시작할 수 없으니, 그냥
두면 한 줄을 고칠 때마다 로그아웃해야 합니다.

그래서 절대 바뀌지 않는 `extension.js`가 로더로 남고, 일은 전부 `impl.js`에
있습니다. 로더가 `enable()`마다 질의 문자열을 붙여 동적 import를 하면 모듈 캐시를
비껴갑니다.

```sh
gnome-extensions disable kakaotalk-popup@lens0021
gnome-extensions enable kakaotalk-popup@lens0021
```

**질의 문자열은 `Date.now()`가 아니라 `impl.js`의 수정 시각입니다.** 시각을
지어내면 `enable()`마다 URL이 달라지는데, 캐시를 비껴간 모듈은 셸이 끝날 때까지
풀리지 않습니다. 화면을 잠갔다 풀 때마다 셸이 확장을 disable/enable하니 사본이
하루에 수십 벌씩 쌓입니다. 열흘 돌린 셸을 떠보니 170벌이었고, 모듈 수준의
`GObject.registerClass`가 그때마다 다시 돌아 해제되지 않는 GType도 170개 만들어
두었습니다. 수정 시각이면 파일이 그대로일 때 캐시된 모듈을 다시 씁니다.

**`classify.js`와 `decide.js`는 이 방법으로 다시 읽히지 않습니다.** `impl.js`가
그 둘을 `./classify.js`처럼 상대 경로로 가져오는데, 상대 경로는 가져오는 쪽의
질의 문자열을 물려받지 않아 언제나 같은 URL로 풀립니다. 그 둘만 고쳤다면 로그인을
다시 해야 합니다. 대신 둘 다 gi를 import하지 않아서 `test/`에서 gjs로 부를 수 있고,
고치는 동안에는 그쪽이 훨씬 빠릅니다.

`enable()`은 import를 기다릴 수 없어서 진짜 객체가 늦게 옵니다. `disable()`이 그
전에 불릴 수 있다는 것을 로더가 감당합니다.

## 설정

`~/.config/kakaotalk-popup.json`입니다. 바뀌면 다시 읽습니다. 단정함 때문이
아닙니다. Wayland 세션에는 셸이 확장의 코드를 다시 읽게 할 방법이 없어서,
`impl.js`를 고치면 로그아웃이 필요하고 설정을 고치면 공짜입니다.

```json
{
  "log": false,
  "rules": [
    {"type": [0, 12], "title": "KakaoTalkShadowWnd", "action": "bottom-right"}
  ]
}
```

규칙은 카카오톡 프로세스가 가진 창에 대해, 적어둔 모든 항목이 맞을 때
매칭됩니다.

| 키 | |
|---|---|
| `type` | `Meta.WindowType` |
| `title` | 정확히 일치 |
| `max_width`, `max_height` | 프레임의 상한 |
| `action` | `pointer`(왼쪽 위 모서리를 커서에), `bottom-right`(작업 영역의 모서리에), `none`(매칭하고 그대로 둠. 아래의 더 넓은 규칙이 가져가지 못하게) |
| `above` | `true`면 창을 위에 유지. 다만 전체화면 창 위에서는 아님 |

`12`가 `NOTIFICATION`이고 그 목록에 들어 있는 이유는, 이 확장이 팝업의 창을 그
타입으로 바꾸기 때문입니다. `_markNotification`을 보세요. `NORMAL`만 적은 규칙은
그 순간부터 매칭을 멈추고 위치 조정도 같이 멈춥니다.

나머지 키는 `impl.js`의 `DEFAULT_CONFIG`에 각각 왜 있는지와 함께 적혀 있습니다.

## 창이 어떻게 생겼는지 보려면

`"log": true`를 켜고 저널을 보세요.

```sh
journalctl --user -f -o cat -g 'kakaotalk-popup'
```

`KakaoTalkShadowWnd`라는 이름도 그렇게 알아냈습니다. 로그를 켜둔 채 메시지가
왔고 팝업이 자기 이름을 밝혔습니다. 폭 315에 미끄러지면서 높이가 늘었다 줄었다
했습니다.

크기만 보고 판단할 수는 없습니다. Firefox의 메뉴가 카카오톡 것과 같은
폭으로, 클래스도 제목도 없이 옵니다. 소유를 pid로 가리는 이유입니다.

로그의 `kind=`가 확장이 그 창을 무엇으로 봤는지입니다. `classify.js`가 그걸
정하고 `test/classify.test.js`가 기준을 고정합니다.

## 시험

```sh
gjs -m 'kakaotalk-popup@lens0021/test/classify.test.js'
```
