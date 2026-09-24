/* 트레이를 거치지 않고 카카오톡에 창을 띄우라고 요청한다.
 *
 * 숨은 창을 되찾는 방법으로 카카오톡이 주는 것은 트레이 아이콘 클릭뿐이고,
 * Wine의 Wayland 드라이버에서 그 트레이는 떠 있는 창이다. 우클릭은 아무
 * 일도 하지 않고 좌클릭은 진짜 손이 해줘야 한다. 패널 인디케이터가 할 수
 * 있는 것은 포인터를 그 위로 옮기고 기다리는 것뿐이었다.
 *
 * 그런데 앱이 반응하는 것은 그 클릭이 아니다. +msg로 추적해보면 앱이
 * 자기에게 메시지 하나를 보내고 ShowWindow를 부른다.
 *
 *   NtUserPostMessage hwnd 0x1007a msg 111 (WM_COMMAND) wp 8035
 *   show_window hwnd=0x1007a, cmd=5, was_visible 1
 *
 * 그러면 그 메시지를 여기서 보내면 되고, 트레이 창은 아예 필요가 없어진다.
 *
 *   kakaoshow          메시지를 보낸다
 *   kakaoshow --menu   트레이 아이콘을 우클릭해서 앱이 자기 메뉴를 띄우게
 *                      한다
 *   kakaoshow --menu-close
 *                      그 메뉴를 닫는다
 *   kakaoshow --list   앱의 모든 최상위 창을 찍는다. 어디로 보낼지 알아낼 때
 *
 * 클라이언트가 돌고 있는 인스턴스 안에서 돌려라. 다른 데서는 안 된다.
 * 두 번째 `flatpak run`은 자기 PID 네임스페이스를 갖고, 그 경계를 넘어 다른
 * 프로세스를 들여다보면 wine 세션 전체가 죽는다. 메시지도 필요 없이
 * --list 하나로 충분하다. 바깥에서 이걸 요청하는 통로가 런처의 컨트롤
 * 파일이다. 손으로 돌리려면:
 *
 *   flatpak enter $(flatpak ps --columns=instance,application |
 *                   grep KakaoTalk | head -1 | cut -f1) \
 *     env HOME=$HOME LOCPATH=/app/lib/locale \
 *         WINEPREFIX=$HOME/.var/app/io.github.chaotic_ground.KakaoTalk/data/prefix \
 *         /app/wine/bin/wine /app/share/kakaotalk/kakaoshow.exe --list
 */
#include <windows.h>
#include <stdio.h>

#define KAKAO_SHOW_COMMAND 0x8035

static BOOL listing;
static HWND found;
static HWND tray_icon;

/* 이렇게 연 메뉴는 스스로 닫히지 않는다. 메뉴가 보통 사라지는 방법은
 * 다른 데를 클릭하는 것인데, 그 클릭은 다른 Wayland 클라이언트에 떨어지고
 * wine에는 아예 닿지 않는다. 메뉴는 영영 그 자리에 있게 되고, 우클릭을 또
 * 하면 그 위에 하나가 더 쌓인다.
 *
 * 메뉴 창에 보낸 WM_CANCELMODE는 NtUserEndMenu가 안에서 하는 일과 같다.
 * 메뉴 자신의 루프가 자기 큐에서 그걸 읽으므로 바깥에서 보내도 동작한다. */
static BOOL CALLBACK cancel_menu( HWND hwnd, LPARAM param )
{
    WCHAR cls[64] = {0};

    GetClassNameW( hwnd, cls, 64 );
    if (!lstrcmpW( cls, L"#32768" )) PostMessageW( hwnd, WM_CANCELMODE, 0, 0 );
    return TRUE;
}

/* 트레이 아이콘은 wine 자신의 explorer.exe가 __wine_tray_icon 창으로 들고
 * 있고, 거기 온 우클릭을 앱이 반응하는 WM_CONTEXTMENU로 바꿔준다. 그래서
 * 메뉴를 여기서 요청할 수 있고, 그것은 앱의 진짜 메뉴다. 흉내 낸 것이라면
 * 앱을 따라 계속 맞춰줘야 했을 것이다.
 *
 * 재귀인 이유는 아이콘 창이 트레이의 자식이고 EnumWindows는 최상위만
 * 훑기 때문이다.
 *
 * send가 아니라 post인 이유는 TrackPopupMenu가 모달 루프를 돌기 때문이다.
 * SendMessage였다면 우리가 아니라 손이 닫아줄 메뉴를 기다리게 된다. */
static BOOL CALLBACK find_tray( HWND hwnd, LPARAM param )
{
    WCHAR cls[64] = {0};

    GetClassNameW( hwnd, cls, 64 );
    if (!lstrcmpW( cls, L"__wine_tray_icon" ))
    {
        tray_icon = hwnd;
        return FALSE;
    }
    EnumChildWindows( hwnd, find_tray, 0 );
    return !tray_icon;
}

static BOOL is_kakaotalk( HWND hwnd )
{
    DWORD pid = 0;
    WCHAR path[MAX_PATH];
    HANDLE proc;
    BOOL ours = FALSE;

    GetWindowThreadProcessId( hwnd, &pid );
    if (!pid) return FALSE;
    if (!(proc = OpenProcess( PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid )))
        return FALSE;
    DWORD len = MAX_PATH;
    if (QueryFullProcessImageNameW( proc, 0, path, &len ))
    {
        const WCHAR *base = wcsrchr( path, '\\' );
        ours = !lstrcmpiW( base ? base + 1 : path, L"KakaoTalk.exe" );
    }
    CloseHandle( proc );
    return ours;
}

static BOOL CALLBACK visit( HWND hwnd, LPARAM param )
{
    WCHAR cls[256] = {0}, title[256] = {0};
    RECT r;

    if (!is_kakaotalk( hwnd )) return TRUE;

    GetClassNameW( hwnd, cls, 256 );
    GetWindowTextW( hwnd, title, 256 );
    GetWindowRect( hwnd, &r );

    if (listing)
    {
        printf( "hwnd=%p class=%ls title=%ls %dx%d visible=%d\n",
                hwnd, cls, title, (int)(r.right - r.left),
                (int)(r.bottom - r.top), IsWindowVisible( hwnd ) );
        return TRUE;
    }

    /* 메인 창을 클래스와 크기로 찾는다. 카카오톡은 이 클래스의 창을 여러
     * 개 들고 있는데 하나 빼고 전부 0x0이다. 창이 아니라 메시지 받는
     * 자리다. 진짜 창은 숨어 있는 동안에도 크기를 유지하고, 그것이 이
     * 방법이 통하는 이유다. 앱은 최소화가 아니라 숨기기를 하므로 화면에서
     * 찾을 단서가 없다. */
    if (lstrcmpW( cls, L"EVA_Window_Dblclk" )) return TRUE;
    if (r.right - r.left < 100 || r.bottom - r.top < 100) return TRUE;
    found = hwnd;
    return FALSE;
}

int main( int argc, char **argv )
{
    if (argc > 1 && !strcmp( argv[1], "--menu-close" ))
    {
        EnumWindows( cancel_menu, 0 );
        return 0;
    }

    if (argc > 1 && !strcmp( argv[1], "--menu" ))
    {
        /* 더 얹기 전에, 이미 열려 있는 것부터 닫는다. */
        EnumWindows( cancel_menu, 0 );

        EnumWindows( find_tray, 0 );
        if (!tray_icon)
        {
            fprintf( stderr, "no tray icon window found\n" );
            return 1;
        }
        PostMessageW( tray_icon, WM_RBUTTONDOWN, 0, 0 );
        PostMessageW( tray_icon, WM_RBUTTONUP, 0, 0 );
        return 0;
    }

    listing = argc > 1 && !strcmp( argv[1], "--list" );
    EnumWindows( visit, 0 );
    if (listing) return 0;
    if (!found)
    {
        fprintf( stderr, "no KakaoTalk window found\n" );
        return 1;
    }
    PostMessageW( found, WM_COMMAND, KAKAO_SHOW_COMMAND, 0 );
    return 0;
}
