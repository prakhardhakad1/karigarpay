"""Business, staff and catalog services. HTTP-free, tenant-scoped."""
import json
from .db import Repo, utc_now
from .errors import AppError, Missing, Conflict
from .money import paise
from .security import require_owner, public_user, public_business, new_id, hash_pin


def task_public(row):
    return {"id": row["id"], "name": row["name"], "unit": row["unit"], "rate": row["rate_paise"] / 100,
            "aliases": json.loads(row["aliases"]), "active": bool(row["active"]), "created_at": row["created_at"]}


def worker_record(repo, worker_id, active=False):
    row = repo.one("users", worker_id)
    if not row or row["role"] != "worker":
        raise Missing("Worker")
    if active and not row["active"]:
        raise AppError("This worker is archived. Restore the account before adding work.")
    return row


class WorkforceService:
    def __init__(self, db):
        self.db = db

    def business(self, actor):
        with self.db.transaction() as conn:
            return public_business(Repo(conn, actor["business_id"]).business())

    def update_business(self, actor, data):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            values = data.model_dump(exclude_unset=True)
            if "overtime_policy" in values:
                values["overtime_policy"] = data.overtime_policy.model_dump_json()
            repo.update_business(values)
            if "owner_name" in values:
                repo.update("users", actor["id"], {"name": values["owner_name"]})
            repo.audit(actor, "business.updated", "business", actor["business_id"], {"fields": list(values)})
            return public_business(repo.business())

    def workers(self, actor):
        require_owner(actor)
        with self.db.transaction() as conn:
            return [public_user(r) for r in Repo(conn, actor["business_id"]).rows("users", "role='worker'", order="active DESC, name COLLATE NOCASE")]

    def create_worker(self, actor, data):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            if repo.rows("users", "phone=?", (data.phone,), order="", limit=1):
                raise Conflict("This phone already belongs to an account in your business.")
            worker_id = new_id("WRK")
            repo.insert("users", {"id": worker_id, "name": data.name, "phone": data.phone, "pin_hash": hash_pin(data.pin),
                "role": "worker", "payment_model": data.payment_model, "salary_paise": paise(data.salary), "upi_id": data.upi_id,
                "overtime_policy": data.overtime_policy.model_dump_json() if data.overtime_policy else None, "created_at": utc_now()})
            repo.audit(actor, "worker.created", "worker", worker_id, {"payment_model": data.payment_model})
            return public_user(repo.one("users", worker_id))

    def update_worker(self, actor, worker_id, data):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            current = worker_record(repo, worker_id)
            values = data.model_dump(exclude_unset=True)
            if "phone" in values:
                existing = repo.rows("users", "phone=? AND id!=?", (data.phone, worker_id), order="", limit=1)
                if existing:
                    raise Conflict("This phone already belongs to an account in your business.")
            if "salary" in values:
                values["salary_paise"] = paise(values.pop("salary"))
            effective_model = values.get("payment_model", current["payment_model"])
            effective_salary = values.get("salary_paise", current["salary_paise"])
            if effective_model != "piece" and effective_salary <= 0:
                raise AppError("Daily or monthly workers need a positive base salary.")
            if "overtime_policy" in values:
                values["overtime_policy"] = data.overtime_policy.model_dump_json() if data.overtime_policy else None
            changed_fields = list(values)
            if "pin" in values:
                values["pin_hash"] = hash_pin(values.pop("pin"))
            if "active" in values:
                values["active"] = int(values["active"])
            if values:
                repo.update("users", worker_id, values)
            if "pin_hash" in values or values.get("active") == 0 or "phone" in values:
                conn.execute("DELETE FROM sessions WHERE user_id=?", (worker_id,))
            repo.audit(actor, "worker.updated", "worker", worker_id, {"fields": changed_fields})
            return public_user(repo.one("users", worker_id))

    def tasks(self, actor):
        with self.db.transaction() as conn:
            rows = Repo(conn, actor["business_id"]).rows("tasks", "1=1" if actor["role"] == "owner" else "active=1", order="active DESC,name COLLATE NOCASE")
            return [task_public(r) for r in rows]

    def create_task(self, actor, data):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            if repo.rows("tasks", "lower(name)=lower(?)", (data.name,), order="", limit=1):
                raise Conflict("A task with this name already exists. Edit or restore it instead.")
            task_id = new_id("TSK")
            repo.insert("tasks", {"id": task_id, "name": data.name, "unit": data.unit, "rate_paise": paise(data.rate),
                "aliases": json.dumps(list(dict.fromkeys(data.aliases)), ensure_ascii=False), "created_at": utc_now()})
            repo.audit(actor, "task.created", "task", task_id)
            return task_public(repo.one("tasks", task_id))

    def update_task(self, actor, task_id, data):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            if not repo.one("tasks", task_id):
                raise Missing("Task")
            values = data.model_dump(exclude_unset=True)
            if "name" in values and repo.rows("tasks", "lower(name)=lower(?) AND id!=?", (data.name, task_id), order="", limit=1):
                raise Conflict("Another task already uses this name.")
            if "rate" in values:
                values["rate_paise"] = paise(values.pop("rate"))
            if "aliases" in values:
                values["aliases"] = json.dumps(list(dict.fromkeys(values["aliases"])), ensure_ascii=False)
            if "active" in values:
                values["active"] = int(values["active"])
            if values:
                repo.update("tasks", task_id, values)
            repo.audit(actor, "task.updated", "task", task_id, {"fields": list(values)})
            return task_public(repo.one("tasks", task_id))

    def audit(self, actor, limit=100):
        require_owner(actor)
        with self.db.transaction() as conn:
            rows = Repo(conn, actor["business_id"]).rows("audit", order="id DESC", limit=limit)
            for row in rows:
                row["detail"] = json.loads(row["detail"])
            return rows
