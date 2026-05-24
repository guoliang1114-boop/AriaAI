#!/usr/bin/env python3
"""Aria command-line client.

This CLI talks to the same FastAPI backend used by the web app. It is intended
as a thin automation layer for the website's core capabilities, not a separate
business-logic implementation.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx


DEFAULT_BASE_URL = "http://localhost:8000"
CONFIG_PATH = Path(os.getenv("ARIA_CLI_CONFIG", "~/.aria-cli.json")).expanduser()


class CliError(RuntimeError):
    pass


def _load_config() -> dict[str, Any]:
    if not CONFIG_PATH.is_file():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_config(data: dict[str, Any]) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        CONFIG_PATH.chmod(0o600)
    except OSError:
        pass


def _base_url(args: argparse.Namespace) -> str:
    config = _load_config()
    return (
        getattr(args, "base_url", None)
        or os.getenv("ARIA_API_URL")
        or config.get("base_url")
        or DEFAULT_BASE_URL
    ).rstrip("/")


def _api_prefixed_url(url: str) -> str:
    clean = url.rstrip("/")
    if clean.endswith("/api"):
        return clean
    return f"{clean}/api"


def _token(args: argparse.Namespace) -> str:
    config = _load_config()
    token = getattr(args, "token", None) or os.getenv("ARIA_AUTH_TOKEN") or config.get("token") or ""
    if getattr(args, "no_auth", False):
        return ""
    return token


def _client(args: argparse.Namespace) -> httpx.Client:
    headers = {"Accept": "application/json"}
    token = _token(args)
    if token:
        headers["X-Auth-Token"] = token
    return httpx.Client(base_url=_base_url(args), headers=headers, timeout=getattr(args, "timeout", 60.0))


def _print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def _print_table(rows: list[dict[str, Any]], columns: list[str]) -> None:
    if not rows:
        print("(empty)")
        return
    widths = {
        column: max(len(column), *(len(str(row.get(column, ""))) for row in rows))
        for column in columns
    }
    print("  ".join(column.ljust(widths[column]) for column in columns))
    print("  ".join("-" * widths[column] for column in columns))
    for row in rows:
        print("  ".join(str(row.get(column, "")).ljust(widths[column]) for column in columns))


def _parse_json_value(raw: str | None, *, default: Any = None) -> Any:
    if raw is None:
        return default
    if raw == "-":
        raw = sys.stdin.read()
    if raw.startswith("@"):
        raw = Path(raw[1:]).read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CliError(f"Invalid JSON: {exc}") from exc


def _read_text_arg(value: str | None) -> str:
    if not value:
        return ""
    if value == "-":
        return sys.stdin.read()
    path = Path(value)
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return value


def _request(
    args: argparse.Namespace,
    method: str,
    path: str,
    *,
    json_body: Any = None,
    params: dict[str, Any] | None = None,
    files: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> Any:
    with _client(args) as client:
        response = client.request(method, path, json=json_body, params=params, files=files, data=data)
    if response.status_code >= 400:
        detail = response.text
        try:
            detail = json.dumps(response.json(), ensure_ascii=False)
        except Exception:
            pass
        raise CliError(f"{method} {path} failed: HTTP {response.status_code} {detail}")
    if not response.content:
        return None
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return response.json()
    return response.text


def _show(args: argparse.Namespace, data: Any, *, columns: list[str] | None = None) -> None:
    if getattr(args, "json", False) or columns is None or not isinstance(data, list):
        _print_json(data)
    else:
        _print_table(data, columns)


def cmd_config(args: argparse.Namespace) -> None:
    config = _load_config()
    if args.config_action == "show":
        shown = dict(config)
        if shown.get("token"):
            shown["token"] = shown["token"][:8] + "..."
        _print_json(shown)
        return
    if args.config_action == "set":
        if args.base_url_value:
            config["base_url"] = args.base_url_value.rstrip("/")
        if args.token_value:
            config["token"] = args.token_value
        _save_config(config)
        print(f"Saved config to {CONFIG_PATH}")
        return
    raise CliError("Unknown config action")


def cmd_login(args: argparse.Namespace) -> None:
    password = args.password or getpass.getpass("Password: ")
    body = {"email": args.email, "password": password}
    try:
        result = _request(args, "POST", "/auth/login", json_body=body)
        login_base_url = _base_url(args)
    except CliError as exc:
        base_url = _base_url(args)
        should_retry_with_api_prefix = (
            not base_url.rstrip("/").endswith("/api")
            and "HTTP 405" in str(exc)
            and "<center><h1>405 Not Allowed</h1></center>" in str(exc)
        )
        if not should_retry_with_api_prefix:
            raise
        retry_args = argparse.Namespace(**vars(args))
        retry_args.base_url = _api_prefixed_url(base_url)
        result = _request(retry_args, "POST", "/auth/login", json_body=body)
        login_base_url = retry_args.base_url
    config = _load_config()
    config["base_url"] = login_base_url
    config["token"] = result["token"]
    _save_config(config)
    user = result.get("user") or {}
    print(f"Logged in as {user.get('email', args.email)}")


def cmd_me(args: argparse.Namespace) -> None:
    _print_json(_request(args, "GET", "/auth/me"))


def cmd_logout(args: argparse.Namespace) -> None:
    _print_json(_request(args, "POST", "/auth/logout"))
    config = _load_config()
    config.pop("token", None)
    _save_config(config)


def cmd_projects(args: argparse.Namespace) -> None:
    if args.projects_action == "list":
        params = {}
        if args.status:
            params["status"] = args.status
        data = _request(args, "GET", "/projects", params=params)
        _show(args, data, columns=["id", "name", "client", "status", "contract_amount"])
    elif args.projects_action == "show":
        _print_json(_request(args, "GET", f"/projects/{args.project_id}"))
    elif args.projects_action == "detail":
        _print_json(_request(args, "GET", f"/projects/{args.project_id}/detail"))
    elif args.projects_action == "create":
        body = {
            "name": args.name,
            "client": args.client,
            "description": args.description or "",
            "status": args.status or "lead",
            "contract_amount": args.contract_amount or 0.0,
        }
        _print_json(_request(args, "POST", "/projects", json_body=body))
    elif args.projects_action == "update":
        body = {k: v for k, v in {
            "name": args.name,
            "client": args.client,
            "description": args.description,
            "status": args.status,
            "contract_amount": args.contract_amount,
        }.items() if v is not None}
        _print_json(_request(args, "PATCH", f"/projects/{args.project_id}", json_body=body))
    else:
        raise CliError("Unknown projects action")


def cmd_files(args: argparse.Namespace) -> None:
    base = f"/projects/{args.project_id}"
    if args.files_action == "list":
        data = _request(args, "GET", f"{base}/files")
        _show(args, data, columns=["id", "name", "file_type", "folder_id", "size_bytes", "origin"])
    elif args.files_action == "upload":
        path = Path(args.path)
        if not path.is_file():
            raise CliError(f"File not found: {path}")
        with path.open("rb") as fh:
            files = {"file": (path.name, fh, "application/octet-stream")}
            form = {}
            if args.folder_id is not None:
                form["folder_id"] = str(args.folder_id)
            data = _request(args, "POST", f"{base}/files", files=files, data=form)
        _print_json(data)
    elif args.files_action == "delete":
        _print_json(_request(args, "DELETE", f"{base}/files/{args.file_id}"))
    else:
        raise CliError("Unknown files action")


def cmd_folders(args: argparse.Namespace) -> None:
    base = f"/projects/{args.project_id}/folders"
    if args.folders_action == "list":
        data = _request(args, "GET", base)
        _show(args, data, columns=["id", "name", "sort_order"])
    elif args.folders_action == "create":
        _print_json(_request(args, "POST", base, json_body={"name": args.name, "sort_order": args.sort_order}))
    elif args.folders_action == "delete":
        _print_json(_request(args, "DELETE", f"{base}/{args.folder_id}"))
    else:
        raise CliError("Unknown folders action")


def cmd_todos(args: argparse.Namespace) -> None:
    base = f"/projects/{args.project_id}/todos"
    if args.todos_action == "list":
        data = _request(args, "GET", base)
        _show(args, data, columns=["id", "content", "is_done", "due_date", "assigned_to_user_id"])
    elif args.todos_action == "create":
        _print_json(_request(args, "POST", base, json_body={"content": args.content, "due_date": args.due_date}))
    elif args.todos_action == "done":
        _print_json(_request(args, "PATCH", f"{base}/{args.todo_id}", json_body={"is_done": True}))
    elif args.todos_action == "delete":
        _print_json(_request(args, "DELETE", f"{base}/{args.todo_id}"))
    else:
        raise CliError("Unknown todos action")


def cmd_milestones(args: argparse.Namespace) -> None:
    base = f"/projects/{args.project_id}/milestones"
    if args.milestones_action == "list":
        data = _request(args, "GET", base)
        _show(args, data, columns=["id", "title", "is_done", "priority", "due_date"])
    elif args.milestones_action == "create":
        body = {"title": args.title, "priority": args.priority, "due_date": args.due_date}
        _print_json(_request(args, "POST", base, json_body=body))
    elif args.milestones_action == "done":
        _print_json(_request(args, "PATCH", f"{base}/{args.milestone_id}", json_body={"is_done": True}))
    elif args.milestones_action == "delete":
        _print_json(_request(args, "DELETE", f"{base}/{args.milestone_id}"))
    else:
        raise CliError("Unknown milestones action")


def cmd_financials(args: argparse.Namespace) -> None:
    base = f"/projects/{args.project_id}/financials"
    if args.financials_action == "list":
        _print_json(_request(args, "GET", base))
    elif args.financials_action == "add":
        body = {"amount": args.amount, "payment_date": args.date, "note": args.note or "", "payment_type": args.type}
        _print_json(_request(args, "POST", base, json_body=body))
    elif args.financials_action == "delete":
        _print_json(_request(args, "DELETE", f"{base}/{args.payment_id}"))
    else:
        raise CliError("Unknown financials action")


def cmd_memory(args: argparse.Namespace) -> None:
    base = f"/projects/{args.project_id}/memory"
    if args.memory_action == "get":
        _print_json(_request(args, "GET", base))
    elif args.memory_action == "rebuild":
        _print_json(_request(args, "POST", f"{base}/rebuild"))
    elif args.memory_action == "summaries":
        _print_json(_request(args, "GET", f"{base}/summaries"))
    elif args.memory_action == "generate-summaries":
        body = {"force_refresh": args.force, "language": args.language}
        _print_json(_request(args, "POST", f"{base}/summaries/generate", json_body=body))
    else:
        raise CliError("Unknown memory action")


def cmd_briefing(args: argparse.Namespace) -> None:
    base = f"/projects/{args.project_id}/briefing"
    if args.briefing_action == "get":
        _print_json(_request(args, "GET", base))
    elif args.briefing_action == "refine":
        body = {"meeting_type": args.meeting_type, "language": args.language, "force_refresh": args.force}
        _print_json(_request(args, "POST", f"{base}/refine", json_body=body))
    else:
        raise CliError("Unknown briefing action")


def cmd_clients(args: argparse.Namespace) -> None:
    if args.clients_action == "list":
        data = _request(args, "GET", "/clients")
        _show(args, data, columns=["id", "name", "industry", "contact"])
    elif args.clients_action == "show":
        _print_json(_request(args, "GET", f"/clients/{args.client_id}"))
    elif args.clients_action == "create":
        body = {"name": args.name, "industry": args.industry or "", "contact": args.contact or "", "notes": args.notes or ""}
        _print_json(_request(args, "POST", "/clients", json_body=body))
    elif args.clients_action == "projects":
        _print_json(_request(args, "GET", f"/clients/{args.client_id}/projects"))
    else:
        raise CliError("Unknown clients action")


def cmd_skills(args: argparse.Namespace) -> None:
    if args.skills_action == "list":
        params = {"category": args.category} if args.category else None
        data = _request(args, "GET", "/skills", params=params)
        _show(args, data, columns=["id", "name", "category", "estimated_time"])
    elif args.skills_action == "show":
        _print_json(_request(args, "GET", f"/skills/{args.skill_id}"))
    elif args.skills_action == "tools":
        _print_json(_request(args, "GET", "/skills/tools/available"))
    elif args.skills_action == "seed-pro":
        _print_json(_request(args, "POST", "/skills/seed-pro"))
    elif args.skills_action == "run":
        skill_id = _resolve_skill_id(args, args.skill)
        _send_chat(args, content=_read_text_arg(args.message), project_id=args.project_id, skill_id=skill_id, force_skill=True)
    else:
        raise CliError("Unknown skills action")


def _resolve_skill_id(args: argparse.Namespace, value: str) -> int:
    if value.isdigit():
        return int(value)
    skills = _request(args, "GET", "/skills")
    matches = [skill for skill in skills if skill.get("name") == value]
    if not matches:
        partial = [skill for skill in skills if value.lower() in skill.get("name", "").lower()]
        matches = partial
    if len(matches) != 1:
        names = ", ".join(skill.get("name", "") for skill in matches[:10])
        raise CliError(f"Could not uniquely resolve skill '{value}'. Matches: {names or 'none'}")
    return int(matches[0]["id"])


def _send_chat(
    args: argparse.Namespace,
    *,
    content: str,
    project_id: int | None = None,
    skill_id: int | None = None,
    conversation_id: int | None = None,
    force_skill: bool = False,
) -> None:
    payload = {
        "content": content,
        "project_id": project_id,
        "skill_id": skill_id,
        "conversation_id": conversation_id,
        "force_skill": force_skill,
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    headers = {"Accept": "text/event-stream"}
    token = _token(args)
    if token:
        headers["X-Auth-Token"] = token
    with httpx.Client(base_url=_base_url(args), headers=headers, timeout=None) as client:
        with client.stream("POST", "/chat/send", json=payload) as response:
            if response.status_code >= 400:
                raise CliError(f"POST /chat/send failed: HTTP {response.status_code} {response.text}")
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                if event.get("type") == "text":
                    print(event.get("content", ""), end="", flush=True)
                elif event.get("type") == "error":
                    print("", file=sys.stderr)
                    raise CliError(event.get("message", "Chat failed"))
                elif event.get("type") == "done":
                    if not getattr(args, "quiet", False):
                        print()
                        print(json.dumps(event, ensure_ascii=False))


def cmd_chat(args: argparse.Namespace) -> None:
    if args.chat_action == "send":
        _send_chat(
            args,
            content=_read_text_arg(args.message),
            project_id=args.project_id,
            skill_id=args.skill_id,
            conversation_id=args.conversation_id,
            force_skill=args.force_skill,
        )
    elif args.chat_action == "conversations":
        params = {"standalone": args.standalone}
        if args.project_id is not None:
            params["project_id"] = args.project_id
        data = _request(args, "GET", "/chat/conversations", params=params)
        _show(args, data, columns=["id", "title", "project_id", "skill_id", "updated_at"])
    elif args.chat_action == "messages":
        params = {"limit": args.limit}
        _print_json(_request(args, "GET", f"/chat/conversations/{args.conversation_id}/messages", params=params))
    else:
        raise CliError("Unknown chat action")


def cmd_settings(args: argparse.Namespace) -> None:
    if args.settings_action == "list":
        _print_json(_request(args, "GET", "/settings/"))
    elif args.settings_action == "get":
        _print_json(_request(args, "GET", f"/settings/{args.key}"))
    elif args.settings_action == "set":
        _print_json(_request(args, "PUT", f"/settings/{args.key}", json_body={"value": args.value}))
    elif args.settings_action == "metadata":
        _print_json(_request(args, "GET", "/settings/metadata"))
    else:
        raise CliError("Unknown settings action")


def cmd_api(args: argparse.Namespace) -> None:
    body = _parse_json_value(args.body, default=None)
    params = dict(item.split("=", 1) for item in args.query or [])
    data = _request(args, args.method.upper(), args.path, json_body=body, params=params or None)
    _print_json(data)


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--base-url", help=f"API base URL. Default: {DEFAULT_BASE_URL}")
    parser.add_argument("--token", help="Auth token. Defaults to ARIA_AUTH_TOKEN or saved config.")
    parser.add_argument("--no-auth", action="store_true", help="Do not send auth token.")
    parser.add_argument("--timeout", type=float, default=60.0, help="HTTP timeout in seconds.")
    parser.add_argument("--json", action="store_true", help="Print full JSON instead of compact tables where available.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aria", description="CLI for Aria website capabilities.")
    _add_common(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    config = sub.add_parser("config", help="Show or update CLI config.")
    config_sub = config.add_subparsers(dest="config_action", required=True)
    config_sub.add_parser("show")
    config_set = config_sub.add_parser("set")
    config_set.add_argument("--base-url", dest="base_url_value")
    config_set.add_argument("--token", dest="token_value")
    config.set_defaults(func=cmd_config)

    auth = sub.add_parser("auth", help="Authentication.")
    auth_sub = auth.add_subparsers(dest="auth_action", required=True)
    login = auth_sub.add_parser("login")
    login.add_argument("--email", required=True)
    login.add_argument("--password")
    login.set_defaults(func=cmd_login)
    auth_sub.add_parser("me").set_defaults(func=cmd_me)
    auth_sub.add_parser("logout").set_defaults(func=cmd_logout)

    projects = sub.add_parser("projects", help="Project CRUD and detail.")
    projects_sub = projects.add_subparsers(dest="projects_action", required=True)
    plist = projects_sub.add_parser("list")
    plist.add_argument("--status")
    plist.set_defaults(func=cmd_projects)
    for name in ("show", "detail"):
        p = projects_sub.add_parser(name)
        p.add_argument("project_id", type=int)
        p.set_defaults(func=cmd_projects)
    pcreate = projects_sub.add_parser("create")
    pcreate.add_argument("--name", required=True)
    pcreate.add_argument("--client", required=True)
    pcreate.add_argument("--description")
    pcreate.add_argument("--status")
    pcreate.add_argument("--contract-amount", type=float)
    pcreate.set_defaults(func=cmd_projects)
    pupdate = projects_sub.add_parser("update")
    pupdate.add_argument("project_id", type=int)
    pupdate.add_argument("--name")
    pupdate.add_argument("--client")
    pupdate.add_argument("--description")
    pupdate.add_argument("--status")
    pupdate.add_argument("--contract-amount", type=float)
    pupdate.set_defaults(func=cmd_projects)

    files = sub.add_parser("files", help="Project files.")
    files_sub = files.add_subparsers(dest="files_action", required=True)
    flist = files_sub.add_parser("list")
    flist.add_argument("--project-id", type=int, required=True)
    flist.set_defaults(func=cmd_files)
    fupload = files_sub.add_parser("upload")
    fupload.add_argument("--project-id", type=int, required=True)
    fupload.add_argument("--path", required=True)
    fupload.add_argument("--folder-id", type=int)
    fupload.set_defaults(func=cmd_files)
    fdelete = files_sub.add_parser("delete")
    fdelete.add_argument("--project-id", type=int, required=True)
    fdelete.add_argument("--file-id", type=int, required=True)
    fdelete.set_defaults(func=cmd_files)

    folders = sub.add_parser("folders", help="Project folders.")
    folders_sub = folders.add_subparsers(dest="folders_action", required=True)
    for name in ("list",):
        p = folders_sub.add_parser(name)
        p.add_argument("--project-id", type=int, required=True)
        p.set_defaults(func=cmd_folders)
    fcreate = folders_sub.add_parser("create")
    fcreate.add_argument("--project-id", type=int, required=True)
    fcreate.add_argument("--name", required=True)
    fcreate.add_argument("--sort-order", type=int, default=0)
    fcreate.set_defaults(func=cmd_folders)
    fdel = folders_sub.add_parser("delete")
    fdel.add_argument("--project-id", type=int, required=True)
    fdel.add_argument("--folder-id", type=int, required=True)
    fdel.set_defaults(func=cmd_folders)

    todos = sub.add_parser("todos", help="Project todos.")
    todos_sub = todos.add_subparsers(dest="todos_action", required=True)
    tlist = todos_sub.add_parser("list")
    tlist.add_argument("--project-id", type=int, required=True)
    tlist.set_defaults(func=cmd_todos)
    tcreate = todos_sub.add_parser("create")
    tcreate.add_argument("--project-id", type=int, required=True)
    tcreate.add_argument("--content", required=True)
    tcreate.add_argument("--due-date")
    tcreate.set_defaults(func=cmd_todos)
    tdone = todos_sub.add_parser("done")
    tdone.add_argument("--project-id", type=int, required=True)
    tdone.add_argument("--todo-id", type=int, required=True)
    tdone.set_defaults(func=cmd_todos)
    tdelete = todos_sub.add_parser("delete")
    tdelete.add_argument("--project-id", type=int, required=True)
    tdelete.add_argument("--todo-id", type=int, required=True)
    tdelete.set_defaults(func=cmd_todos)

    milestones = sub.add_parser("milestones", help="Project milestones.")
    milestones_sub = milestones.add_subparsers(dest="milestones_action", required=True)
    mlist = milestones_sub.add_parser("list")
    mlist.add_argument("--project-id", type=int, required=True)
    mlist.set_defaults(func=cmd_milestones)
    mcreate = milestones_sub.add_parser("create")
    mcreate.add_argument("--project-id", type=int, required=True)
    mcreate.add_argument("--title", required=True)
    mcreate.add_argument("--priority", default="medium")
    mcreate.add_argument("--due-date")
    mcreate.set_defaults(func=cmd_milestones)
    mdone = milestones_sub.add_parser("done")
    mdone.add_argument("--project-id", type=int, required=True)
    mdone.add_argument("--milestone-id", type=int, required=True)
    mdone.set_defaults(func=cmd_milestones)
    mdelete = milestones_sub.add_parser("delete")
    mdelete.add_argument("--project-id", type=int, required=True)
    mdelete.add_argument("--milestone-id", type=int, required=True)
    mdelete.set_defaults(func=cmd_milestones)

    financials = sub.add_parser("financials", help="Project financials.")
    financials_sub = financials.add_subparsers(dest="financials_action", required=True)
    finlist = financials_sub.add_parser("list")
    finlist.add_argument("--project-id", type=int, required=True)
    finlist.set_defaults(func=cmd_financials)
    finadd = financials_sub.add_parser("add")
    finadd.add_argument("--project-id", type=int, required=True)
    finadd.add_argument("--amount", type=float, required=True)
    finadd.add_argument("--date", required=True)
    finadd.add_argument("--note")
    finadd.add_argument("--type", default="received")
    finadd.set_defaults(func=cmd_financials)
    findel = financials_sub.add_parser("delete")
    findel.add_argument("--project-id", type=int, required=True)
    findel.add_argument("--payment-id", type=int, required=True)
    findel.set_defaults(func=cmd_financials)

    memory = sub.add_parser("memory", help="Project memory.")
    memory_sub = memory.add_subparsers(dest="memory_action", required=True)
    for name in ("get", "rebuild", "summaries"):
        p = memory_sub.add_parser(name)
        p.add_argument("--project-id", type=int, required=True)
        p.set_defaults(func=cmd_memory)
    mgenerate = memory_sub.add_parser("generate-summaries")
    mgenerate.add_argument("--project-id", type=int, required=True)
    mgenerate.add_argument("--force", action="store_true")
    mgenerate.add_argument("--language")
    mgenerate.set_defaults(func=cmd_memory)

    briefing = sub.add_parser("briefing", help="Project briefing.")
    briefing_sub = briefing.add_subparsers(dest="briefing_action", required=True)
    bget = briefing_sub.add_parser("get")
    bget.add_argument("--project-id", type=int, required=True)
    bget.set_defaults(func=cmd_briefing)
    brefine = briefing_sub.add_parser("refine")
    brefine.add_argument("--project-id", type=int, required=True)
    brefine.add_argument("--meeting-type", default="status")
    brefine.add_argument("--language")
    brefine.add_argument("--force", action="store_true")
    brefine.set_defaults(func=cmd_briefing)

    clients = sub.add_parser("clients", help="Clients.")
    clients_sub = clients.add_subparsers(dest="clients_action", required=True)
    clients_sub.add_parser("list").set_defaults(func=cmd_clients)
    cshow = clients_sub.add_parser("show")
    cshow.add_argument("client_id", type=int)
    cshow.set_defaults(func=cmd_clients)
    ccreate = clients_sub.add_parser("create")
    ccreate.add_argument("--name", required=True)
    ccreate.add_argument("--industry")
    ccreate.add_argument("--contact")
    ccreate.add_argument("--notes")
    ccreate.set_defaults(func=cmd_clients)
    cprojects = clients_sub.add_parser("projects")
    cprojects.add_argument("client_id", type=int)
    cprojects.set_defaults(func=cmd_clients)

    skills = sub.add_parser("skills", help="Skills.")
    skills_sub = skills.add_subparsers(dest="skills_action", required=True)
    slist = skills_sub.add_parser("list")
    slist.add_argument("--category")
    slist.set_defaults(func=cmd_skills)
    sshow = skills_sub.add_parser("show")
    sshow.add_argument("skill_id", type=int)
    sshow.set_defaults(func=cmd_skills)
    skills_sub.add_parser("tools").set_defaults(func=cmd_skills)
    skills_sub.add_parser("seed-pro").set_defaults(func=cmd_skills)
    srun = skills_sub.add_parser("run")
    srun.add_argument("skill")
    srun.add_argument("--message", required=True, help="Message text, '-' for stdin, or path to a text file.")
    srun.add_argument("--project-id", type=int)
    srun.add_argument("--quiet", action="store_true")
    srun.set_defaults(func=cmd_skills)

    chat = sub.add_parser("chat", help="Chat.")
    chat_sub = chat.add_subparsers(dest="chat_action", required=True)
    csend = chat_sub.add_parser("send")
    csend.add_argument("--message", required=True, help="Message text, '-' for stdin, or path to a text file.")
    csend.add_argument("--project-id", type=int)
    csend.add_argument("--skill-id", type=int)
    csend.add_argument("--conversation-id", type=int)
    csend.add_argument("--force-skill", action="store_true")
    csend.add_argument("--quiet", action="store_true")
    csend.set_defaults(func=cmd_chat)
    cconvs = chat_sub.add_parser("conversations")
    cconvs.add_argument("--project-id", type=int)
    cconvs.add_argument("--standalone", action="store_true")
    cconvs.set_defaults(func=cmd_chat)
    cmessages = chat_sub.add_parser("messages")
    cmessages.add_argument("conversation_id", type=int)
    cmessages.add_argument("--limit", type=int, default=30)
    cmessages.set_defaults(func=cmd_chat)

    settings = sub.add_parser("settings", help="Settings.")
    settings_sub = settings.add_subparsers(dest="settings_action", required=True)
    settings_sub.add_parser("list").set_defaults(func=cmd_settings)
    settings_sub.add_parser("metadata").set_defaults(func=cmd_settings)
    sget = settings_sub.add_parser("get")
    sget.add_argument("key")
    sget.set_defaults(func=cmd_settings)
    sset = settings_sub.add_parser("set")
    sset.add_argument("key")
    sset.add_argument("value")
    sset.set_defaults(func=cmd_settings)

    api = sub.add_parser("api", help="Raw API escape hatch for any website endpoint.")
    api.add_argument("method")
    api.add_argument("path")
    api.add_argument("--body", help="JSON string, @file, or '-' for stdin.")
    api.add_argument("--query", action="append", help="Query parameter as key=value. Can repeat.")
    api.set_defaults(func=cmd_api)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
        return 0
    except CliError as exc:
        print(f"aria: {exc}", file=sys.stderr)
        return 1
    except httpx.RequestError as exc:
        print(f"aria: request failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
