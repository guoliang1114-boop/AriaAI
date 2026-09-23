#!/usr/bin/env python3
"""Switch the deployed knowledge provider, retaining a private rollback copy.

This operator tool changes only .env and restarts the existing PM2 process.
It never enqueues business jobs; reindexing belongs to the native API.
"""
from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

from dotenv import dotenv_values, set_key

KEY = "KNOWLEDGE_EMBEDDING_PROVIDER"
PROCESS = "ariaai-backend"
BACKEND_ROOT = Path(__file__).resolve().parents[1]


class SwitchError(RuntimeError):
    """Stable diagnostics only; never include command output or configuration."""


def _process() -> dict:
    result = subprocess.run(
        ["pm2", "jlist"], check=True, capture_output=True, text=True, timeout=20,
    )
    matches = [item for item in json.loads(result.stdout) if item.get("name") == PROCESS]
    if len(matches) != 1 or not matches[0].get("pid"):
        raise SwitchError("Expected one running backend process")
    return matches[0]


def _restart() -> None:
    subprocess.run(
        ["pm2", "restart", PROCESS], check=True, capture_output=True, timeout=45,
    )


def _healthy(previous_pid: int) -> dict:
    for _ in range(30):
        try:
            process = _process()
            if process["pid"] != previous_pid and process["pm2_env"]["status"] == "online":
                with urlopen("http://127.0.0.1:8000/health", timeout=3) as response:
                    if response.status == 200 and json.load(response).get("status") == "ok":
                        return {"pid": process["pid"], "rss_bytes": process.get("monit", {}).get("memory")}
        except Exception:
            pass
        time.sleep(2)
    raise SwitchError("Backend did not become healthy after restart")


def _replace(path: Path, expected: bytes, replacement: bytes) -> None:
    """Stage privately, preserve ownership, and refuse to overwrite intervening edits."""
    stat = path.stat()
    fd, temporary = tempfile.mkstemp(prefix=".knowledge-provider-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(replacement)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temporary, stat.st_uid, stat.st_gid)
        if path.read_bytes() != expected:
            raise SwitchError("Configuration changed concurrently; refusing overwrite")
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def switch_provider(provider: str, backup_path: Path, *, backend_root: Path = BACKEND_ROOT) -> dict:
    if provider not in {"hash", "fastembed"}:
        raise SwitchError("Unsupported provider")
    env_path = backend_root / ".env"
    if env_path.is_symlink() or not env_path.is_file():
        raise SwitchError("Expected a regular backend .env file")
    process = _process()
    process_env = process.get("pm2_env", {})
    # PM2 retains inherited variables across restart. Refuse an override rather
    # than report success for a .env value that the backend would ignore.
    if KEY in process_env or KEY in process_env.get("env", {}) or KEY in os.environ:
        raise SwitchError("Provider environment override must be removed before switching")
    original = env_path.read_bytes()
    values = dotenv_values(stream=io.StringIO(original.decode("utf-8")), interpolate=False)
    previous = str(values.get(KEY, "hash")).strip().lower()
    if previous not in {"hash", "fastembed"}:
        raise SwitchError("Existing provider is invalid")
    backup_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(backup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(original)
        stream.flush()
        os.fsync(stream.fileno())
    # Use dotenv's own serializer on a private staging file, never on live .env.
    fd, staged_name = tempfile.mkstemp(prefix=".knowledge-provider-", dir=backend_root)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(original)
        set_key(staged_name, KEY, provider)
        changed = Path(staged_name).read_bytes()
    finally:
        Path(staged_name).unlink(missing_ok=True)
    _replace(env_path, original, changed)
    try:
        _restart()
        health = _healthy(process["pid"])
    except Exception as exc:
        try:
            _replace(env_path, changed, original)
            try:
                failed_pid = _process()["pid"]
            except Exception:
                failed_pid = process["pid"]
            _restart()
            _healthy(failed_pid)
        except Exception:
            raise SwitchError("Switch failed; automatic rollback incomplete; private backup retained") from None
        raise SwitchError("Switch failed; previous configuration restored and backend healthy") from exc
    return {"previous_provider": previous, "provider": provider, "health": health,
            "config_backup": str(backup_path), "business_jobs_enqueued": 0}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", required=True, choices=("hash", "fastembed"))
    parser.add_argument("--backup-path", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = switch_provider(args.provider, args.backup_path)
    except SwitchError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        print("Provider switch failed; inspect private server state", file=sys.stderr)
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
