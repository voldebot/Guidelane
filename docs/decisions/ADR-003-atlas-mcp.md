# ADR-003: Atlas — Guidelane's Own MCP Server (Architecture-First Knowledge + Project Graph + Decision Ledger)

- **Status**: Accepted (delivery method **corrected by [ADR-007](ADR-007-headless-engine-contract.md)**, 2026-07-30)
- **Date**: 2026-07-30
- **Deciders**: Talha (owner), Claude (technical lead)
- **Supersedes**: none

> **Correction (ADR-007, measured in S0):** this ADR specified Atlas as
> "bundled via the plugin's `.mcp.json`". The S0 probe found that
> `--strict-mcp-config` excludes plugin-bundled MCP servers as well as the
> user's own, so bundling and session hermeticity cannot both hold. **Atlas
> ships via `--mcp-config` on every invocation, with `--strict-mcp-config`
> always on.** Everything else in this ADR stands.

## Context

Owner requirements: build my own MCP server (R8); serve proven paths/code
examples (R5b); **architecture knowledge is the priority**; "affected files keep
getting overlooked"; serve all languages/architectures in general; the MCP's own
architecture must be quality work; use the latest MCP conventions (R5a).
Closest prior art: alicankiraz1's indexandria (live crawl, no persistence) and
WrongStack's SAGE (code-anchored auto-injected memory) + CodeMap (human-facing
dependency graph).

## Options considered

### Option A — Documentation-search MCP (index docs, answer queries)
- **Pros**: simple, known shape.
- **Cons**: docs say what an API does, not "the way this is actually done and why the obvious alternative fails"; no impact analysis; no project memory.

### Option B — indexandria-style live crawl only
- **Pros**: tiny, always fresh.
- **Cons**: no offline value, no curation, no graph, no ledger; retrieval-quality-bound.

### Option C — Three-subsystem Atlas: curated knowledge (architecture-first) + project graph (impact) + ledger (decisions/outcomes)
- **Pros**: answers all four owner directives; pushed-mode makes knowledge deterministic where it matters; standalone value for any MCP client.
- **Cons**: largest build; corpus is sustained content work.

## Decision

**Chosen**: Option C.

- **Knowledge subsystem** — three kinds, architecture-decision first
  (language-agnostic decision logic + per-stack notes), quality-standard
  (compiled to lint rules where possible; judgment-shaped ones feed G5),
  task-pattern (with "when NOT to use" + failure modes + provenance). Seed
  content: the owner's five agent doctrines + taste-skill + discipline rules
  (~28 entries; separate content track per REVIEW-01 #4).
- **Project graph subsystem** — **v1 depth = TypeScript** (tsc + import graph),
  per-language adapter interface preserved for the "all languages" goal;
  produces impact maps (consumers + covering tests + last-touched-by-phase),
  FILEMAP and `@MAP` headers per the owner's FILEMAP.spec (validation law kept:
  never overwrite a map that fails re-parse).
- **Ledger subsystem** — append-only: project auto-ADRs (pushed as digest to
  every session; deviation requires surfacing to the user) + outcome ledger
  (`worked/failed` per pattern, per machine) + anchor re-verification adopted
  from SAGE (hash-checked entries, stale → flagged).
- **Serving** — two modes: **pushed** (orchestrator-assembled slices; invariants
  always; impact maps consumer-gated; ground-truth digest) and **pulled** (small
  kind-aware tool surface under progressive disclosure / Tool Search; detail via
  resources). Query path never writes; single-file SQLite + FTS5; stdio;
  bundled via the plugin's `.mcp.json`.
- **Spec target**: current stable MCP rev with capability detection for newer
  features (REVIEW-01 C1: don't hard-depend on a days-old RC).
- Deferred to v1.1 (REVIEW-01): contract-change tripwire, anchor re-verify
  automation breadth, multi-language structural parsing, standalone packaging
  polish.

## Consequences

### Positive
- The engine is steered by curated, provenance-carrying knowledge instead of
  vibes; affected files are in front of the model *before* edits; project
  decisions are enforced, not remembered; the corpus starts warm from the
  owner's own doctrines.

### Negative / accepted trade-offs
- Corpus quality is sustained human-judgment work (the plan's largest non-code
  cost, now separately scheduled); v1 impact depth is TS-only — honest
  per-language capability matrix required in docs.

### Follow-up work required
- [ ] S5: server + builder + seed corpus + pushed house-rules pack + G5 checklist served from Atlas
- [ ] S5b: TS graph indexer + impact maps + FILEMAP/@MAP writer
- [ ] Content track: measure entries/day; grow by outcome-ledger evidence

## References

- `docs/research/RESEARCH-01-feasibility.md` §5
- `docs/research/RESEARCH-02-product-architecture.md` §7
- `docs/research/RESEARCH-04-context-problem.md` §2–§4
- `docs/research/REVIEW-01-independent-findings.md` §2, C1
