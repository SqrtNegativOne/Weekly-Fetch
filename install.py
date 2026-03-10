"""Register a Windows Task Scheduler task for Weekly Fetch.

Run once to install, then the task fires automatically on the configured
day and time (default: every Saturday at 09:00).

Settings are read from settings.json in the project root.
"""
import json
import subprocess
import sys
from pathlib import Path

_ROOT     = Path(__file__).parent
TASK_NAME = "WeeklyFetchDigest"


def main():
    # Read schedule from settings.json (fall back to safe defaults)
    settings_path = _ROOT / "settings.json"
    settings = {"schedule_day": "Saturday", "schedule_time": "09:00"}
    if settings_path.exists():
        settings.update(json.loads(settings_path.read_text(encoding="utf-8")))

    # schtasks /D expects a 3-letter abbreviation: "Saturday" → "SAT"
    day_abbr = settings["schedule_day"][:3].upper()
    run_time = settings["schedule_time"]

    python_exe  = sys.executable
    script_path = _ROOT / "src" / "main.py"   # ← fixed (was "main.py")

    task_cmd = f'"{python_exe}" "{script_path}"'

    cmd = [
        "schtasks", "/Create", "/F",
        "/SC",  "WEEKLY",
        "/D",   day_abbr,
        "/ST",  run_time,
        "/TN",  TASK_NAME,
        "/TR",  task_cmd,
        "/RL",  "LIMITED",
    ]

    subprocess.run(cmd, check=True)
    print(f"Task '{TASK_NAME}' registered: every {settings['schedule_day']} at {run_time}")
    print(f"Script: {script_path}")


if __name__ == "__main__":
    main()
