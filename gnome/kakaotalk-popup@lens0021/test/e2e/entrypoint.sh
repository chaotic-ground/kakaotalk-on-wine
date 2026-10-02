#!/bin/bash
# root로 시스템 버스를 띄우고, 시험은 평범한 사용자로 돌린다.
#
# 둘 다 필요하다. GNOME Shell의 로그인 관리자가 시스템 버스에 붙으려
# 하고, 없으면 background.js 초기화가 깨져서 셸이 org.gnome.Shell이라는
# 이름을 아예 못 올린다. 그런데 시스템 버스는 root가 띄우고 gnome-shell은
# root를 거부한다.
#
# 러너에서 그걸로 한참 헤맸다. 셸은 Wayland 소켓까지 열어놓고 버스에만 안
# 올라와서, 증상이 "시간 초과"로만 보였다.
set -euo pipefail

# systemd가 있는 척하는 것을 치운다.
#
# 셸의 loginManager.js는 /run/systemd/seats가 있는지로 로그인 관리자를
# 고른다. 있으면 logind에 붙으려 하고, 없으면 아무것도 안 하는 대역을
# 쓴다. 러너의 /run이 컨테이너 안에서 보여서 그 디렉터리가 있고, 그런데
# logind는 없다. 그래서 셸이 background.js 초기화 중에 깨지고 org.gnome
# .Shell이라는 이름을 영영 못 올린다. 증상은 "시간 초과"로만 보인다.
#
# 지우는 게 아니라 빈 tmpfs로 덮는다. 러너의 것을 건드리지 않는다.
if [[ -e /run/systemd/seats ]]; then
  mount -t tmpfs -o size=1k tmpfs /run/systemd 2>/dev/null \
    || rm -rf /run/systemd
fi

mkdir -p /run/dbus
dbus-daemon --system --fork

exec runuser -u tester -- "$@"
