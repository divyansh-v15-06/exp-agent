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
                "h-2 rounded-sm border",
                active && !terminal ? "border-emerald-300 bg-emerald-300" : "",
                active && terminal ? "border-amber-300 bg-amber-300" : "",
                !active ? "border-neutral-700 bg-neutral-900" : "",
              ].join(" ")}
            />
            <p className="mt-2 truncate text-[10px] text-neutral-500">{item}</p>
          </div>
        );
      })}
    </div>
  );
}

function EnclavePanel({ events, selectedLc }: { events: StepEvent[]; selectedLc?: LetterOfCredit }) {
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
    <section className="border-y border-neutral-800 bg-[#11140f]/80 px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] lg:border lg:border-neutral-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase text-emerald-300">Terminal 3 Secure Enclave</p>
          <h2 className="mt-1 text-lg font-semibold text-neutral-100">Private resolution boundary</h2>
        </div>
        <div className="rounded-sm border border-emerald-500/40 px-2 py-1 text-xs text-emerald-200">
          TEE
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {milestones.map((kind) => {
          const event = events.find((item) => item.kind === kind && (!selectedLc || item.lcId === selectedLc.id));
          return (
            <div
              key={kind}
              className={[
                "flex items-center justify-between border px-3 py-2 text-xs",
                event
                  ? event.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-100"
                  : "border-neutral-800 bg-neutral-950/40 text-neutral-500",
              ].join(" ")}
            >
              <span>{kind}</span>
              <span>{event ? "seen" : "waiting"}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 border border-neutral-800 bg-black/30 p-3 font-mono text-xs text-neutral-300">
        <p className="text-neutral-500">latest enclave signal</p>
        <p className="mt-2 min-h-10 break-words">{latest?.message ?? "Awaiting agent event stream..."}</p>
      </div>
    </section>
  );
}

export default function Home() {
  const [lcs, setLcs] = useState<LetterOfCredit[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#080a0b_0%,#11140f_48%,#14110b_100%)] text-neutral-100">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <header className="lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-800 pb-5">
            <div>
              <p className="font-mono text-xs uppercase text-amber-300">Autonomous trade finance</p>
              <h1 className="mt-2 text-3xl font-semibold text-neutral-50">Letter of Credit agent console</h1>
            </div>
            <button
              onClick={() => refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
              className="border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-emerald-300 hover:text-emerald-100"
            >
              Refresh
            </button>
          </div>
        </header>

        <section className="space-y-4">
          {error ? (
            <div className="border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              {error}
            </div>
          ) : null}

          <div className="grid gap-3">
            {lcs.map((lc) => (
              <article
                key={lc.id}
                onClick={() => setSelectedId(lc.id)}
                className={[
                  "cursor-pointer border p-4 transition",
                  selectedLc?.id === lc.id
                    ? "border-emerald-400 bg-emerald-500/10"
                    : "border-neutral-800 bg-neutral-950/35 hover:border-neutral-600",
                ].join(" ")}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-neutral-500">{lc.id}</p>
                    <h2 className="mt-1 text-lg font-semibold">{lc.exporterRef}</h2>
                  </div>
                  <span className="border border-neutral-700 px-2 py-1 font-mono text-xs text-neutral-300">
                    {lc.state}
                  </span>
                </div>

                <div className="mt-4">
                  <StateRail state={lc.state} />
                </div>

                <dl className="mt-4 grid gap-3 text-sm text-neutral-300 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-neutral-500">Value</dt>
                    <dd>{money(lc.valueCents, lc.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-500">Delivery port</dt>
                    <dd>{lc.targetPort}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-500">Terms</dt>
                    <dd>{lc.terms?.requiredPort ?? "No terms"}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      authorize(lc);
                    }}
                    disabled={busyId === lc.id || lc.state !== "INITIATED"}
                    className="border border-emerald-500/50 px-3 py-2 text-sm text-emerald-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600"
                  >
                    Authorize escrow
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      simulateDelivery(lc);
                    }}
                    disabled={busyId === lc.id || lc.state !== "ESCROWED"}
                    className="border border-amber-500/50 px-3 py-2 text-sm text-amber-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600"
                  >
                    Simulate delivery
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <EnclavePanel events={events} selectedLc={selectedLc} />

          <section className="border border-neutral-800 bg-neutral-950/50 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Agent log</h2>
              <span className="font-mono text-xs text-neutral-500">{events.length} events</span>
            </div>
            <div className="mt-4 max-h-72 space-y-2 overflow-auto pr-1">
              {events.length === 0 ? (
                <p className="text-sm text-neutral-500">No streamed events yet.</p>
              ) : (
                events.map((event) => (
                  <div key={event.id} className="border border-neutral-800 bg-black/25 p-3 text-sm">
                    <div className="flex justify-between gap-3 font-mono text-xs text-neutral-500">
                      <span>{event.kind}</span>
                      <span>{event.ok ? "ok" : "blocked"}</span>
                    </div>
                    <p className="mt-2 text-neutral-200">{event.message}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="border border-neutral-800 bg-neutral-950/50 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Audit ledger</h2>
              <span className="font-mono text-xs text-neutral-500">{ledger.length} rows</span>
            </div>
            <div className="mt-4 max-h-72 space-y-2 overflow-auto pr-1">
              {ledger.length === 0 ? (
                <p className="text-sm text-neutral-500">No audit rows yet.</p>
              ) : (
                ledger.map((entry) => (
                  <div key={entry.id} className="border border-neutral-800 bg-black/25 p-3 font-mono text-xs">
                    <p className="text-neutral-300">
                      {entry.fromState} -&gt; {entry.toState}
                    </p>
                    <p className="mt-1 break-words text-neutral-500">proof {entry.proof}</p>
                    <p className="mt-1 text-neutral-600">{new Date(entry.ts).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
