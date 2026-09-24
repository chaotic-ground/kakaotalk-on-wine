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
