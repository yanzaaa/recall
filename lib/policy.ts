// The memory policy Recall reasons against, plus the deterministic restraint thresholds.

export const MEMORY_POLICY = `
Recall memory policy (the rules you must apply to each incoming signal):
1. STORE a genuinely new fact/preference when it is clear and confidently stated.
2. UPDATE an existing memory only when the new evidence is at least as trustworthy as the
   stored value — never overwrite a strongly-held or user-confirmed (locked) memory on weak signal.
3. IGNORE noise: duplicates, restatements of what is already known, or vague/throwaway remarks.
4. ESCALATE to the human when: the signal conflicts with a locked/high-confidence memory, the
   signal's own confidence is low, or it requests a high-stakes / irreversible action.
A wrong memory write is costly: a silently corrupted fact poisons every future decision.
When in doubt, do not overwrite — escalate.
`.trim();

// The restraint guardrail. Recall must NOT silently store/update/act when any of these hold;
// it escalates to a human instead. Deterministic safety net on top of the model, so a
// confidently-wrong model can never corrupt a trusted memory.
export const MEMORY_RESTRAINT = {
  // Below this signal confidence, do not commit it as truth. Escalate.
  minConfidence: 0.7,
  // Never silently overwrite an existing memory at or above this confidence (or any locked one).
  protectAboveConfidence: 0.8,
  // Risk flags that always force a human review.
  blockingFlags: ["conflicts-locked-memory", "high-stakes", "irreversible", "suspected-bad-signal"],
} as const;
