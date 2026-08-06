/**
 * Purely decorative hero background: a few drifting gradient blobs plus an
 * inline SVG "map" — a faint graticule with pins that light up on a loop.
 * Pure CSS `@keyframes` only (see globals.css `.hero__bg` rules) — no JS,
 * no canvas, no external requests. `prefers-reduced-motion: reduce` pauses
 * everything (handled globally in CSS).
 */
export function HeroBackdrop() {
  const pins = [
    { x: 120, y: 96, delay: 0 },
    { x: 340, y: 58, delay: 0.6 },
    { x: 560, y: 118, delay: 1.2 },
    { x: 690, y: 64, delay: 1.9 },
    { x: 230, y: 176, delay: 2.5 },
    { x: 470, y: 190, delay: 3.1 },
  ];

  return (
    <div className="hero__bg" aria-hidden="true">
      <span className="hero__blob hero__blob--jade" />
      <span className="hero__blob hero__blob--teal" />
      <span className="hero__blob hero__blob--blue" />

      <svg
        className="hero__map"
        viewBox="0 0 800 260"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <pattern id="hero-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.2" cy="1.2" r="1.2" fill="currentColor" />
          </pattern>
          <linearGradient id="hero-map-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity="0.15" />
            <stop offset="45%" stopColor="#000" stopOpacity="1" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <mask id="hero-map-mask">
            <rect width="800" height="260" fill="url(#hero-map-fade)" />
          </mask>
        </defs>

        <g mask="url(#hero-map-mask)">
          <rect width="800" height="260" fill="url(#hero-grid)" className="hero__grid" />
          {/* a couple of soft contour lines suggesting coastline / routes */}
          <path
            className="hero__route"
            d="M-20 210 C 120 180, 200 230, 320 190 S 520 140, 640 175 S 780 150, 840 170"
          />
          <path
            className="hero__route hero__route--b"
            d="M-20 70 C 140 40, 260 95, 400 60 S 620 20, 840 55"
          />

          {pins.map((p, i) => (
            <g
              key={i}
              className={`hero__pin ${i % 2 === 0 ? 'hero__pin--jade' : 'hero__pin--blue'}`}
              style={{ ['--pin-delay' as string]: `${p.delay}s` }}
              transform={`translate(${p.x} ${p.y})`}
            >
              <circle className="hero__pin-ring" r="10" />
              <circle className="hero__pin-dot" r="3.2" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
