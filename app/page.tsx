"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LcState = "INITIATED" | "ESCROWED" | "VERIFIED" | "EXECUTED" | "SETTLED" | "DENIED" | "FAILED";

interface LetterOfCredit {
  id: string;
  buyerRef: string | null;
  exporterRef: string | null;
  valueCents: number;
  currency: string;
  targetPort: string;
  state: LcState;
  terms: {
    requiredPort: string;
    requiredBolStatus: string;
    maxValueCents: number;
  } | null;
}

interface LedgerEntry {
  id: string;
  lcId: string | null;
  agentDid: string | null;
  fromState: string;
  toState: string;
  proof: string | null;
  txRef: string | null;
  ts: string;
}

interface StepEvent {
  id: string;
  kind: string;
  lcId?: string;
  message: string;
  ok: boolean;
  proof?: string;
  data?: Record<string, unknown>;
  ts: string;
}

const states: LcState[] = ["INITIATED", "ESCROWED", "VERIFIED", "EXECUTED", "SETTLED"];

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed: ${response.status}`);
  return payload;
}

function getExplanation(kind: string): string {
  switch (kind) {
    case "identity.verify":
      return "Before executing any privileged logic, the agent verifies its identity on the Terminal 3 Network. The agent signs a cryptographic challenge locally using its private key (stored securely in the server environment). The network resolves this signature to confirm that the agent's DID is authentic and registered to this tenant.";
    case "authorization.mint":
      return "The buyer delegates payment release authority to the agent. Using the Terminal 3 SDK, the buyer signs a Delegation Credential. This credential specifies that the agent is authorized to call the 'release-escrow' function on the trade contract for this specific Letter of Credit. The resulting signature is represented by an opaque 'buyerPlaceholder' credential ID. The agent never sees the buyer's private key.";
    case "escrow.lock":
      return "The agent intercepts the buyer's authorization and requests Stripe to place an escrow hold on the buyer's card. This PaymentIntent is kept in an 'uncaptured' state. The money is locked and cannot be double-spent, but is not yet transferred to the exporter.";
    case "llm.parse":
      return "The agent processes a mock Bill of Lading webhook. Because transport documents are unstructured, the agent calls Google Gemini (gemini-2.5-flash) to extract the status, port of arrival, and vessel details. This assessment is advisory only and is parsed into a structured payload for validation.";
    case "policy.check":
      return "A strict, deterministic policy engine evaluates the structured transport data against the Letter of Credit terms. It compares the required port (Hamburg) vs the actual port, maximum allowable value, and vessel status. The policy code is the sole authority for releasing funds; the LLM cannot override these rules.";
    case "tee.resolve":
      return "Since the policy checks passed, the agent enters the TEE boundary to resolve the funds. The agent builds an invocation preimage containing the buyer's credential ID, a secure random nonce, and a hash of the release request. The agent signs this preimage using its private key. This replay-resistant signature is sent to the ledger to verify the transaction's authenticity.";
    case "payout.fire":
      return "Inside the secure TEE boundary, the opaque exporter reference is resolved to the real Stripe Connect account ID. The agent calls Stripe to capture the original hold and transfer the funds directly to the exporter's account using the captured charge as the transaction source.";
    case "audit.write":
      return "The state transition, receipt proof, and transaction references are compiled into a canonical JSON block. The agent hashes this block using SHA-256 to generate an immutable receipt hash. This receipt is logged in the local audit ledger (and would be written to the T3 immutable network ledger in production).";
    case "lc.transition":
      return "The Letter of Credit transitions from one state to another (e.g. INITIATED -> ESCROWED or VERIFIED -> SETTLED) in the SQLite database, signaling the updated state to the user console.";
    default:
      return "A system event representing a step in the autonomous escrow lifecycle. All inputs and outputs are validated at trust boundaries to prevent PII or raw financial details from escaping the Secure Enclave.";
  }
}

function renderVisualDetails(event: StepEvent) {
  if (!event.ok) return null;
  const data = event.data as any;

  switch (event.kind) {
    case "llm.parse": {
      const explanation = data?.explanation as string;
      const opinionMet = data?.opinionMet as boolean;
      if (!explanation) return null;
      return (
        <div className="border border-emerald-500/15 bg-emerald-950/20 p-4 rounded-sm space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-500/10 pb-2">
            <span className="text-neutral-400 font-mono text-[10px] uppercase">LLM Assessment Opinion</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${opinionMet ? "bg-emerald-900/40 text-emerald-300 border border-emerald-500/30" : "bg-amber-900/40 text-amber-300 border border-amber-500/30"}`}>
              {opinionMet ? "CONDITIONS MET" : "CONDITIONS NOT MET"}
            </span>
          </div>
          <p className="text-xs text-neutral-300 italic leading-relaxed whitespace-pre-wrap">
            &ldquo;{explanation}&rdquo;
          </p>
        </div>
      );
    }

    case "policy.check": {
      const checks = data?.checks as any[];
      if (!checks || !Array.isArray(checks)) return null;
      return (
        <div className="border border-neutral-900 bg-neutral-950/40 p-4 rounded-sm space-y-3">
          <p className="text-neutral-400 font-mono text-[10px] uppercase border-b border-neutral-900 pb-2">Deterministic Policy Checklist</p>
          <div className="space-y-2">
            {checks.map((check: any) => (
              <div key={check.name} className="flex items-start justify-between text-xs gap-3">
                <div className="flex items-center gap-2">
                  <span>{check.ok ? "✔️" : "❌"}</span>
                  <span className="font-mono text-[11px] text-neutral-300">{check.name}</span>
                </div>
                <span className="text-neutral-400 text-right font-mono text-[10px]">{check.detail}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "identity.verify": {
      return (
        <div className="border border-emerald-500/15 bg-emerald-950/20 p-4 rounded-sm space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-emerald-500/10 pb-2">
            <span className="text-neutral-400 text-[10px] uppercase">T3 Identity Verification Card</span>
            <span className="text-emerald-400 text-[10px] font-bold">✓ SECURE AGENT</span>
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-neutral-500">Agent DID</span>
              <span className="text-emerald-300 truncate max-w-[200px]" title={event.proof}>{event.proof || "did:t3n:..."}</span>
            </div>
            {data?.address && (
              <div className="flex justify-between">
                <span className="text-neutral-500">ETH Address</span>
                <span className="text-neutral-300">{data.address as string}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-neutral-500">Status</span>
              <span className="text-emerald-400">Handshake & Authenticate OK</span>
            </div>
          </div>
        </div>
      );
    }

    case "authorization.mint": {
      if (!data) return null;
      return (
        <div className="border border-neutral-900 bg-neutral-950/40 p-4 rounded-sm space-y-3 font-mono text-xs">
          <p className="text-neutral-400 text-[10px] uppercase border-b border-neutral-900 pb-2">Minted Delegation Details</p>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-neutral-500">Allowed Function</span>
              <span className="text-emerald-300">{data.function as string || "release-escrow"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">TTL</span>
              <span className="text-neutral-300">{data.ttlSecs as number || 86400} seconds</span>
            </div>
            {data.buyerSigColonHex && (
              <div>
                <span className="text-neutral-500 block mb-1">Buyer Signature (EIP-191)</span>
                <div className="bg-black/40 border border-neutral-900 p-2 rounded text-[10px] text-neutral-400 break-all select-all leading-tight">
                  {data.buyerSigColonHex as string}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    case "escrow.lock": {
      return (
        <div className="border border-neutral-900 bg-neutral-950/40 p-4 rounded-sm space-y-3 font-mono text-xs">
          <p className="text-neutral-400 text-[10px] uppercase border-b border-neutral-900 pb-2">Stripe Payment Intent (Hold)</p>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-neutral-500">Intent ID</span>
              <span className="text-emerald-300">{event.proof || "pi_..."}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Capture Status</span>
              <span className="text-neutral-300">{data?.status as string || "requires_capture"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Mode</span>
              <span className="text-neutral-300">{data?.simulated ? "Offline Simulator" : "Live Stripe Testnet"}</span>
            </div>
          </div>
        </div>
      );
    }

    case "payout.fire": {
      return (
        <div className="border border-neutral-900 bg-neutral-950/40 p-4 rounded-sm space-y-3 font-mono text-xs">
          <p className="text-neutral-400 text-[10px] uppercase border-b border-neutral-900 pb-2">Stripe Connect Transfer</p>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-neutral-500">Transfer ID</span>
              <span className="text-emerald-300">{event.proof || "tr_..."}</span>
            </div>
            {data?.destination && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Connected Destination</span>
                <span className="text-neutral-300">{data.destination as string}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-neutral-500">Payout Status</span>
              <span className="text-emerald-400 font-bold">Confirmed / Succeeded</span>
            </div>
          </div>
        </div>
      );
    }

    case "audit.write": {
      const payload = data?.auditPayload as any;
      return (
        <div className="border border-neutral-900 bg-neutral-950/40 p-4 rounded-sm space-y-3 font-mono text-xs">
          <p className="text-neutral-400 text-[10px] uppercase border-b border-neutral-900 pb-2">Cryptographic Audit Ledger Write</p>
          <div className="space-y-2 text-[11px]">
            {payload && (
              <>
                <div className="flex justify-between">
                  <span className="text-neutral-500">State Transition</span>
                  <span className="text-neutral-300">{payload.fromState} ➔ {payload.toState}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Agent Signer DID</span>
                  <span className="text-neutral-300 truncate max-w-[200px]" title={payload.agentDid}>{payload.agentDid}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-neutral-500">Receipt SHA-256</span>
              <span className="text-emerald-400 truncate max-w-[200px]" title={event.proof}>{event.proof}</span>
            </div>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {}
  };

  return (
    <button
      onClick={handleCopy}
      className="px-2 py-1 text-[10px] font-mono border border-neutral-800 hover:border-neutral-600 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200 transition rounded-sm flex items-center gap-1 select-none"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function StateRail({ state }: { state: LcState }) {
  const current = states.includes(state) ? states.indexOf(state) : states.length - 1;

  return (
    <div className="grid grid-cols-5 gap-2">
      {states.map((item, index) => {
        const active = index <= current;
        const terminal = state === "DENIED" || state === "FAILED";
        return (
          <div key={item} className="min-w-0">
            <div
              className={[
                "h-1.5 rounded-sm border transition-all duration-300",
                active && !terminal ? "border-emerald-500/40 bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.3)]" : "",
                active && terminal ? "border-amber-500/40 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.3)]" : "",
                !active ? "border-neutral-800 bg-neutral-900/40" : "",
              ].join(" ")}
            />
            <p className="mt-2 truncate text-[9px] font-mono uppercase tracking-wider text-neutral-500">{item}</p>
          </div>
        );
      })}
    </div>
  );
}

function EnclavePanel({
  events,
  selectedLc,
  onSelectEvent,
}: {
  events: StepEvent[];
  selectedLc?: LetterOfCredit;
  onSelectEvent: (event: StepEvent) => void;
}) {
  const latest = events.find((event) => !selectedLc || event.lcId === selectedLc.id);
  const milestones = [
    "authorization.mint",
    "escrow.lock",
    "llm.parse",
    "policy.check",
    "tee.resolve",
    "payout.fire",
    "audit.write",
  ];

  return (
    <section className="glass-panel px-5 py-5 shadow-2xl rounded-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Terminal 3 Secure Enclave</p>
          <h2 className="mt-1 text-lg font-semibold text-neutral-100">Private resolution boundary</h2>
        </div>
        <div className="rounded-sm border border-emerald-500/30 bg-emerald-950/20 px-2 py-0.5 text-xs text-emerald-300 font-mono flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          TEE ACTIVE
        </div>
      </div>

      <div className="mt-6 grid gap-2.5">
        {milestones.map((kind) => {
          const event = events.find((item) => item.kind === kind && (!selectedLc || item.lcId === selectedLc.id));
          const active = !!event;
          return (
            <div
              key={kind}
              onClick={() => event && onSelectEvent(event)}
              className={[
                "flex items-center justify-between border px-3 py-2 text-xs transition duration-200 rounded-sm select-none",
                active
                  ? event.ok
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100 cursor-pointer hover:border-emerald-500/60 hover:bg-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.02)]"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-100 cursor-pointer hover:border-amber-500/60 hover:bg-amber-500/10"
                  : "border-neutral-850 bg-neutral-900/10 text-neutral-500 cursor-not-allowed",
              ].join(" ")}
            >
              <span className="font-mono">{kind}</span>
              <div className="flex items-center gap-2">
                {active && (
                  <span className="text-[10px] text-neutral-400 font-mono underline hover:text-neutral-200">
                    Inspect Proof
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono ${
                  active 
                    ? event.ok 
                      ? "bg-emerald-950/40 text-emerald-300 border border-emerald-500/20" 
                      : "bg-amber-950/40 text-amber-300 border border-amber-500/20"
                    : "bg-neutral-900/40 text-neutral-600 border border-transparent"
                }`}>
                  {active ? (event.ok ? "verified" : "failed") : "waiting"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 border border-neutral-850 bg-neutral-900/10 p-3 font-mono text-xs text-neutral-300 rounded-sm">
        <p className="text-neutral-500 uppercase text-[9px] tracking-wider">latest enclave signal</p>
        <p className="mt-2 min-h-10 break-words text-neutral-300 leading-relaxed">
          {latest?.message ?? "Awaiting agent event stream..."}
        </p>
      </div>
    </section>
  );
}

function downloadProof(event: StepEvent) {
  const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
    JSON.stringify(event, null, 2)
  )}`;
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", jsonString);
  downloadAnchor.setAttribute("download", `t3-proof-${event.kind}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function TeeFlowchart({ stepKind }: { stepKind: string }) {
  const isBrowserActive = ["authorization.mint"].includes(stepKind);
  const isTeeActive = ["identity.verify", "llm.parse", "policy.check", "tee.resolve"].includes(stepKind);
  const isLedgerActive = ["escrow.lock", "payout.fire", "audit.write"].includes(stepKind);

  const highlightsArrow1 = ["authorization.mint", "escrow.lock"].includes(stepKind);
  const highlightsArrow2 = ["tee.resolve", "payout.fire", "audit.write"].includes(stepKind);

  return (
    <div className="border border-neutral-900 bg-neutral-950/40 p-4 rounded-sm select-none font-mono text-[10px]">
      <p className="uppercase tracking-widest text-[8px] text-neutral-500 mb-4 text-center">Interactive Security Topology</p>
      <div className="flex items-center justify-between gap-2">
        {/* Node 1: Browser */}
        <div className={`flex flex-col items-center p-2.5 border rounded-sm w-28 text-center transition duration-300 ${
          isBrowserActive 
            ? "border-emerald-500 bg-emerald-950/20 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)]" 
            : "border-neutral-850 bg-neutral-900/10 text-neutral-500"
        }`}>
          <span className="font-semibold uppercase tracking-wider text-[8px]">Client Zone</span>
          <span className="mt-1 text-[8px] text-neutral-400">Buyer Wallet</span>
          <span className="mt-1.5 text-[7px] bg-neutral-900/60 px-1 py-0.5 rounded border border-neutral-800">EIP-191 Sign</span>
        </div>

        {/* Arrow 1 to 2 */}
        <div className="flex-1 flex flex-col items-center min-w-0">
          <span className={`text-[7px] text-center truncate w-full ${highlightsArrow1 ? "text-emerald-400 font-bold" : "text-neutral-600"}`}>
            {stepKind === "authorization.mint" ? "Delegation" : stepKind === "escrow.lock" ? "Opaque ID" : "Secure Connection"}
          </span>
          <svg className="w-full h-4 mt-1" fill="none" viewBox="0 0 100 20" preserveAspectRatio="none">
            <path
              d="M 0 10 L 96 10 M 90 6 L 96 10 L 90 14"
              stroke={highlightsArrow1 ? "#34d399" : "#262626"}
              strokeWidth={highlightsArrow1 ? "2" : "1"}
              className={highlightsArrow1 ? "animate-pulse" : ""}
            />
          </svg>
        </div>

        {/* Node 2: TEE */}
        <div className={`flex flex-col items-center p-2.5 border rounded-sm w-32 text-center transition duration-300 ${
          isTeeActive 
            ? "border-emerald-500 bg-emerald-950/20 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)]" 
            : "border-neutral-850 bg-neutral-900/10 text-neutral-500"
        }`}>
          <span className="font-semibold uppercase tracking-wider text-[8px]">TEE Enclave</span>
          <span className="mt-1 text-[8px] text-neutral-400">Escrow Agent</span>
          <span className="mt-1.5 text-[7px] bg-neutral-900/60 px-1 py-0.5 rounded border border-neutral-800">Private Execution</span>
        </div>

        {/* Arrow 2 to 3 */}
        <div className="flex-1 flex flex-col items-center min-w-0">
          <span className={`text-[7px] text-center truncate w-full ${highlightsArrow2 ? "text-emerald-400 font-bold" : "text-neutral-600"}`}>
            {stepKind === "tee.resolve" ? "Signature" : stepKind === "payout.fire" ? "Payout" : stepKind === "audit.write" ? "Receipt Hash" : "Secure Connection"}
          </span>
          <svg className="w-full h-4 mt-1" fill="none" viewBox="0 0 100 20" preserveAspectRatio="none">
            <path
              d="M 0 10 L 96 10 M 90 6 L 96 10 L 90 14"
              stroke={highlightsArrow2 ? "#34d399" : "#262626"}
              strokeWidth={highlightsArrow2 ? "2" : "1"}
              className={highlightsArrow2 ? "animate-pulse" : ""}
            />
          </svg>
        </div>

        {/* Node 3: Settlement */}
        <div className={`flex flex-col items-center p-2.5 border rounded-sm w-28 text-center transition duration-300 ${
          isLedgerActive 
            ? "border-emerald-500 bg-emerald-950/20 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)]" 
            : "border-neutral-850 bg-neutral-900/10 text-neutral-500"
        }`}>
          <span className="font-semibold uppercase tracking-wider text-[8px]">Settlement</span>
          <span className="mt-1 text-[8px] text-neutral-400">Stripe / Ledger</span>
          <span className="mt-1.5 text-[7px] bg-neutral-900/60 px-1 py-0.5 rounded border border-neutral-800">Immutable State</span>
        </div>
      </div>
      
      <div className="mt-3 text-center text-[8.5px] text-neutral-400 leading-normal border-t border-neutral-900/50 pt-2.5">
        {isBrowserActive && "Active State: The Buyer canonicalizes and signs the Delegation Credential (JCS) to grant agent access."}
        {isTeeActive && "Active State: Inside the hardware-isolated Enclave, the agent performs deterministic checks and signs TEE invocation."}
        {isLedgerActive && "Active State: The agent captures Stripe holds and records the cryptographic verification hash to the ledger."}
        {!isBrowserActive && !isTeeActive && !isLedgerActive && "Select a milestone above to visualize the trust boundary transitions."}
      </div>
    </div>
  );
}

export default function Home() {
  const [lcs, setLcs] = useState<LetterOfCredit[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Inspector Drawer State
  const [inspectorEvent, setInspectorEvent] = useState<StepEvent | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"visual" | "raw">("visual");

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formExporter, setFormExporter] = useState("exporter-ref:acme-textiles-001");
  const [formValue, setFormValue] = useState("25000");
  const [formPort, setFormPort] = useState("Rotterdam");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customizePolicy, setCustomizePolicy] = useState(false);
  const [formRequiredPort, setFormRequiredPort] = useState("Rotterdam");
  const [formMaxLimit, setFormMaxLimit] = useState("25000");

  // Reset DB State
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [confirmResetText, setConfirmResetText] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const handlePortChange = (val: string) => {
    setFormPort(val);
    if (!customizePolicy) {
      setFormRequiredPort(val);
    }
  };

  const handleValueChange = (val: string) => {
    setFormValue(val);
    if (!customizePolicy) {
      setFormMaxLimit(val);
    }
  };

  async function handleCreateLc(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const reqPort = customizePolicy ? formRequiredPort : formPort;
      const maxLimitCents = Math.round(Number(customizePolicy ? formMaxLimit : formValue) * 100);

      const response = await fetch("/api/lc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exporterRef: formExporter,
          valueCents: Math.round(Number(formValue) * 100),
          currency: "AUD",
          targetPort: formPort,
          terms: {
            requiredPort: reqPort,
            requiredBolStatus: "DELIVERED",
            maxValueCents: maxLimitCents,
          },
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to create Letter of Credit");
      }
      setIsCreateOpen(false);
      setFormExporter("exporter-ref:acme-textiles-001");
      setFormValue("25000");
      setFormPort("Rotterdam");
      setCustomizePolicy(false);
      setFormRequiredPort("Rotterdam");
      setFormMaxLimit("25000");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetDb() {
    setIsResetting(true);
    setError(null);
    try {
      const response = await fetch("/api/reset", {
        method: "POST",
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to reset database");
      }
      setIsResetOpen(false);
      setConfirmResetText("");
      setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsResetting(false);
    }
  }

  const selectedLc = useMemo(
    () => lcs.find((lc) => lc.id === selectedId) ?? lcs[0],
    [lcs, selectedId],
  );

  const refresh = useCallback(async () => {
    const [lcPayload, ledgerPayload] = await Promise.all([
      readJson<{ ok: true; data: LetterOfCredit[] }>("/api/lc"),
      readJson<{ ok: true; data: LedgerEntry[] }>("/api/ledger"),
    ]);
    setLcs(lcPayload.data);
    setLedger(ledgerPayload.data);
    if (lcPayload.data[0]) {
      setSelectedId((current) => current ?? lcPayload.data[0].id);
    }
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));

    const source = new EventSource("/api/stream");
    source.addEventListener("step", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as StepEvent;
      setEvents((current) => [event, ...current].slice(0, 80));
      refresh().catch(() => undefined);
    });
    source.onerror = () => setError("Event stream disconnected; refresh still works.");
    return () => source.close();
  }, [refresh]);

  async function authorize(lc: LetterOfCredit) {
    setBusyId(lc.id);
    setError(null);
    try {
      await readJson(`/api/lc/${lc.id}/authorize`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function simulateDelivery(lc: LetterOfCredit) {
    setBusyId(lc.id);
    setError(null);
    try {
      await readJson("/api/webhook/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lcId: lc.id,
          status: "DELIVERED",
          port: lc.targetPort,
          vesselId: `VESSEL-${lc.id.slice(-6).toUpperCase()}`,
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const handleSelectLedger = (entry: LedgerEntry) => {
    setInspectorEvent({
      id: entry.id,
      kind: "audit.write",
      lcId: entry.lcId || undefined,
      message: `${entry.fromState} -> ${entry.toState}`,
      ok: true,
      proof: entry.proof || undefined,
      ts: entry.ts,
      data: {
        receiptHash: entry.proof,
        auditPayload: {
          lcId: entry.lcId,
          agentDid: entry.agentDid,
          fromState: entry.fromState,
          toState: entry.toState,
          proof: entry.proof,
          txRef: entry.txRef,
        },
      },
    });
    setInspectorTab("visual");
  };

  const handleSelectEvent = (event: StepEvent) => {
    setInspectorEvent(event);
    setInspectorTab(event.data ? "raw" : "visual");
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-950 via-[#0a0d11] to-black text-neutral-100 flex flex-col font-sans pb-12">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex-1 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <header className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-900 pb-5">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-amber-400 flex items-center gap-2">
                <span>Autonomous trade finance node</span>
                <button
                  onClick={() => setIsResetOpen(true)}
                  className="opacity-40 hover:opacity-100 transition-opacity duration-200 text-red-400 hover:text-red-300 font-mono text-[9px] border border-red-500/20 hover:border-red-500/40 bg-red-950/20 px-1.5 py-0.5 rounded cursor-pointer select-none"
                  title="Reset database to demo seed data"
                >
                  [DEMO RESET]
                </button>
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-neutral-50 sm:text-3xl">
                Letter of Credit Agent Console
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCreateOpen(true)}
                className="border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-xs font-mono text-emerald-300 hover:border-emerald-400 hover:bg-emerald-500/10 transition duration-200 rounded-sm shadow-[0_0_15px_rgba(16,185,129,0.05)]"
              >
                CREATE CONTRACT
              </button>
              <button
                onClick={() => refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
                className="border border-neutral-800 bg-neutral-900/30 px-4 py-2 text-xs font-mono text-neutral-300 hover:border-emerald-500/40 hover:bg-emerald-500/5 hover:text-emerald-300 transition duration-200 rounded-sm"
              >
                REFRESH STATE
              </button>
            </div>
          </div>
        </header>

        <section className="space-y-4">
          {error ? (
            <div className="border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs font-mono text-amber-300 rounded-sm flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-neutral-500 hover:text-neutral-300 font-bold">×</button>
            </div>
          ) : null}

          <div className="grid gap-4">
            {lcs.map((lc) => {
              const active = selectedLc?.id === lc.id;
              return (
                <article
                  key={lc.id}
                  onClick={() => setSelectedId(lc.id)}
                  className={[
                    "cursor-pointer border transition duration-300 rounded-sm p-5 relative overflow-hidden",
                    active
                      ? "border-emerald-500/30 bg-emerald-500/[0.03] shadow-[0_0_30px_rgba(16,185,129,0.02)]"
                      : "border-neutral-900 bg-neutral-950/20 hover:border-neutral-800 hover:bg-neutral-900/10",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] text-neutral-500 uppercase tracking-wide">ID: {lc.id}</p>
                      <h2 className="mt-1 text-lg font-semibold tracking-tight text-neutral-100">{lc.exporterRef}</h2>
                    </div>
                    <span className={`px-2 py-0.5 font-mono text-[10px] rounded-full uppercase tracking-wider border ${
                      lc.state === "SETTLED"
                        ? "bg-emerald-950/30 border-emerald-500/20 text-emerald-400"
                        : lc.state === "DENIED" || lc.state === "FAILED"
                        ? "bg-amber-950/30 border-amber-500/20 text-amber-400"
                        : "bg-neutral-900/50 border-neutral-800 text-neutral-400"
                    }`}>
                      {lc.state}
                    </span>
                  </div>

                  <div className="mt-5">
                    <StateRail state={lc.state} />
                  </div>

                  <dl className="mt-5 grid gap-4 text-xs font-mono text-neutral-400 sm:grid-cols-3 border-t border-neutral-900/50 pt-4">
                    <div>
                      <dt className="text-[10px] text-neutral-500 uppercase">Value</dt>
                      <dd className="mt-0.5 text-neutral-200 text-sm font-semibold">{money(lc.valueCents, lc.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-neutral-500 uppercase">Delivery port</dt>
                      <dd className="mt-0.5 text-neutral-200">{lc.targetPort}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-neutral-500 uppercase">Terms Required Port</dt>
                      <dd className="mt-0.5 text-neutral-200">{lc.terms?.requiredPort ?? "No terms"}</dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-wrap gap-3 border-t border-neutral-900/50 pt-4">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        authorize(lc);
                      }}
                      disabled={busyId === lc.id || lc.state !== "INITIATED"}
                      className="bg-emerald-500/10 border border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/20 text-emerald-300 px-4 py-2 text-xs font-mono disabled:opacity-30 disabled:cursor-not-allowed transition duration-200 rounded-sm"
                    >
                      Authorize Escrow
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        simulateDelivery(lc);
                      }}
                      disabled={busyId === lc.id || lc.state !== "ESCROWED"}
                      className="bg-amber-500/10 border border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/20 text-amber-300 px-4 py-2 text-xs font-mono disabled:opacity-30 disabled:cursor-not-allowed transition duration-200 rounded-sm"
                    >
                      Simulate Delivery
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <EnclavePanel events={events} selectedLc={selectedLc} onSelectEvent={handleSelectEvent} />

          <section className="glass-panel p-5 rounded-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wide">Agent execution logs</h2>
              <span className="font-mono text-[10px] text-neutral-500">{events.length} logs</span>
            </div>
            <div className="mt-4 max-h-60 space-y-2.5 overflow-auto pr-1">
              {events.length === 0 ? (
                <p className="text-xs font-mono text-neutral-600 py-3">Awaiting agent event stream...</p>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    onClick={() => handleSelectEvent(event)}
                    className="border border-neutral-900 bg-neutral-950/20 hover:border-neutral-700/50 hover:bg-neutral-900/10 p-3 text-xs transition duration-200 cursor-pointer rounded-sm animate-fade-in"
                  >
                    <div className="flex justify-between gap-3 font-mono text-[10px] text-neutral-500">
                      <span>{event.kind}</span>
                      <span className={event.ok ? "text-emerald-400" : "text-amber-400"}>
                        {event.ok ? "ok" : "blocked"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-neutral-300 leading-relaxed font-mono text-[11px]">{event.message}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="glass-panel p-5 rounded-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-200 uppercase tracking-wide">Audit ledger</h2>
              <span className="font-mono text-[10px] text-neutral-500">{ledger.length} receipts</span>
            </div>
            <div className="mt-4 max-h-60 space-y-2.5 overflow-auto pr-1">
              {ledger.length === 0 ? (
                <p className="text-xs font-mono text-neutral-600 py-3">No ledger records yet.</p>
              ) : (
                ledger.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => handleSelectLedger(entry)}
                    className="border border-neutral-900 bg-neutral-950/20 hover:border-neutral-700/50 hover:bg-neutral-900/10 p-3 font-mono text-[11px] transition duration-200 cursor-pointer rounded-sm"
                  >
                    <div className="flex justify-between text-[10px] text-neutral-500">
                      <span>{entry.fromState} -&gt; {entry.toState}</span>
                      <span className="text-[10px] text-neutral-400 underline hover:text-neutral-200">
                        Inspect
                      </span>
                    </div>
                    <p className="mt-1 break-all text-neutral-300">receipt {entry.proof}</p>
                    <p className="mt-1 text-[9px] text-neutral-600">{new Date(entry.ts).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* Cryptographic Inspector Side Drawer */}
      {inspectorEvent && (
        <>
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40 transition-all duration-300"
            onClick={() => setInspectorEvent(null)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl border-l border-neutral-800 bg-[#0b0e12]/95 backdrop-blur-xl shadow-2xl p-6 overflow-y-auto flex flex-col animate-fade-in font-sans">
            <div className="flex items-start justify-between border-b border-neutral-900 pb-5">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">
                  T3 Cryptographic Inspector
                </span>
                <h3 className="text-xl font-semibold text-neutral-50 mt-1">{inspectorEvent.kind}</h3>
              </div>
              <button
                onClick={() => setInspectorEvent(null)}
                className="text-neutral-400 hover:text-neutral-100 p-1.5 border border-neutral-800 bg-neutral-900/40 rounded-sm text-xs font-mono"
              >
                CLOSE [X]
              </button>
            </div>

            <div className="mt-5 flex gap-4 border-b border-neutral-900 pb-2">
              <button
                onClick={() => setInspectorTab("visual")}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-all duration-200 border-b-2 ${
                  inspectorTab === "visual"
                    ? "border-emerald-400 text-emerald-300"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Visual Explanation
              </button>
              <button
                onClick={() => setInspectorTab("raw")}
                disabled={!inspectorEvent.data}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-all duration-200 border-b-2 disabled:opacity-30 disabled:cursor-not-allowed ${
                  inspectorTab === "raw"
                    ? "border-emerald-400 text-emerald-300"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Raw Cryptography Payload
              </button>
            </div>

            <div className="flex-1 mt-6 flex flex-col min-h-0">
              {inspectorTab === "visual" ? (
                <div className="space-y-5 flex-1 overflow-auto pr-1">
                  <TeeFlowchart stepKind={inspectorEvent.kind} />

                  <div className="border border-emerald-500/10 bg-emerald-950/[0.02] p-4 rounded-sm">
                    <h4 className="text-xs font-mono uppercase tracking-wider text-emerald-400">Under the Hood Process</h4>
                    <p className="text-xs text-neutral-300 mt-2.5 leading-relaxed">
                      {getExplanation(inspectorEvent.kind)}
                    </p>
                  </div>

                  {renderVisualDetails(inspectorEvent)}

                  <div className="border border-neutral-900 bg-neutral-950/20 p-4 rounded-sm font-mono text-[11px] space-y-3.5">
                    <div className="flex justify-between border-b border-neutral-900 pb-2">
                      <span className="text-neutral-500">Event Execution</span>
                      <span className={inspectorEvent.ok ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                        {inspectorEvent.ok ? "VERIFIED / COMPLETED" : "BLOCKED / FAILED"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-neutral-900 pb-2">
                      <span className="text-neutral-500">Timestamp</span>
                      <span className="text-neutral-300">{new Date(inspectorEvent.ts).toLocaleString()}</span>
                    </div>
                    {inspectorEvent.lcId && (
                      <div className="flex justify-between border-b border-neutral-900 pb-2">
                        <span className="text-neutral-500">Context LC Reference</span>
                        <span className="text-neutral-300">{inspectorEvent.lcId}</span>
                      </div>
                    )}
                    {inspectorEvent.proof && (
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-neutral-500">Cryptographic Receipt / Proof ID</span>
                          <CopyButton text={inspectorEvent.proof} />
                        </div>
                        <div className="bg-black/50 border border-neutral-900 p-3 rounded-sm text-neutral-300 break-all text-[11px] leading-relaxed">
                          {inspectorEvent.proof}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                      Decoded Registry Payload (TEE Boundary)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => downloadProof(inspectorEvent)}
                        className="px-2 py-1 text-[10px] font-mono border border-neutral-800 hover:border-neutral-600 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200 transition rounded-sm flex items-center gap-1 select-none"
                      >
                        Download JSON
                      </button>
                      {inspectorEvent.data && (
                        <CopyButton text={JSON.stringify(inspectorEvent.data, null, 2)} />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto border border-neutral-900 bg-neutral-950/40 rounded-sm p-4">
                    <pre className="font-mono text-[11px] text-emerald-300/80 leading-relaxed whitespace-pre-wrap break-all">
                      {JSON.stringify(inspectorEvent.data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {isCreateOpen && (
        <>
          <div
            onClick={() => setIsCreateOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300"
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-neutral-950/80 border border-neutral-900 shadow-2xl p-6 rounded-sm z-50 transition-all duration-300 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-neutral-900 pb-3 mb-5">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-emerald-400">Escrow Agreement</p>
                <h3 className="text-lg font-bold text-neutral-50">Create Letter of Credit</h3>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-neutral-400 hover:text-neutral-100 p-1 font-mono text-xs hover:border border-transparent"
              >
                CLOSE [X]
              </button>
            </div>

            <form onSubmit={handleCreateLc} className="space-y-4 text-xs font-mono">
              <div className="space-y-1.5">
                <label className="text-neutral-400 uppercase tracking-wider text-[9px]">Exporter Reference / Destination</label>
                <input
                  type="text"
                  required
                  value={formExporter}
                  onChange={(e) => setFormExporter(e.target.value)}
                  placeholder="e.g., exporter-ref:acme-textiles-001"
                  className="w-full bg-black/60 border border-neutral-900 rounded-sm px-3 py-2 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-emerald-500/50 transition"
                />
                <p className="text-[9.5px] text-neutral-500 leading-normal mt-1">
                  Use <code className="text-emerald-400 font-semibold bg-neutral-900/60 px-1 py-0.5 rounded border border-neutral-800/40">exporter-ref:acme-textiles-001</code> to simulate a successful Stripe Connect settlement.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-neutral-400 uppercase tracking-wider text-[9px]">Value (AUD)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={formValue}
                    onChange={(e) => handleValueChange(e.target.value)}
                    placeholder="e.g., 25000"
                    className="w-full bg-black/60 border border-neutral-900 rounded-sm px-3 py-2 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-emerald-500/50 transition"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-neutral-400 uppercase tracking-wider text-[9px]">Target Delivery Port</label>
                  <input
                    type="text"
                    required
                    value={formPort}
                    onChange={(e) => handlePortChange(e.target.value)}
                    placeholder="e.g., Rotterdam"
                    className="w-full bg-black/60 border border-neutral-900 rounded-sm px-3 py-2 text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-emerald-500/50 transition"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-2.5">
                <input
                  type="checkbox"
                  id="customizePolicy"
                  checked={customizePolicy}
                  onChange={(e) => {
                    setCustomizePolicy(e.target.checked);
                    if (e.target.checked) {
                      setFormRequiredPort(formPort);
                      setFormMaxLimit(formValue);
                    }
                  }}
                  className="rounded border-neutral-800 bg-black/60 text-emerald-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                />
                <label htmlFor="customizePolicy" className="text-neutral-400 select-none uppercase tracking-wider text-[8.5px] cursor-pointer hover:text-neutral-200 transition">
                  Customize TEE Policy Rules (Simulate Mismatches)
                </label>
              </div>

              {customizePolicy ? (
                <div className="grid grid-cols-2 gap-4 border border-neutral-900/60 bg-neutral-950/20 p-3 rounded-sm mt-1.5">
                  <div className="space-y-1.5">
                    <label className="text-neutral-400 uppercase tracking-wider text-[8px]">Required Port</label>
                    <input
                      type="text"
                      required
                      value={formRequiredPort}
                      onChange={(e) => setFormRequiredPort(e.target.value)}
                      placeholder="e.g., Hamburg"
                      className="w-full bg-black/60 border border-neutral-900 rounded-sm px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:border-emerald-500/50 transition text-[11px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-neutral-400 uppercase tracking-wider text-[8px]">Max Value Cap (AUD)</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formMaxLimit}
                      onChange={(e) => setFormMaxLimit(e.target.value)}
                      placeholder="e.g., 20000"
                      className="w-full bg-black/60 border border-neutral-900 rounded-sm px-2.5 py-1.5 text-neutral-200 focus:outline-none focus:border-emerald-500/50 transition text-[11px]"
                    />
                  </div>
                </div>
              ) : (
                <div className="border border-neutral-900 bg-neutral-950/40 p-3 rounded-sm space-y-2 mt-2">
                  <p className="text-[9px] uppercase tracking-wider text-neutral-500">Deterministic Policy Terms (TEE Gated)</p>
                  <div className="flex items-center justify-between text-[10px] text-neutral-400">
                    <span>Required Port of Lading</span>
                    <span className="text-emerald-400 font-semibold">{formPort || "Same as Target"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-neutral-400">
                    <span>Required Bill of Lading Status</span>
                    <span className="text-emerald-400 font-semibold">DELIVERED</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-neutral-400">
                    <span>Max Escrow Value Limit</span>
                    <span className="text-emerald-400 font-semibold">A${Number(formValue).toLocaleString() || "0"}</span>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold py-2.5 rounded-sm transition tracking-wider uppercase text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Creating Contract..." : "Deploy Agreement"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
      {isResetOpen && (
        <>
          <div
            onClick={() => {
              if (!isResetting) {
                setIsResetOpen(false);
                setConfirmResetText("");
              }
            }}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[60] transition-opacity duration-300 animate-fade-in"
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#0a0d12] border border-red-950/60 shadow-2xl p-6 rounded-sm z-[70] transition-all duration-300 backdrop-blur-md animate-fade-in font-sans">
            <div className="flex items-center gap-3 border-b border-red-950/30 pb-3 mb-5">
              <span className="text-red-500 text-2xl">⚠️</span>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-red-400">Dangerous Administrative Action</p>
                <h3 className="text-lg font-bold text-neutral-50 font-mono">Reset Demo Database</h3>
              </div>
            </div>

            <div className="space-y-4 text-xs font-mono leading-relaxed text-neutral-300">
              <div className="border border-red-500/20 bg-red-950/10 p-3.5 rounded-sm text-red-400">
                <span className="font-bold uppercase tracking-wider block mb-1 text-[9.5px]">Warning & Disclaimer:</span>
                This action is intended <span className="underline font-bold text-red-300">strictly for the demo version</span> of the application. It will permanently delete:
                <ul className="list-disc list-inside mt-1.5 space-y-1 ml-1 text-neutral-300 text-[10.5px]">
                  <li>All Letters of Credit contracts</li>
                  <li>All simulated Bills of Lading</li>
                  <li>All escrow hold & payout records</li>
                  <li>All cryptographic audit ledger logs</li>
                </ul>
              </div>

              <p className="text-neutral-400 text-[10.5px]">
                Once executed, the database will be seeded back to its original 3 demo contracts. There is no undo.
              </p>

              <div className="space-y-2 mt-4 font-mono">
                <label className="text-neutral-400 uppercase tracking-wider text-[9px] block">
                  To confirm, type <code className="text-red-400 font-bold bg-neutral-900/60 px-1 py-0.5 rounded border border-neutral-800">RESET</code> below:
                </label>
                <input
                  type="text"
                  required
                  value={confirmResetText}
                  onChange={(e) => setConfirmResetText(e.target.value)}
                  placeholder="RESET"
                  disabled={isResetting}
                  className="w-full bg-black/60 border border-neutral-900 rounded-sm px-3 py-2 text-neutral-200 placeholder-neutral-800 focus:outline-none focus:border-red-500/50 transition font-mono uppercase tracking-wider text-center"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={() => {
                    setIsResetOpen(false);
                    setConfirmResetText("");
                  }}
                  className="flex-1 bg-neutral-900 hover:bg-neutral-850 border border-neutral-850 hover:border-neutral-700 text-neutral-400 font-mono py-2 rounded-sm transition tracking-wider uppercase text-[10px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirmResetText !== "RESET" || isResetting}
                  onClick={handleResetDb}
                  className="flex-1 bg-red-950/20 hover:bg-red-900/20 border border-red-500/30 hover:border-red-500/60 disabled:border-neutral-900 disabled:bg-neutral-950/40 text-red-400 disabled:text-neutral-600 font-mono font-bold py-2 rounded-sm transition tracking-wider uppercase text-[10px] disabled:cursor-not-allowed"
                >
                  {isResetting ? "Resetting..." : "Execute Reset"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
