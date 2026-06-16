# DEMO.md - Judge Walkthrough

This walkthrough shows the project in under five minutes.

## Setup

```bash
npm install
cp .env.example .env.local
npm run db:push
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

Required local env values:

- `DATABASE_URL="file:./dev.db"`
- `T3N_AGENT_PRIVATE_KEY=0x...`
- `T3N_DEMO_BUYER_PRIVATE_KEY=0x...`

Stripe is optional. Without `STRIPE_SECRET_KEY`, the app uses simulator escrow
refs such as `pi_sim_*` and `tr_sim_*`.

## Happy Path

1. Open the dashboard.
2. Select the valid Rotterdam Letter of Credit.
3. Click `Authorize escrow`.
4. Watch the state move from `INITIATED` to `ESCROWED`.
5. Click `Simulate delivery`.
6. Watch the live agent log:
   - buyer authorization minted
   - escrow locked
   - BoL parsed
   - deterministic policy passed
   - agent identity verified
   - placeholder resolved inside TEE
   - payout fired
   - audit rows written
7. Confirm final state is `SETTLED`.
8. Confirm the audit ledger shows `EXECUTED -> SETTLED`.

## Denied Case: Port Mismatch

1. Select the LC whose target port is Rotterdam but terms require Hamburg.
2. Click `Authorize escrow`.
3. Click `Simulate delivery`.
4. The policy gate rejects release because the delivery port does not match the
   contract terms.
5. Confirm no release transfer is created.
6. Confirm the audit ledger includes `VERIFIED -> DENIED`.

## Denied Case: Over Value

1. Select the Singapore LC whose value exceeds the contract cap.
2. Click `Authorize escrow`.
3. Click `Simulate delivery`.
4. The policy gate rejects release because value exceeds the max cap.
5. Confirm no release transfer is created.
6. Confirm the audit ledger includes `VERIFIED -> DENIED`.

## API Checks

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/lc
curl -s http://localhost:3000/api/ledger
curl -N http://localhost:3000/api/stream
```

## Smoke Test

```bash
npm run smoke:step5
```

This verifies:

- valid LC settles end-to-end
- port mismatch denies with audit proof
- over-value denies with audit proof
- duplicate delivery after settlement does not double-release
- DID mismatch is rejected
- missing agent key fails before mutating LC state or escrow rows

