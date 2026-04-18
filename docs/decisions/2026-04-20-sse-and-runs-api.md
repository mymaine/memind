---
summary: '2026-04-20 decision — wire contract shape of the Runs REST + SSE protocol between the web dashboard and the server'
read_when:
  - Before adding a /api/runs route or SSE event
  - Before changing Artifact / RunSnapshot / SSE payload schema in packages/shared
  - Before adding an EventSource subscription on the web side
  - Before extending runKind (adding creator / heartbeat entry points)
status: locked
---

# Runs API + SSE Protocol

**Decision date**: 2026-04-20
**Phase**: 4 Day 4 (before the AC4 dashboard integration starts)
**Trigger**: the existing `demo-a2a-run.ts` CLI orchestrator needs to connect to the Next.js dashboard so that ThemeInput triggers runs, LogPanel streams live logs, and TxList receives the five artifacts.

## Decision summary

1. **Three REST endpoints**: `POST /api/runs` triggers; `GET /api/runs/:id/events` (SSE) streams; `GET /api/runs/:id` returns the terminal snapshot.
2. **SSE uses native `event:` field classification**, not a self-rolled `{ type, data }` wrapper. Event types are fixed at three: `log` / `artifact` / `status`.
3. **Artifact is a discriminated union on `kind`**, five variants: `bsc-token` / `token-deploy-tx` / `lore-cid` / `x402-tx` / `tweet-url`.
4. **The first release ships only `runKind: 'a2a'`**; `creator` / `heartbeat` slots remain reserved in the enum but POST returns 400.
5. **Run storage is an in-memory Map** (same pattern as LoreStore; single process, no persistence).

## REST shape

### `POST /api/runs`

```jsonc
// Request body (zod: createRunRequestSchema)
{ "kind": "a2a", "params": {} }
```

```jsonc
// Response 201
{ "runId": "run_<nanoid>" }
```

- Any value other than the allowed `kind` returns 400.
- `params` is optional; a2a ignores it in this release; creator / heartbeat will parse it later.
- `runId` has no strong format constraint (UUID / nanoid / timestamp + random all acceptable), but must be URL-safe.

### `GET /api/runs/:id/events` (SSE)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no   ← disables nginx buffering; only relevant if a proxy is added later
```

Three event types:

```
event: log
data: {"ts":"2026-04-20T10:00:15.000Z","agent":"narrator","tool":"extend_lore","level":"info","message":"published chapter 1"}

event: artifact
data: {"kind":"lore-cid","cid":"bafk...","gatewayUrl":"https://gateway.pinata.cloud/ipfs/bafk...","author":"narrator","chapterNumber":1}

event: status
data: {"runId":"run_abc","status":"done"}
```

- **Terminal events**: after `status=done` or `status=error` (the latter carries `errorMessage`), the server actively `res.end()`s the connection. The client's EventSource will attempt to reconnect, so the `addEventListener('status')` handler must detect terminal status and call `es.close()`.
- **Keepalive**: every 20s the server writes a `: ping\n\n` comment line. EventSource does not fire a handler for this; it exists purely to prevent proxy idle timeouts.
- **Order guarantee**: `log` / `artifact` replay strictly in sink-receipt order (late subscribers first replay the buffered history from the beginning, then enter the live stream).

### `GET /api/runs/:id`

```jsonc
// Response 200 (zod: runSnapshotSchema)
{
  "runId": "run_abc",
  "kind": "a2a",
  "status": "done",
  "startedAt": "2026-04-20T10:00:00.000Z",
  "endedAt": "2026-04-20T10:01:10.000Z",
  "artifacts": [
    /* ... 5 artifacts ... */
  ],
  "logs": [
    /* ... full LogEvent[] ... */
  ],
  "errorMessage": null,
}
```

- Unknown run returns 404.
- `logs` can grow long (heartbeat runs accumulate hundreds), but a single a2a run is < 100 entries, so pagination is skipped.

## Why native SSE events rather than `{ type, data }` wrappers

| Alternative                                              | Downside                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `event: message` + `data: { type: 'log', payload: ... }` | Client must hand-roll dispatch; EventSource `onmessage` is a single entry point. Wastes SSE's built-in classification. |
| JSON Lines over a fetch stream                           | No auto-reconnect; no built-in event type. If we chose SSE, we should use it in full.                                  |

Benefits of native events:

- The client writes `es.addEventListener('artifact', handler)` for direct routing; React state updates stay clear (log → logs[], artifact → artifacts[]).
- Chrome DevTools "Network → EventStream" automatically groups by event type, aiding debugging.
- It mirrors the Anthropic Messages API streaming convention (`event: content_block_delta` etc.), lowering cognitive cost.

## Why artifact is a discriminated union

The five pills truly have different fields:

- `bsc-token` carries only `address` (not a tx hash)
- `x402-tx` is the only one with `amountUsdc`
- `tweet-url` has no chain concept; it has `tweetId`
- `lore-cid` does not need `chain` / `explorerUrl`; it has `author` + `chapterNumber`

Forcing a unified flat shape (for example `{ chain, hash, label, explorerUrl }`) produces many optional fields and the client still has to switch(kind) to render. Using `z.discriminatedUnion('kind', [...])` lets TypeScript enforce exhaustiveness for us.

## Why ship only `a2a` kind first

Time constraint (less than two days left in the hackathon) + the AC4 five-pill set can be fully collected inside the a2a flow:

| Pill                        | Source in the a2a flow                           |
| --------------------------- | ------------------------------------------------ |
| `bsc-token` (token address) | `DEFAULT_DEMO_TOKEN_ADDR` (Phase 2 pre-deployed) |
| `token-deploy-tx`           | Phase 2 record `0x760ff53f…760c9b`               |
| `lore-cid` (creator)        | Phase 2 record `bafkrei…peq4`                    |
| `lore-cid` (narrator)       | Produced by the Narrator agent in this run       |
| `x402-tx`                   | Produced when the Market-maker settles           |

The first three are pre-seeded artifacts that `runA2ADemo` emits at startup; the latter two are produced during the run. All five pills populate, satisfying AC4.

`creator` and `heartbeat` remain in the `runKindSchema` enum but POST returns 400 `{ error: 'kind not yet implemented' }` so we avoid a breaking change — future expansion only needs a new dispatcher branch.

## Why run storage is an in-memory Map

- Hackathon single-process demo; losing state on restart is acceptable.
- Follows the existing LoreStore pattern (`apps/server/src/state/`); no new abstraction.
- No Redis / Postgres / file I/O dependency — deployment stays simple.
- EventSource reconnection is handled by the "join-at-any-time replay buffer" (each run retains its full `logs[]` + `artifacts[]`).

## Out of scope

- Multi-tenant / auth: the dashboard defaults to local access.
- Run cancellation (`DELETE /api/runs/:id`): not needed in the two-day demo window.
- Structured logging / observability hooks: `LogEvent` is already structured logging.
- SSE `Last-Event-ID` resume: the replay buffer plus re-subscribing to the same `runId` already covers it.
- WebSocket: SSE is one-way and sufficient; WS requires full duplex sync with much more complexity.

## Related file changes

| File                                                              | Change                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/schema.ts`                                   | Added the artifact discriminated union, runKind, runStatus, createRunRequest, createRunResponse, runSnapshot, and SSE payload schemas; added `bsc-mainnet` to chainSchema |
| `packages/shared/src/schema.test.ts`                              | Added 17 new schema tests (9 artifact, 3 createRunRequest, 2 statusEventPayload, 2 runSnapshot, 1 chain mainnet)                                                          |
| `apps/server/src/runs/` (Phase 4 implementation)                  | New `RunStore` + `runA2ADemo` pure function + SSE route handler                                                                                                           |
| `apps/server/src/index.ts` (Phase 4 implementation)               | Mount the three `/api/runs/*` endpoints                                                                                                                                   |
| `apps/server/src/demos/demo-a2a-run.ts` (Phase 4 implementation)  | Extract shared logic into `runA2ADemo`; CLI entry becomes a thin wrapper                                                                                                  |
| `apps/web/src/app/page.tsx` + components (Phase 4 implementation) | ThemeInput onSubmit → POST /api/runs → EventSource subscription                                                                                                           |
