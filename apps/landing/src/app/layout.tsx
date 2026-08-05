import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_NAME = 'Mapvest';
const SITE_DESCRIPTION =
  'Point at a place. See what’s investable. Mapvest turns storefronts and shelves into tickers, comparables, and ETF exposure.';
const SITE_URL = 'https://mapvest.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Point at a place. See what’s investable.`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'investing',
    'map',
    'tickers',
    'ETFs',
    'brands',
    'comparables',
    'consumer investing',
    'mapvest',
  ],
  authors: [{ name: 'Mapvest' }],
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Point at a place. See what’s investable.`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: '/og.svg',
        width: 1200,
        height: 630,
        type: 'image/svg+xml',
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Point at a place. See what’s investable.`,
    description: SITE_DESCRIPTION,
    images: ['/og.svg'],
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container site-header__inner">
            <a href="/" className="brand" aria-label="Mapvest home">
              <span className="brand__dot" aria-hidden="true" />
              mapvest
            </a>
            <nav className="nav" aria-label="Primary">
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
                href="https://testflight.apple.com/join/PLACEHOLDER"
                target="_blank"
                rel="noreferrer noopener"
                style={{ padding: '8px 14px', fontSize: 13 }}
              >
                TestFlight
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container site-footer__inner">
            <div>
              &copy; {new Date().getFullYear()} Mapvest. Not investment advice.
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
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
