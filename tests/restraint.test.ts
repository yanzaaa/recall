import { describe, it, expect } from "vitest";
import { applyMemoryRestraint, assessMemoryRisk, fallbackTriage } from "../lib/agent";
import { MEMORY_RESTRAINT } from "../lib/policy";
import { MEMORY, QUEUE } from "../lib/data";
import type { IncomingSignal, MemoryRisk } from "../lib/types";

const sig = (over: Partial<IncomingSignal> = {}): IncomingSignal => ({
  id: "T", text: "t", proposesKey: "k", proposesValue: "v",
  confidence: 0.9, stakes: "low", kind: "fact", ...over,
});
const risk = (over: Partial<MemoryRisk> = {}): MemoryRisk => ({
  hasExisting: false, conflictsExisting: false, conflictsLocked: false,
  existingConfidence: 0, isHighStakes: false, ...over,
});

describe("applyMemoryRestraint — the deterministic memory guardrail", () => {
  it("stores a confident, low-stakes new fact", () => {
    const r = applyMemoryRestraint("store", sig(), risk(), []);
    expect(r.action).toBe("store");
    expect(r.heldBack).toBe(false);
  });

  it("lets an update to an unlocked, low-confidence memory through", () => {
    const r = applyMemoryRestraint("update", sig({ confidence: 0.86 }), risk({ hasExisting: true, conflictsExisting: true, existingConfidence: 0.6 }), []);
    expect(r.action).toBe("update");
    expect(r.heldBack).toBe(false);
  });

  it("WITHHOLDS an overwrite of a LOCKED memory and escalates", () => {
    const r = applyMemoryRestraint("update", sig({ confidence: 0.9 }), risk({ hasExisting: true, conflictsExisting: true, conflictsLocked: true, existingConfidence: 0.95 }), []);
    expect(r.action).toBe("escalate");
    expect(r.heldBack).toBe(true);
    expect(r.flags).toContain("conflicts-locked-memory");
  });

  it("WITHHOLDS an overwrite of a high-confidence (>= protect floor) memory even if unlocked", () => {
    const r = applyMemoryRestraint("update", sig({ confidence: 0.9 }), risk({ hasExisting: true, conflictsExisting: true, existingConfidence: MEMORY_RESTRAINT.protectAboveConfidence }), []);
    expect(r.action).toBe("escalate");
    expect(r.heldBack).toBe(true);
  });

  it("escalates a low-confidence write", () => {
    const r = applyMemoryRestraint("store", sig({ confidence: MEMORY_RESTRAINT.minConfidence - 0.01 }), risk(), []);
    expect(r.action).toBe("escalate");
    expect(r.heldBack).toBe(true);
  });

  it("escalates a high-stakes action regardless of confidence", () => {
    const r = applyMemoryRestraint("store", sig({ confidence: 0.99, stakes: "high" }), risk({ isHighStakes: true }), []);
    expect(r.action).toBe("escalate");
    expect(r.heldBack).toBe(true);
    expect(r.flags).toContain("high-stakes");
  });

  it("lets a benign 'ignore' pass through (never an override)", () => {
    const r = applyMemoryRestraint("ignore", sig({ confidence: 0.2 }), risk({ hasExisting: true }), []);
    expect(r.action).toBe("ignore");
    expect(r.heldBack).toBe(false);
  });

  it("never downgrades an escalate to a write (one-way ratchet)", () => {
    for (const conf of [0, 0.5, 0.7, 1]) {
      for (const stakes of ["low", "high"] as const) {
        const r = applyMemoryRestraint("escalate", sig({ confidence: conf, stakes }), risk({ conflictsLocked: true }), []);
        expect(r.action).toBe("escalate");
      }
    }
  });

  it("updates an unlocked memory at exactly the protect floor minus epsilon", () => {
    const r = applyMemoryRestraint("update", sig({ confidence: 0.9 }), risk({ hasExisting: true, conflictsExisting: true, existingConfidence: MEMORY_RESTRAINT.protectAboveConfidence - 0.01 }), []);
    expect(r.action).toBe("update");
  });
});

describe("assessMemoryRisk — deterministic lookup", () => {
  it("flags a conflict with a locked memory", () => {
    const r = assessMemoryRisk(MEMORY, "diet", "eats meat", "low");
    expect(r.hasExisting).toBe(true);
    expect(r.conflictsExisting).toBe(true);
    expect(r.conflictsLocked).toBe(true);
    expect(r.existingConfidence).toBeGreaterThan(0.9);
  });

  it("reports no existing memory for a new key", () => {
    const r = assessMemoryRisk(MEMORY, "seat_pref", "window", "low");
    expect(r.hasExisting).toBe(false);
    expect(r.conflictsExisting).toBe(false);
  });

  it("does not flag a restatement of the same value as a conflict", () => {
    const r = assessMemoryRisk(MEMORY, "home_airport", "SFO", "low");
    expect(r.conflictsExisting).toBe(false);
  });
});

describe("fallbackTriage — end-to-end over the demo signals", () => {
  const byId = (id: string) => QUEUE.find((q) => q.id === id)!;

  it("escalates the locked-diet conflict and records the held-back override (the money moment)", () => {
    const d = fallbackTriage(byId("S-03"), MEMORY);
    expect(d.action).toBe("escalate");
    expect(d.heldBack).toBe(true);
    expect(d.rawAction).toBe("update");
    expect(d.riskFlags).toContain("conflicts-locked-memory");
  });

  it("stores a confident new preference", () => {
    expect(fallbackTriage(byId("S-01"), MEMORY).action).toBe("store");
  });

  it("updates an unlocked low-confidence memory", () => {
    expect(fallbackTriage(byId("S-02"), MEMORY).action).toBe("update");
  });

  it("ignores a restatement of an existing memory", () => {
    expect(fallbackTriage(byId("S-05"), MEMORY).action).toBe("ignore");
  });

  it("escalates a low-confidence change to a high-confidence memory", () => {
    const d = fallbackTriage(byId("S-06"), MEMORY);
    expect(d.action).toBe("escalate");
    expect(d.heldBack).toBe(true);
  });

  it("escalates a high-stakes action (S-04) and a confident overwrite of a locked memory (S-08)", () => {
    const a = fallbackTriage(byId("S-04"), MEMORY);
    expect(a.action).toBe("escalate");
    expect(a.heldBack).toBe(true);
    const b = fallbackTriage(byId("S-08"), MEMORY);
    expect(b.action).toBe("escalate");
    expect(b.heldBack).toBe(true);
    expect(b.riskFlags).toContain("conflicts-locked-memory");
  });

  it("consulted the inspect_memory tool on every decision", () => {
    for (const s of QUEUE) expect(fallbackTriage(s, MEMORY).toolsUsed).toContain("inspect_memory");
  });
});
