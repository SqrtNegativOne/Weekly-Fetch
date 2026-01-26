import subprocess
import sys
from pathlib import Path

TASK_NAME = "WeeklyRedditDigest"
RUN_DAY = "MON"
RUN_TIME = "09:00"

def main():
    python_exe = sys.executable
    script_path = Path(__file__).parent / "main.py"
    start_dir = script_path.parent

    cmd = [
        "schtasks",
        "/Create",
        "/F",
        "/SC", "WEEKLY",
        "/D", RUN_DAY,
        "/ST", RUN_TIME,
        "/TN", TASK_NAME,
        "/TR",
        f'"{python_exe}" "{script_path}"',
        "/RL", "LIMITED",
        "/WD", str(start_dir)
    ]

    subprocess.run(" ".join(cmd), shell=True, check=True)

if __name__ == "__main__":
    main()
