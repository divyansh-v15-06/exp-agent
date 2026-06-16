import { onDeliveryWebhook } from "@/lib/agent/run";
import { masked, safeJson, errorJson } from "@/lib/api/responses";
import { isBolStatus } from "@/lib/store/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const lcId = asString(body.lcId, "lcId");
    const status = asString(body.status ?? "DELIVERED", "status");
    if (!isBolStatus(status)) {
      throw new Error(`status must be one of PENDING, IN_TRANSIT, DELIVERED, REJECTED`);
    }

    const result = await onDeliveryWebhook(lcId, {
      status,
      port: asString(body.port, "port"),
      vesselId: asString(body.vesselId, "vesselId"),
    });

    return safeJson({
      ok: true,
      data: {
        ...result,
        payoutRef: masked(result.payoutRef),
      },
    });
  } catch (err) {
    return errorJson(err, 400);
  }
}

