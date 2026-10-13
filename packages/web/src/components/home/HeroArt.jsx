/**
 * The first-visit hero's one illustration: a council chamber's colonnade in a faint tint of the
 * stage's ivory, and you, at the podium, in ivory (the colors come from home.css). Decorative
 * only. Drawn on a 1440x168 canvas that slices from the bottom center, so the speaker stays
 * centered at every width.
 */
const COLUMN_XS = Array.from({ length: 16 }, (_, i) => -30 + i * 96);

export default function HeroArt() {
  return (
    <div className="hero__art" aria-hidden="true">
      <svg viewBox="0 0 1440 168" preserveAspectRatio="xMidYMax slice" focusable="false">
        <g fill="currentColor" opacity=".14">
          <rect x="-40" y="14" width="1520" height="14" rx="7" />
          {COLUMN_XS.map((x) => (
            <g key={x}>
              <rect x={x} y="34" width="60" height="10" rx="4" />
              <rect x={x + 9} y="48" width="42" height="112" rx="8" />
            </g>
          ))}
          <rect x="-40" y="160" width="1520" height="8" />
        </g>
        <g fill="currentColor">
          <circle cx="720" cy="74" r="17" />
          <path d="M684 102h72l-8 58h-56z" />
          <rect className="hero__mic" x="700" y="110" width="40" height="6" rx="3" />
        </g>
      </svg>
    </div>
  );
}
