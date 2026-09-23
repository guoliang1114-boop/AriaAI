import io
from unittest.mock import Mock

from dotenv import dotenv_values
import pytest

from scripts import knowledge_provider_switch as switch


@pytest.fixture
def operator(tmp_path, monkeypatch):
    backend = tmp_path / "backend"
    backend.mkdir()
    env = backend / ".env"
    env.write_text("# retained\nDATABASE_URL='postgresql://private:secret@db/aria'\nOTHER=\"x y\"\n")
    monkeypatch.delenv(switch.KEY, raising=False)
    monkeypatch.setattr(switch, "_process", Mock(return_value={"pid": 1, "pm2_env": {"env": {}}}))
    monkeypatch.setattr(switch, "_restart", Mock())
    monkeypatch.setattr(switch, "_healthy", Mock(return_value={"pid": 2, "rss_bytes": 100}))
    return backend, env, tmp_path / "backups" / "private.env"


def test_switch_preserves_settings_and_private_original(operator):
    backend, env, backup = operator
    original = env.read_bytes()
    before = dotenv_values(env)
    report = switch.switch_provider("fastembed", backup, backend_root=backend)
    assert dotenv_values(env) == {**before, switch.KEY: "fastembed"}
    assert "# retained" in env.read_text()
    assert backup.read_bytes() == original
    assert backup.stat().st_mode & 0o777 == 0o600
    assert env.stat().st_mode & 0o777 == 0o600
    assert report["previous_provider"] == "hash"
    assert report["provider"] == "fastembed"
    assert report["business_jobs_enqueued"] == 0
    assert "secret" not in str(report)
    switch._healthy.assert_called_once_with(1)


def test_explicit_hash_rollback(operator):
    backend, env, backup = operator
    env.write_text(env.read_text() + f"{switch.KEY}=fastembed\n")
    report = switch.switch_provider("hash", backup, backend_root=backend)
    assert report["previous_provider"] == "fastembed"
    assert dotenv_values(env)[switch.KEY] == "hash"


def test_failed_health_restores_exact_configuration(operator):
    backend, env, backup = operator
    original = env.read_bytes()
    switch._healthy.side_effect = [RuntimeError("private diagnostic"), {"pid": 3}]
    with pytest.raises(switch.SwitchError, match="previous configuration restored"):
        switch.switch_provider("fastembed", backup, backend_root=backend)
    assert env.read_bytes() == original == backup.read_bytes()
    assert switch._restart.call_count == 2


def test_failed_restart_still_rolls_back_when_process_is_missing(operator):
    backend, env, backup = operator
    original = env.read_bytes()
    switch._restart.side_effect = [RuntimeError("restart failed"), None]
    switch._process.side_effect = [{"pid": 1, "pm2_env": {}}, RuntimeError("not running")]
    with pytest.raises(switch.SwitchError, match="previous configuration restored"):
        switch.switch_provider("fastembed", backup, backend_root=backend)
    assert env.read_bytes() == original
    assert switch._restart.call_count == 2


def test_incomplete_rollback_is_reported(operator):
    backend, env, backup = operator
    original = env.read_bytes()
    switch._healthy.side_effect = RuntimeError("private failure")
    with pytest.raises(switch.SwitchError, match="rollback incomplete"):
        switch.switch_provider("fastembed", backup, backend_root=backend)
    assert env.read_bytes() == original == backup.read_bytes()


def test_rollback_preserves_intervening_operator_changes(operator):
    backend, env, backup = operator
    def failure(_):
        env.write_text("NEW_OPERATOR_VALUE=preserve\n")
        raise RuntimeError("unhealthy")
    switch._healthy.side_effect = failure
    with pytest.raises(switch.SwitchError, match="rollback incomplete"):
        switch.switch_provider("fastembed", backup, backend_root=backend)
    assert env.read_text() == "NEW_OPERATOR_VALUE=preserve\n"
    assert switch._restart.call_count == 1
    assert backup.is_file()


@pytest.mark.parametrize("environment", [
    {switch.KEY: "hash"}, {"env": {switch.KEY: "fastembed"}},
])
def test_pm2_override_refused_before_configuration_change(operator, environment):
    backend, env, backup = operator
    original = env.read_bytes()
    switch._process.return_value = {"pid": 1, "pm2_env": environment}
    with pytest.raises(switch.SwitchError, match="environment override"):
        switch.switch_provider("fastembed", backup, backend_root=backend)
    assert env.read_bytes() == original
    assert not backup.exists()
    switch._restart.assert_not_called()


def test_shell_override_refused(operator, monkeypatch):
    backend, _, backup = operator
    monkeypatch.setenv(switch.KEY, "hash")
    with pytest.raises(switch.SwitchError, match="environment override"):
        switch.switch_provider("fastembed", backup, backend_root=backend)


def test_existing_backup_is_never_overwritten(operator):
    backend, env, backup = operator
    original = env.read_bytes()
    backup.parent.mkdir()
    backup.write_bytes(b"earlier backup")
    with pytest.raises(FileExistsError):
        switch.switch_provider("fastembed", backup, backend_root=backend)
    assert env.read_bytes() == original
    assert backup.read_bytes() == b"earlier backup"
    switch._restart.assert_not_called()


@pytest.mark.parametrize("provider", ["other", "fastembed; rm", ""])
def test_invalid_provider_is_rejected(operator, provider):
    backend, _, backup = operator
    with pytest.raises(switch.SwitchError, match="Unsupported provider"):
        switch.switch_provider(provider, backup, backend_root=backend)
    switch._process.assert_not_called()


def test_replace_refuses_intervening_change_and_cleans_staging(operator):
    backend, env, _ = operator
    original = env.read_bytes()
    with pytest.raises(switch.SwitchError, match="changed concurrently"):
        switch._replace(env, b"different", b"replacement")
    assert env.read_bytes() == original
    assert list(backend.glob(".knowledge-provider-*")) == []


def test_main_error_does_not_print_private_diagnostic(operator, monkeypatch, capsys):
    monkeypatch.setattr(switch.sys, "argv", ["switch", "--provider", "hash", "--backup-path", "unused"])
    monkeypatch.setattr(switch, "switch_provider", Mock(side_effect=RuntimeError("password=private")))
    assert switch.main() == 1
    assert "password=private" not in capsys.readouterr().err


def test_health_requires_new_pid_and_online_process(monkeypatch):
    process = Mock(side_effect=[
        {"pid": 1, "pm2_env": {"status": "online"}},
        {"pid": 2, "pm2_env": {"status": "launching"}},
        {"pid": 2, "pm2_env": {"status": "online"}, "monit": {"memory": 123}},
    ])
    response = io.StringIO('{"status":"ok"}')
    response.status = 200
    urlopen = Mock(return_value=response)
    monkeypatch.setattr(switch, "_process", process)
    monkeypatch.setattr(switch, "urlopen", urlopen)
    monkeypatch.setattr(switch.time, "sleep", Mock())
    assert switch._healthy(1) == {"pid": 2, "rss_bytes": 123}
    assert process.call_count == 3
    urlopen.assert_called_once()


def test_health_does_not_accept_an_unhealthy_service(monkeypatch):
    monkeypatch.setattr(switch, "_process", Mock(return_value={"pid": 2, "pm2_env": {"status": "online"}}))
    monkeypatch.setattr(switch, "urlopen", Mock(side_effect=OSError("unavailable")))
    monkeypatch.setattr(switch.time, "sleep", Mock())
    with pytest.raises(switch.SwitchError, match="did not become healthy"):
        switch._healthy(1)
