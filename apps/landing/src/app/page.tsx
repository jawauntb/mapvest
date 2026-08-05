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

// ---------- iOS screenshots ----------
//
// Each entry points at a self-contained SVG under `public/screenshots/`.
// They stand in as "device screenshots" for the alpha — deterministic,
// diffable, and swappable one-for-one when real simulator captures land
// post-TestFlight. Every SVG is authored at a 12:19 aspect ratio so it
// drops straight into the `.phone` device frame without letterboxing.
const screenshots = [
  {
    key: 'auth',
    label: 'Sign in',
    src: '/screenshots/auth.svg',
    alt: 'Mapvest sign-in — magic-link email input over the wordmark',
    caption:
      'One tap, one link. Magic-link email — no passwords, no OAuth carousel — gets you into the alpha.',
  },
  {
    key: 'map',
    label: 'Map view',
    src: '/screenshots/map.svg',
    alt: 'Mapvest map view — five public brand pins and two private-brand comparables around a selected Hershey’s location',
    caption:
      'Pin the world. Green pins are public tickers; orange pins are private brands resolved to comparables.',
  },
  {
    key: 'camera',
    label: 'Camera',
    src: '/screenshots/camera.svg',
    alt: 'Mapvest camera view — a Hershey’s bar is identified and returned as HSY $179.04 +0.77%',
    caption:
      'Point at a shelf. Multimodal vision resolves the brand and returns the ticker with confidence and sources.',
  },
  {
    key: 'detail',
    label: 'Detail sheet',
    src: '/screenshots/detail.svg',
    alt: 'Hershey Company detail sheet — three comparables, four ETFs, and source citations',
    caption:
      'HSY header, sector, three comparables, four ETFs with weights, and the sources that produced every number.',
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

      <section className="shots" aria-labelledby="shots-title">
        <div className="container">
          <div className="section__eyebrow">Screenshots</div>
          <h2 id="shots-title" className="section__title">
            Four surfaces, one loop: sign in, see it, name it, invest it.
          </h2>
          <p className="section__lead">
            Renderings from the iOS alpha. Every number, ticker, and confidence
            score you’ll see in the real app is backed by a resolver that
            returns its sources — the map is never a dead end.
          </p>
        </div>

        <div
          className="shots__scroller"
          role="region"
          aria-label="Screenshot gallery — scroll horizontally"
          tabIndex={0}
        >
          <div className="shots__track">
            {screenshots.map((s) => (
              <figure className="shot" key={s.key}>
                <div className="phone">
                  <div className="phone__notch" aria-hidden="true" />
                  <div className="phone__screen">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.src}
                      alt={s.alt}
                      loading="lazy"
                      decoding="async"
                      width={320}
                      height={506}
                    />
                  </div>
                </div>
                <figcaption className="shot__caption">
                  <div className="shot__label">{s.label}</div>
                  <p>{s.caption}</p>
                </figcaption>
              </figure>
            ))}
          </div>
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
