/**
 * Domain types for the Trade Finance agent.
 *
 * SQLite (via Prisma) has no native enums, so the DB stores these as plain
 * strings. These const unions are the single source of truth in TS land — use
 * them everywhere the state machine or BoL status is referenced.
 */

/** The 5-state escrow spine (AGENTS.md) plus two terminal failure states. */
export const LC_STATES = [
  "INITIATED", // buyer + exporter terms entered; buyer authorizes (placeholder minted)
  "ESCROWED", // agent locks funds (Stripe held PaymentIntent / platform balance)
  "VERIFIED", // mock BoL fires; LLM parses; deterministic policy confirms conditions
  "EXECUTED", // agent releases; TEE resolves placeholder -> Connect account; payout fires
  "SETTLED", // Stripe confirms; receipt written to the T3 immutable audit ledger
  "DENIED", // policy gate rejected the release (e.g. port mismatch / over-value)
  "FAILED", // an operation failed (identity invalid, TEE resolve / payout error)
] as const;
export type LcState = (typeof LC_STATES)[number];

/** Bill-of-Lading lifecycle status. */
export const BOL_STATUSES = [
  "PENDING",
  "IN_TRANSIT",
  "DELIVERED",
  "REJECTED",
] as const;
export type BolStatus = (typeof BOL_STATUSES)[number];

/** Placeholder for a buyer authorization that has not been minted yet. */
export const BUYER_AUTH_PENDING = "PENDING_AUTH";

export function isLcState(value: string): value is LcState {
  return (LC_STATES as readonly string[]).includes(value);
}

export function isBolStatus(value: string): value is BolStatus {
  return (BOL_STATUSES as readonly string[]).includes(value);
}
