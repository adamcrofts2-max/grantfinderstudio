/**
 * The cast — line characters for the front door and the empty states.
 *
 * Direction chosen on 2026-09-08: characters at the front door, annotation
 * inside the working screens. One family, drawn to one set of rules, so six
 * figures read as one product and not as six stock images:
 *
 *  - Black line, white fill, ONE accent — the product's own accent, spent on
 *    the one object that matters in each scene: the grant under the glass,
 *    the day circled, the lines already ticked. Clothing is `--fig-wash`, a
 *    tint of the same accent, so the eye goes to the object and not to a
 *    block of blue. Never a second hue.
 *  - Every colour is a token that flips with the scheme, so each drawing
 *    inverts on its own in dark mode. Raster art cannot do that — see the
 *    roadmap note on why generated images are reference, not the asset.
 *  - Built from shared parts (head, hair, body, limbs), with five hair shapes
 *    so the cast is not one person repeated. Limbs are drawn as an outlined
 *    tube — a wide ink stroke under a narrower fill stroke — which keeps the
 *    line weight identical everywhere without hand-closing every sleeve.
 *  - Each figure DOES the job of the screen it sits on: finding, weighing,
 *    writing, planning, arriving. A figure that just stands there is a
 *    mascot, and the design brief rules mascots out.
 *
 * Never beside a number. A person standing next to a chart makes the chart
 * look like a stock photograph of one.
 *
 * Decorative: `aria-hidden`, because the words beside a figure carry the
 * whole message and a screen reader gains nothing from "a person holding a
 * magnifying glass".
 */

import type { ReactNode } from 'react';

const LINE = 'var(--fig-line)';
const FILL = 'var(--fig-fill)';
const ACCENT = 'var(--fig-accent)';
const MUTED = 'var(--fig-muted)';
const WASH = 'var(--fig-wash)';
const W = 2.4;

type Hair = 'short' | 'bob' | 'bun' | 'curly' | 'wrap';

/** Points, relative to the figure's centre, as "x,y x,y x,y". */
type Limb = string;

function Tube({ points, outer, inner, colour }: { points: string; outer: number; inner: number; colour: string }) {
  return (
    <>
      <polyline points={points} fill="none" stroke={LINE} strokeWidth={outer} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke={colour} strokeWidth={inner} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function lastPoint(points: string): [number, number] {
  const last = points.trim().split(/\s+/u).at(-1) ?? '0,0';
  const [x, y] = last.split(',').map(Number);
  return [x ?? 0, y ?? 0];
}

function HairShape({ hair }: { hair: Hair }) {
  switch (hair) {
    case 'short':
      return (
        <path d="M-16.5,40 C-18,21 -8,20 0,20 C10,20 18,23 16.5,40 C13,31 5,29 -2,30 C-9,31 -13,33 -16.5,40 Z" fill={LINE} />
      );
    case 'bob':
      return (
        <path d="M-19,56 C-23,26 -11,19 0,19 C12,19 23,26 19,56 C17,49 16,40 13,33 C6,36 -5,36 -13,32 C-15,40 -17,49 -19,56 Z" fill={LINE} />
      );
    case 'bun':
      return (
        <>
          <circle cx="0" cy="15" r="7.5" fill={LINE} />
          <path d="M-17,42 C-18,22 -8,20 0,20 C9,20 18,22 17,42 C14,33 8,30 0,30 C-8,30 -14,33 -17,42 Z" fill={LINE} />
        </>
      );
    case 'curly':
      return (
        <g fill={LINE}>
          <circle cx="-14" cy="33" r="7" />
          <circle cx="-9" cy="25" r="7.5" />
          <circle cx="0" cy="21.5" r="8" />
          <circle cx="9.5" cy="24.5" r="7.5" />
          <circle cx="14.5" cy="33" r="7" />
        </g>
      );
    case 'wrap':
      return (
        <path
          d="M-19,50 C-22,24 -10,18 0,18 C11,18 22,24 19,50 C16,43 14,36 9,33 C3,31 -3,31 -9,33 C-14,36 -16,43 -19,50 Z"
          fill={ACCENT}
          stroke={LINE}
          strokeWidth={W}
          strokeLinejoin="round"
        />
      );
  }
}

/**
 * A standing person, centred on x, feet on y = 186.
 *
 * `near` is the arm drawn in front of the body, `far` the one behind it;
 * both start at their shoulder. `holding` is drawn after the near arm's hand
 * — for a pen or a card the hand closes over.
 */
function Person({
  x,
  hair,
  far,
  near,
  children,
}: {
  x: number;
  hair: Hair;
  far: Limb;
  near: Limb;
  children?: ReactNode;
}) {
  const [fx, fy] = lastPoint(far);
  const [nx, ny] = lastPoint(near);
  return (
    <g transform={`translate(${x} 0)`}>
      <ellipse cx="0" cy="187" rx="34" ry="4.5" fill={WASH} />
      {/* Far arm, behind the body. */}
      <Tube points={far} outer={11} inner={6.4} colour={WASH} />
      <circle cx={fx} cy={fy} r="5.2" fill={FILL} stroke={LINE} strokeWidth={W} />
      {/* Legs and shoes. */}
      <Tube points="-9,122 -10,177" outer={15} inner={10.2} colour={FILL} />
      <Tube points="9,122 10,177" outer={15} inner={10.2} colour={FILL} />
      <path d="M-21,176 L-2.5,176 C-2,183 -5,186 -12,186 C-19,186 -22,183 -21,176 Z" fill={LINE} />
      <path d="M2.5,176 L21,176 C22,183 19,186 12,186 C5,186 2,183 2.5,176 Z" fill={LINE} />
      {/* Body. */}
      <path
        d="M-23,72 C-23,64 -14,60 0,60 C14,60 23,64 23,72 L26,121 C26,127 15,129 0,129 C-15,129 -26,127 -26,121 Z"
        fill={WASH}
        stroke={LINE}
        strokeWidth={W}
        strokeLinejoin="round"
      />
      <path d="M-7,60 L-7,53 L7,53 L7,60" fill={FILL} stroke={LINE} strokeWidth={W} strokeLinejoin="round" />
      {/* Head. */}
      <ellipse cx="0" cy="40" rx="16" ry="18" fill={FILL} stroke={LINE} strokeWidth={W} />
      <HairShape hair={hair} />
      <circle cx="-6" cy="42" r="1.9" fill={LINE} />
      <circle cx="6" cy="42" r="1.9" fill={LINE} />
      <path d="M-4.5,49 Q0,52.5 4.5,49" fill="none" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      {/* Near arm, in front. */}
      <Tube points={near} outer={11} inner={6.4} colour={WASH} />
      {children}
      <circle cx={nx} cy={ny} r="5.2" fill={FILL} stroke={LINE} strokeWidth={W} />
    </g>
  );
}

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 200"
      fill="none"
      className={className === undefined ? 'figure' : `figure ${className}`}
    >
      {children}
    </svg>
  );
}

/** Finding — a magnifying glass over the grants a funder has made. */
export function Finder() {
  return (
    <Frame>
      {/* The record: three awarded grants, each with its amount. */}
      <g stroke={LINE} strokeWidth={W} strokeLinejoin="round">
        {[62, 96, 130].map((y, i) => (
          <g key={y}>
            <rect x="140" y={y} width="82" height="26" rx="5" fill={FILL} />
            <rect x="148" y={y + 8} width="18" height="10" rx="2.5" fill={i === 1 ? ACCENT : MUTED} stroke="none" />
            <rect x="172" y={y + 7} width="40" height="3.2" rx="1.6" fill={MUTED} stroke="none" />
            <rect x="172" y={y + 15} width="28" height="3.2" rx="1.6" fill={MUTED} stroke="none" />
          </g>
        ))}
      </g>
      <Person x={78} hair="bob" far="-22,70 -30,98 -26,122" near="22,70 36,94 58,100">
        {/* The glass: handle from the hand, lens over the middle grant. */}
        <line x1="58" y1="100" x2="76" y2="104" stroke={LINE} strokeWidth="6" strokeLinecap="round" />
        <circle cx="100" cy="108" r="21" fill={WASH} fillOpacity="0.55" stroke={LINE} strokeWidth="4.5" />
        <path d="M88,98 Q92,93 98,92" fill="none" stroke={FILL} strokeWidth="2.6" strokeLinecap="round" />
      </Person>
    </Frame>
  );
}

/** Weighing — the fund on one pan, your time on the other. */
export function Weigher() {
  return (
    <Frame>
      <g stroke={LINE} strokeWidth={W} strokeLinecap="round" strokeLinejoin="round">
        {/* Stand. */}
        <path d="M150,186 L200,186 L186,176 L164,176 Z" fill={FILL} />
        <line x1="175" y1="176" x2="175" y2="66" strokeWidth="4" />
        <circle cx="175" cy="62" r="5" fill={ACCENT} />
        {/* Beam, level: nothing here is weighted in advance. */}
        <line x1="131" y1="68" x2="219" y2="68" strokeWidth="4" />
        {/* Left pan: the fund, a page. */}
        <line x1="131" y1="68" x2="120" y2="116" />
        <line x1="131" y1="68" x2="142" y2="116" />
        <path d="M114,116 L148,116 C146,124 139,127 131,127 C123,127 116,124 114,116 Z" fill={FILL} />
        <rect x="121" y="90" width="20" height="25" rx="2.5" fill={FILL} />
        <line x1="125" y1="98" x2="137" y2="98" strokeWidth="2" />
        <line x1="125" y1="104" x2="134" y2="104" strokeWidth="2" />
        {/* Right pan: your time, a clock. */}
        <line x1="219" y1="68" x2="208" y2="116" />
        <line x1="219" y1="68" x2="230" y2="116" />
        <path d="M202,116 L236,116 C234,124 227,127 219,127 C211,127 204,124 202,116 Z" fill={FILL} />
        <circle cx="219" cy="102" r="12" fill={WASH} />
        <path d="M219,95 L219,102 L224,105" fill="none" strokeWidth="2.2" />
      </g>
      <Person x={66} hair="curly" far="-22,70 -34,92 -20,108" near="22,70 44,58 58,44" />
    </Frame>
  );
}

/** Writing — every line on the page ticked against something confirmed. */
export function Writer() {
  return (
    <Frame>
      <g stroke={LINE} strokeWidth={W} strokeLinecap="round" strokeLinejoin="round">
        {/* Easel legs, then the sheet. */}
        <line x1="150" y1="150" x2="140" y2="186" />
        <line x1="196" y1="150" x2="206" y2="186" />
        <rect x="118" y="40" width="108" height="118" rx="6" fill={FILL} />
        {[58, 80, 102, 124].map((y, i) => (
          <g key={y}>
            <rect
              x="130"
              y={y}
              width="12"
              height="12"
              rx="3"
              fill={i < 3 ? ACCENT : FILL}
              stroke={i < 3 ? 'none' : LINE}
              strokeWidth="2"
            />
            {i < 3 ? (
              <path d={`M133,${y + 6} L135.5,${y + 8.5} L139.5,${y + 3.5}`} fill="none" stroke={FILL} strokeWidth="2" />
            ) : null}
            <rect x="150" y={y + 4} width={i === 3 ? 34 : 62} height="3.4" rx="1.7" fill={MUTED} stroke="none" />
          </g>
        ))}
      </g>
      <Person x={70} hair="bun" far="-22,70 -30,96 -24,120" near="22,70 42,100 62,118">
        {/* The pen, meeting the unticked line. */}
        <line x1="62" y1="118" x2="70" y2="130" stroke={LINE} strokeWidth="4" strokeLinecap="round" />
      </Person>
    </Frame>
  );
}

/** Planning — the last day you could still start, marked on the calendar. */
export function Planner() {
  return (
    <Frame>
      <g stroke={LINE} strokeWidth={W} strokeLinecap="round" strokeLinejoin="round">
        <rect x="120" y="36" width="104" height="112" rx="6" fill={FILL} />
        <path d="M120,56 L120,42 C120,39 123,36 126,36 L218,36 C221,36 224,39 224,42 L224,56 Z" fill={ACCENT} />
        <line x1="140" y1="30" x2="140" y2="42" strokeWidth="4" />
        <line x1="204" y1="30" x2="204" y2="42" strokeWidth="4" />
        {/* The grid. */}
        {[146, 172, 198].map((x) => (
          <line key={x} x1={x} y1="56" x2={x} y2="148" stroke={MUTED} strokeWidth="1.6" />
        ))}
        {[79, 102, 125].map((y) => (
          <line key={y} x1="120" y1={y} x2="224" y2={y} stroke={MUTED} strokeWidth="1.6" />
        ))}
        {/* The one day that matters, circled in ink. */}
        <path
          d="M160,116 C148,115 146,103 157,99 C168,95 186,98 186,109 C186,119 174,121 163,119"
          fill="none"
          stroke={ACCENT}
          strokeWidth="3"
        />
      </g>
      <Person x={66} hair="short" far="-22,70 -30,96 -26,122" near="22,70 46,74 66,86">
        {/* A card being pinned up. */}
        <rect x="60" y="72" width="26" height="19" rx="3" fill={FILL} stroke={LINE} strokeWidth={W} />
        <circle cx="73" cy="76.5" r="2.6" fill={ACCENT} />
      </Person>
    </Frame>
  );
}

/** Arriving — a door held open, and a wave. */
export function Welcome() {
  return (
    <Frame>
      <g stroke={LINE} strokeWidth={W} strokeLinecap="round" strokeLinejoin="round">
        {/* The doorway, lit from inside. */}
        <rect x="148" y="30" width="66" height="156" rx="3" fill={WASH} />
        <path d="M148,30 L176,40 L176,180 L148,186 Z" fill={FILL} />
        <circle cx="170" cy="112" r="3" fill={ACCENT} stroke="none" />
        <line x1="138" y1="186" x2="226" y2="186" />
        {/* A plant by the step — something growing. */}
        <path d="M18,186 L42,186 L39,166 L21,166 Z" fill={ACCENT} />
        <path d="M30,166 C30,152 22,146 16,144 C18,152 22,160 30,166 Z" fill={FILL} />
        <path d="M30,166 C30,150 38,142 46,140 C44,150 38,160 30,166 Z" fill={FILL} />
      </g>
      {/* Motion lines by the waving hand. */}
      <path d="M126,22 Q131,28 128,35 M133,16 Q141,26 136,38" fill="none" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <Person x={92} hair="wrap" far="-22,70 -30,96 -26,122" near="22,70 36,50 32,26" />
    </Frame>
  );
}

/** Lost — the 404, reading a map that does not have this page on it. */
export function Lost() {
  return (
    <Frame>
      <path
        d="M150,26 C150,14 170,12 172,24 C173,32 162,33 162,42"
        fill="none"
        stroke={ACCENT}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="162" cy="54" r="3.6" fill={ACCENT} />
      <Person x={110} hair="curly" far="-22,70 -40,90 -32,104" near="22,70 40,90 32,104">
        {/* The map, held in both hands: three folded panels. */}
        <path
          d="M-38,86 L-14,92 L10,86 L34,92 L34,120 L10,114 L-14,120 L-38,114 Z"
          fill={FILL}
          stroke={LINE}
          strokeWidth={W}
          strokeLinejoin="round"
        />
        <line x1="-14" y1="92" x2="-14" y2="120" stroke={MUTED} strokeWidth="1.6" />
        <line x1="10" y1="86" x2="10" y2="114" stroke={MUTED} strokeWidth="1.6" />
        <path d="M-30,110 C-22,98 -8,112 2,100 S20,98 26,104" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeDasharray="3 4" strokeLinecap="round" />
      </Person>
    </Frame>
  );
}

export const CAST = { Finder, Weigher, Writer, Planner, Welcome, Lost } as const;
export type CastMember = keyof typeof CAST;
