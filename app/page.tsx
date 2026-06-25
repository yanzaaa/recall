"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import dynamic from "next/dynamic";
import { MEMORY, QUEUE } from "@/lib/data";
import type { MemoryDecision, IncomingSignal, MemoryItem } from "@/lib/types";

const Hero3D = dynamic(() => import("@/components/Hero3D"), { ssr: false });

const EASE = [0.32, 0.72, 0, 1] as const;

const META: Record<string, { label: string; tag: string; edge: string }> = {
  store: { label: "Stored", tag: "tag-store", edge: "edge-store" },
  update: { label: "Updated", tag: "tag-update", edge: "edge-update" },
  ignore: { label: "Ignored", tag: "tag-ignore", edge: "edge-ignore" },
  escalate: { label: "Escalated to human", tag: "tag-escalate", edge: "edge-escalate" },
};

type Cell = MemoryDecision | "loading" | undefined;

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const item = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.75, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Tilt({ children, className }: { children: React.ReactNode; className?: string }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [5.5, -5.5]), { stiffness: 220, damping: 18 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-5.5, 5.5]), { stiffness: 220, damping: 18 });
  return (
    <motion.div
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width - 0.5);
        y.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onMouseLeave={() => { x.set(0); y.set(0); }}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function DecisionBody({ d }: { d: MemoryDecision }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="mt-3 pt-3"
      style={{ borderTop: "1px solid var(--hair)" }}
    >
      <div className="text-[13.5px] text-[#dbe3ee]">{d.reasoning}</div>
      <div className="flex items-center gap-2 mt-2.5">
        <span className="text-[11px] text-[var(--mut)] w-[78px]">confidence</span>
        <div className="gk-bar flex-1"><span style={{ width: `${Math.round(d.confidence * 100)}%` }} /></div>
        <span className="gk-num text-[11px] text-[var(--mut)] w-[34px] text-right">{Math.round(d.confidence * 100)}%</span>
      </div>
      {d.riskFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {d.riskFlags.map((f) => (<span key={f} className="gk-flag">{f}</span>))}
        </div>
      )}
      {d.heldBack && (
        <>
          <div className="text-[11.5px] text-[var(--mut)] mt-2.5 italic">A naive agent would have silently overwritten this.</div>
          <div className="gk-held mt-1.5">
            ⚠ The model proposed <b>{d.rawAction}</b>, so Recall held back and escalated instead of touching memory.
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5 text-[11px] text-[var(--mut)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="gk-engine-dot" data-engine={d.engine} />
          {d.engine === "qwen" ? `Reasoned by ${d.model ?? "qwen-max"}` : "deterministic fallback"}
        </span>
        {d.toolsUsed && d.toolsUsed.length > 0 && (
          <span>· tool call: <span className="gk-num">{d.toolsUsed.join(", ")}</span></span>
        )}
      </div>
    </motion.div>
  );
}

export default function Page() {
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [running, setRunning] = useState(false);
  const [engine, setEngine] = useState<string>();
  const [store, setStore] = useState<MemoryItem[]>(MEMORY);
  const [form, setForm] = useState({
    text: "I prefer late-evening flights.",
    proposesKey: "diet",
    proposesValue: "eats meat",
    confidence: "0.5",
    stakes: "low",
  });
  const [custom, setCustom] = useState<Cell>();

  // Memory PERSISTS across sessions (localStorage). This is the whole point of a memory
  // agent: the store actually accumulates — reload the page and your last session is restored.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("recall.memory.v1");
      if (saved) setStore(JSON.parse(saved));
    } catch {}
  }, []);
  const persist = (next: MemoryItem[]) => {
    setStore(next);
    try { localStorage.setItem("recall.memory.v1", JSON.stringify(next)); } catch {}
  };
  const resetMemory = () => {
    try { localStorage.removeItem("recall.memory.v1"); } catch {}
    setStore(MEMORY); setCells({}); setCustom(undefined);
  };

  const today = new Date().toISOString().slice(0, 10);
  const memStale = (m: MemoryItem) =>
    !m.locked && m.ttlDays != null && (Date.parse(today) - Date.parse(m.updatedAt)) / 86_400_000 > m.ttlDays;
  function applyDecision(current: MemoryItem[], s: IncomingSignal, d: MemoryDecision): MemoryItem[] {
    if (d.action === "store" && !current.some((m) => m.key === s.proposesKey)) {
      return [...current, { id: s.id, key: s.proposesKey, value: s.proposesValue, confidence: s.confidence, locked: false, source: "learned this session", updatedAt: today }];
    }
    if (d.action === "update") {
      return current.map((m) => (m.key === s.proposesKey ? { ...m, value: s.proposesValue, confidence: s.confidence, updatedAt: today } : m));
    }
    return current; // ignore / escalate never mutate memory
  }

  async function send(signal: IncomingSignal, currentStore: MemoryItem[]): Promise<MemoryDecision | undefined> {
    const res = await fetch("/api/recall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signal, store: currentStore }),
    });
    const { decision } = (await res.json()) as { decision: MemoryDecision };
    if (decision?.engine) setEngine(decision.engine);
    return decision;
  }

  async function run() {
    setRunning(true);
    setCells({});
    let working = [...store];
    for (const s of QUEUE) {
      setCells((c) => ({ ...c, [s.id]: "loading" }));
      try {
        const d = await send(s, working);
        if (d) { working = applyDecision(working, s, d); persist(working); }
        setCells((c) => ({ ...c, [s.id]: d }));
      } catch {
        setCells((c) => ({ ...c, [s.id]: undefined }));
      }
    }
    setRunning(false);
  }

  async function runCustom() {
    setCustom("loading");
    const s: IncomingSignal = {
      id: "CUSTOM",
      text: form.text,
      proposesKey: form.proposesKey,
      proposesValue: form.proposesValue,
      confidence: Number(form.confidence) || 0,
      stakes: (form.stakes as IncomingSignal["stakes"]) || "low",
      kind: "fact",
    };
    try {
      const d = await send(s, store);
      if (d) persist(applyDecision(store, s, d));
      setCustom(d ?? undefined);
    } catch { setCustom(undefined); }
  }

  const done = Object.values(cells).filter((d): d is MemoryDecision => !!d && d !== "loading");
  const stored = done.filter((d) => d.action === "store").length;
  const updated = done.filter((d) => d.action === "update").length;
  const ignored = done.filter((d) => d.action === "ignore").length;
  const esc = done.filter((d) => d.action === "escalate").length;
  const held = done.filter((d) => d.heldBack).length;
  const escalated = done.filter((d) => d.action === "escalate");
  const customDec = custom && custom !== "loading" ? custom : null;
  const customMeta = customDec ? META[customDec.action] : null;
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <main className="max-w-[1120px] mx-auto px-6 py-20 md:py-28">
      {/* Hero */}
      <div className="relative">
        <div className="pointer-events-none absolute right-[-90px] top-[-140px] hidden md:block w-[380px] h-[380px] lg:w-[460px] lg:h-[460px] z-0 opacity-[0.92]" aria-hidden>
          <Hero3D />
        </div>
        <motion.div variants={container} initial="hidden" animate="show" className="relative z-10">
          <motion.div variants={item}>
            <span className="gk-eyebrow"><span className="dot" /> Qwen Cloud · MemoryAgent</span>
          </motion.div>
          <motion.h1 variants={item} className="gk-title text-[clamp(52px,9vw,104px)] leading-[0.95] mt-5">
            Recall
          </motion.h1>
          <motion.p variants={item} className="text-[clamp(18px,2.2vw,23px)] text-[#d3cee0] mt-4 max-w-[46rem] leading-[1.5]" style={{ textShadow: "0 1px 16px rgba(8,4,20,0.55)" }}>
            The memory agent that knows when <span className="text-[#e9b3ff] font-semibold">not</span> to overwrite.
            It remembers what is clear, ignores the noise, and refuses to corrupt a trusted memory, escalating to a human instead.
          </motion.p>
          <motion.div variants={item} className="flex flex-wrap items-center gap-3 mt-9">
            <button className="gk-btn" onClick={run} disabled={running}>
              <span>{running ? "Processing signals" : "Run Recall on the signals"}</span>
              <span className="ico">{running ? <span className="spin" /> : "▶"}</span>
            </button>
            <span className="gk-pill">{QUEUE.length} new signals</span>
            {engine && (
              <span className="gk-pill">engine: <b className="text-[var(--ink)]">{engine === "qwen" ? "Qwen (live)" : "fallback"}</b></span>
            )}
          </motion.div>
          <motion.div variants={item} className="mt-7 gk-lockup">
            <span className="gk-mark"><span className="gk-glyph" /> Qwen<span className="sub">Cloud</span></span>
            <span className="gk-x">×</span>
            <span className="gk-mark gk-mark-dev">Devpost</span>
            <span className="gk-lockup-label">MemoryAgent Hackathon</span>
          </motion.div>
        </motion.div>
      </div>

      {/* Stats */}
      {done.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mt-12">
          <Stat n={stored + updated} label="memory writes committed" color="var(--acc)" i={0} />
          <Stat n={ignored} label="noise ignored" color="var(--mut)" i={1} />
          <Stat n={esc} label="escalated to a human" color="var(--amber)" i={2} />
          <Stat n={held} label="bad writes the guardrail held back" color="var(--acc2)" i={3} />
        </div>
      )}

      {/* Existing memory — persists across sessions, accumulates live */}
      <Reveal className="mt-20 mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="gk-kicker">What Recall already knows · {store.length} memories</div>
          <div className="text-[12px] text-[var(--mut)] mt-1.5">Persists across sessions — reload and your last session is restored. Writes accumulate here live as signals are processed.</div>
        </div>
        <button className="gk-pill" onClick={resetMemory} style={{ cursor: "pointer" }}>Reset memory</button>
      </Reveal>
      <div className="grid md:grid-cols-2 gap-3.5">
        {store.map((m, idx) => (
          <Reveal key={m.id} delay={Math.min(idx * 0.04, 0.3)}>
            <div className="glass p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] text-[var(--mut)] gk-num">{m.key}</div>
                  <div className="text-[15px] font-semibold mt-0.5">{m.value}</div>
                </div>
                {m.locked ? (
                  <span className="gk-flag" style={{ color: "#e9b3ff" }}>🔒 locked</span>
                ) : memStale(m) ? (
                  <span className="gk-flag" style={{ color: "var(--amber)" }}>⏳ stale</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <div className="gk-bar flex-1"><span style={{ width: fmtPct(m.confidence) }} /></div>
                <span className="gk-num text-[11px] text-[var(--mut)]">{fmtPct(m.confidence)}</span>
              </div>
              <div className="text-[11.5px] text-[var(--mut)] mt-1.5">{m.source}</div>
            </div>
          </Reveal>
        ))}
      </div>

      {/* Incoming signals */}
      <Reveal className="gk-kicker mt-20 mb-4">Incoming signals</Reveal>
      <div className="grid md:grid-cols-2 gap-3.5" style={{ perspective: 1200 }}>
        {QUEUE.map((s, idx) => {
          const cell = cells[s.id];
          const d = cell && cell !== "loading" ? cell : null;
          const m = d ? META[d.action] : null;
          return (
            <Reveal key={s.id} delay={Math.min(idx * 0.04, 0.3)}>
              <Tilt className={`glass p-5 ${m ? m.edge : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">&ldquo;{s.text}&rdquo;</div>
                    <div className="gk-num text-[12.5px] text-[var(--mut)] mt-1">
                      {s.proposesKey} → {s.proposesValue} · {fmtPct(s.confidence)} conf · {s.stakes} stakes
                    </div>
                  </div>
                  {cell === "loading" ? <div className="spin mt-1" /> : m ? <span className={`gk-tag ${m.tag}`}>{m.label}</span> : null}
                </div>
                {d && <DecisionBody d={d} />}
              </Tilt>
            </Reveal>
          );
        })}
      </div>

      {/* Human review */}
      {escalated.length > 0 && (
        <>
          <Reveal className="gk-kicker mt-20 mb-4">Human review queue ({escalated.length})</Reveal>
          <Reveal>
            <div className="glass p-5">
              <p className="text-[13.5px] text-[var(--mut)] mb-3">
                This is all a human ever has to look at. Everything else was remembered, revised, or ignored automatically — without corrupting a trusted memory.
              </p>
              <div className="flex flex-col gap-2">
                {escalated.map((d) => {
                  const s = QUEUE.find((q) => q.id === d.signalId)!;
                  return (
                    <div key={d.signalId} className="flex items-start justify-between gap-3 py-2.5" style={{ borderBottom: "1px solid var(--hair)" }}>
                      <div>
                        <div className="gk-num text-[14px] font-medium">{s.proposesKey} → {s.proposesValue}</div>
                        <div className="text-[12.5px] text-[var(--mut)]">{d.reasoning}</div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">{d.riskFlags.slice(0, 2).map((f) => <span key={f} className="gk-flag">{f}</span>)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </>
      )}

      {/* Try your own */}
      <Reveal className="gk-kicker mt-20 mb-4">Try your own signal</Reveal>
      <Reveal>
        <div className="gk-shell">
          <div className={`gk-core p-5 ${customMeta ? customMeta.edge : ""}`}>
            <p className="text-[13px] text-[var(--mut)] mb-3.5">
              Not a canned demo. Send any signal at the memory and watch the live Qwen agent decide — and the guardrail refuse a bad write. (Try a low-confidence change to a 🔒 locked key like <span className="gk-num">diet</span>.)
            </p>
            <div className="grid md:grid-cols-4 gap-2.5">
              <div className="md:col-span-4"><label className="gk-label">Signal</label><input className="gk-input" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></div>
              <div><label className="gk-label">Memory key</label><input className="gk-input gk-num" value={form.proposesKey} onChange={(e) => setForm({ ...form, proposesKey: e.target.value })} /></div>
              <div><label className="gk-label">New value</label><input className="gk-input" value={form.proposesValue} onChange={(e) => setForm({ ...form, proposesValue: e.target.value })} /></div>
              <div><label className="gk-label">Confidence (0-1)</label><input className="gk-input gk-num" value={form.confidence} inputMode="decimal" onChange={(e) => setForm({ ...form, confidence: e.target.value })} /></div>
              <div>
                <label className="gk-label">Stakes</label>
                <select className="gk-input" value={form.stakes} onChange={(e) => setForm({ ...form, stakes: e.target.value })}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button className="gk-btn" onClick={runCustom} disabled={custom === "loading"}>
                <span>{custom === "loading" ? "Thinking" : "Send to Recall"}</span>
                <span className="ico">{custom === "loading" ? <span className="spin" /> : "▶"}</span>
              </button>
              {customMeta && <span className={`gk-tag ${customMeta.tag}`}>{customMeta.label}</span>}
            </div>
            {customDec && <DecisionBody d={customDec} />}
          </div>
        </div>
      </Reveal>

      <footer className="mt-20 pt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between" style={{ borderTop: "1px solid var(--hair)" }}>
        <div className="text-[12.5px] text-[var(--mut)] max-w-[40rem]">
          Recall · built on Qwen Cloud for the Qwen × Devpost MemoryAgent Hackathon · the memory you trust because it knows what not to remember.
          <span className="block mt-1.5">Designed &amp; built by <span className="gk-sig">Anthony Yanza</span>.</span>
        </div>
        <div className="gk-lockup self-start md:self-auto">
          <span className="gk-mark"><span className="gk-glyph" /> Qwen<span className="sub">Cloud</span></span>
          <span className="gk-x">×</span>
          <span className="gk-mark gk-mark-dev">Devpost</span>
        </div>
      </footer>
    </main>
  );
}

function Stat({ n, label, color, i }: { n: number; label: string; color: string; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
      className="glass px-5 py-5"
    >
      <div className="gk-num text-[40px] font-extrabold leading-none" style={{ color }}><CountUp n={n} /></div>
      <div className="text-[12.5px] text-[var(--mut)] mt-2">{label}</div>
    </motion.div>
  );
}

function CountUp({ n }: { n: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 520);
      setV(Math.round(p * n));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  return <>{v}</>;
}
