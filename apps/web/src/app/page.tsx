import { AgentStatusBar } from '@/components/agent-status-bar';
import { ThemeInput } from '@/components/theme-input';
import { LogPanel } from '@/components/log-panel';
import { TxList } from '@/components/tx-list';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[1280px] flex-col gap-12 px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-full bg-accent"
            style={{ animation: 'signal-pulse 1500ms ease-in-out infinite' }}
          />
          <span className="font-[family-name:var(--font-sans-display)] text-[20px] font-semibold uppercase tracking-[0.5px] text-fg-primary">
            Agent Swarm
          </span>
        </div>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          four.meme × x402 · base-sepolia
        </span>
      </header>

      <section className="flex flex-col gap-4">
        <h1 className="font-[family-name:var(--font-sans-display)] text-[36px] font-normal leading-[1.11] tracking-[-0.9px] text-fg-primary">
          First agent-to-agent commerce
          <span className="text-accent"> on Four.Meme</span>
        </h1>
        <p className="max-w-[640px] text-[16px] leading-[1.5] text-fg-secondary">
          Three agents cooperate: Creator deploys a four.meme token, Narrator writes lore, and
          Market-maker auto-pays USDC via x402 to fetch it. One prompt. Five on-chain artifacts.
        </p>
        <ThemeInput />
      </section>

      <AgentStatusBar />

      <LogPanel />

      <TxList />

      <footer className="border-t border-border-default pt-6 text-[12px] text-fg-tertiary">
        <span className="font-[family-name:var(--font-mono)]">
          Four.Meme AI Sprint · submission 2026-04-22 UTC 15:59
        </span>
      </footer>
    </main>
  );
}
