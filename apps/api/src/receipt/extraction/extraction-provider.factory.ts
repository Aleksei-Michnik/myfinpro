import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicExtractionProvider } from './anthropic-extraction.provider';
import { resolveDeploymentProvider } from './deployment-provider.util';
import { RECEIPT_EXTRACTION_PROVIDER } from './extraction-provider.interface';
import { MockExtractionProvider } from './mock-extraction.provider';
import { OpenAiExtractionProvider } from './openai-extraction.provider';
import { ResilientExtractionProvider } from './resilient-extraction.provider';
import { UnconfiguredExtractionProvider } from './unconfigured-extraction.provider';

export { SUPPORTED_EXTRACTION_PROVIDERS } from './deployment-provider.util';

/**
 * Phase 7, iteration 7.5 — binds `RECEIPT_EXTRACTION_PROVIDER` (the DI
 * token) to the env-selected implementation; since Phase 8.11 this binding
 * is the DEPLOYMENT DEFAULT, used for uploaders without a personal model
 * selection or stored key (the per-user path is ExtractionResolverService).
 * Real providers are wrapped in the retry + circuit-breaker decorator; the
 * mock stays bare so tests and dev remain fully deterministic. An unknown
 * value fails the boot — a typo in the provider name is a config error, not
 * something to silently mask with the mock.
 *
 * 8.11-hotfix: an unset provider in production binds
 * UnconfiguredExtractionProvider instead of the mock, and both that and a
 * deliberate mock in production log at WARN — production's LOG_LEVEL is
 * `warn`, so an info line about serving canned fixtures is never seen.
 */
export const extractionProviderFactory: Provider = {
  provide: RECEIPT_EXTRACTION_PROVIDER,
  inject: [ConfigService, MockExtractionProvider],
  useFactory: (config: ConfigService, mock: MockExtractionProvider) => {
    const selected = resolveDeploymentProvider(config);
    const logger = new Logger('ExtractionProviderFactory');
    if (selected === 'unconfigured') {
      logger.warn(
        'Receipt extraction provider: none configured — receipts fail until RECEIPT_EXTRACTION_PROVIDER and its API key are set, or the uploader stores a personal key in Settings (runbook §0)',
      );
      return new UnconfiguredExtractionProvider();
    }
    if (selected === 'mock' && config.get<string>('NODE_ENV') === 'production') {
      logger.warn(
        'Receipt extraction provider: mock (production) — every receipt without a personal key returns the canned fixture',
      );
      return mock;
    }
    logger.log(`Receipt extraction provider: ${selected}`);
    const model = config.get<string>('RECEIPT_EXTRACTION_MODEL');
    if (selected === 'anthropic') {
      return new ResilientExtractionProvider(
        new AnthropicExtractionProvider({ apiKey: config.get('ANTHROPIC_API_KEY'), model }),
      );
    }
    if (selected === 'openai') {
      return new ResilientExtractionProvider(
        new OpenAiExtractionProvider({
          apiKey: config.get('OPENAI_API_KEY'),
          model,
          baseUrl: config.get('OPENAI_BASE_URL'),
        }),
      );
    }
    return mock;
  },
};
