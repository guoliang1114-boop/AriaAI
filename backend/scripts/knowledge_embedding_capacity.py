#!/usr/bin/env python3
"""Measure semantic embedding memory and throughput with synthetic passages.

Runs in its own process after importing the full backend app, so its resident
memory approximates the PM2 backend during an ingestion job. No database,
business document, or provider configuration is touched; model cache files are
the only persistent writes. Prints only numbers.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PASSAGE_CHARS = 384


def _status_mb(field: str) -> float | None:
    """Linux /proc value in MB; None where unavailable (e.g. macOS dev hosts)."""

    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith(field + ":"):
                return round(int(line.split()[1]) / 1024, 1)
    except OSError:
        return None
    return None


def _host_memory_mb() -> dict[str, float | None]:
    values: dict[str, float | None] = {"total": None, "available": None}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, raw = line.split(":", 1)
            if key == "MemTotal":
                values["total"] = round(int(raw.split()[0]) / 1024, 1)
            elif key == "MemAvailable":
                values["available"] = round(int(raw.split()[0]) / 1024, 1)
    except OSError:
        pass
    return values


def synthetic_passages(count: int) -> list[str]:
    base = "知识库容量探针合成段落，用于测量本地语义模型的批量编码内存与耗时，不含业务内容。"
    return [(f"{index:04d} " + base * 10)[:PASSAGE_CHARS] for index in range(count)]


def measure(passage_count: int, batch_size: int) -> dict:
    stages: list[dict] = []

    def stage(name: str, started: float) -> None:
        stages.append({
            "stage": name,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "rss_mb": _status_mb("VmRSS"),
            "peak_rss_mb": _status_mb("VmHWM"),
        })

    started = time.perf_counter()
    import main  # noqa: F401  Full app import, matching the PM2 process.
    from app import config
    from app.services import knowledge_embeddings

    stage("app_import", started)
    config.KNOWLEDGE_EMBEDDING_PROVIDER = "fastembed"
    started = time.perf_counter()
    knowledge_embeddings.embed_texts(["容量探针预热"], query=True)
    stage("model_load", started)

    passages = synthetic_passages(passage_count)
    batch_ms: list[float] = []
    started = time.perf_counter()
    for offset in range(0, len(passages), batch_size):
        batch_started = time.perf_counter()
        knowledge_embeddings.embed_texts(passages[offset:offset + batch_size])
        batch_ms.append(round((time.perf_counter() - batch_started) * 1000, 1))
    stage("passage_embedding", started)
    return {
        "schema_version": 1,
        "synthetic": True,
        "content_included": False,
        "model": config.KNOWLEDGE_EMBEDDING_MODEL,
        "threads": config.KNOWLEDGE_EMBEDDING_THREADS,
        "cpu_count": os.cpu_count(),
        "passage_count": passage_count,
        "passage_chars": PASSAGE_CHARS,
        "batch_size": batch_size,
        "batch_ms_max": max(batch_ms) if batch_ms else None,
        "stages": stages,
        "host_memory_mb": _host_memory_mb(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--passages", type=int, default=150)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    print(json.dumps(measure(max(1, args.passages), max(1, args.batch_size))))
