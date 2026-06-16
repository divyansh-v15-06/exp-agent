import { authorizeAndEscrow } from "@/lib/agent/run";
import { masked, safeJson, errorJson } from "@/lib/api/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const result = await authorizeAndEscrow(params.id);
    return safeJson({
      ok: true,
      data: {
        state: result.state,
        buyerPlaceholder: masked(result.buyerPlaceholder),
        escrowRef: masked(result.escrowRef),
      },
    });
  } catch (err) {
    return errorJson(err, 400);
  }
}

