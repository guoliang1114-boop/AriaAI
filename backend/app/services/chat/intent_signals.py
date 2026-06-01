"""Structured intent signals extracted from a single user message.

The pre-refactor routing code (``policy_guards.detect_action_policy`` and
``policy_guards.detect_tool_access_policy``) used a first-match cascade
that mixed two concerns: (a) classify intent and (b) decide tool access.
A single keyword could silently downgrade capability — the
"结构化记忆 → INJECTED_CONTEXT_ONLY" bug is the canonical example.

This module separates **signal extraction** (pure, deterministic) from
**decision** (the resolver in ``capability_resolver``). All signal
extraction goes through ``extract_intent_signals``; downstream code
should never re-derive these from raw text.

The signal set intentionally mirrors every check the legacy cascade
performed so Phase 1 of the refactor stays behavior-preserving — once
all callers route through the resolver, Phase 4 reorders priorities
to fix the bug without further surgery to extraction.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.artifact_intent import (
    ArtifactIntent,
    detect_artifact_intent,
    is_question_like,
    primary_user_request_text,
)
from app.services.policy_guards import (
    CONCISE_SUMMARY_TERMS,
    DESTRUCTIVE_NEGATION_TERMS,
    DESTRUCTIVE_OBJECT_TERMS,
    DESTRUCTIVE_TERMS,
    DOCUMENT_TERMS,
    FILE_LIST_TERMS,
    MODIFY_TERMS,
    OFFICE_ARTIFACT_TERMS,
    PROJECT_ANALYSIS_TERMS,
    PROJECT_SPACE_ORGANIZATION_TERMS,
    READ_FILE_TERMS,
    READ_TARGET_TERMS,
    WRITE_TERMS,
    _has_any,
    _normalize,
)


_PROJECT_SPACE_OBJECT_TERMS = (
    "空间",
    "项目空间",
    "文件",
    "文档",
    "资料",
    "file",
    "document",
)

_CREATE_VERB_TERMS = (
    "生成",
    "制作",
    "整理一份",
    "做一份",
    "准备一份",
    "输出",
    "create",
    "write",
    "generate",
)

_PRIOR_REFERENCE_TERMS = (
    "刚才的",
    "现有",
    "已有",
    "previous",
    "existing",
    "last",
)


@dataclass(frozen=True)
class IntentSignals:
    """Every boolean / composite signal the cascade needs, computed once.

    Field order roughly tracks the legacy cascade — destructive →
    project-space-organization → question → file-read → modify →
    write → artifact → project-analysis → concise-summary →
    structured-memory — so reading top-to-bottom matches reading
    ``detect_action_policy`` top-to-bottom.
    """

    raw_content: str
    routing_content: str
    text: str  # lowercased + stripped routing_content

    # Empty / question shape
    is_empty: bool
    is_question: bool

    # Destructive — composite of three lower-level checks
    is_destructive: bool

    # Read intents
    is_explicit_file_read: bool

    # Project-space organization (move/rename/restructure)
    has_project_space_organization_intent: bool

    # Write / modify intents
    has_explicit_modify_intent: bool
    has_write_terms: bool
    # "生成 / 制作 / ..." combined with DOC or OFFICE target
    has_create_verbs_with_doc_target: bool

    # Artifact intent (richer signal — comes from artifact_intent module)
    artifact_intent: ArtifactIntent

    # Read-leaning hints
    has_project_analysis_terms: bool
    has_concise_summary_terms: bool
    references_structured_memory: bool

    # ──────────────────────────────────────────────────────────────
    # Convenience composites — Phase 4 will use these to give explicit
    # write intent priority over read hints. Phase 1 does not consume
    # them; they're defined here so the resolver can reach for them
    # without re-deriving.
    # ──────────────────────────────────────────────────────────────

    @property
    def has_any_write_intent(self) -> bool:
        """True if the user's message carries any signal that the turn
        should produce / modify a deliverable. Used by the resolver's
        explicit-write-wins rule (Phase 4). Mirrors the union of
        signals the legacy cascade scattered across multiple
        branches."""
        return (
            self.has_explicit_modify_intent
            or self.has_write_terms
            or self.has_create_verbs_with_doc_target
            or self.artifact_intent.requested
            or self.has_project_space_organization_intent
        )


def extract_intent_signals(
    content: str,
    *,
    project_id: int | None = None,
    force_skill: bool = False,
) -> IntentSignals:
    """Extract every signal the resolver might consult, in one pass.

    Pure function — no side effects, no I/O. The ``project_id`` and
    ``force_skill`` arguments are not used directly by extraction but
    are accepted for API symmetry with the resolver context (so callers
    don't have to thread them through two functions).
    """
    del project_id  # accepted for symmetry; reserved for future signals
    del force_skill  # same

    routing_content = primary_user_request_text(content)
    text = _normalize(routing_content)
    is_empty = not bool(text)

    if is_empty:
        # Skip downstream keyword matching when there's no text — keeps
        # the cheap "empty" branch identical to the legacy cascade.
        return IntentSignals(
            raw_content=content or "",
            routing_content=routing_content,
            text=text,
            is_empty=True,
            is_question=False,
            is_destructive=False,
            is_explicit_file_read=False,
            has_project_space_organization_intent=False,
            has_explicit_modify_intent=False,
            has_write_terms=False,
            has_create_verbs_with_doc_target=False,
            artifact_intent=ArtifactIntent(requested=False),
            has_project_analysis_terms=False,
            has_concise_summary_terms=False,
            references_structured_memory=False,
        )

    is_destructive = (
        _has_any(text, DESTRUCTIVE_TERMS)
        and not _has_any(text, DESTRUCTIVE_NEGATION_TERMS)
        and _has_any(text, DESTRUCTIVE_OBJECT_TERMS)
    )

    is_explicit_file_read = _detect_explicit_file_read(text)

    has_project_space_organization_intent = _has_any(
        text, PROJECT_SPACE_ORGANIZATION_TERMS
    ) and _has_any(text, _PROJECT_SPACE_OBJECT_TERMS)

    has_explicit_modify_intent = _has_any(text, MODIFY_TERMS) and (
        _has_any(text, DOCUMENT_TERMS)
        or _has_any(text, OFFICE_ARTIFACT_TERMS)
        or _has_any(text, _PRIOR_REFERENCE_TERMS)
    )

    has_write_terms = _has_any(text, WRITE_TERMS)
    has_create_verbs_with_doc_target = _has_any(text, _CREATE_VERB_TERMS) and (
        _has_any(text, DOCUMENT_TERMS) or _has_any(text, OFFICE_ARTIFACT_TERMS)
    )

    artifact_intent = detect_artifact_intent(routing_content)

    has_project_analysis_terms = _has_any(text, PROJECT_ANALYSIS_TERMS)
    has_concise_summary_terms = _has_any(text, CONCISE_SUMMARY_TERMS)
    references_structured_memory = "结构化记忆" in text

    return IntentSignals(
        raw_content=content or "",
        routing_content=routing_content,
        text=text,
        is_empty=False,
        is_question=is_question_like(routing_content),
        is_destructive=is_destructive,
        is_explicit_file_read=is_explicit_file_read,
        has_project_space_organization_intent=has_project_space_organization_intent,
        has_explicit_modify_intent=has_explicit_modify_intent,
        has_write_terms=has_write_terms,
        has_create_verbs_with_doc_target=has_create_verbs_with_doc_target,
        artifact_intent=artifact_intent,
        has_project_analysis_terms=has_project_analysis_terms,
        has_concise_summary_terms=has_concise_summary_terms,
        references_structured_memory=references_structured_memory,
    )


def _detect_explicit_file_read(text: str) -> bool:
    """Mirrors policy_guards._is_explicit_file_read_request.

    Duplicated here (not re-imported) because the legacy helper is
    private and we'd rather not extend the import surface of
    policy_guards while we're mid-refactor. Behaviour is identical."""
    if not text:
        return False
    if _has_any(text, FILE_LIST_TERMS):
        return True
    if "file_id" in text or "文件 id" in text or "文件id" in text:
        return True
    if _has_any(text, READ_FILE_TERMS) and _has_any(text, READ_TARGET_TERMS):
        return True
    return False
