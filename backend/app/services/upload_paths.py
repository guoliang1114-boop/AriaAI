from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException


def resolve_upload_path(
    uploads_dir: Path,
    stored_path: str,
    *,
    must_exist: bool = True,
    allow_absolute: bool = True,
) -> Path:
    """Resolve a stored uploads path and ensure it cannot escape uploads_dir."""
    uploads_root = uploads_dir.resolve()
    raw_path = Path(stored_path)
    if raw_path.is_absolute():
        if not allow_absolute:
            raise HTTPException(status_code=400, detail="Invalid path")
        candidate = raw_path.resolve()
    else:
        candidate = (uploads_root / raw_path).resolve()

    try:
        candidate.relative_to(uploads_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")

    if must_exist and not candidate.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return candidate


def normalize_relative_upload_path(uploads_dir: Path, path: str) -> str:
    """Return a normalized relative uploads path from user input."""
    resolved = resolve_upload_path(
        uploads_dir,
        path,
        must_exist=False,
        allow_absolute=False,
    )
    return str(resolved.relative_to(uploads_dir.resolve()))
