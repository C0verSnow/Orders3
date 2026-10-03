"""Run the source checkout with the same entry point as the installed package."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from orders_dashboard.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
