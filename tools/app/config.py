from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from fastapi import status
import httpx

LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

DEFAULT_WORKSPACE_ROOT: Final[str] = "/app"
APP_MODE_DEV: Final[str] = "dev"
APP_MODE_PROD: Final[str] = "prod"
DEFAULT_JWT_AUDIENCE: Final[str] = "tools"
DEFAULT_VAULT_SECRET_PATH: Final[str] = "secret/data/page-2-code/tools"
ENCODING: Final[str] = "utf-8"

MAX_READ_BYTES: Final[int] = 262_144
MAX_WRITE_BYTES: Final[int] = 1_048_576
MAX_LIST_ENTRIES: Final[int] = 500
MAX_PATCH_FILES: Final[int] = 32
MAX_PATCH_HUNKS_PER_FILE: Final[int] = 64

VAULT_HEADER_TOKEN: Final[str] = "X-Vault-Token"
VAULT_HTTP_TIMEOUT_SECONDS: Final[float] = 5.0


@dataclass(frozen=True)
class ToolsConfig:
    app_mode: str
    jwt_audience: str
    jwt_public_key: str
    workspace_root: Path

    @property
    def is_production_mode(self) -> bool:
        return self.app_mode == APP_MODE_PROD

    @classmethod
    def load(cls) -> ToolsConfig:
        app_mode: str = os.environ.get("APP_MODE", APP_MODE_DEV).strip()
        if app_mode != APP_MODE_DEV:
            app_mode = APP_MODE_PROD

        jwt_audience: str = os.environ.get("JWT_AUDIENCE", DEFAULT_JWT_AUDIENCE).strip()

        if app_mode == APP_MODE_PROD:
            vault_secrets: dict[str, str] = _fetch_vault_secrets()
            jwt_public_key: str = _resolve_jwt_public_key(vault_secrets)
        else:
            jwt_public_key = ""

        workspace_root_raw: str = os.environ.get("TOOLS_WORKSPACE_ROOT", DEFAULT_WORKSPACE_ROOT)
        workspace_root: Path = Path(workspace_root_raw).expanduser().resolve()
        workspace_root.mkdir(parents=True, exist_ok=True)

        return cls(
            app_mode=app_mode,
            jwt_audience=jwt_audience,
            jwt_public_key=jwt_public_key,
            workspace_root=workspace_root,
        )


def _fetch_vault_secrets() -> dict[str, str]:
    vault_addr: str | None = os.environ.get("VAULT_ADDR")
    vault_token: str | None = os.environ.get("VAULT_TOKEN")
    secret_path: str = os.environ.get("VAULT_SECRET_PATH", DEFAULT_VAULT_SECRET_PATH)

    if not vault_addr or not vault_token:
        raise RuntimeError(
            f"Vault configuration missing: VAULT_ADDR and VAULT_TOKEN are required in {APP_MODE_PROD} mode. Refusing to start."
        )

    url: str = f"{vault_addr.rstrip('/')}/v1/{secret_path.lstrip('/')}"
    headers: dict[str, str] = {VAULT_HEADER_TOKEN: vault_token}

    try:
        with httpx.Client(timeout=VAULT_HTTP_TIMEOUT_SECONDS) as client:
            response: httpx.Response = client.get(url, headers=headers)
            if response.status_code != status.HTTP_200_OK:
                raise RuntimeError(
                    f"Failed to fetch secrets from Vault at {url} (status {response.status_code}: {response.text}). Refusing to start."
                )

            body: dict[str, Any] = response.json()
            data: dict[str, Any] = body.get("data", {}).get("data", {})
            if not data:
                raise RuntimeError(f"Vault response at {url} is missing data.data payload. Refusing to start.")
            return {str(k): str(v) for k, v in data.items() if v is not None}
    except Exception as error:
        if isinstance(error, RuntimeError):
            raise
        raise RuntimeError(f"Failed to connect to Vault at {url}: {error}. Refusing to start.") from error


def _resolve_jwt_public_key(secrets: dict[str, str]) -> str:
    inline_key: str | None = secrets.get("JWT_PUBLIC_KEY")
    if not inline_key or not inline_key.strip():
        raise RuntimeError("JWT_PUBLIC_KEY is missing or empty in Vault secrets. Refusing to start.")
    return inline_key.strip()
