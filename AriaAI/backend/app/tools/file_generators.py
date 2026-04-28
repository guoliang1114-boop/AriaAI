"""File generation tools for Claude Function Calling.

Provides tools to generate PPT, Word, Excel, and PDF files.
"""
from __future__ import annotations

import json
import os
import re
from copy import deepcopy
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


def _layout_placeholder_idx(slide, placeholder_name: str) -> int | None:
    for placeholder in slide.slide_layout.placeholders:
        if placeholder.name == placeholder_name:
            return placeholder.placeholder_format.idx
    return None


def _placeholder_by_layout_name(slide, placeholder_name: str):
    idx = _layout_placeholder_idx(slide, placeholder_name)
    if idx is None:
        return None
    try:
        return slide.placeholders[idx]
    except KeyError:
        return None


def _shape_by_name(slide, shape_name: str):
    for shape in slide.shapes:
        if shape.name == shape_name:
            return shape
    return None


def _set_placeholder_text(slide, placeholder_name: str, text: str) -> bool:
    placeholder = _placeholder_by_layout_name(slide, placeholder_name)
    if placeholder is None or not placeholder.has_text_frame:
        return False
    placeholder.text_frame.clear()
    placeholder.text_frame.text = text
    placeholder.text_frame.word_wrap = True
    _style_text_frame(placeholder.text_frame, placeholder_name)
    return True


def _set_named_or_placeholder_text(slide, shape_name: str, text: str) -> bool:
    """Write text by normal shape name first, then by layout placeholder name."""
    shape = _shape_by_name(slide, shape_name)
    if shape is not None and getattr(shape, "has_text_frame", False):
        shape.text_frame.clear()
        shape.text_frame.text = text
        shape.text_frame.word_wrap = True
        _style_text_frame(shape.text_frame, shape_name)
        return True
    return _set_placeholder_text(slide, shape_name, text)


def _placeholder_bounds(slide, placeholder_name: str):
    placeholder = _placeholder_by_layout_name(slide, placeholder_name)
    if placeholder is None:
        return None
    return placeholder.left, placeholder.top, placeholder.width, placeholder.height


def _bounds_by_name_or_placeholder(slide, shape_name: str):
    shape = _shape_by_name(slide, shape_name)
    if shape is not None:
        return shape.left, shape.top, shape.width, shape.height
    return _placeholder_bounds(slide, shape_name)


def _shape_by_name_or_placeholder(slide, shape_name: str):
    return _shape_by_name(slide, shape_name) or _placeholder_by_layout_name(slide, shape_name)


def _resize_named_or_placeholder(slide, shape_name: str, x, y, w, h) -> bool:
    shape = _shape_by_name_or_placeholder(slide, shape_name)
    if shape is None:
        return False
    shape.left = x
    shape.top = y
    shape.width = w
    shape.height = h
    return True


def _style_text_frame(frame, role: str):
    """Apply a clean consulting-style baseline to template text frames."""
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    role = role.lower()
    is_title = "title" in role
    is_cover = "cover" in role
    for paragraph in frame.paragraphs:
        paragraph.font.name = "Aptos"
        paragraph.font.size = Pt(30 if is_cover and is_title else 21 if is_title else 12)
        paragraph.font.bold = is_title
        if is_cover:
            paragraph.font.color.rgb = RGBColor.from_string("FFFFFF")
        else:
            paragraph.font.color.rgb = RGBColor.from_string("111827" if is_title else "334155")
        paragraph.space_after = Pt(4 if is_title else 3)
        paragraph.line_spacing = 1.08 if is_title else 1.18
        if paragraph.text.strip().startswith("-"):
            paragraph.level = 0


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
    replaced_title = _set_named_or_placeholder_text(slide, "aria_cover_title", title)
    replaced_subtitle = bool(subtitle) and _set_named_or_placeholder_text(slide, "aria_cover_subtitle", subtitle)
    if replaced_title and (replaced_subtitle or not subtitle):
        return

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


def _slide_ref(prs, index: int):
    refs = list(prs.slides._sldIdLst)
    if 0 <= index < len(refs):
        return refs[index]
    return None


def _remove_slide_ref(prs, slide_ref):
    if slide_ref is None:
        return
    slide_id_list = prs.slides._sldIdLst
    if slide_ref not in slide_id_list:
        return
    rel_id = slide_ref.rId
    slide_id_list.remove(slide_ref)
    prs.part.drop_rel(rel_id)


def _move_slide_ref_to_end(prs, slide_ref):
    if slide_ref is None:
        return
    slide_id_list = prs.slides._sldIdLst
    if slide_ref not in slide_id_list:
        return
    slide_id_list.remove(slide_ref)
    slide_id_list.append(slide_ref)


def _replace_relationship_ids(element, rel_id_map: dict[str, str]) -> None:
    if not rel_id_map:
        return
    for node in element.iter():
        for attr_name, attr_value in list(node.attrib.items()):
            if attr_value in rel_id_map:
                node.attrib[attr_name] = rel_id_map[attr_value]


def _clone_slide_from_prototype(prs, source_slide):
    """Duplicate a normal template slide so custom slide-level artwork survives.

    python-pptx's add_slide(layout) only applies the master/layout. It does not
    copy shapes that designers place on a normal slide, which made generated
    decks look like empty layouts. This clones the prototype slide's XML shapes
    and non-layout relationships before the content renderer writes text.
    """
    slide = prs.slides.add_slide(source_slide.slide_layout)
    sp_tree = slide.shapes._spTree
    for shape in list(slide.shapes):
        sp_tree.remove(shape.element)

    cloned_elements = [deepcopy(shape.element) for shape in source_slide.shapes]
    rel_id_map: dict[str, str] = {}
    for rel in source_slide.part.rels.values():
        if rel.reltype.endswith("/slideLayout") or rel.reltype.endswith("/notesSlide"):
            continue
        new_rel_id = slide.part.rels._add_relationship(
            rel.reltype,
            rel._target,
            getattr(rel, "is_external", False),
        )
        rel_id_map[rel.rId] = new_rel_id

    for element in cloned_elements:
        _replace_relationship_ids(element, rel_id_map)
        sp_tree.insert_element_before(element, "p:extLst")
    return slide


def _clear_text_shapes(slide):
    for shape in slide.shapes:
        if shape.has_text_frame:
            shape.text_frame.clear()


def _clear_generated_text_shapes(slide):
    for shape in slide.shapes:
        if shape.has_text_frame and not shape.is_placeholder:
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
    paragraph.font.name = "Aptos"
    paragraph.font.size = Pt(size)
    paragraph.font.bold = bold
    paragraph.font.color.rgb = RGBColor.from_string(color)
    paragraph.line_spacing = 1.08
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


def _add_shape(slide, shape_type, x, y, w, h, *, fill: str = "E0F2FE", line: str = "BAE6FD"):
    from pptx.dml.color import RGBColor
    from pptx.util import Pt

    shape = slide.shapes.add_shape(shape_type, x, y, w, h)
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


def _add_template_frame(slide, title: str, slide_number: int, *, section: str = "Digital strategy"):
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    top_rule = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.58), Inches(0.18), Inches(12.18), Inches(0.025))
    top_rule.fill.solid()
    top_rule.fill.fore_color.rgb = RGBColor.from_string("D7DEE8")
    top_rule.line.fill.background()

    accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.58), Inches(0.18), Inches(1.45), Inches(0.025))
    accent.fill.solid()
    accent.fill.fore_color.rgb = RGBColor.from_string("1D4ED8")
    accent.line.fill.background()

    rail = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.58), Inches(1.35), Inches(0.05), Inches(5.3))
    rail.fill.solid()
    rail.fill.fore_color.rgb = RGBColor.from_string("E2E8F0")
    rail.line.fill.background()

    marker_top = Inches(1.35 + ((slide_number - 1) % 5) * 0.56)
    marker = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.51), marker_top, Inches(0.19), Inches(0.5))
    marker.fill.solid()
    marker.fill.fore_color.rgb = RGBColor.from_string("1D4ED8")
    marker.line.fill.background()

    _add_textbox(slide, Inches(0.86), Inches(6.92), Inches(4.2), Inches(0.22), section.upper(), size=7, bold=True, color="94A3B8")
    _add_textbox(slide, Inches(11.85), Inches(6.9), Inches(0.8), Inches(0.24), f"{slide_number:02d}", size=8, bold=True, color="94A3B8")


def _add_consulting_visual_panel(slide, x, y, w, h, bullets: list[str]):
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    _add_card(slide, x, y, w, h, fill="FAFBFC", line="D7DEE8")
    _add_textbox(slide, x + Inches(0.24), y + Inches(0.16), w - Inches(0.48), Inches(0.28), "Executive lens", size=11, bold=True, color="0F172A")
    _add_textbox(slide, x + Inches(0.24), y + Inches(0.48), w - Inches(0.48), Inches(0.24), "Impact drivers", size=8, color="64748B")

    colors = ["1D4ED8", "047857", "B45309"]
    labels = ["Value", "Adoption", "Scale"]
    for idx, label in enumerate(labels):
        top = y + Inches(0.88 + idx * 0.64)
        _add_shape(slide, MSO_SHAPE.OVAL, x + Inches(0.28), top, Inches(0.30), Inches(0.30), fill=colors[idx], line=colors[idx])
        _add_textbox(slide, x + Inches(0.72), top - Inches(0.03), w - Inches(1.0), Inches(0.26), label, size=9, bold=True, color="334155")
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x + Inches(0.72), top + Inches(0.28), Inches(1.35 + idx * 0.34), Inches(0.06))
        bar.fill.solid()
        bar.fill.fore_color.rgb = RGBColor.from_string(colors[idx])
        bar.line.fill.background()

    insight = bullets[0] if bullets else "Align digital investments with measurable business outcomes."
    matrix_x = x + Inches(0.26)
    matrix_y = y + Inches(2.95)
    matrix_w = w - Inches(0.52)
    matrix_h = Inches(0.86)
    _add_card(slide, matrix_x, matrix_y, matrix_w, matrix_h, fill="EEF2FF", line="C7D2FE")
    _add_textbox(slide, matrix_x + Inches(0.16), matrix_y + Inches(0.13), matrix_w - Inches(0.32), Inches(0.46), insight[:110], size=9, bold=True, color="1E1B4B")
    _add_textbox(slide, x + Inches(0.28), y + Inches(3.98), w - Inches(0.56), Inches(0.22), "Decision focus: prioritize high-confidence, high-impact moves", size=7, color="64748B")


def _add_value_chain_visual(slide, x, y, w, h, bullets: list[str]):
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    labels = ["Diagnose", "Design", "Mobilize", "Scale"]
    colors = ["EFF6FF", "ECFDF5", "FFF7ED", "F8FAFC"]
    accents = ["1D4ED8", "047857", "C2410C", "475569"]
    step_w = w / 4 - Inches(0.08)
    for idx, label in enumerate(labels):
        left = x + idx * (step_w + Inches(0.1))
        _add_card(slide, left, y, step_w, h, fill=colors[idx], line="D8DEE9")
        _add_shape(slide, MSO_SHAPE.OVAL, left + Inches(0.12), y + Inches(0.12), Inches(0.34), Inches(0.34), fill=accents[idx], line=accents[idx])
        _add_textbox(slide, left + Inches(0.22), y + Inches(0.19), Inches(0.14), Inches(0.12), str(idx + 1), size=7, bold=True, color="FFFFFF")
        _add_textbox(slide, left + Inches(0.12), y + Inches(0.55), step_w - Inches(0.24), Inches(0.24), label, size=9, bold=True, color=accents[idx])
        if idx < len(bullets):
            _add_textbox(slide, left + Inches(0.12), y + Inches(0.88), step_w - Inches(0.24), h - Inches(1.0), bullets[idx][:80], size=7, color="475569")


def _add_roadmap_visual(slide, title: str, bullets: list[str], slide_number: int) -> bool:
    if not any(token in title.lower() for token in ("roadmap", "horizon", "phase", "路线", "阶段")):
        return False

    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    _clear_text_shapes(slide)
    _add_slide_header(slide, title, slide_number)
    phases = bullets[:3] or ["Foundation", "Scale", "Lead"]
    colors = [("DBEAFE", "2563EB"), ("DCFCE7", "16A34A"), ("FEF3C7", "D97706")]
    for idx, phase in enumerate(phases):
        x = Inches(0.85 + idx * 4.05)
        fill, accent = colors[idx % len(colors)]
        _add_card(slide, x, Inches(1.55), Inches(3.55), Inches(4.55), fill=fill, line=accent)
        _add_shape(slide, MSO_SHAPE.OVAL, x + Inches(0.25), Inches(1.85), Inches(0.58), Inches(0.58), fill=accent, line=accent)
        _add_textbox(slide, x + Inches(0.42), Inches(1.97), Inches(0.28), Inches(0.22), str(idx + 1), size=11, bold=True, color="FFFFFF")
        label = ["Foundation", "Scale", "Lead"][idx] if idx < 3 else f"Phase {idx + 1}"
        _add_textbox(slide, x + Inches(0.95), Inches(1.88), Inches(2.2), Inches(0.35), label, size=15, bold=True, color=accent)
        _add_textbox(slide, x + Inches(0.35), Inches(2.55), Inches(2.95), Inches(2.45), phase[:260], size=12, color="334155")
        if idx < len(phases) - 1:
            _add_shape(slide, MSO_SHAPE.CHEVRON, x + Inches(3.38), Inches(3.42), Inches(0.48), Inches(0.44), fill="E5E7EB", line="E5E7EB")
    _add_slide_footer(slide)
    return True


def _wants_visual_slide(title: str, content: str = "") -> bool:
    text = f"{title}\n{content}".lower()
    keywords = (
        "roadmap", "horizon", "phase", "blueprint", "capability", "maturity",
        "heatmap", "root cause", "operating model", "use-case", "use case",
        "portfolio", "prioritization", "investment", "funding", "kpi",
        "risk", "mitigation", "90-day", "90 day", "action plan",
        "路线", "阶段", "蓝图", "能力", "成熟度", "路径", "规划",
    )
    return any(keyword in text for keyword in keywords)


def _render_visual_slide(slide, title: str, content: str, slide_number: int):
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches

    _clear_generated_text_shapes(slide)
    bullets = _split_bullets(content, limit=6)
    used_template = (
        _set_named_or_placeholder_text(slide, "aria_slide_title", title)
        and _set_named_or_placeholder_text(slide, "aria_slide_body", "\n".join(f"- {bullet}" for bullet in bullets[:4]))
    )
    visual_bounds = _bounds_by_name_or_placeholder(slide, "aria_visual_area")
    if not used_template or visual_bounds is None:
        _clear_text_shapes(slide)
        _add_slide_header(slide, title, slide_number)
        visual_bounds = (Inches(7.4), Inches(1.45), Inches(4.7), Inches(4.8))
        _add_textbox(slide, Inches(0.85), Inches(1.45), Inches(5.95), Inches(4.9), "\n".join(f"- {bullet}" for bullet in bullets), size=13, color="334155")

    x, y, w, h = visual_bounds
    lower_title = title.lower()

    if any(token in lower_title for token in ("heatmap", "maturity", "prioritization", "portfolio")):
        labels = ["High value", "Build foundation", "Scale later", "Defer"]
        positions = [
            (0.06, 0.08, "DBEAFE", "1D4ED8"),
            (0.52, 0.08, "ECFDF5", "047857"),
            (0.06, 0.52, "FFF7ED", "C2410C"),
            (0.52, 0.52, "F8FAFC", "475569"),
        ]
        cell_w = w * 0.42
        cell_h = h * 0.35
        for idx, (left_ratio, top_ratio, fill, accent) in enumerate(positions):
            left = x + w * left_ratio
            top = y + h * top_ratio
            _add_card(slide, left, top, cell_w, cell_h, fill=fill, line=accent)
            _add_textbox(slide, left + Inches(0.14), top + Inches(0.12), cell_w - Inches(0.28), Inches(0.24), labels[idx], size=9, bold=True, color=accent)
            if idx < len(bullets):
                _add_textbox(slide, left + Inches(0.14), top + Inches(0.42), cell_w - Inches(0.28), cell_h - Inches(0.52), bullets[idx][:120], size=7, color="334155")
        if not used_template:
            _add_slide_footer(slide)
        return

    if any(token in lower_title for token in ("kpi", "investment", "funding", "business case")):
        metrics = [
            ("Value", "Revenue / margin impact", "1D4ED8"),
            ("Adoption", "Users / workflow coverage", "047857"),
            ("Delivery", "Milestones / dependencies", "C2410C"),
            ("Risk", "Controls / mitigations", "7C3AED"),
        ]
        card_w = w / 2 - Inches(0.12)
        card_h = h / 2 - Inches(0.14)
        for idx, (label, default, accent) in enumerate(metrics):
            left = x + (idx % 2) * (card_w + Inches(0.24))
            top = y + (idx // 2) * (card_h + Inches(0.28))
            _add_card(slide, left, top, card_w, card_h, fill="FFFFFF", line="D7DEE8")
            _add_shape(slide, MSO_SHAPE.RECTANGLE, left, top, card_w, Inches(0.08), fill=accent, line=accent)
            _add_textbox(slide, left + Inches(0.16), top + Inches(0.22), card_w - Inches(0.32), Inches(0.26), label, size=10, bold=True, color=accent)
            metric_text = bullets[idx] if idx < len(bullets) else default
            _add_textbox(slide, left + Inches(0.16), top + Inches(0.58), card_w - Inches(0.32), card_h - Inches(0.68), metric_text[:135], size=8, color="334155")
        if not used_template:
            _add_slide_footer(slide)
        return

    if any(token in lower_title for token in ("risk", "mitigation")):
        colors = [("FEF2F2", "DC2626"), ("FFF7ED", "EA580C"), ("F8FAFC", "475569")]
        for idx, (fill, accent) in enumerate(colors):
            top = y + idx * (h / 3)
            _add_card(slide, x, top, w, h / 3 - Inches(0.16), fill=fill, line=accent)
            _add_textbox(slide, x + Inches(0.16), top + Inches(0.12), Inches(0.6), Inches(0.28), f"R{idx + 1}", size=9, bold=True, color=accent)
            risk_text = bullets[idx] if idx < len(bullets) else "Define owner, mitigation and monitoring cadence."
            _add_textbox(slide, x + Inches(0.86), top + Inches(0.1), w - Inches(1.05), h / 3 - Inches(0.34), risk_text[:170], size=8, color="334155")
        if not used_template:
            _add_slide_footer(slide)
        return

    phases = bullets[:3] or ["Foundation", "Scale", "Lead"]
    colors = [("EFF6FF", "1D4ED8"), ("ECFDF5", "047857"), ("FFF7ED", "C2410C")]
    card_h = h / 3 - Inches(0.16)
    for idx, phase in enumerate(phases[:3]):
        fill, accent = colors[idx]
        top = y + idx * (card_h + Inches(0.22))
        _add_card(slide, x, top, w, card_h, fill=fill, line=accent)
        _add_shape(slide, MSO_SHAPE.OVAL, x + Inches(0.18), top + Inches(0.16), Inches(0.38), Inches(0.38), fill=accent, line=accent)
        _add_textbox(slide, x + Inches(0.31), top + Inches(0.23), Inches(0.14), Inches(0.12), str(idx + 1), size=8, bold=True, color="FFFFFF")
        label = ["Foundation", "Scale", "Lead"][idx]
        _add_textbox(slide, x + Inches(0.68), top + Inches(0.12), w - Inches(0.9), Inches(0.26), label, size=11, bold=True, color=accent)
        _add_textbox(slide, x + Inches(0.68), top + Inches(0.45), w - Inches(0.9), card_h - Inches(0.58), phase[:180], size=9, color="334155")

    if not used_template:
        _add_slide_footer(slide)


def _render_content_slide(slide, title: str, content: str, slide_number: int):
    from pptx.util import Inches

    _clear_generated_text_shapes(slide)
    bullets = _split_bullets(content, limit=6)
    if _add_roadmap_visual(slide, title, bullets, slide_number):
        return
    used_template = (
        _set_named_or_placeholder_text(slide, "aria_slide_title", title)
        and _set_named_or_placeholder_text(slide, "aria_slide_body", "\n".join(f"- {bullet}" for bullet in bullets))
    )
    if not used_template:
        _clear_text_shapes(slide)
        _add_slide_header(slide, title, slide_number)
    if bullets:
        hero = bullets[0]
        if used_template:
            # Template-first mode: keep the user's slide geometry intact and
            # only write into named placeholders. Extra visuals are reserved
            # for pages that explicitly expose aria_visual_area.
            return
        else:
            _add_card(slide, Inches(0.75), Inches(1.2), Inches(11.85), Inches(1.0), fill="EFF6FF", line="BFDBFE")
            _add_textbox(slide, Inches(1.0), Inches(1.38), Inches(11.35), Inches(0.55), hero, size=18, bold=True, color="1E3A8A")

    card_y = Inches(2.45)
    card_h = Inches(0.72)
    if not used_template:
        for idx, bullet in enumerate(bullets[1:6], start=1):
            y = card_y + Inches(0.82 * (idx - 1))
            _add_card(slide, Inches(0.85), y, Inches(7.85), card_h)
            _add_textbox(slide, Inches(1.05), y + Inches(0.12), Inches(0.45), Inches(0.3), f"{idx}", size=11, bold=True, color="2563EB")
            _add_textbox(slide, Inches(1.55), y + Inches(0.08), Inches(6.85), Inches(0.45), bullet, size=13, color="334155")
    if not used_template:
        _add_consulting_visual_panel(slide, Inches(9.05), Inches(2.45), Inches(3.35), Inches(4.1), bullets)
        _add_slide_footer(slide)


def _render_two_column_slide(slide, title: str, left_content: str, right_content: str, slide_number: int):
    from pptx.util import Inches

    _clear_generated_text_shapes(slide)
    used_template = (
        _set_named_or_placeholder_text(slide, "aria_slide_title", title)
        and _set_named_or_placeholder_text(slide, "aria_left_body", left_content)
        and _set_named_or_placeholder_text(slide, "aria_right_body", right_content)
    )
    if not used_template:
        _clear_text_shapes(slide)
        _add_slide_header(slide, title, slide_number)
    columns = [
        ("Current / Foundation", left_content, "F8FAFC", "2563EB", Inches(0.85)),
        ("Target / Scale", right_content, "F0FDF4", "16A34A", Inches(6.85)),
    ]
    if used_template:
        # Keep the user's two-column template untouched apart from named text.
        return
    for heading, content, fill, color, x in columns:
        _add_card(slide, x, Inches(1.35), Inches(5.55), Inches(5.2), fill=fill)
        _add_textbox(slide, x + Inches(0.28), Inches(1.58), Inches(5.0), Inches(0.38), heading, size=15, bold=True, color=color)
        bullets = _split_bullets(content, limit=6)
        for idx, bullet in enumerate(bullets):
            y = Inches(2.22 + idx * 0.62)
            _add_textbox(slide, x + Inches(0.35), y, Inches(0.25), Inches(0.24), "•", size=14, bold=True, color=color)
            _add_textbox(slide, x + Inches(0.65), y - Inches(0.02), Inches(4.55), Inches(0.38), bullet, size=12, color="334155")
    if not used_template:
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


def _normalize_digital_strategy_slides(slides: list[dict]) -> list[dict]:
    normalized = [dict(slide) for slide in slides if slide.get("title")]
    if len(normalized) >= 20:
        return normalized

    existing = {str(slide.get("title", "")).strip().lower() for slide in normalized}
    plan = [
        {
            "type": "title",
            "title": "Executive Alignment",
        },
        {
            "type": "content",
            "title": "Executive Summary",
            "content": "- Transformation thesis: digital must be managed as a business value portfolio, not a technology refresh\n- Value ambition: set explicit targets for growth, efficiency, risk control and decision speed\n- Priority moves: fix data foundations, launch high-value use cases and establish portfolio governance\n- Leadership decisions: confirm scope, funding envelope, owner model and first-wave pilot list\n- Success condition: every initiative has a business KPI, adoption target and accountable owner\n- Immediate ask: approve diagnostic scope, first-wave pilots and steering cadence",
        },
        {
            "type": "content",
            "title": "Strategic Context and Transformation Thesis",
            "content": "- Market shift: customers expect faster response, more transparency and personalized service\n- Competitive shift: digitally mature players compound advantage through data and operating speed\n- Internal constraint: fragmented systems and manual processes slow execution and obscure accountability\n- Opportunity window: AI, automation and cloud platforms now make cross-functional redesign feasible\n- Management implication: fund reusable capabilities rather than disconnected digital projects",
        },
        {
            "type": "content",
            "title": "Current Digital Maturity Diagnosis",
            "content": "- Strategy: test whether digital priorities are linked to growth, cost and risk objectives\n- Customer: assess channel integration, journey orchestration and customer data completeness\n- Operations: identify manual handoffs, process bottlenecks and automation opportunities\n- Organization: evaluate decision rights, product ownership, digital talent and change capacity\n- Data/technology: score master data, data governance, API maturity, cloud readiness and legacy risk",
        },
        {
            "type": "two_column",
            "title": "Maturity Heatmap: Strengths vs Constraints",
            "left_content": "- Strongest domains and where momentum already exists\n- Existing systems, data assets or teams that can be reused\n- Business units with sponsorship and adoption readiness\n- Quick proof points that can create confidence",
            "right_content": "- Weakest domains that block scaling\n- Legacy, data ownership, talent or process constraints\n- Decisions that require executive intervention\n- Capability gaps that should not be solved by tools alone",
        },
        {
            "type": "content",
            "title": "Pain Point Root Causes",
            "content": "- Process pain points often come from unclear ownership, not only missing systems\n- Data pain points usually reflect weak master data, inconsistent definitions and low accountability\n- Technology pain points come from point-to-point integration and customized legacy platforms\n- Adoption pain points come from incentives and training gaps rather than tool availability\n- Root-cause view should separate symptoms, structural causes and required management actions",
        },
        {
            "type": "title",
            "title": "Target Blueprint",
        },
        {
            "type": "content",
            "title": "Customer and Growth Experience Gaps",
            "content": "- Map priority journeys from awareness, sales, onboarding, service to retention\n- Identify breakpoints: duplicated data entry, slow response, inconsistent channels and limited personalization\n- Quantify impact through conversion leakage, retention risk, service cost and customer satisfaction gaps\n- Define growth scenarios such as precision marketing, sales productivity and next-best-action engagement\n- Link each scenario to required data assets, workflow changes and owner accountability",
        },
        {
            "type": "content",
            "title": "Digital Vision and Target State",
            "content": "- Vision: become a data-driven enterprise where decisions, operations and customer engagement are continuously optimized\n- North-star metrics: revenue uplift, margin improvement, cycle-time reduction and risk incident reduction\n- Operating principles: business-led, data-governed, platform-enabled and adoption-measured\n- Capability ambition: move priority domains from opportunistic pilots to managed enterprise capabilities\n- Design guardrail: standardize core platforms while enabling local business innovation",
        },
        {
            "type": "content",
            "title": "Capability Blueprint",
            "content": "- Customer intelligence: unified profile, segmentation, journey triggers and service personalization\n- Digital operations: workflow automation, process mining, exception management and SLA visibility\n- Data foundation: master data, quality rules, data products, access controls and ownership model\n- AI decision support: forecasting, recommendation, knowledge retrieval and assisted execution\n- Platform architecture: API layer, cloud services, security controls and reusable integration components",
        },
        {
            "type": "two_column",
            "title": "Target Operating Model Blueprint",
            "left_content": "- Business product owners own value, adoption and backlog priorities\n- Data owners govern definitions, access, quality and lifecycle\n- Technology teams provide reusable platforms and security guardrails\n- Transformation PMO manages portfolio rhythm and benefit tracking",
            "right_content": "- Steering committee resolves scope, funding and cross-functional trade-offs\n- Domain squads deliver use cases through agile releases\n- Change champions drive frontline adoption and training\n- Finance validates value realization and stage-gate funding",
        },
        {
            "type": "content",
            "title": "Use-Case Portfolio",
            "content": "- Growth use cases: lead scoring, precision marketing, churn prediction and pricing optimization\n- Efficiency use cases: automated reporting, workflow routing, demand planning and service operations\n- Risk use cases: compliance monitoring, anomaly detection, access governance and early-warning dashboards\n- Employee use cases: knowledge assistant, document drafting, training recommendation and expert matching\n- Portfolio rule: balance quick wins, foundation enablers and strategic differentiators",
        },
        {
            "type": "two_column",
            "title": "Use-Case Prioritization Logic",
            "left_content": "- Value pool size and confidence\n- Sponsorship strength and owner readiness\n- Data availability and quality\n- Delivery complexity and dependencies",
            "right_content": "- Start with visible quick wins to build momentum\n- Fund foundations that unlock multiple use cases\n- Sequence differentiators after data and ownership mature\n- Defer low-value automation without business sponsorship",
        },
        {
            "type": "title",
            "title": "Roadmap and Investment",
        },
        {
            "type": "two_column",
            "title": "Current State vs Target State",
            "left_content": "Current state\n- Fragmented data and manual workflows\n- Limited journey orchestration\n- Value tracking not fully embedded",
            "right_content": "Target state\n- Integrated customer and business data layer\n- Automated scenario-based operations\n- KPI-driven portfolio governance",
        },
        {
            "type": "content",
            "title": "Gap Prioritization Matrix",
            "content": "- Quick wins: high value, low complexity and visible within 90-180 days\n- Foundations: data, architecture and governance enablers required before scaled rollout\n- Differentiators: capabilities that create customer, cost or ecosystem advantage\n- Defer items: low-value automation or technology experiments without business sponsorship\n- Decision rule: prioritize by value, feasibility, dependency and change readiness",
        },
        {
            "type": "content",
            "title": "Three-Horizon Roadmap",
            "content": "- Horizon 1 Foundation: stabilize data, launch pilots, establish governance and prove value\n- Horizon 2 Scale: extend validated use cases across business units and integrate platforms\n- Horizon 3 Lead: build AI-native operations, ecosystem integration and continuous innovation loops\n- Roadmap dependency: do not scale advanced analytics before data ownership is working\n- Review cadence: quarterly value review and semi-annual roadmap refresh\n- Management gate: scale only after adoption and business KPI movement are visible",
        },
        {
            "type": "content",
            "title": "Initiative Portfolio and Milestones",
            "content": "- Each initiative defines owner, value KPI, user group, data dependency and milestone\n- Year 1: maturity baseline, data governance launch, 3-5 pilots and first value dashboard\n- Year 2: platform integration, scaled workflows, business-unit rollout and talent academy\n- Year 3: AI operating model, ecosystem collaboration and continuous optimization\n- Governance checkpoint: stop, scale or redesign initiatives based on adoption and value",
        },
        {
            "type": "two_column",
            "title": "Investment Case and Funding Model",
            "left_content": "- Technology: platforms, integration, security and automation tooling\n- Data: master data, governance, quality and analytics-ready data products\n- Talent/change: product owners, training, adoption and capability academy\n- Ecosystem: selected partners, pilots and capability transfer",
            "right_content": "- Stage-gate funding tied to proof of value\n- Base/upside/downside benefit assumptions\n- KPI ownership shared by business and finance\n- Quarterly review to stop, scale or redesign initiatives",
        },
        {
            "type": "content",
            "title": "Investment, KPI and Risk Controls",
            "content": "- Investment envelope covers technology, data, talent, change and partner support\n- Suggested split: 40% technology, 30% talent/change, 20% data, 10% ecosystem experimentation\n- KPI dashboard links business outcomes, adoption, data quality and delivery milestones\n- Key risks: legacy complexity, data ownership gaps, low adoption, vendor lock-in and security exposure\n- Control rhythm: monthly PMO dashboard and quarterly executive value review",
        },
        {
            "type": "title",
            "title": "Governance and Mobilization",
        },
        {
            "type": "content",
            "title": "Governance and Operating Model",
            "content": "- Steering committee owns priorities, funding trade-offs and cross-functional escalation\n- Transformation PMO manages portfolio rhythm, benefits tracking and dependency resolution\n- Product owners translate business pain points into roadmaps and adoption plans\n- Data owners govern definitions, quality, access and lifecycle management\n- Technology teams provide reusable platforms, standards and security guardrails",
        },
        {
            "type": "two_column",
            "title": "Risk Register and Mitigation Plan",
            "left_content": "- Legacy risk: hidden customization, downtime and integration debt\n- Data risk: inconsistent definitions, weak ownership and privacy exposure\n- Adoption risk: low frontline usage, training fatigue and incentive gaps\n- Vendor risk: lock-in, unclear accountability and capability transfer gaps",
            "right_content": "- Use phased migration and architecture guardrails\n- Assign named data owners and quality SLAs\n- Build change champions and role-based enablement\n- Define partner exit criteria and internal capability transfer",
        },
        {
            "type": "content",
            "title": "90-Day Action Plan",
            "content": "- Week 1-2: confirm ambition, scope, sponsor, decision forum and baseline assumptions\n- Week 3-5: run leadership interviews, maturity assessment and data/platform diagnostic\n- Week 6-8: prioritize use cases, estimate benefits and define first-wave pilots\n- Week 9-11: design operating model, investment case, KPI dashboard and roadmap dependencies\n- Week 12: align steering committee on launch plan, funding and owners",
        },
        {
            "type": "content",
            "title": "Immediate Next Steps",
            "content": "- Confirm leadership alignment and decision rights for the transformation portfolio\n- Validate maturity baseline with interviews, KPI data, system inventory and process evidence\n- Select first-wave use cases with clear value owners and measurable adoption targets\n- Convert roadmap into funded quarterly releases with dependency and risk controls\n- Prepare steering committee materials for scope, funding and mobilization approval",
        },
        {
            "type": "content",
            "title": "Appendix: Assessment and Interview Guide",
            "content": "- Executive interviews: strategic priorities, pain points, risk tolerance and value ambition\n- Business interviews: journey friction, process bottlenecks, adoption barriers and KPI baselines\n- IT/data interviews: architecture, integration, data quality, security and delivery constraints\n- Evidence pack: process maps, system inventory, data dictionary, project portfolio and budget baseline\n- Use findings to replace assumptions and sharpen the next deck version",
        },
    ]

    for slide in plan:
        key = slide["title"].lower()
        if key in existing:
            continue
        normalized.append(slide)
        existing.add(key)
        if len(normalized) >= 22:
            break
    return normalized


PRESENTATION_BUILDER_PRESETS: dict[str, list[dict]] = {
    "strategy": [
        {
            "type": "title",
            "title": "Strategic Direction",
        },
        {
            "type": "content",
            "title": "Executive Answer",
            "content": "- Core recommendation and decision required\n- Value ambition and expected management impact\n- Priority moves for the next planning horizon\n- Key assumptions and evidence to validate\n- Immediate leadership asks",
        },
        {
            "type": "content",
            "title": "Strategic Context",
            "content": "- Market, customer, competitor and internal pressure points\n- Why the topic matters now\n- Current constraints and opportunity window\n- Business implications if no action is taken\n- Scope boundaries for the recommendation",
        },
        {
            "type": "two_column",
            "title": "Current State vs Target State",
            "left_content": "Current state\n- Fragmented priorities\n- Manual decision loops\n- Inconsistent ownership\n- Limited value tracking",
            "right_content": "Target state\n- Clear strategic choices\n- Measurable initiatives\n- Accountable owners\n- Quarterly value review",
        },
        {
            "type": "matrix",
            "title": "Strategic Options",
            "content": "- Option A: conservative path with lower execution risk\n- Option B: focused acceleration around priority value pools\n- Option C: bold transformation with broader operating model change\n- Trade-offs across value, feasibility, risk and speed\n- Recommended option and rationale",
            "labels": ["Quick wins", "Foundations", "Differentiators", "Defer"],
        },
        {
            "type": "title",
            "title": "Roadmap and Governance",
        },
        {
            "type": "roadmap",
            "title": "Roadmap and Investment Logic",
            "left_content": "Phase 1\n- Prove value and establish foundations\n- Confirm owners and operating cadence",
            "content": "Phase 2\n- Scale validated initiatives\n- Expand across teams or business units",
            "right_content": "Phase 3\n- Institutionalize governance\n- Optimize continuous value realization",
        },
        {
            "type": "kpi",
            "title": "Governance, KPI and Next Steps",
            "content": "- Decision forum and escalation route\n- KPI dashboard linked to business outcomes\n- Owner model for delivery and adoption\n- Top risks and mitigations\n- 30/60/90-day actions",
        },
    ],
    "proposal": [
        {
            "type": "title",
            "title": "Client Need",
        },
        {
            "type": "content",
            "title": "Client Situation and Need",
            "content": "- Client context and triggering business issue\n- What is at stake for leadership\n- Current pain points and constraints\n- Why external support is valuable now\n- Desired outcomes for the engagement",
        },
        {
            "type": "content",
            "title": "Our Understanding of the Challenge",
            "content": "- Business questions to answer\n- Stakeholder priorities and concerns\n- Data, process or organizational unknowns\n- Success criteria for the work\n- Key assumptions to validate in kickoff",
        },
        {
            "type": "title",
            "title": "Proposed Solution",
        },
        {
            "type": "roadmap",
            "title": "Proposed Approach",
            "left_content": "Phase 1\n- Diagnose current state and value pools\n- Align on business questions",
            "content": "Phase 2\n- Design recommendations and target model\n- Build roadmap and business case",
            "right_content": "Phase 3\n- Align stakeholders\n- Prepare mobilization and governance",
        },
        {
            "type": "two_column",
            "title": "Scope and Deliverables",
            "left_content": "In scope\n- Executive interviews\n- Current-state analysis\n- Option design\n- Roadmap and business case\n- Steering materials",
            "right_content": "Deliverables\n- Findings summary\n- Recommendation deck\n- Initiative backlog\n- Implementation roadmap\n- Governance playbook",
        },
        {
            "type": "title",
            "title": "Mobilization",
        },
        {
            "type": "roadmap",
            "title": "Team, Timeline and Ways of Working",
            "left_content": "Team\n- Consulting team roles\n- Client participation model",
            "content": "Timeline\n- Weekly cadence\n- Steering committee rhythm",
            "right_content": "Ways of working\n- Required inputs\n- Escalation route",
        },
        {
            "type": "risk",
            "title": "Commercials, Risks and Next Steps",
            "content": "- Fee and effort assumptions\n- Optional modules and expansion paths\n- Key risks and mitigation actions\n- Immediate next meeting agenda\n- Decision required to launch",
        },
    ],
    "project-update": [
        {
            "type": "title",
            "title": "Status Snapshot",
        },
        {
            "type": "content",
            "title": "Executive Status",
            "content": "- Overall status and confidence level\n- Progress since last update\n- Key decisions or escalations required\n- Risks that may affect timeline, budget or value\n- Next milestone and owner",
        },
        {
            "type": "two_column",
            "title": "Progress vs Plan",
            "left_content": "Planned\n- Milestones\n- Workstream outputs\n- Decisions expected\n- Dependencies",
            "right_content": "Actual\n- Completed work\n- Variances\n- Open decisions\n- Dependency status",
        },
        {
            "type": "content",
            "title": "Workstream Highlights",
            "content": "- Workstream 1: progress, blocker and next action\n- Workstream 2: progress, blocker and next action\n- Workstream 3: progress, blocker and next action\n- Cross-workstream dependencies\n- Support needed from sponsors",
        },
        {
            "type": "title",
            "title": "Risks and Decisions",
        },
        {
            "type": "risk",
            "title": "Risks, Issues and Decisions",
            "content": "- Top risks ranked by impact and likelihood\n- Active issues and resolution owner\n- Decisions needed this cycle\n- Mitigation actions and deadlines\n- Items to monitor before next update",
        },
        {
            "type": "kpi",
            "title": "Value and Adoption Signals",
            "content": "- Benefits delivered or leading indicators\n- User adoption and stakeholder feedback\n- KPI movement against baseline\n- Evidence collected this period\n- Gaps to address before scaling",
        },
        {
            "type": "next_steps",
            "title": "Next Steps",
            "content": "- Actions for the next two weeks\n- Owners and deadlines\n- Upcoming workshops or steering meetings\n- Inputs needed from client or leadership\n- Decision log updates",
        },
    ],
}

PRESENTATION_BUILDER_COMMON_SLIDES: list[dict] = [
    {
        "type": "content",
        "title": "Key Assumptions",
        "content": "- Business context and audience assumptions\n- Data and evidence currently available\n- Constraints that shape the recommendation\n- Areas requiring validation\n- Implications for the next working session",
    },
    {
        "type": "content",
        "title": "Stakeholder Implications",
        "content": "- Primary stakeholders affected by the recommendation\n- Expected benefits and concerns by stakeholder group\n- Communication messages to reinforce\n- Likely objections and response logic\n- Sponsor actions required",
    },
    {
        "type": "content",
        "title": "Decision and Action Log",
        "content": "- Decisions required from leadership\n- Actions already agreed\n- Open actions and owners\n- Due dates and dependencies\n- Escalations for the next governance meeting",
    },
    {
        "type": "risk",
        "title": "Risks and Mitigations",
        "content": "- Execution risks and likely triggers\n- Stakeholder or adoption risks\n- Data, technology or operational dependencies\n- Mitigation actions and owners\n- Monitoring cadence",
    },
    {
        "type": "kpi",
        "title": "Success Metrics",
        "content": "- Business outcome KPIs\n- Adoption and usage indicators\n- Delivery milestone metrics\n- Quality and risk indicators\n- Review cadence and accountability",
    },
    {
        "type": "content",
        "title": "Appendix: Supporting Detail",
        "content": "- Source materials and evidence pack\n- Interview or workshop notes to collect\n- Additional analysis required\n- Optional modules or future work\n- Reference data for the next version",
    },
]


PRESENTATION_BUILDER_PRESETS: dict[str, list[dict]] = {
    "strategy": [
        {
            "type": "title",
            "title": "Strategic Direction",
        },
        {
            "type": "content",
            "title": "Executive Answer",
            "content": "- Core recommendation and decision required\n- Value ambition and expected management impact\n- Priority moves for the next planning horizon\n- Key assumptions and evidence to validate\n- Immediate leadership asks",
        },
        {
            "type": "content",
            "title": "Strategic Context",
            "content": "- Market, customer, competitor and internal pressure points\n- Why the topic matters now\n- Current constraints and opportunity window\n- Business implications if no action is taken\n- Scope boundaries for the recommendation",
        },
        {
            "type": "two_column",
            "title": "Current State vs Target State",
            "left_content": "Current state\n- Fragmented priorities\n- Manual decision loops\n- Inconsistent ownership\n- Limited value tracking",
            "right_content": "Target state\n- Clear strategic choices\n- Measurable initiatives\n- Accountable owners\n- Quarterly value review",
        },
        {
            "type": "matrix",
            "title": "Strategic Options",
            "content": "- Option A: conservative path with lower execution risk\n- Option B: focused acceleration around priority value pools\n- Option C: bold transformation with broader operating model change\n- Trade-offs across value, feasibility, risk and speed\n- Recommended option and rationale",
            "labels": ["Quick wins", "Foundations", "Differentiators", "Defer"],
        },
        {
            "type": "title",
            "title": "Roadmap and Governance",
        },
        {
            "type": "roadmap",
            "title": "Roadmap and Investment Logic",
            "left_content": "Phase 1\n- Prove value and establish foundations\n- Confirm owners and operating cadence",
            "content": "Phase 2\n- Scale validated initiatives\n- Expand across teams or business units",
            "right_content": "Phase 3\n- Institutionalize governance\n- Optimize continuous value realization",
        },
        {
            "type": "kpi",
            "title": "Governance, KPI and Next Steps",
            "content": "- Decision forum and escalation route\n- KPI dashboard linked to business outcomes\n- Owner model for delivery and adoption\n- Top risks and mitigations\n- 30/60/90-day actions",
        },
    ],
    "proposal": [
        {
            "type": "title",
            "title": "Client Need",
        },
        {
            "type": "content",
            "title": "Client Situation and Need",
            "content": "- Client context and triggering business issue\n- What is at stake for leadership\n- Current pain points and constraints\n- Why external support is valuable now\n- Desired outcomes for the engagement",
        },
        {
            "type": "content",
            "title": "Our Understanding of the Challenge",
            "content": "- Business questions to answer\n- Stakeholder priorities and concerns\n- Data, process or organizational unknowns\n- Success criteria for the work\n- Key assumptions to validate in kickoff",
        },
        {
            "type": "title",
            "title": "Proposed Solution",
        },
        {
            "type": "roadmap",
            "title": "Proposed Approach",
            "left_content": "Phase 1\n- Diagnose current state and value pools\n- Align on business questions",
            "content": "Phase 2\n- Design recommendations and target model\n- Build roadmap and business case",
            "right_content": "Phase 3\n- Align stakeholders\n- Prepare mobilization and governance",
        },
        {
            "type": "two_column",
            "title": "Scope and Deliverables",
            "left_content": "In scope\n- Executive interviews\n- Current-state analysis\n- Option design\n- Roadmap and business case\n- Steering materials",
            "right_content": "Deliverables\n- Findings summary\n- Recommendation deck\n- Initiative backlog\n- Implementation roadmap\n- Governance playbook",
        },
        {
            "type": "title",
            "title": "Mobilization",
        },
        {
            "type": "roadmap",
            "title": "Team, Timeline and Ways of Working",
            "left_content": "Team\n- Consulting team roles\n- Client participation model",
            "content": "Timeline\n- Weekly cadence\n- Steering committee rhythm",
            "right_content": "Ways of working\n- Required inputs\n- Escalation route",
        },
        {
            "type": "risk",
            "title": "Commercials, Risks and Next Steps",
            "content": "- Fee and effort assumptions\n- Optional modules and expansion paths\n- Key risks and mitigation actions\n- Immediate next meeting agenda\n- Decision required to launch",
        },
    ],
    "project-update": [
        {
            "type": "title",
            "title": "Status Snapshot",
        },
        {
            "type": "content",
            "title": "Executive Status",
            "content": "- Overall status and confidence level\n- Progress since last update\n- Key decisions or escalations required\n- Risks that may affect timeline, budget or value\n- Next milestone and owner",
        },
        {
            "type": "two_column",
            "title": "Progress vs Plan",
            "left_content": "Planned\n- Milestones\n- Workstream outputs\n- Decisions expected\n- Dependencies",
            "right_content": "Actual\n- Completed work\n- Variances\n- Open decisions\n- Dependency status",
        },
        {
            "type": "content",
            "title": "Workstream Highlights",
            "content": "- Workstream 1: progress, blocker and next action\n- Workstream 2: progress, blocker and next action\n- Workstream 3: progress, blocker and next action\n- Cross-workstream dependencies\n- Support needed from sponsors",
        },
        {
            "type": "title",
            "title": "Risks and Decisions",
        },
        {
            "type": "risk",
            "title": "Risks, Issues and Decisions",
            "content": "- Top risks ranked by impact and likelihood\n- Active issues and resolution owner\n- Decisions needed this cycle\n- Mitigation actions and deadlines\n- Items to monitor before next update",
        },
        {
            "type": "kpi",
            "title": "Value and Adoption Signals",
            "content": "- Benefits delivered or leading indicators\n- User adoption and stakeholder feedback\n- KPI movement against baseline\n- Evidence collected this period\n- Gaps to address before scaling",
        },
        {
            "type": "next_steps",
            "title": "Next Steps",
            "content": "- Actions for the next two weeks\n- Owners and deadlines\n- Upcoming workshops or steering meetings\n- Inputs needed from client or leadership\n- Decision log updates",
        },
    ],
}

PRESENTATION_BUILDER_COMMON_SLIDES: list[dict] = [
    {
        "type": "content",
        "title": "Key Assumptions",
        "content": "- Business context and audience assumptions\n- Data and evidence currently available\n- Constraints that shape the recommendation\n- Areas requiring validation\n- Implications for the next working session",
    },
    {
        "type": "content",
        "title": "Stakeholder Implications",
        "content": "- Primary stakeholders affected by the recommendation\n- Expected benefits and concerns by stakeholder group\n- Communication messages to reinforce\n- Likely objections and response logic\n- Sponsor actions required",
    },
    {
        "type": "content",
        "title": "Decision and Action Log",
        "content": "- Decisions required from leadership\n- Actions already agreed\n- Open actions and owners\n- Due dates and dependencies\n- Escalations for the next governance meeting",
    },
    {
        "type": "risk",
        "title": "Risks and Mitigations",
        "content": "- Execution risks and likely triggers\n- Stakeholder or adoption risks\n- Data, technology or operational dependencies\n- Mitigation actions and owners\n- Monitoring cadence",
    },
    {
        "type": "kpi",
        "title": "Success Metrics",
        "content": "- Business outcome KPIs\n- Adoption and usage indicators\n- Delivery milestone metrics\n- Quality and risk indicators\n- Review cadence and accountability",
    },
    {
        "type": "content",
        "title": "Appendix: Supporting Detail",
        "content": "- Source materials and evidence pack\n- Interview or workshop notes to collect\n- Additional analysis required\n- Optional modules or future work\n- Reference data for the next version",
    },
]


def _normalize_presentation_deck_type(deck_type: str | None) -> str:
    normalized = (deck_type or "strategy").strip().lower().replace("_", "-")
    aliases = {
        "strategic": "strategy",
        "strategy-report": "strategy",
        "executive": "strategy",
        "executive-briefing": "strategy",
        "proposal-deck": "proposal",
        "client-proposal": "proposal",
        "update": "project-update",
        "project": "project-update",
        "status": "project-update",
        "project-status": "project-update",
    }
    return aliases.get(normalized, normalized if normalized in PRESENTATION_BUILDER_PRESETS else "strategy")


def _normalize_presentation_builder_slides(slides: list[dict], deck_type: str | None = None) -> list[dict]:
    normalized = [dict(slide) for slide in slides if slide.get("title")]
    preset_key = _normalize_presentation_deck_type(deck_type)
    minimum_slide_count = 12 if preset_key in {"proposal", "project-update"} else 14
    if len(normalized) >= minimum_slide_count:
        return normalized

    existing = {str(slide.get("title", "")).strip().lower() for slide in normalized}
    for slide in PRESENTATION_BUILDER_PRESETS[preset_key]:
        key = slide["title"].lower()
        if key in existing:
            continue
        normalized.append(dict(slide))
        existing.add(key)
        if len(normalized) >= minimum_slide_count:
            break
    for slide in PRESENTATION_BUILDER_COMMON_SLIDES:
        if len(normalized) >= minimum_slide_count:
            break
        key = slide["title"].lower()
        if key in existing:
            continue
        normalized.append(dict(slide))
        existing.add(key)
    return normalized


def _normalize_presentation_slide_type(slide_type: Any) -> str:
    normalized = str(slide_type or "content").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "section": "title",
        "divider": "title",
        "section_divider": "title",
        "compare": "two_column",
        "current_target": "two_column",
        "plan_actual": "two_column",
        "timeline": "roadmap",
        "milestones": "roadmap",
        "scorecard": "kpi",
        "metrics": "kpi",
        "risks": "risk",
        "risk_mitigation": "risk",
        "nextsteps": "next_steps",
        "actions": "next_steps",
    }
    return aliases.get(normalized, normalized)


def _normalize_presentation_builder_slide_format(slides: list[dict]) -> list[dict]:
    formatted: list[dict] = []
    for slide in slides:
        item = dict(slide)
        slide_type = _normalize_presentation_slide_type(item.get("type"))
        item["type"] = slide_type
        if slide_type == "roadmap":
            roadmap_parts = [
                str(item.get("left_content") or item.get("phase_1") or "").strip(),
                str(item.get("content") or item.get("phase_2") or "").strip(),
                str(item.get("right_content") or item.get("phase_3") or "").strip(),
            ]
            item["content"] = "\n".join(part for part in roadmap_parts if part)
        if slide_type == "matrix":
            labels = item.get("labels") or item.get("card_titles") or []
            label_lines = [f"- {label}" for label in labels if str(label).strip()]
            body = str(item.get("content") or "").strip()
            item["content"] = "\n".join([*label_lines, body]).strip()
        if slide_type in {"roadmap", "matrix", "kpi", "risk", "next_steps"}:
            item.setdefault("content", item.get("content") or "")
        if slide_type == "next_steps":
            item["type"] = "content"
        if slide_type in {"roadmap", "matrix", "kpi", "risk"}:
            item["type"] = "content"
        if item["type"] == "content" and item.get("content"):
            bullets = _split_bullets(str(item.get("content") or ""), limit=6)
            item["content"] = "\n".join(f"- {bullet}" for bullet in bullets)
        if item["type"] == "two_column":
            left = _split_bullets(str(item.get("left_content") or ""), limit=5)
            right = _split_bullets(str(item.get("right_content") or ""), limit=5)
            item["left_content"] = "\n".join(f"- {bullet}" for bullet in left)
            item["right_content"] = "\n".join(f"- {bullet}" for bullet in right)
        formatted.append(item)
    return formatted


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
        if len(prs.slides) >= 5:
            _set_template_cover_text(prs.slides[0], title, subtitle)

            content_ref = _slide_ref(prs, 1)
            two_col_ref = _slide_ref(prs, 2)
            visual_ref = _slide_ref(prs, 3)
            back_cover_ref = _slide_ref(prs, 4)
            content_prototype = prs.slides[1]
            two_col_prototype = prs.slides[2]
            visual_prototype = prs.slides[3]

            for slide_index, slide_data in enumerate(slides):
                slide_type = slide_data.get("type", "content")
                slide_title = slide_data.get("title", "")
                content = slide_data.get("content", "")
                use_visual = slide_type == "content" and _wants_visual_slide(slide_title, content)

                if slide_type in {"title", "section"}:
                    slide = _clone_slide_from_prototype(prs, visual_prototype)
                elif slide_type == "two_column":
                    slide = _clone_slide_from_prototype(prs, two_col_prototype)
                elif use_visual:
                    slide = _clone_slide_from_prototype(prs, visual_prototype)
                else:
                    slide = _clone_slide_from_prototype(prs, content_prototype)

                if slide_type in {"title", "section"}:
                    _render_section_slide(slide, slide_title, slide_index + 1)
                elif use_visual:
                    _render_visual_slide(slide, slide_title, content, slide_index + 1)
                elif slide_type == "two_column":
                    _render_two_column_slide(
                        slide,
                        slide_title,
                        slide_data.get("left_content", ""),
                        slide_data.get("right_content", ""),
                        slide_index + 1,
                    )
                elif "content" in slide_data:
                    _render_content_slide(slide, slide_title, content, slide_index + 1)

            _remove_slide_ref(prs, content_ref)
            _remove_slide_ref(prs, two_col_ref)
            _remove_slide_ref(prs, visual_ref)
            _move_slide_ref_to_end(prs, back_cover_ref)

            filename = _generate_filename("pptx")
            filepath = GENERATED_DIR / filename
            prs.save(filepath)
            return {
                "success": True,
                "file_type": "pptx",
                "file_name": filename,
                "file_path": str(filepath.relative_to(UPLOADS_DIR)),
                "full_path": str(filepath),
                "template_path": str(template_path),
                "template_name": Path(template_path).name,
                "template_applied": True,
                "template_mode": "cloned_prototype_slides",
                "slide_count": len(prs.slides),
            }

    if using_template:
        prs = Presentation(template_path)

        # ── Cover slide (template slide 0) ──────────────────────────────────
        cover_slide = prs.slides[0]
        _set_template_cover_text(cover_slide, title, subtitle)
        has_template_content_prototype = len(prs.slides) > 2

        # Layout helpers for content slides
        content_layout = _safe_layout(prs, 1)   # aria_slide_title + aria_slide_body
        two_col_layout = _safe_layout(prs, 2)   # aria_slide_title + aria_left_body + aria_right_body

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
        **({
            "template_path": str(template_path),
            "template_name": Path(template_path).name,
            "template_applied": True,
            "template_mode": "layout_fallback",
        } if using_template else {"template_applied": False}),
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
                        "type": {
                            "type": "string",
                            "enum": [
                                "title",
                                "section",
                                "content",
                                "two_column",
                                "roadmap",
                                "matrix",
                                "kpi",
                                "risk",
                                "next_steps",
                            ],
                        },
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "left_content": {"type": "string"},
                        "right_content": {"type": "string"}
                    },
                    "required": ["type", "title"]
                }
            },
            "deck_type": {
                "type": "string",
                "description": "Optional deck preset for presentation-builder: strategy, proposal, or project-update"
            },
            "template_key": {
                "type": "string",
                "description": "Optional template hint. presentation-builder can use digital-strategy as its base template."
            }
        },
        "required": ["skill_name", "title", "slides"]
    }
)
async def generate_ppt_from_skill(
    skill_name: str,
    title: str,
    slides: list[dict],
    subtitle: str = "",
    deck_type: str = "",
    template_key: str = "",
) -> dict[str, Any]:
    """Generate PPT using a skill's template."""
    if skill_name == "digital-strategy":
        slides = _normalize_digital_strategy_slides(slides)
    elif skill_name == "presentation-builder":
        slides = _normalize_presentation_builder_slides(slides, deck_type or template_key)
        slides = _normalize_presentation_builder_slide_format(slides)

    strict_template_skills = {"digital-strategy", "presentation-builder"}

    # Search for template in assets/ then references/ (both locations are valid)
    template_path = None
    searched_paths: list[str] = []
    template_skill_names = [skill_name]
    if skill_name == "presentation-builder":
        template_skill_names.extend(["digital-strategy"])
    for template_skill_name in template_skill_names:
        for folder in ("assets", "references"):
            for filename in ("KPMG-Template.pptx", "Template.pptx", "template.pptx"):
                candidate = SKILLS_DIR / template_skill_name / folder / filename
                searched_paths.append(str(candidate))
                if candidate.exists():
                    template_path = candidate
                    break
            if template_path:
                break
        if template_path:
            break

    if not template_path:
        if skill_name in strict_template_skills:
            return {
                "success": False,
                "error": f"{skill_name} template not found; refusing to generate a blank deck.",
                "searched_paths": searched_paths,
                "template_applied": False,
            }
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
