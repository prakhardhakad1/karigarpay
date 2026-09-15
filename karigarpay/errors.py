class AppError(Exception):
    def __init__(self, detail: str, code: str = "INVALID_REQUEST", status: int = 400):
        super().__init__(detail)
        self.detail, self.code, self.status = detail, code, status


class Missing(AppError):
    def __init__(self, label="Record"):
        super().__init__(f"{label} not found.", "NOT_FOUND", 404)


class Conflict(AppError):
    def __init__(self, detail):
        super().__init__(detail, "CONFLICT", 409)


class Forbidden(AppError):
    def __init__(self, detail="You do not have permission to do this."):
        super().__init__(detail, "FORBIDDEN", 403)
