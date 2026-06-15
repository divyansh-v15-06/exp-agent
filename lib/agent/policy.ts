/**
 * Deterministic policy gate (AGENTS.md §0 + Step 5).
 *
 * THIS is the only thing that may authorise a payout. The LLM (lib/agent/llm.ts)
 * may parse the Bill of Lading and explain its reasoning, but it is advisory —
 * `verifyConditions` is plain, auditable TypeScript and is the sole gate on
 * releasing money. Never let the model be the decision-maker.
 */
import type { BolStatus } from "../store/types";

export interface ContractTermsLike {
  requiredPort: string;
  requiredBolStatus: string;
  maxValueCents: number;
}

export interface BillOfLadingLike {
  status: string;
  port: string;
  vesselId: string;
}

export interface LcLike {
  valueCents: number;
  targetPort: string;
}

export interface ConditionCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PolicyResult {
  ok: boolean;
  checks: ConditionCheck[];
  /** Human-readable failure reasons (empty when ok). */
  reasons: string[];
}

/**
 * Verify delivery conditions against contract terms. Returns ok only if EVERY
 * check passes. Pure function — no I/O, no model, fully deterministic.
 */
export function verifyConditions(
  terms: ContractTermsLike,
  bol: BillOfLadingLike,
  lc: LcLike,
): PolicyResult {
  const checks: ConditionCheck[] = [
    {
      name: "bol_status",
      ok: bol.status === terms.requiredBolStatus,
      detail: `BoL status ${bol.status} vs required ${terms.requiredBolStatus}`,
    },
    {
      name: "port_match",
      ok: bol.port === terms.requiredPort,
      detail: `delivered to ${bol.port} vs required ${terms.requiredPort}`,
    },
    {
      name: "value_within_cap",
      ok: lc.valueCents <= terms.maxValueCents,
      detail: `value ${lc.valueCents} vs cap ${terms.maxValueCents}`,
    },
  ];

  const reasons = checks.filter((c) => !c.ok).map((c) => c.detail);
  return { ok: reasons.length === 0, checks, reasons };
}

/** Convenience: the BoL statuses the policy treats as "delivered". */
export const DELIVERED: BolStatus = "DELIVERED";
