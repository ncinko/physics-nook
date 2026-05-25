import type { ReactNode } from 'react';

interface NewtSpriteProps {
  x: number;
  y: number;
  angle?: number;
  scale?: number;
  children?: ReactNode;
}

export const NEWT_RADIUS = 30;
export const NEWT_MOUTH_OFFSET = { x: 0, y: 6 };

export default function NewtSprite({
  x,
  y,
  angle = 0,
  scale = 1,
  children,
}: NewtSpriteProps) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <path
        d="M -24 20 C -38 21 -43 30 -32 34 C -20 38 -9 31 -13 23"
        fill="#22c55e"
        stroke="#15803d"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
      <path
        d="M 24 20 C 38 21 43 30 32 34 C 20 38 9 31 13 23"
        fill="#22c55e"
        stroke="#15803d"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
      <ellipse cx="-25" cy="13" rx="8" ry="5" fill="#4ade80" stroke="#15803d" strokeWidth="2" />
      <ellipse cx="25" cy="13" rx="8" ry="5" fill="#4ade80" stroke="#15803d" strokeWidth="2" />
      <ellipse cx="0" cy="6" rx="31" ry="25" fill="#22c55e" stroke="#166534" strokeWidth="2.5" />
      <ellipse cx="-16" cy="-16" rx="12" ry="13" fill="#86efac" stroke="#166534" strokeWidth="2.2" />
      <ellipse cx="16" cy="-16" rx="12" ry="13" fill="#86efac" stroke="#166534" strokeWidth="2.2" />
      <circle cx="-16" cy="-17" r="5.2" fill="#052e16" />
      <circle cx="16" cy="-17" r="5.2" fill="#052e16" />
      <circle cx="-17.8" cy="-19.2" r="1.6" fill="#f8fafc" />
      <circle cx="14.2" cy="-19.2" r="1.6" fill="#f8fafc" />
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#bbf7d0" opacity="0.82" />
      <path
        d="M -13 4 C -7 11 7 11 13 4"
        fill="none"
        stroke="#14532d"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <circle cx="-10" cy="3" r="1.6" fill="#14532d" opacity="0.7" />
      <circle cx="10" cy="3" r="1.6" fill="#14532d" opacity="0.7" />
      {children}
    </g>
  );
}
