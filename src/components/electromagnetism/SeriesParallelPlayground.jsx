import React, { useEffect, useRef, useState } from "react";
import { seriesResistance, parallelResistance } from "../../lib/electromagnetism";

// SeriesParallelPlayground.jsx (v3.4)
// - Per-branch vertical feed animations gated (no motion when branch open)
// - Add neutral (non-animated) split spine for visual continuity
// - Battery graphic: remove inner bars, add +/- labels, shift position down/right
// - Keep larger hover targets, warmer bulb, clearer nodes, strict zero gating

const fmt = (x, unit) => `${x.toFixed(0)} ${unit}`;
const fexp = (x, unit) => (Math.abs(x) < 1e-3 || Math.abs(x) > 1e4 ? `${x.toExponential(2)} ${unit}` : `${x.toFixed(3)} ${unit}`);

export default function SeriesParallelPlayground({ width = 940, height = 580 }) {
  // Controls
  const [V, setV] = useState(9);        // V
  const [Rb, setRb] = useState(60);     // bulb Ω
  const [RA, setRA] = useState(150);    // branch A Ω
  const [RB1, setRB1] = useState(220);  // branch B part 1 Ω
  const [RB2, setRB2] = useState(330);  // branch B part 2 Ω
  const [SA, setSA] = useState(true);   // branch A switch
  const [SB, setSB] = useState(false);  // branch B switch

  // ========= Grid helpers =========
  const g = 20; // grid size in px
  const pad = 2 * g;
  const Gx = (n) => pad + n * g;
  const Gy = (n) => pad + n * g;

  // Key coordinates
  const xBatt = Gx(2);
  const xBulb = Gx(16);
  const xSplitL = Gx(22);
  const xSplitR = Gx(34);
  const xRight = Gx(42);
  const yTop = Gy(3);
  const yA = Gy(12);
  const yB = Gy(18);
  const yBottom = Gy(26);

  // ========= Circuit math =========
  const RAeff = SA ? RA : Infinity;
  const RBeff = SB ? seriesResistance([RB1, RB2]) : Infinity;
  const finiteBranches = [RAeff, RBeff].filter(isFinite);
  const hasAny = finiteBranches.length > 0;
  const Rpar = hasAny ? parallelResistance(finiteBranches) : Infinity;
  const Rtot = hasAny ? seriesResistance([Rb, Rpar]) : Infinity;
  const I = hasAny ? (V / Rtot) : 0;             // total current through battery & bulb
  const Vbulb = I * Rb;                           // drop across bulb
  const Vpar = hasAny ? (V - Vbulb) : 0;          // drop across the parallel network
  const IA = isFinite(RAeff) ? Vpar / RAeff : 0;  // branch A current
  const IB = isFinite(RBeff) ? Vpar / RBeff : 0;  // branch B current

  // Power
  const P_bulb = I * I * Rb;
  const P_RA = IA * IA * (isFinite(RAeff) ? RA : 0);
  const P_RB1 = IB * IB * (isFinite(RBeff) ? RB1 : 0);
  const P_RB2 = IB * IB * (isFinite(RBeff) ? RB2 : 0);
  const P_batt = V * I; // power delivered by battery

  // ========= Wire animation =========
  const [tick, setTick] = useState(0);
  const rafRef = useRef(0);
  useEffect(() => {
    let last = performance.now();
    const loop = (t) => {
      const dt = (t - last) / 1000;
      last = t;
      setTick((x) => x + dt);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const SPEED_MIN = 30;
  const SPEED_MAX = 220;
  const ZERO_EPS = 1e-12; // strict zero
  const speed = (amps) => {
    const a = Math.abs(amps);
    if (a < ZERO_EPS) return 0; // freeze animation
    return Math.max(SPEED_MIN, Math.min(SPEED_MAX, a * 800));
  };
  const wireOpacity = (amps) => {
    const a = Math.abs(amps);
    if (a < ZERO_EPS) return 0.18; // faint when open
    return Math.max(0.25, Math.min(0.95, a * 3));
  };
  const dash = "10 8";
  const phase = (v, dir = 1) => (-dir * speed(v) * tick) % 1000; // dir +1 along path orientation

  // Precompute speeds to toggle dash arrays
  const sI = speed(I);
  const sIA = speed(IA);
  const sIB = speed(IB);
  const sIAB = speed(IA + IB);

  // Tooltip state
  const [tip, setTip] = useState(null); // {x,y,lines:[]}
  const showTip = (evt, lines) => {
    const rect = evt.currentTarget.ownerSVGElement.getBoundingClientRect();
    setTip({ x: evt.clientX - rect.left + 12, y: evt.clientY - rect.top + 12, lines });
  };
  const hideTip = () => setTip(null);

  // Convenience
  const NodeDot = ({ x, y, r = 4 }) => (
    <circle cx={x} cy={y} r={r} fill="#bfe0ff" stroke="#5aa0ff" strokeWidth={1.5} />
  );

  return (
    <div style={{ width: "100%", maxWidth: width, margin: "0 auto", overflowX: "auto", color: "var(--text-primary)", fontFamily: "Inter, system-ui, sans-serif" }}>
      <svg width={width} height={height} style={{ background: "#0b1520", borderRadius: 16, boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
        {/* Invisible grid */}
        <g opacity={0}>
          {Array.from({ length: Math.floor(width / g) + 2 }, (_, i) => (
            <line key={`vx${i}`} x1={Gx(i)} y1={0} x2={Gx(i)} y2={height} stroke="#ffffff" strokeWidth={0.5} />
          ))}
          {Array.from({ length: Math.floor(height / g) + 2 }, (_, j) => (
            <line key={`hy${j}`} x1={0} y1={Gy(j)} x2={width} y2={Gy(j)} stroke="#ffffff" strokeWidth={0.5} />
          ))}
        </g>

        {/* ============= Wires (animated) ============= */}
        <g stroke="#6ea8ff" strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round">
          {/* Battery -> bulb (top wire, left to right) */}
          <path d={`M ${xBatt} ${yTop} H ${xBulb - g}`} style={{ strokeDasharray: sI ? dash : "none", strokeDashoffset: sI ? phase(I, +1) : 0, opacity: wireOpacity(I) }} />
          {/* Bulb gap handled by bulb group */}
          <path d={`M ${xBulb + g} ${yTop} H ${xSplitL}`} style={{ strokeDasharray: sI ? dash : "none", strokeDashoffset: sI ? phase(I, +1) : 0, opacity: wireOpacity(I) }} />



          {/* Per-branch animated overlays from top node down to rails */}
          <path d={`M ${xSplitL} ${yTop} V ${yA}`} style={{ strokeDasharray: sIA ? dash : "none", strokeDashoffset: sIA ? phase(IA, +1) : 0, opacity: wireOpacity(IA) }} />
          <path d={`M ${xSplitL} ${yTop} V ${yB}`} style={{ strokeDasharray: sIB ? dash : "none", strokeDashoffset: sIB ? phase(IB, +1) : 0, opacity: wireOpacity(IB) }} />

          {/* Branch A rails */}
          <path d={`M ${xSplitL} ${yA} H ${xSplitR}`} style={{ strokeDasharray: sIA ? dash : "none", strokeDashoffset: sIA ? phase(IA, +1) : 0, opacity: wireOpacity(IA) }} />
          <path d={`M ${xSplitR} ${yA} H ${xRight}`} style={{ strokeDasharray: sIA ? dash : "none", strokeDashoffset: sIA ? phase(IA, +1) : 0, opacity: wireOpacity(IA) }} />

          {/* Branch B rails (fully gated on IB) */}
          <path d={`M ${xSplitL} ${yB} H ${xSplitR}`} style={{ strokeDasharray: sIB ? dash : "none", strokeDashoffset: sIB ? phase(IB, +1) : 0, opacity: wireOpacity(IB) }} />
          <path d={`M ${xSplitR} ${yB} H ${xRight}`} style={{ strokeDasharray: sIB ? dash : "none", strokeDashoffset: sIB ? phase(IB, +1) : 0, opacity: wireOpacity(IB) }} />

          {/* Right vertical feeder to bottom return */}
          <path d={`M ${xRight} ${yA} V ${yB}`} style={{ strokeDasharray: sIA ? dash : "none", strokeDashoffset: sIA ? phase(IA, +1) : 0, opacity: wireOpacity(IA) }} />
          <path d={`M ${xRight} ${yB} V ${yBottom}`} style={{ strokeDasharray: sIAB ? dash : "none", strokeDashoffset: sIAB ? phase(IA + IB, +1) : 0, opacity: wireOpacity(IA + IB) }} />

          {/* Bottom return to battery (right to left) */}
          <path d={`M ${xRight} ${yBottom} H ${xBatt}`} style={{ strokeDasharray: sI ? dash : "none", strokeDashoffset: sI ? phase(I, +1) : 0, opacity: wireOpacity(I) }} />
          {/* Left riser: bottom -> top, animation moves UP into battery */}
          <path d={`M ${xBatt} ${yBottom} V ${yTop}`} style={{ strokeDasharray: sI ? dash : "none", strokeDashoffset: sI ? phase(I, +1) : 0, opacity: wireOpacity(I) }} />
        </g>

        {/* Node dots at key junctions (no top-right floater) */}
        <g>
          <NodeDot x={xBatt} y={yTop} />
          <NodeDot x={xBulb - g} y={yTop} />
          <NodeDot x={xBulb + g} y={yTop} />
          <NodeDot x={xSplitL} y={yTop} />
          <NodeDot x={xSplitL} y={yA} />
          <NodeDot x={xSplitL} y={yB} />


          <NodeDot x={xRight} y={yA} />
          <NodeDot x={xRight} y={yB} />
          <NodeDot x={xRight} y={yBottom} />
          <NodeDot x={xBatt} y={yBottom} />
        </g>

        {/* Battery (shifted down/right, no inner bars, add +/-) */}
        <g transform={`translate(${xBatt + 4}, ${yTop + 8})`} onMouseMove={(e) => showTip(e, [
          `Battery`,
          `ΔV = ${fmt(V, 'V')}`,
          `I = ${fexp(I, 'A')}`,
          `Power out = ${fexp(P_batt, 'W')}`,
        ])} onMouseLeave={hideTip}>
          {/* Body */}
          <rect x={-22} y={0} width={35} height={80} rx={6} fill="#102034" stroke="#93c5fd" />
          {/* Terminal stub to node */}
          <line x1={2} y1={-8} x2={12} y2={-8} stroke="#6ea8ff" strokeWidth={3} />
          {/* +/- labels */}
          <text x={-10} y={15} fontSize={14} fill="#cfe7ff">+</text>
          <text x={-10} y={70} fontSize={14} fill="#cfe7ff">−</text>
          <text x={20} y={50} fontSize={20} fill="#cfe7ff">{fmt(V, "V")}</text>
        </g>

        {/* Bulb */}
        <g transform={`translate(${xBulb}, ${yTop})`} onMouseMove={(e) => showTip(e, [
          `Bulb`,
          `R = ${fmt(Rb, 'Ω')}`,
          `I = ${fexp(I, 'A')}`,
          `ΔV = ${fexp(Vbulb, 'V')}`,
          `P = ${fexp(P_bulb, 'W')}`,
        ])} onMouseLeave={hideTip}>
          <defs>
            <radialGradient id="bulbCore" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff2c8" />
              <stop offset="45%" stopColor="#ffd08a" />
              <stop offset="100%" stopColor="#ffb65c" />
            </radialGradient>
            <filter id="bulbSoft" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation={8} />
            </filter>
          </defs>
          <circle cx={0} cy={0} r={g * 1.15} fill="#1b2636" stroke="#cfe7ff" />
          {(() => {
            const glow = 1 - Math.exp(-P_bulb / 0.6);
            const outerOpacity = Math.min(0.95, 0.25 + 0.75 * glow);
            const innerOpacity = Math.min(0.95, 0.35 + 0.65 * glow);
            return (
              <>
                <circle cx={0} cy={0} r={g * 1.15 - 2} fill="url(#bulbCore)" filter="url(#bulbSoft)" opacity={outerOpacity} />
                <path d={`M ${-g * 0.6} ${g * 0.35} Q 0 ${-g * 0.55} ${g * 0.6} ${g * 0.35}`} stroke="#ffe199" strokeWidth={2.4} fill="none" opacity={innerOpacity} />
              </>
            );
          })()}
        </g>

        {/* Branch A: switch + RA (large hover) */}
        <g>
          {/* Switch A */}
          <g transform={`translate(${xSplitL + g * 1.2}, ${yA})`} style={{ cursor: "pointer" }} onClick={() => setSA(v => !v)} onMouseMove={(e) => showTip(e, [
            `Switch A`,
            SA ? "Closed" : "Open",
            `I_A = ${fexp(IA, 'A')}`,
          ])} onMouseLeave={hideTip}>
            <rect x={-14} y={-18} width={g * 2 + 48} height={36} fill="transparent" pointerEvents="all" />
            <line x1={0} y1={0} x2={g * 2} y2={0} stroke="#cbd5e1" strokeWidth={3} />
            <line x1={g * 2} y1={0} x2={g * 2 + 18} y2={SA ? 0 : -12} stroke="#cbd5e1" strokeWidth={3} />
            <circle cx={-6} cy={0} r={4} fill="#cbd5e1" />
            <circle cx={g * 2 + 22} cy={SA ? 0 : -12} r={4} fill="#cbd5e1" />
          </g>
          {/* Resistor R_A */}
          <g transform={`translate(${xSplitL + g * 6.2}, ${yA})`} onMouseMove={(e) => showTip(e, [
            `Resistor R1`,
            `R = ${fmt(RA, 'Ω')}`,
            `I = ${fexp(IA, 'A')}`,
            `ΔV = ${fexp(IA * (SA ? RA : 0), 'V')}`,
            `P = ${fexp(P_RA, 'W')}`,
          ])} onMouseLeave={hideTip}>
            <rect x={-g - 16} y={-20} width={g * 6.4} height={40} fill="transparent" pointerEvents="all" />
            <path d={`M ${-g} 0 h 12 l 8 -12 l 8 12 l 8 -12 l 8 12 l 8 -12 l 8 12 h 12`} stroke="#cbd5e1" strokeWidth={3} fill="none" />
            <text x={10} y={-20} fontSize={20} fill="#cfe7ff" textAnchor="middle">{fmt(RA, 'Ω')}</text>
          </g>
        </g>

        {/* Branch B: switch + RB1 + RB2 (large hover) */}
        <g>
          {/* Switch B */}
          <g transform={`translate(${xSplitL + g * 1.2}, ${yB})`} style={{ cursor: "pointer" }} onClick={() => setSB(v => !v)} onMouseMove={(e) => showTip(e, [
            `Switch B`,
            SB ? "Closed" : "Open",
            `I_B = ${fexp(IB, 'A')}`,
          ])} onMouseLeave={hideTip}>
            <rect x={-14} y={-18} width={g * 2 + 48} height={36} fill="transparent" pointerEvents="all" />
            <line x1={0} y1={0} x2={g * 2} y2={0} stroke="#cbd5e1" strokeWidth={3} />
            <line x1={g * 2} y1={0} x2={g * 2 + 18} y2={SB ? 0 : -12} stroke="#cbd5e1" strokeWidth={3} />
            <circle cx={-6} cy={0} r={4} fill="#cbd5e1" />
            <circle cx={g * 2 + 22} cy={SB ? 0 : -12} r={4} fill="#cbd5e1" />
          </g>
          {/* RB1 */}
          <g transform={`translate(${xSplitL + g * 6.2}, ${yB})`} onMouseMove={(e) => showTip(e, [
            `Resistor R2`,
            `R = ${fmt(RB1, 'Ω')}`,
            `I = ${fexp(IB, 'A')}`,
            `ΔV = ${fexp(IB * (SB ? RB1 : 0), 'V')}`,
            `P = ${fexp(P_RB1, 'W')}`,
          ])} onMouseLeave={hideTip}>
            <rect x={-g - 16} y={-20} width={g * 6.4} height={40} fill="transparent" pointerEvents="all" />
            <path d={`M ${-g} 0 h 12 l 8 -12 l 8 12 l 8 -12 l 8 12 l 8 -12 l 8 12 h 12`} stroke="#cbd5e1" strokeWidth={3} fill="none" />
            <text x={10} y={-20} fontSize={20} fill="#cfe7ff" textAnchor="middle">{fmt(RB1, 'Ω')}</text>
          </g>
          {/* RB2 */}
          <g transform={`translate(${xSplitL + g * 11.2}, ${yB})`} onMouseMove={(e) => showTip(e, [
            `Resistor R3`,
            `R = ${fmt(RB2, 'Ω')}`,
            `I = ${fexp(IB, 'A')}`,
            `ΔV = ${fexp(IB * (SB ? RB2 : 0), 'V')}`,
            `P = ${fexp(P_RB2, 'W')}`,
          ])} onMouseLeave={hideTip}>
            <rect x={-g - 16} y={-20} width={g * 6.4} height={40} fill="transparent" pointerEvents="all" />
            <path d={`M ${-g} 0 h 12 l 8 -12 l 8 12 l 8 -12 l 8 12 l 8 -12 l 8 12 h 12`} stroke="#cbd5e1" strokeWidth={3} fill="none" />
            <text x={10} y={-20} fontSize={20} fill="#cfe7ff" textAnchor="middle">{fmt(RB2, 'Ω')}</text>
          </g>
        </g>

        {/* On-canvas numeric readout */}
        <g transform={`translate(${xRight - 38 * g}, ${yBottom - 8 * g})`}>
          <rect x={-8} y={-8} width={9 * g} height={7 * g} rx={12} fill="rgba(16,24,36,0.6)" stroke="rgba(160,200,255,0.2)" />
          <text x={12} y={40} fontSize={16} fill="#cfe7ff">R_total = {isFinite(Rtot) ? `${Math.round(Rtot)} Ω` : 'open'}</text>
          <text x={12} y={60} fontSize={16} fill="#cfe7ff">I_total = {fexp(I, 'A')}</text>
          <text x={12} y={80} fontSize={16} fill="#ffdca8">P_bulb = {fexp(P_bulb, 'W')}</text>
          <text x={12} y={100} fontSize={16} fill="#cfe7ff">P_batt = {fexp(P_batt, 'W')}</text>
        </g>

        {/* Tooltip bubble */}
        {tip && (
          <g transform={`translate(${tip.x}, ${tip.y})`} pointerEvents="none">
            <rect x={0} y={0} rx={8} width={240} height={tip.lines.length * 16 + 16} fill="rgba(12,16,24,0.92)" stroke="rgba(147,197,253,0.4)" />
            {tip.lines.map((s, i) => (
              <text key={i} x={8} y={20 + i * 16} fontSize={12} fill="#e8f1ff">{s}</text>
            ))}
          </g>
        )}
      </svg>

      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, background: "#0e1a28", color: "#e8f1ff", padding: 12, borderRadius: 12, border: "1px solid rgba(147,197,253,0.2)", marginTop: 10 }}>
        <div style={{ gridColumn: "span 2" }}>
          <label style={{ display: "block", fontSize: 13, opacity: 0.9 }}>Battery Voltage: {fmt(V, "V")}</label>
          <input type="range" min={0} max={24} step={0.1} value={V} onChange={(e) => setV(parseFloat(e.target.value))} />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label style={{ display: "block", fontSize: 13, opacity: 0.9 }}>Bulb Resistance: {fmt(Rb, "Ω")}</label>
          <input type="range" min={10} max={240} step={1} value={Rb} onChange={(e) => setRb(parseFloat(e.target.value))} />
        </div>
        <div style={{ gridColumn: "span 2", alignSelf: "end", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => { setSA(true); setSB(true); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "#0b1520", color: "#e8f1ff", cursor: "pointer" }}>Close Both</button>
          <button onClick={() => { setSA(false); setSB(false); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "#0b1520", color: "#e8f1ff", cursor: "pointer" }}>Open Both</button>
          <button onClick={() => { setV(9); setRb(60); setRA(150); setRB1(220); setRB2(330); setSA(true); setSB(false); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "#0b1520", color: "#e8f1ff", cursor: "pointer" }}>Reset</button>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, opacity: 0.9 }}>R1 = {fmt(RA, "Ω")}</label>
          <input type="range" min={10} max={500} step={1} value={RA} onChange={(e) => setRA(parseFloat(e.target.value))} />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, opacity: 0.9 }}>R2 = {fmt(RB1, "Ω")}</label>
          <input type="range" min={10} max={500} step={1} value={RB1} onChange={(e) => setRB1(parseFloat(e.target.value))} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 13, opacity: 0.9 }}>R3 = {fmt(RB2, "Ω")}</label>
          <input type="range" min={10} max={500} step={1} value={RB2} onChange={(e) => setRB2(parseFloat(e.target.value))} />
          
        </div>
      </div>

      <p style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
        Toggle the switches to add or remove each branch. Hover any component to read its current, voltage drop, and power; the animated wires show where charge is flowing.
      </p>
    </div>
  );
}
