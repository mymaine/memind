/**
 * Vitest config for the web app.
 *
 * esbuild `jsx: 'automatic'` tells vitest to use the React 17+ JSX transform
 * so `.tsx` test files (and component sources imported from them) do not
 * need to explicitly `import * as React from 'react'`. Next.js handles this
 * automatically in the app build; vitest runs outside Next so we mirror the
 * setting here.
 *
 * `resolve.alias` mirrors the `@/*` path alias declared in tsconfig.json +
 * the Next.js webpack config. Component sources use `@/...` imports to
 * satisfy Next's webpack resolver; without mirroring the alias here,
 * vitest would fail to resolve them when a test pulls a component that
 * imports through the alias.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
