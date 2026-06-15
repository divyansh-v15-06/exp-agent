/**
 * Step 4 smoke test — Stripe Connect escrow (simulator mode) + idempotency.
 * Run: node --env-file=.env.local --env-file=.env --import tsx tools/step4-smoke.ts
 */
import { prisma } from "../lib/store/prisma";
import { lockFunds } from "../lib/escrow"; // import wires the real executor
import { mintBuyerAuthorization, resolveAndPayoutInTEE } from "../lib/t3/adk";
import { onStep } from "../lib/t3/events";

async function main() {
  onStep((e) => console.log(`  [step] ${e.kind} ok=${e.ok} :: ${e.message}`));

  const lc = await prisma.letterOfCredit.findFirstOrThrow({ orderBy: { exporterRef: "asc" } });
  console.log("using LC:", lc.id, lc.exporterRef, `${lc.currency} ${lc.valueCents / 100}`);

  console.log("\n1) lockFunds (first call)");
  const lock1 = await lockFunds(lc.id, lc.valueCents, lc.currency);
  console.log("   escrowRef:", lock1.escrowRef, "status:", lock1.status, "simulated:", lock1.simulated, "reused:", lock1.reused);

  console.log("\n2) lockFunds again (idempotent -> reused, same ref)");
  const lock2 = await lockFunds(lc.id, lc.valueCents, lc.currency);
  console.log("   escrowRef:", lock2.escrowRef, "reused:", lock2.reused, "SAME:", lock1.escrowRef === lock2.escrowRef);

  console.log("\n3) mint + releaseToExporter via TEE adapter (first payout)");
  const mint = await mintBuyerAuthorization("did:t3n:" + "ab".repeat(20), lc.id);
  const payInput = {
    buyerPlaceholder: mint.data!.buyerPlaceholder,
    exporterRef: lc.exporterRef,
    amountCents: lc.valueCents,
    currency: lc.currency,
    lcId: lc.id,
  };
  const pay1 = await resolveAndPayoutInTEE(payInput);
  console.log("   payoutRef:", pay1.data?.payoutRef, "dest:", pay1.data?.destinationMasked);

  console.log("\n4) payout retry (same logical settlement -> must NOT double-fire)");
  const pay2 = await resolveAndPayoutInTEE(payInput);
  console.log("   payoutRef:", pay2.data?.payoutRef, "SAME:", pay1.data?.payoutRef === pay2.data?.payoutRef);

  const releases = await prisma.escrowTransfer.count({ where: { kind: "RELEASE", lcId: lc.id } });
  const locks = await prisma.escrowTransfer.count({ where: { kind: "LOCK", lcId: lc.id } });
  console.log("\nledger rows for LC:", { locks, releases });

  if (lock1.escrowRef !== lock2.escrowRef) throw new Error("lock not idempotent");
  if (pay1.data?.payoutRef !== pay2.data?.payoutRef) throw new Error("payout double-fired");
  if (releases !== 1 || locks !== 1) throw new Error(`expected exactly 1 lock + 1 release, got ${locks}/${releases}`);

  console.log("\nSMOKE OK (no double-fire)");
}

main()
  .catch((e) => {
    console.error("SMOKE FAILED:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
