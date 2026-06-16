import { onStep, type StepEvent } from "@/lib/t3/events";
import { assertNoRawAccountData } from "@/lib/t3/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeSse(event: string, data: unknown): Uint8Array {
  assertNoRawAccountData(data);
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET() {
  let unsubscribe: (() => void) | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encodeSse("ready", {
          ok: true,
          message: "Agent event stream connected",
          ts: new Date().toISOString(),
        }),
      );

      unsubscribe = onStep((event: StepEvent) => {
        controller.enqueue(encodeSse("step", event));
      });

      keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive ${new Date().toISOString()}\n\n`));
      }, 25_000);
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
