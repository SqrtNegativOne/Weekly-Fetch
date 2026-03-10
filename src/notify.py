"""Windows toast notifications via winotify.

If winotify isn't installed (e.g. running on another OS for testing),
the notification is silently skipped.
"""


def notify_digest_ready(week_tag: str, html_path: str) -> None:
    """Show a Windows 10/11 toast: 'New digest ready · 2026-W10'.

    Clicking the toast opens the HTML file in the default browser
    (the `launch` parameter is a file:// URI or path that Windows opens).
    """
    try:
        from winotify import Notification
        Notification(
            app_id="Weekly Fetch",
            title=f"New digest ready · {week_tag}",
            msg="Click to open in your browser",
            launch=html_path,
        ).show()
    except Exception:
        pass  # winotify not installed, or Windows notification service unavailable
