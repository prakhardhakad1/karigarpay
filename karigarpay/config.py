from dataclasses import dataclass
from pathlib import Path
import os
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def load_env(path):
    """Small literal .env reader; no interpolation and no command execution."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key.startswith("KARIGARPAY_"):
            os.environ.setdefault(key, value)


def flag(key, default="false"):
    value = os.environ.get(key, default).lower()
    if value not in ("true", "false"):
        raise ValueError(f"{key} must be true or false")
    return value == "true"


@dataclass(frozen=True)
class Settings:
    db_path: Path
    upload_dir: Path
    env: str = "development"
    secure_cookies: bool = False
    origins: tuple = ("http://localhost:8000", "http://127.0.0.1:8000")
    hosts: tuple = ("localhost", "127.0.0.1", "[::1]")
    session_hours: int = 12
    max_upload_bytes: int = 5 * 1024 * 1024

    @classmethod
    def from_env(cls):
        load_env(ROOT / ".env")
        env = os.getenv("KARIGARPAY_ENV", "development")
        if env not in {"development", "production", "test"}:
            raise ValueError("KARIGARPAY_ENV must be development, test, or production")
        secure = flag("KARIGARPAY_SECURE_COOKIES")
        origins = tuple(x.strip().rstrip("/") for x in os.getenv("KARIGARPAY_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") if x.strip())
        hosts = tuple(x.strip() for x in os.getenv("KARIGARPAY_HOSTS", "localhost,127.0.0.1,[::1]").split(",") if x.strip())
        hours = int(os.getenv("KARIGARPAY_SESSION_HOURS", "12"))
        if not 1 <= hours <= 48:
            raise ValueError("Session duration must be between 1 and 48 hours")
        if not origins or any(urlparse(o).scheme not in {"https", "http"} or not urlparse(o).netloc or urlparse(o).path for o in origins):
            raise ValueError("Configure explicit origins including scheme, with no path")
        if not hosts:
            raise ValueError("Configure allowed hosts")
        if env == "production" and (not secure or any(not o.startswith("https://") for o in origins)):
            raise ValueError("Production requires secure cookies and HTTPS origins")
        is_vercel = bool(os.getenv("VERCEL"))
        default_db = "/tmp/karigarpay.db" if is_vercel else str(ROOT / "karigarpay.db")
        default_uploads = "/tmp/private_uploads" if is_vercel else str(ROOT / "private_uploads")
        return cls(Path(os.getenv("KARIGARPAY_DB", default_db)),
                   Path(os.getenv("KARIGARPAY_UPLOADS", default_uploads)),
                   env=env, secure_cookies=secure, origins=origins, hosts=hosts,
                   session_hours=hours)
