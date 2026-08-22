# Third-party notices

## OpenAI Codex

AriaAI contains Python adaptations of selected algorithms from the open-source
OpenAI Codex repository. AriaAI does not bundle, start, import, or communicate
with a Codex runtime. The adapted mechanisms currently cover:

- head/tail output buffering;
- byte-based token estimation, UTF-8-safe middle truncation, per-turn
  context-window budgeting, atomic tool-batch retention, and structured tool
  payload compaction;
- append-only rollout ordinals, chronological checkpoint reconstruction, and
  fail-closed recovery planning;
- single-artifact structured text patch parsing, ordered replacement planning,
  unified-diff preview, and line-ending-preserving application;
- the `allow / prompt / forbidden` policy decision model;
- canonical approval-action binding and policy-stage revalidation;
- tool call/output pairing, orphan-output removal, deterministic missing-output
  insertion, and stable prompt-only call-ID repair;
- bounded model-stream retry state, semantic retry/error classification,
  server-provided delay handling, and side-effect-aware replay suppression;
- `SKILL.md` frontmatter parsing and conservative YAML scalar repair; and
- ordered Skill-root discovery, immutable content snapshots, cache reuse,
  error-isolated merging, and unambiguous candidate selection.

Upstream baseline: commit `343074d4207d572809bd8cea15f4be1d09d98e0b`
(2026-08-22). The specific upstream source path and Aria modification notice
are recorded in each adapted Python module.

OpenAI Codex is available under the Apache License 2.0:

- Source: <https://github.com/openai/codex>
- Local license copy: `third_party/openai-codex/LICENSE`
- Upstream notice: OpenAI Codex, Copyright 2025 OpenAI

No Codex App Server, SDK, CLI binary, generated protocol bindings, cloud code,
or IDE-extension code is included in the Aria application.
