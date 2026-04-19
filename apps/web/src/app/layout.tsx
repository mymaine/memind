import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Header } from '@/components/header';
import { BrainStatusBar } from '@/components/brain-status-bar';
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
        <Header />
        {/*
         * BrainStatusBar mounts in the root layout so the Brain is visible on
         * every route (decisions/2026-04-19-brain-agent-positioning.md §Scope
         * explicitly forbids a dedicated /brain route). The bar + click-to-open
         * modal is the entire "Brain is here" surface.
         *
         * It currently renders with no runState (idle). Threading the per-page
         * useRun() state in would require a RunStateContext provider — deferred
         * per the V4.7-P4 brief's "do not refactor useRun" guardrail.
         */}
        <BrainStatusBar />
        {children}
      </body>
    </html>
  );
}
