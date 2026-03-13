"""dwm.py — DWM styling + frameless window resize hit-testing.

Two jobs:
  1. DWM attributes  — dark scrollbar/caret chrome, violet accent border.
  2. Resize borders  — subclasses WndProc to intercept WM_NCHITTEST and
                       return resize hit codes for the window edges, giving
                       a frameless window full resize + Windows Snap.

Why WM_NCHITTEST for resize?
-----------------------------
A frameless window has no visible border, so Windows never sends resize
cursors and never starts a resize drag.  But we can intercept WM_NCHITTEST
and return HTLEFT / HTRIGHT / etc. when the cursor is near an edge.
Windows then starts a native resize exactly as if the window had a real
frame — including snap-to-edge, snap-to-corner, and resize cursors.

Why does drag-to-snap still work?
----------------------------------
Snap is triggered by WM_NCLBUTTONDOWN(HTCAPTION), not by WM_NCHITTEST.
WebView2 sends that message automatically when the user starts a drag on
any element marked -webkit-app-region:drag.  Our WndProc only touches
WM_NCHITTEST, so the two mechanisms never interfere.

Public API
----------
    apply_titlebar_style("Weekly Fetch", icon_path="ui/logo.ico")
"""

import ctypes
import ctypes.wintypes
import sys

# ── Platform guard ────────────────────────────────────────────────────────────
if sys.platform != "win32":
    def apply_titlebar_style(hwnd_or_title, *, icon_path=None) -> None:
        pass

else:
    _dwm    = ctypes.windll.dwmapi
    _user32 = ctypes.windll.user32

    # Fix pointer-sized return types — ctypes defaults to c_int (32-bit),
    # which silently truncates 64-bit pointers on x64 and causes crashes.
    _user32.FindWindowW.restype       = ctypes.c_ssize_t
    _user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    _user32.SetWindowLongPtrW.restype = ctypes.c_ssize_t
    _user32.CallWindowProcW.restype   = ctypes.c_ssize_t
    _user32.CallWindowProcW.argtypes  = [
        ctypes.c_ssize_t,        # lpPrevWndFunc (stored as integer, not live pointer)
        ctypes.wintypes.HWND,
        ctypes.c_uint,
        ctypes.wintypes.WPARAM,
        ctypes.wintypes.LPARAM,
    ]

    # GetDpiForWindow is Win10+ — fall back to 96 (100%) on older builds.
    try:
        _user32.GetDpiForWindow.restype = ctypes.c_uint
        _user32.GetDpiForWindow.argtypes = [ctypes.wintypes.HWND]
        def _dpi(hwnd): return _user32.GetDpiForWindow(hwnd) or 96
    except AttributeError:
        def _dpi(hwnd): return 96

    # Titlebar geometry (must match CSS tokens: --titlebar-h: 36px, 3×46px buttons)
    _TB_H_CSS      = 36    # CSS px — titlebar height
    _CONTROLS_W_CSS = 138  # CSS px — 3 window-control buttons × 46px

    # ── DWM attribute constants ───────────────────────────────────────────────
    _DWMWA_USE_IMMERSIVE_DARK_MODE = 20   # dark scrollbars, caret, chrome  Win10 20H1+
    _DWMWA_BORDER_COLOR            = 34   # 1px window border accent color   Win11+

    # ── Icon constants ────────────────────────────────────────────────────────
    _WM_SETICON      = 0x0080
    _ICON_SMALL      = 0
    _ICON_BIG        = 1
    _IMAGE_ICON      = 1
    _LR_LOADFROMFILE = 0x0010
    _LR_DEFAULTSIZE  = 0x0040

    # ── Window style constants (for proper maximize behaviour) ────────────────
    _GWL_STYLE          = -16
    _WS_CAPTION         = 0x00C00000   # title bar + border
    _WS_THICKFRAME      = 0x00040000   # resizable frame
    _SWP_NOMOVE         = 0x0002
    _SWP_NOSIZE         = 0x0001
    _SWP_NOZORDER       = 0x0004
    _SWP_FRAMECHANGED   = 0x0020       # re-evaluate frame after style change
    _SM_CYFRAME         = 33           # GetSystemMetrics: vertical frame thickness
    _SM_CXPADDEDBORDER  = 92           # GetSystemMetrics: padded border width

    # ── WndProc / hit-test constants ──────────────────────────────────────────
    _WM_NCCALCSIZE    = 0x0083
    _WM_NCHITTEST     = 0x0084
    _WM_NCLBUTTONDOWN = 0x00A1
    _WM_DESTROY       = 0x0002
    _GWLP_WNDPROC     = -4       # index for SetWindowLongPtrW

    # Non-client hit-test return values
    _HTCAPTION     = 2    # draggable caption area
    _HTLEFT        = 10
    _HTRIGHT       = 11
    _HTTOP         = 12
    _HTTOPLEFT     = 13
    _HTTOPRIGHT    = 14
    _HTBOTTOM      = 15
    _HTBOTTOMLEFT  = 16
    _HTBOTTOMRIGHT = 17

    # Resize grab zone width in physical pixels.
    # 10px works well at both 100% and 150% DPI.
    _BORDER = 10

    # ── Color helpers ─────────────────────────────────────────────────────────
    # Win32 COLORREF = 0x00BBGGRR — Blue and Red are swapped vs HTML #RRGGBB.
    def _rgb(r: int, g: int, b: int) -> int:
        return (b << 16) | (g << 8) | r

    # --accent oklch(62% 0.210 285) ≈ #6a3cc8
    _COLOR_BORDER = _rgb(0x6a, 0x3c, 0xc8)

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
        hbig = _user32.LoadImageW(
            None, path, _IMAGE_ICON, 0, 0, _LR_LOADFROMFILE | _LR_DEFAULTSIZE,
        )
        hsmall = _user32.LoadImageW(
            None, path, _IMAGE_ICON, 16, 16, _LR_LOADFROMFILE,
        )
        if hbig:   _user32.SendMessageW(hwnd, _WM_SETICON, _ICON_BIG,   hbig)
        if hsmall: _user32.SendMessageW(hwnd, _WM_SETICON, _ICON_SMALL, hsmall)

    # ── Frame style fixer ─────────────────────────────────────────────────────
    def _ensure_frame_styles(hwnd: int) -> None:
        """Add WS_CAPTION | WS_THICKFRAME to a frameless WS_POPUP window.

        pywebview creates a WS_POPUP window (no frame).  WS_POPUP maximizes to
        the full screen rect, hiding the taskbar.  Adding WS_CAPTION and
        WS_THICKFRAME tells Windows to use the work-area rect instead, so the
        taskbar stays visible — exactly how Electron / Discord handle this.

        WM_NCCALCSIZE in our WndProc returns 0 so the frame chrome is never
        drawn; we get the proper maximize behaviour without any visible frame.
        """
        style = _user32.GetWindowLongPtrW(hwnd, _GWL_STYLE)
        new_style = style | _WS_CAPTION | _WS_THICKFRAME
        if new_style != style:
            _user32.SetWindowLongPtrW(hwnd, _GWL_STYLE, new_style)
            # SWP_FRAMECHANGED forces Windows to re-evaluate the NC area
            # so the style change takes effect immediately.
            _user32.SetWindowPos(hwnd, None, 0, 0, 0, 0,
                _SWP_NOMOVE | _SWP_NOSIZE | _SWP_NOZORDER | _SWP_FRAMECHANGED)

    # ── WndProc subclass for resize hit-testing ───────────────────────────────

    # Must hold (old_proc_address, callback_ref) alive.
    # If Python GC collects the callback, the function pointer becomes a
    # dangling pointer and Windows crashes the next time it calls the proc.
    _subclassed: dict = {}

    _WNDPROC = ctypes.WINFUNCTYPE(
        ctypes.c_ssize_t,
        ctypes.wintypes.HWND,
        ctypes.c_uint,
        ctypes.wintypes.WPARAM,
        ctypes.wintypes.LPARAM,
    )

    def _install_resize_hittest(hwnd: int) -> None:
        """Subclass the WndProc to return resize hit codes for window edges."""

        def _proc(h, msg, wp, lp):
            hk  = int(h)
            old, _ = _subclassed.get(hk, (0, None))
            if not old:
                return _user32.DefWindowProcW(h, msg, wp, lp)

            if msg == _WM_NCCALCSIZE and wp:
                # Returning 0 makes the client area equal the full window rect,
                # hiding the native title bar and frame chrome.
                #
                # When maximized, Windows positions a WS_THICKFRAME window with
                # ~8px negative margins so the drop-shadow is off-screen.  The
                # vertical frame + padding must be added back at the top so that
                # content doesn't spill under the taskbar.
                if _user32.IsZoomed(h):
                    frame_y = _user32.GetSystemMetrics(_SM_CYFRAME)
                    padding  = _user32.GetSystemMetrics(_SM_CXPADDEDBORDER)
                    rect = ctypes.cast(lp, ctypes.POINTER(ctypes.wintypes.RECT))
                    rect[0].top += frame_y + padding
                return 0

            elif msg == _WM_NCHITTEST:
                # lParam low word = cursor x, high word = cursor y (screen coords).
                # c_int16 handles sign extension for negative coords on multi-monitors.
                cx = ctypes.c_int16(lp         & 0xFFFF).value
                cy = ctypes.c_int16((lp >> 16) & 0xFFFF).value

                wr = ctypes.wintypes.RECT()
                _user32.GetWindowRect(h, ctypes.byref(wr))

                left   = cx - wr.left   < _BORDER
                right  = wr.right  - cx < _BORDER
                top    = cy - wr.top    < _BORDER
                bottom = wr.bottom - cy < _BORDER

                if top    and left:  return _HTTOPLEFT
                if top    and right: return _HTTOPRIGHT
                if bottom and left:  return _HTBOTTOMLEFT
                if bottom and right: return _HTBOTTOMRIGHT
                if top:              return _HTTOP
                if bottom:           return _HTBOTTOM
                if left:             return _HTLEFT
                if right:            return _HTRIGHT

                # Titlebar drag area → HTCAPTION so Windows handles both
                # drag-to-move AND Snap natively.  Skip the controls zone
                # (right 138 CSS px) so the buttons still receive clicks.
                scale       = _dpi(h) / 96
                tb_h_px     = int(_TB_H_CSS       * scale)
                controls_px = int(_CONTROLS_W_CSS * scale)
                if cy - wr.top < tb_h_px and wr.right - cx > controls_px:
                    return _HTCAPTION

            elif msg == _WM_NCLBUTTONDOWN:
                # WinForms' WndProc does NOT forward WM_NCLBUTTONDOWN to
                # DefWindowProc for FormBorderStyle.None windows, so resize
                # and caption-drag loops never start.  We bypass WinForms and
                # call DefWindowProc directly for all non-client button codes.
                _resize_codes = (
                    _HTCAPTION,
                    _HTLEFT, _HTRIGHT, _HTTOP, _HTTOPLEFT, _HTTOPRIGHT,
                    _HTBOTTOM, _HTBOTTOMLEFT, _HTBOTTOMRIGHT,
                )
                if wp in _resize_codes:
                    return _user32.DefWindowProcW(h, msg, wp, lp)

            elif msg == _WM_DESTROY:
                if hk in _subclassed:
                    _user32.SetWindowLongPtrW(h, _GWLP_WNDPROC, _subclassed[hk][0])
                    del _subclassed[hk]

            return _user32.CallWindowProcW(old, h, msg, wp, lp)

        cb  = _WNDPROC(_proc)
        old = _user32.SetWindowLongPtrW(hwnd, _GWLP_WNDPROC, cb)
        _subclassed[hwnd] = (old, cb)

    # ── Public API ────────────────────────────────────────────────────────────
    def apply_titlebar_style(hwnd_or_title, *, icon_path=None) -> None:
        """Apply DWM styling, window icon, and resize hit-testing.

        Args:
            hwnd_or_title: window title string (FindWindowW) or HWND integer.
            icon_path:     optional path to .ico file for titlebar + taskbar icon.
        """
        hwnd = (_user32.FindWindowW(None, hwnd_or_title)
                if isinstance(hwnd_or_title, str) else int(hwnd_or_title))
        if not hwnd:
            return

        build = sys.getwindowsversion().build

        # Dark chrome — scrollbars, caret, selection handles use light-on-dark.
        if build >= 19041:
            _set_attr(hwnd, _DWMWA_USE_IMMERSIVE_DARK_MODE, 1)

        # Violet accent border around the window edge.
        if build >= 22000:
            _set_attr(hwnd, _DWMWA_BORDER_COLOR, _COLOR_BORDER)

        # Window icon (titlebar corner + taskbar button).
        if icon_path:
            _install_icon(hwnd, str(icon_path))

        # Add WS_CAPTION | WS_THICKFRAME so maximize respects the taskbar.
        # Must happen before WndProc installation so the style is set before
        # our WM_NCCALCSIZE handler fires.
        _ensure_frame_styles(hwnd)

        # Resize borders via WndProc hit-testing.
        _install_resize_hittest(hwnd)
