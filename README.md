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

## Where the SDK fires

Every fund movement / PII resolution routes through `@terminal3/t3n-sdk`. Remove
the SDK and the app breaks by design.

| SDK call | Purpose | File:line |
| --- | --- | --- |
| `setEnvironment("testnet")` | Pin SDK to the T3 test network | `lib/t3/client.ts:51`, `lib/t3/client.ts:72` |
| `loadWasmComponent()` | Load the WASM crypto/state-machine component | `lib/t3/client.ts:52` |
| `eth_get_address(privateKey)` | Derive the agent's ETH address from its secret | `lib/t3/client.ts:75` |
| `metamask_sign(address, _, privateKey)` | EthSign handler for the SDK handshake/auth | `lib/t3/client.ts:81` |
| `new T3nClient({ wasmComponent, handlers })` | Construct the authenticated agent client | `lib/t3/client.ts:78` |
| `client.handshake()` | Establish the encrypted session | `lib/t3/client.ts:85` |
| `client.authenticate(createEthAuthInput(address))` | Authenticate + resolve the agent DID | `lib/t3/client.ts:86` |

_(Line numbers are refreshed as the code evolves. The four-function core adapter —
mint authorization, verify identity, resolve+payout in TEE, write audit row —
lands in `lib/t3/adk.ts` at Step 3.)_

## Build progress

- [x] **Step 1** — Scaffold + onboarding. `/health` resolves the agent DID.
- [x] **Step 2** — Domain model (Prisma + SQLite). `LetterOfCredit`, `ContractTerms`,
  `BillOfLading`, `AuditEntry` in `prisma/schema.prisma`; TS state unions in
  `lib/store/types.ts`. Seeds 3 LCs (valid, port-mismatch, over-value) —
  `npm run db:push && npm run db:seed`. Buyer/exporter stored as opaque
  placeholders only; no raw bank/Stripe data persisted.
- [ ] Step 3 — T3 SDK adapter (core).
- [ ] Step 4 — Escrow (Stripe Connect, test mode).
- [ ] Step 5 — Agent loop + deterministic policy gate.
- [ ] Step 6 — API + SSE event stream.
- [ ] Step 7 — Dashboard.
- [ ] Step 8 — Edge cases + docs + demo.
