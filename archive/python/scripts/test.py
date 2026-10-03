"""Run the checkout test suite without an editable installation."""
from pathlib import Path
import sys
import unittest

repository = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repository / "src"))
suite = unittest.defaultTestLoader.discover(str(repository / "tests"))
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
