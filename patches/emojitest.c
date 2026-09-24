/* Ask the font for one character and say whether a real glyph came back.
 *
 * GetGlyphOutlineW without GGO_GLYPH_INDEX takes a character, and Wine hands
 * it straight to get_glyph_index_linked -- the lookup that walks the font and
 * then its linked children. So passing the composed codepoint exercises
 * exactly the path an astral character has to travel, without needing anyone
 * to look at a window.
 *
 * The outline size is the answer. A missing glyph is either refused outright
 * or comes back as the notdef box, a handful of bytes; a real glyph is an
 * outline and is much bigger. Extents are no use here: this font gives the
 * same advance whether it knows the character or not.
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

static const MAT2 identity = { {0,1}, {0,0}, {0,0}, {0,1} };

static void ask( HDC dc, UINT ch, const char *what )
{
    GLYPHMETRICS gm;
    DWORD size;

    size = GetGlyphOutlineW( dc, ch, GGO_NATIVE, &gm, 0, NULL, &identity );
    if (size == GDI_ERROR)
        printf( "%-24s U+%05X  refused\n", what, ch );
    else
        printf( "%-24s U+%05X  outline=%lu bytes  box=%ux%u\n",
                what, ch, size, gm.gmBlackBoxX, gm.gmBlackBoxY );
}

static void with_face( const WCHAR *face, const char *label )
{
    HDC dc = CreateCompatibleDC( NULL );
    HBITMAP bmp = CreateCompatibleBitmap( GetDC( NULL ), 64, 64 );
    LOGFONTW lf = { 0 };
    char what[64];

    SelectObject( dc, bmp );
    lf.lfHeight = -32;
    lstrcpyW( lf.lfFaceName, face );
    SelectObject( dc, CreateFontIndirectW( &lf ) );

    {
        /* What the selected charmap says it covers. A (3,1) cmap stops at
         * U+FFFF; a (3,10) one does not, so the top of this range says which
         * one is actually in effect for this font instance. */
        DWORD size = GetFontUnicodeRanges( dc, NULL );
        GLYPHSET *gs = malloc( size );
        if (gs)
        {
            gs->cbThis = size;
            if (GetFontUnicodeRanges( dc, gs ))
            {
                WCRANGE *last = &gs->ranges[gs->cRanges - 1];
                printf( "%-24s ranges=%u top=U+%05X\n", label, gs->cRanges,
                        last->wcLow + last->cGlyphs - 1 );
            }
            free( gs );
        }
    }
    sprintf( what, "%s hangul", label );   ask( dc, 0xac00, what );
    sprintf( what, "%s smile", label );    ask( dc, 0x263a, what );
    sprintf( what, "%s astral", label );   ask( dc, 0x1f33e, what );
    DeleteDC( dc );
}

int main( void )
{
    with_face( L"\xb9d1\xc740 \xace0\xb515", "malgun" );  /* 맑은 고딕 */
    with_face( L"Noto Emoji", "notoemoji" );
    return 0;
}
