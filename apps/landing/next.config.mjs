/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Docs are read from ../../docs at build time via fs; Next needs to know
    // that filesystem access is intended.
    outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  },
};

export default nextConfig;
