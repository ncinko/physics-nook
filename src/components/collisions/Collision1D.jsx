import React, { useState, useEffect, useRef } from 'react';
import { Play, RotateCcw, Info } from 'lucide-react';

const formatNum = (num, plusSign = false) => {
  const val = num.toFixed(1);
  if (val === '-0.0') return '0.0';
  return num > 0 && plusSign ? `+${val}` : val;
};

export default function Collision1D() {
  // Input states
  const [m1, setM1] = useState(2.0);
  const [u1, setU1] = useState(3.0);
  const [m2, setM2] = useState(2.0);
  const [u2, setU2] = useState(-2.0);
  const [e, setE] = useState(1.0); // Coefficient of restitution

  // Physics Derived Values
  const collisionType = e === 1 ? 'elastic' : e === 0 ? 'perfectly_inelastic' : 'inelastic';
  const pInitial = m1 * u1 + m2 * u2;
  const keInitial = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;

  // Simulation State
  const [simState, setSimState] = useState({
    isPlaying: false,
    isStuck: false,
    x1: -5,
    x2: 5,
    v1: u1,
    v2: u2,
  });

  const requestRef = useRef();
  const lastTimeRef = useRef();

  // Reset function
  const handleReset = () => {
    setSimState({
      isPlaying: false,
      isStuck: false,
      x1: -5,
      x2: 5,
      v1: u1,
      v2: u2,
    });
    lastTimeRef.current = undefined;
  };

  // Sync inputs to unplayed sim state
  useEffect(() => {
    if (!simState.isPlaying) {
      setSimState((prev) => ({ ...prev, v1: u1, v2: u2, isStuck: false, x1: -5, x2: 5 }));
    }
  }, [u1, u2, m1, m2, e]);

  // Animation Loop
  const animate = (time) => {
    if (lastTimeRef.current != undefined) {
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.03); // Cap dt for smooth 1D physics

      setSimState((prev) => {
        if (!prev.isPlaying) return prev;

        let { x1, x2, v1, v2, isStuck } = prev;

        // Block physical widths (0.6m base + 0.1m per kg)
        const w1 = 0.6 + m1 * 0.1;
        const w2 = 0.6 + m2 * 0.1;
        const minDist = (w1 + w2) / 2;

        x1 += v1 * dt;
        x2 += v2 * dt;

        // Block-to-Block Collision Check
        const dist = x2 - x1;
        if (!isStuck && dist <= minDist && v1 > v2) {
          if (e === 0) {
            const v_final = (m1 * v1 + m2 * v2) / (m1 + m2);
            v1 = v_final;
            v2 = v_final;
            isStuck = true;
            x2 = x1 + minDist; // Snap together
          } else {
            const new_v1 = (m1 * v1 + m2 * v2 + m2 * e * (v2 - v1)) / (m1 + m2);
            const new_v2 = (m1 * v1 + m2 * v2 + m1 * e * (v1 - v2)) / (m1 + m2);
            v1 = new_v1;
            v2 = new_v2;
            
            // Separate to prevent overlapping frame traps
            const overlap = minDist - dist;
            x1 -= (overlap / 2 + 0.001);
            x2 += (overlap / 2 + 0.001);
          }
        }

        // Enforce stickiness
        if (isStuck) {
          x2 = x1 + minDist;
          v2 = v1;
        }

        // Boundary Collisions (Perfectly Elastic Walls at -10 and +10)
        if (x1 - w1 / 2 <= -10) {
          x1 = -10 + w1 / 2;
          if (v1 < 0) v1 = -v1;
          if (isStuck) { v2 = v1; x2 = x1 + minDist; }
        }
        if (x2 + w2 / 2 >= 10) {
          x2 = 10 - w2 / 2;
          if (v2 > 0) v2 = -v2;
          if (isStuck) { v1 = v2; x1 = x2 - minDist; }
        }

        return { ...prev, x1, x2, v1, v2, isStuck };
      });
    }

    lastTimeRef.current = time;
    if (simState.isPlaying) {
      requestRef.current = requestAnimationFrame(animate);
    }
  };

  useEffect(() => {
    if (simState.isPlaying) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(requestRef.current);
      lastTimeRef.current = undefined;
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [simState.isPlaying, m1, m2, u1, u2, e]);

  const togglePlay = () => {
    setSimState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  // Rendering Helpers
  const trackWidth = 20; // -10m to 10m
  const getPosPct = (x) => ((x + 10) / trackWidth) * 100;
  const getWidthPct = (mass) => ((0.6 + mass * 0.1) / trackWidth) * 100;
  
  const pos1Pct = getPosPct(simState.x1);
  const pos2Pct = getPosPct(simState.x2);
  const w1Pct = getWidthPct(m1);
  const w2Pct = getWidthPct(m2);

  const currentP = m1 * simState.v1 + m2 * simState.v2;
  const currentKE = 0.5 * m1 * simState.v1 * simState.v1 + 0.5 * m2 * simState.v2 * simState.v2;
  const keLost = Math.max(0, keInitial - currentKE);

  const maxKeDisplay = 150; // J for bar charts scaling

  return (
    <div className="flex h-full min-h-[40rem] w-full flex-col overflow-hidden bg-[var(--sim-bg,#f8fafc)] text-[var(--text-primary,#0f172a)] font-sans">
      {/* Main Simulation Stage */}
      <div className="relative h-64 flex-shrink-0 overflow-hidden border-b border-[var(--grid-line,#e2e8f0)] bg-[var(--bg-primary,#ffffff)] md:h-72 lg:h-80">
        
        {/* Track Grid Lines */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(to right, var(--grid-line,#e2e8f0) 1px, transparent 1px)', backgroundSize: '5% 100%' }}></div>
        
        {/* Track Line & Boundary Walls */}
        <div className="absolute bottom-8 left-0 right-0 h-0.5 bg-[var(--text-muted,#64748b)] opacity-50 z-0"></div>
        <div className="absolute bottom-8 left-0 h-16 w-1 bg-[var(--text-muted,#64748b)] opacity-50 z-0 transform translate-y-1/2"></div>
        <div className="absolute bottom-8 right-0 h-16 w-1 bg-[var(--text-muted,#64748b)] opacity-50 z-0 transform translate-y-1/2"></div>
        
        <div className="absolute bottom-4 left-[50%] -translate-x-1/2 text-xs text-[var(--text-muted,#64748b)]">0 m</div>
        <div className="absolute bottom-8 left-[50%] h-2 w-px bg-[var(--text-muted,#64748b)] opacity-50 z-0"></div>

        {/* Carts */}
        <div 
          className="absolute bottom-8 rounded-t-md shadow-md flex flex-col items-center justify-center font-bold text-white z-20 transition-transform duration-75"
          style={{ 
            left: `${pos1Pct}%`, 
            width: `${w1Pct}%`, 
            aspectRatio: '1 / 1',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--accent-blue,#2563eb)'
          }}
        >
          <div className="absolute inset-0 pointer-events-none">
             <svg className="w-full h-full overflow-visible">
                <defs>
                   <marker id="arrow-v-dark" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                     <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
                   </marker>
                </defs>
                {Math.abs(simState.v1) > 0.05 && (
                    <line 
                      x1={simState.v1 > 0 ? "100%" : "0%"} 
                      y1="50%" 
                      x2={simState.v1 > 0 ? `calc(100% + ${simState.v1 * 12}px)` : `calc(0% + ${simState.v1 * 12}px)`} 
                      y2="50%" 
                      stroke="#334155" 
                      strokeWidth="2.5" 
                      markerEnd="url(#arrow-v-dark)" 
                      strokeLinecap="round" 
                    />
                )}
             </svg>
          </div>
        </div>
        
        <div 
          className="absolute bottom-8 rounded-t-md shadow-md flex flex-col items-center justify-center font-bold text-white z-20 transition-transform duration-75"
          style={{ 
            left: `${pos2Pct}%`, 
            width: `${w2Pct}%`, 
            aspectRatio: '1 / 1',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--accent-red,#e11d48)'
          }}
        >
          <div className="absolute inset-0 pointer-events-none">
             <svg className="w-full h-full overflow-visible">
                {/* Reusing arrow-v-dark def from above */}
                {Math.abs(simState.v2) > 0.05 && (
                    <line 
                      x1={simState.v2 > 0 ? "100%" : "0%"} 
                      y1="50%" 
                      x2={simState.v2 > 0 ? `calc(100% + ${simState.v2 * 12}px)` : `calc(0% + ${simState.v2 * 12}px)`} 
                      y2="50%" 
                      stroke="#334155" 
                      strokeWidth="2.5" 
                      markerEnd="url(#arrow-v-dark)" 
                      strokeLinecap="round" 
                    />
                )}
             </svg>
          </div>
        </div>
      </div>

      {/* Controls & Analysis Area */}
      <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1.75fr_0.85fr]">
        
        {/* Left Col: Controls */}
        <div className="flex min-w-0 flex-col gap-5">
          
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Play Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full font-semibold text-white transition-all active:scale-95"
                style={{ backgroundColor: 'var(--accent-blue,#2563eb)' }}
              >
                <Play className={`w-4 h-4 ${simState.isPlaying ? 'hidden' : 'block'}`} />
                <div className={`w-4 h-4 bg-white rounded-sm ${simState.isPlaying ? 'block' : 'hidden'}`} />
                {simState.isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                onClick={handleReset}
                className="p-2.5 rounded-full border border-[var(--grid-line,#e2e8f0)] hover:bg-[var(--sim-bg,#f8fafc)] transition-colors text-[var(--text-muted,#64748b)]"
                title="Reset simulation"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
            </div>

            {/* Elasticity Slider */}
            <div className="flex min-w-[200px] flex-1 flex-col rounded-lg border border-[var(--grid-line,#e2e8f0)] bg-[var(--surface-elevated,#ffffff)] p-3 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-[var(--text-primary,#0f172a)] uppercase tracking-wide">Elasticity</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold ${e === 1 ? 'bg-green-100 text-green-700' : e === 0 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                    {collisionType === 'elastic' ? 'Elastic' : collisionType === 'perfectly_inelastic' ? 'Perf. Inelastic' : 'Inelastic'}
                  </span>
                  <span className="text-sm font-mono font-medium text-[var(--text-muted,#64748b)]">{e.toFixed(2)}</span>
                </div>
              </div>
              <input
                type="range" min="0" max="1" step="0.05" value={e}
                onChange={(evt) => { setE(parseFloat(evt.target.value)); handleReset(); }}
                disabled={simState.isPlaying}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 accent-slate-600"
              />
            </div>
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Object 1 Controls */}
            <div className="relative overflow-hidden rounded-xl border border-[var(--grid-line,#e2e8f0)] bg-[color-mix(in_srgb,var(--accent-blue,#2563eb)_8%,var(--bg-primary,#ffffff))] p-4 shadow-sm">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--accent-blue,#2563eb)]"></div>
              <h3 className="font-semibold text-sm mb-4 text-[var(--accent-blue,#2563eb)]">Object 1</h3>
              
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[var(--text-muted,#64748b)]">Mass</span>
                    <span className="font-mono">{m1.toFixed(1)} kg</span>
                  </div>
                  <input
                    type="range" min="1" max="5" step="0.5" value={m1}
                    onChange={(e) => setM1(parseFloat(e.target.value))}
                    disabled={simState.isPlaying}
                    className="w-full h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[var(--text-muted,#64748b)]">Velocity</span>
                    <span className="font-mono">{formatNum(simState.v1, true)} m/s</span>
                  </div>
                  <input
                    type="range" min="-5" max="5" step="0.5" value={u1}
                    onChange={(e) => setU1(parseFloat(e.target.value))}
                    disabled={simState.isPlaying}
                    className="w-full h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                  />
                </div>

                <div className="mt-2 flex justify-between border-t border-blue-200/50 pt-3 text-sm">
                   <span className="text-[var(--text-muted,#64748b)] font-medium">Current Momentum</span>
                   <span className="font-mono font-medium">{formatNum(m1 * simState.v1, true)} kg*m/s</span>
                </div>
              </div>
            </div>

            {/* Object 2 Controls */}
            <div className="relative overflow-hidden rounded-xl border border-[var(--grid-line,#e2e8f0)] bg-[color-mix(in_srgb,var(--accent-red,#e11d48)_8%,var(--bg-primary,#ffffff))] p-4 shadow-sm">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--accent-red,#e11d48)]"></div>
              <h3 className="font-semibold text-sm mb-4 text-[var(--accent-red,#e11d48)]">Object 2</h3>
              
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[var(--text-muted,#64748b)]">Mass</span>
                    <span className="font-mono">{m2.toFixed(1)} kg</span>
                  </div>
                  <input
                    type="range" min="1" max="5" step="0.5" value={m2}
                    onChange={(e) => setM2(parseFloat(e.target.value))}
                    disabled={simState.isPlaying}
                    className="w-full h-1.5 bg-red-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[var(--text-muted,#64748b)]">Velocity</span>
                    <span className="font-mono">{formatNum(simState.v2, true)} m/s</span>
                  </div>
                  <input
                    type="range" min="-5" max="5" step="0.5" value={u2}
                    onChange={(e) => setU2(parseFloat(e.target.value))}
                    disabled={simState.isPlaying}
                    className="w-full h-1.5 bg-red-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                  />
                </div>

                <div className="mt-2 flex justify-between border-t border-red-200/50 pt-3 text-sm">
                   <span className="text-[var(--text-muted,#64748b)] font-medium">Current Momentum</span>
                   <span className="font-mono font-medium">{formatNum(m2 * simState.v2, true)} kg*m/s</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Analysis */}
        <div className="flex min-h-0 flex-col rounded-xl border border-[var(--grid-line,#e2e8f0)] bg-[var(--surface-elevated,#ffffff)] p-5">
          <div className="space-y-5 flex-1">
            
            {/* Momentum Section */}
            <div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-sm font-medium text-[var(--text-muted,#64748b)]">System Momentum</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-[var(--grid-line,#e2e8f0)] bg-[var(--bg-primary,#ffffff)] p-3 shadow-sm">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted,#64748b)]">Initial:</span>
                  <span className="font-mono">{formatNum(pInitial, true)} kg*m/s</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted,#64748b)]">Current:</span>
                  <span className="font-mono text-[var(--accent-blue,#2563eb)] font-medium">
                    {formatNum(currentP, true)} kg*m/s
                  </span>
                </div>
              </div>
            </div>

            {/* Kinetic Energy Section */}
            <div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-sm font-medium text-[var(--text-muted,#64748b)]">Kinetic Energy</span>
                {collisionType === 'elastic' ? (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">Conserved</span>
                ) : (
                  <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-medium">Not Conserved</span>
                )}
              </div>
              
              <div className="rounded-lg border border-[var(--grid-line,#e2e8f0)] bg-[var(--bg-primary,#ffffff)] p-3 shadow-sm">
                
                {/* Initial KE Bar */}
                <div className="mb-3">
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[var(--text-muted,#64748b)]">Initial</span>
                    <span className="font-mono">{formatNum(keInitial)} J</span>
                  </div>
                  <div className="h-2 w-full bg-[var(--grid-line,#e2e8f0)] rounded-full overflow-hidden">
                    <div className="h-full bg-slate-400" style={{ width: `${Math.min(100, (keInitial / maxKeDisplay) * 100)}%` }}></div>
                  </div>
                </div>

                {/* Current KE Bar */}
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-[var(--text-muted,#64748b)]">Current</span>
                    <span className="font-mono font-medium">{formatNum(currentKE)} J</span>
                  </div>
                  <div className="h-2 w-full bg-[var(--grid-line,#e2e8f0)] rounded-full overflow-hidden">
                    <div 
                       className={`h-full transition-all duration-300 ${collisionType === 'elastic' ? 'bg-slate-400' : 'bg-orange-400'}`} 
                       style={{ width: `${Math.min(100, (currentKE / maxKeDisplay) * 100)}%` }}
                    ></div>
                  </div>
                  <div className="h-4 mt-1.5">
                    <div className={`text-[10px] text-orange-600 font-medium text-right transition-opacity duration-300 ${keLost > 0.05 ? 'opacity-100' : 'opacity-0'}`}>
                      Lost {formatNum(keLost)} J to internal energy
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>

      </div>

      {/* Footer Educational Note */}
      <div className="flex flex-shrink-0 items-start gap-3 border-t border-[var(--grid-line,#e2e8f0)] bg-[var(--surface-elevated,#ffffff)] px-5 py-3">
        <Info className="w-5 h-5 text-[var(--accent-blue,#2563eb)] flex-shrink-0 mt-0.5" />
        <p className="text-base text-[var(--text-primary,#0f172a)] leading-relaxed">
          {collisionType === 'elastic' && "In an elastic collision, objects bounce off each other perfectly. Both momentum and kinetic energy are conserved."}
          {collisionType === 'inelastic' && "In an inelastic collision, objects bounce but lose some kinetic energy to heat and sound. Momentum is still conserved."}
          {collisionType === 'perfectly_inelastic' && "In a perfectly inelastic collision, objects stick together and share a final velocity. This results in the maximum possible loss of kinetic energy, though momentum remains conserved."}
        </p>
      </div>

    </div>
  );
}
