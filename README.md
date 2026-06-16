# Autonomous Trade Finance (Letter of Credit) Agent

> Built for the **Terminal 3 ADK Bounty Challenge** — "Best Agent utilising Terminal 3 Agent Auth SDK".

An autonomous escrow agent for cross-border trade. It locks a buyer's funds,
watches for proof of delivery, and releases payment to the exporter through the
Terminal 3 TEE — so the agent never sees either party's raw banking details, and
every step is written to an immutable audit ledger.

## State machine (the spine)

```
1 INITIATED  -> buyer + exporter terms entered, buyer authorizes via T3 SDK (placeholder minted)
2 ESCROWED   -> agent locks funds (Stripe held PaymentIntent / platform balance)
3 VERIFIED   -> mock BoL webhook fires; LLM parses, deterministic policy code confirms conditions
4 EXECUTED   -> agent releases; TEE resolves placeholder -> exporter Connect account; payout fires
5 SETTLED    -> Stripe confirms; cryptographic receipt written to T3 immutable audit ledger
```

**Invariant:** no raw account/routing/customer value ever enters the agent's LLM
context, app logs, or the DB. Placeholders only; the TEE resolves real values at
payout time.

## Stack

Next.js 14 (App Router) + TypeScript + Tailwind · `@terminal3/t3n-sdk` (v3.5.2) ·
Stripe Connect (test mode) · Prisma + SQLite · SSE for live updates.

## Run it

```bash
npm install
cp .env.example .env.local   # set T3N_AGENT_PRIVATE_KEY (any 32-byte hex, 0x-prefixed)
npm run db:push
npm run db:seed
npm run dev
# then:
curl -s http://localhost:3000/health | jq
```

`GET /health` inits the Terminal 3 client, performs the SDK handshake,
authenticates the agent, and returns its resolved DID:

```json
{
  "status": "ok",
  "did": "did:t3n:<40-hex>",
  "address": "0x...",
  "environment": "testnet",
  "node": "https://cn-api.sg.testnet.t3n.terminal3.io"
}
```

## Configuration & fallbacks

The app is designed to **run end-to-end with zero external accounts** — every
integration that needs credentials degrades to a faithful, clearly-labelled
simulator so judges can clone and demo immediately.

| Env var | Required? | When set | When **unset** (fallback) |
| --- | --- | --- | --- |
| `T3N_AGENT_PRIVATE_KEY` | **Yes** | Agent authenticates to T3 testnet; real `did:t3n` resolves | App can't authenticate. A throwaway testnet key ships in `.env.local`. |
| `T3N_DEMO_BUYER_PRIVATE_KEY` | **Yes** | Demo buyer signs the delegation credential | Mint throws `AuthorizationError`. A throwaway key ships in `.env.local`. |
| `DATABASE_URL` | **Yes** | Prisma/SQLite | — (ships in `.env` / `.env.local`) |
| `STRIPE_SECRET_KEY` | No | Real **Stripe test-mode** PaymentIntents + Transfers (`pi_…`/`tr_…`). `sk_live_` is rejected by design. | **Escrow simulator**: deterministic `pi_sim_…` / `tr_sim_…` refs, no network, no money moved. Rows flagged `simulated: true`. |
| `STRIPE_DESTINATIONS` | No | JSON map `exporterRef → acct_…` resolved inside the payout boundary | Destination simulated as `acct_sim_<hash>` (never returned to app context either way). |

Two parts of the T3 flow are **stubbed behind the adapter** and marked
`// TODO: confirm`, because no Trinity contract is deployed in this scaffold:
submitting the signed invocation to a `tee:trade-finance` delegation contract
(`client.execute`), and the immutable T3 ledger write (tenant `logging::audit`
→ `client.getAuditEvents`). The credential mint, identity check, and invocation
signing are all **real SDK crypto** regardless. See "Honest accounting" below.

Smoke tests for each layer:
`node --env-file=.env.local --env-file=.env --import tsx tools/step3-smoke.ts`
(adapter), `.../step4-smoke.ts` (escrow idempotency), and
`npm run smoke:step5` (full lifecycle).

## App surface

The dashboard at `/` is the judge-facing demo console. It lists seeded Letters
of Credit, shows the five-state rail, exposes `Authorize escrow` and
`Simulate delivery` actions, streams live agent events, and shows the audit
ledger with masked proofs/refs.

API routes:

| Route | Purpose |
| --- | --- |
| `GET /health` | Resolve the agent DID through the Terminal 3 SDK. |
| `GET /api/lc` | List Letters of Credit with terms and current state. |
| `POST /api/lc` | Create a new Letter of Credit and contract terms. |
| `POST /api/lc/[id]/authorize` | Mint buyer authorization and lock escrow. |
| `POST /api/webhook/delivery` | Mock Bill-of-Lading delivery webhook. |
| `GET /api/ledger` | Return redacted audit rows. |
| `GET /api/stream` | Server-sent stream of live agent events. |

## Where the SDK fires

Every fund movement / PII resolution routes through `@terminal3/t3n-sdk`. Remove
the SDK and the app breaks by design.

**Identity / session** (`lib/t3/client.ts`):

| SDK call | Purpose | File:line |
| --- | --- | --- |
| `setEnvironment("testnet")` | Pin SDK to the T3 test network | `lib/t3/client.ts:49`, `:95` |
| `loadWasmComponent()` | Load the WASM crypto/state-machine component | `lib/t3/client.ts:50` |
| `eth_get_address(privateKey)` | Derive the agent's ETH address from its secret | `lib/t3/client.ts:74`, `:97` |
| `metamask_sign(address, _, privateKey)` | EthSign handler for the SDK handshake/auth | `lib/t3/client.ts:102` |
| `new T3nClient({ wasmComponent, handlers })` | Construct the authenticated agent client | `lib/t3/client.ts:100` |
| `client.handshake()` | Establish the encrypted session | `lib/t3/client.ts:105` |
| `client.authenticate(createEthAuthInput(address))` | Authenticate + resolve the agent DID | `lib/t3/client.ts:106` |

**Agent-Auth core — the four-function adapter** (`lib/t3/adk.ts`):

| Adapter fn | Real SDK calls | Purpose | File:line |
| --- | --- | --- | --- |
| `mintBuyerAuthorization` | `buildDelegationCredential` · `validateCredentialBody` · `canonicaliseCredential` · `signCredential` · `b64uEncodeBytes` | Buyer signs a delegation credential authorising the agent to release escrow; `vc_id` becomes the opaque buyer placeholder | `lib/t3/adk.ts:125`, `:136`, `:138`, `:139`, `:141` |
| `verifyAgentIdentity` | `createAuthenticatedClient` → `handshake`/`authenticate`/`getDid`/`isAuthenticated` | Confirm the agent DID before any privileged action | `lib/t3/adk.ts:186` |
| `resolveAndPayoutInTEE` | `b64uDecodeStrict` · `buildInvocationPreimage` · `signAgentInvocation` | Agent signs a replay-bound invocation under the buyer's delegation; gates the TEE resolve + payout | `lib/t3/adk.ts:266`, `:272`, `:273` |
| `writeAuditRow` | (SHA-256 receipt + DB) | Immutable audit row + cryptographic receipt hash | `lib/t3/adk.ts` |

The `agent_pubkey` a credential authorises is the agent's 33-byte compressed
secp256k1 key, derived via ethers `SigningKey` (`lib/t3/client.ts:86`).

**Honest accounting:** the credential mint, identity check, and invocation
signing are **real SDK crypto** (verified offline + against testnet in
`tools/step3-smoke.ts`). Two pieces are stubbed behind the adapter and marked
`// TODO: confirm`: submitting the signed invocation to a *deployed*
`tee:trade-finance` delegation contract (`client.execute`), and the immutable
T3 ledger write (a tenant `logging::audit` host call read back via
`client.getAuditEvents`) — neither contract is deployed in this scaffold. The
actual Stripe Connect transfer is injected by Step 4 via `setPayoutExecutor`.

## Build progress

- [x] **Step 1** — Scaffold + onboarding. `/health` resolves the agent DID.
- [x] **Step 2** — Domain model (Prisma + SQLite). `LetterOfCredit`, `ContractTerms`,
  `BillOfLading`, `AuditEntry` in `prisma/schema.prisma`; TS state unions in
  `lib/store/types.ts`. Seeds 3 LCs (valid, port-mismatch, over-value) —
  `npm run db:push && npm run db:seed`. Buyer/exporter stored as opaque
  placeholders only; no raw bank/Stripe data persisted.
- [x] **Step 3** — T3 SDK adapter (core 40%). Four typed fns in `lib/t3/adk.ts`
  wrapping real SDK delegation/identity/invocation crypto; typed errors
  (`IdentityError`/`ResolutionError`/`PayoutError`), redaction guard, and a
  `step` event bus. Verified by `tools/step3-smoke.ts`.
- [x] **Step 4** — Escrow (Stripe Connect, test mode). `lib/escrow`: `lockFunds`
  (manual-capture held PaymentIntent) + `releaseToExporter` (Connect Transfer),
  wired into the Step 3 TEE adapter via `setPayoutExecutor`. Double-fire is
  prevented by a persistent `EscrowTransfer` table with a UNIQUE idempotency key
  (+ Stripe idempotency keys). Runs against real Stripe test mode when
  `STRIPE_SECRET_KEY` is set, else a faithful simulator. The exporter
  destination acct id is resolved server-side and never returned to app context.
  Verified by `tools/step4-smoke.ts`.
- [x] **Step 5** - Agent loop + deterministic policy gate. `lib/agent/run.ts`
  drives `INITIATED -> ESCROWED -> VERIFIED -> EXECUTED -> SETTLED` using
  `mintBuyerAuthorization`, `lockFunds`, advisory BoL parsing, deterministic
  `verifyConditions`, T3 identity verification, TEE payout, and audit rows.
  Denied cases halt after `VERIFIED` with an audit proof. Verified by
  `npm run smoke:step5`, including valid settlement, port mismatch, over-value,
  duplicate delivery, and identity-safety checks.
- [x] **Step 6** - API + SSE event stream. `app/api/*` exposes LC create/list,
  authorization, delivery webhook, ledger, and server-sent `step` events. Every
  JSON response is guarded by the redaction helper in `lib/api/responses.ts`.
- [x] **Step 7** - Dashboard. `app/page.tsx` is a functional demo console with
  LC cards, state rail, authorize/delivery actions, live agent log, secure
  enclave panel, and audit ledger.
- [x] **Step 8** - Edge cases + docs + demo. Failure paths are covered for port
  mismatch, over-value, duplicate delivery, identity mismatch/missing key, and
  post-policy settlement failures. `DEMO.md`, `NEXTSTEPS.md`, and
  `project_readme.md` capture the final walkthrough/status.
