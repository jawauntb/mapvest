import { TESTFLIGHT_URL } from "@/lib/site";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

const SITE_NAME = "Mapvest";
const SITE_DESCRIPTION =
  "See a brand. Get the ticker. Then research the company, the local economy, and the charts — so you can decide whether to own or trade it.";
const SITE_URL = "https://mapvest.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — See a brand. Get the ticker.`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "investing",
    "map",
    "tickers",
    "ETFs",
    "brands",
    "comparables",
    "consumer investing",
    "mapvest",
  ],
  authors: [{ name: "Mapvest" }],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — See a brand. Get the ticker.`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og.svg",
        width: 1200,
        height: 630,
        type: "image/svg+xml",
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — See a brand. Get the ticker.`,
    description: SITE_DESCRIPTION,
    images: ["/og.svg"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0E10",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body
        style={
          {
            ["--mv-font-display" as string]: "var(--font-syne), Syne, sans-serif",
            ["--mv-font-sans" as string]: "var(--font-plex), 'IBM Plex Sans', sans-serif",
            ["--mv-font-mono" as string]: "var(--font-plex-mono), 'IBM Plex Mono', monospace",
            ["--font-display" as string]: "var(--mv-font-display)",
            ["--font-sans" as string]: "var(--mv-font-sans)",
            ["--font-mono" as string]: "var(--mv-font-mono)",
          } as React.CSSProperties
        }
      >
        <header className="site-header">
          <div className="container site-header__inner">
            <a href="/" className="brand" aria-label="Mapvest home">
              <img
                className="brand__mark"
                src="/brand/mark.svg"
                alt=""
                width={28}
                height={28}
              />
              mapvest
            </a>
            <nav className="nav" aria-label="Primary">
              <a href="/app">Web preview</a>
              <a href="/docs">Docs</a>
              <a
                href="https://github.com/jawauntb/mapvest"
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
              <a
                className="btn btn--primary"
                href={TESTFLIGHT_URL}
                target="_blank"
                rel="noreferrer noopener"
                style={{ padding: "8px 14px", fontSize: 13 }}
              >
                Get TestFlight
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container site-footer__inner">
            <div>&copy; {new Date().getFullYear()} Mapvest. Not investment advice.</div>
            <div style={{ display: "flex", gap: 16 }}>
              <a href="/docs">Docs</a>
              <a
                href="https://github.com/jawauntb/mapvest"
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
