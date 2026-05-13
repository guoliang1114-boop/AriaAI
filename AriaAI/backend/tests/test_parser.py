"""Tests for parser service — extract_text from various file types."""
import unittest
import tempfile
import os
from pathlib import Path

from app.services.parser import extract_text


class ExtractTextTestCase(unittest.TestCase):
    def test_txt_file(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write("Hello world\nSecond line")
            path = f.name
        try:
            result = extract_text(path)
            self.assertIn('Hello world', result)
            self.assertIn('Second line', result)
        finally:
            os.unlink(path)

    def test_md_file_returns_empty(self):
        """Parser only handles pdf/docx/xlsx/txt — md returns empty."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False, encoding='utf-8') as f:
            f.write("# Title\n\nParagraph text")
            path = f.name
        try:
            result = extract_text(path)
            self.assertEqual(result, "")
        finally:
            os.unlink(path)

    def test_csv_file_returns_empty(self):
        """Parser only handles pdf/docx/xlsx/txt — csv returns empty."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, encoding='utf-8') as f:
            f.write('name,age\nAlice,30\nBob,25')
            path = f.name
        try:
            result = extract_text(path)
            self.assertEqual(result, "")
        finally:
            os.unlink(path)

    def test_json_file_returns_empty(self):
        """Parser only handles pdf/docx/xlsx/txt — json returns empty."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            f.write('{"key": "value"}')
            path = f.name
        try:
            result = extract_text(path)
            self.assertEqual(result, "")
        finally:
            os.unlink(path)

    def test_unsupported_returns_empty(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.xyz', delete=False) as f:
            f.write("data")
            path = f.name
        try:
            result = extract_text(path)
            self.assertEqual(result, "")
        finally:
            os.unlink(path)

    def test_path_object(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write("Path object test")
            path = Path(f.name)
        try:
            result = extract_text(path)
            self.assertIn('Path object test', result)
        finally:
            os.unlink(path)
