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

mkdir -p /run/dbus
dbus-daemon --system --fork

exec runuser -u tester -- "$@"
