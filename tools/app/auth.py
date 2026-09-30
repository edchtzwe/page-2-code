from __future__ import annotations

import logging
from typing import Final

import jwt
from fastapi import Request, status
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from .config import ToolsConfig

LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

AUTHORIZATION_HEADER: Final[str] = "authorization"
BEARER_PREFIX: Final[str] = "Bearer "
OPTIONS_METHOD: Final[str] = "OPTIONS"
HEALTH_PATH: Final[str] = "/health"
UNAUTHORIZED_DETAIL: Final[str] = "unauthorized"
WWW_AUTHENTICATE_HEADER: Final[str] = "WWW-Authenticate"
WWW_AUTHENTICATE_VALUE: Final[str] = "Bearer"
JWT_ALGORITHMS: Final[list[str]] = ["RS256"]
REQUIRED_CLAIMS: Final[list[str]] = ["exp", "iat", "iss", "aud"]


def _extract_bearer_token(header: str | None) -> str | None:
    if header is None or not header.startswith(BEARER_PREFIX):
        return None
    token: str = header[len(BEARER_PREFIX) :].strip()
    return token or None


def _reject(reason: str) -> JSONResponse:
    LOGGER.warning("rejected request: %s", reason)
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={"detail": UNAUTHORIZED_DETAIL},
        headers={WWW_AUTHENTICATE_HEADER: WWW_AUTHENTICATE_VALUE},
    )


class JwtAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, config: ToolsConfig) -> None:
        super().__init__(app)
        self._config: ToolsConfig = config

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if not self._config.is_production_mode:
            return await call_next(request)

        if request.method == OPTIONS_METHOD or request.url.path == HEALTH_PATH:
            return await call_next(request)

        token: str | None = _extract_bearer_token(request.headers.get(AUTHORIZATION_HEADER))
        if token is None:
            return _reject("missing bearer token")

        try:
            jwt.decode(
                token,
                self._config.jwt_public_key,
                algorithms=JWT_ALGORITHMS,
                audience=self._config.jwt_audience,
                options={"require": REQUIRED_CLAIMS},
            )
        except (jwt.PyJWTError, RuntimeError) as error:
            return _reject(f"invalid bearer token: {error}")
        return await call_next(request)
