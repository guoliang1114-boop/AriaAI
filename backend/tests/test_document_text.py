"""Tests for document_text service — text extraction from various file formats."""
import unittest
import tempfile
import os
from pathlib import Path

from app.services.document_text import extract_text_from_file
from app.services.document_text import DocumentExtractionError
from tests.knowledge_document_fixtures import document_bytes
import pytest


@pytest.mark.parametrize("kind", ["pdf", "docx", "pptx", "xlsx"])
def test_complete_extraction_preserves_tables_groups_notes_and_late_pages(tmp_path, kind):
    content, markers = document_bytes(kind)
    path = tmp_path / f"source.{kind}"
    path.write_bytes(content)
    text = extract_text_from_file(path, kind, max_chars=200_000, require_complete=True)
    assert all(marker in text for marker in markers)
    if kind == "pdf": assert text.count("[Page ") == 16
    if kind == "pptx": assert text.count("[Slide ") == 2
    if kind == "docx":
        assert text.index("Before the delivery table") < text.index(markers[0]) < text.index(markers[1]) < text.index("After the delivery table")


@pytest.mark.parametrize("kind", ["pdf", "xlsx"])
def test_preview_limits_remain_bounded(tmp_path, kind):
    content, markers = document_bytes(kind)
    path = tmp_path / f"preview.{kind}"
    path.write_bytes(content)
    assert markers[0] not in extract_text_from_file(path, kind, max_chars=200_000)


@pytest.mark.parametrize("case", ["missing", "corrupt", "unsupported", "oversized"])
def test_complete_extraction_refuses_error_and_truncation_placeholders(tmp_path, case):
    path = tmp_path / "private-source.docx"
    if case != "missing": path.write_text("private content" * 20)
    kind = "docx" if case in {"missing", "corrupt"} else "unknown" if case == "unsupported" else "txt"
    with pytest.raises(DocumentExtractionError) as error:
        extract_text_from_file(path, kind, max_chars=100, require_complete=True)
    assert "private" not in str(error.value)


def test_word_merged_cells_are_not_repeated(tmp_path):
    from docx import Document
    doc = Document()
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).merge(table.cell(1, 1)).text = "MERGEDORION"
    path = tmp_path / "merged.docx"
    doc.save(path)
    assert extract_text_from_file(path, "docx", require_complete=True).count("MERGEDORION") == 1


@pytest.mark.parametrize("kind", ["pdf", "pptx"])
def test_blank_pages_are_not_source_evidence(tmp_path, kind):
    path = tmp_path / f"empty.{kind}"
    if kind == "pdf":
        from reportlab.pdfgen.canvas import Canvas
        canvas = Canvas(str(path)); canvas.showPage(); canvas.save()
    else:
        from pptx import Presentation
        deck = Presentation(); deck.slides.add_slide(deck.slide_layouts[6]); deck.save(path)
    assert extract_text_from_file(path, kind, require_complete=True) == ""


class ExtractTextFromTxtTestCase(unittest.TestCase):
    def test_extracts_plain_text(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write("Hello world\nSecond line")
            path = Path(f.name)
        try:
            result = extract_text_from_file(path, 'txt')
            self.assertIn('Hello world', result)
            self.assertIn('Second line', result)
        finally:
            os.unlink(path)

    def test_truncates_at_max_chars(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write("A" * 5000)
            path = Path(f.name)
        try:
            result = extract_text_from_file(path, 'txt', max_chars=100)
            self.assertLessEqual(len(result), 150)
            self.assertIn('truncated', result)
        finally:
            os.unlink(path)

    def test_returns_empty_placeholder_for_empty_file(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write("")
            path = Path(f.name)
        try:
            result = extract_text_from_file(path, 'txt', empty_placeholder='[EMPTY]')
            self.assertEqual(result, '[EMPTY]')
        finally:
            os.unlink(path)

    def test_nonexistent_file_returns_not_found(self):
        result = extract_text_from_file(Path('/nonexistent/file.txt'), 'txt')
        self.assertIn('not found', result.lower())

    def test_unsupported_type_returns_placeholder(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.xyz', delete=False) as f:
            f.write("data")
            path = Path(f.name)
        try:
            result = extract_text_from_file(path, 'xyz', unsupported_placeholder='[UNSUPPORTED]')
            self.assertEqual(result, '[UNSUPPORTED]')
        finally:
            os.unlink(path)

    def test_error_prefix_on_exception(self):
        result = extract_text_from_file(Path('/nonexistent'), 'txt', error_prefix='[ERR] ')
        self.assertTrue(result.startswith('[ERR]') or 'not found' in result.lower())


class ExtractTextFromJsonTestCase(unittest.TestCase):
    def test_extracts_json(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            f.write('{"key": "value", "number": 42}')
            path = Path(f.name)
        try:
            result = extract_text_from_file(path, 'json')
            self.assertIn('key', result)
            self.assertIn('value', result)
        finally:
            os.unlink(path)


class ExtractTextFromCsvTestCase(unittest.TestCase):
    def test_extracts_csv(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, encoding='utf-8') as f:
            f.write('name,age\nAlice,30\nBob,25')
            path = Path(f.name)
        try:
            result = extract_text_from_file(path, 'csv')
            self.assertIn('Alice', result)
            self.assertIn('Bob', result)
        finally:
            os.unlink(path)


class ExtractTextFromMarkdownTestCase(unittest.TestCase):
    def test_extracts_markdown(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False, encoding='utf-8') as f:
            f.write('# Title\n\nSome **bold** text')
            path = Path(f.name)
        try:
            result = extract_text_from_file(path, 'md')
            self.assertIn('Title', result)
            self.assertIn('bold', result)
        finally:
            os.unlink(path)


class ExtractTextFromDocxTestCase(unittest.TestCase):
    def test_extracts_docx(self):
        from docx import Document
        with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as f:
            path = Path(f.name)
        try:
            doc = Document()
            doc.add_paragraph("First paragraph")
            doc.add_paragraph("Second paragraph")
            doc.save(str(path))
            result = extract_text_from_file(path, 'docx')
            self.assertIn('First paragraph', result)
            self.assertIn('Second paragraph', result)
        finally:
            os.unlink(path)


class ExtractTextFromXlsxTestCase(unittest.TestCase):
    def test_extracts_xlsx(self):
        import openpyxl
        with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as f:
            path = Path(f.name)
        try:
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "TestData"
            ws.append(["Name", "Age"])
            ws.append(["Alice", 30])
            wb.save(str(path))
            wb.close()
            result = extract_text_from_file(path, 'xlsx')
            self.assertIn('TestData', result)
            self.assertIn('Alice', result)
        finally:
            os.unlink(path)


class ExtractTextFromPptxTestCase(unittest.TestCase):
    def test_extracts_pptx(self):
        from pptx import Presentation
        from pptx.util import Inches
        with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as f:
            path = Path(f.name)
        try:
            prs = Presentation()
            slide = prs.slides.add_slide(prs.slide_layouts[1])
            slide.shapes.title.text = "Slide Title"
            prs.save(str(path))
            result = extract_text_from_file(path, 'pptx')
            self.assertIn('Slide Title', result)
        finally:
            os.unlink(path)


class ExtractTextErrorHandlingTestCase(unittest.TestCase):
    def test_error_returns_empty_without_prefix(self):
        result = extract_text_from_file(Path('/nonexistent/file.txt'), 'txt')
        self.assertIn('not found', result.lower())

    def test_error_returns_with_prefix(self):
        result = extract_text_from_file(Path('/nonexistent/file.txt'), 'txt', error_prefix='ERR: ')
        self.assertTrue('not found' in result.lower() or result.startswith('ERR'))


if __name__ == "__main__":
    unittest.main()
