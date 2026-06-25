import type { IncomingSignal, MemoryItem } from "./types";

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

// Context-budgeted recall: a real memory agent cannot stuff its entire store into the model's
// context window. So before deciding, Recall ranks memories by relevance to the incoming signal
// and loads only the top-K within a budget — the rest are deliberately left out of context.
// Relevance = exact-key match (dominant) > token overlap with the signal > confidence > recency.
export function recallRelevant(
  store: MemoryItem[],
  signal: Pick<IncomingSignal, "proposesKey" | "proposesValue" | "text">,
  budget = 3,
): { loaded: MemoryItem[]; skipped: MemoryItem[] } {
  const q = new Set(tokens(`${signal.proposesKey} ${signal.proposesValue} ${signal.text}`));
  const score = (m: MemoryItem) => {
    let s = 0;
    if (m.key === signal.proposesKey) s += 1000; // the memory the signal targets is always critical
    for (const t of tokens(`${m.key} ${m.value}`)) if (q.has(t)) s += 10;
    s += m.confidence * 3;
    s += (Date.parse(m.updatedAt) || 0) / 1e13; // tiny recency tiebreak
    return s;
  };
  const ranked = [...store].map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s);
  return {
    loaded: ranked.slice(0, budget).map((x) => x.m),
    skipped: ranked.slice(budget).map((x) => x.m),
  };
}
