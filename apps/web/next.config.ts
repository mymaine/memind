import type { NextConfig } from 'next';

/**
 * Server origin for the Runs API + SSE stream. Defaults to the local server
 * port (4000). We rewrite same-origin `/api/runs/*` so the browser's
 * EventSource hits `window.location.origin` (no CORS preflight) while Next.js
 * transparently proxies to the backend.
 */
const SERVER_ORIGIN = process.env.NEXT_PUBLIC_SERVER_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  // `typedRoutes` was promoted out of `experimental` in Next 15.
  typedRoutes: true,
  transpilePackages: ['@hack-fourmeme/shared'],
  async rewrites() {
    return [
      {
        source: '/api/runs/:path*',
        destination: `${SERVER_ORIGIN}/api/runs/:path*`,
      },
      {
        source: '/api/runs',
        destination: `${SERVER_ORIGIN}/api/runs`,
      },
    ];
  },
};

export default config;
