from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path
from typing import Final

from .config import MAX_READ_BYTES, MAX_WRITE_BYTES
from .models import (
    DirEntry,
    EditFileRequest,
    EditFileResponse,
    ListDirRequest,
    ListDirResponse,
    PatchFileRequest,
    PatchFileResponse,
    PatchedFile,
    ReadFileRequest,
    ReadFileResponse,
    WriteFileRequest,
    WriteFileResponse,
)

LOGGER: Final[logging.Logger] = logging.getLogger(__name__)

ENCODING: Final[str] = "utf-8"
LINE_SEPARATOR: Final[str] = "\n"
TEMPORARY_PREFIX: Final[str] = "."
TEMPORARY_SUFFIX: Final[str] = ".tmp"
TEMPORARY_TOKEN_BYTES: Final[int] = 8
EMPTY_SIZE_BYTES: Final[int] = 0
SINGLE_REPLACEMENT: Final[int] = 1
REQUIRED_UNIQUE_OCCURRENCES: Final[int] = 1
SortKey = tuple[bool, str]


class FsToolError(Exception):
    pass


def _is_within_root(root: Path, candidate: Path) -> bool:
    return candidate == root or root in candidate.parents


def _reject_symlink(path: Path) -> None:
    if path.is_symlink():
        raise FsToolError(f"refusing to operate on symlink: {path}")


def _display_path(root: Path, target: Path) -> str:
    if _is_within_root(root, target):
        return str(target.relative_to(root))
    return str(target)


def resolve_target(raw_path: str, root: Path) -> Path:
    if not raw_path:
        raise FsToolError("path must not be empty")

    candidate: Path = Path(raw_path)
    unresolved: Path = candidate if candidate.is_absolute() else root / candidate
    _reject_symlink(unresolved)

    resolved: Path = unresolved.resolve()
    if not _is_within_root(root, resolved):
        raise FsToolError(f"path escapes workspace root: {raw_path}")
    return resolved


def _sort_key(child: Path) -> SortKey:
    return (not child.is_dir(), child.name.lower())


def _write_atomically(target: Path, content: str) -> int:
    encoded: bytes = content.encode(ENCODING)
    size_bytes: int = len(encoded)
    if size_bytes > MAX_WRITE_BYTES:
        raise FsToolError(f"content exceeds {MAX_WRITE_BYTES} bytes: {size_bytes}")

    target.parent.mkdir(parents=True, exist_ok=True)
    token: str = secrets.token_hex(TEMPORARY_TOKEN_BYTES)
    temporary: Path = target.parent / f"{TEMPORARY_PREFIX}{target.name}.{token}{TEMPORARY_SUFFIX}"

    try:
        temporary.write_text(content, encoding=ENCODING)
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    return size_bytes


def _read_existing_text(target: Path) -> str:
    if not target.is_file():
        raise FsToolError(f"not a file: {target}")

    size_bytes: int = target.stat().st_size
    if size_bytes > MAX_READ_BYTES:
        raise FsToolError(f"file exceeds {MAX_READ_BYTES} bytes: {size_bytes}")
    return target.read_text(encoding=ENCODING)


def _replace_unique(content: str, old_text: str, new_text: str) -> str:
    occurrences: int = content.count(old_text)
    if occurrences == EMPTY_SIZE_BYTES:
        raise FsToolError("old_text not found")
    if occurrences > REQUIRED_UNIQUE_OCCURRENCES:
        raise FsToolError(f"old_text is not unique ({occurrences} matches)")
    return content.replace(old_text, new_text, SINGLE_REPLACEMENT)


def read_file(request: ReadFileRequest, root: Path) -> ReadFileResponse:
    target: Path = resolve_target(request.path, root)
    text: str = _read_existing_text(target)
    lines: list[str] = text.split(LINE_SEPARATOR)
    total_lines: int = len(lines)
    start_index: int = request.offset - 1

    if start_index >= total_lines and total_lines > EMPTY_SIZE_BYTES:
        raise FsToolError(f"offset {request.offset} beyond end of file ({total_lines} lines)")

    end_index: int = total_lines if request.limit is None else min(start_index + request.limit, total_lines)
    selected: list[str] = lines[start_index:end_index]
    truncated: bool = end_index < total_lines

    LOGGER.info(
        "read_file path=%s offset=%d line_count=%d truncated=%s",
        request.path,
        request.offset,
        len(selected),
        truncated,
    )
    return ReadFileResponse(
        path=_display_path(root, target),
        size_bytes=target.stat().st_size,
        total_lines=total_lines,
        offset=request.offset,
        line_count=len(selected),
        truncated=truncated,
        content=LINE_SEPARATOR.join(selected),
    )


def write_file(request: WriteFileRequest, root: Path) -> WriteFileResponse:
    target: Path = resolve_target(request.path, root)

    if target.exists() and target.is_dir():
        raise FsToolError(f"path is a directory: {target}")

    existed: bool = target.exists()
    if existed and not request.overwrite:
        raise FsToolError(f"file exists and overwrite is false: {target}")

    size_bytes: int = _write_atomically(target, request.content)
    LOGGER.info("write_file path=%s created=%s size_bytes=%d", request.path, not existed, size_bytes)
    return WriteFileResponse(
        path=_display_path(root, target),
        size_bytes=size_bytes,
        created=not existed,
        overwritten=existed,
    )


def edit_file(request: EditFileRequest, root: Path) -> EditFileResponse:
    target: Path = resolve_target(request.path, root)
    original: str = _read_existing_text(target)
    updated: str = _replace_unique(original, request.old_text, request.new_text)
    size_bytes: int = _write_atomically(target, updated)

    LOGGER.info("edit_file path=%s replacements=%d size_bytes=%d", request.path, SINGLE_REPLACEMENT, size_bytes)
    return EditFileResponse(
        path=_display_path(root, target),
        replacements=SINGLE_REPLACEMENT,
        size_bytes=size_bytes,
    )


def patch_file(request: PatchFileRequest, root: Path) -> PatchFileResponse:
    plans: list[tuple[Path, str, int]] = []

    for target_spec in request.files:
        target: Path = resolve_target(target_spec.path, root)
        content: str = _read_existing_text(target)
        for edit in target_spec.edits:
            content = _replace_unique(content, edit.old_text, edit.new_text)
        plans.append((target, content, len(target_spec.edits)))

    results: list[PatchedFile] = []
    for target, content, replacements in plans:
        size_bytes: int = _write_atomically(target, content)
        LOGGER.info("patch_file path=%s replacements=%d size_bytes=%d", str(target), replacements, size_bytes)
        results.append(
            PatchedFile(
                path=_display_path(root, target),
                replacements=replacements,
                size_bytes=size_bytes,
            )
        )
    return PatchFileResponse(files=results)


def list_dir(request: ListDirRequest, root: Path) -> ListDirResponse:
    target: Path = resolve_target(request.path, root)

    if not target.is_dir():
        raise FsToolError(f"not a directory: {target}")

    entries: list[DirEntry] = []
    truncated: bool = False

    for child in sorted(target.iterdir(), key=_sort_key):
        if len(entries) >= request.max_entries:
            truncated = True
            break
        is_dir: bool = child.is_dir()
        entries.append(
            DirEntry(
                name=child.name,
                is_dir=is_dir,
                is_symlink=child.is_symlink(),
                size_bytes=EMPTY_SIZE_BYTES if is_dir else child.lstat().st_size,
            )
        )

    LOGGER.info("list_dir path=%s entry_count=%d truncated=%s", request.path, len(entries), truncated)
    return ListDirResponse(
        path=_display_path(root, target),
        entries=entries,
        truncated=truncated,
    )
