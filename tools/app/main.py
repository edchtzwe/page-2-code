from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Final, TypeVar

from fastapi import FastAPI, HTTPException, status

from .auth import JwtAuthMiddleware
from .config import ToolsConfig
from .fs import FsToolError, edit_file, list_dir, patch_file, read_file, write_file
from .models import (
    EditFileRequest,
    EditFileResponse,
    HealthResponse,
    ListDirRequest,
    ListDirResponse,
    PatchFileRequest,
    PatchFileResponse,
    ReadFileRequest,
    ReadFileResponse,
    WriteFileRequest,
    WriteFileResponse,
)

LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

SERVICE_NAME: Final[str] = "page-2-code-tools"
SERVICE_VERSION: Final[str] = "0.0.0"
SERVICE_STATUS_OK: Final[str] = "ok"
LOG_FORMAT: Final[str] = "%(asctime)s %(levelname)s %(name)s %(message)s"
LOG_DATE_FORMAT: Final[str] = "%Y-%m-%dT%H:%M:%S%z"

RequestT = TypeVar("RequestT")
ResponseT = TypeVar("ResponseT")
logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt=LOG_DATE_FORMAT)

config: ToolsConfig = ToolsConfig.load()
app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION)
app.add_middleware(JwtAuthMiddleware, config=config)


def _execute(tool: Callable[[RequestT, Path], ResponseT], request: RequestT) -> ResponseT:
    try:
        return tool(request, config.workspace_root)
    except FsToolError as error:
        LOGGER.warning("tool rejected request: %s", error)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status=SERVICE_STATUS_OK, service=SERVICE_NAME, version=SERVICE_VERSION)


@app.post("/tools/read-file")
def read_file_route(request: ReadFileRequest) -> ReadFileResponse:
    return _execute(read_file, request)


@app.post("/tools/write-file")
def write_file_route(request: WriteFileRequest) -> WriteFileResponse:
    return _execute(write_file, request)


@app.post("/tools/edit-file")
def edit_file_route(request: EditFileRequest) -> EditFileResponse:
    return _execute(edit_file, request)


@app.post("/tools/patch-file")
def patch_file_route(request: PatchFileRequest) -> PatchFileResponse:
    return _execute(patch_file, request)


@app.post("/tools/list-dir")
def list_dir_route(request: ListDirRequest) -> ListDirResponse:
    return _execute(list_dir, request)
