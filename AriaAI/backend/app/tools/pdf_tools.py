"""PDF manipulation tools — merge, split, extract pages, add watermarks."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import engine
from app.models.db import ProjectFile
from app.services.cache import projects_cache
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_files import active_project_files_stmt
from app.services.tool_descriptions import tool_description
from app.tools import registry

MANAGE_PDF_TOOL_NAME = "manage_pdf"

_READABLE_PDF_TYPES = {"pdf"}


def _bust_cache(project_id: int) -> None:
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")


def _find_project_file(session: Session, project_id: int, file_id: int | None, file_name: str | None) -> ProjectFile:
    if file_id is not None:
        project_file = session.get(ProjectFile, file_id)
        if not project_file or project_file.project_id != project_id or project_file.deleted_at is not None:
            raise HTTPException(404, "File not found")
        return project_file
    normalized = (file_name or "").strip().lower()
    if not normalized:
        raise HTTPException(400, "Provide file_id or file_name")
    files = session.exec(active_project_files_stmt(project_id)).all()
    for project_file in files:
        if project_file.name.strip().lower() == normalized:
            return project_file
    raise HTTPException(404, "File not found")


def _file_path(project_file: ProjectFile) -> Path:
    full_path = UPLOADS_DIR / Path(project_file.path)
    try:
        full_path.resolve().relative_to(UPLOADS_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(400, "Invalid project file path") from exc
    if not full_path.is_file():
        raise HTTPException(404, "File not found on disk")
    return full_path


def _generated_dir() -> Path:
    d = UPLOADS_DIR / "generated"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _register_file(session: Session, project_id: int, source_path: Path, file_name: str, summary: str, folder_id: int | None = None) -> ProjectFile:
    safe_name = "_".join((file_name or "document").strip().split())
    for char in '/\\:*?"<>|':
        safe_name = safe_name.replace(char, "_")
    safe_name = safe_name.strip("._")[:96] or "document"
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"

    from app.services.project_documents import infer_project_folder
    from app.services.project_core import init_default_project_folders

    init_default_project_folders(session, project_id)
    if folder_id is None:
        folder = infer_project_folder(
            session, project_id,
            init_default_folders=init_default_project_folders,
            name=file_name,
        )
        folder_id = folder.id if folder else None

    dest_dir = UPLOADS_DIR / str(project_id) / str(folder_id or "0")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{uuid.uuid4().hex[:12]}_{safe_name}"
    shutil.copy2(source_path, dest_path)

    project_file = ProjectFile(
        project_id=project_id,
        name=safe_name,
        file_type="pdf",
        path=str(dest_path.relative_to(UPLOADS_DIR)),
        size_bytes=dest_path.stat().st_size,
        summary=summary,
        origin="ai_generated",
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file


def _pdf_merge(file_paths: list[Path], output_path: Path) -> dict:
    """Merge multiple PDFs into one."""
    try:
        from pypdf import PdfWriter
    except ImportError:
        return {"success": False, "error": "pypdf not installed"}

    writer = PdfWriter()
    try:
        for p in file_paths:
            if not p.is_file():
                return {"success": False, "error": f"File not found: {p.name}"}
            writer.append(str(p))
        with open(output_path, "wb") as f:
            writer.write(f)
        return {"success": True, "page_count": len(file_paths)}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        writer.close()


def _pdf_split(file_path: Path, page_ranges: list[dict], output_dir: Path) -> dict:
    """Split PDF into multiple files by page ranges."""
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        return {"success": False, "error": "pypdf not installed"}

    try:
        reader = PdfReader(str(file_path))
    except Exception as e:
        return {"success": False, "error": f"Failed to open PDF: {e}"}

    total_pages = len(reader.pages)
    outputs = []

    for i, page_range in enumerate(page_ranges):
        start = page_range.get("start", 1)
        end = page_range.get("end", total_pages)
        label = page_range.get("label", f"part_{i + 1}")

        start = max(1, min(start, total_pages))
        end = max(start, min(end, total_pages))

        writer = PdfWriter()
        for page_num in range(start - 1, end):
            writer.add_page(reader.pages[page_num])

        out_path = output_dir / f"{label}.pdf"
        with open(out_path, "wb") as f:
            writer.write(f)

        outputs.append({"label": label, "pages": f"{start}-{end}", "path": str(out_path.name)})

    return {"success": True, "outputs": outputs, "total_pages": total_pages}


def _pdf_extract(file_path: Path, page_numbers: list[int], output_path: Path) -> dict:
    """Extract specific pages from a PDF."""
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        return {"success": False, "error": "pypdf not installed"}

    try:
        reader = PdfReader(str(file_path))
    except Exception as e:
        return {"success": False, "error": f"Failed to open PDF: {e}"}

    total_pages = len(reader.pages)
    writer = PdfWriter()
    extracted = []

    for page_num in page_numbers:
        if 1 <= page_num <= total_pages:
            writer.add_page(reader.pages[page_num - 1])
            extracted.append(page_num)

    if not extracted:
        return {"success": False, "error": "No valid pages to extract"}

    with open(output_path, "wb") as f:
        writer.write(f)

    return {"success": True, "extracted_pages": extracted, "total_pages": total_pages}


def _pdf_read_text(file_path: Path, page_numbers: list[int] | None = None) -> dict:
    """Extract text content from PDF pages."""
    try:
        import pdfplumber
    except ImportError:
        return {"success": False, "error": "pdfplumber not installed"}

    try:
        with pdfplumber.open(str(file_path)) as pdf:
            total_pages = len(pdf.pages)
            pages_to_read = page_numbers or list(range(1, total_pages + 1))
            pages_text = []

            for page_num in pages_to_read:
                if 1 <= page_num <= total_pages:
                    page = pdf.pages[page_num - 1]
                    text = page.extract_text() or ""
                    tables = page.extract_tables()
                    page_content = {"page": page_num, "text": text}
                    if tables:
                        page_content["tables"] = tables
                    pages_text.append(page_content)

            return {"success": True, "total_pages": total_pages, "pages": pages_text}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _pdf_add_watermark(file_path: Path, watermark_text: str, output_path: Path) -> dict:
    """Add text watermark to each page of a PDF."""
    try:
        from pypdf import PdfReader, PdfWriter
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.lib.pagesizes import letter
        import io
    except ImportError:
        return {"success": False, "error": "pypdf and reportlab required"}

    try:
        reader = PdfReader(str(file_path))
    except Exception as e:
        return {"success": False, "error": f"Failed to open PDF: {e}"}

    try:
        packet = io.BytesIO()
        c = rl_canvas.Canvas(packet, pagesize=letter)
        c.setFont("Helvetica", 40)
        c.setFillAlpha(0.3)
        c.saveState()
        c.translate(300, 400)
        c.rotate(45)
        c.drawCentredString(0, 0, watermark_text)
        c.restoreState()
        c.save()
        packet.seek(0)

        watermark_reader = PdfReader(packet)
        watermark_page = watermark_reader.pages[0]

        writer = PdfWriter(clone_from=reader)
        for page in writer.pages:
            page.merge_page(watermark_page)

        with open(output_path, "wb") as f:
            writer.write(f)

        return {"success": True, "pages_watermarked": len(reader.pages)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@registry.register(
    name=MANAGE_PDF_TOOL_NAME,
    description=tool_description(
        MANAGE_PDF_TOOL_NAME,
        "Manage PDF files in the project space. "
        "Actions: merge (combine multiple PDFs), split (split by page ranges), "
        "extract (extract specific pages), read (extract text content), "
        "watermark (add text watermark). "
        "Use read_project_file with action='read' for simple PDF text extraction. "
        "Use this tool for advanced PDF operations like merge, split, extract pages."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["merge", "split", "extract", "read", "watermark"],
                "description": "PDF operation to perform.",
            },
            "file_id": {"type": "integer", "description": "Project file ID of the source PDF."},
            "file_name": {"type": "string", "description": "Project file name (alternative to file_id)."},
            "file_ids": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "For merge: list of file IDs to merge.",
            },
            "file_names": {
                "type": "array",
                "items": {"type": "string"},
                "description": "For merge: list of file names to merge (alternative to file_ids).",
            },
            "page_ranges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start": {"type": "integer"},
                        "end": {"type": "integer"},
                        "label": {"type": "string"},
                    },
                },
                "description": "For split: list of page ranges [{start, end, label}].",
            },
            "page_numbers": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "For extract/read: list of 1-based page numbers.",
            },
            "watermark_text": {"type": "string", "description": "For watermark: text to overlay."},
            "output_name": {"type": "string", "description": "Output file name."},
        },
        "required": ["action"],
    },
)
async def manage_pdf(
    *,
    project_id: int,
    action: str,
    file_id: int | None = None,
    file_name: str | None = None,
    file_ids: list[int] | None = None,
    file_names: list[str] | None = None,
    page_ranges: list[dict] | None = None,
    page_numbers: list[int] | None = None,
    watermark_text: str | None = None,
    output_name: str | None = None,
) -> dict[str, Any]:
    if not project_id:
        raise HTTPException(400, "Project id is required")

    with Session(engine) as session:
        if action == "merge":
            source_files = []
            if file_ids:
                for fid in file_ids:
                    pf = session.get(ProjectFile, fid)
                    if pf and pf.project_id == project_id and pf.deleted_at is None:
                        source_files.append(pf)
            elif file_names:
                all_files = session.exec(active_project_files_stmt(project_id)).all()
                name_map = {f.name.strip().lower(): f for f in all_files}
                for fn in file_names:
                    pf = name_map.get(fn.strip().lower())
                    if pf:
                        source_files.append(pf)

            if len(source_files) < 2:
                raise HTTPException(400, "At least 2 PDF files required for merge")

            source_paths = [_file_path(f) for f in source_files]
            out_path = _generated_dir() / f"{uuid.uuid4().hex[:12]}_merged.pdf"

            result = _pdf_merge(source_paths, out_path)
            if not result.get("success"):
                raise HTTPException(500, result.get("error") or "Merge failed")

            out_name = output_name or "merged.pdf"
            if not out_name.endswith(".pdf"):
                out_name = f"{out_name}.pdf"

            project_file = _register_file(
                session, project_id, out_path, out_name,
                f"Merged {len(source_files)} PDFs"
            )
            _bust_cache(project_id)

            return {
                "ok": True,
                "id": project_file.id,
                "name": project_file.name,
                "message": f"Merged {len(source_files)} PDFs into {project_file.name}",
            }

        else:
            project_file = _find_project_file(session, project_id, file_id, file_name)
            if project_file.file_type != "pdf":
                raise HTTPException(400, f"File is {project_file.file_type}, not PDF")
            source_path = _file_path(project_file)

    if action == "split":
        if not page_ranges:
            raise HTTPException(400, "page_ranges required for split")
        out_dir = _generated_dir() / uuid.uuid4().hex[:8]
        out_dir.mkdir(parents=True, exist_ok=True)

        result = _pdf_split(source_path, page_ranges, out_dir)
        if not result.get("success"):
            raise HTTPException(500, result.get("error") or "Split failed")

        outputs = []
        with Session(engine) as session:
            for out in result.get("outputs", []):
                out_path = out_dir / out["path"]
                out_name = output_name and f"{output_name}_{out['label']}.pdf" or f"{out['label']}.pdf"
                pf = _register_file(session, project_id, out_path, out_name, f"Split: {out['pages']}")
                outputs.append({"id": pf.id, "name": pf.name, "pages": out["pages"]})
            _bust_cache(project_id)

        return {
            "ok": True,
            "outputs": outputs,
            "total_pages": result.get("total_pages"),
            "message": f"Split into {len(outputs)} files",
        }

    elif action == "extract":
        if not page_numbers:
            raise HTTPException(400, "page_numbers required for extract")
        out_name = output_name or f"{project_file.name.replace('.pdf', '')}_extracted.pdf"
        if not out_name.endswith(".pdf"):
            out_name = f"{out_name}.pdf"
        out_path = _generated_dir() / f"{uuid.uuid4().hex[:12]}_{out_name}"

        result = _pdf_extract(source_path, page_numbers, out_path)
        if not result.get("success"):
            raise HTTPException(500, result.get("error") or "Extract failed")

        with Session(engine) as session:
            pf = _register_file(session, project_id, out_path, out_name, f"Extracted pages {result.get('extracted_pages')}")
            _bust_cache(project_id)

        return {
            "ok": True,
            "id": pf.id,
            "name": pf.name,
            "extracted_pages": result.get("extracted_pages"),
            "message": f"Extracted {len(result.get('extracted_pages', []))} pages",
        }

    elif action == "read":
        result = _pdf_read_text(source_path, page_numbers)
        if not result.get("success"):
            raise HTTPException(500, result.get("error") or "Read failed")
        return {
            "ok": True,
            "total_pages": result.get("total_pages"),
            "pages": result.get("pages"),
        }

    elif action == "watermark":
        if not watermark_text:
            raise HTTPException(400, "watermark_text required for watermark")
        out_name = output_name or f"{project_file.name.replace('.pdf', '')}_watermarked.pdf"
        if not out_name.endswith(".pdf"):
            out_name = f"{out_name}.pdf"
        out_path = _generated_dir() / f"{uuid.uuid4().hex[:12]}_{out_name}"

        result = _pdf_add_watermark(source_path, watermark_text, out_path)
        if not result.get("success"):
            raise HTTPException(500, result.get("error") or "Watermark failed")

        with Session(engine) as session:
            pf = _register_file(session, project_id, out_path, out_name, f"Watermarked: {watermark_text}")
            _bust_cache(project_id)

        return {
            "ok": True,
            "id": pf.id,
            "name": pf.name,
            "pages_watermarked": result.get("pages_watermarked"),
            "message": f"Added watermark to {result.get('pages_watermarked')} pages",
        }

    else:
        raise HTTPException(400, f"Unknown action: {action}")
