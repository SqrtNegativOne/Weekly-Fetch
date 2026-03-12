"""dwm.py — Windows DWM titlebar styling + custom caption text.

Three things this module does:
  1. DWM attributes  — dark chrome, custom caption/text/border colors
  2. Window icon     — sets the titlebar & taskbar icon from an .ico file
  3. Caption font    — subclasses the window WndProc to draw the title in
                       Consolas instead of Segoe UI

Why WndProc subclassing for the font?
--------------------------------------
DWM attributes control color and material (Mica/Acrylic), but the caption
*font* is owned entirely by Windows.  The only way to change it is to
intercept the paint messages Windows sends to the window's message handler
(WndProc), let Windows draw the NC area normally, then immediately overdraw
the caption text area with our own font.

The subclassing pattern:
  1. Call SetWindowLongPtrW(GWLP_WNDPROC, new_proc) — swaps the handler
  2. In new_proc, forward every message to the original handler first
  3. After WM_NCPAINT / WM_NCACTIVATE, overdraw the caption text
  4. Keep a Python reference to the callback — if GC collects it, the
     function pointer becomes a dangling pointer and Windows crashes.

Public API
----------
    apply_titlebar_style(
        "Weekly Fetch",          # window title or HWND
        icon_path="ui/logo.ico"  # optional path to .ico file
    )
"""

import ctypes
import ctypes.wintypes
import sys

# ── Platform guard ────────────────────────────────────────────────────────────
if sys.platform != "win32":
    def apply_titlebar_style(hwnd_or_title, *, icon_path=None) -> None:  # type: ignore
        pass

else:
    _dwm    = ctypes.windll.dwmapi
    _user32 = ctypes.windll.user32
    _gdi32  = ctypes.windll.gdi32

    # ── Fix pointer-sized types (ctypes defaults to c_int = 32-bit, wrong on x64) ──
    _user32.SetWindowLongPtrW.restype  = ctypes.c_ssize_t
    _user32.CallWindowProcW.restype    = ctypes.c_ssize_t
    _user32.CallWindowProcW.argtypes   = [
        ctypes.c_ssize_t,        # lpPrevWndFunc — stored as integer, not a live pointer
        ctypes.wintypes.HWND,
        ctypes.c_uint,
        ctypes.wintypes.WPARAM,
        ctypes.wintypes.LPARAM,
    ]

    # ── DWM attribute constants ───────────────────────────────────────────────
    _DWMWA_USE_IMMERSIVE_DARK_MODE = 20
    _DWMWA_BORDER_COLOR            = 34
    _DWMWA_CAPTION_COLOR           = 35
    _DWMWA_TEXT_COLOR              = 36
    _DWMWA_SYSTEMBACKDROP_TYPE     = 38
    _DWMSBT_DISABLE                = 1   # no Mica/Acrylic (needed to let caption color show)

    # ── Icon constants ────────────────────────────────────────────────────────
    _WM_SETICON      = 0x0080
    _ICON_SMALL      = 0
    _ICON_BIG        = 1
    _IMAGE_ICON      = 1
    _LR_LOADFROMFILE = 0x0010
    _LR_DEFAULTSIZE  = 0x0040

    # ── WndProc / GDI constants ───────────────────────────────────────────────
    _WM_NCPAINT      = 0x0085   # repaint the non-client area
    _WM_NCACTIVATE   = 0x0086   # caption switches active↔inactive
    _WM_DESTROY      = 0x0002   # window being destroyed — restore old WndProc
    _GWLP_WNDPROC    = -4       # index for SetWindowLongPtrW to swap WndProc
    _FW_NORMAL       = 400
    _DEFAULT_CHARSET = 1
    _FIXED_PITCH     = 1        # request a monospace font family
    _TRANSPARENT     = 1        # SetBkMode: don't paint text background
    _DT_LEFT_VCENTER_SINGLE = 0x0024  # DT_LEFT(0) | DT_VCENTER(4) | DT_SINGLELINE(0x20)

    # System metric indices
    _SM_CYCAPTION      = 4
    _SM_CXSIZE         = 30   # width of caption buttons (min/max/close)
    _SM_CXSIZEFRAME    = 32
    _SM_CYSIZEFRAME    = 33
    _SM_CXPADDEDBORDER = 92

    # ── COLORREF helper ───────────────────────────────────────────────────────
    # Win32 colors are 0x00BBGGRR — Blue and Red are SWAPPED vs HTML #RRGGBB.
    def _rgb(r: int, g: int, b: int) -> int:
        return (b << 16) | (g << 8) | r

    # Palette derived from CSS design tokens (oklch → approximate sRGB):
    #
    #   --bg-surface  oklch(10%  0.035 285) → #100d1f  (mid-dark purple, caption bg)
    #   --text-1      oklch(97%  0.012 285) → #e8e3f5  (lavender-white, caption text)
    #   --accent      oklch(62%  0.210 285) → #6a3cc8  (vivid violet, window border)
    #
    # Caption is a noticeable purple rather than near-black so it reads as
    # clearly custom against both light-mode and dark-mode system defaults.
    _COLOR_CAPTION = _rgb(0x10, 0x0d, 0x1f)
    _COLOR_TEXT    = _rgb(0xe8, 0xe3, 0xf5)
    _COLOR_BORDER  = _rgb(0x6a, 0x3c, 0xc8)

    # ── DWM attribute setter ──────────────────────────────────────────────────
    def _set_attr(hwnd: int, attr: int, value: int) -> bool:
        c_val = ctypes.c_int(value)
        hr = _dwm.DwmSetWindowAttribute(
            hwnd, ctypes.c_uint(attr),
            ctypes.byref(c_val), ctypes.c_uint(ctypes.sizeof(c_val)),
        )
        return hr == 0

    # ── Icon installer ────────────────────────────────────────────────────────
    def _install_icon(hwnd: int, path: str) -> None:
        """Load an .ico and apply it to the titlebar (small) and taskbar (big)."""
        hbig = _user32.LoadImageW(
            None, path, _IMAGE_ICON, 0, 0, _LR_LOADFROMFILE | _LR_DEFAULTSIZE,
        )
        hsmall = _user32.LoadImageW(
            None, path, _IMAGE_ICON, 16, 16, _LR_LOADFROMFILE,
        )
        if hbig:
            _user32.SendMessageW(hwnd, _WM_SETICON, _ICON_BIG,   hbig)
        if hsmall:
            _user32.SendMessageW(hwnd, _WM_SETICON, _ICON_SMALL, hsmall)

    # ── WndProc subclass for custom caption font ──────────────────────────────

    # Keeps (old_proc_address, callback_ref) alive per HWND.
    # The callback_ref MUST be held here — if Python GC collects it, the
    # function pointer becomes a dangling pointer and Windows will crash.
    _subclassed: dict = {}

    # Reentrancy guard — HWNDs currently inside our NC-paint handler.
    #
    # Why this is needed:
    #   CallWindowProcW(old, WM_NCPAINT)  ← we call this
    #     → DefWindowProc internally calls SendMessage(WM_NCACTIVATE)
    #       → our _proc is entered again (same thread, synchronous)
    #         → CallWindowProcW(old, WM_NCACTIVATE)
    #           → DefWindowProc internally calls SendMessage(WM_NCPAINT)
    #             → infinite loop / stack overflow
    #
    # Fix: if the HWND is already in this set, skip the custom overdraw
    # and just forward the message — breaking the cycle.
    _nc_active: set = set()

    _WNDPROC = ctypes.WINFUNCTYPE(
        ctypes.c_ssize_t,       # LRESULT return
        ctypes.wintypes.HWND,
        ctypes.c_uint,          # message
        ctypes.wintypes.WPARAM,
        ctypes.wintypes.LPARAM,
    )

    def _paint_caption_text(hwnd: int, title: str) -> None:
        """Overdraw the caption text area with Consolas after Windows paints it."""
        hdc = _user32.GetWindowDC(hwnd)
        if not hdc:
            return
        try:
            cap_h = _user32.GetSystemMetrics(_SM_CYCAPTION)
            fr_y  = (_user32.GetSystemMetrics(_SM_CYSIZEFRAME)
                     + _user32.GetSystemMetrics(_SM_CXPADDEDBORDER))
            btn_w = _user32.GetSystemMetrics(_SM_CXSIZE) * 3  # 3 caption buttons

            wr = ctypes.wintypes.RECT()
            _user32.GetWindowRect(hwnd, ctypes.byref(wr))
            win_w = wr.right - wr.left

            # The band we own: from the app icon to just before the buttons.
            # x=32 clears past the 16px icon + frame padding.
            x1, x2 = 32, win_w - btn_w
            y1, y2 = fr_y, fr_y + cap_h

            # 1. Fill with caption background to erase Windows' Segoe UI title.
            er = ctypes.wintypes.RECT()
            er.left, er.top, er.right, er.bottom = x1, y1, x2, y2
            hbr = _gdi32.CreateSolidBrush(_COLOR_CAPTION)
            _user32.FillRect(hdc, ctypes.byref(er), hbr)
            _gdi32.DeleteObject(hbr)

            # 2. Draw title in Consolas.
            font_px = cap_h - 6
            hfont = _gdi32.CreateFontW(
                -font_px, 0, 0, 0,           # height (negative = char height), width, escapement, orientation
                _FW_NORMAL, 0, 0, 0,         # weight, italic, underline, strikeout
                _DEFAULT_CHARSET, 0, 0, 0,   # charset, output precision, clip precision, quality
                _FIXED_PITCH, "Consolas",    # pitch + face name
            )
            old_font = _gdi32.SelectObject(hdc, hfont)
            _gdi32.SetTextColor(hdc, _COLOR_TEXT)
            _gdi32.SetBkMode(hdc, _TRANSPARENT)

            tr = ctypes.wintypes.RECT()
            tr.left, tr.top, tr.right, tr.bottom = x1, y1, x2, y2
            _user32.DrawTextW(hdc, title, -1, ctypes.byref(tr), _DT_LEFT_VCENTER_SINGLE)

            _gdi32.SelectObject(hdc, old_font)
            _gdi32.DeleteObject(hfont)
        finally:
            _user32.ReleaseDC(hwnd, hdc)

    def _install_caption_font(hwnd: int, title: str) -> None:
        """Subclass the window WndProc to draw Consolas caption text."""

        def _proc(h, msg, wp, lp):
            hk  = int(h)
            old, _ = _subclassed.get(hk, (0, None))

            # Guard: old=0 means we're not properly subclassed; fall back safely.
            if not old:
                return _user32.DefWindowProcW(h, msg, wp, lp)

            is_nc = msg in (_WM_NCPAINT, _WM_NCACTIVATE)

            if is_nc and hk in _nc_active:
                # Re-entrant NC message — forward only, no custom draw.
                return _user32.CallWindowProcW(old, h, msg, wp, lp)

            if is_nc:
                _nc_active.add(hk)

            try:
                result = _user32.CallWindowProcW(old, h, msg, wp, lp)

                if is_nc:
                    _paint_caption_text(hk, title)
                elif msg == _WM_DESTROY:
                    if hk in _subclassed:
                        _user32.SetWindowLongPtrW(h, _GWLP_WNDPROC, _subclassed[hk][0])
                        del _subclassed[hk]
                    _nc_active.discard(hk)

                return result
            finally:
                if is_nc:
                    _nc_active.discard(hk)

        cb  = _WNDPROC(_proc)
        old = _user32.SetWindowLongPtrW(hwnd, _GWLP_WNDPROC, cb)
        _subclassed[hwnd] = (old, cb)

        # Trigger one immediate repaint so the font appears right away.
        _user32.SendMessageW(hwnd, _WM_NCPAINT, 1, 0)

    # ── Public API ────────────────────────────────────────────────────────────
    def apply_titlebar_style(hwnd_or_title, *, icon_path=None) -> None:
        """Apply DWM colors, icon, and Consolas caption font to the window.

        Args:
            hwnd_or_title: window title string (FindWindowW) or HWND integer.
            icon_path:     optional path to an .ico file.
        """
        hwnd = (_user32.FindWindowW(None, hwnd_or_title)
                if isinstance(hwnd_or_title, str) else int(hwnd_or_title))
        if not hwnd:
            return

        title_text = (hwnd_or_title if isinstance(hwnd_or_title, str)
                      else _get_window_text(hwnd))

        build = sys.getwindowsversion().build

        # Step 1 — Dark chrome (scrollbars, caret, selection handles).
        if build >= 19041:
            _set_attr(hwnd, _DWMWA_USE_IMMERSIVE_DARK_MODE, 1)

        # Step 2 — Custom solid caption + text + border colors.
        # We explicitly disable Mica here because DWMWA_SYSTEMBACKDROP_TYPE
        # (Mica) takes priority over DWMWA_CAPTION_COLOR — you can't have both.
        if build >= 22000:
            _set_attr(hwnd, _DWMWA_CAPTION_COLOR, _COLOR_CAPTION)
            _set_attr(hwnd, _DWMWA_TEXT_COLOR,    _COLOR_TEXT)
            _set_attr(hwnd, _DWMWA_BORDER_COLOR,  _COLOR_BORDER)
        if build >= 22621:
            _set_attr(hwnd, _DWMWA_SYSTEMBACKDROP_TYPE, _DWMSBT_DISABLE)

        # Step 3 — Window icon (titlebar + taskbar).
        if icon_path:
            _install_icon(hwnd, str(icon_path))

        # Step 4 — Custom Consolas caption font via WndProc subclass.
        _install_caption_font(hwnd, title_text)

    def _get_window_text(hwnd: int) -> str:
        buf = ctypes.create_unicode_buffer(256)
        _user32.GetWindowTextW(hwnd, buf, 256)
        return buf.value
