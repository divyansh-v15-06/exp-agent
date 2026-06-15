/**
 * Agent loop — drives the Letter-of-Credit state machine (AGENTS.md Step 5).
 *
 *   INITIATED -> ESCROWED        authorizeAndEscrow(): mint buyer authorization
 *                                (T3 SDK) + lock funds (Stripe escrow)
 *   ESCROWED  -> VERIFIED        onDeliveryWebhook(): record BoL, LLM explains
 *                                (advisory), deterministic verifyConditions gates
 *   VERIFIED  -> EXECUTED        gate passed: verify agent identity, resolve +
 *                                payout in TEE
 *   EXECUTED  -> SETTLED         write the final receipt to the audit ledger
 *
 * On a failed gate the LC HALTS at VERIFIED and a 'denied' audit row is written.
 * The LLM may explain its reasoning, but `verifyConditions` — not the model —
 * is the sole authority that releases money.
 */
import { Wallet } from "ethers";
import { prisma } from "../store/prisma";
import type { LcState } from "../store/types";
import {
  mintBuyerAuthorization,
  verifyAgentIdentity,
  resolveAndPayoutInTEE,
  writeAuditRow,
} from "../t3/adk";
import { resolveAgentIdentity } from "../t3/client";
import { lockFunds } from "../escrow"; // import wires setPayoutExecutor (Step 4)
import { emitStep } from "../t3/events";
import { verifyConditions } from "./policy";
import { parseAndExplainBoL } from "./llm";

function buyerDidFor(): string {
  // Demo: the buyer DID is derived from the demo buyer key. In production the
  // buyer's DID comes from their own authenticated session.
  const addr = new Wallet(process.env.T3N_DEMO_BUYER_PRIVATE_KEY!).address;
  return "did:t3n:" + addr.slice(2).toLowerCase();
}

/** Persist a state transition, emit an event, and write an audit row. */
async function transition(
  lcId: string,
  from: LcState,
  to: LcState,
  agentDid: string,
  proof: string,
  txRef?: string,
): Promise<void> {
  await prisma.letterOfCredit.update({ where: { id: lcId }, data: { state: to } });
  emitStep({
    kind: "lc.transition",
    lcId,
    ok: true,
    message: `${from} -> ${to}`,
    data: { from, to },
  });
  await writeAuditRow({ lcId, agentDid, fromState: from, toState: to, proof, txRef });
}

/**
 * INITIATED -> ESCROWED: mint the buyer's delegation authorization (T3 SDK) and
 * lock the buyer's funds in escrow (Stripe Connect).
 */
export async function authorizeAndEscrow(lcId: string) {
  const lc = await prisma.letterOfCredit.findUniqueOrThrow({ where: { id: lcId } });
  if (lc.state !== "INITIATED") {
    throw new Error(`LC ${lcId} must be INITIATED to authorize (is ${lc.state})`);
  }
  const { did: agentDid } = await resolveAgentIdentity();

  // 1. Buyer authorizes the agent (mint cryptographic placeholder).
  const mint = await mintBuyerAuthorization(buyerDidFor(), lcId);
  const buyerPlaceholder = mint.data!.buyerPlaceholder;
  await prisma.letterOfCredit.update({
    where: { id: lcId },
    data: { buyerRef: buyerPlaceholder },
  });

  // 2. Lock the buyer's funds.
  const lock = await lockFunds(lcId, lc.valueCents, lc.currency);

  // 3. INITIATED -> ESCROWED.
  await transition(lcId, "INITIATED", "ESCROWED", agentDid, lock.escrowRef);

  return { state: "ESCROWED" as LcState, buyerPlaceholder, escrowRef: lock.escrowRef };
}

export interface DeliveryInput {
  status: string;
  port: string;
  vesselId: string;
}

export interface DeliveryOutcome {
  state: LcState;
  settled: boolean;
  denied: boolean;
  reasons: string[];
  payoutRef?: string;
}

/**
 * Mock BoL webhook handler (state 3 onward). Records the Bill of Lading, lets
 * the LLM explain (advisory), then the deterministic gate decides. Only on a
 * passing gate does the agent verify identity, resolve + pay out in the TEE,
 * and settle.
 */
export async function onDeliveryWebhook(
  lcId: string,
  delivery: DeliveryInput,
): Promise<DeliveryOutcome> {
  const lc = await prisma.letterOfCredit.findUniqueOrThrow({
    where: { id: lcId },
    include: { terms: true },
  });
  if (!lc.terms) throw new Error(`LC ${lcId} has no contract terms`);
  if (lc.state !== "ESCROWED") {
    throw new Error(`LC ${lcId} must be ESCROWED to verify delivery (is ${lc.state})`);
  }
  const { did: agentDid } = await resolveAgentIdentity();

  // Record the Bill of Lading.
  const bol = await prisma.billOfLading.create({
    data: { lcId, status: delivery.status, port: delivery.port, vesselId: delivery.vesselId },
  });

  // LLM parses + explains — ADVISORY ONLY.
  const assessment = await parseAndExplainBoL(lc.terms, bol, lc);
  emitStep({
    kind: "llm.parse",
    lcId,
    ok: true,
    message: `LLM (${assessment.source}) assessment: ${assessment.opinionMet ? "MET" : "NOT MET"}`,
    data: { explanation: assessment.explanation, opinionMet: assessment.opinionMet },
  });

  // Deterministic gate — THE decision.
  const policy = verifyConditions(lc.terms, bol, lc);
  emitStep({
    kind: "policy.check",
    lcId,
    ok: policy.ok,
    message: policy.ok
      ? "Policy check passed — all conditions satisfied"
      : `Policy check FAILED: ${policy.reasons.join("; ")}`,
    data: { checks: policy.checks },
  });

  // ESCROWED -> VERIFIED (the BoL has been evaluated either way).
  await transition(
    lcId,
    "ESCROWED",
    "VERIFIED",
    agentDid,
    `policy:${policy.ok ? "pass" : "fail"}`,
  );

  if (!policy.ok) {
    // Halt at VERIFIED with a clean rejection + a 'denied' audit row.
    await writeAuditRow({
      lcId,
      agentDid,
      fromState: "VERIFIED",
      toState: "DENIED",
      proof: `denied: ${policy.reasons.join("; ")}`,
    });
    emitStep({
      kind: "lc.transition",
      lcId,
      ok: false,
      message: `Release DENIED — ${policy.reasons.join("; ")}`,
      data: { denied: true },
    });
    return { state: "VERIFIED", settled: false, denied: true, reasons: policy.reasons };
  }

  // Gate passed: confirm agent identity before any privileged action.
  await verifyAgentIdentity(agentDid);

  // Resolve placeholder -> exporter destination inside the TEE and fire payout.
  const payout = await resolveAndPayoutInTEE({
    buyerPlaceholder: lc.buyerRef,
    exporterRef: lc.exporterRef,
    amountCents: lc.valueCents,
    currency: lc.currency,
    lcId,
  });
  const payoutRef = payout.data!.payoutRef;

  // VERIFIED -> EXECUTED -> SETTLED.
  await transition(lcId, "VERIFIED", "EXECUTED", agentDid, payout.proof!, payoutRef);
  await transition(lcId, "EXECUTED", "SETTLED", agentDid, payoutRef, payoutRef);

  return { state: "SETTLED", settled: true, denied: false, reasons: [], payoutRef };
}

/** Convenience: run the full happy path for an LC (authorize -> deliver -> settle). */
export async function runLifecycle(lcId: string, delivery: DeliveryInput) {
  await authorizeAndEscrow(lcId);
  return onDeliveryWebhook(lcId, delivery);
}
