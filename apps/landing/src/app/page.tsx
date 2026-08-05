import type { Metadata } from 'next';
import { probeApiSafe, type ApiState } from '@/lib/status';
import { CopyableCurl } from './CopyableCurl';

export const metadata: Metadata = {
  title: 'Point at a place. See what’s investable.',
};

// TestFlight isn't live yet. The visual CTA stays so the page shape is
// unchanged, but the href intentionally does NOT go to the placeholder
// join URL — anyone who clicks lands back on the page with a #coming-soon
// anchor instead of a broken TestFlight join screen.
const TESTFLIGHT_HREF = '#testflight-coming-soon';
const GITHUB_URL = 'https://github.com/jawauntb/mapvest';
const API_BASE_URL = 'https://api-production-4b27.up.railway.app';
const API_DOCS_URL = '/docs';

// Force this page to be statically rendered at build time. The API probe
// runs once during `next build` — never at request time — which matches
// the task requirement (fetches at build time only).
export const dynamic = 'force-static';
export const revalidate = false;

const features = [
  {
    icon: 'M',
    title: 'Map',
    body: 'Every pin on the map is a public brand, a private-brand comparable, or an ETF with material exposure. Pan the world, see what you can own.',
  },
  {
    icon: 'C',
    title: 'Camera',
    body: 'Point your phone at a shelf, a storefront, a chocolate bar. Mapvest identifies the brand and returns the ticker plus sources, in seconds.',
  },
  {
    icon: 'Δ',
    title: 'Comparable',
    body: 'Private company? We resolve the nearest public comparable, the sector ETF, and a confidence score — so the map is never a dead end.',
  },
] as const;

// ---------- inline SVG phone screenshots ----------
//
// These are hand-drawn mockups, not real captures. They live in the JSX so
// there are zero external image dependencies and the whole gallery is
// diffable text. Each one is a 320x640 iPhone-shaped canvas rendered inside
// a shared .phone chrome wrapper.

function PhoneMapScreen() {
  return (
    <svg
      viewBox="0 0 320 640"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Mapvest map view — pins on a stylized map with a ticker chip"
    >
      <defs>
        <pattern id="mapGrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1a2a1e" strokeWidth="1" />
        </pattern>
        <linearGradient id="mapVignette" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="100%" stopColor="#0a0a0a" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      <rect width="320" height="640" fill="#0a0a0a" />

      {/* status bar */}
      <g fill="#ffffff">
        <text x="20" y="26" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="12" fontWeight="600">9:41</text>
        <rect x="270" y="18" width="18" height="10" rx="2" fill="none" stroke="#ffffff" strokeWidth="1" />
        <rect x="272" y="20" width="12" height="6" rx="1" />
      </g>

      {/* map area */}
      <g>
        <rect x="0" y="44" width="320" height="500" fill="#0f1a14" />
        <rect x="0" y="44" width="320" height="500" fill="url(#mapGrid)" />

        {/* landmasses */}
        <path d="M 0 180 Q 60 160 120 175 T 240 170 T 320 190 L 320 260 Q 260 275 200 260 T 100 265 T 0 260 Z"
              fill="#1f3a2a" stroke="#2a5540" strokeWidth="1" />
        <path d="M 0 360 Q 80 345 160 365 T 320 360 L 320 460 L 0 460 Z"
              fill="#1f3a2a" stroke="#2a5540" strokeWidth="1" />

        {/* roads */}
        <path d="M 0 250 Q 100 235 180 265 T 320 275" fill="none" stroke="#3ee68a" strokeWidth="1" strokeOpacity="0.55" />
        <path d="M 90 44 Q 100 200 160 320 T 200 540" fill="none" stroke="#3ee68a" strokeWidth="1" strokeOpacity="0.35" />
        <path d="M 0 400 Q 160 380 320 405" fill="none" stroke="#3ee68a" strokeWidth="1" strokeOpacity="0.35" />

        {/* secondary pins */}
        <g fill="#3ee68a" fillOpacity="0.55">
          <circle cx="60" cy="150" r="3" />
          <circle cx="230" cy="220" r="3" />
          <circle cx="270" cy="380" r="3" />
          <circle cx="50" cy="360" r="3" />
          <circle cx="180" cy="430" r="3" />
        </g>

        {/* primary pin + pulse */}
        <g transform="translate(160,290)">
          <circle r="26" fill="none" stroke="#3ee68a" strokeOpacity="0.18" strokeWidth="2" />
          <circle r="14" fill="none" stroke="#3ee68a" strokeOpacity="0.35" strokeWidth="2" />
          <path d="M 0 -20 C -10 -20 -17 -13 -17 -4 C -17 6 -6 14 0 26 C 6 14 17 6 17 -4 C 17 -13 10 -20 0 -20 Z"
                fill="#3ee68a" stroke="#0a0a0a" strokeWidth="1.5" />
          <circle cx="0" cy="-4" r="5" fill="#0a0a0a" />
        </g>

        {/* ticker chip */}
        <g transform="translate(190,258)">
          <rect x="0" y="0" width="96" height="26" rx="5" fill="#0a0a0a" stroke="#3ee68a" strokeWidth="1" />
          <text x="10" y="17" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="700" fill="#3ee68a">$SBUX</text>
          <text x="58" y="17" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fill="#a1a1a1">+1.2%</text>
        </g>

        <rect x="0" y="44" width="320" height="500" fill="url(#mapVignette)" />
      </g>

      {/* search bar */}
      <g transform="translate(16,58)">
        <rect x="0" y="0" width="288" height="40" rx="10" fill="#131313" stroke="#1f1f1f" strokeWidth="1" />
        <circle cx="18" cy="20" r="6" fill="none" stroke="#a1a1a1" strokeWidth="1.5" />
        <line x1="22" y1="24" x2="28" y2="30" stroke="#a1a1a1" strokeWidth="1.5" strokeLinecap="round" />
        <text x="40" y="25" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="13" fill="#6b6b6b">Search a place, brand, or ticker</text>
      </g>

      {/* bottom sheet peek */}
      <g transform="translate(0,494)">
        <rect x="0" y="0" width="320" height="146" rx="16" fill="#131313" stroke="#1f1f1f" strokeWidth="1" />
        <rect x="146" y="8" width="28" height="4" rx="2" fill="#2a2a2a" />
        <text x="20" y="34" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="11" fontWeight="600" fill="#3ee68a" letterSpacing="1.5">SELECTED PIN</text>
        <text x="20" y="58" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="18" fontWeight="700" fill="#ffffff">Starbucks — 4th &amp; King</text>
        <text x="20" y="80" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="12" fill="#a1a1a1">Public · NASDAQ</text>

        <g transform="translate(20,96)">
          <rect x="0" y="0" width="60" height="24" rx="4" fill="#0a0a0a" stroke="#3ee68a" strokeWidth="1" />
          <text x="30" y="16" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="700" fill="#3ee68a">$SBUX</text>

          <rect x="68" y="0" width="52" height="24" rx="4" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1" />
          <text x="94" y="16" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="#ffffff">$XLY</text>

          <rect x="128" y="0" width="52" height="24" rx="4" fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="1" />
          <text x="154" y="16" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fill="#ffffff">$JVA</text>
        </g>
      </g>
    </svg>
  );
}

function PhoneCameraScreen() {
  return (
    <svg
      viewBox="0 0 320 640"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Mapvest camera view — a shelf item is identified and matched to a ticker"
    >
      <defs>
        <linearGradient id="camViewfinder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
        <linearGradient id="barWrap" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4a2418" />
          <stop offset="50%" stopColor="#6b3822" />
          <stop offset="100%" stopColor="#4a2418" />
        </linearGradient>
      </defs>

      <rect width="320" height="640" fill="#0a0a0a" />

      {/* status bar */}
      <g fill="#ffffff">
        <text x="20" y="26" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="12" fontWeight="600">9:41</text>
        <rect x="270" y="18" width="18" height="10" rx="2" fill="none" stroke="#ffffff" strokeWidth="1" />
        <rect x="272" y="20" width="12" height="6" rx="1" />
      </g>

      {/* viewfinder */}
      <rect x="0" y="44" width="320" height="500" fill="url(#camViewfinder)" />

      {/* shelf */}
      <rect x="0" y="360" width="320" height="180" fill="#161616" />
      <rect x="0" y="360" width="320" height="2" fill="#2a2a2a" />
      <rect x="0" y="440" width="320" height="2" fill="#2a2a2a" />

      {/* products (chocolate bars in wrappers) */}
      <g>
        <rect x="18" y="368" width="46" height="70" rx="3" fill="#3a2018" />
        <rect x="20" y="378" width="42" height="14" fill="#5a2f22" />
        <rect x="72" y="368" width="46" height="70" rx="3" fill="#2a1a12" />
        <rect x="74" y="378" width="42" height="14" fill="#4a2418" />

        {/* focused bar */}
        <g>
          <rect x="130" y="360" width="60" height="78" rx="4" fill="url(#barWrap)" stroke="#3ee68a" strokeWidth="2" />
          <text x="160" y="392" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="9" fontWeight="700" fill="#f4d9a8" letterSpacing="0.5">COCOA</text>
          <text x="160" y="404" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="7" fill="#f4d9a8">72% DARK</text>
          <rect x="140" y="412" width="40" height="10" rx="1" fill="#f4d9a8" opacity="0.15" />
        </g>

        <rect x="200" y="368" width="46" height="70" rx="3" fill="#2a1a12" />
        <rect x="202" y="378" width="42" height="14" fill="#4a2418" />
        <rect x="254" y="368" width="46" height="70" rx="3" fill="#3a2018" />
        <rect x="256" y="378" width="42" height="14" fill="#5a2f22" />
      </g>

      {/* reticle */}
      <g stroke="#3ee68a" strokeWidth="2" fill="none">
        <path d="M 110 344 L 110 356 M 110 356 L 122 356" strokeLinecap="round" />
        <path d="M 210 344 L 210 356 M 210 356 L 198 356" strokeLinecap="round" />
        <path d="M 110 454 L 110 442 M 110 442 L 122 442" strokeLinecap="round" />
        <path d="M 210 454 L 210 442 M 210 442 L 198 442" strokeLinecap="round" />
      </g>

      {/* identification pill (animates in real app; static here) */}
      <g transform="translate(28,92)">
        <rect x="0" y="0" width="264" height="60" rx="12" fill="#131313" stroke="#3ee68a" strokeWidth="1" />
        <g transform="translate(14,14)">
          <rect x="0" y="0" width="32" height="32" rx="6" fill="rgba(62,230,138,0.12)" />
          <text x="16" y="22" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="16" fontWeight="700" fill="#3ee68a">C</text>
        </g>
        <text x="58" y="26" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="13" fontWeight="700" fill="#ffffff">Identified: Lindt Excellence</text>
        <text x="58" y="42" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="11" fill="#a1a1a1">Confidence 0.92 · 3 sources</text>
      </g>

      {/* result chip */}
      <g transform="translate(96,472)">
        <rect x="0" y="0" width="128" height="40" rx="20" fill="#0a0a0a" stroke="#3ee68a" strokeWidth="1.5" />
        <text x="64" y="20" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="14" fontWeight="700" fill="#3ee68a">$LISN.SW</text>
        <text x="64" y="32" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="9" fill="#a1a1a1">Lindt &amp; Sprüngli AG</text>
      </g>

      {/* shutter row */}
      <g transform="translate(0,556)">
        <rect x="0" y="0" width="320" height="84" fill="#0a0a0a" />
        <circle cx="160" cy="42" r="30" fill="none" stroke="#ffffff" strokeWidth="2" />
        <circle cx="160" cy="42" r="24" fill="#ffffff" />
        <rect x="36" y="30" width="24" height="24" rx="4" fill="none" stroke="#a1a1a1" strokeWidth="1.5" />
        <circle cx="264" cy="42" r="12" fill="none" stroke="#a1a1a1" strokeWidth="1.5" />
        <path d="M 258 42 L 270 42 M 264 36 L 264 48" stroke="#a1a1a1" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

function PhoneDetailScreen() {
  return (
    <svg
      viewBox="0 0 320 640"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Mapvest detail sheet — ticker, comparables, ETF exposure with sources"
    >
      <rect width="320" height="640" fill="#0a0a0a" />

      {/* status bar */}
      <g fill="#ffffff">
        <text x="20" y="26" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="12" fontWeight="600">9:41</text>
        <rect x="270" y="18" width="18" height="10" rx="2" fill="none" stroke="#ffffff" strokeWidth="1" />
        <rect x="272" y="20" width="12" height="6" rx="1" />
      </g>

      {/* top bar */}
      <g transform="translate(16,56)">
        <text x="0" y="14" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="12" fill="#a1a1a1">← Back to map</text>
        <text x="288" y="14" textAnchor="end" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="12" fill="#3ee68a">Save</text>
      </g>

      {/* header */}
      <g transform="translate(16,88)">
        <text x="0" y="20" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="11" fontWeight="600" fill="#3ee68a" letterSpacing="1.5">PUBLIC · SIX SWISS</text>
        <text x="0" y="48" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="22" fontWeight="700" fill="#ffffff">Lindt &amp; Sprüngli</text>
        <text x="0" y="70" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="13" fill="#a1a1a1">$LISN.SW · CHF 11,240</text>
        <text x="288" y="70" textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="13" fill="#3ee68a">+0.84%</text>
      </g>

      {/* sparkline */}
      <g transform="translate(16,176)">
        <rect x="0" y="0" width="288" height="80" rx="10" fill="#131313" stroke="#1f1f1f" strokeWidth="1" />
        <path d="M 12 60 L 40 52 L 60 56 L 88 40 L 112 46 L 140 34 L 168 38 L 196 28 L 224 30 L 252 22 L 276 26"
              fill="none" stroke="#3ee68a" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 12 60 L 40 52 L 60 56 L 88 40 L 112 46 L 140 34 L 168 38 L 196 28 L 224 30 L 252 22 L 276 26 L 276 72 L 12 72 Z"
              fill="rgba(62,230,138,0.10)" />
        <text x="12" y="20" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="10" fill="#6b6b6b">1M</text>
      </g>

      {/* section: comparables */}
      <g transform="translate(16,276)">
        <text x="0" y="14" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="11" fontWeight="600" fill="#a1a1a1" letterSpacing="1.5">COMPARABLES</text>

        <g transform="translate(0,26)">
          <rect x="0" y="0" width="288" height="40" rx="8" fill="#131313" stroke="#1f1f1f" strokeWidth="1" />
          <text x="14" y="17" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="700" fill="#ffffff">$HSY</text>
          <text x="14" y="31" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="10" fill="#a1a1a1">Hershey · confectionery</text>
          <text x="274" y="24" textAnchor="end" fontFamily="ui-monospace, monospace" fontSize="11" fill="#3ee68a">0.88</text>
        </g>

        <g transform="translate(0,72)">
          <rect x="0" y="0" width="288" height="40" rx="8" fill="#131313" stroke="#1f1f1f" strokeWidth="1" />
          <text x="14" y="17" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="700" fill="#ffffff">$MDLZ</text>
          <text x="14" y="31" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="10" fill="#a1a1a1">Mondelez · snacks &amp; chocolate</text>
          <text x="274" y="24" textAnchor="end" fontFamily="ui-monospace, monospace" fontSize="11" fill="#3ee68a">0.81</text>
        </g>
      </g>

      {/* section: ETF exposure */}
      <g transform="translate(16,424)">
        <text x="0" y="14" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="11" fontWeight="600" fill="#a1a1a1" letterSpacing="1.5">ETF EXPOSURE</text>
        <g transform="translate(0,26)">
          <rect x="0" y="0" width="288" height="40" rx="8" fill="#131313" stroke="#1f1f1f" strokeWidth="1" />
          <text x="14" y="17" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="700" fill="#ffffff">$PBJ</text>
          <text x="14" y="31" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="10" fill="#a1a1a1">Food &amp; Beverage · 2.1% weight</text>
          <text x="274" y="24" textAnchor="end" fontFamily="ui-monospace, monospace" fontSize="11" fill="#3ee68a">held</text>
        </g>
      </g>

      {/* sources footer */}
      <g transform="translate(16,506)">
        <text x="0" y="14" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="11" fontWeight="600" fill="#a1a1a1" letterSpacing="1.5">SOURCES</text>
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fill="#6b6b6b">
          <text x="0" y="34">• six-group.com — profile, listing</text>
          <text x="0" y="52">• sec.gov — 20-F filing (2024)</text>
          <text x="0" y="70">• etf.com — PBJ holdings</text>
        </g>
      </g>

      {/* CTA */}
      <g transform="translate(16,588)">
        <rect x="0" y="0" width="288" height="40" rx="8" fill="#3ee68a" />
        <text x="144" y="26" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif" fontSize="14" fontWeight="700" fill="#04120a">Add to watchlist</text>
      </g>
    </svg>
  );
}

const screenshots = [
  {
    key: 'map',
    label: 'Map view',
    caption:
      'Pin the world. Every dot is a public brand, a private-brand comparable, or an ETF with material exposure.',
    node: <PhoneMapScreen />,
  },
  {
    key: 'camera',
    label: 'Camera view',
    caption:
      'Point at a shelf. Multimodal vision resolves the brand and returns the ticker with confidence and sources.',
    node: <PhoneCameraScreen />,
  },
  {
    key: 'detail',
    label: 'Detail sheet',
    caption:
      'Ticker, comparables, ETF exposure, and citation-backed sources. No hallucinated numbers.',
    node: <PhoneDetailScreen />,
  },
] as const;

// Map an API state to a badge label. Landing is always "up" from the
// perspective of anyone who can read this page.
function stateLabel(state: ApiState, upWord = 'live'): string {
  if (state === 'up') return upWord;
  if (state === 'down') return 'down';
  return 'unknown';
}

export default async function HomePage() {
  // Build-time probe. probeApiSafe never throws — the worst case is
  // { api: "down" } or { api: "unknown" } and we render accordingly.
  const status = await probeApiSafe();
  const apiState: ApiState = status.api;
  const apiBadgeLabel =
    apiState === 'up' ? 'API: live' : apiState === 'down' ? 'API: down' : 'API: unknown';

  const curlHealth = `curl -sS ${API_BASE_URL}/v1/health`;
  const curlNearby = `curl -sS "${API_BASE_URL}/v1/nearby?lat=37.7749&lng=-122.4194&radius_m=500"`;
  const curlResolve = `curl -sS -X POST "${API_BASE_URL}/v1/resolve-comparable" \\
  -H 'content-type: application/json' \\
  -d '{"brand":"Lindt","country":"CH"}'`;

  return (
    <>
      <section className="hero" id="testflight-coming-soon">
        <div className="container">
          <span className="hero__eyebrow">alpha · iOS · TestFlight</span>
          <h1 className="hero__title">
            Point at a place.
            <br />
            See what’s <span className="accent">investable</span>.
          </h1>
          <p className="hero__sub">
            Mapvest turns the real world into a portfolio surface. Storefronts,
            shelves, and street corners become tickers, comparables, and ETF
            exposure — with sources, right in your pocket.
          </p>
          <div className="hero__ctas">
            <a
              className="btn btn--primary btn--disabled"
              href={TESTFLIGHT_HREF}
              aria-disabled="true"
              role="link"
            >
              Join TestFlight (coming soon)
            </a>
            <span className="cta-with-badge">
              <a className="btn btn--ghost" href={API_DOCS_URL}>
                Try the API
              </a>
              <span
                className={`status-badge status-badge--${apiState}`}
                aria-label={apiBadgeLabel}
                title={`Last checked ${status.checkedAt}`}
              >
                <span className={`status-dot status-dot--${apiState}`} aria-hidden="true" />
                {apiBadgeLabel}
              </span>
            </span>
            <a
              className="btn btn--ghost"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="features container">
        <div className="features__grid">
          {features.map((f) => (
            <article className="feature" key={f.title}>
              <div className="feature__icon" aria-hidden="true">
                {f.icon}
              </div>
              <h3 className="feature__title">{f.title}</h3>
              <p className="feature__body">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="shots container" aria-labelledby="shots-title">
        <div className="section__eyebrow">Screenshots</div>
        <h2 id="shots-title" className="section__title">
          Three surfaces, one loop: see it, name it, invest it.
        </h2>
        <p className="section__lead">
          Renderings from the iOS alpha. Every number, ticker, and confidence
          score you’ll see in the real app is backed by a resolver that returns
          its sources — the map is never a dead end.
        </p>

        <div className="shots__grid">
          {screenshots.map((s) => (
            <figure className="shot" key={s.key}>
              <div className="phone" aria-hidden="true">
                <div className="phone__notch" />
                <div className="phone__screen">{s.node}</div>
              </div>
              <figcaption className="shot__caption">
                <div className="shot__label">{s.label}</div>
                <p>{s.caption}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="section container" aria-labelledby="how-title">
        <div className="section__eyebrow">How it works</div>
        <h2 id="how-title" className="section__title">
          From a real-world signal to a citation-backed idea.
        </h2>
        <p className="section__lead">
          Mapvest fuses multimodal vision, brand search, and finance resolvers
          into one API. Every answer comes back with the sources that produced
          it — nothing is hallucinated on your behalf.
        </p>
        <div className="hero__ctas" style={{ justifyContent: 'flex-start' }}>
          <a className="btn btn--ghost" href="/docs">
            Read the docs →
          </a>
        </div>
      </section>

      <section className="section container" aria-labelledby="api-playground-title">
        <div className="section__eyebrow">API playground</div>
        <h2 id="api-playground-title" className="section__title">
          Copy. Paste. Get sourced answers.
        </h2>
        <p className="section__lead">
          The API is live at{' '}
          <code>{API_BASE_URL}</code>. Three requests are enough to feel the
          product — health, nearby brands, and a comparable resolver.
        </p>

        <div className="curl-stack">
          <CopyableCurl
            label="health"
            path="/v1/health"
            command={curlHealth}
          />
          <CopyableCurl
            label="nearby"
            path="/v1/nearby"
            command={curlNearby}
          />
          <CopyableCurl
            label="resolve"
            path="/v1/resolve-comparable"
            command={curlResolve}
          />
        </div>
      </section>

      <section className="section container" aria-labelledby="status-title">
        <div className="section__eyebrow">System status</div>
        <h2 id="status-title" className="section__title">
          What’s up right now.
        </h2>
        <p className="section__lead">
          Probed at build time from this static page. For live status hit{' '}
          <code>/api/status</code>.
        </p>

        <ul className="status-list" role="list">
          <li className={`status-row status-row--${apiState}`}>
            <span className={`status-dot status-dot--${apiState}`} aria-hidden="true" />
            <span className="status-row__name">api</span>
            <code className="status-row__host">
              {API_BASE_URL.replace(/^https?:\/\//, '')}
            </code>
            <span className="status-row__state">{stateLabel(apiState)}</span>
          </li>
          <li className="status-row status-row--up">
            <span className="status-dot status-dot--up" aria-hidden="true" />
            <span className="status-row__name">landing</span>
            <code className="status-row__host">landing-production-ce7b.up.railway.app</code>
            <span className="status-row__state">live</span>
          </li>
        </ul>
        <p className="status-note">
          Last checked{' '}
          <time dateTime={status.checkedAt}>{status.checkedAt}</time>.
        </p>
      </section>
    </>
  );
}
