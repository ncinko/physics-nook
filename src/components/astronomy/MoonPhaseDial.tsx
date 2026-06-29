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

const PHASE_DESCRIPTIONS: Record<string, string> = {
  'New Moon':
    'The Moon sits between us and the Sun, so its lit half faces away. We see the unlit side.',
  'Waxing Crescent':
    'A sliver of the lit half has rotated into view on the right. The crescent grows night by night.',
  'First Quarter':
    'The Moon is a quarter of the way around its orbit. We see the lit half edge-on as a right-lit half disk.',
  'Waxing Gibbous':
    'More than half the disk is lit and still growing as the Moon heads toward opposition with the Sun.',
  'Full Moon':
    'The Moon is opposite the Sun, so the entire lit half faces us — a fully illuminated disk.',
  'Waning Gibbous':
    'Past full, the lit fraction is shrinking. The shadow now creeps in from the right.',
  'Third Quarter':
    'Three quarters of the way around. We again see the lit half edge-on, now as a left-lit half disk.',
  'Waning Crescent':
    'Only a thin crescent on the left remains lit as the Moon swings back toward the Sun.',
};

// Screen bearing of the Moon (atan2, y-down) for a given elongation longitude.
// The Sun is drawn to the left, so its direction from Earth is 180deg; longitude
// is measured from that Sun direction (new moon = toward the Sun).
const longitudeToScreenDegrees = (longitude: number) =>
  normalizeDegrees(longitude + 180);

const pointerToLongitude = (event: PointerEvent<SVGElement>): number => {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return 0;
  const rect = svg.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * ORBIT_VIEW;
  const py = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * ORBIT_VIEW;
  const screenDeg = (Math.atan2(py - EARTH_Y, px - EARTH_X) / DEG);
  return normalizeDegrees(screenDeg - 180);
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

  const illumination = moonIlluminationFromLongitude(longitude);
  const phaseName = moonPhaseNameFromLongitude(longitude);
  const waxing = longitude > 0 && longitude < 180;
  const description = PHASE_DESCRIPTIONS[phaseName] ?? '';

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

            {/* Earth */}
            <circle cx={EARTH_X} cy={EARTH_Y} r={16} fill="#3b82f6" />
            <circle cx={EARTH_X} cy={EARTH_Y} r={16} fill="none" stroke="#1d4ed8" strokeWidth={2} />
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

            {/* Sight line from Earth to the Moon */}
            <line
              x1={EARTH_X}
              y1={EARTH_Y}
              x2={moonX}
              y2={moonY}
              stroke="var(--accent-blue)"
              strokeOpacity={0.5}
              strokeWidth={2}
            />

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
          View from North Pole
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
