import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
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
  title: 'Agent Swarm · Four.Meme',
  description:
    'First agent-to-agent commerce demo on Four.Meme Agentic Mode — Creator, Narrator, Market-maker cooperate via x402.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
