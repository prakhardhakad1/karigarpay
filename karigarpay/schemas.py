from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Pin = Annotated[str, StringConstraints(pattern=r"^[0-9]{4}$")]
Phone = Annotated[str, StringConstraints(pattern=r"^[6-9][0-9]{9}$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
Money = Annotated[Decimal, Field(ge=0, le=10_000_000, max_digits=12, decimal_places=2, allow_inf_nan=False)]
PositiveMoney = Annotated[Decimal, Field(gt=0, le=10_000_000, max_digits=12, decimal_places=2, allow_inf_nan=False)]
Quantity = Annotated[Decimal, Field(gt=0, le=1_000_000, decimal_places=3, allow_inf_nan=False)]
Hours = Annotated[Decimal, Field(ge=0, le=16, decimal_places=2, allow_inf_nan=False)]
PaymentModel = Literal["piece", "daily", "monthly"]
Attendance = Literal["full", "half", "absent"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OTPolicy(Model):
    mode: Literal["none", "hourly", "multiplier", "shift", "flat"] = "hourly"
    hourly_rate: Money = Decimal("50")
    multiplier: Annotated[Decimal, Field(ge=0, le=10, decimal_places=2, allow_inf_nan=False)] = Decimal("1.5")
    half_shift_rate: Money = Decimal("200")
    full_shift_rate: Money = Decimal("400")
    flat_rate: Money = Decimal("0")


class Register(Model):
    name: Name
    owner_name: Name
    owner_phone: Phone
    pin: Pin


class Login(Model):
    business_id: Annotated[str, StringConstraints(pattern=r"^BIZ-[A-Za-z0-9]{3,16}$")]
    phone: Phone
    pin: Pin
    role: Literal["owner", "worker"]

    @field_validator("business_id", mode="before")
    @classmethod
    def normalize_business(cls, value):
        return str(value).strip().upper()


class ChangePin(Model):
    old_pin: Pin
    new_pin: Pin


class BusinessPatch(Model):
    name: Name | None = None
    owner_name: Name | None = None
    settlement_cycle: Literal["weekly", "monthly"] | None = None
    salary_divisor: Annotated[int, Field(ge=1, le=31)] | None = None
    overtime_policy: OTPolicy | None = None

    @model_validator(mode="after")
    def not_null(self):
        for key in self.model_fields_set:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class WorkerCreate(Model):
    name: Name
    phone: Phone
    pin: Pin
    payment_model: PaymentModel = "piece"
    salary: Money = Decimal("0")
    upi_id: Annotated[str, StringConstraints(max_length=120)] = ""
    overtime_policy: OTPolicy | None = None

    @field_validator("upi_id")
    @classmethod
    def validate_upi(cls, value):
        import re
        if value and not re.fullmatch(r"[A-Za-z0-9._-]{2,100}@[A-Za-z][A-Za-z0-9.-]{1,30}", value):
            raise ValueError("Enter a valid UPI ID, for example name@bank")
        return value

    @model_validator(mode="after")
    def salary_required(self):
        if self.payment_model != "piece" and self.salary <= 0:
            raise ValueError("Daily or monthly workers need a positive base salary")
        return self


class WorkerPatch(Model):
    name: Name | None = None
    phone: Phone | None = None
    pin: Pin | None = None
    payment_model: PaymentModel | None = None
    salary: Money | None = None
    upi_id: Annotated[str, StringConstraints(max_length=120)] | None = None
    overtime_policy: OTPolicy | None = None
    active: bool | None = None

    @field_validator("upi_id")
    @classmethod
    def validate_upi(cls, value):
        return WorkerCreate.validate_upi(value) if value is not None else value

    @model_validator(mode="after")
    def not_null(self):
        for key in self.model_fields_set - {"overtime_policy"}:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class TaskCreate(Model):
    name: Name
    unit: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]
    rate: Money
    aliases: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]] = Field(default_factory=list, max_length=20)


class TaskPatch(Model):
    name: Name | None = None
    unit: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)] | None = None
    rate: Money | None = None
    aliases: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]] | None = Field(default=None, max_length=20)
    active: bool | None = None

    @model_validator(mode="after")
    def not_null(self):
        for key in self.model_fields_set:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class WorkItem(Model):
    task_id: Annotated[str, StringConstraints(max_length=40)]
    quantity: Quantity


class WorkInput(Model):
    worker_id: Annotated[str, StringConstraints(max_length=40)] | None = None
    work_date: date
    items: list[WorkItem] = Field(default_factory=list, max_length=50)
    attendance: Attendance | None = None
    ot_hours: Hours = Decimal("0")
    photo_id: Annotated[str, StringConstraints(max_length=40)] | None = None
    note: Annotated[str, StringConstraints(max_length=1000)] = ""
    request_id: UUID

    @model_validator(mode="after")
    def unique_tasks(self):
        if len({i.task_id for i in self.items}) != len(self.items):
            raise ValueError("Combine repeated tasks into one quantity")
        return self


class Review(Model):
    action: Literal["approve", "reject"]
    note: Annotated[str, StringConstraints(max_length=1000)] = ""


class ApproveAll(Model):
    date: date


class AdvanceCreate(Model):
    worker_id: Annotated[str, StringConstraints(max_length=40)]
    date: date
    amount: PositiveMoney
    note: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    request_id: UUID


class VoidAdvance(Model):
    reason: Annotated[str, StringConstraints(min_length=3, max_length=500)]


class Settle(Model):
    worker_id: Annotated[str, StringConstraints(max_length=40)]
    start: date
    end: date
    fingerprint: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    method: Literal["cash", "upi", "adjustment"]
    reference: Annotated[str, StringConstraints(max_length=120)] = ""
    confirmed: bool
    request_id: UUID

    @model_validator(mode="after")
    def confirmation(self):
        if not self.confirmed:
            raise ValueError("Confirm that the worker was actually paid before recording settlement")
        if self.method == "upi" and len(self.reference) < 4:
            raise ValueError("UPI settlement requires the bank transaction reference")
        return self
