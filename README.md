# Autonomous TEE Trade Finance (Letter of Credit) Agent

> Built for the **Terminal 3 ADK Bounty Challenge** — "Best Agent utilising Terminal 3 Agent Auth SDK".

An autonomous escrow agent for international trade finance executing Letter of Credit agreements. The agent locks a buyer's funds, verifies logistics delivery rules, and releases payment to the exporter. 

By executing the trade rules and payment resolution inside a secure **Trusted Execution Environment (TEE)** boundary via the **Terminal 3 Agent Auth SDK**, the agent never exposes sensitive keys or exporter destination accounts, and every state transition is recorded in an immutable cryptographic audit ledger.

---

## 🌍 The Real-World Problem & Solution

In international trade, **Letters of Credit (LC)** are slow, manual, paper-heavy, and prone to fraud:
1. **High Friction**: Traditional LCs require manual validation of physical Bills of Lading (BoL) and customs paperwork.
2. **Confidentiality vs. Auditing**: Exporters want to keep their logistics accounts and payment destinations private, but regulators and banks need audit trails to prevent fraud.
3. **API Key & Settlement Exposure**: Storing sensitive merchant payout keys (like Stripe Secret Keys) leaves them vulnerable to database leaks and server exploits.

### 🛡️ How Our Project Solves It
* **TEE-Shielded Settlements**: Payout credentials and exporter destinations are resolved strictly inside the TEE enclave boundary. The parent application has zero access to these secrets.
* **Autonomous Gated Policy**: The TEE acts as an impartial cryptographic arbiter, consuming delivery webhooks and executing payouts automatically when policy conditions are met.
* **Privacy-Preserving Audit Ledger**: Every transaction state transition generates a cryptographic claim (a T3 proof) signed by the agent's DID, letting auditors inspect compliance without exposing underlying trade secrets.

---

## 🎨 Premium Visual & UX Features

*   **Dynamic creation**: Click **CREATE CONTRACT** in the console header to deploy new custom Letters of Credit on-the-fly.
*   **TEE Policy Customization**: Toggle *Customize TEE Policy Rules* in the creation form to set independent required ports or value limit caps—making it simple to test and demonstrate port/value policy violations.
*   **Stripe Sandbox Helper**: Pre-populated defaults steer deployment toward `exporter-ref:acme-textiles-001` to ensure successful Stripe destination mapping.
*   **TEE Cryptographic Flowchart**: An interactive, color-coded SVG flowchart dynamically maps client, enclave, and settlement zones for the inspected transaction receipt.
*   **T3 Proof Exporter**: A "Download JSON" proof exporter saves signed cryptographic T3 proofs (`t3-proof-*.json`) directly to the user's browser.

---

## 🔄 Lifecycle State Machine

```text
INITIATED ──> ESCROWED ──> VERIFIED ──> EXECUTED ──> SETTLED
```

*   **INITIATED**: Buyer + exporter terms entered.
*   **ESCROWED**: Buyer authorizes via T3 SDK; agent locks funds (Stripe held PaymentIntent).
*   **VERIFIED**: Mock Bill of Lading webhook fires; deterministic policy code confirms conditions.
*   **EXECUTED**: Agent signs a replay-bound invocation under the buyer's delegation. TEE resolves exporter placeholder and releases payment.
*   **SETTLED**: Stripe transfer completes; T3 cryptographic receipt written to the audit ledger.

---

## 📂 Codebase File Map

| File | Purpose |
| --- | --- |
| `app/page.tsx` | Dashboard console UI with flowchart, inspector drawer, and creation modal. |
| `app/api/lc/route.ts` | List (`GET`) and dynamically create (`POST`) Letters of Credit. |
| `app/api/lc/[id]/authorize/route.ts` | Mint buyer delegation credential and lock escrow. |
| `app/api/webhook/delivery/route.ts` | Simulated Bill-of-Lading cargo delivery webhook. |
| `lib/t3/client.ts` | Handshake and connection handler for Terminal 3 SDK. |
| `lib/t3/adk.ts` | Core SDK adapter (credential minting, identity verification, TEE invocation signing). |
| `lib/escrow/index.ts` | Stripe payments and Connect transfers handling with idempotency safety. |
| `lib/escrow/destinations.ts` | Resolves exporter references to Connect destinations inside the TEE boundary. |
| `prisma/schema.prisma` | Domain SQLite model defining `LetterOfCredit`, `ContractTerms`, and `AuditEntry`. |

---

## 🚀 Quick Start & Run Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Environment
Copy the example environment file:
```bash
cp .env.example .env.local
```
*A throwaway private key and DID seed ship pre-configured in `.env.local` for instant testing.*

### 3. Initialize Database
Push schema and seed initial demo Letters of Credit:
```bash
npm run db:push
npm run db:seed
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔬 Testing & Verification

Run the full end-to-end integration and policy boundary test suite:
```bash
npm run smoke:step5
```
This test suite verifies successful settlement, port mismatch denials, value limit caps, duplicate execution prevention, and agent identity mismatch safeguards.
