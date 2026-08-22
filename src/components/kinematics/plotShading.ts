/**
 * Canvas drawing shared by the two graph explorers' area readings.
 *
 * Both pairs of graphs make the same argument one derivative apart - the area
 * under the lower curve is the change in the upper quantity - so both draw it
 * the same way, and the shading is tinted with the colour of the quantity it
 * produces rather than the curve it sits under.
 */

export const withAlpha = (color: string, alpha: number) => {
  const hex = color.trim();
  if (!/^#([0-9a-f]{6})$/i.test(hex)) {
    return hex;
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export interface SignedAreaOptions {
  from: number;
  to: number;
  valueOfT: (t: number) => number;
  xPix: (t: number) => number;
  yPix: (value: number) => number;
  color: string;
  font: string;
}

/**
 * Shades the region between a curve and its zero line across an interval.
 *
 * Stretches above and below the axis are filled separately - the negative ones
 * lighter and outlined, and each run captioned with its sign - because the
 * whole point of a signed area is that the two contributions pull opposite ways.
 */
export function fillSignedArea(
  ctx: CanvasRenderingContext2D,
  { from, to, valueOfT, xPix, yPix, color, font }: SignedAreaOptions,
) {
  const baseline = yPix(0);

  const fillRun = (runFrom: number, runTo: number, sign: number) => {
    if (runTo - runFrom < 1e-6) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xPix(runFrom), baseline);
    for (let i = 0; i <= 64; i += 1) {
      const t = runFrom + ((runTo - runFrom) * i) / 64;
      ctx.lineTo(xPix(t), yPix(valueOfT(t)));
    }
    ctx.lineTo(xPix(runTo), baseline);
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, sign >= 0 ? 0.3 : 0.14);
    ctx.fill();
    if (sign < 0) {
      ctx.strokeStyle = withAlpha(color, 0.6);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }
    ctx.restore();

    if (Math.abs(xPix(runTo) - xPix(runFrom)) > 26) {
      const midT = (runFrom + runTo) / 2;
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `700 18px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        sign >= 0 ? '+' : '−',
        xPix(midT),
        (baseline + yPix(valueOfT(midT))) / 2 + 6,
      );
      ctx.restore();
    }
  };

  const steps = 240;
  let runStart = from;
  let runSign = Math.sign(valueOfT(from)) || 1;
  for (let i = 1; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    const sign = Math.sign(valueOfT(t)) || runSign;
    if (sign !== runSign) {
      fillRun(runStart, t, runSign);
      runStart = t;
      runSign = sign;
    }
  }
  fillRun(runStart, to, runSign);
}

export interface ChangeBracketOptions {
  xFrom: number;
  xTo: number;
  xArrow: number;
  yFrom: number;
  yTo: number;
  color: string;
  label: string;
  font: string;
}

/**
 * Marks the rise of the upper curve across the interval: dashed rules at the two
 * endpoint values and a double-headed arrow spanning them. This is the other
 * half of the area reading - the shaded region below equals this jump above.
 */
export function drawChangeBracket(
  ctx: CanvasRenderingContext2D,
  { xFrom, xTo, xArrow, yFrom, yTo, color, label, font }: ChangeBracketOptions,
) {
  ctx.save();
  ctx.strokeStyle = withAlpha(color, 0.75);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 5]);
  [yFrom, yTo].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(Math.min(xFrom, xTo), y);
    ctx.lineTo(xArrow, y);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xArrow, yFrom);
  ctx.lineTo(xArrow, yTo);
  ctx.stroke();

  const head = 6;
  const direction = Math.sign(yTo - yFrom) || 1;
  [
    { y: yTo, dir: direction },
    { y: yFrom, dir: -direction },
  ].forEach(({ y, dir }) => {
    ctx.beginPath();
    ctx.moveTo(xArrow, y);
    ctx.lineTo(xArrow - head * 0.7, y - dir * head);
    ctx.lineTo(xArrow + head * 0.7, y - dir * head);
    ctx.closePath();
    ctx.fill();
  });

  ctx.font = `600 14px ${font}`;
  ctx.textAlign = 'left';
  ctx.fillText(label, xArrow + 8, (yFrom + yTo) / 2 + 5);
  ctx.restore();
}
