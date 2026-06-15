/**
 * Seed 3 Letters of Credit, each encoding a distinct verification scenario so
 * the policy gate (Step 5) can be demoed end-to-end:
 *
 *   LC-1  VALID         — required port matches target, value within cap -> settles
 *   LC-2  PORT MISMATCH — terms require a different port than the cargo's target
 *                         -> the simulated delivery's port won't match -> DENIED
 *   LC-3  OVER VALUE    — LC value exceeds the contract's max-value cap -> DENIED
 *
 * The edge cases are encoded purely in the seeded ContractTerms vs the LC, so
 * no pre-baked BillOfLading is needed — the Step 5 "Simulate Port Delivery"
 * webhook will surface them naturally.
 *
 * HARD CONSTRAINT: buyerRef / exporterRef are OPAQUE placeholders, never raw
 * bank / Stripe account data. The TEE resolves them at payout time.
 */
import { PrismaClient } from "@prisma/client";
import { BUYER_AUTH_PENDING } from "../lib/store/types";

const prisma = new PrismaClient();

async function main() {
  // Idempotent reseed: clear children first (FK order), then parents.
  await prisma.auditEntry.deleteMany();
  await prisma.billOfLading.deleteMany();
  await prisma.contractTerms.deleteMany();
  await prisma.letterOfCredit.deleteMany();

  // LC-1 — VALID: required port == target port, value $25,000 within $50,000 cap.
  await prisma.letterOfCredit.create({
    data: {
      buyerRef: BUYER_AUTH_PENDING,
      exporterRef: "exporter-ref:acme-textiles-001",
      valueCents: 2_500_000,
      currency: "USD",
      targetPort: "Port of Rotterdam (NLRTM)",
      state: "INITIATED",
      terms: {
        create: {
          requiredPort: "Port of Rotterdam (NLRTM)",
          requiredBolStatus: "DELIVERED",
          maxValueCents: 5_000_000,
        },
      },
    },
  });

  // LC-2 — PORT MISMATCH: cargo targets Rotterdam, but terms require Hamburg.
  await prisma.letterOfCredit.create({
    data: {
      buyerRef: BUYER_AUTH_PENDING,
      exporterRef: "exporter-ref:north-sea-foods-002",
      valueCents: 1_800_000,
      currency: "USD",
      targetPort: "Port of Rotterdam (NLRTM)",
      state: "INITIATED",
      terms: {
        create: {
          requiredPort: "Port of Hamburg (DEHAM)",
          requiredBolStatus: "DELIVERED",
          maxValueCents: 5_000_000,
        },
      },
    },
  });

  // LC-3 — OVER VALUE: value $95,000 exceeds the $50,000 contract cap.
  await prisma.letterOfCredit.create({
    data: {
      buyerRef: BUYER_AUTH_PENDING,
      exporterRef: "exporter-ref:pacific-machinery-003",
      valueCents: 9_500_000,
      currency: "USD",
      targetPort: "Port of Singapore (SGSIN)",
      state: "INITIATED",
      terms: {
        create: {
          requiredPort: "Port of Singapore (SGSIN)",
          requiredBolStatus: "DELIVERED",
          maxValueCents: 5_000_000,
        },
      },
    },
  });

  const count = await prisma.letterOfCredit.count();
  console.log(`Seeded ${count} Letters of Credit (1 valid, 1 port-mismatch, 1 over-value).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
