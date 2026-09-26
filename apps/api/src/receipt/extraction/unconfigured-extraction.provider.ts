import type { ExtractionResult } from '@myfinpro/shared';
import {
  ExtractionFailedError,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';

export const EXTRACTION_UNCONFIGURED_MESSAGE =
  'No AI provider is configured for reading receipts — add your API key in Settings → Account → AI model, or ask the administrator to configure one';

/**
 * Phase 8.11-hotfix — the deployment default in a production deployment that
 * set no `RECEIPT_EXTRACTION_PROVIDER`. It fails every extraction with a
 * settings-facing reason instead of returning the mock's canned fixture,
 * which reads as a successful recognition of a receipt nobody read.
 *
 * `ExtractionFailedError` is permanent: the worker marks the receipt FAILED
 * with this reason and burns no retries.
 */
export class UnconfiguredExtractionProvider implements ReceiptExtractionProvider {
  readonly name = 'unconfigured';

  async extract(): Promise<ExtractionResult> {
    throw new ExtractionFailedError(EXTRACTION_UNCONFIGURED_MESSAGE);
  }
}
