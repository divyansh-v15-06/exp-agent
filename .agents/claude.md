# AGENTS.md — Autonomous Trade Finance (Letter of Credit) Agent

> Build target: **Terminal 3 ADK Bounty Challenge** — primary track ("Best Agent utilising Terminal 3 Agent Auth SDK").
> Optimized for: **SDK Integration 40% · Completeness 30% · Creativity 30%.**
> Pitch: *An autonomous escrow agent for cross-border trade. It locks a buyer's funds, watches for proof of delivery, and releases payment to the exporter through the Terminal 3 TEE — so the agent never sees either party's raw banking details, and every step is written to an immutable audit ledger.*
>
> **Why this lane:** deliberately avoids all four official T3 sandbox demos (Payroll, E-commerce Procurement, E-visa, Travel Booking). Same TEE-placeholder engine, novel institutional domain.

---

## 0. Ground rules for the coding agent (read first)

- **The SDK is the backbone, not a login wall.** Every fund movement / PII resolution routes through `@terminal3/t3n-sdk`. Remove the SDK and the app must break.
- **Raw banking details never enter LLM context, app logs, or the DB.** Buyer + exporter payout details exist only as placeholders/tokens; real values are resolved inside the TEE at payout time.
- **The LLM proposes; deterministic code approves.** The LLM may parse the Bill of Lading and explain its reasoning, but a plain TypeScript policy function must verify delivery conditions against contract terms before ANY payout fires. Never let the model be the sole gate on releasing money.
- **Payout = Stripe Connect (test mode).** "Escrow" is an authorized/held PaymentIntent or platform balance. The TEE resolves the buyer placeholder + exporter reference to a **Connect destination account ID** and fires a Transfer/payout. Do not build a plain charge.
- **The external shipping API is MOCKED.** A "Simulate Port Delivery" dev panel fires a fake Bill-of-Lading webhook. Do NOT integrate a real shipping API — it's a liability, not the project.
- **README is graded.** Keep a "Where the SDK fires" table mapping each SDK call to file + line.
- Verify the real SDK API before writing calls: `npm view @terminal3/t3n-sdk`, read its `.d.ts` types, and the docs at `https://docs.terminal3.io`. Never invent method names — stub behind the adapter with `// TODO: confirm` if unsure.

Stack: **Next.js (App Router) + TypeScript** · `@terminal3/t3n-sdk` · Stripe Connect (test mode) · Prisma + SQLite · SSE for live updates.

---

## The State Machine (the spine)

```
1 INITIATED  -> buyer + exporter terms entered, buyer authorizes via T3 SDK (placeholder minted)
2 ESCROWED   -> agent locks funds (Stripe held PaymentIntent / platform balance)
3 VERIFIED   -> mock BoL webhook fires; LLM parses, deterministic policy code confirms conditions
4 EXECUTED   -> agent releases; TEE resolves placeholder -> exporter Connect account; payout fires
5 SETTLED    -> Stripe confirms; cryptographic receipt written to T3 immutable audit ledger
```

Invariant to assert in code at every transition: no raw account/routing/customer value is present in the agent message context or any serialized response.

---

## STEP 1 — Scaffold + onboarding
"Scaffold Next.js 14+ (App Router, TS, Tailwind). Folders: `/app`, `/lib/t3` (SDK adapter), `/lib/agent`, `/lib/escrow` (Stripe Connect), `/lib/store`. Install `@terminal3/t3n-sdk`, set testnet, load `T3N_API_KEY` server-side only from `.env.local`. Add `GET /health` that inits the T3 client and confirms my DID resolves."
**Accept:** `/health` returns 200 + DID. Log onboarding friction to `BUGS.md`.

## STEP 2 — Domain model
"Types + seed for `LetterOfCredit` (id, buyerRef PLACEHOLDER, exporterRef PLACEHOLDER, value, currency, targetPort, state), `ContractTerms` (required port, required BoL status, max value), `BillOfLading` (status, port, vesselId), `AuditEntry` (id, agentDid, fromState, toState, proof, txRef, ts). Persist via Prisma+SQLite. NEVER store raw bank/Stripe account numbers — only placeholder references the TEE resolves. Seed 3 LCs; one with a port mismatch and one over-value to force edge cases."

## STEP 3 — T3 SDK adapter (core 40%)
"In `/lib/t3/adk.ts`, expose four typed fns wrapping REAL sdk calls (verify names first):
1. `mintBuyerAuthorization(buyerDid, lcId)` -> cryptographic placeholder for the buyer's funds authorization.
2. `verifyAgentIdentity(agentDid)` -> confirm the agent's DID before any privileged action.
3. `resolveAndPayoutInTEE({ buyerPlaceholder, exporterRef, amount })` -> inside the TEE, resolve placeholder -> exporter Stripe Connect destination, fire the Transfer. Raw values must never return to app context.
4. `writeAuditRow(entry)` -> immutable ledger write; return receipt hash.
Each returns `{ ok, proof, error }`, throws typed errors (`IdentityError`, `ResolutionError`, `PayoutError`), and emits a `step` event for the dashboard. Record file+line of each in README."

## STEP 4 — Escrow (Stripe Connect, test mode)
"In `/lib/escrow`, implement: `lockFunds(lcId, amount)` (held PaymentIntent / platform balance, returns an escrow ref — NOT raw card data) and `releaseToExporter(...)` which is called ONLY by the TEE adapter in Step 3 (Connect Transfer to destination account). Add idempotency keys so a payout can never double-fire."

## STEP 5 — Agent loop + policy gate
"In `/lib/agent/run.ts`, drive the state machine. On the mock BoL webhook (State 3): LLM parses the payload and explains whether conditions are met, THEN a deterministic `verifyConditions(terms, bol)` function is the actual gate. Only if it returns true does the loop call `verifyAgentIdentity` -> `resolveAndPayoutInTEE` -> `writeAuditRow` and move to EXECUTED/SETTLED. Emit a structured event per transition with redacted payloads."
**Accept:** valid LC settles end-to-end; the port-mismatch and over-value LCs halt at VERIFIED with a clean rejection + a 'denied' audit row.

## STEP 6 — API + event stream
"Routes: `POST /api/lc` (create), `POST /api/lc/:id/authorize`, `POST /api/webhook/delivery` (the mock BoL trigger), `GET /api/ledger`, `GET /api/stream` (SSE of state transitions). All responses fully redacted."

## STEP 7 — Dashboard (completeness 30%, the cinematic demo)
"Split-screen. LEFT: active LC contracts + live agent log ('LLM parsing Bill of Lading...', 'policy check passed'). RIGHT: a 'Terminal 3 Secure Enclave View' that animates each step — placeholder minted -> escrow locked -> BoL verified -> placeholder resolved INSIDE TEE -> payout fired -> ledger receipt. Show the state machine as a 5-node progress rail. A 'Simulate Port Delivery' dev button fires the webhook. End state shows a 'Compliance Verified' badge with the TEE log hash. Enterprise look: muted palette, monospace hashes."

## STEP 8 — Edge cases + README
"Handle: port mismatch, value over contract cap, invalid/expired agent identity, TEE resolution failure, Stripe payout decline, duplicate delivery webhook (idempotent). Each fails gracefully with a clear reason + an audit row. Then write `README.md` (pitch, diagram, 'Where the SDK fires' table, 60s demo script) and `DEMO.md` (click-by-click for judges). Record a <3 min demo: create LC -> authorize -> simulate delivery -> watch TEE payout -> show ledger -> trigger a denied case."

---

## Parallel — bug bounty track (free extra prize)
Log every claim-flow / SDK / docs friction to `BUGS.md` (severity, repro, expected vs actual, screenshot). Email `devrel@terminal3.io` to confirm where bug submissions go. Known doc-gap finding: no single end-to-end quickstart from API key -> first resolved placeholder.

## Submit checklist
- [ ] Remove the SDK -> app breaks (load-bearing).
- [ ] grep agent context for raw account/routing strings -> zero hits.
- [ ] LLM does NOT solely gate fund release; deterministic verifyConditions does.
- [ ] Payout uses Stripe Connect destination resolved in TEE.
- [ ] README "Where the SDK fires" -> real files + lines.
- [ ] All 6 edge cases demoable; <5 min clone-to-demo.
- [ ] BUGS.md filed.