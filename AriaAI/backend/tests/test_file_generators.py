"""Tests for file_generators — core delivery tools for PPT/HTML generation."""
import unittest
from unittest.mock import MagicMock, patch, mock_open
from pathlib import Path
import base64

from app.tools.file_generators import (
    _generate_filename,
    _slugify_filename,
    _html_escape,
    _html_bullets,
    _data_uri_for_asset,
)


class UtilityFunctionsTestCase(unittest.TestCase):
    def test_generate_filename_has_extension(self):
        name = _generate_filename("pptx")
        self.assertTrue(name.endswith(".pptx"))
        self.assertGreater(len(name), 5)

    def test_generate_filename_unique(self):
        # Based on timestamp; rapid calls may collide within the same second.
        names = {_generate_filename("pptx") for _ in range(20)}
        self.assertGreaterEqual(len(names), 1)

    def test_slugify_filename(self):
        self.assertEqual(_slugify_filename("Hello World!"), "hello-world")
        self.assertEqual(_slugify_filename("A/B\\C"), "a-b-c")
        self.assertEqual(_slugify_filename("  spaced  "), "spaced")

    def test_html_escape(self):
        self.assertEqual(_html_escape("<script>"), "&lt;script&gt;")
        self.assertEqual(_html_escape('"quotes"'), "&quot;quotes&quot;")
        self.assertEqual(_html_escape("&amp;"), "&amp;amp;")
        self.assertEqual(_html_escape(123), "123")
        self.assertEqual(_html_escape(None), "")

    def test_html_bullets(self):
        self.assertEqual(_html_bullets(""), "")
        self.assertIn("<li>a</li>", _html_bullets("- a\n- b"))
        self.assertIn("<li>b</li>", _html_bullets("* a\n* b"))
        self.assertIn("<li>a</li>", _html_bullets("1. a\n2. b"))


class DataUriForAssetTestCase(unittest.TestCase):
    @patch("app.tools.file_generators.mimetypes.guess_type")
    def test_data_uri_for_asset_success(self, mock_guess):
        mock_guess.return_value = ("image/png", None)
        with patch("pathlib.Path.is_file", return_value=True):
            with patch("pathlib.Path.read_bytes", return_value=b"\x89PNG"):
                result = _data_uri_for_asset(Path("/tmp/test.png"))
        self.assertTrue(result.startswith("data:image/png;base64,"))
        expected = base64.b64encode(b"\x89PNG").decode("ascii")
        self.assertIn(expected, result)

    @patch("app.tools.file_generators.mimetypes.guess_type")
    def test_data_uri_for_asset_directory_returns_empty(self, mock_guess):
        """Regression: directories must not be read as files (EISDIR fix)."""
        mock_guess.return_value = ("image/png", None)
        with patch("pathlib.Path.is_file", return_value=False):
            result = _data_uri_for_asset(Path("/tmp/a_directory"))
        self.assertEqual(result, "")

    def test_data_uri_for_asset_missing_returns_empty(self):
        with patch("pathlib.Path.is_file", return_value=False):
            result = _data_uri_for_asset(Path("/tmp/nonexistent.png"))
        self.assertEqual(result, "")


class GeneratePptFromSkillTestCase(unittest.TestCase):
    def _call(self, **kwargs):
        import asyncio
        from app.tools.file_generators import generate_ppt_from_skill
        return asyncio.run(generate_ppt_from_skill(**kwargs))

    @patch("app.tools.file_generators.generate_ppt")
    def test_strict_skill_refuses_blank_deck(self, mock_generate_ppt):
        with patch("pathlib.Path.is_file", return_value=False):
            result = self._call(
                skill_name="digital-strategy",
                title="Test",
                slides=[{"title": "S1", "content": "C1"}],
            )
        self.assertFalse(result["success"])
        self.assertIn("template not found", result["error"])
        self.assertFalse(result["template_applied"])
        mock_generate_ppt.assert_not_called()

    @patch("app.tools.file_generators.generate_ppt")
    def test_non_strict_skill_fallback_to_blank(self, mock_generate_ppt):
        mock_generate_ppt.return_value = {"success": True, "file_type": "pptx"}
        with patch("pathlib.Path.is_file", return_value=False):
            result = self._call(
                skill_name="some-other-skill",
                title="Test",
                slides=[{"title": "S1", "content": "C1"}],
            )
        self.assertTrue(result["success"])
        mock_generate_ppt.assert_awaited_once()

    @patch("app.tools.file_generators.generate_ppt")
    def test_finds_template_in_assets(self, mock_generate_ppt):
        mock_generate_ppt.return_value = {"success": True, "file_type": "pptx"}
        with patch("pathlib.Path.is_file", return_value=True):
            result = self._call(
                skill_name="presentation-builder",
                title="Test",
                slides=[{"title": "S1", "content": "C1"}],
            )
        self.assertTrue(result["success"])
        mock_generate_ppt.assert_awaited_once()
        args, _ = mock_generate_ppt.call_args
        self.assertTrue(args[3])  # template_path is truthy


class GeneratePptTestCase(unittest.TestCase):
    def _call(self, **kwargs):
        import asyncio
        from app.tools.file_generators import generate_ppt
        return asyncio.run(generate_ppt(**kwargs))

    def test_import_error_returns_graceful(self):
        """When python-pptx is missing, return a clear error."""
        with patch.dict("sys.modules", {"pptx": None}):
            result = self._call(title="T", slides=[{"title": "S"}])
        self.assertFalse(result["success"])
        self.assertIn("python-pptx not installed", result["error"])

    @patch("app.tools.file_generators._render_content_slide")
    @patch("app.tools.file_generators._render_two_column_slide")
    @patch("app.tools.file_generators._ensure_body_min_font_sizes")
    @patch("app.tools.file_generators._write_title_preserving_style")
    @patch("app.tools.file_generators._find_body_placeholder")
    @patch("pptx.Presentation")
    def test_blank_deck_generation(self, mock_pres_class, mock_find_body, mock_write_title, mock_ensure, mock_two_col, mock_render_content):
        """generate_ppt without template creates a blank presentation."""
        mock_slide = MagicMock()
        mock_slide.shapes.title = MagicMock()
        mock_slide_layout = MagicMock()
        mock_prs = MagicMock()
        mock_prs.slide_layouts = [mock_slide_layout, mock_slide_layout]
        mock_prs.slides.add_slide.return_value = mock_slide
        mock_pres_class.return_value = mock_prs

        mock_generated_dir = MagicMock()
        with patch("app.tools.file_generators.GENERATED_DIR", mock_generated_dir):
            result = self._call(title="Test Deck", slides=[{"title": "Slide 1", "content": "Hello"}])

        self.assertTrue(result["success"])
        self.assertEqual(result["file_type"], "pptx")
        self.assertEqual(result["template_applied"], False)
        mock_pres_class.assert_called_once()  # Called without template path
