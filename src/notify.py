"""Windows toast notifications via winotify.

If winotify isn't installed (e.g. running on another OS for testing),
the notification is silently skipped.
"""


def notify_new_artifacts(count: int) -> None:
    """Show a Windows 10/11 toast: 'New artifacts ready'."""
    try:
        from winotify import Notification
        Notification(
            app_id="Weekly Fetch",
            title="New artifacts ready",
            msg=f"{count} new item{'s' if count != 1 else ''} to review",
        ).show()
    except Exception:
        pass  # winotify not installed, or Windows notification service unavailable
