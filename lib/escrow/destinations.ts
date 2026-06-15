/**
 * Exporter-reference -> Stripe Connect destination resolution. SERVER-ONLY.
 *
 * This is the "resolve the placeholder INSIDE the TEE" boundary: the opaque
 * exporterRef stored on a Letter of Credit is mapped here to a real Connect
 * destination account id (acct_…). The resolved acct id is used only to build
 * the Stripe Transfer and is NEVER returned to app context, logged, or stored
 * in the DB — callers receive a redacted ref instead.
 *
 * Mapping source: STRIPE_DESTINATIONS env (JSON object exporterRef -> acct_id).
 * When unset (simulation mode), a deterministic acct_sim_<hash> is derived so
 * the flow stays runnable without configuring connected accounts.
 */
import { createHash } from "node:crypto";

let cachedMap: Record<string, string> | null | undefined;

function loadMap(): Record<string, string> | null {
  if (cachedMap !== undefined) return cachedMap;
  const raw = process.env.STRIPE_DESTINATIONS;
  if (!raw) {
    cachedMap = null;
    return cachedMap;
  }
  try {
    cachedMap = JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error("STRIPE_DESTINATIONS is not valid JSON (expected { exporterRef: acct_id }).");
  }
  return cachedMap;
}

export interface ResolvedDestination {
  /** Stripe Connect account id — sensitive; do not log or return to callers. */
  accountId: string;
  /** Whether this came from a configured map (false) or the simulator (true). */
  simulated: boolean;
}

/**
 * Resolve an exporter reference to a Connect destination account id.
 * Throws if a real mapping is configured but the ref is unknown.
 */
export function resolveDestination(exporterRef: string): ResolvedDestination {
  const map = loadMap();
  if (map) {
    const accountId = map[exporterRef];
    if (!accountId) {
      throw new Error(`No Connect destination configured for exporter reference.`);
    }
    return { accountId, simulated: false };
  }
  // Simulation: deterministic fake destination so payouts are reproducible.
  const hash = createHash("sha256").update(exporterRef).digest("hex").slice(0, 16);
  return { accountId: `acct_sim_${hash}`, simulated: true };
}
