"""Snapshot payroll; allocation happens once inside a serialized transaction.

All unallocated approved work and nonvoid advances through the cutoff are used.
Earlier periods carry forward; date filters can never conceal an old advance.
A QR is a payment intent, NOT bank verification. No funds move in this service.
"""
from datetime import date
from hashlib import sha256
from urllib.parse import urlencode, quote
import json
from .db import Repo, utc_now
from .errors import AppError, Conflict, Missing
from .ledger import replay, payload_hash, submission_public, advance_public, authorize_worker, worker_names
from .money import rupees, today_ist, cycle_dates
from .security import new_id, require_owner, public_user
from .workforce import worker_record


def format_inr(paise):
    amount = f"{paise / 100:.2f}"
    integer, fraction = amount.split(".")
    if len(integer) > 3:
        head, tail = integer[:-3], integer[-3:]
        groups = []
        while head:
            groups.insert(0, head[-2:])
            head = head[:-2]
        integer = ",".join(groups + [tail])
    return "₹" + integer + ("." + fraction if fraction != "00" else "")


def slip_links(business, worker, start, end, base, overtime, advances, net, recorded=False):
    text = (f"Namaste {worker['name']} ji, {business['name']} Salary Slip ({start} to {end}):\n"
            f"Total Work Done: {format_inr(base)}\nOvertime: {format_inr(overtime)}\n"
            f"Advance Deducted: -{format_inr(advances)}\nNet Payable: {format_inr(net)}\n"
            "Includes earlier unsettled balances, if any.\n" +
            ("Settlement recorded by owner. Please check receipt of funds." if recorded else "Preview only. Payment not yet recorded."))
    return text, f"https://wa.me/91{worker['phone']}?text={quote(text, safe='')}"


def periods(business, start=None, end=None):
    default_start, default_end, next_pay = cycle_dates(business["settlement_cycle"])
    start, end = start or default_start, end or default_end
    if start > end:
        raise AppError("The start date must not be after the end date.")
    if end > today_ist():
        raise AppError("Payroll cannot include future dates.")
    if start < date(2000, 1, 1):
        raise AppError("Payroll start date must be on or after 1 January 2000.")
    return start, end, next_pay


def build_preview(repo, worker, start, end, source=None):
    business = repo.business()
    if source is None:
        work = repo.rows("submissions", "worker_id=? AND work_date<=? AND settlement_id IS NULL AND status='approved'", (worker["id"], str(end)), order="work_date,id")
        advances = repo.rows("advances", "worker_id=? AND date<=? AND settlement_id IS NULL AND voided=0", (worker["id"], str(end)), order="date,id")
        pending = repo.rows("submissions", "worker_id=? AND work_date<=? AND status='pending'", (worker["id"], str(end)), order="id")
    else:
        work, advances, pending = source
    base = sum(r["base_paise"] for r in work)
    overtime = sum(r["overtime_paise"] for r in work)
    deductions = sum(r["amount_paise"] for r in advances)
    gross, net = base + overtime, base + overtime - deductions
    carry = {"base": rupees(sum(r["base_paise"] for r in work if r["work_date"] < str(start))),
             "overtime": rupees(sum(r["overtime_paise"] for r in work if r["work_date"] < str(start))),
             "advances": rupees(sum(r["amount_paise"] for r in advances if r["date"] < str(start)))}
    signature = {"business_id": business["id"], "worker_id": worker["id"], "upi_id": worker["upi_id"],
        "worker_name": worker["name"], "phone": worker["phone"], "business_name": business["name"],
        "start": str(start), "end": str(end), "work": [(r["id"], r["base_paise"], r["overtime_paise"], r["updated_at"]) for r in work],
        "advances": [(r["id"], r["amount_paise"]) for r in advances], "pending": [(r["id"], r["updated_at"]) for r in pending]}
    fingerprint = sha256(json.dumps(signature, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    text, whatsapp = slip_links(business, worker, start, end, base, overtime, deductions, net)
    upi, qr_url = None, None
    if worker["upi_id"] and net > 0 and not pending:
        upi = "upi://pay?" + urlencode({"pa": worker["upi_id"], "pn": worker["name"], "am": f"{net / 100:.2f}",
            "cu": "INR", "tn": f"KarigarPay wages through {end}", "tr": "KP" + fingerprint[:20]})
        qr_url = "/api/payroll/qr?" + urlencode({"worker_id": worker["id"], "start": str(start), "end": str(end), "fingerprint": fingerprint})
    names = {worker["id"]: worker["name"]}
    return {"worker": public_user(worker), "start": str(start), "end": str(end),
        "base": rupees(base), "overtime": rupees(overtime), "gross": rupees(gross), "advances": rupees(deductions), "net": rupees(net),
        "pending_count": len(pending), "count": len(work), "entries": [submission_public(r, names) for r in work],
        "advance_entries": [advance_public(r, names) for r in advances], "carry_in": carry, "fingerprint": fingerprint,
        "whatsapp_text": text, "whatsapp_url": whatsapp, "upi_uri": upi, "qr_url": qr_url}


def settlement_public(row):
    snapshot = json.loads(row["snapshot"])
    return {"id": row["id"], "worker_id": row["worker_id"], "worker_name": snapshot["worker_name"],
        "business_name": snapshot["business_name"], "start": row["start"], "end": row["end"],
        "base": rupees(row["base_paise"]), "overtime": rupees(row["overtime_paise"]), "advances": rupees(row["advances_paise"]),
        "net": rupees(row["net_paise"]), "method": row["method"], "reference": row["reference"], "created_at": row["created_at"],
        "whatsapp_text": snapshot["whatsapp_text"], "whatsapp_url": snapshot["whatsapp_url"],
        "entries": snapshot["entries"], "advance_entries": snapshot["advance_entries"],
        "verification": "owner_confirmed_only"}


class PayrollService:
    def __init__(self, db):
        self.db = db

    def preview(self, actor, worker_id, start=None, end=None):
        require_owner(actor)
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            worker = worker_record(repo, worker_id)
            start, end, _ = periods(repo.business(), start, end)
            return build_preview(repo, worker, start, end)

    def payroll(self, actor, start=None, end=None):
        require_owner(actor)
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            start, end, next_pay = periods(repo.business(), start, end)
            workers = repo.rows("users", "role='worker'", order="name COLLATE NOCASE")
            approved = repo.rows("submissions", "work_date<=? AND settlement_id IS NULL AND status='approved'", (str(end),), order="work_date,id")
            pending = repo.rows("submissions", "work_date<=? AND status='pending'", (str(end),), order="id")
            advances = repo.rows("advances", "date<=? AND settlement_id IS NULL AND voided=0", (str(end),), order="date,id")
            grouped = {w["id"]: [[], [], []] for w in workers}
            for index, collection in enumerate((approved, advances, pending)):
                for row in collection:
                    grouped[row["worker_id"]][index].append(row)
            rows = [build_preview(repo, w, start, end, grouped[w["id"]]) for w in workers if w["active"] or any(grouped[w["id"]])]
            base = sum(r["base_paise"] for r in approved)
            overtime = sum(r["overtime_paise"] for r in approved)
            deductions = sum(r["amount_paise"] for r in advances)
            return {"start": str(start), "end": str(end), "rows": rows,
                "totals": {"base": rupees(base), "overtime": rupees(overtime), "advances": rupees(deductions), "net": rupees(base + overtime - deductions)},
                "next_payout": str(next_pay)}

    def settle(self, actor, data):
        require_owner(actor)
        with self.db.transaction(write=True) as conn:
            repo = Repo(conn, actor["business_id"])
            old = replay(repo, actor, "settlement", data)
            if old:
                return settlement_public(repo.one("settlements", old))
            worker = worker_record(repo, data.worker_id)
            business = repo.business()
            start, end, _ = periods(business, data.start, data.end)
            preview = build_preview(repo, worker, start, end)
            if preview["fingerprint"] != data.fingerprint:
                raise Conflict("Payroll changed since your preview. Refresh and check the new total before confirming payment.")
            if preview["pending_count"]:
                raise Conflict("Review all pending work through this date before settling payroll.")
            if not preview["entries"] and not preview["advance_entries"]:
                raise Conflict("There are no unsettled records in this payroll.")
            from .money import paise
            base, overtime, deductions, net = (paise(preview[k]) for k in ("base", "overtime", "advances", "net"))
            if net < 0:
                raise Conflict("Advances exceed earnings. The balance carries forward; no payment is due yet.")
            if net == 0 and data.method != "adjustment":
                raise AppError("Choose adjustment for a zero-rupee settlement.")
            if net > 0 and data.method == "adjustment":
                raise AppError("A positive wage balance must be paid using cash or UPI.")
            if data.method == "upi" and not worker["upi_id"]:
                raise AppError("Add this worker's UPI ID before recording a UPI settlement.")
            row_id = new_id("PAY")
            text, whatsapp = slip_links(business, worker, start, end, base, overtime, deductions, net, recorded=True)
            snapshot = {"worker_name": worker["name"], "business_name": business["name"], "phone": worker["phone"],
                "upi_id": worker["upi_id"], "entries": preview["entries"], "advance_entries": preview["advance_entries"],
                "whatsapp_text": text, "whatsapp_url": whatsapp, "fingerprint": preview["fingerprint"]}
            repo.insert("settlements", {"id": row_id, "worker_id": worker["id"], "start": str(start), "end": str(end),
                "base_paise": base, "overtime_paise": overtime, "advances_paise": deductions, "net_paise": net,
                "method": data.method, "reference": data.reference, "snapshot": json.dumps(snapshot, ensure_ascii=False),
                "created_at": utc_now(), "actor_id": actor["id"]})
            for row in preview["entries"]:
                repo.update("submissions", row["id"], {"settlement_id": row_id})
            for row in preview["advance_entries"]:
                repo.update("advances", row["id"], {"settlement_id": row_id})
            repo.remember(actor["id"], "settlement", data.request_id, payload_hash(data), row_id)
            repo.audit(actor, "payroll.settled", "settlement", row_id, {"worker_id": worker["id"], "net": rupees(net), "method": data.method, "verification": "owner_confirmed"})
            return settlement_public(repo.one("settlements", row_id))

    def settlements(self, actor, worker_id=None):
        if actor["role"] == "worker":
            authorize_worker(actor, worker_id or actor["id"])
            worker_id = actor["id"]
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            rows = repo.rows("settlements", "worker_id=?" if worker_id else "1=1", (worker_id,) if worker_id else (), limit=500)
            return [settlement_public(row) for row in rows]

    def settlement(self, actor, row_id):
        with self.db.transaction() as conn:
            repo = Repo(conn, actor["business_id"])
            row = repo.one("settlements", row_id)
            if not row:
                raise Missing("Settlement")
            authorize_worker(actor, row["worker_id"])
            return settlement_public(row)
