"""PDF Translation tool — bridges AriaAI to CTools translation service.

Provides a Claude Function Calling tool that wraps the full CTools document
translation pipeline: upload → parse → translate (LLM) → layout restore → download.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from datetime import datetime

import httpx
from app.config import UPLOADS_DIR
from app.tools import registry

# ── Configuration ────────────────────────────────────────────────────────────
# Read from environment at import time so tests can monkey-patch easily.
import os

_DEFAULT_CTOOLS_URL = os.getenv("CTOOLS_BASE_URL", "http://localhost:3001")
_DEFAULT_CTOOLS_TOKEN = os.getenv("CTOOLS_API_TOKEN", "")

# Where translated files are stored locally so Aria artifacts can serve them
TRANSLATION_DIR = UPLOADS_DIR / "translations"
TRANSLATION_DIR.mkdir(parents=True, exist_ok=True)

# ── Helper utilities ─────────────────────────────────────────────────────────


def _resolve_path(file_path: str) -> Path:
    """Resolve a path that may be absolute or relative to UPLOADS_DIR."""
    p = Path(file_path)
    if p.is_absolute():
        return p
    # Relative paths are resolved under UPLOADS_DIR (Aria's file storage)
    return UPLOADS_DIR / p


def _headers(token: str) -> dict[str, str]:
    """Build Authorization header for CTools."""
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }


# ── Tool registration ────────────────────────────────────────────────────────


@registry.register(
    name="translate_document",
    description=(
        "Translate a PDF/DOCX/PPTX document using the CTools translation engine. "
        "Uploads the file, creates a translation job, polls for completion, and "
        "returns a downloadable URL to the translated document. "
        "Supports layout-preserving translation powered by DeepSeek AI."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": (
                    "Absolute or relative path to the document file on the AriaAI server. "
                    "Relative paths are resolved under the uploads directory."
                ),
            },
            "source_language": {
                "type": "string",
                "description": "Source language code, e.g. 'en', 'zh', 'ja', 'de', 'fr'. Default: 'auto'.",
            },
            "target_language": {
                "type": "string",
                "description": "Target language code, e.g. 'zh', 'en', 'ja'. Default: 'zh'.",
            },
            "options": {
                "type": "object",
                "description": "Optional translation flags.",
                "properties": {
                    "preserve_formatting": {
                        "type": "boolean",
                        "description": "Keep original PDF layout and typography. Default: true.",
                    },
                    "use_term_base": {
                        "type": "boolean",
                        "description": "Use glossary / term base if available. Default: true.",
                    },
                    "use_memory": {
                        "type": "boolean",
                        "description": "Use translation memory for consistency. Default: true.",
                    },
                },
            },
            "ctools_api_token": {
                "type": "string",
                "description": (
                    "Optional CTools JWT API token. "
                    "If omitted, falls back to the CTOOLS_API_TOKEN environment variable."
                ),
            },
            "ctools_base_url": {
                "type": "string",
                "description": (
                    "Optional CTools base URL. "
                    "Default: http://localhost:3001 (or CTOOLS_BASE_URL env var)."
                ),
            },
        },
        "required": ["file_path", "target_language"],
    },
)
async def translate_document(
    file_path: str,
    target_language: str,
    source_language: str = "auto",
    options: dict[str, Any] | None = None,
    ctools_api_token: str = "",
    ctools_base_url: str = "",
) -> dict[str, Any]:
    """Execute full PDF translation via CTools API.

    Steps:
        1. Validate local file exists.
        2. Upload file to CTools → obtain document_id.
        3. Create translation task.
        4. Poll until completed / failed / timed-out.
        5. Download translated PDF to local Aria storage.
        6. Return metadata + local download path.
    """
    base_url = (ctools_base_url or _DEFAULT_CTOOLS_URL).rstrip("/")
    token = ctools_api_token or _DEFAULT_CTOOLS_TOKEN
    opts = options or {}

    if not token:
        return {
            "success": False,
            "error": (
                "No CTools API token provided. "
                "Set CTOOLS_API_TOKEN environment variable or pass ctools_api_token."
            ),
        }

    local_path = _resolve_path(file_path)
    if not local_path.is_file():
        return {
            "success": False,
            "error": f"File not found: {local_path}",
        }

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        # ── Step 1: Upload document ───────────────────────────────────────────
        try:
            with open(local_path, "rb") as f:
                upload_resp = await client.post(
                    f"{base_url}/api/documents/upload",
                    headers={"Authorization": f"Bearer {token}"},
                    files={"file": (local_path.name, f, "application/octet-stream")},
                )
            upload_resp.raise_for_status()
            upload_data = upload_resp.json()
            if not upload_data.get("success"):
                return {
                    "success": False,
                    "error": f"CTools upload failed: {upload_data.get('message', 'Unknown')}",
                }
            document_id = upload_data["data"]["id"]
        except httpx.HTTPStatusError as exc:
            return {
                "success": False,
                "error": f"CTools upload HTTP error: {exc.response.status_code} — {exc.response.text}",
            }
        except Exception as exc:
            return {"success": False, "error": f"CTools upload failed: {exc}"}

        # ── Step 2: Create translation task ───────────────────────────────────
        payload = {
            "documentId": document_id,
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "options": {
                "preserveFormatting": opts.get("preserve_formatting", True),
                "useTerm": opts.get("use_term_base", True),
                "useMemory": opts.get("use_memory", True),
            },
        }
        try:
            create_resp = await client.post(
                f"{base_url}/api/translations",
                headers=_headers(token),
                json=payload,
            )
            create_resp.raise_for_status()
            create_data = create_resp.json()
            if not create_data.get("success"):
                return {
                    "success": False,
                    "error": f"CTools translation creation failed: {create_data.get('message', 'Unknown')}",
                }
            translation_id = create_data["data"]["id"]
            document_name = create_data["data"].get("documentName", local_path.name)
        except httpx.HTTPStatusError as exc:
            return {
                "success": False,
                "error": f"CTools create HTTP error: {exc.response.status_code} — {exc.response.text}",
            }
        except Exception as exc:
            return {"success": False, "error": f"CTools create failed: {exc}"}

        # ── Step 3: Poll until completion ─────────────────────────────────────
        max_wait_seconds = 1800  # 30 minutes
        poll_interval = 5.0      # start at 5s
        start_time = asyncio.get_event_loop().time()
        last_status = "pending"
        progress = 0

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_wait_seconds:
                return {
                    "success": False,
                    "error": f"Translation timed out after {max_wait_seconds}s. Last status: {last_status}",
                    "translation_id": translation_id,
                    "ctools_url": f"{base_url}/translations/{translation_id}",
                }

            try:
                status_resp = await client.get(
                    f"{base_url}/api/translations/{translation_id}",
                    headers=_headers(token),
                )
                status_resp.raise_for_status()
                status_data = status_resp.json()
                if not status_data.get("success"):
                    await asyncio.sleep(poll_interval)
                    continue

                tx = status_data.get("data", {})
                last_status = tx.get("status", "unknown")
                progress = tx.get("progress", 0)

                if last_status == "completed":
                    break
                if last_status == "failed":
                    return {
                        "success": False,
                        "error": f"CTools reported translation failed for {document_name}.",
                        "translation_id": translation_id,
                    }
            except Exception:
                # Network hiccup during polling — keep trying
                pass

            await asyncio.sleep(poll_interval)
            # Gentle back-off up to 15s
            poll_interval = min(poll_interval + 1.0, 15.0)

        # ── Step 4: Download translated file ──────────────────────────────────
        try:
            download_resp = await client.get(
                f"{base_url}/api/history/{translation_id}/download/translated",
                headers=_headers(token),
            )
            download_resp.raise_for_status()

            # Determine extension from Content-Disposition or fallback to .pdf
            content_disp = download_resp.headers.get("content-disposition", "")
            ext = ".pdf"
            if "filename=" in content_disp:
                fname = content_disp.split("filename=")[-1].strip('"').strip("'")
                if "." in fname:
                    ext = fname[fname.rfind("."):]
            elif "." in document_name:
                ext = document_name[document_name.rfind("."):]

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            out_name = f"translated_{Path(document_name).stem}_{timestamp}{ext}"
            out_path = TRANSLATION_DIR / out_name
            out_path.write_bytes(download_resp.content)

            return {
                "success": True,
                "translation_id": translation_id,
                "document_id": document_id,
                "document_name": document_name,
                "source_language": source_language,
                "target_language": target_language,
                "local_file_path": str(out_path),
                "download_url": f"/artifacts/download-by-path?path=translations/{out_name}",
                "elapsed_seconds": round(asyncio.get_event_loop().time() - start_time, 1),
            }
        except httpx.HTTPStatusError as exc:
            return {
                "success": False,
                "error": f"Download failed: {exc.response.status_code} — {exc.response.text}",
                "translation_id": translation_id,
            }
        except Exception as exc:
            return {
                "success": False,
                "error": f"Download failed: {exc}",
                "translation_id": translation_id,
            }
