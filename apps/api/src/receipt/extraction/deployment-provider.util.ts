import type { ConfigService } from '@nestjs/config';

export const SUPPORTED_EXTRACTION_PROVIDERS = ['mock', 'anthropic', 'openai'] as const;

export type DeploymentExtractionProvider =
  | (typeof SUPPORTED_EXTRACTION_PROVIDERS)[number]
  | 'unconfigured';

/**
 * Phase 8.11-hotfix — reads `RECEIPT_EXTRACTION_PROVIDER`: an explicit value
 * must be one of SUPPORTED_EXTRACTION_PROVIDERS (a typo is a config error, so
 * it fails the boot); unset or blank means `mock` outside production and
 * `unconfigured` when `NODE_ENV === 'production'` — a production deployment
 * must never impersonate recognition with the canned fixture.
 *
 * Blank counts as unset because compose passes an empty string for an
 * undefined variable (`${RECEIPT_EXTRACTION_PROVIDER:-}`).
 */
export function resolveDeploymentProvider(config: ConfigService): DeploymentExtractionProvider {
  const selected = config.get<string>('RECEIPT_EXTRACTION_PROVIDER')?.trim();
  if (!selected) {
    return config.get<string>('NODE_ENV') === 'production' ? 'unconfigured' : 'mock';
  }
  if (!(SUPPORTED_EXTRACTION_PROVIDERS as readonly string[]).includes(selected)) {
    throw new Error(
      `Unknown RECEIPT_EXTRACTION_PROVIDER '${selected}' — supported: ${SUPPORTED_EXTRACTION_PROVIDERS.join(', ')}`,
    );
  }
  return selected as DeploymentExtractionProvider;
}
