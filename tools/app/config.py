from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import httpx

LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

DEFAULT_WORKSPACE_ROOT: Final[str] = "/app"
APP_MODE_DEV: Final[str] = "dev"
APP_MODE_PROD: Final[str] = "prod"
DEFAULT_JWT_AUDIENCE: Final[str] = "tools"
ENCODING: Final[str] = "utf-8"

MAX_READ_BYTES: Final[int] = 262_144
MAX_WRITE_BYTES: Final[int] = 1_048_576
MAX_LIST_ENTRIES: Final[int] = 500
MAX_PATCH_FILES: Final[int] = 32
MAX_PATCH_HUNKS_PER_FILE: Final[int] = 64

VAULT_HEADER_TOKEN: Final[str] = "X-Vault-Token"
VAULT_HTTP_TIMEOUT_SECONDS: Final[float] = 5.0
HTTP_STATUS_OK: Final[int] = 200
HTTP_STATUS_NOT_FOUND: Final[int] = 404


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
        vault_secrets: dict[str, str] = _fetch_vault_secrets()

        app_mode: str = _get_config_value("APP_MODE", vault_secrets, APP_MODE_DEV)
        if app_mode != APP_MODE_DEV:
            app_mode = APP_MODE_PROD

        jwt_audience: str = _get_config_value("JWT_AUDIENCE", vault_secrets, DEFAULT_JWT_AUDIENCE)
        jwt_public_key: str = _resolve_jwt_public_key(vault_secrets, app_mode)

        workspace_root_raw: str = _get_config_value("TOOLS_WORKSPACE_ROOT", vault_secrets, DEFAULT_WORKSPACE_ROOT)
        workspace_root: Path = Path(workspace_root_raw).expanduser().resolve()
        workspace_root.mkdir(parents=True, exist_ok=True)

        return cls(
            app_mode=app_mode,
            jwt_audience=jwt_audience,
            jwt_public_key=jwt_public_key,
            workspace_root=workspace_root,
        )


def _get_config_value(key: str, secrets: dict[str, str], default: str) -> str:
    value: str | None = os.environ.get(key) or secrets.get(key)
    return value if value is not None and value.strip() else default


def _fetch_vault_secrets() -> dict[str, str]:
    vault_addr: str | None = os.environ.get("VAULT_ADDR")
    vault_token: str | None = os.environ.get("VAULT_TOKEN")
    secret_path: str = os.environ.get("VAULT_SECRET_PATH", "secret/data/page-2-code/tools")

    if not vault_addr or not vault_token:
        LOGGER.info("vault configuration not set in environment, skipping vault secrets fetch")
        return {}

    url: str = f"{vault_addr.rstrip('/')}/v1/{secret_path.lstrip('/')}"
    headers: dict[str, str] = {VAULT_HEADER_TOKEN: vault_token}

    try:
        with httpx.Client(timeout=VAULT_HTTP_TIMEOUT_SECONDS) as client:
            response: httpx.Response = client.get(url, headers=headers)
            if response.status_code == HTTP_STATUS_NOT_FOUND:
                LOGGER.warning("vault path not found: %s", secret_path)
                return {}
            if response.status_code != HTTP_STATUS_OK:
                LOGGER.warning("failed to fetch secrets from vault: %s (status %d)", response.text, response.status_code)
                return {}

            body: dict[str, Any] = response.json()
            data: dict[str, Any] = body.get("data", {}).get("data", {})
            return {str(k): str(v) for k, v in data.items() if v is not None}
    except Exception as error:
        LOGGER.warning("vault connection failed: %s", error)
        return {}


def _resolve_jwt_public_key(secrets: dict[str, str], app_mode: str) -> str:
    inline_key: str | None = os.environ.get("JWT_PUBLIC_KEY") or secrets.get("JWT_PUBLIC_KEY")
    if inline_key and inline_key.strip():
        return inline_key.strip()

    path_str: str | None = os.environ.get("JWT_PUBLIC_KEY_PATH") or secrets.get("JWT_PUBLIC_KEY_PATH")
    if path_str and path_str.strip():
        key_path: Path = Path(path_str.strip())
        if key_path.is_file():
            return key_path.read_text(encoding=ENCODING)

    if app_mode == APP_MODE_PROD:
        raise RuntimeError("JWT public key is required when APP_MODE=prod (set JWT_PUBLIC_KEY or JWT_PUBLIC_KEY_PATH)")

    return ""
