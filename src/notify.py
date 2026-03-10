"""Windows toast notifications via winotify.

If winotify isn't installed (e.g. running on another OS for testing),
the notification is silently skipped.
"""


def notify_digest_ready(day_tag: str) -> None:
    """Show a Windows 10/11 toast: 'New digest ready · 2026-03-10'."""
    try:
        from winotify import Notification
        Notification(
            app_id="Weekly Fetch",
            title=f"New digest ready \u00b7 {day_tag}",
            msg="Open the app to read your digest",
        ).show()
    except Exception:
        pass  # winotify not installed, or Windows notification service unavailable
