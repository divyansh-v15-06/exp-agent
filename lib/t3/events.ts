/**
 * In-process event bus for agent "step" events. The adapter emits one per
 * privileged action; the dashboard SSE stream (Step 6) subscribes and relays
 * them to the "Secure Enclave View".
 *
 * Every emitted event is run through the redaction guard, so a step can never
 * carry raw account data to the UI.
 */
import { EventEmitter } from "node:events";
import { assertNoRawAccountData } from "./redact";

export type StepKind =
  | "identity.verify"
  | "authorization.mint"
  | "escrow.lock"
  | "llm.parse"
  | "policy.check"
  | "tee.resolve"
  | "payout.fire"
  | "audit.write"
  | "lc.transition";

export interface StepEvent {
  /** Unique id for this event. */
  id: string;
  kind: StepKind;
  /** Letter-of-Credit this step belongs to, when applicable. */
  lcId?: string;
  /** Human-readable, already-redacted message for the log pane. */
  message: string;
  /** Whether the step succeeded. */
  ok: boolean;
  /** Public proof artifact (credential id, signature, receipt hash). */
  proof?: string;
  /** Extra redacted structured data for the enclave animation. */
  data?: Record<string, unknown>;
  ts: string;
}

// Survive Next.js dev hot-reload (module re-evaluation) by pinning on globalThis.
const globalForBus = globalThis as unknown as { __agentBus?: EventEmitter };
const bus = globalForBus.__agentBus ?? new EventEmitter();
bus.setMaxListeners(100);
globalForBus.__agentBus = bus;

const STEP = "step";

/** Emit a step event. Redaction-checked before it leaves this process. */
export function emitStep(event: Omit<StepEvent, "id" | "ts">): StepEvent {
  const full: StepEvent = {
    ...event,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
  };
  assertNoRawAccountData(full);
  bus.emit(STEP, full);
  return full;
}

/** Subscribe to step events. Returns an unsubscribe function. */
export function onStep(listener: (event: StepEvent) => void): () => void {
  bus.on(STEP, listener);
  return () => bus.off(STEP, listener);
}
