import re
import os
from pathlib import Path
import httpx

TURSO_URL = os.getenv("TURSO_DB_URL", "https://kariarpay-prakhardhakad.aws-ap-south-1.turso.io")
if TURSO_URL.startswith("libsql://"):
    TURSO_URL = TURSO_URL.replace("libsql://", "https://")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODk0NjI4NjEsImlkIjoiMDFhMGE0NGItYzMwMS03NDNjLWE5ODQtNDg1NjY3MmFkOWRjIiwia2lkIjoiR2dnbms3LWJpc1dTaFpkY29qNVZQdUtPUlBiOER3Nl9XNWs3UmlYVUEycyIsInJpZCI6IjY4NzdkYjVjLWNhNzgtNGU0NS05NTNhLTVjMTVhNzkxYjNlNyJ9.66ztZTeIGHcW7RO-T2Eli2IPF_lFJhaCpaJwX1ML_cgltnH7zwQaPaacHl0arLFfZWBZ7UT2h-jEy4NzHRSMCQ")

ROOT = Path(__file__).resolve().parent
sql_path = ROOT / "migrations" / "001_initial.sql"
content = sql_path.read_text(encoding="utf-8")

statements = []
current = []
in_trigger = False

for line in content.splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("--") or stripped == "PRAGMA foreign_keys = ON;":
        continue
    if "CREATE TRIGGER" in line.upper():
        in_trigger = True
    current.append(line)
    if in_trigger:
        if "END;" in line:
            statements.append("\n".join(current).strip())
            current = []
            in_trigger = False
    elif line.endswith(";"):
        statements.append("\n".join(current).strip())
        current = []

if current:
    stmt = "\n".join(current).strip()
    if stmt:
        statements.append(stmt)

print(f"Parsed {len(statements)} statements to execute on Turso...")

pipeline_url = f"{TURSO_URL.rstrip('/')}/v2/pipeline"
headers = {"Authorization": f"Bearer {TURSO_TOKEN}", "Content-Type": "application/json"}

for i, stmt in enumerate(statements, 1):
    payload = {
        "requests": [
            {"type": "execute", "stmt": {"sql": stmt}}
        ]
    }
    res = httpx.post(pipeline_url, headers=headers, json=payload, timeout=15)
    data = res.json()
    if res.status_code != 200 or "error" in data:
        print(f"[{i}/{len(statements)}] FAILED: {stmt[:50]}... -> {data}")
    else:
        results = data.get("results", [])
        if results and results[0].get("type") == "error":
            print(f"[{i}/{len(statements)}] TURSO ERROR: {results[0].get('error')} for: {stmt[:60]}")
        else:
            print(f"[{i}/{len(statements)}] OK: {stmt.splitlines()[0][:60]}")

print("\nMigration finished on Turso!")
