---
summary: 'Test pyramid, validation entry points, and testing reality during the hackathon'
read_when:
  - Before writing tests
  - Before committing changes
  - Before the Day 4 Hard Gate review
status: active
---

# Testing

## Strategy

Under hackathon constraints the test pyramid is deliberately incomplete; only the critical paths must be verifiable. Priority order:

1. **Agent tool unit tests** (many) — each tool mocks LLM and network independently, validating the input/output schema
2. **x402 middleware integration tests** (medium) — real local express server exercised with an `x402-fetch` client
3. **Three end-to-end demo flows** (Day 4 Hard Gate) — manual and scripted, run in parallel
4. **Not in scope**: full E2E browser automation, cross-chain retry, load testing, security fuzzing

## Validation Matrix

| Layer             | Tech                        | Location                                 | Cadence                      |
| ----------------- | --------------------------- | ---------------------------------------- | ---------------------------- |
| Unit              | vitest                      | `apps/server/**/*.test.ts`               | pre-commit + pnpm test       |
| Integration       | vitest + local express      | `apps/server/x402/*.integration.test.ts` | CI (when available) + manual |
| Probe hello world | Custom script               | `scripts/probe-*.ts`                     | Day 1 EOD one-shot hard gate |
| E2E demo flow     | Manual run + log screenshot | `docs/runbooks/hard-gate-checklist.md`   | Day 4 EOD hard gate          |
| Typecheck         | tsc --noEmit                | Entire workspace                         | pre-commit + CI              |
| Lint              | eslint                      | Entire workspace                         | pre-commit + CI              |

## Current Reality

- Framework: **vitest** is wired up.
- **Current counts** (2026-04-20 EOD, after Phase 4 AC4 landed and the Run #3 robustness fixes):
  - `packages/shared`: 21 tests / 1 file (schema parse happy and sad paths, including the Artifact discriminated union and RunSnapshot)
  - `apps/server`: 188 tests / 19 files (includes real Base Sepolia x402 settle integration, 8 RunStore tests, 8 runs/routes tests, 7 `_json` robustness tests)
  - `apps/web`: 0 tests (UI components are not yet covered by unit tests; visual verification runs through `pnpm dev`)
  - Total: **209 tests, all green**
- **Not required**: 100% coverage, mutation testing, visual regression, Playwright E2E (all excluded by the hackathon schedule)

## Rules

1. Every new agent tool ships with one unit test asserting the input/output schema (zod parse happy path plus a failure case).
2. When fixing a bug, first write a failing reproduction test (red), then fix the code (green).
3. Do not mock the database — there is no database in this project.
4. Do not mock the `viem` client network calls — use real Base Sepolia / BSC testnet traffic (free and replayable).
5. LLM calls may be mocked — use fixed fixtures to avoid burning API credit during tests.
6. If the Hard Gate fails, cut the most complex flow and keep two demo-able ones (see the risk section in the internal roadmap, not public).
