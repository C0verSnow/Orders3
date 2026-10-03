"""Entry point for the self-contained release executables."""
import os
import sys

from orders_dashboard.cli import main


if __name__ == "__main__":
    arguments = sys.argv[1:]
    overrides = {"--browser", "--no-browser", "--fetch-only", "--list", "--desktop", "--help", "-h"}
    if os.name == "nt" and not overrides.intersection(arguments):
        arguments = ["--desktop", *arguments]
    raise SystemExit(main(arguments))
