import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { AsciiBackdrop } from '@/components/ascii-backdrop';
import { Header } from '@/components/header';
import { RunStateProvider } from '@/hooks/useRunStateContext';
import './globals.css';

// Inter drives `--font-sans-body` (design.md §3); system-ui already backs
// `--font-sans-display` via globals.css so we only need Inter + JetBrains Mono.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans-body',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Shilling Market on Four.meme',
  description:
    'Shilling Market — a creator-to-agent promotion service on four.meme, paid over x402. Creator pays 0.01 USDC; an AI shiller posts a promotional tweet from its own aged X account.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        {/*
         * <RunStateProvider /> hoists the run-state context above both the
         * <Header /> (which now hosts the <BrainIndicator />) and the routed
         * <main> (children). Each page publishes its `useRun()` state via
         * `usePublishRunState(state)`; the indicator subscribes via
         * `useRunState()`. Routes without a useRun instance (e.g. /demo/glyph)
         * leave the context at IDLE_STATE, and the indicator stays `idle`.
         *
         * The old independent <BrainStatusBar /> strip was retired in
         * immersive-single-page P1 Task 3 / AC-ISP-6 — the Brain surface
         * now lives inside the Header alongside the nav.
         */}
        {/*
         * <AsciiBackdrop /> is the fixed-position atmospheric layer
         * (immersive-single-page P2 Task 1 / AC-ISP-8). It renders once at
         * the top of <body> with `z-index: -1` + `pointer-events: none` so
         * no UI layer (Header, Drawer, Toast, modals) is ever occluded and
         * no click is intercepted. Mount order relative to the context
         * provider does not matter — the backdrop is self-contained.
         */}
        <AsciiBackdrop />
        <RunStateProvider>
          <Header />
          {children}
        </RunStateProvider>
      </body>
    </html>
  );
}
