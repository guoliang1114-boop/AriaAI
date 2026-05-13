"""Tests for document text extraction parser."""
import unittest
from unittest.mock import MagicMock, patch, mock_open
from pathlib import Path

from app.services.parser import extract_text


class ExtractTextTestCase(unittest.TestCase):
    def test_unknown_extension_returns_empty(self):
        self.assertEqual(extract_text("/tmp/file.unknown"), "")

    def test_txt_file(self):
        m = mock_open(read_data="Hello, world!")
        with patch("pathlib.Path.open", m):
            result = extract_text("/tmp/hello.txt")
        self.assertEqual(result, "Hello, world!")

    @patch("pdfplumber.open")
    def test_pdf_extraction(self, mock_open):
        page1 = MagicMock()
        page1.extract_text.return_value = "Page one text"
        page2 = MagicMock()
        page2.extract_text.return_value = None
        page3 = MagicMock()
        page3.extract_text.return_value = "Page three text"

        pdf = MagicMock()
        pdf.pages = [page1, page2, page3]
        mock_open.return_value.__enter__ = lambda s: s
        mock_open.return_value.__exit__ = lambda *a: None
        mock_open.return_value.pages = pdf.pages

        result = extract_text("/tmp/doc.pdf")
        self.assertEqual(result, "Page one text\n\nPage three text")

    @patch("docx.Document")
    def test_docx_extraction(self, mock_document_class):
        para1 = MagicMock()
        para1.text = "First paragraph"
        para2 = MagicMock()
        para2.text = "   "
        para3 = MagicMock()
        para3.text = "Second paragraph"
        mock_doc = MagicMock()
        mock_doc.paragraphs = [para1, para2, para3]
        mock_document_class.return_value = mock_doc

        result = extract_text("/tmp/doc.docx")
        self.assertEqual(result, "First paragraph\nSecond paragraph")

    @patch("openpyxl.load_workbook")
    def test_xlsx_extraction(self, mock_load_workbook):
        sheet = MagicMock()
        sheet.iter_rows.return_value = [
            (1, "A", None),
            (None, 2, "B"),
            ("  ", None, None),
        ]
        wb = MagicMock()
        wb.worksheets = [sheet]
        mock_load_workbook.return_value = wb

        result = extract_text("/tmp/data.xlsx")
        self.assertEqual(result, "1\tA\n2\tB")

    def test_path_object_input(self):
        """extract_text should accept Path objects."""
        m = mock_open(read_data="path object")
        with patch("pathlib.Path.open", m):
            result = extract_text(Path("/tmp/test.txt"))
        self.assertEqual(result, "path object")
