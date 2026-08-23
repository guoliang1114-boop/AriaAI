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
- explicitly declared read-only parallel tool lanes, exclusive mutation
  barriers, bounded fan-out, and deterministic call-order result merging;
- active-turn registration, authorized user interruption, durable partial
  reply markers, cancelled-step checkpoints, and terminal cancellation events;
- monotonic per-turn execution accounting, atomic planned-tool reservations,
  shared model/tool deadlines, and durable budget-exhaustion boundaries;
- bounded run-completion evidence, structured deterministic findings, explicit
  terminal verdicts, and false-completion prevention;
- versioned tool-execution records, call-ID-linked lifecycle updates, trusted
  omission accounting, recent-first bounded retention, and shared outcome
  classification without persisting raw tool inputs or outputs;
- fail-closed versioned tool capability manifests, duplicate-registration
  rejection, registry-owned execution metadata, operation-aware policy and
  scheduling lookup, schema fingerprints, and Product Run Event mapping;
- versioned context-assembly manifests, stable source identities, bounded
  privacy-safe snapshots, domain-separated fingerprints, exact initial model
  request binding, and shared Trace/Rollout/Evaluation context evidence;
- typed run-output items, stable output identities, source-linked artifact
  lifecycle facts, verified persistence digests, and separately reviewed memory
  candidate decisions without storing raw paths or candidate text in the run
  record;
- `SKILL.md` frontmatter parsing and conservative YAML scalar repair; and
- ordered Skill-root discovery, immutable content snapshots, cache reuse,
  error-isolated merging, and unambiguous candidate selection.

Latest upstream audit baseline: commit `83d1fe0e67b1323f71febc2925817732b449f1d9`
(2026-08-23). The specific upstream source path and Aria modification notice
are recorded in each adapted Python module.

OpenAI Codex is available under the Apache License 2.0:

- Source: <https://github.com/openai/codex>
- Local license copy: `third_party/openai-codex/LICENSE`
- Upstream notice: OpenAI Codex, Copyright 2025 OpenAI

No Codex App Server, SDK, CLI binary, generated protocol bindings, cloud code,
or IDE-extension code is included in the Aria application.
