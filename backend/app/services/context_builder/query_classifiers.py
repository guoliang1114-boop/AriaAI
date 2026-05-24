"""Query classifiers for context builder."""

from sqlmodel import Session, select

from app.models.db import Project, ClientRecord


def _normalize_client_match_text(value: str) -> str:
    return "".join(str(value or "").lower().split())


def is_client_project_portfolio_query(content: str) -> bool:
    text = _normalize_client_match_text(content)
    if not text:
        return False
    all_project_markers = (
        "\u5168\u90e8\u9879\u76ee",
        "\u6240\u6709\u9879\u76ee",
        "\u5168\u90e8\u7684\u9879\u76ee",
        "\u6240\u6709\u7684\u9879\u76ee",
        "全部项目",
        "所有项目",
        "全部的项目",
        "所有的项目",
        "全部项目",
        "所有项目",
        "全部的项目",
        "所有的项目",
        "allprojects",
        "allproject",
        "projectportfolio",
        "portfolio",
    )
    summary_markers = (
        "\u9879\u76ee\u60c5\u51b5",
        "\u9879\u76ee\u72b6\u6001",
        "\u9879\u76ee\u98ce\u9669",
        "\u60c5\u51b5\u53ca\u98ce\u9669",
        "\u60c5\u51b5\u548c\u98ce\u9669",
        "\u603b\u7ed3",
        "\u6c47\u603b",
        "\u98ce\u9669",
        "项目情况",
        "项目状态",
        "项目风险",
        "情况及风险",
        "情况和风险",
        "总结",
        "汇总",
        "风险",
        "项目情况",
        "项目状态",
        "项目风险",
        "情况及风险",
        "总结",
        "汇总",
        "风险",
        "summary",
        "summarize",
        "risk",
        "risks",
    )
    return any(marker in text for marker in all_project_markers) and any(marker in text for marker in summary_markers)


def is_workspace_project_inventory_query(content: str) -> bool:
    text = _normalize_client_match_text(content)
    if not text:
        return False
    all_project_markers = (
        "\u5168\u90e8\u9879\u76ee",
        "\u6240\u6709\u9879\u76ee",
        "\u5168\u90e8\u7684\u9879\u76ee",
        "\u6240\u6709\u7684\u9879\u76ee",
        "\u5168\u91cf\u9879\u76ee",
        "\u6240\u670921\u4e2a\u9879\u76ee",
        "\u6240\u670922\u4e2a\u9879\u76ee",
        "全部项目",
        "所有项目",
        "全部的项目",
        "所有的项目",
        "全量项目",
        "所有21个项目",
        "所有22个项目",
        "allprojects",
        "allproject",
        "entireprojectportfolio",
        "workspaceprojects",
    )
    summary_markers = (
        "\u9879\u76ee\u60c5\u51b5",
        "\u9879\u76ee\u72b6\u6001",
        "\u9879\u76ee\u98ce\u9669",
        "\u60c5\u51b5\u53ca\u98ce\u9669",
        "\u60c5\u51b5\u548c\u98ce\u9669",
        "\u9879\u76ee\u6e05\u5355",
        "\u9879\u76ee\u5217\u8868",
        "\u603b\u7ed3",
        "\u6c47\u603b",
        "\u98ce\u9669",
        "项目情况",
        "项目状态",
        "项目风险",
        "情况及风险",
        "情况和风险",
        "项目清单",
        "项目列表",
        "总结",
        "汇总",
        "风险",
        "summary",
        "summarize",
        "inventory",
        "status",
        "risk",
        "risks",
    )
    return any(marker in text for marker in all_project_markers) and any(marker in text for marker in summary_markers)


def _is_project_review_query(content: str) -> bool:
    text = _normalize_client_match_text(content)
    if not text:
        return False
    project_markers = (
        "\u9879\u76ee",
        "project",
        "projects",
    )
    review_markers = (
        "\u60c5\u51b5",
        "\u72b6\u6001",
        "\u98ce\u9669",
        "\u603b\u7ed3",
        "\u6c47\u603b",
        "\u6e05\u5355",
        "\u5217\u8868",
        "summary",
        "summarize",
        "status",
        "risk",
        "risks",
        "inventory",
    )
    return any(marker in text for marker in project_markers) and any(marker in text for marker in review_markers)


def _find_client_name_in_query(session: Session, content: str) -> str:
    query_text = _normalize_client_match_text(content)
    if not query_text:
        return ""

    client_names: set[str] = set()
    for client in session.exec(select(Project.client).where(Project.client != "")).all():
        if client:
            client_names.add(client.strip())
    for name in session.exec(select(ClientRecord.name).where(ClientRecord.name != "")).all():
        if name:
            client_names.add(name.strip())

    matches = [
        name
        for name in client_names
        if _normalize_client_match_text(name) and _normalize_client_match_text(name) in query_text
    ]
    if not matches:
        return ""
    return max(matches, key=len)
