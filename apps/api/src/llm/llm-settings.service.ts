import { findLlmModel, LLM_MODEL_CATALOG, LLM_PROVIDERS, type LlmProvider } from '@myfinpro/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_ERRORS } from './constants/llm-errors';
import { LlmCredentialsService, type LlmCredentialHint } from './llm-credentials.service';
import { PrismaService } from '../prisma/prisma.service';

/** Deployment-level ("shared") API key env var per provider. */
export const LLM_SHARED_KEY_ENV: Record<LlmProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export interface LlmSelection {
  provider: string;
  model: string;
}

export interface LlmCatalogResponse {
  models: Array<{ provider: LlmProvider; id: string; label: string; available: boolean }>;
  /** null = deployment default provider decides. */
  selection: LlmSelection | null;
  /** Hint-only credential rows (§9.4 layer 2). */
  credentials: LlmCredentialHint[];
  /** Providers usable without a personal key (deployment key present). */
  sharedProviders: LlmProvider[];
}

/**
 * Phase 8.11 — model catalog + per-user selection (runbook §9.1–§9.3).
 * A model is "available" to a user when its provider has a deployment key
 * or the user stored their own; selection of an unavailable model is
 * rejected here rather than surfacing later as a failed extraction.
 */
@Injectable()
export class LlmSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly credentialsService: LlmCredentialsService,
  ) {}

  sharedProviders(): LlmProvider[] {
    return LLM_PROVIDERS.filter((p) => !!this.configService.get<string>(LLM_SHARED_KEY_ENV[p]));
  }

  async getCatalog(userId: string): Promise<LlmCatalogResponse> {
    const [user, credentials] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { llmProvider: true, llmModel: true },
      }),
      this.credentialsService.listCredentials(userId),
    ]);
    const shared = this.sharedProviders();
    const usable = new Set<string>([...shared, ...credentials.map((c) => c.provider)]);
    return {
      models: LLM_MODEL_CATALOG.map((m) => ({ ...m, available: usable.has(m.provider) })),
      selection:
        user.llmProvider && user.llmModel
          ? { provider: user.llmProvider, model: user.llmModel }
          : null,
      credentials,
      sharedProviders: shared,
    };
  }

  /** Sets or clears (both nulls) the user's model selection. */
  async updateSelection(
    userId: string,
    provider: string | null,
    model: string | null,
  ): Promise<LlmSelection | null> {
    if ((provider === null) !== (model === null)) {
      throw new BadRequestException({
        message: 'provider and model must be set together or both be null',
        errorCode: LLM_ERRORS.LLM_INVALID_MODEL,
      });
    }
    if (provider !== null && model !== null) {
      const entry = findLlmModel(provider, model);
      if (!entry) {
        throw new BadRequestException({
          message: 'Unknown provider/model combination',
          errorCode: LLM_ERRORS.LLM_INVALID_MODEL,
        });
      }
      const hasUserKey = await this.prisma.userLlmCredential.count({
        where: { userId, provider },
      });
      if (!hasUserKey && !this.sharedProviders().includes(entry.provider)) {
        throw new BadRequestException({
          message: 'Add an API key for this provider first',
          errorCode: LLM_ERRORS.LLM_PROVIDER_UNAVAILABLE,
        });
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { llmProvider: provider, llmModel: model },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LLM_SELECTION_UPDATED',
        entity: 'User',
        entityId: userId,
        details: provider && model ? { provider, model } : { cleared: true },
      },
    });
    return provider && model ? { provider, model } : null;
  }
}
