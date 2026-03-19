import sys
from pathlib import Path

# Make bare imports like `from schedule import ...` work from the tests/ directory.
sys.path.insert(0, str(Path(__file__).parent / "src"))
