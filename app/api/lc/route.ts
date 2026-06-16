import { prisma } from "@/lib/store/prisma";
import { BUYER_AUTH_PENDING } from "@/lib/store/types";
import { masked, safeJson, errorJson } from "@/lib/api/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializeLc(lc: {
  id: string;
  buyerRef: string;
  exporterRef: string;
  valueCents: number;
  currency: string;
  targetPort: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  terms: {
    requiredPort: string;
    requiredBolStatus: string;
    maxValueCents: number;
  } | null;
}) {
  return {
    id: lc.id,
    buyerRef: masked(lc.buyerRef),
    exporterRef: masked(lc.exporterRef),
    valueCents: lc.valueCents,
    currency: lc.currency,
    targetPort: lc.targetPort,
    state: lc.state,
    createdAt: lc.createdAt.toISOString(),
    updatedAt: lc.updatedAt.toISOString(),
    terms: lc.terms,
  };
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function asPositiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export async function GET() {
  try {
    const lcs = await prisma.letterOfCredit.findMany({
      include: { terms: true },
      orderBy: { createdAt: "asc" },
    });
    return safeJson({ ok: true, data: lcs.map(serializeLc) });
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const terms = (body.terms ?? {}) as Record<string, unknown>;

    const lc = await prisma.letterOfCredit.create({
      data: {
        buyerRef: BUYER_AUTH_PENDING,
        exporterRef: asString(body.exporterRef, "exporterRef"),
        valueCents: asPositiveInt(body.valueCents, "valueCents"),
        currency: asString(body.currency ?? "USD", "currency").toUpperCase(),
        targetPort: asString(body.targetPort, "targetPort"),
        state: "INITIATED",
        terms: {
          create: {
            requiredPort: asString(terms.requiredPort ?? body.targetPort, "terms.requiredPort"),
            requiredBolStatus: asString(terms.requiredBolStatus ?? "DELIVERED", "terms.requiredBolStatus"),
            maxValueCents: asPositiveInt(terms.maxValueCents ?? body.valueCents, "terms.maxValueCents"),
          },
        },
      },
      include: { terms: true },
    });

    return safeJson({ ok: true, data: serializeLc(lc) }, { status: 201 });
  } catch (err) {
    return errorJson(err, 400);
  }
}

