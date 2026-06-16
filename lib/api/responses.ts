import { NextResponse } from "next/server";
import { assertNoRawAccountData, maskRef } from "../t3/redact";

export function safeJson(data: unknown, init?: ResponseInit): NextResponse {
  assertNoRawAccountData(data);
  return NextResponse.json(data, init);
}

export function errorJson(err: unknown, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : "Unknown error";
  return safeJson(
    {
      ok: false,
      error: message,
      ts: new Date().toISOString(),
    },
    { status },
  );
}

export function masked(value: string | null | undefined): string | null {
  return value ? maskRef(value) : null;
}

