"""Fetch trailing orders directly, without command-line options."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orders_dashboard.trailing import main

if __name__ == "__main__":
    raise SystemExit(main())
