export interface Point {
  x: number;
  y: number;
}

export interface RopeNode extends Point {
  previousX: number;
  previousY: number;
}

export interface Circle extends Point {
  radius: number;
}

export interface RectZone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface RopeStepOptions {
  dt: number;
  gravity: number;
  damping: number;
  segmentLength: number;
  iterations: number;
  fixedStart: boolean;
  peg?: Circle;
  pegPadding?: number;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const getDistance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const clampPointToZone = (point: Point, zone: RectZone): Point => ({
  x: clamp(point.x, zone.minX, zone.maxX),
  y: clamp(point.y, zone.minY, zone.maxY),
});

export const createRopeNodes = (anchor: Point, bob: Point, segmentCount: number): RopeNode[] => {
  const safeSegmentCount = Math.max(1, Math.round(segmentCount));

  return Array.from({ length: safeSegmentCount + 1 }, (_, index) => {
    const t = index / safeSegmentCount;
    const x = anchor.x + (bob.x - anchor.x) * t;
    const y = anchor.y + (bob.y - anchor.y) * t;

    return {
      x,
      y,
      previousX: x,
      previousY: y,
    };
  });
};

export const cloneRopeNodes = (nodes: RopeNode[]) =>
  nodes.map((node) => ({ ...node }));

export const getNodeVelocity = (node: RopeNode, dt = 1): Point => ({
  x: (node.x - node.previousX) / dt,
  y: (node.y - node.previousY) / dt,
});

export const setNodeVelocity = (node: RopeNode, velocity: Point, dt = 1) => {
  node.previousX = node.x - velocity.x * dt;
  node.previousY = node.y - velocity.y * dt;
};

export const integrateRope = (
  nodes: RopeNode[],
  dt: number,
  gravity: number,
  damping: number,
  fixedStart: boolean,
) => {
  const dtSquared = dt * dt;
  const startIndex = fixedStart ? 1 : 0;

  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    const velocityX = (node.x - node.previousX) * damping;
    const velocityY = (node.y - node.previousY) * damping;

    node.previousX = node.x;
    node.previousY = node.y;
    node.x += velocityX;
    node.y += velocityY + gravity * dtSquared;
  }
};

export const constrainRopeSegments = (
  nodes: RopeNode[],
  segmentLength: number,
  fixedStart = true,
) => {
  if (nodes.length < 2) {
    return;
  }

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const start = nodes[index];
    const end = nodes[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) {
      continue;
    }

    const correctionScale = (distance - segmentLength) / distance;

    if (fixedStart && index === 0) {
      end.x -= dx * correctionScale;
      end.y -= dy * correctionScale;
      continue;
    }

    const correctionX = dx * correctionScale * 0.5;
    const correctionY = dy * correctionScale * 0.5;

    start.x += correctionX;
    start.y += correctionY;
    end.x -= correctionX;
    end.y -= correctionY;
  }
};

export const projectPointOutOfCircle = (
  point: Point,
  circle: Circle,
  padding = 0,
): { point: Point; moved: boolean } => {
  const radius = circle.radius + padding;
  const dx = point.x - circle.x;
  const dy = point.y - circle.y;
  const distance = Math.hypot(dx, dy);

  if (distance >= radius) {
    return { point: { ...point }, moved: false };
  }

  const normalX = distance === 0 ? 0 : dx / distance;
  const normalY = distance === 0 ? -1 : dy / distance;

  return {
    point: {
      x: circle.x + normalX * radius,
      y: circle.y + normalY * radius,
    },
    moved: true,
  };
};

export const resolvePegCollision = (
  nodes: RopeNode[],
  peg: Circle,
  padding = 0,
  fixedStart = true,
) => {
  let movedCount = 0;
  const startIndex = fixedStart ? 1 : 0;

  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    const projected = projectPointOutOfCircle(node, peg, padding);

    if (!projected.moved) {
      continue;
    }

    const shiftX = projected.point.x - node.x;
    const shiftY = projected.point.y - node.y;
    node.x = projected.point.x;
    node.y = projected.point.y;
    node.previousX += shiftX * 0.72;
    node.previousY += shiftY * 0.72;
    movedCount += 1;
  }

  return movedCount;
};

export const stepRope = (nodes: RopeNode[], options: RopeStepOptions) => {
  integrateRope(nodes, options.dt, options.gravity, options.damping, options.fixedStart);

  for (let pass = 0; pass < options.iterations; pass += 1) {
    constrainRopeSegments(nodes, options.segmentLength, options.fixedStart);

    if (options.peg) {
      resolvePegCollision(nodes, options.peg, options.pegPadding ?? 0, options.fixedStart);
    }
  }
};

export const getPointToSegmentDistance = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return getDistance(point, start);
  }

  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  const closest = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };

  return getDistance(point, closest);
};

export const findNearestRopeSegment = (
  nodes: RopeNode[],
  point: Point,
  maxDistance: number,
) => {
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const distance = getPointToSegmentDistance(point, nodes[index], nodes[index + 1]);

    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }

  if (nearestIndex === -1 || nearestDistance > maxDistance) {
    return null;
  }

  return {
    index: nearestIndex,
    distance: nearestDistance,
  };
};

export const cutRopeAtSegment = (nodes: RopeNode[], segmentIndex: number) => {
  if (nodes.length <= 1) {
    return cloneRopeNodes(nodes);
  }

  const safeSegmentIndex = clamp(Math.floor(segmentIndex), 0, nodes.length - 2);
  return cloneRopeNodes(nodes.slice(safeSegmentIndex + 1));
};

export const hasLanded = (bob: Point, bobRadius: number, groundY: number) =>
  bob.y + bobRadius >= groundY;

export const getLandingScore = (bobX: number, targetX: number) =>
  Math.abs(bobX - targetX);
