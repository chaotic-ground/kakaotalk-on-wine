// 가짜 카카오톡 창.
//
// 확장이 창에 대해 보는 것은 wm_class, 제목, 크기, pid뿐이다. mutter는
// Wayland 클라이언트의 app_id를 wm_class로 돌려주므로, app_id만 맞추면
// 확장 입장에서 진짜와 구별되지 않는다. 진짜 앱은 CI에 올릴 수 없다.
// 카카오 설치 파일을 받아야 하고 로그인이 필요하다.
//
//   gjs -m fakeapp.js <제목> <폭> <높이>
import GLib from 'gi://GLib';

// app_id는 prgname에서 온다. Gtk.init보다 먼저 세워야 한다.
GLib.set_prgname('kakaotalk.exe');

const Gtk = (await import('gi://Gtk?version=4.0')).default;

const [title, width, height] = [ARGV[0], Number(ARGV[1]), Number(ARGV[2])];
Gtk.init();
new Gtk.Window({ title, defaultWidth: width, defaultHeight: height }).present();
GLib.MainLoop.new(null, false).run();
