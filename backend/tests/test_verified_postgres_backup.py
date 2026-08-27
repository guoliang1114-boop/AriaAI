from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

from scripts import verified_postgres_backup as backup


def test_direct_script_entrypoint_can_import_backend_app() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/verified_postgres_backup.py"],
        cwd=Path(__file__).resolve().parents[1],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "BACKUP_PATH is required" in result.stderr
    assert "ModuleNotFoundError" not in result.stderr


def test_connection_arguments_keep_password_out_of_command() -> None:
    arguments, environment = backup._connection_args(
        "postgresql://aria:secret@db.example.com:5433/ariaai"
    )

    assert arguments == [
        "--host",
        "db.example.com",
        "--port",
        "5433",
        "--username",
        "aria",
        "--dbname",
        "ariaai",
    ]
    assert "secret" not in " ".join(arguments)
    assert environment["PGPASSWORD"] == "secret"


def test_verified_backup_checks_archive_and_returns_digest(tmp_path: Path) -> None:
    destination = tmp_path / "pre-deploy.dump"

    def fake_run(command, **_kwargs):
        if "--file" in command:
            output_path = Path(command[command.index("--file") + 1])
            output_path.write_bytes(b"verified-backup")
        return None

    with (
        patch.object(backup, "_postgres_server_major", return_value=15),
        patch.object(
            backup,
            "_compatible_clients",
            return_value=([(16, "/opt/postgres/bin/pg_dump")], []),
        ),
        patch.object(backup.os.path, "isfile", return_value=True),
        patch.object(backup.os, "access", return_value=True),
        patch.object(backup.subprocess, "run", side_effect=fake_run) as run_mock,
    ):
        result = backup.create_verified_backup(
            destination,
            "postgresql://aria:secret@db.example.com:5432/ariaai",
        )

    assert destination.read_bytes() == b"verified-backup"
    assert result["bytes"] == len(b"verified-backup")
    assert len(str(result["sha256"])) == 64
    assert result["client"] == "local:/opt/postgres/bin/pg_dump:v16"
    assert run_mock.call_count == 2


def test_verified_backup_refuses_to_overwrite(tmp_path: Path) -> None:
    destination = tmp_path / "existing.dump"
    destination.write_bytes(b"keep-me")

    try:
        backup.create_verified_backup(destination, "postgresql://unused")
    except RuntimeError as error:
        assert "Refusing to overwrite" in str(error)
    else:
        raise AssertionError("existing backup should have been rejected")

    assert destination.read_bytes() == b"keep-me"
