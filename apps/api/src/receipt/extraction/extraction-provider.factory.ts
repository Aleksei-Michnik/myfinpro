import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicExtractionProvider } from './anthropic-extraction.provider';
import { RECEIPT_EXTRACTION_PROVIDER } from './extraction-provider.interface';
import { MockExtractionProvider } from './mock-extraction.provider';
import { OpenAiExtractionProvider } from './openai-extraction.provider';
import { ResilientExtractionProvider } from './resilient-extraction.provider';

export const SUPPORTED_EXTRACTION_PROVIDERS = ['mock', 'anthropic', 'openai'] as const;

/**
 * Phase 7, iteration 7.5 — binds `RECEIPT_EXTRACTION_PROVIDER` (the DI
 * token) to the env-selected implementation. Real providers are wrapped in
 * the retry + circuit-breaker decorator; the mock stays bare so tests and
 * dev remain fully deterministic. An unknown value fails the boot — a typo
 * in the provider name is a config error, not something to silently mask
 * with the mock.
 */
export const extractionProviderFactory: Provider = {
  provide: RECEIPT_EXTRACTION_PROVIDER,
  inject: [
    ConfigService,
    MockExtractionProvider,
    AnthropicExtractionProvider,
    OpenAiExtractionProvider,
  ],
  useFactory: (
    config: ConfigService,
    mock: MockExtractionProvider,
    anthropic: AnthropicExtractionProvider,
    openai: OpenAiExtractionProvider,
  ) => {
    const selected = config.get<string>('RECEIPT_EXTRACTION_PROVIDER', 'mock');
    if (!(SUPPORTED_EXTRACTION_PROVIDERS as readonly string[]).includes(selected)) {
      throw new Error(
        `Unknown RECEIPT_EXTRACTION_PROVIDER '${selected}' — supported: ${SUPPORTED_EXTRACTION_PROVIDERS.join(', ')}`,
      );
    }
    new Logger('ExtractionProviderFactory').log(`Receipt extraction provider: ${selected}`);
    if (selected === 'anthropic') return new ResilientExtractionProvider(anthropic);
    if (selected === 'openai') return new ResilientExtractionProvider(openai);
    return mock;
  },
};
