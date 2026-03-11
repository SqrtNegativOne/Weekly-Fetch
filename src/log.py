"""Central logging configuration for Weekly Fetch.

Import `logger` from this module anywhere you need logging:

    from log import logger
    logger.info("Starting fetch")
    logger.error("Something went wrong: {}", exc)

Logs are written to BASE_DIR/weekly_fetch.log (rotated at 5 MB, 3 files kept).
In development, INFO+ messages also appear on stderr.
"""
import sys
from pathlib import Path

# Ensure config is importable when this module is imported from any location
sys.path.insert(0, str(Path(__file__).parent))

from loguru import logger
from config import BASE_DIR

# Remove loguru's default stderr handler (we add our own below)
logger.remove()

# ── File sink ──────────────────────────────────────────────────────────────────
# rotation="5 MB"  → start a new file once this one hits 5 MB
# retention=3      → keep only the 3 most recent log files
logger.add(
    BASE_DIR / "weekly_fetch.log",
    rotation="5 MB",
    retention=3,
    level="DEBUG",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {name}:{line} - {message}",
    encoding="utf-8",
)

# ── Stderr sink (dev convenience) ─────────────────────────────────────────────
logger.add(
    sys.stderr,
    level="INFO",
    format="{time:HH:mm:ss} | <level>{level:<8}</level> | {message}",
    colorize=True,
)
