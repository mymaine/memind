import type { AgentId, AgentStatus } from '@hack-fourmeme/shared';
import { cn } from '@/lib/cn';

const AGENTS: { id: Exclude<AgentId, 'heartbeat'>; label: string }[] = [
  { id: 'creator', label: 'creator' },
  { id: 'narrator', label: 'narrator' },
  { id: 'market-maker', label: 'market-maker' },
];

const statusDotClass: Record<AgentStatus, string> = {
  idle: 'bg-fg-tertiary',
  running: 'bg-accent',
  done: 'bg-[color:var(--color-success)]',
  error: 'bg-[color:var(--color-danger)]',
};

/**
 * Border treatment by status (docs/design.md §4 "Agent Status Bar" + §6):
 *   running → 2px accent emerald (Level 3 Accent)
 *   done    → 1px success emerald
 *   error   → 1px danger coral
 *   idle    → 1px warm charcoal (default)
 */
function borderClass(status: AgentStatus): string {
  if (status === 'running') return 'border-2 border-accent';
  if (status === 'done') return 'border border-[color:var(--color-success)]';
  if (status === 'error') return 'border border-[color:var(--color-danger)]';
  return 'border border-border-default';
}

export function AgentStatusBar({ statuses }: { statuses: Record<AgentId, AgentStatus> }) {
  return (
    <section aria-label="Agent status" className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {AGENTS.map((a) => {
        const status = statuses[a.id];
        const isRunning = status === 'running';
        return (
          <div
            key={a.id}
            className={cn(
              'rounded-[var(--radius-card)] bg-bg-surface p-6 transition-[border-color,border-width] duration-150',
              borderClass(status),
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-[family-name:var(--font-sans-display)] text-[20px] font-semibold text-fg-primary">
                {a.label}
              </span>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn('h-2 w-2 rounded-full', statusDotClass[status])}
                  style={isRunning ? { animation: 'signal-pulse 1500ms ease-in-out infinite' } : {}}
                />
                <span
                  aria-label={`status: ${status}`}
                  className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary"
                >
                  {status}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
