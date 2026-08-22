"""Aria-native structured text patch planning and atomic file writes.

The patch grammar, ordered context search, replacement planning, unified-diff
preview, and line-ending preservation are Python adaptations of OpenAI Codex:

* ``codex-rs/apply-patch/src/parser.rs``
* ``codex-rs/apply-patch/src/file_update.rs``
* ``codex-rs/apply-patch/src/seek_sequence.rs``
* ``codex-rs/apply-patch/src/text_file.rs``

Upstream baseline: commit ``343074d4207d572809bd8cea15f4be1d09d98e0b``
(Apache License 2.0).

Modified for AriaAI on 2026-08-22: only one existing Markdown/text artifact
may be updated; add/delete/move operations and shell invocation parsing are
intentionally excluded. Aria adds exact base-content hashes, ambiguous-context
rejection, bounded inputs, cross-process locking, atomic replacement, and a
version-backed rollback contract. This module does not communicate with Codex.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import difflib
import hashlib
import os
from pathlib import Path, PurePosixPath
import tempfile
import threading
from typing import Iterator, Sequence


BEGIN_PATCH_MARKER = "*** Begin Patch"
END_PATCH_MARKER = "*** End Patch"
UPDATE_FILE_MARKER = "*** Update File: "
EOF_MARKER = "*** End of File"
MAX_PATCH_BYTES = 256 * 1024
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024


class StructuredPatchError(ValueError):
    """A safe, user-correctable structured patch error."""

    def __init__(self, code: str, message: str, *, line_number: int | None = None):
        self.code = code
        self.line_number = line_number
        prefix = f"line {line_number}: " if line_number is not None else ""
        super().__init__(f"{code}: {prefix}{message}")


class StructuredPatchConflict(StructuredPatchError):
    """The requested patch no longer has one deterministic target."""


@dataclass(frozen=True)
class PatchChunk:
    change_context: str | None
    old_lines: tuple[str, ...]
    new_lines: tuple[str, ...]
    end_of_file: bool = False


@dataclass(frozen=True)
class ParsedPatch:
    target_path: str
    chunks: tuple[PatchChunk, ...]


@dataclass(frozen=True)
class StructuredPatchPlan:
    target_path: str
    base_sha256: str
    result_sha256: str
    original_content: str
    result_content: str
    unified_diff: str
    replacement_count: int


@dataclass
class _SourceLine:
    text: str
    ending: str | None


@dataclass
class _SourceText:
    lines: list[_SourceLine]
    preferred_ending: str

    @classmethod
    def parse(cls, content: str) -> "_SourceText":
        lines: list[_SourceLine] = []
        preferred: str | None = None
        start = 0
        cursor = 0
        while cursor < len(content):
            char = content[cursor]
            if char == "\r":
                ending = "\r\n" if cursor + 1 < len(content) and content[cursor + 1] == "\n" else "\r"
            elif char == "\n":
                ending = "\n"
            else:
                cursor += 1
                continue
            preferred = preferred or ending
            lines.append(_SourceLine(content[start:cursor], ending))
            cursor += len(ending)
            start = cursor
        if start < len(content):
            lines.append(_SourceLine(content[start:], None))
        return cls(lines=lines, preferred_ending=preferred or "\n")

    def line_texts(self) -> list[str]:
        return [line.text for line in self.lines]

    def apply_replacements(self, replacements: Sequence[tuple[int, int, Sequence[str]]]) -> str:
        lines = list(self.lines)
        for start, old_len, new_segment in sorted(replacements, key=lambda item: item[0], reverse=True):
            inserted = [_SourceLine(text, self.preferred_ending) for text in new_segment]
            lines[start : start + old_len] = inserted

        # Codex updates historically terminate every resulting text line. Keep
        # unchanged mixed endings, but give inserted or formerly-unterminated
        # lines the source file's first observed ending.
        for line in lines:
            line.ending = line.ending or self.preferred_ending
        return "".join(f"{line.text}{line.ending or ''}" for line in lines)


def content_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _validate_document_size(content: str) -> None:
    size = len(content.encode("utf-8"))
    if size > MAX_DOCUMENT_BYTES:
        raise StructuredPatchError(
            "document_too_large",
            f"document is {size} bytes; maximum is {MAX_DOCUMENT_BYTES}",
        )


def _finish_chunk(
    chunks: list[PatchChunk],
    *,
    context: str | None,
    old_lines: list[str],
    new_lines: list[str],
    changed: bool,
    end_of_file: bool,
    line_number: int,
) -> None:
    if not changed:
        if old_lines or new_lines or context is not None or end_of_file:
            raise StructuredPatchError(
                "empty_patch_chunk",
                "each chunk must add or remove at least one line",
                line_number=line_number,
            )
        return
    chunks.append(
        PatchChunk(
            change_context=context,
            old_lines=tuple(old_lines),
            new_lines=tuple(new_lines),
            end_of_file=end_of_file,
        )
    )


def parse_structured_patch(patch: str) -> ParsedPatch:
    if not isinstance(patch, str) or not patch.strip():
        raise StructuredPatchError("empty_patch", "patch text is required")
    patch_size = len(patch.encode("utf-8"))
    if patch_size > MAX_PATCH_BYTES:
        raise StructuredPatchError(
            "patch_too_large",
            f"patch is {patch_size} bytes; maximum is {MAX_PATCH_BYTES}",
        )

    lines = patch.strip("\r\n").splitlines()
    if len(lines) < 3 or lines[0].strip() != BEGIN_PATCH_MARKER or lines[-1].strip() != END_PATCH_MARKER:
        raise StructuredPatchError(
            "invalid_patch_boundaries",
            f"patch must start with '{BEGIN_PATCH_MARKER}' and end with '{END_PATCH_MARKER}'",
        )

    update_line = lines[1].strip()
    if not update_line.startswith(UPDATE_FILE_MARKER):
        raise StructuredPatchError(
            "update_only",
            "Aria structured patches support exactly one existing text document update",
            line_number=2,
        )
    target_path = update_line[len(UPDATE_FILE_MARKER) :].strip()
    if not target_path:
        raise StructuredPatchError("missing_target", "update target is required", line_number=2)
    normalized_path = PurePosixPath(target_path.replace("\\", "/"))
    if normalized_path.is_absolute() or ".." in normalized_path.parts or normalized_path.name in {"", "."}:
        raise StructuredPatchError(
            "unsafe_target",
            "target must be a relative artifact name without parent traversal",
            line_number=2,
        )

    chunks: list[PatchChunk] = []
    context: str | None = None
    old_lines: list[str] = []
    new_lines: list[str] = []
    changed = False
    end_of_file = False

    for index, line in enumerate(lines[2:-1], start=3):
        stripped = line.strip()
        if stripped.startswith(("*** Add File:", "*** Delete File:", "*** Move to:", "*** Update File:")):
            raise StructuredPatchError(
                "single_update_only",
                "add, delete, move, and multiple-file operations are not allowed",
                line_number=index,
            )
        if line == "@@" or line.startswith("@@ "):
            _finish_chunk(
                chunks,
                context=context,
                old_lines=old_lines,
                new_lines=new_lines,
                changed=changed,
                end_of_file=end_of_file,
                line_number=index,
            )
            context = line[3:] if line.startswith("@@ ") else None
            old_lines = []
            new_lines = []
            changed = False
            end_of_file = False
            continue
        if stripped == EOF_MARKER:
            if end_of_file:
                raise StructuredPatchError("duplicate_eof", "duplicate end-of-file marker", line_number=index)
            end_of_file = True
            continue
        if end_of_file:
            raise StructuredPatchError(
                "content_after_eof",
                "no patch content is allowed after the end-of-file marker",
                line_number=index,
            )
        if not line or line[0] not in {" ", "+", "-"}:
            raise StructuredPatchError(
                "invalid_patch_line",
                "patch lines must begin with a space, '+', '-', '@@', or an EOF marker",
                line_number=index,
            )
        prefix, value = line[0], line[1:]
        if prefix == " ":
            old_lines.append(value)
            new_lines.append(value)
        elif prefix == "-":
            old_lines.append(value)
            changed = True
        else:
            new_lines.append(value)
            changed = True

    _finish_chunk(
        chunks,
        context=context,
        old_lines=old_lines,
        new_lines=new_lines,
        changed=changed,
        end_of_file=end_of_file,
        line_number=len(lines) - 1,
    )
    if not chunks:
        raise StructuredPatchError("empty_patch", "patch must contain at least one changed chunk")
    return ParsedPatch(target_path=str(normalized_path), chunks=tuple(chunks))


def _unique_sequence_index(
    lines: Sequence[str],
    pattern: Sequence[str],
    *,
    start: int,
    end_of_file: bool,
    label: str,
) -> int:
    if not pattern:
        if end_of_file:
            return len(lines)
        raise StructuredPatchError(
            "unsafe_insertion",
            "an insertion without old lines needs a unique @@ context line or an EOF marker",
        )
    if len(pattern) > len(lines):
        raise StructuredPatchConflict("missing_context", f"could not find expected lines for {label}")

    last = len(lines) - len(pattern)
    candidates = [
        index
        for index in range(max(start, 0), last + 1)
        if list(lines[index : index + len(pattern)]) == list(pattern)
    ]
    if end_of_file:
        candidates = [index for index in candidates if index + len(pattern) == len(lines)]
    if not candidates:
        raise StructuredPatchConflict("missing_context", f"could not find expected lines for {label}")
    if len(candidates) > 1:
        raise StructuredPatchConflict(
            "ambiguous_context",
            f"expected lines for {label} match {len(candidates)} locations; add more context",
        )
    return candidates[0]


def _chunk_replacements(
    start: int,
    old_lines: Sequence[str],
    new_lines: Sequence[str],
) -> list[tuple[int, int, tuple[str, ...]]]:
    if not old_lines:
        return [(start, 0, tuple(new_lines))]
    matcher = difflib.SequenceMatcher(a=list(old_lines), b=list(new_lines), autojunk=False)
    replacements: list[tuple[int, int, tuple[str, ...]]] = []
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        replacements.append(
            (start + old_start, old_end - old_start, tuple(new_lines[new_start:new_end]))
        )
    return replacements


def _unified_diff(target_path: str, before: str, after: str) -> str:
    lines = list(
        difflib.unified_diff(
            before.splitlines(),
            after.splitlines(),
            fromfile=f"a/{target_path}",
            tofile=f"b/{target_path}",
            n=3,
            lineterm="",
        )
    )
    return "\n".join(lines) + ("\n" if lines else "")


def plan_content_transition(*, target_path: str, base_content: str, result_content: str) -> StructuredPatchPlan:
    """Plan a full-content transition, used by version-backed rollback."""

    _validate_document_size(base_content)
    _validate_document_size(result_content)
    base_hash = content_sha256(base_content)
    result_hash = content_sha256(result_content)
    if base_hash == result_hash:
        raise StructuredPatchError("no_effect", "the requested change would not modify the document")
    return StructuredPatchPlan(
        target_path=target_path,
        base_sha256=base_hash,
        result_sha256=result_hash,
        original_content=base_content,
        result_content=result_content,
        unified_diff=_unified_diff(target_path, base_content, result_content),
        replacement_count=1,
    )


def plan_structured_patch(
    patch: str,
    *,
    base_content: str,
    expected_path: str,
) -> StructuredPatchPlan:
    """Parse, resolve, and preview one deterministic text artifact update."""

    _validate_document_size(base_content)
    parsed = parse_structured_patch(patch)
    if PurePosixPath(parsed.target_path).name.casefold() != Path(expected_path).name.casefold():
        raise StructuredPatchError(
            "target_mismatch",
            f"patch targets '{parsed.target_path}', but the selected artifact is '{expected_path}'",
        )

    source = _SourceText.parse(base_content)
    source_lines = source.line_texts()
    replacements: list[tuple[int, int, tuple[str, ...]]] = []
    cursor = 0
    previous_end = 0

    for chunk_number, chunk in enumerate(parsed.chunks, start=1):
        search_start = cursor
        if chunk.change_context is not None:
            context_index = _unique_sequence_index(
                source_lines,
                (chunk.change_context,),
                start=cursor,
                end_of_file=False,
                label=f"chunk {chunk_number} context '{chunk.change_context}'",
            )
            search_start = context_index + 1

        if chunk.old_lines:
            start = _unique_sequence_index(
                source_lines,
                chunk.old_lines,
                start=search_start,
                end_of_file=chunk.end_of_file,
                label=f"chunk {chunk_number}",
            )
        elif chunk.change_context is not None:
            start = search_start
        elif chunk.end_of_file:
            start = len(source_lines)
        else:  # Defensive; parser/planner contract should already reject this.
            raise StructuredPatchError("unsafe_insertion", f"chunk {chunk_number} has no anchor")

        if start < previous_end or (start == previous_end and not chunk.old_lines and replacements):
            raise StructuredPatchConflict(
                "overlapping_chunks",
                f"chunk {chunk_number} overlaps or reuses the previous patch location",
            )
        chunk_changes = _chunk_replacements(start, chunk.old_lines, chunk.new_lines)
        replacements.extend(chunk_changes)
        cursor = start + len(chunk.old_lines)
        previous_end = cursor

    if not replacements:
        raise StructuredPatchError("no_effect", "the patch contains no effective replacements")
    result_content = source.apply_replacements(replacements)
    _validate_document_size(result_content)
    base_hash = content_sha256(base_content)
    result_hash = content_sha256(result_content)
    if base_hash == result_hash:
        raise StructuredPatchError("no_effect", "the patch would not modify the document")

    return StructuredPatchPlan(
        target_path=parsed.target_path,
        base_sha256=base_hash,
        result_sha256=result_hash,
        original_content=base_content,
        result_content=result_content,
        unified_diff=_unified_diff(parsed.target_path, base_content, result_content),
        replacement_count=len(replacements),
    )


_PATH_LOCKS: dict[str, threading.RLock] = {}
_PATH_LOCKS_GUARD = threading.Lock()


@contextmanager
def locked_text_path(path: Path) -> Iterator[None]:
    """Serialize compare-and-swap writes for a project artifact path."""

    resolved = str(path.resolve(strict=False))
    with _PATH_LOCKS_GUARD:
        thread_lock = _PATH_LOCKS.setdefault(resolved, threading.RLock())
    with thread_lock:
        lock_path = path.parent / f".{path.name}.aria.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock_file:
            try:
                import fcntl  # Unix/macOS production and development hosts.
            except ImportError:  # pragma: no cover - Windows fallback is process-local.
                fcntl = None  # type: ignore[assignment]
            if fcntl is not None:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def atomic_write_text(path: Path, content: str) -> int:
    """Atomically replace one UTF-8 text file and return its byte size."""

    if not path.is_file():
        raise FileNotFoundError(path)
    encoded = content.encode("utf-8")
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.aria-", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "wb") as temp_file:
            temp_file.write(encoded)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
        except OSError:
            directory_fd = None
        if directory_fd is not None:
            try:
                try:
                    os.fsync(directory_fd)
                except OSError:
                    # The atomic rename has already succeeded. Some filesystems
                    # do not support directory fsync; do not misreport the write
                    # as failed after the target has changed.
                    pass
            finally:
                os.close(directory_fd)
        return len(encoded)
    finally:
        if temp_path.exists():
            temp_path.unlink()
