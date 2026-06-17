# AI Usage

This project was built with Claude (Anthropic, Opus 4.7, 1M context) for both planning and implementation. AI was used to:

- Research best practices: allow-list vs exclusion-list semantics (NIST 800-171, CERT Top 10), Postgres timezone handling (the double-`AT TIME ZONE 'UTC'` trap), money-as-integer-cents conventions, fast-check property testing
- Draft the implementation plan (four phases, ~40 files) covering data model, layered enforcement, key flows, failure modes, and testing strategy — including the five-layer defense documented in [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Scaffold the codebase across all phases — env validation, DB client + migrations, canonical status enum, per-source mappers, mock CSV + Stripe ingest, the SQL VIEW, the metrics repository (the blessed query module), service layer, HTTP routes, ESLint flat config with the no-restricted-syntax rule, dependency-cruiser module-boundary rules
- Diagnose and fix bugs as they surfaced: ESLint flat config (ESLint 9+) needed an explicit `@eslint/js` install, dependency-cruiser rule was initially too strict (broke legitimate `src/sources/types.ts` import of CanonicalStatus type), test isolation broke because integration tests ran in parallel against the same Supabase (fixed with `fileParallelism: false`), Stripe SDK v22 doesn't expose `LatestApiVersion` type, and the bucket-boundary timezone drift on `date_trunc` (which would have silently miscategorised every metric query)

All architectural decisions, library choices, and deployment configuration were reviewed and approved by the developer before commits. Claude presented options with trade-offs at each design decision (concurrency model, source choice, auth boundaries, test isolation strategy); the developer made the calls.

## How the conversation happened

This project was built via **Claude Code CLI** — the terminal-based agentic coding environment from Anthropic, not the claude.ai web interface. As a result there isn't a single "share link" the way a claude.ai chat would produce; the equivalent is the local session transcript that the CLI captures.

What's available in this repo:

- **[`docs/ai-conversation.md`](docs/ai-conversation.md)** — curated narrative log: the questions, trade-offs discussed, decisions made, and bugs caught across all four implementation phases. Code, commands, and terminal output stripped out so it reads as a design story.
- **[`docs/raw-conversation.md`](docs/raw-conversation.md)** — the full, unfiltered Claude Code CLI session transcript, exported via the `/export` command. 2,692 lines, ~110 KB. Read this if you want the literal log of how the developer directed and reviewed AI output throughout the build.
