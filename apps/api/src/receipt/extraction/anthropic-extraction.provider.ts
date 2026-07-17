import Anthropic from '@anthropic-ai/sdk';
import { validateExtractionResult, type ExtractionResult } from '@myfinpro/shared';
import { Logger } from '@nestjs/common';
import {
  buildContinuationPrompt,
  lastSalvagedName,
  MAX_EXTRACTION_CONTINUATIONS,
  mergeContinuationItems,
  salvageCompleteItems,
} from './extraction-continuation.util';
import {
  ExtractionFailedError,
  type ExtractionContext,
  type ExtractionInput,
  type LlmClientOptions,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';
import {
  buildExtractionPrompt,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_RESULT_JSON_SCHEMA,
} from './extraction.schema';

/**
 * Phase 7, iteration 7.5 — Anthropic vision extraction.
 *
 * Images ride as base64 `image` blocks, PDFs as `document` blocks, URL
 * snapshots as plain text — always before the instruction text block.
 * Structured output is enforced with `output_config.format` (json_schema)
 * and re-validated with the shared validator before returning, so schema
 * drift becomes a permanent ExtractionFailedError instead of bad rows.
 *
 * 8.21: calls stream (required at this max_tokens), a pass that stops at
 * the output ceiling salvages its complete items and CONTINUES in a fresh
 * call (chunked extraction — no generated tokens are lost), and 4xx API
 * rejections fail permanently instead of burning retries.
 *
 * Built by the module factory (env key/model) or the per-user resolver
 * (Phase 8.11) — never injected directly.
 */
export class AnthropicExtractionProvider implements ReceiptExtractionProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicExtractionProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: LlmClientOptions = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || 'claude-opus-4-8';
  }

  async extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult> {
    const docBlocks = this.buildDocBlocks(input);
    const basePrompt = buildExtractionPrompt(ctx);

    const salvaged: Record<string, unknown>[] = [];
    let prompt = basePrompt;
    for (let pass = 0; pass <= MAX_EXTRACTION_CONTINUATIONS; pass++) {
      const response = await this.callModel([...docBlocks, { type: 'text', text: prompt }]);

      if (response.stop_reason === 'refusal') {
        throw new ExtractionFailedError('Provider declined to process this document');
      }
      const text = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text',
      )?.text;
      if (!text) {
        throw new ExtractionFailedError('Provider returned no text content');
      }

      if (response.stop_reason === 'max_tokens') {
        // Chunk boundary: keep this pass's complete items, continue after them.
        const before = salvaged.length;
        salvaged.push(...salvageCompleteItems(text));
        if (salvaged.length === before) {
          throw new ExtractionFailedError(
            'Provider output was cut off and no line items could be salvaged — ' +
              'the document may be too complex',
          );
        }
        this.logger.warn(
          `anthropic extraction truncated (pass ${pass + 1}) — ` +
            `continuing from item ${salvaged.length}`,
        );
        prompt = buildContinuationPrompt(basePrompt, salvaged.length, lastSalvagedName(salvaged));
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
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

  /** One streamed model call; permanent 4xx rejections fail the receipt. */
  private async callModel(content: Anthropic.ContentBlockParam[]): Promise<Anthropic.Message> {
    const started = Date.now();
    let response: Anthropic.Message;
    try {
      // Streaming is required by the SDK guidance for max_tokens > ~16K
      // (non-streaming requests risk HTTP timeouts); we only need the
      // final message, not the deltas.
      response = await this.client.messages
        .stream({
          model: this.model,
          max_tokens: EXTRACTION_MAX_OUTPUT_TOKENS,
          thinking: { type: 'adaptive' },
          output_config: {
            format: {
              type: 'json_schema',
              schema: EXTRACTION_RESULT_JSON_SCHEMA as unknown as Record<string, unknown>,
            },
          },
          messages: [{ role: 'user', content }],
        })
        .finalMessage();
    } catch (err) {
      // A 4xx (other than 429) is a permanent request/model incompatibility
      // — e.g. a model that rejects adaptive thinking — not a provider
      // outage; retrying it just burns paid calls (8.21).
      if (
        err instanceof Anthropic.APIError &&
        typeof err.status === 'number' &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        throw new ExtractionFailedError(
          `Provider rejected the request (${err.status}): ${err.message.slice(0, 300)}`,
          err,
        );
      }
      throw err;
    }

    this.logger.log(
      `anthropic extraction: model=${this.model} durationMs=${Date.now() - started} ` +
        `input=${response.usage.input_tokens}tok output=${response.usage.output_tokens}tok ` +
        `stop=${response.stop_reason}`,
    );
    return response;
  }

  private buildDocBlocks(input: ExtractionInput): Anthropic.ContentBlockParam[] {
    if (input.kind === 'image') {
      // One block per photographed page, in shot order (8.22).
      return input.pages.map(
        (page): Anthropic.ContentBlockParam => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: page.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: page.data.toString('base64'),
          },
        }),
      );
    }
    if (input.kind === 'pdf') {
      return [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.data.toString('base64'),
          },
        },
      ];
    }
    return [
      {
        type: 'text',
        text: `Online receipt snapshot from ${input.sourceUrl}:\n\n${input.data.slice(0, 200_000)}`,
      },
    ];
  }
}
