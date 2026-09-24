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
    memory_audit = workflow.index(
        '"$PYTHON" scripts/memory_read_authority_report.py'
    )
    knowledge_audit = workflow.index(
        '"$PYTHON" scripts/knowledge_read_authority_report.py'
    )
    restart = workflow.index("pm2 delete ariaai-backend")

    assert backup < migration < memory_audit < knowledge_audit < restart


def test_remote_release_runs_this_contract_test() -> None:
    workflow = _workflow_text()

    assert "tests/test_deployment_workflow_contract.py" in workflow


def test_runner_installs_test_dependencies_before_product_contract_gate() -> None:
    workflow = _workflow_text()
    runner = workflow.split("- name: Deploy to Server", 1)[0]
    install = runner.index("-r requirements-test.txt")
    fixture = runner.index("python scripts/product_run_contract_fixture.py")
    test = runner.index("python -m pytest -q tests/test_product_run_contract.py")
    assert install < fixture < test


def test_provider_switch_serializes_preflight_backup_and_config_change() -> None:
    workflow = (REPOSITORY_ROOT / ".github/workflows/knowledge-provider-switch.yml").read_text()
    assert "group: production-database-maintenance" in workflow
    assert "cancel-in-progress: false" in workflow
    preflight = workflow.index("scripts/knowledge_retrieval_eval.py --semantic --enforce")
    backup = workflow.index('"$PYTHON" scripts/verified_postgres_backup.py')
    change = workflow.index('"$PYTHON" scripts/knowledge_provider_switch.py')
    assert preflight < backup < change
    assert "envs: ARIA_TARGET_PROVIDER,ARIA_RUN_TAG" in workflow
    remote = workflow.split("script: |", 1)[1]
    assert "${{ inputs.provider }}" not in remote
    assert "/reindex" not in remote


def test_semantic_eval_probes_embedding_capacity_without_business_writes() -> None:
    workflow = (REPOSITORY_ROOT / ".github/workflows/knowledge-semantic-eval.yml").read_text()
    assert "group: production-database-maintenance" in workflow
    assert "scripts/knowledge_embedding_capacity.py --passages 150" in workflow
    remote = workflow.split("script: |", 1)[1]
    assert "/reindex" not in remote
    assert "knowledge_provider_switch.py --provider" not in remote


def test_capacity_probe_uses_only_synthetic_passages() -> None:
    import sys

    sys.path.insert(0, str(REPOSITORY_ROOT / "backend"))
    from scripts.knowledge_embedding_capacity import PASSAGE_CHARS, synthetic_passages

    passages = synthetic_passages(3)
    assert len(passages) == 3
    assert all(len(item) == PASSAGE_CHARS for item in passages)
    assert len(set(passages)) == 3


def test_backend_memory_limit_leaves_room_for_local_semantic_indexing() -> None:
    # Full app + bge-small-zh + a 139-slide extraction peaks near 800 MB; the
    # former 512M limit made PM2 restart the backend mid-reindex.
    config = (REPOSITORY_ROOT / "backend/ecosystem.config.js").read_text()
    match = re.search(r'max_memory_restart:\s*"(\d+)M"', config)
    assert match is not None
    assert int(match.group(1)) >= 1536


if __name__ == "__main__":
    test_remote_release_command_has_headroom_for_the_release_gate()
    test_remote_release_keeps_backup_before_migration_and_restart()
    test_remote_release_runs_this_contract_test()
    test_runner_installs_test_dependencies_before_product_contract_gate()
    test_provider_switch_serializes_preflight_backup_and_config_change()
    test_semantic_eval_probes_embedding_capacity_without_business_writes()
    test_capacity_probe_uses_only_synthetic_passages()
    test_backend_memory_limit_leaves_room_for_local_semantic_indexing()
    print("deployment workflow contract passed")
