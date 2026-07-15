import { randomBytes } from 'node:crypto';
import {
  decryptLlmSecret,
  encryptLlmSecret,
  llmKeyHint,
  parseLlmMasterKey,
} from './llm-crypto.util';

describe('llm-crypto.util', () => {
  const key = randomBytes(32);
  const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';

  it('roundtrips a secret through the v1 envelope', () => {
    const encoded = encryptLlmSecret(secret, key);
    expect(encoded).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(encoded).not.toContain(secret);
    expect(decryptLlmSecret(encoded, key)).toBe(secret);
  });

  it('uses a fresh IV per write — same plaintext, different ciphertext', () => {
    expect(encryptLlmSecret(secret, key)).not.toBe(encryptLlmSecret(secret, key));
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const [version, iv, tag, data] = encryptLlmSecret(secret, key).split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, iv, tag, flipped.toString('base64')].join(':');
    expect(() => decryptLlmSecret(tampered, key)).toThrow();
  });

  it('rejects the wrong master key and unknown versions', () => {
    const encoded = encryptLlmSecret(secret, key);
    expect(() => decryptLlmSecret(encoded, randomBytes(32))).toThrow();
    expect(() => decryptLlmSecret(encoded.replace(/^v1:/, 'v9:'), key)).toThrow(/version/i);
    expect(() => decryptLlmSecret('garbage', key)).toThrow(/version/i);
  });

  it('parseLlmMasterKey: null when unset, strict 32-byte check otherwise', () => {
    expect(parseLlmMasterKey(undefined)).toBeNull();
    expect(parseLlmMasterKey('')).toBeNull();
    expect(() => parseLlmMasterKey(Buffer.from('too-short').toString('base64'))).toThrow(
      /32 bytes/,
    );
    expect(parseLlmMasterKey(randomBytes(32).toString('base64'))?.length).toBe(32);
  });

  it('llmKeyHint exposes only the last 4 characters', () => {
    expect(llmKeyHint('sk-ant-api03-abcdEFGH')).toBe('EFGH');
  });
});
