import type { IncomingSignal, MemoryDecision, MemoryItem } from "./types";
import { MEMORY } from "./data";

// Durable, server-side, cross-session memory backed by Supabase (Postgres). The store lives on
// the server, not the browser — so the memory a judge sees is the same on any device, and it
// genuinely accumulates across sessions. If Supabase env is absent, it degrades to the in-memory
// seed so the app still runs (same fallback philosophy as the Qwen client).
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const enabled = !!(SB_URL && SB_KEY);

const headers = (extra: Record<string, string> = {}) => ({
  apikey: SB_KEY as string,
  Authorization: `Bearer ${SB_KEY}`,
  "content-type": "application/json",
  ...extra,
});

interface Row {
  id: string; key: string; value: string; confidence: number;
  locked: boolean; source: string; updated_at: string; ttl_days: number | null;
}
const toItem = (r: Row): MemoryItem => ({
  id: r.id, key: r.key, value: r.value, confidence: r.confidence,
  locked: r.locked, source: r.source, updatedAt: r.updated_at, ttlDays: r.ttl_days ?? undefined,
});
const toRow = (m: MemoryItem): Row => ({
  id: m.id, key: m.key, value: m.value, confidence: m.confidence,
  locked: m.locked, source: m.source, updated_at: m.updatedAt, ttl_days: m.ttlDays ?? null,
});

async function seed(): Promise<MemoryItem[]> {
  await fetch(`${SB_URL}/rest/v1/memories`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=ignore-duplicates" }),
    body: JSON.stringify(MEMORY.map(toRow)),
  });
  return MEMORY;
}

export async function getStore(): Promise<MemoryItem[]> {
  if (!enabled) return MEMORY;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/memories?select=*`, { headers: headers(), cache: "no-store" });
    if (!res.ok) return MEMORY;
    const rows = (await res.json()) as Row[];
    if (!rows.length) return await seed();
    // stable order: keep seed order first, then any newer keys
    const order = new Map(MEMORY.map((m, i) => [m.key, i]));
    return rows.map(toItem).sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
  } catch {
    return MEMORY;
  }
}

async function upsert(item: MemoryItem): Promise<void> {
  if (!enabled) return;
  try {
    await fetch(`${SB_URL}/rest/v1/memories?on_conflict=key`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify([toRow(item)]),
    });
  } catch {}
}

export async function resetStore(): Promise<MemoryItem[]> {
  if (!enabled) return MEMORY;
  try {
    await fetch(`${SB_URL}/rest/v1/memories?id=neq.__never__`, { method: "DELETE", headers: headers() });
    return await seed();
  } catch {
    return MEMORY;
  }
}

// Apply a decision's effect on memory and persist it. ignore/escalate never change a fact's value;
// a confirming restatement (ignore on a same-value signal) reinforces confidence + refreshes it.
export async function applyAndPersist(
  store: MemoryItem[],
  signal: IncomingSignal,
  d: MemoryDecision,
): Promise<MemoryItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const norm = (v: string) => v.trim().toLowerCase();

  if (d.action === "store" && !store.some((m) => m.key === signal.proposesKey)) {
    const item: MemoryItem = { id: signal.id, key: signal.proposesKey, value: signal.proposesValue, confidence: signal.confidence, locked: false, source: "learned this session", updatedAt: today };
    await upsert(item);
    return [...store, item];
  }
  if (d.action === "update") {
    const ex = store.find((m) => m.key === signal.proposesKey);
    if (ex) {
      const item = { ...ex, value: signal.proposesValue, confidence: signal.confidence, updatedAt: today };
      await upsert(item);
      return store.map((m) => (m.key === ex.key ? item : m));
    }
  }
  if (d.action === "ignore") {
    const ex = store.find((m) => m.key === signal.proposesKey && norm(m.value) === norm(signal.proposesValue));
    if (ex) {
      const item = { ...ex, confidence: Math.min(0.99, +(ex.confidence + 0.03).toFixed(3)), updatedAt: today };
      await upsert(item);
      return store.map((m) => (m.key === ex.key ? item : m));
    }
  }
  return store;
}
