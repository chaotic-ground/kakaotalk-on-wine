#!/bin/bash
# 화면 없는 GNOME Shell에 확장을 올리고, 가짜 카카오톡 창이 실제로 화면에
# 남아 있는지 본다.
#
# 이것이 있는 이유는 단위 시험이 못 잡는 것이 있기 때문이다. classify가
# 창을 list라고 옳게 답해도, 그 뒤에 액터를 숨기면 화면에서는 사라진다.
# 실제로 그렇게 났다. 셸은 showing이라 하고 앱은 visible이라 하는데
# 아무것도 안 보였고, 인디케이터는 그 창을 올리고 있었다.
#
# 진짜 앱은 쓸 수 없다. 카카오 설치 파일을 받아야 하고 로그인이 필요하다.
# 확장이 창에 대해 보는 것은 wm_class와 제목과 크기뿐이라 가짜로 충분하다.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
readonly EXT=kakaotalk-popup@lens0021
readonly DISPLAY_NAME=wayland-e2e-$$
WORK=$(mktemp -d)
readonly WORK

# 떨어질 때 셸 로그를 찍는다. 이게 없으면 CI에서 고칠 수가 없다. 처음
# 올렸을 때 셸이 컨테이너에서 즉시 죽었는데, 이유를 적은 파일을 정리가
# 먼저 지웠다.
cleanup() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "--- gnome-shell 로그 ---" >&2
    cat "$WORK/shell.log" >&2 2>/dev/null || echo "(없음)" >&2
    echo "--- 가짜 앱 로그 ---" >&2
    cat "$WORK/fake.log" >&2 2>/dev/null || echo "(없음)" >&2
  fi
  [[ -n ${FAKE_PID:-} ]] && kill "$FAKE_PID" 2>/dev/null
  [[ -n ${SHELL_PID:-} ]] && kill "$SHELL_PID" 2>/dev/null
  [[ -n ${DBUS_PID:-} ]] && kill "$DBUS_PID" 2>/dev/null
  rm -rf "$WORK"
  return 0
}
trap cleanup EXIT

# 기다림마다 상한을 둔다. CI에서 영영 매달려 있는 것보다 떨어지는 쪽이 낫다.
wait_for() {
  local what=$1 seconds=$2 i
  shift 2
  for ((i = 0; i < seconds * 2; i++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "시간 초과: $what" >&2
  return 1
}

# 사용자의 세션을 건드리지 않는다. 자기 버스, 자기 XDG, 자기 wayland 소켓.
DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address --print-pid=3 3>"$WORK/dbus.pid")
export DBUS_SESSION_BUS_ADDRESS
DBUS_PID=$(cat "$WORK/dbus.pid")

export XDG_DATA_HOME="$WORK/share"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_STATE_HOME="$WORK/state"
export XDG_CACHE_HOME="$WORK/cache"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$WORK/run}"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME" \
  "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
cp -r "$HERE/../.." "$XDG_DATA_HOME/gnome-shell/extensions/$EXT"

# 로그를 켠다. 이 시험이 보는 것이 그 로그다.
printf '{"log": true}\n' > "$XDG_CONFIG_HOME/kakaotalk-popup.json"

# --no-x11이 없으면 컨테이너에서 셸이 즉시 죽는다. Xwayland가
# /tmp/.X11-unix에 소켓을 만들려 하는데 그 디렉터리가 쓸 수 없고,
# mutter는 그것을 치명적으로 본다. 이 시험에 X11은 필요 없다. 보는 것은
# Wayland 창 하나다.
gnome-shell --headless --no-x11 --virtual-monitor 1280x800 \
  --wayland-display="$DISPLAY_NAME" > "$WORK/shell.log" 2>&1 &
SHELL_PID=$!

wait_for "셸이 소켓을 여는 것" 90 test -S "$XDG_RUNTIME_DIR/$DISPLAY_NAME"
# 이름이 올라온 것과 쓸 수 있는 것은 다르다. introspect는 객체가 생기기
# 전에도 통과해서, 바로 다음 줄이 "Object does not exist"로 떨어졌다.
# 실제로 부를 메서드로 묻는다.
wait_for "셸이 확장 인터페이스를 여는 것" 180 \
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.ListExtensions

gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.EnableExtension "$EXT" >/dev/null
wait_for "확장이 켜지는 것" 30 grep -q 'kakaotalk-popup\] enabled' "$WORK/shell.log"

WAYLAND_DISPLAY="$DISPLAY_NAME" GDK_BACKEND=wayland DISPLAY='' \
  gjs -m "$HERE/fakeapp.js" '카카오톡' 392 562 > "$WORK/fake.log" 2>&1 &
FAKE_PID=$!

wait_for "가짜 창이 셸에 보이는 것" 60 grep -q 'kind=list' "$WORK/shell.log"

# 숨기는 쪽은 창이 뜬 직후가 아니라 제목이 붙은 뒤에 돈다. 그래서 바로
# 보지 않고 둔다. 버그가 있던 판에서는 이 사이에 사라졌다.
sleep 5

# 확장을 다시 읽히면 지금 있는 창을 전부 present:로 찍는다. 그게 이
# 시험이 읽는 것이다.
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.DisableExtension "$EXT" >/dev/null
sleep 1
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.EnableExtension "$EXT" >/dev/null
wait_for "다시 켜지는 것" 30 grep -q 'present:.*kind=list' "$WORK/shell.log"

line=$(grep 'present:.*kind=list' "$WORK/shell.log" | tail -1)
echo "$line"
if [[ $line != *actor=visible* ]]; then
  echo "실패: 목록 창이 화면에 없습니다. 확장이 숨겼습니다." >&2
  exit 1
fi
echo "통과: 목록 창이 화면에 남아 있습니다."
