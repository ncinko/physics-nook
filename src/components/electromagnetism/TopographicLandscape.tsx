import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Button, ControlBar } from '../shared/InlineControls';
import { themeColors, onThemeChange, getCssColor } from '../shared/themeColors';
import { buildTerrain, terrainCover, TERRAIN_WIDTH, TERRAIN_DEPTH } from '../../lib/electromagnetism/terrain';

export default function TopographicLandscape() {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<(top: boolean) => void>(() => {});
  const [topDown, setTopDown] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1300, 1300, 900, -900, 1, 10000);
    const terrain = buildTerrain();
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let row = 0; row < terrain.rows; row++) {
      for (let col = 0; col < terrain.columns; col++) {
        positions.push(col / (terrain.columns - 1) * TERRAIN_WIDTH - TERRAIN_WIDTH / 2,
          terrain.heights[row * terrain.columns + col],
          row / (terrain.rows - 1) * TERRAIN_DEPTH - TERRAIN_DEPTH / 2);
        colors.push(0, 0, 0);
        if (row < terrain.rows - 1 && col < terrain.columns - 1) {
          const a = row * terrain.columns + col, b = a + 1;
          const d = a + terrain.columns, c = d + 1;
          // Match the contour helper's diagonal, with upward-facing normals.
          indices.push(a, c, b, a, d, c);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    scene.add(new THREE.Mesh(geometry, material));
    const ambient = new THREE.AmbientLight(0xffffff, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-800, 1800, 600);
    scene.add(ambient, sun);

    const lines = terrain.contours.map(contour => {
      const coords: number[] = [];
      for (const segment of contour.segments) {
        for (const [x, z] of segment) coords.push(x - TERRAIN_WIDTH / 2, contour.level + 1, z - TERRAIN_DEPTH / 2);
      }
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      const lineMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
      const line = new THREE.LineSegments(lineGeometry, lineMaterial);
      scene.add(line);
      // Spread labels along the front-right flank, including in the overhead view.
      const anchor = contour.segments.flat().reduce((a, b) => b[0] + 0.7 * b[1] > a[0] + 0.7 * a[1] ? b : a);
      return { level: contour.level, line, anchor: new THREE.Vector3(
        anchor[0] - TERRAIN_WIDTH / 2, contour.level + 2, anchor[1] - TERRAIN_DEPTH / 2) };
    });

    let width = 700, height = 460, frame = 0;
    let angle = 34, startAngle = angle, targetAngle = angle, startTime = 0;
    let palette = themeColors();
    const ctx = labels.getContext('2d')!;
    const draw = () => {
      // Elevation above the horizontal: a true overhead orthographic view at 90°.
      const radians = angle * Math.PI / 180;
      const focus = 180 * (1 - (angle - 34) / 56);
      camera.position.set(0, focus + 3000 * Math.sin(radians), 3000 * Math.cos(radians));
      camera.up.set(0, Math.cos(radians), -Math.sin(radians));
      camera.lookAt(0, focus, 0);
      camera.updateMatrixWorld();
      // Remove directional shading overhead so this reads as a 2D contour map.
      sun.intensity = 1.7 * (90 - angle) / 56;
      ambient.intensity = 1.1 + 1.1 * (angle - 34) / 56;
      renderer.render(scene, camera);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = `${width < 450 ? 11 : 13}px system-ui`;
      ctx.textBaseline = 'middle';
      let nextLabelY = 12;
      const annotations = lines.map(item => {
        const point = item.anchor.clone().project(camera);
        const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
        return { item, x, y, labelY: y };
      }).sort((a, b) => a.y - b.y);
      for (const annotation of annotations) {
        annotation.labelY = Math.max(annotation.y, nextLabelY);
        nextLabelY = annotation.labelY + 19;
      }
      const overflow = Math.max(0, nextLabelY - 19 - (height - 12));
      for (const { item, x, y, labelY: unshiftedY } of annotations) {
        const labelX = Math.min(width - 54, x + 18);
        const labelY = unshiftedY - overflow;
        ctx.strokeStyle = palette.muted;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(labelX - 3, labelY); ctx.stroke();
        ctx.fillStyle = palette.surface;
        ctx.fillRect(labelX - 2, labelY - 9, 51, 18);
        ctx.fillStyle = palette.text;
        ctx.fillText(`${item.level} m`, labelX, labelY);
      }
    };
    const applyTheme = () => {
      palette = themeColors();
      const forest = new THREE.Color(getCssColor('--terrain-forest', palette.probe));
      const rock = new THREE.Color(getCssColor('--terrain-rock', palette.muted));
      const snow = new THREE.Color(getCssColor('--terrain-snow', palette.bg));
      const colorAttribute = geometry.getAttribute('color');
      terrain.heights.forEach((h, i) => {
        const { forest: forestCover, snow: snowCover } = terrainCover(positions[i * 3], positions[i * 3 + 2], h);
        const color = rock.clone().lerp(forest, forestCover).lerp(snow, snowCover);
        colorAttribute.setXYZ(i, color.r, color.g, color.b);
      });
      colorAttribute.needsUpdate = true;
      for (const item of lines) {
        item.line.material.color.set(item.level <= 200
          ? getCssColor('--terrain-snow', palette.bg) : getCssColor('--terrain-contour', palette.text));
      }
      draw();
    };
    const animate = (time: number) => {
      const t = Math.min(1, (time - startTime) / 850);
      angle = startAngle + (targetAngle - startAngle) * (t * t * (3 - 2 * t));
      draw();
      if (t < 1) frame = requestAnimationFrame(animate);
    };
    controlsRef.current = (top) => {
      const next = top ? 90 : 34;
      if (next === targetAngle) return;
      cancelAnimationFrame(frame);
      startAngle = angle;
      targetAngle = next;
      startTime = performance.now();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        angle = next; draw();
      } else frame = requestAnimationFrame(animate);
    };
    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const halfWidth = 1280, halfHeight = halfWidth * height / width;
      camera.left = -halfWidth; camera.right = halfWidth;
      camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      labels.width = Math.round(width * dpr); labels.height = Math.round(height * dpr);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const unwatch = onThemeChange(applyTheme);
    applyTheme(); resize();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); unwatch();
      controlsRef.current = () => {};
      geometry.dispose(); material.dispose();
      for (const item of lines) { item.line.geometry.dispose(); item.line.material.dispose(); }
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  useEffect(() => { controlsRef.current(topDown); }, [topDown]);

  return (
    <figure className="not-prose mx-auto my-8 max-w-3xl text-[var(--text-primary)]">
      <ControlBar>
        <Button variant={topDown ? 'secondary' : 'primary'} aria-pressed={!topDown}
          onClick={() => setTopDown(false)}>3D landscape</Button>
        <Button variant={topDown ? 'primary' : 'secondary'} aria-pressed={topDown}
          onClick={() => setTopDown(true)}>Top-down map</Button>
      </ControlBar>
      {unavailable ? <p className="p-6 text-center" role="status">
        This 3D view needs WebGL. Each contour joins places at the same elevation:
        100, 200, 300, 400, 500, and 600 m. Close contours indicate a steep slope.
      </p> : <div ref={hostRef} className="relative my-3 aspect-[3/2] w-full"
        role="img" aria-label={`${topDown ? 'Top-down contour map' : 'Three-dimensional landscape'} of a Mount Rainier-inspired snowy volcano, with glacier valleys and rocky ridges. Contours every 100 metres on this simplified landscape.`}>
        <canvas ref={labelsRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>}
      <figcaption className="text-center text-sm leading-relaxed text-[var(--text-muted)]">
        Switch views to see the same hills from above. Close lines mean steep slopes;
        widely spaced lines mean gentler slopes.
      </figcaption>
    </figure>
  );
}
