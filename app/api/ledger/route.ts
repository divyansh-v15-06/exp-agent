import { prisma } from "@/lib/store/prisma";
import { masked, safeJson, errorJson } from "@/lib/api/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await prisma.auditEntry.findMany({
      orderBy: { ts: "desc" },
      take: 100,
    });

    return safeJson({
      ok: true,
      data: entries.map((entry) => ({
        id: entry.id,
        lcId: entry.lcId,
        agentDid: masked(entry.agentDid),
        fromState: entry.fromState,
        toState: entry.toState,
        proof: masked(entry.proof),
        txRef: masked(entry.txRef),
        ts: entry.ts.toISOString(),
      })),
    });
  } catch (err) {
    return errorJson(err);
  }
}

