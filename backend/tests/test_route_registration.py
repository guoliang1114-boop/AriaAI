from __future__ import annotations

from collections import Counter

import main


def test_http_route_signatures_are_registered_once() -> None:
    signatures = Counter(
        (
            tuple(sorted(getattr(route, "methods", set()) or set())),
            getattr(route, "path", ""),
        )
        for route in main.app.routes
    )

    duplicates = {
        signature: count
        for signature, count in signatures.items()
        if count > 1
    }
    assert duplicates == {}
    assert signatures[
        (
            ("POST",),
            "/projects/{project_id}/questions/{question_sha256}/remediation",
        )
    ] == 1
    assert signatures[
        (
            ("POST",),
            "/projects/{project_id}/questions/{question_sha256}/answer-adoption/prepare",
        )
    ] == 1
