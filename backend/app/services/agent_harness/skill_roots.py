"""Aria-native Skill root discovery, immutable snapshots, and selection metadata.

The ordered-root snapshot/cache model and error-isolated merge behavior are
Python adaptations of OpenAI Codex:

* ``codex-rs/skills/src/loading.rs``
* ``codex-rs/skills/src/selection.rs``
* ``codex-rs/ext/skills/src/loader/discovery.rs``
* ``codex-rs/ext/skills/src/loader/host.rs``
* ``codex-rs/ext/skills/src/loader/host_merge.rs``

Upstream baseline: commit ``343074d4207d572809bd8cea15f4be1d09d98e0b``
(Apache License 2.0).

Modified for AriaAI on 2026-08-22: local filesystem roots are bounded and
symlink-safe; package snapshots carry exact SHA-256 content fingerprints;
unchanged roots reuse an owner-managed cache; higher-priority roots shadow the
same package key; and one malformed package never blocks valid siblings. The
database remains Aria's published Skill source of truth. No Codex process,
protocol, SDK, or executable is used.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat as stat_module
import threading
from types import MappingProxyType
from typing import Iterable, Mapping, Sequence

from app.services.agent_harness.skill_package import (
    SkillPackageDocument,
    SkillPackageError,
    parse_skill_document,
)


MAX_SCAN_DEPTH = 8
MAX_DIRECTORIES_PER_ROOT = 4_000
MAX_FILES_PER_ROOT = 20_000
MAX_SKILLS_PER_ROOT = 1_000
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_PACKAGE_BYTES = 16 * 1024 * 1024
MAX_ROOT_BYTES = 64 * 1024 * 1024
SKILL_FILENAME = "SKILL.md"


class SkillRootError(ValueError):
    """Raised for a requested package or reference that is not safely usable."""


class FileBackedSkillPrompt(str):
    """String prompt carrying the file snapshot identity used to build it."""

    def __new__(
        cls,
        value: str,
        *,
        package_key: str,
        reference_files: Sequence[str] = (),
        source_fingerprint: str = "",
        package_version: str = "",
        package_status: str = "",
        load_error: str = "",
    ) -> "FileBackedSkillPrompt":
        instance = str.__new__(cls, value)
        instance.package_key = package_key
        instance.reference_files = tuple(reference_files)
        instance.source_fingerprint = source_fingerprint
        instance.package_version = package_version
        instance.package_status = package_status
        instance.load_error = load_error
        return instance


@dataclass(frozen=True)
class SkillRootSpec:
    path: Path
    priority: int = 100
    source: str = "configured"


@dataclass(frozen=True)
class SkillRootIssue:
    root: str
    path: str
    code: str
    message: str
    severity: str = "error"


@dataclass(frozen=True)
class SkillPackageSnapshot:
    key: str
    root: str
    skill_path: str
    document: SkillPackageDocument
    fingerprint: str
    files: Mapping[str, bytes]

    def render_prompt(self, reference_files: Sequence[str] = ()) -> str:
        parts = [self.document.instructions]
        for reference_name in reference_files:
            normalized = _safe_relative_reference(reference_name)
            candidates = (normalized, f"references/{normalized}")
            selected_name = next((name for name in candidates if name in self.files), None)
            if selected_name is None:
                # Preserve Aria's existing optional-reference behavior.
                continue
            try:
                reference_text = self.files[selected_name].decode("utf-8-sig").strip()
            except UnicodeDecodeError as exc:
                raise SkillRootError(
                    f"reference is not valid UTF-8 text: {reference_name}"
                ) from exc
            parts.append(
                f"## Bundled Reference: {reference_name}\n\n{reference_text}"
            )
        return "\n\n---\n\n".join(part for part in parts if part)


@dataclass(frozen=True)
class SkillRootSnapshot:
    root: str
    source: str
    priority: int
    inventory_fingerprint: str
    content_fingerprint: str
    packages: tuple[SkillPackageSnapshot, ...]
    issues: tuple[SkillRootIssue, ...]


@dataclass(frozen=True)
class LoadedSkillCatalog:
    roots: tuple[SkillRootSnapshot, ...]
    packages: tuple[SkillPackageSnapshot, ...]
    issues: tuple[SkillRootIssue, ...]
    fingerprint: str
    cache_hits: int
    refreshed_roots: int
    _packages_by_key: Mapping[str, SkillPackageSnapshot]
    _packages_by_basename: Mapping[str, tuple[SkillPackageSnapshot, ...]]

    def get(self, package_key: str) -> SkillPackageSnapshot | None:
        normalized = _normalize_package_key(package_key).casefold()
        exact = self._packages_by_key.get(normalized)
        if exact is not None:
            return exact
        basename_matches = self._packages_by_basename.get(
            PurePosixPath(normalized).name.casefold(), ()
        )
        return basename_matches[0] if len(basename_matches) == 1 else None

    def prompt(
        self,
        package_key: str,
        reference_files: Sequence[str] = (),
    ) -> FileBackedSkillPrompt:
        package = self.get(package_key)
        if package is None:
            return FileBackedSkillPrompt(
                "",
                package_key=package_key,
                reference_files=reference_files,
                load_error=f"Skill package not found or ambiguous: {package_key}",
            )
        try:
            rendered = package.render_prompt(reference_files)
        except (SkillRootError, SkillPackageError) as exc:
            return FileBackedSkillPrompt(
                "",
                package_key=package_key,
                reference_files=reference_files,
                source_fingerprint=package.fingerprint,
                load_error=str(exc),
            )
        return FileBackedSkillPrompt(
            rendered,
            package_key=package_key,
            reference_files=reference_files,
            source_fingerprint=package.fingerprint,
            package_version=str(package.document.metadata.get("version") or ""),
            package_status=str(package.document.metadata.get("status") or ""),
        )


@dataclass(frozen=True)
class _InventoryFile:
    relative_path: str
    path: Path
    size: int
    mtime_ns: int
    inode: int


@dataclass(frozen=True)
class _RootInventory:
    root: Path
    fingerprint: str
    files: tuple[_InventoryFile, ...]
    issues: tuple[SkillRootIssue, ...]


def _json_fingerprint(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _normalize_package_key(value: str) -> str:
    normalized = str(PurePosixPath(str(value or "").replace("\\", "/")))
    return normalized.removeprefix("./").strip("/")


def _safe_relative_reference(value: str) -> str:
    candidate = PurePosixPath(str(value or "").replace("\\", "/"))
    if candidate.is_absolute() or not candidate.parts or ".." in candidate.parts:
        raise SkillRootError(f"reference escapes skill package root: {value}")
    normalized = str(candidate).removeprefix("./")
    if normalized in {"", "."}:
        raise SkillRootError(f"invalid empty Skill reference: {value}")
    return normalized


class SkillRootSnapshotCache:
    """Owner-managed, thread-safe cache of immutable root snapshots."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._snapshots: dict[tuple[str, int, str], SkillRootSnapshot] = {}

    def get(
        self,
        key: tuple[str, int, str],
        inventory_fingerprint: str,
    ) -> SkillRootSnapshot | None:
        with self._lock:
            snapshot = self._snapshots.get(key)
            if snapshot and snapshot.inventory_fingerprint == inventory_fingerprint:
                return snapshot
            return None

    def insert(
        self,
        key: tuple[str, int, str],
        snapshot: SkillRootSnapshot,
    ) -> None:
        with self._lock:
            self._snapshots[key] = snapshot

    def clear(self) -> None:
        with self._lock:
            self._snapshots.clear()


class SkillRootLoader:
    """Load ordered local Skill roots while reusing unchanged root snapshots."""

    def __init__(self, cache: SkillRootSnapshotCache | None = None) -> None:
        self.cache = cache or SkillRootSnapshotCache()

    def load(self, roots: Iterable[SkillRootSpec]) -> LoadedSkillCatalog:
        indexed_roots = list(enumerate(roots))
        indexed_roots.sort(key=lambda item: (item[1].priority, item[0]))
        snapshots: list[SkillRootSnapshot] = []
        cache_hits = 0
        refreshed_roots = 0

        for _, spec in indexed_roots:
            inventory = _inventory_root(spec)
            cache_key = (str(inventory.root), spec.priority, spec.source)
            cached = self.cache.get(cache_key, inventory.fingerprint)
            if cached is not None:
                snapshots.append(cached)
                cache_hits += 1
                continue
            snapshot = _load_root_snapshot(spec, inventory)
            self.cache.insert(cache_key, snapshot)
            snapshots.append(snapshot)
            refreshed_roots += 1

        packages: list[SkillPackageSnapshot] = []
        issues: list[SkillRootIssue] = []
        by_key: dict[str, SkillPackageSnapshot] = {}
        by_basename: dict[str, list[SkillPackageSnapshot]] = {}
        for snapshot in snapshots:
            issues.extend(snapshot.issues)
            for package in snapshot.packages:
                normalized = package.key.casefold()
                winner = by_key.get(normalized)
                if winner is not None:
                    issues.append(
                        SkillRootIssue(
                            root=package.root,
                            path=package.skill_path,
                            code="shadowed_package",
                            message=(
                                f"package '{package.key}' is shadowed by higher-priority "
                                f"package {winner.skill_path}"
                            ),
                            severity="warning",
                        )
                    )
                    continue
                by_key[normalized] = package
                packages.append(package)
                by_basename.setdefault(PurePosixPath(normalized).name, []).append(package)

        catalog_fingerprint = _json_fingerprint(
            [(package.key, package.fingerprint, package.root) for package in packages]
        )
        return LoadedSkillCatalog(
            roots=tuple(snapshots),
            packages=tuple(packages),
            issues=tuple(issues),
            fingerprint=catalog_fingerprint,
            cache_hits=cache_hits,
            refreshed_roots=refreshed_roots,
            _packages_by_key=MappingProxyType(dict(by_key)),
            _packages_by_basename=MappingProxyType(
                {key: tuple(value) for key, value in by_basename.items()}
            ),
        )


def _root_hint(spec: SkillRootSpec) -> Path:
    expanded = spec.path.expanduser()
    if not expanded.is_absolute():
        return expanded.absolute()
    return expanded


def _issue(
    spec: SkillRootSpec,
    path: Path,
    code: str,
    message: str,
    *,
    severity: str = "error",
) -> SkillRootIssue:
    return SkillRootIssue(
        root=str(_root_hint(spec)),
        path=str(path),
        code=code,
        message=message,
        severity=severity,
    )


def _inventory_root(spec: SkillRootSpec) -> _RootInventory:
    root_hint = _root_hint(spec)
    issues: list[SkillRootIssue] = []
    if not spec.path.expanduser().is_absolute():
        issues.append(
            _issue(spec, root_hint, "relative_root", "Skill roots must be absolute paths")
        )
        return _RootInventory(
            root=root_hint,
            fingerprint=_json_fingerprint(("relative", str(root_hint))),
            files=(),
            issues=tuple(issues),
        )
    try:
        root = root_hint.resolve(strict=True)
    except (FileNotFoundError, OSError) as exc:
        issues.append(_issue(spec, root_hint, "missing_root", f"Skill root is unavailable: {exc}"))
        return _RootInventory(
            root=root_hint,
            fingerprint=_json_fingerprint(("missing", str(root_hint))),
            files=(),
            issues=tuple(issues),
        )
    if not root.is_dir():
        issues.append(_issue(spec, root, "not_directory", "Skill root is not a directory"))
        return _RootInventory(
            root=root,
            fingerprint=_json_fingerprint(("not-directory", str(root))),
            files=(),
            issues=tuple(issues),
        )

    files: list[_InventoryFile] = []
    directory_count = 0
    truncated = False
    try:
        walker = os.walk(root, topdown=True, followlinks=False)
        for current_raw, directory_names, file_names in walker:
            current = Path(current_raw)
            relative_current = current.relative_to(root)
            depth = len(relative_current.parts)
            directory_count += 1
            if directory_count > MAX_DIRECTORIES_PER_ROOT:
                truncated = True
                directory_names[:] = []
                break
            safe_directories: list[str] = []
            for name in sorted(directory_names):
                candidate = current / name
                if name.startswith("."):
                    continue
                if candidate.is_symlink():
                    issues.append(
                        _issue(
                            spec,
                            candidate,
                            "symlink_directory_ignored",
                            "symlinked Skill directories are not followed",
                            severity="warning",
                        )
                    )
                    continue
                safe_directories.append(name)
            directory_names[:] = safe_directories if depth < MAX_SCAN_DEPTH else []
            if depth >= MAX_SCAN_DEPTH and safe_directories:
                truncated = True

            for name in sorted(file_names):
                if name.startswith("."):
                    continue
                path = current / name
                if path.is_symlink():
                    issues.append(
                        _issue(spec, path, "symlink_file_ignored", "symlinked Skill files are not loaded")
                    )
                    continue
                try:
                    stat = path.stat()
                except OSError as exc:
                    issues.append(_issue(spec, path, "stat_failed", str(exc)))
                    continue
                if not path.is_file():
                    continue
                files.append(
                    _InventoryFile(
                        relative_path=path.relative_to(root).as_posix(),
                        path=path,
                        size=stat.st_size,
                        mtime_ns=stat.st_mtime_ns,
                        inode=getattr(stat, "st_ino", 0),
                    )
                )
                if len(files) >= MAX_FILES_PER_ROOT:
                    truncated = True
                    directory_names[:] = []
                    break
            if len(files) >= MAX_FILES_PER_ROOT:
                break
    except OSError as exc:
        issues.append(_issue(spec, root, "walk_failed", str(exc)))

    if truncated:
        issues.append(
            _issue(
                spec,
                root,
                "scan_truncated",
                "Skill root scan reached its bounded traversal limit",
            )
        )
    files.sort(key=lambda item: item.relative_path)
    signature = [
        (item.relative_path, item.size, item.mtime_ns, item.inode)
        for item in files
    ]
    return _RootInventory(
        root=root,
        fingerprint=_json_fingerprint(
            {
                "files": signature,
                "issues": [(item.path, item.code, item.message) for item in issues],
                "truncated": truncated,
            }
        ),
        files=tuple(files),
        issues=tuple(issues),
    )


def _package_files(
    package_dir: Path,
    skill_dirs: set[Path],
    inventory: _RootInventory,
) -> list[_InventoryFile]:
    nested_dirs = {
        candidate
        for candidate in skill_dirs
        if candidate != package_dir and package_dir in candidate.parents
    }
    result: list[_InventoryFile] = []
    for item in inventory.files:
        if item.path != package_dir and package_dir not in item.path.parents:
            continue
        if any(nested == item.path or nested in item.path.parents for nested in nested_dirs):
            continue
        result.append(item)
    return result


def _read_bounded_regular_file(
    path: Path,
    *,
    root: Path,
    package_dir: Path,
) -> bytes:
    """Read without following a last-component symlink or leaving the package."""
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise SkillRootError(f"failed to resolve Skill file: {exc}") from exc
    if root not in resolved.parents or package_dir not in resolved.parents:
        raise SkillRootError("Skill file resolves outside its package root")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise SkillRootError(f"failed to open Skill file safely: {exc}") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat_module.S_ISREG(metadata.st_mode):
            raise SkillRootError("Skill package members must be regular files")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            content = source.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise SkillRootError(
                f"Skill file exceeds maximum of {MAX_FILE_BYTES} bytes"
            )
        return content
    finally:
        os.close(descriptor)


def _load_root_snapshot(
    spec: SkillRootSpec,
    inventory: _RootInventory,
) -> SkillRootSnapshot:
    issues = list(inventory.issues)
    skill_files = [item for item in inventory.files if item.path.name == SKILL_FILENAME]
    if len(skill_files) > MAX_SKILLS_PER_ROOT:
        issues.append(
            _issue(
                spec,
                inventory.root,
                "too_many_skills",
                f"Skill root contains more than {MAX_SKILLS_PER_ROOT} packages",
            )
        )
        skill_files = skill_files[:MAX_SKILLS_PER_ROOT]
    skill_dirs = {item.path.parent for item in skill_files}
    packages: list[SkillPackageSnapshot] = []
    root_bytes = 0

    for skill_item in skill_files:
        package_dir = skill_item.path.parent
        relative_dir = package_dir.relative_to(inventory.root)
        package_key = (
            inventory.root.name
            if str(relative_dir) in {"", "."}
            else relative_dir.as_posix()
        )
        members = _package_files(package_dir, skill_dirs, inventory)
        package_size = sum(member.size for member in members)
        if package_size > MAX_PACKAGE_BYTES:
            issues.append(
                _issue(
                    spec,
                    skill_item.path,
                    "package_too_large",
                    f"package is {package_size} bytes; maximum is {MAX_PACKAGE_BYTES}",
                )
            )
            continue
        if root_bytes + package_size > MAX_ROOT_BYTES:
            issues.append(
                _issue(
                    spec,
                    inventory.root,
                    "root_too_large",
                    f"loaded package content exceeds {MAX_ROOT_BYTES} bytes",
                )
            )
            break
        root_bytes += package_size

        file_bytes: dict[str, bytes] = {}
        digest = hashlib.sha256()
        failed = False
        for member in members:
            relative_member = member.path.relative_to(package_dir).as_posix()
            if member.size > MAX_FILE_BYTES:
                issues.append(
                    _issue(
                        spec,
                        member.path,
                        "file_too_large",
                        f"Skill file is {member.size} bytes; maximum is {MAX_FILE_BYTES}",
                    )
                )
                failed = True
                break
            try:
                content = _read_bounded_regular_file(
                    member.path,
                    root=inventory.root,
                    package_dir=package_dir,
                )
            except (OSError, SkillRootError) as exc:
                issues.append(_issue(spec, member.path, "read_failed", str(exc)))
                failed = True
                break
            file_bytes[relative_member] = content
            digest.update(relative_member.encode("utf-8"))
            digest.update(b"\0")
            digest.update(len(content).to_bytes(8, "big"))
            digest.update(content)
        if failed:
            continue
        skill_contents = file_bytes.get(SKILL_FILENAME)
        if skill_contents is None:
            issues.append(_issue(spec, skill_item.path, "missing_skill_file", "SKILL.md disappeared during scan"))
            continue
        try:
            document = parse_skill_document(
                skill_contents.decode("utf-8-sig"),
                default_name=package_dir.name,
            )
        except (UnicodeDecodeError, SkillPackageError) as exc:
            issues.append(_issue(spec, skill_item.path, "invalid_skill", str(exc)))
            continue
        packages.append(
            SkillPackageSnapshot(
                key=_normalize_package_key(package_key),
                root=str(inventory.root),
                skill_path=str(skill_item.path),
                document=document,
                fingerprint=digest.hexdigest(),
                files=MappingProxyType(dict(file_bytes)),
            )
        )

    packages.sort(key=lambda package: (package.key.casefold(), package.skill_path))
    content_fingerprint = _json_fingerprint(
        [(package.key, package.fingerprint) for package in packages]
    )
    return SkillRootSnapshot(
        root=str(inventory.root),
        source=spec.source,
        priority=spec.priority,
        inventory_fingerprint=inventory.fingerprint,
        content_fingerprint=content_fingerprint,
        packages=tuple(packages),
        issues=tuple(issues),
    )
