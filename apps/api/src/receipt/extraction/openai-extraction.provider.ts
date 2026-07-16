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

interface ChatCompletionPayload {
  choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

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
      docContent.push({
        type: 'image_url',
        image_url: { url: `data:${input.mimeType};base64,${input.data.toString('base64')}` },
      });
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
      const choice = await this.callModel([...docContent, { type: 'text', text: prompt }]);
      const message = choice?.message;
      if (message?.refusal) {
        throw new ExtractionFailedError('Provider declined to process this document');
      }
      if (!message?.content) {
        throw new ExtractionFailedError('Provider returned no content');
      }

      if (choice?.finish_reason === 'length') {
        // Chunk boundary: keep this pass's complete items, continue after them.
        const before = salvaged.length;
        salvaged.push(...salvageCompleteItems(message.content));
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
        prompt = buildContinuationPrompt(basePrompt, salvaged.length, lastSalvagedName(salvaged));
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(message.content);
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

  /** One chat-completions call; 4xx (except 429) fails permanently. */
  private async callModel(
    userContent: unknown[],
  ): Promise<NonNullable<ChatCompletionPayload['choices']>[number] | undefined> {
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

    const payload = (await res.json()) as ChatCompletionPayload;
    this.logger.log(
      `openai extraction: model=${this.model} durationMs=${Date.now() - started} ` +
        `input=${payload.usage?.prompt_tokens ?? '?'}tok output=${payload.usage?.completion_tokens ?? '?'}tok ` +
        `finish=${payload.choices?.[0]?.finish_reason ?? '?'}`,
    );
    return payload.choices?.[0];
  }
}
