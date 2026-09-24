# kakaotalk-on-wine

GNOME Wayland에서 한국어 카카오톡. 패치한 Wine을 담은 flatpak 하나와,
Wayland가 부족한 부분을 메우는 GNOME 확장 하나로 이루어집니다.

## 설치

```sh
curl -fLO https://github.com/chaotic-ground/kakaotalk-on-wine/releases/latest/download/kakaotalk.flatpak
flatpak install --user kakaotalk.flatpak
```

카카오톡 자체는 들어있지 않습니다. 카카오의 것이라 배포할 수 없어서, 런처가
첫 실행 때 설치 파일을 받아옵니다.

확장은 손으로 깔아야 합니다. 샌드박스 안의 앱은
`~/.local/share/gnome-shell/extensions`에 아무것도 넣을 수 없습니다.

```sh
git clone https://github.com/chaotic-ground/kakaotalk-on-wine
cp -r kakaotalk-on-wine/gnome/kakaotalk-popup@lens0021 \
  ~/.local/share/gnome-shell/extensions/
gnome-extensions enable kakaotalk-popup@lens0021
```

확장을 먼저 깔아도 됩니다. 인디케이터가 flatpak 설치를 권합니다.

Fedora 43, GNOME 49 Wayland, 패치한 Wine 11.18, 카카오톡 26.8(64비트)에서
확인했습니다.

64비트 클라이언트를 씁니다. 카카오는 윈도우용을 셋 배포하는데, 검색으로
나오는 `app-pc.kakaocdn.net/talk/win32/`는 32비트입니다.

## 되는 것과 안 되는 것

| | |
|---|---|
| 한국어 UI, 메뉴, 툴팁, 대화상자 | 됨 |
| 인디케이터로 창 불러오기 | 됨, 확장 |
| 인디케이터 우클릭으로 카카오톡 메뉴 | 됨, **패치한 Wine**(0005) |
| 앱 아이콘 우클릭의 다시 시작·종료 | 됨 |
| Alt-Tab 아이콘과 이름 | 됨 |
| 새 메시지 팝업 위치와 겹침 | 됨, 확장 |
| 팝업이 포커스를 안 뺏음 | 됨, 확장 |
| 알림이 남기는 유령 창 | 숨김, 확장 |
| 스크롤할 때 뜨는 날짜 | 위치 조정, 확장 |
| 두 손가락 스크롤 | 됨, **패치한 Wine**(0002) |
| 이모지 | 됨, **패치한 Wine**(0001). 흑백입니다 |
| 이미지·스크린샷 붙여넣기 | 됨, **패치한 Wine**(0003, 0006) |
| QWERTY가 아닌 자판의 단축키 | 됨, **패치한 Wine**(0004) |
| 창이 스스로 앞으로 나오기 | **안 됨** |

**유령 창**은 알림이 올 때마다 하나씩 남는 107x29짜리 창입니다. 제목이
진짜 창과 똑같은 "카카오톡"인데 아무것도 담고 있지 않고 클릭도 받지
않습니다. 제목만 보고 창을 찾으면 이걸 찾게 되어서, 한동안 인디케이터가
그 유령을 활성화하는 데 클릭을 쓰고 있었습니다. 지금은 높이로 가려내고
아예 숨깁니다.

**창이 스스로 앞으로 나오기**가 안 되는 것은, Wayland에서 클라이언트가
자기 창을 올릴 수 없고 winewayland에 xdg-activation이 없어서입니다.
컴포지터만 할 수 있고, 그게 인디케이터가 하는 일입니다. 다만 숨어 있던
창이 나오는 경우는 됩니다. 그건 map이고 새로 map된 창은 보입니다. 안 되는
것은 이미 떠 있는 창이 뒤에서 앞으로 나오는 경우입니다.

각 패치가 무엇을 고치는지는 `patches/README.md`에 있습니다. 나머지는
그것을 다루는 코드의 주석에 적어두었습니다.

## 알아둘 것

**Bitdefender 같은 백신이 Wine을 먹습니다.** 직접 빌드한 Wine을 `$HOME`
아래에 두면 PE 모듈이 격리됩니다. 92개가 사라진 적이 있고, 증상은 없는
파일이 아니라 엉뚱한 Wine 오류입니다.

```
wine: Call from ... to unimplemented function user32.dll.CreateDialogParamW
```

`WINEDEBUG=+loaddll`을 켜면 한 줄 위에 진짜 이유가 있습니다. flatpak 안의
Wine은 읽기 전용이라 안전하고, 프리픽스는 `~/.var/app` 아래라 그렇지
않습니다.

**실행 중인 앱에 두 번째 `flatpak run`을 하면 앱이 죽습니다.** 두 번째
클라이언트 얘기가 아닙니다. 다른 프로세스를 들여다보는 wine 프로세스면
무엇이든 그렇습니다. `wine tasklist` 하나로 5초 안에 클라이언트와
explorer가 사라집니다. 인스턴스마다 PID 네임스페이스가 따로라서입니다.

그래서 `--show`나 `--quit`은 `~/.var/app` 아래 파일에 단어를 쓰고, 앱을
들고 있는 인스턴스가 읽습니다. `flatpak/kakaotalk`의 `serve_control`을
보세요.

**GNOME은 다음 로그인까지 모릅니다.** 새 확장 디렉터리도, desktop 파일의
새 액션도, 확장의 이름과 설명도 그렇습니다. Wayland 세션은 셸을 다시
시작할 수 없습니다. 그래서 확장 디렉터리 이름은 그대로 두고, 로더와
`impl.js`로 나눠서 로더가 캐시 무력화 질의로 다시 import합니다. 코드
수정은 disable/enable로 끝납니다.

## 구성

- `flatpak/`: 매니페스트와 그 안의 런처.
  `io.github.chaotic_ground.KakaoTalk.yml`은 모든 것을 URL과 체크섬으로
  가져와서 이 체크아웃 없이도 빌드됩니다. CI가 이걸 씁니다.
  `local-manifest.yml`은 같은 것을 로컬 경로로 읽습니다.
  `kakaoshow.c`는 실행 중인 카카오톡에 창을 띄우라고 요청합니다.
  `extract-icon.py`는 설치된 클라이언트에서 아이콘을 꺼냅니다.
- `gnome/kakaotalk-popup@lens0021/`: "KakaoTalk on Wayland" 확장. 팝업
  위치와 포커스, 트레이 대신하는 인디케이터, 카카오톡 메뉴 열기, flatpak
  설치 안내.
- `patches/`: Wine 패치 여섯 개와 빌드 방법.
- `bin/kakaotalk-restart`: 샌드박스 밖에서 시작·종료·재시작. 안에서 할 수
  없는 일은 "고집부리기"입니다. 인스턴스마다 PID 네임스페이스가 따로라
  안에서는 밖의 클라이언트에 신호를 못 보냅니다.
- `bin/kakaotalk-install`: 번들을 받아 설치합니다. 인디케이터가 부릅니다.
- `bin/kakaotalk-trace`: `WINEDEBUG=+msg`로 실행하고 마지막 부분만 링
  버퍼에 남깁니다.
- `bin/kakaotalk-hang-report`: 스레드 상태와 백트레이스. 심볼이 없으니
  주소를 모듈+오프셋으로 풉니다. `winedbg`가 아니라 `eu-stack`인 이유는,
  winedbg가 물어본 프로세스를 죽였기 때문입니다.
- `bin/wayland-screenshot`: 데스크톱 포털로 캡처. 창이 XWayland가 아니라
  다른 도구로는 안 보일 때.
- `config/kakaotalk-korean.reg`: UI 언어와 라틴 글꼴 치환. 클라이언트를
  설치하기 **전에** 들어가야 합니다. 카카오톡은 UI 언어를 한 번만 읽습니다.
- `config/kakaotalk-popup.json`: 확장 규칙.

## 라이선스

GPL-3.0-or-later. GNOME Shell이 GPL-2.0-or-later이고, 그 안에서 도는 것은
호환되어야 합니다.
