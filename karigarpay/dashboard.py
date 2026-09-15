from datetime import timedelta
import json
from .db import Repo
from .ledger import submission_public, worker_names
from .money import today_ist, rupees, cycle_dates
from .security import require_owner, public_user, public_business
from .payroll import settlement_public


class DashboardService:
    def __init__(self, db):
        self.db = db

    def owner(self, actor, day=None):
        require_owner(actor)
        day = day or today_ist()
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            business = repo.business()
            workers = repo.rows("users", "role='worker'", order="")
            names = {w["id"]: w["name"] for w in workers}
            pending = repo.rows("submissions", "status='pending'", order="work_date,created_at")
            recent = repo.rows("submissions", "work_date>=? AND work_date<=? AND status!='rejected'", (str(day - timedelta(days=6)), str(day)), order="work_date")
            unsettled = repo.rows("submissions", "status='approved' AND settlement_id IS NULL", order="")
            advances = repo.rows("advances", "settlement_id IS NULL AND voided=0", order="")
            this_day = [r for r in recent if r["work_date"] == str(day)]
            approved = [r for r in this_day if r["status"] == "approved"]
            balances = {w["id"]: 0 for w in workers}
            for row in unsettled:
                balances[row["worker_id"]] += row["base_paise"] + row["overtime_paise"]
            for row in advances:
                balances[row["worker_id"]] -= row["amount_paise"]
            week = []
            for offset in range(6, -1, -1):
                date = str(day - timedelta(days=offset))
                entries = [r for r in recent if r["work_date"] == date and r["status"] == "approved"]
                base = sum(r["base_paise"] for r in entries)
                overtime = sum(r["overtime_paise"] for r in entries)
                week.append({"date": date, "work": rupees(base), "overtime": rupees(overtime), "total": rupees(base + overtime), "workers": len(entries)})
            audit = repo.rows("audit", order="id DESC", limit=8)
            for r in audit:
                r["detail"] = json.loads(r["detail"])
            return {"date": str(day), "worker_count": sum(w["active"] for w in workers), "pending_count": len(pending),
                "approved_today": len(approved), "work_today": rupees(sum(r["base_paise"] for r in approved)),
                "overtime_today": rupees(sum(r["overtime_paise"] for r in approved)),
                "total_outstanding": rupees(sum(max(0, value) for value in balances.values())),
                "total_advances": rupees(sum(r["amount_paise"] for r in advances)),
                "attendance": {a: sum(r["attendance"] == a for r in this_day) for a in ("full", "half", "absent")},
                "week": week, "pending_submissions": [submission_public(r, names) for r in pending[:12]],
                "activity": audit, "payroll_due_on": str(cycle_dates(business["settlement_cycle"])[2])}

    def worker(self, actor):
        from .errors import Forbidden
        if actor["role"] != "worker":
            raise Forbidden("This dashboard belongs to worker accounts.")
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            worker = repo.one("users", actor["id"])
            entries = repo.rows("submissions", "worker_id=?", (actor["id"],), order="work_date DESC,created_at DESC")
            advances = repo.rows("advances", "worker_id=? AND settlement_id IS NULL AND voided=0", (actor["id"],), order="")
            approved = sum(r["base_paise"] + r["overtime_paise"] for r in entries if r["status"] == "approved" and not r["settlement_id"])
            pending = sum(r["base_paise"] + r["overtime_paise"] for r in entries if r["status"] == "pending")
            deductions = sum(r["amount_paise"] for r in advances)
            names = {worker["id"]: worker["name"]}
            this_day = next((submission_public(r, names) for r in entries if r["work_date"] == str(today_ist())), None)
            settlements = repo.rows("settlements", "worker_id=?", (actor["id"],), limit=10)
            return {"worker": public_user(worker), "business": public_business(repo.business()), "today_submission": this_day,
                "approved_earnings": rupees(approved), "pending_earnings": rupees(pending),
                "advances_balance": rupees(deductions), "unsettled_net": rupees(approved - deductions),
                "recent_submissions": [submission_public(r, names) for r in entries[:20]], "settlements": [settlement_public(r) for r in settlements]}
