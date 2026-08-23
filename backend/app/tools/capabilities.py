"""Versioned capability manifests for Aria tools.

The registry-owned metadata and fail-closed duplicate/unknown behavior are
Python adaptations of OpenAI Codex's ``codex-rs/core/src/tools/registry.rs``
and ``codex-rs/core/src/tools/router.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: the manifest describes domain-level side
effects, ActionPolicy requirements, scheduling, retry behavior, project scope,
result semantics, and Product Run Event mapping. It does not import, start, or
communicate with a Codex runtime.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType
from typing import Any, Mapping


TOOL_CAPABILITY_MANIFEST_VERSION = 1
_ACTION_POLICIES = frozenset(
    {
        "direct_answer",
        "read_only_tool",
        "write_artifact",
        "modify_existing_file",
        "durable_task",
        "destructive_action",
    }
)


class ToolEffect(str, Enum):
    READ = "read"
    CREATE = "create"
    MODIFY = "modify"
    DELETE = "delete"
    EXTERNAL = "external"


class ToolRetryMode(str, Enum):
    NEVER = "never"
    TRANSIENT_READ = "transient_read"
    ARTIFACT = "artifact"


class ToolResultKind(str, Enum):
    DATA = "data"
    ARTIFACT = "artifact"
    MUTATION = "mutation"


class ToolProductEvent(str, Enum):
    TOOL_PROGRESS = "tool_progress"
    ARTIFACT_READY = "artifact_ready"


@dataclass(frozen=True)
class ToolOperationCapability:
    """Execution semantics for one resolved tool operation."""

    required_policy: str
    effect: ToolEffect
    result_kind: ToolResultKind = ToolResultKind.DATA
    retry_mode: ToolRetryMode = ToolRetryMode.NEVER
    parallel_safe: bool = False
    product_event: ToolProductEvent = ToolProductEvent.TOOL_PROGRESS

    def __post_init__(self) -> None:
        if self.required_policy not in _ACTION_POLICIES:
            raise ValueError(f"invalid tool required_policy: {self.required_policy!r}")
        if self.parallel_safe and self.effect is not ToolEffect.READ:
            raise ValueError("only read-only tool operations may be parallel-safe")
        if self.retry_mode is ToolRetryMode.TRANSIENT_READ and self.effect is not ToolEffect.READ:
            raise ValueError("transient-read retry requires a read-only operation")
        if self.retry_mode is ToolRetryMode.ARTIFACT and self.result_kind is not ToolResultKind.ARTIFACT:
            raise ValueError("artifact retry requires an artifact result")
        if self.product_event is ToolProductEvent.ARTIFACT_READY and self.result_kind is not ToolResultKind.ARTIFACT:
            raise ValueError("artifact_ready mapping requires an artifact result")

    @property
    def mutating(self) -> bool:
        return self.effect is not ToolEffect.READ

    def to_dict(self) -> dict[str, Any]:
        return {
            "required_policy": self.required_policy,
            "effect": self.effect.value,
            "result_kind": self.result_kind.value,
            "retry_mode": self.retry_mode.value,
            "parallel_safe": self.parallel_safe,
            "product_event": self.product_event.value,
        }


@dataclass(frozen=True)
class ToolCapabilityManifest:
    """Stable, provider-neutral execution contract for one registered tool."""

    name: str
    display_name: str
    default: ToolOperationCapability
    operations: Mapping[str, ToolOperationCapability] = field(default_factory=dict)
    project_scoped: bool = False
    running_message: str = ""
    manifest_version: int = TOOL_CAPABILITY_MANIFEST_VERSION

    def __post_init__(self) -> None:
        name = str(self.name or "").strip()
        display_name = str(self.display_name or "").strip()
        if not name:
            raise ValueError("tool capability manifest name is required")
        if not display_name:
            raise ValueError(f"tool capability manifest display_name is required: {name}")
        if self.manifest_version != TOOL_CAPABILITY_MANIFEST_VERSION:
            raise ValueError(
                f"unsupported tool capability manifest version: {self.manifest_version}"
            )
        if not isinstance(self.default, ToolOperationCapability):
            raise TypeError(f"invalid default capability for tool {name}")
        normalized_operations: dict[str, ToolOperationCapability] = {}
        for operation, capability in dict(self.operations).items():
            key = str(operation or "").strip().lower()
            if not key or key == "default":
                raise ValueError(f"invalid operation override for tool {name}: {operation!r}")
            if not isinstance(capability, ToolOperationCapability):
                raise TypeError(f"invalid capability for {name}.{key}")
            normalized_operations[key] = capability
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "display_name", display_name)
        object.__setattr__(self, "operations", MappingProxyType(normalized_operations))

    def resolve(self, tool_input: Mapping[str, Any] | None = None) -> ToolOperationCapability:
        return self.operations.get(tool_operation(tool_input), self.default)

    def to_dict(self) -> dict[str, Any]:
        return {
            "manifest_version": self.manifest_version,
            "name": self.name,
            "display_name": self.display_name,
            "project_scoped": self.project_scoped,
            "running_message": self.running_message,
            "default": self.default.to_dict(),
            "operations": {
                key: capability.to_dict()
                for key, capability in sorted(self.operations.items())
            },
        }


def tool_operation(tool_input: Mapping[str, Any] | None = None) -> str:
    value = tool_input or {}
    return str(
        value.get("action")
        or value.get("mode")
        or value.get("file_type")
        or value.get("document_type")
        or "default"
    ).strip().lower()


def _op(
    policy: str,
    effect: ToolEffect,
    *,
    result: ToolResultKind = ToolResultKind.DATA,
    retry: ToolRetryMode = ToolRetryMode.NEVER,
    parallel: bool = False,
    event: ToolProductEvent = ToolProductEvent.TOOL_PROGRESS,
) -> ToolOperationCapability:
    return ToolOperationCapability(
        required_policy=policy,
        effect=effect,
        result_kind=result,
        retry_mode=retry,
        parallel_safe=parallel,
        product_event=event,
    )


READ = _op(
    "read_only_tool",
    ToolEffect.READ,
    retry=ToolRetryMode.TRANSIENT_READ,
    parallel=True,
)
SERIAL_READ = _op(
    "read_only_tool",
    ToolEffect.READ,
    retry=ToolRetryMode.TRANSIENT_READ,
)
CREATE_ARTIFACT = _op(
    "write_artifact",
    ToolEffect.CREATE,
    result=ToolResultKind.ARTIFACT,
    retry=ToolRetryMode.ARTIFACT,
    event=ToolProductEvent.ARTIFACT_READY,
)
MODIFY_ARTIFACT = _op(
    "modify_existing_file",
    ToolEffect.MODIFY,
    result=ToolResultKind.ARTIFACT,
    event=ToolProductEvent.ARTIFACT_READY,
)
MODIFY = _op(
    "modify_existing_file",
    ToolEffect.MODIFY,
    result=ToolResultKind.MUTATION,
)
CREATE_MUTATION = _op(
    "write_artifact",
    ToolEffect.CREATE,
    result=ToolResultKind.MUTATION,
)
CREATE_ARTIFACT_ONCE = _op(
    "write_artifact",
    ToolEffect.CREATE,
    result=ToolResultKind.ARTIFACT,
    event=ToolProductEvent.ARTIFACT_READY,
)
DELETE = _op(
    "destructive_action",
    ToolEffect.DELETE,
    result=ToolResultKind.MUTATION,
)


def _manifest(
    name: str,
    display_name: str,
    default: ToolOperationCapability,
    *,
    operations: Mapping[str, ToolOperationCapability] | None = None,
    project_scoped: bool = False,
    running_message: str = "",
) -> ToolCapabilityManifest:
    return ToolCapabilityManifest(
        name=name,
        display_name=display_name,
        default=default,
        operations=operations or {},
        project_scoped=project_scoped,
        running_message=running_message,
    )


_BUILTIN_MANIFESTS = {
    manifest.name: manifest
    for manifest in (
        _manifest(
            "generate_html_deck_from_skill",
            "生成 HTML 演示文稿",
            CREATE_ARTIFACT,
            running_message="正在生成 HTML 演示文稿…",
        ),
        _manifest(
            "generate_ppt",
            "生成 PowerPoint",
            CREATE_ARTIFACT,
            running_message="正在生成 PowerPoint…",
        ),
        _manifest(
            "generate_ppt_from_skill",
            "按技能生成 PowerPoint",
            CREATE_ARTIFACT,
            running_message="正在按技能生成 PowerPoint…",
        ),
        _manifest(
            "generate_docx",
            "生成 Word 文档",
            CREATE_ARTIFACT,
            running_message="正在生成 Word 文档…",
        ),
        _manifest(
            "generate_xlsx",
            "生成 Excel 工作簿",
            CREATE_ARTIFACT,
            running_message="正在生成 Excel 工作簿…",
        ),
        _manifest(
            "generate_pdf",
            "生成 PDF",
            CREATE_ARTIFACT,
            running_message="正在生成 PDF…",
        ),
        _manifest("save_json", "保存 JSON 文件", CREATE_ARTIFACT),
        _manifest("save_text", "保存文本文件", CREATE_ARTIFACT),
        _manifest(
            "manage_project_folders",
            "管理项目文件夹",
            DELETE,
            operations={
                "list": SERIAL_READ,
                "create": CREATE_MUTATION,
                "rename": MODIFY,
                "move_file": MODIFY,
                "delete": DELETE,
            },
            project_scoped=True,
        ),
        _manifest(
            "manage_project_files",
            "管理项目文件",
            DELETE,
            operations={"list": SERIAL_READ, "delete": DELETE},
            project_scoped=True,
        ),
        _manifest(
            "read_project_file",
            "读取项目文件",
            READ,
            operations={"list": READ, "read": READ},
            project_scoped=True,
            running_message="正在读取项目文件…",
        ),
        _manifest(
            "write_project_office_document",
            "生成项目 Office 文档",
            CREATE_ARTIFACT,
            project_scoped=True,
            running_message="正在生成项目文档…",
        ),
        _manifest(
            "edit_project_office_document",
            "编辑项目 Office 文档",
            MODIFY_ARTIFACT,
            project_scoped=True,
            running_message="正在编辑项目文档…",
        ),
        _manifest(
            "manage_pdf",
            "处理项目 PDF",
            MODIFY_ARTIFACT,
            operations={
                "read": SERIAL_READ,
                "merge": CREATE_ARTIFACT_ONCE,
                "split": CREATE_ARTIFACT_ONCE,
                "extract": CREATE_ARTIFACT_ONCE,
                "watermark": CREATE_ARTIFACT_ONCE,
            },
            project_scoped=True,
            running_message="正在处理项目 PDF…",
        ),
        _manifest(
            "translate_document",
            "翻译文档",
            _op(
                "write_artifact",
                ToolEffect.EXTERNAL,
                result=ToolResultKind.ARTIFACT,
                event=ToolProductEvent.ARTIFACT_READY,
            ),
            running_message="正在翻译文档…",
        ),
        _manifest(
            "update_project_markdown_document",
            "写入项目 Markdown 文档",
            CREATE_ARTIFACT,
            operations={
                "create": CREATE_ARTIFACT,
                "append": MODIFY_ARTIFACT,
                "replace": MODIFY_ARTIFACT,
                "patch": MODIFY_ARTIFACT,
                "rollback": MODIFY_ARTIFACT,
            },
            project_scoped=True,
            running_message="正在写入项目 Markdown 文档…",
        ),
        _manifest(
            "read_project_markdown_document",
            "读取项目 Markdown 文档",
            READ,
            operations={"list": READ, "read": READ},
            project_scoped=True,
            running_message="正在读取项目 Markdown 文档…",
        ),
    )
}


def builtin_tool_manifest(name: str) -> ToolCapabilityManifest | None:
    return _BUILTIN_MANIFESTS.get(str(name or "").strip())


def conservative_tool_manifest(name: str) -> ToolCapabilityManifest:
    """Return a fail-closed manifest for an unclassified registered tool."""

    normalized = str(name or "").strip() or "unknown"
    return _manifest(
        normalized,
        "工具" if normalized == "unknown" else normalized,
        _op(
            "destructive_action",
            ToolEffect.EXTERNAL,
            result=ToolResultKind.MUTATION,
        ),
    )


def all_builtin_tool_manifests() -> tuple[ToolCapabilityManifest, ...]:
    return tuple(_BUILTIN_MANIFESTS.values())


def resolve_tool_manifest(name: str) -> ToolCapabilityManifest:
    return builtin_tool_manifest(name) or conservative_tool_manifest(name)


def resolve_tool_capability(
    name: str,
    tool_input: Mapping[str, Any] | None = None,
) -> ToolOperationCapability:
    return resolve_tool_manifest(name).resolve(tool_input)


def tool_display_name(name: str) -> str:
    return resolve_tool_manifest(name).display_name


def tool_running_message(name: str) -> str:
    manifest = resolve_tool_manifest(name)
    return manifest.running_message or f"正在执行{manifest.display_name}…"


def tool_is_project_scoped(name: str) -> bool:
    return resolve_tool_manifest(name).project_scoped


def tool_is_mutating(name: str, tool_input: Mapping[str, Any] | None = None) -> bool:
    return resolve_tool_capability(name, tool_input).mutating
