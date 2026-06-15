/**
 * Stripe client factory (test mode). SERVER-ONLY.
 *
 * Real Stripe Connect test-mode calls fire when STRIPE_SECRET_KEY is set;
 * otherwise the escrow layer falls back to a faithful offline simulator (same
 * id shapes, flagged `simulated`) so the whole flow runs without credentials.
 *
 * Only a test key is ever accepted — a live key (`sk_live_…`) is rejected so
 * this demo can never touch real money.
 */
import Stripe from "stripe";

let cached: Stripe | null | undefined;

/** Returns a Stripe client, or null when running in simulation mode. */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    cached = null;
    return cached;
  }
  if (key.startsWith("sk_live_")) {
    throw new Error(
      "Refusing to use a live Stripe key. This demo is test-mode only — use an sk_test_ key.",
    );
  }
  // Omit apiVersion to use the account default and avoid pinning a literal that
  // drifts across @types/stripe releases.
  cached = new Stripe(key);
  return cached;
}

/** True when real Stripe test-mode calls will be made. */
export function isLiveStripe(): boolean {
  return getStripe() !== null;
}
