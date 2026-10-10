# 패치

업스트림 Wine에 없는 변경들. 배포되는 Wine에는 이미 들어있으니, flatpak을
설치하면 따로 할 일은 없습니다. 여기는 패치를 고칠 때 보는 곳입니다.

각 패치가 무엇을 왜 고치는지는 사이트에 있습니다.
<https://chaotic-ground.github.io/kakaotalk-on-wine/#고친_것>에 표가 있고,
`패치/0001`부터 `패치/0012`까지 한 쪽씩입니다. 원본은 `site/패치/`이고
표는 거기서 자동으로 만들어집니다. 패치를 더하면 쪽을 하나 쓰세요. 표는
건드리지 않아도 됩니다.

영어로 된 같은 이야기가 각 `.patch`의 커밋 메시지에 있습니다. 그쪽이
업스트림에 보낼 수 있는 형태이고, 사이트 쪽은 어떻게 찾았는지와 무엇을
조심해야 하는지입니다.

## 빌드

`.github/workflows/wine.yml`이 합니다. `patches/`를 건드려 main에 올리면
돌고, 나온 tarball이 `wine-dnf`와 `wine-apt` 아티팩트로 붙습니다. 러너는
코어가 적어 두어 시간 걸립니다.

Fedora와 우분투 양쪽에서 짓습니다. configure는 없는 라이브러리를 보고
멈추지 않고 그 기능이 빠진 Wine을 지을 뿐이라, 한쪽 배포판의 기본값에
기대고 있으면 빌드는 조용히 끝나고 쓰다가 드러납니다. 배포되는 것은
Fedora 쪽입니다. 개발하는 기계가 그것이고 지금까지 올라간 것도 그렇게
지어졌습니다.

두 쪽이 똑같이 나오지는 않습니다. 2026년 10월 기준으로 우분투 쪽에는
`capi2032`가 더 있고 `sane.ds`가 없습니다. 배포판이 기본으로 들고 있는
개발 패키지가 달라서입니다. 카카오톡에는 둘 다 쓰이지 않습니다. 자산
비교 단계가 이 목록 차이를 찍어 주므로, 거기 다른 이름이 뜨면 그게
무엇인지는 보고 넘어가세요.

릴리스 자산까지 바꾸려면 workflow_dispatch로 `publish`를 켜고 돌리세요.
그 다음 매니페스트의 sha256을 요약에 적힌 값으로 고쳐야 설치되는 것이
바뀝니다. 자산과 체크섬은 같이 가야 합니다.

아래는 손으로 할 때의 같은 절차입니다. 패치를 고치면서 반복할 때 씁니다.
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

데비안 계열이면 의존성만 다르고 나머지는 같습니다. `deb-src`를 켜야
`build-dep`이 돕니다.

```sh
sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/ubuntu.sources
apt-get update
apt-get build-dep -y wine
apt-get install -y gcc-mingw-w64-i686 gcc-mingw-w64-x86-64 libpng-dev
```

어느 쪽이든 configure가 끝나면 로그에서 `not found`를 한 번 보세요.
wayland, xkbcommon, png, freetype, fontconfig, gnutls, vulkan 중 하나라도
거기 있으면 그 기능이 빠진 채로 빌드가 성공합니다. 워크플로는 그 줄을
보고 떨어집니다.

그 임시 git 저장소에 커밋해서 패치를 만들 생각이라면 빌드 디렉터리를
빼세요. 빌드 후 `git add -A`는 오브젝트 파일 3GB를 담고, `format-patch`는
5만 줄을 돌려줍니다.

## 패키징

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

### 빌드한 것이 도는 것인지 확인하기

flatpak-builder는 모듈을 캐시하고 아무 말 없이 재사용합니다. 매니페스트를
다른 디렉터리로 옮기면 상대 `path:` 원본을 못 찾고, `path:` tarball을
제자리에서 바꿔도 캐시가 무효화되지 않습니다. 체크섬이 바뀐 Wine을 새로
만들어도 `Cache hit for wine, skipping build`가 나오는데, `--force-clean`은
빌드 디렉터리를 지울 뿐 캐시는 건드리지 않습니다. 어느 쪽이든 빌드는
조용히 성공하고 내용은 옛것입니다.

```sh
sha256sum ~/wine-emoji/lib/wine/x86_64-unix/winewayland.so
sha256sum "$(find ~/.local/share/flatpak/app/io.github.chaotic_ground.KakaoTalk \
  -name winewayland.so)"
```

`--disable-cache`를 쓰면 전체 재빌드를 대가로 이 문제가 없어집니다.

### 백신

여기서 빌드한 Wine은 `$HOME` 아래 있어 백신이 닿습니다. flatpak 안으로
들어가면 읽기 전용이 되어 그때부터는 안전하니, 위험한 것은 빌드한 직후부터
패키징할 때까지입니다. 증상은
[설치 문서](https://chaotic-ground.github.io/kakaotalk-on-wine/설치#백신이_Wine을_격리할_때)를
보세요.

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

## emojitest.c

0001이 제대로 들어갔는지 숫자로 확인합니다. 쓰는 법과 기대하는 값은
사이트의 `패치/0001`에 있습니다.
