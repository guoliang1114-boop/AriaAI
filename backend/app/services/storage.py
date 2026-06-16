from __future__ import annotations

from pathlib import Path

from app.config import UPLOADS_DIR


class StorageService:
    """Storage-key based local storage abstraction.

    Business modules use storage keys instead of absolute file paths so the
    implementation can later move from local disk to MinIO/S3 without changing
    knowledge ingestion code.
    """

    def __init__(self, root: Path = UPLOADS_DIR):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _safe_key(self, key: str) -> Path:
        normalized = Path(str(key).strip().lstrip("/"))
        if normalized.is_absolute() or ".." in normalized.parts:
            raise ValueError("Invalid storage key")
        return normalized

    def resolve_path(self, key: str) -> Path:
        relative = self._safe_key(key)
        path = (self.root / relative).resolve()
        path.relative_to(self.root.resolve())
        return path

    def put_bytes(self, key: str, content: bytes) -> str:
        path = self.resolve_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return str(self._safe_key(key))

    def put_text(self, key: str, content: str) -> str:
        return self.put_bytes(key, content.encode("utf-8"))

    def read_bytes(self, key: str) -> bytes:
        return self.resolve_path(key).read_bytes()

    def read_text(self, key: str) -> str:
        return self.resolve_path(key).read_text(encoding="utf-8", errors="replace")

    def exists(self, key: str) -> bool:
        return self.resolve_path(key).exists()

    def delete(self, key: str) -> None:
        path = self.resolve_path(key)
        if path.is_file():
            path.unlink()


storage_service = StorageService()
