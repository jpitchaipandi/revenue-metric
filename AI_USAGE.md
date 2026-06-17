# AI Usage

This project was built with Claude (Anthropic, Opus 4.7, 1M context) for both planning and implementation. AI was used to:

- Research best practices: allow-list vs exclusion-list semantics (NIST 800-171, CERT Top 10), Postgres timezone handling (the double-`AT TIME ZONE 'UTC'` trap), money-as-integer-cents conventions, fast-check property testing
- Draft the implementation plan (four phases, ~40 files) covering data model, layered enforcement, key flows, failure modes, and testing strategy — including the five-layer defense documented in [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Scaffold the codebase across all phases — env validation, DB client + migrations, canonical status enum, per-source mappers, mock CSV + Stripe ingest, the SQL VIEW, the metrics repository (the blessed query module), service layer, HTTP routes, ESLint flat config with the no-restricted-syntax rule, dependency-cruiser module-boundary rules
- Diagnose and fix bugs as they surfaced: ESLint flat config (ESLint 9+) needed an explicit `@eslint/js` install, dependency-cruiser rule was initially too strict (broke legitimate `src/sources/types.ts` import of CanonicalStatus type), test isolation broke because integration tests ran in parallel against the same Supabase (fixed with `fileParallelism: false`), Stripe SDK v22 doesn't expose `LatestApiVersion` type, and the bucket-boundary timezone drift on `date_trunc` (which would have silently miscategorised every metric query)

All architectural decisions, library choices, and deployment configuration were reviewed and approved by the developer before commits. Claude presented options with trade-offs at each design decision (concurrency model, source choice, auth boundaries, test isolation strategy); the developer made the calls.

## Conversation transcript

A narrative log of the dialogue — questions, trade-offs discussed, and decisions made (without code or terminal output) — lives at [`docs/ai-conversation.md`](docs/ai-conversation.md).

The implementation-level build diary (with concrete bugs, fixes, and verification outputs) is kept privately outside this repo for the developer's reference. Same pattern as Project 1 (`sync-pipeline`).

The original Claude chat share link will be added here on final submission.
