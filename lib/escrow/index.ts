/**
 * Escrow via Stripe Connect (test mode). SERVER-ONLY. (AGENTS.md Step 4)
 *
 *   lockFunds(lcId, amount)      -> hold the buyer's funds (manual-capture
 *                                   PaymentIntent). Returns an opaque escrow
 *                                   ref, never raw card data.
 *   releaseToExporter(ctx)        -> Connect Transfer to the exporter's resolved
 *                                   destination account. Called ONLY by the
 *                                   Step 3 TEE adapter (wired via setPayoutExecutor).
 *
 * Double-fire safety: every money movement is keyed by an idempotency key and
 * recorded in the EscrowTransfer table whose UNIQUE(idempotencyKey) index makes
 * a second attempt return the original ref instead of moving money again. The
 * same key is also passed to Stripe's own idempotency layer.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../store/prisma";
import { getStripe, isLiveStripe } from "./stripe";
import { resolveDestination } from "./destinations";
import {
  setPayoutExecutor,
  type PayoutContext,
  type PayoutOutcome,
} from "../t3/adk";
import { PayoutError } from "../t3/errors";
import { maskRef } from "../t3/redact";
import { emitStep } from "../t3/events";

function simRef(prefix: string, key: string): string {
  return `${prefix}_sim_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export interface LockResult {
  escrowRef: string;
  status: string;
  simulated: boolean;
  /** True when an existing lock was returned (idempotent replay). */
  reused: boolean;
}

/**
 * Lock (hold) the buyer's funds for an LC. Idempotent on `lock:<lcId>`.
 */
export async function lockFunds(
  lcId: string,
  amountCents: number,
  currency = "aud",
): Promise<LockResult> {
  const idempotencyKey = `lock:${lcId}`;
  const cur = currency.toLowerCase();

  const existing = await prisma.escrowTransfer.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { escrowRef: existing.ref, status: existing.status, simulated: existing.simulated, reused: true };
  }

  let ref: string;
  let status: string;
  const simulated = !isLiveStripe();
  try {
    const stripe = getStripe();
    if (stripe) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: cur,
          capture_method: "manual", // authorize/hold — do not capture (escrow)
          payment_method_types: ["card"],
          payment_method: "pm_card_visa", // Stripe test token; never a real card
          confirm: true,
        },
        { idempotencyKey },
      );
      ref = pi.id;
      status = pi.status; // expected: "requires_capture" (funds held)
    } else {
      ref = simRef("pi", idempotencyKey);
      status = "requires_capture";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "lockFunds failed";
    emitStep({ kind: "escrow.lock", lcId, ok: false, message });
    throw new PayoutError(message, "LOCK_FAILED");
  }

  const row = await upsertTransfer({
    lcId,
    kind: "LOCK",
    idempotencyKey,
    ref,
    amountCents,
    currency: cur,
    status,
    simulated,
  });

  emitStep({
    kind: "escrow.lock",
    lcId,
    ok: true,
    message: `Escrow locked ${maskRef(row.ref)} (${status}${simulated ? ", simulated" : ""})`,
    proof: row.ref,
    data: { status, simulated },
  });

  return { escrowRef: row.ref, status: row.status, simulated: row.simulated, reused: false };
}

/**
 * Release escrowed funds to the exporter via a Connect Transfer. Matches the
 * Step 3 {@link PayoutExecutor} signature and is wired in via setPayoutExecutor.
 * Idempotent on `ctx.idempotencyKey`; the exporter destination account id is
 * resolved internally and never returned to app context.
 */
export async function releaseToExporter(ctx: PayoutContext): Promise<PayoutOutcome> {
  const destinationMasked = maskRef(ctx.exporterRef);

  const existing = await prisma.escrowTransfer.findUnique({
    where: { idempotencyKey: ctx.idempotencyKey },
  });
  if (existing) {
    return { payoutRef: existing.ref, destinationMasked };
  }

  // Resolve placeholder -> Connect destination. acct id stays in this scope.
  const { accountId, simulated: destSimulated } = resolveDestination(ctx.exporterRef);
  const cur = (ctx.currency ?? "aud").toLowerCase();

  let ref: string;
  const simulated = !isLiveStripe();
  try {
    const stripe = getStripe();
    if (stripe) {
      let source_transaction: string | undefined;
      if (ctx.lcId) {
        const lock = await prisma.escrowTransfer.findFirst({
          where: { lcId: ctx.lcId, kind: "LOCK" },
        });
        if (lock && lock.ref.startsWith("pi_")) {
          // Capture the hold so we actually collect the funds from the buyer
          const pi = await stripe.paymentIntents.capture(lock.ref);
          if (pi.latest_charge) {
            source_transaction = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id;
          }
        }
      }

      const transfer = await stripe.transfers.create(
        { amount: ctx.amountCents, currency: cur, destination: accountId, source_transaction },
        { idempotencyKey: ctx.idempotencyKey },
      );
      ref = transfer.id;
    } else {
      ref = simRef("tr", ctx.idempotencyKey);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "transfer failed";
    throw new PayoutError(message, "TRANSFER_FAILED");
  }

  const row = await upsertTransfer({
    lcId: ctx.lcId ?? null,
    kind: "RELEASE",
    idempotencyKey: ctx.idempotencyKey,
    ref,
    amountCents: ctx.amountCents,
    currency: cur,
    status: "paid",
    simulated: simulated || destSimulated,
  });

  return { payoutRef: row.ref, destinationMasked };
}

/**
 * Insert an EscrowTransfer, treating a UNIQUE(idempotencyKey) collision as a
 * concurrent duplicate and returning the row that won the race. This is the
 * restart/concurrency-safe half of the double-fire guard.
 */
async function upsertTransfer(data: {
  lcId: string | null;
  kind: string;
  idempotencyKey: string;
  ref: string;
  amountCents: number;
  currency: string;
  status: string;
  simulated: boolean;
}) {
  try {
    return await prisma.escrowTransfer.create({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.escrowTransfer.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (winner) return winner;
    }
    throw err;
  }
}

/** Wire the real Stripe executor into the Step 3 TEE adapter. */
export function registerEscrowExecutor(): void {
  setPayoutExecutor(releaseToExporter);
}

// Auto-register on import so any consumer of the escrow layer (the agent loop)
// gets the real executor wired without an explicit setup call.
registerEscrowExecutor();
