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
  request binding, base-linked content-free derived request receipts for
  durable steering, and shared Trace/Rollout/Evaluation context evidence;
- typed run-output items, stable output identities, source-linked artifact
  lifecycle facts, verified persistence digests, and separately reviewed memory
  candidate decisions without storing raw paths or candidate text in the run
  record;
- typed search-result identities and item lifecycles adapted into bounded
  knowledge-evidence manifests, stable citation keys, output citation
  resolution, and content-digest provenance without persisting retrieved chunk
  text;
- semantic failure categories and bounded exponential retry adapted into
  lease-based, checkpointed knowledge-ingestion jobs with deterministic
  idempotency and without persisting raw document text or local paths;
- verify-before-write plan fingerprints and restart-safe item checkpoints
  adapted into non-destructive legacy knowledge migration with durable mapping
  records and content-digest drift detection;
- `SKILL.md` frontmatter parsing and conservative YAML scalar repair; and
- ordered Skill-root discovery, immutable content snapshots, cache reuse,
  error-isolated merging, and unambiguous candidate selection.
- per-turn Skill mention/selection boundaries adapted into relevant-follow-up
  continuation, stale conversation-Skill release, and user-visible activation
  provenance; and
- immutable Skill contract snapshots, reconstructed active views,
  project-sticky rollout buckets, content-free release health, and fail-back
  decisions adapted to Aria-native database releases and ChatRun lifecycle.
- project-bound retained conversation capsules, previous-state fingerprint
  chaining, bounded tool outcomes, unresolved blocker retention, and
  current-turn constraint supersession without remote compaction; and
- stable instruction-layer identities and precedence adapted into a bounded,
  no-content manifest covering platform policy, current user requests, project
  scope, active task state, Skills, preferences, evidence, and history; and
- query-aware user/client/project memory-layer selection and deterministic
  current-turn preference supersession, with content-free routing receipts; and
- stable project/client memory-slot identities, canonical content digests,
  bounded source references, targeted freshness invalidation, and verified
  slot overlays adapted to Aria-native business entities; and
- content-addressed project/client memory-fact identities, first/last-seen and
  active/retired lifecycle reconstruction, digest verification, and explicit
  matched/scoped/legacy/unresolved source relationships; and
- slot-level reconstruction planning, captured state fingerprints,
  verify-before-write conflict rejection, bounded partial patches, and safe
  full-rebuild fallback adapted to Aria-native memory ledgers; and
- model-visible stable source handles, private bounded fact-to-source
  attribution declarations, exact validation against the Aria-owned per-slot
  source whitelist, and direct/matched/scoped provenance fallback adapted to
  Aria-native project and client memory rebuilds; and
- stable world-state entity identity adapted into Aria-native
  `Project.client_id` relationships, one-time ambiguity-safe legacy backfill,
  display-snapshot separation, and verify-before-write client authorization;
  and
- expected-turn-bound active-run steering, text-only mailbox delivery, safe
  model/tool boundary injection, stale planned-tool supersession, and concise
  turn-understanding receipts without exposing prompts or hidden reasoning;
- content-free run-effect identities, server-reconstructed recovery contracts,
  current-world-state comparison, and verified prior-result reuse adapted into
  fail-closed Aria-native interruption recovery without replaying a Codex
  transcript; and
- durable database-backed run-control inputs, ordered compare-and-set
  consumption, and process-local live-stage / same-worker cancellation hints
  adapted from the expected-turn input boundary so accepted steering or
  cancellation intent is not owned by one ASGI process.

Recorded upstream audit baselines include commits
`83d1fe0e67b1323f71febc2925817732b449f1d9` and
`343074d4207d572809bd8cea15f4be1d09d98e0b`, plus the later run-completion
baseline `99660ab3c7b861c916e467581fa9b8723504d66b`. The specific upstream source path,
pinned commit, and Aria modification notice are recorded in each adapted
Python module.

For the Phase 3N additions specifically:

- `backend/app/services/agent_harness/durable_run_inputs.py` adapts
  `codex-rs/core/src/session/turn_input.rs` at
  `83d1fe0e67b1323f71febc2925817732b449f1d9` into Aria's content-free,
  database-backed Run mailbox and ACL/phase-boundary consumption;
- `backend/app/services/agent_harness/run_effect_record.py` adapts
  `codex-rs/core/src/tools/executed_tool_calls.rs` and
  `codex-rs/core/src/tools/registry.rs` at the same commit into Aria's
  content-free effect ledger and durable-result verification contract; and
- the derived-request extension in
  `backend/app/services/context_builder/assembly.py` remains based on
  `codex-rs/core/src/context/world_state/mod.rs` and
  `codex-rs/core/src/context_manager/history.rs` at the same commit, translated
  into Aria's base-linked manifest for exact effective Provider inputs.

Those files record the upstream path, pinned commit, Apache-2.0 basis, and
Aria-specific modification notice in their module headers.

For the Phase 3X evidence-review addition,
`backend/app/services/project_question_remediation_evidence_reviews.py`
adapts the immutable-evidence / separate-review-judgment boundary from
`codex-rs/core/src/context/guardian_review_evidence.rs` at commit
`99660ab3c7b861c916e467581fa9b8723504d66b`. Aria replaces the upstream
context-guardian implementation with a native SQLModel current-state ledger,
append-only decision events, project ACL reauthorization, optimistic revision,
and a React/FastAPI workflow. No Codex runtime, protocol, SDK, subprocess, or
network communication is included.

OpenAI Codex is available under the Apache License 2.0:

- Source: <https://github.com/openai/codex>
- Local license copy: `third_party/openai-codex/LICENSE`
- Upstream notice: OpenAI Codex, Copyright 2025 OpenAI

No Codex App Server, SDK, CLI binary, generated protocol bindings, cloud code,
or IDE-extension code is included in the Aria application.
