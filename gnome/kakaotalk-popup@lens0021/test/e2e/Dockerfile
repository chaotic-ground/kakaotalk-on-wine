# e2e 시험이 도는 곳.
#
# 이미지로 만드는 이유는 gnome-shell이 apt로 수백 MB라서다. 매번 받으면
# 시험보다 설치가 오래 걸린다. 레이어가 캐시되면 그 비용이 한 번으로
# 끝난다.
#
# 데비안을 쓴다. Ubuntu 러너와 같은 계열이고 gnome-shell이 패키지로 있다.
FROM debian:trixie-slim

# gnome-shell이 끌고 오는 것이 많아서 --no-install-recommends로 줄인다.
# 시험에 필요한 것은 셸과 gjs와 GTK4와 D-Bus뿐이다.
#
# mesa의 소프트웨어 래스터라이저가 필요하다. 러너에는 GPU가 없고
# --headless는 그래도 무언가에 그려야 한다.
RUN apt-get update && apt-get install -y --no-install-recommends \
      gnome-shell \
      gjs \
      libgtk-4-1 \
      gir1.2-gtk-4.0 \
      dbus \
      dbus-x11 \
      libgl1-mesa-dri \
      mesa-vulkan-drivers \
      fonts-noto-cjk \
      procps \
      util-linux \
    && rm -rf /var/lib/apt/lists/*

# 한국어 제목을 쓰므로 UTF-8이어야 한다. 그러지 않으면 제목 비교가
# 어긋나고, 이 시험이 보는 것이 바로 그 제목이다.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    GALLIUM_DRIVER=llvmpipe \
    LIBGL_ALWAYS_SOFTWARE=1

# 시험은 평범한 사용자로 돈다. gnome-shell이 root를 거부한다. 다만
# 시스템 버스는 root가 띄워야 해서, 진입점이 root로 시작해 거기서
# 갈라준다. entrypoint.sh를 보라.
RUN useradd --create-home --uid 1001 tester \
    && mkdir -p /home/tester/run \
    && chown tester:tester /home/tester/run \
    && chmod 700 /home/tester/run

COPY entrypoint.sh /usr/local/bin/e2e-entrypoint
RUN chmod +x /usr/local/bin/e2e-entrypoint

WORKDIR /home/tester
ENV XDG_RUNTIME_DIR=/home/tester/run
ENTRYPOINT ["/usr/local/bin/e2e-entrypoint"]
