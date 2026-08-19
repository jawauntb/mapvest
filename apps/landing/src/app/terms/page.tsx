import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Mapvest",
  description: "Terms governing your use of Mapvest — plain language, no dark patterns.",
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "August 18, 2026";
const CONTACT = "jawaun.brown95@gmail.com";

export default function Terms() {
  return (
    <main className="legal">
      <article className="legal__inner">
        <p className="legal__eyebrow">Mapvest — Terms of Service</p>
        <h1 className="legal__title">Terms of Service</h1>
        <p className="legal__meta">Last updated: {LAST_UPDATED}</p>

        <section>
          <h2>Acceptance</h2>
          <p>
            By using Mapvest ("the Service") you agree to these Terms. If you do not agree, do not
            use the Service.
          </p>
        </section>

        <section>
          <h2>What Mapvest is</h2>
          <p>
            Mapvest is a research and identification tool. It identifies brands you see in the world
            and maps them to publicly traded tickers, private comparables, and ETF exposure. It is
            not a brokerage. It does not custody funds. It does not place orders on your behalf. All
            identifications, briefs, backtests, and movers are informational and are not investment
            advice.
          </p>
        </section>

        <section>
          <h2>Your account</h2>
          <p>
            Sign-in is optional. If you sign in, you are responsible for keeping your email address
            current and for the security of the device that holds your session. If you connect a
            Robinhood MCP token, you are responsible for its scope and for revoking it if your
            device is lost.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>Don&rsquo;t:</p>
          <ul>
            <li>Attempt to scrape, mirror, or resell the Service.</li>
            <li>Bypass rate limits or usage quotas.</li>
            <li>Upload images of real people to be identified without their consent.</li>
            <li>Use the Service to violate any law.</li>
            <li>
              Rely on Mapvest&rsquo;s output as investment advice or as a substitute for the
              disclosures brokerages provide.
            </li>
          </ul>
        </section>

        <section>
          <h2>No investment advice</h2>
          <p>
            <strong>
              Everything Mapvest shows is informational and is not investment advice, a
              recommendation, a solicitation, or an offer to buy or sell any security.
            </strong>{" "}
            Quotes and historical prices are supplied by third parties on a delayed, best-effort
            basis and may be inaccurate. Backtests are hypothetical and past performance is not
            indicative of future results. Consult a licensed financial advisor before making any
            trading decision.
          </p>
        </section>

        <section>
          <h2>Subscriptions</h2>
          <p>
            Browse is free. Identify, research briefs, and memos are limited to 50 lifetime
            generations unless you subscribe to Mapvest Pro ($19.99/month) or we have granted your
            account unlimited use. Map and nearby stay free. A subscription is for research access,
            not a brokerage account and not investment advice. On the web, payment is processed by
            Stripe. On a future App Store or Play listing, in-app purchases will use Apple or Google
            billing as those stores require. Manage or cancel Stripe subscriptions from the billing
            portal in Home; manage native-store subscriptions in App Store or Play settings.
          </p>
        </section>

        <section>
          <h2>Third-party services</h2>
          <p>
            Mapvest sends parts of your requests to third-party processors (Anthropic, OpenRouter,
            Massive, Yahoo Finance, Finnhub, Exa, OpenStreetMap Nominatim, Google Maps, Expo,
            Stripe, Robinhood). Each has its own terms and privacy policy. See the{" "}
            <a href="/privacy">Privacy Policy</a> for the full list and what we send them.
          </p>
        </section>

        <section>
          <h2>Content ownership</h2>
          <p>
            You retain ownership of the text you type and the images you upload. You grant Mapvest a
            limited license to process that content to answer your requests and to persist your
            watchlists, memos, and research threads on your behalf. Mapvest owns the aggregated,
            de-identified statistics we derive to improve the Service.
          </p>
        </section>

        <section>
          <h2>Termination</h2>
          <p>
            You can stop using the Service at any time. You can request deletion of your account and
            data by emailing <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We may suspend accounts
            that violate these Terms.
          </p>
        </section>

        <section>
          <h2>Disclaimers</h2>
          <p>
            The Service is provided <em>as is</em>. To the maximum extent permitted by law, we
            disclaim all warranties, express or implied, including merchantability, fitness for a
            particular purpose, and non-infringement.
          </p>
        </section>

        <section>
          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Mapvest&rsquo;s aggregate liability arising out
            of or relating to the Service will not exceed one hundred U.S. dollars ($100). We are
            not liable for indirect, incidental, consequential, or punitive damages.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p>
            We may update these Terms. The &ldquo;Last updated&rdquo; date at the top always
            reflects the current version. Material changes will be announced in-app or via email.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </p>
        </section>
      </article>
    </main>
  );
}
