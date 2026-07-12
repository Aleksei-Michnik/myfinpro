import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Phase 8.11 — envelope encryption for BYOK LLM API keys (runbook §9.4
 * layer 1). AES-256-GCM with a random 96-bit IV per write and the auth tag
 * stored alongside, encoded as `v1:<iv>:<tag>:<ciphertext>` (base64). The
 * version prefix lets a future master-key rotation re-encrypt rows
 * incrementally (`v2:` …) without a flag day.
 */

export const LLM_SECRET_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const MASTER_KEY_BYTES = 32;

/** Parses the base64 master key; null when unset, throws when malformed. */
export function parseLlmMasterKey(raw: string | undefined | null): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `LLM_SECRETS_ENCRYPTION_KEY must be ${MASTER_KEY_BYTES} bytes of base64 (openssl rand -base64 32)`,
    );
  }
  return key;
}

export function encryptLlmSecret(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    LLM_SECRET_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    data.toString('base64'),
  ].join(':');
}

/** Throws on unknown version, malformed encoding, or GCM tag mismatch. */
export function decryptLlmSecret(encoded: string, masterKey: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = encoded.split(':');
  if (version !== LLM_SECRET_VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error(`Unsupported LLM secret encoding (version=${version || 'none'})`);
  }
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** The only readable trace of a stored key — its last 4 characters. */
export function llmKeyHint(apiKey: string): string {
  return apiKey.slice(-4);
}
