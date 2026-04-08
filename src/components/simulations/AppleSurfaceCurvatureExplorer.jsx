import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DARK_BACKGROUND_COLOR = '#0d0d12';
const LIGHT_BACKGROUND_FALLBACK = '#f9fafb';
const ANT_SPEED = 0.35;
const MAX_TRAIL_POINTS = 300;
const DEFAULT_SPACING = 0.15;
const TRAIL_COLOR_SETS = [
  [0xff3333, 0xff8888, 0xffcccc],
  [0x33ff33, 0x88ff88, 0xccffcc],
  [0x3333ff, 0x8888ff, 0xccccff],
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getSceneBackgroundColor = () => {
  if (typeof document === 'undefined') {
    return LIGHT_BACKGROUND_FALLBACK;
  }

  const root = document.documentElement;
  if (root.getAttribute('data-theme') === 'dark') {
    return DARK_BACKGROUND_COLOR;
  }

  return getComputedStyle(root).getPropertyValue('--sim-bg').trim() || LIGHT_BACKGROUND_FALLBACK;
};

function getRTarget(phi) {
  const dimpleTop = 0.8 * Math.exp(-(phi ** 2) / 0.15);
  const dimpleBottom = 0.4 * Math.exp(-((phi - Math.PI) ** 2) / 0.2);
  let radius = 2.0 - dimpleTop - dimpleBottom;
  radius *= 1.0 + 0.08 * Math.cos(phi);
  return radius;
}

function getF(point) {
  const radius = point.length();
  if (radius === 0) {
    return 0;
  }

  const yNormalized = clamp(point.y / radius, -1, 1);
  const phi = Math.acos(yNormalized);
  return radius - getRTarget(phi);
}

function getGradient(point) {
  const delta = 0.001;
  const px = new THREE.Vector3(point.x + delta, point.y, point.z);
  const mx = new THREE.Vector3(point.x - delta, point.y, point.z);
  const py = new THREE.Vector3(point.x, point.y + delta, point.z);
  const my = new THREE.Vector3(point.x, point.y - delta, point.z);
  const pz = new THREE.Vector3(point.x, point.y, point.z + delta);
  const mz = new THREE.Vector3(point.x, point.y, point.z - delta);

  return new THREE.Vector3(
    (getF(px) - getF(mx)) / (2 * delta),
    (getF(py) - getF(my)) / (2 * delta),
    (getF(pz) - getF(mz)) / (2 * delta),
  );
}

function projectToSurface(point) {
  for (let index = 0; index < 3; index += 1) {
    const value = getF(point);
    const gradient = getGradient(point);
    const gradientSq = gradient.lengthSq();

    if (gradientSq > 1e-8) {
      point.sub(gradient.multiplyScalar(value / gradientSq));
    }
  }
}

function getNormal(point) {
  return getGradient(point).normalize();
}

function calculateGaussianCurvature(point) {
  const normal = getNormal(point);
  let tangent1 = new THREE.Vector3(0, 1, 0);

  if (Math.abs(normal.y) > 0.9) {
    tangent1.set(1, 0, 0);
  }

  tangent1.cross(normal).normalize();
  const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1).normalize();
  const epsilon = 0.001;

  const point1 = point.clone().addScaledVector(tangent1, epsilon);
  const point2 = point.clone().addScaledVector(tangent2, epsilon);
  projectToSurface(point1);
  projectToSurface(point2);

  const normal1 = getNormal(point1);
  const normal2 = getNormal(point2);
  const dNormal1 = normal1.clone().sub(normal).divideScalar(epsilon);
  const dNormal2 = normal2.clone().sub(normal).divideScalar(epsilon);

  const s11 = tangent1.dot(dNormal1);
  const s12 = tangent2.dot(dNormal1);
  const s21 = tangent1.dot(dNormal2);
  const s22 = tangent2.dot(dNormal2);

  return s11 * s22 - s12 * s21;
}

class Ant {
  constructor(scene, color, startPoint = null, startVelocity = null) {
    if (startPoint && startVelocity) {
      this.p = startPoint.clone();
      this.v = startVelocity.clone().normalize().multiplyScalar(ANT_SPEED);
    } else {
      this.p = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 2,
      )
        .normalize()
        .multiplyScalar(2);
      projectToSurface(this.p);

      const normal = getNormal(this.p);
      const randomVector = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();

      this.v = randomVector
        .sub(normal.clone().multiplyScalar(randomVector.dot(normal)))
        .normalize()
        .multiplyScalar(ANT_SPEED);
    }

    this.mesh = new THREE.Group();
    this.bodyGroup = new THREE.Group();
    this.mesh.add(this.bodyGroup);

    const antMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
    });

    const abdomenGeometry = new THREE.SphereGeometry(0.045, 16, 16);
    abdomenGeometry.scale(1, 1, 1.4);
    const abdomen = new THREE.Mesh(abdomenGeometry, antMaterial);
    abdomen.position.set(0, 0, 0.08);

    const thoraxGeometry = new THREE.SphereGeometry(0.025, 16, 16);
    thoraxGeometry.scale(1, 1, 1.1);
    const thorax = new THREE.Mesh(thoraxGeometry, antMaterial);
    thorax.position.set(0, 0, 0);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), antMaterial);
    head.position.set(0, 0, -0.05);

    abdomen.castShadow = true;
    thorax.castShadow = true;
    head.castShadow = true;

    this.bodyGroup.add(abdomen);
    this.bodyGroup.add(thorax);
    this.bodyGroup.add(head);

    const antennaGeometry = new THREE.CylinderGeometry(0.002, 0.001, 0.05, 4);
    antennaGeometry.translate(0, 0.025, 0);

    for (let index = 0; index < 2; index += 1) {
      const isRight = index === 0;
      const sign = isRight ? 1 : -1;
      const antenna = new THREE.Mesh(antennaGeometry, antMaterial);
      antenna.position.set(sign * 0.01, 0.01, -0.015);
      antenna.rotation.x = -Math.PI * 0.35;
      antenna.rotation.z = sign * Math.PI * 0.15;
      antenna.castShadow = true;
      head.add(antenna);
    }

    this.legs = [];
    const femurGeometry = new THREE.CylinderGeometry(0.005, 0.003, 0.06, 5);
    femurGeometry.translate(0, -0.03, 0);
    const tibiaGeometry = new THREE.CylinderGeometry(0.003, 0.001, 0.08, 5);
    tibiaGeometry.translate(0, -0.04, 0);

    for (let index = 0; index < 6; index += 1) {
      const isRight = index % 2 === 0;
      const pairIndex = Math.floor(index / 2);
      const legGroup = new THREE.Group();
      const sideSign = isRight ? 1 : -1;

      const femur = new THREE.Mesh(femurGeometry, antMaterial);
      femur.castShadow = true;
      femur.rotation.z = sideSign * Math.PI * 0.6;

      const tibia = new THREE.Mesh(tibiaGeometry, antMaterial);
      tibia.castShadow = true;
      tibia.position.set(0, -0.06, 0);
      tibia.rotation.z = -sideSign * Math.PI * 0.45;

      femur.add(tibia);
      legGroup.add(femur);
      legGroup.position.set(sideSign * 0.02, 0.01, -0.03 + pairIndex * 0.03);
      legGroup.rotation.x = -(1 - pairIndex) * 0.4;

      const baseY = (1 - pairIndex) * sideSign * 0.2;
      legGroup.rotation.y = baseY;

      this.bodyGroup.add(legGroup);
      this.legs.push({
        group: legGroup,
        isRight,
        pairIndex,
        baseY,
      });
    }

    this.bodyGroup.rotation.y = Math.PI;
    this.walkCycle = Math.random() * Math.PI * 2;

    scene.add(this.mesh);

    this.trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3);
    this.trailOpacities = new Float32Array(MAX_TRAIL_POINTS);
    this.trailDropTimes = new Float32Array(MAX_TRAIL_POINTS);
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeometry.setAttribute('pointOpacity', new THREE.BufferAttribute(this.trailOpacities, 1));
    this.trailGeometry.setDrawRange(0, 0);

    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
      },
      vertexShader: `
        attribute float pointOpacity;
        varying float vOpacity;
        void main() {
          vOpacity = pointOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vOpacity;
        void main() {
          gl_FragColor = vec4(color, vOpacity * 0.7);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.trailLine = new THREE.Line(this.trailGeometry, this.trailMaterial);
    scene.add(this.trailLine);

    this.trailCount = 0;
    this.frameCount = Math.floor(Math.random() * 10);
  }

  update(dt, time) {
    const clampedDt = Math.min(dt, 0.05);

    this.p.addScaledVector(this.v, clampedDt);
    projectToSurface(this.p);

    const newNormal = getNormal(this.p);
    this.v.sub(newNormal.clone().multiplyScalar(this.v.dot(newNormal)));
    this.v.normalize().multiplyScalar(ANT_SPEED);

    this.mesh.position.copy(this.p);

    const target = this.p.clone().add(this.v);
    this.mesh.up.copy(newNormal);
    this.mesh.lookAt(target);

    this.walkCycle += clampedDt * 35;
    this.legs.forEach((leg) => {
      const phaseOffset = ((leg.isRight ? 0 : 1) + leg.pairIndex) % 2 === 0 ? 0 : Math.PI;
      leg.group.rotation.y = leg.baseY + Math.sin(this.walkCycle + phaseOffset) * 0.4;
    });

    this.frameCount += 1;
    if (this.frameCount % 4 === 0) {
      if (this.trailCount >= MAX_TRAIL_POINTS) {
        this.trailPositions.copyWithin(0, 3, MAX_TRAIL_POINTS * 3);
        this.trailOpacities.copyWithin(0, 1, MAX_TRAIL_POINTS);
        this.trailDropTimes.copyWithin(0, 1, MAX_TRAIL_POINTS);
        this.trailCount -= 1;
      }

      const offset = this.trailCount * 3;
      this.trailPositions[offset] = this.p.x;
      this.trailPositions[offset + 1] = this.p.y;
      this.trailPositions[offset + 2] = this.p.z;
      this.trailDropTimes[this.trailCount] = time;
      this.trailOpacities[this.trailCount] = 1;
      this.trailCount += 1;
      this.trailGeometry.setDrawRange(0, this.trailCount);
      this.trailGeometry.attributes.position.needsUpdate = true;
    }

    for (let index = 0; index < this.trailCount; index += 1) {
      const age = time - this.trailDropTimes[index];
      this.trailOpacities[index] = Math.max(0, 1.0 - age / 5.0);
    }

    this.trailGeometry.attributes.pointOpacity.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    scene.remove(this.trailLine);

    this.mesh.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
        child.material?.dispose();
      }
    });

    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
  }
}

function spawnAntSet(scene, ants, centerPos, initialVelDir, rightDir, spacing, colors) {
  for (let index = -1; index <= 1; index += 1) {
    const offset = rightDir.clone().multiplyScalar(index * spacing);
    const point = centerPos.clone().add(offset);
    projectToSurface(point);

    const normal = getNormal(point);
    const velocity = initialVelDir.clone();
    velocity.sub(normal.clone().multiplyScalar(velocity.dot(normal)));

    ants.push(new Ant(scene, colors[index + 1], point, velocity));
  }
}

export default function AppleSurfaceCurvatureExplorer() {
  const rootRef = useRef(null);
  const canvasHostRef = useRef(null);
  const runtimeRef = useRef(null);
  const placingModeRef = useRef(false);
  const [isCurvatureMode, setIsCurvatureMode] = useState(false);
  const [isPlacingMode, setIsPlacingMode] = useState(false);
  const [isInView, setIsInView] = useState(true);
  const [panelBackground, setPanelBackground] = useState(() => getSceneBackgroundColor());
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  );

  placingModeRef.current = isPlacingMode;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting && entry.intersectionRatio > 0.2);
      },
      { threshold: [0, 0.2, 0.5, 0.8] },
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const root = document.documentElement;
    const handleVisibility = () => setIsDocumentVisible(!document.hidden);
    const syncTheme = () => setPanelBackground(getSceneBackgroundColor());

    syncTheme();
    document.addEventListener('visibilitychange', handleVisibility);
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return undefined;
    }

    const initialBackground = getSceneBackgroundColor();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(initialBackground);
    scene.fog = new THREE.FogExp2(initialBackground, 0.04);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(5, 3, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(initialBackground, 1);
    renderer.domElement.className = 'block h-full w-full';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 3;
    controls.maxDistance = 15;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragStartPoint = new THREE.Vector3();
    const dragCurrentDir = new THREE.Vector3();

    const aimArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      0.5,
      0xffffff,
      0.1,
      0.08,
    );
    aimArrow.visible = false;
    scene.add(aimArrow);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 0.8);
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.3);
    fillLight.position.set(-5, -2, -5);
    scene.add(fillLight);

    const appleGroup = new THREE.Group();
    scene.add(appleGroup);

    const appleGeometry = new THREE.SphereGeometry(2, 128, 128);
    const positionAttribute = appleGeometry.attributes.position;
    const colorsOriginal = new Float32Array(positionAttribute.count * 3);
    const colorsCurvature = new Float32Array(positionAttribute.count * 3);
    const baseColor = new THREE.Color(0xc81111);
    const curvatureBase = new THREE.Color(0x444444);
    const positiveCurvature = new THREE.Color(0xffbb00);
    const negativeCurvature = new THREE.Color(0x0088ff);

    for (let index = 0; index < positionAttribute.count; index += 1) {
      const point = new THREE.Vector3().fromBufferAttribute(positionAttribute, index);
      projectToSurface(point);
      positionAttribute.setXYZ(index, point.x, point.y, point.z);

      const offset = index * 3;
      colorsOriginal[offset] = baseColor.r;
      colorsOriginal[offset + 1] = baseColor.g;
      colorsOriginal[offset + 2] = baseColor.b;

      const curvature = calculateGaussianCurvature(point);
      const color =
        curvature > 0
          ? curvatureBase.clone().lerp(positiveCurvature, Math.min(curvature * 2.5, 1))
          : curvatureBase.clone().lerp(negativeCurvature, Math.min(-curvature * 2.5, 1));

      colorsCurvature[offset] = color.r;
      colorsCurvature[offset + 1] = color.g;
      colorsCurvature[offset + 2] = color.b;
    }

    appleGeometry.computeVertexNormals();
    appleGeometry.setAttribute('color', new THREE.BufferAttribute(colorsOriginal.slice(), 3));
    appleGeometry.setAttribute('colorOrig', new THREE.BufferAttribute(colorsOriginal, 3));
    appleGeometry.setAttribute('colorCurv', new THREE.BufferAttribute(colorsCurvature, 3));

    const appleMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.35,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.2,
    });
    const appleMesh = new THREE.Mesh(appleGeometry, appleMaterial);
    appleMesh.castShadow = true;
    appleMesh.receiveShadow = true;
    appleGroup.add(appleMesh);

    const stemGeometry = new THREE.CylinderGeometry(0.04, 0.02, 0.6, 8);
    stemGeometry.translate(0, 0.3, 0);
    const stemMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d2314,
      roughness: 0.9,
    });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    const stemPos = new THREE.Vector3(0, 2, 0);
    projectToSurface(stemPos);
    stem.position.copy(stemPos);
    stem.rotation.z = Math.PI * 0.1;
    stem.rotation.x = Math.PI * 0.05;
    stem.castShadow = true;
    appleGroup.add(stem);

    const ants = [];
    spawnAntSet(
      scene,
      ants,
      new THREE.Vector3(2.0, -0.2, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      DEFAULT_SPACING,
      TRAIL_COLOR_SETS[0],
    );
    spawnAntSet(
      scene,
      ants,
      new THREE.Vector3(0, 0.8, 2.0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      DEFAULT_SPACING,
      TRAIL_COLOR_SETS[1],
    );
    spawnAntSet(
      scene,
      ants,
      new THREE.Vector3(-1.8, -1.0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      DEFAULT_SPACING,
      TRAIL_COLOR_SETS[2],
    );

    const renderScene = () => {
      renderer.render(scene, camera);
    };

    const updateSize = () => {
      const width = Math.max(host.clientWidth, 320);
      const height = Math.max(host.clientHeight, 420);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderScene();
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(host);
    updateSize();

    const getPointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handlePointerDown = (event) => {
      if (!placingModeRef.current) {
        return;
      }

      getPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObject(appleMesh);

      if (!intersects.length) {
        return;
      }

      runtimeRef.current.isDragging = true;
      dragStartPoint.copy(intersects[0].point);
      projectToSurface(dragStartPoint);

      aimArrow.position.copy(dragStartPoint);
      const normal = getNormal(dragStartPoint);
      const randomDir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      );
      dragCurrentDir.copy(
        randomDir.sub(normal.clone().multiplyScalar(randomDir.dot(normal))).normalize(),
      );

      aimArrow.setDirection(dragCurrentDir);
      aimArrow.visible = true;
      renderScene();
    };

    const handlePointerMove = (event) => {
      const runtime = runtimeRef.current;
      if (!placingModeRef.current || !runtime?.isDragging) {
        return;
      }

      getPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObject(appleMesh);

      if (!intersects.length) {
        return;
      }

      const currentPoint = intersects[0].point.clone();
      projectToSurface(currentPoint);

      const direction = currentPoint.sub(dragStartPoint);
      if (direction.lengthSq() > 0.001) {
        const normal = getNormal(dragStartPoint);
        direction.sub(normal.clone().multiplyScalar(direction.dot(normal))).normalize();
        dragCurrentDir.copy(direction);
        aimArrow.setDirection(dragCurrentDir);
        renderScene();
      }
    };

    const handlePointerUp = () => {
      const runtime = runtimeRef.current;
      if (!placingModeRef.current || !runtime?.isDragging) {
        return;
      }

      runtime.isDragging = false;
      aimArrow.visible = false;

      const normal = getNormal(dragStartPoint);
      const rightDir = dragCurrentDir.clone().cross(normal).normalize();
      const hue = Math.random();
      const color1 = new THREE.Color().setHSL(hue, 1, 0.5).getHex();
      const color2 = new THREE.Color().setHSL((hue + 0.05) % 1, 1, 0.6).getHex();
      const color3 = new THREE.Color().setHSL((hue - 0.05 + 1) % 1, 1, 0.6).getHex();

      spawnAntSet(scene, ants, dragStartPoint, dragCurrentDir, rightDir, DEFAULT_SPACING, [color1, color2, color3]);
      setIsPlacingMode(false);
      renderScene();
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    runtimeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      appleGroup,
      appleGeometry,
      appleMesh,
      aimArrow,
      ants,
      resizeObserver,
      renderScene,
      frameId: 0,
      lastTimestamp: null,
      elapsedTime: 0,
      isDragging: false,
      cleanup: () => {
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        resizeObserver.disconnect();
        ants.forEach((ant) => ant.dispose(scene));
        appleGeometry.dispose();
        appleMaterial.dispose();
        stemGeometry.dispose();
        stemMaterial.dispose();
        controls.dispose();
        renderer.dispose();
        host.replaceChildren();
      },
    };

    renderScene();

    return () => {
      if (runtimeRef.current?.frameId) {
        window.cancelAnimationFrame(runtimeRef.current.frameId);
      }

      runtimeRef.current?.cleanup();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    runtime.controls.enabled = !isPlacingMode;
    runtime.renderer.domElement.style.cursor = isPlacingMode ? 'crosshair' : 'default';

    if (!isPlacingMode) {
      runtime.isDragging = false;
      runtime.aimArrow.visible = false;
    }

    runtime.renderScene();
  }, [isPlacingMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    const targetAttr = isCurvatureMode ? 'colorCurv' : 'colorOrig';
    runtime.appleGeometry.attributes.color.array.set(runtime.appleGeometry.attributes[targetAttr].array);
    runtime.appleGeometry.attributes.color.needsUpdate = true;
    runtime.renderScene();
  }, [isCurvatureMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    runtime.scene.background = new THREE.Color(panelBackground);
    runtime.scene.fog.color.set(panelBackground);
    runtime.renderer.setClearColor(panelBackground, 1);
    runtime.renderScene();
  }, [panelBackground]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return undefined;
    }

    if (!isInView || !isDocumentVisible) {
      runtime.lastTimestamp = null;
      runtime.renderScene();
      return undefined;
    }

    let frameId = 0;

    const animate = (timestamp) => {
      const dt =
        runtime.lastTimestamp === null
          ? 0.016
          : Math.min((timestamp - runtime.lastTimestamp) / 1000, 0.05);

      runtime.lastTimestamp = timestamp;
      runtime.elapsedTime += dt;

      runtime.appleGroup.rotation.y = runtime.elapsedTime * 0.1;
      runtime.ants.forEach((ant) => ant.update(dt, runtime.elapsedTime));
      runtime.controls.update();
      runtime.renderScene();

      frameId = window.requestAnimationFrame(animate);
      runtime.frameId = frameId;
    };

    frameId = window.requestAnimationFrame(animate);
    runtime.frameId = frameId;

    return () => {
      runtime.lastTimestamp = null;
      window.cancelAnimationFrame(frameId);
    };
  }, [isDocumentVisible, isInView]);

  const autoPaused = !isInView || !isDocumentVisible;

  return (
    <div
      ref={rootRef}
      className="relative h-full min-h-[44rem] overflow-hidden"
      style={{ backgroundColor: panelBackground }}
    >
      <div ref={canvasHostRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute top-5 left-5 max-w-[18rem] rounded-xl border border-white/10 bg-black/60 px-5 py-4 text-white backdrop-blur">
  

        <button
          type="button"
          onClick={() => setIsCurvatureMode((current) => !current)}
          className="pointer-events-auto mt-3 block w-full rounded-md border border-white/30 bg-white/15 px-3.5 py-2 text-[13px] text-white transition-all duration-200 hover:bg-white/25"
        >
          Toggle Curvature Mode
        </button>

        <button
          type="button"
          onClick={() => setIsPlacingMode((current) => !current)}
          className={`pointer-events-auto mt-2 block w-full rounded-md border px-3.5 py-2 text-[13px] text-white transition-all duration-200 ${
            isPlacingMode
              ? 'border-red-400/50 bg-red-500/30 hover:bg-red-500/40'
              : 'border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30'
          }`}
        >
          {isPlacingMode ? 'Cancel Placement' : '+ Place Ants (Drag to Aim)'}
        </button>

        <div className="mt-3 text-[12px] leading-6" style={{ display: isCurvatureMode ? 'block' : 'none' }}>
          <span style={{ color: '#ffbb00' }}>&#9632;</span> Positive (Spherical)
          <br />
          <span style={{ color: '#0088ff' }}>&#9632;</span> Negative (Saddle)
          <br />
          <span style={{ color: '#444444' }}>&#9632;</span> Flat
        </div>

      </div>
    </div>
  );
}
