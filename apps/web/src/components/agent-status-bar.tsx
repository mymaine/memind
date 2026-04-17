import type { AgentId, AgentStatus } from '@hack-fourmeme/shared';
import { cn } from '@/lib/cn';

const AGENTS: { id: AgentId; label: string }[] = [
  { id: 'creator', label: 'creator' },
  { id: 'narrator', label: 'narrator' },
  { id: 'market-maker', label: 'market-maker' },
];

const statusClass: Record<AgentStatus, string> = {
  idle: 'bg-fg-tertiary',
  running: 'bg-accent',
  done: 'bg-[color:var(--color-success)]',
  error: 'bg-[color:var(--color-danger)]',
};

export function AgentStatusBar({
  statuses = { creator: 'idle', narrator: 'idle', 'market-maker': 'idle', heartbeat: 'idle' },
}: {
  statuses?: Record<AgentId, AgentStatus>;
}) {
  return (
    <section aria-label="Agent status" className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {AGENTS.map((a) => {
        const status = statuses[a.id];
        const isRunning = status === 'running';
        return (
          <div
            key={a.id}
            className={cn(
              'rounded-[var(--radius-card)] border bg-bg-surface p-6 transition-[border-color] duration-150',
              isRunning ? 'border-2 border-accent' : 'border border-border-default',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-[family-name:var(--font-sans-display)] text-[20px] font-semibold text-fg-primary">
                {a.label}
              </span>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn('h-2 w-2 rounded-full', statusClass[status])}
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
