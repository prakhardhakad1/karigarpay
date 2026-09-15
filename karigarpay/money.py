"""Exact rupee/paise arithmetic. Historical approved work is never repriced."""
from datetime import datetime, date, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
import json
from .errors import AppError

IST = timezone(timedelta(hours=5, minutes=30))
D = Decimal


def today_ist():
    return datetime.now(IST).date()


def paise(value):
    return int((D(str(value)) * 100).quantize(D("1"), rounding=ROUND_HALF_UP))


def round_paise(value):
    return int(D(str(value)).quantize(D("1"), rounding=ROUND_HALF_UP))


def rupees(value):
    return float(D(value) / 100)


def jsonable_policy(policy):
    if hasattr(policy, "model_dump"):
        return json.loads(policy.model_dump_json())
    return policy


def date_allowed(value):
    if value > today_ist():
        raise AppError("Future-dated work or advances cannot be recorded.")
    if value < date(2000, 1, 1):
        raise AppError("Date must be on or after 1 January 2000.")


def calculate_work(worker, business, data, tasks):
    model = worker["payment_model"]
    items, base = [], 0
    hours = data.ot_hours
    if model == "piece":
        if data.attendance is not None:
            raise AppError("Piece-rate workers use production quantities, not salary attendance.")
        if not data.items and hours == 0:
            raise AppError("Add at least one task or overtime entry.")
        for item in data.items:
            task = tasks.get(item.task_id)
            if not task or not task["active"]:
                raise AppError("A selected task is unavailable. Refresh the task catalog.", status=422)
            amount = round_paise(D(task["rate_paise"]) * item.quantity)
            if amount > 100_000_000_00:
                raise AppError("The task total is too large. Check quantity and rate.")
            items.append({"task_id": task["id"], "name": task["name"], "unit": task["unit"],
                          "quantity": float(item.quantity), "rate": rupees(task["rate_paise"]), "total": rupees(amount)})
            base += amount
    else:
        if data.items:
            raise AppError("Salary workers use attendance, not piece-rate items.")
        if data.attendance is None:
            raise AppError("Choose full day, half day, or absent.")
        factor = {"full": D("1"), "half": D("0.5"), "absent": D("0")}[data.attendance]
        divisor = business["salary_divisor"] if model == "monthly" else 1
        base = round_paise(D(worker["salary_paise"]) / divisor * factor)
        if data.attendance == "absent" and hours > 0:
            raise AppError("Absent attendance cannot include overtime. Choose the actual attendance.")

    policy = json.loads(worker["overtime_policy"] or business["overtime_policy"])
    mode = policy["mode"]
    overtime = 0
    if hours > 0:
        if mode == "none":
            raise AppError("Overtime is disabled for this worker. Ask the owner to configure it.")
        if mode == "hourly":
            overtime = round_paise(D(str(policy["hourly_rate"])) * 100 * hours)
        elif mode == "multiplier":
            if model == "monthly":
                hourly = D(worker["salary_paise"]) / business["salary_divisor"] / 8
            elif model == "daily":
                hourly = D(worker["salary_paise"]) / 8
            else:
                hourly = D(str(policy["hourly_rate"])) * 100
            overtime = round_paise(hourly * D(str(policy["multiplier"])) * hours)
        elif mode == "shift":
            if hours % 4:
                raise AppError("Shift overtime must be 4, 8, 12, or 16 hours. Use hourly OT for other durations.")
            full = int(hours // 8)
            half = int((hours % 8) // 4)
            overtime = full * paise(policy["full_shift_rate"]) + half * paise(policy["half_shift_rate"])
        elif mode == "flat":
            overtime = paise(policy["flat_rate"])
    snapshot = {"salary": rupees(worker["salary_paise"]), "salary_divisor": business["salary_divisor"],
                "payment_model": model, "overtime_policy": policy, "rounding": "HALF_UP per line and OT, paise"}
    return {"items": items, "base_paise": base, "overtime_paise": overtime, "rate_snapshot": snapshot}


def cycle_dates(cycle, day=None):
    day = day or today_ist()
    if cycle == "weekly":
        # Sunday-Saturday workweek; Saturday is payday, including today.
        start = day - timedelta(days=(day.weekday() + 1) % 7)
        next_pay = day + timedelta(days=(5 - day.weekday()) % 7)
    else:
        start = day.replace(day=1)
        if day.day == 1:
            next_pay = day
        else:
            next_pay = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, day, next_pay
