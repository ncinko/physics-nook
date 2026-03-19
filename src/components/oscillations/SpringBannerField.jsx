import React, { useEffect, useRef } from 'react';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const getGeometry = (width, height, displacement) => {
  const trackY = height * 0.74;
  const anchorX = 24;
  const wallX = 0;
  const equilibriumX = width * 0.58;
  const massWidth = clamp(width * 0.1, 72, 104);
  const massHeight = clamp(height * 0.16, 54, 72);
  const maxDisplacement = Math.min(width * 0.14, 112);
  const massCenterX = equilibriumX + displacement;
  const massLeftX = massCenterX - massWidth / 2;
  const massTopY = trackY - massHeight / 2;

  return {
    trackY,
    anchorX,
    wallX,
    equilibriumX,
    massWidth,
    massHeight,
    maxDisplacement,
    massCenterX,
    massLeftX,
    massTopY,
  };
};

const createSpringPoints = (startX, endX, y) => {
  const lead = 22;
  const tail = 14;
  const coilCount = 12;
  const usable = Math.max(18, endX - startX - lead - tail);
  const points = [
    [startX, y],
    [startX + lead * 0.4, y],
    [startX + lead, y],
  ];

  for (let index = 0; index < coilCount; index += 1) {
    const x = startX + lead + usable * ((index + 0.5) / coilCount);
    const offset = index % 2 === 0 ? -13 : 13;
    points.push([x, y + offset]);
  }

  points.push([endX - tail, y]);
  points.push([endX, y]);

  return points.map(([xPoint, yPoint]) => `${xPoint},${yPoint}`).join(' ');
};

export default function SpringBannerField() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const motionRef = useRef({ displacement: 64, velocity: 0 });
  const dragRef = useRef({
    active: false,
    pointerId: null,
    lastX: 0,
    lastAt: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      const dpr = window.devicePixelRatio || 1;

      sizeRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const geometry = getGeometry(width, height, motionRef.current.displacement);
      motionRef.current.displacement = clamp(
        motionRef.current.displacement,
        -geometry.maxDisplacement,
        geometry.maxDisplacement,
      );
    };

    const draw = () => {
      const { width, height } = sizeRef.current;
      const geometry = getGeometry(width, height, motionRef.current.displacement);

      context.clearRect(0, 0, width, height);

      context.fillStyle = 'rgba(15, 23, 42, 0.3)';
      context.fillRect(geometry.wallX, geometry.trackY - 48, 10, 96);
      context.fillStyle = 'rgba(15, 23, 42, 0.09)';
      context.fillRect(geometry.wallX + 10, geometry.trackY - 42, 7, 84);

      context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      context.lineWidth = 2.4;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(geometry.wallX + 10, geometry.trackY);
      context.lineTo(width - 24, geometry.trackY);
      context.stroke();

      context.save();
      context.strokeStyle = 'rgba(59, 130, 246, 0.34)';
      context.lineWidth = 2.6;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      const springPath = new Path2D(`M ${createSpringPoints(geometry.anchorX, geometry.massLeftX, geometry.trackY)}`);
      context.stroke(springPath);
      context.restore();

      context.save();
      context.shadowBlur = 10;
      context.shadowColor = 'rgba(59, 130, 246, 0.04)';
      context.fillStyle = 'rgba(255, 255, 255, 0.58)';
      context.strokeStyle = 'rgba(30, 64, 175, 0.28)';
      context.lineWidth = 1.8;
      context.beginPath();
      context.roundRect(geometry.massLeftX, geometry.massTopY, geometry.massWidth, geometry.massHeight, 18);
      context.fill();
      context.stroke();
      context.restore();

      context.fillStyle = 'rgba(59, 130, 246, 0.07)';
      context.beginPath();
      context.roundRect(
        geometry.massLeftX + 14,
        geometry.massTopY + 12,
        geometry.massWidth - 28,
        9,
        6,
      );
      context.fill();

      context.fillStyle = 'rgba(15, 23, 42, 0.3)';
      context.font = '700 14px ui-sans-serif, system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText('m', geometry.massCenterX, geometry.trackY + 7);
    };

    const step = (dt) => {
      if (dragRef.current.active) {
        return;
      }

      const { width, height } = sizeRef.current;
      const motion = motionRef.current;
      const geometry = getGeometry(width, height, motion.displacement);
      const omega = 4.1;
      const damping = 0.82;
      const acceleration = -(omega * omega) * motion.displacement - damping * motion.velocity;

      motion.velocity += acceleration * dt;
      motion.displacement += motion.velocity * dt;

      if (motion.displacement > geometry.maxDisplacement || motion.displacement < -geometry.maxDisplacement) {
        motion.displacement = clamp(motion.displacement, -geometry.maxDisplacement, geometry.maxDisplacement);
        motion.velocity *= -0.22;
      }

      if (Math.abs(motion.displacement) < 0.04 && Math.abs(motion.velocity) < 0.04) {
        motion.displacement = 0;
        motion.velocity = 0;
      }
    };

    const animate = (timestamp) => {
      const previous = lastFrameTimeRef.current ?? timestamp;
      lastFrameTimeRef.current = timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.024);

      step(dt);
      draw();
      animationRef.current = window.requestAnimationFrame(animate);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    animationRef.current = window.requestAnimationFrame(animate);

    return () => {
      observer.disconnect();

      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }

      animationRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, []);

  const handlePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    const { width, height } = sizeRef.current;
    const geometry = getGeometry(width, height, motionRef.current.displacement);

    if (
      pointX < geometry.massLeftX ||
      pointX > geometry.massLeftX + geometry.massWidth ||
      pointY < geometry.massTopY ||
      pointY > geometry.massTopY + geometry.massHeight
    ) {
      return;
    }

    event.preventDefault();
    motionRef.current.displacement = clamp(
      pointX - geometry.equilibriumX,
      -geometry.maxDisplacement,
      geometry.maxDisplacement,
    );
    motionRef.current.velocity = 0;
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: pointX,
      lastAt: performance.now(),
    };
    container.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const now = performance.now();
    const dt = Math.max((now - dragRef.current.lastAt) / 1000, 0.001);
    const { width, height } = sizeRef.current;
    const geometry = getGeometry(width, height, motionRef.current.displacement);

    motionRef.current.displacement = clamp(
      pointX - geometry.equilibriumX,
      -geometry.maxDisplacement,
      geometry.maxDisplacement,
    );
    motionRef.current.velocity = clamp((pointX - dragRef.current.lastX) / dt, -760, 760);
    dragRef.current = {
      ...dragRef.current,
      lastX: pointX,
      lastAt: now,
    };
  };

  const finishDrag = (pointerId) => {
    if (dragRef.current.pointerId !== pointerId) {
      return;
    }

    dragRef.current = {
      active: false,
      pointerId: null,
      lastX: 0,
      lastAt: 0,
    };
  };

  const handlePointerUp = (event) => {
    if (!containerRef.current) {
      return;
    }

    finishDrag(event.pointerId);

    if (containerRef.current.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerCancel = (event) => {
    if (!containerRef.current) {
      return;
    }

    finishDrag(event.pointerId);

    if (containerRef.current.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label="Interactive spring background; drag the mass to set the displacement"
    >
      <canvas ref={canvasRef} className="h-full w-full opacity-[0.68]" aria-hidden="true" />
    </div>
  );
}
