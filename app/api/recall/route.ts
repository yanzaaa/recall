import { NextResponse } from "next/server";
import { triage } from "@/lib/agent";
import { MEMORY } from "@/lib/data";
import type { IncomingSignal, MemoryItem } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { signal?: IncomingSignal; store?: MemoryItem[] };
    if (!body?.signal?.id) {
      return NextResponse.json({ error: "missing signal" }, { status: 400 });
    }
    const store = Array.isArray(body.store) ? body.store : MEMORY;
    const decision = await triage(body.signal, store);
    return NextResponse.json({ decision });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
