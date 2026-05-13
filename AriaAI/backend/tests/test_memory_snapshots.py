"""Tests for memory_snapshots pure functions."""
import unittest

from app.services.memory_snapshots import (
    parse_snapshot_memory,
    build_memory_snapshot_diff,
    _value_kind,
    _list_delta,
    _stable_json,
)


class ParseSnapshotMemoryTestCase(unittest.TestCase):
    def test_valid_json(self):
        result = parse_snapshot_memory('{"key": "value"}')
        self.assertEqual(result, {"key": "value"})

    def test_none_returns_empty(self):
        result = parse_snapshot_memory(None)
        self.assertEqual(result, {})

    def test_empty_string_returns_empty(self):
        result = parse_snapshot_memory("")
        self.assertEqual(result, {})

    def test_invalid_json_raises(self):
        with self.assertRaises(ValueError):
            parse_snapshot_memory("not json")

    def test_nested_json(self):
        result = parse_snapshot_memory('{"a": {"b": [1, 2, 3]}}')
        self.assertEqual(result["a"]["b"], [1, 2, 3])


class ValueKindTestCase(unittest.TestCase):
    def test_list_kind(self):
        self.assertEqual(_value_kind([1, 2], [1, 2, 3]), "list")

    def test_dict_kind(self):
        self.assertEqual(_value_kind({"a": 1}, {"a": 2}), "object")

    def test_scalar_kind(self):
        self.assertEqual(_value_kind("old", "new"), "value")

    def test_none_to_value(self):
        self.assertEqual(_value_kind(None, "new"), "value")


class ListDeltaTestCase(unittest.TestCase):
    def test_removes_common_items(self):
        result = _list_delta(["a", "b", "c"], ["b"])
        self.assertEqual(result, ["a", "c"])

    def test_no_overlap(self):
        result = _list_delta(["a", "b"], ["c", "d"])
        self.assertEqual(result, ["a", "b"])

    def test_all_common(self):
        result = _list_delta(["a", "b"], ["a", "b"])
        self.assertEqual(result, [])

    def test_empty_source(self):
        result = _list_delta([], ["a"])
        self.assertEqual(result, [])


class StableJsonTestCase(unittest.TestCase):
    def test_deterministic(self):
        result1 = _stable_json({"b": 2, "a": 1})
        result2 = _stable_json({"a": 1, "b": 2})
        self.assertEqual(result1, result2)

    def test_contains_sorted_keys(self):
        result = _stable_json({"z": 1, "a": 2})
        self.assertIn('"a": 2', result)

    def test_handles_non_ascii(self):
        result = _stable_json({"key": "中文"})
        self.assertIn("中文", result)


class BuildMemorySnapshotDiffTestCase(unittest.TestCase):
    def test_no_changes(self):
        before = {"name": "Alice", "tags": ["a"]}
        after = {"name": "Alice", "tags": ["a"]}
        result = build_memory_snapshot_diff(before, after)
        self.assertEqual(result["summary"]["changed"], 0)

    def test_simple_value_change(self):
        before = {"name": "Alice"}
        after = {"name": "Bob"}
        result = build_memory_snapshot_diff(before, after)
        self.assertEqual(result["summary"]["changed"], 1)
        self.assertEqual(len(result["fields"]), 1)
        self.assertEqual(result["fields"][0]["field"], "name")

    def test_new_field(self):
        before = {"name": "Alice"}
        after = {"name": "Alice", "role": "CEO"}
        result = build_memory_snapshot_diff(before, after)
        self.assertEqual(result["summary"]["added"], 1)
        self.assertEqual(result["fields"][0]["field"], "role")

    def test_removed_field(self):
        before = {"name": "Alice", "role": "CEO"}
        after = {"name": "Alice"}
        result = build_memory_snapshot_diff(before, after)
        self.assertEqual(result["summary"]["removed"], 1)

    def test_list_changes(self):
        before = {"tags": ["a", "b", "c"]}
        after = {"tags": ["b", "d"]}
        result = build_memory_snapshot_diff(before, after)
        self.assertEqual(len(result["fields"]), 1)
        self.assertIn("added", result["fields"][0])
        self.assertIn("removed", result["fields"][0])

    def test_ignored_fields(self):
        before = {"name": "Alice", "updated_at": "2024-01-01"}
        after = {"name": "Bob", "updated_at": "2024-06-01"}
        result = build_memory_snapshot_diff(before, after, ignored_fields={"updated_at"})
        self.assertEqual(result["summary"]["changed"], 1)
        self.assertEqual(result["fields"][0]["field"], "name")

    def test_empty_dicts(self):
        result = build_memory_snapshot_diff({}, {})
        self.assertEqual(result["summary"]["changed"], 0)
        self.assertEqual(result["summary"]["added"], 0)
        self.assertEqual(result["summary"]["removed"], 0)
