import { TESTFLIGHT_URL } from "@/lib/site";
import { type ApiState, probeApiSafe } from "@/lib/status";
import type { Metadata } from "next";
import { CopyableCurl } from "./CopyableCurl";
import { HeroBackdrop } from "./HeroBackdrop";
import { HowItWorksDiagram } from "./HowItWorksDiagram";
import { Reveal } from "./Reveal";

export const metadata: Metadata = {
  title: "See a brand. Get the ticker.",
};

const API_BASE_URL = "https://api-production-4b27.up.railway.app";

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
    title: "Identify anything around you",
    body: "Camera or map. Public brand → the ticker. Private → the closest public comparable and an ETF with real exposure. That’s how you build an investable universe out of the world.",
  },
  {
    icon: <IconResearch />,
    title: "Agentic local research",
    body: "Once a place or photo has an identity, research the company — or the local economy around it. Regional quirks that make a street better or worse for a business show up in the brief.",
  },
  {
    icon: <IconChat />,
    title: "Finance agent, briefs, chats",
    body: "A finance agent with tools writes memos on names you care about. Save chats. Chat about / Chat with a ticker from the map and everywhere else.",
  },
  {
    icon: <IconChart />,
    title: "Analytics that inform a position",
    body: "Charts and modules for trends and levels — so you can think about how and why to own, trade, or structure a position around the asset. Not just a name on a card.",
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
      "One tap, one link. Magic-link email — no passwords, no OAuth carousel — gets you into the alpha.",
  },
  {
    key: "map",
    label: "Map view",
    src: "/screenshots/map.svg",
    alt: "Mapvest map view — five public brand pins and two private-brand comparables around a selected Hershey’s location",
    caption:
      "Pin the world. Green pins are public tickers; orange pins are private brands resolved to comparables.",
  },
  {
    key: "camera",
    label: "Camera",
    src: "/screenshots/camera.svg",
    alt: "Mapvest camera view — a Hershey’s bar is identified and returned as HSY $179.04 +0.77%",
    caption:
      "Point at a shelf. Multimodal vision resolves the brand and returns the ticker with confidence and sources.",
  },
  {
    key: "detail",
    label: "Detail sheet",
    src: "/screenshots/detail.svg",
    alt: "Hershey Company detail sheet — three comparables, four ETFs, and source citations",
    caption:
      "HSY header, sector, three comparables, four ETFs with weights, and the sources that produced every number.",
  },
] as const;

// Map an API state to a badge label. Landing is always "up" from the
// perspective of anyone who can read this page.
function stateLabel(state: ApiState, upWord = "live"): string {
  if (state === "up") return upWord;
  if (state === "down") return "down";
  return "unknown";
}

export default async function HomePage() {
  // Build-time probe. probeApiSafe never throws — the worst case is
  // { api: "down" } or { api: "unknown" } and we render accordingly.
  const status = await probeApiSafe();
  const apiState: ApiState = status.api;
  const apiBadgeLabel =
    apiState === "up" ? "API: live" : apiState === "down" ? "API: down" : "API: unknown";

  const curlHealth = `curl -sS ${API_BASE_URL}/v1/health`;
  const curlNearby = `curl -sS "${API_BASE_URL}/v1/nearby?lat=37.7749&lng=-122.4194&radius_m=500"`;
  const curlResolve = `curl -sS -X POST "${API_BASE_URL}/v1/resolve-comparable" \\
  -H 'content-type: application/json' \\
  -d '{"brand":"Lindt","country":"CH"}'`;

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
            Identify what’s around you. Research the company or the local economy. Get a brief.
            Read the charts. Then decide whether you want to own or trade it.
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
              Open in browser
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

      <section className="shots" aria-labelledby="shots-title">
        <Reveal className="container">
          <div className="section__eyebrow">Screenshots</div>
          <h2 id="shots-title" className="section__title">
            Log in. Learn what’s around you. Build a universe from it.
          </h2>
          <p className="section__lead">
            The iPhone app is the product. Identify a place or a photo, then research, brief, and
            chart the name — every ticker and comparable comes back with sources.
          </p>
        </Reveal>

        <div
          className="shots__scroller"
          role="region"
          aria-label="Screenshot gallery — scroll horizontally"
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
        <Reveal>
          <div className="section__eyebrow">How it works</div>
          <h2 id="how-title" className="section__title">
            From a place or a photo to a decision.
          </h2>
          <p className="section__lead">
            See what’s around you and turn it into an investable universe. Research the company or
            the local economy, get a brief, then look at the charts before you decide whether to own
            or trade it. Sources stay on the card.
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

      {/* Hidden for now — visitors don't need curl samples on the marketing page. */}
      <section
        hidden
        className="section container"
        aria-labelledby="api-playground-title"
        aria-hidden="true"
      >
        <Reveal>
          <div className="section__eyebrow">API playground</div>
          <h2 id="api-playground-title" className="section__title">
            Copy. Paste. Get sourced answers.
          </h2>
          <p className="section__lead">
            The API is live at <code>{API_BASE_URL}</code>. Three requests are enough to feel the
            product — health, nearby brands, and a comparable resolver.
          </p>

          <div className="curl-stack">
            <CopyableCurl label="health" path="/v1/health" command={curlHealth} />
            <CopyableCurl label="nearby" path="/v1/nearby" command={curlNearby} />
            <CopyableCurl label="resolve" path="/v1/resolve-comparable" command={curlResolve} />
          </div>
        </Reveal>
      </section>

      {/* Hidden for now — visitors don't need infra status on the marketing page. */}
      <section
        hidden
        className="section container"
        aria-labelledby="status-title"
        aria-hidden="true"
      >
        <Reveal>
          <div className="section__eyebrow">System status</div>
          <h2 id="status-title" className="section__title">
            What’s up right now.
          </h2>
          <p className="section__lead">
            Probed at build time from this static page. For live status hit <code>/api/status</code>
            .
          </p>

          <ul className="status-list">
            <li className={`status-row status-row--${apiState}`}>
              <span className={`status-dot status-dot--${apiState}`} aria-hidden="true" />
              <span className="status-row__name">api</span>
              <code className="status-row__host">{API_BASE_URL.replace(/^https?:\/\//, "")}</code>
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
            Last checked <time dateTime={status.checkedAt}>{status.checkedAt}</time>.
          </p>
        </Reveal>
      </section>
    </>
  );
}
