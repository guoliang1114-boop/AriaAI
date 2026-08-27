#!/usr/bin/env python3
"""Create and verify a production PostgreSQL backup before deployment.

The destination must be supplied explicitly through ``BACKUP_PATH``. Database
credentials are read from Aria's existing ``DATABASE_URL`` configuration and
are never printed or written to a temporary command file.
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

# Direct script execution sets ``sys.path[0]`` to ``backend/scripts`` rather
# than the backend package root. Keep this operational entry point equivalent
# to ``python -m scripts.verified_postgres_backup`` so production deployment
# can import Aria's configuration reliably.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import DATABASE_URL


def _postgres_server_major(database_url: str) -> int:
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            version_number = int(
                connection.execute(text("SHOW server_version_num")).scalar_one()
            )
    finally:
        engine.dispose()
    return version_number // 10_000


def _compatible_clients(server_major: int) -> tuple[list[tuple[int, str]], list[str]]:
    candidate_paths = set(
        glob.glob("/usr/lib/postgresql/*/bin/pg_dump")
        + glob.glob("/usr/pgsql-*/bin/pg_dump")
        + glob.glob("/www/server/pgsql*/bin/pg_dump")
        + glob.glob("/www/server/pgsql/*/bin/pg_dump")
        + glob.glob("/opt/pgsql*/bin/pg_dump")
    )
    default_pg_dump = shutil.which("pg_dump")
    if default_pg_dump:
        candidate_paths.add(default_pg_dump)
    for process_executable in glob.glob("/proc/[0-9]*/exe"):
        try:
            resolved = Path(process_executable).resolve()
        except OSError:
            continue
        if resolved.name.startswith("postgres"):
            candidate_paths.add(str(resolved.parent / "pg_dump"))

    compatible: list[tuple[int, str]] = []
    discovered: list[str] = []
    for candidate in sorted(candidate_paths):
        if not os.path.isfile(candidate) or not os.access(candidate, os.X_OK):
            continue
        result = subprocess.run(
            [candidate, "--version"],
            check=False,
            capture_output=True,
            text=True,
        )
        version_text = (result.stdout or result.stderr).strip()
        match = re.search(r"(\d+)(?:\.\d+)?", version_text)
        if not match:
            continue
        client_major = int(match.group(1))
        discovered.append(f"{candidate}:{client_major}")
        if client_major >= server_major:
            compatible.append((client_major, candidate))
    return compatible, discovered


def _connection_args(database_url: str) -> tuple[list[str], dict[str, str]]:
    url = make_url(database_url)
    environment = os.environ.copy()
    if url.password:
        environment["PGPASSWORD"] = url.password
    arguments: list[str] = []
    if url.host:
        arguments.extend(["--host", url.host])
    if url.port:
        arguments.extend(["--port", str(url.port)])
    if url.username:
        arguments.extend(["--username", url.username])
    if url.database:
        arguments.extend(["--dbname", url.database])
    return arguments, environment


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as backup_file:
        for chunk in iter(lambda: backup_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_verified_backup(backup_path: Path, database_url: str) -> dict[str, object]:
    if backup_path.exists():
        raise RuntimeError(f"Refusing to overwrite existing backup: {backup_path}")
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(backup_path.parent, 0o700)

    server_major = _postgres_server_major(database_url)
    compatible, discovered = _compatible_clients(server_major)
    connection_args, client_environment = _connection_args(database_url)
    try:
        if compatible:
            client_major, pg_dump = sorted(compatible)[-1]
            pg_restore = str(Path(pg_dump).with_name("pg_restore"))
            if not os.path.isfile(pg_restore) or not os.access(pg_restore, os.X_OK):
                raise RuntimeError(f"Matching pg_restore not found beside {pg_dump}")
            subprocess.run(
                [
                    pg_dump,
                    *connection_args,
                    "--format=custom",
                    "--no-owner",
                    "--no-acl",
                    "--file",
                    str(backup_path),
                ],
                env=client_environment,
                check=True,
            )
            subprocess.run(
                [pg_restore, "--list", str(backup_path)],
                check=True,
                stdout=subprocess.DEVNULL,
            )
            backup_client = f"local:{pg_dump}:v{client_major}"
        else:
            docker = shutil.which("docker")
            if not docker:
                raise RuntimeError(
                    "No PostgreSQL client compatible with server "
                    f"v{server_major}; discovered={discovered}"
                )
            url = make_url(database_url)
            docker_environment = ["--env", "PGPASSWORD"] if url.password else []
            image = f"postgres:{server_major}"
            with backup_path.open("wb") as backup_file:
                subprocess.run(
                    [
                        docker,
                        "run",
                        "--rm",
                        "--network",
                        "host",
                        *docker_environment,
                        image,
                        "pg_dump",
                        *connection_args,
                        "--format=custom",
                        "--no-owner",
                        "--no-acl",
                    ],
                    env=client_environment,
                    check=True,
                    stdout=backup_file,
                )
            with backup_path.open("rb") as backup_file:
                subprocess.run(
                    [docker, "run", "--rm", "-i", image, "pg_restore", "--list"],
                    check=True,
                    stdin=backup_file,
                    stdout=subprocess.DEVNULL,
                )
            backup_client = f"docker:{image}"

        if backup_path.stat().st_size <= 0:
            raise RuntimeError("PostgreSQL backup is empty")
        os.chmod(backup_path, 0o600)
        return {
            "path": str(backup_path),
            "bytes": backup_path.stat().st_size,
            "sha256": _sha256(backup_path),
            "server_major": server_major,
            "client": backup_client,
        }
    except BaseException:
        backup_path.unlink(missing_ok=True)
        raise


def main() -> None:
    raw_path = os.getenv("BACKUP_PATH", "").strip()
    if not raw_path:
        raise SystemExit("BACKUP_PATH is required")
    result = create_verified_backup(Path(raw_path), DATABASE_URL)
    print(f"Production backup verified: {json.dumps(result, sort_keys=True)}")


if __name__ == "__main__":
    main()
