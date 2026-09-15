import { TESTFLIGHT_URL } from "@/lib/site";
import { type ApiState, probeApiSafe } from "@/lib/status";
import type { Metadata } from "next";
import { HeroBackdrop } from "./HeroBackdrop";
import { HowItWorksDiagram } from "./HowItWorksDiagram";
import { Reveal } from "./Reveal";

export const metadata: Metadata = {
  title: "See a brand. Get the ticker.",
};

// Force this page to be statically rendered at build time. The API probe
// runs once during `next build` — never at request time — which matches
// the task requirement (fetches at build time only).
export const dynamic = "force-static";
export const revalidate = false;

// Small hand-authored icons — no icon library. 24x24 viewBox, stroke-based,
// sized down to 22px via .feature__icon svg in globals.css.
function IconCamera() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.5h3l1.4-2.1a1.5 1.5 0 0 1 1.25-.65h4.7a1.5 1.5 0 0 1 1.25.65L17 8.5h3A1.5 1.5 0 0 1 21.5 10v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.5" r="3.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconResearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 5.5h8M8 9.5h8M8 13.5h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 6.5h14A1.5 1.5 0 0 1 20.5 8v7A1.5 1.5 0 0 1 19 16.5H9.5L5 20.2V8A1.5 1.5 0 0 1 6.5 6.5H5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 19.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M6.5 16V11M12 16V7.5M17.5 16v-5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

const features = [
  {
    icon: <IconCamera />,
    title: "Point at anything with a name on it",
    body: "Camera or map. Public brand returns the ticker. Private brand returns the closest public comparable and an ETF that actually holds it. Every result carries confidence, and every result carries evidence. No account needed to identify — sign in when you find something worth keeping.",
  },
  {
    icon: <IconResearch />,
    title: "Research the neighborhood, not just the name",
    body: "Once an identify lands, the brief covers the block around it — foot traffic, local competitors, permits, the regional quirks that make one corner better than another. The company and the ground it stands on come back together.",
  },
  {
    icon: <IconChat />,
    title: "A finance agent that cites its tools",
    body: "Chat about any name in your universe. The agent doesn't guess — it names the tool it used, the sources it read, and what it couldn't find. Every morning it writes one brief on the names you've caught. No hype, no calls.",
  },
  {
    icon: <IconChart />,
    title: "Prices and postures — never buy or sell",
    body: "Charts, options chains, corporate events, and a Prism dashboard that states a posture (favorable, balanced, unfavorable) with a confidence band. Mapvest identifies. Mapvest does not recommend.",
  },
];

// ---------- iOS screenshots ----------
//
// Each entry points at a self-contained SVG under `public/screenshots/`.
// They stand in as "device screenshots" for the alpha — deterministic,
// diffable, and swappable one-for-one when real simulator captures land
// post-TestFlight. Every SVG is authored at a 12:19 aspect ratio so it
// drops straight into the `.phone` device frame without letterboxing.
const screenshots = [
  {
    key: "auth",
    label: "Sign in",
    src: "/screenshots/auth.svg",
    alt: "Mapvest sign-in — magic-link email input over the wordmark",
    caption:
      "One link, no password. You can identify without signing in — sign in when you find something worth keeping.",
  },
  {
    key: "map",
    label: "The map",
    src: "/screenshots/map.svg",
    alt: "Mapvest map view — five public brand pins and two private-brand comparables around a selected Hershey’s location",
    caption:
      "Jade pins are public tickers. Blue pins are private brands resolved to a comparable and an ETF that holds them.",
  },
  {
    key: "camera",
    label: "Identify",
    src: "/screenshots/camera.svg",
    alt: "Mapvest camera view — a Hershey’s bar is identified and returned as HSY $179.04 +0.77%",
    caption:
      "Point at a shelf, a sign, a can. The brand becomes a ticker with a confidence level and an evidence card.",
  },
  {
    key: "detail",
    label: "The result",
    src: "/screenshots/detail.svg",
    alt: "Hershey Company detail sheet — three comparables, four ETFs, and source citations",
    caption:
      "Ticker, sector, comparables, ETFs that actually hold it, and the sources behind every number. Evidence travels with the result.",
  },
] as const;

export default async function HomePage() {
  // Build-time probe. probeApiSafe never throws — the worst case is
  // { api: "down" } or { api: "unknown" } and we render accordingly.
  const status = await probeApiSafe();
  const apiState: ApiState = status.api;
  const apiBadgeLabel =
    apiState === "up" ? "API: live" : apiState === "down" ? "API: down" : "API: unknown";

  return (
    <>
      {/* If JS never loads, scroll-reveal content must still be visible. */}
      <noscript>
        <style>{".reveal{opacity:1!important;transform:none!important;}"}</style>
      </noscript>

      <section className="hero" id="get-testflight">
        <HeroBackdrop />
        <div className="container">
          <h1 className="hero__brand">
            <img src="/brand/mark.svg" alt="" width={72} height={72} />
            mapvest
          </h1>
          <p className="hero__title">
            See a brand. Get the <span className="accent">ticker</span>.
          </p>
          <p className="hero__sub">
            A can of soda on a shelf is a claim on a public company's future cash flows. Mapvest
            removes the packaging. Point at anything with a name on it — public or private — and
            get the ticker, the comparable, and the evidence.
          </p>
          <div className="hero__ctas">
            <a
              className="btn btn--primary"
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Get TestFlight
            </a>
            <a className="btn btn--ghost" href="/app">
              Preview in the browser
            </a>
            <span
              className={`status-badge status-badge--${apiState}`}
              aria-label={apiBadgeLabel}
              title={`Last checked ${status.checkedAt}`}
            >
              <span className={`status-dot status-dot--${apiState}`} aria-hidden="true" />
              {apiBadgeLabel}
            </span>
          </div>
        </div>
      </section>

      <section className="features container">
        <div className="features__grid">
          {features.map((f, i) => (
            <Reveal key={f.title} className="feature-reveal" delay={i * 90}>
              <article className="feature">
                <div className="feature__icon" aria-hidden="true">
                  {f.icon}
                </div>
                <h3 className="feature__title">{f.title}</h3>
                <p className="feature__body">{f.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section container" aria-labelledby="manifesto-title">
        <Reveal>
          <div className="section__eyebrow">Manifesto</div>
          <h2 id="manifesto-title" className="section__title">
            Remove the packaging.
          </h2>
          <p className="section__lead">
            A can of soda on a shelf and a bottle of shampoo in a drugstore aisle are legal claims
            on a public company's future cash flows, and nobody standing there thinks about them
            that way.
          </p>
          <p className="section__lead">
            Mapvest removes the packaging. Point the camera at the object and what comes back
            isn't the product — it's the company behind it, priced, charted, and sourced.
            Public brand: the ticker. Private brand: the closest public comparable and an ETF that
            actually holds it. Every find is kept in your universe. Every result travels with
            evidence.
          </p>
          <p className="section__lead">
            Mapvest identifies. Mapvest does not recommend. Not advice — evidence.
          </p>
        </Reveal>
      </section>

      <section className="shots" aria-labelledby="shots-title">
        <Reveal className="container">
          <div className="section__eyebrow">The app</div>
          <h2 id="shots-title" className="section__title">
            Point at something. Read the brief. Build a universe.
          </h2>
          <p className="section__lead">
            The iPhone app is the product. Every identify is kept as a find — your universe grows as
            you move through the world. The brief writes itself. The tape shows up when you're ready
            to decide. Nothing on the card is unsourced.
          </p>
        </Reveal>

        <section className="shots__scroller" aria-label="Screenshot gallery — scroll horizontally">
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
        </section>
      </section>

      <section className="section container" aria-labelledby="how-title">
        <Reveal>
          <div className="section__eyebrow">The loop</div>
          <h2 id="how-title" className="section__title">
            Capture → identify → confidence → evidence.
          </h2>
          <p className="section__lead">
            Point at it. The world becomes a ticker or a comparable, and it comes back with a
            confidence level and an evidence card. Then comps, news, and a brief on the neighborhood
            the object was found in. Evidence travels with every result. Nothing on the card is
            unsourced.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <HowItWorksDiagram />
        </Reveal>

        <div className="hero__ctas" style={{ justifyContent: "flex-start", marginTop: 28 }}>
          <a className="btn btn--ghost" href="/docs">
            Read the docs →
          </a>
        </div>
      </section>
    </>
  );
}
