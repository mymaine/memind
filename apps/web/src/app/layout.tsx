import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactElement, ReactNode } from 'react';
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
  title: 'MEMIND — meme × mind · chat-to-launch on four.meme',
  description:
    'Give every meme coin a brain and a wallet. Launch via chat on four.meme, order shill tweets for 0.01 USDC over x402, and watch an autonomous heartbeat keep the token alive.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        {/*
         * <RunStateProvider /> hoists the run-state context above the routed
         * <main> (children). Each page publishes its `useRun()` state via
         * `usePublishRunState(state)`; consumers (TopBar <BrainIndicator />
         * etc.) subscribe via `useRunState()`. Routes without a useRun
         * instance (e.g. /demo/glyph) leave the context at IDLE_STATE.
         *
         * The <Header /> TopBar mount moved from layout.tsx into page.tsx in
         * memind-scrollytelling-rebuild AC-MSR-3 — the new TopBar needs live
         * activeIdx / progress props from the StickyStage engine, which are
         * only available inside the route component.
         *
         * The P0 rebuild removed the legacy ASCII backdrop layer entirely
         * (component + CSS). The sticky-viewport radial-gradient now owns the
         * background treatment alone.
         */}
        <RunStateProvider>{children}</RunStateProvider>
      </body>
    </html>
  );
}
