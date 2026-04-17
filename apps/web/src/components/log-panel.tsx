import type { LogEvent } from '@hack-fourmeme/shared';

const PLACEHOLDER: LogEvent[] = [
  {
    ts: new Date().toISOString(),
    agent: 'creator',
    tool: 'runtime.boot',
    level: 'info',
    message: 'waiting for theme input…',
  },
];

export function LogPanel({ logs = PLACEHOLDER }: { logs?: LogEvent[] }) {
  return (
    <section
      aria-label="Agent log stream"
      className="rounded-[var(--radius-card)] border border-border-default bg-bg-primary p-4"
    >
      <header className="mb-3 flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-[0.5px] text-fg-tertiary">Log stream</span>
        <span className="font-[family-name:var(--font-mono)] text-[12px] text-fg-tertiary">
          SSE · {logs.length} events
        </span>
      </header>
      <ol className="max-h-[60vh] space-y-1 overflow-y-auto font-[family-name:var(--font-mono)] text-[13px] leading-[1.5]">
        {logs.map((e, i) => (
          <li key={`${e.ts}-${i}`} className="flex gap-3">
            <span className="shrink-0 text-fg-tertiary">{e.ts.slice(11, 19)}</span>
            <span className="shrink-0 text-accent-text">{e.agent}.</span>
            <span className="shrink-0 text-fg-secondary">{e.tool}</span>
            <span className="text-fg-primary">{e.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
