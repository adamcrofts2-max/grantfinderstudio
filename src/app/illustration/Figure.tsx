/**
 * The line-character figure.
 *
 * PLACEHOLDER ART. Drawn here to hold the slot and prove the direction works
 * in both colour schemes; it is not the standard the rest of the product is
 * held to. Before this ships to anyone it wants a real illustrator or a
 * licensed set — at which point only this file changes.
 *
 * Front door and empty states only. A figure never appears beside a number:
 * one standing next to the award-distribution chart would make the chart look
 * like a stock photograph of a chart.
 *
 * Every colour is a token that already flips for dark mode, so the line art
 * inverts on its own — light lines on a dark ground — rather than becoming a
 * black drawing on a black page.
 *
 * Decorative throughout, so it is hidden from assistive technology: the empty
 * state's own words carry the whole message.
 */
export function Figure() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 230 300" fill="none" className="figure">
    <g stroke="var(--fig-line)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
    <path d="M70,150 C68,180 66,220 65,258 L96,258 C97,220 98,182 99,152 Z" fill="var(--fig-fill)"/>
    <path d="M101,152 C102,182 103,220 104,258 L135,258 C134,220 132,180 130,150 Z" fill="var(--fig-fill)"/>
    <path d="M62,256 C61,268 66,274 82,274 C94,274 98,270 98,256 Z" fill="var(--fig-line)"/>
    <path d="M104,256 C104,270 108,274 120,274 C136,274 141,268 140,256 Z" fill="var(--fig-line)"/>
    <path d="M93,64 L109,64 L109,82 L93,82 Z" fill="var(--fig-fill)"/>
    <path d="M100,76 C84,76 72,82 70,92 L66,142 C66,150 78,154 100,154 C122,154 134,150 134,142 L130,92 C128,82 116,76 100,76 Z" fill="var(--fig-accent)"/>
    <path d="M70,84 C62,88 58,100 56,118 C54,132 54,142 55,150 L73,150 C72,140 72,128 74,114 C76,100 78,92 82,86 Z" fill="var(--fig-accent)"/>
    <path d="M130,84 C140,88 148,100 150,116 C151,126 150,134 148,140 L130,138 C132,130 132,120 129,110 C126,100 122,92 118,87 Z" fill="var(--fig-accent)"/>
    <circle cx="64" cy="152" r="8" fill="var(--fig-fill)"/>
    <circle cx="146" cy="142" r="8" fill="var(--fig-fill)"/>
    <ellipse cx="100" cy="46" rx="22" ry="25" fill="var(--fig-fill)"/>
    <path d="M78,58 C74,28 86,17 100,17 C114,17 126,28 122,58 C120,58 118,48 117,40 C110,46 90,46 83,40 C82,48 80,58 78,58 Z" fill="var(--fig-line)"/>
    <path d="M95,56 Q100,60 105,56" fill="none"/>
    <rect x="152" y="96" width="56" height="72" rx="5" fill="var(--fig-fill)"/>
    <rect x="171" y="90" width="18" height="11" rx="3" fill="var(--fig-line)"/>
    </g>
    <circle cx="92" cy="47" r="2.4" fill="var(--fig-line)"/>
    <circle cx="108" cy="47" r="2.4" fill="var(--fig-line)"/>
    <g>
    <rect x="159" y="112" width="11" height="11" rx="2.5" fill="var(--fig-accent)"/>
    <path d="M161.5,117.5 L164,120 L167.5,114.5" stroke="var(--fig-fill)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <rect x="175" y="116" width="25" height="2.6" rx="1.3" fill="var(--fig-muted)"/>
    <rect x="159" y="130" width="11" height="11" rx="2.5" fill="var(--fig-accent)"/>
    <path d="M161.5,135.5 L164,138 L167.5,132.5" stroke="var(--fig-fill)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <rect x="175" y="134" width="19" height="2.6" rx="1.3" fill="var(--fig-muted)"/>
    <rect x="159" y="148" width="11" height="11" rx="2.5" fill="var(--fig-fill)" stroke="var(--fig-line)" strokeWidth="1.8"/>
    <rect x="175" y="152" width="25" height="2.6" rx="1.3" fill="var(--fig-muted)"/>
    </g>
    </svg>
  );
}
