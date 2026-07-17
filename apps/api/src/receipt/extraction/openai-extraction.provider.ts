import { validateExtractionResult, type ExtractionResult } from '@myfinpro/shared';
import { Logger } from '@nestjs/common';
import {
  buildContinuationPrompt,
  lastSalvagedName,
  MAX_EXTRACTION_CONTINUATIONS,
  mergeContinuationItems,
  salvageCompleteItems,
} from './extraction-continuation.util';
import { RawNameCounter } from './extraction-progress.util';
import {
  ExtractionFailedError,
  type ExtractionContext,
  type ExtractionInput,
  type ExtractionProgressUpdate,
  type LlmClientOptions,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';
import {
  buildExtractionPrompt,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_RESULT_JSON_SCHEMA,
} from './extraction.schema';
import { consumeChatCompletionsStream } from './openai-sse.util';

/**
 * Phase 7, iteration 7.5 — OpenAI vision extraction (raw HTTP on purpose:
 * one endpoint, no SDK dependency for the secondary provider).
 *
 * Images ride as `image_url` data-URLs; URL snapshots as text. PDFs are NOT
 * supported on the chat-completions surface — the factory's docs steer PDF
 * workloads to the anthropic provider; here they fail permanently with a
 * clear reason. Structured output via `response_format: json_schema`
 * (strict), re-validated with the shared validator.
 *
 * 8.21: a pass that stops at the output ceiling (`finish_reason: length`)
 * salvages its complete items and CONTINUES in a fresh call — chunked
 * extraction, same protocol as the anthropic provider.
 *
 * 8.26: the call streams (SSE) so content deltas can drive live progress.
 * No 'thinking' stage — reasoning summaries are not exposed on the
 * chat-completions surface; the UI degrades to generic animated states.
 *
 * Built by the module factory (env key/model) or the per-user resolver
 * (Phase 8.11) — never injected directly.
 */
export class OpenAiExtractionProvider implements ReceiptExtractionProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiExtractionProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: LlmClientOptions = {}) {
    this.apiKey = options.apiKey ?? '';
    this.model = options.model || 'gpt-4o';
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1';
  }

  async extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult> {
    if (input.kind === 'pdf') {
      throw new ExtractionFailedError(
        "The 'openai' extraction provider does not support PDFs; use the 'anthropic' provider for PDF receipts",
      );
    }

    const docContent: unknown[] = [];
    if (input.kind === 'image') {
      // One image per photographed page, in shot order (8.22).
      for (const page of input.pages) {
        docContent.push({
          type: 'image_url',
          image_url: { url: `data:${page.mimeType};base64,${page.data.toString('base64')}` },
        });
      }
    } else {
      docContent.push({
        type: 'text',
        text: `Online receipt snapshot from ${input.sourceUrl}:\n\n${input.data.slice(0, 200_000)}`,
      });
    }
    const basePrompt = buildExtractionPrompt(ctx);

    const salvaged: Record<string, unknown>[] = [];
    let prompt = basePrompt;
    for (let pass = 0; pass <= MAX_EXTRACTION_CONTINUATIONS; pass++) {
      const outcome = await this.callModel(
        [...docContent, { type: 'text', text: prompt }],
        ctx.onProgress,
        salvaged.length,
      );
      if (outcome.refusal) {
        throw new ExtractionFailedError('Provider declined to process this document');
      }
      if (!outcome.content) {
        throw new ExtractionFailedError('Provider returned no content');
      }

      if (outcome.finishReason === 'length') {
        // Chunk boundary: keep this pass's complete items, continue after them.
        const before = salvaged.length;
        salvaged.push(...salvageCompleteItems(outcome.content));
        if (salvaged.length === before) {
          throw new ExtractionFailedError(
            'Provider output was cut off and no line items could be salvaged — ' +
              'the document may be too complex',
          );
        }
        this.logger.warn(
          `openai extraction truncated (pass ${pass + 1}) — ` +
            `continuing from item ${salvaged.length}`,
        );
        // 8.26 — surface the chunk boundary (1-based continuation pass).
        ctx.onProgress?.({ stage: 'continuing', pass: pass + 1, itemsSoFar: salvaged.length });
        prompt = buildContinuationPrompt(basePrompt, salvaged.length, lastSalvagedName(salvaged));
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(outcome.content);
      } catch (err) {
        throw new ExtractionFailedError('Provider returned non-JSON output', err);
      }
      const validated = validateExtractionResult(mergeContinuationItems(parsed, salvaged));
      if (!validated.ok) {
        throw new ExtractionFailedError(
          `Provider output failed validation: ${validated.errors
            .map((e) => `${e.path}: ${e.message}`)
            .join('; ')}`,
        );
      }
      return validated.result!;
    }

    throw new ExtractionFailedError(
      'Provider output was cut off repeatedly — the document is too long to extract',
    );
  }

  /** One streamed chat-completions call; 4xx (except 429) fails permanently. */
  private async callModel(
    userContent: unknown[],
    onProgress: ((update: ExtractionProgressUpdate) => void) | undefined,
    itemsBase: number,
  ): Promise<Awaited<ReturnType<typeof consumeChatCompletionsStream>>> {
    const started = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: EXTRACTION_MAX_OUTPUT_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: userContent }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'receipt_extraction',
            strict: true,
            schema: EXTRACTION_RESULT_JSON_SCHEMA,
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 4xx (except 429) are permanent; 429/5xx bubble as retryable errors.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new ExtractionFailedError(
          `OpenAI request rejected (${res.status}): ${body.slice(0, 300)}`,
        );
      }
      throw new Error(`OpenAI request failed (${res.status})`);
    }
    if (!res.body) {
      throw new Error('OpenAI response had no body stream');
    }

    onProgress?.({ stage: 'processing' });
    const itemCounter = new RawNameCounter();
    const outcome = await consumeChatCompletionsStream(
      res.body as unknown as AsyncIterable<Uint8Array>,
      (delta) =>
        onProgress?.({ stage: 'generating', itemsSoFar: itemsBase + itemCounter.add(delta) }),
    );
    this.logger.log(
      `openai extraction: model=${this.model} durationMs=${Date.now() - started} ` +
        `input=${outcome.usage?.prompt_tokens ?? '?'}tok output=${outcome.usage?.completion_tokens ?? '?'}tok ` +
        `finish=${outcome.finishReason ?? '?'}`,
    );
    return outcome;
  }
}
