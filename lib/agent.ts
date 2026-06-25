import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { MemoryAction, MemoryDecision, MemoryItem, MemoryRisk, IncomingSignal } from "./types";
import { MEMORY_POLICY, MEMORY_RESTRAINT } from "./policy";
import { qwenClient, QWEN_MODEL } from "./qwen";

const SYSTEM = `You are Recall, an autonomous personal-memory agent. You maintain a long-lived memory of
facts and preferences about the user. For each incoming signal you decide ONE action:
"store" (a new fact), "update" (revise an existing memory), "ignore" (noise/duplicate), or
"escalate" (hand to the human).

${MEMORY_POLICY}

THE MOST IMPORTANT RULE, know when NOT to write:
The dangerous failure is not forgetting, it is silently remembering something wrong. A corrupted
memory poisons every future decision. So you only auto-store or auto-update when the signal is
clear, confident, and does not contradict a strongly-held memory. The moment a signal conflicts
with a locked/high-confidence memory, is itself low-confidence, or asks for a high-stakes or
irreversible action, you ESCALATE to the human instead of mutating memory or acting.

If the signal's proposed value is the same as (or a trivial restatement of) what you already have,
choose "ignore" — there is nothing to change; do not log a no-op update.

If the existing memory is marked STALE in the tool result (it is past its TTL), treat it as
outdated: prefer to refresh it with a confident new value rather than guard it as protected.

TOOL USE: before deciding, you MUST call inspect_memory to get the deterministic state of the
existing memory for this key (its value, confidence, and whether it is locked). Do not guess it.

Respond with STRICT JSON only, no prose, in exactly this shape:
{
  "action": "store" | "update" | "ignore" | "escalate",
  "confidence": number between 0 and 1,
  "reasoning": "one or two sentences, plain English",
  "riskFlags": ["zero or more of: conflicts-locked-memory, conflicting-evidence, low-confidence, high-stakes, irreversible, duplicate, suspected-bad-signal"]
}`;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "inspect_memory",
      description:
        "Look up the current memory for a key: whether one exists, its stored value and confidence, whether it is locked, and whether the incoming signal conflicts with it. Call this before deciding.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "the memory key the signal touches, e.g. 'diet'" },
          proposedValue: { type: "string", description: "the new value the signal implies" },
        },
        required: ["key", "proposedValue"],
      },
    },
  },
];

function signalPrompt(s: IncomingSignal): string {
  return `Incoming signal:
- id: ${s.id}
- text: "${s.text}"
- proposes key: ${s.proposesKey}
- proposes value: ${s.proposesValue}
- signal confidence: ${s.confidence}
- stakes if acted on: ${s.stakes}
- kind: ${s.kind}

Decide the action and return the JSON.`;
}

// Deterministic memory lookup. Used both as the agent's tool implementation and inside the
// key-free fallback, so the conflict/locked signals are computed the same robust way in both paths.
// Today as YYYY-MM-DD (server-side); overridable for deterministic tests.
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Timely forgetting: a memory goes STALE (outdated -> safe to refresh) once it is past its TTL.
// Locked facts and facts with no TTL never go stale.
export function isStale(item: MemoryItem, refISO: string = todayISO()): boolean {
  if (item.locked || item.ttlDays == null) return false;
  const days = (Date.parse(refISO) - Date.parse(item.updatedAt)) / 86_400_000;
  return days > item.ttlDays;
}

export function assessMemoryRisk(
  store: MemoryItem[],
  key: string,
  proposedValue: string,
  stakes: IncomingSignal["stakes"],
  refISO: string = todayISO(),
): MemoryRisk {
  const existing = store.find((m) => m.key === key);
  const norm = (v: string) => v.trim().toLowerCase();
  const conflictsExisting = !!existing && norm(existing.value) !== norm(proposedValue);
  return {
    hasExisting: !!existing,
    conflictsExisting,
    conflictsLocked: conflictsExisting && !!existing?.locked,
    existingConfidence: existing?.confidence ?? 0,
    existingStale: existing ? isStale(existing, refISO) : false,
    isHighStakes: stakes === "high",
  };
}

// The deterministic restraint guardrail. It sits on TOP of the model: even if the model
// confidently returns store/update/ignore, this forces an escalation for risky writes.
// One-way ratchet: it can only make a memory action SAFER (-> escalate), never less safe.
export function applyMemoryRestraint(
  rawAction: MemoryAction,
  signal: IncomingSignal,
  risk: MemoryRisk,
  modelFlags: string[],
): { action: MemoryAction; heldBack: boolean; flags: string[] } {
  const flags = new Set(modelFlags);
  if (risk.conflictsLocked) flags.add("conflicts-locked-memory");
  if (signal.stakes === "high") flags.add("high-stakes");
  if (signal.confidence < MEMORY_RESTRAINT.minConfidence) flags.add("low-confidence");

  // "escalate" and "ignore" never mutate or act, so they are always safe to pass through.
  if (rawAction === "escalate" || rawAction === "ignore") {
    return { action: rawAction, heldBack: false, flags: [...flags] };
  }

  // Deterministic no-op guard: a "write" that changes nothing is a restatement -> ignore.
  if ((rawAction === "store" || rawAction === "update") && risk.hasExisting && !risk.conflictsExisting) {
    return { action: "ignore", heldBack: false, flags: [...flags] };
  }

  const lowConfidence = signal.confidence < MEMORY_RESTRAINT.minConfidence;
  const highStakes = signal.stakes === "high";
  const overwriteProtected =
    rawAction === "update" &&
    risk.conflictsExisting &&
    !risk.existingStale && // a stale memory is outdated -> safe to refresh, not protected
    (risk.conflictsLocked || risk.existingConfidence >= MEMORY_RESTRAINT.protectAboveConfidence);
  const blocking = [...flags].some((f) => (MEMORY_RESTRAINT.blockingFlags as readonly string[]).includes(f));

  if (lowConfidence || highStakes || overwriteProtected || blocking) {
    if (overwriteProtected) {
      // Be precise about WHY: a locked memory vs a merely high-confidence (>= floor) one.
      flags.add(risk.conflictsLocked ? "conflicts-locked-memory" : "conflicts-protected-memory");
    }
    return { action: "escalate", heldBack: true, flags: [...flags] };
  }
  return { action: rawAction, heldBack: false, flags: [...flags] };
}

// Deterministic, key-free triage so the app runs before the Qwen credits land (and as a fallback
// if the API is unavailable). Mirrors the policy + restraint rules and the same risk signals.
export function fallbackTriage(signal: IncomingSignal, store: MemoryItem[]): MemoryDecision {
  const risk = assessMemoryRisk(store, signal.proposesKey, signal.proposesValue, signal.stakes);
  const flags: string[] = [];

  let raw: MemoryAction;
  let confidence = signal.confidence;
  let reasoning: string;

  if (!risk.hasExisting) {
    raw = "store";
    reasoning = `New fact for "${signal.proposesKey}"; no prior memory to conflict with.`;
  } else if (!risk.conflictsExisting) {
    raw = "ignore";
    reasoning = `Restates the existing "${signal.proposesKey}" memory; nothing to change.`;
    flags.push("duplicate");
  } else {
    raw = "update";
    reasoning = `New value for "${signal.proposesKey}" conflicts with the stored one; revising.`;
    flags.push("conflicting-evidence");
  }

  const restrained = applyMemoryRestraint(raw, signal, risk, flags);
  return {
    signalId: signal.id,
    action: restrained.action,
    rawAction: raw,
    heldBack: restrained.heldBack,
    confidence,
    reasoning,
    riskFlags: restrained.flags,
    engine: "fallback",
    toolsUsed: ["inspect_memory"],
  };
}

export async function triage(signal: IncomingSignal, store: MemoryItem[]): Promise<MemoryDecision> {
  const client = qwenClient();
  if (!client) return fallbackTriage(signal, store);

  try {
    const convo: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: signalPrompt(signal) },
    ];
    const toolsUsed: string[] = [];

    // Round 1: require the agent to inspect memory before it can decide.
    const first = await client.chat.completions.create({
      model: QWEN_MODEL,
      temperature: 0,
      tools: TOOLS,
      tool_choice: { type: "function", function: { name: "inspect_memory" } },
      messages: convo,
    });
    const m1 = first.choices[0]?.message;
    const risk = assessMemoryRisk(store, signal.proposesKey, signal.proposesValue, signal.stakes);

    if (m1?.tool_calls?.length) {
      convo.push({ role: "assistant", content: m1.content ?? "", tool_calls: m1.tool_calls });
      for (const tc of m1.tool_calls) {
        if (tc.type === "function" && tc.function.name === "inspect_memory") {
          // Computed from the TRUSTED store, not from model-supplied args, so the model
          // cannot poison its own memory-risk signal.
          const existing = store.find((m) => m.key === signal.proposesKey) ?? null;
          toolsUsed.push("inspect_memory");
          convo.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ existing, risk }),
          });
        } else {
          convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "unknown tool" }) });
        }
      }
    } else if (m1?.content) {
      convo.push({ role: "assistant", content: m1.content });
    }

    // Final: force the decision JSON (no tools), with the memory state now in context.
    const completion = await client.chat.completions.create({
      model: QWEN_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [...convo, { role: "user", content: "Now return ONLY the decision JSON, nothing else." }],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      action: MemoryAction;
      confidence: number;
      reasoning: string;
      riskFlags?: string[];
    };

    const rawAction: MemoryAction = ["store", "update", "ignore", "escalate"].includes(parsed.action)
      ? parsed.action
      : "escalate";
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    const modelFlags = Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [];

    const restrained = applyMemoryRestraint(rawAction, signal, risk, modelFlags);
    return {
      signalId: signal.id,
      action: restrained.action,
      rawAction,
      heldBack: restrained.heldBack,
      confidence,
      reasoning: parsed.reasoning || "(no reasoning returned)",
      riskFlags: restrained.flags,
      engine: "qwen",
      model: QWEN_MODEL,
      toolsUsed,
    };
  } catch {
    const fb = fallbackTriage(signal, store);
    return { ...fb, reasoning: fb.reasoning + " (Qwen unavailable, deterministic fallback used.)" };
  }
}
