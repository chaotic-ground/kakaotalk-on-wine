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

## 0007 창이 스스로 앞으로 나오기

알림을 눌러도 대화창이 뒤에 그대로 있었습니다. 앱은 요청하고 있습니다.
받는 쪽이 없었습니다.

드라이버 인터페이스에는 `pActivateWindow`가 있고, X11 드라이버는 거기서
`_NET_ACTIVE_WINDOW`를 보냅니다. winewayland는 이 함수를 아예 구현하지
않습니다. 그래서 `SetForegroundWindow`는 Wine 안에서 포커스만 옮기고
컴포지터에게는 아무 말도 하지 않습니다.

Wayland에서 같은 일을 하는 것이 xdg-activation입니다. 컴포지터에서 토큰을
받고, 토큰을 가진 쪽이 표면을 올립니다. 토큰을 요청할 때 마지막 입력
시리얼과 seat을 붙이는데, 이 요청이 사용자가 한 일을 따라온 것이라고
컴포지터에게 말하는 것이 그것입니다. Wine은 시리얼을
`process_wayland.input_serial`에 이미 들고 있습니다.

**요청을 아무 때나 보내면 안 됩니다.** 윈도우는 배경 프로세스가
포그라운드를 가져가게 두지 않고, 조건 중 하나가 "마지막 입력 이벤트를
받은 프로세스"입니다. 그 조건이 없으면 알림이 올 때마다 창이 앞으로
튀어나옵니다. 카카오톡은 알림마다 자기 목록 창을 앞으로 내달라고 하는데,
그건 사용자가 한 일이 아닙니다.

그래서 진짜 입력이 온 시각을 들고 있다가, 그 뒤 2초 안의 요청만
내보냅니다. 알림을 눌렀을 때는 그 클릭이 우리 표면에 떨어지므로
통과합니다. 시리얼로는 할 수 없습니다. 시리얼은 컴포지터가 매기는 번호일
뿐이라 얼마나 오래됐는지 말해주지 않습니다.

포커스가 들고 나는 것은 입력이 아니므로 `enter`와 `leave`에서는 시각을
올리지 않습니다. 키와 포인터 버튼만입니다.

화면 없는 mutter에서 확인했습니다. 가상 키보드를 18초 동안 두드리는
동안에는 요청이 나가고, 멈춘 뒤로는 전부 막힙니다.

```
(두드리는 중)  WAYLAND_ActivateWindow → get_activation_token
(멈춘 뒤)      last input was 3911 ms ago, not asking
```

**Wine은 컴포지터가 키보드를 가져가도 자기 포그라운드 창을 그대로
둡니다.** `keyboard_handle_leave`에 업스트림이 적어둔 FIXME가 그것입니다.
그래서 이미 포그라운드인 창에 `SetForegroundWindow`를 부르면 아무 일도
일어나지 않고, `pActivateWindow`까지 오지 않습니다. 알림을 누르는 경우는
팝업에서 대화창으로 가는 진짜 변경이라 닿습니다.

**토큰은 왕복 하나만큼 늦게 옵니다.** 그 사이에 포그라운드가 바뀌어
있을 수 있고, 낡은 토큰으로 표면을 올리면 컴포지터의 포커스를 이미
지나간 창으로 끌고 갑니다. 트레이 메뉴가 그렇게 죽었습니다. 메뉴는
`track_menu`가 `set_capture_window`로 캡처를 잡고 도는데, 포커스가
옮겨가면 그 캡처가 풀리고 루프가 끝납니다. 토큰이 루프보다 먼저 오면
멀쩡하고 늦게 오면 죽어서, 여섯 번에 한 번씩 안 떴습니다.

그래서 요청을 하나만 살려두고, 토큰이 왔을 때 그 창이 아직 포그라운드가
아니면 버립니다. X11 드라이버에는 이 창이 없습니다. 왕복 없이
`_NET_ACTIVE_WINDOW`를 그 자리에서 보냅니다. 다만 거기도 이미 요청한
창에는 다시 요청하지 않습니다.

프로토콜 xml은 wayland-protocols에서 가져와 패치에 들어 있습니다.

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

## 0008 입력기를 바꾼 뒤 한글이 안 들어감

드보락으로 입력창을 쓰다가 글벗(ibus 한글 입력기)으로 바꾸면 한글이
안 들어갔습니다. 다른 곳을 클릭했다가 입력창을 다시 누르면 그제야
됐습니다.

Wayland 단은 멀쩡했습니다. 추적에 조합이 그대로 찍힙니다.

```
text_input_preedit_string text "\xe3\x85\x87"   (ㅇ)
post_ime_update comp_str L"\3147"
```

막힌 곳은 키보드 그룹이었습니다. 한 번의 재현에서 이렇게 나옵니다.

```
keyboard_handle_keymap       4     전환마다 온다
keyboard_handle_modifiers    1     그룹을 고쳐줄 유일한 길
activate_keyboard_hkl        2     둘 다 text_input_enter에 붙음
```

`keyboard_handle_keymap`은 끝에서 `set_current_xkb_group(0)`을 부릅니다.
새로 만든 `xkb_state`가 그룹 0이니 그 자체는 맞습니다. 올바른 그룹은
뒤따르는 `modifiers`가 알려줍니다.

그런데 `keyboard_handle_modifiers`가 그 전에 돌아가고 있었습니다.

```c
if (!wayland_keyboard_get_focused_hwnd()) return;
```

그룹은 창의 속성이 아니라 seat의 속성입니다. 우리 창이 키보드를 들고
있지 않은 사이에 온 그룹 변경이 버려지고, 남는 것은 키맵이 리셋한 0
입니다. 입력 소스를 바꿀 때마다 키맵이 오므로 그 창이 늘 열려 있습니다.

다시 클릭하면 되는 이유도 같은 자리입니다. 그건 포커스 변경이고,
`text_input_enter`가 여기서 정한 값으로 레이아웃을 세웁니다.

포커스가 무엇이든 그룹은 따라가고, 알려줄 창이 있을 때만 알려주게
했습니다. 나중에 포커스를 얻는 창은 그때 듣습니다.


## 0009 조합이 자기 UI 창 때문에 취소됨

0008과 같은 증상을 쫓다가 나온 것입니다. 조합이 오는 족족 취소되고
있었습니다.

```
preedit "ㅇ" → post_ime_update
text_input_leave                  ← 조합 취소
text_input_enter hwnd 0x1e00dc    ← IME UI 창이 포커스를 가져감
text_input_leave
text_input_enter hwnd 0x700e8     ← 돌아옴
```

`0x1e00dc`는 Wine 자신의 IME UI 창입니다. imm32가 `CreateWindowExW(
WS_EX_TOOLWINDOW, ..., 0, 0, 1, 1)`로 만듭니다. 1x1입니다.

그 창이 **0005 때문에** 독립 toplevel을 받고 있었습니다. 0005는 주인이
화면에 없는 owned 창에 자기 표면을 주는데, 트레이 메뉴를 보이게 하려던
것이었습니다. IME UI 창도 그 조건에 맞아서 toplevel이 되고, 컴포지터가
거기 포커스를 주고, 앱이 조합하던 text input에 `leave`가 가서 글자가
죽습니다. 입력기가 만든 글자를 그 입력기의 UI 창이 지우는 셈입니다.

그릴 것이 있는 창만 올립니다. toplevel은 컴포지터에게 키보드를
달라는 것이고, 넓이가 없는 창은 그걸로 읽을 것이 없습니다.

**이것으로도 신고된 증상은 안 고쳐집니다.** 포커스 튀는 것은 추적에서
사라졌지만 한글은 여전히 안 들어갑니다. 고친 것은 진짜 결함이고,
증상의 원인은 아직 모릅니다.


## 화면을 안 뺏고 시험하기

포커스와 창 올리기를 건드리는 변경은 시험할 때마다 쓰던 화면을
가로챕니다. mutter를 화면 없이 띄우고 그 안에서 돌리면 됩니다.

```sh
DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address)
export DBUS_SESSION_BUS_ADDRESS
mutter --headless --virtual-monitor 1280x800 --wayland-display=wayland-test &
WAYLAND_DISPLAY=wayland-test WINEPREFIX=/tmp/tp wine <program>
```

그대로 두면 `wl_seat.capabilities(0)`입니다. 입력 장치가 없어서 키보드
포커스 이벤트가 아예 안 오고, 포커스가 걸린 문제는 재현되지 않습니다.
mutter는 RemoteDesktop 세션에 실제로 키가 들어와야 가상 장치를 만듭니다.
세션은 만든 D-Bus 연결과 함께 살기 때문에 `gdbus call` 한 줄로는 안 되고,
연결을 붙들고 있는 프로그램이 필요합니다.

1. `org.gnome.Mutter.RemoteDesktop.CreateSession`
2. 그 세션에 `Start`
3. `NotifyKeyboardKeycode(42, true)` 와 `(42, false)`

그러면 `capabilities(2)`가 되고 `wl_keyboard.enter`가 옵니다.

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
