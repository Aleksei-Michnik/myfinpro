import { LLM_API_KEY_PATTERNS, type LlmProvider } from '@myfinpro/shared';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_ERRORS } from './constants/llm-errors';
import {
  decryptLlmSecret,
  encryptLlmSecret,
  llmKeyHint,
  parseLlmMasterKey,
} from './llm-crypto.util';
import { PrismaService } from '../prisma/prisma.service';

/** What reads are allowed to see — never the key material (§9.4 layer 2). */
export interface LlmCredentialHint {
  provider: string;
  keyHint: string;
  updatedAt: Date;
}

/** Save-time live probe outcome. Only a definite rejection blocks the save. */
type ProbeVerdict = 'valid' | 'invalid' | 'unknown';

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Phase 8.11 — custody of BYOK LLM API keys (runbook §9.4).
 *
 * This service is the single encrypt/decrypt boundary: plaintext keys exist
 * only inside `setCredential` (inbound, validated then encrypted) and
 * `resolveApiKey` (outbound, decrypted at call time for the extraction
 * worker). Everything else — API reads, audit logs, errors — sees at most
 * the provider name and the last-4 hint.
 */
@Injectable()
export class LlmCredentialsService {
  private readonly logger = new Logger(LlmCredentialsService.name);
  private readonly masterKey: Buffer | null;
  private readonly liveValidation: boolean;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.masterKey = parseLlmMasterKey(configService.get<string>('LLM_SECRETS_ENCRYPTION_KEY'));
    if (!this.masterKey) {
      // Fail fast where real user secrets would be at stake; stay bootable in
      // dev/test so the rest of the app doesn't hinge on this feature.
      if (configService.get<string>('NODE_ENV') === 'production') {
        throw new Error('LLM_SECRETS_ENCRYPTION_KEY is required in production (runbook §9.5)');
      }
      this.logger.warn('LLM_SECRETS_ENCRYPTION_KEY not set — BYOK key storage is disabled');
    }
    this.liveValidation = configService.get<string>('LLM_KEY_LIVE_VALIDATION', 'true') !== 'false';
  }

  get storageConfigured(): boolean {
    return this.masterKey !== null;
  }

  /** Validates (shape gate + live probe), encrypts and upserts a user key. */
  async setCredential(
    userId: string,
    provider: LlmProvider,
    apiKey: string,
  ): Promise<LlmCredentialHint> {
    const masterKey = this.requireMasterKey();
    const trimmed = apiKey.trim();
    if (!LLM_API_KEY_PATTERNS[provider].test(trimmed)) {
      throw new BadRequestException({
        message: `That does not look like a valid ${provider} API key`,
        errorCode: LLM_ERRORS.LLM_INVALID_API_KEY,
      });
    }
    if (this.liveValidation && (await this.probeKey(provider, trimmed)) === 'invalid') {
      throw new BadRequestException({
        message: 'The provider rejected this API key',
        errorCode: LLM_ERRORS.LLM_KEY_REJECTED,
      });
    }

    const encryptedValue = encryptLlmSecret(trimmed, masterKey);
    const keyHint = llmKeyHint(trimmed);
    const credential = await this.prisma.userLlmCredential.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, credentialKind: 'api_key', encryptedValue, keyHint },
      update: { encryptedValue, keyHint },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LLM_CREDENTIAL_SET',
        entity: 'UserLlmCredential',
        entityId: credential.id,
        details: { provider, keyHint },
      },
    });
    return { provider, keyHint, updatedAt: credential.updatedAt };
  }

  async listCredentials(userId: string): Promise<LlmCredentialHint[]> {
    return this.prisma.userLlmCredential.findMany({
      where: { userId },
      select: { provider: true, keyHint: true, updatedAt: true },
      orderBy: { provider: 'asc' },
    });
  }

  async deleteCredential(userId: string, provider: LlmProvider): Promise<void> {
    const { count } = await this.prisma.userLlmCredential.deleteMany({
      where: { userId, provider },
    });
    if (count === 0) {
      throw new NotFoundException({
        message: 'No API key stored for this provider',
        errorCode: LLM_ERRORS.LLM_CREDENTIAL_NOT_FOUND,
      });
    }
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LLM_CREDENTIAL_DELETED',
        entity: 'UserLlmCredential',
        entityId: userId,
        details: { provider },
      },
    });
  }

  /** Immediate wipe on account-deletion request (§9.4 layer 7). */
  async deleteAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.userLlmCredential.deleteMany({ where: { userId } });
    if (count > 0) this.logger.log(`Wiped ${count} LLM credential(s) for user ${userId}`);
    return count;
  }

  /**
   * Decrypts a user's key for an outbound provider call. Internal-only —
   * never expose through a controller. Decryption failures (e.g. a lost
   * master key) degrade to null so extraction falls back to the shared key
   * instead of crashing the worker.
   */
  async resolveApiKey(userId: string, provider: LlmProvider): Promise<string | null> {
    if (!this.masterKey) return null;
    const row = await this.prisma.userLlmCredential.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { encryptedValue: true },
    });
    if (!row) return null;
    try {
      return decryptLlmSecret(row.encryptedValue, this.masterKey);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt LLM credential (user=${userId} provider=${provider}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private requireMasterKey(): Buffer {
    if (!this.masterKey) {
      throw new ServiceUnavailableException({
        message: 'API key storage is not configured on this server',
        errorCode: LLM_ERRORS.LLM_STORAGE_UNCONFIGURED,
      });
    }
    return this.masterKey;
  }

  /**
   * Cheapest authenticated call each provider offers (§9.4 layer 5). Only a
   * definite 401/403 rejects the key — network trouble on our side must not
   * lock users out of saving a valid key.
   */
  private async probeKey(provider: LlmProvider, apiKey: string): Promise<ProbeVerdict> {
    const request: { url: string; headers: Record<string, string> } =
      provider === 'anthropic'
        ? {
            url: 'https://api.anthropic.com/v1/models?limit=1',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          }
        : {
            url: 'https://api.openai.com/v1/models',
            headers: { Authorization: `Bearer ${apiKey}` },
          };
    try {
      const res = await fetch(request.url, {
        headers: request.headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) return 'invalid';
      if (res.ok) return 'valid';
      this.logger.warn(`LLM key probe for ${provider} returned ${res.status}; accepting key`);
      return 'unknown';
    } catch (err) {
      this.logger.warn(`LLM key probe for ${provider} failed: ${(err as Error).message}`);
      return 'unknown';
    }
  }
}
