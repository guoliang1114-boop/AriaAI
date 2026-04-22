"""File generation tools for Claude Function Calling.

Provides tools to generate PPT, Word, Excel, and PDF files.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from app.config import UPLOADS_DIR
from app.tools import registry

# Ensure output directory exists
GENERATED_DIR = UPLOADS_DIR / "generated"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

# Skills directory for templates
# file is at backend/app/tools/ → need 4 parents to reach project root
SKILLS_DIR = Path(__file__).parent.parent.parent.parent / "skills"


def _generate_filename(extension: str) -> str:
    """Generate a unique filename with timestamp."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"generated_{timestamp}.{extension}"


@registry.register(
    name="generate_ppt",
    description="Generate a PowerPoint (.pptx) presentation with structured slides. Supports title slides, content slides, and two-column layouts.",
    input_schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Presentation title"
            },
            "subtitle": {
                "type": "string",
                "description": "Optional subtitle for title slide"
            },
            "slides": {
                "type": "array",
                "description": "Array of slide objects",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["title", "content", "two_column"],
                            "description": "Slide layout type"
                        },
                        "title": {
                            "type": "string",
                            "description": "Slide title"
                        },
                        "content": {
                            "type": "string",
                            "description": "Main content (bullet points supported with - or *)"
                        },
                        "left_content": {
                            "type": "string",
                            "description": "Left column content (for two_column type)"
                        },
                        "right_content": {
                            "type": "string",
                            "description": "Right column content (for two_column type)"
                        }
                    },
                    "required": ["type", "title"]
                }
            },
            "template_path": {
                "type": "string",
                "description": "Optional path to a .pptx template file. If not provided, uses default blank template."
            }
        },
        "required": ["title", "slides"]
    }
)
def _safe_layout(prs, preferred_idx: int):
    """Return slide_layouts[preferred_idx] if it exists, otherwise the last available layout."""
    layouts = prs.slide_layouts
    if preferred_idx < len(layouts):
        return layouts[preferred_idx]
    return layouts[-1]


def _find_body_placeholder(slide):
    """Find the first non-title body/text placeholder on a slide.

    Templates can use non-standard idx values (e.g. 10, 11 instead of 1).
    Try common indices first, then fall back to any non-title placeholder.
    """
    for idx in (1, 10, 11, 2, 12, 13, 14, 15):
        try:
            return slide.placeholders[idx]
        except KeyError:
            continue
    # Last resort: first placeholder that is not the title (idx != 0)
    for ph in slide.placeholders:
        if ph.placeholder_format.idx != 0:
            return ph
    return None


def _set_content_slide_text(slide, title: str, content: str):
    """Write visible title/body text even when templates use unusual placeholders."""
    from pptx.util import Inches, Pt

    if slide.shapes.title:
        slide.shapes.title.text = title
    else:
        title_box = slide.shapes.add_textbox(Inches(0.6), Inches(0.35), Inches(12.0), Inches(0.6))
        title_box.text_frame.text = title
        title_box.text_frame.paragraphs[0].font.size = Pt(24)
        title_box.text_frame.paragraphs[0].font.bold = True

    body = _find_body_placeholder(slide)
    if body is not None:
        body.text_frame.text = content
        body.text_frame.word_wrap = True
    else:
        body_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.25), Inches(11.6), Inches(5.7))
        body_box.text_frame.word_wrap = True
        body_box.text_frame.text = content


def _set_template_cover_text(slide, title: str, subtitle: str):
    """Best-effort cover replacement for branded templates."""
    replaced_title = False
    replaced_subtitle = False
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        current = (shape.text or "").strip()
        if "客户名称" in current or "方案建议名称" in current or shape.name.lower() in {"cover_title", "title 3"}:
            shape.text_frame.text = f"{title}\n方案建议书"
            replaced_title = True
        elif subtitle and ("KPMG China" in current or shape.name.lower() in {"cover_subtitle", "subtitle 4"}):
            if not replaced_subtitle:
                shape.text_frame.text = subtitle
                replaced_subtitle = True
            elif shape.name.lower() in {"cover_subtitle", "subtitle 4"}:
                shape.text_frame.text = ""

    if not replaced_title:
        from pptx.util import Inches, Pt

        title_box = slide.shapes.add_textbox(Inches(0.8), Inches(2.2), Inches(10.8), Inches(1.2))
        title_box.text_frame.text = f"{title}\n方案建议书"
        for paragraph in title_box.text_frame.paragraphs:
            paragraph.font.size = Pt(28)
            paragraph.font.bold = True
    if subtitle and not replaced_subtitle:
        from pptx.util import Inches, Pt

        subtitle_box = slide.shapes.add_textbox(Inches(0.8), Inches(3.6), Inches(10.8), Inches(0.5))
        subtitle_box.text_frame.text = subtitle
        subtitle_box.text_frame.paragraphs[0].font.size = Pt(14)


def _remove_slide(prs, index: int):
    """Remove a template slide by index."""
    slide_id_list = prs.slides._sldIdLst
    slides = list(slide_id_list)
    if 0 <= index < len(slides):
        slide_id = slides[index]
        rel_id = slide_id.rId
        slide_id_list.remove(slide_id)
        prs.part.drop_rel(rel_id)


def _clear_text_shapes(slide):
    for shape in slide.shapes:
        if shape.has_text_frame:
            shape.text_frame.clear()


def _add_textbox(slide, x, y, w, h, text: str, *, size: int = 14, bold: bool = False, color: str = "1F2937"):
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    box = slide.shapes.add_textbox(x, y, w, h)
    frame = box.text_frame
    frame.clear()
    frame.word_wrap = True
    frame.margin_left = Pt(6)
    frame.margin_right = Pt(6)
    frame.margin_top = Pt(4)
    frame.margin_bottom = Pt(4)
    paragraph = frame.paragraphs[0]
    paragraph.text = text
    paragraph.font.size = Pt(size)
    paragraph.font.bold = bold
    paragraph.font.color.rgb = RGBColor.from_string(color)
    return box


def _add_card(slide, x, y, w, h, *, fill: str = "F8FAFC", line: str = "E2E8F0"):
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Pt

    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(fill)
    shape.line.color.rgb = RGBColor.from_string(line)
    shape.line.width = Pt(1)
    return shape


def _split_bullets(content: str, limit: int = 6) -> list[str]:
    bullets: list[str] = []
    for raw in content.splitlines():
        item = raw.strip()
        item = re.sub(r"^[-*•]\s*", "", item)
        item = re.sub(r"^\d{1,2}[.、)）]\s*", "", item)
        if item:
            bullets.append(item)
    if not bullets and content.strip():
        bullets = [content.strip()]
    return bullets[:limit]


def _add_slide_header(slide, title: str, slide_number: int):
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches, Pt

    accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.33), Inches(0.12))
    accent.fill.solid()
    accent.fill.fore_color.rgb = RGBColor.from_string("2563EB")
    accent.line.fill.background()

    _add_textbox(slide, Inches(0.65), Inches(0.32), Inches(10.8), Inches(0.62), title, size=22, bold=True, color="111827")
    _add_textbox(slide, Inches(11.65), Inches(0.42), Inches(1.1), Inches(0.35), f"{slide_number:02d}", size=11, bold=True, color="94A3B8")


def _add_slide_footer(slide, label: str = "AriaAI generated deck"):
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.65), Inches(7.02), Inches(12), Inches(0.02))
    line.fill.solid()
    line.fill.fore_color.rgb = RGBColor.from_string("E5E7EB")
    line.line.fill.background()
    _add_textbox(slide, Inches(0.65), Inches(7.08), Inches(5.5), Inches(0.25), label, size=8, color="94A3B8")


def _render_content_slide(slide, title: str, content: str, slide_number: int):
    from pptx.util import Inches

    _clear_text_shapes(slide)
    _add_slide_header(slide, title, slide_number)
    bullets = _split_bullets(content, limit=6)
    if bullets:
        hero = bullets[0]
        _add_card(slide, Inches(0.75), Inches(1.2), Inches(11.85), Inches(1.0), fill="EFF6FF", line="BFDBFE")
        _add_textbox(slide, Inches(1.0), Inches(1.38), Inches(11.35), Inches(0.55), hero, size=18, bold=True, color="1E3A8A")

    card_y = Inches(2.45)
    card_h = Inches(0.72)
    for idx, bullet in enumerate(bullets[1:6], start=1):
        y = card_y + Inches(0.82 * (idx - 1))
        _add_card(slide, Inches(0.85), y, Inches(11.6), card_h)
        _add_textbox(slide, Inches(1.05), y + Inches(0.12), Inches(0.45), Inches(0.3), f"{idx}", size=11, bold=True, color="2563EB")
        _add_textbox(slide, Inches(1.55), y + Inches(0.08), Inches(10.55), Inches(0.45), bullet, size=13, color="334155")
    _add_slide_footer(slide)


def _render_two_column_slide(slide, title: str, left_content: str, right_content: str, slide_number: int):
    from pptx.util import Inches

    _clear_text_shapes(slide)
    _add_slide_header(slide, title, slide_number)
    columns = [
        ("Current / Foundation", left_content, "F8FAFC", "2563EB", Inches(0.85)),
        ("Target / Scale", right_content, "F0FDF4", "16A34A", Inches(6.85)),
    ]
    for heading, content, fill, color, x in columns:
        _add_card(slide, x, Inches(1.35), Inches(5.55), Inches(5.2), fill=fill)
        _add_textbox(slide, x + Inches(0.28), Inches(1.58), Inches(5.0), Inches(0.38), heading, size=15, bold=True, color=color)
        bullets = _split_bullets(content, limit=6)
        for idx, bullet in enumerate(bullets):
            y = Inches(2.22 + idx * 0.62)
            _add_textbox(slide, x + Inches(0.35), y, Inches(0.25), Inches(0.24), "•", size=14, bold=True, color=color)
            _add_textbox(slide, x + Inches(0.65), y - Inches(0.02), Inches(4.55), Inches(0.38), bullet, size=12, color="334155")
    _add_slide_footer(slide)


def _render_back_cover(slide, title: str):
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    _clear_text_shapes(slide)
    background = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.33), Inches(7.5))
    background.fill.solid()
    background.fill.fore_color.rgb = RGBColor.from_string("0F172A")
    background.line.fill.background()
    _add_textbox(slide, Inches(0.9), Inches(2.35), Inches(11.5), Inches(0.7), "Thank you", size=34, bold=True, color="FFFFFF")
    _add_textbox(slide, Inches(0.9), Inches(3.15), Inches(11.5), Inches(0.45), title, size=16, color="CBD5E1")
    _add_textbox(slide, Inches(0.9), Inches(6.75), Inches(11.5), Inches(0.3), "Generated by AriaAI", size=10, color="94A3B8")


async def generate_ppt(
    title: str,
    slides: list[dict],
    subtitle: str = "",
    template_path: str = ""
) -> dict[str, Any]:
    """Generate a PowerPoint presentation."""
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
    except ImportError:
        return {
            "success": False,
            "error": "python-pptx not installed. Run: pip install python-pptx"
        }

    using_template = bool(template_path and Path(template_path).exists())

    if using_template:
        prs = Presentation(template_path)

        # ── Cover slide (template slide 0) ──────────────────────────────────
        cover_slide = prs.slides[0]
        _set_template_cover_text(cover_slide, title, subtitle)
        has_template_content_prototype = len(prs.slides) > 2

        # Layout helpers for content slides
        content_layout = _safe_layout(prs, 1)   # 'One Column Text'
        two_col_layout = _safe_layout(prs, 1)   # Reuse content layout and draw two columns manually.

    else:
        prs = Presentation()
        has_template_content_prototype = False

        # Blank template: add a simple cover slide
        cover_layout = _safe_layout(prs, 0)
        slide = prs.slides.add_slide(cover_layout)
        if slide.shapes.title:
            slide.shapes.title.text = title
        if subtitle:
            body = _find_body_placeholder(slide)
            if body is not None:
                body.text_frame.text = subtitle

        content_layout = _safe_layout(prs, 1)
        two_col_layout = _safe_layout(prs, 1)

    # ── Content slides ───────────────────────────────────────────────────────
    for slide_index, slide_data in enumerate(slides):
        slide_type  = slide_data.get("type", "content")
        slide_title = slide_data.get("title", "")

        layout = two_col_layout if slide_type == "two_column" else content_layout
        if using_template and has_template_content_prototype and slide_index == 0:
            slide = prs.slides[1]
        else:
            slide = prs.slides.add_slide(layout)

        if slide_type == "content" and "content" in slide_data:
            _render_content_slide(slide, slide_title, slide_data["content"], slide_index + 1)

        elif slide_type == "two_column":
            _render_two_column_slide(
                slide,
                slide_title,
                slide_data.get("left_content", ""),
                slide_data.get("right_content", ""),
                slide_index + 1,
            )

    # ── Move back cover to the end ────────────────────────────────────────────
    # Template order after adding slides:
    # - With prototype: [cover, content1(prototype), back_cover, content2, ...]
    # - Without:        [cover, back_cover, content1, ...]
    # Desired order:    [cover, content1, content2, ..., back_cover]
    if using_template and len(prs.slides) >= 2:
        sldIdLst = prs.slides._sldIdLst
        back_cover_index = 2 if has_template_content_prototype and len(prs.slides) > 2 else 1
        back_cover_ref = list(sldIdLst)[back_cover_index]
        sldIdLst.remove(back_cover_ref)
        sldIdLst.append(back_cover_ref)
        _render_back_cover(prs.slides[-1], title)

    # ── Save ─────────────────────────────────────────────────────────────────
    filename = _generate_filename("pptx")
    filepath = GENERATED_DIR / filename
    prs.save(filepath)

    return {
        "success": True,
        "file_type": "pptx",
        "file_name": filename,
        "file_path": str(filepath.relative_to(UPLOADS_DIR)),
        "full_path": str(filepath),
        "slide_count": len(slides) + 2,  # cover + content + back cover
    }


@registry.register(
    name="generate_ppt_from_skill",
    description="Generate PowerPoint using a Skill's template. Looks for KPMG-Template.pptx or template.pptx in the skill's assets folder.",
    input_schema={
        "type": "object",
        "properties": {
            "skill_name": {
                "type": "string",
                "description": "Skill folder name (e.g., 'ai-strategy-report')"
            },
            "title": {
                "type": "string",
                "description": "Presentation title"
            },
            "subtitle": {
                "type": "string",
                "description": "Optional subtitle"
            },
            "slides": {
                "type": "array",
                "description": "Array of slide objects",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["title", "content", "two_column"]},
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "left_content": {"type": "string"},
                        "right_content": {"type": "string"}
                    },
                    "required": ["type", "title"]
                }
            }
        },
        "required": ["skill_name", "title", "slides"]
    }
)
async def generate_ppt_from_skill(
    skill_name: str,
    title: str,
    slides: list[dict],
    subtitle: str = ""
) -> dict[str, Any]:
    """Generate PPT using a skill's template."""
    # Search for template in assets/ then references/ (both locations are valid)
    template_path = None
    for folder in ("assets", "references"):
        for filename in ("KPMG-Template.pptx", "template.pptx", "Template.pptx"):
            candidate = SKILLS_DIR / skill_name / folder / filename
            if candidate.exists():
                template_path = candidate
                break
        if template_path:
            break

    if not template_path:
        # Fallback to default generation
        return await generate_ppt(title, slides, subtitle)

    return await generate_ppt(title, slides, subtitle, str(template_path))


@registry.register(
    name="generate_docx",
    description="Generate a Word (.docx) document with formatted content",
    input_schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Document title"
            },
            "sections": {
                "type": "array",
                "description": "Array of document sections",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {
                            "type": "string",
                            "description": "Section heading"
                        },
                        "content": {
                            "type": "string",
                            "description": "Section content"
                        },
                        "level": {
                            "type": "integer",
                            "enum": [1, 2, 3],
                            "description": "Heading level"
                        }
                    },
                    "required": ["heading", "content"]
                }
            }
        },
        "required": ["title", "sections"]
    }
)
async def generate_docx(
    title: str,
    sections: list[dict]
) -> dict[str, Any]:
    """Generate a Word document."""
    try:
        from docx import Document
        from docx.shared import Inches, Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except ImportError:
        return {
            "success": False,
            "error": "python-docx not installed. Run: pip install python-docx"
        }
    
    doc = Document()
    
    # Title
    title_para = doc.add_paragraph()
    title_run = title_para.add_run(title)
    title_run.bold = True
    title_run.font.size = Pt(18)
    title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    
    doc.add_paragraph()  # Spacing
    
    # Sections
    for section in sections:
        heading = section.get("heading", "")
        content = section.get("content", "")
        level = section.get("level", 1)
        
        # Add heading
        heading_para = doc.add_heading(heading, level=level)
        
        # Add content
        for line in content.split("\n"):
            line = line.strip()
            if line:
                # Check for bold (**text**)
                if line.startswith("**") and line.endswith("**"):
                    p = doc.add_paragraph()
                    run = p.add_run(line[2:-2])
                    run.bold = True
                elif line.startswith("- ") or line.startswith("* "):
                    doc.add_paragraph(line[2:], style='List Bullet')
                else:
                    doc.add_paragraph(line)
    
    # Save file
    filename = _generate_filename("docx")
    filepath = GENERATED_DIR / filename
    doc.save(filepath)
    
    return {
        "success": True,
        "file_type": "docx",
        "file_name": filename,
        "file_path": str(filepath.relative_to(UPLOADS_DIR)),
        "full_path": str(filepath),
        "section_count": len(sections),
    }


@registry.register(
    name="generate_xlsx",
    description="Generate an Excel (.xlsx) spreadsheet with data tables",
    input_schema={
        "type": "object",
        "properties": {
            "sheets": {
                "type": "array",
                "description": "Array of sheet objects",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Sheet name"
                        },
                        "headers": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Column headers"
                        },
                        "data": {
                            "type": "array",
                            "description": "Array of row arrays",
                            "items": {
                                "type": "array",
                                "items": {"type": ["string", "number", "boolean"]}
                            }
                        }
                    },
                    "required": ["name", "headers", "data"]
                }
            }
        },
        "required": ["sheets"]
    }
)
async def generate_xlsx(
    sheets: list[dict]
) -> dict[str, Any]:
    """Generate an Excel spreadsheet."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, PatternFill
    except ImportError:
        return {
            "success": False,
            "error": "openpyxl not installed. Run: pip install openpyxl"
        }
    
    wb = Workbook()
    
    for idx, sheet_data in enumerate(sheets):
        sheet_name = sheet_data.get("name", f"Sheet{idx+1}")
        headers = sheet_data.get("headers", [])
        data = sheet_data.get("data", [])
        
        if idx == 0:
            ws = wb.active
            ws.title = sheet_name
        else:
            ws = wb.create_sheet(title=sheet_name)
        
        # Add headers
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = Font(bold=True)
            cell.fill = PatternFill(start_color="B4C7DC", end_color="B4C7DC", fill_type="solid")
        
        # Add data
        for row_idx, row_data in enumerate(data, 2):
            for col_idx, value in enumerate(row_data, 1):
                ws.cell(row=row_idx, column=col_idx, value=value)
    
    # Save file
    filename = _generate_filename("xlsx")
    filepath = GENERATED_DIR / filename
    wb.save(filepath)
    
    return {
        "success": True,
        "file_type": "xlsx",
        "file_name": filename,
        "file_path": str(filepath.relative_to(UPLOADS_DIR)),
        "full_path": str(filepath),
        "sheet_count": len(sheets),
    }


@registry.register(
    name="generate_pdf",
    description="Generate a PDF document from markdown or HTML content",
    input_schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Document title"
            },
            "content": {
                "type": "string",
                "description": "Document content (Markdown format supported)"
            },
            "orientation": {
                "type": "string",
                "enum": ["portrait", "landscape"],
                "description": "Page orientation"
            }
        },
        "required": ["title", "content"]
    }
)
async def generate_pdf(
    title: str,
    content: str,
    orientation: str = "portrait"
) -> dict[str, Any]:
    """Generate a PDF document."""
    try:
        # Try to use reportlab if available
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
    except ImportError:
        # Fallback: generate markdown file with note
        filename = _generate_filename("md")
        filepath = GENERATED_DIR / filename
        
        md_content = f"# {title}\n\n{content}\n\n---\n*Note: PDF generation requires reportlab. Install with: pip install reportlab*"
        filepath.write_text(md_content, encoding="utf-8")
        
        return {
            "success": True,
            "file_type": "md",
            "file_name": filename,
            "file_path": str(filepath.relative_to(UPLOADS_DIR)),
            "full_path": str(filepath),
            "note": "Generated as Markdown. Install reportlab for true PDF support."
        }
    
    # Generate actual PDF
    filename = _generate_filename("pdf")
    filepath = GENERATED_DIR / filename
    
    page_size = landscape(A4) if orientation == "landscape" else A4
    doc = SimpleDocTemplate(str(filepath), pagesize=page_size)
    
    styles = getSampleStyleSheet()
    story = []
    
    # Title
    story.append(Paragraph(title, styles['Title']))
    story.append(Spacer(1, 12))
    
    # Content
    for line in content.split("\n"):
        if line.strip():
            story.append(Paragraph(line, styles['Normal']))
            story.append(Spacer(1, 6))
    
    doc.build(story)
    
    return {
        "success": True,
        "file_type": "pdf",
        "file_name": filename,
        "file_path": str(filepath.relative_to(UPLOADS_DIR)),
        "full_path": str(filepath),
    }


@registry.register(
    name="save_json",
    description="Save structured data as a JSON file",
    input_schema={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Filename without extension"
            },
            "data": {
                "type": "object",
                "description": "JSON-serializable data object"
            }
        },
        "required": ["filename", "data"]
    }
)
async def save_json(
    filename: str,
    data: dict
) -> dict[str, Any]:
    """Save data as JSON file."""
    if not filename.endswith(".json"):
        filename += ".json"
    
    filepath = GENERATED_DIR / filename
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    return {
        "success": True,
        "file_type": "json",
        "file_name": filename,
        "file_path": str(filepath.relative_to(UPLOADS_DIR)),
        "full_path": str(filepath),
    }


@registry.register(
    name="save_text",
    description="Save plain text content as a text file",
    input_schema={
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Filename without extension"
            },
            "content": {
                "type": "string",
                "description": "Text content"
            },
            "extension": {
                "type": "string",
                "enum": ["txt", "md", "csv", "html"],
                "description": "File extension"
            }
        },
        "required": ["filename", "content"]
    }
)
async def save_text(
    filename: str,
    content: str,
    extension: str = "txt"
) -> dict[str, Any]:
    """Save text content to file."""
    if not filename.endswith(f".{extension}"):
        filename += f".{extension}"
    
    filepath = GENERATED_DIR / filename
    filepath.write_text(content, encoding="utf-8")
    
    return {
        "success": True,
        "file_type": extension,
        "file_name": filename,
        "file_path": str(filepath.relative_to(UPLOADS_DIR)),
        "full_path": str(filepath),
    }
