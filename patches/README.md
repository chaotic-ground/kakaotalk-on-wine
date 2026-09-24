# 패치

업스트림 Wine에 없는 변경들. 배포되는 Wine에는 이미 들어있으니, flatpak을
설치하면 따로 할 일은 없습니다. 여기는 패치를 고칠 때 보는 곳입니다.

## 0001 이모지가 한 글자로 그려짐

U+FFFF 위에 사는 것은 여기서 이모지뿐입니다. 세 가지가 한꺼번에 틀려
있었고, 자세한 것은 패치의 커밋 메시지에 있습니다.

업스트림은 셋 중 첫 번째만 알고 있습니다.
[bug 53929](https://bugs.winehq.org/show_bug.cgi?id=53929), 2022년부터
열려 있습니다.

컬러 이모지는 여전히 흑백입니다. `win32u`의 텍스트 경로에 컬러 글리프
지원이 아예 없습니다. `FT_LOAD_COLOR`도 CBDT도 COLR도 없고, 글리프는 현재
텍스트 색으로 칠해지는 커버리지 마스크로 DIB 드라이버에 도착합니다. 자기
색을 들고 오는 글리프가 지나갈 통로가 없습니다.

## 0002 터치패드 스크롤

휠 마우스는 되는데 두 손가락은 아무 일도 없었습니다. Wine이
`wl_pointer.axis_value120`(휠의 이벤트)만 처리하고 `wl_pointer.axis`는 빈
함수로 두었기 때문입니다. 터치패드에는 눈금이 없어서 거리만 보냅니다.

업스트림: [56043](https://bugs.winehq.org/show_bug.cgi?id=56043),
[57709](https://bugs.winehq.org/show_bug.cgi?id=57709). 둘 다 열려 있고
UNCONFIRMED입니다.

## 0003 이미지 붙여넣기

컴포지터가 내놓는 것은 mime 타입이고 윈도우 앱이 찾는 것은 `CF_DIB`인데,
Wayland 드라이버의 클립보드 표에 `CF_DIB` 항목이 아예 없었습니다.
`image/png`·`image/jpeg`·`image/gif`는 "PNG"·"JFIF"·"GIF"라는 이름의 등록
포맷으로 넘어가고, 그 이름을 찾는 앱은 없습니다.

X11 드라이버는 `image/bmp` → `CF_DIB`을 오래전부터 갖고 있었습니다. 그걸
옮겨 심었습니다. Firefox와 GTK가 `image/png` 옆에 `image/bmp`도 같이
내놓기 때문에 항목 하나로 충분합니다. 다른 출처를 가정하기 전에
`wl-paste --list-types`로 확인하세요.

`image/png`은 디코더가 필요해서 0006에서 다룹니다.

## 0004 키보드 레이아웃이 키보드의 것

드보락에서 모든 단축키가 QWERTY 자리에 있었습니다. Ctrl+V가 v를 치는
키가 아니라 각인이 V인 키에서 동작했습니다. 스캔코드는 제대로 도착하고
드라이버의 드보락 표도 맞습니다. 그 표가 안 쓰였습니다.

`WAYLAND_KbdLayerDescriptor`는 HKL을 다시 만들어 비교하는 식으로 레이아웃을
찾고, `get_layout_hkl`은 상위 워드에 레이아웃의 언어를 넣습니다. 묻는 쪽은
스캔코드를 VK로 바꾸는 키보드 이벤트 스레드인데, 이 스레드는 레이아웃이
활성화된 적이 없습니다. 활성화는 포커스된 창에 보내는 메시지라 여기 오지
않습니다. 그래서 `NtUserGetKeyboardLayout`이 로캘로 지어낸
`MAKELONG(locale, locale)`을 건네고, 로캘이 레이아웃의 언어와 같지 않으면
아무것도 일치하지 않습니다. 못 찾으면 NULL이고, win32u는 내장 표로
답합니다. QWERTY입니다.

QWERTY 사용자에게는 그 잘못된 폴백이 우연히 맞습니다. 그래서 아무도
신고하지 않았습니다. 이 패키지는 프리픽스 로캘이 한국어라 모두에게 어긋나
있습니다.

`WINEDEBUG=+keyboard`를 켜면 한 줄로 드러납니다.

```
warn:keyboard:WAYLAND_KbdLayerDescriptor Failed to find Xkb layout for HKL 0x4120412
```

`0412`는 한국어이고, 어느 레이아웃도 상위 워드에 그걸 갖고 있지 않습니다.

## 0005 숨겨진 창이 주인인 창도 보이게

트레이 메뉴가 아예 안 떴습니다. 엉뚱한 자리도 뒤도 아니고 어디에도
없었습니다.

`wayland_win_data_create_wayland_surface`는 주인이 있는 창에 주인 표면의
**서브서피스**를 줍니다. 화면에 없는 주인의 표면에는 역할이 없고,
드라이버는 빈 xdg_toplevel로 컴포지터를 채우지 않으려고 일부러 그렇게
둡니다. 지도에 없는 표면의 서브서피스는 어디에도 그려지지 않습니다.

주인이 실제로 화면에 있을 때만 서브서피스로 붙이고, 아니면 자기 표면을
주도록 했습니다. 주인이 없는 창은 원래 그렇게 하고 있었습니다.

화면이 아니라 Win32에 물어서 찾았습니다. 메뉴 창은 존재하고 `visible=1`,
크기 124x141, 위치도 멀쩡한데, 주인이 0x0에 `visible=0`인
`EVA_Window_Dblclk`였습니다.

## 0006 클립보드의 PNG 디코딩

0003은 Firefox와 GTK가 내놓는 것을 다루고, GNOME 스크린샷은 다루지
못합니다. 그쪽은 `image/png` 하나만 내놓습니다.

디코딩을 드라이버에서 하는 이유는 더 나은 자리가 없기 때문입니다.
`CF_DIB`을 `CF_BITMAP`으로 바꾸는 포맷 합성은 **서버**에 있고 내장 포맷
ID만 압니다. "PNG"는 실행 중에 등록되는 포맷이라 거기 들어갈 수 없습니다.

알아둘 결정 셋:

- **알파는 흰색 위에 합성합니다.** DIB에는 합의된 알파 채널이 없습니다.
  32비트의 최상위 바이트는 예약이고 앱마다 해석이 다릅니다. 모서리가
  둥근 스크린샷이 검은 배경에 붙으면 망가져 보이는데, 그걸 클립보드 탓이라
  짐작하기 어렵습니다.
- **`image/png`이 `CF_DIB`이 됩니다.** 전에는 "PNG"라는 등록 포맷이었고,
  그 이름을 찾는 것은 없습니다.
- **인코더는 없습니다.** 필요도 없습니다. 클립보드 포맷 하나는 표에서 처음
  만나는 mime 하나로만 나가고, `CF_DIB`에게 그건 `image/bmp`입니다.

`-lpng16`을 `Makefile.in`에 직접 박았습니다. 업스트림 판이라면 그러지
않을 것입니다. Wine의 configure는 PE 쪽 libpng(`PNG_PE_LIBS`)만 찾으므로
유닉스 쪽 검사를 먼저 추가해야 합니다.

## 빌드

호스트에 빌드 의존성을 남기지 않으려고 컨테이너에서 합니다. 14스레드에서
40분쯤 걸립니다.

클라이언트는 64비트지만 두 아키텍처를 다 빌드합니다. 카카오가 32비트 NSIS
설치 파일 안에 넣어 배포해서, 32비트 쪽이 없는 Wine은 "failed to load
syswow64\ntdll.dll"에서 멈춥니다. 새 WoW64는 32비트 PE 컴파일러를 필요로
하고 32비트 호스트 라이브러리는 필요로 하지 않습니다. mingw32만 있고 다른
것은 없는 이유입니다.

```sh
toolbox create -y --container wine-build
toolbox run -c wine-build sudo dnf builddep -y wine
toolbox run -c wine-build sudo dnf install -y mingw32-gcc mingw64-gcc
# 0006이 Wayland 드라이버를 시스템 libpng에 겁니다.
toolbox run -c wine-build sudo dnf install -y libpng-devel

curl -fsSLO https://dl.winehq.org/wine/source/11.x/wine-11.18.tar.xz
tar -xf wine-11.18.tar.xz
( cd wine-11.18 && git init -q . && git apply /path/to/patches/000*.patch )

toolbox run -c wine-build sh -c '
  cd wine-11.18 && mkdir -p build && cd build &&
  ../configure --enable-archs=i386,x86_64 --prefix=$HOME/wine-emoji &&
  make -j$(nproc) && make install'
```

그 임시 git 저장소에 커밋해서 패치를 만들 생각이라면 빌드 디렉터리를
빼세요. 빌드 후 `git add -A`는 오브젝트 파일 3GB를 담고, `format-patch`는
5만 줄을 돌려줍니다.

패키징 전에 strip합니다. 안 하면 1.7GB, 하면 379MB입니다. PE 모듈은
`x86_64-w64-mingw32-strip`과 `i686-w64-mingw32-strip`, 나머지는 그냥
`strip`입니다.

그 다음 `include/`와 `lib/wine/*/*.a`를 버립니다. import 라이브러리와
헤더는 Wine으로 빌드할 때 쓰는 것이지 실행할 때 쓰는 것이 아닙니다.
strip 후 499MB와 배포되는 379MB의 차이가 이것입니다. 이 문단을 믿지 말고
이미 올라간 tarball과 파일 목록을 비교하세요.

```sh
diff <(tar -tf old.tar.xz | sed 's#/$##' | sort) <(find wine-11.18-emoji | sort)
```

tarball을 `flatpak/wine-11.18-emoji-wow64-x86_64.tar.xz`에 두고
`local-manifest.yml`로 빌드하면 됩니다. 추적되는 매니페스트는 배포된 것을
URL과 체크섬으로 읽습니다.

앱을 먼저 끄세요. 돌고 있는 프리픽스 밑에서 Wine을 바꾸면 좀비가 남고 앱도
같이 갑니다.

**빌드한 것이 도는 것인지 확인하세요.** flatpak-builder는 모듈을 캐시하고
아무 말 없이 재사용합니다. 두 가지 경우가 있습니다. 매니페스트를 다른
디렉터리로 옮기면 상대 `path:` 원본을 못 찾고, `path:` tarball을 제자리에서
바꿔도 캐시가 무효화되지 않습니다. 체크섬이 바뀐 Wine을 새로 만들어도
`Cache hit for wine, skipping build`가 나옵니다. `--force-clean`은 빌드
디렉터리를 지울 뿐 캐시는 건드리지 않습니다. 두 경우 다 빌드는 조용히
성공하고 내용은 옛것입니다.

```sh
sha256sum ~/wine-emoji/lib/wine/x86_64-unix/winewayland.so
sha256sum "$(find ~/.local/share/flatpak/app/io.github.chaotic_ground.KakaoTalk \
  -name winewayland.so)"
```

`--disable-cache`를 쓰면 전체 재빌드를 대가로 이 문제가 없어집니다.

**여기서 빌드한 Wine은 `$HOME` 아래 있고, 백신이 닿는 자리입니다.**
flatpak 안으로 들어가면 읽기 전용이라 안전합니다. 만든 직후 92개 파일이
사라지면 그 일이 일어난 것입니다.

## 테스트

`emojitest.c`는 글꼴에 문자를 하나 물어보고 돌아온 아웃라인의 크기를
찍습니다. 창을 들여다보는 대신 숫자로 답이 나옵니다. 글리프가 없으면
notdef 상자라서 작고, 있으면 그렇지 않습니다.

```sh
x86_64-w64-mingw32-gcc -o emojitest.exe emojitest.c -lgdi32
cp emojitest.exe <prefix>/drive_c/
wine C:\\emojitest.exe
```

패치 전과 후:

```
malgun astral  U+1F33E  outline=188 bytes   box=22x26
malgun astral  U+1F33E  outline=3144 bytes  box=37x33
```

이모지 글꼴을 직접 고르든 폰트 링크로 닿든 같은 3144가 나와야 합니다.
글리프가 그냥 존재하는 것과 링크가 동작하는 것을 그렇게 구별합니다.
