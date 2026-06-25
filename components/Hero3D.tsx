"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Recall, visualized: signals stream toward memory. Clear, trusted facts pop and
// are absorbed straight in (mint). Risky overwrites of a protected memory slam to a
// stop at the gate, swell and pulse amber while the gate flares and fires a shockwave
// ring, then get bounced back to a human. "It refuses bad writes" IS the animation.
const COUNT = 26;
const C_PASS = new THREE.Color("#4ee6b0");
const C_BLOCK = new THREE.Color("#ffb020");

type Phase = "flow" | "blocked" | "bounce";
type Token = { x: number; y: number; z: number; speed: number; risky: boolean; phase: Phase; timer: number; spin: number };

function spawn(fresh: boolean): Token {
  return {
    x: (Math.random() - 0.5) * 0.66,
    y: (Math.random() - 0.5) * 0.66,
    z: fresh ? -7 - Math.random() * 3 : -3 - Math.random() * 7,
    speed: 0.44 + Math.random() * 0.38,
    risky: Math.random() < 0.42,
    phase: "flow",
    timer: 0,
    spin: Math.random() * Math.PI,
  };
}

function GateScene() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const gate = useRef<THREE.Group>(null!);
  const ringMat = useRef<THREE.MeshStandardMaterial>(null!);
  const flare = useRef<THREE.Mesh>(null!);
  const flareMat = useRef<THREE.MeshBasicMaterial>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const tokens = useMemo(() => Array.from({ length: COUNT }, () => spawn(false)), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const VIOLET = useMemo(() => new THREE.Color("#a78bfa"), []);
  const AMBER = useMemo(() => new THREE.Color("#ffb020"), []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const time = state.clock.elapsedTime;
    let blockEnergy = 0;

    for (let i = 0; i < COUNT; i++) {
      let t = tokens[i];

      if (t.phase === "flow") {
        t.z += dt * t.speed;
        if (t.risky && t.z >= 0) { t.phase = "blocked"; t.timer = 0; t.z = 0; }
        else if (t.z > 3.8) { t = tokens[i] = spawn(true); }
      } else if (t.phase === "blocked") {
        t.timer += dt; t.z = 0; blockEnergy += 1;
        if (t.timer > 1.15) { t.phase = "bounce"; t.timer = 0; }
      } else {
        t.timer += dt; t.z -= dt * 1.4; blockEnergy += 0.4;
        if (t.z < -3.2) { t = tokens[i] = spawn(true); }
      }

      let size: number;
      let color: THREE.Color;
      if (t.phase === "flow") {
        if (t.risky) {
          // risky requests are amber the whole way in, so you see them coming
          size = 0.12;
          color = C_BLOCK;
        } else {
          const passing = t.z > -0.5 && t.z < 0.6;
          size = 0.11 * (passing ? 1.7 : 1);
          color = C_PASS;
        }
      } else if (t.phase === "blocked") {
        size = 0.21 * (1 + Math.sin(time * 14) * 0.4);
        color = C_BLOCK;
      } else {
        size = 0.21 * Math.max(0, 1 - t.timer * 0.7);
        color = C_BLOCK;
      }

      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(t.spin + t.z * 0.5, t.spin + t.z * 0.4, 0);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
      mesh.current.setColorAt(i, color);
    }

    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;

    const k = Math.min(1, blockEnergy / 1.5);
    // the gate ring flares amber while actively blocking
    if (ringMat.current) {
      tmp.copy(VIOLET).lerp(AMBER, k * 0.9);
      ringMat.current.emissive.copy(tmp);
      ringMat.current.emissiveIntensity = 0.7 + k * 1.1;
    }
    // amber shockwave ring expands + glows when blocking
    if (flare.current && flareMat.current) {
      flareMat.current.opacity = k * 0.85;
      const s = 1 + k * 0.28 + Math.sin(time * 9) * 0.05 * k;
      flare.current.scale.set(s, s, s);
    }
    if (gate.current) {
      gate.current.rotation.z += dt * 0.09;
      gate.current.rotation.x = Math.sin(time * 0.28) * 0.1;
    }
  });

  return (
    <group>
      <group ref={gate}>
        <mesh>
          <torusGeometry args={[1.15, 0.07, 24, 96]} />
          <meshStandardMaterial ref={ringMat} color="#7c3aed" emissive="#a78bfa" emissiveIntensity={0.7} metalness={0.45} roughness={0.25} />
        </mesh>
        {/* amber shockwave ring (fires on block) */}
        <mesh ref={flare}>
          <torusGeometry args={[1.15, 0.03, 12, 96]} />
          <meshBasicMaterial ref={flareMat} color="#ffb020" transparent opacity={0} toneMapped={false} />
        </mesh>
        <mesh>
          <torusGeometry args={[1.42, 0.012, 10, 96]} />
          <meshBasicMaterial color="#c4b5fd" transparent opacity={0.35} toneMapped={false} />
        </mesh>
        <mesh>
          <torusGeometry args={[0.9, 0.01, 10, 96]} />
          <meshBasicMaterial color="#f0abfc" transparent opacity={0.3} toneMapped={false} />
        </mesh>
      </group>
      <instancedMesh ref={mesh} args={[geo, mat, COUNT]} />
    </group>
  );
}

export default function Hero3D() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // pause the WebGL render loop when the hero is scrolled offscreen (keeps scroll smooth)
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 140);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%" }}>
      <Canvas
        frameloop={active ? "always" : "never"}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.2, 5], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ pointerEvents: "none", background: "transparent" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 5, 4]} intensity={1.3} />
        <pointLight position={[-5, -2, -3]} intensity={1.2} color="#c026d3" />
        <pointLight position={[3, -3, 3]} intensity={0.9} color="#22d3ee" />
        <GateScene />
      </Canvas>
    </div>
  );
}
