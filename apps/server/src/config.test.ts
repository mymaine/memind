import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('parses defaults when required env absent', () => {
    const original = { ...process.env };
    process.env = { SERVER_PORT: '4000' };
    const cfg = loadConfig();
    expect(cfg.port).toBe(4000);
    expect(cfg.x402.network).toBe('eip155:84532');
    process.env = original;
  });
});
