import { createHash } from 'node:crypto';
import { findLlmModel, isLlmProvider } from '@myfinpro/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pickLlmBinding } from '../../llm/llm-binding.util';
import { LlmCredentialsService } from '../../llm/llm-credentials.service';
import { LLM_SHARED_KEY_ENV } from '../../llm/llm-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnthropicExtractionProvider } from './anthropic-extraction.provider';
import {
  ExtractionFailedError,
  RECEIPT_EXTRACTION_PROVIDER,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';
import { OpenAiExtractionProvider } from './openai-extraction.provider';
import { ResilientExtractionProvider } from './resilient-extraction.provider';

export interface ResolvedExtraction {
  provider: ReceiptExtractionProvider;
  /** For logs/audit — never key material (runbook §9.4 layer 4). */
  providerName: string;
  model: string | null;
  keySource: 'user' | 'shared' | 'default';
  /** Why this binding was chosen (audit trail): null = deployment default. */
  bindingSource: 'selection' | 'credential' | null;
}

/** Cached (provider, model, key) instances — keeps breaker state coherent. */
const INSTANCE_CACHE_MAX = 50;

/**
 * Phase 8.11 — picks the extraction provider for a receipt's uploader
 * (runbook §9.3). No selection and no stored key → the deployment default
 * binding. With a binding: the user's own key wins, the deployment ("shared")
 * env key is the fallback, and no key at all is a PERMANENT failure with a
 * settings-facing message — silently billing another key would be worse.
 *
 * 8.11-hotfix: a stored personal key without a selection is itself the
 * binding (`pickLlmBinding`) — it used to be ignored, which ran the
 * deployment default (the mock) on receipts the user expected a real model to
 * read.
 *
 * Keys are resolved at call time (single decrypt boundary in
 * LlmCredentialsService) and never appear on job payloads, logs or errors;
 * cache keys carry only a short digest of the key.
 */
@Injectable()
export class ExtractionResolverService {
  private readonly logger = new Logger(ExtractionResolverService.name);
  private readonly instances = new Map<string, ReceiptExtractionProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly credentialsService: LlmCredentialsService,
    @Inject(RECEIPT_EXTRACTION_PROVIDER)
    private readonly defaultProvider: ReceiptExtractionProvider,
  ) {}

  async resolveForUser(userId: string): Promise<ResolvedExtraction> {
    const [user, credentials] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { llmProvider: true, llmModel: true },
      }),
      this.credentialsService.listCredentials(userId),
    ]);
    const binding = pickLlmBinding({
      llmProvider: user?.llmProvider,
      llmModel: user?.llmModel,
      credentialProviders: credentials.map((c) => c.provider),
    });
    if (!binding) {
      return {
        provider: this.defaultProvider,
        providerName: this.defaultProvider.name,
        model: null,
        keySource: 'default',
        bindingSource: null,
      };
    }
    const { provider, model } = binding;

    // Catalog drift (model retired after selection) fails with a reason the
    // user can act on rather than an opaque provider 404.
    if (!isLlmProvider(provider) || !findLlmModel(provider, model)) {
      throw new ExtractionFailedError(
        'Selected AI model is no longer available — choose another one in Settings',
      );
    }

    const userKey = await this.credentialsService.resolveApiKey(userId, provider);
    // The shared deployment key backs an explicit, gated selection only. A
    // credential-derived binding is justified by the stored key alone: when
    // that key cannot be read (master key rotated, row corrupt) the intent is
    // gone, and silently billing the deployment's key would be worse.
    const apiKey =
      userKey ??
      (binding.source === 'selection'
        ? this.configService.get<string>(LLM_SHARED_KEY_ENV[provider])
        : undefined);
    if (!apiKey) {
      throw new ExtractionFailedError(
        binding.source === 'credential'
          ? 'Your stored API key could not be read — save it again in Settings'
          : 'Selected AI provider has no API key — add one in Settings or choose another model',
      );
    }
    return {
      provider: this.getInstance(provider, model, apiKey),
      providerName: provider,
      model,
      keySource: userKey ? 'user' : 'shared',
      bindingSource: binding.source,
    };
  }

  private getInstance(
    provider: 'anthropic' | 'openai',
    model: string,
    apiKey: string,
  ): ReceiptExtractionProvider {
    const digest = createHash('sha256').update(apiKey).digest('base64url').slice(0, 16);
    const cacheKey = `${provider}:${model}:${digest}`;
    const cached = this.instances.get(cacheKey);
    if (cached) return cached;

    const bare =
      provider === 'anthropic'
        ? new AnthropicExtractionProvider({ apiKey, model })
        : new OpenAiExtractionProvider({
            apiKey,
            model,
            baseUrl: this.configService.get('OPENAI_BASE_URL'),
          });
    const instance = new ResilientExtractionProvider(bare);
    if (this.instances.size >= INSTANCE_CACHE_MAX) {
      const oldest = this.instances.keys().next().value;
      if (oldest) this.instances.delete(oldest);
      this.logger.log('Extraction instance cache full — evicted oldest entry');
    }
    this.instances.set(cacheKey, instance);
    return instance;
  }
}
