"""Environment settings and runtime paths."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


def default_output():
    configured = os.environ.get("ORDERS_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve() / "data.db"
    repository = Path(__file__).resolve().parents[2]
    directory = repository / "data" if (repository / "pyproject.toml").is_file() else Path.home() / ".orders-dashboard"
    return directory / "data.db"


def validate_output(output):
    """SQLite output must not masquerade as a JSON export."""
    output = Path(output).expanduser().resolve()
    if output.suffix.lower() not in {".db", ".sqlite", ".sqlite3"}:
        raise ValueError("输出文件必须使用 .db、.sqlite 或 .sqlite3 后缀；不再生成 JSON 文件")
    return output
