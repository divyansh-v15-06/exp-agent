/**
 * Step 5 smoke test - full agent lifecycle.
 *
 * Run:
 *   node --env-file=.env.local --env-file=.env --import tsx tools/step5-smoke.ts
 *
 * This exercises the agent loop, not just the lower-level adapters:
 *   - valid seeded LC settles end-to-end
 *   - port mismatch LC is denied with an audit proof
 *   - over-value LC is denied with an audit proof
 *   - duplicate delivery after settlement is rejected without another release
 */
import { prisma } from "../lib/store/prisma";
import { BUYER_AUTH_PENDING } from "../lib/store/types";
import { authorizeAndEscrow, onDeliveryWebhook } from "../lib/agent/run";
import { onStep } from "../lib/t3/events";
import { verifyAgentIdentity } from "../lib/t3/adk";
import { IdentityError } from "../lib/t3/errors";

interface ScenarioSeed {
  label: string;
  exporterRef: string;
  valueCents: number;
  targetPort: string;
  requiredPort: string;
  maxValueCents: number;
  expectSettled: boolean;
  expectedReasonFragment?: string;
}

const scenarios: ScenarioSeed[] = [
  {
    label: "valid",
    exporterRef: "exporter-ref:acme-textiles-001",
    valueCents: 2_500_000,
    targetPort: "Port of Rotterdam (NLRTM)",
    requiredPort: "Port of Rotterdam (NLRTM)",
    maxValueCents: 5_000_000,
    expectSettled: true,
  },
  {
    label: "port-mismatch",
    exporterRef: "exporter-ref:north-sea-foods-002",
    valueCents: 1_800_000,
    targetPort: "Port of Rotterdam (NLRTM)",
    requiredPort: "Port of Hamburg (DEHAM)",
    maxValueCents: 5_000_000,
    expectSettled: false,
    expectedReasonFragment: "Port of Hamburg",
  },
  {
    label: "over-value",
    exporterRef: "exporter-ref:pacific-machinery-003",
    valueCents: 9_500_000,
    targetPort: "Port of Singapore (SGSIN)",
    requiredPort: "Port of Singapore (SGSIN)",
    maxValueCents: 5_000_000,
    expectSettled: false,
    expectedReasonFragment: "cap",
  },
];

async function ensureSmokeSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LetterOfCredit" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "buyerRef" TEXT NOT NULL,
      "exporterRef" TEXT NOT NULL,
      "valueCents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL,
      "targetPort" TEXT NOT NULL,
      "state" TEXT NOT NULL DEFAULT 'INITIATED',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EscrowTransfer" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "lcId" TEXT,
      "kind" TEXT NOT NULL,
      "idempotencyKey" TEXT NOT NULL,
      "ref" TEXT NOT NULL,
      "amountCents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "simulated" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "EscrowTransfer_lcId_fkey" FOREIGN KEY ("lcId") REFERENCES "LetterOfCredit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "EscrowTransfer_idempotencyKey_key"
    ON "EscrowTransfer"("idempotencyKey")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ContractTerms" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "lcId" TEXT NOT NULL,
      "requiredPort" TEXT NOT NULL,
      "requiredBolStatus" TEXT NOT NULL,
      "maxValueCents" INTEGER NOT NULL,
      CONSTRAINT "ContractTerms_lcId_fkey" FOREIGN KEY ("lcId") REFERENCES "LetterOfCredit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ContractTerms_lcId_key"
    ON "ContractTerms"("lcId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BillOfLading" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "lcId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "port" TEXT NOT NULL,
      "vesselId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BillOfLading_lcId_fkey" FOREIGN KEY ("lcId") REFERENCES "LetterOfCredit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AuditEntry" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "lcId" TEXT,
      "agentDid" TEXT NOT NULL,
      "fromState" TEXT NOT NULL,
      "toState" TEXT NOT NULL,
      "proof" TEXT NOT NULL,
      "txRef" TEXT,
      "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AuditEntry_lcId_fkey" FOREIGN KEY ("lcId") REFERENCES "LetterOfCredit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
}

function requireEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`${name} is required. Load .env.local/.env before running this smoke test.`);
  }
}

async function reseedSmokeData() {
  await prisma.auditEntry.deleteMany();
  await prisma.escrowTransfer.deleteMany();
  await prisma.billOfLading.deleteMany();
  await prisma.contractTerms.deleteMany();
  await prisma.letterOfCredit.deleteMany();

  const created = [];
  for (const scenario of scenarios) {
    const lc = await prisma.letterOfCredit.create({
      data: {
        buyerRef: BUYER_AUTH_PENDING,
        exporterRef: scenario.exporterRef,
        valueCents: scenario.valueCents,
        currency: "USD",
        targetPort: scenario.targetPort,
        state: "INITIATED",
        terms: {
          create: {
            requiredPort: scenario.requiredPort,
            requiredBolStatus: "DELIVERED",
            maxValueCents: scenario.maxValueCents,
          },
        },
      },
    });
    created.push({ ...scenario, lcId: lc.id });
  }
  return created;
}

async function assertCounts(lcId: string, expected: { locks: number; releases: number }) {
  const [locks, releases] = await Promise.all([
    prisma.escrowTransfer.count({ where: { lcId, kind: "LOCK" } }),
    prisma.escrowTransfer.count({ where: { lcId, kind: "RELEASE" } }),
  ]);
  if (locks !== expected.locks || releases !== expected.releases) {
    throw new Error(
      `LC ${lcId} expected ${expected.locks} lock(s) and ${expected.releases} release(s), got ${locks}/${releases}`,
    );
  }
}

async function createIdentityFailureLc() {
  return prisma.letterOfCredit.create({
    data: {
      buyerRef: BUYER_AUTH_PENDING,
      exporterRef: "exporter-ref:identity-failure-004",
      valueCents: 1_000_000,
      currency: "USD",
      targetPort: "Port of Rotterdam (NLRTM)",
      state: "INITIATED",
      terms: {
        create: {
          requiredPort: "Port of Rotterdam (NLRTM)",
          requiredBolStatus: "DELIVERED",
          maxValueCents: 2_000_000,
        },
      },
    },
  });
}

async function assertIdentityFailuresDoNotMutateState() {
  console.log("\nScenario: identity-safety");

  try {
    await verifyAgentIdentity("did:t3n:" + "00".repeat(20));
    throw new Error("Identity mismatch unexpectedly succeeded.");
  } catch (err) {
    if (!(err instanceof IdentityError)) throw err;
    console.log("  mismatch rejected:", err.code);
  }

  const lc = await createIdentityFailureLc();
  const originalAgentKey = process.env.T3N_AGENT_PRIVATE_KEY;
  delete process.env.T3N_AGENT_PRIVATE_KEY;
  try {
    await authorizeAndEscrow(lc.id);
    throw new Error("Missing agent key unexpectedly authorized an LC.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("T3N_AGENT_PRIVATE_KEY")) throw err;
  } finally {
    process.env.T3N_AGENT_PRIVATE_KEY = originalAgentKey;
  }

  const unchanged = await prisma.letterOfCredit.findUniqueOrThrow({ where: { id: lc.id } });
  const movements = await prisma.escrowTransfer.count({ where: { lcId: lc.id } });
  if (unchanged.state !== "INITIATED" || unchanged.buyerRef !== BUYER_AUTH_PENDING || movements !== 0) {
    throw new Error(`Missing-key failure mutated LC ${lc.id}: state=${unchanged.state}, movements=${movements}`);
  }
  console.log("  missing key rejected before mutation");
}

async function main() {
  requireEnv("DATABASE_URL");
  requireEnv("T3N_AGENT_PRIVATE_KEY");
  requireEnv("T3N_DEMO_BUYER_PRIVATE_KEY");

  onStep((e) => console.log(`  [step] ${e.kind} ok=${e.ok} :: ${e.message}`));

  await ensureSmokeSchema();
  const seeded = await reseedSmokeData();
  console.log(`Seeded ${seeded.length} lifecycle smoke scenarios.`);

  for (const scenario of seeded) {
    console.log(`\nScenario: ${scenario.label} (${scenario.lcId})`);

    const auth = await authorizeAndEscrow(scenario.lcId);
    console.log("  authorized:", auth.state, "escrowRef:", auth.escrowRef);

    const outcome = await onDeliveryWebhook(scenario.lcId, {
      status: "DELIVERED",
      port: scenario.targetPort,
      vesselId: `VESSEL-${scenario.label.toUpperCase()}`,
    });
    console.log("  outcome:", outcome);

    const lc = await prisma.letterOfCredit.findUniqueOrThrow({
      where: { id: scenario.lcId },
      include: { auditTrail: true },
    });

    if (scenario.expectSettled) {
      if (!outcome.settled || outcome.denied || lc.state !== "SETTLED") {
        throw new Error(`Expected ${scenario.label} to settle, got outcome ${JSON.stringify(outcome)} and state ${lc.state}`);
      }
      await assertCounts(scenario.lcId, { locks: 1, releases: 1 });

      try {
        await onDeliveryWebhook(scenario.lcId, {
          status: "DELIVERED",
          port: scenario.targetPort,
          vesselId: "VESSEL-DUPLICATE",
        });
        throw new Error("Duplicate delivery unexpectedly succeeded after settlement.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("must be ESCROWED")) throw err;
      }
      await assertCounts(scenario.lcId, { locks: 1, releases: 1 });
      console.log("  duplicate delivery rejected without double release");
      continue;
    }

    if (!outcome.denied || outcome.settled || lc.state !== "VERIFIED") {
      throw new Error(`Expected ${scenario.label} to be denied at VERIFIED, got ${JSON.stringify(outcome)} and state ${lc.state}`);
    }
    if (
      scenario.expectedReasonFragment &&
      !outcome.reasons.some((reason) => reason.includes(scenario.expectedReasonFragment!))
    ) {
      throw new Error(`Expected denial reason to include ${scenario.expectedReasonFragment}, got ${outcome.reasons.join("; ")}`);
    }

    const deniedAudit = lc.auditTrail.find(
      (entry) => entry.fromState === "VERIFIED" && entry.toState === "DENIED",
    );
    if (!deniedAudit) throw new Error(`Expected denied audit row for ${scenario.label}`);
    await assertCounts(scenario.lcId, { locks: 1, releases: 0 });
  }

  await assertIdentityFailuresDoNotMutateState();

  console.log("\nSMOKE OK (Step 5 lifecycle)");
}

main()
  .catch((err) => {
    console.error("SMOKE FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
