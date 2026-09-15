from contextlib import asynccontextmanager
from datetime import date
from io import BytesIO
from time import perf_counter
from typing import Annotated, Literal
from uuid import uuid4
import hmac
import json
import logging
import sqlite3
import qrcode
from fastapi import FastAPI, Depends, Request, Response, UploadFile, File, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .config import Settings, ROOT
from .db import Database
from .errors import AppError, Conflict
from .security import AuthService, COOKIE, require_owner
from .workforce import WorkforceService
from .ledger import LedgerService
from .payroll import PayrollService
from .dashboard import DashboardService
from .photos import PhotoService
from . import schemas as s

log = logging.getLogger("karigarpay")


class RequestSizeGuard:
    """Enforce size for both Content-Length and chunked streaming bodies."""
    def __init__(self, app, max_bytes):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"detail": "Invalid Content-Length.", "code": "BAD_REQUEST"}, 400)(scope, receive, send)
        if length > self.max_bytes:
            return await JSONResponse({"detail": "Request exceeds the upload limit.", "code": "TOO_LARGE"}, 413)(scope, receive, send)
        read = 0
        async def limited_receive():
            nonlocal read
            message = await receive()
            if message["type"] == "http.request":
                read += len(message.get("body", b""))
                if read > self.max_bytes:
                    raise AppError("Request exceeds the upload limit.", "TOO_LARGE", 413)
            return message
        return await self.app(scope, limited_receive, send)


def create_app(settings=None):
    settings = settings or Settings.from_env()
    db = Database(settings.db_path)
    auth = AuthService(db, settings)
    workforce = WorkforceService(db)
    ledger = LedgerService(db)
    payroll = PayrollService(db)
    dashboards = DashboardService(db)
    photos = PhotoService(db, settings)

    @asynccontextmanager
    async def lifespan(app):
        db.initialize()
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        yield
        # All requests use bounded transactions; checkpoint after graceful drain.
        conn = db.connect()
        try:
            conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        finally:
            conn.close()

    app = FastAPI(title="KarigarPay API", version="1.0.0", description="Tenant-scoped work and wage ledger. Amounts are INR rupees. Banking transactions are not executed or verified.",
                  lifespan=lifespan, docs_url="/docs" if settings.env != "production" else None,
                  redoc_url=None, openapi_url="/openapi.json" if settings.env != "production" else None)
    app.state.db, app.state.settings = db, settings

    @app.exception_handler(AppError)
    async def app_error(request, exc):
        headers = {"Retry-After": "900"} if exc.status == 429 else None
        return JSONResponse({"detail": exc.detail, "code": exc.code, "request_id": getattr(request.state, "request_id", "")}, status_code=exc.status, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, exc):
        errors = [{"field": ".".join(str(v) for v in e["loc"] if v != "body"), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse({"detail": "Please check the highlighted input details.", "code": "VALIDATION_ERROR", "errors": errors}, status_code=422)

    @app.exception_handler(sqlite3.IntegrityError)
    async def invalid_write(request, exc):
        # Do not leak schema details, SQL text, PIN hashes or worker phone numbers.
        return JSONResponse({"detail": "This conflicts with an existing or locked record. Refresh and check the entry.", "code": "CONFLICT"}, status_code=409)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        return JSONResponse({"detail": str(exc.detail), "code": "HTTP_ERROR"}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        log.error(json.dumps({"event": "request.error", "request_id": getattr(request.state, "request_id", ""), "exception_type": type(exc).__name__}))
        return JSONResponse({"detail": "Something went wrong. Your changes may not have completed; refresh before trying again.", "code": "INTERNAL_ERROR"}, status_code=500)

    app.add_middleware(RequestSizeGuard, max_bytes=settings.max_upload_bytes + 64 * 1024)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_credentials=True,
                       allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"], allow_headers=["Content-Type", "X-CSRF-Token", "Accept"], expose_headers=["X-Request-ID"])
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.hosts))

    @app.middleware("http")
    async def safety(request, call_next):
        started = perf_counter()
        request.state.request_id = uuid4().hex
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") not in settings.origins:
                return JSONResponse({"detail": "This request origin is not allowed.", "code": "BAD_ORIGIN"}, status_code=403)
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "Cross-site writes are blocked.", "code": "BAD_ORIGIN"}, status_code=403)
            # A browser cannot smuggle form data into the JSON auth endpoints.
            if request.url.path.startswith("/api/auth/") and request.url.path not in {"/api/auth/logout"} and "application/json" not in request.headers.get("content-type", ""):
                return JSONResponse({"detail": "Use an application/json request.", "code": "UNSUPPORTED_MEDIA_TYPE"}, status_code=415)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "microphone=(self), camera=(self), geolocation=()"
        response.headers["Content-Security-Policy"] = ("default-src 'self'; script-src 'self' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://cdn.tailwindcss.com; "
            "worker-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'")
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, private"
            response.headers["Pragma"] = "no-cache"
        if settings.secure_cookies:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        log.info(json.dumps({"event": "request", "request_id": request.state.request_id, "method": request.method,
            "path": request.url.path, "status": response.status_code, "duration_ms": round((perf_counter() - started) * 1000, 1)}))
        return response

    def actor(request: Request):
        user = auth.authenticate(request.cookies.get(COOKIE))
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            sent = request.headers.get("x-csrf-token", "")
            if not hmac.compare_digest(sent, user["csrf_token"]):
                raise AppError("Your security token is missing or expired. Refresh and try again.", "CSRF_FAILED", 403)
        return user

    User = Annotated[dict, Depends(actor)]

    def attach_cookie(response, token):
        response.set_cookie(COOKIE, token, max_age=settings.session_hours * 3600, httponly=True,
                            secure=settings.secure_cookies, samesite="strict", path="/")

    @app.get("/health", tags=["system"])
    def health():
        return {"status": "ok", "service": "KarigarPay"}

    @app.get("/ready", tags=["system"])
    def ready():
        try:
            healthy = db.healthy()
        except sqlite3.Error:
            healthy = False
        return JSONResponse({"status": "ready" if healthy else "unavailable", "database": healthy}, 200 if healthy else 503)

    @app.post("/api/auth/register", tags=["authentication"], status_code=201)
    def register(data: s.Register, request: Request, response: Response):
        token, body = auth.register(data, request.client.host if request.client else "unknown")
        attach_cookie(response, token)
        return body

    @app.post("/api/auth/login", tags=["authentication"])
    def login(data: s.Login, request: Request, response: Response):
        token, body = auth.login(data, request.client.host if request.client else "unknown")
        attach_cookie(response, token)
        return body

    @app.get("/api/auth/me", tags=["authentication"])
    def me(user: User):
        return auth.me(user)

    @app.post("/api/auth/logout", tags=["authentication"])
    def logout(user: User, response: Response):
        auth.logout(user)
        response.delete_cookie(COOKIE, path="/", secure=settings.secure_cookies, httponly=True, samesite="strict")
        return {"ok": True}

    @app.post("/api/auth/change-pin", tags=["authentication"])
    def change_pin(data: s.ChangePin, user: User, response: Response):
        auth.change_pin(user, data)
        response.delete_cookie(COOKIE, path="/", secure=settings.secure_cookies, httponly=True, samesite="strict")
        return {"ok": True, "reauthenticate": True}

    @app.get("/api/business", tags=["business"])
    def business(user: User):
        return workforce.business(user)

    @app.patch("/api/business", tags=["business"])
    def update_business(data: s.BusinessPatch, user: User):
        return workforce.update_business(user, data)

    @app.get("/api/workers", tags=["workers"])
    def workers(user: User):
        return {"items": workforce.workers(user)}

    @app.post("/api/workers", tags=["workers"], status_code=201)
    def create_worker(data: s.WorkerCreate, user: User):
        return workforce.create_worker(user, data)

    @app.patch("/api/workers/{worker_id}", tags=["workers"])
    def update_worker(worker_id: str, data: s.WorkerPatch, user: User):
        return workforce.update_worker(user, worker_id, data)

    @app.get("/api/tasks", tags=["catalog"])
    def tasks(user: User):
        return {"items": workforce.tasks(user)}

    @app.post("/api/tasks", tags=["catalog"], status_code=201)
    def create_task(data: s.TaskCreate, user: User):
        return workforce.create_task(user, data)

    @app.patch("/api/tasks/{task_id}", tags=["catalog"])
    def update_task(task_id: str, data: s.TaskPatch, user: User):
        return workforce.update_task(user, task_id, data)

    @app.get("/api/dashboard", tags=["dashboard"])
    def dashboard(user: User, date: date | None = None):
        return dashboards.owner(user, date)

    @app.get("/api/worker/dashboard", tags=["dashboard"])
    def worker_dashboard(user: User):
        return dashboards.worker(user)

    @app.get("/api/submissions", tags=["work"])
    def submissions(user: User, date: date | None = None, status: Literal["pending", "approved", "rejected"] | None = None,
                    worker_id: str | None = None, limit: int = Query(100, ge=1, le=500)):
        return {"items": ledger.submissions(user, date, status, worker_id, limit)}

    @app.post("/api/submissions", tags=["work"], status_code=201)
    def submit(data: s.WorkInput, user: User):
        return ledger.create_submission(user, data)

    @app.post("/api/submissions/approve-all", tags=["work"])
    def approve_all(data: s.ApproveAll, user: User):
        return {"approved_count": ledger.approve_all(user, data.date)}

    @app.get("/api/submissions/{submission_id}", tags=["work"])
    def submission(submission_id: str, user: User):
        return ledger.submission(user, submission_id)

    @app.put("/api/submissions/{submission_id}", tags=["work"])
    def edit_submission(submission_id: str, data: s.WorkInput, user: User):
        return ledger.edit_submission(user, submission_id, data)

    @app.post("/api/submissions/{submission_id}/review", tags=["work"])
    def review(submission_id: str, data: s.Review, user: User):
        return ledger.review(user, submission_id, data)

    @app.post("/api/photos", tags=["photos"], status_code=201)
    def upload_photo(user: User, file: UploadFile = File(...)):
        try:
            content = file.file.read(settings.max_upload_bytes + 1)
            return photos.upload(user, content, file.content_type)
        finally:
            file.file.close()

    @app.get("/api/photos/{photo_id}", tags=["photos"])
    def view_photo(photo_id: str, user: User):
        return FileResponse(photos.get(user, photo_id), media_type="image/jpeg", headers={"Content-Disposition": 'inline; filename="work-proof.jpg"'})

    @app.get("/api/advances", tags=["advances"])
    def advances(user: User, worker_id: str | None = None):
        return {"items": ledger.advances(user, worker_id)}

    @app.post("/api/advances", tags=["advances"], status_code=201)
    def advance(data: s.AdvanceCreate, user: User):
        return ledger.create_advance(user, data)

    @app.post("/api/advances/{advance_id}/void", tags=["advances"])
    def void_advance(advance_id: str, data: s.VoidAdvance, user: User):
        return ledger.void_advance(user, advance_id, data.reason)

    @app.get("/api/payroll", tags=["payroll"])
    def payroll_list(user: User, start: date | None = None, end: date | None = None):
        return payroll.payroll(user, start, end)

    @app.get("/api/payroll/preview", tags=["payroll"])
    def preview(user: User, worker_id: str, start: date | None = None, end: date | None = None):
        return payroll.preview(user, worker_id, start, end)

    @app.get("/api/payroll/qr", tags=["payroll"])
    def qr(user: User, worker_id: str, start: date, end: date, fingerprint: str):
        result = payroll.preview(user, worker_id, start, end)
        if not hmac.compare_digest(result["fingerprint"], fingerprint):
            raise Conflict("This QR is out of date. Refresh the payroll preview.")
        if not result["upi_uri"]:
            raise AppError("A positive, reviewed balance and a worker UPI ID are required for a QR code.")
        output = BytesIO()
        qrcode.make(result["upi_uri"], box_size=8, border=4).save(output, format="PNG")
        return Response(output.getvalue(), media_type="image/png")

    @app.post("/api/settlements", tags=["payroll"], status_code=201)
    def settle(data: s.Settle, user: User):
        return payroll.settle(user, data)

    @app.get("/api/settlements", tags=["payroll"])
    def settlements(user: User, worker_id: str | None = None):
        return {"items": payroll.settlements(user, worker_id)}

    @app.get("/api/settlements/{settlement_id}", tags=["payroll"])
    def settlement(settlement_id: str, user: User):
        return payroll.settlement(user, settlement_id)

    @app.get("/api/audit", tags=["audit"])
    def audit(user: User, limit: int = Query(100, ge=1, le=500)):
        return {"items": workforce.audit(user, limit)}

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.webmanifest", include_in_schema=False)
    def manifest():
        return FileResponse(ROOT / "static" / "manifest.webmanifest", media_type="application/manifest+json", headers={"Cache-Control": "no-cache"})

    @app.get("/sw.js", include_in_schema=False)
    def service_worker():
        return FileResponse(ROOT / "static" / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})

    @app.get("/guide", include_in_schema=False)
    def guide():
        return FileResponse(ROOT / "outputs" / "KarigarPay-guide.html", headers={"Cache-Control": "no-cache"})

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app
