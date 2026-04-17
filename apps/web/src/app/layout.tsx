import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Swarm · Four.Meme',
  description:
    'First agent-to-agent commerce demo on Four.Meme Agentic Mode — Creator, Narrator, Market-maker cooperate via x402.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
