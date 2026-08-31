from __future__ import annotations

import re
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_WORKFLOW = REPOSITORY_ROOT / ".github" / "workflows" / "deploy.yml"


def _workflow_text() -> str:
    return DEPLOY_WORKFLOW.read_text(encoding="utf-8")


def test_remote_release_command_has_headroom_for_the_release_gate() -> None:
    workflow = _workflow_text()
    remote_step = workflow.split("- name: Execute Remote Deployment", 1)[1]
    remote_step = remote_step.split("- name: Notify Success", 1)[0]

    timeout_match = re.search(r"^\s+command_timeout:\s*(\d+)m\s*$", remote_step, re.MULTILINE)

    assert timeout_match is not None
    assert int(timeout_match.group(1)) >= 20


def test_remote_release_keeps_backup_before_migration_and_restart() -> None:
    workflow = _workflow_text()
    backup = workflow.index('"$PYTHON" scripts/verified_postgres_backup.py')
    migration = workflow.index('"$PYTHON" scripts/migration_governance.py upgrade')
    restart = workflow.index("pm2 delete ariaai-backend")

    assert backup < migration < restart


def test_remote_release_runs_this_contract_test() -> None:
    workflow = _workflow_text()

    assert "tests/test_deployment_workflow_contract.py" in workflow
