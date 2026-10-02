# kakaotalk-on-wine

GNOME Wayland에서 한국어 카카오톡. 패치한 Wine을 담은 flatpak 하나와,
Wayland가 부족한 부분을 메우는 GNOME 확장 하나로 이루어집니다.

**쓰시려는 분은 <https://chaotic-ground.github.io/kakaotalk-on-wine/>를
보세요.** 무엇이 되는지, 어떻게 까는지, 안 될 때 무엇을 보는지가 거기
있습니다. 여기는 고치는 사람이 보는 곳입니다.

## 읽을 것

| | |
|---|---|
| [`patches/README.md`](patches/README.md) | Wine 패치를 빌드하고 패키징하고, 화면 안 뺏고 시험하는 법 |
| [`site/패치/`](site/%ED%8C%A8%EC%B9%98/) | 패치 열 개가 각각 무엇을 왜 고치는지. 한 쪽씩이고 첫 화면의 표는 여기서 만들어집니다 |
| [`gnome/README.md`](gnome/README.md) | 확장이 하는 일, 설정 형식, 창을 들여다보는 법 |
| [`site/`](site/) | 위 사이트의 원본. wikven으로 굽습니다. 표는 DPL4가 만듭니다 |

## 알아둘 것

**실행 중인 앱에 두 번째 `flatpak run`을 하면 앱이 죽습니다.** 두 번째
클라이언트 얘기가 아닙니다. 다른 프로세스를 들여다보는 wine 프로세스면
무엇이든 그렇습니다. `wine tasklist` 하나로 5초 안에 클라이언트와
explorer가 사라집니다. 인스턴스마다 PID 네임스페이스가 따로라서입니다.

그래서 `--show`나 `--quit`은 `~/.var/app` 아래 파일에 단어를 쓰고, 앱을
들고 있는 인스턴스가 읽습니다. `flatpak/kakaotalk`의 `serve_control`을
보세요.

**끄는 것은 클라이언트가 가는 것으로 끝나지 않습니다.** Wine은
`wineserver`와 `explorer.exe`를 남기고, bwrap은 샌드박스 안의 모든 것을
기다립니다. 그래서 런처가 나갈 때 세션을 끝냅니다. 그것을 안 하던 동안
죽은 인스턴스가 열 개까지 쌓였습니다.

**GNOME은 다음 로그인까지 모릅니다.** 새 확장 디렉터리도, desktop 파일의
새 액션도, 확장의 이름과 설명도 그렇습니다. Wayland 세션은 셸을 다시
시작할 수 없습니다. 그래서 확장 디렉터리 이름은 그대로 두고, 로더와
`impl.js`로 나눠서 로더가 캐시 무력화 질의로 다시 import합니다. 코드
수정은 disable/enable로 끝납니다.

**백신이 직접 빌드한 Wine을 먹습니다.** `$HOME` 아래에 두면 PE 모듈이
격리됩니다. 92개가 사라진 적이 있고, 증상은 없는 파일이 아니라 엉뚱한
Wine 오류입니다. `WINEDEBUG=+loaddll`을 켜면 한 줄 위에 진짜 이유가
있습니다.

## 구성

- `flatpak/`: 매니페스트와 그 안의 런처.
  `io.github.chaotic_ground.KakaoTalk.yml`은 모든 것을 URL과 체크섬으로
  가져와서 이 체크아웃 없이도 빌드됩니다. CI가 이걸 씁니다.
  `local-manifest.yml`은 같은 것을 로컬 경로로 읽습니다.
  `kakaoshow.c`는 실행 중인 카카오톡에 창을 띄우라고 요청합니다.
  `extract-icon.py`는 설치된 클라이언트에서 아이콘을 꺼냅니다.
- `gnome/kakaotalk-popup@lens0021/`: "KakaoTalk on Wayland" 확장.
  `classify.js`가 창을 무엇으로 볼지 정하고 `decide.js`가 인디케이터의
  판단을 정합니다. 둘 다 gi를 import하지 않아서 `test/`에서 부를 수
  있습니다.
- `patches/`: Wine 패치 열 개와 빌드 방법.
- `site/`: 사용자용 사이트의 위키텍스트 원본.
- `bin/kakaotalk-restart`: 샌드박스 밖에서 시작·종료·재시작. 안에서 할 수
  없는 일은 "고집부리기"입니다.
- `bin/kakaotalk-install`: 번들을 받아 설치합니다. 인디케이터가 부릅니다.
- `bin/kakaotalk-trace`: `WINEDEBUG`를 켜고 실행해 마지막 부분만 링
  버퍼에 남깁니다. 채널은 `KAKAOTALK_WINEDEBUG`로 줍니다.
- `bin/kakaotalk-hang-report`: 스레드 상태와 백트레이스. 심볼이 없으니
  주소를 모듈+오프셋으로 풉니다. `winedbg`가 아니라 `eu-stack`인 이유는,
  winedbg가 물어본 프로세스를 죽였기 때문입니다.
- `bin/wayland-screenshot`: 데스크톱 포털로 캡처. 창이 XWayland가 아니라
  다른 도구로는 안 보일 때.
- `config/kakaotalk-korean.reg`: UI 언어와 라틴 글꼴 치환. 클라이언트를
  설치하기 **전에** 들어가야 합니다. 카카오톡은 UI 언어를 한 번만 읽습니다.

## CI

| 워크플로 | |
|---|---|
| `lint.yml` | gjs 문법, 단위 시험, biome, shellcheck, ruff, yamllint, actionlint, 그리고 `.opengrep/rules.yml`의 불변식 |
| `e2e.yml` | 화면 없는 gnome-shell에 확장을 올리고 창이 실제로 화면에 남아 있는지 |
| `bundle.yml` | flatpak 번들을 지어 릴리스에 붙입니다 |
| `site.yml`, `site-preview.yml` | 사이트를 구워 gh-pages에 |

Wine은 CI에서 빌드하지 않습니다. 크로스 컴파일러가 필요한 40분짜리
작업이고 `patches/`가 바뀔 때만 바뀝니다. 손으로 빌드해 릴리스 자산으로
올리고, 매니페스트의 체크섬이 둘을 묶습니다. `patches/README.md`를 보세요.

## 라이선스

GPL-3.0-or-later. GNOME Shell이 GPL-2.0-or-later이고, 그 안에서 도는 것은
호환되어야 합니다.
