"""Short-lived SQLite connections, serialized writes, versioned initialization.

SQLite has no remote connection overhead; one connection per transaction avoids
sharing cursors across FastAPI worker threads. WAL permits concurrent readers.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import json
import sqlite3

TABLES = {"users", "tasks", "photos", "submissions", "advances", "settlements", "audit", "idempotency"}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)

    def connect(self):
        conn = sqlite3.connect(str(self.path), timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=15000")
        conn.execute("PRAGMA synchronous=FULL")
        return conn

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
            migrations = Path(__file__).resolve().parent.parent / "migrations"
            for path in sorted(migrations.glob("[0-9]*.sql")):
                version = int(path.name.split("_", 1)[0])
                if conn.execute("SELECT 1 FROM schema_migrations WHERE version=?", (version,)).fetchone():
                    continue
                # executescript is intentionally one atomic transaction per migration.
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
            return conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] >= 1


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
