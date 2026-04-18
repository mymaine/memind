/**
 * Vitest config for the web app.
 *
 * esbuild `jsx: 'automatic'` tells vitest to use the React 17+ JSX transform
 * so `.tsx` test files (and component sources imported from them) do not
 * need to explicitly `import * as React from 'react'`. Next.js handles this
 * automatically in the app build; vitest runs outside Next so we mirror the
 * setting here.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
