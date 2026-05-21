# Office 全局默认模板草案（KPMG 风格参考）

> 用途：先作为全局默认模板配置草案。整体参考 KPMG 官网的专业咨询风格：深蓝主色、清晰留白、洞察型标题、克制的亮蓝点缀。你可以直接改字段值；确认后再接入后端工具，让 Skill 生成 DOCX / PPTX / XLSX / PDF 时默认套用。

```json
{
  "name": "aria_kpmg_inspired_default",
  "display_name": "Aria KPMG-inspired 咨询交付模板",
  "version": "1.1",
  "style_reference": {
    "source": "KPMG global website inspired",
    "principles": [
      "deep blue corporate authority",
      "large white space",
      "clear insight-first hierarchy",
      "minimal accent color usage",
      "consulting report density without decorative clutter"
    ]
  },
  "brand": {
    "primary_color": "#00338D",
    "secondary_color": "#005EB8",
    "accent_color": "#0091DA",
    "light_accent_color": "#E6F4FB",
    "warning_color": "#F68D2E",
    "danger_color": "#D9291C",
    "text_color": "#111827",
    "muted_text_color": "#5F6B7A",
    "border_color": "#D7DFEA",
    "background_color": "#FFFFFF",
    "subtle_background_color": "#F3F6FA",
    "deep_panel_background": "#00338D",
    "font_family": "Arial",
    "cjk_font_family": "Microsoft YaHei",
    "logo_text": "Aria",
    "confidential_label": "Confidential"
  },
  "docx": {
    "page": {
      "size": "A4",
      "margin_top_cm": 2.4,
      "margin_right_cm": 2.0,
      "margin_bottom_cm": 2.2,
      "margin_left_cm": 2.0
    },
    "title": {
      "font_size_pt": 21,
      "bold": true,
      "color": "#00338D",
      "alignment": "left",
      "space_after_pt": 18,
      "bottom_border_color": "#0091DA",
      "bottom_border_width_pt": 1.5
    },
    "heading_1": {
      "font_size_pt": 16,
      "bold": true,
      "color": "#00338D",
      "space_before_pt": 20,
      "space_after_pt": 8
    },
    "heading_2": {
      "font_size_pt": 13,
      "bold": true,
      "color": "#111827",
      "space_before_pt": 12,
      "space_after_pt": 6
    },
    "key_message": {
      "font_size_pt": 11,
      "bold": true,
      "color": "#00338D",
      "left_border_color": "#0091DA",
      "background": "#F3F6FA",
      "padding_pt": 8
    },
    "body": {
      "font_size_pt": 10.5,
      "line_spacing": 1.22,
      "space_after_pt": 6,
      "first_line_indent_chars": 0
    },
    "bullet": {
      "font_size_pt": 10.5,
      "indent_cm": 0.5,
      "space_after_pt": 4
    },
    "table": {
      "header_fill": "#00338D",
      "header_text_color": "#FFFFFF",
      "border_color": "#D8E0EE",
      "banded_row_fill": "#F3F6FA",
      "cell_padding_pt": 6
    },
    "footer": {
      "enabled": true,
      "text": "Aria | Confidential",
      "show_page_number": true,
      "font_size_pt": 8,
      "color": "#6B7280"
    }
  },
  "pptx": {
    "page": {
      "size": "16:9",
      "width_in": 13.333,
      "height_in": 7.5
    },
    "theme": {
      "background": "#FFFFFF",
      "section_background": "#00338D",
      "title_color": "#111827",
      "body_color": "#374151",
      "primary_color": "#00338D",
      "secondary_color": "#005EB8",
      "accent_color": "#0091DA",
      "light_panel": "#F3F6FA"
    },
    "cover_slide": {
      "layout": "kpmg_style_blue_band_cover",
      "title_font_size_pt": 36,
      "subtitle_font_size_pt": 15,
      "title_color": "#FFFFFF",
      "background": "#00338D",
      "accent_bar_color": "#0091DA",
      "show_client": true,
      "show_date": true,
      "show_confidential": true
    },
    "section_slide": {
      "layout": "blue_field_large_section_title",
      "section_number_font_size_pt": 56,
      "title_font_size_pt": 32,
      "title_color": "#FFFFFF",
      "background": "#00338D",
      "accent_color": "#0091DA"
    },
    "content_slide": {
      "layout": "insight_title_body_with_blue_rule",
      "title_font_size_pt": 24,
      "title_color": "#00338D",
      "key_message_font_size_pt": 13,
      "key_message_color": "#111827",
      "key_message_background": "#F3F6FA",
      "body_font_size_pt": 12,
      "max_bullets": 6,
      "top_rule_color": "#0091DA",
      "show_footer": true
    },
    "two_column_slide": {
      "layout": "two_column_with_blue_column_heads",
      "title_font_size_pt": 23,
      "column_title_font_size_pt": 14,
      "body_font_size_pt": 11,
      "column_gap_in": 0.35,
      "column_header_fill": "#00338D",
      "column_header_text": "#FFFFFF"
    },
    "chart_slide": {
      "layout": "chart_left_insight_right",
      "chart_palette": ["#00338D", "#005EB8", "#0091DA", "#7FBCE8", "#D7DFEA"],
      "callout_fill": "#F3F6FA",
      "callout_border": "#0091DA"
    },
    "footer": {
      "enabled": true,
      "left_text": "Aria",
      "right_text": "Confidential",
      "show_page_number": true,
      "font_size_pt": 7,
      "color": "#6B7280"
    }
  },
  "xlsx": {
    "workbook": {
      "default_sheet_name": "Sheet1",
      "freeze_header_row": true,
      "auto_filter": true,
      "gridlines": false
    },
    "header": {
      "fill": "#00338D",
      "text_color": "#FFFFFF",
      "bold": true,
      "font_size_pt": 11,
      "height": 26
    },
    "body": {
      "font_size_pt": 10,
      "text_color": "#111827",
      "odd_row_fill": "#FFFFFF",
      "even_row_fill": "#F3F6FA",
      "border_color": "#D7DFEA",
      "row_height": 22
    },
    "columns": {
      "default_width": 16,
      "min_width": 10,
      "max_width": 36,
      "auto_fit": true
    },
    "number_formats": {
      "integer": "#,##0",
      "decimal": "#,##0.00",
      "currency": "¥#,##0.00",
      "percent": "0.0%",
      "date": "yyyy-mm-dd"
    },
    "summary_row": {
      "enabled": true,
      "fill": "#E6F4FB",
      "bold": true,
      "top_border_color": "#00338D"
    },
    "charts": {
      "default_palette": ["#00338D", "#005EB8", "#0091DA", "#7FBCE8"],
      "show_legend": true,
      "show_data_labels": false
    }
  },
  "pdf": {
    "page": {
      "size": "A4",
      "orientation": "portrait",
      "margin_top_cm": 2.2,
      "margin_right_cm": 1.8,
      "margin_bottom_cm": 2.0,
      "margin_left_cm": 1.8
    },
    "font": {
      "family": "Helvetica",
      "cjk_family": "Source Han Sans",
      "body_size_pt": 10.5,
      "line_spacing": 1.25
    },
    "title": {
      "font_size_pt": 22,
      "bold": true,
      "color": "#00338D",
      "alignment": "left",
      "space_after_pt": 16,
      "bottom_rule_color": "#0091DA"
    },
    "heading_1": {
      "font_size_pt": 16,
      "bold": true,
      "color": "#00338D",
      "space_before_pt": 16,
      "space_after_pt": 8
    },
    "heading_2": {
      "font_size_pt": 13,
      "bold": true,
      "color": "#111827",
      "space_before_pt": 10,
      "space_after_pt": 6
    },
    "header": {
      "enabled": true,
      "left_text": "Aria",
      "right_text": "{{project_name}}",
      "font_size_pt": 8,
      "color": "#6B7280",
      "bottom_rule_color": "#D7DFEA"
    },
    "footer": {
      "enabled": true,
      "left_text": "Confidential",
      "show_page_number": true,
      "font_size_pt": 8,
      "color": "#6B7280",
      "top_rule_color": "#D7DFEA"
    }
  }
}
```

## 可优先修改的字段

- `brand.primary_color`：主色，当前为 KPMG deep blue 风格 `#00338D`。
- `brand.secondary_color` / `brand.accent_color`：中蓝和亮蓝，用于分隔线、强调条、图表辅助色。
- `brand.font_family` / `brand.cjk_font_family`：英文和中文默认字体。
- `docx.page` / `pdf.page`：页边距。
- `pptx.cover_slide.layout` / `pptx.content_slide.layout`：PPT 默认版式名称。
- `xlsx.header.fill`：Excel 表头颜色。
- `footer` / `header`：页眉页脚文案。

## 参考来源

- KPMG Global 官网首页的内容结构和视觉气质：深蓝、留白、洞察/行动导向的信息层级。
- 公开品牌色资料常见 KPMG 蓝系：`#00338D`、`#005EB8`、`#0091DA`。
