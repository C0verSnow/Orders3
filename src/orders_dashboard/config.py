"""Environment settings and runtime paths."""
import os
from configparser import ConfigParser, Error as ConfigError
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import tempfile

from croniter import croniter, CroniterError
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config"


@dataclass(frozen=True)
class ScheduleConfig:
    enabled: bool = True
    cron: str = "*/15 * * * *"


def validate_schedule(enabled, expression):
    if type(enabled) is not bool or not isinstance(expression, str):
        raise ValueError("enabled 必须是布尔值，cron 必须是字符串")
    expression = expression.strip()
    try:
        if len(expression.split()) != 5 or not croniter.is_valid(expression):
            raise ValueError("cron 必须为有效的五段表达式：分 时 日 月 星期")
        croniter(expression, datetime.now(), max_years_between_matches=8).get_next(datetime)
    except (CroniterError, ValueError) as error:
        raise ValueError(f"Cron 表达式无效：{error}") from error
    return ScheduleConfig(enabled, expression)


def read_config(path):
    parser = ConfigParser(interpolation=None)
    if path.exists():
        with path.open(encoding="utf-8-sig") as source:
            parser.read_file(source)
    return parser


def load_schedule(path=None):
    path = Path(path) if path is not None else CONFIG_PATH
    try:
        parser = read_config(path)
        return validate_schedule(parser.getboolean("schedule", "enabled", fallback=True),
                                 parser.get("schedule", "cron", fallback="*/15 * * * *"))
    except (ConfigError, ValueError, OSError) as error:
        raise ValueError(f"配置文件 {path} 无效：{error}") from error


def save_schedule(config, path=None):
    """Atomically persist settings while preserving other INI sections."""
    path = Path(path) if path is not None else CONFIG_PATH
    parser = read_config(path)
    if not parser.has_section("schedule"):
        parser.add_section("schedule")
    parser.set("schedule", "enabled", str(config.enabled).lower())
    parser.set("schedule", "cron", config.cron)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         suffix=".tmp", delete=False) as target:
            temporary = Path(target.name)
            parser.write(target)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


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
