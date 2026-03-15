import React, { useEffect, useRef, useState } from 'react';

export default function LandingWaveField() {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [sources, setSources] = useState([
    { x: 0.14, y: 0.16, colorVar: '--accent-blue', phaseOffset: 0 },
    { x: 0.46, y: 0.22, colorVar: '--accent-blue', phaseOffset: 0 },
    { x: 0.82, y: 0.18, colorVar: '--accent-red', phaseOffset: Math.PI },
  ]);
  const sourcesRef = useRef(sources);
  const sourceHistoryRef = useRef([
    [{ t: 0, x: 0.14, y: 0.16 }],
    [{ t: 0, x: 0.46, y: 0.22 }],
    [{ t: 0, x: 0.82, y: 0.18 }],
  ]);
  const dragRef = useRef({ index: null, hovering: null, pointerId: null, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let frameId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const getPoint = (event) => {
      const rect = wrapper.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    };

    const hitTest = (point) => {
      const radius = 0.055;
      return sourcesRef.current.findIndex((source) => Math.hypot(point.x - source.x, point.y - source.y) < radius);
    };

    const handlePointerMove = (event) => {
      const point = getPoint(event);
      const hitIndex = hitTest(point);
      if (dragRef.current.index === null) {
        dragRef.current.hovering = hitIndex === -1 ? null : hitIndex;
      }

      if (dragRef.current.index === null) return;

      setSources((previousSources) =>
        previousSources.map((source, index) =>
          index === dragRef.current.index
            ? {
                ...source,
                x: Math.max(0, Math.min(1, point.x - dragRef.current.offsetX)),
                y: Math.max(0, Math.min(1, point.y - dragRef.current.offsetY)),
              }
            : source
        )
      );
    };

    const handlePointerUp = (event) => {
      if (dragRef.current.pointerId !== null && event.pointerId !== dragRef.current.pointerId) return;
      dragRef.current.index = null;
      dragRef.current.pointerId = null;
      dragRef.current.offsetX = 0;
      dragRef.current.offsetY = 0;
    };

    const handlePointerLeave = () => {
      if (dragRef.current.index === null) {
        dragRef.current.hovering = null;
      }
    };

    const drawEmitter = (source, index, color, time) => {
      const cx = source.x * width;
      const cy = source.y * height;
      const isDragging = dragRef.current.index === index;
      const isHovered = dragRef.current.hovering === index;
      const pulse = 1 + Math.sin(time * 0.003 + index) * 0.06;

      context.save();
      context.globalAlpha = isDragging || isHovered ? 0.28 : 0.18;
      context.beginPath();
      context.arc(cx, cy, 28 * pulse, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();

      context.globalAlpha = 0.9;
      context.beginPath();
      context.arc(cx, cy, isDragging ? 10 : 8, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();

      context.lineWidth = isDragging ? 2.5 : 1.5;
      context.strokeStyle = color;
      context.beginPath();
      context.arc(cx, cy, isDragging ? 18 : 15, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    };

    const getRetardedSourcePosition = (history, targetTime) => {
      if (history.length === 0) return null;
      if (targetTime <= history[0].t) return history[0];

      for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].t <= targetTime) {
          const current = history[i];
          const next = history[i + 1];
          if (!next) return current;

          const span = next.t - current.t;
          if (span <= 0) return current;

          const alpha = (targetTime - current.t) / span;
          return {
            x: current.x + (next.x - current.x) * alpha,
            y: current.y + (next.y - current.y) * alpha,
          };
        }
      }

      return history[0];
    };

    const draw = (time) => {
      const t = time * 0.001;
      context.clearRect(0, 0, width, height);

      const styles = getComputedStyle(document.documentElement);
      const primary = styles.getPropertyValue('--accent-blue').trim() || '#60a5fa';
      const secondary = styles.getPropertyValue('--accent-red').trim() || '#f87171';
      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      const isLightTheme = theme === 'light';

      for (let i = 0; i < sourcesRef.current.length; i += 1) {
        const source = sourcesRef.current[i];
        const history = sourceHistoryRef.current[i];
        const last = history[history.length - 1];
        if (!last || Math.abs(last.x - source.x) > 0.0005 || Math.abs(last.y - source.y) > 0.0005 || t - last.t > 0.03) {
          history.push({ t, x: source.x, y: source.y });
        }
        while (history.length > 1 && t - history[0].t > 6) {
          history.shift();
        }
      }

      const waveSpeed = 220;

      for (let row = 0; row < 28; row += 1) {
        const yBase = height * 0.08 + row * ((height * 0.84) / 27);
        context.beginPath();

        for (let x = 0; x <= width; x += 6) {
          let interference = 0;

          for (let i = 0; i < sourcesRef.current.length; i += 1) {
            const latestSource = sourcesRef.current[i];
            const latestX = latestSource.x * width;
            const latestY = latestSource.y * height;
            const latestDistance = Math.hypot(x - latestX, yBase - latestY);
            const delayedTime = t - latestDistance / waveSpeed;
            const retardedSource = getRetardedSourcePosition(sourceHistoryRef.current[i], delayedTime) ?? latestSource;
            const sx = retardedSource.x * width;
            const sy = retardedSource.y * height;
            const distance = Math.hypot(x - sx, yBase - sy);
            const wave = Math.sin(distance * 0.05 - t * 2.8 + (latestSource.phaseOffset ?? 0));
            interference += wave * Math.exp(-distance / 520);
          }

          const envelope = 0.9 + Math.sin((x / width) * Math.PI * 2 - t * 0.3) * 0.08;
          const drift = Math.sin(x * 0.008 + row * 0.24 - t * 0.35) * 0.9;
          const y = yBase + interference * 8.5 * envelope + drift;

          if (x === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.strokeStyle = row % 6 === 0 ? secondary : primary;
        context.globalAlpha = isLightTheme ? 0.075 + row * 0.0075 : 0.045 + row * 0.006;
        context.lineWidth = isLightTheme ? (row % 5 === 0 ? 1.55 : 1.15) : (row % 5 === 0 ? 1.35 : 1);
        context.stroke();
      }

      drawEmitter(sourcesRef.current[0], 0, primary, time);
      drawEmitter(sourcesRef.current[1], 1, primary, time);
      drawEmitter(sourcesRef.current[2], 2, secondary, time);

      context.globalAlpha = 1;
      frameId = window.requestAnimationFrame(draw);
    };

    resize();
    frameId = window.requestAnimationFrame(draw);

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    wrapper.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      wrapper.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  const handleSourcePointerDown = (index) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const point = (() => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return { x: sourcesRef.current[index].x, y: sourcesRef.current[index].y };
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    })();

    dragRef.current.index = index;
    dragRef.current.hovering = index;
    dragRef.current.pointerId = event.pointerId;
    dragRef.current.offsetX = point.x - sourcesRef.current[index].x;
    dragRef.current.offsetY = point.y - sourcesRef.current[index].y;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  return (
    <div ref={wrapperRef} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="pointer-events-none h-full w-full opacity-[0.98] dark:opacity-90"
        aria-hidden="true"
      />
      {sources.map((source, index) => (
        <button
          key={source.colorVar}
          type="button"
          onPointerDown={handleSourcePointerDown(index)}
          className="pointer-events-auto absolute z-20 h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white/80 shadow-[0_0_0_6px_rgba(255,255,255,0.12)] active:cursor-grabbing"
          style={{
            left: `${source.x * 100}%`,
            top: `${source.y * 100}%`,
            backgroundColor: `var(${source.colorVar})`,
          }}
          aria-label={`Move wave source ${index + 1}`}
        />
      ))}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(96,165,250,0.18),transparent_38%),radial-gradient(circle_at_80%_20%,rgba(248,113,113,0.14),transparent_28%),linear-gradient(180deg,transparent,rgba(255,255,255,0.08))] dark:bg-[radial-gradient(circle_at_top,rgba(96,165,250,0.14),transparent_38%),radial-gradient(circle_at_80%_20%,rgba(248,113,113,0.12),transparent_28%),linear-gradient(180deg,transparent,rgba(255,255,255,0.18))]" />
    </div>
  );
}
