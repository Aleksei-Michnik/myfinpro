import {
  validateExtractionResult,
  type ExtractionResult,
  type ExtractionValidationError,
} from '@myfinpro/shared';
import type { Logger } from '@nestjs/common';
import { mergeContinuationItems } from './extraction-continuation.util';
import { normalizeExtractionPayload } from './extraction-normalize.util';
import { ExtractionFailedError } from './extraction-provider.interface';
import { buildRepairPrompt } from './extraction.schema';

/**
 * The tail every provider shares once it holds the model's final text:
 * parse → splice earlier chunks → normalize → validate, and only if that
 * still fails, ONE repair round-trip where the model is shown its own
 * validation errors.
 *
 * The escalation is deliberate. The prompt (extraction.schema.ts) teaches the
 * model what valid output looks like; `normalizeExtractionPayload` fixes the
 * unambiguous drift for free; the repair call costs a second request per
 * receipt and is therefore the last resort, never the first.
 */

/** Sends `prompt` to the model, returning its raw text (null if unusable). */
export type ExtractionRepairFn = (prompt: string) => Promise<string | null>;

export interface FinalizeExtractionParams {
  /** The final pass's raw model output. */
  text: string;
  /** Complete items salvaged from earlier truncated passes (8.21). */
  salvaged: Record<string, unknown>[];
  logger: Logger;
  providerName: string;
  /** Omitted by providers that cannot make a follow-up call. */
  repair?: ExtractionRepairFn;
}

export async function finalizeExtraction(
  params: FinalizeExtractionParams,
): Promise<ExtractionResult> {
  const { text, salvaged, logger, providerName, repair } = params;

  const merged = mergeContinuationItems(parseJson(text), salvaged);
  const first = normalizeAndValidate(merged);
  if (first.adjustments.length > 0) {
    logger.log(
      `${providerName} extraction: normalized provider output — ${first.adjustments.join('; ')}`,
    );
  }
  if (first.result) return first.result;

  // Still invalid after the deterministic pass — hand the model its errors.
  if (!repair) throw rejection(first.errors);
  logger.warn(
    `${providerName} extraction: output failed validation after normalization ` +
      `(${first.errors.length} problem(s)) — asking the model to repair it`,
  );

  let repaired: string | null = null;
  try {
    repaired = await repair(buildRepairPrompt(JSON.stringify(first.payload), first.errors));
  } catch (err) {
    // The repair is a bonus round: its own failure must surface the ORIGINAL
    // problem, not a confusing second-order one.
    logger.warn(`${providerName} extraction: repair call failed — ${(err as Error).message}`);
  }
  if (!repaired) throw rejection(first.errors);

  let second: NormalizedValidation;
  try {
    second = normalizeAndValidate(JSON.parse(repaired));
  } catch {
    throw rejection(first.errors);
  }
  if (second.result) {
    logger.log(`${providerName} extraction: model repaired its output — extraction recovered`);
    return second.result;
  }
  logger.warn(
    `${providerName} extraction: repair did not resolve the problems ` +
      `(${second.errors.length} left) — failing the receipt`,
  );
  throw rejection(first.errors);
}

interface NormalizedValidation {
  payload: unknown;
  adjustments: string[];
  errors: ExtractionValidationError[];
  result?: ExtractionResult;
}

function normalizeAndValidate(payloadIn: unknown): NormalizedValidation {
  const { payload, adjustments } = normalizeExtractionPayload(payloadIn);
  const validated = validateExtractionResult(payload);
  return { payload, adjustments, errors: validated.errors, result: validated.result };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ExtractionFailedError('Provider returned non-JSON output', err);
  }
}

function rejection(errors: ExtractionValidationError[]): ExtractionFailedError {
  return new ExtractionFailedError(
    `Provider output failed validation: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
  );
}
