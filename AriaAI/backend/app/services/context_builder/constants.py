"""Constants for context builder."""
import os

from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME

MAX_FILE_CONTENT_CHARS = int(os.getenv("ARIA_MAX_FILE_CONTEXT_CHARS", "120000"))
MAX_SINGLE_FILE_CHARS = int(os.getenv("ARIA_MAX_SINGLE_FILE_CHARS", "24000"))
MAX_PROJECT_NOTES_CHARS = 6000
MAX_PROJECT_TODOS = 12
MAX_PROJECT_ARTIFACTS = 8
PROJECT_MARKDOWN_TOOL_NAMES = ["update_project_markdown_document", "read_project_markdown_document"]
PROJECT_OFFICE_TOOL_NAMES = [WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME]
PROJECT_MARKDOWN_TOOL_PROMPT = ""
PROJECT_FILE_QUERY_MARKERS = (
    "file",
    "files",
    "document",
    "documents",
    "attachment",
    "attachments",
    "source",
    "\u6587\u4ef6",
    "\u6587\u6863",
    "\u9644\u4ef6",
    "\u6750\u6599",
    "\u539f\u6587",
    "\u4e0a\u4f20",
)
