import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  moonIlluminationFromLongitude,
  moonPhaseNameFromLongitude,
  normalizeDegrees,
} from '../../lib/astronomy/index.ts';

// This interactive is purely geometric: the phase is set by the Sun–Earth–Moon
// elongation longitude (0deg = new, 180deg = full), not by a calendar date. We
// reuse the same longitude->illumination and longitude->name helpers the 3D
// explorer uses so the naming stays consistent across the site.

const DEG = Math.PI / 180;

// Orbit panel (top-down view) geometry, in viewBox units.
const ORBIT_VIEW = 400;
const EARTH_X = 250;
const EARTH_Y = 200;
const ORBIT_R = 120;
const MOON_DOT_R = 15;
const SUN_X = 46;

// Illuminated-Moon panel geometry.
const DISK_VIEW = 300;
const DISK_CX = 150;
const DISK_CY = 150;
const DISK_R = 124;

const MOON_TEXTURE = '/textures/astronomy/moon-lroc-color-2k.jpg';

// Where the bright limb sits on the disk, by clock angle (3 o'clock = 0, going
// clockwise). The lit limb starts on the right (waxing) or left (waning) from the
// North Pole and rotates clockwise as the observer moves toward the South Pole.
const DIRECTION_WORDS: Record<number, string> = {
  0: 'right',
  45: 'lower right',
  90: 'bottom',
  135: 'lower left',
  180: 'left',
  225: 'upper left',
  270: 'top',
  315: 'upper right',
};

const directionWord = (clockAngle: number) =>
  DIRECTION_WORDS[(((Math.round(clockAngle / 45) * 45) % 360) + 360) % 360];

// Build the phase description, weaving in where the lit/dark side falls for the
// chosen viewpoint so the left/right language matches the rotated Moon.
const describePhase = (
  phaseName: string,
  litDir: string,
  darkDir: string,
  viewpointLabel: string,
): string => {
  const from = `Seen from the ${viewpointLabel}, `;
  switch (phaseName) {
    case 'New Moon':
      return 'The Moon sits between us and the Sun, so its lit half faces away. We see the unlit side — the disk is essentially dark from anywhere on Earth.';
    case 'Waxing Crescent':
      return `A sliver of the lit half has come into view, and the crescent grows night by night. ${from}the bright crescent hugs the ${litDir}.`;
    case 'First Quarter':
      return `The Moon is a quarter of the way around its orbit, so we see the lit half edge-on as a half disk. ${from}the ${litDir} half is the bright one.`;
    case 'Waxing Gibbous':
      return `More than half the disk is lit and still growing as the Moon heads toward opposition with the Sun. ${from}the last sliver of shadow clings to the ${darkDir}.`;
    case 'Full Moon':
      return 'The Moon is opposite the Sun, so the entire lit half faces us — a fully illuminated disk from anywhere on Earth.';
    case 'Waning Gibbous':
      return `Past full, the lit fraction is shrinking. ${from}the shadow now encroaches from the ${darkDir}.`;
    case 'Third Quarter':
      return `Three quarters of the way around, we again see the lit half edge-on as a half disk. ${from}the ${litDir} half is the bright one.`;
    case 'Waning Crescent':
      return `Only a thin crescent stays lit as the Moon swings back toward the Sun. ${from}that crescent sits on the ${litDir}.`;
    default:
      return '';
  }
};

// Observer latitude changes the orientation of the Moon in our sky: upright from
// the North Pole, rotated through the equator (terminator horizontal), and flipped
// 180deg from the South Pole. The rotation here is a linear north->south stand-in.
// It runs counter-clockwise so a waning Moon — eaten from the right at the pole —
// is eaten from the upper right in the Northern Hemisphere.
const VIEWPOINTS: { label: string; rotation: number }[] = [
  { label: 'North Pole', rotation: 0 },
  { label: 'Northern Hemisphere', rotation: -45 },
  { label: 'Equator', rotation: -90 },
  { label: 'Southern Hemisphere', rotation: -135 },
  { label: 'South Pole', rotation: -180 },
];

// Screen bearing of the Moon (atan2, y-down) for a given elongation longitude.
// The Sun is drawn to the left, so its direction from Earth is 180deg; longitude
// is measured from that Sun direction (new moon = toward the Sun). Because the SVG
// y-axis points down, increasing longitude must DEcrease the screen angle so the
// Moon orbits counter-clockwise, as it does seen from above the North Pole.
const longitudeToScreenDegrees = (longitude: number) =>
  normalizeDegrees(180 - longitude);

const pointerToLongitude = (event: PointerEvent<SVGElement>): number => {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return 0;
  const rect = svg.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * ORBIT_VIEW;
  const py = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * ORBIT_VIEW;
  const screenDeg = (Math.atan2(py - EARTH_Y, px - EARTH_X) / DEG);
  return normalizeDegrees(180 - screenDeg);
};

// SVG path for the UNLIT region of a disk of radius r centered at (0,0), given
// the illuminated fraction and whether the Moon is waxing. The terminator is a
// half-ellipse whose horizontal semi-axis collapses to zero at the quarters.
const shadowPath = (r: number, illumination: number, waxing: boolean): string => {
  const cosPhase = 1 - 2 * illumination; // +1 at new, -1 at full
  const semi = r * Math.abs(cosPhase);
  const top = `0 ${-r}`;
  const bottom = `0 ${r}`;
  if (waxing) {
    // Lit on the right; the dark region hugs the left limb.
    const limbSweep = 0;
    const termSweep = cosPhase > 0 ? 0 : 1;
    return `M ${top} A ${r} ${r} 0 0 ${limbSweep} ${bottom} A ${semi} ${r} 0 0 ${termSweep} ${top} Z`;
  }
  // Waning: lit on the left; the dark region hugs the right limb.
  const limbSweep = 1;
  const termSweep = cosPhase > 0 ? 1 : 0;
  return `M ${top} A ${r} ${r} 0 0 ${limbSweep} ${bottom} A ${semi} ${r} 0 0 ${termSweep} ${top} Z`;
};

export default function MoonPhaseDial() {
  const [longitude, setLongitude] = useState(90);
  const [viewpointIndex, setViewpointIndex] = useState(0);

  const viewpoint = VIEWPOINTS[viewpointIndex];
  const cycleViewpoint = () =>
    setViewpointIndex((index) => (index + 1) % VIEWPOINTS.length);

  const illumination = moonIlluminationFromLongitude(longitude);
  const phaseName = moonPhaseNameFromLongitude(longitude);
  const waxing = longitude > 0 && longitude < 180;

  // The bright limb starts on the right (waxing) or left (waning), then rotates
  // clockwise with the viewpoint, matching the rotated lunar disk below.
  const litClock = (waxing ? 0 : 180) + viewpoint.rotation;
  const litDir = directionWord(litClock);
  const darkDir = directionWord(litClock + 180);
  const description = describePhase(phaseName, litDir, darkDir, viewpoint.label);

  const screenDeg = longitudeToScreenDegrees(longitude);
  const moonX = EARTH_X + ORBIT_R * Math.cos(screenDeg * DEG);
  const moonY = EARTH_Y + ORBIT_R * Math.sin(screenDeg * DEG);

  const dragHandlers = useMemo(
    () => ({
      onPointerDown: (event: PointerEvent<SVGElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setLongitude(pointerToLongitude(event));
      },
      onPointerMove: (event: PointerEvent<SVGElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        setLongitude(pointerToLongitude(event));
      },
      onPointerUp: (event: PointerEvent<SVGElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
    }),
    [],
  );

  const handleKeyDown = (event: KeyboardEvent<SVGElement>) => {
    const step = event.shiftKey ? 15 : 5;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      setLongitude((value) => normalizeDegrees(value + step));
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      setLongitude((value) => normalizeDegrees(value - step));
      event.preventDefault();
    }
  };

  return (
    <div className="not-prose my-8 grid gap-6 text-[color:var(--text-primary)] sm:grid-cols-2 sm:items-start">
      {/* Part 1 — top-down Sun–Earth–Moon view */}
      <figure className="m-0">
        <figcaption className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Top-down view — drag the Moon
        </figcaption>
        <svg
          viewBox={`0 0 ${ORBIT_VIEW} ${ORBIT_VIEW}`}
          className="mx-auto w-full max-w-sm touch-none"
          role="img"
          aria-label="Top-down view of the Sun, Earth, and Moon. Drag the Moon around its orbit."
        >
            {/* Sunlight rays travelling left to right */}
            {[-70, -35, 0, 35, 70].map((dy) => (
              <line
                key={dy}
                x1={SUN_X + 26}
                y1={EARTH_Y + dy}
                x2={EARTH_X - ORBIT_R - 20}
                y2={EARTH_Y + dy}
                stroke="#facc15"
                strokeOpacity={0.35}
                strokeWidth={2}
                strokeDasharray="4 8"
              />
            ))}

            {/* Sun */}
            <circle cx={SUN_X} cy={EARTH_Y} r={30} fill="#fbbf24" />
            <circle cx={SUN_X} cy={EARTH_Y} r={30} fill="none" stroke="#f59e0b" strokeWidth={2} />
            <text
              x={SUN_X}
              y={EARTH_Y + 54}
              textAnchor="middle"
              fontSize={15}
              fontWeight={600}
              fill="var(--text-muted)"
            >
              Sun
            </text>

            {/* Orbit ring */}
            <circle
              cx={EARTH_X}
              cy={EARTH_Y}
              r={ORBIT_R}
              fill="none"
              stroke="var(--grid-line)"
              strokeWidth={2}
              strokeDasharray="3 7"
            />

            {/* Earth: night side away from the Sun, lit on its Sun-facing (left) half */}
            <g transform={`translate(${EARTH_X} ${EARTH_Y})`}>
              <circle r={16} fill="#1e293b" />
              <path d={`M 0 ${-16} A 16 16 0 0 0 0 16 Z`} fill="#3b82f6" />
              <circle r={16} fill="none" stroke="#1d4ed8" strokeWidth={2} />
            </g>
            <text
              x={EARTH_X}
              y={EARTH_Y + 36}
              textAnchor="middle"
              fontSize={15}
              fontWeight={600}
              fill="var(--text-muted)"
            >
              Earth
            </text>

            {/* Moon: always lit on its Sun-facing (left) half */}
            <g
              transform={`translate(${moonX} ${moonY})`}
              {...dragHandlers}
              onKeyDown={handleKeyDown}
              tabIndex={0}
              role="slider"
              aria-label="Moon position in orbit"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(normalizeDegrees(longitude))}
              aria-valuetext={phaseName}
              className="cursor-grab outline-none focus-visible:[&>circle]:stroke-[var(--accent-blue)]"
            >
              {/* Generous transparent hit area */}
              <circle r={MOON_DOT_R + 12} fill="transparent" />
              {/* Dark (far) hemisphere */}
              <circle r={MOON_DOT_R} fill="#1e293b" />
              {/* Lit (Sun-facing, left) hemisphere */}
              <path
                d={`M 0 ${-MOON_DOT_R} A ${MOON_DOT_R} ${MOON_DOT_R} 0 0 0 0 ${MOON_DOT_R} Z`}
                fill="#f8fafc"
              />
            <circle r={MOON_DOT_R} fill="none" stroke="#0f172a" strokeWidth={1.5} />
          </g>
        </svg>
      </figure>

      {/* Part 2 — illuminated Moon as seen from Earth, with its description */}
      <figure className="m-0 flex flex-col items-center gap-3">
        <figcaption className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          View from{' '}
          <button
            type="button"
            onClick={cycleViewpoint}
            aria-label={`Change viewpoint, currently ${viewpoint.label}. Click to cycle.`}
            className="rounded-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-blue)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[color:var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]"
          >
            {viewpoint.label}
          </button>
        </figcaption>
        <svg
          viewBox={`0 0 ${DISK_VIEW} ${DISK_VIEW}`}
          className="w-44 max-w-full"
          role="img"
          aria-label={`The Moon as seen from Earth: ${phaseName}, ${Math.round(
            illumination * 100,
          )} percent illuminated.`}
        >
          <defs>
            <clipPath id="moon-disk-clip">
              <circle cx={DISK_CX} cy={DISK_CY} r={DISK_R} />
            </clipPath>
          </defs>
          <circle cx={DISK_CX} cy={DISK_CY} r={DISK_R} fill="#0b1020" />
          {/* Observer latitude rotates the lunar disk in our sky. */}
          <g transform={`rotate(${viewpoint.rotation} ${DISK_CX} ${DISK_CY})`}>
            <image
              href={MOON_TEXTURE}
              x={DISK_CX - DISK_R}
              y={DISK_CY - DISK_R}
              width={DISK_R * 2}
              height={DISK_R * 2}
              preserveAspectRatio="xMidYMid slice"
              clipPath="url(#moon-disk-clip)"
            />
            {/* The shadow path lies within the disk by construction, so it needs no clip. */}
            {illumination < 0.999 && (
              <path
                transform={`translate(${DISK_CX} ${DISK_CY})`}
                d={shadowPath(DISK_R, illumination, waxing)}
                fill="#05070f"
                fillOpacity={0.93}
              />
            )}
          </g>
          <circle
            cx={DISK_CX}
            cy={DISK_CY}
            r={DISK_R}
            fill="none"
            stroke="var(--grid-line)"
            strokeWidth={2}
          />
        </svg>

        <div className="text-center">
          <p className="text-lg font-semibold leading-tight">{phaseName}</p>
          <p className="text-sm text-[var(--text-muted)]">
            {Math.round(illumination * 100)}% illuminated
            {longitude > 0 && longitude < 360 && longitude !== 180 ? (
              <span> · {waxing ? 'waxing' : 'waning'}</span>
            ) : null}
          </p>
        </div>

        <p className="text-sm leading-7 text-[color:var(--text-primary)]">{description}</p>
      </figure>
    </div>
  );
}
