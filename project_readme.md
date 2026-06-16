# Autonomous Trade Finance Agent - Project Overview

## What This Project Does

This project is an autonomous Letter of Credit escrow agent for cross-border
trade finance. It models a buyer, exporter, contract terms, delivery proof, an
escrow hold, a secure payout boundary, and an immutable audit trail.

The core flow:

1. A Letter of Credit is created with buyer/exporter placeholders and contract
   terms.
2. The buyer authorizes the agent through a Terminal 3 delegation credential.
3. The agent locks funds in escrow through Stripe test mode or a local simulator.
4. A mock Bill of Lading delivery webhook arrives.
5. An LLM or heuristic parser explains the delivery evidence.
6. Deterministic TypeScript policy code makes the binding payout decision.
7. If policy passes, the agent verifies its Terminal 3 identity and signs a TEE
   invocation.
8. The TEE-style payout boundary resolves the exporter placeholder and fires the
   transfer.
9. Every transition writes an audit row with a cryptographic receipt hash.

The main safety invariant is that raw bank, card, routing, customer, or Stripe
secret values never enter the browser, database, logs, LLM prompt, or API
responses. The app stores and displays only opaque placeholders and masked refs.

## Why It Is Interesting

This uses the Terminal 3 Agent Auth SDK as the backbone of a non-trivial
institutional workflow. It is not just login. The SDK is used to:

- resolve the agent DID
- mint buyer delegation credentials
- sign agent invocations
- prove the agent is authorized before privileged settlement
- produce public proof artifacts for the audit trail

The LLM is deliberately not trusted with money movement. It can parse and
explain the Bill of Lading, but `verifyConditions` in deterministic TypeScript
is the only gate that can approve payout.

## Main Features

- Next.js 14 App Router dashboard.
- Prisma + SQLite persistence.
- Seeded demo Letters of Credit:
  - valid shipment
  - port mismatch denial
  - over-value denial
- Terminal 3 SDK identity and agent-auth adapter.
- Buyer authorization placeholder minting.
- Stripe Connect test-mode escrow, with simulator fallback.
- Persistent idempotency ledger preventing duplicate locks/releases.
- Advisory LLM Bill-of-Lading parsing with deterministic fallback.
- Deterministic policy gate for payout approval.
- TEE-style placeholder resolution and payout boundary.
- Audit ledger with receipt hashes.
- Redaction guard for every public response/event boundary.
- Server-sent event stream for live agent logs.
- Dashboard with LC cards, state rails, secure enclave panel, live log, and
  audit ledger.
- Full lifecycle smoke test.

## Where the SDK Fires

Every privileged identity, authorization, and payout-proof step routes through
`@terminal3/t3n-sdk`. These are the load-bearing SDK call sites:

| Flow | SDK calls | File lines |
| --- | --- | --- |
| Agent session bootstrap | `setEnvironment`, `loadWasmComponent` | `lib/t3/client.ts:49`, `lib/t3/client.ts:50` |
| Agent address and DID auth | `eth_get_address`, `metamask_sign`, `new T3nClient`, `handshake`, `authenticate` | `lib/t3/client.ts:97`, `lib/t3/client.ts:102`, `lib/t3/client.ts:100`, `lib/t3/client.ts:105`, `lib/t3/client.ts:106` |
| Buyer authorization mint | `buildDelegationCredential`, `validateCredentialBody`, `canonicaliseCredential`, `signCredential`, `b64uEncodeBytes` | `lib/t3/adk.ts:125`, `lib/t3/adk.ts:136`, `lib/t3/adk.ts:138`, `lib/t3/adk.ts:139`, `lib/t3/adk.ts:141` |
| Agent identity check | `verifyAgentIdentity` calls authenticated T3 client session checks | `lib/t3/adk.ts:175` |
| TEE payout invocation proof | `b64uDecodeStrict`, `buildInvocationPreimage`, `signAgentInvocation`, `b64uEncodeBytes` | `lib/t3/adk.ts:272`, `lib/t3/adk.ts:278`, `lib/t3/adk.ts:279`, `lib/t3/adk.ts:280` |
| Audit receipt boundary | `writeAuditRow` persists the redacted proof and receipt hash | `lib/t3/adk.ts:350` |

## Simulation Mode

The project is designed to demo without paid or external financial accounts.
When Stripe credentials are absent, escrow and payout use deterministic simulator
references:

- `pi_sim_*` for held PaymentIntent-style escrow locks.
- `tr_sim_*` for exporter release transfers.
- `acct_sim_*` for resolved exporter destinations.

Terminal 3 credential minting, DID verification, and invocation signing still
use the real SDK path. The simulator only replaces the external money movement
boundary so the judge/demo flow is cloneable.

## State Machine

```text
INITIATED -> ESCROWED -> VERIFIED -> EXECUTED -> SETTLED
```

Failure/denial states:

- `DENIED`: policy rejected release, such as port mismatch or value over cap.
- `FAILED`: identity, TEE resolution, or payout failed after policy passed.

## Key Files

| File | Purpose |
| --- | --- |
| `app/page.tsx` | Dashboard demo console. |
| `app/api/lc/route.ts` | List/create Letters of Credit. |
| `app/api/lc/[id]/authorize/route.ts` | Mint authorization and lock escrow. |
| `app/api/webhook/delivery/route.ts` | Mock delivery webhook. |
| `app/api/ledger/route.ts` | Redacted audit ledger API. |
| `app/api/stream/route.ts` | Server-sent event stream. |
| `lib/agent/run.ts` | State machine and settlement loop. |
| `lib/agent/policy.ts` | Deterministic payout policy gate. |
| `lib/agent/llm.ts` | Advisory BoL parser/explainer. |
| `lib/t3/client.ts` | Terminal 3 SDK client bootstrap. |
| `lib/t3/adk.ts` | Terminal 3 Agent Auth adapter. |
| `lib/t3/redact.ts` | Raw financial data leak guard. |
| `lib/escrow/index.ts` | Escrow lock/release and idempotency. |
| `prisma/schema.prisma` | Domain data model. |
| `tools/step5-smoke.ts` | End-to-end lifecycle smoke test. |

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | Resolve Terminal 3 agent identity. |
| `/api/lc` | `GET` | List Letters of Credit. |
| `/api/lc` | `POST` | Create a Letter of Credit. |
| `/api/lc/[id]/authorize` | `POST` | Authorize buyer and lock escrow. |
| `/api/webhook/delivery` | `POST` | Simulate Bill-of-Lading delivery. |
| `/api/ledger` | `GET` | Read redacted audit entries. |
| `/api/stream` | `GET` | Stream live agent events via SSE. |

## Run Locally

```bash
npm install
cp .env.example .env.local
npm run db:push
npm run db:seed
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Verification

```bash
npm run smoke:step5
npx tsc --noEmit
npm run build
```

The Step 5 smoke test verifies settlement, denial cases, duplicate protection,
identity mismatch handling, and missing-key safety.

## Current Limitations

- The deployed TEE contract submission is documented as `TODO: confirm` because
  no deployed `tee:trade-finance` contract exists in this scaffold.
- The immutable Terminal 3 ledger write is represented by a local audit row and
  receipt hash; a real tenant ledger contract can replace that boundary later.
- Stripe runs in simulator mode unless a test-mode `STRIPE_SECRET_KEY` and
  destination map are configured.
- Browser visual verification was HTTP/build verified here; the `agent-browser`
  CLI was not available on PATH in this environment.
- `npm audit` still reports framework/SDK dependency advisories that require
  breaking upgrades or upstream fixes: Next major upgrade path, `ws` via
  `ethers`/`@terminal3/t3n-sdk`, and Next-bundled PostCSS. The safe direct
  updates (`tsx`, root `postcss`, ESLint, Anthropic SDK) have been applied.
