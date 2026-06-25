/**
 * Recall MCP server — exposes the vetted, guarded memory to any MCP client (Claude Desktop,
 * Cursor, other agents) over stdio. Other agents can READ Recall's trusted memory and SUBMIT
 * signals to it, but every write still passes the same deterministic restraint guardrail — so a
 * second agent can't corrupt the memory either. Run: `npm run mcp`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "node:fs";
import { triage } from "./lib/agent";
import { getStore, applyAndPersist } from "./lib/store";
import type { IncomingSignal } from "./lib/types";

// Minimal .env loader so the same Qwen + Supabase config powers the MCP server.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const server = new Server({ name: "recall-memory", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_memory",
      description:
        "Return Recall's current vetted memory store (each item: key, value, confidence, locked, ttlDays, updatedAt). This is the durable, cross-session memory the guardrail protects.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "submit_signal",
      description:
        "Submit a new observation to Recall. It decides store / update / ignore / escalate under its deterministic restraint guardrail (it refuses to overwrite a locked/high-confidence memory, act on low confidence, or take a high-stakes action — escalating instead) and persists the result. Returns the decision and the updated store.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "the raw observation/statement" },
          proposesKey: { type: "string", description: "the memory key it touches, e.g. 'diet'" },
          proposesValue: { type: "string", description: "the value it implies" },
          confidence: { type: "number", description: "0..1 confidence of the signal" },
          stakes: { type: "string", enum: ["low", "medium", "high"], description: "impact if acted on" },
        },
        required: ["text", "proposesKey", "proposesValue", "confidence"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  if (name === "get_memory") {
    const store = await getStore();
    return { content: [{ type: "text", text: JSON.stringify(store, null, 2) }] };
  }

  if (name === "submit_signal") {
    const signal: IncomingSignal = {
      id: "mcp-" + Math.random().toString(36).slice(2, 8),
      text: String(args.text ?? ""),
      proposesKey: String(args.proposesKey ?? ""),
      proposesValue: String(args.proposesValue ?? ""),
      confidence: Number(args.confidence) || 0,
      stakes: (["low", "medium", "high"].includes(String(args.stakes)) ? String(args.stakes) : "low") as IncomingSignal["stakes"],
      kind: "fact",
    };
    const store = await getStore();
    const decision = await triage(signal, store);
    const updated = await applyAndPersist(store, signal, decision);
    return { content: [{ type: "text", text: JSON.stringify({ decision, store: updated }, null, 2) }] };
  }

  throw new Error(`unknown tool: ${name}`);
});

async function main() {
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  console.error("recall-mcp failed:", e);
  process.exit(1);
});
