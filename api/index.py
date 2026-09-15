import sys
import os
import urllib.parse
from pathlib import Path
from starlette.responses import JSONResponse

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from karigarpay.app import create_app

base_app = create_app()

class VercelRouteMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            qs = scope.get("query_string", b"").decode("latin1")
            raw_path = scope.get("path", "")
            
            if "/debug-route" in raw_path or "debug-route" in qs:
                resp = JSONResponse({
                    "raw_path": raw_path,
                    "qs": qs,
                    "headers": {k.decode("latin1"): v.decode("latin1") for k, v in scope.get("headers", [])}
                })
                return await resp(scope, receive, send)

            new_qs_parts = []
            route = None
            if qs:
                for part in qs.split("&"):
                    if part.startswith("_route="):
                        route = urllib.parse.unquote(part.split("=", 1)[1])
                    elif part:
                        new_qs_parts.append(part)
                scope["query_string"] = "&".join(new_qs_parts).encode("latin1")

            if route:
                if not route.startswith("/"):
                    route = "/" + route
                target = f"/api{route}"
                scope["path"] = target
                scope["raw_path"] = target.encode("latin1")
            elif raw_path.endswith(".py"):
                headers = dict(scope.get("headers", []))
                matched = headers.get(b"x-matched-path", b"").decode("latin1")
                if matched and not matched.endswith(".py"):
                    scope["path"] = matched
                    scope["raw_path"] = matched.encode("latin1")

        return await self.app(scope, receive, send)

app = VercelRouteMiddleware(base_app)
