"""Production and advance ledgers with idempotent writes and immutable approval."""
from hashlib import sha256
import json
from .db import Repo, utc_now
from .errors import AppError, Missing, Conflict, Forbidden
from .money import calculate_work, date_allowed, paise, rupees
from .security import require_owner, new_id
from .workforce import worker_record


def payload_hash(data):
    value = data.model_dump(mode="json", exclude={"request_id"}) if hasattr(data, "model_dump") else data
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def replay(repo, actor, kind, data):
    old = repo.remembered(actor["id"], kind, data.request_id)
    if old and old["payload_hash"] != payload_hash(data):
        raise Conflict("This request ID was already used for different data. Start a new action.")
    return old["entity_id"] if old else None


def submission_public(row, names=None):
    value = {k: v for k, v in row.items() if k not in {"base_paise", "overtime_paise", "rate_snapshot"}}
    value["items"] = json.loads(row["items"])
    value["ot_hours"] = float(row["ot_hours"])
    value["base"] = rupees(row["base_paise"])
    value["overtime"] = rupees(row["overtime_paise"])
    value["total"] = rupees(row["base_paise"] + row["overtime_paise"])
    value["worker_name"] = (names or {}).get(row["worker_id"], "Worker")
    value["photo_url"] = f"/api/photos/{row['photo_id']}" if row["photo_id"] else None
    return value


def advance_public(row, names=None):
    value = {k: v for k, v in row.items() if k != "amount_paise"}
    value["amount"] = rupees(row["amount_paise"])
    value["voided"] = bool(row["voided"])
    value["worker_name"] = (names or {}).get(row["worker_id"], "Worker")
    return value


def worker_names(repo):
    return {r["id"]: r["name"] for r in repo.rows("users", "role='worker'", order="")}


def authorize_worker(actor, worker_id):
    if actor["role"] != "owner" and actor["id"] != worker_id:
        raise Forbidden()


class LedgerService:
    def __init__(self, db):
        self.db = db

    def submissions(self, actor, work_date=None, status=None, worker_id=None, limit=100):
        where, args = ["1=1"], []
        if actor["role"] == "worker":
            if worker_id and worker_id != actor["id"]:
                raise Forbidden()
            worker_id = actor["id"]
        if worker_id:
            where.append("worker_id=?")
            args.append(worker_id)
        if work_date:
            where.append("work_date=?")
            args.append(str(work_date))
        if status:
            where.append("status=?")
            args.append(status)
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            names = worker_names(repo)
            rows = repo.rows("submissions", " AND ".join(where), args, order="work_date DESC,created_at DESC", limit=limit)
            return [submission_public(row, names) for row in rows]

    def submission(self, actor, submission_id):
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            row = repo.one("submissions", submission_id)
            if not row:
                raise Missing("Work entry")
            authorize_worker(actor, row["worker_id"])
            return submission_public(row, worker_names(repo))

    def _values(self, repo, actor, worker, data):
        date_allowed(data.work_date)
        if data.photo_id:
            photo = repo.one("photos", data.photo_id)
            if not photo or (actor["role"] != "owner" and photo["user_id"] != actor["id"]):
                raise Missing("Photo")
        task_map = {t["id"]: t for t in repo.rows("tasks", order="")}
        amounts = calculate_work(worker, repo.business(), data, task_map)
        return {"items": json.dumps(amounts["items"], ensure_ascii=False), "attendance": data.attendance,
            "ot_hours": str(data.ot_hours), "base_paise": amounts["base_paise"], "overtime_paise": amounts["overtime_paise"],
            "payment_model": worker["payment_model"], "rate_snapshot": json.dumps(amounts["rate_snapshot"], ensure_ascii=False),
            "note": data.note, "photo_id": data.photo_id, "updated_at": utc_now()}

    def create_submission(self, actor, data):
        if actor["role"] == "worker" and data.worker_id and data.worker_id != actor["id"]:
            raise Forbidden()
        worker_id = data.worker_id if actor["role"] == "owner" else actor["id"]
        if not worker_id:
            raise AppError("Select the worker for this entry.")
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            existing_id = replay(repo, actor, "submission", data)
            if existing_id:
                return submission_public(repo.one("submissions", existing_id), worker_names(repo))
            worker = worker_record(repo, worker_id, active=True)
            if repo.rows("submissions", "worker_id=? AND work_date=?", (worker_id, str(data.work_date)), order="", limit=1):
                raise Conflict("This worker already has an entry for this date. Edit the existing pending or rejected entry.")
            values = self._values(repo, actor, worker, data)
            row_id = new_id("WRKLOG")
            repo.insert("submissions", {"id": row_id, "worker_id": worker_id, "work_date": str(data.work_date),
                **values, "status": "pending", "created_at": utc_now()})
            repo.remember(actor["id"], "submission", data.request_id, payload_hash(data), row_id)
            repo.audit(actor, "work.submitted", "submission", row_id, {"worker_id": worker_id, "work_date": str(data.work_date)})
            return submission_public(repo.one("submissions", row_id), {worker_id: worker["name"]})

    def edit_submission(self, actor, row_id, data):
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            row = repo.one("submissions", row_id)
            if not row:
                raise Missing("Work entry")
            authorize_worker(actor, row["worker_id"])
            if row["status"] == "approved" or row["settlement_id"]:
                raise Conflict("Approved and settled entries are locked. Only pending or rejected work can be edited.")
            if data.worker_id and data.worker_id != row["worker_id"]:
                raise AppError("A work entry cannot be moved to a different worker.")
            if str(data.work_date) != row["work_date"]:
                raise AppError("The date of an existing entry cannot be changed.")
            worker = worker_record(repo, row["worker_id"], active=True)
            values = self._values(repo, actor, worker, data)
            repo.update("submissions", row_id, {**values, "status": "pending", "review_note": "", "reviewed_at": None, "reviewed_by": None})
            repo.audit(actor, "work.edited", "submission", row_id, {"previous_status": row["status"]})
            return submission_public(repo.one("submissions", row_id), {worker["id"]: worker["name"]})

    def review(self, actor, row_id, data):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            row = repo.one("submissions", row_id)
            if not row:
                raise Missing("Work entry")
            new_status = "approved" if data.action == "approve" else "rejected"
            if row["status"] != "pending":
                raise Conflict("This entry has already been reviewed. Refresh the review queue.")
            repo.update("submissions", row_id, {"status": new_status, "review_note": data.note, "reviewed_by": actor["id"], "reviewed_at": utc_now(), "updated_at": utc_now()})
            repo.audit(actor, "work." + new_status, "submission", row_id)
            return submission_public(repo.one("submissions", row_id), worker_names(repo))

    def approve_all(self, actor, day):
        require_owner(actor)
        date_allowed(day)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            rows = repo.rows("submissions", "work_date=? AND status='pending'", (str(day),), order="")
            for row in rows:
                repo.update("submissions", row["id"], {"status": "approved", "review_note": "", "reviewed_by": actor["id"], "reviewed_at": utc_now(), "updated_at": utc_now()})
                repo.audit(actor, "work.approved", "submission", row["id"], {"bulk": True})
            return len(rows)

    def advances(self, actor, worker_id=None):
        if actor["role"] == "worker":
            if worker_id and worker_id != actor["id"]:
                raise Forbidden()
            worker_id = actor["id"]
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            names = worker_names(repo)
            rows = repo.rows("advances", "worker_id=?" if worker_id else "1=1", (worker_id,) if worker_id else (), order="date DESC,created_at DESC", limit=500)
            return [advance_public(row, names) for row in rows]

    def create_advance(self, actor, data):
        require_owner(actor)
        date_allowed(data.date)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            existing_id = replay(repo, actor, "advance", data)
            if existing_id:
                return advance_public(repo.one("advances", existing_id), worker_names(repo))
            worker = worker_record(repo, data.worker_id, active=True)
            row_id = new_id("ADV")
            repo.insert("advances", {"id": row_id, "worker_id": data.worker_id, "date": str(data.date),
                "amount_paise": paise(data.amount), "note": data.note, "created_at": utc_now(), "actor_id": actor["id"]})
            repo.remember(actor["id"], "advance", data.request_id, payload_hash(data), row_id)
            repo.audit(actor, "advance.recorded", "advance", row_id, {"amount": float(data.amount)})
            return advance_public(repo.one("advances", row_id), {worker["id"]: worker["name"]})

    def void_advance(self, actor, row_id, reason):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            row = repo.one("advances", row_id)
            if not row:
                raise Missing("Advance")
            if row["settlement_id"]:
                raise Conflict("This advance is already part of a settlement and cannot be voided.")
            if row["voided"]:
                raise Conflict("This advance is already voided.")
            repo.update("advances", row_id, {"voided": 1, "void_reason": reason})
            repo.audit(actor, "advance.voided", "advance", row_id, {"reason": reason})
            return advance_public(repo.one("advances", row_id), worker_names(repo))
