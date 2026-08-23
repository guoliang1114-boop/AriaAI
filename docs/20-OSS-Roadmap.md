# AriaAI OSS Roadmap

> Updated: 2026-08-23
> Status: Public roadmap for open-source contributors and maintainers.

AriaAI is an open-source agentic workspace for professional knowledge work. The roadmap below highlights work that strengthens AriaAI as a reusable reference implementation for AI-native workspaces: memory, skills, knowledge workflows, human approval, and auditable runs.

## 1. Agentic Workspace Foundation

Goal: make AI work durable, traceable, and understandable.

- Define a stable AI Run contract covering run, step, event, tool call, artifact, approval, and memory candidate.
- Separate product-facing run events from internal trace events.
- Keep ordinary chat quiet while making long-running work transparent.
- Improve failure recovery for streaming, tool calls, and artifact saves.
- Keep Aria's Agent Loop native and provider-neutral; selectively absorb proven
  open-source harness mechanisms without introducing a second runtime.
- Budget system context, tool schemas, history, reasoning, output reserve, and
  safety margin before every model turn; preserve call/result batches as atomic
  structured units and compact only when the selected model window requires it.
- Persist ordinary chat runs as ordered Aria checkpoints, reconstruct them
  deterministically after interruption, and retry only when side effects are known safe.
- Apply targeted Markdown changes through a single-artifact structured patch:
  freeze the diff before approval, verify the exact base hash again at execution,
  atomically replace the file, and preserve a rollback version.
- Normalize tool call/result transcripts at every provider boundary: repair
  stable IDs, insert fail-closed interrupted outputs, remove orphans, and reject
  duplicate call IDs before a business tool can execute twice.
- Retry transient model-turn failures only before the first provider event;
  honor bounded server delays, classify quota/auth/request errors as terminal,
  and never replay partial text, reasoning, or a tool plan.

## 2. Memory System

Goal: make long-lived project, client, contact, and user memory useful without becoming unsafe.

- Improve project memory slots and source visibility.
- Add memory candidate review before durable writes.
- Link memory updates to source messages, files, and runs.
- Add tests for memory injection, stale detection, and cross-scope isolation.
- Baseline delivered on 2026-08-23: source-linked pending candidates, explicit
  accept/reject decisions, protected accepted anchors, project/client permission
  checks, and PostgreSQL-isolated contract coverage.

## 3. Knowledge Workflows

Goal: turn documents and team knowledge into workflow context, not only search results.

- Stabilize document ingestion, parsing, chunking, and indexing.
- Add source citations to knowledge-assisted answers and artifacts.
- Enforce project/client permission boundaries before retrieval.
- Add retry and status visibility for failed ingestion jobs.

## 4. Skill Workflows

Goal: turn skills from prompts into delivery-oriented workflows.

- Define input requirements, output artifacts, QA checklist, and save location for core skills.
- Add golden cases for important skills.
- Add examples for authoring and testing skills.
- Align Skill metadata with open agent skill conventions where useful.
- Validate file-backed Skill metadata and load only explicitly selected bundled
  references into each Aria execution context.
- Discover ordered Skill roots into immutable content-fingerprinted snapshots,
  refresh only changed roots, isolate malformed packages, and keep the
  database-published Skill catalog authoritative for intent selection.

## 5. Human-in-the-Loop Approval

Goal: keep AI actions powerful but reviewable.

- Continue server-side pending action persistence for write/delete/update operations.
- Improve approval UI and audit trail.
- Add rollback or recovery paths for high-impact changes.
- Render frozen Markdown diffs inside the approval card and reject stale or
  ambiguous changes without writing.
- Add security checks for tool actions that touch project, client, memory, or files.
- Use an explicit `allow / prompt / forbidden` decision before every tool call;
  `prompt` must always enter AriaAI's durable HITAS approval flow.
- Bind each new HITAS preview to a versioned hash of its tool, frozen input,
  project scope, risk, creation policy, and batch order; revalidate the exact
  envelope before atomically claiming execution.

## 6. OSS Quality

Goal: make AriaAI easier to adopt, inspect, and contribute to.

- Improve English setup docs.
- Add screenshots and architecture diagrams to README.
- Increase test coverage around chat, memory, knowledge, and Skill flows.
- Add contributor-friendly issues and milestones.
- Publish preview releases with clear release notes.

## Current Preview Milestone

`v0.1.0-agentic-workspace-preview`

Focus:

- repository OSS readiness;
- project/client memory foundations;
- knowledge-base v1 direction;
- Skill workflow upgrade direction;
- AI Run Harness design;
- security and contribution process.
