PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE businesses (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_name TEXT NOT NULL, owner_phone TEXT NOT NULL,
 settlement_cycle TEXT NOT NULL DEFAULT 'weekly' CHECK(settlement_cycle IN ('weekly','monthly')),
 salary_divisor INTEGER NOT NULL DEFAULT 26 CHECK(salary_divisor BETWEEN 1 AND 31),
 overtime_policy TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE users (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL,
 phone TEXT NOT NULL, pin_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','worker')),
 payment_model TEXT NOT NULL DEFAULT 'piece' CHECK(payment_model IN ('piece','daily','monthly')),
 salary_paise INTEGER NOT NULL DEFAULT 0 CHECK(salary_paise >= 0), upi_id TEXT NOT NULL DEFAULT '',
 overtime_policy TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL,
 UNIQUE(business_id,phone), UNIQUE(id,business_id)
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf_token TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX ix_sessions_user ON sessions(user_id);
CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL,
 unit TEXT NOT NULL, rate_paise INTEGER NOT NULL CHECK(rate_paise >= 0), aliases TEXT NOT NULL DEFAULT '[]',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL,
 UNIQUE(business_id,name), UNIQUE(id,business_id)
);
CREATE TABLE photos (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL, user_id TEXT NOT NULL, path TEXT NOT NULL,
 mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(user_id,business_id) REFERENCES users(id,business_id), UNIQUE(id,business_id)
);
CREATE TABLE settlements (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL, worker_id TEXT NOT NULL,
 start TEXT NOT NULL, end TEXT NOT NULL, base_paise INTEGER NOT NULL, overtime_paise INTEGER NOT NULL,
 advances_paise INTEGER NOT NULL, net_paise INTEGER NOT NULL CHECK(net_paise >= 0),
 method TEXT NOT NULL CHECK(method IN ('cash','upi','adjustment')), reference TEXT NOT NULL,
 snapshot TEXT NOT NULL, created_at TEXT NOT NULL, actor_id TEXT NOT NULL,
 FOREIGN KEY(worker_id,business_id) REFERENCES users(id,business_id), UNIQUE(id,business_id)
);
CREATE TABLE submissions (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL, worker_id TEXT NOT NULL, work_date TEXT NOT NULL,
 items TEXT NOT NULL, attendance TEXT CHECK(attendance IS NULL OR attendance IN ('full','half','absent')),
 ot_hours TEXT NOT NULL, base_paise INTEGER NOT NULL CHECK(base_paise >= 0),
 overtime_paise INTEGER NOT NULL CHECK(overtime_paise >= 0),
 payment_model TEXT NOT NULL, rate_snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 note TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '', photo_id TEXT,
 settlement_id TEXT, reviewed_at TEXT, reviewed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(worker_id,business_id) REFERENCES users(id,business_id),
 FOREIGN KEY(photo_id,business_id) REFERENCES photos(id,business_id),
 FOREIGN KEY(settlement_id,business_id) REFERENCES settlements(id,business_id),
 UNIQUE(business_id,worker_id,work_date), UNIQUE(id,business_id)
);
CREATE INDEX ix_submissions_review ON submissions(business_id,work_date,status);
CREATE INDEX ix_submissions_payroll ON submissions(business_id,worker_id,settlement_id,status,work_date);
CREATE TABLE advances (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL, worker_id TEXT NOT NULL, date TEXT NOT NULL,
 amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), note TEXT NOT NULL,
 voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0,1)), void_reason TEXT NOT NULL DEFAULT '',
 settlement_id TEXT, created_at TEXT NOT NULL, actor_id TEXT NOT NULL,
 FOREIGN KEY(worker_id,business_id) REFERENCES users(id,business_id),
 FOREIGN KEY(settlement_id,business_id) REFERENCES settlements(id,business_id), UNIQUE(id,business_id)
);
CREATE INDEX ix_advances_payroll ON advances(business_id,worker_id,settlement_id,date);
CREATE TABLE audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, business_id TEXT NOT NULL REFERENCES businesses(id),
 actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX ix_audit_business ON audit(business_id,id);
CREATE TABLE idempotency (
 business_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, request_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(business_id,user_id,kind,request_id),
 FOREIGN KEY(user_id,business_id) REFERENCES users(id,business_id)
);
-- Records are immutable after approval, or allocation to a payroll settlement.
CREATE TRIGGER submissions_lock BEFORE UPDATE ON submissions
WHEN OLD.settlement_id IS NOT NULL OR
 (OLD.status = 'approved' AND (NEW.items != OLD.items OR NEW.base_paise != OLD.base_paise OR
 NEW.overtime_paise != OLD.overtime_paise OR NEW.status != OLD.status OR NEW.ot_hours != OLD.ot_hours OR
 NEW.work_date != OLD.work_date OR NEW.worker_id != OLD.worker_id OR NEW.business_id != OLD.business_id OR
 NEW.payment_model != OLD.payment_model OR NEW.rate_snapshot != OLD.rate_snapshot OR
 NEW.note != OLD.note OR NEW.review_note != OLD.review_note OR
 NEW.photo_id IS NOT OLD.photo_id OR NEW.attendance IS NOT OLD.attendance))
BEGIN SELECT RAISE(ABORT, 'Approved or settled work is immutable'); END;
CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions
BEGIN SELECT RAISE(ABORT, 'Work ledger entries cannot be deleted'); END;
CREATE TRIGGER advances_lock BEFORE UPDATE ON advances WHEN OLD.settlement_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Settled advances are immutable'); END;
CREATE TRIGGER advances_no_delete BEFORE DELETE ON advances
BEGIN SELECT RAISE(ABORT, 'Advance ledger entries cannot be deleted'); END;
CREATE TRIGGER settlements_lock BEFORE UPDATE ON settlements
BEGIN SELECT RAISE(ABORT, 'Settlements are immutable'); END;
CREATE TRIGGER settlements_no_delete BEFORE DELETE ON settlements
BEGIN SELECT RAISE(ABORT, 'Settlements cannot be deleted'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'Audit trail is append only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'Audit trail is append only'); END;
