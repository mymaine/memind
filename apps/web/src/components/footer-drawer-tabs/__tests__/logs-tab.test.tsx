/**
 * Tests for `<LogsTab />` (P0-14 / FooterDrawer Developer Logs tab).
 *
 * Static-markup tests in the node env. Coverage:
 *   - Empty state copy when `logs` is empty.
 *   - Three-row render with correct column values.
 *   - Level-based `log-<level>` class is applied to each row.
 *   - `agent.tool` source format (with `.` separator).
 *   - `formatLogTs` ISO → HH:MM:SS.mmm helper pure-function check.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogEvent } from '@hack-fourmeme/shared';
import { LogsTab, formatLogTs } from '../logs-tab.js';

const FIXTURE_LOGS: LogEvent[] = [
  {
    ts: '2026-04-20T14:52:08.212Z',
    agent: 'brain',
    tool: 'tick',
    level: 'info',
    message: 'heartbeat t+60s',
  },
  {
    ts: '2026-04-20T14:52:10.121Z',
    agent: 'creator',
    tool: 'pinata_upload',
    level: 'warn',
    message: 'pinata slow response',
  },
  {
    ts: '2026-04-20T14:52:11.412Z',
    agent: 'narrator',
    tool: 'write_chapter',
    level: 'error',
    message: 'lore schema mismatch',
  },
];

describe('<LogsTab />', () => {
  it('renders the empty-state copy when there are no logs', () => {
    const out = renderToStaticMarkup(<LogsTab logs={[]} />);
    expect(out).toContain('awaiting run');
    // Empty state does not render the column headers or log rows.
    expect(out).not.toContain('logs-head');
    expect(out).not.toContain('log-row');
  });

  it('renders a row per log event with formatted ts / level / source / message', () => {
    const out = renderToStaticMarkup(<LogsTab logs={FIXTURE_LOGS} />);
    // One `log-row` per fixture entry.
    const rowMatches = out.match(/class="log-row /g) ?? [];
    expect(rowMatches.length).toBe(FIXTURE_LOGS.length);
    // Each formatted ts substring should appear.
    expect(out).toContain('14:52:08.212');
    expect(out).toContain('14:52:10.121');
    expect(out).toContain('14:52:11.412');
    // Level uppercased.
    expect(out).toContain('INFO');
    expect(out).toContain('WARN');
    expect(out).toContain('ERROR');
    // Message verbatim.
    expect(out).toContain('heartbeat t+60s');
    expect(out).toContain('lore schema mismatch');
  });

  it('applies the `log-<level>` class per row based on LogEvent.level', () => {
    const out = renderToStaticMarkup(<LogsTab logs={FIXTURE_LOGS} />);
    expect(out).toMatch(/class="log-row log-info"/);
    expect(out).toMatch(/class="log-row log-warn"/);
    expect(out).toMatch(/class="log-row log-error"/);
  });

  it('renders the source as `${agent}.${tool}` when tool is populated', () => {
    const out = renderToStaticMarkup(<LogsTab logs={FIXTURE_LOGS} />);
    expect(out).toContain('brain.tick');
    expect(out).toContain('creator.pinata_upload');
    expect(out).toContain('narrator.write_chapter');
  });

  it('falls back to just the agent name when tool is empty', () => {
    const logs: LogEvent[] = [
      {
        ts: '2026-04-20T14:52:08.212Z',
        agent: 'brain',
        tool: '',
        level: 'info',
        message: 'bootstrapping',
      },
    ];
    const out = renderToStaticMarkup(<LogsTab logs={logs} />);
    // `brain` should appear without a trailing `.` in the source column.
    expect(out).toMatch(/>brain</);
    expect(out).not.toContain('brain.');
  });

  it('formatLogTs extracts HH:MM:SS.mmm from an ISO datetime', () => {
    expect(formatLogTs('2026-04-20T14:52:08.212Z')).toBe('14:52:08.212');
    expect(formatLogTs('2026-04-20T14:52:08Z')).toBe('14:52:08.000');
    // Non-ISO input falls through verbatim.
    expect(formatLogTs('whatever')).toBe('whatever');
  });
});
