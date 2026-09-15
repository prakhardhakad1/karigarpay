"""Database connectivity: Supports both native SQLite and Turso Cloud (libSQL).

When TURSO_DB_URL and TURSO_AUTH_TOKEN are set, connects over HTTPS to Turso cloud.
Otherwise, connects to local SQLite file for offline/local development.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import os
import json
import sqlite3
import httpx

TABLES = {"users", "tasks", "photos", "submissions", "advances", "settlements", "audit", "idempotency"}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class TursoRow(dict):
    """Compatible with sqlite3.Row: accessible by column name, integer index, or dict()."""
    def __init__(self, cols, values):
        super().__init__(zip(cols, values))
        self._cols = cols
        self._values = list(values)

    def __getitem__(self, item):
        if isinstance(item, int):
            return self._values[item]
        return super().__getitem__(item)


class TursoCursor:
    def __init__(self, cols, rows, affected_row_count=0, last_insert_rowid=None):
        self._cols = cols
        self._rows = rows
        self.rowcount = affected_row_count
        self.lastrowid = last_insert_rowid
        self._idx = 0

    def fetchall(self):
        return [TursoRow(self._cols, r) for r in self._rows]

    def fetchone(self):
        if self._idx < len(self._rows):
            row = TursoRow(self._cols, self._rows[self._idx])
            self._idx += 1
            return row
        return None


class TursoConnection:
    def __init__(self, url, token):
        clean_url = url.replace("libsql://", "https://").rstrip("/")
        self.url = f"{clean_url}/v2/pipeline"
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.baton = None
        self.client = httpx.Client(timeout=20)

    def _to_arg(self, val):
        if val is None:
            return {"type": "null"}
        if isinstance(val, bool):
            return {"type": "integer", "value": "1" if val else "0"}
        if isinstance(val, int):
            return {"type": "integer", "value": str(val)}
        if isinstance(val, float):
            return {"type": "float", "value": val}
        return {"type": "text", "value": str(val)}

    def _parse_val(self, col):
        t = col.get("type")
        v = col.get("value")
        if t == "null" or v is None:
            return None
        if t == "integer":
            return int(v)
        if t == "float":
            return float(v)
        return v

    def execute(self, sql, parameters=()):
        stripped = sql.strip().upper()
        if stripped.startswith("PRAGMA "):
            return TursoCursor([], [])

        args = [self._to_arg(p) for p in parameters]
        stmt = {"sql": sql}
        if args:
            stmt["args"] = args

        body = {"requests": [{"type": "execute", "stmt": stmt}]}
        if self.baton:
            body["baton"] = self.baton

        res = self.client.post(self.url, headers=self.headers, json=body)
        data = res.json()
        if "baton" in data:
            self.baton = data["baton"]

        results = data.get("results", [])
        if not results:
            if "error" in data:
                raise sqlite3.OperationalError(str(data["error"]))
            return TursoCursor([], [])

        r = results[0]
        if r.get("type") == "error":
            err = r.get("error", {}).get("message", "Database error")
            if "UNIQUE constraint failed" in err or "CHECK constraint failed" in err or "immutable" in err:
                raise sqlite3.IntegrityError(err)
            raise sqlite3.OperationalError(err)

        exec_res = r.get("response", {}).get("result", {})
        cols = [c["name"] for c in exec_res.get("cols", [])]
        rows = [[self._parse_val(col) for col in row] for row in exec_res.get("rows", [])]
        return TursoCursor(cols, rows, exec_res.get("affected_row_count", 0), exec_res.get("last_insert_rowid"))

    def commit(self):
        if self.baton:
            body = {"baton": self.baton, "requests": [{"type": "execute", "stmt": {"sql": "COMMIT"}}]}
            try:
                self.client.post(self.url, headers=self.headers, json=body)
            except Exception:
                pass
            self.baton = None

    def rollback(self):
        if self.baton:
            body = {"baton": self.baton, "requests": [{"type": "execute", "stmt": {"sql": "ROLLBACK"}}]}
            try:
                self.client.post(self.url, headers=self.headers, json=body)
            except Exception:
                pass
            self.baton = None

    def close(self):
        self.rollback()
        self.client.close()


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        env_file = Path(__file__).resolve().parent.parent / ".env"
        if not os.getenv("TURSO_DB_URL") and env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
        self.turso_url = os.getenv("TURSO_DB_URL")
        self.turso_token = os.getenv("TURSO_AUTH_TOKEN")
        self.use_turso = bool(self.turso_url and self.turso_token)

    def connect(self):
        if self.use_turso:
            return TursoConnection(self.turso_url, self.turso_token)
        conn = sqlite3.connect(str(self.path), timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=15000")
        conn.execute("PRAGMA synchronous=FULL")
        return conn

    def initialize(self):
        if self.use_turso:
            # Verified schema on Turso Cloud
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
            migrations = Path(__file__).resolve().parent.parent / "migrations"
            for path in sorted(migrations.glob("[0-9]*.sql")):
                version = int(path.name.split("_", 1)[0])
                if conn.execute("SELECT 1 FROM schema_migrations WHERE version=?", (version,)).fetchone():
                    continue
                sql = path.read_text(encoding="utf-8")
                stamp = utc_now().replace("'", "''")
                try:
                    conn.executescript(f"BEGIN IMMEDIATE;\n{sql}\nINSERT INTO schema_migrations VALUES ({version},'{stamp}');\nCOMMIT;")
                except Exception:
                    if conn.in_transaction:
                        conn.rollback()
                    raise
        conn.close()

    @contextmanager
    def transaction(self, write=False):
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def healthy(self):
        with self.transaction() as conn:
            cur = conn.execute("SELECT COUNT(*) FROM schema_migrations")
            row = cur.fetchone()
            return (row[0] if row else 0) >= 1


class Repo:
    """Every domain lookup is automatically constrained to its business."""
    def __init__(self, conn, business_id):
        self.conn, self.business_id = conn, business_id

    def rows(self, table, where="1=1", args=(), order="created_at DESC", limit=None):
        if table not in TABLES:
            raise ValueError("Unknown table")
        query = f"SELECT * FROM {table} WHERE business_id=? AND ({where})"
        if order:
            query += f" ORDER BY {order}"
        parameters = [self.business_id, *args]
        if limit is not None:
            query += " LIMIT ?"
            parameters.append(limit)
        return [dict(r) for r in self.conn.execute(query, parameters).fetchall()]

    def one(self, table, record_id):
        rows = self.rows(table, "id=?", (record_id,), order="", limit=1)
        return rows[0] if rows else None

    def insert(self, table, values):
        if table not in TABLES:
            raise ValueError("Unknown table")
        values = {**values, "business_id": self.business_id}
        keys = list(values)
        self.conn.execute(f"INSERT INTO {table} ({','.join(keys)}) VALUES ({','.join('?' for _ in keys)})", list(values.values()))

    def update(self, table, record_id, values):
        if table not in TABLES or not values:
            raise ValueError("Invalid update")
        if "business_id" in values or "id" in values:
            raise ValueError("Identifiers cannot be changed")
        return self.conn.execute(f"UPDATE {table} SET {','.join(k+'=?' for k in values)} WHERE business_id=? AND id=?", [*values.values(), self.business_id, record_id]).rowcount

    def business(self):
        row = self.conn.execute("SELECT * FROM businesses WHERE id=?", (self.business_id,)).fetchone()
        return dict(row) if row else None

    def update_business(self, values):
        if not values:
            return
        self.conn.execute(f"UPDATE businesses SET {','.join(k+'=?' for k in values)} WHERE id=?", [*values.values(), self.business_id])

    def audit(self, actor, action, entity_type, entity_id, detail=None):
        self.insert("audit", {"actor_id": actor["id"], "actor_name": actor["name"], "action": action,
            "entity_type": entity_type, "entity_id": entity_id, "detail": json.dumps(detail or {}, ensure_ascii=False), "created_at": utc_now()})

    def remembered(self, user_id, kind, request_id):
        result = self.rows("idempotency", "user_id=? AND kind=? AND request_id=?", (user_id, kind, str(request_id)), order="", limit=1)
        return result[0] if result else None

    def remember(self, user_id, kind, request_id, payload_hash, entity_id):
        self.insert("idempotency", {"user_id": user_id, "kind": kind, "request_id": str(request_id),
            "payload_hash": payload_hash, "entity_id": entity_id, "created_at": utc_now()})
