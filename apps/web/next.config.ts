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
  // NodeNext ESM rewrites source imports to `./schema.js` etc; webpack
  // doesn't strip the extension back to find `schema.ts`. Map `.js` to the
  // TS source extensions so the shared package resolves in production
  // builds (dev mode masked this).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async rewrites() {
    // Catch-all proxy to the backend. The web app owns no Next API routes,
    // so forwarding everything under `/api/*` keeps endpoints like
    // `/api/artifacts` (Ch12 hydration) reachable without a per-route entry.
    return [
      {
        source: '/api/:path*',
        destination: `${SERVER_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default config;
