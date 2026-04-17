import { describe, it, expect } from 'vitest';
import { createRequestSchema, txRefSchema } from './schema.js';

describe('createRequestSchema', () => {
  it('accepts a valid theme string', () => {
    const result = createRequestSchema.safeParse({ theme: 'a meme for BNB Chain 2026' });
    expect(result.success).toBe(true);
  });

  it('rejects a theme shorter than 3 characters', () => {
    const result = createRequestSchema.safeParse({ theme: 'hi' });
    expect(result.success).toBe(false);
  });
});

describe('txRefSchema', () => {
  it('accepts valid BSC testnet tx ref', () => {
    const result = txRefSchema.safeParse({
      chain: 'bsc-testnet',
      hash: '0xabcdef',
      explorerUrl: 'https://testnet.bscscan.com/tx/0xabcdef',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown chain value', () => {
    const result = txRefSchema.safeParse({
      chain: 'mainnet',
      hash: '0xabc',
      explorerUrl: 'https://example.com/tx/0xabc',
    });
    expect(result.success).toBe(false);
  });
});
