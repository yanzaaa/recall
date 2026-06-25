import { NextResponse } from "next/server";
import { triage } from "@/lib/agent";
import { getStore, applyAndPersist, resetStore } from "@/lib/store";
import type { IncomingSignal } from "@/lib/types";

export const runtime = "nodejs";

// Current durable memory store (server-side, cross-session).
export async function GET() {
  return NextResponse.json({ store: await getStore() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { signal?: IncomingSignal; reset?: boolean };
    if (body?.reset) {
      return NextResponse.json({ store: await resetStore() });
    }
    if (!body?.signal?.id) {
      return NextResponse.json({ error: "missing signal" }, { status: 400 });
    }
    const store = await getStore();
    const decision = await triage(body.signal, store);
    const updated = await applyAndPersist(store, body.signal, decision);
    return NextResponse.json({ decision, store: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
