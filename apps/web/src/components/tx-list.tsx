import type { TxRef } from '@hack-fourmeme/shared';

const chainColor: Record<TxRef['chain'], string> = {
  'bsc-testnet': 'var(--color-chain-bnb)',
  'base-sepolia': 'var(--color-chain-base)',
  ipfs: 'var(--color-chain-ipfs)',
};

const chainLabel: Record<TxRef['chain'], string> = {
  'bsc-testnet': 'BSC',
  'base-sepolia': 'BASE',
  ipfs: 'IPFS',
};

export function TxList({ txs = [] }: { txs?: TxRef[] }) {
  return (
    <section
      aria-label="On-chain artifacts"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border-default bg-bg-surface p-6"
    >
      <header className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">
          On-chain artifacts
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          {txs.length} / 5
        </span>
      </header>
      {txs.length === 0 ? (
        <p className="text-[14px] text-fg-secondary">No artifacts yet — run a swarm to populate.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {txs.map((tx) => (
            <li key={`${tx.chain}-${tx.hash}`}>
              <a
                href={tx.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-full border bg-bg-surface px-3 py-1 font-[family-name:var(--font-mono)] text-[12px] text-fg-primary transition-[filter] duration-150 hover:[filter:drop-shadow(0_0_4px_currentColor)]"
                style={{ borderColor: chainColor[tx.chain], color: chainColor[tx.chain] }}
              >
                <span>{chainLabel[tx.chain]}</span>
                <span className="text-fg-primary">
                  {tx.hash.slice(0, 6)}…{tx.hash.slice(-4)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
