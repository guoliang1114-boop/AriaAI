from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from sqlmodel import Session

from app.database import get_session
from app.models.db import Message
from app.routers.chat_schemas import ExportConversationRequest
from app.services.chat_store import get_conversation_or_404, get_full_message_history

router = APIRouter()


@router.post("/conversations/{conv_id}/export")
async def export_conversation(
    conv_id: int,
    req: ExportConversationRequest,
    session: Session = Depends(get_session),
):
    conv = get_conversation_or_404(session, conv_id)
    messages = get_full_message_history(session, conv_id)
    if not messages:
        raise HTTPException(400, "Conversation has no messages")

    format_type = req.format.lower()
    if format_type == "markdown":
        return _export_markdown(conv, messages)
    if format_type == "pdf":
        return await _export_pdf(conv, messages)
    raise HTTPException(400, f"Unsupported format: {format_type}. Use 'markdown' or 'pdf'")


def _safe_export_filename(title: str, created_at: datetime, extension: str) -> str:
    safe_title = "".join(c for c in (title or "conversation") if c.isalnum() or c in " _-").strip()
    return f"{safe_title}_{created_at.strftime('%Y%m%d')}.{extension}"


def _export_markdown(conv, messages: List[Message]):
    lines = [
        f"# {conv.title or 'Untitled Conversation'}",
        "",
        f"**Created:** {conv.created_at.strftime('%Y-%m-%d %H:%M')}",
        f"**Exported:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
        "",
        "---",
        "",
    ]

    for msg in messages:
        role_label = "**User**" if msg.role == "user" else "**Assistant**"
        time_str = msg.created_at.strftime('%H:%M')
        lines.append(f"{role_label} *({time_str})*")
        lines.append("")
        lines.append(msg.content)
        lines.append("")
        lines.append("---")
        lines.append("")

    return PlainTextResponse(
        content="\n".join(lines),
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{_safe_export_filename(conv.title, conv.created_at, "md")}"'
        },
    )


async def _export_pdf(conv, messages: List[Message]):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=72,
            leftMargin=72,
            topMargin=72,
            bottomMargin=18,
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle("CustomTitle", parent=styles["Heading1"], fontSize=18, spaceAfter=12)
        user_style = ParagraphStyle("UserLabel", parent=styles["Heading3"], fontSize=11, textColor="#2563eb", spaceAfter=6)
        assistant_style = ParagraphStyle("AssistantLabel", parent=styles["Heading3"], fontSize=11, textColor="#7c3aed", spaceAfter=6)
        content_style = ParagraphStyle("Content", parent=styles["BodyText"], fontSize=10, leading=14, spaceAfter=12)
        separator_style = ParagraphStyle(
            "Separator",
            parent=styles["Normal"],
            fontSize=8,
            textColor="#9ca3af",
            alignment=1,
            spaceBefore=12,
            spaceAfter=12,
        )

        story = [
            Paragraph(conv.title or "Untitled Conversation", title_style),
            Spacer(1, 0.1 * inch),
            Paragraph(
                f"<i>Created: {conv.created_at.strftime('%Y-%m-%d %H:%M')} | Exported: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}</i>",
                styles["Normal"],
            ),
            Spacer(1, 0.2 * inch),
            Paragraph("—" * 40, separator_style),
            Spacer(1, 0.1 * inch),
        ]

        for msg in messages:
            time_str = msg.created_at.strftime("%H:%M")
            story.append(Paragraph(f"{'User' if msg.role == 'user' else 'Assistant'} ({time_str})", user_style if msg.role == "user" else assistant_style))

            content = msg.content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            content = content.replace("**", "<b>").replace("__", "<i>")
            content = content.replace("\n", "<br/>")

            story.append(Paragraph(content, content_style))
            story.append(Spacer(1, 0.1 * inch))

        doc.build(story)
        pdf_content = buffer.getvalue()
        buffer.close()

        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{_safe_export_filename(conv.title, conv.created_at, "pdf")}"'
            },
        )
    except ImportError:
        raise HTTPException(500, "PDF generation requires reportlab. Install with: pip install reportlab")
    except Exception as exc:
        raise HTTPException(500, f"PDF generation failed: {str(exc)}")
