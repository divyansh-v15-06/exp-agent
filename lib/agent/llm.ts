/**
 * LLM Bill-of-Lading parser (AGENTS.md Step 5). ADVISORY ONLY.
 *
 * The model parses the BoL and explains whether the delivery conditions look
 * satisfied. Its opinion is surfaced to the dashboard but NEVER gates a payout —
 * the deterministic `verifyConditions` (lib/agent/policy.ts) is the sole gate.
 *
 * Uses Gemini (gemini-2.5-flash) via @google/genai when GEMINI_API_KEY is
 * set; otherwise falls back to a deterministic heuristic explainer so the flow
 * runs without credentials. Only non-sensitive fields are ever sent to the model.
 */
import { GoogleGenAI } from "@google/genai";
import type {
  BillOfLadingLike,
  ContractTermsLike,
  LcLike,
} from "./policy";

const MODEL = "gemini-2.5-flash";

export interface BolAssessment {
  /** The model's (or heuristic's) natural-language reasoning. ADVISORY. */
  explanation: string;
  /** The model's non-binding opinion on whether conditions are met. NOT a gate. */
  opinionMet: boolean;
  /** "gemini" when the LLM was used, "heuristic" when the offline fallback ran. */
  source: "gemini" | "heuristic";
}

function buildPrompt(
  terms: ContractTermsLike,
  bol: BillOfLadingLike,
  lc: LcLike,
): string {
  // Only non-sensitive domain fields — no buyer/exporter identifiers.
  return [
    "You are a trade-finance analyst reviewing a Bill of Lading against a Letter of Credit's terms.",
    "",
    "Contract terms:",
    `- required port: ${terms.requiredPort}`,
    `- required BoL status: ${terms.requiredBolStatus}`,
    `- maximum value (cents): ${terms.maxValueCents}`,
    "",
    "Bill of Lading:",
    `- status: ${bol.status}`,
    `- delivery port: ${bol.port}`,
    `- vessel: ${bol.vesselId}`,
    "",
    "Letter of Credit:",
    `- value (cents): ${lc.valueCents}`,
    `- target port: ${lc.targetPort}`,
    "",
    "In 2-3 sentences, explain whether the delivery conditions appear to be satisfied and why.",
    'Then on a final line output exactly "ASSESSMENT: MET" or "ASSESSMENT: NOT MET".',
    "Note: your assessment is advisory; a separate deterministic policy check makes the binding decision.",
  ].join("\n");
}

function heuristicExplain(
  terms: ContractTermsLike,
  bol: BillOfLadingLike,
  lc: LcLike,
): BolAssessment {
  const issues: string[] = [];
  if (bol.status !== terms.requiredBolStatus)
    issues.push(`status is ${bol.status}, not ${terms.requiredBolStatus}`);
  if (bol.port !== terms.requiredPort)
    issues.push(`delivered to ${bol.port} but terms require ${terms.requiredPort}`);
  if (lc.valueCents > terms.maxValueCents)
    issues.push(`value exceeds the contract cap`);

  const met = issues.length === 0;
  const explanation = met
    ? `The Bill of Lading reports ${bol.status} at ${bol.port} aboard ${bol.vesselId}, matching the contract's required port and status, and the value is within the cap. Conditions appear satisfied. (heuristic explainer — no LLM configured)`
    : `The Bill of Lading does not appear to satisfy the terms: ${issues.join("; ")}. (heuristic explainer — no LLM configured)`;
  return { explanation, opinionMet: met, source: "heuristic" };
}

/**
 * Parse + explain a BoL. Returns advisory reasoning. Never throws on LLM
 * failure — falls back to the heuristic explainer so the agent loop continues.
 */
export async function parseAndExplainBoL(
  terms: ContractTermsLike,
  bol: BillOfLadingLike,
  lc: LcLike,
): Promise<BolAssessment> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return heuristicExplain(terms, bol, lc);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: buildPrompt(terms, bol, lc),
    });

    const text = response.text || "";

    const opinionMet = /ASSESSMENT:\s*MET/i.test(text) && !/NOT MET/i.test(text);
    return { explanation: text || "(empty model response)", opinionMet, source: "gemini" };
  } catch {
    // Network / auth / rate-limit — advisory step must never break the loop.
    return heuristicExplain(terms, bol, lc);
  }
}
