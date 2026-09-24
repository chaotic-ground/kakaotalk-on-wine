/* Ask KakaoTalk to show its window, without going through the tray.
 *
 * Clicking the tray icon is the only thing KakaoTalk offers for getting a
 * hidden window back, and under Wine's Wayland driver that tray is a
 * floating window whose right-click does nothing and whose left-click has to
 * be delivered by a real hand -- the panel indicator can only warp the
 * pointer onto it and wait.
 *
 * But the click is not what the app acts on. A +msg trace of one shows the
 * app posting itself a single message and then calling ShowWindow:
 *
 *   NtUserPostMessage hwnd 0x1007a msg 111 (WM_COMMAND) wp 8035
 *   show_window hwnd=0x1007a, cmd=5, was_visible 1
 *
 * So the message can be sent from here instead, and the tray window stops
 * being needed at all.
 *
 *   kakaoshow          post it
 *   kakaoshow --menu   right-click the tray icon, which makes the app put up
 *                      its own menu
 *   kakaoshow --menu-close
 *                      dismiss it
 *   kakaoshow --list   print every top-level window of the app, to find out
 *                      what to post it to
 *
 * Run it inside the instance that is running the client, and nowhere else. A
 * second `flatpak run` gets its own PID namespace, and looking at another
 * process across that boundary kills the whole wine session -- --list on its
 * own is enough, no message required. The launcher's control file is how the
 * outside asks for this; to run it by hand:
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

/* Wine's own explorer.exe owns the tray icon, as a __wine_tray_icon window,
 * and turns a right-click on it into the WM_CONTEXTMENU the app acts on. So
 * the menu can be asked for from here, and it is the app's real menu rather
 * than an imitation that would have to be kept in step with it.
 *
 * Recursive, because the icon window is a child of the tray and EnumWindows
 * only walks the top level.
 *
 * Posted and not sent: TrackPopupMenu runs a modal loop, and a SendMessage
 * would wait for a menu that is dismissed by a hand, not by us. */
/* A menu opened this way is never dismissed by itself. Clicking elsewhere on
 * the desktop is how a menu normally goes, and a click that lands on another
 * Wayland client never reaches wine at all, so the menu sits there for good
 * -- and a second right-click stacks another one on top.
 *
 * WM_CANCELMODE posted to the menu window is what NtUserEndMenu does from
 * inside, and the menu's own loop reads it out of its queue, so it works from
 * out here too. */
static BOOL CALLBACK cancel_menu( HWND hwnd, LPARAM param )
{
    WCHAR cls[64] = {0};

    GetClassNameW( hwnd, cls, 64 );
    if (!lstrcmpW( cls, L"#32768" )) PostMessageW( hwnd, WM_CANCELMODE, 0, 0 );
    return TRUE;
}

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

    /* The main window, by class and by having a size. KakaoTalk keeps
     * several windows of this class and all but one are 0x0 -- message
     * sinks, not windows. The real one keeps its size while hidden, which is
     * what makes this work at all: the app hides rather than minimises, so
     * there is nothing on screen to find it by. */
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
        /* Whatever is already open, before adding to it. */
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
