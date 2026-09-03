"""Deterministic, content-safe verification for generated Aria artifacts.

This verifier is intentionally Aria-native. It never runs code, macros, or
scripts bundled by a Skill. The automated layer checks only filesystem
identity and well-known file-container integrity. Skill-specific completion
steps remain explicit manual requirements unless a future Aria-owned verifier
is registered for that exact check type.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from PIL import Image
from pypdf import PdfReader
from sqlmodel import Session, select

from app.models.db import ArtifactVerification, GeneratedFile


ARTIFACT_VERIFICATION_SCHEMA_VERSION = 1
ARTIFACT_VERIFIER_VERSION = 1
_MAX_XML_MEMBER_BYTES = 8 * 1024 * 1024
_MAX_TEXT_BYTES = 64 * 1024 * 1024
_MAX_VERIFICATION_FILE_BYTES = 512 * 1024 * 1024
_MAX_ZIP_ENTRIES = 20_000
_MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_CHECK_STATUSES = frozenset({"passed", "failed", "skipped"})
_VERIFICATION_STATUSES = frozenset(
    {"passed", "failed", "partial", "manual_required"}
)
_TECHNICAL_STATUSES = frozenset({"passed", "failed", "unsupported"})
_SKILL_STATUSES = frozenset(
    {"not_declared", "manual_required", "context_incomplete"}
)


def _stable_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_kind(value: Any) -> str:
    normalized = str(value or "").strip().lower().lstrip(".")
    return {
        "markdown": "md",
        "text": "txt",
        "jpeg": "jpg",
    }.get(normalized, normalized)


def _check(check_id: str, status: str, code: str = "") -> dict[str, str]:
    if status not in _CHECK_STATUSES:
        raise ValueError(f"invalid artifact verification check status: {status}")
    payload = {"check_id": str(check_id)[:80], "status": status}
    if code:
        payload["code"] = str(code)[:80]
    return payload


def _read_zip_xml(archive: zipfile.ZipFile, member: str) -> ElementTree.Element:
    info = archive.getinfo(member)
    if info.file_size > _MAX_XML_MEMBER_BYTES:
        raise ValueError("required XML member exceeds verification limit")
    data = archive.read(info)
    return ElementTree.fromstring(data)


def _verify_openxml(path: Path, kind: str) -> tuple[dict[str, str], dict[str, int]]:
    required_member = {
        "pptx": "ppt/presentation.xml",
        "docx": "word/document.xml",
        "xlsx": "xl/workbook.xml",
    }[kind]
    metric_name = {
        "pptx": "slide_count",
        "docx": "paragraph_count",
        "xlsx": "worksheet_count",
    }[kind]
    metric_value = 0
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            total_uncompressed = sum(max(0, int(item.file_size)) for item in entries)
            if (
                len(entries) > _MAX_ZIP_ENTRIES
                or total_uncompressed > _MAX_ZIP_UNCOMPRESSED_BYTES
            ):
                return _check("format_integrity", "failed", "archive_limits_exceeded"), {}
            if any(item.flag_bits & 0x1 for item in entries):
                return _check("format_integrity", "failed", "encrypted_archive_unsupported"), {}
            names = {item.filename for item in entries}
            if "[Content_Types].xml" not in names or required_member not in names:
                return _check("format_integrity", "failed", "required_package_member_missing"), {}
            _read_zip_xml(archive, "[Content_Types].xml")
            document_root = _read_zip_xml(archive, required_member)
            if kind == "pptx":
                structural_members = sorted(
                    name
                    for name in names
                    if re.fullmatch(r"ppt/slides/slide[0-9]+\.xml", name)
                )
                for member in structural_members:
                    _read_zip_xml(archive, member)
                metric_value = len(structural_members)
            elif kind == "xlsx":
                structural_members = sorted(
                    name
                    for name in names
                    if re.fullmatch(r"xl/worksheets/sheet[0-9]+\.xml", name)
                )
                for member in structural_members:
                    _read_zip_xml(archive, member)
                metric_value = len(structural_members)
            else:
                metric_value = sum(
                    element.tag.rsplit("}", 1)[-1] == "p"
                    for element in document_root.iter()
                )
            if metric_value < 1:
                return _check("format_integrity", "failed", f"empty_{metric_name}"), {
                    metric_name: 0
                }
    except (
        OSError,
        KeyError,
        ValueError,
        zipfile.BadZipFile,
        ElementTree.ParseError,
    ):
        return _check("format_integrity", "failed", "invalid_openxml_package"), {}
    return _check("format_integrity", "passed"), {metric_name: metric_value}


def _verify_pdf(path: Path) -> tuple[dict[str, str], dict[str, int]]:
    try:
        with path.open("rb") as source:
            if source.read(5) != b"%PDF-":
                return _check("format_integrity", "failed", "invalid_pdf_header"), {}
        reader = PdfReader(str(path), strict=False)
        if reader.is_encrypted:
            return _check("format_integrity", "failed", "encrypted_pdf_unsupported"), {}
        page_count = len(reader.pages)
        if page_count < 1:
            return _check("format_integrity", "failed", "empty_pdf"), {"page_count": 0}
    except Exception:
        return _check("format_integrity", "failed", "invalid_pdf"), {}
    return _check("format_integrity", "passed"), {"page_count": page_count}


def _verify_image(path: Path) -> tuple[dict[str, str], dict[str, int]]:
    try:
        with Image.open(path) as image:
            width, height = image.size
            image.verify()
        if width < 1 or height < 1:
            return _check("format_integrity", "failed", "empty_image"), {}
    except Exception:
        return _check("format_integrity", "failed", "invalid_image"), {}
    return _check("format_integrity", "passed"), {
        "width_px": int(width),
        "height_px": int(height),
    }


def _verify_text(path: Path, kind: str) -> tuple[dict[str, str], dict[str, int]]:
    try:
        if path.stat().st_size > _MAX_TEXT_BYTES:
            return _check("format_integrity", "failed", "text_validation_limit_exceeded"), {}
        text = path.read_text(encoding="utf-8")
        if not text.strip():
            return _check("format_integrity", "failed", "empty_text"), {"line_count": 0}
        metrics = {"line_count": len(text.splitlines()) or 1}
        if kind == "json":
            json.loads(text)
        elif kind == "csv":
            rows = csv.reader(text.splitlines())
            metrics["row_count"] = sum(1 for _ in rows)
            if metrics["row_count"] < 1:
                return _check("format_integrity", "failed", "empty_csv"), metrics
    except UnicodeDecodeError:
        return _check("format_integrity", "failed", "invalid_utf8"), {}
    except json.JSONDecodeError:
        return _check("format_integrity", "failed", "invalid_json"), {}
    except (OSError, csv.Error):
        return _check("format_integrity", "failed", "invalid_text_document"), {}
    return _check("format_integrity", "passed"), metrics


def _format_verification(path: Path, kind: str) -> tuple[dict[str, str], dict[str, int]]:
    if kind in {"pptx", "docx", "xlsx"}:
        return _verify_openxml(path, kind)
    if kind == "pdf":
        return _verify_pdf(path)
    if kind in {"png", "jpg"}:
        return _verify_image(path)
    if kind in {"md", "txt", "json", "csv", "html"}:
        return _verify_text(path, kind)
    return _check("format_integrity", "skipped", "unsupported_file_type"), {}


def normalize_artifact_verification_reference(value: Any) -> dict[str, Any]:
    """Whitelist the user-visible, content-free evidence summary."""

    if not isinstance(value, dict):
        return {}
    try:
        schema_version = int(value.get("schema_version") or 0)
        verifier_version = int(value.get("verifier_version") or 0)
        verification_id = int(value.get("verification_id") or 0)
    except (TypeError, ValueError):
        return {}
    status = str(value.get("status") or "")
    technical_status = str(value.get("technical_status") or "")
    skill_status = str(value.get("skill_status") or "")
    content_sha256 = str(value.get("content_sha256") or "").lower()
    evidence_sha256 = str(value.get("evidence_sha256") or "").lower()
    if (
        schema_version != ARTIFACT_VERIFICATION_SCHEMA_VERSION
        or verifier_version < 1
        or verification_id < 1
        or status not in _VERIFICATION_STATUSES
        or technical_status not in _TECHNICAL_STATUSES
        or skill_status not in _SKILL_STATUSES
        or not _SHA256_RE.fullmatch(content_sha256)
        or not _SHA256_RE.fullmatch(evidence_sha256)
    ):
        return {}
    counts: dict[str, int] = {}
    for key in (
        "automated_check_count",
        "automated_passed_count",
        "automated_failed_count",
        "automated_skipped_count",
        "skill_check_count",
    ):
        try:
            counts[key] = max(0, int(value.get(key) or 0))
        except (TypeError, ValueError):
            return {}
    if counts["automated_check_count"] != (
        counts["automated_passed_count"]
        + counts["automated_failed_count"]
        + counts["automated_skipped_count"]
    ):
        return {}
    inferred_technical_status = (
        "failed"
        if counts["automated_failed_count"]
        else "unsupported"
        if counts["automated_skipped_count"]
        else "passed"
    )
    if technical_status != inferred_technical_status:
        return {}
    expected_status = (
        "failed"
        if technical_status == "failed"
        else "partial"
        if technical_status == "unsupported" or skill_status == "context_incomplete"
        else "manual_required"
        if skill_status == "manual_required"
        else "passed"
    )
    if status != expected_status:
        return {}
    raw_metrics = value.get("metrics")
    if not isinstance(raw_metrics, dict):
        raw_metrics = {}
    metrics: dict[str, int] = {}
    for key in (
        "slide_count",
        "paragraph_count",
        "worksheet_count",
        "page_count",
        "line_count",
        "row_count",
        "width_px",
        "height_px",
    ):
        if key not in raw_metrics:
            continue
        try:
            metrics[key] = max(0, int(raw_metrics[key]))
        except (TypeError, ValueError):
            return {}
    normalized = {
        "schema_version": ARTIFACT_VERIFICATION_SCHEMA_VERSION,
        "verification_id": verification_id,
        "verifier_version": verifier_version,
        "status": status,
        "technical_status": technical_status,
        "skill_status": skill_status,
        "content_sha256": content_sha256,
        "evidence_sha256": evidence_sha256,
        **counts,
        "metrics": metrics,
    }
    plan_sha256 = str(value.get("verification_plan_sha256") or "").lower()
    if _SHA256_RE.fullmatch(plan_sha256):
        normalized["verification_plan_sha256"] = plan_sha256
    release_sha256 = str(value.get("skill_release_sha256") or "").lower()
    if _SHA256_RE.fullmatch(release_sha256):
        normalized["skill_release_sha256"] = release_sha256
    return normalized


def build_artifact_verification_evidence(
    path: Path,
    *,
    file_type: str,
    expected_content_sha256: str,
    skill_runtime_contract: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run bounded technical checks and bind any Skill checklist as manual."""

    resolved = Path(path)
    expected_kind = _canonical_kind(file_type)
    path_kind = _canonical_kind(resolved.suffix)
    expected_digest = str(expected_content_sha256 or "").strip().lower()
    checks: list[dict[str, str]] = []

    exists = resolved.is_file()
    checks.append(
        _check(
            "file_exists",
            "passed" if exists else "failed",
            "" if exists else "file_missing",
        )
    )
    size_bytes = resolved.stat().st_size if exists else 0
    checks.append(
        _check(
            "file_non_empty",
            "passed" if size_bytes > 0 else "failed",
            "" if size_bytes > 0 else "empty_file",
        )
    )
    actual_digest = _sha256_file(resolved) if exists else ""
    digest_matches = bool(
        _SHA256_RE.fullmatch(expected_digest) and actual_digest == expected_digest
    )
    checks.append(
        _check(
            "content_sha256_match",
            "passed" if digest_matches else "failed",
            "" if digest_matches else "content_digest_mismatch",
        )
    )
    extension_matches = bool(expected_kind and expected_kind == path_kind)
    checks.append(
        _check(
            "file_extension_match",
            "passed" if extension_matches else "failed",
            "" if extension_matches else "file_extension_mismatch",
        )
    )
    if size_bytes > _MAX_VERIFICATION_FILE_BYTES:
        format_check, metrics = (
            _check("format_integrity", "failed", "file_size_limit_exceeded"),
            {},
        )
    elif exists and size_bytes > 0:
        format_check, metrics = _format_verification(resolved, expected_kind)
    else:
        format_check, metrics = (
            _check("format_integrity", "failed", "file_unavailable"),
            {},
        )
    checks.append(format_check)

    passed_count = sum(item["status"] == "passed" for item in checks)
    failed_count = sum(item["status"] == "failed" for item in checks)
    skipped_count = sum(item["status"] == "skipped" for item in checks)
    technical_status = (
        "failed" if failed_count else "unsupported" if skipped_count else "passed"
    )

    runtime = skill_runtime_contract if isinstance(skill_runtime_contract, dict) else {}
    verification_status = str(runtime.get("verification_status") or "not_declared")
    try:
        skill_check_count = max(0, int(runtime.get("verification_step_count") or 0))
    except (TypeError, ValueError):
        skill_check_count = 0
    if verification_status != "available":
        skill_status = "not_declared"
        skill_check_count = 0
    elif bool(runtime.get("verification_context_complete")):
        skill_status = "manual_required"
    else:
        skill_status = "context_incomplete"

    if technical_status == "failed":
        status = "failed"
    elif technical_status == "unsupported" or skill_status == "context_incomplete":
        status = "partial"
    elif skill_status == "manual_required":
        status = "manual_required"
    else:
        status = "passed"

    evidence: dict[str, Any] = {
        "schema_version": ARTIFACT_VERIFICATION_SCHEMA_VERSION,
        "verifier_version": ARTIFACT_VERIFIER_VERSION,
        "status": status,
        "technical_status": technical_status,
        "skill_status": skill_status,
        "content_sha256": actual_digest or expected_digest,
        "automated_check_count": len(checks),
        "automated_passed_count": passed_count,
        "automated_failed_count": failed_count,
        "automated_skipped_count": skipped_count,
        "skill_check_count": skill_check_count,
        "checks": checks,
        "metrics": metrics,
    }
    verification_plan_sha256 = str(
        runtime.get("verification_plan_sha256") or ""
    ).lower()
    if verification_status == "available" and _SHA256_RE.fullmatch(
        verification_plan_sha256
    ):
        evidence["verification_plan_sha256"] = verification_plan_sha256
    skill_release_sha256 = str(runtime.get("release_sha256") or "").lower()
    if _SHA256_RE.fullmatch(skill_release_sha256):
        evidence["skill_release_sha256"] = skill_release_sha256
    evidence["evidence_sha256"] = _sha256_json(evidence)
    return evidence


def artifact_verification_reference(record: ArtifactVerification) -> dict[str, Any]:
    try:
        evidence = json.loads(record.evidence_json or "{}")
    except json.JSONDecodeError:
        evidence = {}
    if not isinstance(evidence, dict):
        return {}
    hashed_evidence = dict(evidence)
    stored_evidence_sha256 = str(hashed_evidence.pop("evidence_sha256", "")).lower()
    bound_values = (
        ("verifier_version", int(record.verifier_version or 0)),
        ("content_sha256", record.content_sha256),
        ("status", record.status),
        ("technical_status", record.technical_status),
        ("skill_status", record.skill_status),
        ("automated_check_count", record.automated_check_count),
        ("automated_passed_count", record.automated_passed_count),
        ("automated_failed_count", record.automated_failed_count),
        ("automated_skipped_count", record.automated_skipped_count),
        ("skill_check_count", record.skill_check_count),
    )
    if (
        stored_evidence_sha256 != record.evidence_sha256
        or _sha256_json(hashed_evidence) != record.evidence_sha256
        or any(evidence.get(key) != expected for key, expected in bound_values)
        or str(evidence.get("skill_release_sha256") or "")
        != record.skill_release_sha256
    ):
        return {}
    reference = {
        "schema_version": ARTIFACT_VERIFICATION_SCHEMA_VERSION,
        "verification_id": int(record.id or 0),
        "verifier_version": int(record.verifier_version or 0),
        "status": record.status,
        "technical_status": record.technical_status,
        "skill_status": record.skill_status,
        "content_sha256": record.content_sha256,
        "evidence_sha256": record.evidence_sha256,
        "automated_check_count": record.automated_check_count,
        "automated_passed_count": record.automated_passed_count,
        "automated_failed_count": record.automated_failed_count,
        "automated_skipped_count": record.automated_skipped_count,
        "skill_check_count": record.skill_check_count,
        "metrics": evidence.get("metrics") if isinstance(evidence, dict) else {},
        "verification_plan_sha256": (
            evidence.get("verification_plan_sha256")
            if isinstance(evidence, dict)
            else None
        ),
        "skill_release_sha256": record.skill_release_sha256 or None,
    }
    return normalize_artifact_verification_reference(reference)


def persist_artifact_verification(
    session: Session,
    artifact: GeneratedFile,
    path: Path,
    *,
    skill_runtime_contract: dict[str, Any] | None = None,
    skill_id: int | None = None,
    skill_release_id: int | None = None,
) -> dict[str, Any]:
    """Persist or reuse the immutable evidence bound to exact file bytes."""

    if artifact.id is None:
        raise ValueError("generated artifact must be flushed before verification")
    evidence = build_artifact_verification_evidence(
        path,
        file_type=artifact.file_type,
        expected_content_sha256=artifact.content_sha256,
        skill_runtime_contract=skill_runtime_contract,
    )
    if evidence["content_sha256"] != artifact.content_sha256:
        raise ValueError("artifact content changed during verification")
    release_sha256 = str(evidence.get("skill_release_sha256") or "").lower()
    if not _SHA256_RE.fullmatch(release_sha256):
        release_sha256 = ""
    existing = session.exec(
        select(ArtifactVerification).where(
            ArtifactVerification.generated_file_id == int(artifact.id),
            ArtifactVerification.content_sha256 == evidence["content_sha256"],
            ArtifactVerification.verifier_version == ARTIFACT_VERIFIER_VERSION,
            ArtifactVerification.skill_release_sha256 == release_sha256,
        )
    ).first()
    if existing is None:
        existing = ArtifactVerification(
            generated_file_id=int(artifact.id),
            run_id=str(artifact.run_id or "")[:96],
            output_id=str(artifact.output_id or "")[:96],
            skill_id=skill_id if isinstance(skill_id, int) and skill_id > 0 else None,
            skill_release_id=(
                skill_release_id
                if isinstance(skill_release_id, int) and skill_release_id > 0
                else None
            ),
            skill_release_sha256=release_sha256,
            content_sha256=evidence["content_sha256"],
            evidence_sha256=evidence["evidence_sha256"],
            status=evidence["status"],
            technical_status=evidence["technical_status"],
            skill_status=evidence["skill_status"],
            verifier_version=ARTIFACT_VERIFIER_VERSION,
            automated_check_count=evidence["automated_check_count"],
            automated_passed_count=evidence["automated_passed_count"],
            automated_failed_count=evidence["automated_failed_count"],
            automated_skipped_count=evidence["automated_skipped_count"],
            skill_check_count=evidence["skill_check_count"],
            evidence_json=_stable_json(evidence),
        )
        session.add(existing)
        session.flush()
    reference = artifact_verification_reference(existing)
    if not reference:
        raise ValueError("artifact verification evidence integrity check failed")
    return reference


def latest_artifact_verification_reference(
    session: Session,
    *,
    generated_file_id: int,
    content_sha256: str,
) -> dict[str, Any]:
    record = session.exec(
        select(ArtifactVerification)
        .where(
            ArtifactVerification.generated_file_id == int(generated_file_id),
            ArtifactVerification.content_sha256 == str(content_sha256 or "").lower(),
        )
        .order_by(ArtifactVerification.created_at.desc(), ArtifactVerification.id.desc())
    ).first()
    if record is None:
        return {}
    reference = artifact_verification_reference(record)
    if not reference:
        raise ValueError("artifact verification evidence integrity check failed")
    return reference


def artifact_verification_evidence_payload(record: ArtifactVerification) -> dict[str, Any]:
    """Return bounded full check evidence for an authorized API response."""

    reference = artifact_verification_reference(record)
    if not reference:
        return {}
    try:
        evidence = json.loads(record.evidence_json or "{}")
    except json.JSONDecodeError:
        evidence = {}
    checks = []
    raw_checks = evidence.get("checks") if isinstance(evidence, dict) else []
    for item in list(raw_checks or [])[:16]:
        if not isinstance(item, dict):
            continue
        check_id = str(item.get("check_id") or "")[:80]
        status = str(item.get("status") or "")
        if not check_id or status not in _CHECK_STATUSES:
            continue
        normalized = {"check_id": check_id, "status": status}
        code = str(item.get("code") or "")[:80]
        if code:
            normalized["code"] = code
        checks.append(normalized)
    return {**reference, "checks": checks, "created_at": record.created_at.isoformat()}
