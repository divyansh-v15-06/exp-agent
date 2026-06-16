# NEXTSTEPS.md - Project Completion Plan

This file is the working checklist for finishing the Autonomous Trade Finance
Agent. After each completed task, update the relevant checkbox from `[ ]` to
`[x]` and add a short note if anything changed from the original plan.

## Current Baseline

- [x] Step 1: Next.js scaffold and `/health` route.
- [x] Step 2: Prisma domain model, SQLite seed data, placeholder-only storage.
- [x] Step 3: Terminal 3 SDK adapter for identity, delegation, invocation, audit receipt.
- [x] Step 4: Escrow layer with Stripe/simulator and payout idempotency.
- [x] Step 5 core: Agent loop, advisory BoL parser, deterministic policy gate.
- [x] Step 5 verification: Smoke test the full lifecycle from seeded LC to settlement/denial.
- [x] Step 6: API routes and SSE stream.
- [x] Step 7: Dashboard demo UI.
- [x] Step 8: Edge cases, docs, and final demo polish.

## Chunk 1 - Align Docs With Code

Goal: make the project docs reflect the real implementation state before adding
more surface area.

- [x] Update `README.md` progress checklist to mark Step 5 core as implemented.
- [x] Add a short note that Step 5 still needs lifecycle/API verification.
- [x] Keep the "Where the SDK fires" section accurate after any line movement.
- [x] Decide whether `.agents/claude.md` should stay as original spec or receive a status note.

Decision: `.agents/claude.md` stays as the original build spec. Live status now
lives here and in the README progress section.

Remaining after this chunk:

- Step 5 lifecycle verification.
- API routes and SSE.
- Dashboard.
- Edge cases and final docs/demo.

## Chunk 2 - Full Lifecycle Smoke Test

Goal: prove `lib/agent/run.ts` works end-to-end against seeded data.

- [x] Add `tools/step5-smoke.ts`.
- [x] Exercise valid LC: authorize -> escrow -> delivery -> policy pass -> payout -> settled.
- [x] Exercise port mismatch LC: delivery -> policy fail -> denial audit row.
- [x] Exercise over-value LC: delivery -> policy fail -> denial audit row.
- [x] Confirm idempotency behavior or document the current duplicate-webhook limitation.
- [x] Add an npm script for the smoke test if useful.

Verification: `npm run smoke:step5` passed with temporary local test keys and
simulator escrow. Duplicate delivery after settlement is rejected by state guard
and does not create a second release.

Remaining after this chunk:

- API routes and SSE.
- Dashboard.
- Edge cases and final docs/demo.

## Chunk 3 - API Routes

Goal: expose the agent workflow through clean, redacted HTTP endpoints.

- [x] `GET /api/lc` - list Letters of Credit with terms and current state.
- [x] `POST /api/lc` - create a new Letter of Credit with contract terms.
- [x] `POST /api/lc/[id]/authorize` - call `authorizeAndEscrow`.
- [x] `POST /api/webhook/delivery` - call `onDeliveryWebhook`.
- [x] `GET /api/ledger` - return redacted audit entries.
- [x] Ensure every response passes the redaction guard.
- [x] Ensure route handlers run on Node.js runtime where needed.
- [x] Add basic error envelopes with safe messages and status codes.

Verification: `npx tsc --noEmit` and `npm run build` passed after adding the
API route tree.

Remaining after this chunk:

- SSE stream.
- Dashboard.
- Edge cases and final docs/demo.

## Chunk 4 - SSE Event Stream

Goal: stream state transitions and secure-enclave events to the dashboard.

- [x] Add `GET /api/stream`.
- [x] Subscribe to `onStep`.
- [x] Emit server-sent events in browser-friendly format.
- [x] Send keepalive comments or pings.
- [x] Clean up listeners on disconnect.
- [x] Verify no raw account-like values can stream.

Verification: `npm run build` includes `/api/stream`; `npx tsc --noEmit`
passes after build-generated Next types are stable.

Remaining after this chunk:

- Dashboard.
- Edge cases and final docs/demo.

## Chunk 5 - Dashboard

Goal: build the judge-facing demo surface.

- [x] Replace the current placeholder home page with a functional dashboard.
- [x] Show active LC contracts and state.
- [x] Add authorize/escrow action for an LC.
- [x] Add "Simulate Port Delivery" action.
- [x] Show live agent log from SSE.
- [x] Show a five-node state machine rail.
- [x] Show a Terminal 3 Secure Enclave view with placeholder -> resolve -> payout -> receipt flow.
- [x] Show audit ledger entries.
- [x] Make valid, port-mismatch, and over-value cases easy to demo.
- [x] Verify mobile and desktop layouts.

Verification: `npm run build` and `npx tsc --noEmit` passed. Dev server
responded at `http://localhost:3000`, dashboard HTML contained the expected
console title, `/api/lc` and `/api/ledger` returned redacted data, and
`/api/stream` emitted the SSE `ready` event. `agent-browser` was not available
on PATH, so verification used responsive code review plus HTTP/build checks.

Remaining after this chunk:

- Edge cases and final docs/demo.

## Chunk 6 - Edge Cases And Hardening

Goal: make all required failure paths demoable and graceful.

- [x] Duplicate delivery webhook is idempotent or cleanly rejected without double payout.
- [x] Port mismatch denies with audit proof.
- [x] Value over contract cap denies with audit proof.
- [x] Invalid or missing agent identity fails safely.
- [x] TEE resolution failure fails safely.
- [x] Stripe payout decline/failure fails safely.
- [x] Redaction guard is applied to all outward payloads.
- [x] Confirm no raw account/routing/card-like values are stored or returned.

Verification: Step 5 smoke confirms duplicate post-settlement delivery does not
double-release, port mismatch denies, over-value denies, DID mismatch throws
`IdentityError`, and missing agent key fails before LC/escrow mutation.
Settlement failures after policy pass now transition to `FAILED` with an audit
row. A raw-value scan for card/account/routing/IBAN/Stripe-secret patterns
returned no matches.

Remaining after this chunk:

- Final docs/demo polish.

## Chunk 7 - Final Docs And Demo Polish

Goal: make the repo easy to judge, clone, run, and understand.

- [x] Update `README.md` with current routes, scripts, and final status.
- [x] Add `DEMO.md` with a click-by-click judge walkthrough.
- [x] Add a short architecture diagram or text flow.
- [x] Update "Where the SDK fires" line references.
- [x] Update `BUGS.md` with any new SDK/docs friction.
- [x] Add a final clone-to-demo checklist.
- [x] Run lint/build/smoke tests and record results.

Verification: `README.md`, `DEMO.md`, and `project_readme.md` are current.
No new Terminal 3 SDK/docs friction was found beyond existing `BUGS.md` entries.
`npm run lint`, `npx tsc --noEmit`, `npm run build`, and
`npm run smoke:step5` pass. Raw-value scan returned no matches.

Remaining after this chunk:

- Project ready for final review/submission.

## Running Task Log

Use this section to record completed work as we go.

- [x] Chunk 1 complete: README now reflects Step 5 core implementation; `.agents/claude.md` remains the original spec.
- [x] Chunk 2 complete: added and ran `tools/step5-smoke.ts`; valid LC settled, port mismatch and over-value denied, duplicate post-settlement delivery did not double-release.
- [x] Chunk 3 complete: added LC, authorize, delivery webhook, and ledger API routes with guarded redacted responses; TypeScript and Next build passed.
- [x] Chunk 4 complete: added SSE stream route with redaction check, keepalive, and disconnect cleanup.
- [x] Chunk 5 complete: dashboard implemented and HTTP/build verified; `agent-browser` was unavailable on PATH, so visual verification used responsive code review plus route checks.
- [x] Chunk 6 complete: duplicate, policy denial, settlement failure, payout failure, redaction, DID mismatch, and missing-key safety are covered.
- [x] Chunk 7 complete: README updated, `DEMO.md` added, `project_readme.md` added, final verification recorded.
