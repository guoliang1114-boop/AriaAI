from __future__ import annotations

from datetime import datetime
from typing import List

from app.models.db import Message
from app.services.time_utils import utc_now_naive


def safe_export_filename(title: str, created_at: datetime, extension: str) -> str:
    safe_title = "".join(c for c in (title or "conversation") if c.isalnum() or c in " _-").strip()
    return f"{safe_title}_{created_at.strftime('%Y%m%d')}.{extension}"


def build_markdown_export_content(conv, messages: List[Message]) -> str:
    lines = [
        f"# {conv.title or 'Untitled Conversation'}",
        "",
        f"**Created:** {conv.created_at.strftime('%Y-%m-%d %H:%M')}",
        f"**Exported:** {utc_now_naive().strftime('%Y-%m-%d %H:%M')}",
        "",
        "---",
        "",
    ]

    for msg in messages:
        role_label = "**User**" if msg.role == "user" else "**Assistant**"
        time_str = msg.created_at.strftime("%H:%M")
        lines.append(f"{role_label} *({time_str})*")
        lines.append("")
        lines.append(msg.content)
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)
