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

# 셸이 systemd가 있다고 판단하는 근거를 찍는다. loginManager.js가
# /run/systemd/seats가 있는지로 고르고, 있다고 보면 logind에 붙으려다
# 실패해서 background.js 초기화가 깨진다.
echo "e2e: /run/systemd =" "$(ls -d /run/systemd 2>&1)" >&2
echo "e2e: /run/systemd/seats =" "$(ls -d /run/systemd/seats 2>&1)" >&2

mkdir -p /run/dbus
dbus-daemon --system --fork

exec runuser -u tester -- "$@"
