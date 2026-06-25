export type MemoryAction = "store" | "update" | "ignore" | "escalate";

// A fact Recall holds about the user, accumulated across sessions.
export interface MemoryItem {
  id: string;
  key: string; // e.g. "diet", "budget_cap", "home_airport"
  value: string;
  confidence: number; // 0..1 — how strongly the fact is held
  locked: boolean; // user-confirmed / high-trust: never silently overwrite
  source: string; // how it was learned
  updatedAt: string;
}

// A new observation arriving this session that may touch memory.
export interface IncomingSignal {
  id: string;
  text: string; // the raw observation / statement
  proposesKey: string; // which memory key it touches
  proposesValue: string; // the new value it implies
  confidence: number; // 0..1 — how confident the signal itself is
  stakes: "low" | "medium" | "high"; // impact/irreversibility if acted on
  kind: "preference" | "fact" | "action-request";
}

export interface MemoryDecision {
  signalId: string;
  action: MemoryAction; // FINAL action after the restraint guardrail
  rawAction: MemoryAction; // what the model proposed BEFORE the guardrail
  heldBack: boolean; // true if the guardrail overrode a mutate/act into escalate
  confidence: number; // 0..1 (model's self-reported confidence)
  reasoning: string;
  riskFlags: string[]; // e.g. ["conflicts-locked-memory", "low-confidence", "high-stakes"]
  engine: "qwen" | "fallback";
  model?: string;
  toolsUsed?: string[];
}

// Deterministic signals the agent looks up via a tool instead of guessing.
export interface MemoryRisk {
  hasExisting: boolean;
  conflictsExisting: boolean; // an existing memory has a different value
  conflictsLocked: boolean; // the conflicting existing memory is locked
  existingConfidence: number; // confidence of the existing memory (0 if none)
  isHighStakes: boolean;
}
