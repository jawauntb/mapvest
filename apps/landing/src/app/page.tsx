import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Point at a place. See what’s investable.',
};

const TESTFLIGHT_URL = 'https://testflight.apple.com/join/PLACEHOLDER';
const GITHUB_URL = 'https://github.com/jawauntb/mapvest';

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

export default function HomePage() {
  return (
    <>
      <section className="hero">
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
              className="btn btn--primary"
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Join TestFlight
            </a>
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

      <section className="section container">
        <div className="section__eyebrow">How it works</div>
        <h2 className="section__title">
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
    </>
  );
}
