"""Opaque, server-side sessions, salted scrypt PINs, DB-backed throttling."""
from datetime import datetime, timezone
import hashlib
import hmac
import secrets
import time
import json
from .db import Repo, utc_now
from .errors import AppError, Forbidden
from .schemas import OTPolicy

COOKIE = "karigarpay_session"


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_pin(pin):
    salt = secrets.token_bytes(16)
    value = hashlib.scrypt(pin.encode("ascii"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${value.hex()}"


def check_pin(pin, stored):
    try:
        scheme, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(pin.encode("ascii"), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError, UnicodeEncodeError):
        return False


def new_id(prefix):
    return prefix + "-" + secrets.token_hex(4).upper()


def throttled(db, namespace, value, limit, window):
    """Count attempts in its own transaction so failed auth never rolls it back."""
    key = digest(namespace + ":" + value)
    now = int(time.time())
    with db.transaction(write=True) as conn:
        conn.execute("DELETE FROM auth_attempts WHERE expires_at<=?", (now,))
        row = conn.execute("SELECT attempts FROM auth_attempts WHERE key=?", (key,)).fetchone()
        if row and row[0] >= limit:
            raise AppError("Too many attempts. Wait 15 minutes and try again.", "RATE_LIMITED", 429)
        conn.execute("INSERT INTO auth_attempts(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1", (key, now + window))
    return key


def public_business(row):
    return {k: (json.loads(v) if k == "overtime_policy" else v) for k, v in row.items()}


def public_user(row):
    result = {k: v for k, v in row.items() if k not in {"pin_hash", "salary_paise", "overtime_policy"}}
    result["salary"] = row["salary_paise"] / 100
    result["active"] = bool(row["active"])
    result["overtime_policy"] = json.loads(row["overtime_policy"]) if row["overtime_policy"] else None
    return result


class AuthService:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings

    def _create_session(self, conn, user_id):
        token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
        now = int(time.time())
        conn.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
        # Bounded simultaneous sessions: newest ten retained.
        ids = conn.execute("SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 9", (user_id,)).fetchall()
        for row in ids:
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (row[0],))
        conn.execute("INSERT INTO sessions VALUES(?,?,?,?,?)", (digest(token), user_id, csrf, now + self.settings.session_hours * 3600, utc_now()))
        return token, csrf

    def register(self, data, client_ip):
        throttled(self.db, "register", client_ip, 10, 3600)
        with self.db.transaction(write=True) as conn:
            business_id = new_id("BIZ")
            owner_id = new_id("OWN")
            now = utc_now()
            conn.execute("INSERT INTO businesses(id,name,owner_name,owner_phone,overtime_policy,created_at) VALUES(?,?,?,?,?,?)",
                         (business_id, data.name, data.owner_name, data.owner_phone, OTPolicy().model_dump_json(), now))
            repo = Repo(conn, business_id)
            repo.insert("users", {"id": owner_id, "name": data.owner_name, "phone": data.owner_phone,
                "pin_hash": hash_pin(data.pin), "role": "owner", "created_at": now})
            defaults = [("Packing", "dozen", 1500, ["packing", "पैकिंग", "pack"]),
                        ("Sewing", "dozen", 3000, ["sewing", "सिलाई", "silai"]),
                        ("Cutting", "piece", 1000, ["cutting", "कटिंग", "katai", "कटाई"]),
                        ("Assembly", "unit", 5000, ["assembly", "असेंबली", "jodai", "जोड़ाई"])]
            for name, unit, rate, aliases in defaults:
                repo.insert("tasks", {"id": new_id("TSK"), "name": name, "unit": unit, "rate_paise": rate,
                    "aliases": json.dumps(aliases, ensure_ascii=False), "created_at": now})
            owner = repo.one("users", owner_id)
            repo.audit(owner, "business.created", "business", business_id)
            token, csrf = self._create_session(conn, owner_id)
            return token, {"user": public_user(owner), "business": public_business(repo.business()), "csrf_token": csrf}

    def login(self, data, client_ip):
        throttled(self.db, "login-ip", client_ip, 50, 900)
        account = throttled(self.db, "login-account", f"{data.business_id}:{data.phone}", 8, 900)
        with self.db.transaction(write=True) as conn:
            row = conn.execute("SELECT * FROM users WHERE business_id=? AND phone=? AND role=?", (data.business_id, data.phone, data.role)).fetchone()
            user = dict(row) if row else None
            # Equal-cost verification for unknown users prevents a cheap account oracle.
            stored = user["pin_hash"] if user else "scrypt$00000000000000000000000000000000$" + "0" * 64
            valid = check_pin(data.pin, stored)
            if not user or not valid or not user["active"]:
                raise AppError("Business code, phone or PIN is incorrect, or this account is inactive.", "INVALID_CREDENTIALS", 401)
            conn.execute("DELETE FROM auth_attempts WHERE key=?", (account,))
            token, csrf = self._create_session(conn, user["id"])
            repo = Repo(conn, user["business_id"])
            repo.audit(user, "session.login", "user", user["id"])
            return token, {"user": public_user(user), "business": public_business(repo.business()), "csrf_token": csrf}

    def authenticate(self, token):
        if not token:
            raise AppError("Please sign in to continue.", "UNAUTHENTICATED", 401)
        with self.db.transaction() as conn:
            row = conn.execute("SELECT u.*, s.csrf_token, s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
                               (digest(token), int(time.time()))).fetchone()
            if not row:
                raise AppError("Your session expired. Sign in again.", "UNAUTHENTICATED", 401)
            user = dict(row)
            user["session_hash"] = user.pop("token_hash")
            return user

    def me(self, actor):
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            return {"user": public_user(repo.one("users", actor["id"])), "business": public_business(repo.business()), "csrf_token": actor["csrf_token"]}

    def logout(self, actor):
        with self.db.transaction(write=True) as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (actor["session_hash"],))

    def change_pin(self, actor, data):
        throttled(self.db, "pin-change", actor["id"], 8, 900)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            current = repo.one("users", actor["id"])
            if not check_pin(data.old_pin, current["pin_hash"]):
                raise AppError("Current PIN is incorrect.", "INVALID_CREDENTIALS", 401)
            if data.old_pin == data.new_pin:
                raise AppError("Choose a different PIN.")
            repo.update("users", actor["id"], {"pin_hash": hash_pin(data.new_pin)})
            conn.execute("DELETE FROM sessions WHERE user_id=?", (actor["id"],))
            repo.audit(actor, "pin.changed", "user", actor["id"])


def require_owner(actor):
    if actor["role"] != "owner":
        raise Forbidden()
