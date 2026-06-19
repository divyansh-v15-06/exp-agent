import { prisma } from "@/lib/store/prisma";
import { BUYER_AUTH_PENDING } from "@/lib/store/types";
import { safeJson, errorJson } from "@/lib/api/responses";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  // Production protection: prevent accidental wipes on production environment
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_RESET !== "true") {
    return new NextResponse("Forbidden: Database reset is disabled in production environment.", { status: 403 });
  }

  try {
    // Idempotent reseed: clear children first (FK order), then parents.
    await prisma.auditEntry.deleteMany();
    await prisma.billOfLading.deleteMany();
    await prisma.escrowTransfer.deleteMany();
    await prisma.contractTerms.deleteMany();
    await prisma.letterOfCredit.deleteMany();

    // LC-1 — VALID: required port == target port, value $25,000 within $50,000 cap.
    await prisma.letterOfCredit.create({
      data: {
        buyerRef: BUYER_AUTH_PENDING,
        exporterRef: "exporter-ref:acme-textiles-001",
        valueCents: 2_500_000,
        currency: "AUD",
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
        currency: "AUD",
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
        currency: "AUD",
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

    return safeJson({ ok: true, message: "Database reset and seeded successfully." });
  } catch (err) {
    return errorJson(err, 500);
  }
}
