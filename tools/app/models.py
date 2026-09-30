from __future__ import annotations

from typing import Final

from pydantic import BaseModel, ConfigDict, Field

from .config import MAX_LIST_ENTRIES, MAX_PATCH_FILES, MAX_PATCH_HUNKS_PER_FILE

DEFAULT_READ_OFFSET: Final[int] = 1
DEFAULT_LIST_PATH: Final[str] = "."
MIN_LINE_OFFSET: Final[int] = 1
MIN_LINE_LIMIT: Final[int] = 1
MIN_ITEMS: Final[int] = 1


class ToolRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToolResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(ToolResponse):
    status: str
    service: str
    version: str


class ReadFileRequest(ToolRequest):
    path: str = Field(min_length=MIN_ITEMS)
    offset: int = Field(default=DEFAULT_READ_OFFSET, ge=MIN_LINE_OFFSET)
    limit: int | None = Field(default=None, ge=MIN_LINE_LIMIT)


class ReadFileResponse(ToolResponse):
    path: str
    size_bytes: int
    total_lines: int
    offset: int
    line_count: int
    truncated: bool
    content: str


class WriteFileRequest(ToolRequest):
    path: str = Field(min_length=MIN_ITEMS)
    content: str
    overwrite: bool = False


class WriteFileResponse(ToolResponse):
    path: str
    size_bytes: int
    created: bool
    overwritten: bool


class EditFileRequest(ToolRequest):
    path: str = Field(min_length=MIN_ITEMS)
    old_text: str = Field(min_length=MIN_ITEMS)
    new_text: str


class EditFileResponse(ToolResponse):
    path: str
    replacements: int
    size_bytes: int


class PatchEdit(ToolRequest):
    old_text: str = Field(min_length=MIN_ITEMS)
    new_text: str


class PatchTarget(ToolRequest):
    path: str = Field(min_length=MIN_ITEMS)
    edits: list[PatchEdit] = Field(min_length=MIN_ITEMS, max_length=MAX_PATCH_HUNKS_PER_FILE)


class PatchFileRequest(ToolRequest):
    files: list[PatchTarget] = Field(min_length=MIN_ITEMS, max_length=MAX_PATCH_FILES)


class PatchedFile(ToolResponse):
    path: str
    replacements: int
    size_bytes: int


class PatchFileResponse(ToolResponse):
    files: list[PatchedFile]


class ListDirRequest(ToolRequest):
    path: str = Field(default=DEFAULT_LIST_PATH, min_length=MIN_ITEMS)
    max_entries: int = Field(default=MAX_LIST_ENTRIES, ge=MIN_ITEMS, le=MAX_LIST_ENTRIES)


class DirEntry(ToolResponse):
    name: str
    is_dir: bool
    is_symlink: bool
    size_bytes: int


class ListDirResponse(ToolResponse):
    path: str
    entries: list[DirEntry]
    truncated: bool
