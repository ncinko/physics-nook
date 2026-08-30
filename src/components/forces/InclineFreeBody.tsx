import { useState } from 'react';
import { ControlBar, Slider, Toggle } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { ForceArrow, FORCE_COLORS } from './ForceArrow';
import NewtSprite, { NEWT_RADIUS } from './NewtSprite';
import { solveIncline } from '../../lib/forces';

// The ramp, drawn with tilted axes. Everything except the weight already lies
// along one axis or the other, which is the whole reason for tilting them.

const VIEW = { width: 700, height: 380 };
const MASS = 2;
const GRAVITY = 9.8;
const PIVOT = { x: 622, y: 322 };
const MAX_SLOPE_LENGTH = 470;
const PIXELS_PER_NEWTON = 5;
// Newt is drawn a little under full size here so the force arrows, not the
// sprite, dominate the diagram.
const NEWT_SCALE = 0.7;

const DEG = Math.PI / 180;
const format = (value: number, digits = 1) => value.toFixed(digits);

export default function InclineFreeBody() {
  const [angleDeg, setAngleDeg] = useState(20);
  const [muStatic, setMuStatic] = useState(0.5);
  const [muKinetic, setMuKinetic] = useState(0.35);
  const [showComponents, setShowComponents] = useState(true);

  const solution = solveIncline({ angleDeg, mass: MASS, muStatic, muKinetic, g: GRAVITY });
  const theta = angleDeg * DEG;

  // Keep the apex on screen at steep angles by shortening the ramp instead of
  // letting it run off the top of the frame.
  const slopeLength = Math.min(MAX_SLOPE_LENGTH, angleDeg < 1 ? MAX_SLOPE_LENGTH : (PIVOT.y - 44) / Math.sin(theta));
  const upSlope = { x: -Math.cos(theta), y: -Math.sin(theta) };
  const downSlope = { x: Math.cos(theta), y: Math.sin(theta) };
  const outward = { x: Math.sin(theta), y: -Math.cos(theta) };
  const apex = { x: PIVOT.x + upSlope.x * slopeLength, y: PIVOT.y + upSlope.y * slopeLength };

  const along = 0.46 * slopeLength;
  const contact = { x: PIVOT.x + upSlope.x * along, y: PIVOT.y + upSlope.y * along };
  const standoff = NEWT_RADIUS * NEWT_SCALE + 4;
  const newt = { x: contact.x + outward.x * standoff, y: contact.y + outward.y * standoff };

  const px = (newtons: number) => newtons * PIXELS_PER_NEWTON;

  return (
    <div className="not-prose my-8 grid gap-4">
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={`Newt on a ${format(angleDeg, 0)} degree ramp, ${solution.sliding ? 'sliding down' : 'held in place by static friction'}`}
        className="block h-auto w-full select-none"
      >
        {/* Wedge sitting on the ground: vertical face at the left, hypotenuse
            descending to the pivot, so Newt stands on the outside of it. */}
        <polygon
          points={`${PIVOT.x},${PIVOT.y} ${apex.x},${apex.y} ${apex.x},${PIVOT.y}`}
          fill="color-mix(in srgb, var(--grid-line) 22%, transparent)"
          stroke="var(--grid-line)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <line x1="40" y1={PIVOT.y} x2={VIEW.width - 30} y2={PIVOT.y} stroke="var(--grid-line)" strokeWidth="3" strokeLinecap="round" />

        {/* Angle mark at the pivot. */}
        <path
          d={`M ${PIVOT.x - 54} ${PIVOT.y} A 54 54 0 0 0 ${PIVOT.x + upSlope.x * 54} ${PIVOT.y + upSlope.y * 54}`}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2"
        />
        <text x={PIVOT.x - 76} y={PIVOT.y - 14} fill="var(--text-muted)" fontSize="15" fontWeight="600">
          {format(angleDeg, 0)}°
        </text>

        <NewtSprite x={newt.x} y={newt.y} angle={angleDeg} scale={NEWT_SCALE} />

        {showComponents && (
          <>
            <ForceArrow
              origin={newt}
              vector={downSlope}
              scale={px(solution.weightAlong)}
              maxLength={px(solution.weightAlong)}
              color={FORCE_COLORS.gravity}
              label="mg sinθ"
              labelBounds={VIEW}
              opacity={0.75}
              dashed
            />
            <ForceArrow
              origin={newt}
              vector={{ x: -outward.x, y: -outward.y }}
              scale={px(solution.weightPerpendicular)}
              maxLength={px(solution.weightPerpendicular)}
              color={FORCE_COLORS.gravity}
              label="mg cosθ"
              labelBounds={VIEW}
              opacity={0.75}
              dashed
            />
          </>
        )}

        <ForceArrow
          origin={newt}
          vector={{ x: 0, y: 1 }}
          scale={px(solution.weight)}
          maxLength={px(solution.weight)}
          color={FORCE_COLORS.gravity}
          label="mg"
          labelBounds={VIEW}
        />
        <ForceArrow
          origin={newt}
          vector={outward}
          scale={px(solution.normal)}
          maxLength={px(solution.normal)}
          color={FORCE_COLORS.normal}
          label="N"
          labelBounds={VIEW}
        />
        <ForceArrow
          origin={newt}
          vector={upSlope}
          scale={px(Math.abs(solution.friction))}
          maxLength={px(Math.abs(solution.friction))}
          color={FORCE_COLORS.friction}
          label="f"
          labelBounds={VIEW}
        />
        {solution.sliding && (
          <ForceArrow
            origin={{ x: newt.x + outward.x * 46, y: newt.y + outward.y * 46 }}
            vector={downSlope}
            scale={px(solution.netAlong)}
            maxLength={px(solution.netAlong)}
            color={FORCE_COLORS.net}
            label="net"
            labelBounds={VIEW}
          />
        )}
      </svg>

      <ControlBar>
        <Slider label="angle" unit="°" min={0} max={40} step={1} value={angleDeg} onChange={setAngleDeg} />
        <Slider label="μs" min={0} max={0.9} step={0.05} value={muStatic} onChange={setMuStatic} format={(v) => v.toFixed(2)} />
        <Slider label="μk" min={0} max={0.9} step={0.05} value={muKinetic} onChange={setMuKinetic} format={(v) => v.toFixed(2)} />
        <Toggle label="weight components" checked={showComponents} onChange={setShowComponents} />
      </ControlBar>

      <Readout variant="inline" className="justify-center">
        <Readout.Value label="N" value={format(solution.normal)} unit="N" />
        <Readout.Value label="mg sinθ" value={format(solution.weightAlong)} unit="N" />
        <Readout.Value label="f" value={format(Math.abs(solution.friction))} unit="N" />
        <Readout.Value label="a" value={format(solution.acceleration, 2)} unit="m/s²" />
      </Readout>

      <p className="m-0 text-center text-sm leading-6 text-[color:var(--text-muted)]">
        {solution.sliding
          ? `Newt slides: the ramp is steeper than the slip angle of ${format(solution.slipAngleDeg, 0)}°, so mg sinθ beats the most static friction the surface can supply.`
          : `Newt stays put: static friction supplies exactly ${format(Math.abs(solution.friction))} N, within the ${format(solution.maxStatic)} N it can muster. He slips past ${format(solution.slipAngleDeg, 0)}°.`}
      </p>
    </div>
  );
}
