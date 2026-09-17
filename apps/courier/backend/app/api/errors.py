"""RFC 7807 ``application/problem+json`` error responses."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

CONTENT_TYPE = "application/problem+json"


class Problem(Exception):
    """Raise anywhere to produce a problem+json response."""

    def __init__(
        self,
        status: int,
        title: str,
        detail: str | None = None,
        *,
        type_: str = "about:blank",
        row_errors: list[dict[str, Any]] | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(detail or title)
        self.status = status
        self.title = title
        self.detail = detail
        self.type = type_
        self.row_errors = row_errors or []
        self.extra = extra

    def to_response(self, request: Request) -> JSONResponse:
        body: dict[str, Any] = {
            "type": self.type,
            "title": self.title,
            "status": self.status,
            "instance": str(request.url.path),
        }
        if self.detail:
            body["detail"] = self.detail
        if self.row_errors:
            body["row_errors"] = self.row_errors
        body.update(self.extra)
        return JSONResponse(body, status_code=self.status, media_type=CONTENT_TYPE)


def install(app: FastAPI) -> None:
    @app.exception_handler(Problem)
    async def _problem(request: Request, exc: Problem) -> JSONResponse:
        return exc.to_response(request)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return Problem(
            status=exc.status_code,
            title=str(exc.detail) if exc.detail else "Request failed",
        ).to_response(request)

    @app.exception_handler(RequestValidationError)
    async def _validation(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return Problem(
            status=422,
            title="Validation failed",
            detail="One or more fields are invalid.",
            row_errors=[
                {
                    "row_no": 0,
                    "status": "error",
                    "field": ".".join(str(p) for p in err.get("loc", ())[1:]),
                    "message": err.get("msg", "invalid value"),
                }
                for err in exc.errors()
            ],
        ).to_response(request)
