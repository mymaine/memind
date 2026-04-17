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

  it('provides Phase 3 defaults for BSC RPC and heartbeat interval', () => {
    const original = { ...process.env };
    process.env = {};
    const cfg = loadConfig();
    expect(cfg.bsc.rpcUrl).toBe('https://bsc-dataseed.binance.org');
    expect(cfg.heartbeat.intervalMs).toBe(60_000);
    process.env = original;
  });

  it('accepts HEARTBEAT_INTERVAL_MS override and surfaces X API credentials', () => {
    const original = { ...process.env };
    process.env = {
      HEARTBEAT_INTERVAL_MS: '15000',
      X_API_KEY: 'key-abc',
      X_API_KEY_SECRET: 'secret-abc',
      X_ACCESS_TOKEN: 'token-abc',
      X_ACCESS_TOKEN_SECRET: 'token-secret-abc',
      X_BEARER_TOKEN: 'bearer-abc',
      X_HANDLE: 'agent_handle',
    };
    const cfg = loadConfig();
    expect(cfg.heartbeat.intervalMs).toBe(15_000);
    expect(cfg.x.apiKey).toBe('key-abc');
    expect(cfg.x.apiKeySecret).toBe('secret-abc');
    expect(cfg.x.accessToken).toBe('token-abc');
    expect(cfg.x.accessTokenSecret).toBe('token-secret-abc');
    expect(cfg.x.bearerToken).toBe('bearer-abc');
    expect(cfg.x.handle).toBe('agent_handle');
    process.env = original;
  });

  it('returns undefined X API fields when env is empty', () => {
    const original = { ...process.env };
    process.env = {
      X_API_KEY: '',
      X_ACCESS_TOKEN: '',
    };
    const cfg = loadConfig();
    expect(cfg.x.apiKey).toBeUndefined();
    expect(cfg.x.accessToken).toBeUndefined();
    expect(cfg.x.handle).toBeUndefined();
    process.env = original;
  });

  it('surfaces OPENROUTER_API_KEY via config.openrouter.apiKey', () => {
    const original = { ...process.env };
    process.env = { OPENROUTER_API_KEY: 'sk-or-abc' };
    const cfg = loadConfig();
    expect(cfg.openrouter.apiKey).toBe('sk-or-abc');
    // Anthropic slot should remain independent when ANTHROPIC_API_KEY is unset.
    expect(cfg.anthropic.apiKey).toBeUndefined();
    process.env = original;
  });

  it('leaves both openrouter.apiKey and anthropic.apiKey undefined when neither env var is set', () => {
    const original = { ...process.env };
    process.env = {};
    const cfg = loadConfig();
    expect(cfg.openrouter.apiKey).toBeUndefined();
    expect(cfg.anthropic.apiKey).toBeUndefined();
    process.env = original;
  });
});
