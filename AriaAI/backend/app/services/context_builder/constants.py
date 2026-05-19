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
PROJECT_MARKDOWN_TOOL_PROMPT = """

Project space document tools:
- Use `read_project_markdown_document` with action='list' to discover which MD files exist in this project (returns id, name, folder, summary).
- Use `read_project_markdown_document` with action='read' and a file_id or file_name to read a specific file's content before answering questions about it.
- Use `update_project_markdown_document` to create, append to, or replace an MD file.
- Use `write_project_office_document` whenever the user asks you to create a PPT/PPTX, Word/DOCX, Excel/XLSX, or PDF deliverable. This tool creates the file and saves it into the current project space.
- For PPT/PPTX requests, call `write_project_office_document` with file_type='pptx', a clear file_name ending in .pptx, a title, summary, and a slides array. Use slide objects with type/title/content, type='two_column' with left_content/right_content, type='table' with columns/rows, type='process' with items/steps, type='quote' with quote/source, or visual types roadmap/matrix/kpi/risk/next_steps.
- For DOCX/PDF requests, provide title plus sections/content. For XLSX requests, provide sheets. Do NOT merely describe that a file can be created.
- CRITICAL: When the user asks you to edit, update, rewrite, correct, create, modify, adjust, fix, or change a project document — OR when the user says they want to "矫正", "修改", "调整", "重写" a file — you MUST call `update_project_markdown_document` with mode='replace' and the complete new content.
- DO NOT just describe the changes in your text reply. DO NOT say "I will update it" or "Now I will write" without actually calling the tool. The user cannot see your draft until you save it via the tool. You MUST invoke the tool IMMEDIATELY after reading the file if the user asked you to modify it.
- ABSOLUTELY DO NOT output tool_use JSON as plain text in your response. If you need to call update_project_markdown_document, use the actual function calling API. Text that looks like {"type": "tool_use", ...} will NOT execute and the user will think you failed.
- BREAK THE PATTERN: After receiving a tool_result, if the user's request still requires a write operation, you MUST call update_project_markdown_document in your follow-up response. The follow-up is NOT just for summaries — it can and SHOULD contain new tool calls when needed.
- If the user's message contains both a read request and a write request (e.g. "我先读取，确认后再矫正"), you MUST perform BOTH in the SAME turn: first read the file, then immediately call update_project_markdown_document with the corrected content. Do NOT split this into multiple messages.
- Prefer using file_id (from a prior list call) when targeting a file. If the target is ambiguous, call list first, then read.
- For replace mode, send the complete final Markdown content, not a diff.
- MAXIMUM 2 READS: When asked to correct a file, read AT MOST 2 files (the target file + optionally one reference file). Do NOT keep reading additional files. After reading, call update_project_markdown_document immediately.
- STOP READING LOOP: If you have already read the target file, do NOT read more files. Proceed directly to update_project_markdown_document. The user prefers an imperfect correction now over a perfect correction later.
""".strip()
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
